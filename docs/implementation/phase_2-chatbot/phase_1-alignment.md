# Phase 2 Alignment Notes

> **Updated:** 2026-02-02
> **Purpose:** Document alignment between Phase 1 implementation and Phase 2 documentation

## Phase 1 Foundations That Phase 2 Inherits

The following Phase 1 implementations provide the foundation for Phase 2 features:

### Security Infrastructure
- **Capability Tokens**: `@polar/core` provides `mintCapabilityToken`, `verifyCapabilityToken`
- **Policy Evaluation**: `evaluatePolicy` with structured constraints
- **Revocation**: Immediate via policy version + introspection
- **Audit Chaining**: SHA-256 hash-chained append-only logs

### Agent Management
- **Agent Spawning**: `spawnAgent` with depth tracking (`spawnDepth`, `parentAgentId`)
- **Role Constraints**: `getRoleCapabilities()` limits what each role can do:
  - `main`: Can spawn, access memory, coordinate
  - `coordinator`: Can spawn, access memory, coordinate
  - `worker`: Cannot spawn, cannot access memory, cannot coordinate
  - `external`: Cannot spawn, cannot access memory, cannot coordinate
- **Limits**: `maxAgentSpawnDepth` (default: 5), `maxAgentsPerSession` (default: 20)

### Memory System
- **Size Limits**: 64KB per memory item (`maxMemoryContentSize`)
- **Encryption**: AES-256-GCM at rest
- **Provenance**: Full tracking of agentId, skillId, sourceId

### Session Management
- **Termination**: `POST /sessions/:id/terminate` terminates session and all agents
- **Listing**: `GET /sessions` with status filter

### Audit
- **Export**: `GET /audit/export` with JSON, NDJSON, CSV formats
- **Redaction**: `POST /audit/:id/redact` with tombstone pattern

---

## Phase 2 Stage-by-Stage Cross-Reference

### Stage 1: Skills & Templates
**Phase 1 Provides:**
- `SkillManifestSchema` with `requestedCapabilities`
- `installerService.ts` with hash verification
- `skillStore.ts` with install/uninstall/update
- Permission diff calculation (`calculatePermissionDiff`)

**Phase 2 Adds:**
- `polar.skill.json` structured constraints
- `SKILL.md` instruction parsing
- Full-archive (manifest + assets) signature verification

### Stage 2: Connectors
**Phase 1 Provides:**
- Gateway enforcement infrastructure
- Tool call introspection
- Rate limiting framework

**Phase 2 Adds:**
- **Egress Control** (HTTP host allowlists) — **CRITICAL GAP FROM PHASE 1**
- Credential injection at Gateway level
- Human approval gates

### Stage 7: Ecosystem Hardening
**Phase 1 Already Implemented:**
- ✅ Skill bundle hashing (SHA-256)
- ✅ Emergency mode (`POST /system/emergency`)
- ✅ Permission diff on update
- ✅ Skill uninstall (`DELETE /skills/:id`)
- ✅ Audit export

**Phase 2 Adds:**
- TOCTOU protection (verify hash on load, not just install)
- Previous version bundle storage for rollback
- Signed-only policy mode

### Stage 10: A2A Interoperability
**Phase 1 Provides:**
- `spawnAgent` with `parentAgentId` tracking
- `maxAgentSpawnDepth` limit (default: 5)
- `ExtendedAgent` type with spawn hierarchy
- Role-based spawn restrictions (workers cannot spawn)
- `proposeCoordination` with initiator capability check

**Phase 2 Adds:**
- `worker.spawn` tool definition for Main Agent
- Worker lifecycle manager
- Nested UI rendering for worker actions

---

## Configuration Reference

Phase 2 can rely on these Phase 1 configuration options:

| Config | Default | Env Var | Description |
|--------|---------|---------|-------------|
| `maxMemoryContentSize` | 64KB | `MAX_MEMORY_CONTENT_SIZE` | Memory proposal limit |
| `maxAgentSpawnDepth` | 5 | `MAX_AGENT_SPAWN_DEPTH` | Recursive spawn limit |
| `maxAgentsPerSession` | 20 | `MAX_AGENTS_PER_SESSION` | Active agents per session |
| `capabilityTtlSeconds` | 120 | `CAPABILITY_TTL` | Capability token lifetime |
| `rateLimitMaxRequests` | 100 | `RATE_LIMIT_MAX` | Requests per minute |

---

## APIs Available for Phase 2

### Runtime Endpoints
- `POST /sessions/:id/agents` — Spawn agent
- `POST /sessions/:id/terminate` — Terminate session
- `GET /sessions` — List sessions
- `DELETE /skills/:id` — Uninstall skill
- `GET /audit/export` — Export audit logs
- `POST /system/emergency` — Toggle emergency mode

### Core Functions
- `spawnAgent({ role, sessionId, userId, parentAgentId })` — With depth tracking
- `terminateAgent(id, reason)` — With audit
- `getRoleCapabilities(role)` — Get role's allowed actions
- `proposeMemory(proposal, subjectId, agentId, skillId)` — With size limits

---

## Critical Gaps for Phase 2 to Address

1. **Egress Control** — Must be implemented in Phase 2 Stage 2
2. **Skill Rollback** — Keep previous version bundles
3. **TOCTOU Protection** — Verify skill hash on every load
4. **Installer Sandbox** — Isolate skill installation process
