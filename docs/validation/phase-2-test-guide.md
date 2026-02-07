# Phase 2 Manual Test Instructions

## Prerequisites
1. Ensure the runtime is running: `npm start` in `apps/runtime`.
2. Ensure you have a valid internal secret in `.env` (default is usually `test-secret`).

---

## 1. Test Channel Pairing
**Goal**: Verify the new pairing flow works independently of manual configuration.

1. **Generate Pairing Code**:
   ```bash
   curl -X POST http://localhost:4000/channels/pairing-code \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer polar_test_token"
   ```
   *Expected*: Returns JSON with a 6-character code (e.g., `ABC123`).

2. **Simulate Connection (Telegram/Slack)**:
   *   If you have a real bot connected, send `/pair <CODE>` to it.
   *   *Stub Test*: Trigger an inbound pairing message via code/console:
       ```typescript
       // In runtime console or script
       adapter.simulateIncomingMessage('test-sender-id', '/pair ABC123', 'chat-1');
       ```
   *Expected*: Bot replies "✅ Successfully paired with user <ID>!".

---

## 2. Test Proactivity & Natural Language
**Goal**: Verify the loop of "Event -> Proposal -> User Confirmation".

1. **Trigger an Event**:
   ```bash
   curl -X POST http://localhost:4000/events \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer polar_test_token" \
     -d '{ "source": "github", "type": "push", "payload": { "repo": "polar" } }'
   ```
   *Note*: Ensure you have an automation set up in `automations.json` that triggers on `github/push` with `tier: "delegated"`.

2. **Check for Proposal**:
   *   Runtime logs should show: `[PROPOSAL CREATED]: Waiting for user approval...` and `[Broadcast] Would send...`.

3. **Confirm with Natural Language**:
   *   Send a message to the bot (or simulate): "Yeah go ahead" or "Run it".
   *   *Expected*: Runtime logs: `[Channel] Message: "Yeah go ahead" classified as: { type: 'confirmation' }`.
   *   *Expected*: Runtime logs: `[PROPOSAL CONFIRMED]: Executing...`.

---

## 3. Test Worker Token Scoping
**Goal**: Ensure workers don't get wildcard permissions.

1. **Spawn a Worker**:
   *   Use the existing `spawn` tools or API to run a skill.
   *   Check the logs/audit for the **Minted Token**.
2. **Verify Resource**:
   *   The token resource should be specific (e.g., `system:worker` or `fs:/path/to/file`), NOT `*:*`.

---
