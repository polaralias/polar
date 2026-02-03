
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { runtimeConfig } from './config.js';
import {
    AutomationEnvelope,
    AutomationEnvelopeSchema,
    IngestedEvent,
    Trigger
} from '@polar/core';
import { ingestEvent, subscribeToEvents } from './eventBus.js';
import { appendAudit } from './audit.js';
import { spawnAgent } from './agentService.js';
import { startWorker } from './workerRuntime.js';

const envelopesPath = path.join(runtimeConfig.dataDir, 'automations.json');
let envelopes: Map<string, AutomationEnvelope> = new Map();

// Load envelopes from disk
export async function loadAutomations() {
    try {
        const raw = await fs.readFile(envelopesPath, 'utf-8');
        const data = JSON.parse(raw);
        envelopes.clear();
        data.forEach((e: any) => {
            const parsed = AutomationEnvelopeSchema.safeParse(e);
            if (parsed.success) {
                envelopes.set(parsed.data.id, parsed.data);
            } else {
                console.error(`Failed to parse envelope ${e.id}:`, parsed.error);
            }
        });
        console.log(`Loaded ${envelopes.size} automation envelopes.`);
    } catch {
        console.log('No existing automations found, starting fresh.');
        envelopes.clear();
    }
}

export async function saveAutomations() {
    const list = Array.from(envelopes.values());
    await fs.writeFile(envelopesPath, JSON.stringify(list, null, 2), 'utf-8');
}

export async function createAutomation(def: Omit<AutomationEnvelope, 'id' | 'createdAt'>): Promise<AutomationEnvelope> {
    const envelope: AutomationEnvelope = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...def
    };
    envelopes.set(envelope.id, envelope);
    await saveAutomations();
    return envelope;
}

export async function deleteAutomation(id: string) {
    if (envelopes.delete(id)) {
        await saveAutomations();
        return true;
    }
    return false;
}

export function listAutomations() {
    return Array.from(envelopes.values());
}

// === Evaluation Logic ===

function matchesFilter(payload: any, filter: any): boolean {
    if (!filter) return true;
    // Simple subset matching
    for (const key in filter) {
        if (payload[key] !== filter[key]) return false;
    }
    return true;
}

async function executeAction(envelope: AutomationEnvelope, event: IngestedEvent) {
    const { action, tier, ownerId } = envelope;

    console.log(`Executing Automation [${envelope.name}] (Tier ${tier}) triggered by ${event.id}`);

    // Tier 0: Informational (Notification only)
    // NOTE: In MVP, we just log. In real system, this sends a push notification.
    if (tier === 'informational') {
        console.log(`[NOTIFY USER]: Event ${event.type} occurred - ${envelope.description}`);
        return;
    }

    // Tier 2: Delegated (Requires Approval)
    // For MVP, we'll auto-approve since we don't have the "Proposal Stream" UI yet.
    // TODO: Implement proposal logic.
    if (tier === 'delegated') {
        console.log(`[PROPOSAL CREATED]: Waiting for user approval to run ${action.skillId}`);
        // We'll skip execution for now to mock the "Pending" state
        return;
    }

    // Tier 1 & 3: Execution
    try {
        // Spawn a Worker to handle the action
        const agent = await spawnAgent({
            role: 'worker',
            userId: ownerId,
            sessionId: 'automation-session', // Automations run in a dedicated context or we need to find active session
            skillId: action.skillId,
            templateId: action.templateId,
            metadata: {
                automationId: envelope.id,
                triggerEventId: event.id,
                ...action.args
            }
        });

        await startWorker(agent);

        await appendAudit({
            id: crypto.randomUUID(),
            time: new Date().toISOString(),
            subject: 'system.automation',
            action: 'automation.execute',
            decision: 'allow',
            resource: { type: 'system', component: 'automation' },
            agentId: agent.id,
            metadata: {
                envelopeId: envelope.id,
                eventId: event.id
            }
        });

    } catch (err) {
        console.error(`Automation execution failed:`, err);
    }
}

export async function startAutomationService() {
    await loadAutomations();

    // Subscribe to Event Bus
    subscribeToEvents((event) => {
        for (const envelope of envelopes.values()) {
            if (!envelope.enabled) continue;

            const { trigger } = envelope;

            // Check Trigger Type
            if (trigger.type === 'event' || trigger.type === 'webhook') {
                // Match Source & Type (We map 'source' in trigger to 'source' in event, but trigger might be generic)
                // For now, assume trigger.source matches event.source
                if (trigger.source === event.source) {
                    if (matchesFilter(event.payload, trigger.filter)) {
                        executeAction(envelope, event);
                    }
                }
            }
        }
    });

    console.log('Automation Service started.');
}
