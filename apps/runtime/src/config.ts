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
  bindAddress: process.env.BIND_ADDRESS ?? ((process.env.DEPLOYMENT_PROFILE ?? 'local') === 'local' && process.env.EXPOSE !== '1' ? '127.0.0.1' : '0.0.0.0'),
  corsOrigin: (process.env.DEPLOYMENT_PROFILE ?? 'local') === 'local' ? (/^http:\/\/localhost:\d+$/) : true,
  dataDir,
  policyPath: path.join(dataDir, 'policy.json'),
  auditPath: path.join(dataDir, 'audit.ndjson'),
  signingKeyPath: path.join(dataDir, 'signing.key'),
  masterKeyPath: path.join(dataDir, 'master.key'),
  secretsPath: path.join(dataDir, 'secrets.json'),
  externalAgentsPath: path.join(dataDir, 'external_agents.json'),
  capabilityTtlSeconds: Number(process.env.CAPABILITY_TTL ?? 120),
  internalSecret: process.env.POLAR_INTERNAL_SECRET ?? 'polar-dev-secret-123',
  authToken: process.env.POLAR_AUTH_TOKEN ?? 'polar-dev-token-456',
  fsBaseDir,
  maxBodySize: Number(process.env.MAX_BODY_SIZE ?? 1024 * 1024), // 1MB
  maxHeaderSize: Number(process.env.MAX_HEADER_SIZE ?? 16 * 1024), // 16KB
  rateLimitWindowMs: 60 * 1000, // 1 minute
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX ?? 100), // 100 requests per window
  maxMemoryContentSize: Number(process.env.MAX_MEMORY_CONTENT_SIZE ?? 64 * 1024), // 64KB default
  maxAgentSpawnDepth: Number(process.env.MAX_AGENT_SPAWN_DEPTH ?? 5), // Prevent runaway recursion
  maxAgentsPerSession: Number(process.env.MAX_AGENTS_PER_SESSION ?? 20), // Prevent session overload
  auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS ?? 30), // Default 30 days
};

export function resolveFsPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }

  return path.resolve(runtimeConfig.fsBaseDir, inputPath);
}
