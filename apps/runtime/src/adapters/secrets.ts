import fs from 'node:fs/promises';
import path from 'node:path';
import { runtimeConfig } from '../config.js';
import { getMasterKey, encryptData, decryptData, EncryptedData } from '../crypto.js';

export interface SecretsAdapter {
    getSecret(key: string): Promise<string | undefined>;
    setSecret(key: string, value: string): Promise<void>;
    deleteSecret(key: string): Promise<void>;
    listSecrets(): Promise<string[]>;
}

export class FileSecretsAdapter implements SecretsAdapter {
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    private async load(): Promise<Record<string, string>> {
        try {
            const raw = await fs.readFile(this.filePath, 'utf-8');
            const data = JSON.parse(raw);

            if (data && typeof data.iv === 'string' && typeof data.content === 'string' && typeof data.authTag === 'string') {
                const key = await getMasterKey();
                const decrypted = decryptData(data as EncryptedData, key);
                return JSON.parse(decrypted);
            }

            return data;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return {};
            }
            throw error;
        }
    }

    private async save(secrets: Record<string, string>): Promise<void> {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.tmp`;

        const key = await getMasterKey();
        const encrypted = encryptData(JSON.stringify(secrets), key);

        await fs.writeFile(tempPath, JSON.stringify(encrypted, null, 2), 'utf-8');
        await fs.rename(tempPath, this.filePath);
    }

    async getSecret(key: string): Promise<string | undefined> {
        const secrets = await this.load();
        return secrets[key];
    }

    async setSecret(key: string, value: string): Promise<void> {
        const secrets = await this.load();
        secrets[key] = value;
        await this.save(secrets);
    }

    async deleteSecret(key: string): Promise<void> {
        const secrets = await this.load();
        delete secrets[key];
        await this.save(secrets);
    }

    async listSecrets(): Promise<string[]> {
        const secrets = await this.load();
        return Object.keys(secrets);
    }
}

// Wrapper for load/save to fix scope issues in the class above if I messed up `this`
// Actually, let's fix the class methods to call valid internal methods.

export class EnvSecretsAdapter implements SecretsAdapter {
    private prefix: string;

    constructor(prefix: string = 'POLAR_SECRET_') {
        this.prefix = prefix;
    }

    async getSecret(key: string): Promise<string | undefined> {
        return process.env[`${this.prefix}${key}`];
    }

    async setSecret(_key: string, _value: string): Promise<void> {
        throw new Error('EnvSecretsAdapter is read-only');
    }

    async deleteSecret(_key: string): Promise<void> {
        throw new Error('EnvSecretsAdapter is read-only');
    }

    async listSecrets(): Promise<string[]> {
        return Object.keys(process.env)
            .filter(k => k.startsWith(this.prefix))
            .map(k => k.slice(this.prefix.length));
    }
}

// Factory
export function createSecretsAdapter(profile: 'local' | 'cloud' | 'edge'): SecretsAdapter {
    switch (profile) {
        case 'cloud':
        case 'edge':
            // In a real scenario, this might use AWS Secrets Manager SDK
            // For now, we follow 12-factor app principles and use Env Variables for cloud/edge
            // or specific cloud SDKs if we had them.
            return new EnvSecretsAdapter();
        case 'local':
        default:
            return new FileSecretsAdapter(runtimeConfig.secretsPath);
    }
}
