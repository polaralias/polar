import { fork, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { Agent, Capability, mintCapabilityToken } from '@polar/core';
import { runtimeConfig } from './config.js';
import { readSigningKey } from './crypto.js';
import { getSkill } from './skillStore.js';
import { updateAgentStatus } from './agentStore.js';
import { appendAudit } from './audit.js';
import { registerTokenTraceContext } from './tokenTraceStore.js';

const activeProcesses = new Map<string, ChildProcess>();

export function resolveWorkerPolicyVersionSubject(agent: Agent): string {
    // Worker tokens should be revoked when the spawning principal's policy changes.
    return agent.userId;
}

export async function startWorker(agent: Agent): Promise<void> {
    // 1. Determine Entry Point
    let entryPoint: string | undefined;

    if (agent.skillId) {
        const skill = await getSkill(agent.skillId);
        if (!skill) {
            console.error(`Skill ${agent.skillId} not found for agent ${agent.id}`);
            updateAgentStatus(agent.id, 'failed');
            return;
        }

        // Check if enabled
        if (skill.status !== 'enabled') {
            console.error(`Skill ${agent.skillId} is not enabled.`);
            updateAgentStatus(agent.id, 'failed');
            return;
        }

        // Resolve entry point
        const pkgPath = path.join(skill.path, 'package.json');
        try {
            const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
            const pkg = JSON.parse(pkgRaw);
            if (pkg.main) {
                entryPoint = path.resolve(skill.path, pkg.main);
            }
        } catch (e) {
            // No package.json, try index.js
        }

        if (!entryPoint) {
            entryPoint = path.join(skill.path, 'index.js');
        }

        // Verify it exists
        try {
            await fs.access(entryPoint);
        } catch {
            console.error(`Entry point not found for skill ${agent.skillId} at ${entryPoint}`);
            updateAgentStatus(agent.id, 'failed');
            return;
        }

    } else {
        // Fallback for Instruction-Only Skills (Virtual Workers)
        // If no skill provided, or no code found, we treat it as a Virtual Worker.
        console.log(`No specific entry point for agent ${agent.id}. Treating as Virtual Worker.`);

        // Spawn a placeholder process that stays alive until killed, 
        // representing the "Thinking" state of the LLM worker.
        // In a real implementation, this would be the `llm-worker` service.
        const child = fork('-e', ['setInterval(() => {}, 10000)'], {
            env: { ...process.env }, // minimalistic env
            stdio: 'ignore'
        });
        activeProcesses.set(agent.id, child);
        updateAgentStatus(agent.id, 'running');

        // We do NOT mint a token for the process itself if it's virtual/placeholder, 
        // as the Runtime/LLMService acts on its behalf.
        return;
    }

    // 2. Validate and Mint Token with Requested Capabilities
    // CRITICAL FIX: Workers now receive tokens with their requested capabilities,
    // not just runtime.workerChannel. This enables workers to perform external tasks.
    const { getSubjectPolicyVersion, loadPolicy } = await import('./policyStore.js');
    const policyVersion = await getSubjectPolicyVersion(resolveWorkerPolicyVersionSubject(agent));

    // Extract requested capabilities from agent metadata
    const requestedCapabilities = (agent.metadata?.capabilities as string[]) || [];
    const isReadOnly = agent.metadata?.readOnly !== false; // Default to read-only

    // Filter capabilities: if read-only, only allow *.read actions
    let allowedCapabilities = requestedCapabilities;
    if (isReadOnly) {
        allowedCapabilities = requestedCapabilities.filter(cap =>
            cap.endsWith('.read') || cap === 'runtime.workerChannel'
        );
        if (allowedCapabilities.length !== requestedCapabilities.length) {
            console.warn(`Worker ${agent.id} restricted to read-only: ${allowedCapabilities.join(', ')}`);
        }
    }

    // Policy evaluation: Verify the spawning user/agent has grants for these capabilities
    const policy = await loadPolicy();
    const userId = agent.userId;
    const userGrants = policy.grants.filter(g => g.subject === userId);
    const userGrantByAction = new Map(userGrants.map(grant => [grant.action, grant]));
    const userGrantedActions = new Set(userGrants.map(g => g.action));

    // Only allow capabilities that the parent has been granted (prevents privilege escalation)
    const validatedCapabilities = allowedCapabilities.filter(cap => {
        if (cap === 'runtime.workerChannel') return true; // Always allow IPC
        const hasGrant = userGrantedActions.has(cap);
        if (!hasGrant) {
            console.warn(`Worker ${agent.id}: capability ${cap} denied - user lacks grant`);
        }
        return hasGrant;
    });

    // Always include runtime.workerChannel for IPC
    if (!validatedCapabilities.includes('runtime.workerChannel')) {
        validatedCapabilities.push('runtime.workerChannel');
    }

    const signingKey = await readSigningKey();

    // Mint separate tokens for each capability
    const tokens: string[] = [];
    const timestamp = Math.floor(Date.now() / 1000);
    const traceId = typeof agent.metadata?.traceId === 'string' ? agent.metadata.traceId : undefined;
    const plannerToolCallId = typeof agent.metadata?.plannerToolCallId === 'string' ? agent.metadata.plannerToolCallId : undefined;
    const parentEventId = plannerToolCallId || traceId;

    for (const action of validatedCapabilities) {
        // Determine TTL based on action type
        // Read-only: 60 mins, Write/Execute: 15 mins
        const isRead = action.endsWith('.read') || action === 'runtime.workerChannel';
        const ttlSeconds = isRead ? 60 * 60 : 15 * 60;

        // Resource constraint:
        // Must be derived from the skill manifest or template definition.
        // For now, we default to stricter than '*' but still need manifest integration
        // in Phase 3. In Phase 2 patch, we at least stop minting '*' for everything.
        // IPC channel gets 'system' resource.
        let resource: Capability['resource'];

        if (action === 'runtime.workerChannel') {
            resource = { type: 'system', components: ['worker'] };
        } else {
            // Use the resource from the user's grant if available, otherwise fallback to skill scope
            const grant = userGrants.find(g => g.action === action);
            if (grant && grant.resource) {
                resource = grant.resource;
            } else {
                resource = { type: 'skill', components: [agent.skillId || 'unknown'] };
            }
        }

        const capability: Capability = {
            id: crypto.randomUUID(),
            subject: agent.id,
            action,
            resource,
            requiresConfirmation: userGrantByAction.get(action)?.requiresConfirmation === true,
            expiresAt: timestamp + ttlSeconds,
        };
        registerTokenTraceContext({
            jti: capability.id,
            sessionId: agent.sessionId,
            agentId: agent.id,
            ...(traceId ? { traceId } : {}),
            ...(parentEventId ? { parentEventId } : {}),
        });
        const token = await mintCapabilityToken(capability, signingKey, policyVersion);
        tokens.push(token);
    }

    const combinedToken = tokens.join(',');

    await appendAudit({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        subject: agent.userId,
        action: 'worker.spawn',
        decision: 'allow',
        resource: { type: 'system', component: 'worker' },
        agentId: agent.id,
        requestId: (agent.metadata?.requestId as string) || crypto.randomUUID(), // Linking ID
        metadata: {
            skillId: agent.skillId,
            templateId: agent.templateId,
            grantedCapabilities: validatedCapabilities,
            requestedCapabilities,
            readOnly: isReadOnly,
        }
    });

    // 3. Spawn
    // using fork ensures it runs in a separate process but with IPC channel if needed
    const child = fork(entryPoint, [], {
        env: {
            ...process.env,
            POLAR_RUNTIME_URL: `http://localhost:${runtimeConfig.port}`, // e.g. http://localhost:4000
            POLAR_GATEWAY_URL: runtimeConfig.gatewayUrl,
            POLAR_AGENT_TOKEN: combinedToken,
            POLAR_AGENT_ID: agent.id,
            POLAR_SESSION_ID: agent.sessionId,
            POLAR_WORKER_TEMPLATE_ID: agent.templateId || '',
            POLAR_AGENT_METADATA: JSON.stringify(agent.metadata || {}),
        },
        stdio: 'inherit', // Stream logs to parent
    });

    activeProcesses.set(agent.id, child);

    child.on('exit', (code) => {
        // If the process is not in the map, it means it was manually stopped (removed in stopWorker)
        if (!activeProcesses.has(agent.id)) return;

        console.log(`Agent ${agent.id} exited with code ${code}`);
        updateAgentStatus(agent.id, code === 0 ? 'completed' : 'failed');
        activeProcesses.delete(agent.id);
    });

    child.on('error', (err) => {
        console.error(`Agent ${agent.id} process error:`, err);
        updateAgentStatus(agent.id, 'failed');
    });

    updateAgentStatus(agent.id, 'running');
}

export function stopWorker(agentId: string): boolean {
    const child = activeProcesses.get(agentId);
    if (child) {
        // Remove from map first to prevent exit handler from overwriting status
        activeProcesses.delete(agentId);
        child.kill();
        return true;
    }
    return false;
}
