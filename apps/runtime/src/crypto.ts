import fs from 'node:fs/promises';
import crypto from 'node:crypto';
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

let cachedMasterKey: Buffer | null = null;

export async function getMasterKey(): Promise<Buffer> {
    if (cachedMasterKey) return cachedMasterKey;

    // 1. Try env var
    if (process.env.POLAR_MASTER_KEY) {
        // user provided hex string
        cachedMasterKey = Buffer.from(process.env.POLAR_MASTER_KEY, 'hex');
        if (cachedMasterKey.length !== 32) {
            throw new Error('POLAR_MASTER_KEY must be a 32-byte hex string');
        }
        return cachedMasterKey;
    }

    // 2. Try file
    try {
        const keyHex = await fs.readFile(runtimeConfig.masterKeyPath, 'utf-8');
        cachedMasterKey = Buffer.from(keyHex.trim(), 'hex');
        return cachedMasterKey;
    } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
    }

    // 3. Generate
    console.warn(`[Security] Generating new master key at ${runtimeConfig.masterKeyPath}`);
    const newKey = crypto.randomBytes(32);
    // Ensure data dir exists
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    await fs.writeFile(runtimeConfig.masterKeyPath, newKey.toString('hex'), { mode: 0o600 });
    cachedMasterKey = newKey;
    return newKey;
}

export interface EncryptedData {
    iv: string;
    content: string;
    authTag: string;
}

export function encryptData(text: string, key: Buffer): EncryptedData {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return {
        iv: iv.toString('hex'),
        content: encrypted,
        authTag: authTag.toString('hex')
    };
}

export function decryptData(data: EncryptedData, key: Buffer): string {
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(data.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));
    let decrypted = decipher.update(data.content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
