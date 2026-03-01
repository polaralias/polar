import { randomUUID } from "node:crypto";

import { RuntimeExecutionError } from "@polar/domain";

function summarizeResult(result) {
  if (!result || typeof result !== "object") {
    return {
      status: "failed",
      summary: "orchestrate returned invalid response",
    };
  }

  const status = typeof result.status === "string" ? result.status : "error";
  if (status === "completed") {
    return {
      status: "executed",
      summary: typeof result.text === "string" ? result.text.slice(0, 500) : "completed",
    };
  }
  if (status === "workflow_proposed" || status === "repair_question") {
    return {
      status: "executed",
      summary: typeof result.text === "string" ? result.text.slice(0, 500) : status,
    };
  }

  return {
    status: "failed",
    summary: typeof result.text === "string" ? result.text.slice(0, 500) : status,
  };
}

function truncate(value, max = 500) {
  if (typeof value !== "string") {
    return "";
  }
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * @param {{
 *   controlPlane: {
 *     orchestrate: (request: Record<string, unknown>) => Promise<Record<string, unknown>>,
 *     resolveProfile?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>,
 *     proactiveInboxCheckHeaders?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>,
 *     proactiveInboxReadBody?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>
 *   },
 *   automationJobStore: {
 *     listDueJobs: (request?: Record<string, unknown>) => Promise<Record<string, unknown>>
 *   },
 *   runEventLinker: {
 *     recordAutomationRun: (request: Record<string, unknown>) => Promise<unknown>
 *   },
 *   now?: () => number,
 *   deliverySink?: (request: {
 *     job: Record<string, unknown>,
 *     runId: string,
 *     orchestrateResult: Record<string, unknown>
 *   }) => Promise<Record<string, unknown>|void>|Record<string, unknown>|void
 * }} config
 */
export function createAutomationRunner({
  controlPlane,
  automationJobStore,
  runEventLinker,
  now = () => Date.now(),
  deliverySink,
}) {
  if (!controlPlane || typeof controlPlane.orchestrate !== "function") {
    throw new RuntimeExecutionError("controlPlane.orchestrate is required");
  }
  if (!automationJobStore || typeof automationJobStore.listDueJobs !== "function") {
    throw new RuntimeExecutionError("automationJobStore.listDueJobs is required");
  }
  if (!runEventLinker || typeof runEventLinker.recordAutomationRun !== "function") {
    throw new RuntimeExecutionError("runEventLinker.recordAutomationRun is required");
  }
  if (deliverySink !== undefined && typeof deliverySink !== "function") {
    throw new RuntimeExecutionError("deliverySink must be a function when provided");
  }

  return Object.freeze({
    /**
     * @param {{ asOfMs?: number, limit?: number }} [request]
     */
    async tick(request = {}) {
      const asOfMs =
        typeof request.asOfMs === "number" && Number.isFinite(request.asOfMs)
          ? request.asOfMs
          : now();
      const due = await automationJobStore.listDueJobs({
        asOfMs,
        ...(typeof request.limit === "number" ? { limit: request.limit } : {}),
      });

      const items = Array.isArray(due.items) ? due.items : [];
      /** @type {Record<string, unknown>[]} */
      const runs = [];

      for (const job of items) {
        const runId = randomUUID();
        const limits =
          job && typeof job === "object" && job.limits && typeof job.limits === "object"
            ? job.limits
            : {};

        let profileId =
          typeof limits.profileId === "string" && limits.profileId.length > 0
            ? limits.profileId
            : "profile.default";

        if (typeof controlPlane.resolveProfile === "function") {
          try {
            const resolved = await controlPlane.resolveProfile({
              sessionId: job.sessionId,
              allowDefaultFallback: true,
              includeProfileConfig: false,
            });
            if (
              resolved &&
              typeof resolved === "object" &&
              resolved.status === "resolved" &&
              typeof resolved.profileId === "string" &&
              resolved.profileId.length > 0
            ) {
              profileId = resolved.profileId;
            }
          } catch {
            // Fall back to deterministic default profile id.
          }
        }

        try {
          const inbox =
            limits && typeof limits.inbox === "object" && limits.inbox !== null
              ? limits.inbox
              : undefined;
          const inboxEnabled = inbox !== undefined;
          let promptText = job.promptTemplate;
          /** @type {Record<string, unknown>|undefined} */
          let inboxMetadata;

          if (inboxEnabled && typeof controlPlane.proactiveInboxCheckHeaders === "function") {
            const capabilities = Array.isArray(inbox.capabilities)
              ? inbox.capabilities
              : ["mail.search_headers"];
            const mode = inbox.mode === "read_body" ? "read_body" : "headers_only";
            const headerCheck = await controlPlane.proactiveInboxCheckHeaders({
              sessionId: job.sessionId,
              userId: job.ownerUserId,
              ...(typeof inbox.connectorId === "string" ? { connectorId: inbox.connectorId } : {}),
              ...(typeof inbox.lookbackHours === "number"
                ? { lookbackHours: inbox.lookbackHours }
                : {}),
              capabilities,
              mode,
              metadata: {
                automationJobId: job.id,
                trigger: "schedule",
              },
            });
            const headers = Array.isArray(headerCheck.headers) ? headerCheck.headers : [];

            if (headerCheck.status === "blocked") {
              await runEventLinker.recordAutomationRun({
                automationId: job.id,
                runId,
                profileId,
                trigger: "schedule",
                output: {
                  status: "failed",
                  failure: {
                    code: "POLAR_AUTOMATION_INBOX_BLOCKED",
                    message:
                      typeof headerCheck.blockedReason === "string"
                        ? headerCheck.blockedReason
                        : "inbox_header_check_blocked",
                  },
                },
                metadata: {
                  sessionId: job.sessionId,
                  executionType: "automation",
                  source: "proactive_inbox",
                },
              });
              runs.push(Object.freeze({ jobId: job.id, runId, status: "failed" }));
              continue;
            }

            if (headerCheck.status === "degraded") {
              inboxMetadata = {
                status: "degraded",
                reason:
                  typeof headerCheck.degradedReason === "string"
                    ? headerCheck.degradedReason
                    : "connector_unavailable",
              };
            } else {
              inboxMetadata = {
                status: "completed",
                headerCount: headers.length,
              };
              if (headers.length > 0) {
                const summaryLines = headers
                  .slice(0, 5)
                  .map(
                    (header) =>
                      `- ${truncate(header.subject, 120)} (from: ${truncate(header.from, 80)})`,
                  );
                promptText =
                  `${job.promptTemplate}\n\n` +
                  `[INBOX HEADER CANDIDATES]\n` +
                  `${summaryLines.join("\n")}`;
              }

              if (mode === "read_body" && typeof controlPlane.proactiveInboxReadBody === "function") {
                const firstHeader = headers[0];
                if (firstHeader && typeof firstHeader.messageId === "string") {
                  const bodyRead = await controlPlane.proactiveInboxReadBody({
                    sessionId: job.sessionId,
                    userId: job.ownerUserId,
                    ...(typeof inbox.connectorId === "string"
                      ? { connectorId: inbox.connectorId }
                      : {}),
                    messageId: firstHeader.messageId,
                    capabilities,
                    metadata: {
                      automationJobId: job.id,
                      trigger: "schedule",
                    },
                  });

                  if (bodyRead.status === "blocked") {
                    await runEventLinker.recordAutomationRun({
                      automationId: job.id,
                      runId,
                      profileId,
                      trigger: "schedule",
                      output: {
                        status: "failed",
                        failure: {
                          code: "POLAR_AUTOMATION_INBOX_BODY_BLOCKED",
                          message:
                            typeof bodyRead.blockedReason === "string"
                              ? bodyRead.blockedReason
                              : "inbox_body_read_blocked",
                        },
                      },
                      metadata: {
                        sessionId: job.sessionId,
                        executionType: "automation",
                        source: "proactive_inbox",
                      },
                    });
                    runs.push(Object.freeze({ jobId: job.id, runId, status: "failed" }));
                    continue;
                  }
                }
              }
            }
          }

          const orchestrateResult = await controlPlane.orchestrate({
            sessionId: job.sessionId,
            userId: job.ownerUserId,
            text: promptText,
            messageId: `msg_auto_${job.id}_${runId}`,
            channel: "telegram",
            metadata: {
              executionType: "automation",
              automationJobId: job.id,
              trigger: "schedule",
              schedule: job.schedule,
            },
          });

          const summary = summarizeResult(orchestrateResult);
          const deliveryResult =
            deliverySink === undefined
              ? undefined
              : await deliverySink({
                  job,
                  runId,
                  orchestrateResult,
                });

          await runEventLinker.recordAutomationRun({
            automationId: job.id,
            runId,
            profileId,
            trigger: "schedule",
            output: {
              status: summary.status,
              assistantSummary: summary.summary,
              orchestrateStatus:
                typeof orchestrateResult?.status === "string"
                  ? orchestrateResult.status
                  : "error",
              ...(inboxMetadata !== undefined ? { proactiveInbox: inboxMetadata } : {}),
              ...(deliveryResult !== undefined ? { delivery: deliveryResult } : {}),
            },
            metadata: {
              sessionId: job.sessionId,
              executionType: "automation",
            },
          });

          runs.push(
            Object.freeze({
              jobId: job.id,
              runId,
              status: summary.status,
            }),
          );
        } catch (error) {
          await runEventLinker.recordAutomationRun({
            automationId: job.id,
            runId,
            profileId,
            trigger: "schedule",
            output: {
              status: "failed",
              failure: {
                code: "POLAR_AUTOMATION_RUNNER_ERROR",
                message: error instanceof Error ? error.message : String(error),
              },
            },
            metadata: {
              sessionId: job.sessionId,
              executionType: "automation",
            },
          });

          runs.push(
            Object.freeze({
              jobId: job.id,
              runId,
              status: "failed",
            }),
          );
        }
      }

      return Object.freeze({
        status: "ok",
        asOfMs,
        dueCount: items.length,
        runCount: runs.length,
        runs: Object.freeze(runs),
      });
    },
  });
}
