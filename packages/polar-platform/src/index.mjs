import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { createControlPlaneService } from "@polar/control-plane";
import {
  createSqliteAutomationJobStore,
  createSqliteBudgetStateStore,
  createSqliteFeedbackEventStore,
  createSqliteMemoryProvider,
  createSqlitePersonalityStore,
  createSqliteSchedulerStateStore,
} from "@polar/runtime-core";
import { createAgentConfigStore } from "./agent-config-store.mjs";

/**
 * @param {{
 *   dbPath: string,
 *   agentConfigDir?: string,
 *   now?: () => number,
 *   auditSink?: (event: unknown) => Promise<void>|void,
 *   devMode?: boolean
 * }} config
 */
export function createPolarPlatform(config = {}) {
  if (
    typeof config !== "object" ||
    config === null ||
    Object.getPrototypeOf(config) !== Object.prototype
  ) {
    throw new TypeError("createPolarPlatform requires a plain object config");
  }
  if (typeof config.dbPath !== "string" || config.dbPath.trim().length === 0) {
    throw new TypeError("createPolarPlatform requires a non-empty dbPath");
  }

  const now = typeof config.now === "function" ? config.now : () => Date.now();
  const resolvedDbPath = resolve(config.dbPath);
  const db = new Database(resolvedDbPath);
  const schedulerStateStore = createSqliteSchedulerStateStore({ db, now });
  const budgetStateStore = createSqliteBudgetStateStore({ db, now });
  const memoryProvider = createSqliteMemoryProvider({ db, now });
  const feedbackEventStore = createSqliteFeedbackEventStore({ db, now });
  const automationJobStore = createSqliteAutomationJobStore({ db, now });
  const personalityStore = createSqlitePersonalityStore({ db, now });
  const agentConfigDir = resolve(
    config.agentConfigDir ?? dirname(resolvedDbPath),
    config.agentConfigDir ? "" : "config/agents",
  );
  const controlPlane = createControlPlaneService({
    schedulerStateStore,
    budgetStateStore,
    memoryProvider,
    feedbackEventStore,
    automationJobStore,
    personalityStore,
    runEventDb: db,
    auditSink: config.auditSink,
    now,
    devMode: config.devMode,
  });
  const agentConfigStore = createAgentConfigStore({
    controlPlane,
    agentConfigDir,
  });
  const bootstrapAgentConfigs = async () => {
    await agentConfigStore.seedDefaultsIfEmpty();
    await agentConfigStore.syncFromDisk();
  };
  const bootstrapPromise = bootstrapAgentConfigs();

  let isClosed = false;
  const shutdown = () => {
    if (isClosed) return;
    isClosed = true;
    db.close();
  };

  return Object.freeze({
    db,
    controlPlane,
    agentConfigStore,
    bootstrapPromise,
    dbPath: resolvedDbPath,
    agentConfigDir,
    shutdown,
  });
}

/**
 * @param {{ shutdown?: () => void } | null | undefined} platform
 */
export function closePolarPlatform(platform) {
  if (platform && typeof platform.shutdown === "function") {
    platform.shutdown();
  }
}

export function defaultDbPath() {
  return resolve(process.cwd(), "../../polar-system.db");
}

export function defaultAgentConfigDir() {
  return resolve(process.cwd(), "../../config/agents");
}
