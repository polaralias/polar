import { randomUUID } from "node:crypto";

import {
  ContractValidationError,
  RuntimeExecutionError,
  isPlainObject,
} from "@polar/domain";

const PERSONALITY_SCOPES = new Set(["global", "user", "session"]);
const MAX_PROMPT_LENGTH = 2000;

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

function normalizePrompt(prompt, schemaId) {
  if (typeof prompt !== "string") {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.prompt must be a string`],
    });
  }
  if (prompt.includes("\u0000")) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.prompt must not contain null bytes`],
    });
  }
  const withoutTrailingWhitespace = prompt.replace(/[ \t]+$/gm, "").trimEnd();
  if (withoutTrailingWhitespace.length === 0) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.prompt must be non-empty`],
    });
  }
  if (withoutTrailingWhitespace.length > MAX_PROMPT_LENGTH) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [
        `${schemaId}.prompt length must be <= ${MAX_PROMPT_LENGTH} characters`,
      ],
    });
  }
  return withoutTrailingWhitespace;
}

function parseScopeLocator(request, schemaId, { requirePrompt = false } = {}) {
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(
    request,
    new Set(["scope", "userId", "sessionId", "name", "prompt"]),
    schemaId,
  );

  if (!isNonEmptyString(request.scope) || !PERSONALITY_SCOPES.has(request.scope.trim())) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.scope must be one of: global, user, session`],
    });
  }

  const scope = request.scope.trim();
  const userId = request.userId === undefined ? undefined : String(request.userId).trim();
  const sessionId =
    request.sessionId === undefined ? undefined : String(request.sessionId).trim();
  const name = request.name === undefined ? undefined : String(request.name).trim();

  if (scope === "global") {
    if (userId !== undefined && userId.length > 0) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId}.userId must be omitted for global scope`],
      });
    }
    if (sessionId !== undefined && sessionId.length > 0) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId}.sessionId must be omitted for global scope`],
      });
    }
  }

  if (scope === "user") {
    if (!isNonEmptyString(userId)) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId}.userId is required for user scope`],
      });
    }
    if (sessionId !== undefined && sessionId.length > 0) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId}.sessionId must be omitted for user scope`],
      });
    }
  }

  if (scope === "session") {
    if (!isNonEmptyString(userId)) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId}.userId is required for session scope`],
      });
    }
    if (!isNonEmptyString(sessionId)) {
      throw new ContractValidationError(`Invalid ${schemaId}`, {
        schemaId,
        errors: [`${schemaId}.sessionId is required for session scope`],
      });
    }
  }

  let prompt;
  if (requirePrompt) {
    prompt = normalizePrompt(request.prompt, schemaId);
  }

  if (request.name !== undefined && typeof request.name !== "string") {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.name must be a string when provided`],
    });
  }

  return Object.freeze({
    scope,
    ...(scope !== "global" ? { userId: userId.trim() } : {}),
    ...(scope === "session" ? { sessionId: sessionId.trim() } : {}),
    ...(name !== undefined && name.length > 0 ? { name } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
  });
}

function parseListRequest(request) {
  const schemaId = "personality.profile.list";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }

  assertNoUnknownKeys(request, new Set(["scope", "userId", "limit"]), schemaId);

  if (
    request.scope !== undefined &&
    (!isNonEmptyString(request.scope) || !PERSONALITY_SCOPES.has(request.scope.trim()))
  ) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.scope must be one of: global, user, session`],
    });
  }
  if (request.userId !== undefined && !isNonEmptyString(request.userId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.userId must be a non-empty string when provided`],
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
    ...(request.scope !== undefined ? { scope: request.scope.trim() } : {}),
    ...(request.userId !== undefined ? { userId: request.userId.trim() } : {}),
    limit: request.limit ?? 100,
  });
}

function parseEffectiveRequest(request) {
  const schemaId = "personality.profile.effective";
  if (!isPlainObject(request)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId} must be a plain object`],
    });
  }
  assertNoUnknownKeys(request, new Set(["userId", "sessionId"]), schemaId);
  if (!isNonEmptyString(request.userId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.userId must be a non-empty string`],
    });
  }
  if (!isNonEmptyString(request.sessionId)) {
    throw new ContractValidationError(`Invalid ${schemaId}`, {
      schemaId,
      errors: [`${schemaId}.sessionId must be a non-empty string`],
    });
  }
  return Object.freeze({
    userId: request.userId.trim(),
    sessionId: request.sessionId.trim(),
  });
}

function profileIdFor(scope, userId, sessionId) {
  if (scope === "global") return "personality:global";
  if (scope === "user") return `personality:user:${userId}`;
  return `personality:session:${userId}:${sessionId}`;
}

function mapRow(row) {
  if (!row) return null;
  return Object.freeze({
    profileId: row.profileId,
    scope: row.scope,
    ...(row.userId ? { userId: row.userId } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.name ? { name: row.name } : {}),
    prompt: row.prompt,
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
  });
}

/**
 * @param {{
 *   db: import("better-sqlite3").Database,
 *   now?: () => number
 * }} config
 */
export function createSqlitePersonalityStore({ db, now = () => Date.now() }) {
  if (!db || typeof db.prepare !== "function") {
    throw new RuntimeExecutionError("A valid better-sqlite3 database instance is required");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS polar_personality_profiles (
      profileId TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      userId TEXT,
      sessionId TEXT,
      name TEXT,
      prompt TEXT NOT NULL,
      createdAtMs INTEGER NOT NULL,
      updatedAtMs INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_personality_user
      ON polar_personality_profiles(userId, scope);
    CREATE INDEX IF NOT EXISTS idx_personality_session
      ON polar_personality_profiles(sessionId, userId, scope);
  `);

  const statements = {
    getById: db.prepare(`
      SELECT profileId, scope, userId, sessionId, name, prompt, createdAtMs, updatedAtMs
      FROM polar_personality_profiles
      WHERE profileId = ?
      LIMIT 1
    `),
    upsert: db.prepare(`
      INSERT INTO polar_personality_profiles (
        profileId,
        scope,
        userId,
        sessionId,
        name,
        prompt,
        createdAtMs,
        updatedAtMs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profileId) DO UPDATE SET
        name = excluded.name,
        prompt = excluded.prompt,
        updatedAtMs = excluded.updatedAtMs
    `),
    deleteById: db.prepare(`
      DELETE FROM polar_personality_profiles
      WHERE profileId = ?
    `),
  };

  return Object.freeze({
    /**
     * @param {unknown} request
     */
    getProfile(request) {
      const parsed = parseScopeLocator(request, "personality.profile.get");
      const profileId = profileIdFor(parsed.scope, parsed.userId, parsed.sessionId);
      return mapRow(statements.getById.get(profileId));
    },

    /**
     * @param {unknown} request
     */
    getEffectiveProfile(request) {
      const parsed = parseEffectiveRequest(request);

      const sessionRow = statements.getById.get(
        profileIdFor("session", parsed.userId, parsed.sessionId),
      );
      if (sessionRow) return mapRow(sessionRow);

      const userRow = statements.getById.get(profileIdFor("user", parsed.userId));
      if (userRow) return mapRow(userRow);

      const globalRow = statements.getById.get(profileIdFor("global"));
      return mapRow(globalRow);
    },

    /**
     * @param {unknown} request
     */
    upsertProfile(request) {
      const parsed = parseScopeLocator(request, "personality.profile.upsert", {
        requirePrompt: true,
      });
      const profileId = profileIdFor(parsed.scope, parsed.userId, parsed.sessionId);
      const existing = statements.getById.get(profileId);
      const nowMs = now();
      const createdAtMs =
        existing && typeof existing.createdAtMs === "number" ? existing.createdAtMs : nowMs;

      statements.upsert.run(
        profileId,
        parsed.scope,
        parsed.userId ?? null,
        parsed.sessionId ?? null,
        parsed.name ?? null,
        parsed.prompt,
        createdAtMs,
        nowMs,
      );

      return mapRow(statements.getById.get(profileId));
    },

    /**
     * @param {unknown} request
     */
    resetProfile(request) {
      const parsed = parseScopeLocator(request, "personality.profile.reset");
      const profileId = profileIdFor(parsed.scope, parsed.userId, parsed.sessionId);
      const result = statements.deleteById.run(profileId);
      return Object.freeze({
        deleted: result.changes > 0,
      });
    },

    /**
     * @param {unknown} [request]
     */
    listProfiles(request = {}) {
      const parsed = parseListRequest(request);
      const whereParts = [];
      const params = [];

      if (parsed.scope !== undefined) {
        whereParts.push("scope = ?");
        params.push(parsed.scope);
      }
      if (parsed.userId !== undefined) {
        whereParts.push("userId = ?");
        params.push(parsed.userId);
      }

      const whereClause =
        whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

      const statement = db.prepare(`
        SELECT profileId, scope, userId, sessionId, name, prompt, createdAtMs, updatedAtMs
        FROM polar_personality_profiles
        ${whereClause}
        ORDER BY updatedAtMs DESC, profileId DESC
        LIMIT ?
      `);
      const rows = statement.all(...params, parsed.limit);
      return Object.freeze(rows.map((row) => mapRow(row)));
    },
  });
}
