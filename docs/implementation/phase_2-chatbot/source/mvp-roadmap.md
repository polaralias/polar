# Polar Assistant: MVP Roadmap (Experience First)

This roadmap turns the secure kernel into a usable assistant with real integrations and channels.

## Phase 1: Skills + Templates (no external APIs yet)
- Skill packaging: `polar.skill.json` + templates
- Installer (local-only)
- Permission grants + UI
- Template runner worker
- Confirm-first write actions
Acceptance:
- A skill installs, requests permissions, runs templates, and is fully auditable.

## Phase 2: First real connector (choose one)
Recommended choices:
- Google Calendar (high user value)
- GitHub (simple auth and objects)
- Home Assistant (fun demo, strong control surfaces)
Build:
- Connector tools + enforcement
- Setup wizard
- A small skill pack with 3–5 templates
Acceptance:
- “Allow X deny Y” is demonstrable (calendarId, repo, entity allowlist).

## Phase 3: Proactive hooks
- Event record store
- One hook source (Gmail push or Calendar polling)
- Notification UI + channel notification path
Acceptance:
- User receives a safe proactive nudge with a preview and optional next action.

## Phase 4: Channels
Implement in order:
1) Telegram
2) Slack
3) WhatsApp transport of choice
Acceptance:
- Pairing + allowlists + audit coverage; inbound behaves like web UI chat.

## Phase 5: CLI connector + one wrapper integration
- Build `cli.run` with allowlists and caps
- Add one local-only wrapper (eg Notes search/list)
Acceptance:
- Wrapper cannot execute arbitrary commands; output is bounded; audited.

## Phase 6: Expand integrations and skill packs
- Gmail (read with field filters, confirm-first send)
- More Home Assistant actions
- File workflows (summarise directory, create docs, etc.)

## Phase 7: Ecosystem hardening
- Signing, provenance, update diffs
- Emergency disable mode
- Exportable audit
