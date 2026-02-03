# Phase 3 Implementation Plan: Integrations & Skill Packs

## Overview
Phase 3 focuses on **"Make the assistant observable, interruptible, and usable in real conversations"**. This phase expands the system from a secure runtime into a connected ecosystem with real-world integrations, multi-channel support, and advanced observability (Logger Chat).

---

## 1. Core Integration Foundations

### 1.1 Secure OAuth & Connector Pattern
*   **Goal**: Establish the standard for authenticated external services.
*   **Scope**:
    *   Implement generic **OAuth2 Authorization Code flow** in Gateway.
    *   Secure storage for **Refresh Tokens** in Runtime (using `secretsService`).
    *   Standardized **Connector Interface** for all external services (Slack, Google, GitHub, etc.).

### 1.2 Tool Identification & Ambiguity Resolution
*   **Goal**: Solve the "Which Notion?" problem.
*   **Scope**:
    *   **Stable IDs**: Every connector instance gets a UUID.
    *   **Semantic Tags**: `work`, `personal`, `dev`.
    *   **Intent Middleware**: Orchestrator explicitly checks for ambiguity before execution.
    *   **Clarification Loop**: If ambiguous, the bot asks: "Did you mean your Personal Notion or Work Notion?"

---

## 2. Channel & Observability Expansion

### 2.1 Finalize Channel Adapters
*   **Slack**: Move from stub to real **Socket Mode** implementation (chat-only surface).
    *   Inbound: Events API / Socket Mode.
    *   Outbound: Web API `chat.postMessage`.
    *   Pairing: Implement slash command `/pair <code>` verification.
*   **Telegram**: Polish existing adapter (ensure stability).
*   **WhatsApp**: (Deferred to late Phase 3 / Phase 4 - low priority).

### 2.2 Logger Chat (The "Meta-Channel")
*   **Concept**: A special chat interface that acts as a **human-readable audit stream**.
*   **Features**:
    *   **Live Stream**: Structured logs appear as chat messages (e.g., "🛠️ *GitHub Skill* verified connectivity").
    *   **Intervention**: User can reply "Stop" to kill an active process.
    *   **Explanation**: User can ask "Why did that fail?" (uses Runtime Context).

---

## 3. First-Party Skill Packs

Curated, high-quality integrations that set the standard for third-party developers.

### 3.1 Google Workspace Pack (OAuth)
*   **Gmail**: Read recent emails, draft replies (no auto-send without approval).
*   **Calendar**: Read availability, schedule events.

### 3.2 Productivity Pack
*   **ClickUp/Linear/Jira**: Create tasks, read status.
*   **Notion**: Read pages, append notes.

### 3.3 System/IoT Pack
*   **Home Assistant**: Read sensor state, toggle scenes.

---

## 4. Phase 3 Execution Checkpoints

### Checkpoint 3.1: Connection Foundations (Current Focus)
*   [ ] Implement Connector Registry (manage active connections).
*   [ ] Build OAuth2 Token Manager (refresh/storage).
*   [ ] Define "Connection Profile" schema (name, tags, scopes).

### Checkpoint 3.2: Logger Chat & Observability
*   [ ] Create `LoggerService` that outputs to a virtual channel.
*   [ ] Implement "Stop/Kill" command intervention.
*   [ ] Wire Audit Log → Logger Chat.

### Checkpoint 3.3: Slack & Google Integration
*   [ ] "True" Slack Adapter (Socket Mode).
*   [ ] Gmail/Calendar Connector (OAuth).

### Checkpoint 3.4: Group Context
*   [ ] Update Orchestrator to handle multi-party context.
*   [ ] Implement "Mention-Only" activation policy.

---
