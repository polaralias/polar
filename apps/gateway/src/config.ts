import path from 'node:path';

const baseDir = process.cwd();

export const gatewayConfig = {
  port: Number(process.env.GATEWAY_PORT ?? 4001),
  runtimeUrl: process.env.RUNTIME_URL ?? 'http://localhost:4000',
  deploymentProfile: (process.env.DEPLOYMENT_PROFILE ?? 'local') as 'local' | 'cloud' | 'edge',
  bindAddress: process.env.BIND_ADDRESS ?? ((process.env.DEPLOYMENT_PROFILE ?? 'local') === 'local' && process.env.EXPOSE !== '1' ? '127.0.0.1' : '0.0.0.0'),
  corsOrigin: (process.env.DEPLOYMENT_PROFILE ?? 'local') === 'local' ? (/^http:\/\/localhost:\d+$/) : true,
  signingKeyPath:
    process.env.SIGNING_KEY_PATH ??
    path.resolve(baseDir, '..', 'runtime', 'data', 'signing.key'),
  fsBaseDir: process.env.FS_BASE_DIR
    ? path.resolve(process.env.FS_BASE_DIR)
    : path.resolve(baseDir, '..', '..', 'sandbox'),
  internalSecret: process.env.POLAR_INTERNAL_SECRET ?? 'polar-dev-secret-123',
  maxBodySize: Number(process.env.MAX_BODY_SIZE ?? 1024 * 1024 * 10), // 10MB default for gateway (file uploads)
  maxHeaderSize: Number(process.env.MAX_HEADER_SIZE ?? 16 * 1024), // 16KB
  rateLimitWindowMs: 60 * 1000,
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX ?? 1000), // Higher limit for gateway
};

export function resolveFsPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }

  return path.resolve(gatewayConfig.fsBaseDir, inputPath);
}
