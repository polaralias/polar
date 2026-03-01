import { RuntimeExecutionError } from "@polar/domain";

/**
 * @param {unknown} message
 * @returns {string}
 */
function extractAssistantText(message) {
  if (typeof message !== "object" || message === null) {
    return "";
  }

  const content = /** @type {Record<string, unknown>} */ (message).content;
  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = [];
  for (const entry of content) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const block = /** @type {Record<string, unknown>} */ (entry);
    if (block.type !== "text" || typeof block.text !== "string") {
      continue;
    }

    textParts.push(block.text);
  }

  return textParts.join("").trim();
}

/**
 * @param {unknown} stream
 * @returns {boolean}
 */
function isAsyncIterable(stream) {
  return (
    typeof stream === "object" &&
    stream !== null &&
    Symbol.asyncIterator in stream
  );
}

/**
 * Creates a pi-mono provider adapter with Polar-compatible operations.
 * The pi-ai integration is lazy-loaded so test environments can inject mocks
 * without requiring pi-mono packages to be installed.
 *
 * @param {{
 *   providerId: string,
 *   modelRegistry: Record<string, unknown>,
 *   systemPrompt?: string,
 *   llmClient?: {
 *     completeSimple: (model: unknown, context: unknown, options?: unknown) => Promise<unknown>,
 *     streamSimple: (model: unknown, context: unknown, options?: unknown) => Promise<unknown>|unknown
 *   },
 *   embedder?: (input: { providerId: string, model: string, text: string }) => Promise<readonly number[]>
 * }} config
 */
export function createPiProviderAdapter(config) {
  if (!config || typeof config !== "object") {
    throw new RuntimeExecutionError("Provider adapter config must be an object");
  }

  const {
    providerId,
    modelRegistry,
    systemPrompt = "",
    llmClient,
    embedder,
  } = config;

  if (typeof providerId !== "string" || providerId.length === 0) {
    throw new RuntimeExecutionError("providerId must be a non-empty string");
  }

  if (typeof modelRegistry !== "object" || modelRegistry === null) {
    throw new RuntimeExecutionError("modelRegistry must be an object map");
  }

  /**
   * @returns {Promise<{
   *   completeSimple: (model: unknown, context: unknown, options?: unknown) => Promise<unknown>,
   *   streamSimple: (model: unknown, context: unknown, options?: unknown) => Promise<unknown>|unknown
   * }>}
   */
  async function resolveLlmClient() {
    if (llmClient) {
      return llmClient;
    }

    const piAiModule = await import("@mariozechner/pi-ai");
    return {
      completeSimple: piAiModule.completeSimple,
      streamSimple: piAiModule.streamSimple,
    };
  }

  /**
   * @param {string} requestedModel
   */
  function resolveModel(requestedModel) {
    const model = /** @type {Record<string, unknown>} */ (modelRegistry)[
      requestedModel
    ];
    if (!model) {
      throw new RuntimeExecutionError("Requested model is not configured", {
        providerId,
        model: requestedModel,
      });
    }

    return model;
  }

  /**
   * @param {{ providerId: string, model: string, prompt: string }} input
   */
  function validatePromptInput(input) {
    if (input.providerId !== providerId) {
      throw new RuntimeExecutionError("Provider id does not match adapter", {
        expected: providerId,
        received: input.providerId,
      });
    }
  }

  return Object.freeze({
    /**
     * @param {{ providerId: string, model: string, prompt: string }} input
     * @returns {Promise<Record<string, unknown>>}
     */
    async generate(input) {
      validatePromptInput(input);

      const model = resolveModel(input.model);
      const client = await resolveLlmClient();
      const message = await client.completeSimple(
        model,
        {
          systemPrompt,
          messages: [
            {
              role: "user",
              content: input.prompt,
              timestamp: Date.now(),
            },
          ],
        },
        {},
      );

      const text = extractAssistantText(message);
      if (text.length === 0) {
        throw new RuntimeExecutionError("pi-ai returned an empty assistant response", {
          providerId,
          model: input.model,
        });
      }

      return {
        providerId: input.providerId,
        model: input.model,
        text,
      };
    },

    /**
     * @param {{ providerId: string, model: string, prompt: string }} input
     * @returns {Promise<Record<string, unknown>>}
     */
    async stream(input) {
      validatePromptInput(input);

      const model = resolveModel(input.model);
      const client = await resolveLlmClient();
      const stream = await client.streamSimple(
        model,
        {
          systemPrompt,
          messages: [
            {
              role: "user",
              content: input.prompt,
              timestamp: Date.now(),
            },
          ],
        },
        {},
      );

      const chunks = [];
      if (isAsyncIterable(stream)) {
        for await (const event of stream) {
          if (
            typeof event === "object" &&
            event !== null &&
            /** @type {Record<string, unknown>} */ (event).type === "text_delta"
          ) {
            const delta = /** @type {Record<string, unknown>} */ (event).delta;
            if (typeof delta === "string" && delta.length > 0) {
              chunks.push(delta);
            }
          }
        }
      }

      if (chunks.length === 0 && stream && typeof stream.result === "function") {
        const message = await stream.result();
        const text = extractAssistantText(message);
        if (text.length > 0) {
          chunks.push(text);
        }
      }

      if (chunks.length === 0) {
        throw new RuntimeExecutionError("pi-ai stream returned no text chunks", {
          providerId,
          model: input.model,
        });
      }

      return {
        providerId: input.providerId,
        model: input.model,
        chunks,
      };
    },

    /**
     * @param {{ providerId: string, model: string, text: string }} input
     * @returns {Promise<Record<string, unknown>>}
     */
    async embed(input) {
      if (input.providerId !== providerId) {
        throw new RuntimeExecutionError("Provider id does not match adapter", {
          expected: providerId,
          received: input.providerId,
        });
      }

      if (typeof embedder !== "function") {
        throw new RuntimeExecutionError("Embedding is not configured for this pi adapter", {
          providerId,
        });
      }

      const vector = await embedder({
        providerId: input.providerId,
        model: input.model,
        text: input.text,
      });

      if (!Array.isArray(vector) || vector.length === 0) {
        throw new RuntimeExecutionError("Embedder returned an invalid vector", {
          providerId,
          model: input.model,
        });
      }

      return {
        providerId: input.providerId,
        model: input.model,
        vector: [...vector],
      };
    },
  });
}

/**
 * @typedef {(event: {
 *   phase: "before"|"after",
 *   toolCallId: string,
 *   toolName: string,
 *   args?: unknown,
 *   result?: unknown,
 *   isError?: boolean
 * }) => Promise<void>|void} ToolLifecycleHandler
 */

/**
 * @param {readonly (ToolLifecycleHandler|undefined)[]} handlers
 * @param {{
 *   phase: "before"|"after",
 *   toolCallId: string,
 *   toolName: string,
 *   args?: unknown,
 *   result?: unknown,
 *   isError?: boolean
 * }} event
 */
async function dispatchLifecycleEvent(handlers, event) {
  for (const handler of handlers) {
    if (!handler) {
      continue;
    }

    await handler(event);
  }
}

/**
 * @param {unknown} stream
 * @param {readonly (ToolLifecycleHandler|undefined)[]} lifecycleHandlers
 */
async function collectAgentEvents(stream, lifecycleHandlers) {
  const events = [];
  for await (const event of stream) {
    events.push(event);

    if (
      event &&
      typeof event === "object" &&
      event.type === "tool_execution_start"
    ) {
      await dispatchLifecycleEvent(lifecycleHandlers, {
        phase: "before",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      });
    }

    if (
      event &&
      typeof event === "object" &&
      event.type === "tool_execution_end"
    ) {
      await dispatchLifecycleEvent(lifecycleHandlers, {
        phase: "after",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      });
    }
  }

  const messages =
    stream && typeof stream.result === "function" ? await stream.result() : [];
  return {
    events: Object.freeze([...events]),
    messages: Object.freeze([...messages]),
  };
}

/**
 * Creates a pi-mono agent-loop adapter that exposes tool lifecycle hooks
 * for Polar middleware integration.
 *
 * @param {{
 *   agentRuntime?: {
 *     agentLoop: (...args: unknown[]) => AsyncIterable<unknown> & { result?: () => Promise<unknown[]> },
 *     agentLoopContinue: (...args: unknown[]) => AsyncIterable<unknown> & { result?: () => Promise<unknown[]> }
 *   },
 *   toolLifecycleHandler?: ToolLifecycleHandler
 * }} [config]
 */
export function createPiAgentTurnAdapter(config = {}) {
  const { agentRuntime, toolLifecycleHandler } = config;

  /**
   * @returns {Promise<{
   *   agentLoop: (...args: unknown[]) => AsyncIterable<unknown> & { result?: () => Promise<unknown[]> },
   *   agentLoopContinue: (...args: unknown[]) => AsyncIterable<unknown> & { result?: () => Promise<unknown[]> }
   * }>}
   */
  async function resolveRuntime() {
    if (agentRuntime) {
      return agentRuntime;
    }

    const piAgentModule = await import("@mariozechner/pi-agent-core");
    return {
      agentLoop: piAgentModule.agentLoop,
      agentLoopContinue: piAgentModule.agentLoopContinue,
    };
  }

  return Object.freeze({
    /**
     * @param {{
     *   prompts: unknown[],
     *   context: unknown,
     *   loopConfig: unknown,
     *   signal?: AbortSignal,
     *   onToolLifecycleEvent?: (event: {
     *     phase: "before"|"after",
     *     toolCallId: string,
     *     toolName: string,
     *     args?: unknown,
     *     result?: unknown,
     *     isError?: boolean
     *   }) => Promise<void>|void
     * }} request
     */
    async runTurn(request) {
      const runtime = await resolveRuntime();
      const stream = runtime.agentLoop(
        request.prompts,
        request.context,
        request.loopConfig,
        request.signal,
      );
      return collectAgentEvents(stream, [
        toolLifecycleHandler,
        request.onToolLifecycleEvent,
      ]);
    },

    /**
     * @param {{
     *   context: unknown,
     *   loopConfig: unknown,
     *   signal?: AbortSignal,
     *   onToolLifecycleEvent?: (event: {
     *     phase: "before"|"after",
     *     toolCallId: string,
     *     toolName: string,
     *     args?: unknown,
     *     result?: unknown,
     *     isError?: boolean
     *   }) => Promise<void>|void
     * }} request
     */
    async continueTurn(request) {
      const runtime = await resolveRuntime();
      const stream = runtime.agentLoopContinue(
        request.context,
        request.loopConfig,
        request.signal,
      );
      return collectAgentEvents(stream, [
        toolLifecycleHandler,
        request.onToolLifecycleEvent,
      ]);
    },
  });
}
