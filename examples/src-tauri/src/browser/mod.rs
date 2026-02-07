use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Instant};

use crate::database::Settings;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BrowserSettings {
    pub enabled: bool,
    pub require_consent: bool,
    pub allowed_domains: Vec<String>,
    pub blocked_domains: Vec<String>,
    /// LLM provider for browser-use agent ("anthropic", "openai", "google", or "browser_use")
    #[serde(default)]
    pub llm_provider: String,
    /// LLM model for browser-use agent
    #[serde(default)]
    pub llm_model: String,
    /// API key for the browser-use agent's LLM
    #[serde(default)]
    pub llm_api_key: String,
    /// Optional base URL for browser LLM provider (useful for OpenAI-compatible endpoints)
    #[serde(default)]
    pub llm_base_url: String,
}

impl BrowserSettings {
    pub fn from_settings(settings: &Settings) -> Self {
        let app_provider = settings.get_provider();
        let mode = settings.browser_llm_mode.trim().to_lowercase();
        let use_custom = mode == "custom";

        let (llm_provider, llm_model, llm_api_key, llm_base_url) = if use_custom {
            let provider = settings.browser_llm_provider.trim().to_lowercase();
            let provider = if provider.is_empty() {
                "browser_use".to_string()
            } else {
                provider
            };

            // Resolve API key for custom mode:
            // browser custom key -> provider-specific key -> main api_key
            let api_key = if !settings.browser_llm_api_key.trim().is_empty() {
                settings.browser_llm_api_key.clone()
            } else {
                settings
                    .provider_keys
                    .get(&provider)
                    .filter(|k| !k.is_empty())
                    .cloned()
                    .unwrap_or_else(|| settings.api_key.clone())
            };

            // Browser custom mode should not blindly inherit the app base URL
            // when provider differs, otherwise OpenAI requests may hit Anthropic
            // (or other) endpoints and return 404.
            let base_url = if !settings.browser_llm_base_url.trim().is_empty() {
                settings.browser_llm_base_url.clone()
            } else if provider == app_provider {
                settings.base_url.clone()
            } else {
                default_base_url_for_provider(&provider)
                    .unwrap_or_default()
                    .to_string()
            };

            (
                provider,
                settings.browser_llm_model.clone(),
                api_key,
                base_url,
            )
        } else {
            // Inherit mode: reuse app provider/model/key
            let provider = match app_provider.as_str() {
                "anthropic" => "anthropic".to_string(),
                "openai" => "openai".to_string(),
                "google" => "google".to_string(),
                // Unknown providers fall back to browser_use native provider.
                _ => "browser_use".to_string(),
            };

            let api_key = settings
                .provider_keys
                .get(&app_provider)
                .filter(|k| !k.is_empty())
                .cloned()
                .unwrap_or_else(|| settings.api_key.clone());

            (
                provider,
                settings.model.clone(),
                api_key,
                settings.base_url.clone(),
            )
        };

        Self {
            enabled: settings.browser_enabled,
            require_consent: settings.browser_require_consent,
            allowed_domains: parse_domain_list(&settings.browser_allowed_domains),
            blocked_domains: parse_domain_list(&settings.browser_blocked_domains),
            llm_provider,
            llm_model,
            llm_api_key,
            llm_base_url,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BrowserStatus {
    pub session_id: Option<String>,
    pub url: Option<String>,
    pub last_action: Option<String>,
    pub status: String,
    pub last_error: Option<String>,
}

impl Default for BrowserStatus {
    fn default() -> Self {
        Self {
            session_id: None,
            url: None,
            last_action: None,
            status: "idle".to_string(),
            last_error: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BrowserSessionInfo {
    pub session_id: String,
    pub url: String,
    pub title: String,
}

#[derive(Serialize)]
struct SidecarRequest {
    id: u64,
    method: String,
    params: serde_json::Value,
}

#[derive(Deserialize)]
struct SidecarResponse {
    id: u64,
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
}

struct BrowserProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

struct BrowserInner {
    process: Option<BrowserProcess>,
    next_id: u64,
    status: BrowserStatus,
    consent_granted: bool,
    paused_sessions: HashSet<String>,
    resource_dir: Option<PathBuf>,
    dev_root: PathBuf,
}

#[derive(Clone)]
pub struct BrowserManager {
    inner: std::sync::Arc<Mutex<BrowserInner>>,
}

impl BrowserManager {
    pub fn new() -> Self {
        let dev_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self {
            inner: std::sync::Arc::new(Mutex::new(BrowserInner {
                process: None,
                next_id: 1,
                status: BrowserStatus::default(),
                consent_granted: false,
                paused_sessions: HashSet::new(),
                resource_dir: None,
                dev_root,
            })),
        }
    }

    pub async fn set_resource_dir(&self, resource_dir: Option<PathBuf>) {
        let mut inner = self.inner.lock().await;
        inner.resource_dir = resource_dir;
    }

    pub async fn get_status(&self) -> BrowserStatus {
        let inner = self.inner.lock().await;
        inner.status.clone()
    }

    pub async fn pause_session(&self, session_id: &str) {
        let mut inner = self.inner.lock().await;
        inner.paused_sessions.insert(session_id.to_string());
        inner.status.status = "paused".to_string();
    }

    pub async fn resume_session(&self, session_id: &str) {
        let mut inner = self.inner.lock().await;
        inner.paused_sessions.remove(session_id);
        if inner.status.status == "paused" {
            inner.status.status = "idle".to_string();
        }
    }

    pub async fn is_paused(&self, session_id: &str) -> bool {
        let inner = self.inner.lock().await;
        inner.paused_sessions.contains(session_id)
    }

    pub async fn grant_session_consent(&self) {
        let mut inner = self.inner.lock().await;
        inner.consent_granted = true;
    }

    pub async fn has_session_consent(&self) -> bool {
        let inner = self.inner.lock().await;
        inner.consent_granted
    }

    pub async fn clear_session_consent(&self) {
        let mut inner = self.inner.lock().await;
        inner.consent_granted = false;
    }

    /// List all active browser sessions (browser-use manages a single browser)
    pub async fn list_sessions(&self) -> Vec<BrowserSessionInfo> {
        let inner = self.inner.lock().await;
        let running = inner.process.is_some()
            || inner.status.session_id.as_deref() == Some("browser-use")
            || inner.status.status == "running"
            || inner.status.status == "paused"
            || inner.status.status == "waiting_for_user";
        if running {
            vec![BrowserSessionInfo {
                session_id: "browser-use".to_string(),
                url: inner.status.url.clone().unwrap_or_default(),
                title: "Browser Use Session".to_string(),
            }]
        } else {
            Vec::new()
        }
    }

    pub async fn call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let mut inner = self.inner.lock().await;
        self.ensure_process(&mut inner).await?;

        let id = inner.next_id;
        inner.next_id += 1;
        let call_timeout = rpc_timeout_for(method, &params);

        let request = SidecarRequest {
            id,
            method: method.to_string(),
            params,
        };
        let payload = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize sidecar request: {}", e))?;

        let write_payload_result = {
            let process = inner
                .process
                .as_mut()
                .ok_or_else(|| "Sidecar not running".to_string())?;
            timeout(
                Duration::from_secs(10),
                process.stdin.write_all(payload.as_bytes()),
            )
            .await
        };
        match write_payload_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                inner.process = None;
                return Err(format!("Failed to write to sidecar: {}", e));
            }
            Err(_) => {
                if let Some(proc) = inner.process.as_mut() {
                    let _ = proc.child.start_kill();
                }
                inner.process = None;
                return Err("Timed out writing to browser-use sidecar".to_string());
            }
        }

        let write_newline_result = {
            let process = inner
                .process
                .as_mut()
                .ok_or_else(|| "Sidecar not running".to_string())?;
            timeout(Duration::from_secs(10), process.stdin.write_all(b"\n")).await
        };
        match write_newline_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                inner.process = None;
                return Err(format!("Failed to write to sidecar: {}", e));
            }
            Err(_) => {
                if let Some(proc) = inner.process.as_mut() {
                    let _ = proc.child.start_kill();
                }
                inner.process = None;
                return Err("Timed out writing newline to browser-use sidecar".to_string());
            }
        }

        let flush_result = {
            let process = inner
                .process
                .as_mut()
                .ok_or_else(|| "Sidecar not running".to_string())?;
            timeout(Duration::from_secs(10), process.stdin.flush()).await
        };
        match flush_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                inner.process = None;
                return Err(format!("Failed to flush sidecar stdin: {}", e));
            }
            Err(_) => {
                if let Some(proc) = inner.process.as_mut() {
                    let _ = proc.child.start_kill();
                }
                inner.process = None;
                return Err("Timed out flushing browser-use sidecar stdin".to_string());
            }
        }

        let deadline = Instant::now() + call_timeout;
        let mut skipped_lines = 0usize;
        let mut last_noise: Option<String> = None;

        loop {
            let mut line = String::new();
            let now = Instant::now();
            if now >= deadline {
                if let Some(proc) = inner.process.as_mut() {
                    let _ = proc.child.start_kill();
                }
                inner.process = None;
                let noise_suffix = last_noise
                    .as_ref()
                    .map(|v| format!(". Last stdout line: {}", v))
                    .unwrap_or_default();
                return Err(format!(
                    "Browser-use sidecar timed out after {}s while running '{}' (ignored {} non-response lines{})",
                    call_timeout.as_secs(),
                    method,
                    skipped_lines,
                    noise_suffix
                ));
            }

            let remaining = deadline.saturating_duration_since(now);
            let read_result = {
                let process = inner
                    .process
                    .as_mut()
                    .ok_or_else(|| "Sidecar not running".to_string())?;
                timeout(remaining, process.stdout.read_line(&mut line)).await
            };
            let bytes = match read_result {
                Ok(Ok(v)) => v,
                Ok(Err(e)) => {
                    inner.process = None;
                    return Err(format!("Failed to read from sidecar: {}", e));
                }
                Err(_) => {
                    if let Some(proc) = inner.process.as_mut() {
                        let _ = proc.child.start_kill();
                    }
                    inner.process = None;
                    let noise_suffix = last_noise
                        .as_ref()
                        .map(|v| format!(". Last stdout line: {}", v))
                        .unwrap_or_default();
                    return Err(format!(
                        "Browser-use sidecar timed out after {}s while running '{}' (ignored {} non-response lines{})",
                        call_timeout.as_secs(),
                        method,
                        skipped_lines,
                        noise_suffix
                    ));
                }
            };

            if bytes == 0 {
                inner.process = None;
                let noise_suffix = last_noise
                    .as_ref()
                    .map(|v| format!(". Last stdout line: {}", v))
                    .unwrap_or_default();
                return Err(format!(
                    "Browser-use sidecar disconnected while running '{}' (ignored {} non-response lines{})",
                    method,
                    skipped_lines,
                    noise_suffix
                ));
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            match serde_json::from_str::<SidecarResponse>(trimmed) {
                Ok(response) if response.id == id => {
                    if response.ok {
                        return Ok(response.result.unwrap_or_else(|| serde_json::json!({})));
                    }
                    return Err(response
                        .error
                        .unwrap_or_else(|| "Browser-use sidecar error".to_string()));
                }
                Ok(response) => {
                    skipped_lines += 1;
                    last_noise = Some(format!("mismatched response id {}", response.id));
                    continue;
                }
                Err(_) => {
                    skipped_lines += 1;
                    let mut snippet = trimmed.to_string();
                    if snippet.len() > 240 {
                        snippet.truncate(240);
                        snippet.push_str("...");
                    }
                    last_noise = Some(snippet);
                    continue;
                }
            }
        }
    }

    pub async fn update_status(
        &self,
        session_id: Option<String>,
        url: Option<String>,
        action: &str,
        status: &str,
        error: Option<String>,
    ) {
        let mut inner = self.inner.lock().await;
        inner.status.session_id = session_id.or(inner.status.session_id.clone());
        if url.is_some() {
            inner.status.url = url;
        }
        inner.status.last_action = Some(action.to_string());
        inner.status.status = status.to_string();
        inner.status.last_error = error;
    }

    pub async fn clear_status(&self) {
        let mut inner = self.inner.lock().await;
        inner.status = BrowserStatus::default();
        inner.consent_granted = false;
    }

    async fn ensure_process(&self, inner: &mut BrowserInner) -> Result<(), String> {
        if inner.process.is_some() {
            return Ok(());
        }

        let script_path = resolve_sidecar_path(inner)?;
        let sidecar_root = script_path
            .parent()
            .ok_or_else(|| "Browser-use sidecar root not found".to_string())?
            .to_path_buf();

        // Find Python executable
        let python = find_python()?;

        // Check that requirements are installed by verifying the sidecar script exists
        if !script_path.exists() {
            return Err("Browser-use sidecar script not found. Ensure browser-use-sidecar/main.py is available.".to_string());
        }

        let mut cmd = Command::new(&python);
        cmd.arg("-u") // unbuffered stdout
            .arg(&script_path)
            .current_dir(&sidecar_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Pass through environment variables for LLM API keys
        for var in &[
            "BROWSER_USE_API_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GOOGLE_API_KEY",
        ] {
            if let Ok(val) = std::env::var(var) {
                cmd.env(var, val);
            }
        }
        // Force UTF-8 output for sidecar JSON-RPC transport and logging on Windows.
        cmd.env("PYTHONUTF8", "1");
        cmd.env("PYTHONIOENCODING", "utf-8");
        // Keep sidecar logs lean; browser-use debug/info logging can be very noisy.
        cmd.env("BROWSER_USE_SETUP_LOGGING", "false");
        // Prefer bundled Playwright browsers colocated with the sidecar.
        let bundled_playwright_path = sidecar_root.join("playwright-browsers");
        if bundled_playwright_path.exists() {
            cmd.env(
                "PLAYWRIGHT_BROWSERS_PATH",
                bundled_playwright_path.as_os_str(),
            );
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to start browser-use sidecar (python: {}): {}",
                python, e
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open sidecar stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open sidecar stdout".to_string())?;

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    let read = reader.read_line(&mut line).await.unwrap_or(0);
                    if read == 0 {
                        break;
                    }
                    eprintln!("[browser-use-sidecar] {}", line.trim());
                }
            });
        }

        inner.process = Some(BrowserProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        });

        Ok(())
    }
}

/// Find a suitable Python executable (python3, python, or py on Windows)
fn find_python() -> Result<String, String> {
    // Check for explicit override
    if let Ok(path) = std::env::var("BROWSER_USE_PYTHON") {
        return Ok(path);
    }

    // Prefer Python 3.12 / 3.11 for sidecar stability.
    // Fallback to any available Python 3.x.
    let candidates: &[(&str, &[&str])] = &[
        ("py", &["-3.12"]),
        ("py", &["-3.11"]),
        ("python3.12", &[]),
        ("python3.11", &[]),
        ("python3", &[]),
        ("python", &[]),
        ("py", &[]),
    ];

    for (cmd, args) in candidates {
        if let Some(exe) = resolve_python_executable(cmd, args) {
            return Ok(exe);
        }
    }

    Err("Python not found. Install Python 3.11/3.12 (preferred) and ensure it is on PATH, or set BROWSER_USE_PYTHON.".to_string())
}

fn resolve_python_executable(cmd: &str, args: &[&str]) -> Option<String> {
    let mut command = std::process::Command::new(cmd);
    for arg in args {
        command.arg(arg);
    }
    if args.is_empty() {
        let status = command
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        if matches!(status, Ok(s) if s.success()) {
            return Some(cmd.to_string());
        }
        return None;
    }

    // For versioned py launcher invocations, resolve concrete executable path.
    let output = command
        .arg("-c")
        .arg("import sys; print(sys.executable)")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        _ => None,
    }
}

fn rpc_timeout_for(method: &str, params: &serde_json::Value) -> Duration {
    match method {
        "status" | "close" | "shutdown" => Duration::from_secs(15),
        "navigate" | "extract" | "screenshot" => Duration::from_secs(120),
        "run_task" => {
            let steps = params
                .get("max_steps")
                .and_then(|v| v.as_u64())
                .unwrap_or(100);
            let seconds = (steps.saturating_mul(20)).clamp(45, 1200);
            Duration::from_secs(seconds)
        }
        _ => Duration::from_secs(120),
    }
}

fn default_base_url_for_provider(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("https://api.openai.com/v1"),
        "anthropic" => Some("https://api.anthropic.com"),
        "google" => Some("https://generativelanguage.googleapis.com"),
        _ => None,
    }
}

fn resolve_sidecar_path(inner: &BrowserInner) -> Result<PathBuf, String> {
    // Check for explicit override
    if let Ok(explicit) = std::env::var("BROWSER_USE_SIDECAR_PATH") {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Ok(path);
        }
    }

    let mut candidates = Vec::new();

    // Check resource dir (production build)
    if let Some(resource_dir) = &inner.resource_dir {
        candidates.push(resource_dir.join("browser-use-sidecar").join("main.py"));
    }

    // Development paths
    candidates.push(inner.dev_root.join("browser-use-sidecar").join("main.py"));
    candidates.push(
        inner
            .dev_root
            .join("..")
            .join("browser-use-sidecar")
            .join("main.py"),
    );

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(
        "Browser-use sidecar script not found. Ensure browser-use-sidecar/main.py is available."
            .to_string(),
    )
}

pub fn validate_url(settings: &BrowserSettings, url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL '{}': {}", url, e))?;

    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Unsupported URL scheme: {}", other)),
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL must include a host".to_string())?
        .to_lowercase();

    if matches_domain(&host, &settings.blocked_domains) {
        return Err(format!("Domain '{}' is blocked", host));
    }

    if !settings.allowed_domains.is_empty() && !matches_domain(&host, &settings.allowed_domains) {
        return Err(format!("Domain '{}' is not in the allowlist", host));
    }

    Ok(())
}

fn parse_domain_list(input: &str) -> Vec<String> {
    input
        .split(|c| c == ',' || c == '\n' || c == '\r')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}

fn matches_domain(host: &str, list: &[String]) -> bool {
    list.iter()
        .any(|pattern| host == pattern.as_str() || host.ends_with(&format!(".{}", pattern)))
}
