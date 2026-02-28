# Deterministic Orchestration Architecture
Last updated: 2026-02-27

## Purpose
This document describes the intended end state for Polar’s chat orchestration: **models propose, code decides**. The assistant should feel human in chat (correct context, minimal inline replies, clean reactions), while ensuring security, workflow correctness, and tool permissions are enforced deterministically in code.

This is a “boundary” doc: it defines what belongs in **code** vs what may remain in **prompts**.

---

## Non-negotiable principles

### 1) Model can propose. Code must decide.
The LLM may:
- Suggest an interpretation (intent, slots, thread attachment)
- Suggest a workflow template and arguments
- Write natural language responses and summaries

The platform must enforce, in code:
- Message routing / thread attachment
- State transitions
- Tool and capability permissions
- Workflow step construction and execution
- Model selection/budget constraints
- Error visibility (failures must not be “summarised away”)

### 2) Prompts are advisory, policies are executable
If the model can ignore a rule and the system breaks, the rule belongs in code.

### 3) Thin clients, thick orchestrator
Clients (web/Telegram/etc.) must never run orchestration logic. They send user input + metadata; the backend orchestrates.

---

## Target user experience

### Context anchoring
- Immediate replies continue the conversation without quoting.
- Inline reply/quoting is used sparingly, only to “repair” ambiguity (replying to older messages or when multiple active topics exist).

### Status nudges
Messages like “any luck?”, “update?”, “?” attach to the most recent in-progress request and return progress/retry, not a fresh clarification.

### Steering overrides
Messages like “actually”, “ignore that”, “stop”, “instead” override the current in-flight context even if a pending question exists.

### Clean reactions
- “Working” reactions may persist during in-flight work.
- “Done” reactions are removed once the next user message arrives, but **only** for flows that are actually completed (not for approvals/pending states).

---

## System overview

### High-level components
1) **Client (Web/Telegram)**
   - Sends: `{ sessionId, userId, text, messageId, replyTo?, channelMetadata }`
   - Displays: assistant messages, workflow cards, tool result summaries (if enabled)

2) **Orchestrator (backend)**
   - Owns: prompts, routing, workflow creation, approvals, execution
   - Maintains per-session state (threads, pending questions, in-flight actions)
   - Produces deterministic “execution header” + model narrative

3) **RoutingPolicyEngine**
   - Deterministically classifies and attaches user turns to the correct micro-thread.

4) **WorkflowEngine + Templates**
   - Converts model suggestions into executable, validated steps.
   - Prevents arbitrary tool chains.

5) **CapabilityScope + Policy Enforcement**
   - Enforces tool allowlists, delegated skill forwarding, and any domain/constraint guards.

6) **ExtensionGateway**
   - Executes tool calls with policy evaluation based on capability scope.

7) **ProviderGateway**
   - Calls LLM providers for “proposal” and “narrative” phases.

---

## Canonical message contract
All channels map to one canonical input shape:

- `sessionId` (stable per chat)
- `userId`
- `text`
- `messageId` (client generated)
- `replyToMessageId` (optional, if the channel supports it)
- `channel` + `channelMetadata`

**Important:** session identity must not be partitioned by reply/thread IDs. Reply metadata is used for anchoring, not for splitting conversation history.

---

## Conversation state model

### Micro-threads (no UI threads required)
A session contains multiple “micro-threads”, each representing a topic/request:

- `threadId`
- `intent` (eg `weather_lookup`, `draft_email`)
- `slots` (intent-specific key/values)
- `status` (`waiting_for_user | in_progress | blocked | workflow_proposed | done | failed`)
- `pendingQuestion` (optional: `{ key, expectedType, askedAtMessageId }`)
- `lastActivityAt`
- `summary` (1–3 lines)

The orchestrator tracks:
- `activeThreadId`
- optionally `queuedThreadIds`

### Status meaning
- `waiting_for_user`: we asked a question; expecting an answer (slot fill).
- `in_progress`: tool/workflow running.
- `blocked`: cannot proceed without permission or missing info.
- `workflow_proposed`: approval required (not “done”).
- `done` / `failed`: terminal.

---

## Deterministic routing

### Routing categories
Each user turn is classified into one of:

- `override` (steering)
- `answer_to_pending` (slot fill)
- `status_nudge` (progress check)
- `new_request` (new intent)
- `filler` (non-mutating)

### Priority rules (enforced in code)
1) **Override** beats everything
   - “actually”, “ignore”, “stop”, “instead”, “scrap that”, etc.

2) **Answer to pending** only if it fits
   - Pending question carries an `expectedType` (location, yes/no, date/time, freeform).
   - The engine does a lightweight fit check before attaching.

3) **Status nudge** attaches to the most recent `in_progress` / `blocked` thread
   - “any luck?”, “update?”, “?”, “hello?”

4) **New request** creates a new thread
   - The system may queue or switch active thread depending on UX policy.

5) **Filler** attaches to active thread without mutation.

### Anchor selection (inline replies)
Default is **no inline reply**.
Use inline reply only when:
- responding to a non-recent message, or
- multiple threads are active and ambiguity is likely, or
- performing “repair” after a topic switch.

---

## Workflow creation and execution

### Template-first workflows (no arbitrary tool chains)
The model does not define steps. It suggests one of:
- A plain response (no tools)
- A template invocation, eg:

```json
{ "template": "lookup_weather", "args": { "location": "Swansea" } }
```

The **WorkflowEngine**:
1) Parses the proposal
2) Validates args with strict schema
3) Expands into a fixed step sequence
4) Validates each step against policy (capability scope)
5) Executes via ExtensionGateway

### Approval states
When a workflow is sensitive or multi-step, the orchestrator returns `workflow_proposed` with a human-readable plan and explicit approve/reject actions. This is a **blocked** state, not completion.

---

## Capability scopes and permission enforcement

### Forwarded skills (`forward_skills`) are untrusted input
Any LLM-proposed list is treated as a *request*, not authority.

Enforcement requirements:
- Server-owned allowlists (primary orchestrator + each sub-agent profile)
- Intersection of requested skills with allowlist
- Rejected items logged
- If none allowed, delegation is blocked or delegated with no tools (safer default is block)

### CapabilityScope structure
Capability scope must be expressive enough to enforce:
- allowed extension IDs
- allowed capability IDs per extension
- optional constraints (eg allowed domains/paths)

Example:

```json
{
  "allowed": {
    "web": ["search_web", "open_url"],
    "email": ["draft_email"]
  },
  "constraints": {
    "web": { "domainsAllowlist": ["*.gov.uk", "*.nhs.uk"] }
  }
}
```

### Policy evaluation
Every tool execution passes through:
- `policy.evaluateExecution(input, currentState)`
- `capabilityScope` is required and must never be `{}` by default.

---

## Error visibility and “truthfulness”
Before any LLM narrative summary, the system renders a deterministic execution header:

- steps executed
- per-step status (success/failure)
- surfaced errors (safely truncated)

The narrative summary may explain and propose next steps, but cannot hide failures because the header is always included.

---

## What belongs in prompts vs code

### Prompts may control
- Tone, style, structure of written responses
- Optional suggestions (intent/slot guesses, template choice)
- Narrative explanations and user-facing plans

### Prompts must not control
- Routing/attachment decisions
- State transitions
- Workflow step construction
- Tool allowlists/permissions
- Delegation permissions (`forward_skills`)
- Model selection/budget caps
- Error visibility

---

## Testing requirements (minimum)
Add/maintain tests that verify deterministic behaviour:

1) Routing
- “Any luck?” attaches to last `in_progress` thread even if another thread has a pending question
- Override beats pending question
- Slot fill only when it fits expected type

2) Delegation scope
- Disallowed `forward_skills` are stripped and logged
- Sub-agent prompt never grants non-allowlisted tools

3) Workflow templates
- Unknown template rejected
- Invalid args rejected before execution

4) UI
- Chat does not call any local `generateOutput` orchestration loop
- Only uses backend orchestration endpoints

---

## Migration plan (recommended order)
1) Remove client-side orchestration (P-07)
2) Enforce `forward_skills` + model override clamping (P-02 / cost policy)
3) Deterministic RoutingPolicyEngine becomes authoritative (P-01)
4) Workflow templates replace arbitrary workflows (P-03)
5) CapabilityScope fully wired into ExtensionGateway policy
6) Deterministic execution header for error visibility (P-08)

---

## Cross-references
- Chat routing and multi-agent design (existing doc): `docs/architecture/chat-routing-and-multi-agent.md`
- Tooling contract and middleware: `docs/architecture/tooling-contract-middleware.md`
- Web UI and chat management: `docs/product/web-ui-and-chat-management.md`

