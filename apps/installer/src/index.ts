import fs from 'node:fs/promises';
import path from 'node:path';
import { SkillManifestSchema } from '@polar/core';

import crypto from 'node:crypto';

async function calculateHash(dir: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const files = await fs.readdir(dir);
    // Sort files to ensure deterministic hash
    files.sort();

    for (const file of files) {
        if (file === 'signature.json') continue;
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
            const content = await fs.readFile(filePath);
            hash.update(file);
            hash.update(content);
        }
    }
    return hash.digest('hex');
}

async function main() {
    const sourceDir = process.argv[2];
    const destBaseDir = process.argv[3];

    if (!sourceDir || !destBaseDir) {
        console.error('Usage: polar-installer <sourceDir> <destBaseDir>');
        process.exit(1);
    }

    try {
        let manifestPath = path.join(sourceDir, 'manifest.json');
        let manifestExists = true;
        try {
            await fs.access(manifestPath);
        } catch {
            manifestPath = path.join(sourceDir, 'polar.skill.json');
            try {
                await fs.access(manifestPath);
            } catch {
                manifestExists = false;
            }
        }

        if (!manifestExists) {
            console.error(JSON.stringify({ error: 'Manifest not found', details: 'Neither manifest.json nor polar.skill.json found in source directory' }));
            process.exit(1);
        }

        const rawManifest = await fs.readFile(manifestPath, 'utf-8');
        const manifestJson = JSON.parse(rawManifest);

        const parsed = SkillManifestSchema.safeParse(manifestJson);
        if (!parsed.success) {
            console.error(JSON.stringify({ error: 'Invalid manifest', details: parsed.error.format() }));
            process.exit(1);
        }

        const manifest = parsed.data;
        const destDir = path.join(destBaseDir, manifest.id);

        await fs.mkdir(destDir, { recursive: true });

        const files = await fs.readdir(sourceDir);
        for (const file of files) {
            const sourceFile = path.join(sourceDir, file);
            let destFile = path.join(destDir, file);

            // If we are copying polar.skill.json, rename it to manifest.json in the destination
            if (file === 'polar.skill.json' && !files.includes('manifest.json')) {
                destFile = path.join(destDir, 'manifest.json');
            }

            await fs.copyFile(sourceFile, destFile);
        }

        const hash = await calculateHash(destDir);
        let signatureData = null;
        try {
            const sigPath = path.join(destDir, 'signature.json');
            const rawSig = await fs.readFile(sigPath, 'utf-8');
            signatureData = JSON.parse(rawSig);
        } catch {
            // No signature
        }

        console.log(JSON.stringify({
            success: true,
            manifest,
            path: destDir,
            hash,
            signature: signatureData
        }));
    } catch (error) {
        console.error(JSON.stringify({
            error: 'Installation failed',
            details: (error as Error).message
        }));
        process.exit(1);
    }
}

main();
