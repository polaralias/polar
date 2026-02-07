type TokenTraceContext = {
  jti: string;
  sessionId?: string;
  agentId?: string;
  traceId?: string;
  parentEventId?: string;
  createdAt: number;
};

const MAX_CONTEXTS = 20_000;
const CONTEXT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const contexts = new Map<string, TokenTraceContext>();

function pruneExpired(now = Date.now()): void {
  for (const [jti, context] of contexts.entries()) {
    if (now - context.createdAt > CONTEXT_TTL_MS) {
      contexts.delete(jti);
    }
  }
}

function pruneOverflow(): void {
  if (contexts.size <= MAX_CONTEXTS) return;

  const ordered = Array.from(contexts.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
  const overflow = contexts.size - MAX_CONTEXTS;
  for (let index = 0; index < overflow; index++) {
    const victim = ordered[index];
    if (victim) {
      contexts.delete(victim[0]);
    }
  }
}

export function registerTokenTraceContext(context: Omit<TokenTraceContext, 'createdAt'>): void {
  pruneExpired();
  contexts.set(context.jti, {
    ...context,
    createdAt: Date.now(),
  });
  pruneOverflow();
}

export function getTokenTraceContext(jti: string): Omit<TokenTraceContext, 'createdAt'> | undefined {
  const context = contexts.get(jti);
  if (!context) return undefined;

  if (Date.now() - context.createdAt > CONTEXT_TTL_MS) {
    contexts.delete(jti);
    return undefined;
  }

  const { createdAt: _createdAt, ...snapshot } = context;
  return snapshot;
}
