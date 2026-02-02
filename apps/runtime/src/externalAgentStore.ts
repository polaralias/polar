import fs from 'node:fs/promises';
import { ExternalAgentPrincipal, ExternalAgentPrincipalSchema } from '@polar/core';
import { runtimeConfig } from './config.js';
import { Mutex } from 'async-mutex';

const mutex = new Mutex();
const EXTERNAL_AGENTS_FILE = runtimeConfig.externalAgentsPath;

export async function loadExternalAgents(): Promise<ExternalAgentPrincipal[]> {
    try {
        const raw = await fs.readFile(EXTERNAL_AGENTS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];

        return data
            .map((item) => {
                const parsed = ExternalAgentPrincipalSchema.safeParse(item);
                return parsed.success ? parsed.data : null;
            })
            .filter((a): a is ExternalAgentPrincipal => a !== null);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

export async function saveExternalAgents(agents: ExternalAgentPrincipal[]): Promise<void> {
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    const tempPath = `${EXTERNAL_AGENTS_FILE}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(agents, null, 2), 'utf-8');
    await fs.rename(tempPath, EXTERNAL_AGENTS_FILE);
}

export async function registerExternalAgent(agent: ExternalAgentPrincipal): Promise<void> {
    await mutex.runExclusive(async () => {
        const agents = await loadExternalAgents();
        const existingIndex = agents.findIndex((a) => a.id === agent.id);

        if (existingIndex >= 0) {
            agents[existingIndex] = agent;
        } else {
            agents.push(agent);
        }

        await saveExternalAgents(agents);
    });
}

export async function getExternalAgent(id: string): Promise<ExternalAgentPrincipal | undefined> {
    const agents = await loadExternalAgents();
    return agents.find((a) => a.id === id);
}

export async function removeExternalAgent(id: string): Promise<void> {
    await mutex.runExclusive(async () => {
        const agents = await loadExternalAgents();
        const filtered = agents.filter(a => a.id !== id);
        await saveExternalAgents(filtered);
    });
}
