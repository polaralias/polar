import { ContractValidationError } from "@polar/domain";

/**
 * @typedef {"ToolUnavailable"|"ToolMisconfigured"|"ToolTransientError"|"ToolValidationError"|"InternalContractBug"} ToolWorkflowErrorCategory
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * @param {unknown} error
 * @returns {ToolWorkflowErrorCategory}
 */
function classify(error) {
  const message = errorMessage(error);
  const lower = message.toLowerCase();

  if (
    message.includes("Invalid chat.management.gateway.message.append.request") ||
    message.includes("chat.management.gateway.message.append.request")
  ) {
    return "InternalContractBug";
  }

  if (
    message.includes("Invalid extension.gateway.execute.request") ||
    /unknown extension|missing extension|missing tool|not installed|not registered/i.test(message)
  ) {
    return "ToolUnavailable";
  }

  if (
    /missing (api|access) key|missing credential|missing credentials|misconfigured|invalid base url|invalid base_url|unauthori[sz]ed|forbidden|auth/i.test(lower)
  ) {
    return "ToolMisconfigured";
  }

  if (
    /timeout|timed out|econnreset|eai_again|temporar|rate limit|429|\b5\d\d\b|network/i.test(lower)
  ) {
    return "ToolTransientError";
  }

  if (
    error instanceof ContractValidationError ||
    /validation|invalid input|schema mismatch|missing required/i.test(lower)
  ) {
    return "ToolValidationError";
  }

  return "InternalContractBug";
}

/**
 * @param {{
 *  error: unknown,
 *  extensionId?: string,
 *  capabilityId?: string,
 *  workflowId?: string,
 *  runId?: string,
 *  threadId?: string,
 * }} params
 */
export function normalizeToolWorkflowError(params) {
  const category = classify(params.error);
  const message = errorMessage(params.error);
  const retryEligible = category === "ToolTransientError";
  const clearPending = category !== "ToolTransientError" && category !== "ToolValidationError";

  const userMessageByCategory = {
    ToolUnavailable: "This capability isn't available in this deployment yet.",
    ToolMisconfigured: "This capability is currently misconfigured, so I can't run it right now.",
    ToolTransientError: "That tool call failed due to a temporary issue.",
    ToolValidationError: "I couldn't run that because required inputs were invalid or missing.",
    InternalContractBug: "Something broke internally while running that workflow step. I've logged it.",
  };

  return {
    category,
    retryEligible,
    clearPending,
    userMessage: userMessageByCategory[category],
    auditMetadata: {
      category,
      retryEligible,
      clearPending,
      extensionId: params.extensionId,
      capabilityId: params.capabilityId,
      workflowId: params.workflowId,
      runId: params.runId,
      threadId: params.threadId,
      errorName: params.error instanceof Error ? params.error.name : typeof params.error,
      errorCode:
        params.error && typeof params.error === "object" && "code" in params.error
          ? /** @type {{ code?: unknown }} */ (params.error).code
          : undefined,
      errorMessage: message.slice(0, 300),
      timestampMs: Date.now(),
    },
  };
}
