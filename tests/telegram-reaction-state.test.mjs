import test from "node:test";
import assert from "node:assert/strict";

import {
  createTelegramReactionController,
  parseCallbackOriginMessageId,
} from "../packages/polar-bot-runner/src/reaction-state.mjs";

function createFakeClock() {
  let nowMs = 0;
  let nextId = 1;
  /** @type {Array<{ id: number, dueAt: number, fn: () => void }>} */
  const timers = [];

  return {
    now() {
      return nowMs;
    },
    setTimeout(fn, delayMs) {
      const id = nextId++;
      timers.push({ id, dueAt: nowMs + delayMs, fn });
      timers.sort((left, right) => left.dueAt - right.dueAt);
      return id;
    },
    clearTimeout(id) {
      const index = timers.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        timers.splice(index, 1);
      }
    },
    advanceBy(deltaMs) {
      nowMs += deltaMs;
      while (timers.length > 0 && timers[0].dueAt <= nowMs) {
        const timer = timers.shift();
        timer?.fn();
      }
    },
  };
}

test("callback origin parser extracts numeric message id", () => {
  assert.equal(parseCallbackOriginMessageId("auto_app:proposal-1:123"), 123);
  assert.equal(parseCallbackOriginMessageId("repair_sel:A:cid"), null);
});

test("reaction lifecycle transitions waiting_user -> done -> clear using deterministic timers", async () => {
  const calls = [];
  const clock = createFakeClock();
  const controller = createTelegramReactionController({
    doneClearMs: 1_000,
    now: () => clock.now(),
    scheduleTimeout: (fn, delayMs) => clock.setTimeout(fn, delayMs),
    cancelTimeout: (timer) => clock.clearTimeout(timer),
  });

  const ctx = {
    chat: { id: 42 },
    telegram: {
      async setMessageReaction(chatId, messageId, payload) {
        calls.push({ chatId, messageId, payload });
      },
    },
  };

  await controller.setReactionState(ctx, 42, 777, "waiting_user");
  await controller.transitionWaitingReactionToDone(
    ctx,
    "wf_app:wf-123:777",
    () => ({ chat: { id: 42 } }),
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].payload, [{ type: "emoji", emoji: "⏳" }]);
  assert.deepEqual(calls[1].payload, [{ type: "emoji", emoji: "✅" }]);

  clock.advanceBy(999);
  assert.equal(calls.length, 2);
  clock.advanceBy(1);
  await Promise.resolve();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].payload, []);
});

