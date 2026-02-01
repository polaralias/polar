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
  MemoryProposalSchema,
  MemoryQuerySchema,
  MemoryResource,
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

import { readSigningKey } from './crypto.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

app.get('/health', async () => ({ ok: true }));

app.get('/doctor', async () => {
  const { runDiagnostics } = await import('./doctorService.js');
  const results = await runDiagnostics();
  return { results };
});

app.post('/sessions', async () => {
  const session = createSession();
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
    // TODO: Verify template.requiredCapabilities ⊆ granted caps
    // For now, continue with policy evaluation based on subject = skillId
  }

  const subject = workerRequest.skillId || body.agentId || session.subject;
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
  const token = await mintCapabilityToken(
    capability,
    signingKey,
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
    metadata: { memoryId: item.id }
  });

  return { ok: true, item };
});

app.delete('/memory/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  // Traditionally, delete is a user action. We'll assume 'user' subject for now.
  // In a real system, we'd get the subject from the auth header.
  const subject = 'user';

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
      subject: 'admin',
      action: 'skill.install',
      decision: 'allow',
      skillId: skill.manifest.id,
      resource: { type: 'fs', path: skill.path },
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

  await grantSkillPermissions(id, skill.manifest.requestedCapabilities);
  await updateSkillStatus(id, 'enabled');

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: 'user',
    action: 'skill.grant',
    decision: 'allow',
    skillId: id,
    resource: { type: 'fs' },
    reason: 'User granted requested permissions'
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
    subject: 'user',
    action: 'skill.revoke',
    decision: 'allow',
    skillId: id,
    resource: { type: 'fs' },
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

app.post('/internal/audit', async (request, reply) => {
  const parsed = AuditEventSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid audit event' });
  }

  await appendAudit(parsed.data);
  return { ok: true };
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
  const principal = {
    type: 'external_agent',
    id: body.agentId,
    provider: body.provider,
    sessionId: body.sessionId,
    userId: 'user', // Default bound user for now
  };

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

app.listen({ port: runtimeConfig.port, host: '0.0.0.0' }).catch((error) => {
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
