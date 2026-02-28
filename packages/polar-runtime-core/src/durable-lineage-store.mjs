import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  ContractValidationError,
  RuntimeExecutionError,
} from "../../polar-domain/src/index.mjs";

const lineageQuerySchemaId = "runtime.lineage.query.request";

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
function isPositiveInteger(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 1;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function normalizeLineageEvent(value) {
  if (!isPlainObject(value)) {
    throw new ContractValidationError("Lineage event must be an object", {
      schemaId: "runtime.lineage.event",
      errors: ["runtime.lineage.event must be a plain object"],
    });
  }

  if (!isNonEmptyString(value.eventType)) {
    throw new ContractValidationError("Lineage eventType must be a non-empty string", {
      schemaId: "runtime.lineage.event",
      errors: ["runtime.lineage.event.eventType must be a non-empty string"],
    });
  }

  return { ...value };
}

/**
 * @param {unknown} request
 * @returns {{
 *   fromSequence: number,
 *   limit: number,
 *   eventType?: string,
 *   workflowId?: string,
 *   runId?: string,
 *   threadId?: string,
 *   traceId?: string,
 *   actionId?: string,
 *   executionType?: string,
 *   extensionId?: string,
 *   capabilityId?: string,
 *   decision?: string,
 *   reasonCode?: string
 * }}
 */
function validateQueryRequest(request) {
  if (!isPlainObject(request)) {
    throw new ContractValidationError("Invalid lineage query request", {
      schemaId: lineageQuerySchemaId,
      errors: [`${lineageQuerySchemaId} must be an object`],
    });
  }

  const fromSequenceRaw = request.fromSequence ?? 1;
  const limitRaw = request.limit ?? 100;

  if (!isPositiveInteger(fromSequenceRaw)) {
    throw new ContractValidationError("Invalid lineage query request", {
      schemaId: lineageQuerySchemaId,
      errors: [`${lineageQuerySchemaId}.fromSequence must be an integer >= 1`],
    });
  }

  if (!isPositiveInteger(limitRaw) || limitRaw > 5000) {
    throw new ContractValidationError("Invalid lineage query request", {
      schemaId: lineageQuerySchemaId,
      errors: [`${lineageQuerySchemaId}.limit must be an integer between 1 and 5000`],
    });
  }

  const normalized = {
    fromSequence: fromSequenceRaw,
    limit: limitRaw,
  };

  for (const key of [
    "eventType",
    "workflowId",
    "runId",
    "threadId",
    "traceId",
    "actionId",
    "executionType",
    "extensionId",
    "capabilityId",
    "decision",
    "reasonCode",
  ]) {
    if (request[key] === undefined) {
      continue;
    }

    if (!isNonEmptyString(request[key])) {
      throw new ContractValidationError("Invalid lineage query request", {
        schemaId: lineageQuerySchemaId,
        errors: [`${lineageQuerySchemaId}.${key} must be a non-empty string when provided`],
      });
    }

    normalized[key] = request[key];
  }

  return normalized;
}

/**
 * @returns {boolean}
 */
export function isRuntimeDevMode() {
  const runtimeMode = String(process.env.POLAR_RUNTIME_MODE ?? "").toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "").toLowerCase();
  const devFlag = String(process.env.POLAR_DEV_MODE ?? "").toLowerCase();
  const isNodeTestRun =
    Array.isArray(process.argv) &&
    process.argv.includes("--test");

  return (
    runtimeMode === "dev" ||
    runtimeMode === "development" ||
    nodeEnv === "development" ||
    nodeEnv === "test" ||
    isNodeTestRun ||
    devFlag === "1" ||
    devFlag === "true"
  );
}

/**
 * @returns {string}
 */
export function resolveDefaultLineageStorePath() {
  const configuredPath = process.env.POLAR_LINEAGE_STORE_PATH;
  if (isNonEmptyString(configuredPath)) {
    return resolve(configuredPath);
  }

  return resolve(process.cwd(), ".polar-data", "lineage", "events.ndjson");
}

/**
 * @param {{
 *   filePath?: string,
 *   now?: () => number
 * }} [config]
 */
export function createDurableLineageStore(config = {}) {
  const filePath = config.filePath ?? resolveDefaultLineageStorePath();
  if (!isNonEmptyString(filePath)) {
    throw new RuntimeExecutionError("filePath must be a non-empty string");
  }

  const now = config.now ?? Date.now;
  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }

  let initialized = false;
  let nextSequence = 1;
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
   * @returns {Promise<readonly Record<string, unknown>[]>}
   */
  const readStoredRecords = async () => {
    let raw = "";
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        /** @type {{ code?: unknown }} */ (error).code === "ENOENT"
      ) {
        return Object.freeze([]);
      }

      throw new RuntimeExecutionError("Failed to read lineage store file", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const lines = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const parsedRecords = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new RuntimeExecutionError("Failed to parse lineage store record", {
          filePath,
          lineNumber: index + 1,
          cause: error instanceof Error ? error.message : String(error),
        });
      }

      if (!isPlainObject(parsed)) {
        throw new RuntimeExecutionError("Lineage store record must be an object", {
          filePath,
          lineNumber: index + 1,
        });
      }

      if (!isPositiveInteger(parsed.sequence)) {
        throw new RuntimeExecutionError("Lineage store record has invalid sequence", {
          filePath,
          lineNumber: index + 1,
        });
      }

      if (!isNonEmptyString(parsed.eventType)) {
        throw new RuntimeExecutionError("Lineage store record has invalid eventType", {
          filePath,
          lineNumber: index + 1,
        });
      }

      parsedRecords.push(Object.freeze({ ...parsed }));
    }

    return Object.freeze(parsedRecords);
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

      await writeFile(filePath, "", "utf8");
    }

    const records = await readStoredRecords();
    const maxSequence = records.reduce((max, record) => {
      const sequence = /** @type {number} */ (record.sequence);
      return Math.max(max, sequence);
    }, 0);
    nextSequence = maxSequence + 1;
    initialized = true;
  };

  /**
   * @param {readonly Record<string, unknown>[]} records
   * @param {ReturnType<typeof validateQueryRequest>} request
   * @returns {readonly Record<string, unknown>[]}
   */
  const filterRecords = (records, request) => {
    return records.filter((record) => {
      if (/** @type {number} */ (record.sequence) < request.fromSequence) {
        return false;
      }

      for (const key of [
        "eventType",
        "workflowId",
        "runId",
        "threadId",
        "traceId",
        "actionId",
        "executionType",
        "extensionId",
        "capabilityId",
        "decision",
        "reasonCode",
      ]) {
        if (request[key] === undefined) {
          continue;
        }

        if (record[key] !== request[key]) {
          return false;
        }
      }

      return true;
    });
  };

  return Object.freeze({
    /**
     * @param {unknown} event
     * @returns {Promise<Record<string, unknown>>}
     */
    async append(event) {
      const normalized = normalizeLineageEvent(event);
      const timestampMs =
        typeof normalized.timestampMs === "number" &&
          Number.isFinite(normalized.timestampMs)
          ? normalized.timestampMs
          : now();
      const timestamp =
        isNonEmptyString(normalized.timestamp)
          ? normalized.timestamp
          : new Date(timestampMs).toISOString();

      return runSerialized(async () => {
        await ensureInitialized();
        const {
          sequence: _ignoredSequence,
          timestamp: _ignoredTimestamp,
          timestampMs: _ignoredTimestampMs,
          ...payload
        } = normalized;

        const record = Object.freeze({
          sequence: nextSequence,
          timestamp,
          timestampMs,
          ...payload,
        });
        nextSequence += 1;

        await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
        return record;
      });
    },

    /**
     * @param {unknown} [request]
     * @returns {Promise<Record<string, unknown>>}
     */
    async query(request = {}) {
      const parsedRequest = validateQueryRequest(request);
      return runSerialized(async () => {
        await ensureInitialized();
        const records = await readStoredRecords();
        const filtered = filterRecords(records, parsedRequest);
        const items = filtered.slice(0, parsedRequest.limit);
        const nextFromSequence =
          filtered.length > parsedRequest.limit
            ? /** @type {number} */ (items[items.length - 1].sequence) + 1
            : undefined;

        const result = {
          status: "ok",
          fromSequence: parsedRequest.fromSequence,
          returnedCount: items.length,
          totalCount: filtered.length,
          items: Object.freeze(items),
        };

        if (nextFromSequence !== undefined) {
          result.nextFromSequence = nextFromSequence;
        }

        return Object.freeze(result);
      });
    },

    /**
     * @returns {Promise<readonly Record<string, unknown>[]>}
     */
    async listState() {
      return runSerialized(async () => {
        await ensureInitialized();
        return readStoredRecords();
      });
    },

    /**
     * @returns {Promise<void>}
     */
    async clear() {
      await runSerialized(async () => {
        await ensureInitialized();
        await writeFile(filePath, "", "utf8");
        nextSequence = 1;
      });
    },

    /**
     * @returns {Promise<void>}
     */
    async removeFile() {
      await runSerialized(async () => {
        await rm(filePath, { force: true });
        initialized = false;
        nextSequence = 1;
      });
    },

    /**
     * @returns {string}
     */
    getFilePath() {
      return filePath;
    },
  });
}
