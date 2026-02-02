# Polar Assistant: Automation Engine

This document defines how Polar supports secure, low-friction automation without autonomous behaviour.

Automation is always user-initiated or explicitly authorised.

## Core principles
- Automations never bypass skills, templates, or capabilities
- Automations never grant permissions implicitly
- Automations run inside explicit automation envelopes

## Automation envelopes
An envelope defines:
- Triggers
- Allowed actions
- Action tier
- Scope constraints
- Expiry / review window

Envelopes are first-class runtime objects.

## Triggers
Triggers produce events, not actions.

Examples:
- New email
- Slack message
- Calendar reminder
- Time-based schedule

## Automation flow
1. Trigger creates an event
2. Event is stored and audited
3. Envelope evaluation
4. Notification, suggestion, or proposed action
5. Execution via normal template runner and capabilities

## LLM classifier
A lightweight LLM (eg GPT-5 nano/mini) is used only for:
- Intent classification
- Ambiguity detection
- Tone inference

It never:
- Decides permissions
- Chooses tools
- Executes actions

Low confidence results require clarification.

## Lifecycle
- Create (UI or chat)
- Preview
- Activate
- Review / expire
- Revoke

All steps are audited.
