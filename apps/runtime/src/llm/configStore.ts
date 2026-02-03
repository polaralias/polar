/**
 * LLM Configuration Store
 * Manages LLM configuration persistence in the system store
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { runtimeConfig } from '../config.js';
import { LLMConfig, LLMConfigSchema, DEFAULT_LLM_CONFIG } from './types.js';

const mutex = new Mutex();
const CONFIG_FILE = path.join(runtimeConfig.dataDir, 'llm_config.json');

/**
 * Load LLM configuration from disk
 */
export async function loadLLMConfig(): Promise<LLMConfig> {
    try {
        const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
        const data = JSON.parse(raw);
        const parsed = LLMConfigSchema.safeParse(data);

        if (parsed.success) {
            return parsed.data;
        }

        console.warn('Invalid LLM config on disk, using defaults:', parsed.error);
        return DEFAULT_LLM_CONFIG;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return DEFAULT_LLM_CONFIG;
        }
        console.error('Failed to load LLM config:', error);
        return DEFAULT_LLM_CONFIG;
    }
}

/**
 * Save LLM configuration to disk
 */
export async function saveLLMConfig(config: LLMConfig): Promise<void> {
    await mutex.runExclusive(async () => {
        // Validate before saving
        const parsed = LLMConfigSchema.safeParse(config);
        if (!parsed.success) {
            throw new Error(`Invalid LLM config: ${parsed.error.message}`);
        }

        await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
        const tempPath = `${CONFIG_FILE}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(parsed.data, null, 2), 'utf-8');
        await fs.rename(tempPath, CONFIG_FILE);
    });
}

/**
 * Update specific fields in the LLM configuration
 */
export async function updateLLMConfig(updates: Partial<LLMConfig>): Promise<LLMConfig> {
    return await mutex.runExclusive(async () => {
        const current = await loadLLMConfig();
        const updated: LLMConfig = {
            ...current,
            ...updates,
            parameters: {
                ...current.parameters,
                ...updates.parameters,
            },
            subAgentModels: {
                ...current.subAgentModels,
                ...updates.subAgentModels,
            },
        };

        await saveLLMConfig(updated);
        return updated;
    });
}

/**
 * Reset LLM configuration to defaults
 */
export async function resetLLMConfig(): Promise<LLMConfig> {
    await saveLLMConfig(DEFAULT_LLM_CONFIG);
    return DEFAULT_LLM_CONFIG;
}
