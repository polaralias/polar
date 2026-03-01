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
  schemaId: "run-event-linker.automation-record",
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
  schemaId: "run-event-linker.heartbeat-record",
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
  schemaId: "run-event-linker.replay.request",
  fields: {
    source: enumField(["automation", "heartbeat", "all"], { required: false }),
    fromSequence: numberField({ min: 0, required: false }),
  },
});

const listRequestSchema = createStrictObjectSchema({
  schemaId: "run-event-linker.list.request",
  fields: {
    fromSequence: numberField({ min: 0, required: false }),
    limit: numberField({ min: 1, max: 500, required: false }),
    id: stringField({ minLength: 1, required: false }),
    runId: stringField({ minLength: 1, required: false }),
    profileId: stringField({ minLength: 1, required: false }),
    trigger: stringField({ minLength: 1, required: false }),
  },
});

function validateRequest(value, schema) {
  const validation = schema.validate(value);
  if (!validation.ok) {
    throw new ContractValidationError(`Invalid ${schema.schemaId}`, {
      schemaId: schema.schemaId,
      errors: validation.errors ?? [],
    });
  }
  return /** @type {Record<string, unknown>} */ (validation.value);
}

function createTaskId(prefix, id, runId) {
  const normalizedId = id.replace(/[^a-zA-Z0-9._:-]/g, "-");
  const normalizedRunId = runId.replace(/[^a-zA-Z0-9._:-]/g, "-");
  return `${prefix}:${normalizedId}:run:${normalizedRunId}`;
}

function createReplayKey(source, id, runId) {
  const normalizedId = id.replace(/[^a-zA-Z0-9._:-]/g, "-");
  const normalizedRunId = runId.replace(/[^a-zA-Z0-9._:-]/g, "-");
  return `${source}:${normalizedId}:run:${normalizedRunId}`;
}

function deriveSessionId(metadata) {
  if (
    metadata &&
    typeof metadata === "object" &&
    Object.prototype.hasOwnProperty.call(metadata, "sessionId") &&
    typeof metadata.sessionId === "string" &&
    metadata.sessionId.length > 0
  ) {
    return metadata.sessionId;
  }
  return undefined;
}

function mapAutomationStatusToTaskStatus(output) {
  return output.status === "executed" ? "done" : "blocked";
}

function mapHeartbeatStatusToTaskStatus(output) {
  return output.status === "executed" ? "done" : "blocked";
}

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

function deriveHeartbeatTransitionReason(output) {
  if (typeof output.skipReason === "string") {
    return `Heartbeat skipped: ${output.skipReason}`;
  }
  return undefined;
}

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

function mapRowToLedgerRecord(row) {
  const output = JSON.parse(row.output);
  const metadata = row.metadata ? JSON.parse(row.metadata) : undefined;
  const record = {
    sequence: row.sequence,
    runId: row.runId,
    profileId: row.profileId,
    trigger: row.trigger,
    output,
    ...(metadata !== undefined ? { metadata } : {}),
    createdAtMs: row.createdAtMs,
  };
  if (row.source === "automation") {
    return Object.freeze({
      ...record,
      automationId: row.id,
    });
  }
  return Object.freeze({
    ...record,
    policyId: row.id,
  });
}

/**
 * @param {{
 *   db: import("better-sqlite3").Database,
 *   now?: () => number,
 *   taskBoardGateway?: {
 *     replayRunLinks?: (request: unknown) => Promise<Record<string, unknown>>|Record<string, unknown>
 *   }
 * }} config
 */
export function createSqliteRunEventLinker({
  db,
  now = () => Date.now(),
  taskBoardGateway,
}) {
  if (!db || typeof db.prepare !== "function") {
    throw new RuntimeExecutionError("A valid better-sqlite3 database instance is required");
  }
  if (typeof now !== "function") {
    throw new RuntimeExecutionError("now must be a function when provided");
  }
  if (taskBoardGateway !== undefined) {
    if (typeof taskBoardGateway !== "object" || taskBoardGateway === null) {
      throw new RuntimeExecutionError("taskBoardGateway must be an object when provided");
    }
    if (
      taskBoardGateway.replayRunLinks !== undefined &&
      typeof taskBoardGateway.replayRunLinks !== "function"
    ) {
      throw new RuntimeExecutionError(
        "taskBoardGateway.replayRunLinks must be a function when provided",
      );
    }
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
  `);

  const statements = {
    insert: db.prepare(`
      INSERT INTO polar_run_events (
        source,
        id,
        runId,
        profileId,
        trigger,
        output,
        metadata,
        createdAtMs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, id, runId) DO NOTHING
    `),
    getByKey: db.prepare(`
      SELECT sequence, source, id, runId, profileId, trigger, output, metadata, createdAtMs
      FROM polar_run_events
      WHERE source = ? AND id = ? AND runId = ?
      LIMIT 1
    `),
  };

  function listRows({ source, parsedRequest }) {
    const where = [];
    const params = [];
    if (source !== undefined) {
      where.push("source = ?");
      params.push(source);
    }
    if (parsedRequest.fromSequence !== undefined) {
      where.push("sequence >= ?");
      params.push(parsedRequest.fromSequence);
    }
    if (parsedRequest.id !== undefined) {
      where.push("id = ?");
      params.push(parsedRequest.id);
    }
    if (parsedRequest.runId !== undefined) {
      where.push("runId = ?");
      params.push(parsedRequest.runId);
    }
    if (parsedRequest.profileId !== undefined) {
      where.push("profileId = ?");
      params.push(parsedRequest.profileId);
    }
    if (parsedRequest.trigger !== undefined) {
      where.push("trigger = ?");
      params.push(parsedRequest.trigger);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = parsedRequest.limit ?? 200;
    const stmt = db.prepare(`
      SELECT sequence, source, id, runId, profileId, trigger, output, metadata, createdAtMs
      FROM polar_run_events
      ${whereClause}
      ORDER BY sequence ASC
      LIMIT ?
    `);
    return stmt.all(...params, limit);
  }

  async function replayRecords(records, sourceLabel) {
    if (!taskBoardGateway?.replayRunLinks) {
      throw new RuntimeExecutionError(
        "taskBoardGateway.replayRunLinks is required to replay run links",
      );
    }
    const replayResult = await taskBoardGateway.replayRunLinks({
      records,
    });
    const firstItem = /** @type {Record<string, unknown>|undefined} */ (
      Array.isArray(replayResult.items) ? replayResult.items[0] : undefined
    );
    assertReplayItemLinked(
      firstItem,
      `Task-board replay failed for ${sourceLabel} run`,
    );
    return firstItem;
  }

  return Object.freeze({
    async recordAutomationRun(request) {
      const parsed = validateRequest(request, automationRunRecordSchema);
      const createdAtMs = now();
      statements.insert.run(
        "automation",
        parsed.automationId,
        parsed.runId,
        parsed.profileId,
        parsed.trigger,
        JSON.stringify(parsed.output),
        parsed.metadata !== undefined ? JSON.stringify(parsed.metadata) : null,
        createdAtMs,
      );

      const row = statements.getByKey.get(
        "automation",
        parsed.automationId,
        parsed.runId,
      );
      if (!row) {
        throw new RuntimeExecutionError("Failed to persist automation run event");
      }

      if (taskBoardGateway?.replayRunLinks) {
        const replayRecord = toAutomationReplayRecord(
          mapRowToLedgerRecord(row),
        );
        const item = await replayRecords([replayRecord], "automation");
        return {
          status: "linked",
          taskId: item.taskId,
          targetStatus: mapAutomationStatusToTaskStatus(parsed.output),
          taskVersion: item.version ?? 0,
        };
      }

      return {
        status: "recorded",
        sequence: row.sequence,
      };
    },

    async recordHeartbeatRun(request) {
      const parsed = validateRequest(request, heartbeatRunRecordSchema);
      const createdAtMs = now();
      statements.insert.run(
        "heartbeat",
        parsed.policyId,
        parsed.runId,
        parsed.profileId,
        parsed.trigger,
        JSON.stringify(parsed.output),
        parsed.metadata !== undefined ? JSON.stringify(parsed.metadata) : null,
        createdAtMs,
      );

      const row = statements.getByKey.get(
        "heartbeat",
        parsed.policyId,
        parsed.runId,
      );
      if (!row) {
        throw new RuntimeExecutionError("Failed to persist heartbeat run event");
      }

      if (taskBoardGateway?.replayRunLinks) {
        const replayRecord = toHeartbeatReplayRecord(mapRowToLedgerRecord(row));
        const item = await replayRecords([replayRecord], "heartbeat");
        return {
          status: "linked",
          taskId: item.taskId,
          targetStatus: mapHeartbeatStatusToTaskStatus(parsed.output),
          taskVersion: item.version ?? 0,
        };
      }

      return {
        status: "recorded",
        sequence: row.sequence,
      };
    },

    async replayRecordedRuns(request = {}) {
      const parsed = validateRequest(request, replayRequestSchema);
      const source =
        /** @type {"automation"|"heartbeat"|"all"|undefined} */ (parsed.source) ??
        "all";
      const fromSequence =
        /** @type {number|undefined} */ (parsed.fromSequence) ?? 0;

      const automationRows =
        source === "heartbeat"
          ? []
          : listRows({
              source: "automation",
              parsedRequest: {
                fromSequence,
                limit: 500,
              },
            });
      const heartbeatRows =
        source === "automation"
          ? []
          : listRows({
              source: "heartbeat",
              parsedRequest: {
                fromSequence,
                limit: 500,
              },
            });

      const replayRecords = [
        ...automationRows.map((row) =>
          toAutomationReplayRecord(mapRowToLedgerRecord(row)),
        ),
        ...heartbeatRows.map((row) =>
          toHeartbeatReplayRecord(mapRowToLedgerRecord(row)),
        ),
      ];

      if (!taskBoardGateway?.replayRunLinks) {
        throw new RuntimeExecutionError(
          "taskBoardGateway.replayRunLinks is required to replay run links",
        );
      }
      const replayResult = await taskBoardGateway.replayRunLinks({
        records: replayRecords,
      });

      return {
        status: "ok",
        source,
        fromSequence,
        automationRecordCount: automationRows.length,
        heartbeatRecordCount: heartbeatRows.length,
        linkedCount: replayResult.linkedCount,
        skippedCount: replayResult.skippedCount,
        rejectedCount: replayResult.rejectedCount,
        totalCount: replayResult.totalCount,
      };
    },

    listAutomationRunLedger(request = {}) {
      const parsed = validateRequest(request, listRequestSchema);
      const rows = listRows({
        source: "automation",
        parsedRequest: parsed,
      });
      return Object.freeze(rows.map((row) => mapRowToLedgerRecord(row)));
    },

    listHeartbeatRunLedger(request = {}) {
      const parsed = validateRequest(request, listRequestSchema);
      const rows = listRows({
        source: "heartbeat",
        parsedRequest: parsed,
      });
      return Object.freeze(rows.map((row) => mapRowToLedgerRecord(row)));
    },
  });
}
