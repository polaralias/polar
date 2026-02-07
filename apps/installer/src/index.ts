import fs from 'node:fs/promises';
import path from 'node:path';
import { SkillManifestSchema } from '@polar/core';

import crypto from 'node:crypto';

async function listFilesRecursive(rootDir: string): Promise<string[]> {
    const files: string[] = [];
    async function walk(currentDir: string): Promise<void> {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const absolutePath = path.join(currentDir, entry.name);
            const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, '/');
            if (entry.isDirectory()) {
                await walk(absolutePath);
            } else if (entry.isFile()) {
                files.push(relativePath);
            }
        }
    }
    await walk(rootDir);
    files.sort();
    return files;
}

async function calculateHash(dir: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const files = await listFilesRecursive(dir);

    for (const file of files) {
        if (file === 'signature.json') continue;
        const filePath = path.join(dir, file);
        const content = await fs.readFile(filePath);
        hash.update(file);
        hash.update(content);
    }
    return hash.digest('hex');
}

async function copyRecursive(sourceDir: string, destDir: string): Promise<void> {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetName = entry.name === 'polar.skill.json' ? 'manifest.json' : entry.name;
        const destPath = path.join(destDir, targetName);

        if (entry.isDirectory()) {
            await fs.mkdir(destPath, { recursive: true });
            await copyRecursive(sourcePath, destPath);
        } else if (entry.isFile()) {
            await fs.copyFile(sourcePath, destPath);
        }
    }
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

        // Skill package requires SKILL.md at root.
        const skillMdPath = path.join(sourceDir, 'SKILL.md');
        try {
            await fs.access(skillMdPath);
        } catch {
            console.error(JSON.stringify({ error: 'Invalid skill package', details: 'SKILL.md is required at skill root' }));
            process.exit(1);
        }

        await copyRecursive(sourceDir, destDir);

        const hash = await calculateHash(destDir);
        let signatureData = null;
        try {
            const sigPath = path.join(destDir, 'signature.json');
            const rawSig = await fs.readFile(sigPath, 'utf-8');
            signatureData = JSON.parse(rawSig);
            if (typeof signatureData?.hash === 'string' && signatureData.hash !== hash) {
                console.error(JSON.stringify({ error: 'Signature hash mismatch', details: 'signature.json hash does not match full-archive hash' }));
                process.exit(1);
            }
            if ((signatureData?.signature && !signatureData?.publicKey) || (!signatureData?.signature && signatureData?.publicKey)) {
                console.error(JSON.stringify({ error: 'Invalid signature metadata', details: 'signature.json must include both signature and publicKey together' }));
                process.exit(1);
            }
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
