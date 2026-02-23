import {
  EXECUTION_TYPES,
  MiddlewareExecutionError,
  PolarTypedError,
  RuntimeExecutionError,
  parseExecutionType,
  validateSchemaOrThrow,
} from "../../polar-domain/src/index.mjs";

const executionTypes = new Set(EXECUTION_TYPES);

/**
 * @typedef {"tool"|"handoff"|"automation"|"heartbeat"} ExecutionType
 */

/**
 * @typedef {Object} MiddlewareContext
 * @property {ExecutionType} executionType
 * @property {string} actionId
 * @property {number} version
 * @property {string} traceId
 * @property {Record<string, unknown>} input
 * @property {Record<string, unknown>|undefined} output
 * @property {PolarTypedError|undefined} error
 */

/**
 * @typedef {Object} RuntimeMiddleware
 * @property {string} id
 * @property {readonly ExecutionType[]} [appliesTo]
 * @property {(context: MiddlewareContext) => Promise<Partial<MiddlewareContext>|void>|Partial<MiddlewareContext>|void} [before]
 * @property {(context: MiddlewareContext) => Promise<Partial<MiddlewareContext>|void>|Partial<MiddlewareContext>|void} [after]
 */

/**
 * @typedef {Object} AuditEventEnvelope
 * @property {string} auditId
 * @property {string} timestamp
 * @property {string} traceId
 * @property {ExecutionType} executionType
 * @property {string} actionId
 * @property {number} version
 * @property {"before"|"execution"|"after"} stage
 * @property {string} checkpoint
 * @property {"ok"|"error"} outcome
 * @property {string} riskClass
 * @property {string} trustClass
 * @property {string|null} middlewareId
 * @property {{ code: string, message: string }|undefined} [error]
 */

/**
 * @param {ExecutionType} executionType
 * @returns {string}
 */
function generateTraceId(executionType) {
  return `trace-${executionType}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * @param {unknown} error
 * @param {"before"|"execution"|"after"} stage
 * @param {string} actionId
 * @param {number} version
 * @param {ExecutionType} executionType
 * @returns {PolarTypedError}
 */
function normalizeError(error, stage, actionId, version, executionType) {
  if (error instanceof PolarTypedError) {
    return error;
  }

  if (stage === "execution") {
    return new RuntimeExecutionError(
      `Action execution failed for ${executionType}:${actionId}@${version}`,
      {
        executionType,
        actionId,
        version,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return new MiddlewareExecutionError(
    `Middleware ${stage} stage failed for ${executionType}:${actionId}@${version}`,
    {
      executionType,
      actionId,
      version,
      stage,
      cause: error instanceof Error ? error.message : String(error),
    },
  );
}

/**
 * @param {RuntimeMiddleware[]} middleware
 * @param {string} scope
 */
function validateMiddleware(middleware, scope) {
  for (const entry of middleware) {
    if (typeof entry !== "object" || entry === null) {
      throw new MiddlewareExecutionError("Middleware entry must be an object", {
        scope,
      });
    }

    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new MiddlewareExecutionError(
        "Middleware entry id must be a non-empty string",
        { scope },
      );
    }

    if (entry.appliesTo !== undefined) {
      if (!Array.isArray(entry.appliesTo) || entry.appliesTo.length === 0) {
        throw new MiddlewareExecutionError(
          `Middleware "${entry.id}" appliesTo must be a non-empty execution type array when provided`,
          { scope },
        );
      }

      for (const executionType of entry.appliesTo) {
        if (!executionTypes.has(executionType)) {
          throw new MiddlewareExecutionError(
            `Middleware "${entry.id}" has unknown execution type "${executionType}"`,
            { scope, executionType },
          );
        }
      }
    }

    if (entry.before !== undefined && typeof entry.before !== "function") {
      throw new MiddlewareExecutionError(
        `Middleware "${entry.id}" before must be a function when provided`,
        { scope },
      );
    }

    if (entry.after !== undefined && typeof entry.after !== "function") {
      throw new MiddlewareExecutionError(
        `Middleware "${entry.id}" after must be a function when provided`,
        { scope },
      );
    }
  }
}

/**
 * @param {MiddlewareContext} context
 * @param {Partial<MiddlewareContext>|void} nextValue
 * @param {{ stage: "before"|"after", middlewareId: string }} patchContext
 * @returns {MiddlewareContext}
 */
function applyContextPatch(context, nextValue, patchContext) {
  if (!nextValue) {
    return context;
  }

  if (typeof nextValue !== "object" || nextValue === null) {
    throw new MiddlewareExecutionError("Middleware patch must be an object", {
      stage: patchContext.stage,
      middlewareId: patchContext.middlewareId,
    });
  }

  const nextContext = { ...context };

  if (Object.prototype.hasOwnProperty.call(nextValue, "input")) {
    nextContext.input = /** @type {Record<string, unknown>} */ (nextValue.input);
  }

  if (Object.prototype.hasOwnProperty.call(nextValue, "output")) {
    nextContext.output = /** @type {Record<string, unknown>|undefined} */ (
      nextValue.output
    );
  }

  if (Object.prototype.hasOwnProperty.call(nextValue, "error")) {
    const nextError = /** @type {unknown} */ (nextValue.error);

    if (nextError === undefined) {
      if (context.error !== undefined) {
        throw new MiddlewareExecutionError(
          "Middleware patch cannot clear an existing error",
          {
            stage: patchContext.stage,
            middlewareId: patchContext.middlewareId,
            existingErrorCode: context.error.code,
          },
        );
      }

      nextContext.error = undefined;
      return nextContext;
    }

    if (!(nextError instanceof PolarTypedError)) {
      throw new MiddlewareExecutionError(
        "Middleware patch error must be a PolarTypedError",
        {
          stage: patchContext.stage,
          middlewareId: patchContext.middlewareId,
        },
      );
    }

    if (context.error !== undefined) {
      throw new MiddlewareExecutionError(
        "Middleware patch cannot override an existing error",
        {
          stage: patchContext.stage,
          middlewareId: patchContext.middlewareId,
          existingErrorCode: context.error.code,
          attemptedErrorCode: nextError.code,
        },
      );
    }

    nextContext.error = nextError;
  }

  return nextContext;
}

/**
 * @param {unknown} error
 * @returns {{ code: string, message: string }}
 */
function toAuditError(error) {
  if (error instanceof PolarTypedError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return {
    code: "POLAR_UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * @param {RuntimeMiddleware[]} middleware
 * @param {ExecutionType} executionType
 * @returns {RuntimeMiddleware[]}
 */
function filterMiddlewareByExecutionType(middleware, executionType) {
  return middleware.filter((entry) => {
    if (!entry.appliesTo) {
      return true;
    }

    return entry.appliesTo.includes(executionType);
  });
}

/**
 * @param {{
 *   contractRegistry: ReturnType<import("./contract-registry.mjs").createContractRegistry>,
 *   middleware?: RuntimeMiddleware[],
 *   middlewareByExecutionType?: Partial<Record<ExecutionType, RuntimeMiddleware[]>>,
 *   auditSink?: (event: AuditEventEnvelope) => Promise<void>|void
 * }} config
 */
export function createMiddlewarePipeline({
  contractRegistry,
  middleware = [],
  middlewareByExecutionType = {},
  auditSink = () => {},
}) {
  if (typeof auditSink !== "function") {
    throw new MiddlewareExecutionError("auditSink must be a function");
  }

  validateMiddleware(middleware, "global");
  for (const [key, scopedMiddleware] of Object.entries(middlewareByExecutionType)) {
    if (!executionTypes.has(key)) {
      throw new MiddlewareExecutionError(`Unknown middleware execution type bucket "${key}"`, {
        executionType: key,
      });
    }

    validateMiddleware(
      scopedMiddleware ?? [],
      `executionType:${key}`,
    );
  }

  return Object.freeze({
    /**
     * @param {{ executionType: unknown, actionId: string, version: number, input: unknown, traceId?: string }} request
     * @param {(validatedInput: Record<string, unknown>) => Promise<unknown>} execute
     * @returns {Promise<Record<string, unknown>>}
     */
    async run(request, execute) {
      if (typeof execute !== "function") {
        throw new MiddlewareExecutionError("execute must be a function");
      }

      const executionType = parseExecutionType(request.executionType);
      const mergedMiddleware = [
        ...middleware,
        ...(middlewareByExecutionType[executionType] ?? []),
      ];
      const selectedMiddleware = filterMiddlewareByExecutionType(
        mergedMiddleware,
        executionType,
      );

      let context = /** @type {MiddlewareContext} */ ({
        executionType,
        actionId: request.actionId,
        version: request.version,
        traceId: request.traceId ?? generateTraceId(executionType),
        input: /** @type {Record<string, unknown>} */ (request.input),
        output: undefined,
        error: undefined,
      });

      let contract;
      let auditIndex = 0;

      /**
       * @param {{
       *   checkpoint: string,
       *   stage: "before"|"execution"|"after",
       *   outcome: "ok"|"error",
       *   middlewareId?: string,
       *   error?: unknown
       * }} params
       */
      const emitAudit = async (params) => {
        auditIndex += 1;

        const auditEvent = /** @type {AuditEventEnvelope} */ ({
          auditId: `${context.traceId}-${String(auditIndex).padStart(4, "0")}`,
          timestamp: new Date().toISOString(),
          traceId: context.traceId,
          executionType: context.executionType,
          actionId: context.actionId,
          version: context.version,
          stage: params.stage,
          checkpoint: params.checkpoint,
          outcome: params.outcome,
          riskClass: contract ? contract.riskClass : "unknown",
          trustClass: contract ? contract.trustClass : "unknown",
          middlewareId: params.middlewareId ?? null,
          error:
            params.error === undefined ? undefined : toAuditError(params.error),
        });

        try {
          await auditSink(Object.freeze(auditEvent));
        } catch (error) {
          throw new MiddlewareExecutionError("Audit sink rejected event", {
            traceId: context.traceId,
            executionType: context.executionType,
            actionId: context.actionId,
            version: context.version,
            checkpoint: params.checkpoint,
            cause: error instanceof Error ? error.message : String(error),
          });
        }
      };

      const finalize = async () => {
        await emitAudit({
          checkpoint: "run.completed",
          stage: "after",
          outcome: context.error ? "error" : "ok",
          error: context.error,
        });
      };

      await emitAudit({
        checkpoint: "run.received",
        stage: "before",
        outcome: "ok",
      });

      try {
        contract = contractRegistry.get(request.actionId, request.version);
        await emitAudit({
          checkpoint: "contract.resolved",
          stage: "before",
          outcome: "ok",
        });
      } catch (error) {
        context.error = normalizeError(
          error,
          "before",
          request.actionId,
          request.version,
          executionType,
        );

        await emitAudit({
          checkpoint: "contract.resolve_failed",
          stage: "before",
          outcome: "error",
          error: context.error,
        });

        await finalize();
        throw context.error;
      }

      try {
        context.input = validateSchemaOrThrow(
          contract.inputSchema,
          request.input,
          "input",
          request.actionId,
          request.version,
        );
        await emitAudit({
          checkpoint: "contract.input.validated",
          stage: "before",
          outcome: "ok",
        });
      } catch (error) {
        context.error = normalizeError(
          error,
          "before",
          request.actionId,
          request.version,
          executionType,
        );
        await emitAudit({
          checkpoint: "contract.input.validation_failed",
          stage: "before",
          outcome: "error",
          error: context.error,
        });
      }

      if (!context.error) {
        for (const entry of selectedMiddleware) {
          if (!entry.before) {
            continue;
          }

          try {
            const patch = await entry.before(context);
            context = applyContextPatch(context, patch, {
              stage: "before",
              middlewareId: entry.id,
            });
            await emitAudit({
              checkpoint: "middleware.before",
              stage: "before",
              outcome: "ok",
              middlewareId: entry.id,
            });
          } catch (error) {
            context.error = normalizeError(
              error,
              "before",
              request.actionId,
              request.version,
              executionType,
            );
            await emitAudit({
              checkpoint: "middleware.before",
              stage: "before",
              outcome: "error",
              middlewareId: entry.id,
              error: context.error,
            });
            break;
          }
        }
      }

      if (!context.error) {
        try {
          context.input = validateSchemaOrThrow(
            contract.inputSchema,
            context.input,
            "input",
            request.actionId,
            request.version,
          );
          await emitAudit({
            checkpoint: "contract.input.revalidated",
            stage: "before",
            outcome: "ok",
          });
        } catch (error) {
          context.error = normalizeError(
            error,
            "before",
            request.actionId,
            request.version,
            executionType,
          );
          await emitAudit({
            checkpoint: "contract.input.revalidation_failed",
            stage: "before",
            outcome: "error",
            error: context.error,
          });
        }
      }

      if (!context.error) {
        try {
          const rawOutput = await execute(context.input);
          context.output = validateSchemaOrThrow(
            contract.outputSchema,
            rawOutput,
            "output",
            request.actionId,
            request.version,
          );
          await emitAudit({
            checkpoint: "execution.completed",
            stage: "execution",
            outcome: "ok",
          });
        } catch (error) {
          context.error = normalizeError(
            error,
            "execution",
            request.actionId,
            request.version,
            executionType,
          );
          await emitAudit({
            checkpoint: "execution.failed",
            stage: "execution",
            outcome: "error",
            error: context.error,
          });
        }
      }

      const reverseMiddleware = [...selectedMiddleware].reverse();
      for (const entry of reverseMiddleware) {
        if (!entry.after) {
          continue;
        }

        try {
          const patch = await entry.after(context);
          context = applyContextPatch(context, patch, {
            stage: "after",
            middlewareId: entry.id,
          });
          await emitAudit({
            checkpoint: "middleware.after",
            stage: "after",
            outcome: "ok",
            middlewareId: entry.id,
          });
        } catch (error) {
          const normalizedError = normalizeError(
            error,
            "after",
            request.actionId,
            request.version,
            executionType,
          );

          if (!context.error) {
            context.error = normalizedError;
          }

          await emitAudit({
            checkpoint: "middleware.after",
            stage: "after",
            outcome: "error",
            middlewareId: entry.id,
            error: normalizedError,
          });
        }
      }

      if (!context.error && context.output !== undefined) {
        try {
          context.output = validateSchemaOrThrow(
            contract.outputSchema,
            context.output,
            "output",
            request.actionId,
            request.version,
          );
          await emitAudit({
            checkpoint: "contract.output.validated",
            stage: "after",
            outcome: "ok",
          });
        } catch (error) {
          context.error = normalizeError(
            error,
            "after",
            request.actionId,
            request.version,
            executionType,
          );
          await emitAudit({
            checkpoint: "contract.output.validation_failed",
            stage: "after",
            outcome: "error",
            error: context.error,
          });
        }
      }

      if (!context.error && !context.output) {
        context.error = new RuntimeExecutionError(
          `Action returned no output for ${executionType}:${request.actionId}@${request.version}`,
          {
            executionType,
            actionId: request.actionId,
            version: request.version,
          },
        );
      }

      await finalize();

      if (context.error) {
        throw context.error;
      }

      return context.output;
    },
  });
}
