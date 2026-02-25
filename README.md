# Polar

Polar is an advanced, deterministic, multi-agent AI framework designed for high-availability production environments. It strictly enforces contract-driven operations, structured observability, and non-bypassable security gateways.

## Quick Run Setup (CLI & UI)

Polar's true power lies in its portable, zero-code configuration architecture. You can run Polar straight from the CLI and manage all LLM providers, skills, automations, and channel endpoints dynamically through the Web UI or via declarative config files.

Instead of relying on scattered `.env` files, Polar centralizes settings into the **Control Plane Gateway**, backed by an **AES-256-GCM Crypto Vault** that automatically intercepts and encrypts sensitive keys before persisting them to disk.

### 1. Starting the Control Plane

To quickly boot the Polar control plane and the Web UI in development mode:

```bash
# Start the core Polar runtime
npm run dev

# In a separate terminal, launch the Operator Dashboard UI
cd packages/polar-web-ui
npm run dev
```

Navigate to `http://localhost:5173/`. You can now manage your entire stack visually.

### 2. UI & CLI Configuration Options

You can configure your setup interactively through the Web UI (Operator Dashboard) or by bootstrapping a declarative JSON configuration file (`polar.config.json`) via the CLI:
`polar init --config polar.config.json`

Below are the configuration schemas for key platform components:

#### A. LLM Providers

Route to any local (e.g., Ollama, vLLM) or remote (e.g., OpenAI, Anthropic) endpoint.

**Via Web UI:**
Head to the **Providers** tab. Enter your `baseUrl` (e.g. `https://api.openai.com` or `http://localhost:11434`) and your `apiKey`. The Crypto Vault encrypts your key automatically.

**Via CLI/Config (`polar.config.json`):**
```json
[
  {
    "resourceType": "provider",
    "resourceId": "openai",
    "config": {
      "baseUrl": "https://api.openai.com",
      "apiKey": "sk-proj-...",
      "modelLimits": {
        "gpt-4": { "maxTokens": 8192 }
      }
    }
  }
]
```

#### B. Channels and Endpoints (Slack, Discord, Telegram)

Polar fully normalizes all inbound events into a canonical thread envelope. 

**Via Web UI:**
Go to the **Channels** tab. Select your adapter type (Slack, Discord, Telegram), and enter your Bot Tokens, Webhooks, or Signing Secrets.

**Via CLI/Config:**
```json
[
  {
    "resourceType": "channel",
    "resourceId": "telegram.main_bot",
    "config": {
      "botToken": "123456:ABC-DEF1234ghIkl-zyx...",
      "webhookUrl": "https://your-domain.com/webhooks/telegram",
      "enabled": true
    }
  },
  {
    "resourceType": "channel",
    "resourceId": "slack.workspace_bot",
    "config": {
      "signingSecret": "xyz123...", 
      "botToken": "xoxb-123...",
      "enabled": true
    }
  }
]
```

#### C. Installed Skills & MCP Connections

Polar's Extension Fabric handles tool projection and Model Context Protocol (MCP) integrations natively, enforcing strict policy checks prior to tool execution.

**Via Web UI:**
Under the **Extensions** tab, install a skill by pasting its Github URL/Manifest, or connect to an MCP server by providing its stdio/SSE target endpoint.

**Via CLI/Config:**
```json
[
  {
    "resourceType": "extension",
    "resourceId": "mcp.local_file_system",
    "config": {
      "type": "mcp",
      "endpoint": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./data"]
    }
  }
]
```

#### D. Configured Automations

Automations execute tasks unattended, governed by deterministic middleware and budget policies.

**Via Web UI:**
Use the **Automations** tab to set Cron triggers or Proactive heartbeat thresholds, binding them directly to your loaded profiles and capabilities.

**Via CLI/Config:**
```json
[
  {
    "resourceType": "automation",
    "resourceId": "nightly_report",
    "config": {
      "trigger": { 
        "type": "cron", 
        "schedule": "0 0 * * *" 
      },
      "runRules": { 
        "maxConcurrency": 1 
      },
      "agentProfileId": "analyst_agent"
    }
  }
]
```

#### E. Agent Profiles & Multi-Agent Handoffs

Polar is designed for specialized, multi-agent capabilities based on the underlying OpenClaw patterns and `pi-agent` primitives. You can define exact roles, pin specific LLM providers to specialized domains (e.g., Anthropic for writing tasks, Gemini for web-connected research), and tightly bound the allowed handoff behavior.

**Via Web UI:**
Navigate to the **Agent Profiles** tab. You can create specialized sub-agents, bind them to specific providers, attach pre-configured skills (like Web Search), and define which primary agent is allowed to route tasks to them.

**Via CLI/Config:**
```json
[
  {
    "resourceType": "agentProfile",
    "resourceId": "primary_orchestrator",
    "config": {
      "systemPrompt": "You are the primary orchestration agent. Delegate research to 'research_subagent' and writing tasks to 'writer_subagent'.",
      "modelPolicy": {
        "lane": "brain",
        "providerId": "openai",
        "modelId": "gpt-4o"
      },
      "allowedHandoffTargets": ["research_subagent", "writer_subagent"]
    }
  },
  {
    "resourceType": "agentProfile",
    "resourceId": "writer_subagent",
    "config": {
      "systemPrompt": "You are a specialized technical writer focusing on clarity and Markdown.",
      "modelPolicy": {
        "lane": "worker",
        "providerId": "anthropic",
        "modelId": "claude-3-5-sonnet-20241022"
      }
    }
  },
  {
    "resourceType": "agentProfile",
    "resourceId": "research_subagent",
    "config": {
      "systemPrompt": "You are the web research sub-agent.",
      "modelPolicy": {
        "lane": "worker",
        "providerId": "google_gemini",
        "modelId": "gemini-1.5-pro-latest"
      },
      "enabledSkills": ["web_search"]
    }
  }
]
```

By formalizing the handoff via `agentProfile` state objects, the primary orchestrator enforces strict boundary controls. It knows exactly *who* it can delegate to, and *which model* will handle the sub-task execution deterministically. 

---

With these constructs defined either via the Web UI interface or passed via the `polar.config.json` CLI standard, Polar is equipped for massive multi-agent scaling with uncompromised production safety.