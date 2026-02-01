import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  AuditEvent,
  Capability,
  AuditEventSchema,
  evaluatePolicy,
  PolicyStoreSchema,
  mintCapabilityToken,
} from '@polar/core';
import { runtimeConfig, resolveFsPath } from './config.js';
import { appendAudit, queryAudit } from './audit.js';
import { loadPolicy, savePolicy } from './policyStore.js';
import { createSession, getSession } from './sessions.js';
import { parseMessage } from './messageParser.js';
import { callGatewayTool } from './gatewayClient.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

app.get('/health', async () => ({ ok: true }));

app.post('/sessions', async () => {
  const session = createSession();
  return { session };
});

app.post('/sessions/:id/messages', async (request, reply) => {
  const session = getSession((request.params as { id: string }).id);
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }

  const body = request.body as { message?: string };
  if (!body?.message) {
    return reply.status(400).send({ error: 'Message is required' });
  }

  const workerRequest = parseMessage(body.message);
  if (!workerRequest) {
    return reply.status(400).send({ error: 'Unsupported message format' });
  }

  const resolvedPath = resolveFsPath(workerRequest.path);
  const policy = await loadPolicy();
  const decision = evaluatePolicy(
    {
      subject: session.subject,
      action: workerRequest.action,
      resource: { type: 'fs', path: resolvedPath },
    },
    policy,
  );

  if (!decision.allowed || !decision.capabilityConstraints) {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      subject: session.subject,
      action: workerRequest.action,
      tool: workerRequest.action,
      decision: 'deny',
      reason: decision.reason ?? 'Policy denied request',
      resource: {
        type: 'fs',
        path: resolvedPath,
      },
      sessionId: session.id,
    };

    await appendAudit(event);

    return reply.status(403).send({ error: event.reason });
  }

  const now = Math.floor(Date.now() / 1000);
  const capability: Capability = {
    id: crypto.randomUUID(),
    subject: session.subject,
    action: workerRequest.action,
    resource: decision.capabilityConstraints.resource,
    fields: decision.capabilityConstraints.fields,
    expiresAt: now + runtimeConfig.capabilityTtlSeconds,
  };

  const signingKey = await fs.readFile(runtimeConfig.signingKeyPath, 'utf-8');
  const token = await mintCapabilityToken(
    capability,
    new TextEncoder().encode(signingKey.trim()),
  );

  const gatewayResponse = await callGatewayTool(workerRequest.action, token, resolvedPath);
  if (!gatewayResponse.ok) {
    return reply.status(gatewayResponse.status).send({ error: gatewayResponse.error });
  }

  return {
    ok: true,
    action: workerRequest.action,
    path: resolvedPath,
    result: gatewayResponse.data,
  };
});

app.post('/workers/spawn', async () => ({ ok: true }));

app.post('/capabilities/mint', async (request, reply) => {
  try {
    const body = request.body as Capability;
    const signingKey = await fs.readFile(runtimeConfig.signingKeyPath, 'utf-8');
    const token = await mintCapabilityToken(
      body,
      new TextEncoder().encode(signingKey.trim()),
    );
    return { token };
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }
});

app.get('/permissions', async () => {
  const policy = await loadPolicy();
  return { policy };
});

app.post('/permissions', async (request, reply) => {
  try {
    const body = request.body as { policy?: unknown };
    if (!body?.policy) {
      return reply.status(400).send({ error: 'Policy is required' });
    }

    const parsed = PolicyStoreSchema.safeParse(body.policy);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid policy schema' });
    }

    await savePolicy(parsed.data);
    return { ok: true };
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }
});

app.get('/audit', async (request) => {
  const query = request.query as {
    from?: string;
    to?: string;
    subject?: string;
    tool?: string;
    decision?: 'allow' | 'deny';
    limit?: string;
  };

  const events = await queryAudit({
    from: query.from,
    to: query.to,
    subject: query.subject,
    tool: query.tool,
    decision: query.decision,
    limit: query.limit ? Number(query.limit) : undefined,
  });

  return { events };
});

app.post('/internal/audit', async (request, reply) => {
  const parsed = AuditEventSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid audit event' });
  }

  await appendAudit(parsed.data);
  return { ok: true };
});

app.listen({ port: runtimeConfig.port, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
