import {
  ContractValidationError,
  RuntimeExecutionError,
  TELEMETRY_ALERT_ACTION,
  TELEMETRY_ALERT_ROUTE_ACTION,
  TELEMETRY_ALERT_SCOPES,
  TELEMETRY_ALERT_SEVERITIES,
  TASK_BOARD_ASSIGNEE_TYPES,
  TASK_BOARD_STATUSES,
  createStrictObjectSchema,
  createTelemetryAlertContract,
  createTelemetryAlertRouteContract,
  enumField,
  numberField,
  booleanField,
  jsonField,
  stringField,
} from "../../polar-domain/src/index.mjs";

const telemetryAlertRequestFields = Object.freeze({
  executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
    required: false,
  }),
  traceId: stringField({ minLength: 1, required: false }),
  scope: enumField(TELEMETRY_ALERT_SCOPES, { required: false }),
  minimumSampleSize: numberField({ min: 1, max: 10_000, required: false }),
  usageFromSequence: numberField({ min: 1, required: false }),
  usageLimit: numberField({ min: 1, max: 500, required: false }),
  usageOperation: enumField(["generate", "stream", "embed"], {
    required: false,
  }),
  usageProviderId: stringField({ minLength: 1, required: false }),
  usageRequestedProviderId: stringField({ minLength: 1, required: false }),
  usageStatus: enumField(["completed", "failed"], {
    required: false,
  }),
  usageModelLane: enumField(["local", "worker", "brain"], {
    required: false,
  }),
  usageFallbackUsed: booleanField({ required: false }),
  usageExecutionType: enumField(
    ["tool", "handoff", "automation", "heartbeat"],
    { required: false },
  ),
  usageFailureRateWarning: numberField({ min: 0, max: 1, required: false }),
  usageFailureRateCritical: numberField({ min: 0, max: 1, required: false }),
  usageFallbackRateWarning: numberField({ min: 0, max: 1, required: false }),
  usageFallbackRateCritical: numberField({
    min: 0,
    max: 1,
    required: false,
  }),
  usageAverageDurationMsWarning: numberField({ min: 0, required: false }),
  usageAverageDurationMsCritical: numberField({ min: 0, required: false }),
  handoffFromSequence: numberField({ min: 1, required: false }),
  handoffLimit: numberField({ min: 1, max: 500, required: false }),
  handoffMode: enumField(["direct", "delegate", "fanout-fanin"], {
    required: false,
  }),
  handoffRouteAdjustedOnly: booleanField({ required: false }),
  handoffProfileResolutionStatus: enumField(["resolved", "not_resolved"], {
    required: false,
  }),
  handoffSessionId: stringField({ minLength: 1, required: false }),
  handoffWorkspaceId: stringField({ minLength: 1, required: false }),
  handoffSourceAgentId: stringField({ minLength: 1, required: false }),
  handoffStatus: enumField(["completed", "failed", "unknown"], {
    required: false,
  }),
  handoffFailureRateWarning: numberField({ min: 0, max: 1, required: false }),
  handoffFailureRateCritical: numberField({
    min: 0,
    max: 1,
    required: false,
  }),
  handoffRouteAdjustedRateWarning: numberField({
    min: 0,
    max: 1,
    required: false,
  }),
  handoffRouteAdjustedRateCritical: numberField({
    min: 0,
    max: 1,
    required: false,
  }),
});

const listTelemetryAlertsRequestSchema = createStrictObjectSchema({
  schemaId: "telemetry.alert.gateway.list.request",
  fields: telemetryAlertRequestFields,
});

const routeTelemetryAlertsRequestSchema = createStrictObjectSchema({
  schemaId: "telemetry.alert.gateway.route.request",
  fields: {
    ...telemetryAlertRequestFields,
    minimumSeverity: enumField(TELEMETRY_ALERT_SEVERITIES, {
      required: false,
    }),
    maxAlerts: numberField({ min: 1, max: 200, required: false }),
    assigneeType: enumField(TASK_BOARD_ASSIGNEE_TYPES),
    assigneeId: stringField({ minLength: 1 }),
    taskStatus: enumField(TASK_BOARD_STATUSES, { required: false }),
    taskIdPrefix: stringField({ minLength: 1, required: false }),
    titlePrefix: stringField({ minLength: 1, required: false }),
    actorId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1, required: false }),
    metadata: jsonField({ required: false }),
    dryRun: booleanField({ required: false }),
  },
});

const defaultThresholds = Object.freeze({
  minimumSampleSize: 5,
  usageFailureRateWarning: 0.15,
  usageFailureRateCritical: 0.35,
  usageFallbackRateWarning: 0.25,
  usageFallbackRateCritical: 0.5,
  usageAverageDurationMsWarning: 2_000,
  usageAverageDurationMsCritical: 5_000,
  handoffFailureRateWarning: 0.1,
  handoffFailureRateCritical: 0.25,
  handoffRouteAdjustedRateWarning: 0.4,
  handoffRouteAdjustedRateCritical: 0.7,
});

/**
 * @param {number|undefined} warning
 * @param {number|undefined} critical
 * @param {string} warningField
 * @param {string} criticalField
 * @param {string[]} errors
 */
function validateThresholdPair(
  warning,
  critical,
  warningField,
  criticalField,
  errors,
) {
  if (
    warning !== undefined &&
    critical !== undefined &&
    critical < warning
  ) {
    errors.push(`${criticalField} must be >= ${warningField}`);
  }
}

/**
 * @param {Record<string, unknown>} input
 */
function validateThresholdRelationships(input) {
  const errors = [];

  validateThresholdPair(
    /** @type {number|undefined} */(input.usageFailureRateWarning),
    /** @type {number|undefined} */(input.usageFailureRateCritical),
    "usageFailureRateWarning",
    "usageFailureRateCritical",
    errors,
  );
  validateThresholdPair(
    /** @type {number|undefined} */(input.usageFallbackRateWarning),
    /** @type {number|undefined} */(input.usageFallbackRateCritical),
    "usageFallbackRateWarning",
    "usageFallbackRateCritical",
    errors,
  );
  validateThresholdPair(
    /** @type {number|undefined} */(input.usageAverageDurationMsWarning),
    /** @type {number|undefined} */(input.usageAverageDurationMsCritical),
    "usageAverageDurationMsWarning",
    "usageAverageDurationMsCritical",
    errors,
  );
  validateThresholdPair(
    /** @type {number|undefined} */(input.handoffFailureRateWarning),
    /** @type {number|undefined} */(input.handoffFailureRateCritical),
    "handoffFailureRateWarning",
    "handoffFailureRateCritical",
    errors,
  );
  validateThresholdPair(
    /** @type {number|undefined} */(input.handoffRouteAdjustedRateWarning),
    /** @type {number|undefined} */(input.handoffRouteAdjustedRateCritical),
    "handoffRouteAdjustedRateWarning",
    "handoffRouteAdjustedRateCritical",
    errors,
  );

  if (errors.length > 0) {
    throw new ContractValidationError("Invalid telemetry alert threshold configuration", {
      schemaId: listTelemetryAlertsRequestSchema.schemaId,
      errors,
    });
  }
}

/**
 * @param {unknown} request
 * @returns {Record<string, unknown>}
 */
function validateRequest(request) {
  const validation = listTelemetryAlertsRequestSchema.validate(request);
  if (!validation.ok) {
    throw new ContractValidationError("Invalid telemetry alert list request", {
      schemaId: listTelemetryAlertsRequestSchema.schemaId,
      errors: validation.errors ?? [],
    });
  }

  const parsed = /** @type {Record<string, unknown>} */ (validation.value);
  validateThresholdRelationships(parsed);
  return parsed;
}

/**
 * @param {number} metricValue
 * @param {number} warningThreshold
 * @param {number} criticalThreshold
 * @returns {"warning"|"critical"|undefined}
 */
function evaluateRateSeverity(metricValue, warningThreshold, criticalThreshold) {
  if (metricValue >= criticalThreshold) {
    return "critical";
  }
  if (metricValue >= warningThreshold) {
    return "warning";
  }

  return undefined;
}

/**
 * @param {number} metricValue
 * @param {number} warningThreshold
 * @param {number} criticalThreshold
 * @returns {"warning"|"critical"|undefined}
 */
function evaluateDurationSeverity(
  metricValue,
  warningThreshold,
  criticalThreshold,
) {
  return evaluateRateSeverity(metricValue, warningThreshold, criticalThreshold);
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerTelemetryAlertContract(contractRegistry) {
  if (
    !contractRegistry.has(
      TELEMETRY_ALERT_ACTION.actionId,
      TELEMETRY_ALERT_ACTION.version,
    )
  ) {
    contractRegistry.register(createTelemetryAlertContract());
  }
}

export function registerTelemetryAlertRouteContract(contractRegistry) {
  if (
    !contractRegistry.has(
      TELEMETRY_ALERT_ROUTE_ACTION.actionId,
      TELEMETRY_ALERT_ROUTE_ACTION.version,
    )
  ) {
    contractRegistry.register(createTelemetryAlertRouteContract());
  }
}

/**
 * @param {Record<string, unknown>} parsed
 */
function buildUsageCollectorRequest(parsed) {
  const input = {};
  if (parsed.usageFromSequence !== undefined) {
    input.fromSequence = parsed.usageFromSequence;
  }
  if (parsed.usageLimit !== undefined) {
    input.limit = parsed.usageLimit;
  }
  if (parsed.usageOperation !== undefined) {
    input.operation = parsed.usageOperation;
  }
  if (parsed.usageProviderId !== undefined) {
    input.providerId = parsed.usageProviderId;
  }
  if (parsed.usageRequestedProviderId !== undefined) {
    input.requestedProviderId = parsed.usageRequestedProviderId;
  }
  if (parsed.usageStatus !== undefined) {
    input.status = parsed.usageStatus;
  }
  if (parsed.usageModelLane !== undefined) {
    input.modelLane = parsed.usageModelLane;
  }
  if (parsed.usageFallbackUsed !== undefined) {
    input.fallbackUsed = parsed.usageFallbackUsed;
  }
  if (parsed.usageExecutionType !== undefined) {
    input.executionType = parsed.usageExecutionType;
  }

  return input;
}

/**
 * @param {Record<string, unknown>} parsed
 */
function buildHandoffCollectorRequest(parsed) {
  const input = {};
  if (parsed.handoffFromSequence !== undefined) {
    input.fromSequence = parsed.handoffFromSequence;
  }
  if (parsed.handoffLimit !== undefined) {
    input.limit = parsed.handoffLimit;
  }
  if (parsed.handoffMode !== undefined) {
    input.mode = parsed.handoffMode;
  }
  if (parsed.handoffRouteAdjustedOnly !== undefined) {
    input.routeAdjustedOnly = parsed.handoffRouteAdjustedOnly;
  }
  if (parsed.handoffProfileResolutionStatus !== undefined) {
    input.profileResolutionStatus = parsed.handoffProfileResolutionStatus;
  }
  if (parsed.handoffSessionId !== undefined) {
    input.sessionId = parsed.handoffSessionId;
  }
  if (parsed.handoffWorkspaceId !== undefined) {
    input.workspaceId = parsed.handoffWorkspaceId;
  }
  if (parsed.handoffSourceAgentId !== undefined) {
    input.sourceAgentId = parsed.handoffSourceAgentId;
  }
  if (parsed.handoffStatus !== undefined) {
    input.status = parsed.handoffStatus;
  }

  return input;
}

/**
 * @param {Record<string, unknown>[]} alerts
 * @param {{
 *   code: string,
 *   source: "usage"|"handoff",
 *   severity: "warning"|"critical",
 *   message: string,
 *   metricValue: number,
 *   warningThreshold: number,
 *   criticalThreshold: number,
 *   sampleSize: number
 * }} item
 */
function appendAlert(alerts, item) {
  alerts.push(
    Object.freeze({
      alertId: `${item.source}:${item.code}:${item.severity}`,
      source: item.source,
      code: item.code,
      severity: item.severity,
      message: item.message,
      metrics: {
        metricValue: item.metricValue,
        warningThreshold: item.warningThreshold,
        criticalThreshold: item.criticalThreshold,
        sampleSize: item.sampleSize,
      },
    }),
  );
}

/**
 * @param {Record<string, unknown>} usageListResult
 * @returns {{
 *   totalOperations: number,
 *   failedCount: number,
 *   fallbackCount: number,
 *   totalDurationMs: number,
 *   averageDurationMs: number
 * }}
 */
function buildUsageWindow(usageListResult) {
  const summary =
    typeof usageListResult.summary === "object" &&
      usageListResult.summary !== null
      ? /** @type {Record<string, unknown>} */ (usageListResult.summary)
      : {};
  const totalOperations =
    typeof summary.totalOperations === "number" ? summary.totalOperations : 0;
  const failedCount =
    typeof summary.failedCount === "number" ? summary.failedCount : 0;
  const fallbackCount =
    typeof summary.fallbackCount === "number" ? summary.fallbackCount : 0;
  const totalDurationMs =
    typeof summary.totalDurationMs === "number" ? summary.totalDurationMs : 0;
  const averageDurationMs =
    totalOperations > 0 ? totalDurationMs / totalOperations : 0;

  return {
    totalOperations,
    failedCount,
    fallbackCount,
    totalDurationMs,
    averageDurationMs,
  };
}

/**
 * @param {Record<string, unknown>} handoffListResult
 * @returns {{
 *   evaluatedCount: number,
 *   failedCount: number,
 *   routeAdjustedCount: number,
 *   failureRate: number,
 *   routeAdjustedRate: number
 * }}
 */
function buildHandoffWindow(handoffListResult) {
  const items = Array.isArray(handoffListResult.items)
    ? /** @type {Record<string, unknown>[]} */ (handoffListResult.items)
    : [];
  const evaluatedCount = items.length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const routeAdjustedCount = items.filter((item) => item.routeAdjusted === true).length;
  const failureRate = evaluatedCount > 0 ? failedCount / evaluatedCount : 0;
  const routeAdjustedRate =
    evaluatedCount > 0 ? routeAdjustedCount / evaluatedCount : 0;

  return {
    evaluatedCount,
    failedCount,
    routeAdjustedCount,
    failureRate,
    routeAdjustedRate,
  };
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   usageTelemetryCollector: { listEvents: (request?: unknown) => Record<string, unknown> },
 *   handoffTelemetryCollector: { listEvents: (request?: unknown) => Record<string, unknown> },
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat",
 *   now?: () => number
 * }} config
 */
export function createTelemetryAlertGateway({
  middlewarePipeline,
  usageTelemetryCollector,
  handoffTelemetryCollector,
  taskBoardGateway,
  defaultExecutionType = "tool",
  now = () => Date.now(),
}) {
  if (
    typeof usageTelemetryCollector !== "object" ||
    usageTelemetryCollector === null ||
    typeof usageTelemetryCollector.listEvents !== "function"
  ) {
    throw new RuntimeExecutionError(
      "usageTelemetryCollector must expose listEvents(request)",
    );
  }

  if (
    typeof handoffTelemetryCollector !== "object" ||
    handoffTelemetryCollector === null ||
    typeof handoffTelemetryCollector.listEvents !== "function"
  ) {
    throw new RuntimeExecutionError(
      "handoffTelemetryCollector must expose listEvents(request)",
    );
  }

  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  return Object.freeze({
    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async listAlerts(request = {}) {
      const parsed = validateRequest(request);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: TELEMETRY_ALERT_ACTION.actionId,
          version: TELEMETRY_ALERT_ACTION.version,
          input: (() => {
            const input = {};
            for (const [key, value] of Object.entries(parsed)) {
              if (key === "executionType" || key === "traceId") {
                continue;
              }
              input[key] = value;
            }
            return input;
          })(),
        },
        async (input) => {
          const scope = /** @type {"usage"|"handoff"|"all"|undefined} */ (
            input.scope
          ) ?? "all";
          const minimumSampleSize =
            /** @type {number|undefined} */ (input.minimumSampleSize) ??
            defaultThresholds.minimumSampleSize;
          const includeUsage = scope === "all" || scope === "usage";
          const includeHandoff = scope === "all" || scope === "handoff";
          const usageListResult = includeUsage
            ? usageTelemetryCollector.listEvents(buildUsageCollectorRequest(input))
            : undefined;
          const handoffListResult = includeHandoff
            ? handoffTelemetryCollector.listEvents(buildHandoffCollectorRequest(input))
            : undefined;

          const usageWindow = usageListResult
            ? buildUsageWindow(usageListResult)
            : {
              totalOperations: 0,
              failedCount: 0,
              fallbackCount: 0,
              totalDurationMs: 0,
              averageDurationMs: 0,
            };
          const handoffWindow = handoffListResult
            ? buildHandoffWindow(handoffListResult)
            : {
              evaluatedCount: 0,
              failedCount: 0,
              routeAdjustedCount: 0,
              failureRate: 0,
              routeAdjustedRate: 0,
            };

          /** @type {Record<string, unknown>[]} */
          const alerts = [];

          if (includeUsage && usageWindow.totalOperations >= minimumSampleSize) {
            const usageFailureRate =
              usageWindow.totalOperations > 0
                ? usageWindow.failedCount / usageWindow.totalOperations
                : 0;
            const usageFallbackRate =
              usageWindow.totalOperations > 0
                ? usageWindow.fallbackCount / usageWindow.totalOperations
                : 0;
            const usageFailureWarning =
              /** @type {number|undefined} */ (input.usageFailureRateWarning) ??
              defaultThresholds.usageFailureRateWarning;
            const usageFailureCritical =
              /** @type {number|undefined} */ (input.usageFailureRateCritical) ??
              defaultThresholds.usageFailureRateCritical;
            const usageFallbackWarning =
              /** @type {number|undefined} */ (input.usageFallbackRateWarning) ??
              defaultThresholds.usageFallbackRateWarning;
            const usageFallbackCritical =
              /** @type {number|undefined} */ (input.usageFallbackRateCritical) ??
              defaultThresholds.usageFallbackRateCritical;
            const usageDurationWarning =
              /** @type {number|undefined} */ (
                input.usageAverageDurationMsWarning
              ) ?? defaultThresholds.usageAverageDurationMsWarning;
            const usageDurationCritical =
              /** @type {number|undefined} */ (
                input.usageAverageDurationMsCritical
              ) ?? defaultThresholds.usageAverageDurationMsCritical;

            const usageFailureSeverity = evaluateRateSeverity(
              usageFailureRate,
              usageFailureWarning,
              usageFailureCritical,
            );
            if (usageFailureSeverity) {
              appendAlert(alerts, {
                source: "usage",
                code: "USAGE_FAILURE_RATE_HIGH",
                severity: usageFailureSeverity,
                message: `Usage failure rate is elevated (${usageFailureRate.toFixed(3)})`,
                metricValue: usageFailureRate,
                warningThreshold: usageFailureWarning,
                criticalThreshold: usageFailureCritical,
                sampleSize: usageWindow.totalOperations,
              });
            }

            const usageFallbackSeverity = evaluateRateSeverity(
              usageFallbackRate,
              usageFallbackWarning,
              usageFallbackCritical,
            );
            if (usageFallbackSeverity) {
              appendAlert(alerts, {
                source: "usage",
                code: "USAGE_FALLBACK_RATE_HIGH",
                severity: usageFallbackSeverity,
                message: `Usage fallback rate is elevated (${usageFallbackRate.toFixed(3)})`,
                metricValue: usageFallbackRate,
                warningThreshold: usageFallbackWarning,
                criticalThreshold: usageFallbackCritical,
                sampleSize: usageWindow.totalOperations,
              });
            }

            const usageDurationSeverity = evaluateDurationSeverity(
              usageWindow.averageDurationMs,
              usageDurationWarning,
              usageDurationCritical,
            );
            if (usageDurationSeverity) {
              appendAlert(alerts, {
                source: "usage",
                code: "USAGE_AVERAGE_DURATION_HIGH",
                severity: usageDurationSeverity,
                message: `Usage average duration is elevated (${usageWindow.averageDurationMs.toFixed(1)} ms)`,
                metricValue: usageWindow.averageDurationMs,
                warningThreshold: usageDurationWarning,
                criticalThreshold: usageDurationCritical,
                sampleSize: usageWindow.totalOperations,
              });
            }
          }

          if (includeHandoff && handoffWindow.evaluatedCount >= minimumSampleSize) {
            const handoffFailureWarning =
              /** @type {number|undefined} */ (input.handoffFailureRateWarning) ??
              defaultThresholds.handoffFailureRateWarning;
            const handoffFailureCritical =
              /** @type {number|undefined} */ (input.handoffFailureRateCritical) ??
              defaultThresholds.handoffFailureRateCritical;
            const handoffAdjustedWarning =
              /** @type {number|undefined} */ (
                input.handoffRouteAdjustedRateWarning
              ) ?? defaultThresholds.handoffRouteAdjustedRateWarning;
            const handoffAdjustedCritical =
              /** @type {number|undefined} */ (
                input.handoffRouteAdjustedRateCritical
              ) ?? defaultThresholds.handoffRouteAdjustedRateCritical;

            const handoffFailureSeverity = evaluateRateSeverity(
              handoffWindow.failureRate,
              handoffFailureWarning,
              handoffFailureCritical,
            );
            if (handoffFailureSeverity) {
              appendAlert(alerts, {
                source: "handoff",
                code: "HANDOFF_FAILURE_RATE_HIGH",
                severity: handoffFailureSeverity,
                message: `Handoff failure rate is elevated (${handoffWindow.failureRate.toFixed(3)})`,
                metricValue: handoffWindow.failureRate,
                warningThreshold: handoffFailureWarning,
                criticalThreshold: handoffFailureCritical,
                sampleSize: handoffWindow.evaluatedCount,
              });
            }

            const handoffAdjustedSeverity = evaluateRateSeverity(
              handoffWindow.routeAdjustedRate,
              handoffAdjustedWarning,
              handoffAdjustedCritical,
            );
            if (handoffAdjustedSeverity) {
              appendAlert(alerts, {
                source: "handoff",
                code: "HANDOFF_ROUTE_ADJUSTED_RATE_HIGH",
                severity: handoffAdjustedSeverity,
                message: `Handoff route-adjustment rate is elevated (${handoffWindow.routeAdjustedRate.toFixed(3)})`,
                metricValue: handoffWindow.routeAdjustedRate,
                warningThreshold: handoffAdjustedWarning,
                criticalThreshold: handoffAdjustedCritical,
                sampleSize: handoffWindow.evaluatedCount,
              });
            }
          }

          return {
            status: "ok",
            evaluatedAtMs: now(),
            scope,
            minimumSampleSize,
            alertCount: alerts.length,
            alerts: Object.freeze(alerts),
            usageWindow: Object.freeze({
              ...usageWindow,
              sampleSizeSatisfied: usageWindow.totalOperations >= minimumSampleSize,
            }),
            handoffWindow: Object.freeze({
              ...handoffWindow,
              sampleSizeSatisfied: handoffWindow.evaluatedCount >= minimumSampleSize,
            }),
          };
        },
      );
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async routeAlerts(request = {}) {
      const parsed = (() => {
        const validation = routeTelemetryAlertsRequestSchema.validate(request);
        if (!validation.ok) {
          throw new ContractValidationError("Invalid telemetry alert route request", {
            schemaId: routeTelemetryAlertsRequestSchema.schemaId,
            errors: validation.errors ?? [],
          });
        }
        const value = /** @type {Record<string, unknown>} */ (validation.value);
        validateThresholdRelationships(value);
        return value;
      })();

      return middlewarePipeline.run(
        {
          executionType: /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (parsed.executionType) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: TELEMETRY_ALERT_ROUTE_ACTION.actionId,
          version: TELEMETRY_ALERT_ROUTE_ACTION.version,
          input: (() => {
            const input = {};
            for (const [key, value] of Object.entries(parsed)) {
              if (key === "executionType" || key === "traceId") {
                continue;
              }
              input[key] = value;
            }
            return input;
          })(),
        },
        async (input) => {
          if (!taskBoardGateway && input.dryRun !== true) {
            throw new RuntimeExecutionError("taskBoardGateway is required for routing alerts without dryRun=true");
          }

          const self = /** @type {any} */ (this);
          const listRequest = {};
          if (input.traceId) { listRequest.traceId = input.traceId + "-list"; }
          if (input.executionType) { listRequest.executionType = input.executionType; }
          for (const key of Object.keys(telemetryAlertRequestFields)) {
            if (key in input) {
              listRequest[key] = input[key];
            }
          }
          const listResponse = await self.listAlerts(listRequest);

          let routedCount = 0;
          let previewCount = 0;
          let skippedCount = 0;
          let rejectedCount = 0;
          const items = [];
          const minimumSeverity = input.minimumSeverity ?? "warning";
          const maxAlerts = input.maxAlerts ?? 50;

          const allAlerts = /** @type {Record<string, unknown>[]} */ (listResponse.alerts);
          let filteredAlerts = [];
          for (const alert of allAlerts) {
            if (minimumSeverity === "critical" && alert.severity !== "critical") {
              skippedCount++;
              continue;
            }
            filteredAlerts.push(alert);
          }

          if (filteredAlerts.length > maxAlerts) {
            skippedCount += (filteredAlerts.length - maxAlerts);
            filteredAlerts = filteredAlerts.slice(0, maxAlerts);
          }

          for (const alert of filteredAlerts) {
            if (input.dryRun === true) {
              previewCount++;
              items.push({ alertId: alert.alertId });
              continue;
            }

            const metricDesc = alert.metrics ? `\nMetric Value: ${Number(alert.metrics.metricValue).toFixed(3)}\nCritical Threshold: ${alert.metrics.criticalThreshold}\nSample Size: ${alert.metrics.sampleSize}` : "";
            const taskRequest = {
              taskId: `${input.taskIdPrefix ?? "alert"}-${alert.alertId}-${input.runId || Date.now()}`,
              title: `${input.titlePrefix ? input.titlePrefix + " " : ""}${alert.message}`,
              status: input.taskStatus ?? "open",
              assigneeType: input.assigneeType,
              assigneeId: input.assigneeId,
              description: `Automatically routed telemetry alert.\nSource: ${alert.source}\nCode: ${alert.code}\nSeverity: ${alert.severity}${metricDesc}`,
            };
            if (input.actorId) { taskRequest.actorId = input.actorId; }
            if (input.sessionId) { taskRequest.sessionId = input.sessionId; }
            if (input.metadata) { taskRequest.metadata = input.metadata; }

            try {
              const upsertResult = await taskBoardGateway.upsertTask(taskRequest);
              if (upsertResult.status === "created" || upsertResult.status === "updated") {
                routedCount++;
                items.push({ alertId: alert.alertId, taskId: taskRequest.taskId });
              } else {
                rejectedCount++;
              }
            } catch (e) {
              rejectedCount++;
            }
          }

          return {
            status: "ok",
            evaluatedAtMs: listResponse.evaluatedAtMs,
            scope: listResponse.scope,
            minimumSampleSize: listResponse.minimumSampleSize,
            minimumSeverity,
            maxAlerts,
            alertCount: listResponse.alertCount,
            routedCount,
            previewCount,
            skippedCount,
            rejectedCount,
            items: Object.freeze(items),
            alerts: listResponse.alerts,
            usageWindow: listResponse.usageWindow,
            handoffWindow: listResponse.handoffWindow,
          };
        }
      );
    },
  });
}
