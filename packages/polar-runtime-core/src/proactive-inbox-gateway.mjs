import {
  ContractValidationError,
  PROACTIVE_INBOX_ACTIONS,
  PROACTIVE_INBOX_CAPABILITIES,
  RuntimeExecutionError,
  createProactiveInboxContracts,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
} from "@polar/domain";

const checkHeadersRequestSchema = createStrictObjectSchema({
  schemaId: "proactive-inbox.gateway.check-headers.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    connectorId: stringField({ minLength: 1, required: false }),
    lookbackHours: numberField({ min: 1, max: 168, required: false }),
    maxHeaders: numberField({ min: 1, max: 100, required: false }),
    capabilities: stringArrayField({ minItems: 1, required: false }),
    mode: enumField(["headers_only", "read_body"], { required: false }),
    metadata: jsonField({ required: false }),
  },
});

const readBodyRequestSchema = createStrictObjectSchema({
  schemaId: "proactive-inbox.gateway.read-body.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    connectorId: stringField({ minLength: 1, required: false }),
    messageId: stringField({ minLength: 1 }),
    capabilities: stringArrayField({ minItems: 1, required: false }),
    metadata: jsonField({ required: false }),
  },
});

function validateRequest(schema, value) {
  const validation = schema.validate(value);
  if (!validation.ok) {
    throw new ContractValidationError(`Invalid ${schema.schemaId}`, {
      schemaId: schema.schemaId,
      errors: validation.errors ?? [],
    });
  }
  return /** @type {Record<string, unknown>} */ (validation.value);
}

function hasCapability(capabilities, capability) {
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

function normalizeHeaders(value) {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  const items = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.messageId === "string" &&
      typeof item.subject === "string" &&
      typeof item.from === "string"
    ) {
      items.push(
        Object.freeze({
          messageId: item.messageId,
          subject: item.subject,
          from: item.from,
          ...((
            typeof item.senderDomain === "string"
              ? item.senderDomain
              : item.from.includes("@")
                ? item.from.split("@").pop()
                : undefined
          )
            ? {
                senderDomain:
                  typeof item.senderDomain === "string"
                    ? item.senderDomain
                    : item.from.split("@").pop(),
              }
            : {}),
          ...(typeof item.receivedAt === "string"
            ? {
                receivedAt: item.receivedAt,
              }
            : {}),
        }),
      );
    }
  }
  return Object.freeze(items);
}

export function registerProactiveInboxContracts(contractRegistry) {
  for (const contract of createProactiveInboxContracts()) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   inboxConnector?: {
 *     searchHeaders?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     readBody?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat"
 * }} config
 */
export function createProactiveInboxGateway({
  middlewarePipeline,
  inboxConnector,
  defaultExecutionType = "automation",
}) {
  if (!middlewarePipeline || typeof middlewarePipeline.run !== "function") {
    throw new RuntimeExecutionError("middlewarePipeline.run is required");
  }

  const connector = inboxConnector ?? {};
  const isConfigured = typeof connector.searchHeaders === "function";

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async checkHeaders(request) {
      const parsed = validateRequest(checkHeadersRequestSchema, request);
      const capabilities = Array.isArray(parsed.capabilities)
        ? parsed.capabilities
        : Object.freeze([PROACTIVE_INBOX_CAPABILITIES[0]]);
      const mode = parsed.mode === "read_body" ? "read_body" : "headers_only";

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: PROACTIVE_INBOX_ACTIONS.checkHeaders.actionId,
          version: PROACTIVE_INBOX_ACTIONS.checkHeaders.version,
          input: {
            sessionId: parsed.sessionId,
            userId: parsed.userId,
            ...(parsed.connectorId !== undefined ? { connectorId: parsed.connectorId } : {}),
            ...(parsed.lookbackHours !== undefined ? { lookbackHours: parsed.lookbackHours } : {}),
            ...(parsed.maxHeaders !== undefined ? { maxHeaders: parsed.maxHeaders } : {}),
            capabilities,
            mode,
            ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
          },
        },
        async (input) => {
          if (!hasCapability(input.capabilities, "mail.search_headers")) {
            return {
              status: "blocked",
              mode,
              blockedReason: "capability_mail.search_headers_required",
              connectorStatus: isConfigured ? "configured" : "not_configured",
              headerCount: 0,
              headers: Object.freeze([]),
            };
          }

          if (!isConfigured) {
            return {
              status: "degraded",
              mode,
              degradedReason: "inbox_connector_not_configured",
              connectorStatus: "not_configured",
              headerCount: 0,
              headers: Object.freeze([]),
            };
          }

          const rawHeaders = await connector.searchHeaders({
            sessionId: input.sessionId,
            userId: input.userId,
            connectorId: input.connectorId,
            lookbackHours: input.lookbackHours ?? 24,
            maxHeaders: input.maxHeaders ?? 20,
            metadata: input.metadata,
          });
          const headers = normalizeHeaders(rawHeaders);

          return {
            status: "completed",
            mode,
            connectorStatus: "configured",
            headerCount: headers.length,
            headers,
          };
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async readBody(request) {
      const parsed = validateRequest(readBodyRequestSchema, request);
      const capabilities = Array.isArray(parsed.capabilities)
        ? parsed.capabilities
        : Object.freeze([PROACTIVE_INBOX_CAPABILITIES[0]]);
      const canReadBody = hasCapability(capabilities, "mail.read_body");

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: PROACTIVE_INBOX_ACTIONS.readBody.actionId,
          version: PROACTIVE_INBOX_ACTIONS.readBody.version,
          input: {
            sessionId: parsed.sessionId,
            userId: parsed.userId,
            messageId: parsed.messageId,
            ...(parsed.connectorId !== undefined ? { connectorId: parsed.connectorId } : {}),
            capabilities,
            ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
          },
        },
        async (input) => {
          if (!canReadBody) {
            return {
              status: "blocked",
              blockedReason: "capability_mail.read_body_requires_explicit_permission",
              connectorStatus: isConfigured ? "configured" : "not_configured",
              messageId: input.messageId,
            };
          }

          if (typeof connector.readBody !== "function") {
            return {
              status: "degraded",
              degradedReason: "inbox_connector_not_configured",
              connectorStatus: "not_configured",
              messageId: input.messageId,
            };
          }

          const bodyValue = await connector.readBody({
            sessionId: input.sessionId,
            userId: input.userId,
            connectorId: input.connectorId,
            messageId: input.messageId,
            metadata: input.metadata,
          });
          const body =
            typeof bodyValue === "string" && bodyValue.trim().length > 0
              ? bodyValue
              : "";
          if (body.length === 0) {
            return {
              status: "degraded",
              degradedReason: "inbox_connector_empty_body",
              connectorStatus: "configured",
              messageId: input.messageId,
            };
          }
          return {
            status: "completed",
            connectorStatus: "configured",
            messageId: input.messageId,
            body,
          };
        },
      );
    },
  });
}
