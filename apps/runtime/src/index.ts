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
import { appendAudit, queryAudit, pruneAuditLog, type AuditQuery } from './audit.js';
import {
  loadPolicy,
  savePolicy,
  grantSkillPermissions,
  revokeSkillPermissions,
  getSubjectPolicyVersion,
} from './policyStore.js';
import { createSession, getSession, terminateSession, listSessions } from './sessions.js';
import { parseMessage } from './messageParser.js';
import { callGatewayTool } from './gatewayClient.js';
import { loadSkillsWithVerification, updateSkillStatus, getSkill, uninstallSkill } from './skillStore.js';
import { installSkill } from './installerService.js';
import { loadMemory, proposeMemory, queryMemory, deleteMemory, runMemoryCleanup } from './memoryStore.js';
import { listAgents, getAgent } from './agentStore.js';
import { spawnAgent, terminateAgent, proposeCoordination } from './agentService.js';
import { isTokenRevoked, revokeToken } from './revocationStore.js';
import { ingestEvent } from './eventBus.js';

import { readSigningKey } from './crypto.js';
import { appendMessage } from './messageStore.js';
import { runCompaction } from './compactor.js';
import { getTokenTraceContext, registerTokenTraceContext } from './tokenTraceStore.js';
import {
  createOrGetApproval,
  getApproval,
  listApprovals,
  updateApproval,
  type PendingApproval,
} from './approvalStore.js';

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
      role: 'user' | 'system' | 'internal' | 'main' | 'coordinator' | 'worker';
    };
  }
}

app.addHook('onRequest', async (request, reply) => {
  const secret = request.headers['x-polar-internal-secret'];

  if (request.url.startsWith('/internal/')) {
    if (secret !== runtimeConfig.internalSecret) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid internal secret' });
    }
    request.principal = { id: 'system', role: 'internal' };
    return;
  }

  // Allow trusted internal callers to access non-/internal endpoints (e.g. gateway memory.query).
  if (secret === runtimeConfig.internalSecret) {
    request.principal = { id: 'system', role: 'internal' };
    return;
  }

  // Public/Unprotected routes
  const requestPath = request.url.split('?')[0] || request.url;
  const publicRoutes = ['/health', '/system/status'];
  const isSlackWebhookRoute = /^\/channels\/[^/]+\/slack\/events$/.test(requestPath);
  if (publicRoutes.includes(requestPath) || isSlackWebhookRoute) {
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

type CapabilityIntrospectionResult =
  | {
    active: true;
    payload: Awaited<ReturnType<typeof verifyCapabilityToken>>;
    trace?: ReturnType<typeof getTokenTraceContext>;
  }
  | { active: false; error: string };

type WorkerTraceEvent = {
  id: string;
  time: string;
  action: string;
  tool?: string;
  decision: 'allow' | 'deny';
  reason?: string;
  resource: AuditEvent['resource'];
  requestId?: string;
  messageId?: string;
  parentEventId?: string;
  metadata?: Record<string, unknown>;
};

type WorkerTrace = {
  agentId: string;
  events: WorkerTraceEvent[];
};

function canAccessSession(
  request: { principal?: { id: string; role: 'user' | 'system' | 'internal' | 'main' | 'coordinator' | 'worker' } },
  sessionSubject: string,
): boolean {
  return request.principal?.role === 'internal' || request.principal?.id === sessionSubject;
}

function canAccessChannel(
  request: { principal?: { id: string; role: 'user' | 'system' | 'internal' | 'main' | 'coordinator' | 'worker' } },
  channelUserId?: string,
): boolean {
  if (request.principal?.role === 'internal') return true;
  // Backward compatibility: legacy channels without owner remain accessible to authenticated principal.
  if (!channelUserId) return true;
  return request.principal?.id === channelUserId;
}

async function introspectCapabilityToken(token: string): Promise<CapabilityIntrospectionResult> {
  try {
    const signingKey = await readSigningKey();
    const payload = await verifyCapabilityToken(token, signingKey);

    const currentVer = await getSubjectPolicyVersion(payload.sub);
    if (payload.pol_ver !== undefined && payload.pol_ver < currentVer) {
      return { active: false, error: 'Token revoked (policy version mismatch)' };
    }

    const { getSystemStatus } = await import('./systemStore.js');
    const status = await getSystemStatus();
    if (status.mode === 'emergency') {
      return { active: false, error: 'System is in EMERGENCY MODE' };
    }

    if (await isTokenRevoked(payload.jti)) {
      return { active: false, error: 'Token revoked (JTI blocked)' };
    }

    const skill = await getSkill(payload.sub);
    if (skill && skill.status !== 'enabled') {
      return { active: false, error: `Subject skill is ${skill.status}` };
    }

    const agent = await getAgent(payload.sub);
    if (agent && agent.status === 'terminated') {
      return { active: false, error: 'Subject agent is terminated' };
    }

    const trace = getTokenTraceContext(payload.jti);
    return {
      active: true,
      payload,
      ...(trace ? { trace } : {}),
    };
  } catch (err) {
    return { active: false, error: (err as Error).message };
  }
}

function toWorkerTraceEvent(event: AuditEvent): WorkerTraceEvent {
  return {
    id: event.id,
    time: event.time,
    action: event.action,
    ...(event.tool ? { tool: event.tool } : {}),
    decision: event.decision,
    ...(event.reason ? { reason: event.reason } : {}),
    resource: event.resource,
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.messageId ? { messageId: event.messageId } : {}),
    ...(event.parentEventId ? { parentEventId: event.parentEventId } : {}),
    ...(event.metadata ? { metadata: event.metadata } : {}),
  };
}

async function collectWorkerTraceForAgents(
  agentIds: string[],
  options: { from?: string; limitPerAgent?: number } = {},
): Promise<WorkerTrace[]> {
  const uniqueAgentIds = Array.from(new Set(agentIds.filter((id) => id.length > 0)));
  if (uniqueAgentIds.length === 0) {
    return [];
  }

  const limitPerAgent = Math.min(Math.max(options.limitPerAgent ?? 40, 1), 200);
  const traces = await Promise.all(
    uniqueAgentIds.map(async (agentId): Promise<WorkerTrace> => {
      const events = await queryAudit({
        subject: agentId,
        ...(options.from ? { from: options.from } : {}),
        limit: Math.max(limitPerAgent * 4, 80),
      });

      const filteredEvents = events
        .filter((event) =>
          (event.subject === agentId || event.agentId === agentId) &&
          event.action !== 'worker.spawn' &&
          event.action !== 'agent.spawn'
        )
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      const recentEvents = filteredEvents.slice(-limitPerAgent).map(toWorkerTraceEvent);
      return { agentId, events: recentEvents };
    }),
  );

  return traces.filter((trace) => trace.events.length > 0);
}

const SECRET_REDACTION_PATTERN = /\b(Bearer\s+[A-Za-z0-9\-._~+/]+=*|sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16})\b/gi;

function sanitizeApprovalResult(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(SECRET_REDACTION_PATTERN, '[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeApprovalResult);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (/token|secret|password|authorization|credential|api[_-]?key/i.test(key)) {
        next[key] = '[REDACTED]';
      } else {
        next[key] = sanitizeApprovalResult(nested);
      }
    }
    return next;
  }
  return value;
}

async function executeApprovalRequest(approval: PendingApproval): Promise<{
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}> {
  const response = await fetch(`${runtimeConfig.gatewayUrl}${approval.request.toolPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-polar-internal-secret': runtimeConfig.internalSecret,
      'x-polar-approval-id': approval.id,
    },
    body: JSON.stringify(approval.request.body),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error = typeof payload === 'string'
      ? payload
      : (payload as { error?: string }).error;
    return {
      ok: false,
      status: response.status,
      ...(error ? { error } : {}),
      data: sanitizeApprovalResult(payload),
    };
  }

  return {
    ok: true,
    status: response.status,
    data: sanitizeApprovalResult(payload),
  };
}

app.post('/sessions', async (request) => {
  const body = request.body as { projectPath?: string };
  const subject = request.principal?.id || 'anonymous';
  const session = createSession(subject, body.projectPath);

  // Spawn the main planning agent for the session
  const mainAgent = await spawnAgent({
    userId: subject,
    sessionId: session.id,
    role: 'main',
  });

  session.mainAgentId = mainAgent.id;

  return { session, mainAgentId: mainAgent.id };
});

app.get('/sessions/:id/prompt', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = getSession(id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  if (!canAccessSession(request, session.subject)) {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  if (!session.mainAgentId) {
    return reply.status(400).send({ error: 'Main agent not initialized' });
  }

  const agent = await getAgent(session.mainAgentId);
  if (!agent) return reply.status(404).send({ error: 'Main agent not found' });

  const { compileMainAgentPrompt } = await import('./orchestrator.js');
  const prompt = await compileMainAgentPrompt(agent, session);

  return { prompt };
});


app.get('/sessions/:id/messages', async (request, reply) => {
  const session = getSession((request.params as { id: string }).id);
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }

  if (session.subject !== request.principal?.id && request.principal?.role !== 'internal') {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  const { getSessionMessages } = await import('./messageStore.js');
  const messages = await getSessionMessages(session.id);
  return { messages };
});

app.get('/sessions/:id/worker-trace', async (request, reply) => {
  const session = getSession((request.params as { id: string }).id);
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }

  if (!canAccessSession(request, session.subject)) {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  const query = request.query as { agentIds?: string; from?: string; limit?: string };
  const requestedAgentIds = query.agentIds
    ? query.agentIds.split(',').map((id) => id.trim()).filter((id) => id.length > 0)
    : [];

  const candidateAgentIds = requestedAgentIds.length > 0
    ? Array.from(new Set(requestedAgentIds))
    : listAgents(session.id)
      .filter((agent) => agent.role === 'worker')
      .map((agent) => agent.id);

  const sessionWorkerIds: string[] = [];
  for (const agentId of candidateAgentIds) {
    const agent = await getAgent(agentId);
    if (agent && agent.sessionId === session.id && agent.role === 'worker') {
      sessionWorkerIds.push(agent.id);
    }
  }

  const limitPerAgentRaw = Number(query.limit);
  const limitPerAgent = Number.isFinite(limitPerAgentRaw)
    ? Math.min(Math.max(limitPerAgentRaw, 1), 200)
    : 40;

  const traces = await collectWorkerTraceForAgents(sessionWorkerIds, {
    ...(query.from ? { from: query.from } : {}),
    limitPerAgent,
  });

  return { traces };
});

app.get('/approvals', async (request, reply) => {
  const query = request.query as { sessionId?: string; status?: string };
  const status = query.status as PendingApproval['status'] | undefined;
  const approvals = await listApprovals({
    ...(query.sessionId ? { sessionId: query.sessionId } : {}),
    ...(status ? { status } : {}),
  });

  if (request.principal?.role === 'internal') {
    return { approvals };
  }

  const visible = approvals.filter((approval) => {
    if (!approval.sessionId) {
      return approval.subject === request.principal?.id;
    }
    const session = getSession(approval.sessionId);
    return Boolean(session && canAccessSession(request, session.subject));
  });

  return { approvals: visible };
});

app.post('/approvals/:id/approve', async (request, reply) => {
  const { id } = request.params as { id: string };
  const approval = await getApproval(id);
  if (!approval) {
    return reply.status(404).send({ error: 'Approval not found' });
  }

  if (request.principal?.role !== 'internal') {
    if (approval.sessionId) {
      const session = getSession(approval.sessionId);
      if (!session || !canAccessSession(request, session.subject)) {
        return reply.status(403).send({ error: 'Forbidden: cannot approve this request' });
      }
    } else if (approval.subject !== request.principal?.id) {
      return reply.status(403).send({ error: 'Forbidden: cannot approve this request' });
    }
  }

  if (approval.status === 'denied') {
    return reply.status(409).send({ error: 'Approval has already been denied' });
  }

  const approved = await updateApproval(id, {
    status: 'approved',
    decidedAt: new Date().toISOString(),
    decidedBy: request.principal?.id || 'system',
  });
  if (!approved) {
    return reply.status(404).send({ error: 'Approval not found' });
  }

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'system',
    action: 'approval.approve',
    decision: 'allow',
    resource: { type: 'system', component: 'approval' },
    ...(approved.sessionId ? { sessionId: approved.sessionId } : {}),
    ...(approved.agentId ? { agentId: approved.agentId } : {}),
    requestId: approved.jti,
    ...(approved.traceId ? { messageId: approved.traceId } : {}),
    ...(approved.parentEventId ? { parentEventId: approved.parentEventId } : {}),
    metadata: { approvalId: approved.id, action: approved.action },
  });

  const execution = await executeApprovalRequest(approved);
  const finalStatus: PendingApproval['status'] = execution.ok ? 'executed' : 'failed';
  const updated = await updateApproval(id, {
    status: finalStatus,
    ...(execution.ok ? { result: execution.data } : { error: execution.error || 'Execution failed', result: execution.data }),
  });

  return {
    ok: execution.ok,
    approval: updated || approved,
    ...(execution.ok ? { result: execution.data } : { error: execution.error, result: execution.data }),
  };
});

app.post('/approvals/:id/deny', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { reason?: string } | undefined;
  const approval = await getApproval(id);
  if (!approval) {
    return reply.status(404).send({ error: 'Approval not found' });
  }

  if (request.principal?.role !== 'internal') {
    if (approval.sessionId) {
      const session = getSession(approval.sessionId);
      if (!session || !canAccessSession(request, session.subject)) {
        return reply.status(403).send({ error: 'Forbidden: cannot deny this request' });
      }
    } else if (approval.subject !== request.principal?.id) {
      return reply.status(403).send({ error: 'Forbidden: cannot deny this request' });
    }
  }

  const denied = await updateApproval(id, {
    status: 'denied',
    decidedAt: new Date().toISOString(),
    decidedBy: request.principal?.id || 'system',
    ...(body?.reason ? { decisionReason: body.reason } : {}),
  });
  if (!denied) {
    return reply.status(404).send({ error: 'Approval not found' });
  }

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'system',
    action: 'approval.deny',
    decision: 'allow',
    resource: { type: 'system', component: 'approval' },
    ...(denied.sessionId ? { sessionId: denied.sessionId } : {}),
    ...(denied.agentId ? { agentId: denied.agentId } : {}),
    requestId: denied.jti,
    ...(denied.traceId ? { messageId: denied.traceId } : {}),
    ...(denied.parentEventId ? { parentEventId: denied.parentEventId } : {}),
    metadata: { approvalId: denied.id, action: denied.action, reason: body?.reason },
  });

  return { ok: true, approval: denied };
});

app.post('/internal/approvals/request', async (request, reply) => {
  const body = request.body as {
    jti?: string;
    subject?: string;
    action?: string;
    sessionId?: string;
    agentId?: string;
    traceId?: string;
    parentEventId?: string;
    resource?: Record<string, unknown>;
    request?: { toolPath?: string; body?: Record<string, unknown> };
  };

  if (!body?.jti || !body?.subject || !body?.action || !body?.request?.toolPath || !body?.request?.body) {
    return reply.status(400).send({ error: 'Invalid approval request payload' });
  }

  const approval: PendingApproval = {
    id: crypto.randomUUID(),
    status: 'pending',
    jti: body.jti,
    subject: body.subject,
    action: body.action,
    ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    ...(body.agentId ? { agentId: body.agentId } : {}),
    ...(body.traceId ? { traceId: body.traceId } : {}),
    ...(body.parentEventId ? { parentEventId: body.parentEventId } : {}),
    resource: body.resource || { type: 'system' },
    request: {
      toolPath: body.request.toolPath,
      body: body.request.body,
    },
    createdAt: new Date().toISOString(),
  };

  const created = await createOrGetApproval(approval);
  return { approval: created };
});

app.post('/sessions/:id/messages', async (request, reply) => {
  const session = getSession((request.params as { id: string }).id);
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }
  const plannerRequestStart = new Date().toISOString();

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

  // Persist message to history
  const savedMessage = await appendMessage({
    sessionId: session.id,
    role: 'user',
    content: body.message,
  });

  // Trigger compaction check
  runCompaction(session.id, session.subject).catch(err =>
    console.error(`Compaction failed for session ${session.id}:`, err)
  );

  try {
    const { processOnboardingMessage } = await import('./onboardingService.js');
    const onboarding = await processOnboardingMessage(session.subject, body.message);
    if (
      onboarding.onboardingStarted
      || onboarding.updated
      || onboarding.topicsCompleted.length > 0
      || onboarding.checkInsScheduled > 0
      || onboarding.onboardingCompleted
    ) {
      await appendAudit({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        subject: request.principal?.id || session.subject,
        action: 'preferences.onboarding_extract',
        decision: 'allow',
        resource: { type: 'system', component: 'preferences' },
        sessionId: session.id,
        requestId: crypto.randomUUID(),
        metadata: {
          onboardingStarted: onboarding.onboardingStarted,
          updated: onboarding.updated,
          topicsCompleted: onboarding.topicsCompleted,
          goalsAdded: onboarding.goalsAdded,
          checkInsScheduled: onboarding.checkInsScheduled,
          onboardingCompleted: onboarding.onboardingCompleted,
        },
      });
    }
  } catch (error) {
    console.error(`Onboarding extraction failed for session ${session.id}:`, error);
  }

  // Stage 3: chat-native automation setup flow.
  const { handleAutomationChatSetup } = await import('./automationService.js');
  const automationSetup = await handleAutomationChatSetup({
    ownerId: session.subject,
    sessionId: session.id,
    message: body.message,
  });
  if (automationSetup.handled) {
    const assistantMessage = await appendMessage({
      sessionId: session.id,
      role: 'assistant',
      content: automationSetup.assistantMessage || 'Automation setup processed.',
    });

    await appendAudit({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      subject: request.principal?.id || session.subject,
      action: automationSetup.status === 'created'
        ? 'automation.setup_create'
        : (automationSetup.status === 'cancelled' ? 'automation.setup_cancel' : 'automation.setup_propose'),
      decision: 'allow',
      resource: { type: 'system', component: 'automation' },
      sessionId: session.id,
      requestId: crypto.randomUUID(),
      ...(automationSetup.automation ? { metadata: { automationId: automationSetup.automation.id } } : {}),
    });

    return {
      ok: true,
      message: assistantMessage,
      ...(automationSetup.automation ? { automation: automationSetup.automation } : {}),
    };
  }

  const spawnWorkerFromArgs = async (
    args: Record<string, unknown>,
    source: 'user' | 'llm_tool',
    traceContext?: { traceId?: string; plannerToolCallId?: string },
  ) => {
    const capabilities = Array.isArray(args.capabilities) ? args.capabilities as string[] : [];
    const modelHint = (args.modelTier || args.modelHint) as string | undefined;

    const requesterRole = request.principal?.role;
    if (requesterRole !== 'user' && requesterRole !== 'main' && requesterRole !== 'coordinator' && requesterRole !== 'internal') {
      throw new Error('Only planners can spawn workers');
    }

    const agent = await spawnAgent({
      role: 'worker',
      sessionId: session.id,
      userId: session.subject,
      skillId: args.skillId as string | undefined,
      metadata: {
        goal: args.goal,
        capabilities,
        modelHint,
        readOnly: args.readOnly,
        source,
        ...(traceContext?.traceId ? { traceId: traceContext.traceId } : {}),
        ...(traceContext?.plannerToolCallId ? { plannerToolCallId: traceContext.plannerToolCallId } : {}),
      }
    });

    await appendAudit({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      subject: request.principal?.id || 'main',
      action: 'worker.spawn',
      decision: 'allow',
      resource: { type: 'system', component: 'worker' },
      sessionId: session.id,
      agentId: agent.id,
      ...(traceContext?.traceId ? { requestId: traceContext.traceId } : {}),
      ...(traceContext?.plannerToolCallId ? { parentEventId: traceContext.plannerToolCallId } : {}),
      metadata: { capabilities, goal: args.goal, modelHint, source }
    });

    return agent;
  };

  const workerRequest = parseMessage(body.message);
  if (!workerRequest) {
    // If no explicit tool call, use LLM planner context and execute approved tool calls.
    const { llmService, compileMainAgentContext } = await import('./llm/index.js');
    const { getSessionMessages, appendMessage } = await import('./messageStore.js');
    const { getAgent } = await import('./agentStore.js');

    const agent = await getAgent(session.mainAgentId!);
    if (!agent) {
      return reply.status(400).send({ error: 'Session has no main agent' });
    }

    const history = await getSessionMessages(session.id);
    const conversationMessages = history.map(m => ({ role: m.role, content: m.content }));
    const sessionContext = session.projectPath ? { id: session.id, projectPath: session.projectPath } : { id: session.id };

    try {
      const context = await compileMainAgentContext(agent, sessionContext, conversationMessages);
      const llmResponse = await llmService.chat({
        messages: context.messages,
        tools: context.tools,
      }, {
        sessionId: session.id,
        ...(session.mainAgentId ? { agentId: session.mainAgentId } : {}),
        tier: 'reasoning' // Use high-quality model for planning
      });

      const toolExecutionResults: Array<{
        callId: string;
        name: string;
        ok: boolean;
        data?: unknown;
        error?: string;
      }> = [];

      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        for (const toolCall of llmResponse.toolCalls) {
          try {
            if (toolCall.name === 'worker.spawn') {
              const spawnedAgent = await spawnWorkerFromArgs(
                toolCall.arguments,
                'llm_tool',
                { traceId: toolCall.id, plannerToolCallId: toolCall.id },
              );
              const requestedCapabilities = Array.isArray(toolCall.arguments.capabilities)
                ? toolCall.arguments.capabilities.filter((cap): cap is string => typeof cap === 'string')
                : [];
              const goal = typeof toolCall.arguments.goal === 'string'
                ? toolCall.arguments.goal
                : undefined;
              const modelHint = typeof toolCall.arguments.modelHint === 'string'
                ? toolCall.arguments.modelHint
                : (typeof toolCall.arguments.modelTier === 'string' ? toolCall.arguments.modelTier : undefined);
              const readOnly = toolCall.arguments.readOnly === true;

              toolExecutionResults.push({
                callId: toolCall.id,
                name: toolCall.name,
                ok: true,
                data: {
                  agentId: spawnedAgent.id,
                  capabilities: requestedCapabilities,
                  goal,
                  modelHint,
                  readOnly,
                  traceId: toolCall.id,
                },
              });
            } else if (toolCall.name === 'memory.query') {
              const parsedQuery = MemoryQuerySchema.safeParse(toolCall.arguments);
              if (!parsedQuery.success) {
                throw new Error('Invalid memory.query arguments');
              }
              const items = await queryMemory(parsedQuery.data, session.subject);
              toolExecutionResults.push({
                callId: toolCall.id,
                name: toolCall.name,
                ok: true,
                data: { count: items.length, items: items.slice(0, 10) },
              });
            } else if (toolCall.name === 'memory.propose') {
              const parsedProposal = MemoryProposalSchema.safeParse({
                ...toolCall.arguments,
                sourceId: typeof toolCall.arguments.sourceId === 'string'
                  ? toolCall.arguments.sourceId
                  : `planner:${session.id}`,
              });
              if (!parsedProposal.success) {
                throw new Error('Invalid memory.propose arguments');
              }

              const item = await proposeMemory(
                parsedProposal.data,
                session.subject,
                session.mainAgentId,
                undefined,
              );
              toolExecutionResults.push({
                callId: toolCall.id,
                name: toolCall.name,
                ok: true,
                data: { id: item.id, scopeId: item.scopeId, type: item.type },
              });
            } else if (toolCall.name === 'policy.check') {
              const action = typeof toolCall.arguments.action === 'string'
                ? toolCall.arguments.action
                : undefined;
              if (!action) {
                throw new Error('policy.check requires action');
              }

              const policy = await loadPolicy();
              const resource = (toolCall.arguments.resource as any) || { type: 'system', component: 'planner' };
              const decision = evaluatePolicy(
                {
                  subject: session.subject,
                  action,
                  resource,
                },
                policy,
              );

              toolExecutionResults.push({
                callId: toolCall.id,
                name: toolCall.name,
                ok: true,
                data: decision,
              });
            } else {
              throw new Error(`Unsupported planner tool: ${toolCall.name}`);
            }

            await appendAudit({
              id: crypto.randomUUID(),
              time: new Date().toISOString(),
              subject: request.principal?.id || 'main',
              action: toolCall.name,
              decision: 'allow',
              resource: { type: 'system', component: 'planner' },
              sessionId: session.id,
              metadata: { toolCallId: toolCall.id },
            });
          } catch (spawnError) {
            toolExecutionResults.push({
              callId: toolCall.id,
              name: toolCall.name,
              ok: false,
              error: (spawnError as Error).message,
            });

            await appendAudit({
              id: crypto.randomUUID(),
              time: new Date().toISOString(),
              subject: request.principal?.id || 'main',
              action: toolCall.name,
              decision: 'deny',
              reason: (spawnError as Error).message,
              resource: { type: 'system', component: 'planner' },
              sessionId: session.id,
              metadata: { toolCallId: toolCall.id },
            });
          }
        }
      }

      let assistantContent = llmResponse.content || '';

      if (toolExecutionResults.length > 0) {
        try {
          const toolMessages = toolExecutionResults.map(result => ({
            role: 'tool' as const,
            name: result.name,
            content: JSON.stringify(result),
          }));

          const followUp = await llmService.chat(
            {
              messages: [
                ...context.messages,
                ...(llmResponse.content ? [{ role: 'assistant' as const, content: llmResponse.content }] : []),
                ...toolMessages,
              ],
            },
            {
              sessionId: session.id,
              ...(session.mainAgentId ? { agentId: session.mainAgentId } : {}),
              tier: 'reasoning',
            },
          );

          if (followUp.content) {
            assistantContent = followUp.content;
          }
        } catch (followUpError) {
          const successCount = toolExecutionResults.filter(result => result.ok).length;
          const failedCount = toolExecutionResults.length - successCount;
          assistantContent = `Executed ${toolExecutionResults.length} planner tool call(s): ${successCount} succeeded, ${failedCount} failed.`;
        }
      }

      const spawnedWorkerIds = toolExecutionResults
        .filter(result => result.ok && result.name === 'worker.spawn' && typeof (result.data as any)?.agentId === 'string')
        .map(result => (result.data as any).agentId as string);
      const workerTraces = spawnedWorkerIds.length > 0
        ? await collectWorkerTraceForAgents(spawnedWorkerIds, { from: plannerRequestStart, limitPerAgent: 60 })
        : [];

      if (!assistantContent) {
        assistantContent = spawnedWorkerIds.length > 0
          ? `Spawned ${spawnedWorkerIds.length} worker(s): ${spawnedWorkerIds.join(', ')}`
          : 'I am processing your request.';
      }

      const assistantMessage = await appendMessage({
        sessionId: session.id,
        role: 'assistant',
        content: assistantContent
      });

      return {
        ok: true,
        message: assistantMessage,
        toolResults: toolExecutionResults.length > 0 ? toolExecutionResults : undefined,
        workerAgentIds: spawnedWorkerIds.length > 0 ? spawnedWorkerIds : undefined,
        workerTraces: workerTraces.length > 0 ? workerTraces : undefined,
        toolCalls: llmResponse.toolCalls,
      };
    } catch (llmError) {
      console.error('LLM Chat failed:', llmError);
      return { ok: true, message: savedMessage }; // Fallback to echo if LLM fails
    }
  }

  if (workerRequest.action === 'worker.spawn') {
    try {
      const agent = await spawnWorkerFromArgs(
        workerRequest.args || {},
        'user',
        { traceId: crypto.randomUUID() },
      );
      return { ok: true, agentId: agent.id };
    } catch (error) {
      return reply.status(403).send({ error: (error as Error).message });
    }
  }

  // Phase 2 hardening: end-user traffic must not invoke direct tool actions.
  // The planner can only execute via worker.spawn. Keep internal bypasses for controlled system workflows.
  if (request.principal?.role !== 'internal') {
    return reply.status(400).send({
      error: 'Direct tool actions are disabled. Request actions through planner delegation (worker.spawn).',
    });
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
    const template = skill.manifest.workerTemplates?.find(t => t.id === workerRequest.templateId);
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
    requiresConfirmation: decision.requiresConfirmation === true,
    expiresAt: now + runtimeConfig.capabilityTtlSeconds,
  };
  registerTokenTraceContext({
    jti: capability.id,
    sessionId: session.id,
    ...(body.agentId ? { agentId: body.agentId } : {}),
  });

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
    return reply.status(gatewayResponse.status).send({
      error: gatewayResponse.error,
      ...(gatewayResponse.data ? { details: sanitizeApprovalResult(gatewayResponse.data) } : {}),
    });
  }
  const sanitizedGatewayResult = sanitizeApprovalResult(gatewayResponse.data);

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
    result: sanitizedGatewayResult,
  };
});

app.get('/memory', async (request) => {
  const subject = request.principal?.id || 'anonymous';
  const items = (await loadMemory()).filter((item) => item.subjectId === subject);
  return { items };
});

app.post('/memory/query', async (request, reply) => {
  const body = request.body as { sessionId?: string; query?: unknown; subject?: string };

  let subject: string;
  let sessionId: string | undefined = body.sessionId;

  // Support internal gateway call with subject override
  const isInternal = request.headers['x-polar-internal-secret'] === runtimeConfig.internalSecret;

  if (isInternal && body.subject) {
    subject = body.subject;
  } else {
    if (!body?.sessionId) {
      return reply.status(400).send({ error: 'sessionId is required' });
    }
    const session = getSession(body.sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    if (!canAccessSession(request, session.subject)) {
      return reply.status(403).send({ error: 'Forbidden: access to session denied' });
    }
    subject = session.subject;
    sessionId = session.id;
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
        subject,
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

  const items = await queryMemory(query, subject);

  // Audit read attempt
  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject,
    action: 'memory.read',
    decision: 'allow',
    resource: { type: 'memory' },
    sessionId,
    requestId: crypto.randomUUID(),
    metadata: { query }
  });

  return { items };
});

const proposalRateLimits = new Map<string, { count: number; windowStart: number }>();

app.post('/memory/propose', async (request, reply) => {
  const body = request.body as { sessionId?: string; proposal?: unknown };
  if (!body?.sessionId) {
    return reply.status(400).send({ error: 'sessionId is required' });
  }

  const session = getSession(body.sessionId);
  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }
  if (!canAccessSession(request, session.subject)) {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  const proposalParsed = MemoryProposalSchema.safeParse(body.proposal);
  if (!proposalParsed.success) {
    return reply.status(400).send({ error: 'Invalid proposal schema' });
  }

  const proposal = proposalParsed.data;
  const subject = request.principal?.id || 'unknown';

  // 1. Rate Limiting
  const now = Date.now();
  let limit = proposalRateLimits.get(subject);
  if (!limit || now - limit.windowStart > 60000) {
    limit = { count: 0, windowStart: now };
    proposalRateLimits.set(subject, limit);
  }
  limit.count++;
  if (limit.count > 10) { // Max 10 proposals per minute
    return reply.status(429).send({ error: 'Proposal rate limit exceeded. Max 10/min.' });
  }

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

app.get('/agents/:id/instructions', async (request, reply) => {
  const { id } = request.params as { id: string };
  const agent = await getAgent(id);
  if (!agent) return reply.status(404).send({ error: 'Agent not found' });

  if (agent.skillId) {
    const { loadSkillContent } = await import('./skillStore.js');
    const content = await loadSkillContent(agent.skillId);
    return content || { instructions: 'No instructions provided.' };
  }

  return { instructions: 'No specific instructions provided.' };
});

// Internal worker spawning is handled via direct logic, not a public endpoint.
// app.post('/workers/spawn', async () => ({ ok: true }));

// Capability minting is an internal authority, not exposed to the network.
// app.post('/capabilities/mint', async (request, reply) => { ... });

app.get('/permissions', async (request) => {
  const policy = await loadPolicy();
  if (request.principal?.role === 'internal') {
    return { policy };
  }

  const subject = request.principal?.id || 'anonymous';
  return {
    policy: {
      ...policy,
      grants: policy.grants.filter((grant) => grant.subject === subject),
      // Regular users cannot view or manage global rule set.
      rules: policy.rules.filter((rule) => rule.subject === subject),
      policyVersions: policy.policyVersions
        ? { [subject]: policy.policyVersions[subject] ?? 0 }
        : undefined,
    },
  };
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

    if (request.principal?.role === 'internal') {
      await savePolicy(parsed.data);
      return { ok: true };
    }

    const subject = request.principal?.id || 'anonymous';

    if (parsed.data.rules.length > 0) {
      return reply.status(403).send({ error: 'User-scoped policy updates cannot modify rules' });
    }

    if (parsed.data.grants.some((grant) => grant.subject !== subject)) {
      return reply.status(403).send({ error: 'Cannot write grants for other subjects' });
    }

    const existingPolicy = await loadPolicy();
    const mergedPolicy = {
      ...existingPolicy,
      grants: [
        ...existingPolicy.grants.filter((grant) => grant.subject !== subject),
        ...parsed.data.grants,
      ],
    };

    await savePolicy(mergedPolicy);
    return { ok: true };
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }
});

app.get('/skills', async () => {
  const skills = await loadSkillsWithVerification();
  return { skills };
});

app.get('/skills/:id/content', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { loadSkillContent } = await import('./skillStore.js');
  const content = await loadSkillContent(id);

  if (!content) {
    return reply.status(404).send({ error: 'Skill content not found' });
  }

  return content;
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

app.post('/skills/:id/rollback', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { version?: string };

  const { rollbackSkill } = await import('./skillStore.js');
  try {
    const skill = await rollbackSkill(id, body?.version);
    return { ok: true, skill };
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }
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

  const body = request.body as { capabilities?: string[]; requiresConfirmationActions?: string[] };
  const requestedSubset = body?.capabilities;
  const requiresConfirmationActions = body?.requiresConfirmationActions;

  await grantSkillPermissions(
    id,
    skill.manifest.requestedCapabilities,
    requestedSubset,
    requiresConfirmationActions,
  );
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
    reason,
    ...(requiresConfirmationActions && requiresConfirmationActions.length > 0
      ? { metadata: { requiresConfirmationActions } }
      : {}),
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

// Skill uninstall endpoint
app.post('/skills/:id/status', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { status } = request.body as { status: any };

  const skill = await getSkill(id);
  if (!skill) {
    return reply.status(404).send({ error: 'Skill not found' });
  }

  // Basic validation (Status must be one of the enum values)
  const validStatuses = ['enabled', 'disabled', 'pending_consent', 'emergency_disabled'];
  if (!validStatuses.includes(status)) {
    return reply.status(400).send({ error: 'Invalid status' });
  }

  await updateSkillStatus(id, status);
  return { ok: true };
});

app.delete('/skills/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { deleteFiles?: boolean } | undefined;
  const deleteFiles = body?.deleteFiles === true;

  // First revoke permissions
  await revokeSkillPermissions(id);

  try {
    await uninstallSkill(id, { deleteFiles });
  } catch (error) {
    return reply.status(404).send({ error: (error as Error).message });
  }

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'skill.uninstall',
    decision: 'allow',
    skillId: id,
    resource: { type: 'fs' },
    requestId: crypto.randomUUID(),
    reason: `Skill uninstalled${deleteFiles ? ' with files deleted' : ''}`
  });

  return { ok: true, path: deleteFiles ? 'deleted' : 'kept' };
});

// Session termination endpoint
app.post('/sessions/:id/terminate', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { reason?: string } | undefined;
  const session = getSession(id);

  if (!session) {
    return reply.status(404).send({ error: 'Session not found' });
  }
  if (!canAccessSession(request, session.subject)) {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  // Terminate all agents in the session
  const sessionAgents = listAgents(id);
  for (const agent of sessionAgents) {
    if (agent.status !== 'terminated' && agent.status !== 'completed' && agent.status !== 'failed') {
      await terminateAgent(agent.id, body?.reason || 'Session terminated');
    }
  }

  // Terminate the session itself
  terminateSession(id);

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'session.terminate',
    decision: 'allow',
    sessionId: id,
    resource: { type: 'system', component: 'session' },
    requestId: crypto.randomUUID(),
    reason: body?.reason || 'User requested termination',
    metadata: { terminatedAgents: sessionAgents.length }
  });

  return { ok: true, terminatedAgents: sessionAgents.length };
});

// Session list endpoint
app.get('/sessions', async (request) => {
  const reqQuery = request.query as { status?: string };
  const status = reqQuery.status as 'active' | 'terminated' | undefined;
  const sessions = listSessions(status).filter((session) => canAccessSession(request, session.subject));
  return { sessions };
});

// Audit export endpoint
app.get('/audit/export', async (request, reply) => {
  const reqQuery = request.query as any;
  const query: AuditQuery = {};
  if (reqQuery.from) query.from = reqQuery.from;
  if (reqQuery.to) query.to = reqQuery.to;
  if (reqQuery.subject) query.subject = reqQuery.subject;
  if (reqQuery.tool) query.tool = reqQuery.tool;
  if (reqQuery.decision) query.decision = reqQuery.decision;
  query.limit = Number(reqQuery.limit ?? 10000); // Higher limit for export

  const events = await queryAudit(query);
  const format = reqQuery.format || 'json';

  if (format === 'ndjson') {
    reply.header('Content-Type', 'application/x-ndjson');
    reply.header('Content-Disposition', 'attachment; filename=audit-export.ndjson');
    return events.map(e => JSON.stringify(e)).join('\n');
  } else if (format === 'csv') {
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename=audit-export.csv');
    const headers = ['id', 'time', 'subject', 'action', 'decision', 'reason', 'sessionId', 'agentId', 'skillId'];
    const rows = events.map(e =>
      headers.map(h => JSON.stringify((e as any)[h] ?? '')).join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  reply.header('Content-Type', 'application/json');
  reply.header('Content-Disposition', 'attachment; filename=audit-export.json');
  return { events, exportedAt: new Date().toISOString(), count: events.length };
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

  let event = parsed.data;
  const traceContext = event.requestId ? getTokenTraceContext(event.requestId) : undefined;
  if (traceContext) {
    const mergedMetadata = {
      ...(event.metadata || {}),
      ...(traceContext.traceId ? { traceId: traceContext.traceId } : {}),
    };
    event = {
      ...event,
      ...(event.sessionId ? {} : (traceContext.sessionId ? { sessionId: traceContext.sessionId } : {})),
      ...(event.agentId ? {} : (traceContext.agentId ? { agentId: traceContext.agentId } : {})),
      ...(event.messageId ? {} : (traceContext.traceId ? { messageId: traceContext.traceId } : {})),
      ...(event.parentEventId ? {} : (traceContext.parentEventId ? { parentEventId: traceContext.parentEventId } : {})),
      ...(Object.keys(mergedMetadata).length > 0 ? { metadata: mergedMetadata } : {}),
    };
  }

  const inferredAgentId = event.agentId || event.subject;
  const agent = inferredAgentId ? await getAgent(inferredAgentId) : null;
  if (agent) {
    event = {
      ...event,
      ...(event.agentId ? {} : { agentId: agent.id }),
      ...(event.sessionId ? {} : { sessionId: agent.sessionId }),
      ...(event.role ? {} : { role: agent.role }),
    };
  }

  await appendAudit(event);
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

  const result = await introspectCapabilityToken(body.token);
  if (!result.active) {
    return reply.status(401).send({ active: false, error: result.error });
  }
  return {
    active: true,
    ...result.payload,
    ...(result.trace ? { trace: result.trace } : {}),
  };
});

app.get('/internal/connectors/credentials/:connector', async (request, reply) => {
  const { connector } = request.params as { connector: string };
  const { getSecret } = await import('./secretsService.js');

  const connectorKeyMap: Record<string, string> = {
    'github.repo': 'CONNECTOR_GITHUB_TOKEN',
    'google.mail': 'CONNECTOR_GOOGLE_ACCESS_TOKEN',
    'home.assistant': 'CONNECTOR_HOME_ASSISTANT_TOKEN',
  };

  const secretKey = connectorKeyMap[connector];
  if (!secretKey) {
    return reply.status(404).send({ error: 'Connector credential mapping not found' });
  }

  const envFallback = process.env[secretKey];
  const secret = await getSecret(secretKey);
  const credential = secret || envFallback;
  if (!credential) {
    return reply.status(404).send({ error: 'Credential not configured' });
  }

  return { credential };
});

app.get('/sessions/:id/agents', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = getSession(id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  if (!canAccessSession(request, session.subject)) {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

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
  const { sessionId, agentId } = request.params as { sessionId: string; agentId: string };
  const { reason } = request.body as { reason?: string };

  const session = getSession(sessionId);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  if (!canAccessSession(request, session.subject)) {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  const agent = await getAgent(agentId);
  if (!agent) return reply.status(404).send({ error: 'Agent not found' });
  if (agent.sessionId !== sessionId) {
    return reply.status(400).send({ error: 'Agent does not belong to this session' });
  }

  const ok = await terminateAgent(agentId, reason || 'User requested termination');
  if (!ok) return reply.status(500).send({ error: 'Agent termination failed' });

  return { ok: true };
});

app.get('/channels', async (request) => {
  const { loadChannels } = await import('./channelStore.js');
  const channels = (await loadChannels()).filter((channel) =>
    canAccessChannel(request, channel.userId)
  );
  return { channels };
});

app.post('/channels/:id/slack/events', async (request, reply) => {
  const { getChannel } = await import('./channelStore.js');
  const { id } = request.params as { id: string };
  const body = request.body as Record<string, unknown>;

  const channel = await getChannel(id);
  if (!channel || channel.type !== 'slack') {
    return reply.status(404).send({ error: 'Slack channel not found' });
  }

  const expectedToken = channel.credentials?.verificationToken;
  const providedToken = typeof body?.token === 'string' ? body.token : undefined;
  if (expectedToken && providedToken !== expectedToken) {
    return reply.status(401).send({ error: 'Invalid Slack verification token' });
  }

  const { ingestSlackEvent } = await import('./channelService.js');
  const result = await ingestSlackEvent(id, body);
  if (!result.ok) {
    return reply.status(400).send({ error: result.reason || 'Slack event rejected' });
  }
  if (result.challenge !== undefined) {
    return { challenge: result.challenge };
  }
  return { ok: true, ...(result.ignored ? { ignored: true, reason: result.reason } : {}) };
});

app.post('/channels', async (request, reply) => {
  const { updateChannel, getChannel } = await import('./channelStore.js');
  const body = request.body as any;
  if (!body.id || !body.type) {
    return reply.status(400).send({ error: 'id and type are required' });
  }
  const existing = await getChannel(body.id);
  if (existing && !canAccessChannel(request, existing.userId)) {
    return reply.status(403).send({ error: 'Forbidden: access to channel denied' });
  }

  if (request.principal?.role !== 'internal') {
    body.userId = request.principal?.id || 'anonymous';
  }

  await updateChannel(body);
  // Restart service to pick up new config
  const { startChannelService } = await import('./channelService.js');
  startChannelService();
  return { ok: true };
});

app.get('/channels/:id/routes', async (request, reply) => {
  const { getChannel } = await import('./channelStore.js');
  const { listChannelRoutes } = await import('./channelService.js');
  const { id } = request.params as { id: string };
  const channel = await getChannel(id);
  if (!channel) return reply.status(404).send({ error: 'Channel not found' });
  if (!canAccessChannel(request, channel.userId)) {
    return reply.status(403).send({ error: 'Forbidden: access to channel denied' });
  }
  const routes = await listChannelRoutes(id);
  return { routes };
});

app.put('/channels/:id/routes', async (request, reply) => {
  const { getChannel } = await import('./channelStore.js');
  const { setChannelRoute } = await import('./channelService.js');
  const { id } = request.params as { id: string };
  const body = request.body as { conversationId?: string; sessionId?: string };

  if (!body?.conversationId || !body?.sessionId) {
    return reply.status(400).send({ error: 'conversationId and sessionId are required' });
  }

  const channel = await getChannel(id);
  if (!channel) return reply.status(404).send({ error: 'Channel not found' });
  if (!canAccessChannel(request, channel.userId)) {
    return reply.status(403).send({ error: 'Forbidden: access to channel denied' });
  }

  const targetSession = getSession(body.sessionId);
  if (!targetSession) {
    return reply.status(404).send({ error: 'Session not found' });
  }
  if (!canAccessSession(request, targetSession.subject)) {
    return reply.status(403).send({ error: 'Forbidden: access to session denied' });
  }

  await setChannelRoute(id, body.conversationId, body.sessionId);
  return { ok: true };
});

app.post('/channels/pairing-code', async (request, reply) => {
  const { generatePairingCode } = await import('./channelService.js');
  const userId = request.principal?.id || 'user';

  const code = await generatePairingCode(userId);

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: userId,
    action: 'channel.pair_start',
    decision: 'allow',
    resource: { type: 'system', component: 'channel' },
    requestId: crypto.randomUUID(),
    metadata: { code_prefix: code.substring(0, 2) + '****' }
  });

  return { code, expiresSeconds: 600 };
});

app.post('/channels/:id/send', async (request, reply) => {
  const { getChannel } = await import('./channelStore.js');
  const { id } = request.params as { id: string };
  const body = request.body as { conversationId: string; text: string };
  const channel = await getChannel(id);
  if (!channel) return reply.status(404).send({ error: 'Channel not found' });
  if (!canAccessChannel(request, channel.userId)) {
    return reply.status(403).send({ error: 'Forbidden: access to channel denied' });
  }

  const { sendChannelMessage } = await import('./channelService.js');
  try {
    await sendChannelMessage(id, body.conversationId, body.text);
    return { ok: true };
  } catch (e) {
    return reply.status(500).send({ error: (e as Error).message });
  }
});

// Start Channel Service
import('./channelService.js').then(m => m.startChannelService());

app.post('/channels/:id/allowlist', async (request, reply) => {
  const { getChannel, updateChannel } = await import('./channelStore.js');
  const { id } = request.params as { id: string };
  const { senderId } = request.body as { senderId: string };

  if (!senderId) return reply.status(400).send({ error: 'senderId is required' });

  const channel = await getChannel(id);
  if (!channel) return reply.status(404).send({ error: 'Channel not found' });
  if (!canAccessChannel(request, channel.userId)) {
    return reply.status(403).send({ error: 'Forbidden: access to channel denied' });
  }

  if (!channel.allowlist.includes(senderId)) {
    channel.allowlist.push(senderId);
    await updateChannel(channel);
  }

  return { ok: true };
});

app.get('/channels/attachments', async (request) => {
  const { listQuarantinedChannelAttachments } = await import('./channelService.js');
  const query = request.query as {
    channelId?: string;
    sessionId?: string;
    status?: 'quarantined' | 'analysis_requested' | 'analyzed' | 'rejected';
  };

  const attachments = await listQuarantinedChannelAttachments({
    ...(request.principal?.role === 'internal' ? {} : { userId: request.principal?.id || 'user' }),
    ...(query.channelId ? { channelId: query.channelId } : {}),
    ...(query.sessionId ? { sessionId: query.sessionId } : {}),
    ...(query.status ? { status: query.status } : {}),
  });
  return { attachments };
});

app.post('/channels/attachments/:attachmentId/analyze', async (request, reply) => {
  const { listQuarantinedChannelAttachments, requestAttachmentAnalysis } = await import('./channelService.js');
  const { attachmentId } = request.params as { attachmentId: string };
  const body = request.body as { note?: string } | undefined;

  const visibleAttachments = await listQuarantinedChannelAttachments({
    ...(request.principal?.role === 'internal' ? {} : { userId: request.principal?.id || 'user' }),
  });
  const target = visibleAttachments.find((attachment) => attachment.id === attachmentId);
  if (!target) {
    return reply.status(404).send({ error: 'Attachment not found' });
  }

  const updated = await requestAttachmentAnalysis({
    attachmentId,
    requestedBy: request.principal?.id || 'user',
    ...(body?.note ? { note: body.note } : {}),
  });
  if (!updated) {
    return reply.status(404).send({ error: 'Attachment not found' });
  }

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'channel.attachment_analyze_request',
    decision: 'allow',
    resource: { type: 'system', component: 'channel' },
    sessionId: updated.sessionId,
    requestId: crypto.randomUUID(),
    metadata: { attachmentId: updated.id, channelId: updated.channelId },
  });

  return { ok: true, attachment: updated };
});

app.post('/sessions/:id/coordination', async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = getSession(id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  let subject = request.principal?.id || 'anonymous';
  let isAuthorized = session.subject === subject || request.principal?.role === 'internal';

  // Support worker-initiated coordination with capability token
  const authHeader = request.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const result = await introspectCapabilityToken(token);
    if (result.active && result.payload.act === 'coordination.propose') {
      subject = result.payload.sub;
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
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
    nonce?: string;
  };

  // 1. Verify Authentication & Nonce
  if (!body.signature || !body.publicKey || !body.nonce) {
    return reply.status(401).send({ error: 'Missing signature, publicKey, or nonce' });
  }

  const { hasJtiBeenUsed, markJtiAsUsed } = await import('./revocationStore.js');
  if (await hasJtiBeenUsed(body.nonce)) {
    return reply.status(401).send({ error: 'Replay detected: Nonce already used' });
  }

  try {
    const verifier = crypto.createVerify('SHA256');
    // Sign task + nonce + sessionId to bind the request
    verifier.update(body.task + body.nonce + body.sessionId);
    verifier.end();

    const isValid = verifier.verify(body.publicKey, body.signature, 'hex');
    if (!isValid) throw new Error('Invalid signature');

    // Mark nonce as used only after successful verification
    await markJtiAsUsed(body.nonce);
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
  const { setEmergencyDisabledForEnabledSkills } = await import('./skillStore.js');
  const body = request.body as { enabled: boolean; reason?: string };

  if (typeof body.enabled !== 'boolean') {
    return reply.status(400).send({ error: 'enabled boolean is required' });
  }

  const status = await setEmergencyMode(body.enabled, body.reason);
  let emergencyDisabledSkills = 0;

  let terminatedWorkers = 0;
  if (body.enabled) {
    const disabled = await setEmergencyDisabledForEnabledSkills();
    emergencyDisabledSkills = disabled.length;

    const activeWorkers = listAgents().filter(
      (agent) => agent.role === 'worker' && (agent.status === 'running' || agent.status === 'pending'),
    );

    for (const worker of activeWorkers) {
      const terminated = await terminateAgent(worker.id, 'Emergency mode activated');
      if (terminated) {
        terminatedWorkers += 1;
      }
    }
  }

  return { ok: true, status, terminatedWorkers, emergencyDisabledSkills };
});

app.post('/system/emergency/recover', async (request, reply) => {
  const { getSystemStatus } = await import('./systemStore.js');
  const { recoverEmergencyDisabledSkills } = await import('./skillStore.js');
  const body = request.body as { skillIds?: string[] } | undefined;

  const status = await getSystemStatus();
  if (status.mode === 'emergency') {
    return reply.status(409).send({ error: 'System remains in EMERGENCY MODE. Disable emergency before recovery.' });
  }

  const recoveredSkillIds = await recoverEmergencyDisabledSkills(body?.skillIds);

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'system.emergency_recover',
    decision: 'allow',
    resource: { type: 'system', component: 'status' },
    requestId: crypto.randomUUID(),
    metadata: {
      recoveredSkillIds,
      count: recoveredSkillIds.length,
    },
  });

  return {
    ok: true,
    recoveredSkillIds,
    count: recoveredSkillIds.length,
  };
});

app.post('/system/policy-mode', async (request, reply) => {
  const { setSkillPolicyMode } = await import('./systemStore.js');
  const body = request.body as { mode: 'developer' | 'signed_only' };

  if (!body.mode || !['developer', 'signed_only'].includes(body.mode)) {
    return reply.status(400).send({ error: "mode must be either 'developer' or 'signed_only'" });
  }

  const status = await setSkillPolicyMode(body.mode);
  return { ok: true, status };
});

app.get('/system/trust-store', async () => {
  const { listTrustedPublishers } = await import('./trustStore.js');
  const publishers = await listTrustedPublishers();
  return { publishers };
});

app.post('/system/trust-store', async (request, reply) => {
  const body = request.body as { name?: string; publicKey?: string };
  if (!body?.name || !body?.publicKey) {
    return reply.status(400).send({ error: 'name and publicKey are required' });
  }

  const { addTrustedPublisher } = await import('./trustStore.js');
  try {
    const publisher = await addTrustedPublisher({
      name: body.name,
      publicKey: body.publicKey,
    });

    await appendAudit({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      subject: request.principal?.id || 'user',
      action: 'system.trust_store_add',
      decision: 'allow',
      resource: { type: 'system', component: 'security' },
      requestId: crypto.randomUUID(),
      metadata: {
        publisherId: publisher.id,
        fingerprint: publisher.fingerprint,
      },
    });

    return { ok: true, publisher };
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }
});

app.delete('/system/trust-store/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { removeTrustedPublisher } = await import('./trustStore.js');
  const deleted = await removeTrustedPublisher(id);
  if (!deleted) {
    return reply.status(404).send({ error: 'Publisher not found' });
  }

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'system.trust_store_remove',
    decision: 'allow',
    resource: { type: 'system', component: 'security' },
    requestId: crypto.randomUUID(),
    metadata: { publisherId: id },
  });

  return { ok: true };
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

// === Automation & Events ===

app.get('/automations', async (request) => {
  const { listAutomations } = await import('./automationService.js');
  const automations = listAutomations();
  if (request.principal?.role === 'internal') {
    return { automations };
  }
  return {
    automations: automations.filter((automation) => automation.ownerId === request.principal?.id),
  };
});

app.post('/automations', async (request, reply) => {
  const { createAutomation } = await import('./automationService.js');
  const { AutomationEnvelopeSchema } = await import('@polar/core');
  try {
    const body = request.body as Record<string, unknown>;
    const createSchema = AutomationEnvelopeSchema.omit({
      id: true,
      createdAt: true,
      ownerId: true,
    });
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid automation payload' });
    }

    const ownerId = request.principal?.role === 'internal'
      ? ((typeof body.ownerId === 'string' && body.ownerId.length > 0) ? body.ownerId : (request.principal?.id || 'system'))
      : (request.principal?.id || 'user');

    const env = await createAutomation({
      ...parsed.data,
      ownerId,
    });
    return { ok: true, automation: env };
  } catch (e) {
    return reply.status(400).send({ error: (e as Error).message });
  }
});

app.delete('/automations/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { deleteAutomation, listAutomations } = await import('./automationService.js');
  const target = listAutomations().find((automation) => automation.id === id);
  if (!target) {
    return reply.status(404).send({ error: 'Automation not found' });
  }
  if (request.principal?.role !== 'internal' && target.ownerId !== request.principal?.id) {
    return reply.status(403).send({ error: 'Forbidden: access to automation denied' });
  }

  await deleteAutomation(id);
  return { ok: true };
});

// ============================================================================
// LLM Brain Endpoints
// ============================================================================

app.get('/llm/config', async () => {
  const { llmService } = await import('./llm/index.js');
  const config = await llmService.getConfig();
  // Flatten the response for the UI (it expects the config fields directly, not nested in { config })
  return config;
});

app.post('/llm/config', async (request, reply) => {
  const body = request.body as {
    provider?: string;
    modelId?: string;
    parameters?: { temperature?: number; maxTokens?: number; topP?: number };
    tierModels?: { cheap?: string; fast?: string; writing?: string; reasoning?: string };
    subAgentModels?: { fast?: string; reasoning?: string };
  };

  const { llmService } = await import('./llm/index.js');
  const { hasProvider } = await import('./llm/providers/index.js');
  if (body.provider && !hasProvider(body.provider)) {
    return reply.status(400).send({ error: `Invalid provider: ${body.provider}` });
  }
  const providerUpdate = body.provider && hasProvider(body.provider) ? body.provider : undefined;

  const updated = await llmService.updateConfig({
    ...(providerUpdate ? { provider: providerUpdate } : {}),
    ...(body.modelId ? { modelId: body.modelId } : {}),
    ...(body.parameters ? { parameters: body.parameters } : {}),
    ...(body.tierModels ? { tierModels: body.tierModels } : {}),
    ...(body.subAgentModels ? { subAgentModels: body.subAgentModels } : {}),
  });

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'llm.config_update',
    decision: 'allow',
    resource: { type: 'system', component: 'llm' },
    requestId: crypto.randomUUID(),
    metadata: { provider: updated.provider, modelId: updated.modelId },
  });

  return { ok: true, config: updated };
});

app.get('/llm/status', async () => {
  const { llmService } = await import('./llm/index.js');
  const status = await llmService.isConfigured();
  return { status };
});

app.get('/llm/providers/status', async () => {
  const { llmService } = await import('./llm/index.js');
  const statuses = await llmService.getProviderStatuses();
  return statuses;
});

app.get('/llm/models', async (request) => {
  const { llmService } = await import('./llm/index.js');
  const query = request.query as { provider?: string };
  const models = await llmService.listModels(query.provider);
  return { models };
});

app.post('/llm/chat', async (request, reply) => {
  const body = request.body as {
    sessionId?: string;
    message?: string;
  };

  if (!body?.sessionId || !body?.message) {
    return reply.status(400).send({ error: 'sessionId and message are required' });
  }
  const internalHeaders: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (request.principal?.role === 'internal') {
    internalHeaders['x-polar-internal-secret'] = runtimeConfig.internalSecret;
  } else {
    const authorization = request.headers['authorization'];
    if (typeof authorization === 'string' && authorization.length > 0) {
      internalHeaders.authorization = authorization;
    }
  }

  const injected = await app.inject({
    method: 'POST',
    url: `/sessions/${encodeURIComponent(body.sessionId)}/messages`,
    headers: internalHeaders,
    payload: { message: body.message },
  });

  const contentType = injected.headers['content-type'] || '';
  const payload = contentType.includes('application/json')
    ? injected.json()
    : injected.body;

  if (injected.statusCode >= 400) {
    return reply.status(injected.statusCode).send(payload as any);
  }

  const data = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
  const message = data.message && typeof data.message === 'object'
    ? data.message as Record<string, unknown>
    : undefined;
  const content = message && typeof message.content === 'string'
    ? message.content
    : '';

  return {
    ok: true,
    content,
    ...(message ? { message } : {}),
    ...(Array.isArray(data.toolCalls) ? { toolCalls: data.toolCalls } : {}),
    ...(Array.isArray(data.toolResults) ? { toolResults: data.toolResults } : {}),
    ...(Array.isArray(data.workerAgentIds) ? { workerAgentIds: data.workerAgentIds } : {}),
    ...(Array.isArray(data.workerTraces) ? { workerTraces: data.workerTraces } : {}),
  };
});

// Endpoint to set/update LLM API keys securely
app.post('/llm/credentials', async (request, reply) => {
  const body = request.body as {
    provider: string;
    credential: string;
  };

  if (!body?.provider || !body?.credential) {
    return reply.status(400).send({ error: 'provider and credential are required' });
  }

  const { getSystemStatus } = await import('./systemStore.js');
  const status = await getSystemStatus();
  if (status.mode === 'emergency') {
    return reply.status(503).send({ error: 'System is in EMERGENCY MODE. Credential updates are disabled.' });
  }

  const { setSecret } = await import('./secretsService.js');
  const { hasProvider } = await import('./llm/providers/index.js');
  const { LLM_CREDENTIAL_KEYS } = await import('./llm/types.js');

  if (!hasProvider(body.provider)) {
    return reply.status(400).send({ error: `Invalid provider: ${body.provider}` });
  }

  const credentialKey = LLM_CREDENTIAL_KEYS[body.provider];
  await setSecret(credentialKey, body.credential);

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'llm.credential_update',
    decision: 'allow',
    resource: { type: 'system', component: 'llm' },
    requestId: crypto.randomUUID(),
    metadata: { provider: body.provider },
  });

  return { ok: true };
});

app.delete('/llm/credentials/:provider', async (request, reply) => {
  const { provider } = request.params as { provider: string };

  const { hasProvider } = await import('./llm/providers/index.js');
  const { deleteSecret } = await import('./secretsService.js');
  const { LLM_CREDENTIAL_KEYS } = await import('./llm/types.js');

  if (!hasProvider(provider)) {
    return reply.status(400).send({ error: 'Invalid provider' });
  }

  const credentialKey = LLM_CREDENTIAL_KEYS[provider as keyof typeof LLM_CREDENTIAL_KEYS];
  await deleteSecret(credentialKey);

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: request.principal?.id || 'user',
    action: 'llm.credential_delete',
    decision: 'allow',
    resource: { type: 'system', component: 'llm' },
    requestId: crypto.randomUUID(),
    metadata: { provider },
  });

  return { ok: true };
});

// Intent classifier endpoint for proactive action validation
app.post('/llm/classify-intent', async (request, reply) => {
  const body = request.body as {
    sessionId?: string;
    proposalContext: string;
    userMessage: string;
  };

  if (!body?.proposalContext || !body?.userMessage) {
    return reply.status(400).send({ error: 'proposalContext and userMessage are required' });
  }

  const { classifyIntent } = await import('./llm/index.js');
  const result = await classifyIntent(body.proposalContext, body.userMessage, body.sessionId);

  return { result };
});

// Conversation summarization endpoint
app.post('/llm/summarize', async (request, reply) => {
  const body = request.body as {
    sessionId?: string;
    messages: Array<{ role: string; content: string }>;
  };

  if (!body?.messages || !Array.isArray(body.messages)) {
    return reply.status(400).send({ error: 'messages array is required' });
  }

  const { summarizeConversation } = await import('./llm/index.js');
  const result = await summarizeConversation(
    body.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
    body.sessionId,
  );

  return { result };
});

// ============================================================================
// End LLM Brain Endpoints
// ============================================================================

// ============================================================================
// User Preferences & Personalization Endpoints
// ============================================================================

app.get('/preferences', async (request) => {
  const { getOrCreatePreferences } = await import('./userPreferences.js');
  const { syncGoalCheckInsForUser } = await import('./goalCheckInService.js');
  const userId = request.principal?.id || 'default-user';
  await syncGoalCheckInsForUser(userId);
  const prefs = await getOrCreatePreferences(userId);
  return prefs;
});

app.put('/preferences/instructions', async (request, reply) => {
  const { updateCustomInstructions } = await import('./userPreferences.js');
  const userId = request.principal?.id || 'default-user';

  const body = request.body as {
    aboutUser?: string;
    responseStyle?: string;
  };

  if (body.aboutUser !== undefined && body.aboutUser.length > 2000) {
    return reply.status(400).send({ error: 'aboutUser exceeds 2000 character limit' });
  }

  if (body.responseStyle !== undefined && body.responseStyle.length > 1000) {
    return reply.status(400).send({ error: 'responseStyle exceeds 1000 character limit' });
  }

  const prefs = await updateCustomInstructions(userId, body);

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: userId,
    action: 'preferences.update_instructions',
    decision: 'allow',
    resource: { type: 'system', component: 'preferences' },
    requestId: crypto.randomUUID(),
  });

  return prefs;
});

app.put('/preferences/context', async (request) => {
  const { updateUserContext } = await import('./userPreferences.js');
  const userId = request.principal?.id || 'default-user';

  const body = request.body as {
    work?: { role?: string; industry?: string; typicalHours?: string; timezone?: string };
    personal?: { familyContext?: string; preferredContactTimes?: string };
  };

  const prefs = await updateUserContext(userId, body);

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: userId,
    action: 'preferences.update_context',
    decision: 'allow',
    resource: { type: 'system', component: 'preferences' },
    requestId: crypto.randomUUID(),
  });

  return prefs;
});

app.post('/preferences/goals', async (request, reply) => {
  const { addGoal } = await import('./userPreferences.js');
  const { syncGoalCheckInsForUser } = await import('./goalCheckInService.js');
  const userId = request.principal?.id || 'default-user';

  const body = request.body as {
    description: string;
    category: 'professional' | 'personal' | 'learning';
  };

  if (!body.description || !body.category) {
    return reply.status(400).send({ error: 'description and category are required' });
  }

  const prefs = await addGoal(userId, body);
  const syncResult = await syncGoalCheckInsForUser(userId);

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: userId,
    action: 'preferences.add_goal',
    decision: 'allow',
    resource: { type: 'system', component: 'preferences' },
    requestId: crypto.randomUUID(),
    metadata: { scheduledCheckIns: syncResult.scheduled },
  });

  return prefs;
});

app.delete('/preferences/goals/:goalId', async (request) => {
  const { getOrCreatePreferences, updateUserContext } = await import('./userPreferences.js');
  const userId = request.principal?.id || 'default-user';
  const { goalId } = request.params as { goalId: string };

  const prefs = await getOrCreatePreferences(userId);
  const newGoals = prefs.userContext.goals.filter(g => g.id !== goalId);

  const updated = await updateUserContext(userId, { goals: newGoals });

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: userId,
    action: 'preferences.remove_goal',
    decision: 'allow',
    resource: { type: 'system', component: 'preferences' },
    requestId: crypto.randomUUID(),
    metadata: { goalId },
  });

  return updated;
});

app.put('/preferences/enabled', async (request) => {
  const { setPersonalizationEnabled } = await import('./userPreferences.js');
  const userId = request.principal?.id || 'default-user';

  const body = request.body as { enabled: boolean };

  const prefs = await setPersonalizationEnabled(userId, body.enabled);

  return prefs;
});

app.get('/preferences/checkins', async (request) => {
  const { listGoalCheckIns } = await import('./goalCheckInService.js');
  const userId = request.principal?.id || 'default-user';
  const query = request.query as { status?: 'pending' | 'sent' };
  const checkIns = await listGoalCheckIns({
    userId,
    ...(query.status ? { status: query.status } : {}),
  });
  return { checkIns };
});

app.get('/preferences/onboarding-status', async (request) => {
  const { getOrCreatePreferences, needsOnboarding } = await import('./userPreferences.js');
  const userId = request.principal?.id || 'default-user';

  const prefs = await getOrCreatePreferences(userId);
  const needs = await needsOnboarding(userId);

  return {
    needsOnboarding: needs,
    phase: prefs.onboarding.phase,
    coveredTopics: prefs.onboarding.coveredTopics,
    completedAt: prefs.onboarding.completedAt,
  };
});

app.post('/preferences/onboarding/start', async (request) => {
  const { startOnboarding, getOrCreatePreferences } = await import('./userPreferences.js');
  const userId = request.principal?.id || 'default-user';

  await startOnboarding(userId);
  const prefs = await getOrCreatePreferences(userId);

  return { ok: true, phase: prefs.onboarding.phase };
});

app.post('/preferences/onboarding/complete', async (request) => {
  const { completeOnboarding, getOrCreatePreferences } = await import('./userPreferences.js');
  const userId = request.principal?.id || 'default-user';

  await completeOnboarding(userId);
  const prefs = await getOrCreatePreferences(userId);

  return { ok: true, completedAt: prefs.onboarding.completedAt };
});

app.post('/preferences/onboarding/topic', async (request, reply) => {
  const { completeOnboardingTopic, getOrCreatePreferences } = await import('./userPreferences.js');
  const userId = request.principal?.id || 'default-user';

  const body = request.body as { topic: 'work' | 'personal' | 'goals' };

  if (!['work', 'personal', 'goals'].includes(body.topic)) {
    return reply.status(400).send({ error: 'topic must be work, personal, or goals' });
  }

  await completeOnboardingTopic(userId, body.topic);
  const prefs = await getOrCreatePreferences(userId);

  return { ok: true, coveredTopics: prefs.onboarding.coveredTopics };
});

// ============================================================================
// End User Preferences Endpoints
// ============================================================================

app.post('/events/ingest', async (request, reply) => {
  const { ingestEvent } = await import('./eventBus.js');
  const body = request.body as { source: string; type: string; payload: any; id?: string };

  if (!body.source || !body.type) {
    return reply.status(400).send({ error: 'source and type required' });
  }

  const event = await ingestEvent(body.source, body.type, body.payload || {}, body.id);
  return { ok: true, eventId: event.id };
});

// Start Automation Service
import('./automationService.js').then(m => m.startAutomationService());
import('./goalCheckInService.js').then(m => m.startGoalCheckInService());

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

// Initial Session Seed
if (listSessions().length === 0) {
  const seed = createSession('default-user');
  console.log(`\n=== INITIAL SESSION CREATED ===`);
  console.log(`Session ID: ${seed.id}`);
  console.log(`Subject: ${seed.subject}`);
  console.log(`================================\n`);
}




app.post('/events', async (request, reply) => {
  // Webhook endpoint for external events (Proactivity Source)
  const body = request.body as { source: string; type: string; payload: any; id?: string };

  // Basic validation
  if (!body?.source || !body?.type) {
    return reply.status(400).send({ error: 'Missing source or type' });
  }

  // Ingest event
  await ingestEvent(body.source, body.type, body.payload || {}, body.id);

  return { ok: true };
});

app.listen({ port: runtimeConfig.port, host: runtimeConfig.bindAddress }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

// Run memory cleanup every minute
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

// Run audit retention every hour
setInterval(async () => {
  try {
    const deletedCount = await pruneAuditLog();
    if (deletedCount > 0) {
      console.log(`Pruned ${deletedCount} old audit log entries`);
    }
  } catch (error) {
    console.error('Audit pruning failed:', error);
  }
}, 3600000);
