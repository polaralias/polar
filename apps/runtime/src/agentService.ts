import crypto from 'node:crypto';
import {
    Agent,
    AgentRole,
    CoordinationPattern,
    CoordinationEvent,
    AuditEvent
} from '@polar/core';
import { createAgent, updateAgentStatus } from './agentStore.js';
import { startWorker, stopWorker } from './workerRuntime.js';
import { appendAudit } from './audit.js';

export async function spawnAgent(params: {
    role: AgentRole;
    sessionId: string;
    userId: string;
    skillId?: string | undefined;
    templateId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}): Promise<Agent> {
    const agent = createAgent(params);

    await appendAudit({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        subject: `system`,
        action: 'agent.spawn',
        decision: 'allow',
        resource: { type: 'agent' },
        sessionId: params.sessionId,
        agentId: agent.id,
        role: agent.role,
        skillId: params.skillId,
        metadata: { ...params.metadata }
    });

    // Trigger the actual worker process
    await startWorker(agent);

    return agent;
}

export async function terminateAgent(id: string, reason: string): Promise<boolean> {
    stopWorker(id);
    const agent = updateAgentStatus(id, 'terminated');
    if (!agent) return false;

    await appendAudit({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        subject: 'system',
        action: 'agent.terminate',
        decision: 'allow',
        resource: { type: 'agent' },
        sessionId: agent.sessionId,
        agentId: agent.id,
        role: agent.role,
        reason,
    });

    return true;
}

export async function proposeCoordination(params: {
    pattern: CoordinationPattern;
    initiatorAgentId: string;
    targetSpecs: Array<{
        role: AgentRole;
        skillId?: string;
        templateId?: string;
        metadata?: Record<string, unknown>;
    }>;
    sessionId: string;
    userId: string;
}): Promise<CoordinationEvent> {
    // 1. Create Coordination Event
    const event: CoordinationEvent = {
        id: crypto.randomUUID(),
        pattern: params.pattern,
        initiatorAgentId: params.initiatorAgentId,
        targetAgentIds: [],
        status: 'proposed',
        metadata: {},
    };

    // 2. Audit Proposal
    await appendAudit({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        subject: params.initiatorAgentId,
        action: 'coordination.propose',
        decision: 'allow',
        resource: { type: 'coordination' },
        sessionId: params.sessionId,
        agentId: params.initiatorAgentId,
        metadata: { pattern: params.pattern, targetCount: params.targetSpecs.length }
    });

    // 3. Spawn Target Agents
    const targetIds: string[] = [];
    for (const spec of params.targetSpecs) {
        const agent = await spawnAgent({
            ...spec,
            sessionId: params.sessionId,
            userId: params.userId,
        });
        targetIds.push(agent.id);
    }

    event.targetAgentIds = targetIds;
    event.status = 'active';

    // 4. Audit Activation
    await appendAudit({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        subject: 'system',
        action: 'coordination.start',
        decision: 'allow',
        resource: { type: 'coordination' },
        sessionId: params.sessionId,
        metadata: { eventId: event.id, targets: targetIds }
    });

    return event;
}
