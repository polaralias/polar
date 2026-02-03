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
  cliAllowlist: {
    git: {
      bin: process.env.GIT_BIN_PATH ?? (process.platform === 'win32' ? 'git.exe' : '/usr/bin/git'),
      allowedSubcommands: ['status', 'log', 'diff', 'show', 'branch']
    },
    echo: {
      bin: process.platform === 'win32' ? 'cmd.exe' : '/bin/echo',
      // Special handling might be needed for shell builtins, but for 'cmd /c echo' or '/bin/echo' it's a binary.
      allowedSubcommands: [] // echo takes args directly, not subcommands usually, but our model assumes subcommand first? 
      // Actually, for generic CLI, we might just allow arguments matching a regex.
      // For MVP, let's stick to "git" as the primary use case which has subcommands.
    }
  } as Record<string, { bin: string; allowedSubcommands: string[] }>,
};

export function resolveFsPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }

  return path.resolve(gatewayConfig.fsBaseDir, inputPath);
}
