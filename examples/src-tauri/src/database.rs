use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Lock error")]
    Lock,
}

use std::collections::HashMap;

pub const TASK_STATUS_PENDING: &str = "PENDING";
pub const TASK_STATUS_RUNNING: &str = "RUNNING";
pub const TASK_STATUS_PAUSED: &str = "PAUSED";
pub const TASK_STATUS_HUMAN_REQUIRED: &str = "HUMAN REQUIRED";
pub const TASK_STATUS_FAILED: &str = "FAILED";
pub const TASK_STATUS_COMPLETED: &str = "COMPLETED";

pub fn normalize_task_status(input: &str) -> String {
    let normalized = input.trim().to_uppercase();
    match normalized.as_str() {
        TASK_STATUS_PENDING => TASK_STATUS_PENDING.to_string(),
        TASK_STATUS_RUNNING => TASK_STATUS_RUNNING.to_string(),
        TASK_STATUS_PAUSED => TASK_STATUS_PAUSED.to_string(),
        TASK_STATUS_HUMAN_REQUIRED => TASK_STATUS_HUMAN_REQUIRED.to_string(),
        TASK_STATUS_FAILED => TASK_STATUS_FAILED.to_string(),
        TASK_STATUS_COMPLETED => TASK_STATUS_COMPLETED.to_string(),
        _ => {
            let compact = input.trim().to_lowercase().replace('_', " ");
            match compact.as_str() {
                "planning" | "pending" => TASK_STATUS_PENDING.to_string(),
                "running" => TASK_STATUS_RUNNING.to_string(),
                "paused" => TASK_STATUS_PAUSED.to_string(),
                "human required" | "waiting for user" | "waiting_for_user"
                | "needs user handoff" => TASK_STATUS_HUMAN_REQUIRED.to_string(),
                "failed" | "error" => TASK_STATUS_FAILED.to_string(),
                "completed" | "done" | "success" => TASK_STATUS_COMPLETED.to_string(),
                _ => TASK_STATUS_PENDING.to_string(),
            }
        }
    }
}

pub fn normalize_step_status(input: &str) -> String {
    normalize_task_status(input)
}

fn normalize_plan_step_list(plan: &mut [PlanStep]) {
    for step in plan {
        step.status = normalize_step_status(&step.status);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub api_key: String,
    pub model: String,
    pub base_url: String,
    pub max_tokens: u32,
    pub temperature: f32,
    #[serde(default)]
    pub execution_backend: String,
    #[serde(default)]
    pub container_enabled: bool,
    #[serde(default)]
    pub container_cpu_cores: f64,
    #[serde(default)]
    pub container_memory_mb: u64,
    #[serde(default)]
    pub container_timeout_secs: u64,
    #[serde(default)]
    pub container_network_enabled: bool,
    #[serde(default)]
    pub container_prepull_on_enable: bool,
    #[serde(default)]
    pub router_model: String,
    #[serde(default)]
    pub browser_enabled: bool,
    #[serde(default)]
    pub browser_require_consent: bool,
    #[serde(default)]
    pub browser_allowed_domains: String,
    #[serde(default)]
    pub browser_blocked_domains: String,
    /// Browser LLM mode: "inherit" (reuse chat model/provider) or "custom"
    #[serde(default)]
    pub browser_llm_mode: String,
    /// Browser LLM provider for custom mode ("openai", "anthropic", "google", "browser_use")
    #[serde(default)]
    pub browser_llm_provider: String,
    /// Browser LLM model for custom mode
    #[serde(default)]
    pub browser_llm_model: String,
    /// Browser LLM API key for custom mode
    #[serde(default)]
    pub browser_llm_api_key: String,
    /// Browser LLM base URL for custom mode (optional)
    #[serde(default)]
    pub browser_llm_base_url: String,
    /// Provider ID (e.g., "anthropic", "ollama", "openrouter")
    /// If empty, will be inferred automatically from model
    #[serde(default)]
    pub provider: String,
    /// Provider-specific API keys
    #[serde(default)]
    pub provider_keys: HashMap<String, String>,
    /// Optional OpenAI Organization ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openai_organization: Option<String>,
    /// Optional OpenAI Project ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openai_project: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: "claude-sonnet-4-5".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            max_tokens: 4096,
            temperature: 0.7,
            execution_backend: "none".to_string(),
            container_enabled: false,
            container_cpu_cores: 2.0,
            container_memory_mb: 2048,
            container_timeout_secs: 300,
            container_network_enabled: true,
            container_prepull_on_enable: false,
            router_model: default_router_model_for("anthropic", "claude-sonnet-4-5"),
            browser_enabled: false,
            browser_require_consent: true,
            browser_allowed_domains: String::new(),
            browser_blocked_domains: String::new(),
            browser_llm_mode: "inherit".to_string(),
            browser_llm_provider: String::new(),
            browser_llm_model: String::new(),
            browser_llm_api_key: String::new(),
            browser_llm_base_url: String::new(),
            provider: "anthropic".to_string(),
            provider_keys: HashMap::new(),
            openai_organization: None,
            openai_project: None,
        }
    }
}

impl Settings {
    /// Automatically infer provider from model (if not set)
    pub fn get_provider(&self) -> String {
        if !self.provider.is_empty() {
            return self.provider.clone();
        }

        // Infer from model name
        let model_lower = self.model.to_lowercase();

        if model_lower.contains("claude") {
            "anthropic".to_string()
        } else if (model_lower.contains("gpt")
            || model_lower.starts_with("o1")
            || model_lower.starts_with("o3")
            || model_lower.starts_with("o4")
            || model_lower.starts_with("computer-use")
            || model_lower.starts_with("chatgpt")
            || model_lower.starts_with("gpt-"))
            && !model_lower.contains("/")
        {
            // OpenAI models: gpt-*, o1-*, o3-*
            "openai".to_string()
        } else if model_lower.contains("gemini") {
            "google".to_string()
        } else if model_lower.contains("minimax") || model_lower.starts_with("m2") {
            "minimax".to_string()
        } else if model_lower.starts_with("anthropic/")
            || model_lower.starts_with("openai/")
            || model_lower.starts_with("meta-llama/")
            || model_lower.starts_with("deepseek/")
        {
            "openrouter".to_string()
        } else if model_lower.contains(":") {
            // Ollama format (e.g., llama3.3:latest)
            "ollama".to_string()
        } else {
            // Default to anthropic
            "anthropic".to_string()
        }
    }

    /// Check if it's a local service that doesn't require API Key
    /// Only returns true for known local inference services with authType === "none"
    pub fn is_local_provider(&self) -> bool {
        let provider = self.get_provider();
        // Only these providers truly don't need API keys
        matches!(
            provider.as_str(),
            "ollama" | "localai" | "vllm" | "tgi" | "sglang" | "lm-studio"
        )
    }

    /// Check if API key can be empty (local providers or custom with empty key)
    pub fn allows_empty_api_key(&self) -> bool {
        // Known local providers don't need API key
        if self.is_local_provider() {
            return true;
        }
        // Custom provider with localhost URL - API key is optional
        let provider = self.get_provider();
        if provider == "custom" {
            return true;
        }
        false
    }

    pub fn default_router_model(&self) -> String {
        default_router_model_for(&self.get_provider(), &self.model)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String, // "PENDING", "RUNNING", "PAUSED", "HUMAN REQUIRED", "FAILED", "COMPLETED"
    pub plan: Option<Vec<PlanStep>>,
    pub current_step: i32,
    pub project_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub step: i32,
    pub description: String,
    pub status: String, // "PENDING", "RUNNING", "PAUSED", "HUMAN REQUIRED", "FAILED", "COMPLETED"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMessage {
    pub id: String,
    pub task_id: String,
    pub role: String, // "user", "assistant"
    pub content: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionLog {
    pub id: String,
    pub tool_use_id: String,
    pub tool_name: String,
    pub input: String,
    pub result: String,
    pub success: bool,
    pub timestamp: i64,
}

pub struct Database {
    pub(crate) conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, DbError> {
        let db_path = Self::get_db_path()?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn get_db_path() -> Result<PathBuf, DbError> {
        let data_dir = dirs::data_dir().ok_or_else(|| {
            DbError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Could not find data directory",
            ))
        })?;
        Ok(data_dir.join("thinqi-cowork").join("thinqi-cowork.db"))
    }

    fn init_tables(&self) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_conversation
             ON messages(conversation_id)",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                plan TEXT,
                current_step INTEGER NOT NULL DEFAULT 0,
                project_path TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS task_messages (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_task_messages_task
             ON task_messages(task_id)",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS execution_audit (
                id TEXT PRIMARY KEY,
                tool_use_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                input TEXT NOT NULL,
                result TEXT NOT NULL,
                success INTEGER NOT NULL,
                timestamp INTEGER NOT NULL
            )",
            [],
        )?;

        self.normalize_existing_task_statuses(&conn)?;

        Ok(())
    }

    fn normalize_existing_task_statuses(&self, conn: &Connection) -> Result<(), DbError> {
        let mut stmt = conn.prepare("SELECT id, status, plan FROM tasks")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;

        let mut updates: Vec<(String, String, Option<String>)> = Vec::new();
        for row in rows {
            let (id, raw_status, raw_plan) = row?;
            let normalized_status = normalize_task_status(&raw_status);

            let normalized_plan = match raw_plan.as_ref() {
                Some(json) => match serde_json::from_str::<Vec<PlanStep>>(json) {
                    Ok(mut plan) => {
                        normalize_plan_step_list(&mut plan);
                        Some(serde_json::to_string(&plan).unwrap_or_else(|_| json.clone()))
                    }
                    Err(_) => raw_plan.clone(),
                },
                None => None,
            };

            if raw_status != normalized_status || normalized_plan != raw_plan {
                updates.push((id, normalized_status, normalized_plan));
            }
        }
        drop(stmt);

        if updates.is_empty() {
            return Ok(());
        }

        let now = chrono::Utc::now().timestamp_millis();
        for (id, status, plan) in updates {
            conn.execute(
                "UPDATE tasks SET status = ?1, plan = ?2, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![status, plan, now, id],
            )?;
        }

        Ok(())
    }

    // Settings methods
    pub fn get_settings(&self) -> Result<Settings, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let mut settings = Settings::default();
        let mut router_model_seen = false;

        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        for row in rows {
            let (key, value) = row?;
            match key.as_str() {
                "api_key" => settings.api_key = value,
                "model" => settings.model = value,
                "base_url" => settings.base_url = value,
                "max_tokens" => settings.max_tokens = value.parse().unwrap_or(4096),
                "temperature" => settings.temperature = value.parse().unwrap_or(0.7),
                "execution_backend" => settings.execution_backend = value,
                "container_enabled" => settings.container_enabled = value == "true",
                "container_cpu_cores" => {
                    settings.container_cpu_cores = value.parse().unwrap_or(2.0)
                }
                "container_memory_mb" => {
                    settings.container_memory_mb = value.parse().unwrap_or(2048)
                }
                "container_timeout_secs" => {
                    settings.container_timeout_secs = value.parse().unwrap_or(300)
                }
                "container_network_enabled" => settings.container_network_enabled = value == "true",
                "container_prepull_on_enable" => {
                    settings.container_prepull_on_enable = value == "true"
                }
                "router_model" => {
                    router_model_seen = true;
                    settings.router_model = value;
                }
                "browser_enabled" => settings.browser_enabled = value == "true",
                "browser_require_consent" => settings.browser_require_consent = value == "true",
                "browser_allowed_domains" => settings.browser_allowed_domains = value,
                "browser_blocked_domains" => settings.browser_blocked_domains = value,
                "browser_llm_mode" => settings.browser_llm_mode = value,
                "browser_llm_provider" => settings.browser_llm_provider = value,
                "browser_llm_model" => settings.browser_llm_model = value,
                "browser_llm_api_key" => settings.browser_llm_api_key = value,
                "browser_llm_base_url" => settings.browser_llm_base_url = value,
                "provider" => settings.provider = value,
                "provider_keys" => {
                    // Parse JSON to HashMap
                    if let Ok(keys) = serde_json::from_str::<HashMap<String, String>>(&value) {
                        settings.provider_keys = keys;
                    }
                }
                _ => {}
            }
        }

        settings.model = normalize_model_id(&settings.model);
        settings.router_model = normalize_model_id(&settings.router_model);
        settings.browser_llm_model = normalize_model_id(&settings.browser_llm_model);

        // If provider is empty, infer from model
        if settings.provider.is_empty() {
            settings.provider = settings.get_provider();
        }

        if !router_model_seen {
            settings.router_model = settings.default_router_model();
        }

        if settings.browser_llm_mode.is_empty() {
            settings.browser_llm_mode = "inherit".to_string();
        }

        // If api_key is empty but we have a provider_key for current provider, use it
        if settings.api_key.is_empty() {
            if let Some(key) = settings.provider_keys.get(&settings.provider) {
                settings.api_key = key.clone();
            }
        }

        Ok(settings)
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let normalized_model = normalize_model_id(&settings.model);
        let normalized_router_model = if settings.router_model.trim().is_empty() {
            String::new()
        } else {
            normalize_model_id(&settings.router_model)
        };
        let normalized_browser_llm_model = if settings.browser_llm_model.trim().is_empty() {
            String::new()
        } else {
            normalize_model_id(&settings.browser_llm_model)
        };

        // If provider is empty, infer automatically
        let provider = if settings.provider.is_empty() {
            let mut normalized_settings = settings.clone();
            normalized_settings.model = normalized_model.clone();
            normalized_settings.provider.clear();
            normalized_settings.get_provider()
        } else {
            settings.provider.clone()
        };

        // Serialize provider_keys to JSON
        let provider_keys_json =
            serde_json::to_string(&settings.provider_keys).unwrap_or_else(|_| "{}".to_string());

        let pairs = [
            ("api_key", settings.api_key.clone()),
            ("model", normalized_model),
            ("base_url", settings.base_url.clone()),
            ("max_tokens", settings.max_tokens.to_string()),
            ("temperature", settings.temperature.to_string()),
            ("execution_backend", settings.execution_backend.clone()),
            ("container_enabled", settings.container_enabled.to_string()),
            (
                "container_cpu_cores",
                settings.container_cpu_cores.to_string(),
            ),
            (
                "container_memory_mb",
                settings.container_memory_mb.to_string(),
            ),
            (
                "container_timeout_secs",
                settings.container_timeout_secs.to_string(),
            ),
            (
                "container_network_enabled",
                settings.container_network_enabled.to_string(),
            ),
            (
                "container_prepull_on_enable",
                settings.container_prepull_on_enable.to_string(),
            ),
            ("router_model", normalized_router_model),
            ("browser_enabled", settings.browser_enabled.to_string()),
            (
                "browser_require_consent",
                settings.browser_require_consent.to_string(),
            ),
            (
                "browser_allowed_domains",
                settings.browser_allowed_domains.clone(),
            ),
            (
                "browser_blocked_domains",
                settings.browser_blocked_domains.clone(),
            ),
            ("browser_llm_mode", settings.browser_llm_mode.clone()),
            (
                "browser_llm_provider",
                settings.browser_llm_provider.clone(),
            ),
            ("browser_llm_model", normalized_browser_llm_model),
            ("browser_llm_api_key", settings.browser_llm_api_key.clone()),
            (
                "browser_llm_base_url",
                settings.browser_llm_base_url.clone(),
            ),
            ("provider", provider),
            ("provider_keys", provider_keys_json),
        ];

        for (key, value) in pairs {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                [key, &value],
            )?;
        }

        Ok(())
    }

    // Conversation methods
    pub fn list_conversations(&self) -> Result<Vec<Conversation>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at
             FROM conversations
             ORDER BY updated_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;

        let mut conversations = Vec::new();
        for row in rows {
            conversations.push(row?);
        }

        Ok(conversations)
    }

    pub fn create_conversation(&self, id: &str, title: &str) -> Result<Conversation, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            [id, title, &now.to_string(), &now.to_string()],
        )?;

        Ok(Conversation {
            id: id.to_string(),
            title: title.to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn update_conversation_title(&self, id: &str, title: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            [title, &now.to_string(), id],
        )?;

        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        // Delete messages first (cascade)
        conn.execute("DELETE FROM messages WHERE conversation_id = ?1", [id])?;
        conn.execute("DELETE FROM conversations WHERE id = ?1", [id])?;

        Ok(())
    }

    // Message methods
    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<Message>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, timestamp
             FROM messages
             WHERE conversation_id = ?1
             ORDER BY timestamp ASC",
        )?;

        let rows = stmt.query_map([conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
            })
        })?;

        let mut messages = Vec::new();
        for row in rows {
            messages.push(row?);
        }

        Ok(messages)
    }

    pub fn add_message(
        &self,
        id: &str,
        conversation_id: &str,
        role: &str,
        content: &str,
    ) -> Result<Message, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            [id, conversation_id, role, content, &now.to_string()],
        )?;

        // Update conversation's updated_at
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            [&now.to_string(), conversation_id],
        )?;

        Ok(Message {
            id: id.to_string(),
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            timestamp: now,
        })
    }

    #[allow(dead_code)]
    pub fn update_message_content(&self, id: &str, content: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        conn.execute(
            "UPDATE messages SET content = ?1 WHERE id = ?2",
            [content, id],
        )?;

        Ok(())
    }

    // Task methods
    pub fn list_tasks(&self) -> Result<Vec<Task>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        let mut stmt = conn.prepare(
            "SELECT id, title, description, status, plan, current_step, project_path, created_at, updated_at
             FROM tasks
             ORDER BY updated_at DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            let plan_json: Option<String> = row.get(4)?;
            let mut plan: Option<Vec<PlanStep>> =
                plan_json.and_then(|json| serde_json::from_str(&json).ok());
            if let Some(steps) = plan.as_mut() {
                normalize_plan_step_list(steps);
            }

            let status: String = row.get(3)?;

            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: normalize_task_status(&status),
                plan,
                current_step: row.get(5)?,
                project_path: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row?);
        }

        Ok(tasks)
    }

    pub fn get_task(&self, id: &str) -> Result<Option<Task>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        let mut stmt = conn.prepare(
            "SELECT id, title, description, status, plan, current_step, project_path, created_at, updated_at
             FROM tasks WHERE id = ?1"
        )?;

        let mut rows = stmt.query([id])?;

        if let Some(row) = rows.next()? {
            let plan_json: Option<String> = row.get(4)?;
            let mut plan: Option<Vec<PlanStep>> =
                plan_json.and_then(|json| serde_json::from_str(&json).ok());
            if let Some(steps) = plan.as_mut() {
                normalize_plan_step_list(steps);
            }

            let status: String = row.get(3)?;

            Ok(Some(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: normalize_task_status(&status),
                plan,
                current_step: row.get(5)?,
                project_path: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn create_task(
        &self,
        id: &str,
        title: &str,
        description: &str,
        project_path: Option<&str>,
    ) -> Result<Task, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO tasks (id, title, description, status, current_step, project_path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7)",
            rusqlite::params![id, title, description, TASK_STATUS_PENDING, project_path, now, now],
        )?;

        Ok(Task {
            id: id.to_string(),
            title: title.to_string(),
            description: description.to_string(),
            status: TASK_STATUS_PENDING.to_string(),
            plan: None,
            current_step: 0,
            project_path: project_path.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn update_task_plan(&self, id: &str, plan: &[PlanStep]) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();
        let plan_json = serde_json::to_string(plan).unwrap_or_default();

        conn.execute(
            "UPDATE tasks SET plan = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![plan_json, TASK_STATUS_RUNNING, now, id],
        )?;

        Ok(())
    }

    pub fn update_task_step(
        &self,
        id: &str,
        current_step: i32,
        step_status: &str,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();
        let step_status = normalize_step_status(step_status);

        // Get current plan and update the step status
        let mut stmt = conn.prepare("SELECT plan FROM tasks WHERE id = ?1")?;
        let plan_json: Option<String> = stmt.query_row([id], |row| row.get(0)).ok().flatten();

        if let Some(json) = plan_json {
            if let Ok(mut plan) = serde_json::from_str::<Vec<PlanStep>>(&json) {
                normalize_plan_step_list(&mut plan);
                if let Some(step) = plan.iter_mut().find(|s| s.step == current_step) {
                    step.status = step_status.clone();
                }
                let updated_json = serde_json::to_string(&plan).unwrap_or_default();
                conn.execute(
                    "UPDATE tasks SET plan = ?1, current_step = ?2, updated_at = ?3 WHERE id = ?4",
                    rusqlite::params![updated_json, current_step, now, id],
                )?;
            }
        }

        Ok(())
    }

    pub fn update_task_status(&self, id: &str, status: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();
        let status = normalize_task_status(status);

        conn.execute(
            "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![status, now, id],
        )?;

        Ok(())
    }

    pub fn reconcile_task_statuses_after_restart(&self) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();

        let mut stmt = conn.prepare("SELECT id, status FROM tasks")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut updates: Vec<(String, String)> = Vec::new();
        for row in rows {
            let (id, raw_status) = row?;
            let normalized_status = normalize_task_status(&raw_status);
            let reconciled_status = if normalized_status == TASK_STATUS_RUNNING {
                TASK_STATUS_PAUSED.to_string()
            } else {
                normalized_status
            };
            if raw_status != reconciled_status {
                updates.push((id, reconciled_status));
            }
        }
        drop(stmt);

        for (id, status) in updates {
            conn.execute(
                "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![status, now, id],
            )?;
        }

        Ok(())
    }

    pub fn pause_running_tasks(&self) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();

        let mut stmt = conn.prepare("SELECT id, status FROM tasks")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut task_ids: Vec<String> = Vec::new();
        for row in rows {
            let (id, status) = row?;
            if normalize_task_status(&status) == TASK_STATUS_RUNNING {
                task_ids.push(id);
            }
        }
        drop(stmt);

        for task_id in task_ids {
            conn.execute(
                "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![TASK_STATUS_PAUSED, now, task_id],
            )?;
        }

        Ok(())
    }

    pub fn delete_task(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        // Delete messages first
        conn.execute("DELETE FROM task_messages WHERE task_id = ?1", [id])?;
        conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
        Ok(())
    }

    // Task message methods
    pub fn get_task_messages(&self, task_id: &str) -> Result<Vec<TaskMessage>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        let mut stmt = conn.prepare(
            "SELECT id, task_id, role, content, timestamp
             FROM task_messages
             WHERE task_id = ?1
             ORDER BY timestamp ASC",
        )?;

        let rows = stmt.query_map([task_id], |row| {
            Ok(TaskMessage {
                id: row.get(0)?,
                task_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
            })
        })?;

        let mut messages = Vec::new();
        for row in rows {
            messages.push(row?);
        }

        Ok(messages)
    }

    pub fn add_task_message(
        &self,
        id: &str,
        task_id: &str,
        role: &str,
        content: &str,
    ) -> Result<TaskMessage, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO task_messages (id, task_id, role, content, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, task_id, role, content, now],
        )?;

        // Update task's updated_at
        conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, task_id],
        )?;

        Ok(TaskMessage {
            id: id.to_string(),
            task_id: task_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            timestamp: now,
        })
    }

    #[allow(dead_code)]
    pub fn update_task_message_content(&self, id: &str, content: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        conn.execute(
            "UPDATE task_messages SET content = ?1 WHERE id = ?2",
            [content, id],
        )?;

        Ok(())
    }

    pub fn log_execution(
        &self,
        tool_use_id: &str,
        tool_name: &str,
        input: &serde_json::Value,
        result: &str,
        success: bool,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = chrono::Utc::now().timestamp_millis();
        let input_json = serde_json::to_string(input).unwrap_or_else(|_| "{}".to_string());
        let id = uuid::Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO execution_audit (id, tool_use_id, tool_name, input, result, success, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, tool_use_id, tool_name, input_json, result, success as i32, now],
        )?;

        Ok(())
    }

    pub fn list_execution_logs(&self, limit: usize) -> Result<Vec<ExecutionLog>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;

        let mut stmt = conn.prepare(
            "SELECT id, tool_use_id, tool_name, input, result, success, timestamp
             FROM execution_audit
             ORDER BY timestamp DESC
             LIMIT ?1",
        )?;

        let rows = stmt.query_map([limit as i64], |row| {
            Ok(ExecutionLog {
                id: row.get(0)?,
                tool_use_id: row.get(1)?,
                tool_name: row.get(2)?,
                input: row.get(3)?,
                result: row.get(4)?,
                success: row.get::<_, i32>(5)? != 0,
                timestamp: row.get(6)?,
            })
        })?;

        let mut logs = Vec::new();
        for row in rows {
            logs.push(row?);
        }

        Ok(logs)
    }
}

fn default_router_model_for(provider: &str, fallback_model: &str) -> String {
    match provider {
        "anthropic" => "claude-sonnet-4-5".to_string(),
        "openai" => "gpt-5-mini".to_string(),
        "google" => "gemini-3-flash-preview-09-2026".to_string(),
        "minimax" => "M2".to_string(),
        "openrouter" => "openai/gpt-5.2".to_string(),
        "together" => "meta-llama/Llama-3.3-70B-Instruct-Turbo".to_string(),
        "groq" => "mixtral-8x7b-32768".to_string(),
        "deepseek" => "deepseek-chat".to_string(),
        "siliconflow" => "Qwen/Qwen2.5-72B-Instruct".to_string(),
        "ollama" => "llama3.3:latest".to_string(),
        _ => fallback_model.to_string(),
    }
}

fn normalize_model_id(model_id: &str) -> String {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let canonical = trimmed.to_lowercase().replace('_', "-").replace(' ', "-");
    match canonical.as_str() {
        "gpt-5.2-mini" | "gpt-5.1-mini" => "gpt-5-mini".to_string(),
        "gpt-5.2-nano" | "gpt-5.1-nano" => "gpt-5-nano".to_string(),
        "gpt-5-mini" => "gpt-5-mini".to_string(),
        "gpt-5-nano" => "gpt-5-nano".to_string(),
        "gpt-5" => "gpt-5.2".to_string(),
        "gpt-4o" => "gpt-5-mini".to_string(),
        _ => trimmed.to_string(),
    }
}
