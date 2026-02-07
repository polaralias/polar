import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  AuditEvent,
  matchesResourceConstraint,
  verifyCapabilityToken,
  HttpResource,
} from '@polar/core';
import { z } from 'zod';
import { gatewayConfig, resolveFsPath } from './config.js';

const app = Fastify({
  logger: true,
  bodyLimit: gatewayConfig.maxBodySize,
});

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now - record.windowStart > gatewayConfig.rateLimitWindowMs) {
      rateLimitMap.delete(ip);
    }
  }
}, gatewayConfig.rateLimitWindowMs).unref();

app.addHook('onRequest', async (request, reply) => {
  const ip = request.ip;
  const now = Date.now();

  let record = rateLimitMap.get(ip);
  if (!record) {
    record = { count: 0, windowStart: now };
    rateLimitMap.set(ip, record);
  } else if (now - record.windowStart > gatewayConfig.rateLimitWindowMs) {
    record.count = 0;
    record.windowStart = now;
  }

  record.count++;

  if (record.count > gatewayConfig.rateLimitMaxRequests) {
    return reply.status(429).send({ error: 'Too Many Requests' });
  }
});

await app.register(cors, { origin: gatewayConfig.corsOrigin });

app.get('/health', async () => ({ ok: true }));

app.get('/doctor', async () => {
  const { runDiagnostics } = await import('./doctorService.js');
  const results = await runDiagnostics();
  return { results };
});

let cachedSigningKey: Uint8Array | null = null;
let lastKeyMtime: number = 0;

type IntrospectionTrace = {
  sessionId?: string;
  agentId?: string;
  traceId?: string;
  parentEventId?: string;
};

type IntrospectionResult = {
  active: boolean;
  error?: string;
  trace?: IntrospectionTrace;
};

async function readSigningKey(): Promise<Uint8Array> {
  try {
    const stats = await fs.stat(gatewayConfig.signingKeyPath);
    if (cachedSigningKey && stats.mtimeMs === lastKeyMtime) {
      return cachedSigningKey;
    }
    const key = await fs.readFile(gatewayConfig.signingKeyPath, 'utf-8');
    cachedSigningKey = new TextEncoder().encode(key.trim());
    lastKeyMtime = stats.mtimeMs;
    return cachedSigningKey;
  } catch (error) {
    // If file doesn't exist yet or fails, return empty or throw.
    // Existing code would have thrown on readFile.
    throw error;
  }
}

async function sendAudit(event: AuditEvent): Promise<void> {
  const response = await fetch(`${gatewayConfig.runtimeUrl}/internal/audit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-polar-internal-secret': gatewayConfig.internalSecret,
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Audit delivery failed with status ${response.status}`);
  }
}

async function introspectToken(token: string): Promise<IntrospectionResult> {
  try {
    const response = await fetch(`${gatewayConfig.runtimeUrl}/internal/introspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-polar-internal-secret': gatewayConfig.internalSecret,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      return { active: false, error: errorData.error || `Introspection failed with status ${response.status}` };
    }

    const data = await response.json() as IntrospectionResult;
    return data;
  } catch (error) {
    return { active: false, error: `Introspection unreachable: ${(error as Error).message}` };
  }
}

function readHeaderValue(headers: Record<string, unknown>, key: string): string | undefined {
  const raw = headers[key.toLowerCase()];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.find((item) => typeof item === 'string');
  return undefined;
}

function isInternalRuntimeCall(headers: Record<string, unknown>): boolean {
  return readHeaderValue(headers, 'x-polar-internal-secret') === gatewayConfig.internalSecret;
}

async function requestHumanApproval(params: {
  jti: string;
  subject: string;
  action: string;
  trace: IntrospectionTrace | undefined;
  toolPath: string;
  requestBody: Record<string, unknown>;
  resource: Record<string, unknown>;
}): Promise<{ approvalId: string; status: string }> {
  const response = await fetch(`${gatewayConfig.runtimeUrl}/internal/approvals/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-polar-internal-secret': gatewayConfig.internalSecret,
    },
    body: JSON.stringify({
      jti: params.jti,
      subject: params.subject,
      action: params.action,
      sessionId: params.trace?.sessionId,
      agentId: params.trace?.agentId,
      traceId: params.trace?.traceId,
      parentEventId: params.trace?.parentEventId,
      resource: params.resource,
      request: {
        toolPath: params.toolPath,
        body: params.requestBody,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to request approval: ${text}`);
  }

  const data = await response.json() as { approval?: { id: string; status: string } };
  if (!data.approval) {
    throw new Error('Invalid approval response from runtime');
  }

  return {
    approvalId: data.approval.id,
    status: data.approval.status,
  };
}

async function getConnectorCredential(connector: string): Promise<string | undefined> {
  const response = await fetch(`${gatewayConfig.runtimeUrl}/internal/connectors/credentials/${encodeURIComponent(connector)}`, {
    method: 'GET',
    headers: {
      'x-polar-internal-secret': gatewayConfig.internalSecret,
    },
  });

  if (!response.ok) {
    return undefined;
  }

  const data = await response.json() as { credential?: string };
  return data.credential;
}

function buildAuditEvent(
  subject: string,
  action: string,
  resource: { type: string; path?: string | undefined; url?: string | undefined; method?: string | undefined },
  decision: 'allow' | 'deny',
  reason?: string,
  requestId?: string,
  messageId?: string,
  parentEventId?: string,
  metadata?: Record<string, unknown>,
): AuditEvent {
  return {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject,
    action,
    tool: action,
    decision,
    reason,
    resource,
    requestId,
    messageId,
    parentEventId,
    metadata: {
      source: 'gateway',
      ...metadata,
    },
  };
}

async function getCanonicalReadPath(inputPath: string): Promise<string> {
  const resolvedPath = resolveFsPath(inputPath);
  return fs.realpath(resolvedPath);
}

async function getCanonicalWritePath(inputPath: string): Promise<string> {
  const resolvedPath = resolveFsPath(inputPath);
  const parentDir = path.dirname(resolvedPath);
  const canonicalParent = await fs.realpath(parentDir);
  const candidatePath = path.join(canonicalParent, path.basename(resolvedPath));

  try {
    const stats = await fs.lstat(candidatePath);
    if (stats.isSymbolicLink()) {
      return fs.realpath(candidatePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return candidatePath;
}

function isDeniedShellBinary(binPath: string): boolean {
  const denied = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'sh', 'bash', 'zsh']);
  return denied.has(path.basename(binPath).toLowerCase());
}

function redactConnectorOutput(raw: string): string {
  return raw
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
}

function getConnectorConstraints(resourceConstraint: unknown, connectorId: string): Record<string, unknown> {
  const constraint = resourceConstraint as {
    type?: string;
    connectorId?: string;
    constraints?: Record<string, unknown>;
  };
  if (constraint?.type !== 'connector' || constraint.connectorId !== connectorId) {
    return {};
  }
  return (constraint.constraints && typeof constraint.constraints === 'object')
    ? constraint.constraints
    : {};
}

const homeAssistantStateCache = new Map<string, { expiresAt: number; value: unknown }>();

function parseSafeGmailQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string') return '';
  const query = rawQuery.trim();
  if (!query) return '';
  if (query.length > 256) {
    throw new Error('Gmail query exceeds 256 characters');
  }
  if (/[\r\n`;$]/.test(query)) {
    throw new Error('Gmail query contains forbidden characters');
  }
  const tokens = query.split(/\s+/).filter((token) => token.length > 0);
  const allowedToken = /^[A-Za-z0-9@._:+\-\"]+$/;
  for (const token of tokens) {
    if (!allowedToken.test(token)) {
      throw new Error(`Unsupported Gmail query token: ${token}`);
    }
  }
  return query;
}

function decodeBase64UrlToUtf8(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function collectGmailTextPart(parts: any[] | undefined): string | undefined {
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const mimeType = typeof part.mimeType === 'string' ? part.mimeType : '';
    const bodyData = part?.body?.data;
    if (mimeType === 'text/plain' && typeof bodyData === 'string') {
      try {
        return decodeBase64UrlToUtf8(bodyData);
      } catch {
        // continue searching other parts
      }
    }
    const nested = collectGmailTextPart(part.parts);
    if (nested) return nested;
  }
  return undefined;
}

function extractGmailBody(message: any): string | undefined {
  const payload = message?.payload;
  if (!payload || typeof payload !== 'object') return undefined;

  const directBody = payload?.body?.data;
  if (typeof directBody === 'string') {
    try {
      return decodeBase64UrlToUtf8(directBody);
    } catch {
      // ignore and continue to nested parts
    }
  }
  return collectGmailTextPart(payload.parts);
}

function gmailHeaderMap(message: any): Record<string, string> {
  const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
  const result: Record<string, string> = {};
  for (const header of headers) {
    const name = typeof header?.name === 'string' ? header.name.toLowerCase() : '';
    const value = typeof header?.value === 'string' ? header.value : '';
    if (!name || !value) continue;
    if (name === 'from' || name === 'to' || name === 'subject' || name === 'date') {
      result[name] = value;
    }
  }
  return result;
}

function sanitizeGmailMessage(message: any, includeBody: boolean): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    id: message?.id,
    threadId: message?.threadId,
    labelIds: Array.isArray(message?.labelIds) ? message.labelIds : [],
    snippet: message?.snippet || '',
    headers: gmailHeaderMap(message),
  };
  if (includeBody) {
    const bodyText = extractGmailBody(message);
    sanitized.body = typeof bodyText === 'string' ? redactConnectorOutput(bodyText).slice(0, 20_000) : '';
  }
  return sanitized;
}

function escapeRegexFragment(fragment: string): string {
  return fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => escapeRegexFragment(part))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

function matchGitignorePattern(relativePath: string, pattern: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/').trim();
  if (!normalizedPattern) return false;

  if (normalizedPattern.endsWith('/')) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  if (!normalizedPattern.includes('/')) {
    const baseName = path.basename(normalizedPath);
    return wildcardPatternToRegex(normalizedPattern).test(baseName);
  }

  return wildcardPatternToRegex(normalizedPattern).test(normalizedPath);
}

async function loadGitignorePatterns(rootPath: string): Promise<string[]> {
  const gitignorePath = path.join(rootPath, '.gitignore');
  try {
    const raw = await fs.readFile(gitignorePath, 'utf-8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'));
  } catch {
    return [];
  }
}

function isPathIgnored(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchGitignorePattern(relativePath, pattern));
}

type FileWorkflowItem = {
  path: string;
  size: number;
  extension: string;
  preview: string;
};

async function collectWorkflowFiles(params: {
  rootPath: string;
  maxFiles: number;
  maxFileSizeBytes: number;
}): Promise<{ files: FileWorkflowItem[]; ignoredCount: number; skippedLargeCount: number }> {
  const gitignorePatterns = await loadGitignorePatterns(params.rootPath);
  const files: FileWorkflowItem[] = [];
  let ignoredCount = 0;
  let skippedLargeCount = 0;

  const walk = async (currentPath: string): Promise<void> => {
    if (files.length >= params.maxFiles) return;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= params.maxFiles) break;
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(params.rootPath, absolutePath).replace(/\\/g, '/');
      if (!relativePath) continue;
      if (isPathIgnored(relativePath, gitignorePatterns)) {
        ignoredCount += 1;
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const stats = await fs.stat(absolutePath);
      if (stats.size > params.maxFileSizeBytes) {
        skippedLargeCount += 1;
        continue;
      }

      let content = '';
      try {
        content = await fs.readFile(absolutePath, 'utf-8');
      } catch {
        // Skip binary/unreadable files.
        continue;
      }

      const firstNonEmptyLine = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) || '';
      const preview = firstNonEmptyLine.slice(0, 180);
      const extension = path.extname(relativePath).toLowerCase() || '<none>';

      files.push({
        path: relativePath,
        size: stats.size,
        extension,
        preview,
      });
    }
  };

  await walk(params.rootPath);
  return { files, ignoredCount, skippedLargeCount };
}

function summarizeWorkflowFiles(rootPath: string, files: FileWorkflowItem[], ignoredCount: number, skippedLargeCount: number): string {
  const extensionCounts = new Map<string, number>();
  for (const file of files) {
    extensionCounts.set(file.extension, (extensionCounts.get(file.extension) || 0) + 1);
  }

  const topExtensions = Array.from(extensionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([extension, count]) => `${extension}: ${count}`)
    .join(', ');
  const sampleFiles = files.slice(0, 12).map((file) => `- ${file.path}${file.preview ? ` :: ${file.preview}` : ''}`);

  return [
    `Directory Summary for ${rootPath}`,
    `Files analyzed: ${files.length}`,
    `Ignored by .gitignore: ${ignoredCount}`,
    `Skipped (too large): ${skippedLargeCount}`,
    topExtensions ? `Top file types: ${topExtensions}` : 'Top file types: none',
    '',
    'Representative files:',
    ...sampleFiles,
  ].join('\n');
}

function buildReadmeDraft(rootName: string, summary: string, files: FileWorkflowItem[]): string {
  const sections = files.slice(0, 8).map((file) => `- \`${file.path}\`${file.preview ? ` - ${file.preview}` : ''}`);
  return [
    `# ${rootName}`,
    '',
    '## Project Summary',
    summary,
    '',
    '## Key Files',
    ...sections,
    '',
    '## Next Steps',
    '- Add setup instructions',
    '- Add usage examples',
    '- Document architecture decisions',
    '',
  ].join('\n');
}

app.post('/tools/fs.readFile', async (request, reply) => {
  const body = request.body as { token?: string; path?: string; messageId?: string; parentEventId?: string };
  if (!body?.token || !body?.path) {
    return reply.status(401).send({ error: 'Token and path are required' });
  }

  let resolvedPath: string;
  try {
    resolvedPath = await getCanonicalReadPath(body.path);
  } catch (error) {
    return reply.status(404).send({ error: (error as Error).message });
  }
  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());

    // Immediate revocation & Emergency mode check via Runtime Introspection
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(
        buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId),
      );
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch (error) {
    await sendAudit(
      buildAuditEvent('unknown', 'fs.readFile', { type: 'fs', path: resolvedPath }, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.readFile') {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'deny', 'Action mismatch', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'deny', 'Path denied', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'fs.readFile',
      trace: intro.trace,
      toolPath: '/tools/fs.readFile',
      requestBody: body as Record<string, unknown>,
      resource: { type: 'fs', path: resolvedPath },
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(
        buildAuditEvent(
          payload.sub,
          'fs.readFile',
          { type: 'fs', path: resolvedPath },
          'deny',
          denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
          payload.jti,
          body.messageId,
          body.parentEventId,
          { approvalId: approval.approvalId, approvalStatus: approval.status },
        ),
      );
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'allow', undefined, payload.jti, body.messageId, body.parentEventId),
    );
    return { content };
  } catch (error) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.readFile', { type: 'fs', path: resolvedPath }, 'allow', 'File read failed', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(404).send({ error: (error as Error).message });
  }
});

app.post('/tools/fs.listDir', async (request, reply) => {
  const body = request.body as { token?: string; path?: string; messageId?: string; parentEventId?: string };
  if (!body?.token || !body?.path) {
    return reply.status(401).send({ error: 'Token and path are required' });
  }

  let resolvedPath: string;
  try {
    resolvedPath = await getCanonicalReadPath(body.path);
  } catch (error) {
    return reply.status(404).send({ error: (error as Error).message });
  }
  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());

    // Immediate revocation & Emergency mode check via Runtime Introspection
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(
        buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId),
      );
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch {
    await sendAudit(
      buildAuditEvent('unknown', 'fs.listDir', { type: 'fs', path: resolvedPath }, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.listDir') {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'deny', 'Action mismatch', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'deny', 'Path denied', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'fs.listDir',
      trace: intro.trace,
      toolPath: '/tools/fs.listDir',
      requestBody: body as Record<string, unknown>,
      resource: { type: 'fs', path: resolvedPath },
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(
        buildAuditEvent(
          payload.sub,
          'fs.listDir',
          { type: 'fs', path: resolvedPath },
          'deny',
          denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
          payload.jti,
          body.messageId,
          body.parentEventId,
          { approvalId: approval.approvalId, approvalStatus: approval.status },
        ),
      );
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  try {
    const entries = await fs.readdir(resolvedPath);
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'allow', undefined, payload.jti, body.messageId, body.parentEventId),
    );
    return { entries };
  } catch (error) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.listDir', { type: 'fs', path: resolvedPath }, 'allow', 'List failed', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(404).send({ error: (error as Error).message });
  }
});

app.post('/tools/fs.writeFile', async (request, reply) => {
  const body = request.body as { token?: string; path?: string; content?: string; messageId?: string; parentEventId?: string };
  if (!body?.token || !body?.path || typeof body?.content !== 'string') {
    return reply.status(401).send({ error: 'Token, path, and content are required' });
  }

  let resolvedPath: string;
  try {
    resolvedPath = await getCanonicalWritePath(body.path);
  } catch (error) {
    return reply.status(404).send({ error: (error as Error).message });
  }
  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());

    // Immediate revocation & Emergency mode check via Runtime Introspection
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(
        buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId),
      );
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch {
    await sendAudit(
      buildAuditEvent('unknown', 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.writeFile') {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'deny', 'Action mismatch', undefined, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'deny', 'Path denied', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'fs.writeFile',
      trace: intro.trace,
      toolPath: '/tools/fs.writeFile',
      requestBody: body as Record<string, unknown>,
      resource: { type: 'fs', path: resolvedPath },
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(
        buildAuditEvent(
          payload.sub,
          'fs.writeFile',
          { type: 'fs', path: resolvedPath },
          'deny',
          denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
          payload.jti,
          body.messageId,
          body.parentEventId,
          { approvalId: approval.approvalId, approvalStatus: approval.status },
        ),
      );
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  try {
    await fs.writeFile(resolvedPath, body.content, 'utf-8');
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'allow', undefined, payload.jti, body.messageId, body.parentEventId),
    );
    return { ok: true };
  } catch (error) {
    await sendAudit(
      buildAuditEvent(payload.sub, 'fs.writeFile', { type: 'fs', path: resolvedPath }, 'allow', 'Write failed', payload.jti, body.messageId, body.parentEventId),
    );
    return reply.status(500).send({ error: (error as Error).message });
  }
});

app.post('/tools/memory.query', async (request, reply) => {
  const body = request.body as { token?: string; query?: any; messageId?: string; parentEventId?: string };
  if (!body?.token || !body?.query) {
    return reply.status(401).send({ error: 'Token and query are required' });
  }

  const resource = { type: 'memory', ...body.query };

  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch {
    await sendAudit(buildAuditEvent('unknown', 'memory.query', resource, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId));
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'memory.query') {
    await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', 'Action mismatch', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  // Enforcement: Scoping (Project context isolation)
  if (payload.res.type === 'memory' && payload.res.scopeIds) {
    const requestedScopes = body.query.scopeIds || [];
    if (requestedScopes.length === 0 || !requestedScopes.every((s: string) => (payload.res as any).scopeIds.includes(s))) {
      await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', 'Scope violation', payload.jti, body.messageId, body.parentEventId));
      return reply.status(403).send({ error: 'Unauthorized memory scope access' });
    }
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'memory.query',
      trace: intro.trace,
      toolPath: '/tools/memory.query',
      requestBody: body as Record<string, unknown>,
      resource: resource as unknown as Record<string, unknown>,
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(buildAuditEvent(
        payload.sub,
        'memory.query',
        resource,
        'deny',
        denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
        payload.jti,
        body.messageId,
        body.parentEventId,
        { approvalId: approval.approvalId, approvalStatus: approval.status },
      ));
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  try {
    const response = await fetch(`${gatewayConfig.runtimeUrl}/memory/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-polar-internal-secret': gatewayConfig.internalSecret,
      },
      body: JSON.stringify({
        subject: payload.sub,
        query: body.query
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', `Runtime error: ${errText}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(response.status).send({ error: `Runtime query failed: ${errText}` });
    }

    const data = await response.json();
    await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
    return data;
  } catch (error) {
    await sendAudit(buildAuditEvent(payload.sub, 'memory.query', resource, 'deny', `Runtime unreachable: ${(error as Error).message}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(502).send({ error: `Runtime unreachable: ${(error as Error).message}` });
  }
});

app.post('/tools/http.request', async (request, reply) => {
  const body = request.body as {
    token?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    messageId?: string;
    parentEventId?: string;
  };

  if (!body?.token || !body?.url) {
    return reply.status(401).send({ error: 'Token and URL are required' });
  }

  const method = body.method || 'GET';
  const resource: HttpResource = { type: 'http', url: body.url, method };

  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch (err) {
    await sendAudit(buildAuditEvent('unknown', 'http.request', resource, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId));
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'http.request') {
    await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'deny', 'Action mismatch', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, resource);
  if (!allowed) {
    await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'deny', 'URL not in allowlist', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: `Egress to ${body.url} is not permitted by your capability.` });
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'http.request',
      trace: intro.trace,
      toolPath: '/tools/http.request',
      requestBody: body as Record<string, unknown>,
      resource: resource as unknown as Record<string, unknown>,
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(buildAuditEvent(
        payload.sub,
        'http.request',
        resource,
        'deny',
        denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
        payload.jti,
        body.messageId,
        body.parentEventId,
        { approvalId: approval.approvalId, approvalStatus: approval.status },
      ));
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  try {
    const response = await fetch(body.url, {
      method,
      ...(body.headers ? { headers: body.headers } : {}),
      ...(body.body ? { body: JSON.stringify(body.body) } : {})
    });

    const status = response.status;
    const data = redactConnectorOutput(await response.text());

    await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
    return { status, data };
  } catch (err) {
    await sendAudit(buildAuditEvent(payload.sub, 'http.request', resource, 'allow', `Fetch failed: ${(err as Error).message}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(502).send({ error: `Request failed: ${(err as Error).message}` });
  }
});

async function handleGoogleMailTool(request: any, reply: any) {
  const body = request.body as {
    token?: string;
    resourceId?: string;
    action?: string;
    args?: unknown;
    messageId?: string;
    parentEventId?: string;
  };

  if (!body?.token || !body?.resourceId || !body?.action) {
    return reply.status(401).send({ error: 'Token, resourceId, and action are required' });
  }
  const mailboxId = body.resourceId;

  const resource = { type: 'connector', connectorId: 'google.mail', resourceId: body.resourceId };

  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(401).send({ error: 'Token revoked' });
    }
  } catch {
    await sendAudit(buildAuditEvent('unknown', 'google.mail', resource, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId));
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'google.mail') {
    await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', 'Action mismatch', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, resource as any);
  if (!allowed) {
    await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', 'Resource denied', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Access to this mailbox is not permitted' });
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'google.mail',
      trace: intro.trace,
      toolPath: '/tools/google.mail',
      requestBody: body as Record<string, unknown>,
      resource: resource as unknown as Record<string, unknown>,
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(buildAuditEvent(
        payload.sub,
        'google.mail',
        resource,
        'deny',
        denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
        payload.jti,
        body.messageId,
        body.parentEventId,
        { approvalId: approval.approvalId, approvalStatus: approval.status },
      ));
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  const connectorConstraints = getConnectorConstraints(payload.res, 'google.mail');
  const allowBody = connectorConstraints.allowBody === true && connectorConstraints.denyBody !== true;
  const configuredAllowLabels = Array.isArray(connectorConstraints.allowLabels)
    ? connectorConstraints.allowLabels.filter((item): item is string => typeof item === 'string')
    : [];

  const credential = await getConnectorCredential('google.mail');
  if (!credential) {
    await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', 'Google credential not configured', payload.jti, body.messageId, body.parentEventId));
    return reply.status(503).send({ error: 'Google connector credential is not configured' });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential}`,
    Accept: 'application/json',
    'User-Agent': 'polar-gateway',
  };

  const searchArgsSchema = z.object({
    query: z.string().max(256).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    includeBody: z.boolean().optional(),
    labelIds: z.array(z.string().min(1)).optional(),
  }).strict();
  const getArgsSchema = z.object({
    messageId: z.string().min(1),
    includeBody: z.boolean().optional(),
  }).strict();
  const draftArgsSchema = z.object({
    to: z.string().min(3).max(320),
    subject: z.string().min(1).max(256),
    bodyText: z.string().min(1).max(20_000),
  }).strict();

  const gmailAction = body.action;
  const args = (body.args && typeof body.args === 'object') ? body.args : {};

  try {
    if (gmailAction === 'search') {
      const parsed = searchArgsSchema.safeParse(args);
      if (!parsed.success) {
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', 'Invalid arguments for search', payload.jti, body.messageId, body.parentEventId));
        return reply.status(400).send({ error: 'Invalid arguments for search' });
      }

      const includeBody = parsed.data.includeBody === true;
      if (includeBody && !allowBody) {
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', 'Body access denied by constraints', payload.jti, body.messageId, body.parentEventId));
        return reply.status(403).send({ error: 'Body access is not permitted for this capability' });
      }

      const requestedLabelIds = parsed.data.labelIds || [];
      if (configuredAllowLabels.length > 0 && requestedLabelIds.some((labelId) => !configuredAllowLabels.includes(labelId))) {
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', 'Label restriction violation', payload.jti, body.messageId, body.parentEventId));
        return reply.status(403).send({ error: 'Requested labels are outside allowlist' });
      }

      let safeQuery = '';
      try {
        safeQuery = parseSafeGmailQuery(parsed.data.query);
      } catch (error) {
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', (error as Error).message, payload.jti, body.messageId, body.parentEventId));
        return reply.status(400).send({ error: (error as Error).message });
      }

      const listQuery = new URLSearchParams({
        maxResults: String(parsed.data.maxResults ?? 10),
        ...(safeQuery ? { q: safeQuery } : {}),
      });
      for (const labelId of requestedLabelIds) {
        listQuery.append('labelIds', labelId);
      }

      const listResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailboxId)}/messages?${listQuery.toString()}`,
        { method: 'GET', headers },
      );
      if (!listResponse.ok) {
        const errorBody = await listResponse.text();
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', `Gmail list failed (${listResponse.status})`, payload.jti, body.messageId, body.parentEventId));
        return reply.status(listResponse.status).send({ error: `Gmail list failed: ${errorBody.slice(0, 240)}` });
      }

      const listData = await listResponse.json() as { messages?: Array<{ id: string }> };
      const ids = Array.isArray(listData.messages) ? listData.messages.map((message) => message.id).filter((id): id is string => typeof id === 'string') : [];

      const messageFetches = ids.map(async (messageId) => {
        const format = includeBody ? 'full' : 'metadata';
        const response = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(messageId)}?format=${format}`,
          { method: 'GET', headers },
        );
        if (!response.ok) return null;
        return response.json();
      });
      const messages = (await Promise.all(messageFetches)).filter((value) => value !== null);
      const sanitized = messages.map((message) => sanitizeGmailMessage(message, includeBody));

      await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
      return {
        ok: true,
        action: gmailAction,
        count: sanitized.length,
        includeBody,
        messages: sanitized,
      };
    }

    if (gmailAction === 'get') {
      const parsed = getArgsSchema.safeParse(args);
      if (!parsed.success) {
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', 'Invalid arguments for get', payload.jti, body.messageId, body.parentEventId));
        return reply.status(400).send({ error: 'Invalid arguments for get' });
      }

      const includeBody = parsed.data.includeBody === true;
      if (includeBody && !allowBody) {
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', 'Body access denied by constraints', payload.jti, body.messageId, body.parentEventId));
        return reply.status(403).send({ error: 'Body access is not permitted for this capability' });
      }

      const format = includeBody ? 'full' : 'metadata';
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(parsed.data.messageId)}?format=${format}`,
        { method: 'GET', headers },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', `Gmail get failed (${response.status})`, payload.jti, body.messageId, body.parentEventId));
        return reply.status(response.status).send({ error: `Gmail get failed: ${errorBody.slice(0, 240)}` });
      }

      const message = await response.json();
      await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
      return {
        ok: true,
        action: gmailAction,
        includeBody,
        message: sanitizeGmailMessage(message, includeBody),
      };
    }

    if (gmailAction === 'create_draft') {
      const parsed = draftArgsSchema.safeParse(args);
      if (!parsed.success) {
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', 'Invalid arguments for create_draft', payload.jti, body.messageId, body.parentEventId));
        return reply.status(400).send({ error: 'Invalid arguments for create_draft' });
      }

      const mime = [
        `To: ${parsed.data.to}`,
        `Subject: ${parsed.data.subject}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        parsed.data.bodyText,
      ].join('\r\n');
      const raw = Buffer.from(mime, 'utf-8').toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailboxId)}/drafts`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: { raw } }),
        },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', `Gmail draft create failed (${response.status})`, payload.jti, body.messageId, body.parentEventId));
        return reply.status(response.status).send({ error: `Gmail draft create failed: ${errorBody.slice(0, 240)}` });
      }

      const draft = await response.json() as { id?: string; message?: { id?: string } };
      await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
      return {
        ok: true,
        action: gmailAction,
        draftId: draft.id,
        messageId: draft.message?.id,
      };
    }

    await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', `Unsupported google.mail action: ${gmailAction}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(400).send({ error: `Unsupported google.mail action: ${gmailAction}` });
  } catch (error) {
    await sendAudit(buildAuditEvent(payload.sub, 'google.mail', resource, 'deny', `Google connector failure: ${(error as Error).message}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(502).send({ error: `Google connector request failed: ${(error as Error).message}` });
  }
}

app.post('/tools/google.mail', async (request, reply) => handleGoogleMailTool(request, reply));

app.post('/tools/home.assistant', async (request, reply) => {
  const body = request.body as {
    token?: string;
    resourceId?: string;
    action?: string;
    args?: unknown;
    messageId?: string;
    parentEventId?: string;
  };

  if (!body?.token || !body?.resourceId || !body?.action) {
    return reply.status(401).send({ error: 'Token, resourceId, and action are required' });
  }

  const resource = { type: 'connector', connectorId: 'home.assistant', resourceId: body.resourceId };
  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(401).send({ error: 'Token revoked' });
    }
  } catch {
    await sendAudit(buildAuditEvent('unknown', 'home.assistant', resource, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId));
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'home.assistant') {
    await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', 'Action mismatch', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, resource as any);
  if (!allowed) {
    await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', 'Resource denied', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Access to this Home Assistant target is not permitted' });
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'home.assistant',
      trace: intro.trace,
      toolPath: '/tools/home.assistant',
      requestBody: body as Record<string, unknown>,
      resource: resource as unknown as Record<string, unknown>,
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(buildAuditEvent(
        payload.sub,
        'home.assistant',
        resource,
        'deny',
        denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
        payload.jti,
        body.messageId,
        body.parentEventId,
        { approvalId: approval.approvalId, approvalStatus: approval.status },
      ));
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  const credential = await getConnectorCredential('home.assistant');
  if (!credential) {
    await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', 'Home Assistant credential not configured', payload.jti, body.messageId, body.parentEventId));
    return reply.status(503).send({ error: 'Home Assistant connector credential is not configured' });
  }

  const connectorConstraints = getConnectorConstraints(payload.res, 'home.assistant');
  const allowEntityIds = Array.isArray(connectorConstraints.allowEntityIds)
    ? connectorConstraints.allowEntityIds.filter((item): item is string => typeof item === 'string')
    : [];
  const defaultAllowServices = ['light.turn_on', 'light.turn_off', 'switch.turn_on', 'switch.turn_off'];
  const allowedServices = Array.isArray(connectorConstraints.allowServices)
    ? connectorConstraints.allowServices.filter((item): item is string => typeof item === 'string')
    : defaultAllowServices;
  const blockedServices = new Set([
    'lock.unlock',
    'lock.open',
    'alarm_control_panel.alarm_disarm',
    'climate.set_temperature',
    ...(Array.isArray(connectorConstraints.blockedServices)
      ? connectorConstraints.blockedServices.filter((item): item is string => typeof item === 'string')
      : []),
  ]);

  const baseUrl = gatewayConfig.homeAssistantUrl.replace(/\/+$/, '');
  const haHeaders: Record<string, string> = {
    Authorization: `Bearer ${credential}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const stateArgsSchema = z.object({
    entityId: z.string().min(3),
  }).strict();
  const serviceArgsSchema = z.object({
    service: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
    entityId: z.string().min(3).optional(),
    serviceData: z.record(z.unknown()).optional(),
  }).strict();

  try {
    if (body.action === 'state.get') {
      const parsed = stateArgsSchema.safeParse(body.args || {});
      if (!parsed.success) {
        await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', 'Invalid arguments for state.get', payload.jti, body.messageId, body.parentEventId));
        return reply.status(400).send({ error: 'Invalid arguments for state.get' });
      }

      if (allowEntityIds.length > 0 && !allowEntityIds.includes(parsed.data.entityId)) {
        await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', 'Entity denied by allowlist', payload.jti, body.messageId, body.parentEventId));
        return reply.status(403).send({ error: 'Entity is outside allowed scope' });
      }

      const cacheKey = `${body.resourceId}:${parsed.data.entityId}`;
      const cached = homeAssistantStateCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId, { cache: 'hit' }));
        return { ok: true, action: body.action, state: cached.value };
      }

      const response = await fetch(
        `${baseUrl}/api/states/${encodeURIComponent(parsed.data.entityId)}`,
        { method: 'GET', headers: haHeaders },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', `State fetch failed (${response.status})`, payload.jti, body.messageId, body.parentEventId));
        return reply.status(response.status).send({ error: `State fetch failed: ${errorBody.slice(0, 240)}` });
      }

      const rawState = await response.json() as Record<string, unknown>;
      const attributes = (rawState.attributes && typeof rawState.attributes === 'object')
        ? rawState.attributes as Record<string, unknown>
        : {};
      const sanitized = {
        entityId: rawState.entity_id,
        state: rawState.state,
        lastChanged: rawState.last_changed,
        attributes: {
          friendly_name: attributes.friendly_name,
          unit_of_measurement: attributes.unit_of_measurement,
          device_class: attributes.device_class,
          icon: attributes.icon,
        },
      };
      homeAssistantStateCache.set(cacheKey, {
        value: sanitized,
        expiresAt: Date.now() + 10_000,
      });

      await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId, { cache: 'miss' }));
      return { ok: true, action: body.action, state: sanitized };
    }

    if (body.action === 'services.call') {
      const parsed = serviceArgsSchema.safeParse(body.args || {});
      if (!parsed.success) {
        await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', 'Invalid arguments for services.call', payload.jti, body.messageId, body.parentEventId));
        return reply.status(400).send({ error: 'Invalid arguments for services.call' });
      }

      const service = parsed.data.service;
      if (blockedServices.has(service)) {
        await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', `Blocked sensitive service: ${service}`, payload.jti, body.messageId, body.parentEventId));
        return reply.status(403).send({ error: `Service ${service} is blocked by default policy` });
      }
      if (!allowedServices.includes(service)) {
        await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', `Service not in allowlist: ${service}`, payload.jti, body.messageId, body.parentEventId));
        return reply.status(403).send({ error: `Service ${service} is not in allowlist` });
      }
      if (parsed.data.entityId && allowEntityIds.length > 0 && !allowEntityIds.includes(parsed.data.entityId)) {
        await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', 'Entity denied by allowlist', payload.jti, body.messageId, body.parentEventId));
        return reply.status(403).send({ error: 'Entity is outside allowed scope' });
      }

      const [domain, serviceName] = service.split('.');
      if (!domain || !serviceName) {
        return reply.status(400).send({ error: 'Invalid service name' });
      }

      const response = await fetch(
        `${baseUrl}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(serviceName)}`,
        {
          method: 'POST',
          headers: haHeaders,
          body: JSON.stringify({
            ...(parsed.data.entityId ? { entity_id: parsed.data.entityId } : {}),
            ...(parsed.data.serviceData ? parsed.data.serviceData : {}),
          }),
        },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', `Service call failed (${response.status})`, payload.jti, body.messageId, body.parentEventId));
        return reply.status(response.status).send({ error: `Service call failed: ${errorBody.slice(0, 240)}` });
      }

      const rawResult = await response.json();
      const sanitizedResult = Array.isArray(rawResult)
        ? rawResult.map((item) => ({
          entityId: item?.entity_id,
          state: item?.state,
          changed: item?.last_changed,
        }))
        : rawResult;

      await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId, { service }));
      return {
        ok: true,
        action: body.action,
        service,
        result: sanitizedResult,
      };
    }

    await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', `Unsupported home.assistant action: ${body.action}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(400).send({ error: `Unsupported home.assistant action: ${body.action}` });
  } catch (error) {
    await sendAudit(buildAuditEvent(payload.sub, 'home.assistant', resource, 'deny', `Home Assistant connector failure: ${(error as Error).message}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(502).send({ error: `Home Assistant connector request failed: ${(error as Error).message}` });
  }
});

app.post('/tools/fs.workflow', async (request, reply) => {
  const body = request.body as {
    token?: string;
    path?: string;
    action?: string;
    args?: unknown;
    messageId?: string;
    parentEventId?: string;
  };

  if (!body?.token || !body?.path || !body?.action) {
    return reply.status(401).send({ error: 'Token, path, and action are required' });
  }

  let resolvedPath: string;
  try {
    resolvedPath = await getCanonicalReadPath(body.path);
  } catch (error) {
    return reply.status(404).send({ error: (error as Error).message });
  }

  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(buildAuditEvent(payload.sub, 'fs.workflow', { type: 'fs', path: resolvedPath }, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(401).send({ error: `Token revoked or invalid: ${intro.error}` });
    }
  } catch {
    await sendAudit(buildAuditEvent('unknown', 'fs.workflow', { type: 'fs', path: resolvedPath }, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId));
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'fs.workflow') {
    await sendAudit(buildAuditEvent(payload.sub, 'fs.workflow', { type: 'fs', path: resolvedPath }, 'deny', 'Action mismatch', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, { type: 'fs', path: resolvedPath });
  if (!allowed) {
    await sendAudit(buildAuditEvent(payload.sub, 'fs.workflow', { type: 'fs', path: resolvedPath }, 'deny', 'Path denied', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Path not permitted' });
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'fs.workflow',
      trace: intro.trace,
      toolPath: '/tools/fs.workflow',
      requestBody: body as Record<string, unknown>,
      resource: { type: 'fs', path: resolvedPath },
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(buildAuditEvent(
        payload.sub,
        'fs.workflow',
        { type: 'fs', path: resolvedPath },
        'deny',
        denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
        payload.jti,
        body.messageId,
        body.parentEventId,
        { approvalId: approval.approvalId, approvalStatus: approval.status },
      ));
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  const workflowArgsSchema = z.object({
    maxFiles: z.number().int().min(1).max(500).optional(),
    maxFileSizeBytes: z.number().int().min(512).max(1024 * 1024).optional(),
  }).strict();
  const parsedArgs = workflowArgsSchema.safeParse((body.args && typeof body.args === 'object') ? body.args : {});
  if (!parsedArgs.success) {
    await sendAudit(buildAuditEvent(payload.sub, 'fs.workflow', { type: 'fs', path: resolvedPath }, 'deny', 'Invalid workflow arguments', payload.jti, body.messageId, body.parentEventId));
    return reply.status(400).send({ error: 'Invalid workflow arguments' });
  }

  try {
    const { files, ignoredCount, skippedLargeCount } = await collectWorkflowFiles({
      rootPath: resolvedPath,
      maxFiles: parsedArgs.data.maxFiles ?? 200,
      maxFileSizeBytes: parsedArgs.data.maxFileSizeBytes ?? 64 * 1024,
    });
    const summary = summarizeWorkflowFiles(resolvedPath, files, ignoredCount, skippedLargeCount);

    if (body.action === 'summarize_directory') {
      await sendAudit(buildAuditEvent(payload.sub, 'fs.workflow', { type: 'fs', path: resolvedPath }, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
      return {
        ok: true,
        action: body.action,
        path: resolvedPath,
        filesAnalyzed: files.length,
        ignoredCount,
        skippedLargeCount,
        summary,
        files: files.slice(0, 30),
      };
    }

    if (body.action === 'generate_readme') {
      const rootName = path.basename(resolvedPath);
      const readme = buildReadmeDraft(rootName, summary, files);
      await sendAudit(buildAuditEvent(payload.sub, 'fs.workflow', { type: 'fs', path: resolvedPath }, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
      return {
        ok: true,
        action: body.action,
        path: resolvedPath,
        readme,
        summary,
      };
    }

    await sendAudit(buildAuditEvent(payload.sub, 'fs.workflow', { type: 'fs', path: resolvedPath }, 'deny', `Unsupported workflow action: ${body.action}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(400).send({ error: `Unsupported workflow action: ${body.action}` });
  } catch (error) {
    await sendAudit(buildAuditEvent(payload.sub, 'fs.workflow', { type: 'fs', path: resolvedPath }, 'deny', `Workflow execution failed: ${(error as Error).message}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(500).send({ error: `Workflow execution failed: ${(error as Error).message}` });
  }
});

app.post('/tools/github.repo', async (request, reply) => {
  const body = request.body as { token?: string; resourceId?: string; action?: string; args?: any; messageId?: string; parentEventId?: string };
  // resourceId: 'owner/repo'

  if (!body?.token || !body?.resourceId || !body?.action) {
    return reply.status(401).send({ error: 'Token, resourceId (owner/repo), and action are required' });
  }

  const resource = { type: 'connector', connectorId: 'github.repo', resourceId: body.resourceId };

  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(buildAuditEvent(payload.sub, 'github.repo', resource, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(401).send({ error: 'Token revoked' });
    }
  } catch {
    await sendAudit(buildAuditEvent('unknown', 'github.repo', resource, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId));
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'github.repo') {
    await sendAudit(buildAuditEvent(payload.sub, 'github.repo', resource, 'deny', 'Action mismatch', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  const allowed = matchesResourceConstraint(payload.res, resource as any);
  if (!allowed) {
    await sendAudit(buildAuditEvent(payload.sub, 'github.repo', resource, 'deny', 'Resource denied', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Access to this repo is not permitted' });
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'github.repo',
      trace: intro.trace,
      toolPath: '/tools/github.repo',
      requestBody: body as Record<string, unknown>,
      resource: resource as unknown as Record<string, unknown>,
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(buildAuditEvent(
        payload.sub,
        'github.repo',
        resource,
        'deny',
        denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
        payload.jti,
        body.messageId,
        body.parentEventId,
        { approvalId: approval.approvalId, approvalStatus: approval.status },
      ));
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  const issueSummary = (issue: any) => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    updatedAt: issue.updated_at,
    htmlUrl: issue.html_url,
    author: issue.user?.login,
    isPullRequest: Boolean(issue.pull_request),
    labels: Array.isArray(issue.labels) ? issue.labels.map((label: any) => label.name).filter((name: unknown) => typeof name === 'string') : [],
  });

  const listArgsSchema = z.object({
    state: z.enum(['open', 'closed', 'all']).optional(),
    perPage: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).max(100).optional(),
  }).strict();
  const getArgsSchema = z.object({
    issueNumber: z.number().int().positive(),
  }).strict();

  const githubAction = body.action;
  const args = body.args || {};
  if (githubAction !== 'issues.list' && githubAction !== 'issues.get') {
    await sendAudit(buildAuditEvent(payload.sub, 'github.repo', resource, 'deny', `Unsupported GitHub action: ${githubAction}`, payload.jti, body.messageId, body.parentEventId));
    return reply.status(400).send({ error: `Unsupported GitHub action: ${githubAction}` });
  }

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'polar-gateway',
  };
  const token = await getConnectorCredential('github.repo');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    if (githubAction === 'issues.list') {
      const parsed = listArgsSchema.safeParse(args);
      if (!parsed.success) {
        await sendAudit(buildAuditEvent(payload.sub, 'github.repo', resource, 'deny', 'Invalid arguments for issues.list', payload.jti, body.messageId, body.parentEventId));
        return reply.status(400).send({ error: 'Invalid arguments for issues.list' });
      }

      const query = new URLSearchParams({
        ...(parsed.data.state ? { state: parsed.data.state } : {}),
        ...(parsed.data.perPage ? { per_page: String(parsed.data.perPage) } : {}),
        ...(parsed.data.page ? { page: String(parsed.data.page) } : {}),
      });
      const response = await fetch(`https://api.github.com/repos/${body.resourceId}/issues?${query.toString()}`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        await sendAudit(buildAuditEvent(
          payload.sub,
          'github.repo',
          resource,
          'deny',
          `GitHub API error (${response.status}): ${errorBody.slice(0, 200)}`,
          payload.jti,
          body.messageId,
          body.parentEventId,
        ));
        return reply.status(response.status).send({ error: `GitHub API returned ${response.status}` });
      }

      const issues = await response.json();
      const sanitized = Array.isArray(issues) ? issues.map(issueSummary) : [];
      await sendAudit(buildAuditEvent(payload.sub, 'github.repo', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
      return {
        ok: true,
        action: githubAction,
        count: sanitized.length,
        issues: sanitized,
      };
    }

    const parsed = getArgsSchema.safeParse(args);
    if (!parsed.success) {
      await sendAudit(buildAuditEvent(payload.sub, 'github.repo', resource, 'deny', 'Invalid arguments for issues.get', payload.jti, body.messageId, body.parentEventId));
      return reply.status(400).send({ error: 'Invalid arguments for issues.get' });
    }

    const response = await fetch(`https://api.github.com/repos/${body.resourceId}/issues/${parsed.data.issueNumber}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) {
      const errorBody = await response.text();
      await sendAudit(buildAuditEvent(
        payload.sub,
        'github.repo',
        resource,
        'deny',
        `GitHub API error (${response.status}): ${errorBody.slice(0, 200)}`,
        payload.jti,
        body.messageId,
        body.parentEventId,
      ));
      return reply.status(response.status).send({ error: `GitHub API returned ${response.status}` });
    }

    const issue = await response.json();
    await sendAudit(buildAuditEvent(payload.sub, 'github.repo', resource, 'allow', undefined, payload.jti, body.messageId, body.parentEventId));
    return {
      ok: true,
      action: githubAction,
      issue: issueSummary(issue),
    };
  } catch (error) {
    await sendAudit(buildAuditEvent(
      payload.sub,
      'github.repo',
      resource,
      'deny',
      `GitHub request failed: ${(error as Error).message}`,
      payload.jti,
      body.messageId,
      body.parentEventId,
    ));
    return reply.status(502).send({ error: `GitHub request failed: ${(error as Error).message}` });
  }
});

app.post('/tools/cli.run', async (request, reply) => {
  const body = request.body as { token?: string; command?: string; args?: string[]; messageId?: string; parentEventId?: string };

  if (!body?.token || !body?.command) {
    return reply.status(401).send({ error: 'Token and command are required' });
  }

  // 1. Validate Command against Allowlist
  const allowlist = gatewayConfig.cliAllowlist;
  const config = allowlist[body.command];

  if (!config) {
    return reply.status(403).send({ error: `Command '${body.command}' is not in the allowlist` });
  }

  // 2. Validate Args (Subcommands & Shell safety)
  const args = body.args || [];

  // Rule: Must prevent shell injection characters if they somehow slipped through.
  // Although 'spawn' array-format protects against most, purely restrictive policy is better.
  const shellMetachars = /[|&;<>$`\\]/;
  if (args.some(arg => shellMetachars.test(arg))) {
    return reply.status(400).send({ error: 'Arguments contain forbidden shell metacharacters' });
  }

  // Rule: First argument usually serves as subcommand checking for git
  if (config.allowedSubcommands.length > 0) {
    const subcommand = args[0];
    if (!subcommand || !config.allowedSubcommands.includes(subcommand)) {
      return reply.status(403).send({ error: `Subcommand '${subcommand}' is not allowed for ${body.command}` });
    }
  }

  if (isDeniedShellBinary(config.bin)) {
    return reply.status(403).send({ error: `Command '${body.command}' is mapped to a forbidden shell binary` });
  }

  const resource = { type: 'cli', command: body.command };

  // 3. Token Verification
  let payload;
  let intro: IntrospectionResult;
  try {
    payload = await verifyCapabilityToken(body.token, await readSigningKey());
    intro = await introspectToken(body.token);
    if (!intro.active) {
      await sendAudit(buildAuditEvent(payload.sub, 'cli.run', resource, 'deny', `Introspection failed: ${intro.error}`, payload.jti, body.messageId, body.parentEventId));
      return reply.status(401).send({ error: 'Token revoked' });
    }
  } catch {
    await sendAudit(buildAuditEvent('unknown', 'cli.run', resource, 'deny', 'Invalid token', undefined, body.messageId, body.parentEventId));
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.act !== 'cli.run') {
    await sendAudit(buildAuditEvent(payload.sub, 'cli.run', resource, 'deny', 'Action mismatch', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Action not permitted' });
  }

  // 4. Policy Check
  const allowed = matchesResourceConstraint(payload.res, resource as any);
  if (!allowed) {
    await sendAudit(buildAuditEvent(payload.sub, 'cli.run', resource, 'deny', 'Resource denied', payload.jti, body.messageId, body.parentEventId));
    return reply.status(403).send({ error: 'Access to this command is not permitted' });
  }

  const internalBypass = isInternalRuntimeCall(request.headers as Record<string, unknown>)
    && Boolean(readHeaderValue(request.headers as Record<string, unknown>, 'x-polar-approval-id'));
  if (payload.rcf && !internalBypass) {
    const approval = await requestHumanApproval({
      jti: payload.jti,
      subject: payload.sub,
      action: 'cli.run',
      trace: intro.trace,
      toolPath: '/tools/cli.run',
      requestBody: body as Record<string, unknown>,
      resource: resource as unknown as Record<string, unknown>,
    });
    const isApproved = approval.status === 'approved' || approval.status === 'executed';
    if (!isApproved) {
      const denied = approval.status === 'denied';
      await sendAudit(buildAuditEvent(
        payload.sub,
        'cli.run',
        resource,
        'deny',
        denied ? 'Denied by confirmation workflow' : 'Awaiting user confirmation',
        payload.jti,
        body.messageId,
        body.parentEventId,
        { approvalId: approval.approvalId, approvalStatus: approval.status },
      ));
      return reply.status(denied ? 403 : 409).send({
        error: denied ? 'Request denied by user' : 'User confirmation required',
        approvalId: approval.approvalId,
      });
    }
  }

  // 5. Execution
  return new Promise((resolve) => {
    const child = spawn(config.bin, args, {
      cwd: gatewayConfig.fsBaseDir, // Enforce working directory in sandbox
      env: {}, // Clean env, or strictly allowed vars
      timeout: 10000 // 10s timeout
    });

    let stdout = '';
    let stderr = '';
    let outputSize = 0;
    const MAX_OUTPUT = 100 * 1024; // 100KB

    child.stdout.on('data', (data) => {
      if (outputSize < MAX_OUTPUT) {
        stdout += data.toString();
        outputSize += data.length;
      }
    });
    child.stderr.on('data', (data) => {
      if (outputSize < MAX_OUTPUT) {
        stderr += data.toString();
        outputSize += data.length;
      }
    });

    child.on('close', async (code) => {
      const truncated = outputSize >= MAX_OUTPUT ? '...[truncated]' : '';

      await sendAudit(
        buildAuditEvent(
          payload.sub,
          'cli.run',
          resource,
          'allow',
          `Exit code: ${code}`,
          payload.jti,
          body.messageId,
          body.parentEventId,
          {
            command: body.command,
            args,
            exitCode: code,
          },
        ),
      );

      resolve({
        ok: code === 0,
        code,
        stdout: stdout + truncated,
        stderr: stderr
      });
    });

    child.on('error', async (err) => {
      await sendAudit(
        buildAuditEvent(
          payload.sub,
          'cli.run',
          resource,
          'allow',
          `Exec failed: ${err.message}`,
          payload.jti,
          body.messageId,
          body.parentEventId,
          {
            command: body.command,
            args,
          },
        ),
      );
      resolve(reply.status(500).send({ error: err.message }));
    });
  });
});

// Startup Safety Check
async function startupCheck(): Promise<void> {
  const { runDiagnostics } = await import('./doctorService.js');
  const results = await runDiagnostics();
  const criticalIssues = results.filter(r => r.status === 'CRITICAL');

  if (criticalIssues.length > 0) {
    console.error('\n=== GATEWAY STARTUP BLOCKED ===');
    console.error('Critical issues detected:');
    for (const issue of criticalIssues) {
      console.error(`  [${issue.id}] ${issue.message}`);
      if (issue.remediation) {
        console.error(`    Fix: ${issue.remediation}`);
      }
    }
    console.error('Resolve these issues before starting the gateway.\n');
    process.exit(1);
  }
}

await startupCheck();

app.listen({ port: gatewayConfig.port, host: gatewayConfig.bindAddress }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
