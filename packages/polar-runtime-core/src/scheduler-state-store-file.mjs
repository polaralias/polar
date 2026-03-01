import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  ContractValidationError,
  RuntimeExecutionError,
  SCHEDULER_EVENT_PROCESS_STATUSES,
  SCHEDULER_EVENT_SOURCES,
} from "@polar/domain";

const DEFAULT_STATE_VERSION = 1;
const processStatuses = new Set(SCHEDULER_EVENT_PROCESS_STATUSES);
const eventSources = new Set(SCHEDULER_EVENT_SOURCES);

/**
 * @returns {{
 *   version: number,
 *   processedEvents: Record<string, unknown>[],
 *   retryEvents: Record<string, unknown>[],
 *   deadLetterEvents: Record<string, unknown>[]
 * }}
 */
function createEmptyState() {
  return {
    version: DEFAULT_STATE_VERSION,
    processedEvents: [],
    retryEvents: [],
    deadLetterEvents: [],
  };
}

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
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNonNegativeInteger(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isPositiveInteger(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) > 0;
}

/**
 * @param {unknown} request
 * @param {string} schemaId
 * @returns {{ eventId: string, sequence?: number }}
 */
function parseQueueRemovalRequest(request, schemaId) {
  if (!isPlainObject(request) || !isNonEmptyString(request.eventId)) {
    throwValidationError(schemaId, `${schemaId}.eventId must be a non-empty string`);
  }

  if (
    request.sequence !== undefined &&
    !isNonNegativeInteger(request.sequence)
  ) {
    throwValidationError(
      schemaId,
      `${schemaId}.sequence must be a non-negative integer when provided`,
    );
  }

  return {
    eventId: request.eventId,
    ...(request.sequence !== undefined ? { sequence: request.sequence } : {}),
  };
}

/**
 * @param {string} schemaId
 * @param {string} message
 * @returns {never}
 */
function throwValidationError(schemaId, message) {
  throw new ContractValidationError(message, {
    schemaId,
    errors: [message],
  });
}

/**
 * @param {"processed"|"retry"|"dead_letter"} queue
 * @param {unknown} event
 * @param {string} schemaId
 * @returns {Record<string, unknown>}
 */
function normalizeQueueEvent(queue, event, schemaId) {
  if (!isPlainObject(event)) {
    throwValidationError(schemaId, `${schemaId} must be an object`);
  }

  if (!isNonEmptyString(event.eventId)) {
    throwValidationError(schemaId, `${schemaId}.eventId must be a non-empty string`);
  }

  if (!eventSources.has(event.source)) {
    throwValidationError(
      schemaId,
      `${schemaId}.source must be one of: ${SCHEDULER_EVENT_SOURCES.join(", ")}`,
    );
  }

  if (!isNonEmptyString(event.runId)) {
    throwValidationError(schemaId, `${schemaId}.runId must be a non-empty string`);
  }

  if (!isNonNegativeInteger(event.sequence)) {
    throwValidationError(schemaId, `${schemaId}.sequence must be a non-negative integer`);
  }

  if (queue === "processed" && !processStatuses.has(event.status)) {
    throwValidationError(
      schemaId,
      `${schemaId}.status must be one of: ${SCHEDULER_EVENT_PROCESS_STATUSES.join(", ")}`,
    );
  }

  if (queue === "retry") {
    if (!isPositiveInteger(event.attempt) || !isPositiveInteger(event.maxAttempts)) {
      throwValidationError(
        schemaId,
        `${schemaId}.attempt and ${schemaId}.maxAttempts must be positive integers`,
      );
    }

    if (!isNonNegativeInteger(event.retryAtMs)) {
      throwValidationError(
        schemaId,
        `${schemaId}.retryAtMs must be a non-negative integer`,
      );
    }

    if (!isNonEmptyString(event.reason)) {
      throwValidationError(schemaId, `${schemaId}.reason must be a non-empty string`);
    }
  }

  if (queue === "dead_letter") {
    if (!isPositiveInteger(event.attempt) || !isPositiveInteger(event.maxAttempts)) {
      throwValidationError(
        schemaId,
        `${schemaId}.attempt and ${schemaId}.maxAttempts must be positive integers`,
      );
    }

    if (!isNonEmptyString(event.reason)) {
      throwValidationError(schemaId, `${schemaId}.reason must be a non-empty string`);
    }
  }

  return { ...event };
}

/**
 * @param {unknown} value
 * @returns {{
 *   version: number,
 *   processedEvents: Record<string, unknown>[],
 *   retryEvents: Record<string, unknown>[],
 *   deadLetterEvents: Record<string, unknown>[]
 * }}
 */
function normalizeState(value) {
  const schemaId = "scheduler.state-store.file.state";
  if (!isPlainObject(value)) {
    throwValidationError(schemaId, `${schemaId} must be an object`);
  }

  if (value.version !== DEFAULT_STATE_VERSION) {
    throwValidationError(
      schemaId,
      `${schemaId}.version must equal ${DEFAULT_STATE_VERSION}`,
    );
  }

  if (!Array.isArray(value.processedEvents)) {
    throwValidationError(schemaId, `${schemaId}.processedEvents must be an array`);
  }
  if (!Array.isArray(value.retryEvents)) {
    throwValidationError(schemaId, `${schemaId}.retryEvents must be an array`);
  }
  if (!Array.isArray(value.deadLetterEvents)) {
    throwValidationError(schemaId, `${schemaId}.deadLetterEvents must be an array`);
  }

  return {
    version: DEFAULT_STATE_VERSION,
    processedEvents: value.processedEvents.map((event) =>
      normalizeQueueEvent(
        "processed",
        event,
        "scheduler.state-store.file.state.processedEvents[]",
      ),
    ),
    retryEvents: value.retryEvents.map((event) =>
      normalizeQueueEvent(
        "retry",
        event,
        "scheduler.state-store.file.state.retryEvents[]",
      ),
    ),
    deadLetterEvents: value.deadLetterEvents.map((event) =>
      normalizeQueueEvent(
        "dead_letter",
        event,
        "scheduler.state-store.file.state.deadLetterEvents[]",
      ),
    ),
  };
}

/**
 * @param {readonly Record<string, unknown>[]} events
 * @returns {readonly Record<string, unknown>[]}
 */
function freezeSortedEvents(events) {
  return Object.freeze(
    events
      .map((event) => Object.freeze({ ...event }))
      .sort(
        (left, right) =>
          /** @type {number} */ (left.sequence) -
          /** @type {number} */ (right.sequence),
      ),
  );
}

/**
 * @param {{
 *   filePath: string,
 *   now?: () => number
 * }} config
 */
export function createFileSchedulerStateStore({ filePath, now = () => Date.now() }) {
  if (!isNonEmptyString(filePath)) {
    throw new RuntimeExecutionError("filePath must be a non-empty string");
  }

  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  let initialized = false;
  /** @type {Promise<void>} */
  let operationChain = Promise.resolve();

  /**
   * @template T
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  const runSerialized = async (operation) => {
    const nextOperation = operationChain.then(operation, operation);
    operationChain = nextOperation.then(
      () => undefined,
      () => undefined,
    );
    return nextOperation;
  };

  /**
   * @returns {Promise<void>}
   */
  const ensureInitialized = async () => {
    if (initialized) {
      return;
    }

    await mkdir(dirname(filePath), { recursive: true });
    try {
      await stat(filePath);
    } catch (error) {
      if (
        !(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          /** @type {{ code?: unknown }} */ (error).code === "ENOENT"
        )
      ) {
        throw error;
      }

      const emptyState = createEmptyState();
      await writeState(emptyState);
    }

    initialized = true;
  };

  /**
   * @returns {Promise<ReturnType<typeof createEmptyState>>}
   */
  const readState = async () => {
    await ensureInitialized();
    const raw = await readFile(filePath, "utf8");
    let parsed = undefined;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new RuntimeExecutionError("Failed to parse scheduler state-store file", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    return normalizeState(parsed);
  };

  /**
   * @param {ReturnType<typeof createEmptyState>} state
   * @returns {Promise<void>}
   */
  const writeState = async (state) => {
    const normalized = normalizeState(state);
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    const tempFilePath = `${filePath}.tmp.${process.pid}.${now()}`;

    await writeFile(tempFilePath, payload, "utf8");
    await rename(tempFilePath, filePath);
  };

  return Object.freeze({
    /**
     * @param {unknown} request
     * @returns {Promise<boolean>}
     */
    async hasProcessedEvent(request) {
      const schemaId = "scheduler.state-store.file.has-processed-event.request";
      if (!isPlainObject(request) || !isNonEmptyString(request.eventId)) {
        throwValidationError(
          schemaId,
          `${schemaId}.eventId must be a non-empty string`,
        );
      }

      return runSerialized(async () => {
        const state = await readState();
        return state.processedEvents.some((event) => event.eventId === request.eventId);
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<void>}
     */
    async storeProcessedEvent(request) {
      const event = normalizeQueueEvent(
        "processed",
        request,
        "scheduler.state-store.file.store-processed-event.request",
      );

      await runSerialized(async () => {
        const state = await readState();
        if (state.processedEvents.some((item) => item.eventId === event.eventId)) {
          return;
        }

        state.processedEvents.push(event);
        await writeState(state);
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<void>}
     */
    async storeRetryEvent(request) {
      const event = normalizeQueueEvent(
        "retry",
        request,
        "scheduler.state-store.file.store-retry-event.request",
      );

      await runSerialized(async () => {
        const state = await readState();
        state.retryEvents.push(event);
        await writeState(state);
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<void>}
     */
    async storeDeadLetterEvent(request) {
      const event = normalizeQueueEvent(
        "dead_letter",
        request,
        "scheduler.state-store.file.store-dead-letter-event.request",
      );

      await runSerialized(async () => {
        const state = await readState();
        state.deadLetterEvents.push(event);
        await writeState(state);
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<boolean>}
     */
    async removeRetryEvent(request) {
      const parsed = parseQueueRemovalRequest(
        request,
        "scheduler.state-store.file.remove-retry-event.request",
      );

      return runSerialized(async () => {
        const state = await readState();
        const index = state.retryEvents.findIndex(
          (event) =>
            event.eventId === parsed.eventId &&
            (parsed.sequence === undefined || event.sequence === parsed.sequence),
        );
        if (index < 0) {
          return false;
        }

        state.retryEvents.splice(index, 1);
        await writeState(state);
        return true;
      });
    },

    /**
     * @param {unknown} request
     * @returns {Promise<boolean>}
     */
    async removeDeadLetterEvent(request) {
      const parsed = parseQueueRemovalRequest(
        request,
        "scheduler.state-store.file.remove-dead-letter-event.request",
      );

      return runSerialized(async () => {
        const state = await readState();
        const index = state.deadLetterEvents.findIndex(
          (event) =>
            event.eventId === parsed.eventId &&
            (parsed.sequence === undefined || event.sequence === parsed.sequence),
        );
        if (index < 0) {
          return false;
        }

        state.deadLetterEvents.splice(index, 1);
        await writeState(state);
        return true;
      });
    },

    /**
     * @returns {Promise<readonly Record<string, unknown>[]>}
     */
    async listProcessedEvents() {
      return runSerialized(async () => {
        const state = await readState();
        return freezeSortedEvents(state.processedEvents);
      });
    },

    /**
     * @returns {Promise<readonly Record<string, unknown>[]>}
     */
    async listRetryEvents() {
      return runSerialized(async () => {
        const state = await readState();
        return freezeSortedEvents(state.retryEvents);
      });
    },

    /**
     * @returns {Promise<readonly Record<string, unknown>[]>}
     */
    async listDeadLetterEvents() {
      return runSerialized(async () => {
        const state = await readState();
        return freezeSortedEvents(state.deadLetterEvents);
      });
    },

    /**
     * @returns {Promise<void>}
     */
    async clear() {
      await runSerialized(async () => {
        await writeState(createEmptyState());
      });
    },

    /**
     * @returns {Promise<void>}
     */
    async removeFile() {
      await runSerialized(async () => {
        await rm(filePath, { force: true });
        initialized = false;
      });
    },
  });
}
