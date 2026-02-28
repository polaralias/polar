import test from "node:test";
import assert from "node:assert/strict";

import { createControlPlaneService } from "../packages/polar-control-plane/src/index.mjs";

test("control-plane exposes deterministic skill proposal + review lifecycle APIs", async () => {
  const providerCalls = [];
  const service = createControlPlaneService({
    resolveProvider: async () => ({
      async generate(request) {
        providerCalls.push(request);
        return {
          providerId: request.providerId,
          model: request.model,
          text: JSON.stringify({
            extensionId: "skill.docs-hitl",
            version: "1.0.0",
            description: "Docs HITL skill",
            permissions: ["fs.read"],
            capabilities: [
              {
                capabilityId: "docs.search",
                riskLevel: "read",
                sideEffects: "none",
              },
            ],
          }),
        };
      },
      async stream(request) {
        return {
          providerId: request.providerId,
          model: request.model,
          chunks: ["unused"],
        };
      },
      async embed(request) {
        return {
          providerId: request.providerId,
          model: request.model,
          vector: [0],
        };
      },
      async listModels(request) {
        return {
          providerId: request.providerId,
          models: ["gpt-4.1-mini"],
        };
      },
    }),
  });

  const proposed = await service.proposeSkillManifest({
    sourceUri: "https://safe.local/skills/docs-hitl/SKILL.md",
    skillContent: "# SKILL.md\nUse docs.search for retrieval",
    mcpInventory: [{ name: "docs.search" }],
  });

  assert.equal(proposed.status, "applied");
  assert.equal(proposed.extensionId, "skill.docs-hitl");
  assert.equal(proposed.lifecycleState, "pending_install");
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].providerId, "openai");
  assert.equal(providerCalls[0].model, "gpt-4.1-mini");

  const pending = service.listPendingSkillInstallProposals();
  assert.equal(pending.status, "ok");
  assert.equal(pending.totalCount, 1);
  assert.equal(pending.items[0].extensionId, "skill.docs-hitl");

  const reviewed = await service.reviewSkillInstallProposal({
    extensionId: "skill.docs-hitl",
    decision: "approve",
    reviewerId: "operator-1",
    reason: "Reviewed and approved",
    requestedTrustLevel: "reviewed",
    enableAfterReview: true,
  });

  assert.equal(reviewed.status, "applied");
  assert.equal(reviewed.reviewStatus, "approved");
  assert.equal(reviewed.lifecycleStatus, "applied");
  assert.equal(reviewed.lifecycleState, "enabled");

  const pendingAfter = service.listPendingSkillInstallProposals();
  assert.equal(pendingAfter.totalCount, 0);

  const authorityStates = service.listCapabilityAuthorityStates();
  const authorityState = authorityStates.find(
    (entry) => entry.extensionId === "skill.docs-hitl",
  );
  assert.ok(authorityState);
  assert.equal(authorityState.lifecycleState, "enabled");
});
