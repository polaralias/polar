import { randomUUID } from "node:crypto";

import {
  ContractValidationError,
  RuntimeExecutionError,
  isPlainObject,
} from "@polar/domain";

const FEEDBACK_POLARITIES = new Set(["positive", "negative", "neutral"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function assertNoUnknownKeys(request, allowedKeys, schemaId) {
  for (const key of Object.keys(request)) {
    if (!allowedKeys.has(key)) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId} has unknown field "${key}"`],
      });
    }
  }
}

function validateRecordRequest(request, now) {
  const schemaId = "feedback.event.record";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(
    request,
    new Set([
      "type",
      "sessionId",
      "messageId",
      "emoji",
      "polarity",
      "payload",
      "createdAtMs",
    ]),
    schemaId,
  );

  if (!isNonEmptyString(request.type)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.type must be a non-empty string`],
    });
  }
  if (!isNonEmptyString(request.sessionId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.sessionId must be a non-empty string`],
    });
  }
  if (request.messageId !== undefined && !isNonEmptyString(request.messageId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.messageId must be a non-empty string`],
    });
  }
  if (request.emoji !== undefined && !isNonEmptyString(request.emoji)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.emoji must be a non-empty string`],
    });
  }
  if (
    request.polarity !== undefined &&
    (typeof request.polarity !== "string" || !FEEDBACK_POLARITIES.has(request.polarity))
  ) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [
        `${schemaId}.polarity must be one of: positive, negative, neutral`,
      ],
    });
  }
  if (request.payload !== undefined && !isPlainObject(request.payload)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.payload must be a plain object`],
    });
  }
  if (request.createdAtMs !== undefined && !isFiniteInteger(request.createdAtMs)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.createdAtMs must be a finite integer`],
    });
  }

  return Object.freeze({
    type: request.type.trim(),
    sessionId: request.sessionId.trim(),
    ...(request.messageId !== undefined ? { messageId: request.messageId.trim() } : {}),
    ...(request.emoji !== undefined ? { emoji: request.emoji.trim() } : {}),
    polarity: request.polarity ?? "neutral",
    payload: request.payload ?? {},
    createdAtMs: request.createdAtMs ?? now(),
  });
}

function validateListRequest(request) {
  const schemaId = "feedback.event.list";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(
    request,
    new Set([
      "sessionId",
      "type",
      "messageId",
      "polarity",
      "limit",
      "beforeCreatedAtMs",
      "afterCreatedAtMs",
    ]),
    schemaId,
  );

  if (request.sessionId !== undefined && !isNonEmptyString(request.sessionId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.sessionId must be a non-empty string`],
    });
  }
  if (request.type !== undefined && !isNonEmptyString(request.type)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.type must be a non-empty string`],
    });
  }
  if (request.messageId !== undefined && !isNonEmptyString(request.messageId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.messageId must be a non-empty string`],
    });
  }
  if (
    request.polarity !== undefined &&
    (typeof request.polarity !== "string" || !FEEDBACK_POLARITIES.has(request.polarity))
  ) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [
        `${schemaId}.polarity must be one of: positive, negative, neutral`,
      ],
    });
  }
  if (request.limit !== undefined && !isFiniteInteger(request.limit)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.limit must be a finite integer`],
    });
  }
  if (
    request.limit !== undefined &&
    (request.limit < 1 || request.limit > 500)
  ) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.limit must be between 1 and 500`],
    });
  }
  if (
    request.beforeCreatedAtMs !== undefined &&
    !isFiniteInteger(request.beforeCreatedAtMs)
  ) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.beforeCreatedAtMs must be a finite integer`],
    });
  }
  if (
    request.afterCreatedAtMs !== undefined &&
    !isFiniteInteger(request.afterCreatedAtMs)
  ) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.afterCreatedAtMs must be a finite integer`],
    });
  }

  return Object.freeze({
    ...(request.sessionId !== undefined ? { sessionId: request.sessionId.trim() } : {}),
    ...(request.type !== undefined ? { type: request.type.trim() } : {}),
    ...(request.messageId !== undefined ? { messageId: request.messageId.trim() } : {}),
    ...(request.polarity !== undefined ? { polarity: request.polarity } : {}),
    ...(request.beforeCreatedAtMs !== undefined
      ? { beforeCreatedAtMs: request.beforeCreatedAtMs }
      : {}),
    ...(request.afterCreatedAtMs !== undefined
      ? { afterCreatedAtMs: request.afterCreatedAtMs }
      : {}),
    limit: request.limit ?? 50,
  });
}

/**
 * @param {{
 *   db: import("better-sqlite3").Database,
 *   now?: () => number
 * }} config
 */
export function createSqliteFeedbackEventStore({ db, now = () => Date.now() }) {
  if (!db || typeof db.prepare !== "function") {
    throw new RuntimeExecutionError("A valid better-sqlite3 database instance is required");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS polar_feedback_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      messageId TEXT,
      emoji TEXT,
      polarity TEXT NOT NULL,
      payload TEXT NOT NULL,
      createdAtMs INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_events_session_created
      ON polar_feedback_events(sessionId, createdAtMs);
    CREATE INDEX IF NOT EXISTS idx_feedback_events_type_created
      ON polar_feedback_events(type, createdAtMs);
  `);

  const statements = {
    insert: db.prepare(`
      INSERT INTO polar_feedback_events (
        id,
        type,
        sessionId,
        messageId,
        emoji,
        polarity,
        payload,
        createdAtMs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
  };

  return Object.freeze({
    /**
     * @param {unknown} request
     */
    async recordEvent(request) {
      const parsed = validateRecordRequest(request, now);
      const id = randomUUID();

      statements.insert.run(
        id,
        parsed.type,
        parsed.sessionId,
        parsed.messageId ?? null,
        parsed.emoji ?? null,
        parsed.polarity,
        JSON.stringify(parsed.payload),
        parsed.createdAtMs,
      );

      return Object.freeze({
        status: "recorded",
        id,
        type: parsed.type,
        sessionId: parsed.sessionId,
        ...(parsed.messageId !== undefined ? { messageId: parsed.messageId } : {}),
        ...(parsed.emoji !== undefined ? { emoji: parsed.emoji } : {}),
        polarity: parsed.polarity,
        createdAtMs: parsed.createdAtMs,
      });
    },

    /**
     * @param {unknown} request
     */
    async listEvents(request = {}) {
      const parsed = validateListRequest(request);
      const whereParts = [];
      const params = [];

      if (parsed.sessionId !== undefined) {
        whereParts.push("sessionId = ?");
        params.push(parsed.sessionId);
      }
      if (parsed.type !== undefined) {
        whereParts.push("type = ?");
        params.push(parsed.type);
      }
      if (parsed.messageId !== undefined) {
        whereParts.push("messageId = ?");
        params.push(parsed.messageId);
      }
      if (parsed.polarity !== undefined) {
        whereParts.push("polarity = ?");
        params.push(parsed.polarity);
      }
      if (parsed.beforeCreatedAtMs !== undefined) {
        whereParts.push("createdAtMs <= ?");
        params.push(parsed.beforeCreatedAtMs);
      }
      if (parsed.afterCreatedAtMs !== undefined) {
        whereParts.push("createdAtMs >= ?");
        params.push(parsed.afterCreatedAtMs);
      }

      const whereClause =
        whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

      const listStatement = db.prepare(`
        SELECT id, type, sessionId, messageId, emoji, polarity, payload, createdAtMs
        FROM polar_feedback_events
        ${whereClause}
        ORDER BY createdAtMs DESC, id DESC
        LIMIT ?
      `);
      const countStatement = db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM polar_feedback_events
        ${whereClause}
      `);

      const rows = listStatement.all(...params, parsed.limit);
      const countRow = countStatement.get(...params);
      const totalCount =
        typeof countRow?.cnt === "number" ? countRow.cnt : Number(countRow?.cnt ?? 0);

      return Object.freeze({
        status: "ok",
        items: Object.freeze(
          rows.map((row) =>
            Object.freeze({
              id: row.id,
              type: row.type,
              sessionId: row.sessionId,
              ...(row.messageId ? { messageId: row.messageId } : {}),
              ...(row.emoji ? { emoji: row.emoji } : {}),
              polarity: row.polarity,
              payload: JSON.parse(row.payload),
              createdAtMs: row.createdAtMs,
            }),
          ),
        ),
        totalCount,
      });
    },
  });
}
