import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { Skill, SkillSchema, SkillManifest, calculatePermissionDiff, PermissionDiff } from '@polar/core';
import { runtimeConfig } from './config.js';
import { Mutex } from 'async-mutex';

const mutex = new Mutex();

const SKILLS_FILE = path.join(runtimeConfig.dataDir, 'skills.json');

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

export async function saveSkills(skills: Skill[]): Promise<void> {
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    const tempPath = `${SKILLS_FILE}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(skills, null, 2), 'utf-8');
    await fs.rename(tempPath, SKILLS_FILE);
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

        // Basic signature verification logic
        let trustLevel: 'trusted' | 'locally_trusted' | 'untrusted' = 'untrusted';
        if (signature?.signature && signature?.publicKey) {
            try {
                // Assuming signature.publicKey is an Ed25519 key or similar supported by crypto.verify
                // If the key is a raw public key, it might need PEM formatting or specific key object.
                // For simplicity, we assume standard Node crypto compatibility.
                const verifier = crypto.createVerify('SHA256');
                verifier.update(hash);
                verifier.end();

                const isValid = verifier.verify(signature.publicKey, signature.signature, 'hex');
                if (isValid) {
                    trustLevel = 'trusted';
                }
            } catch (err) {
                console.warn(`Skill ${manifest.id}: Signature validation failed:`, err);
            }
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

            // Compute diff
            diff = calculatePermissionDiff(existing.manifest, manifest);

            if (existing.manifest.version !== manifest.version) {
                // Check if permissions increased
                if (diff.added.length > 0) {
                    skill.status = 'pending_consent';
                } else {
                    // No new permissions, preserve status (e.g. allow auto-update)
                    // Assuming 'enabled' persists. If it was disabled, it stays disabled.
                    skill.status = existing.status;
                }
            } else {
                skill.status = existing.status;
            }
            skills[existingIndex] = skill;
        } else {
            skills.push(skill);
        }

        await saveSkills(skills);
        if (diff) {
            return { skill, diff };
        }
        return { skill };
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
