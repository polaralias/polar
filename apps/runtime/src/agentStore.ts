import { Agent, AgentRole, AgentStatus } from '@polar/core';
import crypto from 'node:crypto';

export type ExtendedAgent = Agent & { spawnDepth: number; parentAgentId: string | undefined };

const agents = new Map<string, ExtendedAgent>();

export function createAgent(params: {
    role: AgentRole;
    sessionId: string;
    userId: string;
    skillId?: string | undefined;
    templateId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    parentAgentId?: string | undefined;
    spawnDepth?: number | undefined;
}): ExtendedAgent {
    const agent: ExtendedAgent = {
        id: crypto.randomUUID(),
        role: params.role,
        status: 'pending',
        sessionId: params.sessionId,
        userId: params.userId,
        skillId: params.skillId,
        templateId: params.templateId,
        createdAt: new Date().toISOString(),
        metadata: params.metadata,
        parentAgentId: params.parentAgentId,
        spawnDepth: params.spawnDepth ?? 0,
    };
    agents.set(agent.id, agent);
    return agent;
}

export function updateAgentStatus(id: string, status: AgentStatus): Agent | undefined {
    const agent = agents.get(id);
    if (!agent) return undefined;

    agent.status = status;
    if (status === 'completed' || status === 'failed' || status === 'terminated') {
        agent.terminatedAt = new Date().toISOString();
    }

    agents.set(id, agent);
    return agent;
}

export function getAgent(id: string): Agent | undefined {
    return agents.get(id);
}

export function listAgents(sessionId?: string): Agent[] {
    const allAgents = Array.from(agents.values());
    if (sessionId) {
        return allAgents.filter(a => a.sessionId === sessionId);
    }
    return allAgents;
}

export function deleteAgent(id: string): boolean {
    return agents.delete(id);
}
