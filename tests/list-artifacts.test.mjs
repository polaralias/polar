import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { listArtifactFiles } from "../packages/polar-runtime-core/src/artifact-exporter.mjs";

test("listArtifactFiles lists existing and missing files", async () => {
  const artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), "polar-list-artifacts-"));
  try {
    const reactionsPath = path.resolve(artifactsDir, "REACTIONS.md");
    await fs.writeFile(reactionsPath, "reactions");

    // Only REACTIONS.md exists, others don't
    const items = await listArtifactFiles({ artifactsDir });

    assert.strictEqual(items.length, 4);

    const reactions = items.find(i => i.filename === "REACTIONS.md");
    assert.ok(reactions);
    assert.strictEqual(reactions.path, reactionsPath);
    assert.ok(typeof reactions.updatedAtMs === "number");
    assert.ok(Object.isFrozen(reactions));

    const heartbeat = items.find(i => i.filename === "HEARTBEAT.md");
    assert.ok(heartbeat);
    assert.strictEqual(heartbeat.updatedAtMs, null);
    assert.ok(Object.isFrozen(heartbeat));

    const memory = items.find(i => i.filename === "MEMORY.md");
    assert.ok(memory);
    assert.strictEqual(memory.updatedAtMs, null);

    const personality = items.find(i => i.filename === "PERSONALITY.md");
    assert.ok(personality);
    assert.strictEqual(personality.updatedAtMs, null);

    assert.ok(Object.isFrozen(items));

  } finally {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  }
});
