import fs from 'node:fs/promises';
import { AuditEvent, AuditEventSchema } from '@polar/core';
import { runtimeConfig } from './config.js';

export type AuditQuery = {
  from?: string;
  to?: string;
  subject?: string;
  tool?: string;
  decision?: 'allow' | 'deny';
  limit?: number;
};

export async function appendAudit(event: AuditEvent): Promise<void> {
  const parsed = AuditEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error('Invalid audit event');
  }

  await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
  const line = `${JSON.stringify(parsed.data)}\n`;
  await fs.appendFile(runtimeConfig.auditPath, line, 'utf-8');
}

export async function queryAudit(query: AuditQuery): Promise<AuditEvent[]> {
  try {
    const raw = await fs.readFile(runtimeConfig.auditPath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const events: AuditEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = AuditEventSchema.safeParse(JSON.parse(line));
        if (parsed.success) {
          events.push(parsed.data);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return filterAuditEvents(events, query);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function filterAuditEvents(events: AuditEvent[], query: AuditQuery): AuditEvent[] {
  const fromTime = query.from ? new Date(query.from).getTime() : undefined;
  const toTime = query.to ? new Date(query.to).getTime() : undefined;
  const limit = query.limit ?? 200;

  return events
    .filter((event) => {
      const time = new Date(event.time).getTime();
      if (fromTime && time < fromTime) return false;
      if (toTime && time > toTime) return false;
      if (query.subject && event.subject !== query.subject) return false;
      if (query.tool && event.tool !== query.tool) return false;
      if (query.decision && event.decision !== query.decision) return false;
      return true;
    })
    .slice(-limit);
}
