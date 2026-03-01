import crypto from "node:crypto";
import { RuntimeExecutionError } from "../../polar-domain/src/index.mjs";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeIdSegment(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} content
 * @returns {string}
 */
function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * @param {readonly string[]|undefined} value
 * @returns {readonly string[]}
 */
function normalizeStringList(value) {
  const items = value ?? [];
  const deduped = new Set();
  for (const item of items) {
    if (typeof item === "string" && item.length > 0) {
      deduped.add(item);
    }
  }

  return Object.freeze([...deduped].sort((left, right) => left.localeCompare(right)));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sortedEntries = Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [key, sortJsonValue(value[key])]);
  return Object.fromEntries(sortedEntries);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJsonStringify(value) {
  return JSON.stringify(sortJsonValue(value));
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {string}
 */
function resolveDescriptorName(descriptor) {
  for (const field of ["name_for_model", "name", "id"]) {
    const value = descriptor[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  throw new RuntimeExecutionError("Plugin descriptor must include name_for_model, name, or id");
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {string}
 */
function resolvePluginId(descriptor) {
  for (const field of ["id", "name_for_model", "name"]) {
    const value = descriptor[field];
    if (typeof value === "string" && value.length > 0) {
      const slug = toSlug(value);
      if (slug.length > 0) {
        return slug;
      }
    }
  }

  throw new RuntimeExecutionError("Plugin descriptor id/name cannot be normalized");
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {readonly unknown[]}
 */
function resolveDescriptorCapabilities(descriptor) {
  if (Array.isArray(descriptor.capabilities)) {
    return descriptor.capabilities;
  }

  if (
    isPlainObject(descriptor.api) &&
    Array.isArray(descriptor.api.operations)
  ) {
    return descriptor.api.operations;
  }

  throw new RuntimeExecutionError(
    "Plugin descriptor must include capabilities array or api.operations array",
  );
}

/**
 * @param {unknown} value
 * @returns {"none"|string}
 */
function normalizeAuthScheme(value) {
  if (value === undefined || value === null) {
    return "none";
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new RuntimeExecutionError("Plugin auth scheme must be a non-empty string");
  }

  return value.toLowerCase();
}

/**
 * @param {string} extensionId
 * @param {Record<string, unknown>} descriptor
 * @returns {Record<string, unknown>}
 */
function buildPluginManifest(extensionId, descriptor) {
  const name = resolveDescriptorName(descriptor);
  const pluginId = resolvePluginId(descriptor);
  const descriptorHash = sha256(stableJsonStringify(descriptor));
  const descriptorPermissions = normalizeStringList(
    /** @type {readonly string[]|undefined} */(descriptor.permissions),
  );
  const capabilityCandidates = resolveDescriptorCapabilities(descriptor);
  const defaultAuthScheme = normalizeAuthScheme(
    isPlainObject(descriptor.auth) ? descriptor.auth.type : undefined,
  );

  const capabilities = [];
  const knownCapabilityIds = new Set();
  const permissionAccumulator = new Set(descriptorPermissions);
  const requiredAuthSchemes = new Set();

  for (const capabilityCandidate of capabilityCandidates) {
    if (!isPlainObject(capabilityCandidate)) {
      throw new RuntimeExecutionError("Plugin capability entries must be plain objects");
    }

    const operationIdCandidate =
      capabilityCandidate.operationId ??
      capabilityCandidate.id ??
      capabilityCandidate.name;
    if (
      typeof operationIdCandidate !== "string" ||
      operationIdCandidate.length === 0
    ) {
      throw new RuntimeExecutionError(
        "Plugin capability entries require operationId, id, or name",
      );
    }
    const operationId = operationIdCandidate;
    const operationSegment = normalizeIdSegment(operationId);
    if (operationSegment.length === 0) {
      throw new RuntimeExecutionError(`Plugin operation id cannot be normalized: ${operationId}`);
    }

    const capabilityIdCandidate = capabilityCandidate.capabilityId;
    const capabilityId =
      typeof capabilityIdCandidate === "string" && capabilityIdCandidate.length > 0
        ? capabilityIdCandidate
        : `${extensionId}.${operationSegment}`;
    if (knownCapabilityIds.has(capabilityId)) {
      throw new RuntimeExecutionError(`Duplicate plugin capability id: ${capabilityId}`);
    }
    knownCapabilityIds.add(capabilityId);

    const methodCandidate =
      capabilityCandidate.method ?? capabilityCandidate.httpMethod;
    const method =
      typeof methodCandidate === "string" && methodCandidate.length > 0
        ? methodCandidate.toUpperCase()
        : "POST";

    const pathCandidate = capabilityCandidate.path ?? capabilityCandidate.route;
    const path =
      typeof pathCandidate === "string" && pathCandidate.length > 0
        ? pathCandidate
        : `/operations/${operationSegment}`;

    const authScheme = normalizeAuthScheme(
      capabilityCandidate.authScheme ??
      (isPlainObject(capabilityCandidate.auth)
        ? capabilityCandidate.auth.type
        : undefined) ??
      defaultAuthScheme,
    );
    if (authScheme !== "none") {
      requiredAuthSchemes.add(authScheme);
    }

    const capabilityPermissions = normalizeStringList([
      ...(Array.isArray(capabilityCandidate.permissions)
        ? capabilityCandidate.permissions
        : []),
      `plugin.operation.${operationSegment}`,
    ]);
    for (const permission of capabilityPermissions) {
      permissionAccumulator.add(permission);
    }

    const normalizedCapability = {
      capabilityId,
      operationId,
      method,
      path,
      authScheme,
      permissions: capabilityPermissions,
    };
    if (
      typeof capabilityCandidate.description === "string" &&
      capabilityCandidate.description.length > 0
    ) {
      normalizedCapability.description = capabilityCandidate.description;
    }
    if (capabilityCandidate.inputSchema !== undefined) {
      normalizedCapability.inputSchema = capabilityCandidate.inputSchema;
    }
    if (capabilityCandidate.outputSchema !== undefined) {
      normalizedCapability.outputSchema = capabilityCandidate.outputSchema;
    }

    capabilities.push(Object.freeze(normalizedCapability));
  }

  if (capabilities.length === 0) {
    throw new RuntimeExecutionError("Plugin descriptor must include at least one capability");
  }
  capabilities.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));

  const manifest = {
    extensionId,
    extensionType: "plugin",
    pluginId,
    name,
    descriptorHash,
    permissions: Object.freeze(
      [...permissionAccumulator].sort((left, right) => left.localeCompare(right)),
    ),
    requiredAuthSchemes: Object.freeze(
      [...requiredAuthSchemes].sort((left, right) => left.localeCompare(right)),
    ),
    capabilities: Object.freeze(capabilities.map((capability) => Object.freeze({ ...capability }))),
  };
  if (
    typeof descriptor.description_for_model === "string" &&
    descriptor.description_for_model.length > 0
  ) {
    manifest.description = descriptor.description_for_model;
  } else if (
    typeof descriptor.description === "string" &&
    descriptor.description.length > 0
  ) {
    manifest.description = descriptor.description;
  }

  return Object.freeze(manifest);
}

/**
 * @param {{ pluginDescriptor: Record<string, unknown>, extensionId?: string }} request
 * @returns {Record<string, unknown>}
 */
export function mapPluginDescriptor(request) {
  if (!isPlainObject(request)) {
    throw new RuntimeExecutionError("Plugin descriptor mapping request must be a plain object");
  }

  const descriptor = request.pluginDescriptor;
  if (!isPlainObject(descriptor)) {
    throw new RuntimeExecutionError("pluginDescriptor must be a plain object");
  }

  const resolvedExtensionId =
    typeof request.extensionId === "string" && request.extensionId.length > 0
      ? request.extensionId
      : `plugin.${resolvePluginId(descriptor)}`;
  if (!resolvedExtensionId.startsWith("plugin.")) {
    throw new RuntimeExecutionError("Plugin extensionId must use plugin.* namespace");
  }

  return buildPluginManifest(resolvedExtensionId, descriptor);
}

/**
 * @param {{ pluginManifest: Record<string, unknown>, authBindings?: Record<string, unknown> }} request
 * @returns {Record<string, unknown>}
 */
export function verifyPluginAuthBindings(request) {
  if (!isPlainObject(request)) {
    throw new RuntimeExecutionError("Plugin auth binding verification request must be a plain object");
  }

  if (!isPlainObject(request.pluginManifest)) {
    throw new RuntimeExecutionError("pluginManifest must be a plain object");
  }

  const authBindings = request.authBindings ?? {};
  if (!isPlainObject(authBindings)) {
    throw new RuntimeExecutionError("authBindings must be a plain object when provided");
  }

  const requiredSchemes = normalizeStringList(
    /** @type {readonly string[]|undefined} */(request.pluginManifest.requiredAuthSchemes),
  );
  const providedSchemes = Object.freeze(
    Object.keys(authBindings)
      .filter((scheme) => typeof scheme === "string" && scheme.length > 0)
      .sort((left, right) => left.localeCompare(right)),
  );

  const providedSet = new Set(providedSchemes);
  const missingSchemes = Object.freeze(
    requiredSchemes.filter((scheme) => !providedSet.has(scheme)),
  );

  return Object.freeze({
    ok: missingSchemes.length === 0,
    status: missingSchemes.length === 0 ? "bound" : "missing",
    requiredSchemes,
    providedSchemes,
    missingSchemes,
  });
}

/**
 * @param {Record<string, unknown>} config
 * @returns {{ executeCapability: (request: Record<string, unknown>) => Promise<unknown> }}
 */
export function createPluginCapabilityAdapter(config) {
  if (!isPlainObject(config)) {
    throw new RuntimeExecutionError("createPluginCapabilityAdapter config must be a plain object");
  }

  if (typeof config.invokeOperation !== "function") {
    throw new RuntimeExecutionError("createPluginCapabilityAdapter requires invokeOperation");
  }

  if (!isPlainObject(config.pluginManifest)) {
    throw new RuntimeExecutionError("createPluginCapabilityAdapter requires pluginManifest");
  }

  const pluginManifest = config.pluginManifest;
  const extensionId = pluginManifest.extensionId;
  const pluginId = pluginManifest.pluginId;
  const descriptorHash = pluginManifest.descriptorHash;
  if (typeof extensionId !== "string" || extensionId.length === 0) {
    throw new RuntimeExecutionError("pluginManifest.extensionId must be a non-empty string");
  }
  if (typeof pluginId !== "string" || pluginId.length === 0) {
    throw new RuntimeExecutionError("pluginManifest.pluginId must be a non-empty string");
  }
  if (typeof descriptorHash !== "string" || descriptorHash.length === 0) {
    throw new RuntimeExecutionError("pluginManifest.descriptorHash must be a non-empty string");
  }

  const authBindings = isPlainObject(config.authBindings) ? config.authBindings : {};

  const capabilityMap = new Map();
  const capabilities = Array.isArray(pluginManifest.capabilities)
    ? pluginManifest.capabilities
    : [];
  for (const capabilityCandidate of capabilities) {
    if (!isPlainObject(capabilityCandidate)) {
      continue;
    }

    const capabilityId = capabilityCandidate.capabilityId;
    const operationId = capabilityCandidate.operationId;
    const method = capabilityCandidate.method;
    const path = capabilityCandidate.path;
    const authScheme = capabilityCandidate.authScheme;

    if (
      typeof capabilityId !== "string" ||
      capabilityId.length === 0 ||
      typeof operationId !== "string" ||
      operationId.length === 0 ||
      typeof method !== "string" ||
      method.length === 0 ||
      typeof path !== "string" ||
      path.length === 0 ||
      typeof authScheme !== "string" ||
      authScheme.length === 0
    ) {
      continue;
    }

    capabilityMap.set(capabilityId, {
      operationId,
      method,
      path,
      authScheme,
    });
  }

  if (capabilityMap.size === 0) {
    throw new RuntimeExecutionError("pluginManifest.capabilities must include at least one valid capability");
  }

  return Object.freeze({
    /**
     * @param {Record<string, unknown>} request
     * @returns {Promise<unknown>}
     */
    async executeCapability(request) {
      if (!isPlainObject(request)) {
        throw new RuntimeExecutionError("Plugin executeCapability request must be a plain object");
      }

      const capabilityId = request.capabilityId;
      if (typeof capabilityId !== "string" || capabilityId.length === 0) {
        throw new RuntimeExecutionError("Plugin executeCapability request must include capabilityId");
      }

      const capability = capabilityMap.get(capabilityId);
      if (!capability) {
        throw new RuntimeExecutionError(`Unknown plugin capability: ${capabilityId}`);
      }

      const authBinding =
        capability.authScheme === "none"
          ? undefined
          : authBindings[capability.authScheme];
      if (capability.authScheme !== "none" && authBinding === undefined) {
        throw new RuntimeExecutionError(
          `Missing auth binding for plugin capability scheme: ${capability.authScheme}`,
        );
      }

      const result = await config.invokeOperation({
        extensionId,
        pluginId,
        descriptorHash,
        capabilityId,
        operationId: capability.operationId,
        method: capability.method,
        path: capability.path,
        authScheme: capability.authScheme,
        authBinding,
        sessionId: request.sessionId,
        userId: request.userId,
        capabilityScope: request.capabilityScope,
        input: request.input,
        trustLevel: request.trustLevel,
        metadata: request.metadata,
      });

      return Object.freeze({
        extensionId,
        pluginId,
        capabilityId,
        descriptorHash,
        operationId: capability.operationId,
        method: capability.method,
        path: capability.path,
        result,
      });
    },
  });
}
