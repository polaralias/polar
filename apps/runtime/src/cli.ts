import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { PolicyStoreSchema } from '@polar/core';
import { runtimeConfig } from './config.js';

const command = process.argv[2];

async function init() {
  await fs.mkdir(runtimeConfig.dataDir, { recursive: true });

  try {
    await fs.access(runtimeConfig.signingKeyPath);
  } catch {
    const key = crypto.randomBytes(32).toString('base64');
    await fs.writeFile(runtimeConfig.signingKeyPath, key, 'utf-8');
    console.log(`Created signing key at ${runtimeConfig.signingKeyPath}`);
  }

  try {
    await fs.access(runtimeConfig.policyPath);
  } catch {
    const policy = { grants: [], rules: [] };
    await fs.writeFile(runtimeConfig.policyPath, JSON.stringify(policy, null, 2), 'utf-8');
    console.log(`Created policy file at ${runtimeConfig.policyPath}`);
  }

  try {
    await fs.access(runtimeConfig.auditPath);
  } catch {
    await fs.writeFile(runtimeConfig.auditPath, '', 'utf-8');
    console.log(`Created audit log at ${runtimeConfig.auditPath}`);
  }
}

async function doctor() {
  let ok = true;

  try {
    await fs.access(runtimeConfig.signingKeyPath);
    console.log('Signing key: OK');
  } catch {
    ok = false;
    console.error('Signing key: missing');
  }

  try {
    await fs.access(runtimeConfig.auditPath, fsConstants.W_OK);
    console.log('Audit log writable: OK');
  } catch {
    ok = false;
    console.error('Audit log writable: missing or not writable');
  }

  try {
    const raw = await fs.readFile(runtimeConfig.policyPath, 'utf-8');
    const parsed = PolicyStoreSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error('Invalid policy schema');
    }
    console.log('Policy file valid: OK');
  } catch {
    ok = false;
    console.error('Policy file valid: invalid or missing');
  }

  try {
    const response = await fetch(`${runtimeConfig.gatewayUrl}/health`);
    if (!response.ok) {
      throw new Error('Gateway not reachable');
    }
    console.log('Gateway reachable: OK');
  } catch {
    ok = false;
    console.error('Gateway reachable: failed');
  }

  if (!ok) {
    process.exit(1);
  }
}

if (command === 'init') {
  await init();
} else if (command === 'doctor') {
  await doctor();
} else {
  console.log('Usage: pnpm init | pnpm doctor');
  process.exit(1);
}
