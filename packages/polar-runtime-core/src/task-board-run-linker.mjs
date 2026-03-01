import {
  ContractValidationError,
  RuntimeExecutionError,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "@polar/domain";

const automationRunRecordSchema = createStrictObjectSchema({
  schemaId: "task-board.run-linker.automation-record",
  fields: {
    automationId: stringField({ minLength: 1 }),
    runId: stringField({ minLength: 1 }),
    profileId: stringField({ minLength: 1 }),
    trigger: enumField(["schedule", "event", "manual", "heartbeat"]),
    output: jsonField(),
    metadata: jsonField({ required: false }),
  },
});

const heartbeatRunRecordSchema = createStrictObjectSchema({
  schemaId: "task-board.run-linker.heartbeat-record",
  fields: {
    policyId: stringField({ minLength: 1 }),
    runId: stringField({ minLength: 1 }),
    profileId: stringField({ minLength: 1 }),
    trigger: enumField(["schedule", "event", "manual"]),
    output: jsonField(),
    metadata: jsonField({ required: false }),
  },
});

const replayRequestSchema = createStrictObjectSchema({
  schemaId: "task-board.run-linker.replay.request",
  fields: {
    source: enumField(["automation", "heartbeat", "all"], { required: false }),
    fromSequence: numberField({ min: 0, required: false }),
  },
});

/**
 * @param {unknown} value
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [automationRunRecordSchema.schemaId]: automationRunRecordSchema,
    [heartbeatRunRecordSchema.schemaId]: heartbeatRunRecordSchema,
    [replayRequestSchema.schemaId]: replayRequestSchema,
  }[schemaId];

  const validation = schema.validate(value);
  if (!validation.ok) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: validation.errors ?? [],
    });
  }

  return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * @param {string} prefix
 * @param {string} id
 * @param {string} runId
 * @returns {string}
 */
function createTaskId(prefix, id, runId) {
  const normalizedId = id.replace(/[^a-zA-Z0-9._:-]/g, "-");
  const normalizedRunId = runId.replace(/[^a-zA-Z0-9._:-]/g, "-");
  return `${prefix}:${normalizedId}:run:${normalizedRunId}`;
}

/**
 * @param {"automation"|"heartbeat"} source
 * @param {string} id
 * @param {string} runId
 * @returns {string}
 */
function createReplayKey(source, id, runId) {
  const normalizedId = id.replace(/[^a-zA-Z0-9._:-]/g, "-");
  const normalizedRunId = runId.replace(/[^a-zA-Z0-9._:-]/g, "-");
  return `${source}:${normalizedId}:run:${normalizedRunId}`;
}

/**
 * @param {Record<string, unknown>|undefined} metadata
 * @returns {string|undefined}
 */
function deriveSessionId(metadata) {
  if (
    metadata &&
    Object.prototype.hasOwnProperty.call(metadata, "sessionId") &&
    typeof metadata.sessionId === "string" &&
    metadata.sessionId.length > 0
  ) {
    return metadata.sessionId;
  }

  return undefined;
}

/**
 * @param {Record<string, unknown>} output
 * @returns {"todo"|"blocked"|"done"}
 */
function mapAutomationStatusToTaskStatus(output) {
  return output.status === "executed" ? "done" : "blocked";
}

/**
 * @param {Record<string, unknown>} output
 * @returns {"todo"|"blocked"|"done"}
 */
function mapHeartbeatStatusToTaskStatus(output) {
  return output.status === "executed" ? "done" : "blocked";
}

/**
 * @param {Record<string, unknown>} output
 * @returns {string|undefined}
 */
function deriveAutomationTransitionReason(output) {
  if (typeof output.skipReason === "string") {
    return `Automation skipped: ${output.skipReason}`;
  }

  if (typeof output.blockReason === "string") {
    return `Automation blocked: ${output.blockReason}`;
  }

  if (
    output.failure &&
    typeof output.failure === "object" &&
    output.failure !== null
  ) {
    const code =
      typeof output.failure.code === "string" ? output.failure.code : "unknown";
    return `Automation failed: ${code}`;
  }

  return undefined;
}

/**
 * @param {Record<string, unknown>} output
 * @returns {string|undefined}
 */
function deriveHeartbeatTransitionReason(output) {
  if (typeof output.skipReason === "string") {
    return `Heartbeat skipped: ${output.skipReason}`;
  }

  return undefined;
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Record<string, unknown>}
 */
function toAutomationReplayRecord(record) {
  const metadata = /** @type {Record<string, unknown>|undefined} */ (
    record.metadata
  );
  const sessionId = deriveSessionId(metadata);
  const reason = deriveAutomationTransitionReason(
    /** @type {Record<string, unknown>} */ (record.output),
  );

  return {
    replayKey: createReplayKey(
      "automation",
      /** @type {string} */ (record.automationId),
      /** @type {string} */ (record.runId),
    ),
    taskId: createTaskId(
      "automation",
      /** @type {string} */ (record.automationId),
      /** @type {string} */ (record.runId),
    ),
    title: `Automation run ${record.automationId}`,
    assigneeType: "agent_profile",
    assigneeId: record.profileId,
    toStatus: mapAutomationStatusToTaskStatus(
      /** @type {Record<string, unknown>} */ (record.output),
    ),
    runId: record.runId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(reason !== undefined ? { reason } : {}),
    metadata: {
      source: "automation",
      automationId: record.automationId,
      trigger: record.trigger,
      output: record.output,
      ...(metadata !== undefined ? { metadata } : {}),
    },
  };
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Record<string, unknown>}
 */
function toHeartbeatReplayRecord(record) {
  const metadata = /** @type {Record<string, unknown>|undefined} */ (
    record.metadata
  );
  const sessionId = deriveSessionId(metadata);
  const reason = deriveHeartbeatTransitionReason(
    /** @type {Record<string, unknown>} */ (record.output),
  );

  return {
    replayKey: createReplayKey(
      "heartbeat",
      /** @type {string} */ (record.policyId),
      /** @type {string} */ (record.runId),
    ),
    taskId: createTaskId(
      "heartbeat",
      /** @type {string} */ (record.policyId),
      /** @type {string} */ (record.runId),
    ),
    title: `Heartbeat run ${record.policyId}`,
    assigneeType: "agent_profile",
    assigneeId: record.profileId,
    toStatus: mapHeartbeatStatusToTaskStatus(
      /** @type {Record<string, unknown>} */ (record.output),
    ),
    runId: record.runId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(reason !== undefined ? { reason } : {}),
    metadata: {
      source: "heartbeat",
      policyId: record.policyId,
      trigger: record.trigger,
      output: record.output,
      ...(metadata !== undefined ? { metadata } : {}),
    },
  };
}

/**
 * @param {Record<string, unknown>|undefined} item
 * @param {string} errorPrefix
 */
function assertReplayItemLinked(item, errorPrefix) {
  if (!item) {
    throw new RuntimeExecutionError(`${errorPrefix}: missing replay result item`);
  }

  if (item.status === "linked" || item.status === "skipped_duplicate") {
    return;
  }

  throw new RuntimeExecutionError(`${errorPrefix}: replay item rejected`, {
    status: item.status,
    reason: item.reason,
    replayKey: item.replayKey,
    taskId: item.taskId,
  });
}

/**
 * @param {{
 *   taskBoardGateway: {
 *     upsertTask: (request: unknown) => Promise<Record<string, unknown>>,
 *     transitionTask: (request: unknown) => Promise<Record<string, unknown>>,
 *     replayRunLinks: (request: unknown) => Promise<Record<string, unknown>>
 *   }
 * }} config
 */
export function createTaskBoardRunLinker({ taskBoardGateway }) {
  if (typeof taskBoardGateway !== "object" || taskBoardGateway === null) {
    throw new RuntimeExecutionError("taskBoardGateway must be an object");
  }

  if (typeof taskBoardGateway.upsertTask !== "function") {
    throw new RuntimeExecutionError(
      "taskBoardGateway.upsertTask must be a function",
    );
  }

  if (typeof taskBoardGateway.transitionTask !== "function") {
    throw new RuntimeExecutionError(
      "taskBoardGateway.transitionTask must be a function",
    );
  }

  if (typeof taskBoardGateway.replayRunLinks !== "function") {
    throw new RuntimeExecutionError(
      "taskBoardGateway.replayRunLinks must be a function",
    );
  }

  /** @type {Record<string, unknown>[]} */
  const automationRunLedger = [];
  /** @type {Record<string, unknown>[]} */
  const heartbeatRunLedger = [];

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async recordAutomationRun(request) {
      const parsed = validateRequest(request, automationRunRecordSchema.schemaId);
      const record = Object.freeze({ ...parsed });
      automationRunLedger.push(record);

      const replayResult = await taskBoardGateway.replayRunLinks({
        records: [toAutomationReplayRecord(record)],
      });
      const firstItem = /** @type {Record<string, unknown>|undefined} */ (
        Array.isArray(replayResult.items) ? replayResult.items[0] : undefined
      );
      assertReplayItemLinked(firstItem, "Task-board replay failed for automation run");

      return {
        status: "linked",
        taskId: firstItem.taskId,
        targetStatus: mapAutomationStatusToTaskStatus(
          /** @type {Record<string, unknown>} */ (record.output),
        ),
        taskVersion: firstItem.version ?? 0,
      };
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async recordHeartbeatRun(request) {
      const parsed = validateRequest(request, heartbeatRunRecordSchema.schemaId);
      const record = Object.freeze({ ...parsed });
      heartbeatRunLedger.push(record);

      const replayResult = await taskBoardGateway.replayRunLinks({
        records: [toHeartbeatReplayRecord(record)],
      });
      const firstItem = /** @type {Record<string, unknown>|undefined} */ (
        Array.isArray(replayResult.items) ? replayResult.items[0] : undefined
      );
      assertReplayItemLinked(firstItem, "Task-board replay failed for heartbeat run");

      return {
        status: "linked",
        taskId: firstItem.taskId,
        targetStatus: mapHeartbeatStatusToTaskStatus(
          /** @type {Record<string, unknown>} */ (record.output),
        ),
        taskVersion: firstItem.version ?? 0,
      };
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async replayRecordedRuns(request = {}) {
      const parsed = validateRequest(request, replayRequestSchema.schemaId);
      const source = /** @type {"automation"|"heartbeat"|"all"|undefined} */ (
        parsed.source
      ) ?? "all";
      const fromSequence =
        /** @type {number|undefined} */ (parsed.fromSequence) ?? 0;

      const selectedAutomationRuns =
        source === "heartbeat"
          ? []
          : automationRunLedger.slice(fromSequence);
      const selectedHeartbeatRuns =
        source === "automation"
          ? []
          : heartbeatRunLedger.slice(fromSequence);

      const replayRecords = [
        ...selectedAutomationRuns.map((record) => toAutomationReplayRecord(record)),
        ...selectedHeartbeatRuns.map((record) => toHeartbeatReplayRecord(record)),
      ];

      const replayResult = await taskBoardGateway.replayRunLinks({
        records: replayRecords,
      });

      return {
        status: "ok",
        source,
        fromSequence,
        automationRecordCount: selectedAutomationRuns.length,
        heartbeatRecordCount: selectedHeartbeatRuns.length,
        linkedCount: replayResult.linkedCount,
        skippedCount: replayResult.skippedCount,
        rejectedCount: replayResult.rejectedCount,
        totalCount: replayResult.totalCount,
      };
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listAutomationRunLedger() {
      return Object.freeze([...automationRunLedger]);
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listHeartbeatRunLedger() {
      return Object.freeze([...heartbeatRunLedger]);
    },
  });
}
