import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import Database from "better-sqlite3";

import { exportArtifactsFromDb } from "../packages/polar-runtime-core/src/artifact-exporter.mjs";

test("artifact export does not include telegram command access admin/operator ids", async () => {
  const db = new Database(":memory:");
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "polar-artifacts-"));
  try {
    db.exec(`
      CREATE TABLE polar_configs (
        id TEXT PRIMARY KEY,
        resourceType TEXT NOT NULL,
        resourceId TEXT NOT NULL,
        config TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO polar_configs (id, resourceType, resourceId, config)
       VALUES (?, ?, ?, ?)`,
    ).run(
      "policy:telegram_command_access",
      "policy",
      "telegram_command_access",
      JSON.stringify({
        adminTelegramUserIds: ["123456789"],
        operatorTelegramUserIds: ["987654321"],
      }),
    );

    const result = await exportArtifactsFromDb({
      db,
      artifactsDir: workspace,
      generatedAtMs: Date.UTC(2026, 2, 1, 12, 0, 0),
    });

    for (const file of result.files) {
      const content = await fs.readFile(file.path, "utf8");
      assert.doesNotMatch(content, /123456789/);
      assert.doesNotMatch(content, /987654321/);
      assert.doesNotMatch(content, /telegram_command_access/);
    }
  } finally {
    db.close();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
