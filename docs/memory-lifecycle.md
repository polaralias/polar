# Memory Lifecycle

This document describes the flow of data into and out of the Polar Memory System.

## The Write Path (Proposal-Based)

Agents and skills cannot write directly to memory storage. They must submit a `MemoryProposal` to the runtime.

### 1. Proposal Generation
An agent (or a worker/skill) constructs a `MemoryProposal`:
*   **Type**: Category of memory (profile, project, etc.)
*   **Target Scope**: The ID of the session or project.
*   **Content**: The structured data to be remembered.
*   **Provenance**: Reference to the trigger (e.g., `tool_call_id`).
*   **Sensitivity**: Hint provided by the agent.

### 2. Runtime Validation
The runtime intercepts the proposal and performs checks:
*   **Authorization**: Does this agent/skill have permission to write this type of memory to this scope?
*   **Integrity**: Is the content structured correctly?
*   **Safety**: Does it contain forbidden patterns (e.g., cleartext credentials)?
*   **Limits**: Does it exceed size or rate limits?

### 3. Optional Compaction/Refinement
If the runtime configuration requires it, the proposal may be sent to a "Compactor" (a specialized internal agent/worker):
*   **Canonicalization**: Merge with existing similar facts.
*   **Pruning**: Remove redundant or low-value information.
*   **Tagging**: Generate metadata tags for better retrieval.
*   **Embedding**: generate vector representations (if vector search is enabled).

### 4. Finalization and Persistence
The runtime:
1.  Assigns a unique `MemoryID`.
2.  Calculates `expiresAt` based on TTL rules.
3.  Writes the record to the encrypted store.
4.  Emits a `MEMORY_CREATED` audit event.

---

## The Retrieval Path (Query-Based)

Retrieval is deterministic and governed by policy. Agents do not have "total recall".

### 1. Query Issuance
An agent submits a `MemoryQuery`:
*   **Scope Filter**: Restricts search to specific Session or Project IDs.
*   **Type Filter**: Filters by memory types (e.g., "only profile and project").
*   **Attribute Filter**: (e.g., `tags: ['architecture']`).
*   **Query Text**: Optional semantic search string.

### 2. Enforcement and Filtering
The runtime:
1.  **Enforces ACLs**: Verifies the agent's read permissions for the requested scopes and types.
2.  **Applies TTL**: Filters out expired items.
3.  **Applies Sensitivity Masking**: If an item is "High Sensitivity", it may be redacted or summarized unless the agent has specific elevation.

### 3. Deterministic Selection
The runtime retrieves matching items using standard database queries (SQLite/IndexedDB). This ensures predictable performance and cost.

### 4. Optional LLM Reranking (Explicit)
If the query expects many results, the agent can request a rerank:
1.  Runtime retrieves the top $N$ matches deterministically.
2.  Runtime sends these $N$ items to a reranker model with the query.
3.  The model returns a prioritized/pruned list.
4.  The final result is returned to the agent.

---

## Expiration and Deletion

### Automatic Expiration (TTL)
*   A background job in the runtime periodically scans for items where `expiresAt < now`.
*   Expired items are deleted from the primary store.
*   A `MEMORY_EXPIRED` audit event is emitted.

### Explicit Deletion
*   Users can delete specific memory items via the UI.
*   Deletion is immediate and irreversible.
*   A `MEMORY_DELETED` audit event is emitted.

### Scope Cleanup
*   When a Session is closed or a Project is archived, all associated memory items are marked for immediate expiration.
