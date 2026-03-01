import { mkdir, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

function toIso(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  return new Date(ms).toISOString();
}

function toDayKey(ms) {
  if (!Number.isFinite(ms)) return "unknown-day";
  return new Date(ms).toISOString().slice(0, 10);
}

function safeJsonParse(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    if (typeof error?.message === "string" && error.message.includes("no such table")) {
      return [];
    }
    throw error;
  }
}

function groupByDay(rows, getTimestampMs) {
  const groups = new Map();
  for (const row of rows) {
    const timestampMs = getTimestampMs(row);
    const key = toDayKey(timestampMs);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({
      day,
      items: items.sort((a, b) => {
        const aTime = getTimestampMs(a);
        const bTime = getTimestampMs(b);
        if (aTime !== bTime) return aTime - bTime;
        const aId = String(a.id ?? a.memoryId ?? a.sequence ?? "");
        const bId = String(b.id ?? b.memoryId ?? b.sequence ?? "");
        return aId.localeCompare(bId);
      }),
    }));
}

function renderReactionsMarkdown(rows, generatedAtIso) {
  const counts = { positive: 0, negative: 0, neutral: 0 };
  for (const row of rows) {
    if (row.polarity === "positive") counts.positive += 1;
    else if (row.polarity === "negative") counts.negative += 1;
    else counts.neutral += 1;
  }

  const lines = [
    "# REACTIONS",
    "",
    `Generated at: ${generatedAtIso}`,
    `Total events: ${rows.length}`,
    `Polarity counts: positive=${counts.positive}, negative=${counts.negative}, neutral=${counts.neutral}`,
    "",
  ];

  const groups = groupByDay(rows, (row) => Number(row.createdAtMs));
  if (groups.length === 0) {
    lines.push("## No reactions");
    lines.push("");
    return `${lines.join("\n")}`;
  }

  for (const group of groups) {
    lines.push(`## ${group.day}`);
    lines.push("");
    for (const row of group.items) {
      const payload = safeJsonParse(row.payload, {});
      const targetMessageText =
        payload && typeof payload.targetMessageText === "string"
          ? payload.targetMessageText.replace(/\s+/g, " ").trim()
          : "";
      lines.push(`### ${row.id}`);
      lines.push(`- time: ${toIso(Number(row.createdAtMs))}`);
      lines.push(`- sessionId: ${row.sessionId}`);
      lines.push(`- type: ${row.type}`);
      lines.push(`- messageId: ${row.messageId ?? ""}`);
      lines.push(`- emoji: ${row.emoji ?? ""}`);
      lines.push(`- polarity: ${row.polarity}`);
      if (targetMessageText.length > 0) {
        lines.push(`- target: ${targetMessageText}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}`;
}

function renderHeartbeatMarkdown(rows, generatedAtIso) {
  const policyIds = new Set(rows.map((row) => row.id));
  const lines = [
    "# HEARTBEAT",
    "",
    `Generated at: ${generatedAtIso}`,
    `Total heartbeat runs: ${rows.length}`,
    `Distinct policies: ${policyIds.size}`,
    "",
  ];

  const groups = groupByDay(rows, (row) => Number(row.createdAtMs));
  if (groups.length === 0) {
    lines.push("## No heartbeat runs");
    lines.push("");
    return `${lines.join("\n")}`;
  }

  for (const group of groups) {
    lines.push(`## ${group.day}`);
    lines.push("");
    for (const row of group.items) {
      const output = safeJsonParse(row.output, {});
      const status = typeof output?.status === "string" ? output.status : "unknown";
      lines.push(`### ${row.id} / ${row.runId}`);
      lines.push(`- sequence: ${row.sequence}`);
      lines.push(`- time: ${toIso(Number(row.createdAtMs))}`);
      lines.push(`- profileId: ${row.profileId}`);
      lines.push(`- trigger: ${row.trigger}`);
      lines.push(`- status: ${status}`);
      lines.push("");
    }
  }

  return `${lines.join("\n")}`;
}

function extractMemorySummary(row) {
  const record = safeJsonParse(row.record, {});
  if (record && typeof record.summary === "string" && record.summary.trim().length > 0) {
    return record.summary.trim();
  }
  if (record && typeof record.fact === "string" && record.fact.trim().length > 0) {
    return record.fact.trim();
  }
  if (record && typeof record.content === "string" && record.content.trim().length > 0) {
    return record.content.trim();
  }
  const serialized = JSON.stringify(record);
  return serialized === "{}" ? "" : serialized;
}

function renderMemoryMarkdown(rows, generatedAtIso) {
  const scopeCounts = new Map();
  for (const row of rows) {
    scopeCounts.set(row.scope, (scopeCounts.get(row.scope) ?? 0) + 1);
  }

  const sortedScopes = [...scopeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const scopeSummary = sortedScopes.map(([scope, count]) => `${scope}=${count}`).join(", ");

  const lines = [
    "# MEMORY",
    "",
    `Generated at: ${generatedAtIso}`,
    `Total memory rows: ${rows.length}`,
    `Scope counts: ${scopeSummary || "none"}`,
    "",
  ];

  const groups = groupByDay(rows, (row) => Number(row.updatedAtMs ?? row.createdAtMs));
  if (groups.length === 0) {
    lines.push("## No memory summaries");
    lines.push("");
    return `${lines.join("\n")}`;
  }

  for (const group of groups) {
    lines.push(`## ${group.day}`);
    lines.push("");
    for (const row of group.items) {
      const summary = extractMemorySummary(row).replace(/\s+/g, " ").trim();
      lines.push(`### ${row.memoryId}`);
      lines.push(`- time: ${toIso(Number(row.updatedAtMs ?? row.createdAtMs))}`);
      lines.push(`- sessionId: ${row.sessionId}`);
      lines.push(`- userId: ${row.userId}`);
      lines.push(`- scope: ${row.scope}`);
      lines.push(`- type: ${row.type}`);
      lines.push(`- summary: ${summary || "(empty)"}`);
      lines.push("");
    }
  }

  return `${lines.join("\n")}`;
}

function renderPersonalityMarkdown(rows, generatedAtIso) {
  const globalProfile = rows.find((row) => row.scope === "global") || null;
  const userProfiles = rows.filter((row) => row.scope === "user");
  const sessionProfiles = rows.filter((row) => row.scope === "session");

  const lines = [
    "# PERSONALITY",
    "",
    `Generated at: ${generatedAtIso}`,
    `Total profiles: ${rows.length}`,
    "",
    "## Global",
    "",
  ];

  if (!globalProfile) {
    lines.push("No global personality profile is set.");
  } else {
    lines.push(`Updated: ${toIso(Number(globalProfile.updatedAtMs))}`);
    lines.push("");
    lines.push(globalProfile.prompt);
  }

  lines.push("");
  lines.push("## User Profiles");
  lines.push("");
  if (userProfiles.length === 0) {
    lines.push("No user-scoped profiles.");
  } else {
    for (const row of userProfiles) {
      lines.push(`### ${row.userId}`);
      lines.push(`- updated: ${toIso(Number(row.updatedAtMs))}`);
      lines.push(`- prompt: ${row.prompt}`);
      lines.push("");
    }
  }

  lines.push("## Session Profiles");
  lines.push("");
  if (sessionProfiles.length === 0) {
    lines.push("No session-scoped profiles.");
  } else {
    for (const row of sessionProfiles) {
      lines.push(`### ${row.userId} / ${row.sessionId}`);
      lines.push(`- updated: ${toIso(Number(row.updatedAtMs))}`);
      lines.push(`- prompt: ${row.prompt}`);
      lines.push("");
    }
  }

  return `${lines.join("\n")}`;
}

/**
 * @param {{
 *   db: import("better-sqlite3").Database,
 *   artifactsDir: string,
 *   generatedAtMs?: number
 * }} config
 */
export async function exportArtifactsFromDb({
  db,
  artifactsDir,
  generatedAtMs = Date.now(),
}) {
  const resolvedArtifactsDir = resolve(artifactsDir);
  await mkdir(resolvedArtifactsDir, { recursive: true });

  const generatedAtIso = new Date(generatedAtMs).toISOString();

  const reactions = safeAll(
    db,
    `SELECT id, type, sessionId, messageId, emoji, polarity, payload, createdAtMs
     FROM polar_feedback_events
     ORDER BY createdAtMs DESC, id DESC`,
  );

  const heartbeatRuns = safeAll(
    db,
    `SELECT sequence, id, runId, profileId, trigger, output, metadata, createdAtMs
     FROM polar_run_events
     WHERE source = 'heartbeat'
     ORDER BY sequence ASC`,
  );

  const memoryRows = safeAll(
    db,
    `SELECT memoryId, sessionId, userId, scope, type, record, metadata, createdAtMs, updatedAtMs
     FROM polar_memory
     ORDER BY updatedAtMs DESC, memoryId DESC`,
  );
  const personalityRows = safeAll(
    db,
    `SELECT profileId, scope, userId, sessionId, name, prompt, createdAtMs, updatedAtMs
     FROM polar_personality_profiles
     ORDER BY updatedAtMs DESC, profileId DESC`,
  );

  const outputs = [
    {
      filename: "REACTIONS.md",
      path: resolve(resolvedArtifactsDir, "REACTIONS.md"),
      content: renderReactionsMarkdown(reactions, generatedAtIso),
    },
    {
      filename: "HEARTBEAT.md",
      path: resolve(resolvedArtifactsDir, "HEARTBEAT.md"),
      content: renderHeartbeatMarkdown(heartbeatRuns, generatedAtIso),
    },
    {
      filename: "MEMORY.md",
      path: resolve(resolvedArtifactsDir, "MEMORY.md"),
      content: renderMemoryMarkdown(memoryRows, generatedAtIso),
    },
    {
      filename: "PERSONALITY.md",
      path: resolve(resolvedArtifactsDir, "PERSONALITY.md"),
      content: renderPersonalityMarkdown(personalityRows, generatedAtIso),
    },
  ];

  for (const output of outputs) {
    await writeFile(output.path, `${output.content.trimEnd()}\n`, "utf8");
  }

  return Object.freeze({
    status: "exported",
    artifactsDir: resolvedArtifactsDir,
    generatedAtMs,
    generatedAtIso,
    files: Object.freeze(
      outputs.map((output) =>
        Object.freeze({
          filename: output.filename,
          path: output.path,
        }),
      ),
    ),
    counts: Object.freeze({
      reactions: reactions.length,
      heartbeat: heartbeatRuns.length,
      memory: memoryRows.length,
      personality: personalityRows.length,
    }),
  });
}

/**
 * @param {{ artifactsDir: string }} config
 */
export async function listArtifactFiles({ artifactsDir }) {
  const resolvedArtifactsDir = resolve(artifactsDir);
  const filenames = ["REACTIONS.md", "HEARTBEAT.md", "MEMORY.md", "PERSONALITY.md"];
  const items = [];
  for (const filename of filenames) {
    const path = resolve(resolvedArtifactsDir, filename);
    try {
      const info = await stat(path);
      items.push(
        Object.freeze({
          filename,
          path,
          updatedAtMs: info.mtimeMs,
        }),
      );
    } catch {
      items.push(
        Object.freeze({
          filename,
          path,
          updatedAtMs: null,
        }),
      );
    }
  }
  return Object.freeze(items);
}
