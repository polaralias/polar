import {
  booleanField,
  createStrictObjectSchema,
  enumField,
  jsonField,
  numberField,
  stringField,
} from "./runtime-contracts.mjs";

export const SCHEDULER_EVENT_SOURCES = Object.freeze([
  "automation",
  "heartbeat",
]);
export const SCHEDULER_EVENT_PROCESS_STATUSES = Object.freeze([
  "processed",
  "rejected",
  "failed",
]);
export const SCHEDULER_EVENT_RUN_STATUSES = Object.freeze([
  "executed",
  "skipped",
  "blocked",
  "failed",
]);
export const SCHEDULER_EVENT_DISPOSITIONS = Object.freeze([
  "none",
  "retry_scheduled",
  "dead_lettered",
]);
export const SCHEDULER_EVENT_QUEUE_TYPES = Object.freeze([
  "processed",
  "retry",
  "dead_letter",
]);
export const SCHEDULER_EVENT_QUEUE_ACTIONABLE_TYPES = Object.freeze([
  "retry",
  "dead_letter",
]);
export const SCHEDULER_EVENT_QUEUE_ACTIONS = Object.freeze(["dismiss"]);
export const SCHEDULER_EVENT_QUEUE_LIST_STATUSES = Object.freeze(["ok"]);
export const SCHEDULER_EVENT_QUEUE_ACTION_STATUSES = Object.freeze([
  "applied",
  "not_found",
]);
export const SCHEDULER_RUN_LINK_REPLAY_SOURCES = Object.freeze([
  "automation",
  "heartbeat",
  "all",
]);
export const SCHEDULER_RUN_LINK_REPLAY_STATUSES = Object.freeze(["ok"]);

export const SCHEDULER_ACTIONS = Object.freeze({
  processPersistedEvent: Object.freeze({
    actionId: "runtime.scheduler.event.process",
    version: 1,
  }),
  replayRunLinks: Object.freeze({
    actionId: "runtime.scheduler.run-link.replay",
    version: 1,
  }),
  listEventQueue: Object.freeze({
    actionId: "runtime.scheduler.event-queue.list",
    version: 1,
  }),
  runQueueAction: Object.freeze({
    actionId: "runtime.scheduler.event-queue.run-action",
    version: 1,
  }),
});

/**
 * @param {{ trustClass?: "native"|"skill"|"mcp"|"plugin", riskClass?: "low"|"moderate"|"high"|"critical" }} [options]
 */
export function createSchedulerContracts(options = {}) {
  const { trustClass = "native", riskClass = "moderate" } = options;

  return Object.freeze([
    Object.freeze({
      actionId: SCHEDULER_ACTIONS.processPersistedEvent.actionId,
      version: SCHEDULER_ACTIONS.processPersistedEvent.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "runtime.scheduler.event.process.input",
        fields: {
          eventId: stringField({ minLength: 1 }),
          source: enumField(SCHEDULER_EVENT_SOURCES),
          runId: stringField({ minLength: 1 }),
          recordedAtMs: numberField({ min: 0 }),
          attempt: numberField({ min: 1, required: false }),
          maxAttempts: numberField({ min: 1, required: false }),
          retryBackoffMs: numberField({ min: 0, required: false }),
          deadLetterOnMaxAttempts: booleanField({ required: false }),
          automationRequest: jsonField({ required: false }),
          heartbeatRequest: jsonField({ required: false }),
          metadata: jsonField({ required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "runtime.scheduler.event.process.output",
        fields: {
          status: enumField(SCHEDULER_EVENT_PROCESS_STATUSES),
          eventId: stringField({ minLength: 1 }),
          source: enumField(SCHEDULER_EVENT_SOURCES),
          runId: stringField({ minLength: 1 }),
          sequence: numberField({ min: 0 }),
          attempt: numberField({ min: 1, required: false }),
          maxAttempts: numberField({ min: 1, required: false }),
          runStatus: enumField(SCHEDULER_EVENT_RUN_STATUSES, {
            required: false,
          }),
          disposition: enumField(SCHEDULER_EVENT_DISPOSITIONS, {
            required: false,
          }),
          retryAtMs: numberField({ min: 0, required: false }),
          nextAttempt: numberField({ min: 1, required: false }),
          deadLetterReason: stringField({ minLength: 1, required: false }),
          output: jsonField({ required: false }),
          rejectionCode: stringField({ minLength: 1, required: false }),
          reason: stringField({ minLength: 1, required: false }),
          failure: jsonField({ required: false }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 20_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: SCHEDULER_ACTIONS.replayRunLinks.actionId,
      version: SCHEDULER_ACTIONS.replayRunLinks.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "runtime.scheduler.run-link.replay.input",
        fields: {
          source: enumField(SCHEDULER_RUN_LINK_REPLAY_SOURCES, {
            required: false,
          }),
          fromSequence: numberField({ min: 0, required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "runtime.scheduler.run-link.replay.output",
        fields: {
          status: enumField(SCHEDULER_RUN_LINK_REPLAY_STATUSES),
          source: enumField(SCHEDULER_RUN_LINK_REPLAY_SOURCES),
          fromSequence: numberField({ min: 0 }),
          automationRecordCount: numberField({ min: 0 }),
          heartbeatRecordCount: numberField({ min: 0 }),
          linkedCount: numberField({ min: 0 }),
          skippedCount: numberField({ min: 0 }),
          rejectedCount: numberField({ min: 0 }),
          totalCount: numberField({ min: 0 }),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 20_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: SCHEDULER_ACTIONS.listEventQueue.actionId,
      version: SCHEDULER_ACTIONS.listEventQueue.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "runtime.scheduler.event-queue.list.input",
        fields: {
          queue: enumField(SCHEDULER_EVENT_QUEUE_TYPES, {
            required: false,
          }),
          source: enumField(SCHEDULER_EVENT_SOURCES, {
            required: false,
          }),
          eventId: stringField({ minLength: 1, required: false }),
          runId: stringField({ minLength: 1, required: false }),
          status: enumField(SCHEDULER_EVENT_PROCESS_STATUSES, {
            required: false,
          }),
          runStatus: enumField(SCHEDULER_EVENT_RUN_STATUSES, {
            required: false,
          }),
          disposition: enumField(SCHEDULER_EVENT_DISPOSITIONS, {
            required: false,
          }),
          fromSequence: numberField({ min: 0, required: false }),
          limit: numberField({ min: 1, max: 500, required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "runtime.scheduler.event-queue.list.output",
        fields: {
          status: enumField(SCHEDULER_EVENT_QUEUE_LIST_STATUSES),
          queue: enumField(SCHEDULER_EVENT_QUEUE_TYPES),
          fromSequence: numberField({ min: 0 }),
          returnedCount: numberField({ min: 0 }),
          totalCount: numberField({ min: 0 }),
          nextFromSequence: numberField({ min: 1, required: false }),
          items: jsonField(),
          summary: jsonField(),
        },
      }),
      riskClass,
      trustClass,
      timeoutMs: 20_000,
      retryPolicy: {
        maxAttempts: 1,
      },
    }),
    Object.freeze({
      actionId: SCHEDULER_ACTIONS.runQueueAction.actionId,
      version: SCHEDULER_ACTIONS.runQueueAction.version,
      inputSchema: createStrictObjectSchema({
        schemaId: "runtime.scheduler.event-queue.run-action.input",
        fields: {
          queue: enumField(SCHEDULER_EVENT_QUEUE_ACTIONABLE_TYPES),
          action: enumField(SCHEDULER_EVENT_QUEUE_ACTIONS),
          eventId: stringField({ minLength: 1 }),
          sequence: numberField({ min: 0, required: false }),
        },
      }),
      outputSchema: createStrictObjectSchema({
        schemaId: "runtime.scheduler.event-queue.run-action.output",
        fields: {
          status: enumField(SCHEDULER_EVENT_QUEUE_ACTION_STATUSES),
          queue: enumField(SCHEDULER_EVENT_QUEUE_ACTIONABLE_TYPES),
          action: enumField(SCHEDULER_EVENT_QUEUE_ACTIONS),
          eventId: stringField({ minLength: 1 }),
          sequence: numberField({ min: 0, required: false }),
          source: enumField(SCHEDULER_EVENT_SOURCES, {
            required: false,
          }),
          runId: stringField({ minLength: 1, required: false }),
          attempt: numberField({ min: 1, required: false }),
          maxAttempts: numberField({ min: 1, required: false }),
          appliedAtMs: numberField({ min: 0, required: false }),
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
