import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { PolicyStoreSchema } from '@polar/core';
import { runtimeConfig } from './config.js';

const command = process.argv[2];

import prompts from 'prompts';

async function init() {
  console.log('\n❄️  Polar Platform Initialization ❄️\n');
  console.log('This wizard will set up the runtime environment for the Polar Platform.');
  console.log(`Target Data Directory: ${runtimeConfig.dataDir}\n`);

  const response = await prompts({
    type: 'confirm',
    name: 'proceed',
    message: 'Do you want to proceed with initialization?',
    initial: true,
  });

  if (!response.proceed) {
    console.log('❌ Initialization aborted.');
    process.exit(0);
  }

  console.log('\n🚀 Starting setup...\n');

  // 1. Initialise data directory
  await fs.mkdir(runtimeConfig.dataDir, { recursive: true });

  // 2. Generate runtime identity and signing keys
  try {
    await fs.access(runtimeConfig.signingKeyPath);
    console.log('✅ Signing key already exists.');
  } catch {
    const key = crypto.randomBytes(32).toString('base64');
    await fs.writeFile(runtimeConfig.signingKeyPath, key, { encoding: 'utf-8', mode: 0o600 });
    console.log(`✅ Created new signing key at ${runtimeConfig.signingKeyPath}`);
  }

  // 3. Set default deny-all policy
  try {
    await fs.access(runtimeConfig.policyPath);
    console.log('✅ Policy file already exists.');
  } catch {
    const policy = { grants: [], rules: [{ id: 'default-deny', effect: 'deny', reason: 'Default deny-all policy' }] };
    await fs.writeFile(runtimeConfig.policyPath, JSON.stringify(policy, null, 2), 'utf-8');
    console.log(`✅ Created default deny-all policy at ${runtimeConfig.policyPath}`);
  }

  // 4. Initialise audit log
  try {
    await fs.access(runtimeConfig.auditPath);
    console.log('✅ Audit log already exists.');
  } catch {
    await fs.writeFile(runtimeConfig.auditPath, '', 'utf-8');
    console.log(`✅ Created audit log at ${runtimeConfig.auditPath}`);
  }

  // 5. Initialise secrets store
  try {
    await fs.access(runtimeConfig.secretsPath);
    console.log('✅ Secrets store already exists.');
  } catch {
    await fs.writeFile(runtimeConfig.secretsPath, JSON.stringify({ secrets: {} }, null, 2), { encoding: 'utf-8', mode: 0o600 });
    console.log(`✅ Created secrets store at ${runtimeConfig.secretsPath}`);
  }

  console.log('\n✨ Configuration setup complete.');

  // 6. Verify gateway connectivity
  const gwCheck = await prompts({
    type: 'confirm',
    name: 'check',
    message: 'Do you want to verify Gateway connectivity now?',
    initial: true
  });

  if (gwCheck.check) {
    try {
      const response = await fetch(`${runtimeConfig.gatewayUrl}/health`);
      if (response.ok) {
        console.log('✅ Gateway connectivity verified.');
      } else {
        console.log('⚠️ Gateway found but returned error status.');
      }
    } catch {
      console.log('⚠️ Gateway not reachable. Ensure it is running for the platform to be fully functional.');
    }
  }

  console.log('\n🎉  Polar is ready to use!');
}

async function doctor() {
  const { runDiagnostics } = await import('./doctorService.js');
  const results = await runDiagnostics();

  let failed = false;
  for (const res of results) {
    const icon = res.status === 'OK' ? '✅' : res.status === 'WARNING' ? '⚠️' : '❌';
    console.log(`${icon} ${res.name}: ${res.message}`);
    if (res.remediation) {
      console.log(`   Remediation: ${res.remediation}`);
    }
    if (res.status === 'CRITICAL') failed = true;
  }

  if (failed) {
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
