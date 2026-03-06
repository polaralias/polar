import test from "node:test";
import assert from "node:assert/strict";

import { normalizeToolWorkflowError } from "../packages/polar-runtime-core/src/tool-workflow-error-normalizer.mjs";

test("normalizer classifies unavailable tool as terminal and clear-pending", () => {
  const normalized = normalizeToolWorkflowError({
    error: new Error("Invalid extension.gateway.execute.request"),
    extensionId: "web",
    capabilityId: "search_web",
    workflowId: "wf-1",
    runId: "run-1",
    threadId: "th-1",
  });

  assert.equal(normalized.category, "ToolUnavailable");
  assert.equal(normalized.clearPending, true);
  assert.equal(normalized.retryEligible, false);
  assert.match(normalized.userMessage, /isn't available/);
  assert.match(normalized.userMessage, /\[web.search_web\]/);
  assert.match(normalized.userMessage, /Invalid extension.gateway.execute.request/);
});

test("normalizer classifies append contract failures as internal contract bugs", () => {
  const normalized = normalizeToolWorkflowError({
    error: new Error("Invalid chat.management.gateway.message.append.request"),
    extensionId: "orchestrator",
    capabilityId: "executeWorkflow",
  });

  assert.equal(normalized.category, "InternalContractBug");
  assert.equal(normalized.clearPending, true);
  assert.equal(normalized.retryEligible, false);
  assert.match(normalized.userMessage, /Something broke internally/);
});


test("normalizer exposes controlled safe diagnostics without stack trace", () => {
  const normalized = normalizeToolWorkflowError({
    error: new Error("Invalid extension.gateway.execute.request\n at secret stack line"),
    extensionId: "weather",
    capabilityId: "lookup_weather",
  });

  assert.equal(normalized.safeDiagnostic.category, "ToolUnavailable");
  assert.equal(
    normalized.safeDiagnostic.normalizedErrorMessage,
    "Invalid extension.gateway.execute.request",
  );
});
