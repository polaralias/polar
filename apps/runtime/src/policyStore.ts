import fs from 'node:fs/promises';
import { PolicyStore, PolicyStoreSchema } from '@polar/core';
import { runtimeConfig } from './config.js';

export async function loadPolicy(): Promise<PolicyStore> {
  try {
    const raw = await fs.readFile(runtimeConfig.policyPath, 'utf-8');
    const parsed = PolicyStoreSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error('Invalid policy schema');
    }
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { grants: [], rules: [] };
    }
    throw error;
  }
}

export async function savePolicy(policy: PolicyStore): Promise<void> {
  const parsed = PolicyStoreSchema.safeParse(policy);
  if (!parsed.success) {
    throw new Error('Invalid policy schema');
  }

  await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
  const tempPath = `${runtimeConfig.policyPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(parsed.data, null, 2), 'utf-8');
  await fs.rename(tempPath, runtimeConfig.policyPath);
}
