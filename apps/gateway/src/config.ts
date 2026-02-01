import path from 'node:path';

const baseDir = process.cwd();

export const gatewayConfig = {
  port: Number(process.env.GATEWAY_PORT ?? 4001),
  runtimeUrl: process.env.RUNTIME_URL ?? 'http://localhost:4000',
  deploymentProfile: (process.env.DEPLOYMENT_PROFILE ?? 'local') as 'local' | 'cloud' | 'edge',
  signingKeyPath:
    process.env.SIGNING_KEY_PATH ??
    path.resolve(baseDir, '..', 'runtime', 'data', 'signing.key'),
  fsBaseDir: process.env.FS_BASE_DIR
    ? path.resolve(process.env.FS_BASE_DIR)
    : path.resolve(baseDir, '..', '..', 'sandbox'),
};

export function resolveFsPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }

  return path.resolve(gatewayConfig.fsBaseDir, inputPath);
}
