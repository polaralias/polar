import test from "node:test";
import assert from "node:assert/strict";

import {
  parseJsonProposalText,
  routerProposalSchema,
  validateWorkflowPlannerProposal,
  validateSchemaProposal,
  automationPlannerSchema,
  failureExplainerSchema,
  focusThreadResolverSchema,
} from "../packages/polar-runtime-core/src/proposal-contracts.mjs";
import { enforceFocusResolverProposal } from "../packages/polar-runtime-core/src/routing-policy-engine.mjs";

test("router proposal validator accepts contract-compliant proposal", () => {
  const result = parseJsonProposalText(
    JSON.stringify({
      decision: "delegate",
      target: { agentId: "@writer" },
      confidence: 0.8,
      rationale: "specialist required",
    }),
    routerProposalSchema,
  );
  assert.equal(result.valid, true);
  assert.equal(result.value.decision, "delegate");
});

test("workflow planner validator fails closed on malformed steps", () => {
  const result = validateWorkflowPlannerProposal({
    goal: "Do work",
    confidence: 0.8,
    riskHints: { mayWrite: false },
    steps: [{ id: "s1" }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.deepEqual(result.clampReasons, ["schema_invalid"]);
});

test("automation planner validator requires strict schema", () => {
  const result = validateSchemaProposal(
    {
      decision: "propose",
      confidence: 0.9,
      summary: "Daily check",
      schedule: { kind: "daily", expression: "09:00" },
      runScope: { sessionId: "s1", userId: "u1" },
      limits: { maxNotificationsPerDay: 3 },
      riskHints: { mayWrite: false, requiresApproval: false },
    },
    automationPlannerSchema,
  );
  assert.equal(result.valid, true);
});

test("failure explainer validator rejects missing summary", () => {
  const result = validateSchemaProposal(
    { canRetry: false, detailLevel: "safe" },
    failureExplainerSchema,
  );
  assert.equal(result.valid, false);
});

test("focus resolver enforcement clamps unknown anchors", () => {
  const proposal = {
    confidence: 0.7,
    refersTo: "latest",
    candidates: [{ anchorId: "unknown", threadKey: "t", score: 0.7, reason: "x" }],
    needsClarification: false,
  };
  const result = enforceFocusResolverProposal(proposal, ["known"]);
  assert.equal(result.proposalValid, false);
  assert.match(result.clampReasons.join(","), /unknown_anchor/);
});

test("focus resolver schema parses valid payload", () => {
  const result = validateSchemaProposal(
    {
      confidence: 0.5,
      refersTo: "pending",
      candidates: [{ anchorId: "a1", threadKey: "k", score: 0.5, reason: "pending" }],
      needsClarification: false,
    },
    focusThreadResolverSchema,
  );
  assert.equal(result.valid, true);
});
