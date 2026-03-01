import { randomUUID } from "node:crypto";

import {
  ContractValidationError,
  RuntimeExecutionError,
  isPlainObject,
} from "@polar/domain";

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

function validateCreateRequest(request, now) {
  const schemaId = "automation.job.create";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(
    request,
    new Set([
      "id",
      "ownerUserId",
      "sessionId",
      "schedule",
      "promptTemplate",
      "enabled",
      "quietHours",
      "limits",
    ]),
    schemaId,
  );

  if (request.id !== undefined && !isNonEmptyString(request.id)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.id must be a non-empty string when provided`],
    });
  }
  if (!isNonEmptyString(request.ownerUserId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.ownerUserId must be a non-empty string`],
    });
  }
  if (!isNonEmptyString(request.sessionId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.sessionId must be a non-empty string`],
    });
  }
  if (!isNonEmptyString(request.schedule)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.schedule must be a non-empty string`],
    });
  }
  if (!isNonEmptyString(request.promptTemplate)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.promptTemplate must be a non-empty string`],
    });
  }
  if (request.enabled !== undefined && typeof request.enabled !== "boolean") {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.enabled must be a boolean when provided`],
    });
  }
  if (request.quietHours !== undefined && !isPlainObject(request.quietHours)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.quietHours must be a plain object when provided`],
    });
  }
  if (request.limits !== undefined && !isPlainObject(request.limits)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.limits must be a plain object when provided`],
    });
  }

  const nowMs = now();
  return Object.freeze({
    id: request.id?.trim() ?? randomUUID(),
    ownerUserId: request.ownerUserId.trim(),
    sessionId: request.sessionId.trim(),
    schedule: request.schedule.trim(),
    promptTemplate: request.promptTemplate.trim(),
    enabled: request.enabled ?? true,
    quietHours: request.quietHours ?? {
      startHour: 22,
      endHour: 7,
      timezone: "UTC",
    },
    limits: request.limits ?? {
      maxNotificationsPerDay: 3,
    },
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  });
}

function validateListRequest(request) {
  const schemaId = "automation.job.list";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(
    request,
    new Set(["ownerUserId", "sessionId", "enabled", "limit"]),
    schemaId,
  );

  if (request.ownerUserId !== undefined && !isNonEmptyString(request.ownerUserId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.ownerUserId must be a non-empty string when provided`],
    });
  }
  if (request.sessionId !== undefined && !isNonEmptyString(request.sessionId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.sessionId must be a non-empty string when provided`],
    });
  }
  if (request.enabled !== undefined && typeof request.enabled !== "boolean") {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.enabled must be a boolean when provided`],
    });
  }
  if (request.limit !== undefined && !isFiniteInteger(request.limit)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.limit must be a finite integer when provided`],
    });
  }
  if (request.limit !== undefined && (request.limit < 1 || request.limit > 500)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.limit must be between 1 and 500 when provided`],
    });
  }

  return Object.freeze({
    ownerUserId: request.ownerUserId?.trim(),
    sessionId: request.sessionId?.trim(),
    enabled: request.enabled,
    limit: request.limit ?? 100,
  });
}

function validateUpdateRequest(request, now) {
  const schemaId = "automation.job.update";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(
    request,
    new Set(["id", "schedule", "promptTemplate", "enabled", "quietHours", "limits"]),
    schemaId,
  );

  if (!isNonEmptyString(request.id)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.id must be a non-empty string`],
    });
  }

  const hasUpdateField =
    request.schedule !== undefined ||
    request.promptTemplate !== undefined ||
    request.enabled !== undefined ||
    request.quietHours !== undefined ||
    request.limits !== undefined;

  if (!hasUpdateField) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} requires at least one mutable field`],
    });
  }

  if (request.schedule !== undefined && !isNonEmptyString(request.schedule)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.schedule must be a non-empty string when provided`],
    });
  }
  if (request.promptTemplate !== undefined && !isNonEmptyString(request.promptTemplate)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.promptTemplate must be a non-empty string when provided`],
    });
  }
  if (request.enabled !== undefined && typeof request.enabled !== "boolean") {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.enabled must be a boolean when provided`],
    });
  }
  if (request.quietHours !== undefined && !isPlainObject(request.quietHours)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.quietHours must be a plain object when provided`],
    });
  }
  if (request.limits !== undefined && !isPlainObject(request.limits)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.limits must be a plain object when provided`],
    });
  }

  return Object.freeze({
    id: request.id.trim(),
    ...(request.schedule !== undefined ? { schedule: request.schedule.trim() } : {}),
    ...(request.promptTemplate !== undefined
      ? { promptTemplate: request.promptTemplate.trim() }
      : {}),
    ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
    ...(request.quietHours !== undefined ? { quietHours: request.quietHours } : {}),
    ...(request.limits !== undefined ? { limits: request.limits } : {}),
    updatedAtMs: now(),
  });
}

function validateDisableRequest(request, now) {
  const schemaId = "automation.job.disable";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(request, new Set(["id"]), schemaId);
  if (!isNonEmptyString(request.id)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.id must be a non-empty string`],
    });
  }

  return Object.freeze({
    id: request.id.trim(),
    updatedAtMs: now(),
  });
}

function validateGetRequest(request) {
  const schemaId = "automation.job.get";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(request, new Set(["id"]), schemaId);
  if (!isNonEmptyString(request.id)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.id must be a non-empty string`],
    });
  }

  return Object.freeze({
    id: request.id.trim(),
  });
}

function validateDeleteRequest(request) {
  const schemaId = "automation.job.delete";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(request, new Set(["id"]), schemaId);
  if (!isNonEmptyString(request.id)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.id must be a non-empty string`],
    });
  }

  return Object.freeze({
    id: request.id.trim(),
  });
}

function parseRow(row) {
  return Object.freeze({
    id: row.id,
    ownerUserId: row.ownerUserId,
    sessionId: row.sessionId,
    schedule: row.schedule,
    promptTemplate: row.promptTemplate,
    enabled: row.enabled === 1,
    quietHours: row.quietHoursJson ? JSON.parse(row.quietHoursJson) : undefined,
    limits: row.limitsJson ? JSON.parse(row.limitsJson) : undefined,
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
  });
}

function isMissingRunEventsTableError(error) {
  return (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message.includes("no such table: polar_run_events")
  );
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function toSafeInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return fallback;
  }
  return value;
}

/**
 * @param {string} schedule
 * @returns {{ kind: "interval", intervalMs: number } | { kind: "daily", hour: number, minute: number } | null}
 */
export function parseAutomationSchedule(schedule) {
  if (!isNonEmptyString(schedule)) {
    return null;
  }

  const normalized = schedule.trim().toLowerCase();

  let match = normalized.match(/^every\s+(\d+)\s*(minute|minutes|min|m)$/);
  if (match) {
    const interval = Number.parseInt(match[1], 10);
    if (interval >= 1) {
      return { kind: "interval", intervalMs: interval * 60_000 };
    }
  }

  match = normalized.match(/^every\s+(\d+)\s*(hour|hours|h)$/);
  if (match) {
    const interval = Number.parseInt(match[1], 10);
    if (interval >= 1) {
      return { kind: "interval", intervalMs: interval * 3_600_000 };
    }
  }

  match = normalized.match(/^every\s+(\d+)\s*(day|days|d)$/);
  if (match) {
    const interval = Number.parseInt(match[1], 10);
    if (interval >= 1) {
      return { kind: "interval", intervalMs: interval * 86_400_000 };
    }
  }

  match = normalized.match(/^daily\s+at\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { kind: "daily", hour, minute };
    }
  }

  return null;
}

/**
 * @param {{ kind: "interval", intervalMs: number } | { kind: "daily", hour: number, minute: number }} parsed
 * @param {number} baselineMs
 */
function computeNextDueAtMs(parsed, baselineMs) {
  if (parsed.kind === "interval") {
    return baselineMs + parsed.intervalMs;
  }

  const baseline = new Date(baselineMs);
  const candidate = new Date(Date.UTC(
    baseline.getUTCFullYear(),
    baseline.getUTCMonth(),
    baseline.getUTCDate(),
    parsed.hour,
    parsed.minute,
    0,
    0,
  ));

  if (candidate.getTime() <= baselineMs) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate.getTime();
}

/**
 * @param {{ startHour?: unknown, endHour?: unknown }} quietHours
 * @param {number} asOfMs
 */
export function isWithinQuietHours(quietHours, asOfMs) {
  const startHour = toSafeInteger(quietHours?.startHour, 22);
  const endHour = toSafeInteger(quietHours?.endHour, 7);
  if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
    return false;
  }

  const hour = new Date(asOfMs).getUTCHours();
  if (startHour === endHour) {
    return false;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

/**
 * @param {number} asOfMs
 */
function dayWindowUtc(asOfMs) {
  const date = new Date(asOfMs);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0);
  return Object.freeze({
    startAtMs: start,
    endAtMs: start + 86_400_000,
  });
}

/**
 * @param {{
 *   db: import("better-sqlite3").Database,
 *   now?: () => number
 * }} config
 */
export function createSqliteAutomationJobStore({ db, now = () => Date.now() }) {
  if (!db || typeof db.prepare !== "function") {
    throw new RuntimeExecutionError("A valid better-sqlite3 database instance is required");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS polar_run_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      id TEXT NOT NULL,
      runId TEXT NOT NULL,
      profileId TEXT NOT NULL,
      trigger TEXT NOT NULL,
      output TEXT NOT NULL,
      metadata TEXT,
      createdAtMs INTEGER NOT NULL,
      UNIQUE (source, id, runId)
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_source_sequence
      ON polar_run_events(source, sequence);
    CREATE INDEX IF NOT EXISTS idx_run_events_created
      ON polar_run_events(createdAtMs);
    CREATE TABLE IF NOT EXISTS polar_automation_jobs (
      id TEXT PRIMARY KEY,
      ownerUserId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      schedule TEXT NOT NULL,
      promptTemplate TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      quietHoursJson TEXT,
      limitsJson TEXT,
      createdAtMs INTEGER NOT NULL,
      updatedAtMs INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automation_jobs_session_enabled
      ON polar_automation_jobs(sessionId, enabled);
    CREATE INDEX IF NOT EXISTS idx_automation_jobs_enabled
      ON polar_automation_jobs(enabled);
  `);

  const statements = {
    insert: db.prepare(`
      INSERT INTO polar_automation_jobs (
        id,
        ownerUserId,
        sessionId,
        schedule,
        promptTemplate,
        enabled,
        quietHoursJson,
        limitsJson,
        createdAtMs,
        updatedAtMs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getById: db.prepare(`
      SELECT id, ownerUserId, sessionId, schedule, promptTemplate, enabled,
             quietHoursJson, limitsJson, createdAtMs, updatedAtMs
      FROM polar_automation_jobs
      WHERE id = ?
      LIMIT 1
    `),
    update: db.prepare(`
      UPDATE polar_automation_jobs
      SET
        schedule = COALESCE(?, schedule),
        promptTemplate = COALESCE(?, promptTemplate),
        enabled = COALESCE(?, enabled),
        quietHoursJson = COALESCE(?, quietHoursJson),
        limitsJson = COALESCE(?, limitsJson),
        updatedAtMs = ?
      WHERE id = ?
    `),
    disable: db.prepare(`
      UPDATE polar_automation_jobs
      SET enabled = 0, updatedAtMs = ?
      WHERE id = ?
    `),
    deleteById: db.prepare(`
      DELETE FROM polar_automation_jobs
      WHERE id = ?
    `),
    listCount: db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM polar_automation_jobs
      WHERE (? IS NULL OR ownerUserId = ?)
        AND (? IS NULL OR sessionId = ?)
        AND (? IS NULL OR enabled = ?)
    `),
    listItems: db.prepare(`
      SELECT id, ownerUserId, sessionId, schedule, promptTemplate, enabled,
             quietHoursJson, limitsJson, createdAtMs, updatedAtMs
      FROM polar_automation_jobs
      WHERE (? IS NULL OR ownerUserId = ?)
        AND (? IS NULL OR sessionId = ?)
        AND (? IS NULL OR enabled = ?)
      ORDER BY updatedAtMs DESC, id DESC
      LIMIT ?
    `),
    listEnabled: db.prepare(`
      SELECT id, ownerUserId, sessionId, schedule, promptTemplate, enabled,
             quietHoursJson, limitsJson, createdAtMs, updatedAtMs
      FROM polar_automation_jobs
      WHERE enabled = 1
      ORDER BY updatedAtMs ASC, id ASC
      LIMIT ?
    `),
    countRunsInWindow: db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM polar_run_events
      WHERE source = 'automation'
        AND id = ?
        AND createdAtMs >= ?
        AND createdAtMs < ?
    `),
    getLastRunAt: db.prepare(`
      SELECT MAX(createdAtMs) AS lastRunAtMs
      FROM polar_run_events
      WHERE source = 'automation' AND id = ?
    `),
  };

  return Object.freeze({
    async createJob(request) {
      const parsed = validateCreateRequest(request, now);

      statements.insert.run(
        parsed.id,
        parsed.ownerUserId,
        parsed.sessionId,
        parsed.schedule,
        parsed.promptTemplate,
        parsed.enabled ? 1 : 0,
        JSON.stringify(parsed.quietHours),
        JSON.stringify(parsed.limits),
        parsed.createdAtMs,
        parsed.updatedAtMs,
      );

      const row = statements.getById.get(parsed.id);
      return Object.freeze({
        status: "created",
        job: parseRow(row),
      });
    },

    async listJobs(request = {}) {
      const parsed = validateListRequest(request);
      const enabledValue =
        parsed.enabled === undefined ? null : parsed.enabled ? 1 : 0;

      const countRow = statements.listCount.get(
        parsed.ownerUserId ?? null,
        parsed.ownerUserId ?? null,
        parsed.sessionId ?? null,
        parsed.sessionId ?? null,
        enabledValue,
        enabledValue,
      );
      const totalCount =
        typeof countRow?.cnt === "number" ? countRow.cnt : Number(countRow?.cnt ?? 0);

      const rows = statements.listItems.all(
        parsed.ownerUserId ?? null,
        parsed.ownerUserId ?? null,
        parsed.sessionId ?? null,
        parsed.sessionId ?? null,
        enabledValue,
        enabledValue,
        parsed.limit,
      );

      return Object.freeze({
        status: "ok",
        items: Object.freeze(rows.map((row) => parseRow(row))),
        totalCount,
      });
    },

    async getJob(request) {
      const parsed = validateGetRequest(request);
      const row = statements.getById.get(parsed.id);
      if (!row) {
        return Object.freeze({
          status: "not_found",
          id: parsed.id,
        });
      }
      return Object.freeze({
        status: "found",
        job: parseRow(row),
      });
    },

    async updateJob(request) {
      const parsed = validateUpdateRequest(request, now);
      const info = statements.update.run(
        parsed.schedule ?? null,
        parsed.promptTemplate ?? null,
        parsed.enabled !== undefined ? (parsed.enabled ? 1 : 0) : null,
        parsed.quietHours !== undefined ? JSON.stringify(parsed.quietHours) : null,
        parsed.limits !== undefined ? JSON.stringify(parsed.limits) : null,
        parsed.updatedAtMs,
        parsed.id,
      );

      if (info.changes < 1) {
        return Object.freeze({
          status: "not_found",
          id: parsed.id,
        });
      }

      const row = statements.getById.get(parsed.id);
      return Object.freeze({
        status: "updated",
        job: parseRow(row),
      });
    },

    async disableJob(request) {
      const parsed = validateDisableRequest(request, now);
      const info = statements.disable.run(parsed.updatedAtMs, parsed.id);
      if (info.changes < 1) {
        return Object.freeze({
          status: "not_found",
          id: parsed.id,
        });
      }

      const row = statements.getById.get(parsed.id);
      return Object.freeze({
        status: "disabled",
        job: parseRow(row),
      });
    },

    async deleteJob(request) {
      const parsed = validateDeleteRequest(request);
      const row = statements.getById.get(parsed.id);
      if (!row) {
        return Object.freeze({
          status: "not_found",
          id: parsed.id,
        });
      }
      statements.deleteById.run(parsed.id);
      return Object.freeze({
        status: "deleted",
        job: parseRow(row),
      });
    },

    async listDueJobs(request = {}) {
      const asOfMs =
        isPlainObject(request) && isFiniteInteger(request.asOfMs) ? request.asOfMs : now();
      const limit =
        isPlainObject(request) && isFiniteInteger(request.limit) && request.limit > 0
          ? Math.min(request.limit, 500)
          : 50;

      const rows = statements.listEnabled.all(limit);
      const dueJobs = [];
      for (const row of rows) {
        const job = parseRow(row);
        const parsedSchedule = parseAutomationSchedule(job.schedule);
        if (!parsedSchedule) {
          continue;
        }

        if (isWithinQuietHours(job.quietHours ?? {}, asOfMs)) {
          continue;
        }

        const window = dayWindowUtc(asOfMs);
        const limits = isPlainObject(job.limits) ? job.limits : {};
        const maxNotificationsPerDay = toSafeInteger(limits.maxNotificationsPerDay, 3);
        if (maxNotificationsPerDay > 0) {
          let runCount = 0;
          try {
            const runCountRow = statements.countRunsInWindow.get(
              job.id,
              window.startAtMs,
              window.endAtMs,
            );
            runCount =
              typeof runCountRow?.cnt === "number"
                ? runCountRow.cnt
                : Number(runCountRow?.cnt ?? 0);
          } catch (error) {
            if (!isMissingRunEventsTableError(error)) {
              throw error;
            }
          }
          if (runCount >= maxNotificationsPerDay) {
            continue;
          }
        }

        let lastRunRow;
        try {
          lastRunRow = statements.getLastRunAt.get(job.id);
        } catch (error) {
          if (!isMissingRunEventsTableError(error)) {
            throw error;
          }
          lastRunRow = undefined;
        }
        const baselineMs =
          typeof lastRunRow?.lastRunAtMs === "number" && Number.isFinite(lastRunRow.lastRunAtMs)
            ? lastRunRow.lastRunAtMs
            : job.createdAtMs;
        const nextDueAtMs = computeNextDueAtMs(parsedSchedule, baselineMs);

        if (asOfMs < nextDueAtMs) {
          continue;
        }

        dueJobs.push(
          Object.freeze({
            ...job,
            nextDueAtMs,
            lastRunAtMs:
              typeof lastRunRow?.lastRunAtMs === "number" && Number.isFinite(lastRunRow.lastRunAtMs)
                ? lastRunRow.lastRunAtMs
                : undefined,
          }),
        );
      }

      dueJobs.sort((a, b) => {
        if (a.nextDueAtMs !== b.nextDueAtMs) {
          return a.nextDueAtMs - b.nextDueAtMs;
        }
        return a.id.localeCompare(b.id);
      });

      return Object.freeze({
        status: "ok",
        asOfMs,
        items: Object.freeze(dueJobs.slice(0, limit)),
        totalCount: dueJobs.length,
      });
    },
  });
}
