import fs from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { runtimeConfig } from './config.js';

const mutex = new Mutex();
const REVOCATION_FILE = path.join(runtimeConfig.dataDir, 'revoked_tokens.json');

// We use a simple JSON file for now. In production this would be a high-performance KV store.
interface RevocationList {
    blockedJtis: string[];
}

export async function loadRevocationList(): Promise<RevocationList> {
    try {
        const raw = await fs.readFile(REVOCATION_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { blockedJtis: [] };
        }
        throw error;
    }
}

export async function saveRevocationList(list: RevocationList): Promise<void> {
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    const tempPath = `${REVOCATION_FILE}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(list, null, 2), 'utf-8');
    await fs.rename(tempPath, REVOCATION_FILE);
}

export async function revokeToken(jti: string): Promise<void> {
    await mutex.runExclusive(async () => {
        const list = await loadRevocationList();
        if (!list.blockedJtis.includes(jti)) {
            list.blockedJtis.push(jti);
            await saveRevocationList(list);
        }
    });
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
    const list = await loadRevocationList();
    return list.blockedJtis.includes(jti);
}
