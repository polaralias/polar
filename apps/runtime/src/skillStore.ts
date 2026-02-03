import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    Skill,
    SkillSchema,
    SkillContent,
    SkillManifest,
    SkillManifestSchema,
    PermissionDiff,
    calculatePermissionDiff,
    parseSkillMarkdown
} from '@polar/core';
import { runtimeConfig } from './config.js';
import { Mutex } from 'async-mutex';
import { appendAudit } from './audit.js';

const mutex = new Mutex();

const SKILLS_FILE = path.join(runtimeConfig.dataDir, 'skills.json');

/**
 * Calculate hash of skill directory contents for TOCTOU verification.
 */
export async function calculateSkillHash(skillPath: string): Promise<string> {
    const hash = crypto.createHash('sha256');

    try {
        const files = await fs.readdir(skillPath, { withFileTypes: true });
        const sortedFiles = files
            .filter(f => f.isFile())
            .map(f => f.name)
            .sort();

        for (const fileName of sortedFiles) {
            const filePath = path.join(skillPath, fileName);
            const content = await fs.readFile(filePath);
            hash.update(fileName);
            hash.update(content);
        }

        return hash.digest('hex');
    } catch {
        return '';
    }
}

/**
 * Verify skill integrity by comparing current hash against stored hash.
 */
export async function verifySkillIntegrity(skill: Skill): Promise<boolean> {
    if (!skill.path || !skill.provenance?.hash) {
        return true;
    }

    const currentHash = await calculateSkillHash(skill.path);
    if (!currentHash) {
        return false;
    }

    return currentHash === skill.provenance.hash;
}

export async function loadSkillContent(skillId: string): Promise<SkillContent | undefined> {
    const skill = await getSkill(skillId);
    if (!skill || !skill.path) return undefined;

    const skillMdPath = path.join(skill.path, 'SKILL.md');
    try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        return parseSkillMarkdown(content);
    } catch (err) {
        return {
            instructions: skill.manifest.description || 'No instructions provided.',
            metadata: { name: skill.manifest.name }
        };
    }
}

export async function loadSkills(): Promise<Skill[]> {
    try {
        const raw = await fs.readFile(SKILLS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];

        return data
            .map((item) => {
                const parsed = SkillSchema.safeParse(item);
                return parsed.success ? parsed.data : null;
            })
            .filter((s): s is Skill => s !== null);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

/**
 * Load skills with integrity and policy verification.
 */
export async function loadSkillsWithVerification(): Promise<Skill[]> {
    const skills = await loadSkills();
    const verifiedSkills: Skill[] = [];

    const { isSkillTrustLevelAllowed } = await import('./systemStore.js');

    for (const skill of skills) {
        if (skill.status !== 'enabled') {
            verifiedSkills.push(skill);
            continue;
        }

        if (skill.provenance) {
            const isAllowed = await isSkillTrustLevelAllowed(skill.provenance.trustLevel);
            if (!isAllowed) {
                console.warn(`Skill ${skill.manifest.id} policy restricted - disabling`);
                verifiedSkills.push({ ...skill, status: 'disabled' } as Skill);
                continue;
            }
        }

        const isValid = await verifySkillIntegrity(skill);
        if (!isValid) {
            console.warn(`Skill ${skill.manifest.id} tampered - disabling`);
            verifiedSkills.push({
                ...skill,
                status: 'disabled',
                provenance: skill.provenance ? {
                    hash: skill.provenance.hash,
                    trustLevel: 'untrusted',
                    verifiedAt: skill.provenance.verifiedAt,
                    signature: skill.provenance.signature,
                    publicKey: skill.provenance.publicKey,
                    integrityFailed: true,
                    integrityCheckedAt: new Date().toISOString(),
                } : undefined
            } as Skill);
        } else {
            verifiedSkills.push({
                ...skill,
                provenance: skill.provenance ? {
                    hash: skill.provenance.hash,
                    trustLevel: skill.provenance.trustLevel,
                    verifiedAt: skill.provenance.verifiedAt,
                    signature: skill.provenance.signature,
                    publicKey: skill.provenance.publicKey,
                    integrityFailed: skill.provenance.integrityFailed,
                    integrityCheckedAt: new Date().toISOString(),
                } : undefined
            } as Skill);
        }
    }

    return verifiedSkills;
}

export async function saveSkills(skills: Skill[]): Promise<void> {
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    const tempPath = `${SKILLS_FILE}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(skills, null, 2), 'utf-8');
    await fs.rename(tempPath, SKILLS_FILE);
}

/**
 * Backup helper for rollback support.
 */
async function backupSkill(skill: Skill): Promise<void> {
    if (!skill.path) return;
    const backupDir = path.join(runtimeConfig.dataDir, 'backups', skill.manifest.id, skill.manifest.version);
    await fs.mkdir(backupDir, { recursive: true });

    try {
        const files = await fs.readdir(skill.path);
        for (const file of files) {
            const src = path.join(skill.path, file);
            const dest = path.join(backupDir, file);
            if ((await fs.stat(src)).isFile()) {
                await fs.copyFile(src, dest);
            }
        }
        await fs.writeFile(
            path.join(backupDir, 'backup_metadata.json'),
            JSON.stringify({
                backedUpAt: new Date().toISOString(),
                status: skill.status,
                provenance: skill.provenance
            }, null, 2)
        );
    } catch (err) {
        console.warn(`Failed to backup skill ${skill.manifest.id}:`, err);
    }
}

export async function registerSkill(
    manifest: SkillManifest,
    skillPath: string,
    hash: string,
    signature?: any
): Promise<{ skill: Skill; diff?: PermissionDiff }> {
    return await mutex.runExclusive(async () => {
        const skills = await loadSkills();
        const existingIndex = skills.findIndex((s) => s.manifest.id === manifest.id);

        let trustLevel: 'trusted' | 'locally_trusted' | 'untrusted' = 'untrusted';
        if (signature?.signature && signature?.publicKey) {
            try {
                const verifier = crypto.createVerify('SHA256');
                verifier.update(hash);
                verifier.end();
                if (verifier.verify(signature.publicKey, signature.signature, 'hex')) {
                    trustLevel = 'trusted';
                }
            } catch (err) {
                console.warn(`Signature validation failed:`, err);
            }
        }

        const { isSkillTrustLevelAllowed } = await import('./systemStore.js');
        if (!(await isSkillTrustLevelAllowed(trustLevel))) {
            const { getSystemStatus } = await import('./systemStore.js');
            const status = await getSystemStatus();
            throw new Error(`Skill ${manifest.id} trust level ${trustLevel} not allowed by policy (${status.skillPolicyMode}).`);
        }

        const skill: Skill = {
            manifest,
            status: 'pending_consent',
            installedAt: new Date().toISOString(),
            path: skillPath,
            provenance: {
                hash,
                signature: signature?.signature,
                publicKey: signature?.publicKey,
                trustLevel,
                verifiedAt: new Date().toISOString(),
            },
        };

        let diff: PermissionDiff | undefined;
        if (existingIndex >= 0) {
            const existing = skills[existingIndex]!;
            await backupSkill(existing);
            diff = calculatePermissionDiff(existing.manifest, manifest);
            if (existing.manifest.version !== manifest.version && diff.added.length === 0) {
                skill.status = existing.status;
            }
            skills[existingIndex] = skill;
        } else {
            skills.push(skill);
        }

        await saveSkills(skills);
        return { skill, diff: diff as PermissionDiff };
    });
}

export async function rollbackSkill(skillId: string, targetVersion?: string): Promise<Skill> {
    return await mutex.runExclusive(async () => {
        const skills = await loadSkills();
        const skillIndex = skills.findIndex(s => s.manifest.id === skillId);
        if (skillIndex < 0) throw new Error('Skill not found');
        const skill = skills[skillIndex]!;
        const backupRoot = path.join(runtimeConfig.dataDir, 'backups', skillId);
        let versionToRestore = targetVersion;
        if (!versionToRestore) {
            const versions = await fs.readdir(backupRoot).catch(() => []);
            if (versions.length === 0) throw new Error('No backups available');
            versionToRestore = versions.sort().reverse()[0];
        }
        const backupDir = path.join(backupRoot, versionToRestore!);
        const metadata = JSON.parse(await fs.readFile(path.join(backupDir, 'backup_metadata.json'), 'utf-8'));
        const files = await fs.readdir(backupDir);
        for (const file of files) {
            if (file === 'backup_metadata.json') continue;
            await fs.copyFile(path.join(backupDir, file), path.join(skill.path, file));
        }
        const restoredManifest = SkillManifestSchema.parse(JSON.parse(await fs.readFile(path.join(skill.path, 'manifest.json'), 'utf-8')));
        const restoredSkill: Skill = {
            manifest: restoredManifest,
            status: metadata.status,
            installedAt: skill.installedAt,
            path: skill.path,
            provenance: metadata.provenance,
        };
        skills[skillIndex] = restoredSkill;
        await saveSkills(skills);
        await appendAudit({
            id: crypto.randomUUID(),
            time: new Date().toISOString(),
            subject: 'system',
            action: 'skill.rollback',
            decision: 'allow',
            resource: { type: 'system', component: 'skills' },
            metadata: { skillId, version: versionToRestore }
        });
        return restoredSkill;
    });
}

export async function getSkill(id: string): Promise<Skill | undefined> {
    const skills = await loadSkills();
    return skills.find(s => s.manifest.id === id);
}

export async function updateSkillStatus(id: string, status: Skill['status']): Promise<void> {
    await mutex.runExclusive(async () => {
        const skills = await loadSkills();
        const skill = skills.find(s => s.manifest.id === id);
        if (skill) {
            skill.status = status;
            await saveSkills(skills);
        }
    });
}

export async function uninstallSkill(id: string): Promise<void> {
    await mutex.runExclusive(async () => {
        let skills = await loadSkills();
        const skill = skills.find(s => s.manifest.id === id);
        if (!skill) return;
        if (skill.path) {
            await fs.rm(skill.path, { recursive: true, force: true }).catch(() => { });
        }
        skills = skills.filter(s => s.manifest.id !== id);
        await saveSkills(skills);
    });
}
