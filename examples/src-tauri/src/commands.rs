use crate::agent::{
    build_system_prompt, AgentConfig, AgentContent, AgentEvent, AgentLoop, AgentMessage,
};
use crate::browser::{BrowserManager, BrowserSettings, BrowserStatus};
use crate::bundles::{self, BundleMcpEntry};
use crate::claude::{ClaudeClient, Message as ClaudeMessage};
use crate::database::{
    Conversation, Database, ExecutionLog, Message, PlanStep, Settings, Task, TaskMessage,
    TASK_STATUS_COMPLETED, TASK_STATUS_FAILED, TASK_STATUS_HUMAN_REQUIRED, TASK_STATUS_PENDING,
    TASK_STATUS_RUNNING,
};
use crate::execution::ExecutionSettings;
use crate::llm_client::{LLMClient, Message as LLMMessage};
use crate::mcp::{MCPManager, MCPServerConfig, MCPServerStatus, MCPToolCall, MCPToolResult};
use crate::skills::{get_available_skills, SkillMetadata};
use crate::tools::docker::{prepull_images, DEFAULT_PREPULL_IMAGES};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{command, Emitter, State, Window};
use tokio::sync::Mutex;

pub struct AppState {
    pub db: Arc<Database>,
    pub claude_client: Mutex<Option<ClaudeClient>>,
    pub mcp_manager: Arc<MCPManager>,
    pub browser_manager: Arc<BrowserManager>,
}

#[derive(Debug, Serialize)]
pub struct CommandError {
    message: String,
}

impl From<crate::database::DbError> for CommandError {
    fn from(e: crate::database::DbError) -> Self {
        CommandError {
            message: e.to_string(),
        }
    }
}

impl From<crate::claude::ClaudeError> for CommandError {
    fn from(e: crate::claude::ClaudeError) -> Self {
        CommandError {
            message: e.to_string(),
        }
    }
}

fn tool_result_needs_human_handoff(tool: &str, result: &str) -> bool {
    if !tool.starts_with("browser_") {
        return false;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(result) {
        let explicit_handoff = value
            .get("needs_user_handoff")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let waiting_state = matches!(
            value.get("session_state").and_then(|v| v.as_str()),
            Some("waiting_for_user")
        );
        if explicit_handoff || waiting_state {
            return true;
        }
    }

    let lower = result.to_lowercase();
    lower.contains("needs_user_handoff")
        || lower.contains("waiting_for_user")
        || lower.contains("human verification")
        || lower.contains("authentication/challenge")
}

#[derive(Debug, Clone, Serialize)]
pub struct BundleMcpSuggestion {
    pub bundle_id: String,
    pub bundle_name: String,
    pub server_key: String,
    pub server_url: String,
    pub suggested_id: String,
    pub suggested_name: String,
    pub already_configured: bool,
}

fn apply_tool_permissions(config: &mut AgentConfig, settings: &Settings) {
    fn ensure_tool(tools: &mut Vec<String>, name: &str) {
        if !tools.iter().any(|t| t == name) {
            tools.push(name.to_string());
        }
    }

    fn remove_tool(tools: &mut Vec<String>, name: &str) {
        tools.retain(|t| t != name);
    }

    let backend = settings.execution_backend.trim().to_lowercase();
    let containers_enabled = settings.container_enabled && backend == "docker";
    let browser_enabled = settings.browser_enabled;

    if containers_enabled {
        ensure_tool(&mut config.allowed_tools, "exec_container");
    } else {
        remove_tool(&mut config.allowed_tools, "exec_container");
    }

    let browser_tools = [
        "browser_task",
        "browser_navigate",
        "browser_extract",
        "browser_screenshot",
        "browser_close",
        "browser_status",
    ];

    if browser_enabled {
        for tool in browser_tools {
            ensure_tool(&mut config.allowed_tools, tool);
        }
    } else {
        for tool in browser_tools {
            remove_tool(&mut config.allowed_tools, tool);
        }
    }
}

fn apply_structured_output_tools(config: &mut AgentConfig, enabled: bool) {
    fn ensure_tool(tools: &mut Vec<String>, name: &str) {
        if !tools.iter().any(|t| t == name) {
            tools.push(name.to_string());
        }
    }

    fn remove_tool(tools: &mut Vec<String>, name: &str) {
        tools.retain(|t| t != name);
    }

    if enabled {
        ensure_tool(&mut config.allowed_tools, "emit_plan");
    } else {
        remove_tool(&mut config.allowed_tools, "emit_plan");
    }
}

const ROUTER_CONFIDENCE_THRESHOLD: f32 = 0.6;
const ROUTER_MAX_TOKENS: u32 = 256;

#[derive(Debug, Deserialize)]
struct RouterPipelineStep {
    provider: Option<String>,
    model: Option<String>,
    purpose: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RouterDecision {
    label: String,
    confidence: Option<f32>,
    #[allow(dead_code)]
    tool_hint: Option<Vec<String>>,
    #[allow(dead_code)]
    task_type: Option<String>,
    recommended_provider: Option<String>,
    recommended_model: Option<String>,
    #[allow(dead_code)]
    pipeline_steps: Option<Vec<RouterPipelineStep>>,
}

struct RouterOutcome {
    planning: bool,
    decision: Option<RouterDecision>,
}

async fn determine_planning(settings: &Settings, message: &str) -> RouterOutcome {
    if settings.router_model.trim().is_empty() {
        return RouterOutcome {
            planning: true,
            decision: None,
        };
    }

    match classify_request(settings, message).await {
        Ok(decision) => {
            let label = decision.label.trim().to_lowercase();
            let confidence = decision.confidence.unwrap_or(0.0);
            RouterOutcome {
                planning: label == "unknown" || confidence < ROUTER_CONFIDENCE_THRESHOLD,
                decision: Some(decision),
            }
        }
        Err(err) => {
            println!(
                "[router] classification unavailable ({}); falling back to direct mode",
                err
            );
            RouterOutcome {
                // If router fails, keep execution resilient by avoiding forced planning mode.
                planning: false,
                decision: None,
            }
        }
    }
}

async fn classify_request(settings: &Settings, message: &str) -> Result<RouterDecision, String> {
    let router_model = settings.router_model.trim();
    if router_model.is_empty() {
        return Err("router disabled".to_string());
    }

    let provider_id = settings.get_provider();
    let client = LLMClient::new_with_openai_headers(
        settings.api_key.clone(),
        Some(settings.base_url.clone()),
        Some(&provider_id),
        Some(router_model),
        settings.openai_organization.clone(),
        settings.openai_project.clone(),
    );

    let prompt = build_router_prompt(message);
    let messages = vec![LLMMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    let raw = client
        .send_message(messages, router_model, ROUTER_MAX_TOKENS, Some(0.0))
        .await
        .map_err(|e| e.to_string())?;

    Ok(parse_router_decision(&raw).unwrap_or(RouterDecision {
        label: "unknown".to_string(),
        confidence: Some(0.0),
        tool_hint: None,
        task_type: None,
        recommended_provider: None,
        recommended_model: None,
        pipeline_steps: None,
    }))
}

fn build_router_prompt(message: &str) -> String {
    format!(
        "You are a routing classifier for a desktop AI agent.\n\n\
Return ONLY a JSON object matching:\n\
{{\"label\":\"direct|tool|web|unknown\",\"confidence\":0.0-1.0,\"tool_hint\":[\"optional\",\"tools\"],\"task_type\":\"writing|coding|research|planning|general\",\"recommended_provider\":\"optional\",\"recommended_model\":\"optional\",\"pipeline_steps\":[{{\"provider\":\"optional\",\"model\":\"optional\",\"purpose\":\"optional\"}}]}}\n\n\
Rules:\n\
- direct: can answer without tools or planning\n\
- tool: likely needs local tools (files, commands, search)\n\
- web: likely needs live web access\n\
- unknown: you are unsure\n\
- If unsure, choose \"unknown\" and low confidence.\n\n\
User request:\n{}\n",
        message
    )
}

fn parse_router_decision(text: &str) -> Option<RouterDecision> {
    if let Some(parsed) = parse_router_candidate(text.trim()) {
        return Some(parsed);
    }

    for candidate in extract_balanced_json_objects(text) {
        if let Some(parsed) = parse_router_candidate(&candidate) {
            return Some(parsed);
        }
    }

    parse_router_decision_from_text(text).or_else(|| {
        sanitize_router_decision(RouterDecision {
            label: "unknown".to_string(),
            confidence: Some(0.0),
            tool_hint: None,
            task_type: None,
            recommended_provider: None,
            recommended_model: None,
            pipeline_steps: None,
        })
    })
}

fn parse_router_candidate(candidate: &str) -> Option<RouterDecision> {
    if let Ok(parsed) = serde_json::from_str::<RouterDecision>(candidate) {
        if let Some(sanitized) = sanitize_router_decision(parsed) {
            return Some(sanitized);
        }
    }

    let value = serde_json::from_str::<serde_json::Value>(candidate).ok()?;
    parse_router_decision_from_value(&value)
}

fn parse_router_decision_from_value(value: &serde_json::Value) -> Option<RouterDecision> {
    let object = find_router_object(value)?;

    let label = extract_router_label(object).or_else(|| infer_router_label(object));
    let confidence = extract_router_confidence(object);
    let tool_hint = extract_router_tools(object);
    let task_type = extract_optional_string(object, &["task_type", "task", "type"]);
    let recommended_provider = extract_optional_string(
        object,
        &["recommended_provider", "provider", "target_provider"],
    );
    let recommended_model =
        extract_optional_string(object, &["recommended_model", "model", "target_model"]);
    let pipeline_steps = extract_pipeline_steps(object);

    sanitize_router_decision(RouterDecision {
        label: label.unwrap_or_else(|| "unknown".to_string()),
        confidence,
        tool_hint,
        task_type,
        recommended_provider,
        recommended_model,
        pipeline_steps,
    })
}

fn find_router_object<'a>(
    value: &'a serde_json::Value,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    match value {
        serde_json::Value::Object(map) => {
            if looks_like_router_object(map) {
                return Some(map);
            }

            for nested in map.values() {
                if let Some(found) = find_router_object(nested) {
                    return Some(found);
                }
            }

            None
        }
        serde_json::Value::Array(items) => {
            for item in items {
                if let Some(found) = find_router_object(item) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn looks_like_router_object(map: &serde_json::Map<String, serde_json::Value>) -> bool {
    map.contains_key("label")
        || map.contains_key("route")
        || map.contains_key("classification")
        || map.contains_key("task_type")
        || map.contains_key("tool_hint")
        || map.contains_key("recommended_model")
        || map.contains_key("recommended_provider")
}

fn extract_router_label(map: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    let candidate = extract_optional_string(
        map,
        &[
            "label",
            "route",
            "classification",
            "decision",
            "category",
            "mode",
        ],
    )?;
    normalize_router_label(&candidate)
}

fn infer_router_label(map: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    if let Some(task_type) = extract_optional_string(map, &["task_type", "task", "type"]) {
        let normalized = task_type.to_lowercase();
        if normalized.contains("research") || normalized.contains("web") {
            return Some("web".to_string());
        }
        if normalized.contains("coding")
            || normalized.contains("plan")
            || normalized.contains("automation")
        {
            return Some("tool".to_string());
        }
        if normalized.contains("writing") || normalized.contains("general") {
            return Some("direct".to_string());
        }
    }

    if extract_router_tools(map).is_some() {
        return Some("tool".to_string());
    }

    None
}

fn normalize_router_label(raw: &str) -> Option<String> {
    let lower = raw.trim().to_lowercase();
    if lower.is_empty() {
        return None;
    }

    let compact = lower
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();

    match compact.as_str() {
        "direct" | "answer" | "chat" | "simple" | "no_tool" | "notool" | "no_tools"
        | "direct_response" => return Some("direct".to_string()),
        "tool" | "tools" | "local" | "command" | "commands" | "filesystem" | "mcp" | "tool_use" => {
            return Some("tool".to_string())
        }
        "web" | "internet" | "online" | "browser" | "search" | "web_search" => {
            return Some("web".to_string())
        }
        "unknown" | "unsure" | "uncertain" | "unclear" | "ambiguous" | "other" => {
            return Some("unknown".to_string())
        }
        _ => {}
    }

    if compact.contains("web")
        || compact.contains("internet")
        || compact.contains("online")
        || compact.contains("browser")
        || compact.contains("search")
    {
        return Some("web".to_string());
    }

    if compact.contains("tool")
        || compact.contains("file")
        || compact.contains("command")
        || compact.contains("shell")
        || compact.contains("mcp")
        || compact.contains("local")
    {
        return Some("tool".to_string());
    }

    if compact.contains("direct") || compact.contains("answer") || compact.contains("chat") {
        return Some("direct".to_string());
    }

    if compact.contains("unknown")
        || compact.contains("unsure")
        || compact.contains("uncertain")
        || compact.contains("unclear")
    {
        return Some("unknown".to_string());
    }

    None
}

fn parse_router_decision_from_text(text: &str) -> Option<RouterDecision> {
    let label_regex =
        Regex::new(r#"(?i)\b(?:label|route|classification|decision)\b\s*[:=]\s*["']?([a-z_ -]+)"#)
            .ok()?;
    let confidence_regex = Regex::new(
        r#"(?i)\b(?:confidence|score|probability|certainty)\b\s*[:=]\s*["']?([0-9]+(?:\.[0-9]+)?%?)"#,
    )
    .ok()?;

    let label = label_regex
        .captures(text)
        .and_then(|caps| caps.get(1))
        .and_then(|m| normalize_router_label(m.as_str()))?;
    let confidence = confidence_regex
        .captures(text)
        .and_then(|caps| caps.get(1))
        .and_then(|m| parse_confidence_string(m.as_str()));

    sanitize_router_decision(RouterDecision {
        label,
        confidence,
        tool_hint: None,
        task_type: None,
        recommended_provider: None,
        recommended_model: None,
        pipeline_steps: None,
    })
}

fn extract_router_confidence(map: &serde_json::Map<String, serde_json::Value>) -> Option<f32> {
    for key in ["confidence", "score", "probability", "certainty"] {
        if let Some(value) = map.get(key) {
            if let Some(parsed) = parse_confidence_value(value) {
                return Some(parsed);
            }
        }
    }
    None
}

fn parse_confidence_value(value: &serde_json::Value) -> Option<f32> {
    match value {
        serde_json::Value::Number(n) => normalize_confidence(n.as_f64()?),
        serde_json::Value::String(s) => parse_confidence_string(s),
        _ => None,
    }
}

fn parse_confidence_string(value: &str) -> Option<f32> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let is_percent = trimmed.ends_with('%');
    let numeric = trimmed.trim_end_matches('%').trim().parse::<f64>().ok()?;
    if is_percent {
        return normalize_confidence(numeric / 100.0);
    }

    normalize_confidence(numeric)
}

fn normalize_confidence(value: f64) -> Option<f32> {
    if !value.is_finite() {
        return None;
    }

    let normalized = if value > 1.0 && value <= 100.0 {
        value / 100.0
    } else {
        value
    };

    Some(normalized.clamp(0.0, 1.0) as f32)
}

fn extract_router_tools(map: &serde_json::Map<String, serde_json::Value>) -> Option<Vec<String>> {
    let value = map
        .get("tool_hint")
        .or_else(|| map.get("tool_hints"))
        .or_else(|| map.get("tools"))?;

    match value {
        serde_json::Value::Array(items) => {
            let mut parsed = Vec::new();
            for item in items {
                if let Some(name) = optional_string_from_value(item) {
                    parsed.push(name);
                    continue;
                }

                if let Some(name) = item
                    .as_object()
                    .and_then(|obj| extract_optional_string(obj, &["name", "tool", "id"]))
                {
                    parsed.push(name);
                }
            }
            dedupe_strings(parsed)
        }
        serde_json::Value::String(raw) => {
            let parsed = raw
                .split(|c: char| c == ',' || c == '|' || c == ';')
                .map(|token| token.trim().to_string())
                .filter(|token| !token.is_empty())
                .collect::<Vec<_>>();
            dedupe_strings(parsed)
        }
        _ => None,
    }
}

fn extract_pipeline_steps(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Option<Vec<RouterPipelineStep>> {
    let value = map
        .get("pipeline_steps")
        .or_else(|| map.get("pipeline"))
        .or_else(|| map.get("steps"))?;
    let steps = value.as_array()?;

    let mut parsed = Vec::new();
    for step in steps {
        if let Some(step_map) = step.as_object() {
            let provider = extract_optional_string(step_map, &["provider"]);
            let model = extract_optional_string(step_map, &["model"]);
            let purpose = extract_optional_string(step_map, &["purpose", "task"]);
            if provider.is_some() || model.is_some() || purpose.is_some() {
                parsed.push(RouterPipelineStep {
                    provider,
                    model,
                    purpose,
                });
            }
            continue;
        }

        if let Some(purpose) = optional_string_from_value(step) {
            parsed.push(RouterPipelineStep {
                provider: None,
                model: None,
                purpose: Some(purpose),
            });
        }
    }

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

fn extract_optional_string(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .filter_map(|key| map.get(*key))
        .find_map(optional_string_from_value)
}

fn optional_string_from_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn dedupe_strings(values: Vec<String>) -> Option<Vec<String>> {
    let mut deduped = Vec::new();
    for value in values {
        if !deduped.iter().any(|existing: &String| existing == &value) {
            deduped.push(value);
        }
    }

    if deduped.is_empty() {
        None
    } else {
        Some(deduped)
    }
}

fn sanitize_router_decision(mut decision: RouterDecision) -> Option<RouterDecision> {
    decision.label = normalize_router_label(&decision.label)?;

    decision.confidence = decision
        .confidence
        .and_then(|value| normalize_confidence(value as f64));

    decision.tool_hint = decision.tool_hint.and_then(dedupe_strings);

    decision.task_type = decision.task_type.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    decision.recommended_provider = decision.recommended_provider.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    decision.recommended_model = decision.recommended_model.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    decision.pipeline_steps = decision.pipeline_steps.and_then(|steps| {
        let sanitized = steps
            .into_iter()
            .filter_map(|step| {
                let provider = step.provider.and_then(|value| {
                    let trimmed = value.trim().to_string();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
                    }
                });
                let model = step.model.and_then(|value| {
                    let trimmed = value.trim().to_string();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
                    }
                });
                let purpose = step.purpose.and_then(|value| {
                    let trimmed = value.trim().to_string();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
                    }
                });

                if provider.is_some() || model.is_some() || purpose.is_some() {
                    Some(RouterPipelineStep {
                        provider,
                        model,
                        purpose,
                    })
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        if sanitized.is_empty() {
            None
        } else {
            Some(sanitized)
        }
    });

    Some(decision)
}

fn extract_balanced_json_objects(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let mut depth: usize = 0;
    let mut in_string = false;
    let mut escaped = false;

    for (idx, ch) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
            continue;
        }

        if ch == '{' {
            if depth == 0 {
                start = Some(idx);
            }
            depth += 1;
            continue;
        }

        if ch == '}' && depth > 0 {
            depth -= 1;
            if depth == 0 {
                if let Some(s) = start {
                    out.push(text[s..=idx].to_string());
                }
                start = None;
            }
        }
    }

    out
}

fn select_routed_model(settings: &Settings, decision: Option<&RouterDecision>) -> (String, String) {
    let provider_id = settings.get_provider();
    let mut model = settings.model.clone();

    if let Some(decision) = decision {
        if let Some(rec_model) = decision
            .recommended_model
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            let rec_provider = decision
                .recommended_provider
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty());

            if rec_provider
                .map(|p| p.eq_ignore_ascii_case(&provider_id))
                .unwrap_or(true)
            {
                model = rec_model.to_string();
            } else if let Some(provider) = rec_provider {
                println!(
                    "[router] ignoring recommended provider '{}' (current: '{}')",
                    provider, provider_id
                );
            }
        }
    }

    (provider_id, model)
}

// Platform command
#[command]
pub fn get_platform() -> String {
    #[cfg(target_os = "macos")]
    return "darwin".to_string();

    #[cfg(target_os = "windows")]
    return "windows".to_string();

    #[cfg(target_os = "linux")]
    return "linux".to_string();

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return "unknown".to_string();
}

// Settings commands
#[command]
pub fn get_settings(state: State<'_, Arc<AppState>>) -> Result<Settings, CommandError> {
    let settings = state.db.get_settings()?;
    println!(
        "[get_settings] api_key length from db: {}",
        settings.api_key.len()
    );
    Ok(settings)
}

#[command]
pub async fn save_settings(
    state: State<'_, Arc<AppState>>,
    settings: Settings,
) -> Result<(), CommandError> {
    println!("[save_settings] model: {}", settings.model);
    println!("[save_settings] base_url: {}", settings.base_url);
    println!("[save_settings] api_key length: {}", settings.api_key.len());
    // Show first and last 10 chars for debugging
    if settings.api_key.len() > 20 {
        println!(
            "[save_settings] api_key preview: {}...{}",
            &settings.api_key[..10],
            &settings.api_key[settings.api_key.len() - 10..]
        );
    }

    state.db.save_settings(&settings)?;

    // Update Claude client with new settings
    let mut client = state.claude_client.lock().await;
    if !settings.api_key.is_empty() {
        *client = Some(ClaudeClient::new(
            settings.api_key.clone(),
            Some(settings.base_url.clone()),
        ));
    } else {
        *client = None;
    }

    Ok(())
}

#[command]
pub async fn test_connection(state: State<'_, Arc<AppState>>) -> Result<String, CommandError> {
    use crate::llm_client::{LLMClient, Message};

    let settings = state.db.get_settings()?;

    // Debug logging
    println!("[test_connection] model: {}", settings.model);
    println!("[test_connection] base_url: {}", settings.base_url);
    println!(
        "[test_connection] api_key length: {}",
        settings.api_key.len()
    );
    println!("[test_connection] provider: {}", settings.get_provider());
    println!(
        "[test_connection] is_local_provider: {}, allows_empty_api_key: {}",
        settings.is_local_provider(),
        settings.allows_empty_api_key()
    );

    if settings.api_key.is_empty() && !settings.allows_empty_api_key() {
        return Ok("No API key configured".to_string());
    }

    // Choose test method based on provider type
    if settings.is_local_provider() {
        // Local service - use LLMClient to check connection
        let llm_client = LLMClient::new(
            String::new(), // Local services don't need API key
            Some(settings.base_url.clone()),
            None,
            Some(&settings.model),
        );

        match llm_client.check_connection().await {
            Ok(true) => Ok("success".to_string()),
            Ok(false) => Ok(
                "Error: Cannot connect to local service, please ensure it is running".to_string(),
            ),
            Err(e) => Ok(format!("Error: {}", e)),
        }
    } else {
        // Cloud service - check provider type
        let provider = settings.get_provider();

        match provider.as_str() {
            "anthropic" => {
                // Anthropic - use ClaudeClient
                let client = ClaudeClient::new(settings.api_key, Some(settings.base_url));
                let messages = vec![ClaudeMessage {
                    role: "user".to_string(),
                    content: "Hi".to_string(),
                }];

                match client
                    .send_message(messages, &settings.model, 10, None)
                    .await
                {
                    Ok(_) => Ok("success".to_string()),
                    Err(e) => Ok(format!("Error: {}", e)),
                }
            }
            "openai" => {
                // OpenAI - test with actual API request using LLMClient
                let llm_client = LLMClient::new_with_openai_headers(
                    settings.api_key.clone(),
                    Some(settings.base_url.clone()),
                    Some("openai"),
                    Some(&settings.model),
                    settings.openai_organization.clone(),
                    settings.openai_project.clone(),
                );

                let test_messages = vec![Message {
                    role: "user".to_string(),
                    content: "Hi".to_string(),
                }];

                // Send a minimal test request
                match llm_client
                    .send_message(test_messages, &settings.model, 10, None)
                    .await
                {
                    Ok(_) => Ok("success".to_string()),
                    Err(e) => Ok(format!("Error: {}", e)),
                }
            }
            "google" => {
                // Google Gemini - test with actual API request
                let llm_client = LLMClient::new(
                    settings.api_key.clone(),
                    Some(settings.base_url.clone()),
                    Some("google"),
                    Some(&settings.model),
                );

                let test_messages = vec![Message {
                    role: "user".to_string(),
                    content: "Hi".to_string(),
                }];

                match llm_client
                    .send_message(test_messages, &settings.model, 10, None)
                    .await
                {
                    Ok(_) => Ok("success".to_string()),
                    Err(e) => Ok(format!("Error: {}", e)),
                }
            }
            _ => {
                // Other cloud services - try sending a test message
                let llm_client = LLMClient::new(
                    settings.api_key.clone(),
                    Some(settings.base_url.clone()),
                    None,
                    Some(&settings.model),
                );

                let test_messages = vec![Message {
                    role: "user".to_string(),
                    content: "Hi".to_string(),
                }];

                // Try to send a minimal test request
                match llm_client
                    .send_message(test_messages, &settings.model, 10, None)
                    .await
                {
                    Ok(_) => Ok("success".to_string()),
                    Err(e) => {
                        // If sending fails, try simple connection check (for services that support it)
                        match llm_client.check_connection().await {
                            Ok(true) => Ok("success".to_string()),
                            Ok(false) => Ok(format!("Error: {}", e)),
                            Err(conn_e) => Ok(format!("Error: {}", conn_e)),
                        }
                    }
                }
            }
        }
    }
}

// Conversation commands
#[command]
pub fn list_conversations(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<Conversation>, CommandError> {
    state.db.list_conversations().map_err(Into::into)
}

#[command]
pub fn create_conversation(
    state: State<'_, Arc<AppState>>,
    title: String,
) -> Result<Conversation, CommandError> {
    let id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .create_conversation(&id, &title)
        .map_err(Into::into)
}

#[command]
pub fn update_conversation_title(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: String,
) -> Result<(), CommandError> {
    state
        .db
        .update_conversation_title(&id, &title)
        .map_err(Into::into)
}

#[command]
pub fn delete_conversation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), CommandError> {
    state.db.delete_conversation(&id).map_err(Into::into)
}

// Message commands
#[command]
pub fn get_messages(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
) -> Result<Vec<Message>, CommandError> {
    state.db.get_messages(&conversation_id).map_err(Into::into)
}

#[command]
pub fn add_message(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
    role: String,
    content: String,
) -> Result<Message, CommandError> {
    let id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .add_message(&id, &conversation_id, &role, &content)
        .map_err(Into::into)
}

// Chat command with streaming
#[derive(Clone, Serialize)]
struct StreamPayload {
    text: String,
    done: bool,
}

#[command]
pub async fn send_chat_message(
    window: Window,
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
    content: String,
) -> Result<String, CommandError> {
    use crate::llm_client::{LLMClient, Message as LLMMessage};

    let settings = state.db.get_settings()?;

    if settings.api_key.is_empty() && !settings.allows_empty_api_key() {
        return Err(CommandError {
            message: "API key not configured".to_string(),
        });
    }

    // Add user message to database
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .add_message(&user_msg_id, &conversation_id, "user", &content)?;

    // Get conversation history
    let db_messages = state.db.get_messages(&conversation_id)?;

    // Create channel for streaming
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);

    // Spawn task to emit events
    let window_clone = window.clone();
    let emit_task = tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            let _ = window_clone.emit("chat-stream", StreamPayload { text, done: false });
        }
    });

    // Choose client based on provider
    let provider = settings.get_provider();
    let response = match provider.as_str() {
        "anthropic" => {
            // Use ClaudeClient for Anthropic
            let claude_messages: Vec<ClaudeMessage> = db_messages
                .iter()
                .map(|m| ClaudeMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect();
            let client = ClaudeClient::new(settings.api_key, Some(settings.base_url));
            client
                .send_message_stream(
                    claude_messages,
                    &settings.model,
                    settings.max_tokens,
                    Some(settings.temperature),
                    tx,
                )
                .await?
        }
        _ => {
            // Use LLMClient for OpenAI and other providers
            let llm_messages: Vec<LLMMessage> = db_messages
                .iter()
                .map(|m| LLMMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect();
            let llm_client = LLMClient::new_with_openai_headers(
                settings.api_key.clone(),
                Some(settings.base_url.clone()),
                Some(&provider),
                Some(&settings.model),
                settings.openai_organization.clone(),
                settings.openai_project.clone(),
            );
            llm_client
                .send_message_stream(
                    llm_messages,
                    &settings.model,
                    settings.max_tokens,
                    Some(settings.temperature),
                    tx,
                )
                .await
                .map_err(|e| CommandError {
                    message: e.to_string(),
                })?
        }
    };

    // Wait for emit task to finish
    let _ = emit_task.await;

    // Emit done event
    let _ = window.emit(
        "chat-stream",
        StreamPayload {
            text: response.clone(),
            done: true,
        },
    );

    // Save assistant response to database
    let assistant_msg_id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .add_message(&assistant_msg_id, &conversation_id, "assistant", &response)?;

    // Update conversation title if this is the first message
    if db_messages.len() == 1 {
        let title = if content.len() > 30 {
            format!("{}...", &content[..30])
        } else {
            content.clone()
        };
        state
            .db
            .update_conversation_title(&conversation_id, &title)?;
    }

    Ok(response)
}

// Chat event for tool-enabled chat
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ChatEvent {
    #[serde(rename = "text")]
    Text { content: String },
    #[serde(rename = "tool_start")]
    ToolStart {
        tool: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_end")]
    ToolEnd {
        tool: String,
        result: String,
        success: bool,
    },
    #[serde(rename = "done")]
    Done { final_text: String },
}

// Agent command
#[derive(Debug, Deserialize)]
pub struct AgentRequest {
    pub message: String,
    pub project_path: Option<String>,
    pub system_prompt: Option<String>,
    pub max_turns: Option<u32>,
    pub structured_output: Option<bool>,
    pub browser_consent: Option<bool>,
}

#[command]
pub async fn run_agent(
    window: Window,
    state: State<'_, Arc<AppState>>,
    request: AgentRequest,
) -> Result<String, CommandError> {
    let settings = state.db.get_settings()?;

    // Check if API Key is needed (local services don't need it)
    if settings.api_key.is_empty() && !settings.allows_empty_api_key() {
        return Err(CommandError {
            message: "API key not configured".to_string(),
        });
    }

    // Build agent config
    let mut config = AgentConfig::default();
    let routing = match request.structured_output {
        Some(value) => RouterOutcome {
            planning: value,
            decision: None,
        },
        None => determine_planning(&settings, &request.message).await,
    };
    let planning = routing.planning;
    if let Some(prompt) = request.system_prompt {
        config.system_prompt = prompt;
    } else {
        config.system_prompt = build_system_prompt(planning);

        // Add MCP servers info to default system prompt
        let mcp_servers = state.mcp_manager.get_server_statuses().await;
        let mut mcp_info = String::new();
        if !mcp_servers.is_empty() {
            mcp_info.push_str("\nMCP (Model Context Protocol) Tools:\n");
            for server in mcp_servers {
                if matches!(
                    server.status,
                    crate::mcp::types::ConnectionStatus::Connected
                ) {
                    mcp_info.push_str(&format!(
                        "Server '{}' is connected with tools:\n",
                        server.id
                    ));
                    for tool in server.tools {
                        mcp_info.push_str(&format!(
                            "  - {}: {} (use format: {}:{})\n",
                            tool.name, tool.description, server.id, tool.name
                        ));
                    }
                }
            }
        }
        if !mcp_info.is_empty() {
            config.system_prompt.push_str(&mcp_info);
        }
    }

    // Add active browser session context for continuity
    let browser_session_consent = state.browser_manager.has_session_consent().await;
    let active_sessions = if settings.browser_enabled {
        state.browser_manager.list_sessions().await
    } else {
        Vec::new()
    };
    if !active_sessions.is_empty() {
        let mut browser_context = String::from("\n\n## Active Browser Sessions\n");
        browser_context.push_str("The browser-use browser is already running. The browser will persist between `browser_task` calls, so you can build on previous interactions.\n\n");
        for session in &active_sessions {
            browser_context.push_str(&format!(
                "- **Session ID**: `{}`\n  - URL: {}\n  - Title: {}\n",
                session.session_id,
                if session.url.is_empty() {
                    "(unknown)"
                } else {
                    &session.url
                },
                if session.title.is_empty() {
                    "(untitled)"
                } else {
                    &session.title
                }
            ));
        }
        browser_context.push_str("\n### Browser Session Rules\n");
        if browser_session_consent {
            browser_context.push_str(
                "- Browser session consent is already granted for this active session. Do not ask for consent again.\n",
            );
        } else {
            browser_context.push_str(
                "- This user request has initiated browser work; treat it as session consent for the active browser session.\n",
            );
        }
        browser_context.push_str(
            "- If authentication, MFA/2FA, CAPTCHA, or security challenge requires user action, pause autonomous actions, clearly tell the user what to do, and wait.\n",
        );
        browser_context.push_str(
            "- After the user says auth is complete, continue from the existing browser state/session instead of restarting.\n",
        );
        browser_context.push_str(
            "- Continue from the current page and already-completed progress; do not restart the flow from step 1 unless the user explicitly asks.\n",
        );
        browser_context.push_str("\nUse `browser_task`, `browser_extract`, or other browser tools to continue working with the open browser.\n");
        config.system_prompt.push_str(&browser_context);
    }

    if let Some(turns) = request.max_turns {
        config.max_turns = turns;
    }
    config.project_path = request.project_path;
    apply_tool_permissions(&mut config, &settings);
    apply_structured_output_tools(&mut config, planning);

    // Get provider info
    let (provider_id, active_model) = select_routed_model(&settings, routing.decision.as_ref());
    let execution_settings = ExecutionSettings::from_settings(&settings);
    let browser_settings = BrowserSettings::from_settings(&settings);
    let browser_consent = request.browser_consent.unwrap_or(false);

    // Create agent loop with provider
    let agent = AgentLoop::new_with_provider(
        settings.api_key,
        settings.base_url,
        config,
        active_model,
        settings.max_tokens,
        Some(settings.temperature),
        state.mcp_manager.clone(),
        Some(&provider_id),
        Some(execution_settings),
        Some(state.db.clone()),
        Some(state.browser_manager.clone()),
        Some(browser_settings),
        Some(browser_consent),
    );

    // Create channel for events
    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(100);

    // Spawn event emitter
    let window_clone = window.clone();
    let emit_task = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = window_clone.emit("agent-event", &event);
        }
    });

    // Run agent
    let result = agent.run(request.message, tx).await;

    // Wait for emitter to finish
    let _ = emit_task.await;

    match result {
        Ok(_messages) => Ok("Agent completed successfully".to_string()),
        Err(e) => Err(CommandError { message: e }),
    }
}

// Enhanced chat with tools - integrates agent capabilities into chat
#[derive(Debug, Deserialize)]
pub struct EnhancedChatRequest {
    pub conversation_id: String,
    pub content: String,
    pub project_path: Option<String>,
    pub enable_tools: bool,
    pub browser_consent: Option<bool>,
}

#[command]
pub async fn send_chat_with_tools(
    window: Window,
    state: State<'_, Arc<AppState>>,
    request: EnhancedChatRequest,
) -> Result<String, CommandError> {
    use crate::agent::{
        AgentConfig, AgentContent, AgentMessage, ContentBlock, MessageBuilder, ToolExecutor,
        ToolUse,
    };
    use futures::StreamExt;

    let settings = state.db.get_settings()?;

    if settings.api_key.is_empty() && !settings.allows_empty_api_key() {
        return Err(CommandError {
            message: "API key not configured".to_string(),
        });
    }

    // Add user message to database
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    state.db.add_message(
        &user_msg_id,
        &request.conversation_id,
        "user",
        &request.content,
    )?;

    // Get conversation history
    let db_messages = state.db.get_messages(&request.conversation_id)?;

    // If tools are not enabled, fall back to simple chat
    if !request.enable_tools {
        use crate::llm_client::{LLMClient, Message as LLMMessage};

        let provider = settings.get_provider();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);

        let window_clone = window.clone();
        let emit_task = tokio::spawn(async move {
            while let Some(text) = rx.recv().await {
                let _ = window_clone.emit("chat-event", ChatEvent::Text { content: text });
            }
        });

        let response = match provider.as_str() {
            "anthropic" => {
                // Use ClaudeClient for Anthropic
                let claude_messages: Vec<ClaudeMessage> = db_messages
                    .iter()
                    .map(|m| ClaudeMessage {
                        role: m.role.clone(),
                        content: m.content.clone(),
                    })
                    .collect();
                let client =
                    ClaudeClient::new(settings.api_key.clone(), Some(settings.base_url.clone()));
                client
                    .send_message_stream(
                        claude_messages,
                        &settings.model,
                        settings.max_tokens,
                        Some(settings.temperature),
                        tx,
                    )
                    .await?
            }
            _ => {
                // Use LLMClient for OpenAI and other providers
                let llm_messages: Vec<LLMMessage> = db_messages
                    .iter()
                    .map(|m| LLMMessage {
                        role: m.role.clone(),
                        content: m.content.clone(),
                    })
                    .collect();
                let llm_client = LLMClient::new_with_openai_headers(
                    settings.api_key.clone(),
                    Some(settings.base_url.clone()),
                    Some(&provider),
                    Some(&settings.model),
                    settings.openai_organization.clone(),
                    settings.openai_project.clone(),
                );
                llm_client
                    .send_message_stream(
                        llm_messages,
                        &settings.model,
                        settings.max_tokens,
                        Some(settings.temperature),
                        tx,
                    )
                    .await
                    .map_err(|e| CommandError {
                        message: e.to_string(),
                    })?
            }
        };

        let _ = emit_task.await;
        let _ = window.emit(
            "chat-event",
            ChatEvent::Done {
                final_text: response.clone(),
            },
        );

        // Save assistant response
        let assistant_msg_id = uuid::Uuid::new_v4().to_string();
        state.db.add_message(
            &assistant_msg_id,
            &request.conversation_id,
            "assistant",
            &response,
        )?;

        return Ok(response);
    }

    // Enhanced chat with tools - use AgentLoop which supports multiple providers
    use crate::llm_client::ProviderConfig;

    // Build agent-style config for tools
    let mut config = AgentConfig {
        project_path: request.project_path,
        max_turns: 10, // Limit turns in chat mode
        ..Default::default()
    };

    // System prompt for chat with tools - include MCP servers info
    let mcp_servers = state.mcp_manager.get_server_statuses().await;
    let mut mcp_info = String::new();
    if !mcp_servers.is_empty() {
        mcp_info.push_str("\nMCP (Model Context Protocol) Tools:\n");
        for server in mcp_servers {
            if matches!(
                server.status,
                crate::mcp::types::ConnectionStatus::Connected
            ) {
                mcp_info.push_str(&format!(
                    "Server '{}' is connected with tools:\n",
                    server.id
                ));
                for tool in server.tools {
                    mcp_info.push_str(&format!(
                        "  - {}: {} (use format: {}:{})\n",
                        tool.name, tool.description, server.id, tool.name
                    ));
                }
            }
        }
    }

    config.system_prompt = format!(
        r#"You are Thinqi Cowork, an AI assistant that helps users for non dev work.

You have access to tools that allow you to read and write files, execute commands, and search through codebases.

When the user asks you to do something that requires accessing files or running commands, use the appropriate tools.
For simple questions or conversations, respond directly without using tools.

Be concise and helpful. Explain what you're doing when using tools.{}"#,
        mcp_info
    );
    if settings.browser_enabled {
        let browser_session_consent = state.browser_manager.has_session_consent().await;
        let active_sessions = state.browser_manager.list_sessions().await;
        config.system_prompt.push_str(
            "\n\n## Browser Session Rules\n- If authentication, MFA/2FA, CAPTCHA, or security challenge needs the user, pause actions, tell the user exactly what to do, and wait.\n- After the user confirms completion, continue from the same open browser session/state.\n",
        );
        config.system_prompt.push_str(
            "- Continue from the current page and progress; do not restart the workflow from the beginning unless explicitly requested.\n",
        );
        if browser_session_consent {
            config.system_prompt.push_str(
                "- Browser session consent is already granted; do not ask for consent again in this session.\n",
            );
        } else {
            config.system_prompt.push_str(
                "- This request initiates browser work, so treat browser consent as granted for the active session.\n",
            );
        }
        if !active_sessions.is_empty() {
            config
                .system_prompt
                .push_str("- Reuse the existing active browser session.\n");
        }
    }
    apply_tool_permissions(&mut config, &settings);

    let execution_settings = ExecutionSettings::from_settings(&settings);
    let browser_settings = BrowserSettings::from_settings(&settings);
    let browser_consent = request.browser_consent.unwrap_or(false);

    let message_builder = MessageBuilder::new(
        config.clone(),
        settings.model.clone(),
        settings.max_tokens,
        Some(settings.temperature),
    );

    let tool_executor = ToolExecutor::new(config.project_path.clone())
        .with_mcp_manager(state.mcp_manager.clone())
        .with_allowed_tools(config.allowed_tools.clone())
        .with_execution_settings(execution_settings)
        .with_browser_manager(state.browser_manager.clone())
        .with_browser_settings(browser_settings)
        .with_browser_consent(browser_consent)
        .with_db(state.db.clone());

    // Convert DB messages to agent messages
    let mut agent_messages: Vec<AgentMessage> = db_messages
        .iter()
        .map(|m| AgentMessage {
            role: m.role.clone(),
            content: AgentContent::Text(m.content.clone()),
        })
        .collect();

    let client = reqwest::Client::new();
    let mut final_text = String::new();
    let mut turn = 0;
    let max_turns = config.max_turns;

    // Get provider config for determining API format
    let provider_id = settings.get_provider();
    let mut provider_config = ProviderConfig::from_preset(&provider_id);
    if !settings.base_url.is_empty() {
        provider_config.base_url = settings.base_url.clone();
    }

    // Determine API format
    let use_openai_format = matches!(
        provider_config.api_format,
        crate::llm_client::ApiFormat::OpenAI | crate::llm_client::ApiFormat::OpenAICompatible
    );
    let use_openai_responses_format = matches!(
        provider_config.api_format,
        crate::llm_client::ApiFormat::OpenAIResponses
    );
    let use_google_format = matches!(
        provider_config.api_format,
        crate::llm_client::ApiFormat::Google
    );

    // For Google: track thoughtSignature per function call across iterations (required for Gemini 3)
    let mut google_thought_signatures: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    loop {
        turn += 1;
        if turn > max_turns {
            break;
        }

        // Build and send request
        let api_request = message_builder.build_request(&agent_messages).await;

        let response = if use_google_format {
            // Google Gemini format request (pass thought signatures for Gemini 3 function calling)
            let google_request = convert_to_google_format(
                &api_request,
                &settings.model,
                settings.max_tokens,
                &google_thought_signatures,
            );
            let base = provider_config.base_url.trim_end_matches('/');
            let api_version = if settings.model.to_lowercase().starts_with("gemini-3") {
                "v1alpha"
            } else {
                "v1beta"
            };
            let url = format!(
                "{}/{}/models/{}:streamGenerateContent?alt=sse",
                base, api_version, settings.model
            );

            client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("x-goog-api-key", &settings.api_key)
                .json(&google_request)
                .send()
                .await
                .map_err(|e| CommandError {
                    message: format!("HTTP error: {}", e),
                })?
        } else if use_openai_responses_format {
            // OpenAI Responses format request
            let responses_request = convert_to_openai_responses_format(&api_request);
            let base = provider_config.base_url.trim_end_matches('/');
            let url = if base.ends_with("/v1") {
                format!("{}/responses", base)
            } else {
                format!("{}/v1/responses", base)
            };

            let mut req = client.post(&url).header("Content-Type", "application/json");

            if !settings.api_key.is_empty() {
                req = req.header("Authorization", format!("Bearer {}", settings.api_key));
            }
            // Add optional OpenAI headers
            if let Some(ref org) = settings.openai_organization {
                if !org.is_empty() {
                    req = req.header("OpenAI-Organization", org);
                }
            }
            if let Some(ref proj) = settings.openai_project {
                if !proj.is_empty() {
                    req = req.header("OpenAI-Project", proj);
                }
            }

            req.json(&responses_request)
                .send()
                .await
                .map_err(|e| CommandError {
                    message: format!("HTTP error: {}", e),
                })?
        } else if use_openai_format {
            // OpenAI format request
            let openai_request = convert_to_openai_format(&api_request, &settings.model);
            let base = provider_config.base_url.trim_end_matches('/');
            let url = if base.ends_with("/v1") {
                format!("{}/chat/completions", base)
            } else {
                format!("{}/v1/chat/completions", base)
            };

            let mut req = client.post(&url).header("Content-Type", "application/json");

            if !settings.api_key.is_empty() {
                req = req.header("Authorization", format!("Bearer {}", settings.api_key));
            }
            // Add optional OpenAI headers
            if let Some(ref org) = settings.openai_organization {
                if !org.is_empty() {
                    req = req.header("OpenAI-Organization", org);
                }
            }
            if let Some(ref proj) = settings.openai_project {
                if !proj.is_empty() {
                    req = req.header("OpenAI-Project", proj);
                }
            }

            req.json(&openai_request)
                .send()
                .await
                .map_err(|e| CommandError {
                    message: format!("HTTP error: {}", e),
                })?
        } else {
            // Anthropic format request
            client
                .post(format!(
                    "{}/v1/messages",
                    provider_config.base_url.trim_end_matches('/')
                ))
                .header("Content-Type", "application/json")
                .header("x-api-key", &settings.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&api_request)
                .send()
                .await
                .map_err(|e| CommandError {
                    message: format!("HTTP error: {}", e),
                })?
        };

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(CommandError {
                message: format!("API error: {}", error_text),
            });
        }

        // Handle streaming response based on provider format
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut accumulated_text = String::new();
        let mut tool_uses: Vec<ToolUse> = Vec::new();

        if use_google_format {
            // Google Gemini streaming format (SSE with alt=sse)
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| CommandError {
                    message: format!("Stream error: {}", e),
                })?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].trim().to_string();
                    buffer = buffer[pos + 1..].to_string();

                    if line.is_empty() {
                        continue;
                    }

                    // Parse SSE data: prefix
                    let json_str = if let Some(data) = line.strip_prefix("data: ") {
                        data
                    } else {
                        continue;
                    };

                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(json_str) {
                        // Extract text and function calls from candidates
                        if let Some(candidates) = event.get("candidates").and_then(|v| v.as_array())
                        {
                            for candidate in candidates {
                                if let Some(parts) = candidate
                                    .get("content")
                                    .and_then(|c| c.get("parts"))
                                    .and_then(|p| p.as_array())
                                {
                                    for part in parts {
                                        // Handle text
                                        if let Some(text) =
                                            part.get("text").and_then(|v| v.as_str())
                                        {
                                            if !text.is_empty() {
                                                accumulated_text.push_str(text);
                                                let _ = window.emit(
                                                    "chat-event",
                                                    ChatEvent::Text {
                                                        content: accumulated_text.clone(),
                                                    },
                                                );
                                            }
                                        }
                                        // Handle function calls (with thoughtSignature for Gemini 3)
                                        if let Some(fc) = part.get("functionCall") {
                                            let name = fc
                                                .get("name")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("")
                                                .to_string();
                                            let args = fc
                                                .get("args")
                                                .cloned()
                                                .unwrap_or(serde_json::json!({}));
                                            let id = format!("fc_{}", uuid::Uuid::new_v4());

                                            // Capture thoughtSignature from the same part (required for Gemini 3)
                                            let thought_signature = part
                                                .get("thoughtSignature")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string());

                                            // Also store in map for lookup when building functionResponse
                                            if let Some(ref sig) = thought_signature {
                                                google_thought_signatures
                                                    .insert(id.clone(), sig.clone());
                                            }

                                            tool_uses.push(ToolUse {
                                                id: id.clone(),
                                                name: name.clone(),
                                                input: args.clone(),
                                                thought_signature,
                                            });

                                            let _ = window.emit(
                                                "chat-event",
                                                ChatEvent::ToolStart {
                                                    tool: name,
                                                    input: args,
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else if use_openai_responses_format {
            // OpenAI Responses streaming format
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| CommandError {
                    message: format!("Stream error: {}", e),
                })?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].to_string();
                    buffer = buffer[pos + 1..].to_string();

                    if let Some(data) = line.strip_prefix("data: ") {
                        if data.trim() == "[DONE]" {
                            continue;
                        }

                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                            if event.get("type").and_then(|v| v.as_str())
                                == Some("response.output_text.delta")
                            {
                                if let Some(delta) = event.get("delta").and_then(|v| v.as_str()) {
                                    accumulated_text.push_str(delta);
                                    let _ = window.emit(
                                        "chat-event",
                                        ChatEvent::Text {
                                            content: accumulated_text.clone(),
                                        },
                                    );
                                }
                            }

                            if event.get("type").and_then(|v| v.as_str())
                                == Some("response.completed")
                            {
                                if let Some(final_text) =
                                    parse_openai_responses_text(&event["response"])
                                {
                                    if !final_text.is_empty() {
                                        accumulated_text = final_text;
                                    }
                                }

                                for tool_use in extract_openai_responses_tool_uses(&event["response"])
                                {
                                    let _ = window.emit(
                                        "chat-event",
                                        ChatEvent::ToolStart {
                                            tool: tool_use.name.clone(),
                                            input: tool_use.input.clone(),
                                        },
                                    );
                                    tool_uses.push(tool_use);
                                }
                            }
                        }
                    }
                }
            }
        } else if use_openai_format {
            // OpenAI streaming format
            let mut current_tool_calls: std::collections::HashMap<i64, (String, String, String)> =
                std::collections::HashMap::new();

            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| CommandError {
                    message: format!("Stream error: {}", e),
                })?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].to_string();
                    buffer = buffer[pos + 1..].to_string();

                    if let Some(data) = line.strip_prefix("data: ") {
                        if data.trim() == "[DONE]" {
                            continue;
                        }

                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(choices) = event.get("choices").and_then(|v| v.as_array()) {
                                for choice in choices {
                                    if let Some(delta) = choice.get("delta") {
                                        // Handle text content
                                        if let Some(content) =
                                            delta.get("content").and_then(|v| v.as_str())
                                        {
                                            accumulated_text.push_str(content);
                                            let _ = window.emit(
                                                "chat-event",
                                                ChatEvent::Text {
                                                    content: accumulated_text.clone(),
                                                },
                                            );
                                        }

                                        // Handle tool_calls
                                        if let Some(tcs) =
                                            delta.get("tool_calls").and_then(|v| v.as_array())
                                        {
                                            for tc in tcs {
                                                let index = tc
                                                    .get("index")
                                                    .and_then(|v| v.as_i64())
                                                    .unwrap_or(0);

                                                let entry = current_tool_calls
                                                    .entry(index)
                                                    .or_insert_with(|| {
                                                        (
                                                            String::new(),
                                                            String::new(),
                                                            String::new(),
                                                        )
                                                    });

                                                if let Some(id) =
                                                    tc.get("id").and_then(|v| v.as_str())
                                                {
                                                    entry.0 = id.to_string();
                                                }
                                                if let Some(func) = tc.get("function") {
                                                    if let Some(name) =
                                                        func.get("name").and_then(|v| v.as_str())
                                                    {
                                                        entry.1 = name.to_string();
                                                    }
                                                    if let Some(args) = func
                                                        .get("arguments")
                                                        .and_then(|v| v.as_str())
                                                    {
                                                        entry.2.push_str(args);
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    // Check if finished
                                    if choice
                                        .get("finish_reason")
                                        .and_then(|v| v.as_str())
                                        .is_some()
                                    {
                                        // Convert collected tool_calls to ToolUse
                                        for (id, name, args) in current_tool_calls.values() {
                                            if !id.is_empty() && !name.is_empty() {
                                                let input: serde_json::Value =
                                                    serde_json::from_str(args)
                                                        .unwrap_or(serde_json::json!({}));

                                                tool_uses.push(ToolUse {
                                                    id: id.clone(),
                                                    name: name.clone(),
                                                    input: input.clone(),
                                                    thought_signature: None, // OpenAI doesn't use thought signatures
                                                });

                                                // Emit tool start
                                                let _ = window.emit(
                                                    "chat-event",
                                                    ChatEvent::ToolStart {
                                                        tool: name.clone(),
                                                        input,
                                                    },
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Anthropic streaming format
            let mut current_tool_input = String::new();
            let mut current_tool_id = String::new();
            let mut current_tool_name = String::new();

            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| CommandError {
                    message: format!("Stream error: {}", e),
                })?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].to_string();
                    buffer = buffer[pos + 1..].to_string();

                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            continue;
                        }

                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                            let event_type =
                                event.get("type").and_then(|v| v.as_str()).unwrap_or("");

                            match event_type {
                                "content_block_start" => {
                                    if let Some(block) = event.get("content_block") {
                                        if block.get("type").and_then(|v| v.as_str())
                                            == Some("tool_use")
                                        {
                                            current_tool_id = block
                                                .get("id")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("")
                                                .to_string();
                                            current_tool_name = block
                                                .get("name")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("")
                                                .to_string();
                                            current_tool_input.clear();
                                        }
                                    }
                                }
                                "content_block_delta" => {
                                    if let Some(delta) = event.get("delta") {
                                        let delta_type = delta
                                            .get("type")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");

                                        if delta_type == "text_delta" {
                                            if let Some(text) =
                                                delta.get("text").and_then(|v| v.as_str())
                                            {
                                                accumulated_text.push_str(text);
                                                let _ = window.emit(
                                                    "chat-event",
                                                    ChatEvent::Text {
                                                        content: accumulated_text.clone(),
                                                    },
                                                );
                                            }
                                        } else if delta_type == "input_json_delta" {
                                            if let Some(partial) =
                                                delta.get("partial_json").and_then(|v| v.as_str())
                                            {
                                                current_tool_input.push_str(partial);
                                            }
                                        }
                                    }
                                }
                                "content_block_stop" => {
                                    if !current_tool_id.is_empty() {
                                        let input: serde_json::Value =
                                            serde_json::from_str(&current_tool_input)
                                                .unwrap_or(serde_json::json!({}));

                                        tool_uses.push(ToolUse {
                                            id: current_tool_id.clone(),
                                            name: current_tool_name.clone(),
                                            input: input.clone(),
                                            thought_signature: None, // Anthropic doesn't use thought signatures
                                        });

                                        // Emit tool start
                                        let _ = window.emit(
                                            "chat-event",
                                            ChatEvent::ToolStart {
                                                tool: current_tool_name.clone(),
                                                input,
                                            },
                                        );

                                        current_tool_id.clear();
                                        current_tool_name.clear();
                                        current_tool_input.clear();
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        // Update final text
        if !accumulated_text.is_empty() {
            final_text = accumulated_text.clone();
        }

        // Add assistant message to history
        let assistant_content = if tool_uses.is_empty() {
            AgentContent::Text(accumulated_text)
        } else {
            let mut blocks = Vec::new();
            if !accumulated_text.is_empty() {
                blocks.push(ContentBlock::Text {
                    text: accumulated_text,
                });
            }
            for tu in &tool_uses {
                blocks.push(ContentBlock::ToolUse {
                    id: tu.id.clone(),
                    name: tu.name.clone(),
                    input: tu.input.clone(),
                    thought_signature: tu.thought_signature.clone(),
                });
            }
            AgentContent::Blocks(blocks)
        };

        agent_messages.push(AgentMessage {
            role: "assistant".to_string(),
            content: assistant_content,
        });

        // If no tool uses, we're done
        if tool_uses.is_empty() {
            break;
        }

        // Execute tools
        let mut tool_results = Vec::new();

        for tool_use in &tool_uses {
            let result = tool_executor.execute(tool_use).await;

            // Emit tool end
            let _ = window.emit(
                "chat-event",
                ChatEvent::ToolEnd {
                    tool: tool_use.name.clone(),
                    result: result.content.clone(),
                    success: result.is_error.is_none(),
                },
            );

            tool_results.push(result);
        }

        // Add tool results as user message
        agent_messages.push(AgentMessage {
            role: "user".to_string(),
            content: AgentContent::ToolResults(tool_results),
        });
    }

    // Emit done
    let _ = window.emit(
        "chat-event",
        ChatEvent::Done {
            final_text: final_text.clone(),
        },
    );

    // Save final assistant response to database
    let assistant_msg_id = uuid::Uuid::new_v4().to_string();
    state.db.add_message(
        &assistant_msg_id,
        &request.conversation_id,
        "assistant",
        &final_text,
    )?;

    // Update conversation title if this is the first exchange
    if db_messages.len() == 1 {
        let title = if request.content.len() > 30 {
            format!("{}...", &request.content[..30])
        } else {
            request.content.clone()
        };
        state
            .db
            .update_conversation_title(&request.conversation_id, &title)?;
    }

    Ok(final_text)
}

// Task commands
#[command]
pub fn list_tasks(state: State<'_, Arc<AppState>>) -> Result<Vec<Task>, CommandError> {
    state.db.list_tasks().map_err(Into::into)
}

#[command]
pub fn get_task(state: State<'_, Arc<AppState>>, id: String) -> Result<Option<Task>, CommandError> {
    state.db.get_task(&id).map_err(Into::into)
}

#[command]
pub fn create_task(
    state: State<'_, Arc<AppState>>,
    title: String,
    description: String,
    project_path: Option<String>,
) -> Result<Task, CommandError> {
    let id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .create_task(&id, &title, &description, project_path.as_deref())
        .map_err(Into::into)
}

#[command]
pub fn delete_task(state: State<'_, Arc<AppState>>, id: String) -> Result<(), CommandError> {
    state.db.delete_task(&id).map_err(Into::into)
}

// Run agent with task tracking
#[derive(Debug, Deserialize)]
pub struct TaskAgentRequest {
    pub task_id: String,
    pub message: String,
    pub project_path: Option<String>,
    pub max_turns: Option<u32>,
    pub structured_output: Option<bool>,
    pub browser_consent: Option<bool>,
}

#[command]
pub async fn run_task_agent(
    window: Window,
    state: State<'_, Arc<AppState>>,
    request: TaskAgentRequest,
) -> Result<String, CommandError> {
    let settings = state.db.get_settings()?;

    // Check if API Key is needed (local services don't need it)
    if settings.api_key.is_empty() && !settings.allows_empty_api_key() {
        return Err(CommandError {
            message: "API key not configured".to_string(),
        });
    }

    // Load existing conversation history
    let existing_messages = state.db.get_task_messages(&request.task_id)?;

    // Save new user message
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .add_task_message(&user_msg_id, &request.task_id, "user", &request.message)?;

    // Update task status to running
    state
        .db
        .update_task_status(&request.task_id, TASK_STATUS_RUNNING)?;

    // Build agent config with MCP servers info
    let mut config = AgentConfig::default();
    let routing = match request.structured_output {
        Some(value) => RouterOutcome {
            planning: value,
            decision: None,
        },
        None => determine_planning(&settings, &request.message).await,
    };
    let planning = routing.planning;
    config.system_prompt = build_system_prompt(planning);

    // Add MCP servers info to system prompt
    let mcp_servers = state.mcp_manager.get_server_statuses().await;
    let mut mcp_info = String::new();
    if !mcp_servers.is_empty() {
        mcp_info.push_str("\nMCP (Model Context Protocol) Tools:\n");
        for server in mcp_servers {
            if matches!(
                server.status,
                crate::mcp::types::ConnectionStatus::Connected
            ) {
                mcp_info.push_str(&format!(
                    "Server '{}' is connected with tools:\n",
                    server.id
                ));
                for tool in server.tools {
                    mcp_info.push_str(&format!(
                        "  - {}: {} (use format: {}:{})\n",
                        tool.name, tool.description, server.id, tool.name
                    ));
                }
            }
        }
    }
    if !mcp_info.is_empty() {
        config.system_prompt.push_str(&mcp_info);
    }

    // Add active browser session context for continuity
    let browser_session_consent = state.browser_manager.has_session_consent().await;
    let active_sessions = if settings.browser_enabled {
        state.browser_manager.list_sessions().await
    } else {
        Vec::new()
    };
    if !active_sessions.is_empty() {
        let mut browser_context = String::from("\n\n## Active Browser Sessions\n");
        browser_context.push_str("The browser-use browser is already running. The browser will persist between `browser_task` calls, so you can build on previous interactions.\n\n");
        for session in &active_sessions {
            browser_context.push_str(&format!(
                "- **Session ID**: `{}`\n  - URL: {}\n  - Title: {}\n",
                session.session_id,
                if session.url.is_empty() {
                    "(unknown)"
                } else {
                    &session.url
                },
                if session.title.is_empty() {
                    "(untitled)"
                } else {
                    &session.title
                }
            ));
        }
        browser_context.push_str("\n### Browser Session Rules\n");
        if browser_session_consent {
            browser_context.push_str(
                "- Browser session consent is already granted for this active session. Do not ask for consent again.\n",
            );
        } else {
            browser_context.push_str(
                "- This user request has initiated browser work; treat it as session consent for the active browser session.\n",
            );
        }
        browser_context.push_str(
            "- If authentication, MFA/2FA, CAPTCHA, or security challenge requires user action, pause autonomous actions, clearly tell the user what to do, and wait.\n",
        );
        browser_context.push_str(
            "- After the user says auth is complete, continue from the existing browser state/session instead of restarting.\n",
        );
        browser_context.push_str(
            "- Continue from the current page and already-completed progress; do not restart the flow from step 1 unless the user explicitly asks.\n",
        );
        browser_context.push_str("\nUse `browser_task`, `browser_extract`, or other browser tools to continue working with the open browser.\n");
        config.system_prompt.push_str(&browser_context);
    }

    if let Some(turns) = request.max_turns {
        config.max_turns = turns;
    }
    config.project_path = request.project_path;
    apply_tool_permissions(&mut config, &settings);
    apply_structured_output_tools(&mut config, planning);

    // Get provider info
    let (provider_id, active_model) = select_routed_model(&settings, routing.decision.as_ref());
    let execution_settings = ExecutionSettings::from_settings(&settings);
    let browser_settings = BrowserSettings::from_settings(&settings);
    let browser_consent = request.browser_consent.unwrap_or(false);

    // Create agent loop with provider
    let agent = AgentLoop::new_with_provider(
        settings.api_key,
        settings.base_url,
        config,
        active_model,
        settings.max_tokens,
        Some(settings.temperature),
        state.mcp_manager.clone(),
        Some(&provider_id),
        Some(execution_settings),
        Some(state.db.clone()),
        Some(state.browser_manager.clone()),
        Some(browser_settings),
        Some(browser_consent),
    );

    // Build conversation history from existing messages
    let mut agent_messages: Vec<AgentMessage> = existing_messages
        .iter()
        .map(|m| AgentMessage {
            role: m.role.clone(),
            content: AgentContent::Text(m.content.clone()),
        })
        .collect();

    // Add the new user message
    agent_messages.push(AgentMessage {
        role: "user".to_string(),
        content: AgentContent::Text(request.message.clone()),
    });

    // Create channel for events
    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(100);

    // Clone state for event handler
    let task_id = request.task_id.clone();
    let task_id_for_msg = request.task_id.clone();
    let db = state.db.clone();
    let db_for_msg = state.db.clone();
    let human_required = Arc::new(AtomicBool::new(false));
    let human_required_for_events = human_required.clone();
    let used_browser_tools = Arc::new(AtomicBool::new(false));
    let used_browser_tools_for_events = used_browser_tools.clone();

    // Track accumulated text for saving
    let accumulated_text = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let accumulated_text_clone = accumulated_text.clone();

    // Spawn event emitter with task tracking
    let window_clone = window.clone();
    let emit_task = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            // Track plan and step updates in database
            match &event {
                AgentEvent::Text { content } => {
                    // Update accumulated text
                    if let Ok(mut text) = accumulated_text_clone.lock() {
                        *text = content.clone();
                    }
                }
                AgentEvent::Plan { steps } => {
                    let plan_steps: Vec<PlanStep> = steps
                        .iter()
                        .map(|s| PlanStep {
                            step: s.step,
                            description: s.description.clone(),
                            status: TASK_STATUS_PENDING.to_string(),
                        })
                        .collect();
                    let _ = db.update_task_plan(&task_id, &plan_steps);
                }
                AgentEvent::StepStart { step } => {
                    let _ = db.update_task_step(&task_id, *step, TASK_STATUS_RUNNING);
                }
                AgentEvent::StepDone { step } => {
                    let _ = db.update_task_step(&task_id, *step, TASK_STATUS_COMPLETED);
                }
                AgentEvent::ToolStart { tool, .. } => {
                    if tool.starts_with("browser_") {
                        used_browser_tools_for_events.store(true, Ordering::SeqCst);
                    }
                }
                AgentEvent::ToolEnd {
                    tool,
                    result,
                    success,
                } => {
                    if tool.starts_with("browser_") {
                        used_browser_tools_for_events.store(true, Ordering::SeqCst);
                    }
                    if *success && tool_result_needs_human_handoff(tool, result) {
                        human_required_for_events.store(true, Ordering::SeqCst);
                        let _ = db.update_task_status(&task_id, TASK_STATUS_HUMAN_REQUIRED);
                    }
                }
                AgentEvent::Done { .. } => {
                    if !human_required_for_events.load(Ordering::SeqCst) {
                        let _ = db.update_task_status(&task_id, TASK_STATUS_COMPLETED);
                    }
                }
                AgentEvent::Error { .. } => {
                    // Final task status is decided after `run_with_history` returns.
                }
                _ => {}
            }

            // Emit to frontend
            let _ = window_clone.emit("agent-event", &event);
        }
    });

    // Run agent with conversation history
    let result = agent.run_with_history(agent_messages, tx).await;

    // Wait for emitter to finish
    let _ = emit_task.await;

    // Save assistant message with accumulated text
    let final_text = accumulated_text
        .lock()
        .map(|t| t.clone())
        .unwrap_or_default();
    if !final_text.is_empty() {
        let assistant_msg_id = uuid::Uuid::new_v4().to_string();
        let _ = db_for_msg.add_task_message(
            &assistant_msg_id,
            &task_id_for_msg,
            "assistant",
            &final_text,
        );
    }

    let browser_waiting_for_user = used_browser_tools.load(Ordering::SeqCst)
        && matches!(
            state.browser_manager.get_status().await.status.as_str(),
            "waiting_for_user"
        );
    let needs_human_required = human_required.load(Ordering::SeqCst) || browser_waiting_for_user;

    // Always ensure task status is updated at the end
    match result {
        Ok(_messages) => {
            if needs_human_required {
                let _ = state
                    .db
                    .update_task_status(&request.task_id, TASK_STATUS_HUMAN_REQUIRED);
                Ok("Task paused for human input".to_string())
            } else {
                // Explicitly update to completed (in case event was missed)
                let _ = state
                    .db
                    .update_task_status(&request.task_id, TASK_STATUS_COMPLETED);
                Ok("Task completed successfully".to_string())
            }
        }
        Err(e) => {
            state
                .db
                .update_task_status(&request.task_id, TASK_STATUS_FAILED)?;
            Err(CommandError { message: e })
        }
    }
}

// Get task messages command
#[command]
pub fn get_task_messages(
    state: State<'_, Arc<AppState>>,
    task_id: String,
) -> Result<Vec<TaskMessage>, CommandError> {
    state.db.get_task_messages(&task_id).map_err(Into::into)
}

// Skills commands
#[command]
pub fn get_skills_list() -> Vec<SkillMetadata> {
    get_available_skills()
}

#[command]
// MCP commands
pub fn list_mcp_servers(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<MCPServerConfig>, CommandError> {
    state.db.get_mcp_servers().map_err(|e| CommandError {
        message: format!("Failed to get MCP servers: {}", e),
    })
}

#[command]
pub fn save_mcp_server(
    state: State<'_, Arc<AppState>>,
    config: MCPServerConfig,
) -> Result<(), CommandError> {
    state.db.save_mcp_server(&config).map_err(|e| CommandError {
        message: format!("Failed to save MCP server: {}", e),
    })
}

#[command]
pub fn delete_mcp_server(state: State<'_, Arc<AppState>>, id: String) -> Result<(), CommandError> {
    state.db.delete_mcp_server(&id).map_err(|e| CommandError {
        message: format!("Failed to delete MCP server: {}", e),
    })
}

#[command]
pub async fn connect_mcp_server(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), CommandError> {
    // Get server config from database
    let config = match state.db.get_mcp_server(&id).map_err(|e| CommandError {
        message: format!("Failed to get server config: {}", e),
    })? {
        Some(config) => config,
        None => {
            return Err(CommandError {
                message: "MCP server not found".to_string(),
            })
        }
    };

    // Connect using MCP manager
    state
        .mcp_manager
        .connect_server(&config)
        .await
        .map_err(|e| CommandError {
            message: format!("Failed to connect to MCP server: {}", e),
        })?;

    // Update enabled status in database
    state
        .db
        .update_mcp_server_enabled(&id, true)
        .map_err(|e| CommandError {
            message: format!("Failed to update server status: {}", e),
        })
}

#[command]
pub async fn disconnect_mcp_server(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), CommandError> {
    // Disconnect using MCP manager
    state.mcp_manager.disconnect_server(&id).await;

    // Update enabled status in database
    state
        .db
        .update_mcp_server_enabled(&id, false)
        .map_err(|e| CommandError {
            message: format!("Failed to update server status: {}", e),
        })
}

#[command]
pub async fn get_mcp_server_statuses(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<MCPServerStatus>, CommandError> {
    Ok(state.mcp_manager.get_server_statuses().await)
}

#[command]
pub async fn execute_mcp_tool(
    state: State<'_, Arc<AppState>>,
    call: MCPToolCall,
) -> Result<MCPToolResult, CommandError> {
    Ok(state.mcp_manager.execute_tool(&call).await)
}

#[command]
pub fn list_bundle_mcp_suggestions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<BundleMcpSuggestion>, CommandError> {
    let existing = state.db.get_mcp_servers()?;
    let existing_urls: std::collections::HashSet<String> =
        existing.iter().map(|s| s.server_url.clone()).collect();
    let existing_ids: std::collections::HashSet<String> =
        existing.iter().map(|s| s.id.clone()).collect();

    let mut suggestions = Vec::new();

    for bundle in bundles::discover_bundles() {
        let entries: Vec<BundleMcpEntry> = bundles::read_bundle_mcp_entries(&bundle.root);
        for entry in entries {
            let suggested_id = format!("{}:{}", bundle.metadata.id, sanitize_id(&entry.key));
            let suggested_name = format!("{} ({})", entry.key, bundle.metadata.name);
            let already_configured =
                existing_urls.contains(&entry.url) || existing_ids.contains(&suggested_id);

            suggestions.push(BundleMcpSuggestion {
                bundle_id: bundle.metadata.id.clone(),
                bundle_name: bundle.metadata.name.clone(),
                server_key: entry.key.clone(),
                server_url: entry.url.clone(),
                suggested_id,
                suggested_name,
                already_configured,
            });
        }
    }

    suggestions.sort_by(|a, b| {
        a.bundle_name
            .cmp(&b.bundle_name)
            .then(a.server_key.cmp(&b.server_key))
    });

    Ok(suggestions)
}

#[command]
pub fn import_bundle_mcp_servers(
    state: State<'_, Arc<AppState>>,
    bundle_id: String,
) -> Result<Vec<MCPServerConfig>, CommandError> {
    let bundles = bundles::discover_bundles();
    let bundle = bundles
        .into_iter()
        .find(|b| b.metadata.id == bundle_id)
        .ok_or_else(|| CommandError {
            message: "Bundle not found".to_string(),
        })?;

    let entries = bundles::read_bundle_mcp_entries(&bundle.root);
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let existing = state.db.get_mcp_servers()?;
    let existing_urls: std::collections::HashSet<String> =
        existing.iter().map(|s| s.server_url.clone()).collect();
    let existing_ids: std::collections::HashSet<String> =
        existing.iter().map(|s| s.id.clone()).collect();

    let now = chrono::Utc::now().to_rfc3339();
    let mut added = Vec::new();

    for entry in entries {
        let suggested_id = format!("{}:{}", bundle.metadata.id, sanitize_id(&entry.key));
        if existing_urls.contains(&entry.url) || existing_ids.contains(&suggested_id) {
            continue;
        }

        let config = MCPServerConfig {
            id: suggested_id,
            name: format!("{} ({})", entry.key, bundle.metadata.name),
            server_url: entry.url,
            oauth_client_id: None,
            oauth_client_secret: None,
            enabled: false,
            created_at: now.clone(),
            updated_at: now.clone(),
        };

        state.db.save_mcp_server(&config)?;
        added.push(config);
    }

    Ok(added)
}

#[command]
pub async fn prepull_docker_images(
    state: State<'_, Arc<AppState>>,
) -> Result<String, CommandError> {
    let settings = state.db.get_settings()?;
    let backend = settings.execution_backend.trim().to_lowercase();
    if backend != "docker" {
        return Err(CommandError {
            message: "Docker backend is not selected in settings".to_string(),
        });
    }

    let images: Vec<String> = DEFAULT_PREPULL_IMAGES
        .iter()
        .map(|s| s.to_string())
        .collect();
    prepull_images(&images)
        .await
        .map_err(|e| CommandError { message: e })
}

#[command]
pub fn list_execution_audit(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<ExecutionLog>, CommandError> {
    let take = limit.unwrap_or(100) as usize;
    state.db.list_execution_logs(take).map_err(Into::into)
}

#[command]
pub async fn get_browser_status(
    state: State<'_, Arc<AppState>>,
) -> Result<BrowserStatus, CommandError> {
    Ok(state.browser_manager.get_status().await)
}

#[command]
pub async fn browser_pause_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), CommandError> {
    state.browser_manager.pause_session(&session_id).await;
    state.db.pause_running_tasks()?;
    Ok(())
}

#[command]
pub async fn browser_resume_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), CommandError> {
    state.browser_manager.resume_session(&session_id).await;
    Ok(())
}

#[command]
pub async fn browser_close_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), CommandError> {
    let result = state
        .browser_manager
        .call("close", serde_json::json!({ "session_id": session_id }))
        .await
        .map_err(|e| CommandError { message: e })?;
    let _ = result;
    state.browser_manager.clear_status().await;
    Ok(())
}

/// Convert Claude API request format to OpenAI format
fn convert_to_openai_format(
    request: &crate::agent::message_builder::ClaudeApiRequest,
    model: &str,
) -> serde_json::Value {
    use crate::agent::message_builder::ApiContent;

    // Build messages, including system prompt
    let mut messages: Vec<serde_json::Value> = Vec::new();

    // Add system message
    if !request.system.is_empty() {
        messages.push(serde_json::json!({
            "role": "system",
            "content": request.system
        }));
    }

    // Convert conversation messages
    for msg in &request.messages {
        let role = &msg.role;

        match &msg.content {
            ApiContent::Text(text) => {
                messages.push(serde_json::json!({
                    "role": role,
                    "content": text
                }));
            }
            ApiContent::Blocks(blocks) => {
                // Handle content blocks (text, tool_use, tool_result)
                let mut text_parts: Vec<String> = Vec::new();
                let mut tool_calls: Vec<serde_json::Value> = Vec::new();

                for block in blocks {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    match block_type {
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                text_parts.push(text.to_string());
                            }
                        }
                        "tool_use" => {
                            tool_calls.push(serde_json::json!({
                                "id": block.get("id"),
                                "type": "function",
                                "function": {
                                    "name": block.get("name"),
                                    "arguments": serde_json::to_string(block.get("input").unwrap_or(&serde_json::json!({}))).unwrap_or_default()
                                }
                            }));
                        }
                        "tool_result" => {
                            // OpenAI uses tool role to represent tool results
                            messages.push(serde_json::json!({
                                "role": "tool",
                                "tool_call_id": block.get("tool_use_id"),
                                "content": block.get("content")
                            }));
                        }
                        _ => {}
                    }
                }

                // If there's text content
                if !text_parts.is_empty() {
                    let mut msg_obj = serde_json::json!({
                        "role": role,
                        "content": text_parts.join("\n")
                    });

                    // If there are tool_calls
                    if !tool_calls.is_empty() {
                        msg_obj["tool_calls"] = serde_json::json!(tool_calls);
                    }

                    messages.push(msg_obj);
                } else if !tool_calls.is_empty() {
                    // Only tool_calls, no text
                    messages.push(serde_json::json!({
                        "role": role,
                        "content": serde_json::Value::Null,
                        "tool_calls": tool_calls
                    }));
                }
            }
        }
    }

    // Convert tools definition
    let tools: Vec<serde_json::Value> = request
        .tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema
                }
            })
        })
        .collect();

    let mut openai_request = serde_json::json!({
        "model": request.model,
        "stream": request.stream,
        "messages": messages
    });

    // Use provider/model-appropriate max token parameter.
    let model_lower = model.to_lowercase();
    let is_openai_official = (model_lower.starts_with("gpt")
        || model_lower.starts_with("o1")
        || model_lower.starts_with("o3")
        || model_lower.starts_with("o4")
        || model_lower.starts_with("computer-use"))
        && !model_lower.contains('/');
    let is_legacy = model_lower.contains("gpt-3.5")
        || (model_lower.contains("gpt-4")
            && !model_lower.contains("gpt-4o")
            && !model_lower.contains("gpt-4-turbo"));

    if is_openai_official {
        if is_legacy {
            openai_request["max_tokens"] = serde_json::json!(request.max_tokens);
        } else {
            openai_request["max_completion_tokens"] = serde_json::json!(request.max_tokens);
        }
    } else if model_lower.contains("minimax") || model_lower.starts_with("m2") {
        openai_request["max_completion_tokens"] = serde_json::json!(request.max_tokens);
    } else {
        openai_request["max_tokens"] = serde_json::json!(request.max_tokens);
    }

    // OpenAI official reasoning families reject arbitrary temperature values.
    let is_reasoning = model_lower.starts_with("o1")
        || model_lower.starts_with("o3")
        || model_lower.starts_with("o4")
        || model_lower.starts_with("gpt-5")
        || model_lower.contains("gpt-5")
        || model_lower.starts_with("computer-use")
        || model_lower.contains("-o1")
        || model_lower.contains("-o3")
        || model_lower.contains("-o4")
        || model_lower.contains("o1-")
        || model_lower.contains("o3-")
        || model_lower.contains("o4-");

    if let Some(temp) = request.temperature {
        if !is_openai_official || !is_reasoning {
            openai_request["temperature"] = serde_json::json!(temp);
        }
    }

    if !tools.is_empty() {
        openai_request["tools"] = serde_json::json!(tools);
        openai_request["tool_choice"] = serde_json::json!("auto");
    }

    openai_request
}

/// Convert Claude API request format to OpenAI Responses format.
fn convert_to_openai_responses_format(
    request: &crate::agent::message_builder::ClaudeApiRequest,
) -> serde_json::Value {
    use crate::agent::message_builder::ApiContent;

    let mut input: Vec<serde_json::Value> = Vec::new();
    for msg in &request.messages {
        match &msg.content {
            ApiContent::Text(text) => {
                input.push(serde_json::json!({
                    "role": msg.role,
                    "content": text
                }));
            }
            ApiContent::Blocks(blocks) => {
                let text_parts: Vec<String> = blocks
                    .iter()
                    .filter(|block| block.get("type").and_then(|v| v.as_str()) == Some("text"))
                    .filter_map(|block| block.get("text").and_then(|v| v.as_str()))
                    .map(|text| text.to_string())
                    .collect();

                if !text_parts.is_empty() {
                    input.push(serde_json::json!({
                        "role": msg.role,
                        "content": text_parts.join("\n")
                    }));
                }
            }
        }
    }

    let tools: Vec<serde_json::Value> = request
        .tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.input_schema
            })
        })
        .collect();

    let mut responses_request = serde_json::json!({
        "model": request.model,
        "stream": request.stream,
        "input": input,
        "max_output_tokens": request.max_tokens
    });

    if !request.system.is_empty() {
        responses_request["instructions"] = serde_json::json!(request.system);
    }

    let model_lower = request.model.to_lowercase();
    let is_reasoning = model_lower.starts_with("o1")
        || model_lower.starts_with("o3")
        || model_lower.starts_with("o4")
        || model_lower.starts_with("gpt-5")
        || model_lower.contains("gpt-5")
        || model_lower.starts_with("computer-use")
        || model_lower.contains("-o1")
        || model_lower.contains("-o3")
        || model_lower.contains("-o4")
        || model_lower.contains("o1-")
        || model_lower.contains("o3-")
        || model_lower.contains("o4-");
    if let Some(temp) = request.temperature {
        if !is_reasoning {
            responses_request["temperature"] = serde_json::json!(temp);
        }
    }

    if !tools.is_empty() {
        responses_request["tools"] = serde_json::json!(tools);
    }

    responses_request
}

fn parse_openai_responses_text(response: &serde_json::Value) -> Option<String> {
    response["output"]
        .as_array()?
        .iter()
        .find(|item| item["type"].as_str() == Some("message"))
        .and_then(|message| message["content"].as_array())
        .and_then(|content| {
            content
                .iter()
                .find(|item| item["type"].as_str() == Some("output_text"))
        })
        .and_then(|item| item["text"].as_str())
        .map(|text| text.to_string())
}

fn extract_openai_responses_tool_uses(response: &serde_json::Value) -> Vec<crate::agent::ToolUse> {
    let mut tool_uses = Vec::new();
    let output = match response["output"].as_array() {
        Some(output) => output,
        None => return tool_uses,
    };

    for item in output {
        if item["type"].as_str() != Some("function_call") {
            continue;
        }

        let id = item["call_id"].as_str().unwrap_or("").to_string();
        let name = item["name"].as_str().unwrap_or("").to_string();
        let raw_args = item["arguments"].as_str().unwrap_or("{}");
        let input = serde_json::from_str::<serde_json::Value>(raw_args)
            .unwrap_or_else(|_| serde_json::json!({}));

        if id.is_empty() || name.is_empty() {
            continue;
        }

        tool_uses.push(crate::agent::ToolUse {
            id,
            name,
            input,
            thought_signature: None,
        });
    }

    tool_uses
}

fn sanitize_id(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' || ch == ' ' {
            if !out.ends_with('-') {
                out.push('-');
            }
        }
    }

    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "server".to_string()
    } else {
        trimmed
    }
}

/// Convert Claude API request format to Google Gemini format
fn convert_to_google_format(
    request: &crate::agent::message_builder::ClaudeApiRequest,
    _model: &str,
    max_tokens: u32,
    thought_signatures: &std::collections::HashMap<String, String>,
) -> serde_json::Value {
    use crate::agent::message_builder::ApiContent;

    // Build contents array
    let mut contents: Vec<serde_json::Value> = Vec::new();

    // Convert messages to Google format
    for msg in &request.messages {
        // Google uses "user" and "model" instead of "user" and "assistant"
        let role = if msg.role == "assistant" {
            "model"
        } else {
            &msg.role
        };

        let parts = match &msg.content {
            ApiContent::Text(text) => {
                vec![serde_json::json!({"text": text})]
            }
            ApiContent::Blocks(blocks) => {
                let mut parts_list = Vec::new();
                for block in blocks {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    match block_type {
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                parts_list.push(serde_json::json!({"text": text}));
                            }
                        }
                        "tool_use" => {
                            // Convert to functionCall format with thoughtSignature if present (for Gemini 3)
                            let tool_id = block.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            let mut fc_part = serde_json::json!({
                                "functionCall": {
                                    "name": block.get("name"),
                                    "args": block.get("input")
                                }
                            });
                            // Include thoughtSignature if we have it for this tool
                            if let Some(sig) = thought_signatures.get(tool_id) {
                                fc_part["thoughtSignature"] = serde_json::json!(sig);
                            }
                            parts_list.push(fc_part);
                        }
                        "tool_result" => {
                            // Convert to functionResponse format with thoughtSignature (required for Gemini 3)
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            let mut fr_part = serde_json::json!({
                                "functionResponse": {
                                    "name": tool_use_id,
                                    "response": {
                                        "content": block.get("content")
                                    }
                                }
                            });
                            // Include thoughtSignature from matching tool_use (required for Gemini 3)
                            if let Some(sig) = thought_signatures.get(tool_use_id) {
                                fr_part["thoughtSignature"] = serde_json::json!(sig);
                            }
                            parts_list.push(fr_part);
                        }
                        _ => {}
                    }
                }
                parts_list
            }
        };

        if !parts.is_empty() {
            contents.push(serde_json::json!({
                "role": role,
                "parts": parts
            }));
        }
    }

    // Convert tools to Google functionDeclarations format
    let function_declarations: Vec<serde_json::Value> = request
        .tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.input_schema
            })
        })
        .collect();

    let mut google_request = serde_json::json!({
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": max_tokens
        }
    });

    // Add system instruction if present
    if !request.system.is_empty() {
        google_request["systemInstruction"] = serde_json::json!({
            "parts": [{"text": request.system}]
        });
    }

    // Add tools if present
    if !function_declarations.is_empty() {
        google_request["tools"] = serde_json::json!([{
            "functionDeclarations": function_declarations
        }]);
    }

    google_request
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_close(lhs: f32, rhs: f32) {
        assert!((lhs - rhs).abs() < 0.0001, "expected {lhs} ~= {rhs}");
    }

    #[test]
    fn router_parser_accepts_alias_fields_and_string_confidence() {
        let raw = r#"{
            "classification": "tool_use",
            "confidence": "82%",
            "tool_hint": "search_docs, read_file",
            "recommended_provider": "openrouter",
            "recommended_model": "openai/gpt-5.2"
        }"#;

        let parsed = parse_router_decision(raw).expect("router decision should parse");
        assert_eq!(parsed.label, "tool");
        assert_eq!(parsed.tool_hint.unwrap_or_default().len(), 2);
        assert_eq!(parsed.recommended_provider.as_deref(), Some("openrouter"));
        assert_eq!(parsed.recommended_model.as_deref(), Some("openai/gpt-5.2"));
        assert_close(parsed.confidence.unwrap_or_default(), 0.82);
    }

    #[test]
    fn router_parser_accepts_pipeline_step_strings() {
        let raw = r#"```json
        {
            "label": "web_search",
            "confidence": 75,
            "pipeline_steps": [
                "search web sources",
                {"provider":"openrouter","model":"openai/gpt-5.2","purpose":"summarize"}
            ]
        }
        ```"#;

        let parsed = parse_router_decision(raw).expect("router decision should parse");
        assert_eq!(parsed.label, "web");
        assert_close(parsed.confidence.unwrap_or_default(), 0.75);
        let steps = parsed.pipeline_steps.unwrap_or_default();
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].purpose.as_deref(), Some("search web sources"));
        assert_eq!(steps[1].model.as_deref(), Some("openai/gpt-5.2"));
    }

    #[test]
    fn router_parser_falls_back_to_text_pattern() {
        let raw = "Classification: unknown\nConfidence: 0.33";
        let parsed = parse_router_decision(raw).expect("router decision should parse");
        assert_eq!(parsed.label, "unknown");
        assert_close(parsed.confidence.unwrap_or_default(), 0.33);
    }

    #[test]
    fn router_parser_defaults_to_unknown_when_output_is_unparseable() {
        let parsed = parse_router_decision("router unavailable")
            .expect("router decision should default to unknown");
        assert_eq!(parsed.label, "unknown");
        assert_close(parsed.confidence.unwrap_or_default(), 0.0);
    }
}
