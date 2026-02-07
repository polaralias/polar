import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { PolicyStore, PolicyStoreSchema, SkillManifest, Grant, PolicyRule } from '@polar/core';
import { runtimeConfig } from './config.js';
import { Mutex } from 'async-mutex';

const mutex = new Mutex();

function isLegacyDefaultDenyRule(rule: PolicyRule): boolean {
  return (
    rule.effect === 'deny' &&
    (rule.id === 'default-deny' || rule.id === 'default-deny-all') &&
    !rule.subject &&
    !rule.action &&
    !rule.resource
  );
}

export async function loadPolicy(): Promise<PolicyStore> {
  try {
    const raw = await fs.readFile(runtimeConfig.policyPath, 'utf-8');
    const parsed = PolicyStoreSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error('Invalid policy schema');
    }
    return {
      ...parsed.data,
      // Migrate away from legacy unconditional deny defaults that block all grants.
      rules: parsed.data.rules.filter((rule) => !isLegacyDefaultDenyRule(rule)),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // No grants means deny-by-default in evaluatePolicy.
      return {
        grants: [],
        rules: [],
      };
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

export async function grantSkillPermissions(
  skillId: string,
  requestedCaps: SkillManifest['requestedCapabilities'],
  subset?: string[],
  requiresConfirmationActions?: string[],
): Promise<void> {
  await mutex.runExclusive(async () => {
    const policy = await loadPolicy();

    // Validate subset if provided
    let capsToGrant = requestedCaps;
    if (subset) {
      // Security check: Ensure we are only granting what was requested
      const requestedActions = new Set(requestedCaps.map(c => c.action));
      const invalid = subset.filter(s => !requestedActions.has(s));
      if (invalid.length > 0) {
        throw new Error(`Cannot grant unrequested capabilities: ${invalid.join(', ')}`);
      }

      capsToGrant = requestedCaps.filter(c => subset.includes(c.action));
    }

    const confirmationSet = new Set(requiresConfirmationActions || []);
    const requestedActions = new Set(requestedCaps.map(c => c.action));
    const invalidConfirmation = Array.from(confirmationSet).filter(action => !requestedActions.has(action));
    if (invalidConfirmation.length > 0) {
      throw new Error(`Cannot require confirmation for unrequested capabilities: ${invalidConfirmation.join(', ')}`);
    }

    // Remove existing grants for this skill to avoid duplicates/stale grants
    policy.grants = policy.grants.filter(g => g.subject !== skillId);

    for (const cap of capsToGrant) {
      const grant: Grant = {
        id: crypto.randomUUID(),
        subject: skillId,
        action: cap.action,
        resource: cap.resource,
        requiresConfirmation: confirmationSet.has(cap.action) || cap.requiresConfirmation === true,
      };
      policy.grants.push(grant);
    }

    // Bump version
    if (!policy.policyVersions) policy.policyVersions = {};
    const currentVer = policy.policyVersions[skillId] ?? 0;
    policy.policyVersions[skillId] = currentVer + 1;

    await savePolicy(policy);
  });
}

export async function revokeSkillPermissions(skillId: string): Promise<void> {
  await mutex.runExclusive(async () => {
    const policy = await loadPolicy();
    policy.grants = policy.grants.filter(g => g.subject !== skillId);

    // Bump version to invalidate existing tokens
    if (!policy.policyVersions) policy.policyVersions = {};
    const currentVer = policy.policyVersions[skillId] ?? 0;
    policy.policyVersions[skillId] = currentVer + 1;

    await savePolicy(policy);
  });
}

export async function getSubjectPolicyVersion(subject: string): Promise<number> {
  const policy = await loadPolicy();
  return policy.policyVersions?.[subject] ?? 0;
}
