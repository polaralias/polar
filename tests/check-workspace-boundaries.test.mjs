import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  collectWorkspaceBoundaryViolations,
  formatWorkspaceBoundaryViolations,
} from "../scripts/check-workspace-boundaries.mjs";

const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "check-workspace-boundaries.mjs",
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

test("allows package imports and within-package relative imports", () => {
  withWorkspace(
    {
      "packages/polar-domain/src/index.mjs": "export const value = 1;\n",
      "packages/polar-runtime-core/src/index.mjs":
        'import { value } from "@polar/domain";\nimport "./local.mjs";\nexport { value };\n',
      "packages/polar-runtime-core/src/local.mjs": "export const local = true;\n",
    },
    (workspaceRoot) => {
      const violations = collectWorkspaceBoundaryViolations(workspaceRoot);
      assert.deepEqual(violations, []);
    },
  );
});

test("reports cross-package src imports", () => {
  withWorkspace(
    {
      "packages/polar-runtime-core/src/index.mjs":
        'import { value } from "../../polar-domain/src/index.mjs";\nexport { value };\n',
    },
    (workspaceRoot) => {
      const violations = collectWorkspaceBoundaryViolations(workspaceRoot);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].rule, "cross_package_src_import");
    },
  );
});

test("reports /packages/ absolute path imports and sibling traversal", () => {
  withWorkspace(
    {
      "packages/polar-control-plane/src/alpha.mjs":
        'import thing from "/repo/packages/shared/index.mjs";\nexport { thing };\n',
      "packages/polar-runtime-core/src/beta.mjs":
        'import x from "../../../polar-domain/index.mjs";\nexport { x };\n',
    },
    (workspaceRoot) => {
      const violations = collectWorkspaceBoundaryViolations(workspaceRoot);
      assert.equal(violations.length, 2);
      assert.match(formatWorkspaceBoundaryViolations(violations), /\[POLAR-WORKSPACE-BOUNDARY\]/);
      assert.ok(
        violations.some((v) => v.rule === "packages_path_import"),
      );
      assert.ok(
        violations.some((v) => v.rule === "illegal_sibling_traversal"),
      );
    },
  );
});

test("reports surface dependency constraints in code and package manifests", () => {
  withWorkspace(
    {
      "packages/polar-bot-runner/src/index.mjs":
        'import { createNativeHttpAdapter } from "@polar/adapter-native";\n',
      "packages/polar-bot-runner/package.json": JSON.stringify(
        {
          name: "@polar/bot-runner",
          dependencies: {
            "@mariozechner/pi-ai": "^0.54.0",
          },
        },
        null,
        2,
      ),
    },
    (workspaceRoot) => {
      const violations = collectWorkspaceBoundaryViolations(workspaceRoot);
      assert.equal(violations.length, 2);
      assert.ok(
        violations.every((violation) => violation.rule === "surface_dependency_constraint"),
      );
    },
  );
});

test("reports semantic thin-surface violations for direct provider imports and calls", () => {
  withWorkspace(
    {
      "packages/polar-bot-runner/src/index.mjs":
        'import OpenAI from "openai";\nexport async function run(controlPlane) { return controlPlane.generateOutput({}); }\n',
    },
    (workspaceRoot) => {
      const violations = collectWorkspaceBoundaryViolations(workspaceRoot);
      assert.equal(violations.length, 2);
      assert.ok(
        violations.every(
          (violation) => violation.rule === "surface_thinness_constraint",
        ),
      );
    },
  );
});

test("CLI exits non-zero on violation and zero when clean", () => {
  withWorkspace(
    {
      "packages/polar-runtime-core/src/index.mjs":
        'import { value } from "../../polar-domain/src/index.mjs";\nexport { value };\n',
    },
    (workspaceRoot) => {
      const result = spawnSync("node", [SCRIPT_PATH], {
        cwd: workspaceRoot,
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /\[POLAR-WORKSPACE-BOUNDARY\] Found workspace boundary violations/);
    },
  );

  withWorkspace(
    {
      "packages/polar-runtime-core/src/index.mjs":
        'import { value } from "@polar/domain";\nexport { value };\n',
    },
    (workspaceRoot) => {
      const result = spawnSync("node", [SCRIPT_PATH], {
        cwd: workspaceRoot,
        encoding: "utf8",
      });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /\[POLAR-WORKSPACE-BOUNDARY\] No workspace boundary violations found\./);
    },
  );
});
