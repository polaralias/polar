import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringArrayField,
  stringField,
} from "./runtime-contracts.mjs";

export const TASK_BOARD_STATUSES = Object.freeze([
  "todo",
  "in_progress",
  "blocked",
  "done",
]);

export const TASK_BOARD_ASSIGNEE_TYPES = Object.freeze([
  "user",
  "agent",
  "agent_profile",
]);

export const TASK_BOARD_UPSERT_STATUSES = Object.freeze(["applied", "rejected"]);
export const TASK_BOARD_TRANSITION_STATUSES = Object.freeze([
  "applied",
  "rejected",
]);
export const TASK_BOARD_LIST_STATUSES = Object.freeze(["ok"]);
export const TASK_BOARD_REPLAY_STATUSES = Object.freeze(["ok"]);
export const TASK_BOARD_EVENT_TYPES = Object.freeze([
  "task_created",
  "task_updated",
  "task_transitioned",
]);

export const TASK_BOARD_ACTIONS = Object.freeze({
  upsertTask: Object.freeze({
    actionId: "task-board.task.upsert",
    version: 1,
  }),
  transitionTask: Object.freeze({
    actionId: "task-board.task.transition",
    version: 1,
  }),
  listTasks: Object.freeze({
    actionId: "task-board.task.list",
    version: 1,
  }),
  listTaskEvents: Object.freeze({
    actionId: "task-board.event.list",
    version: 1,
  }),
  replayRunLinks: Object.freeze({
    actionId: "task-board.run-link.replay",
    version: 1,
  }),
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createTaskBoardContracts(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze([
    Object.freeze({
      actionId: TASK_BOARD_ACTIONS.upsertTask.actionId,
      version: TASK_BOARD_ACTIONS.upsertTask.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "task-board.task.upsert.input",
        fields: {
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
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "task-board.task.upsert.output",
        fields: {
          status: enumField(TASK_BOARD_UPSERT_STATUSES),
          taskId: stringField({ minLength: 1 }),
          version: numberField({ min: 0 }),
          previousVersion: numberField({ min: 0 }),
          eventId: stringField({ minLength: 1, required: false }),
          task: jsonField({ required: false }),
          reason: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 15_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: TASK_BOARD_ACTIONS.transitionTask.actionId,
      version: TASK_BOARD_ACTIONS.transitionTask.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "task-board.task.transition.input",
        fields: {
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
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "task-board.task.transition.output",
        fields: {
          status: enumField(TASK_BOARD_TRANSITION_STATUSES),
          taskId: stringField({ minLength: 1 }),
          fromStatus: enumField(TASK_BOARD_STATUSES, { required: false }),
          toStatus: enumField(TASK_BOARD_STATUSES),
          version: numberField({ min: 0 }),
          previousVersion: numberField({ min: 0 }),
          eventId: stringField({ minLength: 1, required: false }),
          task: jsonField({ required: false }),
          reason: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 15_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: TASK_BOARD_ACTIONS.listTasks.actionId,
      version: TASK_BOARD_ACTIONS.listTasks.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "task-board.task.list.input",
        fields: {
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
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "task-board.task.list.output",
        fields: {
          status: enumField(TASK_BOARD_LIST_STATUSES),
          items: jsonField(),
          totalCount: numberField({ min: 0 }),
          nextCursor: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 10_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: TASK_BOARD_ACTIONS.listTaskEvents.actionId,
      version: TASK_BOARD_ACTIONS.listTaskEvents.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "task-board.event.list.input",
        fields: {
          taskId: stringField({ minLength: 1, required: false }),
          cursor: stringField({ minLength: 1, required: false }),
          limit: numberField({ min: 1, max: 500, required: false }),
          sinceMs: numberField({ min: 0, required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "task-board.event.list.output",
        fields: {
          status: enumField(TASK_BOARD_LIST_STATUSES),
          items: jsonField(),
          totalCount: numberField({ min: 0 }),
          nextCursor: stringField({ minLength: 1, required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 10_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: TASK_BOARD_ACTIONS.replayRunLinks.actionId,
      version: TASK_BOARD_ACTIONS.replayRunLinks.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "task-board.run-link.replay.input",
        fields: {
          records: jsonField(),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "task-board.run-link.replay.output",
        fields: {
          status: enumField(TASK_BOARD_REPLAY_STATUSES),
          linkedCount: numberField({ min: 0 }),
          skippedCount: numberField({ min: 0 }),
          rejectedCount: numberField({ min: 0 }),
          totalCount: numberField({ min: 0 }),
          items: jsonField(),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 20_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
  ]);
}
