import test from "node:test";
import assert from "node:assert/strict";

import { createControlPlaneService } from "../packages/polar-control-plane/src/index.mjs";

/**
 * @param {string} sessionId
 * @param {readonly string[]} allowedSkills
 */
async function configureSessionProfile(service, sessionId, allowedSkills) {
  const profileId = `profile.${sessionId}`;
  await service.upsertConfig({
    resourceType: "profile",
    resourceId: profileId,
    config: {
      allowedSkills,
      modelPolicy: {
        providerId: "test-provider",
        modelId: "test-model",
      },
    },
  });
  await service.upsertConfig({
    resourceType: "policy",
    resourceId: `profile-pin:session:${sessionId}`,
    config: {
      profileId,
    },
  });
}

/**
 * @param {{
 *  name: string,
 *  description: string,
 *  capabilityId: string,
 *  capabilityDescription: string,
 *  risk: "read"|"write"|"destructive",
 *  effects: "none"|"internal"|"external",
 *  egress: "none"|"network"
 * }} options
 */
function buildSkillManifest(options) {
  return `---
name: ${options.name}
description: ${options.description}
---
## Capabilities
- \`${options.capabilityId}\` : ${options.capabilityDescription} [risk: ${options.risk}, effects: ${options.effects}, egress: ${options.egress}]
`;
}

test("direct executeExtension denies approval-required capabilities without grants", async () => {
  const service = createControlPlaneService();
  const sessionId = "session-direct-approval";
  const extensionId = "skill.mail-skill";
  const capabilityId = "send_mail";

  await configureSessionProfile(service, sessionId, [extensionId]);

  const installResult = await service.installSkill({
    sourceUri: "C:/skills/mail/SKILL.md",
    enableAfterInstall: true,
    skillManifest: buildSkillManifest({
      name: "Mail Skill",
      description: "Send outbound emails",
      capabilityId,
      capabilityDescription: "Send a message to a recipient",
      risk: "write",
      effects: "external",
      egress: "network",
    }),
  });
  assert.equal(installResult.status, "applied");
  assert.equal(installResult.lifecycleState, "enabled");

  const directResult = await service.executeExtension({
    extensionId,
    extensionType: "skill",
    capabilityId,
    sessionId,
    userId: "user-direct-approval",
    // Attempt to force permissive scope from caller should not bypass server-side policy/approval.
    capabilityScope: {
      allowed: {
        [extensionId]: ["*"],
      },
    },
    input: {
      to: "a@example.com",
      subject: "Hello",
      body: "Test",
    },
  });

  assert.equal(directResult.status, "failed");
  assert.equal(directResult.error?.code, "POLAR_EXTENSION_POLICY_DENIED");
  assert.match(directResult.error?.message || "", /approval/i);
});

test("direct executeExtension recomputes scope server-side and ignores caller-supplied capabilityScope", async () => {
  const service = createControlPlaneService();
  const sessionId = "session-direct-scope";
  const extensionId = "skill.notes-skill";
  const capabilityId = "read_notes";

  // No allowed skills for this session.
  await configureSessionProfile(service, sessionId, []);

  const installResult = await service.installSkill({
    sourceUri: "C:/skills/notes/SKILL.md",
    enableAfterInstall: true,
    skillManifest: buildSkillManifest({
      name: "Notes Skill",
      description: "Read local notes",
      capabilityId,
      capabilityDescription: "Read notes for a user",
      risk: "read",
      effects: "none",
      egress: "none",
    }),
  });
  assert.equal(installResult.status, "applied");
  assert.equal(installResult.lifecycleState, "enabled");

  const directResult = await service.executeExtension({
    extensionId,
    extensionType: "skill",
    capabilityId,
    sessionId,
    userId: "user-direct-scope",
    // Caller tries to bypass allowlist with fabricated scope.
    capabilityScope: {
      allowed: {
        [extensionId]: [capabilityId],
      },
    },
    input: {
      query: "project status",
    },
  });

  assert.equal(directResult.status, "failed");
  assert.equal(directResult.error?.code, "POLAR_EXTENSION_POLICY_DENIED");
  assert.match(directResult.error?.message || "", /not in session scope/i);
});
