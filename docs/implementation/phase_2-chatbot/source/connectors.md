# Polar Assistant: Connectors and Integrations

Connectors are **typed tool surfaces** exposed by the gateway. They are the preferred way to build integrations. Skills and agents never call third-party APIs directly.

## Goals
- Reliability: strict schemas and predictable outputs
- Security: capability enforcement at the gateway
- Portability: same semantics across local and cloud deployments

## Connector model
A connector provides a set of tools. Each tool has:
- request schema (validated)
- response schema (validated)
- enforcement middleware:
  - capability validation (signature + optional introspection)
  - resource constraints (ids, paths, domains)
  - field filtering (strip disallowed fields)
  - rate limiting
  - output size limits
- audit emission

## Credentials
- Stored in runtime secrets store.
- Never exposed to agents.
- Prefer: gateway requests short-lived access tokens from runtime if needed.
- Capability tokens never contain secrets.

## Fine-grained permissions
Upstream APIs are often coarse (OAuth scopes). Polar provides fine-grained controls by enforcing constraints in the gateway:
- allow/deny specific resources (calendar IDs, labels, folders)
- limit queries (time window, max results)
- strip sensitive fields (email body, attachments, attendees)
- deny patterns (never read “Personal” calendar)

## Recommended initial connector set
### Filesystem
- `fs.list_dir`
- `fs.read_file`
- `fs.write_file` (optional, confirm-first)
Constraints:
- root allowlist, path allowlist/denylist, size caps

### HTTP
- `http.get`
- `http.post`
Constraints:
- egress allowlist (domains), method allowlist, header allowlist, size/time caps

### Google Calendar (example)
- `gcal.list_calendars`
- `gcal.list_events`
- `gcal.create_event`
Constraints:
- permitted calendarIds only
- time window max (eg 90 days)
- field allowlist (eg title/time only)

### Gmail (example)
- `gmail.search_threads`
- `gmail.get_thread` (field-filtered)
- `gmail.send` (confirm-first)
Constraints:
- label allowlist/denylist
- block exporting full message bodies unless explicitly allowed
- attachments require explicit permission and quarantine

### GitHub (example)
- `github.list_issues`
- `github.get_issue`
- `github.create_comment` (confirm-first)
Constraints:
- repo allowlist, org allowlist

### Home Assistant (example)
- `ha.get_states`
- `ha.call_service`
Constraints:
- entity allowlist, service allowlist, rate limits

## Connector implementation checklist
- [ ] Tool schemas defined
- [ ] Capability enforcement implemented
- [ ] Resource and field filters implemented
- [ ] Rate limits and output caps implemented
- [ ] Auditing: allowed and denied calls
- [ ] Error mapping is deterministic (no raw stack traces)

## Integration setup UX
For each connector:
- setup wizard (auth/connectivity)
- “what will be accessible” preview
- test call that is non-invasive (read-only)
- grant flow that maps to Polar capabilities (not OAuth scopes)

## Notes on MCP vs HTTP
Polar can expose tools via MCP or HTTP. Internally, enforcement rules are identical:
- If using MCP: treat it as transport, not policy.
- If using HTTP: same contract.
In both cases: capability enforcement must occur at the gateway boundary.
