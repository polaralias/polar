import test from "node:test";
import assert from "node:assert/strict";

import { createProactiveInboxGateway } from "../packages/polar-runtime-core/src/index.mjs";

function createPipelineRecorder() {
  const records = [];
  return {
    records,
    pipeline: {
      async run(context, next) {
        const output = await next(context.input);
        records.push({
          actionId: context.actionId,
          executionType: context.executionType,
          output,
        });
        return output;
      },
    },
  };
}

test("proactive inbox gateway fails safely when connector is not configured", async () => {
  const { pipeline } = createPipelineRecorder();
  const gateway = createProactiveInboxGateway({
    middlewarePipeline: pipeline,
  });

  const result = await gateway.checkHeaders({
    sessionId: "telegram:chat:1",
    userId: "user-1",
    capabilities: ["mail.search_headers"],
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.connectorStatus, "not_configured");
  assert.equal(result.degradedReason, "inbox_connector_not_configured");
});

test("proactive inbox gateway blocks body reads without explicit permission", async () => {
  const { pipeline, records } = createPipelineRecorder();
  const gateway = createProactiveInboxGateway({
    middlewarePipeline: pipeline,
    inboxConnector: {
      async searchHeaders() {
        return [
          {
            messageId: "m-1",
            subject: "Quarterly report",
            from: "ceo@example.com",
          },
        ];
      },
      async readBody() {
        return "sensitive body";
      },
    },
  });

  const blocked = await gateway.readBody({
    sessionId: "telegram:chat:1",
    userId: "user-1",
    messageId: "m-1",
    capabilities: ["mail.search_headers"],
  });

  assert.equal(blocked.status, "blocked");
  assert.equal(
    blocked.blockedReason,
    "capability_mail.read_body_requires_explicit_permission",
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].actionId, "proactive-inbox.read-body");
  assert.equal(records[0].executionType, "automation");
});
