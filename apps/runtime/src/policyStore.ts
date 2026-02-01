import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { PolicyStore, PolicyStoreSchema, SkillManifest, Grant } from '@polar/core';
import { runtimeConfig } from './config.js';
import { Mutex } from 'async-mutex';

const mutex = new Mutex();

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

export async function grantSkillPermissions(skillId: string, requestedCaps: SkillManifest['requestedCapabilities']): Promise<void> {
  await mutex.runExclusive(async () => {
    const policy = await loadPolicy();

    // Remove existing grants for this skill to avoid duplicates/stale grants
    policy.grants = policy.grants.filter(g => g.subject !== skillId);

    for (const cap of requestedCaps) {
      const grant: Grant = {
        id: crypto.randomUUID(),
        subject: skillId,
        action: cap.action,
        resource: cap.resource,
      };
      policy.grants.push(grant);
    }

    await savePolicy(policy);
  });
}

export async function revokeSkillPermissions(skillId: string): Promise<void> {
  await mutex.runExclusive(async () => {
    const policy = await loadPolicy();
    policy.grants = policy.grants.filter(g => g.subject !== skillId);
    await savePolicy(policy);
  });
}
