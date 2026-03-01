import {
  booleanField,
  ContractValidationError,
  RuntimeExecutionError,
  TASK_BOARD_ACTIONS,
  TASK_BOARD_ASSIGNEE_TYPES,
  TASK_BOARD_EVENT_TYPES,
  TASK_BOARD_STATUSES,
  createStrictObjectSchema,
  createTaskBoardContracts,
  enumField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
} from "@polar/domain";

const upsertRequestSchema = createStrictObjectSchema({
  schemaId: "task-board.gateway.task.upsert.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    taskId: stringField({ minLength: 1 }),
    title: stringField({ minLength: 1 }),
    assigneeType: enumField(TASK_BOARD_ASSIGNEE_TYPES),
    assigneeId: stringField({ minLength: 1 }),
    status: enumField(TASK_BOARD_STATUSES, { required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1, required: false }),
    artifactIds: stringArrayField({ minItems: 0, required: false }),
    priority: numberField({ min: 0, max: 3, required: false }),
    dueAtMs: numberField({ min: 0, required: false }),
    expectedVersion: numberField({ min: 0, required: false }),
    actorId: stringField({ minLength: 1, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const transitionRequestSchema = createStrictObjectSchema({
  schemaId: "task-board.gateway.task.transition.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    taskId: stringField({ minLength: 1 }),
    toStatus: enumField(TASK_BOARD_STATUSES),
    expectedVersion: numberField({ min: 0, required: false }),
    assigneeType: enumField(TASK_BOARD_ASSIGNEE_TYPES, {
      required: false,
    }),
    assigneeId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1, required: false }),
    actorId: stringField({ minLength: 1, required: false }),
    reason: stringField({ minLength: 1, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const listRequestSchema = createStrictObjectSchema({
  schemaId: "task-board.gateway.task.list.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    status: enumField(TASK_BOARD_STATUSES, { required: false }),
    assigneeType: enumField(TASK_BOARD_ASSIGNEE_TYPES, {
      required: false,
    }),
    assigneeId: stringField({ minLength: 1, required: false }),
    sessionId: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1, required: false }),
    includeDone: booleanField({ required: false }),
    cursor: stringField({ minLength: 1, required: false }),
    limit: numberField({ min: 1, max: 200, required: false }),
  },
});

const listEventsRequestSchema = createStrictObjectSchema({
  schemaId: "task-board.gateway.event.list.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    taskId: stringField({ minLength: 1, required: false }),
    cursor: stringField({ minLength: 1, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
    sinceMs: numberField({ min: 0, required: false }),
  },
});

const replayRunLinksRequestSchema = createStrictObjectSchema({
  schemaId: "task-board.gateway.run-link.replay.request",
  fields: {
    executionType: enumField(["tool", "handoff", "automation", "heartbeat"], {
      required: false,
    }),
    traceId: stringField({ minLength: 1, required: false }),
    records: jsonField(),
  },
});

const taskRecordSchema = createStrictObjectSchema({
  schemaId: "task-board.gateway.task-record",
  fields: {
    taskId: stringField({ minLength: 1 }),
    title: stringField({ minLength: 1 }),
    status: enumField(TASK_BOARD_STATUSES),
    assigneeType: enumField(TASK_BOARD_ASSIGNEE_TYPES),
    assigneeId: stringField({ minLength: 1 }),
    sessionId: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1, required: false }),
    artifactIds: stringArrayField({ minItems: 0, required: false }),
    priority: numberField({ min: 0, max: 3, required: false }),
    dueAtMs: numberField({ min: 0, required: false }),
    metadata: jsonField({ required: false }),
    version: numberField({ min: 1 }),
    createdAtMs: numberField({ min: 0 }),
    updatedAtMs: numberField({ min: 0 }),
  },
});

const eventRecordSchema = createStrictObjectSchema({
  schemaId: "task-board.gateway.event-record",
  fields: {
    eventId: stringField({ minLength: 1 }),
    sequence: numberField({ min: 0 }),
    eventType: enumField(TASK_BOARD_EVENT_TYPES),
    taskId: stringField({ minLength: 1 }),
    version: numberField({ min: 1 }),
    status: enumField(TASK_BOARD_STATUSES),
    previousStatus: enumField(TASK_BOARD_STATUSES, { required: false }),
    actorId: stringField({ minLength: 1, required: false }),
    reason: stringField({ minLength: 1, required: false }),
    timestampMs: numberField({ min: 0 }),
    payload: jsonField({ required: false }),
  },
});

const runLinkRecordSchema = createStrictObjectSchema({
  schemaId: "task-board.gateway.run-link-record",
  fields: {
    replayKey: stringField({ minLength: 1 }),
    taskId: stringField({ minLength: 1 }),
    title: stringField({ minLength: 1 }),
    assigneeType: enumField(TASK_BOARD_ASSIGNEE_TYPES),
    assigneeId: stringField({ minLength: 1 }),
    toStatus: enumField(TASK_BOARD_STATUSES),
    sessionId: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1, required: false }),
    actorId: stringField({ minLength: 1, required: false }),
    reason: stringField({ minLength: 1, required: false }),
    metadata: jsonField({ required: false }),
  },
});

const ALLOWED_TRANSITIONS = Object.freeze({
  todo: Object.freeze(["in_progress", "blocked", "done"]),
  in_progress: Object.freeze(["todo", "blocked", "done"]),
  blocked: Object.freeze(["todo", "in_progress", "done"]),
  done: Object.freeze(["todo"]),
});

/**
 * @param {unknown} value
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function validateRequest(value, schemaId) {
  const schema = {
    [upsertRequestSchema.schemaId]: upsertRequestSchema,
    [transitionRequestSchema.schemaId]: transitionRequestSchema,
    [listRequestSchema.schemaId]: listRequestSchema,
    [listEventsRequestSchema.schemaId]: listEventsRequestSchema,
    [replayRunLinksRequestSchema.schemaId]: replayRunLinksRequestSchema,
    [taskRecordSchema.schemaId]: taskRecordSchema,
    [eventRecordSchema.schemaId]: eventRecordSchema,
    [runLinkRecordSchema.schemaId]: runLinkRecordSchema,
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
 * @param {readonly string[]|undefined} value
 * @returns {readonly string[]}
 */
function normalizeArtifactIds(value) {
  const artifactIds = value ?? [];
  const deduped = new Set();
  for (const artifactId of artifactIds) {
    if (typeof artifactId === "string" && artifactId.length > 0) {
      deduped.add(artifactId);
    }
  }

  return Object.freeze(
    [...deduped].sort((left, right) => left.localeCompare(right)),
  );
}

/**
 * @param {string|undefined} cursor
 * @param {string} schemaId
 * @returns {number}
 */
function parseCursor(cursor, schemaId) {
  if (cursor === undefined) {
    return 0;
  }

  if (!/^\d+$/.test(cursor)) {
    throw new ContractValidationError("Invalid task-board cursor", {
      schemaId,
      errors: [`${schemaId}.cursor must be an unsigned integer string`],
    });
  }

  const offset = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ContractValidationError("Invalid task-board cursor", {
      schemaId,
      errors: [`${schemaId}.cursor must be a safe non-negative integer`],
    });
  }

  return offset;
}

/**
 * @param {"todo"|"in_progress"|"blocked"|"done"} fromStatus
 * @param {"todo"|"in_progress"|"blocked"|"done"} toStatus
 * @returns {boolean}
 */
function isValidStatusTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  return allowed.includes(toStatus);
}

/**
 * @param {Record<string, unknown>} task
 * @returns {Record<string, unknown>}
 */
function formatTask(task) {
  return Object.freeze({
    taskId: task.taskId,
    title: task.title,
    status: task.status,
    assigneeType: task.assigneeType,
    assigneeId: task.assigneeId,
    ...(task.sessionId !== undefined ? { sessionId: task.sessionId } : {}),
    ...(task.runId !== undefined ? { runId: task.runId } : {}),
    ...(task.artifactIds !== undefined ? { artifactIds: task.artifactIds } : {}),
    ...(task.priority !== undefined ? { priority: task.priority } : {}),
    ...(task.dueAtMs !== undefined ? { dueAtMs: task.dueAtMs } : {}),
    ...(task.metadata !== undefined ? { metadata: task.metadata } : {}),
    version: task.version,
    createdAtMs: task.createdAtMs,
    updatedAtMs: task.updatedAtMs,
  });
}

/**
 * @param {Record<string, unknown>} event
 * @returns {Record<string, unknown>}
 */
function formatEvent(event) {
  return Object.freeze({
    eventId: event.eventId,
    sequence: event.sequence,
    eventType: event.eventType,
    taskId: event.taskId,
    version: event.version,
    status: event.status,
    ...(event.previousStatus !== undefined
      ? { previousStatus: event.previousStatus }
      : {}),
    ...(event.actorId !== undefined ? { actorId: event.actorId } : {}),
    ...(event.reason !== undefined ? { reason: event.reason } : {}),
    timestampMs: event.timestampMs,
    ...(event.payload !== undefined ? { payload: event.payload } : {}),
  });
}

/**
 * @param {ReturnType<import("./contract-registry.mjs").createContractRegistry>} contractRegistry
 */
export function registerTaskBoardContracts(contractRegistry) {
  for (const contract of createTaskBoardContracts()) {
    if (!contractRegistry.has(contract.actionId, contract.version)) {
      contractRegistry.register(contract);
    }
  }
}

/**
 * @param {{
 *   middlewarePipeline: ReturnType<import("./middleware-pipeline.mjs").createMiddlewarePipeline>,
 *   initialTasks?: readonly Record<string, unknown>[],
 *   defaultExecutionType?: "tool"|"handoff"|"automation"|"heartbeat",
 *   now?: () => number
 * }} config
 */
export function createTaskBoardGateway({
  middlewarePipeline,
  initialTasks = [],
  defaultExecutionType = "tool",
  now = () => Date.now(),
}) {
  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const tasks = new Map();
  /** @type {Record<string, unknown>[]} */
  const events = [];
  /** @type {Set<string>} */
  const appliedReplayKeys = new Set();

  /**
   * @param {{
   *   eventType: "task_created"|"task_updated"|"task_transitioned",
   *   task: Record<string, unknown>,
   *   previousStatus?: "todo"|"in_progress"|"blocked"|"done",
   *   actorId?: string,
   *   reason?: string,
   *   payload?: unknown
   * }} input
   * @returns {Record<string, unknown>}
   */
  const appendEvent = ({ eventType, task, previousStatus, actorId, reason, payload }) => {
    const sequence = events.length;
    const event = validateRequest(
      {
        eventId: `task-event-${sequence + 1}`,
        sequence,
        eventType,
        taskId: task.taskId,
        version: task.version,
        status: task.status,
        ...(previousStatus !== undefined ? { previousStatus } : {}),
        ...(actorId !== undefined ? { actorId } : {}),
        ...(reason !== undefined ? { reason } : {}),
        timestampMs: now(),
        ...(payload !== undefined ? { payload } : {}),
      },
      eventRecordSchema.schemaId,
    );
    events.push(event);
    return event;
  };

  for (const initialTask of initialTasks) {
    const normalizedTask = validateRequest(initialTask, taskRecordSchema.schemaId);
    const taskId = /** @type {string} */ (normalizedTask.taskId);
    if (tasks.has(taskId)) {
      throw new RuntimeExecutionError(
        "Duplicate initial task id in task-board gateway",
        {
          taskId,
        },
      );
    }

    tasks.set(
      taskId,
      validateRequest(
        {
          ...normalizedTask,
          ...(normalizedTask.artifactIds !== undefined
            ? {
                artifactIds: normalizeArtifactIds(
                  /** @type {readonly string[]|undefined} */ (
                    normalizedTask.artifactIds
                  ),
                ),
              }
            : {}),
        },
        taskRecordSchema.schemaId,
      ),
    );
  }

  /**
   * @param {Record<string, unknown>} input
   * @returns {Record<string, unknown>}
   */
  const applyUpsertTask = (input) => {
    const taskId = /** @type {string} */ (input.taskId);
    const currentTask = tasks.get(taskId);
    const previousVersion =
      /** @type {number|undefined} */ (currentTask?.version) ?? 0;
    const expectedVersion = /** @type {number|undefined} */ (input.expectedVersion);

    if (expectedVersion !== undefined && expectedVersion !== previousVersion) {
      return {
        status: "rejected",
        taskId,
        version: previousVersion,
        previousVersion,
        reason: "Version conflict",
      };
    }

    const timestampMs = now();
    const nextVersion = previousVersion + 1;
    const nextTask = validateRequest(
      {
        taskId,
        title: input.title,
        status:
          /** @type {"todo"|"in_progress"|"blocked"|"done"|undefined} */ (
            input.status
          ) ?? /** @type {"todo"|"in_progress"|"blocked"|"done"|undefined} */ (
            currentTask?.status
          ) ?? "todo",
        assigneeType: input.assigneeType,
        assigneeId: input.assigneeId,
        ...(input.sessionId !== undefined
          ? { sessionId: input.sessionId }
          : currentTask?.sessionId !== undefined
            ? { sessionId: currentTask.sessionId }
            : {}),
        ...(input.runId !== undefined
          ? { runId: input.runId }
          : currentTask?.runId !== undefined
            ? { runId: currentTask.runId }
            : {}),
        ...(input.artifactIds !== undefined
          ? {
              artifactIds: normalizeArtifactIds(
                /** @type {readonly string[]|undefined} */ (input.artifactIds),
              ),
            }
          : currentTask?.artifactIds !== undefined
            ? {
                artifactIds: normalizeArtifactIds(
                  /** @type {readonly string[]|undefined} */ (currentTask.artifactIds),
                ),
              }
            : {}),
        ...(input.priority !== undefined
          ? { priority: input.priority }
          : currentTask?.priority !== undefined
            ? { priority: currentTask.priority }
            : {}),
        ...(input.dueAtMs !== undefined
          ? { dueAtMs: input.dueAtMs }
          : currentTask?.dueAtMs !== undefined
            ? { dueAtMs: currentTask.dueAtMs }
            : {}),
        ...(input.metadata !== undefined
          ? { metadata: input.metadata }
          : currentTask?.metadata !== undefined
            ? { metadata: currentTask.metadata }
            : {}),
        version: nextVersion,
        createdAtMs:
          /** @type {number|undefined} */ (currentTask?.createdAtMs) ?? timestampMs,
        updatedAtMs: timestampMs,
      },
      taskRecordSchema.schemaId,
    );
    tasks.set(taskId, nextTask);

    const event = appendEvent({
      eventType: previousVersion === 0 ? "task_created" : "task_updated",
      task: nextTask,
      actorId: /** @type {string|undefined} */ (input.actorId),
      payload: input.metadata,
    });

    return {
      status: "applied",
      taskId,
      version: nextVersion,
      previousVersion,
      eventId: event.eventId,
      task: formatTask(nextTask),
    };
  };

  /**
   * @param {Record<string, unknown>} input
   * @returns {Record<string, unknown>}
   */
  const applyTransitionTask = (input) => {
    const taskId = /** @type {string} */ (input.taskId);
    const toStatus = /** @type {"todo"|"in_progress"|"blocked"|"done"} */ (
      input.toStatus
    );
    const currentTask = tasks.get(taskId);

    if (!currentTask) {
      return {
        status: "rejected",
        taskId,
        toStatus,
        version: 0,
        previousVersion: 0,
        reason: "Task is not registered",
      };
    }

    const previousVersion = /** @type {number} */ (currentTask.version);
    const expectedVersion = /** @type {number|undefined} */ (input.expectedVersion);
    if (expectedVersion !== undefined && expectedVersion !== previousVersion) {
      return {
        status: "rejected",
        taskId,
        fromStatus: currentTask.status,
        toStatus,
        version: previousVersion,
        previousVersion,
        reason: "Version conflict",
      };
    }

    const fromStatus = /** @type {"todo"|"in_progress"|"blocked"|"done"} */ (
      currentTask.status
    );
    if (fromStatus === toStatus) {
      return {
        status: "rejected",
        taskId,
        fromStatus,
        toStatus,
        version: previousVersion,
        previousVersion,
        reason: "Task is already in requested status",
      };
    }

    const hasAssigneeType = input.assigneeType !== undefined;
    const hasAssigneeId = input.assigneeId !== undefined;
    if (hasAssigneeType !== hasAssigneeId) {
      return {
        status: "rejected",
        taskId,
        fromStatus,
        toStatus,
        version: previousVersion,
        previousVersion,
        reason: "Assignee type and assignee id must be provided together",
      };
    }

    if (!isValidStatusTransition(fromStatus, toStatus)) {
      return {
        status: "rejected",
        taskId,
        fromStatus,
        toStatus,
        version: previousVersion,
        previousVersion,
        reason: `Invalid status transition from ${fromStatus} to ${toStatus}`,
      };
    }

    const nextTask = validateRequest(
      {
        ...currentTask,
        status: toStatus,
        version: previousVersion + 1,
        updatedAtMs: now(),
        ...(hasAssigneeType
          ? {
              assigneeType: input.assigneeType,
              assigneeId: input.assigneeId,
            }
          : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
      taskRecordSchema.schemaId,
    );
    tasks.set(taskId, nextTask);

    const event = appendEvent({
      eventType: "task_transitioned",
      task: nextTask,
      previousStatus: fromStatus,
      actorId: /** @type {string|undefined} */ (input.actorId),
      reason: /** @type {string|undefined} */ (input.reason),
      payload: input.metadata,
    });

    return {
      status: "applied",
      taskId,
      fromStatus,
      toStatus,
      version: nextTask.version,
      previousVersion,
      eventId: event.eventId,
      task: formatTask(nextTask),
    };
  };

  /**
   * @param {unknown} recordsValue
   * @returns {readonly Record<string, unknown>[]}
   */
  const parseRunLinkRecords = (recordsValue) => {
    if (!Array.isArray(recordsValue)) {
      throw new ContractValidationError("Invalid replay run-link records", {
        schemaId: replayRunLinksRequestSchema.schemaId,
        errors: [`${replayRunLinksRequestSchema.schemaId}.records must be an array`],
      });
    }

    return Object.freeze(
      recordsValue.map((value, index) => {
        try {
          return validateRequest(value, runLinkRecordSchema.schemaId);
        } catch (error) {
          if (error instanceof ContractValidationError) {
            throw new ContractValidationError("Invalid replay run-link record", {
              schemaId: runLinkRecordSchema.schemaId,
              index,
              errors: error.details.errors,
            });
          }
          throw error;
        }
      }),
    );
  };

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async upsertTask(request) {
      const parsed = validateRequest(request, upsertRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: TASK_BOARD_ACTIONS.upsertTask.actionId,
          version: TASK_BOARD_ACTIONS.upsertTask.version,
          input: {
            taskId: parsed.taskId,
            title: parsed.title,
            assigneeType: parsed.assigneeType,
            assigneeId: parsed.assigneeId,
            ...(parsed.status !== undefined ? { status: parsed.status } : {}),
            ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
            ...(parsed.runId !== undefined ? { runId: parsed.runId } : {}),
            ...(parsed.artifactIds !== undefined
              ? { artifactIds: parsed.artifactIds }
              : {}),
            ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
            ...(parsed.dueAtMs !== undefined ? { dueAtMs: parsed.dueAtMs } : {}),
            ...(parsed.expectedVersion !== undefined
              ? { expectedVersion: parsed.expectedVersion }
              : {}),
            ...(parsed.actorId !== undefined ? { actorId: parsed.actorId } : {}),
            ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
          },
        },
        async (input) => applyUpsertTask(input),
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async transitionTask(request) {
      const parsed = validateRequest(request, transitionRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: TASK_BOARD_ACTIONS.transitionTask.actionId,
          version: TASK_BOARD_ACTIONS.transitionTask.version,
          input: {
            taskId: parsed.taskId,
            toStatus: parsed.toStatus,
            ...(parsed.expectedVersion !== undefined
              ? { expectedVersion: parsed.expectedVersion }
              : {}),
            ...(parsed.assigneeType !== undefined
              ? { assigneeType: parsed.assigneeType }
              : {}),
            ...(parsed.assigneeId !== undefined
              ? { assigneeId: parsed.assigneeId }
              : {}),
            ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
            ...(parsed.runId !== undefined ? { runId: parsed.runId } : {}),
            ...(parsed.actorId !== undefined ? { actorId: parsed.actorId } : {}),
            ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
            ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
          },
        },
        async (input) => applyTransitionTask(input),
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listTasks(request) {
      const parsed = validateRequest(request, listRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: TASK_BOARD_ACTIONS.listTasks.actionId,
          version: TASK_BOARD_ACTIONS.listTasks.version,
          input: {
            ...(parsed.status !== undefined ? { status: parsed.status } : {}),
            ...(parsed.assigneeType !== undefined
              ? { assigneeType: parsed.assigneeType }
              : {}),
            ...(parsed.assigneeId !== undefined
              ? { assigneeId: parsed.assigneeId }
              : {}),
            ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
            ...(parsed.runId !== undefined ? { runId: parsed.runId } : {}),
            ...(parsed.includeDone !== undefined
              ? { includeDone: parsed.includeDone }
              : {}),
            ...(parsed.cursor !== undefined ? { cursor: parsed.cursor } : {}),
            ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
          },
        },
        async (input) => {
          const includeDone =
            typeof input.includeDone === "boolean" ? input.includeDone : true;
          const offset = parseCursor(
            /** @type {string|undefined} */ (input.cursor),
            listRequestSchema.schemaId,
          );
          const limit = /** @type {number|undefined} */ (input.limit) ?? 50;

          const filteredTasks = [...tasks.values()]
            .filter((task) => {
              if (!includeDone && task.status === "done") {
                return false;
              }

              if (input.status !== undefined && task.status !== input.status) {
                return false;
              }

              if (
                input.assigneeType !== undefined &&
                task.assigneeType !== input.assigneeType
              ) {
                return false;
              }

              if (
                input.assigneeId !== undefined &&
                task.assigneeId !== input.assigneeId
              ) {
                return false;
              }

              if (
                input.sessionId !== undefined &&
                task.sessionId !== input.sessionId
              ) {
                return false;
              }

              if (input.runId !== undefined && task.runId !== input.runId) {
                return false;
              }

              return true;
            })
            .sort((left, right) => {
              if (left.updatedAtMs !== right.updatedAtMs) {
                return right.updatedAtMs - left.updatedAtMs;
              }

              return left.taskId.localeCompare(right.taskId);
            });

          const totalCount = filteredTasks.length;
          const pagedTasks = filteredTasks.slice(offset, offset + limit);
          const nextOffset = offset + limit;

          return {
            status: "ok",
            items: Object.freeze(pagedTasks.map((task) => formatTask(task))),
            totalCount,
            ...(nextOffset < totalCount ? { nextCursor: String(nextOffset) } : {}),
          };
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async listTaskEvents(request) {
      const parsed = validateRequest(request, listEventsRequestSchema.schemaId);

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: TASK_BOARD_ACTIONS.listTaskEvents.actionId,
          version: TASK_BOARD_ACTIONS.listTaskEvents.version,
          input: {
            ...(parsed.taskId !== undefined ? { taskId: parsed.taskId } : {}),
            ...(parsed.cursor !== undefined ? { cursor: parsed.cursor } : {}),
            ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
            ...(parsed.sinceMs !== undefined ? { sinceMs: parsed.sinceMs } : {}),
          },
        },
        async (input) => {
          const offset = parseCursor(
            /** @type {string|undefined} */ (input.cursor),
            listEventsRequestSchema.schemaId,
          );
          const limit = /** @type {number|undefined} */ (input.limit) ?? 100;
          const sinceMs = /** @type {number|undefined} */ (input.sinceMs);

          const filteredEvents = events
            .filter((event) => {
              if (input.taskId !== undefined && event.taskId !== input.taskId) {
                return false;
              }

              if (sinceMs !== undefined && event.timestampMs < sinceMs) {
                return false;
              }

              return true;
            })
            .sort((left, right) => left.sequence - right.sequence);

          const totalCount = filteredEvents.length;
          const pagedEvents = filteredEvents.slice(offset, offset + limit);
          const nextOffset = offset + limit;

          return {
            status: "ok",
            items: Object.freeze(pagedEvents.map((event) => formatEvent(event))),
            totalCount,
            ...(nextOffset < totalCount ? { nextCursor: String(nextOffset) } : {}),
          };
        },
      );
    },

    /**
     * @param {unknown} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async replayRunLinks(request) {
      const parsed = validateRequest(
        request,
        replayRunLinksRequestSchema.schemaId,
      );

      return middlewarePipeline.run(
        {
          executionType:
            /** @type {"tool"|"handoff"|"automation"|"heartbeat"|undefined} */ (
              parsed.executionType
            ) ?? defaultExecutionType,
          traceId: /** @type {string|undefined} */ (parsed.traceId),
          actionId: TASK_BOARD_ACTIONS.replayRunLinks.actionId,
          version: TASK_BOARD_ACTIONS.replayRunLinks.version,
          input: {
            records: parsed.records,
          },
        },
        async (input) => {
          const records = parseRunLinkRecords(input.records);
          const items = [];
          let linkedCount = 0;
          let skippedCount = 0;
          let rejectedCount = 0;

          for (const record of records) {
            const replayKey = /** @type {string} */ (record.replayKey);

            if (appliedReplayKeys.has(replayKey)) {
              skippedCount += 1;
              items.push(
                Object.freeze({
                  replayKey,
                  taskId: record.taskId,
                  status: "skipped_duplicate",
                }),
              );
              continue;
            }

            const upsertResult = applyUpsertTask({
              taskId: record.taskId,
              title: record.title,
              assigneeType: record.assigneeType,
              assigneeId: record.assigneeId,
              status: "todo",
              ...(record.sessionId !== undefined
                ? {
                    sessionId: record.sessionId,
                  }
                : {}),
              ...(record.runId !== undefined
                ? {
                    runId: record.runId,
                  }
                : {}),
              ...(record.actorId !== undefined
                ? {
                    actorId: record.actorId,
                  }
                : {}),
              ...(record.metadata !== undefined
                ? {
                    metadata: record.metadata,
                  }
                : {}),
            });

            if (upsertResult.status !== "applied") {
              rejectedCount += 1;
              items.push(
                Object.freeze({
                  replayKey,
                  taskId: record.taskId,
                  status: "rejected",
                  reason: upsertResult.reason ?? "Task upsert rejected",
                }),
              );
              continue;
            }

            const transitionResult = applyTransitionTask({
              taskId: record.taskId,
              toStatus: record.toStatus,
              assigneeType: record.assigneeType,
              assigneeId: record.assigneeId,
              ...(record.sessionId !== undefined
                ? {
                    sessionId: record.sessionId,
                  }
                : {}),
              ...(record.runId !== undefined
                ? {
                    runId: record.runId,
                  }
                : {}),
              ...(record.actorId !== undefined
                ? {
                    actorId: record.actorId,
                  }
                : {}),
              ...(record.reason !== undefined
                ? {
                    reason: record.reason,
                  }
                : {}),
              ...(record.metadata !== undefined
                ? {
                    metadata: record.metadata,
                  }
                : {}),
            });

            if (
              transitionResult.status === "rejected" &&
              transitionResult.reason !== "Task is already in requested status"
            ) {
              rejectedCount += 1;
              items.push(
                Object.freeze({
                  replayKey,
                  taskId: record.taskId,
                  status: "rejected",
                  reason:
                    transitionResult.reason ?? "Task transition rejected",
                }),
              );
              continue;
            }

            appliedReplayKeys.add(replayKey);
            linkedCount += 1;
            items.push(
              Object.freeze({
                replayKey,
                taskId: record.taskId,
                status: "linked",
                version:
                  transitionResult.version ??
                  upsertResult.version ??
                  0,
              }),
            );
          }

          return {
            status: "ok",
            linkedCount,
            skippedCount,
            rejectedCount,
            totalCount: records.length,
            items: Object.freeze(items),
          };
        },
      );
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listTasksState() {
      return Object.freeze(
        [...tasks.values()]
          .map((task) => formatTask(task))
          .sort((left, right) => left.taskId.localeCompare(right.taskId)),
      );
    },

    /**
     * @returns {readonly Record<string, unknown>[]}
     */
    listTaskEventsState() {
      return Object.freeze(
        [...events]
          .map((event) => formatEvent(event))
          .sort((left, right) => left.sequence - right.sequence),
      );
    },

    /**
     * @returns {readonly string[]}
     */
    listAppliedReplayKeysState() {
      return Object.freeze([...appliedReplayKeys].sort((left, right) =>
        left.localeCompare(right),
      ));
    },
  });
}
