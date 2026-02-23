import {
  createDefaultIngressHealthChecks,
  createDefaultIngressNormalizers,
} from "../../polar-adapter-channels/src/index.mjs";
import {
  createChatIngressGateway,
  createChatManagementGateway,
  createContractRegistry,
  createControlPlaneGateway,
  createHandoffRoutingTelemetryCollector,
  createHandoffRoutingTelemetryGateway,
  createTelemetryAlertGateway,
  createUsageTelemetryCollector,
  createUsageTelemetryGateway,
  createMiddlewarePipeline,
  createProfileResolutionGateway,
  createTaskBoardGateway,
  registerChatIngressContract,
  registerChatManagementContracts,
  registerControlPlaneContracts,
  registerHandoffRoutingTelemetryContract,
  registerProfileResolutionContract,
  registerTelemetryAlertContract,
  registerTaskBoardContracts,
  registerUsageTelemetryContract,
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
 *   auditSink?: (event: unknown) => Promise<void>|void,
 *   now?: () => number
 * }} [config]
 */
export function createControlPlaneService(config = {}) {
  const contractRegistry = createContractRegistry();
  registerControlPlaneContracts(contractRegistry);
  registerProfileResolutionContract(contractRegistry);
  registerChatIngressContract(contractRegistry);
  registerChatManagementContracts(contractRegistry);
  registerTaskBoardContracts(contractRegistry);
  registerHandoffRoutingTelemetryContract(contractRegistry);
  registerUsageTelemetryContract(contractRegistry);
  registerTelemetryAlertContract(contractRegistry);

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

  const middlewarePipeline = createMiddlewarePipeline({
    contractRegistry,
    middleware: [
      ...(config.middleware ? [...config.middleware] : []),
      handoffRoutingTelemetryCollector.middleware,
    ],
    auditSink: config.auditSink,
  });

  const gateway = createControlPlaneGateway({
    middlewarePipeline,
    initialRecords: config.initialRecords,
    now: config.now,
  });
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
  });
  const usageTelemetryGateway = createUsageTelemetryGateway({
    middlewarePipeline,
    telemetryCollector: usageTelemetryCollector,
  });
  const telemetryAlertGateway = createTelemetryAlertGateway({
    middlewarePipeline,
    usageTelemetryCollector,
    handoffTelemetryCollector: handoffRoutingTelemetryCollector,
  });
  const profileResolutionGateway = createProfileResolutionGateway({
    middlewarePipeline,
    readConfigRecord: gateway.readConfigRecord,
  });

  return Object.freeze({
    health() {
      const records = gateway.listStoredRecords();
      const sessions = chatManagementGateway.listSessionsState();
      const tasks = taskBoardGateway.listTasksState();
      const taskEvents = taskBoardGateway.listTaskEventsState();
      const replayKeys = taskBoardGateway.listAppliedReplayKeysState();
      const handoffRoutingTelemetryEvents =
        handoffRoutingTelemetryCollector.listState();
      const usageTelemetryEvents = usageTelemetryCollector.listState();
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
    async resolveProfile(request = {}) {
      return profileResolutionGateway.resolve(request);
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
    async listTelemetryAlerts(request = {}) {
      return telemetryAlertGateway.listAlerts(request);
    },
  });
}
