# AI Assistant Construction: Gap Analysis & Technical Approach

Last updated: 2026-02-25

## Bridging the Gap: How we build the Assistant without touching the Framework

Right now, `polar-control-plane` exposes strict, safe, executable APIs:
- `executeExtension` (runs a sandboxed tool)
- `resolveProfile` (gets an agent's configured LLM/system prompt)
- `generateOutput` / `streamOutput` (calls the LLM)
- `syncMcpServer` / `installSkill` (manages tools)

To build the AI Assistant with "OpenClaw Tool Gating", we can build a lightweight **Agent Runner** that listens to Discord, Telegram, Whatsapp, and Slack endpoints.

This Runner will simply act as a **Consumer** of the framework:

1. **The Orchestrator Loop**: We import `createPiAgentTurnAdapter` from `@polar/adapter-pi` into our new runner service (e.g. `polar-bot-runner`).
2. **Tool Execution**: When `pi-agent-core` wants to run a tool, the runner catches it. Instead of running it unsafely, it fires a call to the framework's `controlPlane.executeExtension()` API.
3. **The Gating (Human-in-the-loop)**: When the runner catches a sensitive tool call, it pauses the `pi-agent-core` loop, sends an interactive UI message (e.g. an Inline Keyboard Button on Telegram or Message Component in Discord) back to the user, and waits for them to click "Approve" before passing the execution to the framework.

### Why this approach is ideal:
- **Zero Framework Bloat**: `polar-runtime-core` remains a pure, stateless enforcement engine. It doesn't need to know what a "chat loop" or "Discord webhook" is.
- **Native Chat Experience**: You get to use the high-quality, existing interfaces of Telegram, Discord, and Slack, including their native push notifications and mobile apps.
- **True Separation of Concerns**: The framework is the engine. The bots are the UI.

---

## Technical Gap Analysis: What actually needs to be built?

To get the local-hosted, multi-agent platform running over external messaging apps, we only need to build the "Runner / Bot" layer:

### 1. Ingress Webhooks (The Endpoints)
* **Gap:** The framework has parsers for Slack, Telegram, and Discord payloads, but no actual HTTP server listening for their webhooks.
* **Action:** Boot up a runner server (e.g., `packages/polar-bot-runner`) with Express/Fastify routes like `/api/webhooks/telegram` to receive messages and pipe them to the `createPiAgentTurnAdapter` loop.
* **Status:** ✅ **Completed** (Implemented natively via Telegraf interacting closely with `controlPlane.generateOutput` and `controlPlane.appendMessage`)

### 2. Native File & Multimodal Handling
* **Gap:** Right now, the core framework handles text. To support native UX like PDF and image uploads, we need to bridge the gap to LLM capabilities.
* **Action:** LLM APIs *do* natively support multimodal vision (sending base64 image strings attached to the prompt). For documents (PDF), the standard pattern is *actually* to use lightweight local parsers (like `pdf-parse`) because shoving raw binary/base64 PDFs into LLMs is often wildly expensive and prone to hallucination/truncation. We will pipe Telegram media downloads into a local processing step that attaches images natively to the LLM context, and extracts text locally for documents *before* sending them to the LLM. 
* **Status:** ✅ **Completed** (`pdf-parse` and Base64 buffer loading fully mapped inside Telegram runner logic)

### 3. Progressive Emoji UX (System State & User Feedback)
* **Gap:** The bot needs a silent, non-jarring way to communicate state, and the user needs a way to score responses without cluttering the chat with command words.
* **Action:** 
    * **System State:** The bot will react to your incoming message with a ⏳ emoji when it receives the payload. It will swap it to a 🔄 when parsing tools/working, a ✅ when done, or a ❌ if the LLM loop completely crashes.
    * **User Feedback (REACTIONS.md):** The bot will listen for Telegram `message_reaction` webhook updates. If you react with a 👍 or 💯 to an LLM response, the bot will append that LLM message to a persistent `REACTIONS.md` memory log (like a dataset of "good behavior" to fine-tune its future system prompt). We'll add a staleness function to trim old entries later.
* **Status:** ✅ **Completed** (Telegram UI reactions bound and `REACTIONS.md` loop implemented)

### 4. Stateful Tool-Gating & Replay Resumption
* **Gap:** A paused LLM tool-call execution currently blocks the loop indefinitely unless acted upon or dropped.
* **Action:** Instead of pausing the active websocket loop indefinitely and draining resources, when a tool requires approval, the bot runner will *suspend* the orchestration state into the Framework's durable SQLite Task Scheduler. It will send you a Telegram message with buttons representing the execution UUID. You can come back hours or days later, tap "Approve" (or reply to the tool message), and the bot will rehydrate the orchestration state from SQLite and resume execution identically. This prevents in-memory memory bloat.
* **Status:** ✅ **Completed** (Deterministic inline button workflow interception is mapped natively; `controlPlane.executeExtension` backend executes payload upon user UI confirmation via standard regex state unwrapping)

### 5. Default Agent Bootstrapping 
* **Gap:** The framework config is empty by default.
* **Action:** Set up a bootstrapping routine to load a default `@Primary` agent profile, configure the Telegraf bot, and sync your MCP shell servers into the `polar-control-plane` so the bot can actually work on your laptop.
* **Status:** ✅ **Completed** (Multi-Agent Orchestration loop is injected into `polar-bot-runner` with deterministic rules allowing the Primary orchestrator to hand off execution directly to specific pre-defined AI roles using `MULTI_AGENT_CONFIG` mapping and `<polar_workflow>` delegation payloads)

---

## Context and Memory Pipeline (Current State)

We have explicitly partitioned how context is handled over long-term and short-term lifecycles.

### 1. Sliding Windows & Retention Policies (Short-Term Memory) ✅ Completed
The bot runner applies a strict sliding window truncating history dynamically. It uses the runtime's default context limit (usually 20 messages) but fetches a slightly deeper pool (up to 500) so it can specifically grab the *freshest* messages off the end of the history array. Furthermore, the `applySessionRetentionPolicy()` gateway evaluates your history on every interaction, forcefully deleting/archiving underlying DB messages that age past your configured `retentionDays` threshold. 

### 2. Semantic Compaction & Vector Recall (Long-Term Memory) ❌ Pending
* **Compaction**: The `memory.compact` contract is in place along with a "Compact Memory" UI workflow, but the background summarizer loop hasn't been implemented. Currently, old messages are simply permanently dropped rather than intelligently compacted using a fast model (like `gpt-4o-mini`).
* **Vector Recall**: We aren't dynamically running a `memory.search` on inbound prompts in the bot runner to inject long-term vector/summary memory just yet. 

### 3. Native File Threading vs. Inline Snippets (Thread Branching) 🏗️ Implemented 
Rather than relying on LLM semantic intent detection (burning tokens to "guess" if your message is a new thread), we leverage explicit UI indicators from messaging apps (like Telegram):
* **Native Thread Isolation:** When you start a true Topic/Thread in the messaging app (`message_thread_id`), the platform maps this to an isolated `sessionId` internally. All interactions in this forum stay locked to their own sliding window stack. 
* **Inline Snippet Injection:** For standard replies (`reply_to_message`), we *do not* fork the session (doing so would wipe the active context history). Instead, the bot stays in the main chat room and manually parses out the replied-to text. It injects a semantic block into the actual text prompt sent to the LLM (e.g., `[In reply to Bot/Sub-Agent: "Here is your workflow..."]`). The LLM sees precisely what you are referencing, but natively retains the chat's sliding window context block simultaneously.