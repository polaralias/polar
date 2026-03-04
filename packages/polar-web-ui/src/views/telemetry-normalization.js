function readAliasedField(record, aliases) {
  for (const alias of aliases) {
    if (record[alias] !== undefined) {
      return record[alias];
    }
  }
  return undefined;
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/**
 * @param {unknown} summary
 * @returns {{
 *   totalOperations: number,
 *   completedCount: number,
 *   failedCount: number,
 *   fallbackCount: number,
 *   totalEstimatedCostUsd: number
 * }}
 */
export function normalizeUsageSummary(summary) {
  const source =
    typeof summary === "object" && summary !== null ? summary : {};
  const totalOperations = toFiniteNumber(source.totalOperations) ?? 0;
  const completedCount = toFiniteNumber(source.completedCount) ?? 0;
  const failedCount = toFiniteNumber(source.failedCount) ?? 0;
  const fallbackCount =
    toFiniteNumber(source.fallbackCount) ??
    toFiniteNumber(source.totalFallbacks) ??
    0;
  const totalEstimatedCostUsd =
    toFiniteNumber(source.totalEstimatedCostUsd) ??
    toFiniteNumber(source.total_estimated_cost_usd) ??
    0;

  return {
    totalOperations,
    completedCount,
    failedCount,
    fallbackCount,
    totalEstimatedCostUsd,
  };
}

/**
 * @param {unknown} event
 * @returns {{
 *   proposalType: string,
 *   proposalValid: boolean,
 *   finalDecision: string,
 *   outcomeStatus: string,
 *   llmConfidence: number|null
 * } | null}
 */
export function normalizeProposalValidationEvent(event) {
  if (typeof event !== "object" || event === null) {
    return null;
  }
  if (event.eventType !== "proposal.validation") {
    return null;
  }

  const proposalType = readAliasedField(event, [
    "proposal_type",
    "proposalType",
  ]);
  const proposalValid = readAliasedField(event, [
    "proposal_valid",
    "proposalValid",
  ]);
  const finalDecision = readAliasedField(event, [
    "final_decision",
    "finalDecision",
  ]);
  const outcomeStatus = readAliasedField(event, [
    "outcome_status",
    "outcomeStatus",
  ]);
  const llmConfidence = readAliasedField(event, [
    "llm_confidence",
    "llmConfidence",
  ]);

  return {
    proposalType:
      typeof proposalType === "string" && proposalType.length > 0
        ? proposalType
        : "unknown",
    proposalValid: proposalValid === true,
    finalDecision:
      typeof finalDecision === "string" && finalDecision.length > 0
        ? finalDecision
        : "unknown",
    outcomeStatus:
      typeof outcomeStatus === "string" && outcomeStatus.length > 0
        ? outcomeStatus
        : "unknown",
    llmConfidence: toFiniteNumber(llmConfidence),
  };
}

/**
 * @param {unknown} items
 * @returns {{ total: number, invalid: number, rejected: number }}
 */
export function summarizeProposalValidationEvents(items) {
  const list = Array.isArray(items) ? items : [];
  const normalized = list
    .map((item) => normalizeProposalValidationEvent(item))
    .filter((item) => item !== null);

  const invalid = normalized.filter((item) => item.proposalValid === false).length;
  const rejected = normalized.filter((item) => item.finalDecision === "clarify").length;

  return {
    total: normalized.length,
    invalid,
    rejected,
  };
}
