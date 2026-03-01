# Implementation log

A practical log of structural decisions and meaningful changes. This is the place to capture “why” as well as “what”, so the repo stays coherent over time.

## Entry template (use this every time)
## YYYY-MM-DD (UTC) - Prompt XX: <Short title>

**Branch:** `<branch-name>`  
**Commit:** `<hash>`  
**Prompt reference:** `Prompt XX` (from chat prompt pack / docs)  
**Specs referenced:**  
- `docs/specs/<SPEC_1>.md`  
- `docs/specs/<SPEC_2>.md`

### Summary
- <1–5 bullets: what changed at a high level>

### Scope and decisions
- **In scope:** <bullets>
- **Out of scope:** <bullets>
- **Key decisions:** <bullets, include defaults chosen>

### Files changed
- `path/to/file` - <what changed>
- `path/to/file` - <what changed>

### Data model / migrations (if applicable)
- **Tables created/changed:** <list>
- **Migration notes:** <any backfill, idempotency, fallback behaviour>
- **Risk:** <low/med/high> + why

### Security and safety checks
- **Allowlist changes:** <what changed, why>
- **Capabilities/middleware affected:** <what changed>
- **Sensitive operations:** <any new sensitive paths, how gated>

### Tests and validation
Commands run and outcomes:
- `npm test` - ✅/❌
- `npm run check:boundaries` - ✅/❌
- `<any other>` - ✅/❌

### Known issues / follow-ups
- <bullets, include links to files/lines if useful>

### Next
- **Next prompt:** `Prompt YY: <Short title>`
- **Suggested starting point:** <exact file(s) to open first>
- **Notes for next run:** <anything the next agent must know, incl. failures or partial work>