# Audit Report: Prompt-Driven Logic in Polar

## A) Executive Summary
This audit evaluated the `polar` repository for "prompt-driven logic"—system behaviors and product rules implemented via LLM instructions rather than deterministic code. 

The investigation identified **7 major instances** of prompt-driven logic. The most critical risks reside in the **Primary Orchestrator**, which delegates state management, tool selection, and even cross-agent permissioning to the model. While the system uses "routing hints" in code, the actual state machine is hosted in a `<thread_state>` block that the LLM is expected to maintain and return.

### Severity Breakdown
- **Critical (1)**: Security/Tool-gating decided by the model.
- **High (3)**: Routing, state machine, and workflow sequencing owned by prompts.
- **Medium (2)**: Delegation triggers and sub-agent task scoping.
- **Low (1)**: UI/UX behavior rules (inline replies).

### Top 5 Highest-Risk Offenders
1. **Tool Permission Forwarding** (`orchestrator.mjs`): The model decides which tools a sub-agent is "allowed" to use. Bypassing this is trivial via prompt injection.
2. **Thread State Machine** (`orchestrator.mjs`): The LLM manages `activeThreadId` and `status`. Model failure leads to "zombie" threads or hijacked context.
3. **Deterministic Workflow Proposal** (`orchestrator.mjs`): The model chooses the sequence of tools. Lack of a code-owned "Plan Validator" means the model can propose unauthorized or dangerous tool sequences.
4. **Handoff Logic** (`orchestrator.mjs`): The decision to delegate to `@writer_agent` vs `@research_agent` is entirely instruction-based, making it unpredictable for the end-user.
5. **UI Logic (Inline Replies)** (`orchestrator.mjs`): The decision to show a specific UI affordance is controlled by a boolean the model is "told" to set true/false.

---

## B) Findings Table

| ID | File + Line Range | Prompt Excerpt | Behavior Controlled | Risk | Current Enforcement | Recommended Owner | Fix Approach |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **P-01** | `orchestrator.mjs:177-192` | `Output your internal state updates... <thread_state>` | Thread lifecycle (`status`), intent mapping, active thread selection. | **High**: State corruption if model halts or hallucirates JSON. | Minimal: `JSON.parse` at line 250 with generic catch. | `RoutingPolicyEngine` | 1. Use code-side classifier for intent. 2. Implement state machine in `RoutingPolicyEngine`. |
| **P-02** | `orchestrator.mjs:150` | `"forward_skills": ["email_mcp", "search_web"]` | Security: Defining tool permissions for sub-agents. | **Critical**: Model can give itself unauthorized tool access. | None: The code trusts the `forward_skills` array. | `ExtensionGateway` / `ProfileResolution` | 1. Map `agentId` to a hardcoded `capabilityScope` in profile config. 2. Validate `forward_skills` against policy. |
| **P-03** | `orchestrator.mjs:155-163` | `<polar_workflow>... sequence of JSON step objects` | Workflow Control: Sequence and selection of tools/MCP servers. | **High**: Logic is fragile; model can skip steps or use invalid tools. | `extensionGateway.execute` checks if tool exists, but not if it's "right" for the step. | `WorkflowEngine` (New service) | 1. Define structured "Task Templates" in code. 2. Model selects template ID; code populates steps. |
| **P-04** | `orchestrator.mjs:190` | `"useInlineReply": boolean // Set to true ONLY if...` | UI Behavior: Deciding if a message should be an inline reply. | **Low**: Affects UX consistency. | None: Blindly trusted. | `ChatManagementGateway` | 1. Determine `useInlineReply` based on `activeThreadId` vs `sessionId` depth in code. |
| **P-05** | `orchestrator.mjs:132-153` | `If user asks for complex flows... YOU MUST DELEGATE` | Product Strategy: When to use sub-agents vs native handling. | **Med**: Unpredictable performance/cost. | None: Entirely instruction-based. | `RoutingPolicyEngine` | 1. Use a small, deterministic classifier (Regex or lightweight classifier) to trigger delegation. |
| **P-06** | `orchestrator.mjs:148` | `"model_override": "gpt-4.1-mini" // Pick smartest model` | Cost/State: Model choosing its own upgrade path. | **Med**: Potential for uncontrolled cost if model picks expensive ones. | `multiAgentConfig.allowlistedModels` (soft check). | `ModelPolicyEngine` | 1. Hard-bind models to `agentId` in `profileConfig`. 2. Don't let orchestrator override. |
| **P-07** | `chat.js:144-150` | `You have the ability to propose... <polar_workflow>` | UI/State: Redundant workflow logic defined in frontend view code. | **High**: Duplication of logic between client and server. | Frontend parsing. | `Orchestrator` (Backend) | 1. Remove prompt construction from `chat.js`. 2. Unified orchestrator should own systemic prompt. |

---

## C) Remediation Plan

### Phase 0: Quick Wins (The "UX & Logic Cleanup")
- **P-04 (Inline Replies)**: Move the `useInlineReply` logic to a utility function in `orchestrator.mjs`. If the number of active threads > 1, set to `true`. Stop asking the LLM to decide this.
- **P-07 (Frontend Duplication)**: Remove prompt assembly from `chat.js`. Ensure the backend Orchestrator is the single source of truth for "core instructions."

### Phase 1: Core Correctness (Routing & Security)
- **P-01 (Thread State)**: Implement a basic state machine in `RoutingPolicyEngine`. The orchestrator should pass the user text to a `classifier` (which can be a model call, but structured), and the code should then update the `SESSION_THREADS` map based on the classification (`NEW_REQUEST`, `UPDATE`, `ANSWER`).
- **P-02 (Security)**: Update `profileResolutionGateway` to include `allowedCapabilities` for every sub-agent ID. In `orchestrator.executeWorkflow`, reject any `delegate_to_agent` call where `forward_skills` includes tools not in the sub-agent's profile allowlist.

### Phase 2: Refactor + Tests
- **P-03 (Workflows)**: Introduce "Protocol Templates." Instead of the model inventing JSON steps, it should say `execute: summarize_inbox`. The code then expands `summarize_inbox` into the exact MCP tool calls required.
- **P-05 (Delegation Triggers)**: Move delegation rules into the `RoutingPolicyEngine`. If the classifier returns `DOMAIN: research`, the engine automatically selects the `@research_agent` route.

---

## D) Tests to Add

### 1. Security: Tool Gating Test
- **Test**: Attempt to call `delegate_to_agent` with `forward_skills: ["admin_exec"]` when the agent profile only allows `["read_only"]`.
- **Expected**: `Orchestrator` should strip unauthorized skills or reject the workflow before execution.

### 2. State: Thread Hijack Prevention
- **Test**: Send two unrelated messages in rapid succession.
- **Expected**: `RoutingPolicyEngine` should deterministically create two threads or merge based on content similarity score, NOT based on the LLM's returned JSON state.

### 3. UX: Inline Reply Determinism
- **Test**: Reply to a thread that is not the `activeThreadId`.
- **Expected**: `useInlineReply` should be `true` based on the message metadata, regardless of model output.

### 4. Workflow: JSON Corruption Fallback
- **Test**: Model returns invalid `<polar_workflow>` (e.g., trailing comma).
- **Expected**: The system should gracefully fail back to a standard text response and NOT crash the orchestrator loop.
