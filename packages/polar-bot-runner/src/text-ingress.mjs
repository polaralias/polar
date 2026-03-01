/**
 * @param {{
 *   ctx: unknown,
 *   commandRouter: { handle: (ctx: unknown) => Promise<{ handled: boolean }> },
 *   handleMessageDebounced: (ctx: unknown) => Promise<void>,
 *   buildTopicReplyOptions: (message: unknown) => Record<string, unknown>,
 *   logger?: { error?: (...args: unknown[]) => void }
 * }} request
 */
export async function handleTextMessageIngress({
  ctx,
  commandRouter,
  handleMessageDebounced,
  buildTopicReplyOptions,
  logger = console,
}) {
  try {
    const result = await commandRouter.handle(ctx);
    if (result?.handled) {
      return { handled: true, route: "command" };
    }
  } catch (error) {
    logger.error?.("[COMMAND_ROUTER_ERROR]", error);
    await ctx.reply(
      `❌ Command failed: ${error.message}`,
      buildTopicReplyOptions(ctx.message),
    );
    return { handled: true, route: "command_error" };
  }
  await handleMessageDebounced(ctx);
  return { handled: false, route: "debounced" };
}

