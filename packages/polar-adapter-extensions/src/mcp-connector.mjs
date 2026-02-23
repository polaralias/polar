import crypto from "node:crypto";

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
function normalizeIdSegment(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
function normalizePermissions(value) {
  const permissions = value ?? [];
  const deduped = new Set();
  for (const permission of permissions) {
    if (typeof permission === "string" && permission.length > 0) {
      deduped.add(permission);
    }
  }

  return Object.freeze([...deduped].sort((left, right) => left.localeCompare(right)));
}

/**
 * @param {Record<string, unknown>} tool
 * @returns {string}
 */
function resolveToolId(tool) {
  for (const field of ["toolId", "id", "name"]) {
    const value = tool[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  throw new Error("MCP tool is missing toolId/id/name");
}

/**
 * @param {{
 *   serverId: string,
 *   tools: readonly unknown[],
 *   extensionId?: string
 * }} request
 * @returns {Record<string, unknown>}
 */
export function mapMcpToolCatalog(request) {
  if (!isPlainObject(request)) {
    throw new Error("MCP catalog mapping request must be a plain object");
  }

  const serverId = request.serverId;
  if (typeof serverId !== "string" || serverId.length === 0) {
    throw new Error("MCP catalog mapping requires serverId");
  }

  const tools = request.tools;
  if (!Array.isArray(tools)) {
    throw new Error("MCP catalog mapping requires tools array");
  }

  const defaultExtensionId = `mcp.${toSlug(serverId)}`;
  const extensionId =
    typeof request.extensionId === "string" && request.extensionId.length > 0
      ? request.extensionId
      : defaultExtensionId;
  if (!extensionId.startsWith("mcp.")) {
    throw new Error("MCP extensionId must use mcp.* namespace");
  }

  const normalizedTools = [];
  const knownToolIds = new Set();
  const knownCapabilityIds = new Set();
  const permissionAccumulator = new Set();

  for (const toolCandidate of tools) {
    if (!isPlainObject(toolCandidate)) {
      throw new Error("MCP tool entries must be plain objects");
    }

    const toolId = resolveToolId(toolCandidate);
    if (knownToolIds.has(toolId)) {
      throw new Error(`Duplicate MCP tool id in catalog: ${toolId}`);
    }
    knownToolIds.add(toolId);

    const normalizedToolSegment = normalizeIdSegment(toolId);
    if (normalizedToolSegment.length === 0) {
      throw new Error(`MCP tool id cannot be normalized: ${toolId}`);
    }

    const capabilityId = `${extensionId}.${normalizedToolSegment}`;
    if (knownCapabilityIds.has(capabilityId)) {
      throw new Error(`Duplicate MCP capability id in catalog: ${capabilityId}`);
    }
    knownCapabilityIds.add(capabilityId);

    const toolPermissions = normalizePermissions([
      ...(Array.isArray(toolCandidate.permissions) ? toolCandidate.permissions : []),
      `mcp.tool.${normalizedToolSegment}`,
    ]);
    for (const permission of toolPermissions) {
      permissionAccumulator.add(permission);
    }

    const capability = {
      capabilityId,
      toolId,
      permissions: toolPermissions,
    };
    if (
      typeof toolCandidate.description === "string" &&
      toolCandidate.description.length > 0
    ) {
      capability.description = toolCandidate.description;
    }
    if (toolCandidate.inputSchema !== undefined) {
      capability.inputSchema = toolCandidate.inputSchema;
    }
    if (toolCandidate.outputSchema !== undefined) {
      capability.outputSchema = toolCandidate.outputSchema;
    }

    normalizedTools.push(Object.freeze(capability));
  }

  if (normalizedTools.length === 0) {
    throw new Error("MCP catalog must include at least one tool");
  }

  normalizedTools.sort((left, right) => left.toolId.localeCompare(right.toolId));

  const canonicalCatalog = normalizedTools.map((tool) => ({
    capabilityId: tool.capabilityId,
    toolId: tool.toolId,
    description: tool.description,
    permissions: tool.permissions,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }));

  return Object.freeze({
    extensionId,
    extensionType: "mcp",
    serverId,
    catalogHash: sha256(JSON.stringify(canonicalCatalog)),
    permissions: Object.freeze(
      [...permissionAccumulator].sort((left, right) => left.localeCompare(right)),
    ),
    capabilities: Object.freeze(normalizedTools.map((tool) => Object.freeze({ ...tool }))),
  });
}

/**
 * @param {unknown} health
 * @returns {Record<string, unknown>}
 */
export function verifyMcpConnectionHealth(health) {
  if (!isPlainObject(health)) {
    throw new Error("MCP health response must be a plain object");
  }

  const healthy =
    typeof health.healthy === "boolean"
      ? health.healthy
      : typeof health.ok === "boolean"
        ? health.ok
        : health.status === "ok" || health.status === "healthy";
  const status =
    typeof health.status === "string" && health.status.length > 0
      ? health.status
      : healthy
        ? "ok"
        : "unhealthy";

  const normalized = {
    healthy,
    status,
  };

  if (
    typeof health.latencyMs === "number" &&
    Number.isFinite(health.latencyMs) &&
    health.latencyMs >= 0
  ) {
    normalized.latencyMs = Math.trunc(health.latencyMs);
  }

  if (health.reason !== undefined) {
    normalized.reason = health.reason;
  }

  if (health.details !== undefined) {
    normalized.details = health.details;
  }

  return Object.freeze(normalized);
}

/**
 * @param {{
 *   mcpManifest: Record<string, unknown>,
 *   invokeTool: (request: Record<string, unknown>) => Promise<unknown>|unknown
 * }} config
 * @returns {{ executeCapability: (request: Record<string, unknown>) => Promise<unknown> }}
 */
export function createMcpCapabilityAdapter(config) {
  if (!isPlainObject(config)) {
    throw new Error("createMcpCapabilityAdapter config must be a plain object");
  }

  if (typeof config.invokeTool !== "function") {
    throw new Error("createMcpCapabilityAdapter requires invokeTool");
  }

  const mcpManifest = config.mcpManifest;
  if (!isPlainObject(mcpManifest)) {
    throw new Error("createMcpCapabilityAdapter requires mcpManifest");
  }

  const extensionId = mcpManifest.extensionId;
  const serverId = mcpManifest.serverId;
  const catalogHash = mcpManifest.catalogHash;
  const capabilities = Array.isArray(mcpManifest.capabilities)
    ? mcpManifest.capabilities
    : [];

  if (typeof extensionId !== "string" || extensionId.length === 0) {
    throw new Error("mcpManifest.extensionId must be a non-empty string");
  }
  if (typeof serverId !== "string" || serverId.length === 0) {
    throw new Error("mcpManifest.serverId must be a non-empty string");
  }
  if (typeof catalogHash !== "string" || catalogHash.length === 0) {
    throw new Error("mcpManifest.catalogHash must be a non-empty string");
  }

  const capabilityToTool = new Map();
  for (const capability of capabilities) {
    if (!isPlainObject(capability)) {
      continue;
    }

    const capabilityId = capability.capabilityId;
    const toolId = capability.toolId;
    if (
      typeof capabilityId !== "string" ||
      capabilityId.length === 0 ||
      typeof toolId !== "string" ||
      toolId.length === 0
    ) {
      continue;
    }

    capabilityToTool.set(capabilityId, toolId);
  }

  if (capabilityToTool.size === 0) {
    throw new Error("mcpManifest.capabilities must include at least one valid capability");
  }

  return Object.freeze({
    /**
     * @param {Record<string, unknown>} request
     * @returns {Promise<unknown>}
     */
    async executeCapability(request) {
      if (!isPlainObject(request)) {
        throw new Error("MCP executeCapability request must be a plain object");
      }

      const capabilityId = request.capabilityId;
      if (typeof capabilityId !== "string" || capabilityId.length === 0) {
        throw new Error("MCP executeCapability request must include capabilityId");
      }

      const toolId = capabilityToTool.get(capabilityId);
      if (!toolId) {
        throw new Error(`Unknown MCP capability: ${capabilityId}`);
      }

      const result = await config.invokeTool({
        serverId,
        toolId,
        capabilityId,
        sessionId: request.sessionId,
        userId: request.userId,
        capabilityScope: request.capabilityScope,
        input: request.input,
        trustLevel: request.trustLevel,
        metadata: request.metadata,
      });

      return Object.freeze({
        extensionId,
        serverId,
        toolId,
        capabilityId,
        catalogHash,
        result,
      });
    },
  });
}

/**
 * @param {{
 *   serverId: string,
 *   extensionId?: string,
 *   probeConnection?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *   listTools: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *   invokeTool: (request: Record<string, unknown>) => Promise<unknown>|unknown
 * }} config
 */
export function createMcpConnectionAdapter(config) {
  if (!isPlainObject(config)) {
    throw new Error("createMcpConnectionAdapter config must be a plain object");
  }

  if (typeof config.serverId !== "string" || config.serverId.length === 0) {
    throw new Error("createMcpConnectionAdapter requires serverId");
  }

  if (typeof config.listTools !== "function") {
    throw new Error("createMcpConnectionAdapter requires listTools(request)");
  }

  if (typeof config.invokeTool !== "function") {
    throw new Error("createMcpConnectionAdapter requires invokeTool(request)");
  }

  return Object.freeze({
    /**
     * @param {Record<string, unknown>} request
     */
    async probeConnection(request = {}) {
      if (config.probeConnection) {
        const rawHealth = await config.probeConnection(request);
        return verifyMcpConnectionHealth(rawHealth);
      }

      return Object.freeze({
        healthy: true,
        status: "ok",
      });
    },

    /**
     * @param {Record<string, unknown>} request
     */
    async importToolCatalog(request = {}) {
      const rawCatalog = await config.listTools(request);
      const tools = Array.isArray(rawCatalog)
        ? rawCatalog
        : isPlainObject(rawCatalog) && Array.isArray(rawCatalog.tools)
          ? rawCatalog.tools
          : null;
      if (!tools) {
        throw new Error("MCP listTools must return a tools array");
      }

      return mapMcpToolCatalog({
        serverId: config.serverId,
        extensionId: config.extensionId,
        tools,
      });
    },

    /**
     * @param {Record<string, unknown>} mcpManifest
     */
    createCapabilityAdapter(mcpManifest) {
      return createMcpCapabilityAdapter({
        mcpManifest,
        invokeTool: config.invokeTool,
      });
    },
  });
}
