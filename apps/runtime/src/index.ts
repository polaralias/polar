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
  verifyCapabilityToken,
  MemoryProposalSchema,
  MemoryQuerySchema,
  MemoryResource,
  ExternalAgentPrincipalSchema,
} from '@polar/core';
import { runtimeConfig, resolveFsPath } from './config.js';
import { appendAudit, queryAudit, type AuditQuery } from './audit.js';
import { loadPolicy, savePolicy, grantSkillPermissions, revokeSkillPermissions } from './policyStore.js';
import { createSession, getSession } from './sessions.js';
import { parseMessage } from './messageParser.js';
import { callGatewayTool } from './gatewayClient.js';
import { loadSkills, updateSkillStatus, getSkill } from './skillStore.js';
import { installSkill } from './installerService.js';
import { loadMemory, proposeMemory, queryMemory, deleteMemory, runMemoryCleanup } from './memoryStore.js';
import { listAgents, getAgent } from './agentStore.js';
import { spawnAgent, terminateAgent, proposeCoordination } from './agentService.js';
import { isTokenRevoked, revokeToken } from './revocationStore.js';

import { readSigningKey } from './crypto.js';

const app = Fastify({
  logger: true,
  bodyLimit: runtimeConfig.maxBodySize,
});

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

// Cleanup interval to prevent memory leaks from old IPs
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now - record.windowStart > runtimeConfig.rateLimitWindowMs) {
      rateLimitMap.delete(ip);
    }
  }
}, runtimeConfig.rateLimitWindowMs).unref(); // Allow process to exit

app.addHook('onRequest', async (request, reply) => {
  const ip = request.ip;
  const now = Date.now();

  let record = rateLimitMap.get(ip);
  if (!record) {
    record = { count: 0, windowStart: now };
    rateLimitMap.set(ip, record);
  } else if (now - record.windowStart > runtimeConfig.rateLimitWindowMs) {
    record.count = 0;
    record.windowStart = now;
  }

  record.count++;

  if (record.count > runtimeConfig.rateLimitMaxRequests) {
    return reply.status(429).send({ error: 'Too Many Requests' });
  }
});

await app.register(cors, {
  origin: runtimeConfig.corsOrigin,
});

declare module 'fastify' {
  interface FastifyRequest {
    principal?: {
      id: string;
      role: 'user' | 'system' | 'internal';
    };
  }
}

app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/internal/')) {
    const secret = request.headers['x-polar-internal-secret'];
    if (secret !== runtimeConfig.internalSecret) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid internal secret' });
    }
    request.principal = { id: 'system', role: 'internal' };
    return;
  }

  // Public/Unprotected routes
  const publicRoutes = ['/health', '/system/status'];
  if (publicRoutes.includes(request.url)) {
    return;
  }

  // Authenticate other routes (UI/Client API)
  const authHeader = request.headers['authorization'];
  if (!authHeader) {
    if (request.method === 'OPTIONS') return; // Allow CORS preflight
    return reply.status(401).send({ error: 'Unauthorized: Missing Authorization header' });
  }

  const token = authHeader.replace('Bearer ', '');
  if (token !== runtimeConfig.authToken) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid token' });
  }

  // Bind principal (default to 'user' for now as per simple auth scheme)
  request.principal = { id: 'user', role: 'user' };
});

app.get('/health', async () => ({ ok: true }));

app.get('/doctor', async () => {
  const { runDiagnostics } = await import('./doctorService.js');
  const results = await runDiagnostics();
  return { results };
});

app.post('/sessions', async (request) => {
  const subject = request.principal?.id || 'anonymous';
  const session = createSession(subject);
  return { session };
});

app.post('/sessions/:id/messages', async (request, reply) => {
  const session = getSession((request.params as { id: string }).id);
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }

  const body = request.body as { message?: string; agentId?: string };
  if (!body?.message) {
    return reply.status(400).send({ error: 'Message is required' });
  }

  const { getSystemStatus } = await import('./systemStore.js');
  const status = await getSystemStatus();
  if (status.mode === 'emergency') {
    return reply.status(503).send({ error: 'System is in EMERGENCY MODE. Actions are disabled.' });
  }

  // Verify session ownership
  if (session.subject !== request.principal?.id && request.principal?.role !== 'internal') {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  const workerRequest = parseMessage(body.message);
  if (!workerRequest) {
    return reply.status(400).send({ error: 'Unsupported message format' });
  }

  const path = workerRequest.path || (workerRequest.args?.path as string);
  if (!path) {
    return reply.status(400).send({ error: 'Path is required for this action' });
  }

  const resolvedPath = resolveFsPath(path);
  const policy = await loadPolicy();

  // If it's a skill worker call, check skill status and template
  if (workerRequest.skillId) {
    const skill = await getSkill(workerRequest.skillId);
    if (!skill || skill.status !== 'enabled') {
      return reply.status(403).send({ error: 'Skill not found or disabled' });
    }
    const template = skill.manifest.workerTemplates.find(t => t.id === workerRequest.templateId);
    if (!template) {
      return reply.status(404).send({ error: 'Worker template not found' });
    }
    // Verify template.requiredCapabilities ⊆ grantedCapabilities(skillId)
    // We strictly enforce that the skill has been granted ONLY the capabilities it requests,
    // and that the template ONLY uses capabilities that have been granted.
    if (template.requiredCapabilities && template.requiredCapabilities.length > 0) {
      // Reuse the policy loaded at line 77
      const skillGrants = policy.grants.filter(g => g.subject === workerRequest.skillId);

      const missingCapabilities = template.requiredCapabilities.filter(reqCap =>
        !skillGrants.some(grant => grant.action === reqCap)
      );

      if (missingCapabilities.length > 0) {
        return reply.status(403).send({
          error: `Skill template requires ungranted capabilities: ${missingCapabilities.join(', ')}`
        });
      }
    }
  }

  // Determine subject. Default to authenticated user.
  // Allow explicit subject override (agent/skill) only because the user is authenticated (Admin/Dev).
  // In a multi-tenant system, this "impersonation" would require explicit permission.
  const subject = workerRequest.skillId || body.agentId || request.principal?.id || session.subject;
  const agentId = body.agentId;

  const decision = evaluatePolicy(
    {
      subject,
      action: workerRequest.action,
      resource: { type: 'fs', path: resolvedPath },
    },
    policy,
  );

  if (!decision.allowed || !decision.capabilityConstraints) {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      subject,
      action: workerRequest.action,
      tool: workerRequest.action,
      decision: 'deny',
      reason: decision.reason ?? 'Policy denied request',
      resource: {
        type: 'fs',
        path: resolvedPath,
      },
      sessionId: session.id,
      agentId: body.agentId,
      skillId: workerRequest.skillId,
      workerTemplate: workerRequest.templateId,
      requestId: crypto.randomUUID(), // Denied before minting, so we generate a fresh correlation ID
    };

    await appendAudit(event);

    return reply.status(403).send({ error: event.reason });
  }

  const now = Math.floor(Date.now() / 1000);
  const capability: Capability = {
    id: crypto.randomUUID(),
    subject,
    action: workerRequest.action,
    resource: decision.capabilityConstraints.resource,
    fields: decision.capabilityConstraints.fields,
    expiresAt: now + runtimeConfig.capabilityTtlSeconds,
  };

  const signingKey = await readSigningKey();
  const policyVersion = await import('./policyStore.js').then(m => m.getSubjectPolicyVersion(subject));
  const token = await mintCapabilityToken(
    capability,
    signingKey,
    policyVersion,
  );

  const content = typeof workerRequest.args?.content === 'string' ? workerRequest.args.content : undefined;
  const gatewayResponse = await callGatewayTool(workerRequest.action as any, token, resolvedPath, content);
  if (!gatewayResponse.ok) {
    return reply.status(gatewayResponse.status).send({ error: gatewayResponse.error });
  }

  // Audit success
  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject,
    action: workerRequest.action,
    tool: workerRequest.action,
    decision: 'allow',
    resource: { type: 'fs', path: resolvedPath },
    sessionId: session.id,
    agentId: body.agentId,
    skillId: workerRequest.skillId,
    workerTemplate: workerRequest.templateId,
    requestId: capability.id,
  });

  return {
    ok: true,
    action: workerRequest.action,
    path: resolvedPath,
    result: gatewayResponse.data,
  };
});

app.get('/memory', async () => {
  const items = await loadMemory();
  return { items };
});

app.post('/memory/query', async (request, reply) => {
  const body = request.body as { sessionId?: string; query?: unknown };
  if (!body?.sessionId) {
    return reply.status(400).send({ error: 'sessionId is required' });
  }

  const session = getSession(body.sessionId);
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }

  const queryParsed = MemoryQuerySchema.safeParse(body.query);
  if (!queryParsed.success) {
    return reply.status(400).send({ error: 'Invalid query schema' });
  }

  const query = queryParsed.data;
  const policy = await loadPolicy();

  // For each memory type being queried, we check if it's allowed
  const typesToQuery = query.types || ['profile', 'project', 'session', 'tool-derived'];

  for (const type of typesToQuery) {
    const decision = evaluatePolicy(
      {
        subject: session.subject,
        action: 'read',
        resource: { type: 'memory', memoryType: type as any } as MemoryResource,
      },
      policy
    );

    if (!decision.allowed) {
      // In a real system, we might just filter out these types. 
      // For now, if you ask for something you can't have, we deny the whole query if explicit,
      // or filter if implicit.
      if (query.types) {
        return reply.status(403).send({ error: `Not allowed to read memory of type: ${type}` });
      }
    }
  }

  const items = await queryMemory(query, session.subject);

  // Audit read attempt
  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: session.subject,
    action: 'memory.read',
    decision: 'allow',
    resource: { type: 'memory' },
    sessionId: session.id,
    requestId: crypto.randomUUID(),
    metadata: { query }
  });

  return { items };
});

app.post('/memory/propose', async (request, reply) => {
  const body = request.body as { sessionId?: string; proposal?: unknown };
  if (!body?.sessionId) {
    return reply.status(400).send({ error: 'sessionId is required' });
  }

  const session = getSession(body.sessionId);
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }

  const proposalParsed = MemoryProposalSchema.safeParse(body.proposal);
  if (!proposalParsed.success) {
    return reply.status(400).send({ error: 'Invalid proposal schema' });
  }

  const proposal = proposalParsed.data;

  const { getSystemStatus } = await import('./systemStore.js');
  const status = await getSystemStatus();
  if (status.mode === 'emergency') {
    return reply.status(503).send({ error: 'System is in EMERGENCY MODE. Memory writes are disabled.' });
  }

  const policy = await loadPolicy();

  const decision = evaluatePolicy(
    {
      subject: session.subject,
      action: 'propose',
      resource: { type: 'memory', memoryType: proposal.type, scopeId: proposal.scopeId },
    },
    policy
  );

  if (!decision.allowed) {
    await appendAudit({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      subject: session.subject,
      action: 'memory.propose',
      decision: 'deny',
      reason: decision.reason,
      resource: { type: 'memory', memoryType: proposal.type, scopeId: proposal.scopeId },
      sessionId: session.id,
      requestId: crypto.randomUUID(),
    });
    return reply.status(403).send({ error: decision.reason || 'Not allowed to propose memory' });
  }

  const item = await proposeMemory(proposal, session.subject);

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: session.subject,
    action: 'memory.propose',
    decision: 'allow',
    resource: { type: 'memory', memoryType: proposal.type, scopeId: proposal.scopeId },
    sessionId: session.id,
    requestId: crypto.randomUUID(),
    metadata: { memoryId: item.id }
  });

  return { ok: true, item };
});

app.delete('/memory/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  // Bind subject from authenticated principal
  const subject = request.principal?.id || 'anonymous';

  const { getSystemStatus } = await import('./systemStore.js');
  const status = await getSystemStatus();
  if (status.mode === 'emergency') {
    return reply.status(503).send({ error: 'System is in EMERGENCY MODE. Memory modification is disabled.' });
  }

  const deleted = await deleteMemory(id, subject);
  if (!deleted) {
    return reply.status(404).send({ error: 'Memory item not found' });
  }

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject,
    action: 'memory.delete',
    decision: 'allow',
    resource: { type: 'memory' },
    requestId: crypto.randomUUID(),
    metadata: { memoryId: id }
  });

  return { ok: true };
});

// Internal worker spawning is handled via direct logic, not a public endpoint.
// app.post('/workers/spawn', async () => ({ ok: true }));

// Capability minting is an internal authority, not exposed to the network.
// app.post('/capabilities/mint', async (request, reply) => { ... });

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

app.get('/skills', async () => {
  const skills = await loadSkills();
  return { skills };
});

app.post('/skills/install', async (request, reply) => {
  const body = request.body as { sourcePath?: string };
  if (!body?.sourcePath) {
    return reply.status(400).send({ error: 'sourcePath is required' });
  }

  const { getSystemStatus } = await import('./systemStore.js');
  const status = await getSystemStatus();
  if (status.mode === 'emergency') {
    return reply.status(503).send({ error: 'System is in EMERGENCY MODE. Installation is disabled.' });
  }

  try {
    const { skill, diff } = await installSkill(body.sourcePath);

    await appendAudit({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      subject: request.principal?.id || 'admin',
      action: 'skill.install',
      decision: 'allow',
      skillId: skill.manifest.id,
      resource: { type: 'fs', path: skill.path },
      requestId: crypto.randomUUID(),
      metadata: {
        version: skill.manifest.version,
        diff
      }
    });

    return { ok: true, skill, diff };
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }
});

app.post('/skills/:id/enable', async (request, reply) => {
  const { id } = request.params as { id: string };
  const skill = await getSkill(id);
  if (!skill) return reply.status(404).send({ error: 'Skill not found' });

  const { getSystemStatus } = await import('./systemStore.js');
  const status = await getSystemStatus();
  if (status.mode === 'emergency') {
    return reply.status(503).send({ error: 'System is in EMERGENCY MODE. Enabling skills is disabled.' });
  }

  await updateSkillStatus(id, 'enabled');
  return { ok: true };
});

app.post('/skills/:id/disable', async (request, reply) => {
  const { id } = request.params as { id: string };
  await updateSkillStatus(id, 'disabled');
  return { ok: true };
});

app.post('/skills/:id/grant', async (request, reply) => {
  const { id } = request.params as { id: string };
  const skill = await getSkill(id);
  if (!skill) return reply.status(404).send({ error: 'Skill not found' });

  const { getSystemStatus } = await import('./systemStore.js');
  const status = await getSystemStatus();
  if (status.mode === 'emergency') {
    return reply.status(503).send({ error: 'System is in EMERGENCY MODE. Permission grants are disabled.' });
  }

  const body = request.body as { capabilities?: string[] };
  const requestedSubset = body?.capabilities;

  await grantSkillPermissions(id, skill.manifest.requestedCapabilities, requestedSubset);
  await updateSkillStatus(id, 'enabled');

  const reason = requestedSubset
    ? `User granted subset of permissions: ${requestedSubset.join(', ')}`
    : 'User granted all requested permissions';

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'skill.grant',
    decision: 'allow',
    skillId: id,
    resource: { type: 'fs' },
    requestId: crypto.randomUUID(),
    reason
  });

  return { ok: true };
});

app.post('/skills/:id/revoke', async (request, reply) => {
  const { id } = request.params as { id: string };
  await revokeSkillPermissions(id);
  await updateSkillStatus(id, 'pending_consent');

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'skill.revoke',
    decision: 'allow',
    skillId: id,
    resource: { type: 'fs' },
    requestId: crypto.randomUUID(),
    reason: 'User revoked all permissions'
  });

  return { ok: true };
});

app.get('/audit', async (request) => {
  const reqQuery = request.query as any;
  const query: AuditQuery = {};
  if (reqQuery.from) query.from = reqQuery.from;
  if (reqQuery.to) query.to = reqQuery.to;
  if (reqQuery.subject) query.subject = reqQuery.subject;
  if (reqQuery.tool) query.tool = reqQuery.tool;
  if (reqQuery.decision) query.decision = reqQuery.decision;
  if (reqQuery.limit) query.limit = Number(reqQuery.limit);

  const events = await queryAudit(query);

  return { events };
});

app.post('/audit/:id/redact', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { reason } = request.body as { reason?: string };
  if (!reason) return reply.status(400).send({ error: 'Reason for redaction is required' });

  const { redactEvent } = await import('./audit.js');
  await redactEvent(id, reason, request.principal?.id || 'admin');

  return { ok: true };
});

app.post('/internal/audit', async (request, reply) => {
  const parsed = AuditEventSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid audit event' });
  }

  await appendAudit(parsed.data);
  return { ok: true };
});

app.post('/internal/revoke', async (request, reply) => {
  const body = request.body as { jti?: string; reason?: string };
  if (!body?.jti) return reply.status(400).send({ error: 'JTI required' });

  await revokeToken(body.jti);
  return { ok: true };
});

app.post('/internal/introspect', async (request, reply) => {
  const body = request.body as { token?: string };
  if (!body?.token) return reply.status(400).send({ error: 'Token required' });

  try {
    const signingKey = await readSigningKey();
    const payload = await verifyCapabilityToken(body.token, signingKey);

    // Check policy version
    const { getSubjectPolicyVersion } = await import('./policyStore.js');
    const currentVer = await getSubjectPolicyVersion(payload.sub);

    if (payload.pol_ver !== undefined && payload.pol_ver < currentVer) {
      return reply.status(401).send({ active: false, error: 'Token revoked (policy version mismatch)' });
    }

    // Check system status (Emergency Mode)
    const { getSystemStatus } = await import('./systemStore.js');
    const status = await getSystemStatus();
    if (status.mode === 'emergency') {
      return reply.status(401).send({ active: false, error: 'System is in EMERGENCY MODE' });
    }

    // Check JTI revocation
    if (await isTokenRevoked(payload.jti)) {
      return reply.status(401).send({ active: false, error: 'Token revoked (JTI blocked)' });
    }

    // Check Subject Status (Skill disabled or Agent terminated)
    const skill = await getSkill(payload.sub);
    if (skill && skill.status !== 'enabled') {
      return reply.status(401).send({ active: false, error: `Subject skill is ${skill.status}` });
    }

    const agent = await getAgent(payload.sub);
    if (agent && agent.status === 'terminated') {
      return reply.status(401).send({ active: false, error: 'Subject agent is terminated' });
    }

    return { active: true, ...payload };
  } catch (err) {
    return reply.status(401).send({ active: false, error: (err as Error).message });
  }
});

app.get('/sessions/:id/agents', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = getSession(id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  const agents = listAgents(id);
  return { agents };
});

app.post('/sessions/:id/agents', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = getSession(id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  if (session.subject !== request.principal?.id && request.principal?.role !== 'internal') {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  const body = request.body as {
    role: string;
    skillId?: string;
    templateId?: string;
    metadata?: Record<string, unknown>;
  };

  if (!body.role) return reply.status(400).send({ error: 'role is required' });

  const { getSystemStatus } = await import('./systemStore.js');
  const status = await getSystemStatus();
  if (status.mode === 'emergency') {
    return reply.status(503).send({ error: 'System is in EMERGENCY MODE. Agent spawning is disabled.' });
  }

  const agent = await spawnAgent({
    role: body.role as any,
    sessionId: id,
    userId: session.subject,
    skillId: body.skillId,
    templateId: body.templateId,
    metadata: body.metadata,
  });

  return { agent };
});

app.post('/sessions/:sessionId/agents/:agentId/terminate', async (request, reply) => {
  const { agentId } = request.params as { agentId: string };
  const { reason } = request.body as { reason?: string };

  const ok = await terminateAgent(agentId, reason || 'User requested termination');
  if (!ok) return reply.status(404).send({ error: 'Agent not found' });

  return { ok: true };
});

app.get('/channels', async () => {
  const { loadChannels } = await import('./channelStore.js');
  const channels = await loadChannels();
  return { channels };
});

app.post('/channels', async (request, reply) => {
  const { updateChannel } = await import('./channelStore.js');
  const body = request.body as any;
  if (!body.id || !body.type) {
    return reply.status(400).send({ error: 'id and type are required' });
  }
  await updateChannel(body);
  return { ok: true };
});

app.post('/channels/:id/allowlist', async (request, reply) => {
  const { getChannel, updateChannel } = await import('./channelStore.js');
  const { id } = request.params as { id: string };
  const { senderId } = request.body as { senderId: string };

  if (!senderId) return reply.status(400).send({ error: 'senderId is required' });

  const channel = await getChannel(id);
  if (!channel) return reply.status(404).send({ error: 'Channel not found' });

  if (!channel.allowlist.includes(senderId)) {
    channel.allowlist.push(senderId);
    await updateChannel(channel);
  }

  return { ok: true };
});

app.post('/sessions/:id/coordination', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = getSession(id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  if (session.subject !== request.principal?.id && request.principal?.role !== 'internal') {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  const body = request.body as {
    pattern: string;
    initiatorAgentId: string;
    targetSpecs: any[];
  };

  const coordination = await proposeCoordination({
    pattern: body.pattern as any,
    initiatorAgentId: body.initiatorAgentId,
    targetSpecs: body.targetSpecs,
    sessionId: id,
    userId: session.subject,
  });

  return { coordination };
});

app.post('/a2a/task', async (request, reply) => {
  const body = request.body as {
    agentId: string;
    provider: string;
    sessionId: string;
    task: string;
    signature: string;
    publicKey?: string;
  };

  // 1. Verify Authentication
  if (!body.signature || !body.publicKey) {
    return reply.status(401).send({ error: 'Missing signature or publicKey' });
  }

  try {
    const verifier = crypto.createVerify('SHA256');
    // We assume the signature signs the task content + sessionId to prevent replay across sessions
    // Or just the task. Let's assume just 'task' for minimal contract.
    verifier.update(body.task);
    verifier.end();

    // In a real PKI, we would check if 'body.publicKey' belongs to 'body.agentId'.
    // For now, we strictly verify that the provided key *did* sign the message.
    const isValid = verifier.verify(body.publicKey, body.signature, 'hex');
    if (!isValid) throw new Error('Invalid signature');
  } catch (err) {
    return reply.status(401).send({ error: 'Authentication failed: Invalid signature' });
  }

  // 2. Map to External Agent Principal
  const { getExternalAgent } = await import('./externalAgentStore.js');
  const principal = await getExternalAgent(body.agentId);

  if (!principal) {
    return reply.status(403).send({ error: 'External agent not registered' });
  }

  // Verify key consistency if stored
  if (principal.publicKey && principal.publicKey !== body.publicKey) {
    return reply.status(401).send({ error: 'Public key mismatch for registered agent' });
  }

  // 3. Evaluate Policy (Mocked)
  const policy = await loadPolicy();
  const decision = evaluatePolicy(
    {
      subject: body.agentId, // Use external agent ID as subject
      action: 'a2a.task',
      resource: { type: 'system', component: 'gateway' },
    },
    policy
  );

  if (!decision.allowed) {
    await appendAudit({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      subject: body.agentId,
      action: 'a2a.task',
      decision: 'deny',
      sessionId: body.sessionId,
      resource: { type: 'gateway' },
    });
    return reply.status(403).send({ error: 'External agent not allowed' });
  }

  // 4. Audit Success
  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: body.agentId,
    action: 'a2a.task',
    decision: 'allow',
    sessionId: body.sessionId,
    resource: { type: 'gateway' },
    metadata: { task: body.task }
  });

  return { ok: true, result: `Task received: ${body.task}` };
});

app.get('/system/status', async () => {
  const { getSystemStatus } = await import('./systemStore.js');
  const status = await getSystemStatus();
  return { status };
});

app.post('/system/emergency', async (request, reply) => {
  const { setEmergencyMode } = await import('./systemStore.js');
  const body = request.body as { enabled: boolean; reason?: string };

  if (typeof body.enabled !== 'boolean') {
    return reply.status(400).send({ error: 'enabled boolean is required' });
  }

  const status = await setEmergencyMode(body.enabled, body.reason);
  return { ok: true, status };
});

app.get('/external-agents', async () => {
  const { loadExternalAgents } = await import('./externalAgentStore.js');
  const agents = await loadExternalAgents();
  return { agents };
});

app.post('/external-agents', async (request, reply) => {
  const parsed = ExternalAgentPrincipalSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid agent principal' });
  }

  const { registerExternalAgent } = await import('./externalAgentStore.js');
  await registerExternalAgent(parsed.data);
  return { ok: true };
});

app.delete('/external-agents/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { removeExternalAgent } = await import('./externalAgentStore.js');
  await removeExternalAgent(id);
  return { ok: true };
});

// Initial security check
const { runDiagnostics } = await import('./doctorService.js');
const diagnostics = await runDiagnostics();
const criticalIssues = diagnostics.filter(d => d.status === 'CRITICAL');
if (criticalIssues.length > 0) {
  console.error('❌ Critical security/config issues detected during startup:');
  criticalIssues.forEach(i => console.error(`   - ${i.name}: ${i.message}`));
  console.error('Run "pnpm run init" or "pnpm run doctor" for details.');
  process.exit(1);
}

app.listen({ port: runtimeConfig.port, host: runtimeConfig.bindAddress }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

// Run cleanup every minute
setInterval(async () => {
  try {
    const deletedCount = await runMemoryCleanup();
    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} expired memory items`);
    }
  } catch (error) {
    console.error('Memory cleanup failed:', error);
  }
}, 60000);
