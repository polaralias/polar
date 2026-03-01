import {
    ContractValidationError,
    RuntimeExecutionError,
} from "@polar/domain";

/**
 * Production-grade SQLite Durable Scheduler Queue Backend
 * Implements the identical Scheduler State Store interface.
 * 
 * Uses standard connection bindings. Best utilized via \`better-sqlite3\`.
 * 
 * @param {{
 *   db: import("better-sqlite3").Database,
 *   now?: () => number
 * }} config
 */
export function createSqliteSchedulerStateStore({ db, now = () => Date.now() }) {
    if (!db || typeof db.prepare !== "function") {
        throw new RuntimeExecutionError("A valid better-sqlite3 database instance is required");
    }

    // Initialize unified table
    db.exec(`
    CREATE TABLE IF NOT EXISTS polar_scheduler_events (
      eventId TEXT NOT NULL,
      queue TEXT NOT NULL,
      sequence INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      createdAtMs INTEGER NOT NULL,
      PRIMARY KEY (eventId, queue)
    )
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS polar_scheduler_run_log (
      runId TEXT PRIMARY KEY,
      eventId TEXT NOT NULL,
      traceId TEXT,
      status TEXT,
      startedAtMs INTEGER NOT NULL,
      completedAtMs INTEGER,
      metadata TEXT
    )
  `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduler_run_trace ON polar_scheduler_run_log(traceId)`);

    const statements = {
        hasProcessed: db.prepare(`SELECT 1 FROM polar_scheduler_events WHERE eventId = ? AND queue = 'processed' LIMIT 1`),
        insertProcessed: db.prepare(`INSERT OR IGNORE INTO polar_scheduler_events (eventId, queue, sequence, payload, createdAtMs) VALUES (?, 'processed', ?, ?, ?)`),
        insertRetry: db.prepare(`INSERT OR REPLACE INTO polar_scheduler_events (eventId, queue, sequence, payload, createdAtMs) VALUES (?, 'retry', ?, ?, ?)`),
        insertDeadLetter: db.prepare(`INSERT OR REPLACE INTO polar_scheduler_events (eventId, queue, sequence, payload, createdAtMs) VALUES (?, 'dead_letter', ?, ?, ?)`),
        deleteRetryId: db.prepare(`DELETE FROM polar_scheduler_events WHERE eventId = ? AND queue = 'retry'`),
        deleteRetryIdWithSeq: db.prepare(`DELETE FROM polar_scheduler_events WHERE eventId = ? AND queue = 'retry' AND sequence = ?`),
        deleteDeadLetterId: db.prepare(`DELETE FROM polar_scheduler_events WHERE eventId = ? AND queue = 'dead_letter'`),
        deleteDeadLetterIdWithSeq: db.prepare(`DELETE FROM polar_scheduler_events WHERE eventId = ? AND queue = 'dead_letter' AND sequence = ?`),
        listByQueue: db.prepare(`SELECT payload FROM polar_scheduler_events WHERE queue = ? ORDER BY sequence ASC, createdAtMs ASC`),
        clear: db.prepare(`DELETE FROM polar_scheduler_events`),
        drop: db.prepare(`DROP TABLE IF EXISTS polar_scheduler_events`),
        insertRun: db.prepare(`INSERT INTO polar_scheduler_run_log (runId, eventId, traceId, status, startedAtMs, metadata) VALUES (?, ?, ?, ?, ?, ?)`),
        updateRun: db.prepare(`UPDATE polar_scheduler_run_log SET status = ?, completedAtMs = ?, metadata = ? WHERE runId = ?`)
    };

    return Object.freeze({
        async hasProcessedEvent(request) {
            if (!request || typeof request.eventId !== "string") {
                throw new ContractValidationError("Invalid request", { schemaId: "sqlite", errors: [] });
            }
            const row = statements.hasProcessed.get(request.eventId);
            return row !== undefined;
        },

        async storeProcessedEvent(request) {
            statements.insertProcessed.run(
                request.eventId,
                request.sequence ?? 0,
                JSON.stringify(request),
                now()
            );
        },

        async storeRetryEvent(request) {
            statements.insertRetry.run(
                request.eventId,
                request.sequence ?? 0,
                JSON.stringify(request),
                now()
            );
        },

        async storeDeadLetterEvent(request) {
            statements.insertDeadLetter.run(
                request.eventId,
                request.sequence ?? 0,
                JSON.stringify(request),
                now()
            );
        },

        async removeRetryEvent(request) {
            const stmt = request.sequence !== undefined ? statements.deleteRetryIdWithSeq : statements.deleteRetryId;
            const params = request.sequence !== undefined ? [request.eventId, request.sequence] : [request.eventId];
            const result = stmt.run(...params);
            return result.changes > 0;
        },

        async removeDeadLetterEvent(request) {
            const stmt = request.sequence !== undefined ? statements.deleteDeadLetterIdWithSeq : statements.deleteDeadLetterId;
            const params = request.sequence !== undefined ? [request.eventId, request.sequence] : [request.eventId];
            const result = stmt.run(...params);
            return result.changes > 0;
        },

        async listProcessedEvents() {
            const rows = statements.listByQueue.all("processed");
            return Object.freeze(rows.map(r => JSON.parse(r.payload)));
        },

        async listRetryEvents() {
            const rows = statements.listByQueue.all("retry");
            return Object.freeze(rows.map(r => JSON.parse(r.payload)));
        },

        async listDeadLetterEvents() {
            const rows = statements.listByQueue.all("dead_letter");
            return Object.freeze(rows.map(r => JSON.parse(r.payload)));
        },

        async clear() {
            statements.clear.run();
        },

        async removeFile() {
            statements.drop.run();
        },

        async recordRunStart(request) {
            statements.insertRun.run(
                request.runId,
                request.eventId,
                request.traceId,
                request.status || "started",
                request.timestampMs || now(),
                request.metadata ? JSON.stringify(request.metadata) : null
            );
        },

        async recordRunComplete(request) {
            statements.updateRun.run(
                request.status || "completed",
                request.timestampMs || now(),
                request.metadata ? JSON.stringify(request.metadata) : null,
                request.runId
            );
        },
    });
}
