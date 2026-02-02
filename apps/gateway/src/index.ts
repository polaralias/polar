import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  AuditEvent,
  matchesResourceConstraint,
  verifyCapabilityToken,
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

function buildAuditEvent(
  subject: string,
  action: string,
  path: string,
  decision: 'allow' | 'deny',
  reason?: string,
  requestId?: string,
): AuditEvent {
  return {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject,
    action,
    tool: action,
    decision,
    reason,
    resource: {
      type: 'fs',
      path,
    },
    requestId,
    metadata: {
      source: 'gateway',
    },
  };
}

app.post('/tools/fs.readFile', async (request, reply) => {
  const body = request.body as { token?: string; path?: string };
  if (!body?.token || !body?.path) {
    return reply.status(401).send({ error: 'Token and path are required' });
  }

  const resolvedPath = resolveFsPath(body.path);
  let payload;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
  } catch (error) {
    await sendAudit(
      buildAuditEvent('unknown', 'fs.readFile', resolvedPath, 'deny', 'Invalid token'),
    );
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.readFile') {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', resolvedPath, 'deny', 'Action mismatch'),
    );
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', resolvedPath, 'deny', 'Path denied', payload.jti),
    );
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', resolvedPath, 'allow', undefined, payload.jti),
    );
    return { content };
  } catch (error) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', resolvedPath, 'allow', 'File read failed', payload.jti),
    );
    return reply.status(404).send({ error: (error as Error).message });
  }
});

app.post('/tools/fs.listDir', async (request, reply) => {
  const body = request.body as { token?: string; path?: string };
  if (!body?.token || !body?.path) {
    return reply.status(401).send({ error: 'Token and path are required' });
  }

  const resolvedPath = resolveFsPath(body.path);
  let payload;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
  } catch {
    await sendAudit(
      buildAuditEvent('unknown', 'fs.listDir', resolvedPath, 'deny', 'Invalid token'),
    );
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.listDir') {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', resolvedPath, 'deny', 'Action mismatch'),
    );
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', resolvedPath, 'deny', 'Path denied', payload.jti),
    );
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  try {
    const entries = await fs.readdir(resolvedPath);
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', resolvedPath, 'allow', undefined, payload.jti),
    );
    return { entries };
  } catch (error) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', resolvedPath, 'allow', 'List failed', payload.jti),
    );
    return reply.status(404).send({ error: (error as Error).message });
  }
});

app.post('/tools/fs.writeFile', async (request, reply) => {
  const body = request.body as { token?: string; path?: string; content?: string };
  if (!body?.token || !body?.path || typeof body?.content !== 'string') {
    return reply.status(401).send({ error: 'Token, path, and content are required' });
  }

  const resolvedPath = resolveFsPath(body.path);
  let payload;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
  } catch {
    await sendAudit(
      buildAuditEvent('unknown', 'fs.writeFile', resolvedPath, 'deny', 'Invalid token'),
    );
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.writeFile') {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', resolvedPath, 'deny', 'Action mismatch'),
    );
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', resolvedPath, 'deny', 'Path denied', payload.jti),
    );
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  try {
    await fs.writeFile(resolvedPath, body.content, 'utf-8');
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', resolvedPath, 'allow', undefined, payload.jti),
    );
    return { ok: true };
  } catch (error) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', resolvedPath, 'allow', 'Write failed', payload.jti),
    );
    return reply.status(500).send({ error: (error as Error).message });
  }
});

app.listen({ port: gatewayConfig.port, host: gatewayConfig.bindAddress }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
