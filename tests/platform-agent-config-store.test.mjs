import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPolarPlatform, closePolarPlatform } from "../packages/polar-platform/src/index.mjs";

test("platform bootstraps default agent YAML files and syncs them into the control plane", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "polar-agent-config-"));
  const dbPath = join(tempDirectory, "platform.db");
  const agentConfigDir = join(tempDirectory, "config", "agents");
  const platform = createPolarPlatform({ dbPath, agentConfigDir });

  try {
    await platform.bootstrapPromise;
    const files = await readdir(agentConfigDir);
    assert.equal(files.length, 4);
    assert.equal(files.includes("general.yaml"), true);
    assert.equal(files.includes("researcher.yaml"), true);
    assert.equal(files.includes("writer.yaml"), true);
    assert.equal(files.includes("coder.yaml"), true);

    const listed = await platform.controlPlane.listAgentProfiles();
    const agentIds = listed.items.map((item) => item.agentId).sort();
    assert.deepEqual(agentIds, ["@coder", "@general", "@researcher", "@writer"]);

    const general = await platform.controlPlane.getAgentConfiguration({ agentId: "@general" });
    assert.equal(general.status, "found");
    assert.equal(general.configuration.profileId, "profile.general");
  } finally {
    closePolarPlatform(platform);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
