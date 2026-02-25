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

You can configure your setup interactively through the Web UI (Operator Dashboard) or locally using the core Polar CLI utility. 

**No plain-text config files are needed.** The CLI injects credentials dynamically, which are instantly encrypted by the Crypto Vault before storage.

Below are the configuration schemas for key platform components:

#### A. LLM Providers

Route to any local (e.g., Ollama, vLLM) or remote (e.g., OpenAI, Anthropic) endpoint.

**Via Web UI:**
Head to the **Providers** tab. Enter your `baseUrl` (e.g. `https://api.openai.com` or `http://localhost:11434`) and your `apiKey`. The Crypto Vault encrypts your key automatically.

**Via CLI:**
```bash
polar config set provider openai \
  --base-url "https://api.openai.com" \
  --api-key "$OPENAI_API_KEY" \
  --model-limits '{"gpt-4":{"maxTokens":8192}}'
```

#### B. Channels and Endpoints (Slack, Discord, Telegram)

Polar fully normalizes all inbound events into a canonical thread envelope.

**Via Web UI:**
Go to the **Channels** tab. Select your adapter type (Slack, Discord, Telegram), and enter your Bot Tokens, Webhooks, or Signing Secrets.

**Via CLI:**
```bash
polar config set channel telegram.main_bot \
  --bot-token "$TELEGRAM_BOT_TOKEN" \
  --webhook-url "https://your-domain.com/webhooks/telegram" \
  --enabled true
```

#### C. Installed Skills & MCP Connections

Polar's Extension Fabric handles tool projection and Model Context Protocol (MCP) integrations natively, enforcing strict policy checks prior to tool execution.

**Via Web UI:**
Under the **Extensions** tab, install a skill by pasting its Github URL/Manifest, or connect to an MCP server by providing its stdio/SSE target endpoint.

**Via CLI:**
```bash
polar config set extension mcp.local_file_system \
  --type "mcp" \
  --endpoint "stdio" \
  --command "npx" \
  --args='["-y", "@modelcontextprotocol/server-filesystem", "./data"]'
```

#### D. Configured Automations

Automations execute tasks unattended, governed by deterministic middleware and budget policies.

**Via Web UI:**
Use the **Automations** tab to set Cron triggers or Proactive heartbeat thresholds, binding them directly to your loaded profiles and capabilities.

**Via CLI:**
```bash
polar config set automation nightly_report \
  --trigger-type "cron" \
  --schedule "0 0 * * *" \
  --agent-profile-id "analyst_agent"
```

#### E. Agent Profiles, Fallbacks & Multi-Agent Handoffs

Polar is designed for specialized, multi-agent capabilities. You can define exact roles, pin specific LLM providers to specialized domains (e.g., Anthropic for writing tasks, Gemini for web-connected research), and tightly bound the allowed handoff behavior.

**Via Web UI:**
Navigate to the **Agent Profiles** tab. You can create specialized sub-agents, bind them to specific providers, attach pre-configured skills (like Web Search), and define which primary agent is allowed to route tasks to them.

**Via CLI:**
```bash
# Set a primary orchestrator (GPT-4)
polar config set profile primary_orchestrator \
  --provider-id "openai" \
  --model-id "gpt-4o" \
  --allowed-handoff-targets "research_subagent,writer_subagent" \
  --fallback-routing-id "error_handler_agent"

# Set a sub-agent (Anthropic Claude 3.5 Sonnet)
polar config set profile writer_subagent \
  --provider-id "anthropic" \
  --model-id "claude-3-5-sonnet-20241022" \
  --skills "markdown_formatter"
```

**Handoffs & Fallback Routing UX:**
By grouping formal handoffs into specific constraints, the primary orchestrator enforces strict boundary controls. Crucially, Polar allows associating a `fallbackRoutingId`. If an agent or task fails, rather than a raw dump of reasoning failing into an error string, the system can route the failure artifact natively to a "0-skills, zero-connection" vanilla fallback agent logic loop. This error-handling loop ensures users safely receive cohesive, context-aware explanations on why a task halted.

---

With these interactively configured constructs, Polar is equipped for massive multi-agent scaling with uncompromised zero-file security standards.