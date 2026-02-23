import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PACKAGES_DIRECTORY = "packages";
export const ADAPTER_PI_DIRECTORY = path.join("packages", "polar-adapter-pi");

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
const PI_MONO_IMPORT_PATTERNS = [
  /^pi-mono(?:$|\/)/,
  /^@pi-mono\//,
  /^@mariozechner\/pi-(?:ai|agent-core|web-ui)(?:$|\/)/,
];
const IMPORT_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?[^"'`]*\sfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function normalizePath(value) {
  return value.replaceAll(path.sep, "/");
}

function isSourceFile(filePath) {
  return SCANNED_EXTENSIONS.has(path.extname(filePath));
}

function isPiMonoSpecifier(specifier) {
  return PI_MONO_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier));
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
  let characterOffset = 0;

  for (const line of lines) {
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        const specifier = match[1] ?? null;
        if (!specifier) {
          continue;
        }

        matches.push({
          index: characterOffset + (match.index ?? 0),
          specifier,
        });
      }
    }

    characterOffset += line.length + 1;
  }

  return matches;
}

function lineNumberFromIndex(sourceText, index) {
  return sourceText.slice(0, index).split("\n").length;
}

function isAllowedAdapterPath(relativePath) {
  const normalizedPath = normalizePath(relativePath);
  const normalizedAllowedDirectory = `${normalizePath(ADAPTER_PI_DIRECTORY)}/`;
  return (
    normalizedPath === normalizePath(ADAPTER_PI_DIRECTORY) ||
    normalizedPath.startsWith(normalizedAllowedDirectory)
  );
}

/**
 * @typedef PiMonoViolation
 * @property {string} file
 * @property {number} line
 * @property {string} specifier
 */

/**
 * Finds import-boundary violations for pi-mono packages in the workspace.
 * @param {string} workspaceRoot
 * @param {{ packagesDirectory?: string }} [options]
 * @returns {PiMonoViolation[]}
 */
export function collectPiMonoImportViolations(
  workspaceRoot,
  { packagesDirectory = DEFAULT_PACKAGES_DIRECTORY } = {},
) {
  const rootPath = path.resolve(workspaceRoot);
  const packagesPath = path.join(rootPath, packagesDirectory);
  const violations = [];

  for (const filePath of listSourceFiles(packagesPath)) {
    const relativePath = path.relative(rootPath, filePath);

    if (isAllowedAdapterPath(relativePath)) {
      continue;
    }

    const sourceText = fs.readFileSync(filePath, "utf8");
    const imports = findImportSpecifiers(sourceText);

    for (const importEntry of imports) {
      if (!isPiMonoSpecifier(importEntry.specifier)) {
        continue;
      }

      violations.push({
        file: normalizePath(relativePath),
        line: lineNumberFromIndex(sourceText, importEntry.index),
        specifier: importEntry.specifier,
      });
    }
  }

  return violations.sort((left, right) => {
    if (left.file !== right.file) {
      return left.file.localeCompare(right.file);
    }

    if (left.line !== right.line) {
      return left.line - right.line;
    }

    return left.specifier.localeCompare(right.specifier);
  });
}

/**
 * @param {PiMonoViolation[]} violations
 * @returns {string}
 */
export function formatViolations(violations) {
  const lines = [
    "[POLAR-IMPORT-BOUNDARY] Found disallowed pi-mono imports outside packages/polar-adapter-pi:",
    ...violations.map(
      (violation) =>
        `- ${violation.file}:${violation.line} imports "${violation.specifier}"`,
    ),
  ];
  return lines.join("\n");
}

function runCli() {
  const workspaceRoot = process.cwd();
  const violations = collectPiMonoImportViolations(workspaceRoot);

  if (violations.length > 0) {
    process.stderr.write(`${formatViolations(violations)}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    "[POLAR-IMPORT-BOUNDARY] No disallowed pi-mono imports found.\n",
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli();
}
