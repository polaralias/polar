import fs from 'node:fs/promises';
import { runtimeConfig } from './config.js';

let cachedSigningKey: Uint8Array | null = null;
let lastKeyMtime: number = 0;

export async function readSigningKey(): Promise<Uint8Array> {
    const stats = await fs.stat(runtimeConfig.signingKeyPath);
    if (cachedSigningKey && stats.mtimeMs === lastKeyMtime) {
        return cachedSigningKey;
    }
    const key = await fs.readFile(runtimeConfig.signingKeyPath, 'utf-8');
    cachedSigningKey = new TextEncoder().encode(key.trim());
    lastKeyMtime = stats.mtimeMs;
    return cachedSigningKey;
}
