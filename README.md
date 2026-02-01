# polar

Polar is a comprehensive AI assistant with a security-first design. It is built to orchestrate tools and skills safely, enforce policy at every boundary, and provide auditable control over execution.

## Goals
- Secure-by-default orchestration and policy enforcement
- Clear auditability and least-privilege access
- Modular services that scale from local to managed deployments

## Repo layout
- /runtime: Orchestrator API, sessions, worker manager, capability service, policy engine, audit service, memory service.
- /gateway: MCP server(s), connectors, enforcement middleware, egress control, rate limits.
- /skills: Skill manifest schema, local skill registry, installer, signing verification stubs.
- /ui: Local control UI (audit timeline, permission editor, skill manager).
- /deploy: docker-compose.yml, local scripts, Terraform modules (later).
- /docs: Threat model, policy model, manifest spec, internal API contracts.

## Notes
This README is intentionally brief and will expand as core services land.
