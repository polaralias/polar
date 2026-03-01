/**
 * Extension adapter registry for skills, MCP tools, and plugin wrappers.
 */
import { RuntimeExecutionError } from "@polar/domain";

export function createExtensionAdapterRegistry() {
  const extensions = new Map();

  return Object.freeze({
    register(extensionId, adapter) {
      if (typeof extensionId !== "string" || extensionId.length === 0) {
        throw new RuntimeExecutionError("extensionId must be a non-empty string");
      }

      if (typeof adapter !== "object" || adapter === null) {
        throw new RuntimeExecutionError("extension adapter must be an object");
      }

      if (typeof adapter.executeCapability !== "function") {
        throw new RuntimeExecutionError("extension adapter must expose executeCapability(request)");
      }

      if (extensions.has(extensionId)) {
        throw new RuntimeExecutionError(`extension adapter already registered: ${extensionId}`);
      }

      extensions.set(extensionId, adapter);
    },
    upsert(extensionId, adapter) {
      if (typeof extensionId !== "string" || extensionId.length === 0) {
        throw new RuntimeExecutionError("extensionId must be a non-empty string");
      }

      if (typeof adapter !== "object" || adapter === null) {
        throw new RuntimeExecutionError("extension adapter must be an object");
      }

      if (typeof adapter.executeCapability !== "function") {
        throw new RuntimeExecutionError("extension adapter must expose executeCapability(request)");
      }

      extensions.set(extensionId, adapter);
    },
    get(extensionId) {
      return extensions.get(extensionId);
    },
    list() {
      return Object.freeze([...extensions.keys()].sort((left, right) => left.localeCompare(right)));
    },
  });
}

/**
 * @param {readonly string[]|undefined} value
 * @param {string} fieldName
 * @returns {readonly string[]}
 */
function normalizePermissionList(value, fieldName) {
  const permissions = value ?? [];
  if (!Array.isArray(permissions)) {
    throw new RuntimeExecutionError(`${fieldName} must be an array when provided`);
  }

  const deduped = new Set();
  for (let index = 0; index < permissions.length; index += 1) {
    const permission = permissions[index];
    if (typeof permission !== "string" || permission.length === 0) {
      throw new RuntimeExecutionError(`${fieldName}[${index}] must be a non-empty string`);
    }

    deduped.add(permission);
  }

  return Object.freeze([...deduped].sort((left, right) => left.localeCompare(right)));
}

/**
 * @param {readonly string[]|undefined} previousPermissions
 * @param {readonly string[]|undefined} nextPermissions
 */
export function createPermissionDeltaReport(previousPermissions, nextPermissions) {
  const previous = normalizePermissionList(previousPermissions, "previousPermissions");
  const next = normalizePermissionList(nextPermissions, "nextPermissions");
  const previousSet = new Set(previous);
  const nextSet = new Set(next);

  const added = [];
  const removed = [];
  const retained = [];

  for (const permission of next) {
    if (!previousSet.has(permission)) {
      added.push(permission);
    } else {
      retained.push(permission);
    }
  }

  for (const permission of previous) {
    if (!nextSet.has(permission)) {
      removed.push(permission);
    }
  }

  return Object.freeze({
    added: Object.freeze([...added]),
    removed: Object.freeze([...removed]),
    retained: Object.freeze([...retained]),
  });
}

export {
  createSkillCapabilityAdapter,
  parseSkillManifest,
  verifySkillProvenance,
} from "./skill-installer.mjs";
export {
  createMcpCapabilityAdapter,
  createMcpConnectionAdapter,
  mapMcpToolCatalog,
  verifyMcpConnectionHealth,
} from "./mcp-connector.mjs";
export {
  createPluginCapabilityAdapter,
  mapPluginDescriptor,
  verifyPluginAuthBindings,
} from "./plugin-connector.mjs";
