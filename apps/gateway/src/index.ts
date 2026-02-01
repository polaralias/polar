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

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true }));

async function readSigningKey(): Promise<Uint8Array> {
  const key = await fs.readFile(gatewayConfig.signingKeyPath, 'utf-8');
  return new TextEncoder().encode(key.trim());
}

async function sendAudit(event: AuditEvent): Promise<void> {
  try {
    await fetch(`${gatewayConfig.runtimeUrl}/internal/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {
    // Ignore audit delivery failures for now.
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

app.listen({ port: gatewayConfig.port, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
