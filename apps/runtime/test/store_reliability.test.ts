import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const tempDir = path.join(os.tmpdir(), `polar-runtime-store-test-${Date.now()}`);
process.env.RUNTIME_DATA_DIR = tempDir;

let loadPolicy: () => Promise<{ grants: unknown[]; rules: Array<{ id: string; effect: string }> }>;
let updateChannel: (config: {
  id: string;
  type: 'slack' | 'discord' | 'webhook' | 'email' | 'telegram';
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
  allowlist: string[];
}) => Promise<void>;
let createAutomation: (def: {
  name: string;
  description: string;
  ownerId: string;
  enabled: boolean;
  tier: 'informational' | 'intent_completion' | 'delegated' | 'autonomous';
  trigger: { type: 'event' | 'schedule' | 'webhook'; source?: string; filter?: Record<string, unknown> };
  action: { skillId: string; templateId: string; args?: Record<string, unknown> };
}) => Promise<{ id: string }>;
let loadAutomations: () => Promise<void>;
let registerSkill: (manifest: {
  id: string;
  name: string;
  version: string;
  requestedCapabilities: [];
}, skillPath: string, hash: string, signature?: unknown) => Promise<{ skill: { provenance?: { trustLevel: string } } }>;
let uninstallSkill: (id: string, options?: { deleteFiles?: boolean }) => Promise<void>;

describe('runtime store reliability', () => {
  beforeAll(async () => {
    const policyStore = await import('../src/policyStore.js');
    const channelStore = await import('../src/channelStore.js');
    const automationService = await import('../src/automationService.js');
    const skillStore = await import('../src/skillStore.js');

    loadPolicy = policyStore.loadPolicy as unknown as () => Promise<{ grants: unknown[]; rules: Array<{ id: string; effect: string }> }>;
    updateChannel = channelStore.updateChannel;
    createAutomation = automationService.createAutomation as unknown as (def: {
      name: string;
      description: string;
      ownerId: string;
      enabled: boolean;
      tier: 'informational' | 'delegated' | 'autonomous' | 'critical';
      trigger: { type: 'event' | 'schedule' | 'webhook'; source?: string; filter?: Record<string, unknown> };
      action: { skillId: string; templateId: string; args?: Record<string, unknown> };
    }) => Promise<{ id: string }>;
    loadAutomations = automationService.loadAutomations;
    registerSkill = skillStore.registerSkill as unknown as (manifest: {
      id: string;
      name: string;
      version: string;
      requestedCapabilities: [];
    }, skillPath: string, hash: string, signature?: unknown) => Promise<{ skill: { provenance?: { trustLevel: string } } }>;
    uninstallSkill = skillStore.uninstallSkill as unknown as (id: string, options?: { deleteFiles?: boolean }) => Promise<void>;
  });

  beforeEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
    await loadAutomations();
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loadPolicy strips legacy default deny rule', async () => {
    const policyPath = path.join(tempDir, 'policy.json');
    await fs.writeFile(
      policyPath,
      JSON.stringify({
        grants: [],
        rules: [{ id: 'default-deny-all', effect: 'deny', reason: 'legacy default' }],
      }),
      'utf-8',
    );

    const policy = await loadPolicy();
    expect(policy.rules).toEqual([]);
  });

  it('channel store creates data directory before write', async () => {
    await updateChannel({
      id: 'channel-1',
      type: 'slack',
      name: 'Ops',
      enabled: true,
      credentials: {},
      allowlist: [],
    });

    const channelsPath = path.join(tempDir, 'channels.json');
    const exists = await fs.access(channelsPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('automation store creates data directory before write', async () => {
    const automation = await createAutomation({
      name: 'auto-1',
      description: 'test',
      ownerId: 'user',
      enabled: true,
      tier: 'informational',
      trigger: { type: 'event', source: 'unit-test' },
      action: { skillId: 'skill-1', templateId: 'template-1', args: {} },
    });

    expect(automation.id).toBeTruthy();

    const automationsPath = path.join(tempDir, 'automations.json');
    const exists = await fs.access(automationsPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('registerSkill treats unsigned local install as locally trusted', async () => {
    const skillDir = path.join(tempDir, 'skills', 'unsigned-demo');
    await fs.mkdir(skillDir, { recursive: true });

    const { skill } = await registerSkill(
      {
        id: 'unsigned.local.skill',
        name: 'Unsigned Local Skill',
        version: '1.0.0',
        requestedCapabilities: [],
      },
      skillDir,
      'hash-value',
    );

    expect(skill.provenance?.trustLevel).toBe('locally_trusted');
  });

  it('uninstallSkill respects deleteFiles=false', async () => {
    const skillDir = path.join(tempDir, 'skills', 'keep-files-skill');
    await fs.mkdir(skillDir, { recursive: true });

    await registerSkill(
      {
        id: 'keep.files.skill',
        name: 'Keep Files Skill',
        version: '1.0.0',
        requestedCapabilities: [],
      },
      skillDir,
      'hash-value',
    );

    await uninstallSkill('keep.files.skill', { deleteFiles: false });

    const exists = await fs.access(skillDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
