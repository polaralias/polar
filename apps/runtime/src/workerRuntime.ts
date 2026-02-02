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

const activeProcesses = new Map<string, ChildProcess>();

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
        // For agents without a skill, we assume they are purely virtual or orchestrated by the system
        // unless we have a default worker.
        // Given the requirement "Worker Execution is Mocked" -> "updates status but does not start a process",
        // we should probably only start a process if we have code to run.
        // If there is no skillId, we'll leave it as is (or maybe we shouldn't fail it?)
        // The matrix gap specifically talks about "Worker Runtime implementation".
        // Let's assume for now valid agents have skills or templates.
        console.warn(`No skillId for agent ${agent.id}, skipping process spawn.`);
        return;
    }

    // 2. Mint Token
    // We give the agent a token to interact with the runtime via a dedicated IPC channel.
    // SECURITY: This token is constrained to the 'runtime.workerChannel' action only,
    // preventing it from being used for any privileged gateway operations.
    // We include policy version to ensure revocation works correctly.
    const { getSubjectPolicyVersion } = await import('./policyStore.js');
    const policyVersion = await getSubjectPolicyVersion(agent.id);

    const capability: Capability = {
        id: crypto.randomUUID(),
        subject: agent.id,
        action: 'runtime.workerChannel', // Constrained to worker IPC only
        resource: { type: 'system', components: ['runtime'] },
        expiresAt: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
    };

    const signingKey = await readSigningKey();
    const token = await mintCapabilityToken(capability, signingKey, policyVersion);

    await appendAudit({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        subject: agent.userId,
        action: 'worker.spawn',
        decision: 'allow',
        resource: { type: 'system', component: 'worker' },
        agentId: agent.id,
        requestId: capability.id, // Linking ID
        metadata: {
            skillId: agent.skillId,
            templateId: agent.templateId,
        }
    });

    // 3. Spawn
    // using fork ensures it runs in a separate process but with IPC channel if needed
    const child = fork(entryPoint, [], {
        env: {
            ...process.env,
            POLAR_RUNTIME_URL: `http://localhost:${runtimeConfig.port}`, // e.g. http://localhost:4000
            POLAR_AGENT_TOKEN: token,
            POLAR_AGENT_ID: agent.id,
            POLAR_SESSION_ID: agent.sessionId,
            POLAR_WORKER_TEMPLATE_ID: agent.templateId || '',
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
