import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_LINEAGE_PATH = resolve(process.cwd(), ".polar-data", "lineage", "events.ndjson");
const LINEAGE_PATH = resolve(process.env.POLAR_LINEAGE_STORE_PATH || DEFAULT_LINEAGE_PATH);
const POLL_INTERVAL_MS = 500;

const INTERESTING_EVENT_TYPES = new Set([
  "delegation.activated",
  "delegation.completed",
  "delegation.cleared",
  "workflow.execution.results",
  "workflow.execution.cancelled",
  "workflow.execution.error_normalized",
]);

const TOOL_CHECKPOINT_ACTION_IDS = new Set([
  "extension.execute",
]);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function normalizeSummary(value) {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isInterestingToolCheckpoint(record) {
  if (!record || typeof record !== "object" || record.executionType !== "tool") {
    return false;
  }
  if (!TOOL_CHECKPOINT_ACTION_IDS.has(record.actionId)) {
    return false;
  }
  return record.stage === "execution";
}

function isInterestingEvent(record, options = {}) {
  if (!record || typeof record !== "object") {
    return false;
  }
  if (INTERESTING_EVENT_TYPES.has(record.eventType)) {
    return true;
  }
  return options.includeToolCheckpoints === true && isInterestingToolCheckpoint(record);
}

function formatWorkflowResults(record) {
  const toolResults = Array.isArray(record?.metadata?.toolResults)
    ? record.metadata.toolResults
    : [];
  if (toolResults.length === 0) {
    return "";
  }
  return toolResults
    .map((result) => {
      const tool = typeof result?.tool === "string" ? result.tool : "unknown_tool";
      const status = typeof result?.status === "string" ? result.status : "unknown";
      return `${tool}:${status}`;
    })
    .join(", ");
}

function formatEvent(record) {
  const timestamp = typeof record.timestamp === "string"
    ? record.timestamp
    : new Date(record.timestampMs || Date.now()).toISOString();

  if (record.executionType === "tool") {
    const actionId = typeof record.actionId === "string" ? record.actionId : "unknown_action";
    const checkpoint = typeof record.checkpoint === "string" ? record.checkpoint : record.eventType;
    const outcome = typeof record.outcome === "string" ? record.outcome : "unknown";
    const runId = typeof record.runId === "string" ? ` run=${record.runId}` : "";
    return `[${timestamp}] TOOL ${actionId} ${checkpoint} outcome=${outcome}${runId}`;
  }

  if (record.eventType === "delegation.activated") {
    const agentId = typeof record.agentId === "string" ? record.agentId : "unknown_agent";
    const modelId = typeof record.modelId === "string" ? ` model=${record.modelId}` : "";
    return `[${timestamp}] DELEGATION activated agent=${agentId}${modelId} workflow=${record.workflowId || "unknown"}`;
  }

  if (record.eventType === "delegation.completed" || record.eventType === "delegation.cleared") {
    const agentId = typeof record.agentId === "string" ? record.agentId : "unknown_agent";
    return `[${timestamp}] DELEGATION ${record.eventType.replace("delegation.", "")} agent=${agentId} workflow=${record.workflowId || "unknown"}`;
  }

  if (record.eventType === "workflow.execution.results") {
    const summary = formatWorkflowResults(record);
    return `[${timestamp}] WORKFLOW results workflow=${record.workflowId || "unknown"}${summary ? ` ${summary}` : ""}`;
  }

  if (record.eventType === "workflow.execution.cancelled") {
    const succeeded = Number.isFinite(record?.metadata?.succeededCount) ? record.metadata.succeededCount : 0;
    const failed = Number.isFinite(record?.metadata?.failedCount) ? record.metadata.failedCount : 0;
    const notAttempted = Number.isFinite(record?.metadata?.notAttemptedCount) ? record.metadata.notAttemptedCount : 0;
    return `[${timestamp}] WORKFLOW cancelled workflow=${record.workflowId || "unknown"} succeeded=${succeeded} failed=${failed} not_attempted=${notAttempted}`;
  }

  if (record.eventType === "workflow.execution.error_normalized") {
    const target = [record.extensionId, record.capabilityId].filter(Boolean).join(".");
    const category = typeof record?.metadata?.category === "string" ? record.metadata.category : "unknown";
    const message = normalizeSummary(record?.metadata?.errorMessage).slice(0, 140);
    return `[${timestamp}] WORKFLOW error workflow=${record.workflowId || "unknown"} target=${target || "unknown"} category=${category}${message ? ` msg=${message}` : ""}`;
  }

  return `[${timestamp}] ${record.eventType}`;
}

async function readChunk(filePath, position, length) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function main() {
  const startAtBeginning = process.argv.includes("--from-start");
  const includeToolCheckpoints = process.argv.includes("--tool-checkpoints");
  let offset = 0;
  let remainder = "";

  try {
    const initialStat = await stat(LINEAGE_PATH);
    offset = startAtBeginning ? 0 : initialStat.size;
  } catch {
    offset = 0;
  }

  process.stdout.write(`Watching lineage events in ${LINEAGE_PATH}\n`);
  process.stdout.write(
    `${startAtBeginning ? "Reading from start." : "Following new events only."} Press Ctrl+C to stop.\n`,
  );
  if (!includeToolCheckpoints) {
    process.stdout.write("Showing high-signal delegation and workflow events only. Use --tool-checkpoints for extension.execute lines.\n");
  }

  while (true) {
    try {
      const fileStat = await stat(LINEAGE_PATH);
      if (fileStat.size < offset) {
        offset = 0;
        remainder = "";
      }

      if (fileStat.size > offset) {
        const chunk = await readChunk(LINEAGE_PATH, offset, fileStat.size - offset);
        offset = fileStat.size;
        const combined = remainder + chunk;
        const lines = combined.split(/\r?\n/);
        remainder = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          try {
            const record = JSON.parse(line);
            if (isInterestingEvent(record, { includeToolCheckpoints })) {
              process.stdout.write(`${formatEvent(record)}\n`);
            }
          } catch {
            process.stdout.write(`[tail-lineage] skipped invalid JSON line\n`);
          }
        }
      }
    } catch {
      // File may not exist yet during startup; keep polling.
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  process.stderr.write(`[tail-lineage] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
