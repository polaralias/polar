import { createSecretsAdapter } from './adapters/secrets.js';
import { runtimeConfig } from './config.js';

export const secretsAdapter = createSecretsAdapter(runtimeConfig.deploymentProfile);

export async function getSecret(key: string): Promise<string | undefined> {
    return secretsAdapter.getSecret(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
    return secretsAdapter.setSecret(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
    return secretsAdapter.deleteSecret(key);
}

export async function listSecrets(): Promise<string[]> {
    return secretsAdapter.listSecrets();
}
