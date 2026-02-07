# Phase 2 - Stage 3: Proactive Automation

## Goal
Move beyond "User acts, Assistant reacts" to "Assistant acts on Trigger". Enable the system to handle events and execute pre-approved workflows via **Automation Envelopes**.

## Implementation Status (as of February 7, 2026)
**Status**: Complete

## 1. Automation Envelopes & Hooks
Define the `AutomationEnvelope` structure. This describes a persisted automation rule.

*   **Trigger**: The event source (e.g., `gmail.new_message`, `cron.daily`).
*   **Action**: Which Skill/Template to run.
*   **Scope**: User/Session/Project binding.
*   **Tier**: The required autonomy level (0-3).
*   **Rate Limit**: Max execution frequency (e.g., "Once per hour").

## 2. Event Store & Ingestion
Implement a mechanism to ingest and store events.

*   **Structure**: `id`, `source`, `type`, `payload`, `timestamp`.
*   **Ingestion**: 
    *   **Webhook Receiver**: For push-based sources (Gmail Pub/Sub).
    *   **Poller**: For pull-based sources (Calendar).
*   **Deduplication**: Processing logic must ensure exactly-once handling.
*   **Batching**: Group notifications to prevent spam (e.g., "5 new emails" vs 5 notifications).

## 3. Proactive Tiers
Implement the enforcement logic for autonomy.

*   **Tier 0 (Informational)**: Notification Only. No side effects.
*   **Tier 1 (Intent Completion)**: "Raincheck this". User gives intent, system finishes.
*   **Tier 2 (Delegated)**: System proposes, User approves via reaction/reply.
    *   *Default for writes.*
    *   **Intent Classifier Sub-Agent**: A specialized, low-cost (e.g., GPT-4o-mini, Gemini Flash) isolate pass.
        *   **Role**: Analyzes user replies (e.g., "ok", "sounds good") to determine if they constitute *valid approval* for the specific pending proposal.
        *   **Context**: Limited to the proposal summary and the user's latest reply. DOES NOT see full conversation history to minimize prompt injection risks and cost.
*   **Tier 3 (Autonomous)**: Fully automatic within envelope constraints.
    *   *Requires explicit opt-in.*

## 4. Chat-Driven Setup
Allow users to configure automations via natural language.

*   **Flow**:
    1.  User: "Notify me when Alex emails."
    2.  Agent: Identifies intent, proposes `AutomationEnvelope` config.
    3.  Agent: Shows summary ("I will check Gmail for 'from:Alex' and notify you on Tier 0").
    4.  User: "Confirm."
    5.  Runtime: Persists envelope and logs audit event.

## 5. UI: Notification & Approval
*   **Event Log**: See what triggered an automation.
*   **Proposal Stream**: Feed of items waiting for Tier 2 approval.
*   **Controls**: Approve, Reject, or Modify proposals.
*   **Active Automations**: List all running envelopes with ability to pause/delete.

## Acceptance Criteria
- [x] Event ingestion pipeline works and deduplicates events.
- [x] Automation Envelope can be defined, persisted, and retrieved.
- [x] Tier 0 trigger sends a batched notification.
- [x] Tier 2 trigger creates a proposal requiring distinct user action.
- [x] Tier 3 trigger executes immediately (and is audited).
- [x] Chat-driven setup flow works: User request -> Config Proposal -> Active Automation.

## Pending Implementation Gaps (as of February 7, 2026)
- No blocking gaps remain for Stage 3 acceptance.
- Tier 0 notifications are batched and delivered as grouped user-facing summaries.
- Chat-native automation setup now supports proposal and explicit confirm/cancel activation flow.
- Event ingestion dedupe state persists across restarts via runtime event history storage.
