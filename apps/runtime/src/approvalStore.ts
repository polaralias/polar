import fs from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { runtimeConfig } from './config.js';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'executed' | 'failed';

export type PendingApproval = {
  id: string;
  status: ApprovalStatus;
  jti: string;
  subject: string;
  action: string;
  sessionId?: string;
  agentId?: string;
  traceId?: string;
  parentEventId?: string;
  resource: Record<string, unknown>;
  request: {
    toolPath: string;
    body: Record<string, unknown>;
  };
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  result?: unknown;
  error?: string;
};

const APPROVALS_FILE = path.join(runtimeConfig.dataDir, 'approvals.json');
const mutex = new Mutex();

async function loadApprovalsUnsafe(): Promise<PendingApproval[]> {
  try {
    const raw = await fs.readFile(APPROVALS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PendingApproval[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function saveApprovalsUnsafe(approvals: PendingApproval[]): Promise<void> {
  await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
  const tempPath = `${APPROVALS_FILE}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(approvals, null, 2), 'utf-8');
  await fs.rename(tempPath, APPROVALS_FILE);
}

export async function listApprovals(filter: { sessionId?: string; status?: ApprovalStatus } = {}): Promise<PendingApproval[]> {
  const approvals = await loadApprovalsUnsafe();
  return approvals.filter((approval) => {
    if (filter.sessionId && approval.sessionId !== filter.sessionId) return false;
    if (filter.status && approval.status !== filter.status) return false;
    return true;
  });
}

export async function getApproval(id: string): Promise<PendingApproval | undefined> {
  const approvals = await loadApprovalsUnsafe();
  return approvals.find((approval) => approval.id === id);
}

export async function getApprovalByJti(jti: string): Promise<PendingApproval | undefined> {
  const approvals = await loadApprovalsUnsafe();
  return approvals.find((approval) => approval.jti === jti);
}

export async function createOrGetApproval(approval: PendingApproval): Promise<PendingApproval> {
  return mutex.runExclusive(async () => {
    const approvals = await loadApprovalsUnsafe();
    const existing = approvals.find((entry) => entry.jti === approval.jti);
    if (existing) {
      return existing;
    }
    approvals.push(approval);
    await saveApprovalsUnsafe(approvals);
    return approval;
  });
}

export async function updateApproval(
  id: string,
  patch: Partial<PendingApproval>,
): Promise<PendingApproval | undefined> {
  return mutex.runExclusive(async () => {
    const approvals = await loadApprovalsUnsafe();
    const index = approvals.findIndex((approval) => approval.id === id);
    if (index < 0) return undefined;

    const current = approvals[index];
    if (!current) return undefined;

    const next: PendingApproval = {
      ...current,
      ...patch,
    };
    approvals[index] = next;
    await saveApprovalsUnsafe(approvals);
    return next;
  });
}
