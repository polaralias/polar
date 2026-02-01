import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SystemStatus, SystemStatusSchema } from '@polar/core';
import { runtimeConfig } from './config.js';
import { Mutex } from 'async-mutex';

const mutex = new Mutex();
import { appendAudit } from './audit.js';

const STATUS_FILE = path.join(runtimeConfig.dataDir, 'system_status.json');

const DEFAULT_STATUS: SystemStatus = {
    mode: 'normal',
    lastModeChange: new Date().toISOString(),
};

export async function getSystemStatus(): Promise<SystemStatus> {
    try {
        const raw = await fs.readFile(STATUS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        const parsed = SystemStatusSchema.safeParse(data);
        return parsed.success ? parsed.data : DEFAULT_STATUS;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return DEFAULT_STATUS;
        }
        return DEFAULT_STATUS;
    }
}

export async function saveSystemStatus(status: SystemStatus): Promise<void> {
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
    const tempPath = `${STATUS_FILE}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(status, null, 2), 'utf-8');
    await fs.rename(tempPath, STATUS_FILE);
}

export async function setEmergencyMode(enabled: boolean, reason?: string): Promise<SystemStatus> {
    return await mutex.runExclusive(async () => {
        const current = await getSystemStatus();
        if ((enabled && current.mode === 'emergency') || (!enabled && current.mode === 'normal')) {
            return current;
        }

        const newStatus: SystemStatus = {
            mode: enabled ? 'emergency' : 'normal',
            lastModeChange: new Date().toISOString(),
            reason: enabled ? reason : undefined,
        };

        await saveSystemStatus(newStatus);

        await appendAudit({
            id: crypto.randomUUID(),
            time: new Date().toISOString(),
            action: 'system.update_mode',
            subject: 'user', // In a real system, this would be the authenticated user ID
            resource: { type: 'system', component: 'status' },
            decision: 'allow',
            reason: reason || `Switched to ${newStatus.mode} mode`,
            metadata: {
                previousMode: current.mode,
                newMode: newStatus.mode,
            },
        });

        return newStatus;
    });
}
