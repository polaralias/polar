import dotenv from "dotenv";
import path from "path";

import { createPolarPlatform } from "@polar/platform";
import {
  createAutomationRunner,
  createSqliteAutomationJobStore,
  createSqliteRunEventLinker,
} from "@polar/runtime-core";

dotenv.config();

const dbPath = path.resolve(process.cwd(), "../../polar-system.db");
const pollIntervalMs = Number.parseInt(process.env.POLAR_AUTOMATION_POLL_MS ?? "30000", 10);
const maxJobsPerTick = Number.parseInt(process.env.POLAR_AUTOMATION_TICK_LIMIT ?? "20", 10);
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";

if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000) {
  throw new Error("POLAR_AUTOMATION_POLL_MS must be an integer >= 1000");
}
if (!Number.isFinite(maxJobsPerTick) || maxJobsPerTick < 1 || maxJobsPerTick > 500) {
  throw new Error("POLAR_AUTOMATION_TICK_LIMIT must be an integer between 1 and 500");
}

const platform = createPolarPlatform({ dbPath });
const automationJobStore = createSqliteAutomationJobStore({ db: platform.db });
const runEventLinker = createSqliteRunEventLinker({ db: platform.db });

/**
 * Capability gate for proactive Telegram delivery:
 * - job limits must explicitly set allowTelegramSend=true
 * - delivery target must include chatId
 */
async function deliverySink({ job, runId, orchestrateResult }) {
  const limits = job && typeof job.limits === "object" && job.limits !== null ? job.limits : {};
  const delivery =
    limits && typeof limits.delivery === "object" && limits.delivery !== null
      ? limits.delivery
      : {};
  const allowTelegramSend = delivery.allowTelegramSend === true;
  const chatId = delivery.chatId;
  const threadId = delivery.threadId;

  if (!allowTelegramSend) {
    return {
      status: "skipped",
      reason: "telegram_delivery_not_enabled_for_job",
    };
  }

  if (!telegramBotToken) {
    return {
      status: "failed",
      reason: "telegram_bot_token_missing",
    };
  }

  if (typeof chatId !== "string" && typeof chatId !== "number") {
    return {
      status: "failed",
      reason: "delivery_chat_id_missing",
    };
  }

  const text =
    orchestrateResult && typeof orchestrateResult.text === "string"
      ? orchestrateResult.text.trim()
      : "";
  if (text.length === 0) {
    return {
      status: "skipped",
      reason: "orchestrate_result_missing_text",
    };
  }

  const payload = {
    chat_id: chatId,
    text,
  };
  if (typeof threadId === "number" && Number.isInteger(threadId) && threadId > 0) {
    payload.message_thread_id = threadId;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const json = await response.json();
  if (!response.ok || json.ok !== true) {
    return {
      status: "failed",
      reason: "telegram_send_failed",
      detail: json?.description ?? `http_${response.status}`,
    };
  }

  if (
    orchestrateResult &&
    typeof orchestrateResult.assistantMessageId === "string" &&
    typeof json?.result?.message_id === "number"
  ) {
    await platform.controlPlane.updateMessageChannelId(
      job.sessionId,
      orchestrateResult.assistantMessageId,
      json.result.message_id,
    );
  }

  return {
    status: "sent",
    channel: "telegram",
    runId,
    messageId: json?.result?.message_id,
  };
}

const runner = createAutomationRunner({
  controlPlane: platform.controlPlane,
  automationJobStore,
  runEventLinker,
  deliverySink,
});

let inFlight = false;
let intervalHandle = null;

async function tick() {
  if (inFlight) {
    return;
  }
  inFlight = true;
  try {
    const result = await runner.tick({
      limit: maxJobsPerTick,
    });
    if (result.runCount > 0) {
      console.log(
        `[automation-runner] due=${result.dueCount} ran=${result.runCount} at=${new Date(result.asOfMs).toISOString()}`,
      );
    }
  } catch (error) {
    console.error("[automation-runner] tick failed", error);
  } finally {
    inFlight = false;
  }
}

function shutdown(signal) {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  console.log(`[automation-runner] stopping on ${signal}`);
  platform.shutdown();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

intervalHandle = setInterval(() => {
  tick().catch((error) => {
    console.error("[automation-runner] uncaught tick error", error);
  });
}, pollIntervalMs);

await tick();
console.log(`[automation-runner] online pollIntervalMs=${pollIntervalMs} db=${dbPath}`);
