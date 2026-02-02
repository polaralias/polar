import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  AuditEvent,
  matchesResourceConstraint,
  verifyCapabilityToken,
  HttpResource,
} from '@polar/core';
import { gatewayConfig, resolveFsPath } from './config.js';

const app = Fastify({
  logger: true,
  bodyLimit: gatewayConfig.maxBodySize,
});

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now - record.windowStart > gatewayConfig.rateLimitWindowMs) {
      rateLimitMap.delete(ip);
    }
  }
}, gatewayConfig.rateLimitWindowMs).unref();

app.addHook('onRequest', async (request, reply) => {
  const ip = request.ip;
  const now = Date.now();

  let record = rateLimitMap.get(ip);
  if (!record) {
    record = { count: 0, windowStart: now };
    rateLimitMap.set(ip, record);
  } else if (now - record.windowStart > gatewayConfig.rateLimitWindowMs) {
    record.count = 0;
    record.windowStart = now;
  }

  record.count++;

  if (record.count > gatewayConfig.rateLimitMaxRequests) {
    return reply.status(429).send({ error: 'Too Many Requests' });
  }
});

await app.register(cors, { origin: gatewayConfig.corsOrigin });

app.get('/health', async () => ({ ok: true }));

app.get('/doctor', async () => {
  const { runDiagnostics } = await import('./doctorService.js');
  const results = await runDiagnostics();
  return { results };
});

let cachedSigningKey: Uint8Array | null = null;
let lastKeyMtime: number = 0;

async function readSigningKey(): Promise<Uint8Array> {
  try {
    const stats = await fs.stat(gatewayConfig.signingKeyPath);
    if (cachedSigningKey && stats.mtimeMs === lastKeyMtime) {
      return cachedSigningKey;
    }
    const key = await fs.readFile(gatewayConfig.signingKeyPath, 'utf-8');
    cachedSigningKey = new TextEncoder().encode(key.trim());
    lastKeyMtime = stats.mtimeMs;
    return cachedSigningKey;
  } catch (error) {
    // If file doesn't exist yet or fails, return empty or throw.
    // Existing code would have thrown on readFile.
    throw error;
  }
}

async function sendAudit(event: AuditEvent): Promise<void> {
  const response = await fetch(`${gatewayConfig.runtimeUrl}/internal/audit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-polar-internal-secret': gatewayConfig.internalSecret,
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Audit delivery failed with status ${response.status}`);
  }
}

async function introspectToken(token: string): Promise<{ active: boolean; error?: string }> {
  try {
    const response = await fetch(`${gatewayConfig.runtimeUrl}/internal/introspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-polar-internal-secret': gatewayConfig.internalSecret,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      return { active: false, error: errorData.error || `Introspection failed with status ${response.status}` };
    }

    const data = await response.json() as { active: boolean; error?: string };
    return data;
  } catch (error) {
    return { active: false, error: `Introspection unreachable: ${(error as Error).message}` };
  }
}

function buildAuditEvent(
  subject: string,
  action: string,
  resource: { type: string; path?: string | undefined; url?: string | undefined; method?: string | undefined },
  decision: 'allow' | 'deny',
  reason?: string,
  requestId?: string,
  messageId?: string,
  parentEventId?: string,
): AuditEvent {
  return {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject,
    action,
    tool: action,
    decision,
    reason,
    resource,
    requestId,
    messageId,
    parentEventId,
    metadata: {
      source: 'gateway',
    },
  };
}

app.post('/tools/fs.readFile', async (request, reply) => {
  const body = request.body as { token?: string; path?: string; messageId?: string; parentEventId?: string };
  if (!body?.token || !body?.path) {
    return reply.status(401).send({ error: 'Token and path are required' });
  }

  const resolvedPath = resolveFsPath(body.path);
  let payload;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());

    // Immediate revocation & Emergency mode check via Runtime Introspection
    const intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(
        buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId),
      );
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch (error) {
    await sendAudit(
      buildAuditEvent('unknown', 'fs.readFile', { type: 'fs', path: resolvedPath }, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.readFile') {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'deny', 'Action mismatch', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'deny', 'Path denied', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'allow', undefined, payload.jti, body.messageId, body.parentEventId),
    );
    return { content };
  } catch (error) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'allow', 'File read failed', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(404).send({ error: (error as Error).message });
  }
});

app.post('/tools/fs.listDir', async (request, reply) => {
  const body = request.body as { token?: string; path?: string; messageId?: string; parentEventId?: string };
  if (!body?.token || !body?.path) {
    return reply.status(401).send({ error: 'Token and path are required' });
  }

  const resolvedPath = resolveFsPath(body.path);
  let payload;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());

    // Immediate revocation & Emergency mode check via Runtime Introspection
    const intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(
        buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId),
      );
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch {
    await sendAudit(
      buildAuditEvent('unknown', 'fs.listDir', { type: 'fs', path: resolvedPath }, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.listDir') {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'deny', 'Action mismatch', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'deny', 'Path denied', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  try {
    const entries = await fs.readdir(resolvedPath);
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'allow', undefined, payload.jti, body.messageId, body.parentEventId),
    );
    return { entries };
  } catch (error) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'allow', 'List failed', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(404).send({ error: (error as Error).message });
  }
});

app.post('/tools/fs.writeFile', async (request, reply) => {
  const body = request.body as { token?: string; path?: string; content?: string; messageId?: string; parentEventId?: string };
  if (!body?.token || !body?.path || typeof body?.content !== 'string') {
    return reply.status(401).send({ error: 'Token, path, and content are required' });
  }

  const resolvedPath = resolveFsPath(body.path);
  let payload;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());

    // Immediate revocation & Emergency mode check via Runtime Introspection
    const intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(
        buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId),
      );
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch {
    await sendAudit(
      buildAuditEvent('unknown', 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.writeFile') {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'deny', 'Action mismatch', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'deny', 'Path denied', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  try {
    await fs.writeFile(resolvedPath, body.content, 'utf-8');
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'allow', undefined, payload.jti, body.messageId, body.parentEventId),
    );
    return { ok: true };
  } catch (error) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'allow', 'Write failed', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(500).send({ error: (error as Error).message });
  }
});

app.post('/tools/memory.query', async (request, reply) => {
  const body = request.body as { token?: string; query?: any; messageId?: string; parentEventId?: string };
  if (!body?.token || !body?.query) {
    return reply.status(401).send({ error: 'Token and query are required' });
  }

  const resource = { type: 'memory', ...body.query };

  let payload;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
    const intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch {
    await sendAudit(buildAuditEvent('unknown', 'memory.query', resource, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId));
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'memory.query') {
    await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', 'Action mismatch', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  // Enforcement: Scoping (Project context isolation)
  if (payload.res.type === 'memory' && payload.res.scopeIds) {
    const requestedScopes = body.query.scopeIds || [];
    if (requestedScopes.length === 0 || !requestedScopes.every((s: string) => (payload.res as any).scopeIds.includes(s))) {
      await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', 'Scope violation', payload.jti, body.messageId, body.parentEventId));
      return reply.status(403).send({ error: 'Unauthorized memory scope access' });
    }
  }

  try {
    const response = await fetch(`${gatewayConfig.runtimeUrl}/memory/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-polar-internal-secret': gatewayConfig.internalSecret,
      },
      body: JSON.stringify({
        subject: payload.sub,
        query: body.query
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', `Runtime error: ${errText}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(response.status).send({ error: `Runtime query failed: ${errText}` });
    }

    const data = await response.json();
    await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
    return data;
  } catch (error) {
    await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', `Runtime unreachable: ${(error as Error).message}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(502).send({ error: `Runtime unreachable: ${(error as Error).message}` });
  }
});

app.post('/tools/http.request', async (request, reply) => {
  const body = request.body as {
    token?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    messageId?: string;
    parentEventId?: string;
  };

  if (!body?.token || !body?.url) {
    return reply.status(401).send({ error: 'Token and URL are required' });
  }

  const method = body.method || 'GET';
  const resource: HttpResource = { type: 'http', url: body.url, method };

  let payload;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
    const intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch (err) {
    await sendAudit(buildAuditEvent('unknown', 'http.request', resource, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId));
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'http.request') {
    await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'deny', 'Action mismatch', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, resource);
  if (!allowed) {
    await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'deny', 'URL not in allowlist', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: `Egress to ${body.url} is not permitted by your capability.` });
  }

  try {
    const response = await fetch(body.url, {
      method,
      ...(body.headers ? { headers: body.headers } : {}),
      ...(body.body ? { body: JSON.stringify(body.body) } : {})
    });

    const status = response.status;
    const data = await response.text();

    await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
    return { status, data };
  } catch (err) {
    await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'allow', `Fetch failed: ${(err as Error).message}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(502).send({ error: `Request failed: ${(err as Error).message}` });
  }
});

// Startup Safety Check
async function startupCheck(): Promise<void> {
  const { runDiagnostics } = await import('./doctorService.js');
  const results = await runDiagnostics();
  const criticalIssues = results.filter(r => r.status === 'CRITICAL');

  if (criticalIssues.length > 0) {
    console.error('\n=== GATEWAY STARTUP BLOCKED ===');
    console.error('Critical issues detected:');
    for (const issue of criticalIssues) {
      console.error(`  [${issue.id}] ${issue.message}`);
      if (issue.remediation) {
        console.error(`    Fix: ${issue.remediation}`);
      }
    }
    console.error('Resolve these issues before starting the gateway.\n');
    process.exit(1);
  }
}

await startupCheck();

app.listen({ port: gatewayConfig.port, host: gatewayConfig.bindAddress }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
