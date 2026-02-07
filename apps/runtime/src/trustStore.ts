import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { runtimeConfig } from './config.js';

const mutex = new Mutex();
const TRUST_STORE_FILE = path.join(runtimeConfig.dataDir, 'trust_store.json');

export type TrustedPublisher = {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt?: string;
};

function canonicalizePublicKey(publicKey: string): string {
  return publicKey.trim().replace(/\r\n/g, '\n');
}

function fingerprintPublicKey(publicKey: string): string {
  return crypto
    .createHash('sha256')
    .update(canonicalizePublicKey(publicKey))
    .digest('hex');
}

async function loadTrustStoreUnsafe(): Promise<TrustedPublisher[]> {
  try {
    const raw = await fs.readFile(TRUST_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as TrustedPublisher[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) =>
      typeof entry?.id === 'string'
      && typeof entry?.name === 'string'
      && typeof entry?.publicKey === 'string'
      && typeof entry?.fingerprint === 'string',
    );
  } catch {
    return [];
  }
}

async function saveTrustStoreUnsafe(entries: TrustedPublisher[]): Promise<void> {
  await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
  const tempPath = `${TRUST_STORE_FILE}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(entries, null, 2), 'utf-8');
  await fs.rename(tempPath, TRUST_STORE_FILE);
}

export async function listTrustedPublishers(): Promise<TrustedPublisher[]> {
  return mutex.runExclusive(async () => {
    const entries = await loadTrustStoreUnsafe();
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function addTrustedPublisher(input: {
  name: string;
  publicKey: string;
}): Promise<TrustedPublisher> {
  const name = input.name.trim();
  const publicKey = canonicalizePublicKey(input.publicKey);
  if (!name) {
    throw new Error('Publisher name is required');
  }
  if (!publicKey) {
    throw new Error('Public key is required');
  }

  return mutex.runExclusive(async () => {
    const entries = await loadTrustStoreUnsafe();
    const fingerprint = fingerprintPublicKey(publicKey);
    const existing = entries.find((entry) => entry.fingerprint === fingerprint);
    if (existing) {
      return existing;
    }

    const publisher: TrustedPublisher = {
      id: crypto.randomUUID(),
      name,
      publicKey,
      fingerprint,
      createdAt: new Date().toISOString(),
    };
    entries.push(publisher);
    await saveTrustStoreUnsafe(entries);
    return publisher;
  });
}

export async function removeTrustedPublisher(id: string): Promise<boolean> {
  return mutex.runExclusive(async () => {
    const entries = await loadTrustStoreUnsafe();
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) {
      return false;
    }
    await saveTrustStoreUnsafe(next);
    return true;
  });
}

export async function isPublicKeyTrusted(publicKey: string): Promise<boolean> {
  const normalized = canonicalizePublicKey(publicKey);
  if (!normalized) return false;
  const fingerprint = fingerprintPublicKey(normalized);
  return mutex.runExclusive(async () => {
    const entries = await loadTrustStoreUnsafe();
    return entries.some((entry) => entry.fingerprint === fingerprint);
  });
}

export async function touchTrustedPublisherUsage(publicKey: string): Promise<void> {
  const normalized = canonicalizePublicKey(publicKey);
  if (!normalized) return;
  const fingerprint = fingerprintPublicKey(normalized);
  await mutex.runExclusive(async () => {
    const entries = await loadTrustStoreUnsafe();
    const index = entries.findIndex((entry) => entry.fingerprint === fingerprint);
    if (index < 0) return;
    const current = entries[index];
    if (!current) return;
    entries[index] = {
      ...current,
      lastUsedAt: new Date().toISOString(),
    };
    await saveTrustStoreUnsafe(entries);
  });
}
