import test from "node:test";
import assert from "node:assert/strict";

import { createControlPlaneService } from "../packages/polar-control-plane/src/index.mjs";

function createProviderHarness(providerCalls) {
  return async () => ({
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
  });
}

test("control-plane exposes deterministic skill proposal + review lifecycle APIs", async () => {
  const providerCalls = [];
  const service = createControlPlaneService({
    resolveProvider: createProviderHarness(providerCalls),
  });

  const proposed = await service.proposeSkillManifest({
    sourceUri: "C:/skills/docs-hitl/SKILL.md",
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

test("control-plane installSkill with a manifest stages approval before enabling the skill", async () => {
  const providerCalls = [];
  const service = createControlPlaneService({
    resolveProvider: createProviderHarness(providerCalls),
  });

  const staged = await service.installSkill({
    sourceUri: "C:/skills/docs-hitl/SKILL.md",
    skillManifest: `---
name: docs-hitl
description: Docs HITL skill
---
## Capabilities
- \`docs.search\` : Search docs [risk: read, effects: none]
`,
    requestedTrustLevel: "reviewed",
    enableAfterInstall: true,
  });

  assert.equal(staged.status, "applied");
  assert.equal(staged.extensionId, "skill.docs-hitl");
  assert.equal(staged.lifecycleState, "pending_install");
  assert.equal(staged.reviewStatus, "pending");
  assert.equal(staged.manifestSource, "provided");
  assert.equal(providerCalls.length, 0);

  const reviewed = await service.reviewSkillInstallProposal({
    extensionId: "skill.docs-hitl",
    decision: "approve",
    reviewerId: "operator-1",
    requestedTrustLevel: "reviewed",
    enableAfterReview: true,
  });

  assert.equal(reviewed.status, "applied");
  assert.equal(reviewed.lifecycleState, "enabled");
  assert.equal(reviewed.reviewStatus, "approved");
});

test("control-plane installSkill without a manifest generates one and still requires approval", async () => {
  const providerCalls = [];
  const service = createControlPlaneService({
    resolveProvider: createProviderHarness(providerCalls),
    mcpAdapter: {
      async probeConnection() {
        return { healthy: true, status: "ok" };
      },
      async importToolCatalog() {
        return {
          extensionId: "mcp.docs",
          serverId: "docs",
          catalogHash: "catalog-hash-1",
          permissions: [],
          capabilities: [
            {
              capabilityId: "docs.search",
              toolId: "docs.search",
              riskLevel: "read",
              sideEffects: "none",
            },
          ],
        };
      },
      createCapabilityAdapter() {
        return {
          async executeCapability() {
            return { ok: true };
          },
        };
      },
    },
  });

  const synced = await service.syncMcpServer({
    sourceUri: "https://safe.local/mcp/docs",
    serverId: "docs",
    enableAfterSync: true,
  });
  assert.equal(synced.status, "applied");

  const staged = await service.installSkill({
    sourceUri: "C:/skills/docs-hitl/SKILL.md",
    skillManifest: "# SKILL.md\nUse docs.search for retrieval",
    requestedTrustLevel: "reviewed",
    enableAfterInstall: true,
  });

  assert.equal(staged.status, "applied");
  assert.equal(staged.extensionId, "skill.docs-hitl");
  assert.equal(staged.lifecycleState, "pending_install");
  assert.equal(staged.reviewStatus, "pending");
  assert.equal(staged.manifestSource, "generated");
  assert.equal(providerCalls.length, 1);

  const reviewed = await service.reviewSkillInstallProposal({
    extensionId: "skill.docs-hitl",
    decision: "approve",
    reviewerId: "operator-1",
    requestedTrustLevel: "reviewed",
    enableAfterReview: true,
  });

  assert.equal(reviewed.status, "applied");
  assert.equal(reviewed.lifecycleState, "enabled");
});
