import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exportArtifactsFromDb } from "@polar/runtime-core";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "..");
const artifactsDir = resolve(repoRoot, "artifacts");
const dbPath = process.env.POLAR_DB_PATH
  ? resolve(process.env.POLAR_DB_PATH)
  : resolve(repoRoot, "polar-system.db");

async function main() {
  const db = new Database(dbPath, { readonly: true, fileMustExist: false });
  try {
    const result = await exportArtifactsFromDb({
      db,
      artifactsDir,
    });
    console.log(`[export:artifacts] db=${dbPath}`);
    console.log(`[export:artifacts] wrote ${result.files.length} files to ${result.artifactsDir}`);
    console.log(
      `[export:artifacts] reactions=${result.counts.reactions} heartbeat=${result.counts.heartbeat} memory=${result.counts.memory} personality=${result.counts.personality}`,
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("[export:artifacts] failed", error);
  process.exitCode = 1;
});
