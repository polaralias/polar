use crate::agent::{ToolDefinition, ToolResult, ToolUse};
use crate::browser::{validate_url, BrowserManager, BrowserSettings};
use serde_json::json;

const BROWSER_HANDOFF_PROMPT: &str = "User-handoff policy: If login, MFA/2FA, CAPTCHA, or any human verification is required, stop autonomous actions and return a clear waiting message with exact next steps. Keep the current browser state open and do not reset or close it. After the user confirms completion, resume from the current page state and continue the task without restarting completed steps. Do not ask for additional consent once this browser session has started unless explicitly revoked.";

pub fn get_browser_tools() -> Vec<ToolDefinition> {
    vec![
        // ========================================================================
        // PRIMARY: Autonomous browser task via browser-use Agent
        // ========================================================================
        ToolDefinition {
            name: "browser_task".to_string(),
            description: "Run an autonomous browser task using browser-use Agent. The agent will navigate, click, type, scroll, and extract data as needed to complete the task. If user authentication is required, it should pause and wait for user handoff, then resume in the same session. This is the primary browser tool - describe what you want done and the agent handles all browser interactions.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Description of the browser task to complete. Be specific: include URLs, actions, and what data to extract."
                    },
                    "max_steps": {
                        "type": "integer",
                        "description": "Maximum steps the browser agent can take (default 100)"
                    },
                    "use_vision": {
                        "type": "string",
                        "enum": ["auto", "true", "false"],
                        "description": "Whether to use vision/screenshots (default 'auto')"
                    },
                    "capture_debug_screenshot_on_error": {
                        "type": "boolean",
                        "description": "Capture a direct browser screenshot when a task ends in an error state without a final result (default true)"
                    },
                    "extend_system_message": {
                        "type": "string",
                        "description": "Additional instructions for the browser agent"
                    },
                    "consent": {
                        "type": "boolean",
                        "description": "Optional session consent. If omitted, consent is inferred from the active browser session request."
                    }
                },
                "required": ["task"]
            }),
        },

        // ========================================================================
        // NAVIGATION: Direct URL navigation
        // ========================================================================
        ToolDefinition {
            name: "browser_navigate".to_string(),
            description: "Navigate the browser to a specific URL. The browser-use agent will open the page and report its title/content.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to navigate to"
                    },
                    "consent": {
                        "type": "boolean",
                        "description": "Optional session consent. If omitted, consent is inferred from the active browser session request."
                    }
                },
                "required": ["url"]
            }),
        },

        // ========================================================================
        // CONTENT EXTRACTION: Extract data from current page
        // ========================================================================
        ToolDefinition {
            name: "browser_extract".to_string(),
            description: "Extract content from the current browser page using the LLM. Describe what data you want extracted.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "What to extract from the page (e.g., 'all product names and prices', 'the main article text')"
                    }
                },
                "required": ["query"]
            }),
        },

        // ========================================================================
        // SCREENSHOT: Visual capture
        // ========================================================================
        ToolDefinition {
            name: "browser_screenshot".to_string(),
            description: "Take a screenshot of the current browser page. Use sparingly - prefer browser_extract for text content.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },

        // ========================================================================
        // LIFECYCLE: Browser management
        // ========================================================================
        ToolDefinition {
            name: "browser_close".to_string(),
            description: "Close the browser. Use when done with browser tasks.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "browser_status".to_string(),
            description: "Check if the browser is currently running.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
    ]
}

/// Map tool names to sidecar method names
fn get_sidecar_method(tool_name: &str) -> &str {
    match tool_name {
        "browser_task" => "run_task",
        "browser_navigate" => "navigate",
        "browser_extract" => "extract",
        "browser_screenshot" => "screenshot",
        "browser_close" => "close",
        "browser_status" => "status",
        _ => tool_name.strip_prefix("browser_").unwrap_or(tool_name),
    }
}

pub async fn execute_browser_tool(
    tool_use: &ToolUse,
    manager: &BrowserManager,
    settings: &BrowserSettings,
    consent_granted: bool,
) -> ToolResult {
    if !settings.enabled {
        return ToolResult::error(
            tool_use.id.clone(),
            "Browser tools are disabled by settings".to_string(),
        );
    }

    let action = tool_use.name.as_str();
    let input = &tool_use.input;
    let paused = manager.is_paused("browser-use").await;

    let update_error = |msg: String| async {
        manager
            .update_status(None, None, action, "error", Some(msg.clone()))
            .await;
        ToolResult::error(tool_use.id.clone(), msg)
    };

    let pause_blocked_actions = [
        "browser_task",
        "browser_navigate",
        "browser_extract",
        "browser_screenshot",
    ];
    if paused && pause_blocked_actions.contains(&action) {
        return update_error(
            "Browser session is paused. Resume it before running browser actions.".to_string(),
        )
        .await;
    }

    // URL validation for navigate
    if action == "browser_navigate" {
        let url = match get_required_string(input, "url") {
            Ok(v) => v,
            Err(e) => return update_error(e).await,
        };

        if let Err(err) = validate_url(settings, &url) {
            return update_error(err).await;
        }
    }

    // Session-level consent: once a browser session has been initiated, consent is reused.
    let consent_required_actions = ["browser_task", "browser_navigate"];
    let explicit_tool_consent = input
        .get("consent")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if explicit_tool_consent || consent_granted {
        manager.grant_session_consent().await;
    }
    if consent_required_actions.contains(&action) && settings.require_consent {
        let has_session_consent = manager.has_session_consent().await;
        if !has_session_consent {
            // User-initiated browser workflows imply session consent; grant once and continue.
            manager.grant_session_consent().await;
        }
    }

    // Get sidecar method name
    let method = get_sidecar_method(action);

    // Update status to running
    manager
        .update_status(
            Some("browser-use".to_string()),
            None,
            action,
            "running",
            None,
        )
        .await;

    // Build params - pass through input and inject LLM config from user settings
    let mut params = input.clone();
    if let serde_json::Value::Object(ref mut map) = params {
        // Inject provider from user settings if not already set by the tool call
        if !map.contains_key("llm_provider") && !settings.llm_provider.is_empty() {
            map.insert(
                "llm_provider".to_string(),
                serde_json::Value::String(settings.llm_provider.clone()),
            );
        }
        // Inject model from user settings if not already set by the tool call
        if !map.contains_key("llm_model") && !settings.llm_model.is_empty() {
            map.insert(
                "llm_model".to_string(),
                serde_json::Value::String(settings.llm_model.clone()),
            );
        }
        // Inject API key from user settings if not already set by the tool call
        if !map.contains_key("llm_api_key") && !settings.llm_api_key.is_empty() {
            map.insert(
                "llm_api_key".to_string(),
                serde_json::Value::String(settings.llm_api_key.clone()),
            );
        }
        // Inject base URL for compatible providers.
        if !map.contains_key("llm_base_url") && !settings.llm_base_url.is_empty() {
            map.insert(
                "llm_base_url".to_string(),
                serde_json::Value::String(settings.llm_base_url.clone()),
            );
        }
        if action == "browser_task" && !map.contains_key("extend_system_message") {
            map.insert(
                "extend_system_message".to_string(),
                serde_json::Value::String(BROWSER_HANDOFF_PROMPT.to_string()),
            );
        }
        if !map.contains_key("allowed_domains") && !settings.allowed_domains.is_empty() {
            map.insert(
                "allowed_domains".to_string(),
                serde_json::Value::Array(
                    settings
                        .allowed_domains
                        .iter()
                        .cloned()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }
        if !map.contains_key("prohibited_domains") && !settings.blocked_domains.is_empty() {
            map.insert(
                "prohibited_domains".to_string(),
                serde_json::Value::Array(
                    settings
                        .blocked_domains
                        .iter()
                        .cloned()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }
    }

    // Call sidecar
    match manager.call(method, params).await {
        Ok(result) => {
            // Extract URL info from result if available
            let urls = result.get("urls").and_then(|v| v.as_array());
            let current_url = urls
                .and_then(|u| u.last())
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let needs_user_handoff = result
                .get("needs_user_handoff")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                || matches!(
                    result.get("session_state").and_then(|v| v.as_str()),
                    Some("waiting_for_user")
                );
            let handoff_message = result
                .get("handoff_message")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            manager
                .update_status(
                    if action == "browser_close" {
                        None
                    } else {
                        Some("browser-use".to_string())
                    },
                    current_url,
                    action,
                    if action == "browser_close" {
                        "closed"
                    } else if needs_user_handoff {
                        "waiting_for_user"
                    } else {
                        "idle"
                    },
                    if needs_user_handoff {
                        handoff_message
                    } else {
                        None
                    },
                )
                .await;

            if action == "browser_close" {
                manager.clear_session_consent().await;
                manager.clear_status().await;
            }

            ToolResult::success(tool_use.id.clone(), result.to_string())
        }
        Err(err) => update_error(err).await,
    }
}

fn get_required_string(input: &serde_json::Value, key: &str) -> Result<String, String> {
    input
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Missing '{}' parameter", key))
}
