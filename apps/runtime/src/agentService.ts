import crypto from 'node:crypto';
import {
    Agent,
    AgentRole,
    CoordinationPattern,
    CoordinationEvent,
    AuditEvent
} from '@polar/core';
import { createAgent, updateAgentStatus, ExtendedAgent } from './agentStore.js';
import { listAgents } from './agentStore.js';
import { startWorker, stopWorker } from './workerRuntime.js';
import { appendAudit } from './audit.js';
import { runtimeConfig } from './config.js';

// Role capability constraints - workers have fewer privileges than main agents
const ROLE_CAPABILITY_LIMITS: Record<AgentRole, {
    canSpawnAgents: boolean;
    canAccessMemory: boolean;
    canCoordinate: boolean;
    maxConcurrentTasks: number;
}> = {
    main: { canSpawnAgents: true, canAccessMemory: true, canCoordinate: true, maxConcurrentTasks: 10 },
    coordinator: { canSpawnAgents: true, canAccessMemory: true, canCoordinate: true, maxConcurrentTasks: 20 },
    worker: { canSpawnAgents: false, canAccessMemory: false, canCoordinate: false, maxConcurrentTasks: 1 },
    external: { canSpawnAgents: false, canAccessMemory: false, canCoordinate: false, maxConcurrentTasks: 1 },
};

export function getRoleCapabilities(role: AgentRole) {
    return ROLE_CAPABILITY_LIMITS[role];
}

export async function spawnAgent(params: {
    role: AgentRole;
    sessionId: string;
    userId: string;
    skillId?: string | undefined;
    templateId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    parentAgentId?: string | undefined;
}): Promise<ExtendedAgent> {
    // Calculate spawn depth from parent
    let spawnDepth = 0;
    if (params.parentAgentId) {
        const parentAgent = listAgents(params.sessionId).find(a => a.id === params.parentAgentId);
        if (parentAgent && 'spawnDepth' in parentAgent) {
            spawnDepth = (parentAgent as ExtendedAgent).spawnDepth + 1;
        }
    }

    // Enforce spawn depth limit
    if (spawnDepth > runtimeConfig.maxAgentSpawnDepth) {
        throw new Error(`Agent spawn depth limit exceeded (max: ${runtimeConfig.maxAgentSpawnDepth})`);
    }

    // Enforce session agent limit
    const sessionAgents = listAgents(params.sessionId).filter(
        a => a.status !== 'terminated' && a.status !== 'completed' && a.status !== 'failed'
    );
    if (sessionAgents.length >= runtimeConfig.maxAgentsPerSession) {
        throw new Error(`Session agent limit exceeded (max: ${runtimeConfig.maxAgentsPerSession})`);
    }

    // Enforce role-based spawn restrictions
    if (params.parentAgentId) {
        const parentAgent = listAgents(params.sessionId).find(a => a.id === params.parentAgentId);
        if (parentAgent) {
            const parentCaps = ROLE_CAPABILITY_LIMITS[parentAgent.role];
            if (!parentCaps.canSpawnAgents) {
                throw new Error(`Agent role '${parentAgent.role}' is not permitted to spawn child agents`);
            }
        }
    }

    const agent = createAgent({
        ...params,
        spawnDepth,
        parentAgentId: params.parentAgentId,
    });

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
        metadata: { ...params.metadata, spawnDepth, parentAgentId: params.parentAgentId }
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
    // Check if initiator has coordination permission
    const initiator = listAgents(params.sessionId).find(a => a.id === params.initiatorAgentId);
    if (initiator) {
        const initiatorCaps = ROLE_CAPABILITY_LIMITS[initiator.role];
        if (!initiatorCaps.canCoordinate) {
            throw new Error(`Agent role '${initiator.role}' is not permitted to coordinate other agents`);
        }
    }

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

    // 3. Spawn Target Agents (with parent tracking for depth limits)
    const targetIds: string[] = [];
    for (const spec of params.targetSpecs) {
        const agent = await spawnAgent({
            ...spec,
            sessionId: params.sessionId,
            userId: params.userId,
            parentAgentId: params.initiatorAgentId, // Track spawn hierarchy
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
