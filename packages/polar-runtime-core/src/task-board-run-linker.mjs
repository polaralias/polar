import Database from "better-sqlite3";

import { createSqliteRunEventLinker } from "./sqlite-run-event-linker.mjs";

/**
 * Legacy wrapper retained for compatibility with existing call-sites/tests.
 * Uses an in-memory SQLite DB while sharing the durable linker implementation.
 *
 * @param {{
 *   taskBoardGateway: {
 *     replayRunLinks: (request: unknown) => Promise<Record<string, unknown>>|Record<string, unknown>
 *   },
 *   now?: () => number
 * }} config
 */
export function createTaskBoardRunLinker({ taskBoardGateway, now = () => Date.now() }) {
  const db = new Database(":memory:");
  return createSqliteRunEventLinker({
    db,
    now,
    taskBoardGateway,
  });
}
