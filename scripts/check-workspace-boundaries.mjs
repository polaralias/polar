import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PACKAGES_DIRECTORY = "packages";
export const SURFACE_PACKAGE_NAMES = new Set([
  "polar-bot-runner",
  "polar-web-ui",
  "polar-cli",
]);

const SCANNED_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  ".tmp",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const IMPORT_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?[^"'`]*\sfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const FORBIDDEN_SURFACE_SPECIFIER_PATTERNS = [
  /^@polar\/adapter-(?:pi|native|channels|extensions)(?:$|\/)/,
  /^@mariozechner\/pi-/,
  /^@pi-mono\//,
  /^pi-mono(?:$|\/)/,
];

function normalizePath(value) {
  return value.replaceAll(path.sep, "/");
}

function isSourceFile(filePath) {
  return SCANNED_EXTENSIONS.has(path.extname(filePath));
}

function listSourceFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const filePaths = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      filePaths.push(...listSourceFiles(entryPath));
      continue;
    }
    if (entry.isFile() && isSourceFile(entryPath)) {
      filePaths.push(entryPath);
    }
  }

  return filePaths.sort((left, right) => left.localeCompare(right));
}

function findImportSpecifiers(sourceText) {
  const matches = [];
  const lines = sourceText.split("\n");
  let offset = 0;

  for (const line of lines) {
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        const specifier = match[1] ?? null;
        if (!specifier) continue;
        matches.push({
          index: offset + (match.index ?? 0),
          specifier,
        });
      }
    }
    offset += line.length + 1;
  }

  return matches;
}

function lineNumberFromIndex(sourceText, index) {
  return sourceText.slice(0, index).split("\n").length;
}

function findPackageNameFromPath(rootPath, filePath) {
  const relative = normalizePath(path.relative(rootPath, filePath));
  const match = /^packages\/([^/]+)\//.exec(relative);
  return match ? match[1] : null;
}

function isInsidePackages(rootPath, absolutePath) {
  const relative = normalizePath(path.relative(rootPath, absolutePath));
  return relative === "packages" || relative.startsWith("packages/");
}

function isCrossPackageSourcePath(rootPath, currentPackageName, absolutePath) {
  const relative = normalizePath(path.relative(rootPath, absolutePath));
  const match = /^packages\/([^/]+)\/src(?:\/|$)/.exec(relative);
  if (!match) return false;
  return match[1] !== currentPackageName;
}

function isIllegalSiblingTraversal(specifier) {
  return /^(\.\.\/){2,}polar-[^/]+(?:\/|$)/.test(specifier);
}

function isForbiddenSurfaceSpecifier(specifier) {
  return FORBIDDEN_SURFACE_SPECIFIER_PATTERNS.some((pattern) =>
    pattern.test(specifier),
  );
}

/**
 * @typedef WorkspaceBoundaryViolation
 * @property {string} file
 * @property {number} line
 * @property {string} rule
 * @property {string} specifier
 */

/**
 * @param {string} workspaceRoot
 * @param {{ packagesDirectory?: string }} [options]
 * @returns {WorkspaceBoundaryViolation[]}
 */
export function collectWorkspaceBoundaryViolations(
  workspaceRoot,
  { packagesDirectory = DEFAULT_PACKAGES_DIRECTORY } = {},
) {
  const rootPath = path.resolve(workspaceRoot);
  const packagesPath = path.join(rootPath, packagesDirectory);
  const violations = [];

  for (const filePath of listSourceFiles(packagesPath)) {
    const sourceText = fs.readFileSync(filePath, "utf8");
    const imports = findImportSpecifiers(sourceText);
    const relativePath = normalizePath(path.relative(rootPath, filePath));
    const currentPackageName = findPackageNameFromPath(rootPath, filePath);
    const isSurfacePackage =
      currentPackageName !== null && SURFACE_PACKAGE_NAMES.has(currentPackageName);

    for (const importEntry of imports) {
      const specifier = importEntry.specifier;
      const line = lineNumberFromIndex(sourceText, importEntry.index);

      if (specifier.includes("/polar-") && specifier.includes("/src/")) {
        violations.push({
          file: relativePath,
          line,
          rule: "cross_package_src_import",
          specifier,
        });
        continue;
      }

      if (specifier.includes("/packages/") || specifier.startsWith("packages/")) {
        violations.push({
          file: relativePath,
          line,
          rule: "packages_path_import",
          specifier,
        });
        continue;
      }

      if (isIllegalSiblingTraversal(specifier)) {
        violations.push({
          file: relativePath,
          line,
          rule: "illegal_sibling_traversal",
          specifier,
        });
        continue;
      }

      if (specifier.startsWith(".")) {
        const absoluteTargetPath = path.resolve(path.dirname(filePath), specifier);
        if (
          currentPackageName !== null &&
          isInsidePackages(rootPath, absoluteTargetPath)
        ) {
          if (
            isCrossPackageSourcePath(
              rootPath,
              currentPackageName,
              absoluteTargetPath,
            )
          ) {
            violations.push({
              file: relativePath,
              line,
              rule: "cross_package_src_import",
              specifier,
            });
            continue;
          }

          const targetPackageName = findPackageNameFromPath(
            rootPath,
            absoluteTargetPath,
          );
          if (
            targetPackageName !== null &&
            targetPackageName !== currentPackageName
          ) {
            violations.push({
              file: relativePath,
              line,
              rule: "illegal_sibling_traversal",
              specifier,
            });
            continue;
          }
        }
      }

      if (isSurfacePackage && isForbiddenSurfaceSpecifier(specifier)) {
        violations.push({
          file: relativePath,
          line,
          rule: "surface_dependency_constraint",
          specifier,
        });
      }
    }
  }

  for (const packageName of SURFACE_PACKAGE_NAMES) {
    const packageJsonPath = path.join(packagesPath, packageName, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;

    const source = fs.readFileSync(packageJsonPath, "utf8");
    /** @type {Record<string, unknown>} */
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      continue;
    }

    const dependencyFields = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ];
    for (const fieldName of dependencyFields) {
      const field = parsed[fieldName];
      if (!field || typeof field !== "object") continue;
      for (const key of Object.keys(field)) {
        if (!isForbiddenSurfaceSpecifier(key)) continue;
        violations.push({
          file: normalizePath(path.relative(rootPath, packageJsonPath)),
          line: 1,
          rule: "surface_dependency_constraint",
          specifier: `${fieldName}:${key}`,
        });
      }
    }
  }

  return violations.sort((left, right) => {
    if (left.file !== right.file) return left.file.localeCompare(right.file);
    if (left.line !== right.line) return left.line - right.line;
    if (left.rule !== right.rule) return left.rule.localeCompare(right.rule);
    return left.specifier.localeCompare(right.specifier);
  });
}

/**
 * @param {WorkspaceBoundaryViolation[]} violations
 * @returns {string}
 */
export function formatWorkspaceBoundaryViolations(violations) {
  const lines = [
    "[POLAR-WORKSPACE-BOUNDARY] Found workspace boundary violations:",
    ...violations.map(
      (violation) =>
        `- ${violation.file}:${violation.line} [${violation.rule}] imports "${violation.specifier}"`,
    ),
  ];
  return lines.join("\n");
}

function runCli() {
  const violations = collectWorkspaceBoundaryViolations(process.cwd());
  if (violations.length > 0) {
    process.stderr.write(`${formatWorkspaceBoundaryViolations(violations)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    "[POLAR-WORKSPACE-BOUNDARY] No workspace boundary violations found.\n",
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli();
}
