# Workflow execution integrity (append/contract safety)

## Problem
A crash like:
- `Invalid chat.management.gateway.message.append.request`
during workflow execution indicates the system attempted to append a message with a shape that violates the chat management contract.

This is an internal bug, but it must be fail-safe and must not derail the conversation.

## Goals
- Validate message append requests before they hit the gateway.
- Ensure workflows and sub-agent execution share the same safe append path as normal turns.
- On failure: normalise to InternalContractBug and produce a user-facing error via orchestrator.

## Requirements
- All message appends include:
  - sessionId, userId, messageId, role, text, timestampMs
- MessageId uniqueness rules must hold within a session.
- Workflow execution must bind channel ids for assistant messages (as normal turns do).

## Tests
- Unit test for executeWorkflow that appends assistant message(s) with valid contract shape.
- Test that invalid append is caught and normalised rather than crashing.

## Agent checklist
- Check AGENTS.md first.
- Read last 150 lines of docs/IMPLEMENTATION_LOG.md.
- Write a log entry when done.
