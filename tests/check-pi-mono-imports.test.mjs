import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  collectPiMonoImportViolations,
  formatViolations,
} from "../scripts/check-pi-mono-imports.mjs";

const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "check-pi-mono-imports.mjs",
);

function createWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polar-boundary-"));

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source, "utf8");
  }

  return root;
}

function withWorkspace(files, callback) {
  const workspaceRoot = createWorkspace(files);
  try {
    callback(workspaceRoot);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

test("allows pi-mono imports inside polar-adapter-pi only", () => {
  withWorkspace(
    {
      "packages/polar-adapter-pi/src/provider.ts":
        'import { provider } from "@mariozechner/pi-ai";\nexport { provider };\n',
      "packages/polar-runtime-core/src/runtime.ts": "export const runtime = {};\n",
    },
    (workspaceRoot) => {
      const violations = collectPiMonoImportViolations(workspaceRoot);
      assert.deepEqual(violations, []);
    },
  );
});

test("reports pi-mono imports outside polar-adapter-pi", () => {
  withWorkspace(
    {
      "packages/polar-runtime-core/src/runtime.ts":
        'import { provider } from "@mariozechner/pi-ai";\nexport const runtime = provider;\n',
    },
    (workspaceRoot) => {
      const violations = collectPiMonoImportViolations(workspaceRoot);
      assert.equal(violations.length, 1);
      assert.deepEqual(violations[0], {
        file: "packages/polar-runtime-core/src/runtime.ts",
        line: 1,
        specifier: "@mariozechner/pi-ai",
      });
    },
  );
});

test("sorts reported violations deterministically", () => {
  withWorkspace(
    {
      "packages/polar-runtime-core/src/zeta.ts":
        'import "@mariozechner/pi-web-ui";\nimport { create } from "pi-mono/factory";\n',
      "packages/polar-control-plane/src/alpha.ts":
        'const pkg = require("@pi-mono/experimental");\nexport { pkg };\n',
    },
    (workspaceRoot) => {
      const violations = collectPiMonoImportViolations(workspaceRoot);
      const formatted = formatViolations(violations);

      assert.deepEqual(
        violations.map((violation) => violation.file),
        [
          "packages/polar-control-plane/src/alpha.ts",
          "packages/polar-runtime-core/src/zeta.ts",
          "packages/polar-runtime-core/src/zeta.ts",
        ],
      );
      assert.match(
        formatted,
        /\[POLAR-IMPORT-BOUNDARY\] Found disallowed pi-mono imports/,
      );
      assert.match(
        formatted,
        /packages\/polar-control-plane\/src\/alpha\.ts:1 imports "@pi-mono\/experimental"/,
      );
    },
  );
});

test("CLI exits with non-zero status when a violation is found", () => {
  withWorkspace(
    {
      "packages/polar-domain/src/index.ts":
        'import { provider } from "@mariozechner/pi-ai";\nexport { provider };\n',
    },
    (workspaceRoot) => {
      const result = spawnSync("node", [SCRIPT_PATH], {
        cwd: workspaceRoot,
        encoding: "utf8",
      });

      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /\[POLAR-IMPORT-BOUNDARY\] Found disallowed pi-mono imports/,
      );
    },
  );
});

test("CLI exits with success when no violation is found", () => {
  withWorkspace(
    {
      "packages/polar-runtime-core/src/index.ts": "export const value = 1;\n",
    },
    (workspaceRoot) => {
      const result = spawnSync("node", [SCRIPT_PATH], {
        cwd: workspaceRoot,
        encoding: "utf8",
      });

      assert.equal(result.status, 0);
      assert.match(
        result.stdout,
        /\[POLAR-IMPORT-BOUNDARY\] No disallowed pi-mono imports found\./,
      );
    },
  );
});
