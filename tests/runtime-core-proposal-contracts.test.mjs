import test from "node:test";
import assert from "node:assert/strict";

import {
  parseJsonProposalText,
  routerProposalSchema,
  routerResponseFormat,
  validateWorkflowPlannerProposal,
  validateSchemaProposal,
  automationPlannerSchema,
  automationPlannerResponseFormat,
  workflowPlannerResponseFormat,
  failureExplainerSchema,
  failureExplainerResponseFormat,
  focusThreadResolverSchema,
  focusThreadResolverResponseFormat,
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

test("router proposal validator rejects target on respond decisions", () => {
  const result = parseJsonProposalText(
    JSON.stringify({
      decision: "respond",
      target: { agentId: "@writer" },
      confidence: 0.8,
      rationale: "direct answer",
    }),
    routerProposalSchema,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /target must be omitted/i);
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

test("automation planner clarify decision requires a clarification question", () => {
  const result = validateSchemaProposal(
    {
      decision: "clarify",
      confidence: 0.4,
      summary: "Need a confirmation",
    },
    automationPlannerSchema,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /clarificationQuestion is required/i);
});

test("failure explainer validator rejects missing summary", () => {
  const result = validateSchemaProposal(
    { canRetry: false, detailLevel: "safe" },
    failureExplainerSchema,
  );
  assert.equal(result.valid, false);
});

test("failure explainer validator requires boolean canRetry", () => {
  const result = validateSchemaProposal(
    {
      summary: "Retry later",
      canRetry: "yes",
      detailLevel: "safe",
    },
    failureExplainerSchema,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /canRetry/i);
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

test("focus resolver schema rejects non-boolean clarification flag", () => {
  const result = validateSchemaProposal(
    {
      confidence: 0.5,
      refersTo: "pending",
      candidates: [{ anchorId: "a1", threadKey: "k", score: 0.5, reason: "pending" }],
      needsClarification: "sometimes",
    },
    focusThreadResolverSchema,
  );
  assert.equal(result.valid, false);
});

test("planner response formats expose native json schema metadata", () => {
  assert.equal(routerResponseFormat.type, "json_schema");
  assert.equal(automationPlannerResponseFormat.type, "json_schema");
  assert.equal(workflowPlannerResponseFormat.type, "json_schema");
  assert.equal(failureExplainerResponseFormat.type, "json_schema");
  assert.equal(focusThreadResolverResponseFormat.type, "json_schema");
});
