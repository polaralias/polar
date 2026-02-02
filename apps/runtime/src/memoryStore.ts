import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    MemoryItem,
    MemoryItemSchema,
    MemoryProposal,
    MemoryQuery,
    SensitivityLevel,
} from '@polar/core';
import { runtimeConfig } from './config.js';
import { Mutex } from 'async-mutex';

const mutex = new Mutex();

const MEMORY_PATH = path.join(runtimeConfig.dataDir, 'memory.json');
let lastCleanupAt: string | undefined;

export function getLastCleanupAt(): string | undefined {
    return lastCleanupAt;
}

async function getEncryptionKey(): Promise<Buffer> {
    const keyRaw = await fs.readFile(runtimeConfig.signingKeyPath, 'utf-8');
    return crypto.createHash('sha256').update(keyRaw).digest();
}

function encrypt(data: any, key: Buffer): any {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${encrypted}:${tag}`;
}

function decrypt(encryptedStr: string, key: Buffer): any {
    const parts = encryptedStr.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const ivHex = parts[0]!;
    const contentHex = parts[1]!;
    const tagHex = parts[2]!;

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(contentHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

export async function loadMemory(): Promise<MemoryItem[]> {
    try {
        const key = await getEncryptionKey();
        const raw = await fs.readFile(MEMORY_PATH, 'utf-8');
        const items = JSON.parse(raw);
        if (!Array.isArray(items)) return [];

        return items.map((item: any) => {
            // Check if content is encrypted (string with 2 colons)
            // Ideally we should flag this better, but heuristic works for migration
            if (typeof item.content === 'string' && item.content.split(':').length === 3) {
                try {
                    item.content = decrypt(item.content, key);
                } catch {
                    // Start fresh or keep raw if decryption fails (e.g. key mismatch)
                }
            }
            return MemoryItemSchema.parse(item);
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

export async function saveMemory(items: MemoryItem[]): Promise<void> {
    const key = await getEncryptionKey();
    // Deep clone to avoid mutating in-memory items
    const itemsToSave = items.map(item => ({
        ...item,
        content: encrypt(item.content, key)
    }));

    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    const tempPath = `${MEMORY_PATH}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(itemsToSave, null, 2), 'utf-8');
    await fs.rename(tempPath, MEMORY_PATH);
}

export async function proposeMemory(
    proposal: MemoryProposal,
    subjectId: string,
    agentId?: string,
    skillId?: string,
): Promise<MemoryItem> {
    // BUG-001 FIX: Validate content size before accepting proposal
    const contentSize = Buffer.byteLength(JSON.stringify(proposal.content), 'utf-8');
    if (contentSize > runtimeConfig.maxMemoryContentSize) {
        throw new Error(`Memory content size (${contentSize} bytes) exceeds maximum allowed (${runtimeConfig.maxMemoryContentSize} bytes)`);
    }

    return await mutex.runExclusive(async () => {
        const items = await loadMemory();

        const now = new Date();
        const ttlSeconds = proposal.ttlSeconds ?? (proposal.type === 'session' ? 3600 : undefined);
        const expiresAt = ttlSeconds ? new Date(now.getTime() + ttlSeconds * 1000).toISOString() : undefined;

        const newItem: MemoryItem = {
            id: crypto.randomUUID(),
            type: proposal.type,
            subjectId,
            scopeId: proposal.scopeId,
            content: proposal.content,
            provenance: {
                agentId,
                skillId,
                sourceId: proposal.sourceId,
                timestamp: now.toISOString(),
            },
            metadata: {
                tags: [], // Could be filled by compactor later
                sensitivity: proposal.sensitivityHint ?? 'low',
                ttlSeconds,
                expiresAt,
            },
        };

        items.push(newItem);
        await saveMemory(items);
        return newItem;
    });
}

const SENSITIVITY_ORDER: Record<string, number> = {
    low: 0,
    moderate: 1,
    high: 2,
};

function isSensitivityAllowed(itemSensitivity: string, maxSensitivity: string): boolean {
    return (SENSITIVITY_ORDER[itemSensitivity] ?? 0) <= (SENSITIVITY_ORDER[maxSensitivity] ?? 0);
}

export async function queryMemory(query: MemoryQuery, subjectId: string): Promise<MemoryItem[]> {
    const allItems = await loadMemory();
    const now = new Date().toISOString();

    return allItems
        .filter(item => {
            // Basic ACL (subject)
            if (item.subjectId !== subjectId) return false;

            // TTL check
            if (item.metadata.expiresAt && item.metadata.expiresAt < now) return false;

            // Type filter
            if (query.types && !query.types.includes(item.type)) return false;

            // Scope filter
            if (query.scopeIds && !query.scopeIds.includes(item.scopeId)) return false;

            // Sensitivity filter
            if (query.maxSensitivity && !isSensitivityAllowed(item.metadata.sensitivity, query.maxSensitivity)) return false;

            // Tag filter
            if (query.tags && !query.tags.every(tag => item.metadata.tags.includes(tag))) return false;

            // Text search (very primitive)
            if (query.queryText) {
                const contentStr = JSON.stringify(item.content).toLowerCase();
                if (!contentStr.includes(query.queryText.toLowerCase())) return false;
            }

            return true;
        })
        .slice(0, query.limit ?? 50);
}

export async function deleteMemory(id: string, subjectId: string): Promise<boolean> {
    return await mutex.runExclusive(async () => {
        const items = await loadMemory();
        const filtered = items.filter(item => item.id !== id || item.subjectId !== subjectId);

        if (filtered.length === items.length) return false;

        await saveMemory(filtered);
        return true;
    });
}

export async function runMemoryCleanup(): Promise<number> {
    return await mutex.runExclusive(async () => {
        const items = await loadMemory();
        const now = new Date().toISOString();
        const valid = items.filter(item => !item.metadata.expiresAt || item.metadata.expiresAt > now);

        const deletedCount = items.length - valid.length;
        lastCleanupAt = now;
        if (deletedCount > 0) {
            await saveMemory(valid);
        }
        return deletedCount;
    });
}

/**
 * Get memory TTL stats for doctor diagnostics.
 * Returns count of expired items that should be cleaned up.
 */
export async function getMemoryTTLStats(): Promise<{ total: number; expired: number; expiringSoon: number }> {
    const items = await loadMemory();
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    let expired = 0;
    let expiringSoon = 0;

    for (const item of items) {
        if (item.metadata.expiresAt) {
            const expiresAt = new Date(item.metadata.expiresAt);
            if (expiresAt <= now) {
                expired++;
            } else if (expiresAt <= oneHourFromNow) {
                expiringSoon++;
            }
        }
    }

    return { total: items.length, expired, expiringSoon };
}
