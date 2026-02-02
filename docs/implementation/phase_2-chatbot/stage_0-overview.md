# Polar Use Case: The Assistant Experience (Phase 2)

## Overview
We are ready to move onto the next phase of development: the actual chatbot we offer, built on all the foundational security focused work we have completed.

This phase focuses on the "Assistant Experience" Layer: Skills, Integrations, Channels, and the LLM Brain.

## Target Outcome
A user can:
* Chat with Polar via UI **and** via external channels (Slack/Telegram/WhatsApp etc)
* Install skills safely
* Use “integrations” (Google, Gmail, GitHub, Home Assistant, Notes, files) through:
  * typed tools (preferred)
  * CLI wrappers (when unavoidable)
* See clear audit trails and permission boundaries
* Get reliable tool use (no “hallucinated instructions”)

Polar stays security-first:
* Runtime mints capabilities
* Gateway enforces
* Agents never hold credentials
* Every effect is audited
* Revocation works (immediate for writes, strongly bounded for reads if you choose)

## Implementation Phases

The implementation is broken down into four staged phases to ensure reliability and security.

*   [**Phase A: Skills & Templates**](./01-phase-2a-skills.md) - The packaging system that drives "assistant features" locally.
*   [**Phase B: Connectors**](./02-phase-2b-connectors.md) - Real third-party integrations (Google, GitHub, HA) via typed tools.
*   [**Phase C: Channels**](./03-phase-2c-channels.md) - Chat gateways (Slack, Telegram, WhatsApp) with strict pairing.
*   [**Phase D: CLI Wrappers**](./04-phase-2d-cli.md) - Safe execution of local tools behind strict schema-validated tools.

## Core Concepts

### 1. Integration Taxonomy
1.  **Connector**: A tool surface to an external system. Lives behind the gateway.
2.  **Channel**: An inbound/outbound messaging adapter.
3.  **Automation Hook**: A trigger source that creates events in Polar.
4.  **Skill Pack**: A bundle of worker templates + tool calls.

**Rule:** If it touches the world, it is a connector tool call behind the gateway.

### 2. The Main Agent
The main agent must be “tool-poor”:
*   Interpret user intent
*   Choose an appropriate skill/template
*   Request runtime to spawn the correct worker
*   Summarise results back to user
*   Optionally propose memory writes

It must **not** call gateway tools directly, decide permissions, or access secrets.

### 3. Workers
Workers are "template runners":
*   Take validated template inputs
*   Call exactly the tool sequence declared in template
*   Return structured outputs
