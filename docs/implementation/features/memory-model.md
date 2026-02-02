# Memory Model

## Overview

Memory in Polar is not a free-form dumping ground for agent state. It is a **governed infrastructure service** provided by the runtime. All memory is structured, typed, and subject to strict access control and lifecycle management.

## Principles

1. **Runtime Ownership**: The runtime is the sole owner of memory state. Agents can only propose changes and query within their allowed scopes.
2. **Deterministic Retrieval**: Primary retrieval is keyword and metadata-driven. LLM-based retrieval (reranking/summarization) is secondary and operates only on filtered sets.
3. **Explicit Provenance**: Every memory item must be traceable back to its origin (e.g., a specific user message, tool call, or agent action).
4. **Visibility**: All memory is inspectable and deletable by the user through the control plane.
5. **Least Privilege**: Memory is scoped by subject, project, and purpose. Agents only see what they need to see.

## Memory Types

### 1. Profile Memory
*   **Purpose**: Stable user preferences and facts.
*   **Examples**: Timezone, preferred language, working hours, expertise levels.
*   **Lifetime**: Permanent (until user deletion).
*   **Scope**: Bound to a specific user.
*   **Sensitivity**: High. Requires explicit user consent for broad access.

### 2. Project Memory
*   **Purpose**: Contextual information tied to a specific project or long-running goal.
*   **Examples**: Project requirements, design decisions, architectural constraints.
*   **Lifetime**: Medium (duration of the project).
*   **Scope**: Bound to User + Project ID. Accessible by agents attached to the project.
*   **Sensitivity**: Moderate to High.

### 3. Session Memory
*   **Purpose**: Short-lived context for immediate tasks.
*   **Examples**: Temporary notes, intermediate summaries, task-specific variables.
*   **Lifetime**: Short (minutes to hours). Automatically expires after session inactivity.
*   **Scope**: Bound to User + Session ID.
*   **Sensitivity**: Low to Moderate.

### 4. Tool-Derived Memory
*   **Purpose**: Facts and structured data extracted from successful tool executions.
*   **Examples**: Data from a database query, results of a file scan, API response snippets.
*   **Lifetime**: Varies based on source (inherits from Session or Project).
*   **Scope**: Bound to User + Skill/Tool ID + Task context.
*   **Sensitivity**: Varies.

## Memory Structure (Schema)

All memory items must adhere to a core schema, extended by type-specific metadata.

```typescript
interface MemoryItem {
  id: string;              // Unique identifier (UUID/Ulid)
  type: MemoryType;        // profile | project | session | tool-derived
  subjectId: string;       // User ID
  scopeId: string;         // Project ID or Session ID
  
  content: Record<string, any>; // Structured data
  
  provenance: {
    agentId?: string;      // Agent that proposed the memory
    skillId?: string;      // Skill/Tool that generated the data
    sourceId: string;      // Message ID, Tool Call ID, or Event ID
    timestamp: string;     // ISO 8601
  };
  
  metadata: {
    tags: string[];
    sensitivity: SensitivityLevel; // low | moderate | high
    ttlSeconds?: number;   // Override for default TTL
    expiresAt?: string;    // Calculated expiration
  };
}
```

## Storage Semantics

*   **Immutability**: Once written, a `MemoryItem` is immutable. Updates are handled by deprecating/deleting the old item and proposing a new one.
*   **Encryption**: All memory is encrypted at rest using keys managed by the runtime.
*   **Audit**: Every write, read (high-level), and deletion is recorded in the audit log.
