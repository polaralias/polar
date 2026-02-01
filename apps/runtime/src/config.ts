import path from 'node:path';

const baseDir = process.cwd();
const dataDir = process.env.RUNTIME_DATA_DIR
  ? path.resolve(process.env.RUNTIME_DATA_DIR)
  : path.resolve(baseDir, 'data');
const fsBaseDir = process.env.FS_BASE_DIR
  ? path.resolve(process.env.FS_BASE_DIR)
  : path.resolve(baseDir, '..', '..', 'sandbox');

export const runtimeConfig = {
  port: Number(process.env.RUNTIME_PORT ?? 4000),
  gatewayUrl: process.env.GATEWAY_URL ?? 'http://localhost:4001',
  deploymentProfile: (process.env.DEPLOYMENT_PROFILE ?? 'local') as 'local' | 'cloud' | 'edge',
  dataDir,
  policyPath: path.join(dataDir, 'policy.json'),
  auditPath: path.join(dataDir, 'audit.ndjson'),
  signingKeyPath: path.join(dataDir, 'signing.key'),
  secretsPath: path.join(dataDir, 'secrets.json'),
  capabilityTtlSeconds: Number(process.env.CAPABILITY_TTL ?? 120),
  fsBaseDir,
};

export function resolveFsPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }

  return path.resolve(runtimeConfig.fsBaseDir, inputPath);
}
