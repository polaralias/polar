# Polar ❄️

Polar is an advanced, deterministic, multi-agent AI framework designed for high-availability production environments. It strictly enforces contract-driven operations, structured observability, and non-bypassable security gateways.

---

## 🚀 Quick Start (Unified Platform)

Polar now features a unified startup process that boots both the **Operator Dashboard (Web UI)** and the **Chat Bot Runner** concurrently.

### 1. Installation
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file in the root directory:
```env
OPENAI_API_KEY=your_key_here
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### 3. Start Everything
```bash
npm run dev
```

*   **Operator Dashboard**: [http://localhost:5173](http://localhost:5173) (Manage budgets, providers, and view telemetry)
*   **Chat Bot**: Open your Telegram bot and start chatting.

---

## 🧠 Advanced Agent Capabilities (Phase 8+)

Polar core is equipped with advanced cognitive middle-ware that enhances LLM reliability:

### 1. Long-Term Durable Memory
*   **Automated Fact Extraction**: Polar automatically analyzes user turns to extract evergreen facts (preferences, project details, context) and persists them to a local SQLite store.
*   **Semantic Recall**: Before every generation turn, Polar proactively searches for relevant past facts and injects them into the provider context, providing agents with "infinite" memory across sessions.

### 2. Dynamic Tool Synthesis
*   **Tool Pruning**: For complex requests with large toolsets, Polar performs an internal "reasoning turn" to prune and rank required capabilities, significantly increasing accuracy and reducing context bloat.

### 3. Unified Governance & Budgets
*   **Hard-Blocking Policies**: Define global or workspace-level USD budgets. Once a budget is exceeded, the orchestrator will block further LLM requests until reset.
*   **Live Consumption Telemetry**: Monitor your real-time spend and token usage through premium dashboards in the Operator UI.

---

## 🏗 Architecture & Persistence

Polar uses a **Unified Control Plane** architecture:

*   **Shared Backend**: All state (Scheduler, Budgets, Memory) is persisted in a single, shared `polar-system.db` at the project root.
*   **Persistent SQLite Store**: No more in-memory data loss. Your configurations and agent memories survive restarts.
*   **Middleware-First**: All security, budget, and memory logic is implemented as non-bypassable middleware in the execution pipeline.

---

## 🛠 Management & Dashboard

The **Operator Dashboard** (`packages/polar-web-ui`) is your mission control:

*   **Providers**: Manage multi-provider routing (OpenAI, Anthropic, Gemini, Ollama).
*   **Agent Profiles**: Define specialized roles and model pinning.
*   **Governance**: Set hard USD limits and enforcement intervals.
*   **Telemetry**: Real-time visualization of agent activity and handoffs.

---

## 🧪 Testing

Maintain 100% confidence with the unified test suite:
```bash
npm test
```
The suite covers everything from contract validation to Phase 8 memory extraction logic.