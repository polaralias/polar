# Skills

Skills are how Polar stays extendable without turning the core into bespoke app logic.

## What a skill is
A skill is a packaged capability with:
- a manifest (identity, inputs/outputs, permissions)
- one or more tools/actions with strict contracts
- optional workflows/templates

## Installation model
- Skills are registered in a skill registry.
- Installing a skill should be a controlled operation:
  - validate manifest
  - validate contracts
  - enforce capability policy
  - record an audit event

## Guardrails
- Skills must declare required capabilities.
- Skills cannot bypass the middleware chain.
- Skills should be testable in isolation (unit tests for contracts + execution).

## Auto-generation
Auto-generating manifests and templates is fine, but treat it as:
- model proposes
- code validates
- human (or policy) approves

For older/extended skill docs, see `docs/_archive/2026-03-01/architecture/skill-registry-and-installation.md`.
