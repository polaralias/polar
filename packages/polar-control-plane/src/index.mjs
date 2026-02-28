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
} from "../../polar-adapter-extensions/src/index.mjs";
import {
  createDefaultIngressHealthChecks,
  createDefaultIngressNormalizers,
} from "../../polar-adapter-channels/src/index.mjs";
import { createNativeHttpAdapter } from "../../polar-adapter-native/src/index.mjs";
import { computeCapabilityScope } from "../../polar-runtime-core/src/capability-scope.mjs";
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
  createMcpConnectorGateway,
  registerMcpConnectorContract,
  createPluginInstallerGateway,
  registerPluginInstallerContract,
  createMemoryGateway,
  registerMemoryContracts,
  createBudgetMiddleware,
  createMemoryExtractionMiddleware,
  createMemoryRecallMiddleware,
  createToolSynthesisMiddleware,
  createApprovalStore,
  createOrchestrator,
  createDurableLineageStore,
  isRuntimeDevMode,
  createSqliteSchedulerStateStore,
} from "../../polar-runtime-core/src/index.mjs";

/**
 * @param {{
 *   middleware?: readonly import("../../polar-runtime-core/src/middleware-pipeline.mjs").RuntimeMiddleware[],
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
 *   handoffRoutingTelemetryCollector?: ReturnType<import("../../polar-runtime-core/src/handoff-routing-telemetry.mjs").createHandoffRoutingTelemetryCollector>,
 *   usageTelemetryCollector?: ReturnType<import("../../polar-runtime-core/src/usage-telemetry.mjs").createUsageTelemetryCollector>,
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
  registerProviderOperationContracts(contractRegistry);
  registerExtensionContracts(contractRegistry);
  registerSkillInstallerContract(contractRegistry);
  registerMcpConnectorContract(contractRegistry);
  registerPluginInstallerContract(contractRegistry);
  registerMemoryContracts(contractRegistry);

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
  const profileResolutionGateway = createProfileResolutionGateway({
    middlewarePipeline,
    readConfigRecord: gateway.readConfigRecord,
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

  const orchestrator = createOrchestrator({
    profileResolutionGateway,
    chatManagementGateway,
    providerGateway,
    extensionGateway,
    approvalStore,
    gateway,
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
     * @param {import("../../polar-runtime-core/src/orchestrator.mjs").PolarEnvelope} request
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
