import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProposalValidationEvent,
  normalizeUsageSummary,
  summarizeProposalValidationEvents,
} from "../packages/polar-web-ui/src/views/telemetry-normalization.js";

test("normalizeUsageSummary accepts fallback aliases", () => {
  const normalized = normalizeUsageSummary({
    totalOperations: 10,
    completedCount: 8,
    failedCount: 2,
    totalFallbacks: 4,
    total_estimated_cost_usd: 1.25,
  });

  assert.deepEqual(normalized, {
    totalOperations: 10,
    completedCount: 8,
    failedCount: 2,
    fallbackCount: 4,
    totalEstimatedCostUsd: 1.25,
  });
});

test("normalizeProposalValidationEvent accepts snake_case and camelCase keys", () => {
  const snake = normalizeProposalValidationEvent({
    eventType: "proposal.validation",
    proposal_type: "automation",
    proposal_valid: true,
    final_decision: "respond",
    outcome_status: "automation_proposed",
    llm_confidence: 0.91,
  });
  const camel = normalizeProposalValidationEvent({
    eventType: "proposal.validation",
    proposalType: "failure_explain",
    proposalValid: false,
    finalDecision: "clarify",
    outcomeStatus: "workflow_failed_summary",
    llmConfidence: 0.33,
  });

  assert.deepEqual(snake, {
    proposalType: "automation",
    proposalValid: true,
    finalDecision: "respond",
    outcomeStatus: "automation_proposed",
    llmConfidence: 0.91,
  });
  assert.deepEqual(camel, {
    proposalType: "failure_explain",
    proposalValid: false,
    finalDecision: "clarify",
    outcomeStatus: "workflow_failed_summary",
    llmConfidence: 0.33,
  });
});

test("summarizeProposalValidationEvents returns deterministic totals", () => {
  const summary = summarizeProposalValidationEvents([
    {
      eventType: "proposal.validation",
      proposal_type: "automation",
      proposal_valid: false,
      final_decision: "clarify",
    },
    {
      eventType: "proposal.validation",
      proposalType: "workflow",
      proposalValid: true,
      finalDecision: "respond",
    },
    { eventType: "workflow.execution.results" },
  ]);

  assert.deepEqual(summary, {
    total: 2,
    invalid: 1,
    rejected: 1,
  });
});
