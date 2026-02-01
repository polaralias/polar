import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import crypto from 'node:crypto';
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

// Queue to serialize writes for blockchain integrity
let auditQueue = Promise.resolve();

export function appendAudit(event: AuditEvent): Promise<void> {
  const next = auditQueue.then(() => processAppend(event));
  auditQueue = next.catch((err) => {
    console.error('Audit append failed:', err);
  });
  return next;
}

async function processAppend(event: AuditEvent): Promise<void> {
  // Validate structure
  const parsed = AuditEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error('Invalid audit event');
  }

  // Ensure directory exists
  await fs.mkdir(runtimeConfig.dataDir, { recursive: true });

  const previousHash = await getLastHash();

  // Create record with linking info
  // Remove any existing hash/prevHash from input to prevent spoofing
  const { hash: _h, previousHash: _p, ...cleanEvent } = parsed.data;

  const recordToHash = {
    ...cleanEvent,
    previousHash,
  };

  // Calculate hash
  const contentString = JSON.stringify(recordToHash);
  const hash = crypto.createHash('sha256').update(contentString).digest('hex');

  const finalRecord = {
    ...recordToHash,
    hash,
  };

  const line = `${JSON.stringify(finalRecord)}\n`;
  await fs.appendFile(runtimeConfig.auditPath, line, 'utf-8');
}

async function getLastHash(): Promise<string> {
  const GENESIS_HASH = '0'.repeat(64);
  try {
    const fileHandle = await fs.open(runtimeConfig.auditPath, 'r');
    try {
      const stats = await fileHandle.stat();
      if (stats.size === 0) return GENESIS_HASH;

      const bufferSize = 4096; // Scan last 4KB
      const position = Math.max(0, stats.size - bufferSize);
      const length = stats.size - position;
      const buffer = Buffer.alloc(length);

      await fileHandle.read(buffer, 0, length, position);
      const content = buffer.toString('utf-8');

      // Split by newline and filter empty strings (e.g. trailing newline)
      const lines = content.trim().split('\n');

      if (lines.length === 0) return GENESIS_HASH;

      // Iterate backwards to find last valid JSON
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line) continue;
        try {
          const json = JSON.parse(line);
          if (typeof json.hash === 'string' && json.hash.length === 64) {
            return json.hash as string;
          }
        } catch {
          // Ignore partial/malformed lines
        }
      }
      return GENESIS_HASH;
    } finally {
      await fileHandle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return GENESIS_HASH;
    }
    throw error;
  }
}

export async function queryAudit(query: AuditQuery): Promise<AuditEvent[]> {
  try {
    const fileStream = createReadStream(runtimeConfig.auditPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const fromTime = query.from ? new Date(query.from).getTime() : undefined;
    const toTime = query.to ? new Date(query.to).getTime() : undefined;
    const limit = query.limit ?? 200;

    // We want the *last* N matching events. To do this efficiently without loading everything,
    // we keep a rolling buffer of matches.
    const buffer: AuditEvent[] = [];

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const event = AuditEventSchema.parse(JSON.parse(line));

        // Filter logic
        const time = new Date(event.time).getTime();
        if (fromTime && time < fromTime) continue;
        if (toTime && time > toTime) continue;
        if (query.subject && event.subject !== query.subject) continue;
        if (query.tool && event.tool !== query.tool) continue;
        if (query.decision && event.decision !== query.decision) continue;

        buffer.push(event);

        // Optimization: If we have more than limit, we *could* shift, 
        // but for extremely large logs where matches >> limit, shifting is O(N).
        // A circular buffer would be better, or just splice occasionally.
        // For simplicity and reasonable limits, shift is fine.
        if (buffer.length > limit) {
          buffer.shift();
        }
      } catch {
        // Skip malformed
      }
    }

    return buffer;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
