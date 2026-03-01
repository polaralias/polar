import {
    RuntimeExecutionError,
} from "@polar/domain";

/**
 * SQLite implementation of a Memory Provider for persistent fact storage.
 * 
 * @param {{
 *   db: import("better-sqlite3").Database,
 *   now?: () => number
 * }} config
 */
export function createSqliteMemoryProvider({ db, now = () => Date.now() }) {
    if (!db || typeof db.prepare !== "function") {
        throw new RuntimeExecutionError("A valid better-sqlite3 database instance is required");
    }

    // Initialize tables with FTS5 virtual table for full-text search (BUG-016 fix)
    db.exec(`
    CREATE TABLE IF NOT EXISTS polar_memory (
      memoryId TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      userId TEXT NOT NULL,
      scope TEXT NOT NULL,
      type TEXT NOT NULL,
      record JSON NOT NULL,
      metadata JSON NOT NULL,
      createdAtMs INTEGER NOT NULL,
      updatedAtMs INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_search ON polar_memory(sessionId, userId, scope);
  `);

    // Create FTS5 virtual table for full-text search if it doesn't exist
    try {
        db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS polar_memory_fts USING fts5(
        memoryId,
        searchableText,
        content='',
        tokenize='porter unicode61'
      );
    `);
    } catch {
        // FTS5 may not be available in all SQLite builds; fall back to LIKE-based search
    }

    const hasFts = (() => {
        try {
            db.prepare("SELECT * FROM polar_memory_fts LIMIT 0").all();
            return true;
        } catch {
            return false;
        }
    })();

    const statements = {
        upsert: db.prepare(`
      INSERT INTO polar_memory (memoryId, sessionId, userId, scope, type, record, metadata, createdAtMs, updatedAtMs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memoryId) DO UPDATE SET
        record = excluded.record,
        metadata = excluded.metadata,
        updatedAtMs = excluded.updatedAtMs
    `),
        get: db.prepare(`SELECT * FROM polar_memory WHERE memoryId = ?`),
        searchFiltered: db.prepare(`
      SELECT * FROM polar_memory 
      WHERE sessionId = ? AND userId = ? AND scope = ?
      ORDER BY updatedAtMs DESC
      LIMIT ?
    `),
        // BUG-016 fix: LIKE-based text search fallback when FTS5 is unavailable
        searchWithQuery: db.prepare(`
      SELECT * FROM polar_memory
      WHERE sessionId = ? AND userId = ? AND scope = ?
        AND record LIKE ?
      ORDER BY updatedAtMs DESC
      LIMIT ?
    `),
        delete: db.prepare(`DELETE FROM polar_memory WHERE memoryId = ?`),
        listAll: db.prepare(`SELECT * FROM polar_memory`),
        // BUG-017 fix: compact queries
        countBySession: db.prepare(`
      SELECT COUNT(*) as cnt FROM polar_memory WHERE sessionId = ? AND scope = ?
    `),
        oldestBySession: db.prepare(`
      SELECT memoryId, record, updatedAtMs FROM polar_memory
      WHERE sessionId = ? AND scope = ?
      ORDER BY updatedAtMs ASC
      LIMIT ?
    `),
        deleteById: db.prepare(`DELETE FROM polar_memory WHERE memoryId = ?`),
    };

    // FTS statements (only prepared if FTS5 is available)
    const ftsStatements = hasFts ? {
        insertFts: db.prepare(`INSERT INTO polar_memory_fts (memoryId, searchableText) VALUES (?, ?)`),
        deleteFts: db.prepare(`DELETE FROM polar_memory_fts WHERE memoryId = ?`),
        searchFts: db.prepare(`
      SELECT m.* FROM polar_memory m
      INNER JOIN polar_memory_fts f ON m.memoryId = f.memoryId
      WHERE m.sessionId = ? AND m.userId = ? AND m.scope = ?
        AND polar_memory_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `),
    } : null;

    /**
     * Extract searchable text from a record for FTS indexing
     */
    function extractSearchableText(record) {
        if (!record || typeof record !== 'object') return '';
        const parts = [];
        if (record.fact) parts.push(record.fact);
        if (record.type) parts.push(record.type);
        if (record.summary) parts.push(record.summary);
        if (record.content) parts.push(record.content);
        // Fallback: stringify the whole record for broad search
        if (parts.length === 0) parts.push(JSON.stringify(record));
        return parts.join(' ');
    }

    return Object.freeze({
        async upsert(request) {
            const memoryId = request.memoryId || `mem_${Math.random().toString(36).substring(2, 10)}`;
            const timestamp = now();

            statements.upsert.run(
                memoryId,
                request.sessionId,
                request.userId,
                request.scope,
                request.record.type || 'generic',
                JSON.stringify(request.record),
                JSON.stringify(request.metadata || {}),
                timestamp,
                timestamp
            );

            // Index in FTS if available
            if (ftsStatements) {
                try {
                    ftsStatements.deleteFts.run(memoryId);
                    ftsStatements.insertFts.run(memoryId, extractSearchableText(request.record));
                } catch {
                    // FTS indexing failure is non-fatal
                }
            }

            return {
                memoryId,
                created: true
            };
        },

        async get(request) {
            const row = statements.get.get(request.memoryId);
            if (!row) return { found: false };

            return {
                found: true,
                record: JSON.parse(row.record),
                metadata: JSON.parse(row.metadata)
            };
        },

        async search(request) {
            const query = request.query;
            const limit = request.limit || 50;
            let rows;

            // BUG-016 fix: Use full-text search when a query is provided
            if (query && typeof query === 'string' && query.trim().length > 0) {
                if (ftsStatements) {
                    // Use FTS5 for ranked search
                    try {
                        rows = ftsStatements.searchFts.all(
                            request.sessionId,
                            request.userId,
                            request.scope,
                            query,
                            limit
                        );
                    } catch {
                        // FTS query syntax error, fall back to LIKE
                        rows = statements.searchWithQuery.all(
                            request.sessionId,
                            request.userId,
                            request.scope,
                            `%${query}%`,
                            limit
                        );
                    }
                } else {
                    // Fallback: LIKE-based search on record JSON
                    rows = statements.searchWithQuery.all(
                        request.sessionId,
                        request.userId,
                        request.scope,
                        `%${query}%`,
                        limit
                    );
                }
            } else {
                // No query: return most recent records (original behavior)
                rows = statements.searchFiltered.all(
                    request.sessionId,
                    request.userId,
                    request.scope,
                    limit
                );
            }

            return {
                records: rows.map(r => ({
                    memoryId: r.memoryId,
                    record: JSON.parse(r.record),
                    metadata: JSON.parse(r.metadata),
                    updatedAtMs: r.updatedAtMs
                }))
            };
        },

        async compact(request) {
            // BUG-017 fix: Real compaction implementation
            // Strategy: for the given session+scope, if there are more than maxRecords,
            // merge the oldest records by concatenating their facts into a single summary record.
            const sessionId = request.sessionId;
            const scope = request.scope || 'session';
            const maxRecords = request.maxRecords || 100;
            const batchSize = request.batchSize || 20;

            const { cnt: totalCount } = statements.countBySession.get(sessionId, scope);

            if (totalCount <= maxRecords) {
                return {
                    examinedCount: totalCount,
                    compactedCount: 0,
                    archivedCount: 0,
                };
            }

            // How many records need to be compacted
            const excessCount = totalCount - maxRecords;
            const toCompact = Math.min(excessCount, batchSize);

            // Get the oldest records to compact
            const oldestRows = statements.oldestBySession.all(sessionId, scope, toCompact);

            if (oldestRows.length === 0) {
                return {
                    examinedCount: totalCount,
                    compactedCount: 0,
                    archivedCount: 0,
                };
            }

            // Merge facts from old records into a single summary
            const mergedFacts = oldestRows.map(row => {
                try {
                    const rec = JSON.parse(row.record);
                    return rec.fact || rec.summary || JSON.stringify(rec);
                } catch {
                    return '';
                }
            }).filter(Boolean);

            const summary = mergedFacts.join('; ');
            const timestamp = now();

            // Delete old records
            const deleteMany = db.transaction((ids) => {
                if (ids.length === 0) return;

                // SQLite has a limit on the number of variables in a single query (default ~999)
                const CHUNK_SIZE = 500;
                for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
                    const chunk = ids.slice(i, i + CHUNK_SIZE);
                    const placeholders = chunk.map(() => '?').join(',');
                    
                    db.prepare(`DELETE FROM polar_memory WHERE memoryId IN (${placeholders})`).run(...chunk);
                    if (ftsStatements) {
                        try {
                            db.prepare(`DELETE FROM polar_memory_fts WHERE memoryId IN (${placeholders})`).run(...chunk);
                        } catch { /* non-fatal */ }
                    }
                }
            });

            const idsToDelete = oldestRows.map(r => r.memoryId);
            deleteMany(idsToDelete);

            // Insert a single compacted summary record
            const compactedId = `compact_${Math.random().toString(36).substring(2, 10)}`;
            statements.upsert.run(
                compactedId,
                sessionId,
                request.userId || 'system',
                scope,
                'compacted_summary',
                JSON.stringify({ type: 'compacted_summary', summary, sourceCount: idsToDelete.length }),
                JSON.stringify({ strategy: 'sqlite_compaction', compactedAt: timestamp }),
                timestamp,
                timestamp
            );

            if (ftsStatements) {
                try {
                    ftsStatements.insertFts.run(compactedId, summary);
                } catch { /* non-fatal */ }
            }

            return {
                examinedCount: totalCount,
                compactedCount: idsToDelete.length,
                archivedCount: 1,
            };
        }
    });
}
