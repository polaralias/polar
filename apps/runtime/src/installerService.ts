import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillManifestSchema } from '@polar/core';
import { runtimeConfig } from './config.js';
import { registerSkill } from './skillStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Path to the installer dist/index.js
const INSTALLER_PATH = path.resolve(__dirname, '../../installer/dist/index.js');

export async function installSkill(sourceDir: string): Promise<any> {
    const destBaseDir = path.join(runtimeConfig.dataDir, 'skills');

    return new Promise((resolve, reject) => {
        const child = spawn('node', [INSTALLER_PATH, sourceDir, destBaseDir]);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', async (code) => {
            if (code !== 0) {
                try {
                    const errorJson = JSON.parse(stderr || stdout);
                    return reject(new Error(errorJson.error || 'Installer failed'));
                } catch {
                    return reject(new Error(stderr || `Installer exited with code ${code}`));
                }
            }

            try {
                const result = JSON.parse(stdout);
                const registration = await registerSkill(result.manifest, result.path, result.hash, result.signature);
                resolve(registration);
            } catch (error) {
                reject(new Error('Failed to parse installer output or register skill'));
            }
        });
    });
}
