import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { classifyUserMessage, enforceFocusResolverProposal } from "../packages/polar-runtime-core/src/routing-policy-engine.mjs";

const replayFixtures = JSON.parse(
  fs.readFileSync(new URL("./fixtures/focus-thread-replay.json", import.meta.url), "utf8"),
);

test("focus/thread replay fixtures remain deterministic for ambiguous follow-ups", () => {
  for (const fixture of replayFixtures) {
    const result = classifyUserMessage(fixture.input);
    assert.equal(result.type, fixture.expected.type, fixture.id);
    assert.equal(result.focusContext?.focusThreadId, fixture.expected.focusThreadId, fixture.id);
    assert.equal(result.clearPendingThreadId, fixture.expected.clearPendingThreadId, fixture.id);
  }
});

test("focus resolver proposal validation clamps unknown candidate anchors and preserves ranking", () => {
  const enforcement = enforceFocusResolverProposal(
    {
      confidence: 0.88,
      refersTo: "focus_anchor",
      candidates: [
        { anchorId: "thread-2", threadKey: "topic:1", score: 0.9, reason: "latest ask" },
        { anchorId: "unknown", threadKey: "topic:1", score: 0.8, reason: "invented" },
      ],
      needsClarification: false,
    },
    ["thread-1", "thread-2"],
  );

  assert.equal(enforcement.proposalValid, false);
  assert.ok(enforcement.clampReasons.includes("unknown_anchor"));
  assert.equal(enforcement.value.candidates.length, 1);
  assert.equal(enforcement.value.candidates[0].anchorId, "thread-2");
});
