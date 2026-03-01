import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  booleanField,
  ContractValidationError,
  createStrictObjectSchema,
  enumField,
  isPlainObject,
  jsonField,
  numberField,
  stringField,
} from "@polar/domain";
import {
  createExtensionAdapterRegistry,
  parseSkillManifest,
  verifySkillProvenance,
  createSkillCapabilityAdapter,
  mapMcpToolCatalog,
  createMcpConnectionAdapter,
  mapPluginDescriptor,
  verifyPluginAuthBindings,
  createPluginCapabilityAdapter,
} from "@polar/adapter-extensions";
import {
  createDefaultIngressHealthChecks,
  createDefaultIngressNormalizers,
} from "@polar/adapter-channels";
import { createNativeHttpAdapter } from "@polar/adapter-native";
import { computeCapabilityScope } from "@polar/runtime-core";
import {
  createChatIngressGateway,
  createChatManagementGateway,
  createContractRegistry,
  createControlPlaneGateway,
  createCryptoVault,
  createBudgetGateway,
  createHandoffRoutingTelemetryCollector,
  createHandoffRoutingTelemetryGateway,
  createSchedulerGateway,
  createTelemetryAlertGateway,
  createUsageTelemetryCollector,
  createUsageTelemetryGateway,
  createMiddlewarePipeline,
  createProfileResolutionGateway,
  createTaskBoardGateway,
  registerBudgetContracts,
  registerChatIngressContract,
  registerChatManagementContracts,
  registerControlPlaneContracts,
  registerHandoffRoutingTelemetryContract,
  registerProfileResolutionContract,
  registerSchedulerContracts,
  registerTelemetryAlertContract,
  registerTelemetryAlertRouteContract,
  registerTaskBoardContracts,
  registerUsageTelemetryContract,
  createProviderGateway,
  registerProviderOperationContracts,
  createExtensionGateway,
  registerExtensionContracts,
  createSkillInstallerGateway,
  registerSkillInstallerContract,
  createSkillRegistry,
  createAutomationGateway,
  registerAutomationContracts,
  createHeartbeatGateway,
  registerHeartbeatContract,
  createMcpConnectorGateway,
  registerMcpConnectorContract,
  createPluginInstallerGateway,
  registerPluginInstallerContract,
  createMemoryGateway,
  registerMemoryContracts,
  createProactiveInboxGateway,
  registerProactiveInboxContracts,
  createSqliteRunEventLinker,
  createBudgetMiddleware,
  createMemoryExtractionMiddleware,
  createMemoryRecallMiddleware,
  createToolSynthesisMiddleware,
  createApprovalStore,
  createOrchestrator,
  createDurableLineageStore,
  isRuntimeDevMode,
  createSqliteSchedulerStateStore,
  exportArtifactsFromDb,
  listArtifactFiles,
  parseAutomationSchedule,
} from "@polar/runtime-core";

const feedbackRecordRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.recordFeedbackEvent.request",
  fields: {
    type: stringField({ minLength: 1 }),
    sessionId: stringField({ minLength: 1 }),
    messageId: stringField({ minLength: 1, required: false }),
    emoji: stringField({ minLength: 1, required: false }),
    polarity: enumField(["positive", "negative", "neutral"], { required: false }),
    payload: jsonField({ required: false }),
    createdAtMs: numberField({ min: 0, required: false }),
  },
});

const feedbackListRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.listFeedbackEvents.request",
  fields: {
    sessionId: stringField({ minLength: 1, required: false }),
    type: stringField({ minLength: 1, required: false }),
    messageId: stringField({ minLength: 1, required: false }),
    polarity: enumField(["positive", "negative", "neutral"], { required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
    beforeCreatedAtMs: numberField({ min: 0, required: false }),
    afterCreatedAtMs: numberField({ min: 0, required: false }),
  },
});

const runLedgerListRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.runLedger.list.request",
  fields: {
    fromSequence: numberField({ min: 0, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
    id: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1, required: false }),
    profileId: stringField({ minLength: 1, required: false }),
    trigger: stringField({ minLength: 1, required: false }),
  },
});

const automationJobCreateRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.automationJob.create.request",
  fields: {
    id: stringField({ minLength: 1, required: false }),
    ownerUserId: stringField({ minLength: 1 }),
    sessionId: stringField({ minLength: 1 }),
    schedule: stringField({ minLength: 1 }),
    promptTemplate: stringField({ minLength: 1 }),
    enabled: booleanField({ required: false }),
    quietHours: jsonField({ required: false }),
    limits: jsonField({ required: false }),
  },
});

const automationJobListRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.automationJob.list.request",
  fields: {
    ownerUserId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    enabled: booleanField({ required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
  },
});

const automationJobUpdateRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.automationJob.update.request",
  fields: {
    id: stringField({ minLength: 1 }),
    schedule: stringField({ minLength: 1, required: false }),
    promptTemplate: stringField({ minLength: 1, required: false }),
    enabled: booleanField({ required: false }),
    quietHours: jsonField({ required: false }),
    limits: jsonField({ required: false }),
  },
});

const automationJobDisableRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.automationJob.disable.request",
  fields: {
    id: stringField({ minLength: 1 }),
  },
});

const automationJobGetRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.automationJob.get.request",
  fields: {
    id: stringField({ minLength: 1 }),
  },
});

const automationJobDeleteRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.automationJob.delete.request",
  fields: {
    id: stringField({ minLength: 1 }),
  },
});

const automationJobRunRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.automationJob.run.request",
  fields: {
    id: stringField({ minLength: 1 }),
    sessionId: stringField({ minLength: 1, required: false }),
    userId: stringField({ minLength: 1, required: false }),
  },
});

const automationJobPreviewRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.automationJob.preview.request",
  fields: {
    schedule: stringField({ minLength: 1 }),
    promptTemplate: stringField({ minLength: 1 }),
  },
});

const artifactsExportRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.artifacts.export.request",
  fields: {
    artifactsDir: stringField({ minLength: 1, required: false }),
  },
});

const artifactsShowRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.artifacts.show.request",
  fields: {
    artifactsDir: stringField({ minLength: 1, required: false }),
  },
});

const proactiveInboxCheckRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.proactiveInbox.checkHeaders.request",
  fields: {
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    connectorId: stringField({ minLength: 1, required: false }),
    lookbackHours: numberField({ min: 1, max: 168, required: false }),
    maxHeaders: numberField({ min: 1, max: 100, required: false }),
    capabilities: jsonField({ required: false }),
    mode: enumField(["headers_only", "read_body"], { required: false }),
    metadata: jsonField({ required: false }),
  },
});

const proactiveInboxReadBodyRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.proactiveInbox.readBody.request",
  fields: {
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    connectorId: stringField({ minLength: 1, required: false }),
    messageId: stringField({ minLength: 1 }),
    capabilities: jsonField({ required: false }),
    metadata: jsonField({ required: false }),
  },
});

const proactiveInboxDryRunRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.proactiveInbox.dryRun.request",
  fields: {
    sessionId: stringField({ minLength: 1 }),
    userId: stringField({ minLength: 1 }),
    connectorId: stringField({ minLength: 1, required: false }),
    lookbackHours: numberField({ min: 1, max: 168, required: false }),
    maxNotificationsPerDay: numberField({ min: 1, max: 20, required: false }),
    capabilities: jsonField({ required: false }),
  },
});

const personalityScopeField = enumField(["global", "user", "session"]);

const personalityProfileGetRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.personality.get.request",
  fields: {
    scope: personalityScopeField,
    userId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
  },
});

const personalityEffectiveRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.personality.effective.request",
  fields: {
    userId: stringField({ minLength: 1 }),
    sessionId: stringField({ minLength: 1 }),
  },
});

const personalityProfileUpsertRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.personality.upsert.request",
  fields: {
    scope: personalityScopeField,
    userId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    name: stringField({ minLength: 1, required: false }),
    prompt: stringField({ minLength: 1 }),
  },
});

const personalityProfileResetRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.personality.reset.request",
  fields: {
    scope: personalityScopeField,
    userId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
  },
});

const personalityProfileListRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.personality.list.request",
  fields: {
    scope: enumField(["global", "user", "session"], { required: false }),
    userId: stringField({ minLength: 1, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
  },
});

const modelRegistryGetRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.modelRegistry.get.request",
  fields: {},
});

const modelRegistryUpsertRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.modelRegistry.upsert.request",
  fields: {
    registry: jsonField(),
  },
});

const modelRegistrySetDefaultRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.modelRegistry.setDefault.request",
  fields: {
    providerId: stringField({ minLength: 1 }),
    modelId: stringField({ minLength: 1 }),
  },
});

const agentRegistryGetRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.agentRegistry.get.request",
  fields: {},
});

const agentProfileGetRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.agentProfile.get.request",
  fields: {
    agentId: stringField({ minLength: 3 }),
  },
});

const agentProfileRegisterRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.agentProfile.register.request",
  fields: {
    agentId: stringField({ minLength: 3 }),
    profileId: stringField({ minLength: 1 }),
    description: stringField({ minLength: 1, maxLength: 300 }),
    defaultForwardSkills: jsonField({ required: false }),
    allowedForwardSkills: jsonField({ required: false }),
    defaultMcpServers: jsonField({ required: false }),
    allowedMcpServers: jsonField({ required: false }),
    tags: jsonField({ required: false }),
  },
});

const agentProfileUnregisterRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.agentProfile.unregister.request",
  fields: {
    agentId: stringField({ minLength: 3 }),
  },
});

const pinProfileForScopeRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.profilePin.pin.request",
  fields: {
    scope: enumField(["session", "user", "global"]),
    profileId: stringField({ minLength: 1 }),
    sessionId: stringField({ minLength: 1, required: false }),
    userId: stringField({ minLength: 1, required: false }),
  },
});

const unpinProfileForScopeRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.profilePin.unpin.request",
  fields: {
    scope: enumField(["session", "user", "global"]),
    sessionId: stringField({ minLength: 1, required: false }),
    userId: stringField({ minLength: 1, required: false }),
  },
});

const effectivePinnedProfileRequestSchema = createStrictObjectSchema({
  schemaId: "controlPlane.profilePin.effective.request",
  fields: {
    sessionId: stringField({ minLength: 1, required: false }),
    userId: stringField({ minLength: 1, required: false }),
  },
});

const MODEL_REGISTRY_RESOURCE_TYPE = "policy";
const MODEL_REGISTRY_RESOURCE_ID = "model_registry";
const AGENT_REGISTRY_RESOURCE_TYPE = "policy";
const AGENT_REGISTRY_RESOURCE_ID = "agent-registry:default";
const GLOBAL_PROFILE_PIN_POLICY_ID = "profile-pin:global";
const AGENT_ID_PATTERN = /^@[a-z0-9_-]{2,32}$/;

/**
 * @param {Record<string, unknown>} request
 * @param {string} schemaId
 */
function validatePersonalityScopeRequest(request, schemaId) {
  const scope = request.scope;
  const userId = request.userId;
  const sessionId = request.sessionId;

  if (scope === "global") {
    if (userId !== undefined || sessionId !== undefined) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId} global scope must not include userId or sessionId`],
      });
    }
    return;
  }

  if (scope === "user") {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId} user scope requires userId`],
      });
    }
    if (sessionId !== undefined) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId} user scope must not include sessionId`],
      });
    }
    return;
  }

  if (scope === "session") {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId} session scope requires userId`],
      });
    }
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId} session scope requires sessionId`],
      });
    }
  }
}

/**
 * @param {string} rawSchedule
 */
function normalizeAutomationSchedule(rawSchedule) {
  const schedule = rawSchedule.trim().replace(/\s+/g, " ");
  const dailyMatch = schedule.match(/^daily\s+(\d{1,2}):(\d{2})$/i);
  if (dailyMatch) {
    const hour = Number.parseInt(dailyMatch[1], 10);
    const minute = Number.parseInt(dailyMatch[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new ContractValidationError("Invalid automation schedule", {
        schemaId: "controlPlane.automation.schedule",
        errors: ["daily schedule must be in 24h HH:MM format"],
      });
    }
    return `daily at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  if (parseAutomationSchedule(schedule)) {
    return schedule.toLowerCase();
  }

  throw new ContractValidationError("Invalid automation schedule", {
    schemaId: "controlPlane.automation.schedule",
    errors: [
      "supported formats: daily HH:MM, daily at HH:MM, every <n> minutes|hours|days",
    ],
  });
}

/**
 * @param {unknown} value
 * @returns {{ version: 1, entries: readonly Record<string, unknown>[], defaults: Record<string, unknown>|null }}
 */
function normalizeModelRegistry(value) {
  if (!isPlainObject(value)) {
    return {
      version: 1,
      entries: Object.freeze([]),
      defaults: null,
    };
  }

  const seenEntries = new Set();
  const seenAliases = new Set();
  const normalizedEntries = [];
  const entries = Array.isArray(value.entries) ? value.entries : [];

  for (const entry of entries) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const provider = typeof entry.provider === "string" ? entry.provider.trim() : "";
    const modelId = typeof entry.modelId === "string" ? entry.modelId.trim() : "";
    if (!provider || !modelId) {
      continue;
    }
    const key = `${provider}::${modelId}`;
    if (seenEntries.has(key)) {
      continue;
    }
    const normalized = {
      provider,
      modelId,
    };
    if (typeof entry.alias === "string") {
      const alias = entry.alias.trim();
      if (alias && !seenAliases.has(alias)) {
        normalized.alias = alias;
        seenAliases.add(alias);
      }
    }
    seenEntries.add(key);
    normalizedEntries.push(normalized);
  }

  let defaults = null;
  if (isPlainObject(value.defaults)) {
    const provider = typeof value.defaults.provider === "string" ? value.defaults.provider.trim() : "";
    const modelId = typeof value.defaults.modelId === "string" ? value.defaults.modelId.trim() : "";
    const alias = typeof value.defaults.alias === "string" ? value.defaults.alias.trim() : "";
    if (provider && modelId) {
      defaults = { provider, modelId };
      if (alias) {
        defaults.alias = alias;
      }
    }
  }

  return {
    version: 1,
    entries: Object.freeze(normalizedEntries),
    defaults,
  };
}

/**
 * @param {unknown} value
 */
function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

/**
 * @param {unknown} value
 * @returns {{ version: 1, agents: readonly Record<string, unknown>[] }}
 */
function normalizeAgentRegistry(value) {
  if (!isPlainObject(value)) {
    return {
      version: 1,
      agents: Object.freeze([]),
    };
  }

  const agents = [];
  const seen = new Set();
  for (const agent of Array.isArray(value.agents) ? value.agents : []) {
    if (!isPlainObject(agent)) {
      continue;
    }
    const agentId = typeof agent.agentId === "string" ? agent.agentId.trim() : "";
    const profileId = typeof agent.profileId === "string" ? agent.profileId.trim() : "";
    const description =
      typeof agent.description === "string" ? agent.description.trim() : "";
    if (!agentId || !profileId || !description || seen.has(agentId)) {
      continue;
    }
    if (!AGENT_ID_PATTERN.test(agentId) || description.length > 300) {
      continue;
    }

    const normalized = {
      agentId,
      profileId,
      description,
    };
    const tags = normalizeStringArray(agent.tags);
    const defaultForwardSkills = normalizeStringArray(agent.defaultForwardSkills);
    const allowedForwardSkills = normalizeStringArray(agent.allowedForwardSkills);
    const defaultMcpServers = normalizeStringArray(agent.defaultMcpServers);
    const allowedMcpServers = normalizeStringArray(agent.allowedMcpServers);

    if (tags.length > 0) {
      normalized.tags = tags;
    }
    if (defaultForwardSkills.length > 0) {
      normalized.defaultForwardSkills = defaultForwardSkills;
    }
    if (allowedForwardSkills.length > 0) {
      normalized.allowedForwardSkills = allowedForwardSkills;
    }
    if (defaultMcpServers.length > 0) {
      normalized.defaultMcpServers = defaultMcpServers;
    }
    if (allowedMcpServers.length > 0) {
      normalized.allowedMcpServers = allowedMcpServers;
    }
    agents.push(normalized);
    seen.add(agentId);
  }
  return {
    version: 1,
    agents: Object.freeze(agents),
  };
}

/**
 * @param {unknown} value
 */
function validateAgentRegistryConfig(value) {
  if (!isPlainObject(value)) {
    throw new ContractValidationError("Invalid agent registry config", {
      schemaId: "controlPlane.agentRegistry.config",
      errors: ["registry must be an object"],
    });
  }
  if (value.version !== 1) {
    throw new ContractValidationError("Invalid agent registry config", {
      schemaId: "controlPlane.agentRegistry.config",
      errors: ["registry.version must be 1"],
    });
  }
  if (!Array.isArray(value.agents)) {
    throw new ContractValidationError("Invalid agent registry config", {
      schemaId: "controlPlane.agentRegistry.config",
      errors: ["registry.agents must be an array"],
    });
  }
  for (const agent of value.agents) {
    if (!isPlainObject(agent)) {
      throw new ContractValidationError("Invalid agent registry config", {
        schemaId: "controlPlane.agentRegistry.config",
        errors: ["registry.agents entries must be objects"],
      });
    }
    const agentId = typeof agent.agentId === "string" ? agent.agentId.trim() : "";
    const profileId = typeof agent.profileId === "string" ? agent.profileId.trim() : "";
    const description =
      typeof agent.description === "string" ? agent.description.trim() : "";
    if (!agentId || !AGENT_ID_PATTERN.test(agentId)) {
      throw new ContractValidationError("Invalid agent registry config", {
        schemaId: "controlPlane.agentRegistry.config",
        errors: ["agentId must match ^@[a-z0-9_-]{2,32}$"],
      });
    }
    if (!profileId) {
      throw new ContractValidationError("Invalid agent registry config", {
        schemaId: "controlPlane.agentRegistry.config",
        errors: ["profileId is required for every agent"],
      });
    }
    if (!description || description.length > 300) {
      throw new ContractValidationError("Invalid agent registry config", {
        schemaId: "controlPlane.agentRegistry.config",
        errors: ["description is required and must be <= 300 chars"],
      });
    }
  }
}

/**
 * @param {string} scope
 * @param {{ sessionId?: string, userId?: string }} request
 */
function buildPinPolicyResourceId(scope, request) {
  if (scope === "global") {
    return GLOBAL_PROFILE_PIN_POLICY_ID;
  }
  if (scope === "session") {
    if (typeof request.sessionId !== "string" || request.sessionId.length === 0) {
      throw new ContractValidationError("Invalid profile pin request", {
        schemaId: pinProfileForScopeRequestSchema.schemaId,
        errors: ["session scope requires sessionId"],
      });
    }
    return `profile-pin:session:${request.sessionId}`;
  }
  if (typeof request.userId !== "string" || request.userId.length === 0) {
    throw new ContractValidationError("Invalid profile pin request", {
      schemaId: pinProfileForScopeRequestSchema.schemaId,
      errors: ["user scope requires userId"],
    });
  }
  return `profile-pin:user:${request.userId}`;
}

/**
 * @param {import("@polar/domain").StrictObjectSchema} schema
 * @param {unknown} request
 * @param {string} message
 */
function validateRequest(schema, request, message) {
  const validation = schema.validate(request);
  if (!validation.ok) {
    throw new ContractValidationError(message, {
      schemaId: schema.schemaId,
      errors: validation.errors ?? [],
    });
  }
  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {{
 *   middleware?: readonly import("@polar/runtime-core").RuntimeMiddleware[],
 *   initialRecords?: readonly Record<string, unknown>[],
 *   initialSessions?: readonly Record<string, unknown>[],
 *   initialMessages?: readonly Record<string, unknown>[],
 *   initialTasks?: readonly Record<string, unknown>[],
 *   ingressNormalizers?: {
 *     web?: (payload: unknown) => Record<string, unknown>|Promise<Record<string, unknown>>,
 *     telegram?: (payload: unknown) => Record<string, unknown>|Promise<Record<string, unknown>>,
 *     slack?: (payload: unknown) => Record<string, unknown>|Promise<Record<string, unknown>>,
 *     discord?: (payload: unknown) => Record<string, unknown>|Promise<Record<string, unknown>>
 *   },
 *   ingressHealthChecks?: {
 *     web?: () => unknown|Promise<unknown>,
 *     telegram?: () => unknown|Promise<unknown>,
 *     slack?: () => unknown|Promise<unknown>,
 *     discord?: () => unknown|Promise<unknown>
 *   },
 *   handoffRoutingTelemetryCollector?: ReturnType<import("@polar/runtime-core").createHandoffRoutingTelemetryCollector>,
 *   usageTelemetryCollector?: ReturnType<import("@polar/runtime-core").createUsageTelemetryCollector>,
 *   schedulerStateStore?: {
 *     hasProcessedEvent?: (request: { eventId: string }) => Promise<unknown>|unknown,
 *     storeProcessedEvent?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     storeRetryEvent?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     storeDeadLetterEvent?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     listProcessedEvents?: () => Promise<unknown>|unknown,
 *     listRetryEvents?: () => Promise<unknown>|unknown,
 *     listDeadLetterEvents?: () => Promise<unknown>|unknown,
 *     removeRetryEvent?: (request: { eventId: string, sequence?: number }) => Promise<unknown>|unknown,
 *     removeDeadLetterEvent?: (request: { eventId: string, sequence?: number }) => Promise<unknown>|unknown
 *   },
 *   feedbackEventStore?: {
 *     recordEvent?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     listEvents?: (request?: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>
 *   },
 *   automationJobStore?: {
 *     createJob?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     listJobs?: (request?: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     getJob?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     updateJob?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     disableJob?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     deleteJob?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     listDueJobs?: (request?: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>
 *   },
 *   personalityStore?: {
 *     getEffectiveProfile?: (request: Record<string, unknown>) => Promise<Record<string, unknown>|null>|Record<string, unknown>|null,
 *     getProfile?: (request: Record<string, unknown>) => Promise<Record<string, unknown>|null>|Record<string, unknown>|null,
 *     upsertProfile?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     resetProfile?: (request: Record<string, unknown>) => Promise<{ deleted: boolean }>|{ deleted: boolean },
 *     listProfiles?: (request?: Record<string, unknown>) => Promise<readonly Record<string, unknown>[]>|readonly Record<string, unknown>[]
 *   },
 *   runEventDb?: import("better-sqlite3").Database,
 *   inboxConnector?: {
 *     searchHeaders?: (request: Record<string, unknown>) => Promise<unknown>|unknown,
 *     readBody?: (request: Record<string, unknown>) => Promise<unknown>|unknown
 *   },
 *   runEventLinker?: {
 *     recordAutomationRun?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     recordHeartbeatRun?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     replayRecordedRuns?: (request?: Record<string, unknown>) => Promise<Record<string, unknown>>|Record<string, unknown>,
 *     listAutomationRunLedger?: (request?: Record<string, unknown>) => readonly Record<string, unknown>[],
 *     listHeartbeatRunLedger?: (request?: Record<string, unknown>) => readonly Record<string, unknown>[]
 *   },
 *   auditSink?: (event: unknown) => Promise<void>|void,
 *   resolveProvider?: (providerId: string) => Promise<{
 *     generate: (request: Record<string, unknown>) => Promise<Record<string, unknown>>,
 *     stream: (request: Record<string, unknown>) => Promise<Record<string, unknown>>,
 *     embed: (request: Record<string, unknown>) => Promise<Record<string, unknown>>,
 *     listModels?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>
 *   }|undefined>,
 *   lineageStore?: {
 *     append: (event: Record<string, unknown>) => Promise<unknown>|unknown,
 *     query?: (request?: unknown) => Promise<Record<string, unknown>>|Record<string, unknown>
 *   },
 *   now?: () => number
 *   artifactsDir?: string
 * }} [config]
 */
export function createControlPlaneService(config = {}) {
  const contractRegistry = createContractRegistry();
  registerControlPlaneContracts(contractRegistry);
  registerProfileResolutionContract(contractRegistry);
  registerBudgetContracts(contractRegistry);
  registerChatIngressContract(contractRegistry);
  registerChatManagementContracts(contractRegistry);
  registerTaskBoardContracts(contractRegistry);
  registerHandoffRoutingTelemetryContract(contractRegistry);
  registerUsageTelemetryContract(contractRegistry);
  registerTelemetryAlertContract(contractRegistry);
  registerTelemetryAlertRouteContract(contractRegistry);
  registerSchedulerContracts(contractRegistry);
  registerAutomationContracts(contractRegistry);
  registerHeartbeatContract(contractRegistry);
  registerProviderOperationContracts(contractRegistry);
  registerExtensionContracts(contractRegistry);
  registerSkillInstallerContract(contractRegistry);
  registerMcpConnectorContract(contractRegistry);
  registerPluginInstallerContract(contractRegistry);
  registerMemoryContracts(contractRegistry);
  registerProactiveInboxContracts(contractRegistry);

  const handoffRoutingTelemetryCollector =
    config.handoffRoutingTelemetryCollector ??
    createHandoffRoutingTelemetryCollector({
      now: config.now,
    });
  const usageTelemetryCollector =
    config.usageTelemetryCollector ??
    createUsageTelemetryCollector({
      now: config.now,
    });
  const lineageStore =
    config.lineageStore ??
    (!isRuntimeDevMode()
      ? createDurableLineageStore({ now: config.now })
      : undefined);

  let budgetGatewayRef;
  const budgetMiddleware = createBudgetMiddleware({
    // Use a proxy-like object to resolve budgetGateway later to avoid circular dependency
    budgetGateway: {
      checkBudget: (req) => budgetGatewayRef.checkBudget(req),
    },
  });

  let memoryGatewayRef;
  let providerGatewayRef;

  const memoryExtractionMiddleware = createMemoryExtractionMiddleware({
    memoryGateway: { upsert: (req) => memoryGatewayRef.upsert(req) },
    providerGateway: { generate: (req) => providerGatewayRef.generate(req) }
  });

  const memoryRecallMiddleware = createMemoryRecallMiddleware({
    memoryGateway: { search: (req) => memoryGatewayRef.search(req) }
  });

  const toolSynthesisMiddleware = createToolSynthesisMiddleware({
    providerGateway: { generate: (req) => providerGatewayRef.generate(req) }
  });

  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware: [
      ...(config.middleware ? [...config.middleware] : []),
      handoffRoutingTelemetryCollector.middleware,
      budgetMiddleware,
      memoryRecallMiddleware,
      toolSynthesisMiddleware,
      memoryExtractionMiddleware,
    ],
    auditSink: config.auditSink,
    lineageStore,
  });

  const cryptoVault = createCryptoVault();

  const extensionRegistry = createExtensionAdapterRegistry();
  const approvalStore = createApprovalStore();
  const skillRegistry = createSkillRegistry();
  const extensionGateway = createExtensionGateway({
    middlewarePipeline,
    extensionRegistry,
    initialStates: config.initialExtensionStates,
    policy: config.extensionPolicy,
    approvalStore,
  });
  const skillInstallerGateway = createSkillInstallerGateway({
    middlewarePipeline,
    extensionGateway,
    extensionRegistry,
    skillAdapter: {
      parseSkillManifest,
      verifySkillProvenance,
      createSkillCapabilityAdapter,
    },
    skillRegistry,
    providerGateway: { generate: (req) => providerGatewayRef.generate(req) },
    policy: config.skillPolicy,
  });
  const mcpConnectorGateway = createMcpConnectorGateway({
    middlewarePipeline,
    extensionGateway,
    extensionRegistry,
    mcpAdapter: config.mcpAdapter ?? {
      async probeConnection() { throw new Error("mcpAdapter not configured"); },
      async importToolCatalog() { throw new Error("mcpAdapter not configured"); },
      createCapabilityAdapter() { throw new Error("mcpAdapter not configured"); },
    },
    skillRegistry,
    policy: config.mcpPolicy,
  });
  const pluginInstallerGateway = createPluginInstallerGateway({
    middlewarePipeline,
    extensionGateway,
    extensionRegistry,
    pluginAdapter: {
      mapPluginDescriptor,
      verifyPluginAuthBindings,
      createPluginCapabilityAdapter,
    },
    policy: config.pluginPolicy,
  });

  const gateway = createControlPlaneGateway({
    middlewarePipeline,
    initialRecords: config.initialRecords,
    cryptoVault,
    now: config.now,
  });
  const budgetGateway = createBudgetGateway({
    middlewarePipeline,
    budgetStateStore: config.budgetStateStore,
  });
  budgetGatewayRef = budgetGateway;
  const chatIngressGateway = createChatIngressGateway({
    middlewarePipeline,
    normalizers:
      config.ingressNormalizers ??
      createDefaultIngressNormalizers({
        now: config.now,
      }),
    healthChecks:
      config.ingressHealthChecks ??
      createDefaultIngressHealthChecks({
        now: config.now,
      }),
    now: config.now,
  });
  const chatManagementGateway = createChatManagementGateway({
    middlewarePipeline,
    initialSessions: config.initialSessions,
    initialMessages: config.initialMessages,
    now: config.now,
  });
  const taskBoardGateway = createTaskBoardGateway({
    middlewarePipeline,
    initialTasks: config.initialTasks,
    now: config.now,
  });
  const profileResolutionGateway = createProfileResolutionGateway({
    middlewarePipeline,
    readConfigRecord: gateway.readConfigRecord,
  });
  const runEventLinker =
    config.runEventLinker ??
    (config.runEventDb
      ? createSqliteRunEventLinker({
          db: config.runEventDb,
          now: config.now,
          taskBoardGateway,
        })
      : {
          async recordAutomationRun() {
            throw new Error("runEventLinker not configured");
          },
          async recordHeartbeatRun() {
            throw new Error("runEventLinker not configured");
          },
          async replayRecordedRuns() {
            throw new Error("runEventLinker not configured");
          },
          listAutomationRunLedger() {
            return Object.freeze([]);
          },
          listHeartbeatRunLedger() {
            return Object.freeze([]);
          },
        });
  const artifactsDir = resolve(config.artifactsDir ?? "artifacts");
  const automationGateway = createAutomationGateway({
    middlewarePipeline,
    runEventLinker,
    profileResolver: {
      resolveProfile: (request) => profileResolutionGateway.resolve(request),
    },
  });
  const heartbeatGateway = createHeartbeatGateway({
    middlewarePipeline,
    runEventLinker,
    profileResolver: {
      resolveProfile: (request) => profileResolutionGateway.resolve(request),
    },
  });
  const handoffRoutingTelemetryGateway = createHandoffRoutingTelemetryGateway({
    middlewarePipeline,
    telemetryCollector: handoffRoutingTelemetryCollector,
    lineageStore,
  });
  const usageTelemetryGateway = createUsageTelemetryGateway({
    middlewarePipeline,
    telemetryCollector: usageTelemetryCollector,
    lineageStore,
  });
  const telemetryAlertGateway = createTelemetryAlertGateway({
    middlewarePipeline,
    usageTelemetryCollector,
    handoffTelemetryCollector: handoffRoutingTelemetryCollector,
    taskBoardGateway,
  });
  const schedulerGateway = createSchedulerGateway({
    middlewarePipeline,
    automationGateway,
    heartbeatGateway,
    runEventLinker,
    schedulerStateStore:
      config.schedulerStateStore ||
      (config.schedulerDb
        ? createSqliteSchedulerStateStore({
          db: config.schedulerDb,
          now: config.now,
        })
        : undefined),
    now: config.now,
  });
  const resolveProvider =
    typeof config.resolveProvider === "function"
      ? config.resolveProvider
      : async (providerId) => {
        let record = gateway.readConfigRecord("provider", providerId);

        // Fallback to environment variables if not found in config DB
        if (!record || !record.config) {
          let envKeyMap = {
            "openai": { key: process.env.OPENAI_API_KEY, mode: "responses", url: "https://api.openai.com/v1/responses" },
            "anthropic": { key: process.env.ANTHROPIC_API_KEY, mode: "anthropic_messages", url: "https://api.anthropic.com/v1/messages" },
            "google_gemini": { key: process.env.GEMINI_API_KEY, mode: "gemini_generate_content", url: "https://generativelanguage.googleapis.com/v1beta" },
            // BUG-014 fix: alias so bot runner's "google" resolves to the same config
            "google": { key: process.env.GEMINI_API_KEY, mode: "gemini_generate_content", url: "https://generativelanguage.googleapis.com/v1beta" },
            "groq": { key: process.env.GROQ_API_KEY, mode: "responses", url: "https://api.groq.com/openai/v1/responses" },
            "openrouter": { key: process.env.OPENROUTER_API_KEY, mode: "chat", url: "https://openrouter.ai/api/v1/chat/completions" },
            "localai": { key: "localai", mode: "responses", url: "http://localhost:8080/v1/responses" },
            "ollama": { key: "ollama", mode: "responses", url: "http://localhost:11434/v1/responses" },
          };
          const envFallback = envKeyMap[providerId];
          if (!envFallback) return undefined;

          record = {
            config: {
              endpointMode: envFallback.mode,
              baseUrl: envFallback.url,
              apiKey: envFallback.key
            }
          };
        }
        return createNativeHttpAdapter({
          providerId,
          endpointMode: record.config.endpointMode || "chat",
          baseUrl: record.config.baseUrl,
          apiKey: record.config.apiKey,
          defaultHeaders: record.config.defaultHeaders,
          capabilities: record.config.capabilities,
        });
      };

  const providerGateway = createProviderGateway({
    middlewarePipeline,
    usageTelemetryCollector,
    now: config.now,
    resolveProvider,
  });
  providerGatewayRef = providerGateway;

  const memoryGateway = createMemoryGateway({
    middlewarePipeline,
    memoryProvider: config.memoryProvider ?? {
      async search() { throw new Error("memoryProvider not configured"); },
      async get() { throw new Error("memoryProvider not configured"); },
      async upsert() { throw new Error("memoryProvider not configured"); },
      async compact() { throw new Error("memoryProvider not configured"); },
    }
  });
  memoryGatewayRef = memoryGateway;
  const proactiveInboxGateway = createProactiveInboxGateway({
    middlewarePipeline,
    inboxConnector: config.inboxConnector,
  });
  const feedbackEventStore = config.feedbackEventStore ?? {
    async recordEvent() {
      throw new Error("feedbackEventStore not configured");
    },
    async listEvents() {
      throw new Error("feedbackEventStore not configured");
    },
  };
  const automationJobStore = config.automationJobStore ?? {
    async createJob() {
      throw new Error("automationJobStore not configured");
    },
    async listJobs() {
      throw new Error("automationJobStore not configured");
    },
    async getJob() {
      throw new Error("automationJobStore not configured");
    },
    async updateJob() {
      throw new Error("automationJobStore not configured");
    },
    async disableJob() {
      throw new Error("automationJobStore not configured");
    },
    async deleteJob() {
      throw new Error("automationJobStore not configured");
    },
    async listDueJobs() {
      throw new Error("automationJobStore not configured");
    },
  };
  const personalityStore = config.personalityStore ?? {
    async getProfile() {
      throw new Error("personalityStore not configured");
    },
    async getEffectiveProfile() {
      throw new Error("personalityStore not configured");
    },
    async upsertProfile() {
      throw new Error("personalityStore not configured");
    },
    async resetProfile() {
      throw new Error("personalityStore not configured");
    },
    async listProfiles() {
      throw new Error("personalityStore not configured");
    },
  };

  const orchestrator = createOrchestrator({
    profileResolutionGateway,
    chatManagementGateway,
    providerGateway,
    extensionGateway,
    approvalStore,
    skillRegistry,
    gateway,
    personalityStore,
    now: config.now,
    lineageStore,
  });

  return Object.freeze({
    // BUG-037 fix: async for API surface consistency with all other methods
    async health() {
      const records = gateway.listStoredRecords();
      const sessions = chatManagementGateway.listSessionsState();
      const tasks = taskBoardGateway.listTasksState();
      const taskEvents = taskBoardGateway.listTaskEventsState();
      const replayKeys = taskBoardGateway.listAppliedReplayKeysState();
      const handoffRoutingTelemetryEvents =
        handoffRoutingTelemetryCollector.listState();
      const usageTelemetryEvents = usageTelemetryCollector.listState();
      const extensions = extensionGateway.listStates();
      return Object.freeze({
        status: "ok",
        contractCount: contractRegistry.list().length,
        recordCount: records.length,
        sessionCount: sessions.length,
        taskCount: tasks.length,
        taskEventCount: taskEvents.length,
        taskReplayKeyCount: replayKeys.length,
        handoffRoutingTelemetryCount: handoffRoutingTelemetryEvents.length,
        usageTelemetryCount: usageTelemetryEvents.length,
        extensionCount: extensions.length,
        vaultStatus: cryptoVault.getStatus(),
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async upsertConfig(request) {
      return gateway.upsertConfig(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getConfig(request) {
      return gateway.getConfig(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listConfigs(request) {
      return gateway.listConfigs(request);
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async getModelRegistry(request = {}) {
      validateRequest(
        modelRegistryGetRequestSchema,
        request,
        "Invalid model registry get request",
      );
      const record = await gateway.getConfig({
        resourceType: MODEL_REGISTRY_RESOURCE_TYPE,
        resourceId: MODEL_REGISTRY_RESOURCE_ID,
      });
      const registry = normalizeModelRegistry(
        record.status === "found" ? record.config : {},
      );
      return {
        status: "ok",
        registry,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async upsertModelRegistry(request) {
      const parsed = validateRequest(
        modelRegistryUpsertRequestSchema,
        request,
        "Invalid model registry upsert request",
      );
      const registry = normalizeModelRegistry(parsed.registry);
      await gateway.upsertConfig({
        resourceType: MODEL_REGISTRY_RESOURCE_TYPE,
        resourceId: MODEL_REGISTRY_RESOURCE_ID,
        config: registry,
      });
      return {
        status: "applied",
        registry,
      };
    },

    /**
     * Applies default model policy to the globally pinned profile so orchestration routing
     * uses the selected provider/model by default.
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async setModelRegistryDefault(request) {
      const parsed = validateRequest(
        modelRegistrySetDefaultRequestSchema,
        request,
        "Invalid model registry default request",
      );
      const pinRecord = await gateway.getConfig({
        resourceType: "policy",
        resourceId: GLOBAL_PROFILE_PIN_POLICY_ID,
      });
      const profileId =
        pinRecord.status === "found" &&
        isPlainObject(pinRecord.config) &&
        typeof pinRecord.config.profileId === "string" &&
        pinRecord.config.profileId.length > 0
          ? pinRecord.config.profileId
          : "profile.global";

      const profileRecord = await gateway.getConfig({
        resourceType: "profile",
        resourceId: profileId,
      });
      const profileConfig =
        profileRecord.status === "found" && isPlainObject(profileRecord.config)
          ? { ...profileRecord.config }
          : {};
      profileConfig.modelPolicy = {
        providerId: parsed.providerId,
        modelId: parsed.modelId,
      };

      await gateway.upsertConfig({
        resourceType: "profile",
        resourceId: profileId,
        config: profileConfig,
      });

      if (pinRecord.status !== "found") {
        await gateway.upsertConfig({
          resourceType: "policy",
          resourceId: GLOBAL_PROFILE_PIN_POLICY_ID,
          config: {
            profileId,
          },
        });
      }

      return {
        status: "applied",
        profileId,
        modelPolicy: profileConfig.modelPolicy,
      };
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async getAgentRegistry(request = {}) {
      validateRequest(
        agentRegistryGetRequestSchema,
        request,
        "Invalid agent registry get request",
      );
      const record = await gateway.getConfig({
        resourceType: AGENT_REGISTRY_RESOURCE_TYPE,
        resourceId: AGENT_REGISTRY_RESOURCE_ID,
      });
      if (record.status === "found") {
        validateAgentRegistryConfig(record.config);
      }
      const registry =
        record.status === "found"
          ? normalizeAgentRegistry(record.config)
          : normalizeAgentRegistry({ version: 1, agents: [] });
      return {
        status: "ok",
        registry,
      };
    },

    /**
     * @returns {Promise<Record<string, unknown>>}
     */
    async listAgentProfiles() {
      const record = await gateway.getConfig({
        resourceType: AGENT_REGISTRY_RESOURCE_TYPE,
        resourceId: AGENT_REGISTRY_RESOURCE_ID,
      });
      if (record.status === "found") {
        validateAgentRegistryConfig(record.config);
      }
      const registry =
        record.status === "found"
          ? normalizeAgentRegistry(record.config)
          : normalizeAgentRegistry({ version: 1, agents: [] });
      const items = registry.agents.map((agent) => ({
        agentId: agent.agentId,
        profileId: agent.profileId,
        description: agent.description,
        ...(Array.isArray(agent.tags) ? { tags: agent.tags } : {}),
      }));
      return {
        status: "ok",
        items,
        totalCount: items.length,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getAgentProfile(request) {
      const parsed = validateRequest(
        agentProfileGetRequestSchema,
        request,
        "Invalid agent profile get request",
      );
      if (!AGENT_ID_PATTERN.test(parsed.agentId)) {
        throw new ContractValidationError("Invalid agent profile get request", {
          schemaId: agentProfileGetRequestSchema.schemaId,
          errors: ["agentId must match ^@[a-z0-9_-]{2,32}$"],
        });
      }
      const record = await gateway.getConfig({
        resourceType: AGENT_REGISTRY_RESOURCE_TYPE,
        resourceId: AGENT_REGISTRY_RESOURCE_ID,
      });
      if (record.status === "found") {
        validateAgentRegistryConfig(record.config);
      }
      const registry =
        record.status === "found"
          ? normalizeAgentRegistry(record.config)
          : normalizeAgentRegistry({ version: 1, agents: [] });
      const found = registry.agents.find((agent) => agent.agentId === parsed.agentId) || null;
      if (!found) {
        return {
          status: "not_found",
          agentId: parsed.agentId,
        };
      }
      return {
        status: "found",
        agent: found,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async registerAgentProfile(request) {
      const parsed = validateRequest(
        agentProfileRegisterRequestSchema,
        request,
        "Invalid agent profile register request",
      );
      if (!AGENT_ID_PATTERN.test(parsed.agentId)) {
        throw new ContractValidationError("Invalid agent profile register request", {
          schemaId: agentProfileRegisterRequestSchema.schemaId,
          errors: ["agentId must match ^@[a-z0-9_-]{2,32}$"],
        });
      }
      const profile = await gateway.getConfig({
        resourceType: "profile",
        resourceId: parsed.profileId,
      });
      if (profile.status !== "found") {
        throw new ContractValidationError("Invalid agent profile register request", {
          schemaId: agentProfileRegisterRequestSchema.schemaId,
          errors: [`profileId "${parsed.profileId}" is not configured`],
        });
      }

      const currentRecord = await gateway.getConfig({
        resourceType: AGENT_REGISTRY_RESOURCE_TYPE,
        resourceId: AGENT_REGISTRY_RESOURCE_ID,
      });
      if (currentRecord.status === "found") {
        validateAgentRegistryConfig(currentRecord.config);
      }
      const current =
        currentRecord.status === "found"
          ? normalizeAgentRegistry(currentRecord.config)
          : normalizeAgentRegistry({ version: 1, agents: [] });
      const filtered = current.agents.filter(
        (agent) => agent.agentId !== parsed.agentId,
      );
      const nextRegistry = normalizeAgentRegistry({
        version: 1,
        agents: [
          ...filtered,
          {
            agentId: parsed.agentId,
            profileId: parsed.profileId,
            description: parsed.description,
            ...(parsed.defaultForwardSkills !== undefined
              ? { defaultForwardSkills: parsed.defaultForwardSkills }
              : {}),
            ...(parsed.allowedForwardSkills !== undefined
              ? { allowedForwardSkills: parsed.allowedForwardSkills }
              : {}),
            ...(parsed.defaultMcpServers !== undefined
              ? { defaultMcpServers: parsed.defaultMcpServers }
              : {}),
            ...(parsed.allowedMcpServers !== undefined
              ? { allowedMcpServers: parsed.allowedMcpServers }
              : {}),
            ...(parsed.tags !== undefined ? { tags: parsed.tags } : {}),
          },
        ],
      });

      await gateway.upsertConfig({
        resourceType: AGENT_REGISTRY_RESOURCE_TYPE,
        resourceId: AGENT_REGISTRY_RESOURCE_ID,
        config: nextRegistry,
      });
      return {
        status: "applied",
        agent:
          nextRegistry.agents.find((agent) => agent.agentId === parsed.agentId) ||
          null,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async unregisterAgentProfile(request) {
      const parsed = validateRequest(
        agentProfileUnregisterRequestSchema,
        request,
        "Invalid agent profile unregister request",
      );
      if (!AGENT_ID_PATTERN.test(parsed.agentId)) {
        throw new ContractValidationError("Invalid agent profile unregister request", {
          schemaId: agentProfileUnregisterRequestSchema.schemaId,
          errors: ["agentId must match ^@[a-z0-9_-]{2,32}$"],
        });
      }

      const currentRecord = await gateway.getConfig({
        resourceType: AGENT_REGISTRY_RESOURCE_TYPE,
        resourceId: AGENT_REGISTRY_RESOURCE_ID,
      });
      if (currentRecord.status === "found") {
        validateAgentRegistryConfig(currentRecord.config);
      }
      const current =
        currentRecord.status === "found"
          ? normalizeAgentRegistry(currentRecord.config)
          : normalizeAgentRegistry({ version: 1, agents: [] });
      const nextAgents = current.agents.filter(
        (agent) => agent.agentId !== parsed.agentId,
      );
      if (nextAgents.length === current.agents.length) {
        return {
          status: "not_found",
          agentId: parsed.agentId,
        };
      }
      const nextRegistry = normalizeAgentRegistry({
        version: 1,
        agents: nextAgents,
      });
      await gateway.upsertConfig({
        resourceType: AGENT_REGISTRY_RESOURCE_TYPE,
        resourceId: AGENT_REGISTRY_RESOURCE_ID,
        config: nextRegistry,
      });
      return {
        status: "deleted",
        agentId: parsed.agentId,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async pinProfileForScope(request) {
      const parsed = validateRequest(
        pinProfileForScopeRequestSchema,
        request,
        "Invalid profile pin request",
      );
      const profile = await gateway.getConfig({
        resourceType: "profile",
        resourceId: parsed.profileId,
      });
      if (profile.status !== "found") {
        throw new ContractValidationError("Invalid profile pin request", {
          schemaId: pinProfileForScopeRequestSchema.schemaId,
          errors: [`profileId "${parsed.profileId}" is not configured`],
        });
      }
      const resourceId = buildPinPolicyResourceId(parsed.scope, parsed);
      await gateway.upsertConfig({
        resourceType: "policy",
        resourceId,
        config: {
          profileId: parsed.profileId,
        },
      });
      return {
        status: "applied",
        scope: parsed.scope,
        profileId: parsed.profileId,
        pinResourceId: resourceId,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async unpinProfileForScope(request) {
      const parsed = validateRequest(
        unpinProfileForScopeRequestSchema,
        request,
        "Invalid profile unpin request",
      );
      const resourceId = buildPinPolicyResourceId(parsed.scope, parsed);
      await gateway.upsertConfig({
        resourceType: "policy",
        resourceId,
        config: {
          profileId: "__UNPINNED__",
          unpinned: true,
        },
      });
      return {
        status: "applied",
        scope: parsed.scope,
        pinResourceId: resourceId,
        unpinned: true,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getEffectivePinnedProfile(request) {
      const parsed = validateRequest(
        effectivePinnedProfileRequestSchema,
        request,
        "Invalid effective pinned profile request",
      );
      const resolved = await profileResolutionGateway.resolve({
        ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
        ...(parsed.userId !== undefined ? { userId: parsed.userId } : {}),
        allowDefaultFallback: false,
      });
      if (resolved.status !== "resolved") {
        return {
          status: "not_found",
        };
      }
      return {
        status: "found",
        scope: resolved.resolvedScope,
        profileId: resolved.profileId,
        pinResourceId: resolved.pinResourceId,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async checkInitialBudget(request) {
      return budgetGateway.checkBudget(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async upsertBudgetPolicy(request) {
      return budgetGateway.upsertPolicy(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getBudgetPolicy(request) {
      return budgetGateway.getPolicy(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getPersonalityProfile(request) {
      const parsed = validateRequest(
        personalityProfileGetRequestSchema,
        request,
        "Invalid personality get request",
      );
      validatePersonalityScopeRequest(parsed, personalityProfileGetRequestSchema.schemaId);
      const profile = await personalityStore.getProfile(parsed);
      if (!profile) {
        return {
          status: "not_found",
          scope: parsed.scope,
          ...(parsed.userId !== undefined ? { userId: parsed.userId } : {}),
          ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
        };
      }
      return {
        status: "found",
        profile,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getEffectivePersonality(request) {
      const parsed = validateRequest(
        personalityEffectiveRequestSchema,
        request,
        "Invalid effective personality request",
      );
      const profile = await personalityStore.getEffectiveProfile(parsed);
      if (!profile) {
        return {
          status: "not_found",
          userId: parsed.userId,
          sessionId: parsed.sessionId,
        };
      }
      return {
        status: "found",
        profile,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async upsertPersonalityProfile(request) {
      const parsed = validateRequest(
        personalityProfileUpsertRequestSchema,
        request,
        "Invalid personality upsert request",
      );
      validatePersonalityScopeRequest(parsed, personalityProfileUpsertRequestSchema.schemaId);
      const profile = await personalityStore.upsertProfile(parsed);
      return {
        status: "upserted",
        profile,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async resetPersonalityProfile(request) {
      const parsed = validateRequest(
        personalityProfileResetRequestSchema,
        request,
        "Invalid personality reset request",
      );
      validatePersonalityScopeRequest(parsed, personalityProfileResetRequestSchema.schemaId);
      const result = await personalityStore.resetProfile(parsed);
      return {
        status: "reset",
        deleted: result.deleted === true,
        scope: parsed.scope,
        ...(parsed.userId !== undefined ? { userId: parsed.userId } : {}),
        ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
      };
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listPersonalityProfiles(request = {}) {
      const parsed = validateRequest(
        personalityProfileListRequestSchema,
        request,
        "Invalid personality list request",
      );
      if (parsed.scope === "global" && parsed.userId !== undefined) {
        throw new ContractValidationError("Invalid controlPlane.personality.list.request", {
          schemaId: personalityProfileListRequestSchema.schemaId,
          errors: [
            "controlPlane.personality.list.request global scope must not include userId",
          ],
        });
      }
      const items = await personalityStore.listProfiles(parsed);
      return {
        status: "ok",
        items,
        totalCount: items.length,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async resolveProfile(request = {}) {
      return profileResolutionGateway.resolve(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async normalizeIngress(request) {
      return chatIngressGateway.normalize(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async checkIngressHealth(request = {}) {
      return chatIngressGateway.checkHealth(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async appendMessage(request) {
      return chatManagementGateway.appendMessage(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listSessions(request) {
      return chatManagementGateway.listSessions(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getSessionHistory(request) {
      return chatManagementGateway.getSessionHistory(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async recordFeedbackEvent(request) {
      if (!isPlainObject(request)) {
        throw new ContractValidationError(
          "Invalid feedback event record request",
          {
            schemaId: feedbackRecordRequestSchema.schemaId,
            errors: [`${feedbackRecordRequestSchema.schemaId} must be a plain object`],
          },
        );
      }
      const parsed = validateRequest(
        feedbackRecordRequestSchema,
        request,
        "Invalid feedback event record request",
      );
      return feedbackEventStore.recordEvent(parsed);
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listFeedbackEvents(request = {}) {
      const parsed = validateRequest(
        feedbackListRequestSchema,
        request,
        "Invalid feedback event list request",
      );
      return feedbackEventStore.listEvents(parsed);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async createAutomationJob(request) {
      const parsed = validateRequest(
        automationJobCreateRequestSchema,
        request,
        "Invalid automation job create request",
      );
      return automationJobStore.createJob({
        ...parsed,
        schedule: normalizeAutomationSchedule(parsed.schedule),
      });
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listAutomationJobs(request = {}) {
      const parsed = validateRequest(
        automationJobListRequestSchema,
        request,
        "Invalid automation job list request",
      );
      return automationJobStore.listJobs(parsed);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async updateAutomationJob(request) {
      const parsed = validateRequest(
        automationJobUpdateRequestSchema,
        request,
        "Invalid automation job update request",
      );
      if (
        parsed.schedule === undefined &&
        parsed.promptTemplate === undefined &&
        parsed.enabled === undefined &&
        parsed.quietHours === undefined &&
        parsed.limits === undefined
      ) {
        throw new ContractValidationError("Invalid automation job update request", {
          schemaId: automationJobUpdateRequestSchema.schemaId,
          errors: [`${automationJobUpdateRequestSchema.schemaId} requires at least one mutable field`],
        });
      }
      return automationJobStore.updateJob({
        ...parsed,
        ...(parsed.schedule !== undefined
          ? { schedule: normalizeAutomationSchedule(parsed.schedule) }
          : {}),
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async disableAutomationJob(request) {
      const parsed = validateRequest(
        automationJobDisableRequestSchema,
        request,
        "Invalid automation job disable request",
      );
      return automationJobStore.disableJob(parsed);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getAutomationJob(request) {
      const parsed = validateRequest(
        automationJobGetRequestSchema,
        request,
        "Invalid automation job get request",
      );
      return automationJobStore.getJob(parsed);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async enableAutomationJob(request) {
      const parsed = validateRequest(
        automationJobDisableRequestSchema,
        request,
        "Invalid automation job enable request",
      );
      return automationJobStore.updateJob({
        id: parsed.id,
        enabled: true,
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async deleteAutomationJob(request) {
      const parsed = validateRequest(
        automationJobDeleteRequestSchema,
        request,
        "Invalid automation job delete request",
      );
      return automationJobStore.deleteJob(parsed);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async previewAutomationJob(request) {
      const parsed = validateRequest(
        automationJobPreviewRequestSchema,
        request,
        "Invalid automation job preview request",
      );
      const schedule = normalizeAutomationSchedule(parsed.schedule);
      return {
        status: "ok",
        preview: {
          schedule,
          promptTemplate: parsed.promptTemplate,
          quietHours: {
            startHour: 22,
            endHour: 7,
            timezone: "UTC",
          },
          limits: {
            maxNotificationsPerDay: 3,
          },
        },
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async runAutomationJob(request) {
      const parsed = validateRequest(
        automationJobRunRequestSchema,
        request,
        "Invalid automation job run request",
      );
      const jobResponse = await automationJobStore.getJob({ id: parsed.id });
      if (jobResponse.status !== "found" || !jobResponse.job) {
        return {
          status: "not_found",
          id: parsed.id,
        };
      }
      const job = jobResponse.job;
      const runId = `run_manual_${randomUUID()}`;
      const orchestrateResult = await orchestrator.orchestrate({
        sessionId: parsed.sessionId ?? job.sessionId,
        userId: parsed.userId ?? job.ownerUserId,
        text: job.promptTemplate,
        messageId: `msg_auto_manual_${randomUUID()}`,
        metadata: {
          executionType: "automation",
          trigger: "manual",
          automationJobId: job.id,
          runId,
        },
      });
      await runEventLinker.recordAutomationRun({
        automationId: job.id,
        runId,
        profileId: "profile-default",
        trigger: "manual",
        output: orchestrateResult,
        metadata: {
          source: "control-plane-manual-run",
        },
      });
      return {
        status: "completed",
        runId,
        job,
        output: orchestrateResult,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async proactiveInboxCheckHeaders(request) {
      const parsed = validateRequest(
        proactiveInboxCheckRequestSchema,
        request,
        "Invalid proactive inbox check request",
      );
      return proactiveInboxGateway.checkHeaders({
        executionType: "automation",
        sessionId: parsed.sessionId,
        userId: parsed.userId,
        ...(parsed.connectorId !== undefined ? { connectorId: parsed.connectorId } : {}),
        ...(parsed.lookbackHours !== undefined ? { lookbackHours: parsed.lookbackHours } : {}),
        ...(parsed.maxHeaders !== undefined ? { maxHeaders: parsed.maxHeaders } : {}),
        ...(Array.isArray(parsed.capabilities) ? { capabilities: parsed.capabilities } : {}),
        ...(parsed.mode !== undefined ? { mode: parsed.mode } : {}),
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async proactiveInboxReadBody(request) {
      const parsed = validateRequest(
        proactiveInboxReadBodyRequestSchema,
        request,
        "Invalid proactive inbox read body request",
      );
      return proactiveInboxGateway.readBody({
        executionType: "automation",
        sessionId: parsed.sessionId,
        userId: parsed.userId,
        messageId: parsed.messageId,
        ...(parsed.connectorId !== undefined ? { connectorId: parsed.connectorId } : {}),
        ...(Array.isArray(parsed.capabilities) ? { capabilities: parsed.capabilities } : {}),
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async proactiveInboxDryRun(request) {
      const parsed = validateRequest(
        proactiveInboxDryRunRequestSchema,
        request,
        "Invalid proactive inbox dry run request",
      );
      const maxNotificationsPerDay =
        parsed.maxNotificationsPerDay !== undefined
          ? parsed.maxNotificationsPerDay
          : 3;
      const checkResult = await proactiveInboxGateway.checkHeaders({
        executionType: "automation",
        sessionId: parsed.sessionId,
        userId: parsed.userId,
        mode: "headers_only",
        ...(parsed.connectorId !== undefined ? { connectorId: parsed.connectorId } : {}),
        ...(parsed.lookbackHours !== undefined ? { lookbackHours: parsed.lookbackHours } : {}),
        ...(Array.isArray(parsed.capabilities)
          ? { capabilities: parsed.capabilities }
          : { capabilities: ["mail.search_headers"] }),
        metadata: {
          source: "proactive_inbox_dry_run",
        },
      });
      const headers = Array.isArray(checkResult.headers) ? checkResult.headers : [];
      return {
        status: checkResult.status,
        mode: "headers_only",
        connectorStatus: checkResult.connectorStatus,
        ...(checkResult.blockedReason !== undefined
          ? { blockedReason: checkResult.blockedReason }
          : {}),
        ...(checkResult.degradedReason !== undefined
          ? { degradedReason: checkResult.degradedReason }
          : {}),
        lookbackHours: parsed.lookbackHours ?? 24,
        scannedHeaderCount: headers.length,
        wouldTriggerCount: Math.min(maxNotificationsPerDay, headers.length),
        wouldTrigger: Object.freeze(
          headers.slice(0, maxNotificationsPerDay).map((header) => ({
            messageId: header.messageId,
            subject: header.subject,
            senderDomain: header.senderDomain,
          })),
        ),
      };
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async exportArtifacts(request = {}) {
      const parsed = validateRequest(
        artifactsExportRequestSchema,
        request,
        "Invalid artifacts export request",
      );
      if (!config.runEventDb) {
        throw new Error("artifacts export requires runEventDb");
      }
      const result = await exportArtifactsFromDb({
        db: config.runEventDb,
        artifactsDir: parsed.artifactsDir ?? artifactsDir,
      });
      return result;
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async showArtifacts(request = {}) {
      const parsed = validateRequest(
        artifactsShowRequestSchema,
        request,
        "Invalid artifacts show request",
      );
      const items = await listArtifactFiles({
        artifactsDir: parsed.artifactsDir ?? artifactsDir,
      });
      return {
        status: "ok",
        items,
        totalCount: items.length,
      };
    },

    /**
     * @param {unknown} [request]
     * @returns {{ status: "ok", items: readonly Record<string, unknown>[], totalCount: number }}
     */
    listAutomationRunLedger(request = {}) {
      const parsed = validateRequest(
        runLedgerListRequestSchema,
        request,
        "Invalid automation run ledger list request",
      );
      const items = runEventLinker.listAutomationRunLedger(parsed);
      return {
        status: "ok",
        items,
        totalCount: items.length,
      };
    },

    /**
     * @param {unknown} [request]
     * @returns {{ status: "ok", items: readonly Record<string, unknown>[], totalCount: number }}
     */
    listHeartbeatRunLedger(request = {}) {
      const parsed = validateRequest(
        runLedgerListRequestSchema,
        request,
        "Invalid heartbeat run ledger list request",
      );
      const items = runEventLinker.listHeartbeatRunLedger(parsed);
      return {
        status: "ok",
        items,
        totalCount: items.length,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async searchMessages(request) {
      return chatManagementGateway.searchMessages(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async applySessionRetentionPolicy(request) {
      return chatManagementGateway.applyRetentionPolicy(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async upsertTask(request) {
      return taskBoardGateway.upsertTask(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async transitionTask(request) {
      return taskBoardGateway.transitionTask(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listTasks(request) {
      return taskBoardGateway.listTasks(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listTaskEvents(request) {
      return taskBoardGateway.listTaskEvents(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async replayTaskRunLinks(request) {
      return taskBoardGateway.replayRunLinks(request);
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listHandoffRoutingTelemetry(request = {}) {
      return handoffRoutingTelemetryGateway.listRoutingTelemetry(request);
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listUsageTelemetry(request = {}) {
      return usageTelemetryGateway.listUsageTelemetry(request);
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listExecutionLineage(request = {}) {
      return middlewarePipeline.queryLineage(request);
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listTelemetryAlerts(request = {}) {
      return telemetryAlertGateway.listAlerts(request);
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async routeTelemetryAlerts(request = {}) {
      return telemetryAlertGateway.routeAlerts(request);
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listSchedulerEventQueue(request = {}) {
      return schedulerGateway.listEventQueue(request);
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async runSchedulerQueueAction(request = {}) {
      return schedulerGateway.runQueueAction(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async generateOutput(request) {
      return providerGateway.generate(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listModels(request) {
      return providerGateway.listModels(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async streamOutput(request) {
      return providerGateway.stream(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async embedText(request) {
      return providerGateway.embed(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async executeExtension(request) {
      if (
        typeof request === "object" &&
        request !== null &&
        Object.getPrototypeOf(request) === Object.prototype &&
        typeof request.sessionId === "string"
      ) {
        const profile = await profileResolutionGateway.resolve({
          sessionId: request.sessionId,
        });
        const capabilityScope = computeCapabilityScope({
          sessionProfile: profile,
          multiAgentConfig: {},
          activeDelegation: null,
          installedExtensions: extensionGateway.listStates(),
          authorityStates: skillRegistry.listAuthorityStates(),
        });

        return extensionGateway.execute({
          ...request,
          capabilityScope,
        });
      }

      return extensionGateway.execute(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async applyExtensionLifecycle(request) {
      return extensionGateway.applyLifecycle(request);
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listExtensionStates() {
      return extensionGateway.listStates();
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async installSkill(request) {
      return skillInstallerGateway.install(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async proposeSkillManifest(request) {
      return skillInstallerGateway.proposeManifest(request);
    },

    /**
     * @returns {{ status: "ok", items: readonly Record<string, unknown>[], totalCount: number }}
     */
    listPendingSkillInstallProposals() {
      const items = skillRegistry.listPending();
      return {
        status: "ok",
        items,
        totalCount: items.length,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async reviewSkillInstallProposal(request) {
      return skillInstallerGateway.reviewProposal(request);
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listCapabilityAuthorityStates() {
      return skillRegistry.listAuthorityStates();
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async syncMcpServer(request) {
      return mcpConnectorGateway.sync(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async installPlugin(request) {
      return pluginInstallerGateway.install(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async searchMemory(request) {
      return memoryGateway.search(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async getMemory(request) {
      return memoryGateway.get(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async upsertMemory(request) {
      return memoryGateway.upsert(request);
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async compactMemory(request) {
      return memoryGateway.compact(request);
    },

    /**
     * @param {import("@polar/runtime-core").PolarEnvelope} request
     */
    async orchestrate(request) {
      return orchestrator.orchestrate(request);
    },

    /**
     * @param {string | { workflowId: string }} request
     */
    async executeWorkflow(request) {
      const workflowId = typeof request === 'string' ? request : request.workflowId;
      return orchestrator.executeWorkflow(workflowId);
    },

    /**
     * @param {string | { workflowId: string }} request
     */
    async rejectWorkflow(request) {
      const workflowId = typeof request === 'string' ? request : request.workflowId;
      return orchestrator.rejectWorkflow(workflowId);
    },

    /**
     * @param {string | { proposalId: string }} request
     */
    async consumeAutomationProposal(request) {
      const proposalId = typeof request === "string" ? request : request.proposalId;
      return orchestrator.consumeAutomationProposal(proposalId);
    },

    /**
     * @param {string | { proposalId: string }} request
     */
    async rejectAutomationProposal(request) {
      const proposalId = typeof request === "string" ? request : request.proposalId;
      return orchestrator.rejectAutomationProposal(proposalId);
    },

    /**
     * Handle a repair selection event (button click: A or B).
     * @param {{ sessionId: string, selection: 'A'|'B', correlationId: string }} request
     */
    async handleRepairSelection(request) {
      return orchestrator.handleRepairSelectionEvent(request);
    },

    /**
     * Binds a synthetic message ID to a real channel (Telegram) message ID.
     */
    async updateMessageChannelId(sessionId, internalId, channelId) {
      return orchestrator.updateMessageChannelId(sessionId, internalId, channelId);
    },

    /**
     * Submit an operator-supplied risk metadata override for a skill capability.
     */
    async submitSkillMetadataOverride(request) {
      return skillRegistry.submitOverride(request);
    },

    /**
     * List skills that are currently blocked due to missing risk metadata.
     */
    async listBlockedSkills() {
      return skillRegistry.listBlocked();
    }
  });
}
