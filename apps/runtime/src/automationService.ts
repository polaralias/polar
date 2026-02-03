
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


// === Proposal Management ===

export interface PendingProposal {
    id: string;
    envelope: AutomationEnvelope;
    event: IngestedEvent;
    createdAt: string;
}

const pendingProposals = new Map<string, PendingProposal>();

export function getPendingProposals(): PendingProposal[] {
    return Array.from(pendingProposals.values()).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

export function getLastPendingProposal(): PendingProposal | undefined {
    return getPendingProposals()[0];
}

export async function confirmProposal(proposalId: string): Promise<boolean> {
    const proposal = pendingProposals.get(proposalId);
    if (!proposal) return false;

    console.log(`[PROPOSAL CONFIRMED]: Executing ${proposal.envelope.name}`);
    await executeAction(proposal.envelope, proposal.event, true); // force=true
    pendingProposals.delete(proposalId);
    return true;
}

export function rejectProposal(proposalId: string): boolean {
    const deleted = pendingProposals.delete(proposalId);
    if (deleted) {
        console.log(`[PROPOSAL REJECTED]: Dropped proposal ${proposalId}`);
    }
    return deleted;
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

async function executeAction(envelope: AutomationEnvelope, event: IngestedEvent, force: boolean = false) {
    const { action, tier, ownerId } = envelope;

    console.log(`Executing Automation [${envelope.name}] (Tier ${tier}) triggered by ${event.id}`);

    // Tier 0: Informational (Notification only)
    if (tier === 'informational') {
        console.log(`[NOTIFY USER]: Event ${event.type} occurred - ${envelope.description}`);
        const { sendChannelMessage } = await import('./channelService.js');
        // Broadcast to all active channels for the owner (simplified for Phase 2)
        // In reality, we'd look up the user's preferred channel
        const { loadChannels } = await import('./channelStore.js');
        const channels = await loadChannels();
        for (const ch of channels) {
            if (ch.enabled && ch.allowlist.includes(ownerId)) {
                // Send to the first conversation found for this user? 
                // Phase 2 stub: just log, or we need conversationId mapping.
                // We will skip actual sending if updated channelService doesn't support user-mapping yet.
            }
        }
        return;
    }

    // Tier 2: Delegated (Requires Approval)
    if (tier === 'delegated' && !force) {
        const proposal: PendingProposal = {
            id: crypto.randomUUID(),
            envelope,
            event,
            createdAt: new Date().toISOString()
        };
        pendingProposals.set(proposal.id, proposal);

        console.log(`[PROPOSAL CREATED]: Waiting for user approval to run ${action.skillId}. Proposal ID: ${proposal.id}`);

        // Notify user of the proposal via ChannelService
        // (Circular dependency warning: we import dynamically)
        try {
            const { broadcastProposal } = await import('./channelService.js');
            await broadcastProposal(ownerId, `Please confirm execution of: ${envelope.name}\nSay "Yes" to confirm.`);
        } catch (e) {
            console.error('Failed to broadcast proposal:', e);
        }
        return;
    }

    // Tier 1 & 3: Execution (or Tier 2 confirmed)
    try {
        const requestId = crypto.randomUUID();
        // Spawn a Worker to handle the action
        const agent = await spawnAgent({
            role: 'worker',
            userId: ownerId,
            sessionId: 'automation-session',
            skillId: action.skillId,
            templateId: action.templateId,
            metadata: {
                automationId: envelope.id,
                triggerEventId: event.id,
                requestId,
                ...action.args
            }
        });

        await appendAudit({
            id: crypto.randomUUID(),
            time: new Date().toISOString(),
            subject: 'system.automation',
            action: 'automation.execute',
            decision: 'allow',
            resource: { type: 'system', component: 'automation' },
            agentId: agent.id,
            requestId,
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

