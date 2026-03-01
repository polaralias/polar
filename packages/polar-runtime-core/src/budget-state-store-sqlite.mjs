import {
  ContractValidationError,
  RuntimeExecutionError,
} from "@polar/domain";

/**
 * Production-grade SQLite Durable Budget Backend
 * 
 * @param {{
 *   db: import("better-sqlite3").Database,
 *   now?: () => number
 * }} config
 */
export function createSqliteBudgetStateStore({ db, now = () => Date.now() }) {
  if (!db || typeof db.prepare !== "function") {
    throw new RuntimeExecutionError("A valid better-sqlite3 database instance is required");
  }

  // Initialize tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS polar_budget_policies (
      scope TEXT NOT NULL,
      targetId TEXT NOT NULL,
      maxLimitUsd REAL NOT NULL,
      resetIntervalMs INTEGER,
      enforceBlocking INTEGER DEFAULT 1,
      PRIMARY KEY (scope, targetId)
    );

    CREATE TABLE IF NOT EXISTS polar_budget_usage (
      scope TEXT NOT NULL,
      targetId TEXT NOT NULL,
      accumulatedUsd REAL NOT NULL DEFAULT 0,
      lastResetAtMs INTEGER NOT NULL,
      updatedAtMs INTEGER NOT NULL,
      PRIMARY KEY (scope, targetId)
    );
  `);

  const statements = {
    upsertPolicy: db.prepare(`
      INSERT INTO polar_budget_policies (scope, targetId, maxLimitUsd, resetIntervalMs, enforceBlocking)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope, targetId) DO UPDATE SET
        maxLimitUsd = excluded.maxLimitUsd,
        resetIntervalMs = excluded.resetIntervalMs,
        enforceBlocking = excluded.enforceBlocking
    `),
    getPolicy: db.prepare(`SELECT * FROM polar_budget_policies WHERE scope = ? AND targetId = ?`),
    getUsage: db.prepare(`SELECT * FROM polar_budget_usage WHERE scope = ? AND targetId = ?`),
    initUsage: db.prepare(`
      INSERT OR IGNORE INTO polar_budget_usage (scope, targetId, accumulatedUsd, lastResetAtMs, updatedAtMs)
      VALUES (?, ?, 0, ?, ?)
    `),
    updateUsage: db.prepare(`
      UPDATE polar_budget_usage SET
        accumulatedUsd = ?,
        lastResetAtMs = ?,
        updatedAtMs = ?
      WHERE scope = ? AND targetId = ?
    `),
    incrementUsage: db.prepare(`
      UPDATE polar_budget_usage SET
        accumulatedUsd = accumulatedUsd + ?,
        updatedAtMs = ?
      WHERE scope = ? AND targetId = ?
    `),
  };

  return Object.freeze({
    async upsertPolicy(request) {
      statements.upsertPolicy.run(
        request.scope,
        request.targetId ?? "",
        request.maxLimitUsd,
        request.resetIntervalMs ?? null,
        request.enforceBlocking === false ? 0 : 1
      );
      return { status: "ok", policyId: `${request.scope}:${request.targetId ?? ""}` };
    },

    async getPolicy(request) {
      const row = statements.getPolicy.get(request.scope, request.targetId ?? "");
      if (!row) return { status: "not_found" };
      return {
        status: "ok",
        policyId: `${row.scope}:${row.targetId}`,
        maxLimitUsd: row.maxLimitUsd,
        resetIntervalMs: row.resetIntervalMs ?? undefined,
        enforceBlocking: row.enforceBlocking === 1
      };
    },

    async checkBudget(request) {
      const scope = request.scope;
      const targetId = request.targetId ?? "";
      const policy = statements.getPolicy.get(scope, targetId);
      if (!policy) return { status: "not_found" };

      const timestamp = now();
      let usage = statements.getUsage.get(scope, targetId);

      if (!usage) {
        statements.initUsage.run(scope, targetId, timestamp, timestamp);
        usage = statements.getUsage.get(scope, targetId);
      }

      // Reset logic
      if (policy.resetIntervalMs) {
        const elapsed = timestamp - usage.lastResetAtMs;
        if (elapsed >= policy.resetIntervalMs) {
          usage.accumulatedUsd = 0;
          usage.lastResetAtMs = timestamp;
          statements.updateUsage.run(0, timestamp, timestamp, scope, targetId);
        }
      }

      const remaining = Math.max(0, policy.maxLimitUsd - usage.accumulatedUsd);
      return {
        status: "ok",
        remainingBudgetUsd: remaining,
        enforceBlocking: policy.enforceBlocking === 1
      };
    },

    async recordUsage(request) {
      const scope = request.scope;
      const targetId = request.targetId ?? "";
      const cost = request.costUsd ?? 0;
      const timestamp = now();

      // Ensure entry exists
      statements.initUsage.run(scope, targetId, timestamp, timestamp);
      // Increment
      statements.incrementUsage.run(cost, timestamp, scope, targetId);
    }
  });
}
