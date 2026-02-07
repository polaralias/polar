
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
import { subscribeToEvents } from './eventBus.js';
import { appendAudit } from './audit.js';
import { spawnAgent } from './agentService.js';
import { appendMessage } from './messageStore.js';
import { listSessions } from './sessions.js';

const envelopesPath = path.join(runtimeConfig.dataDir, 'automations.json');
let envelopes: Map<string, AutomationEnvelope> = new Map();
const tier0NotificationBatches = new Map<string, {
    envelope: AutomationEnvelope;
    events: IngestedEvent[];
    timer?: NodeJS.Timeout;
}>();
const tier0RateHistory = new Map<string, number[]>();
const TIER0_BATCH_WINDOW_MS = 45_000;
const TIER0_BATCH_MAX_EVENTS = 5;
const SETUP_PROPOSAL_TTL_MS = 10 * 60 * 1000;
const chatSetupProposals = new Map<string, {
    id: string;
    ownerId: string;
    sessionId: string;
    createdAt: string;
    expiresAt: string;
    draft: Omit<AutomationEnvelope, 'id' | 'createdAt'>;
    summary: string;
}>();

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
    await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
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

export function getLastPendingProposalForOwner(ownerId: string): PendingProposal | undefined {
    return getPendingProposals().find((proposal) => proposal.envelope.ownerId === ownerId);
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
    // Simple subset matching with basic operator support for textual automation filters.
    for (const key in filter) {
        const expected = filter[key];

        if (key.endsWith('_contains')) {
            const payloadKey = key.slice(0, -'_contains'.length);
            const actual = payload?.[payloadKey];
            if (typeof actual !== 'string' || typeof expected !== 'string') return false;
            if (!actual.toLowerCase().includes(expected.toLowerCase())) return false;
            continue;
        }

        if (payload?.[key] !== expected) return false;
    }
    return true;
}

function applyAutomationRateLimit(envelope: AutomationEnvelope): boolean {
    if (!envelope.rateLimit) return true;

    const now = Date.now();
    const key = envelope.id;
    const windowMs = envelope.rateLimit.windowSeconds * 1000;
    const maxRuns = envelope.rateLimit.maxRuns;
    const existing = tier0RateHistory.get(key) || [];
    const withinWindow = existing.filter((timestamp) => now - timestamp < windowMs);

    if (withinWindow.length >= maxRuns) {
        tier0RateHistory.set(key, withinWindow);
        return false;
    }

    withinWindow.push(now);
    tier0RateHistory.set(key, withinWindow);
    return true;
}

async function deliverTier0Notification(envelope: AutomationEnvelope, events: IngestedEvent[]): Promise<void> {
    if (events.length === 0) return;

    const eventCount = events.length;
    const lastEvent = events[eventCount - 1];
    if (!lastEvent) return;
    const summary = eventCount === 1
        ? `Automation "${envelope.name}" detected 1 event (${lastEvent.source}.${lastEvent.type}).`
        : `Automation "${envelope.name}" detected ${eventCount} events (${lastEvent.source}.${lastEvent.type} latest).`;
    const descriptionSuffix = envelope.description ? ` ${envelope.description}` : '';
    const notificationText = `${summary}${descriptionSuffix}`.trim();

    let deliveredCount = 0;
    try {
        const { broadcastUserMessage } = await import('./channelService.js');
        deliveredCount = await broadcastUserMessage(envelope.ownerId, notificationText);
    } catch (error) {
        console.error('Tier-0 broadcast delivery failed:', error);
    }

    const fallbackSession = listSessions('active')
        .filter((session) => session.subject === envelope.ownerId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (fallbackSession) {
        await appendMessage({
            sessionId: fallbackSession.id,
            role: 'assistant',
            content: `[Automation] ${notificationText}`,
        });
    }

    await appendAudit({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        subject: envelope.ownerId,
        action: 'automation.notify',
        decision: 'allow',
        resource: { type: 'system', component: 'automation' },
        ...(fallbackSession ? { sessionId: fallbackSession.id } : {}),
        requestId: crypto.randomUUID(),
        metadata: {
            envelopeId: envelope.id,
            tier: envelope.tier,
            eventCount,
            deliveredChannels: deliveredCount,
        },
    });
}

async function flushTier0Batch(batchKey: string): Promise<void> {
    const batch = tier0NotificationBatches.get(batchKey);
    if (!batch) return;
    if (batch.timer) {
        clearTimeout(batch.timer);
    }
    tier0NotificationBatches.delete(batchKey);
    await deliverTier0Notification(batch.envelope, batch.events);
}

function queueTier0Notification(envelope: AutomationEnvelope, event: IngestedEvent): void {
    const batchKey = `${envelope.ownerId}:${envelope.id}`;
    const existing = tier0NotificationBatches.get(batchKey);

    if (existing) {
        existing.events.push(event);
        if (existing.events.length >= TIER0_BATCH_MAX_EVENTS) {
            void flushTier0Batch(batchKey);
        }
        return;
    }

    const timer = setTimeout(() => {
        void flushTier0Batch(batchKey);
    }, TIER0_BATCH_WINDOW_MS);
    timer.unref();

    tier0NotificationBatches.set(batchKey, {
        envelope,
        events: [event],
        timer,
    });
}

function buildChatAutomationDraft(ownerId: string, message: string): {
    draft: Omit<AutomationEnvelope, 'id' | 'createdAt'>;
    summary: string;
} | null {
    const trimmed = message.trim();
    const notifyMatch = trimmed.match(/^notify me when\s+(.+)$/i);
    if (!notifyMatch) {
        return null;
    }

    const capturedRule = notifyMatch[1];
    if (!capturedRule) return null;
    const ruleText = capturedRule.trim();
    const lowerRule = ruleText.toLowerCase();
    let trigger: Trigger;

    if (lowerRule.includes('email') || lowerRule.includes('gmail')) {
        const fromMatch = ruleText.match(/\bfrom\s+([A-Za-z0-9_.@\- ]+)/i);
        const from = fromMatch?.[1]?.trim();
        trigger = {
            type: 'event',
            source: 'gmail',
            ...(from ? { filter: { from } } : {}),
        };
    } else if (lowerRule.includes('calendar')) {
        trigger = {
            type: 'event',
            source: 'calendar',
            filter: { text_contains: ruleText },
        };
    } else {
        trigger = {
            type: 'event',
            source: 'channel',
            filter: { text_contains: ruleText },
        };
    }

    const name = `Notify: ${ruleText.length > 48 ? `${ruleText.slice(0, 45)}...` : ruleText}`;
    const draft: Omit<AutomationEnvelope, 'id' | 'createdAt'> = {
        name,
        description: `Created from chat intent: "${ruleText}"`,
        ownerId,
        enabled: true,
        trigger,
        action: {
            skillId: 'system.notify',
            args: { query: ruleText, source: 'chat' },
        },
        tier: 'informational',
        rateLimit: { maxRuns: 10, windowSeconds: 3600 },
    };

    const summary = `I can create an automation: "${name}" on Tier 0 (informational) with trigger ${trigger.source}.${trigger.type}. Reply "confirm automation" to activate, or "cancel automation" to discard.`;
    return { draft, summary };
}

function isAffirmativeConfirmation(text: string): boolean {
    const value = text.toLowerCase().trim();
    return value === 'confirm automation'
        || value === 'confirm'
        || value === 'yes'
        || value === 'y'
        || value === 'go ahead'
        || value === 'do it';
}

function isNegativeConfirmation(text: string): boolean {
    const value = text.toLowerCase().trim();
    return value === 'cancel automation'
        || value === 'cancel'
        || value === 'reject automation'
        || value === 'no'
        || value === 'n';
}

function cleanupExpiredChatSetupProposals(): void {
    const now = Date.now();
    for (const [sessionId, proposal] of chatSetupProposals.entries()) {
        if (new Date(proposal.expiresAt).getTime() <= now) {
            chatSetupProposals.delete(sessionId);
        }
    }
}

export async function handleAutomationChatSetup(params: {
    ownerId: string;
    sessionId: string;
    message: string;
}): Promise<{
    handled: boolean;
    status?: 'proposal' | 'created' | 'cancelled';
    assistantMessage?: string;
    automation?: AutomationEnvelope;
}> {
    cleanupExpiredChatSetupProposals();

    const { ownerId, sessionId, message } = params;
    const pending = chatSetupProposals.get(sessionId);

    if (pending && isAffirmativeConfirmation(message)) {
        const automation = await createAutomation(pending.draft);
        chatSetupProposals.delete(sessionId);
        return {
            handled: true,
            status: 'created',
            automation,
            assistantMessage: `Automation activated: "${automation.name}" (${automation.id}).`,
        };
    }

    if (pending && isNegativeConfirmation(message)) {
        chatSetupProposals.delete(sessionId);
        return {
            handled: true,
            status: 'cancelled',
            assistantMessage: `Automation setup cancelled.`,
        };
    }

    const draft = buildChatAutomationDraft(ownerId, message);
    if (!draft) {
        return { handled: false };
    }

    const now = new Date();
    chatSetupProposals.set(sessionId, {
        id: crypto.randomUUID(),
        ownerId,
        sessionId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SETUP_PROPOSAL_TTL_MS).toISOString(),
        draft: draft.draft,
        summary: draft.summary,
    });

    return {
        handled: true,
        status: 'proposal',
        assistantMessage: draft.summary,
    };
}

async function executeAction(envelope: AutomationEnvelope, event: IngestedEvent, force: boolean = false) {
    const { action, tier, ownerId } = envelope;

    console.log(`Executing Automation [${envelope.name}] (Tier ${tier}) triggered by ${event.id}`);

    if (!applyAutomationRateLimit(envelope)) {
        console.log(`Automation rate limit reached for ${envelope.id}; event ${event.id} skipped.`);
        return;
    }

    // Tier 0: Informational (Notification only)
    if (tier === 'informational') {
        queueTier0Notification(envelope, event);
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

