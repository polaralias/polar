import crypto from 'crypto';
import {
    createStrictObjectSchema,
    enumField,
    jsonField,
    stringArrayField,
    stringField,
    RuntimeExecutionError
} from '@polar/domain';
import {
    createDurableLineageStore,
    isRuntimeDevMode
} from './durable-lineage-store.mjs';
import { validateForwardSkills, validateModelOverride, computeCapabilityScope } from './capability-scope.mjs';
import { classifyUserMessage, applyUserTurn, selectReplyAnchor, detectOfferInText, setOpenOffer, computeRepairDecision, handleRepairSelection } from './routing-policy-engine.mjs';
import { evaluateCapabilityApprovalRequirement } from './extension-gateway.mjs';
import { parseModelProposal, expandTemplate, validateSteps } from './workflow-engine.mjs';

const repairPhrasingSchema = createStrictObjectSchema({
    schemaId: 'orchestrator.repair.phrasing',
    fields: {
        question: stringField({ minLength: 1 }),
        labelA: stringField({ minLength: 1 }),
        labelB: stringField({ minLength: 1 }),
        correlationId: stringField({ minLength: 1, required: false }),
        options: jsonField({ required: false })
    }
});

const threadStateSuggestionSchema = createStrictObjectSchema({
    schemaId: 'orchestrator.thread.state.suggestion',
    fields: {
        status: enumField(['done', 'waiting_for_user'], { required: false }),
        pending_question: stringField({ minLength: 1, required: false }),
        pendingQuestion: stringField({ minLength: 1, required: false }),
        slot_key: stringField({ minLength: 1, required: false }),
        slotKey: stringField({ minLength: 1, required: false }),
        expected_type: stringField({ minLength: 1, required: false }),
        expectedType: stringField({ minLength: 1, required: false }),
        slots: jsonField({ required: false })
    }
});

const delegationStateSchema = createStrictObjectSchema({
    schemaId: 'orchestrator.delegation.state',
    fields: {
        agentId: stringField({ minLength: 1 }),
        task_instructions: stringField({ minLength: 1 }),
        forward_skills: stringArrayField({ minItems: 0, required: false }),
        model_override: stringField({ minLength: 1, required: false }),
        pinnedProvider: stringField({ minLength: 1, required: false })
    }
});

/**
 * @param {string} rawText
 * @returns {string}
 */
function normalizeJsonText(rawText) {
    return rawText.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
}

/**
 * @param {string} text
 * @returns {{ hour: number, minute: number } | null}
 */
function parseTimeOfDay(text) {
    if (typeof text !== "string" || text.trim().length === 0) {
        return null;
    }
    const match = text.trim().toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!match) {
        return null;
    }
    let hour = Number.parseInt(match[1], 10);
    const minute = match[2] !== undefined ? Number.parseInt(match[2], 10) : 0;
    const meridiem = match[3];
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        return null;
    }
    if (meridiem === "am" || meridiem === "pm") {
        if (hour < 1 || hour > 12) {
            return null;
        }
        if (hour === 12) {
            hour = 0;
        }
        if (meridiem === "pm") {
            hour += 12;
        }
    } else if (hour < 0 || hour > 23) {
        return null;
    }
    return { hour, minute };
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function inferAutomationSchedule(text) {
    if (typeof text !== "string") {
        return null;
    }
    const normalized = text.trim().toLowerCase();

    const everyMatch = normalized.match(/\bevery\s+(\d+)\s*(minute|minutes|min|m|hour|hours|h|day|days|d)\b/);
    if (everyMatch) {
        const interval = Number.parseInt(everyMatch[1], 10);
        if (!Number.isInteger(interval) || interval < 1) {
            return null;
        }
        const unit = everyMatch[2];
        if (unit === "minute" || unit === "minutes" || unit === "min" || unit === "m") {
            return `every ${interval} minutes`;
        }
        if (unit === "hour" || unit === "hours" || unit === "h") {
            return `every ${interval} hours`;
        }
        return `every ${interval} days`;
    }

    const dailyMatch = normalized.match(/\b(?:daily|every day)\b(?:\s+at\s+([^\n,.;!?]+))?/);
    if (!dailyMatch) {
        return null;
    }
    const parsedTime = dailyMatch[1] ? parseTimeOfDay(dailyMatch[1]) : { hour: 9, minute: 0 };
    if (!parsedTime) {
        return null;
    }
    const hh = String(parsedTime.hour).padStart(2, "0");
    const mm = String(parsedTime.minute).padStart(2, "0");
    return `daily at ${hh}:${mm}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function inferAutomationPromptTemplate(text) {
    if (typeof text !== "string" || text.trim().length === 0) {
        return "Reminder: check in.";
    }
    const toMatch = text.match(/\b(?:to|about)\s+(.+)$/i);
    let body = toMatch ? toMatch[1].trim() : text.trim();
    body = body.replace(/\s+/g, " ").replace(/[.?!]+$/, "").trim();
    if (body.length === 0) {
        return "Reminder: check in.";
    }
    return `Reminder: ${body}`;
}

/**
 * @param {string} text
 * @returns {null|{ schedule: string, promptTemplate: string, limits: Record<string, unknown>, quietHours: Record<string, unknown> }}
 */
function detectAutomationProposal(text) {
    if (typeof text !== "string") {
        return null;
    }
    const normalized = text.toLowerCase();
    if (!/\b(remind|notify|ping)\s+me\b/.test(normalized)) {
        return null;
    }
    const schedule = inferAutomationSchedule(text);
    if (!schedule) {
        return null;
    }
    return {
        schedule,
        promptTemplate: inferAutomationPromptTemplate(text),
        limits: {
            maxNotificationsPerDay: 3,
        },
        quietHours: {
            startHour: 22,
            endHour: 7,
            timezone: "UTC",
        },
    };
}

/**
 * @param {string} text
 * @returns {null|{ schedule: string, promptTemplate: string, limits: Record<string, unknown>, quietHours: Record<string, unknown>, templateType: "inbox_check" }}
 */
function detectInboxAutomationProposal(text) {
    if (typeof text !== "string") {
        return null;
    }
    const normalized = text.toLowerCase();
    const asksInboxCheck =
        /\b(check|monitor|scan)\b/.test(normalized) &&
        /\b(inbox|email|emails)\b/.test(normalized);
    const asksNotify =
        /\b(notify|alert|ping|remind)\b/.test(normalized) &&
        /\b(inbox|email|emails)\b/.test(normalized);
    if (!asksInboxCheck && !asksNotify) {
        return null;
    }
    const schedule = inferAutomationSchedule(text) ?? "every 1 hours";
    return {
        templateType: "inbox_check",
        schedule,
        promptTemplate: "Proactive inbox check (headers-only). Notify only if important new headers are detected.",
        limits: {
            maxNotificationsPerDay: 3,
            inbox: {
                mode: "headers_only",
                lookbackHours: 24,
                capabilities: ["mail.search_headers"]
            }
        },
        quietHours: {
            startHour: 22,
            endHour: 7,
            timezone: "UTC",
        },
    };
}

/**
 * @param {string} rawText
 * @param {{ validate: (value: unknown) => { ok: boolean, value?: unknown, errors?: string[] }, schemaId: string }} schema
 * @returns {Record<string, unknown>}
 */
function parseJsonWithSchema(rawText, schema) {
    const parsed = JSON.parse(normalizeJsonText(rawText));
    const validation = schema.validate(parsed);
    if (!validation.ok) {
        throw new RuntimeExecutionError(`Invalid ${schema.schemaId}: ${(validation.errors || []).join('; ')}`);
    }
    return /** @type {Record<string, unknown>} */ (validation.value);
}

/**
 * Convert unknown metadata to a strict JSON-compatible value.
 * Undefined/function/symbol/bigint values are dropped.
 * @param {unknown} value
 * @returns {unknown}
 */
function toJsonSafeValue(value) {
    if (value === null) {
        return null;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        const items = [];
        for (const item of value) {
            const normalized = toJsonSafeValue(item);
            if (normalized !== undefined) {
                items.push(normalized);
            }
        }
        return items;
    }
    if (typeof value === "object" && value !== null) {
        const normalizedObject = {};
        for (const [key, entryValue] of Object.entries(value)) {
            const normalized = toJsonSafeValue(entryValue);
            if (normalized !== undefined) {
                normalizedObject[key] = normalized;
            }
        }
        return normalizedObject;
    }
    return undefined;
}

const AGENT_REGISTRY_RESOURCE_TYPE = "policy";
const AGENT_REGISTRY_RESOURCE_ID = "agent-registry:default";
const AGENT_ID_PATTERN = /^@[a-z0-9_-]{2,32}$/;

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const item of value) {
        if (typeof item !== "string") {
            continue;
        }
        const trimmed = item.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        normalized.push(trimmed);
    }
    return normalized;
}

/**
 * @param {unknown} value
 * @returns {{ version: 1, agents: readonly Record<string, unknown>[] }}
 */
function normalizeAgentRegistry(value) {
    if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) {
        return { version: 1, agents: Object.freeze([]) };
    }
    const seen = new Set();
    const agents = [];
    for (const item of Array.isArray(value.agents) ? value.agents : []) {
        if (typeof item !== "object" || item === null || Object.getPrototypeOf(item) !== Object.prototype) {
            continue;
        }
        const agentId = typeof item.agentId === "string" ? item.agentId.trim() : "";
        const profileId = typeof item.profileId === "string" ? item.profileId.trim() : "";
        const description = typeof item.description === "string" ? item.description.trim() : "";
        if (!agentId || !profileId || !description || description.length > 300 || seen.has(agentId)) {
            continue;
        }
        if (!AGENT_ID_PATTERN.test(agentId)) {
            continue;
        }
        const normalized = {
            agentId,
            profileId,
            description,
        };
        const tags = normalizeStringArray(item.tags);
        const defaultForwardSkills = normalizeStringArray(item.defaultForwardSkills);
        const allowedForwardSkills = normalizeStringArray(item.allowedForwardSkills);
        const defaultMcpServers = normalizeStringArray(item.defaultMcpServers);
        const allowedMcpServers = normalizeStringArray(item.allowedMcpServers);
        if (tags.length > 0) normalized.tags = tags;
        if (defaultForwardSkills.length > 0) normalized.defaultForwardSkills = defaultForwardSkills;
        if (allowedForwardSkills.length > 0) normalized.allowedForwardSkills = allowedForwardSkills;
        if (defaultMcpServers.length > 0) normalized.defaultMcpServers = defaultMcpServers;
        if (allowedMcpServers.length > 0) normalized.allowedMcpServers = allowedMcpServers;
        agents.push(normalized);
        seen.add(agentId);
    }
    return {
        version: 1,
        agents: Object.freeze(agents),
    };
}

/**
 * @param {string} systemPrompt
 * @param {Record<string, unknown>|null|undefined} personalityProfile
 */
function appendPersonalityBlock(systemPrompt, personalityProfile) {
    if (
        !personalityProfile ||
        typeof personalityProfile !== "object" ||
        typeof personalityProfile.prompt !== "string" ||
        personalityProfile.prompt.length === 0
    ) {
        return systemPrompt;
    }
    return `${systemPrompt}\n\n## Personality\nFollow the style guidance below unless it conflicts with system/developer instructions.\n${personalityProfile.prompt}`;
}

const LANE_RECENT_MESSAGE_LIMIT = 15;
const LANE_COMPACTION_MESSAGE_THRESHOLD = 30;
const LANE_COMPACTION_TOKEN_THRESHOLD = 2500;
const LANE_UNSUMMARIZED_TAIL_COUNT = 10;
const MEMORY_RETRIEVAL_LIMIT = 8;

function estimateMessageTokens(messages) {
    return messages.reduce((total, message) => {
        const text = typeof message?.text === "string" ? message.text : "";
        return total + Math.ceil(text.length / 4);
    }, 0);
}

function redactSecrets(text) {
    if (typeof text !== "string" || text.length === 0) {
        return "";
    }
    return text
        .replace(/(password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
        .replace(/bearer\s+[a-z0-9._\-]+/gi, "bearer [REDACTED]")
        .replace(/[A-Za-z0-9+/]{32,}={0,2}/g, "[REDACTED_CREDENTIAL]");
}

function deriveLaneThreadKey(sessionId, inboundThreadKey, inboundThreadId) {
    if (typeof inboundThreadKey === "string" && inboundThreadKey.length > 0) {
        return inboundThreadKey;
    }
    if (typeof inboundThreadId === "string" && inboundThreadId.length > 0) {
        if (inboundThreadId.startsWith("telegram:topic:")) {
            const [, , topicId, chatId] = inboundThreadId.split(":");
            if (topicId && chatId) {
                return `topic:${chatId}:${topicId}`;
            }
        }
        if (inboundThreadId.startsWith("telegram:reply:")) {
            const [, , chatId, replyToId] = inboundThreadId.split(":");
            if (chatId && replyToId) {
                return `reply:${chatId}:${replyToId}`;
            }
        }
    }
    const sessionChatMatch = /^telegram:chat:(.+)$/.exec(sessionId);
    if (sessionChatMatch) {
        return `root:${sessionChatMatch[1]}`;
    }
    return "root:unknown";
}

function isMessageInLane(message, laneThreadKey) {
    const messageMetadata = message?.metadata;
    const messageThreadKey = typeof messageMetadata?.threadKey === "string" ? messageMetadata.threadKey : null;
    if (messageThreadKey) {
        return messageThreadKey === laneThreadKey;
    }
    return laneThreadKey === "root:unknown";
}

function buildThreadSummaryRecord(laneMessages) {
    const olderMessages = laneMessages.slice(0, Math.max(0, laneMessages.length - LANE_UNSUMMARIZED_TAIL_COUNT));
    const latestMessages = laneMessages.slice(-LANE_UNSUMMARIZED_TAIL_COUNT);
    const userPoints = olderMessages
        .filter((item) => item.role === "user")
        .slice(-6)
        .map((item) => `- ${redactSecrets(item.text).slice(0, 220)}`);
    const assistantPoints = olderMessages
        .filter((item) => item.role === "assistant")
        .slice(-6)
        .map((item) => `- ${redactSecrets(item.text).slice(0, 220)}`);

    const summary = [
        "Current goals / open questions:",
        ...(userPoints.length > 0 ? userPoints : ["- (none captured)"]),
        "Decisions made:",
        ...(assistantPoints.length > 0 ? assistantPoints : ["- (none captured)"]),
        "Important facts:",
        "- Preserve lane-scoped context and unresolved asks.",
        "Pending actions:",
        "- Continue from unsummarized tail if user follows up.",
    ].join("\n");

    return {
        summary,
        unsummarizedTail: latestMessages,
        summarizedCount: olderMessages.length,
    };
}

function buildReplyContextBlock(messages, replyToMessageId) {
    if (!replyToMessageId) {
        return null;
    }
    const targetIndex = messages.findIndex((item) => item.messageId === replyToMessageId || item.metadata?.channelMessageId === replyToMessageId);
    if (targetIndex < 0) {
        return null;
    }
    const window = messages.slice(Math.max(0, targetIndex - 1), targetIndex + 2);
    const rendered = window
        .map((item) => `[${item.role}] ${redactSecrets(String(item.text ?? ""))}`)
        .join("\n");
    return `[QUOTED_REPLY_CONTEXT]\n${rendered}\n[/QUOTED_REPLY_CONTEXT]`;
}

/**
 * @typedef {Object} PolarEnvelope
 * @property {string} sessionId
 * @property {string} userId
 * @property {string} text
 * @property {string} [messageId]
 * @property {Object} [metadata]
 */

/**
 * Orchestrator core logic - transport agnostic.
 */
export function createOrchestrator({
    profileResolutionGateway,
    chatManagementGateway,
    providerGateway,
    extensionGateway,
    approvalStore,
    skillRegistry,
    gateway, // ControlPlaneGateway for config
    memoryGateway,
    personalityStore,
    now = Date.now,
    lineageStore,
}) {
    const PENDING_WORKFLOWS = new Map();
    const WORKFLOW_TTL_MS = 30 * 60 * 1000;
    const WORKFLOW_MAX_SIZE = 100;
    const PENDING_AUTOMATION_PROPOSALS = new Map();
    const AUTOMATION_PROPOSAL_TTL_MS = 30 * 60 * 1000;

    const SESSION_THREADS = new Map();
    const THREAD_TTL_MS = 60 * 60 * 1000;
    const PENDING_REPAIRS = new Map();
    const REPAIR_TTL_MS = 5 * 60 * 1000;
    const cleanupInterval = setInterval(() => {
        const currentTime = now();
        for (const [id, entry] of PENDING_WORKFLOWS) {
            if (currentTime - entry.createdAt > WORKFLOW_TTL_MS) {
                PENDING_WORKFLOWS.delete(id);
            }
        }
        for (const [id, entry] of PENDING_AUTOMATION_PROPOSALS) {
            if (currentTime - entry.createdAt > AUTOMATION_PROPOSAL_TTL_MS) {
                PENDING_AUTOMATION_PROPOSALS.delete(id);
            }
        }
        for (const [id, entry] of SESSION_THREADS) {
            const lastActivity = entry.threads.reduce((max, t) => Math.max(max, t.lastActivityTs || 0), 0);
            if (currentTime - lastActivity > THREAD_TTL_MS && entry.threads.length > 0) {
                SESSION_THREADS.delete(id);
            }
        }
        for (const [id, entry] of PENDING_REPAIRS) {
            if (currentTime - entry.createdAt > REPAIR_TTL_MS) {
                PENDING_REPAIRS.delete(id);
            }
        }
    }, 5 * 60 * 1000);
    if (typeof cleanupInterval.unref === 'function') {
        cleanupInterval.unref();
    }

    let resolvedLineageStore = lineageStore;
    if (
        resolvedLineageStore !== undefined &&
        (
            typeof resolvedLineageStore !== "object" ||
            resolvedLineageStore === null ||
            typeof resolvedLineageStore.append !== "function"
        )
    ) {
        throw new RuntimeExecutionError("lineageStore must expose append(event) when provided");
    }

    if (resolvedLineageStore === undefined && !isRuntimeDevMode()) {
        resolvedLineageStore = createDurableLineageStore({ now });
    }

    /**
     * @param {Record<string, unknown>} event
     * @returns {Promise<void>}
     */
    async function emitLineageEvent(event) {
        if (!resolvedLineageStore) {
            return;
        }

        await resolvedLineageStore.append(event);
    }

    /**
     * Compute risk summary for a list of workflow steps.
     */
    function evaluateWorkflowRisk(steps) {
        let maxRisk = 'read';
        let maxEffects = 'none';
        let maxEgress = 'none';
        let hasDelegation = false;
        const requirements = [];

        for (const step of steps) {
            if (step.capabilityId === 'delegate_to_agent') {
                hasDelegation = true;
                requirements.push({ capabilityId: 'delegate_to_agent', extensionId: 'system', riskLevel: 'write', sideEffects: 'internal' });
                continue;
            }
            if (step.capabilityId === 'complete_task') continue;

            const state = extensionGateway.getState(step.extensionId);
            const cap = (state?.capabilities || []).find(c => c.capabilityId === step.capabilityId);

            if (cap) {
                // Risk Level: read < write < destructive
                if (cap.riskLevel === 'destructive') maxRisk = 'destructive';
                else if (cap.riskLevel === 'write' && maxRisk === 'read') maxRisk = 'write';

                // Side Effects: none < internal < external
                if (cap.sideEffects === 'external') maxEffects = 'external';
                else if (cap.sideEffects === 'internal' && maxEffects === 'none') maxEffects = 'internal';

                // Data Egress: none < network
                if (cap.dataEgress === 'network') maxEgress = 'network';

                const approvalRequirement = evaluateCapabilityApprovalRequirement({
                    riskLevel: cap.riskLevel || 'unknown',
                    sideEffects: cap.sideEffects || 'unknown',
                    dataEgress: cap.dataEgress || 'unknown'
                });

                if (approvalRequirement.required) {
                    requirements.push({
                        extensionId: step.extensionId,
                        capabilityId: step.capabilityId,
                        riskLevel:
                            approvalRequirement.minimumRiskLevel === 'destructive'
                                ? 'destructive'
                                : (cap.riskLevel || 'write'),
                        sideEffects: cap.sideEffects,
                        dataEgress: cap.dataEgress
                    });
                }
            } else {
                // If metadata missing, assume write/internal for safety
                if (maxRisk === 'read') maxRisk = 'write';
                if (maxEffects === 'none') maxEffects = 'internal';
            }
        }

        return {
            riskLevel: maxRisk,
            sideEffects: maxEffects,
            dataEgress: maxEgress,
            hasDelegation,
            requirements
        };
    }

    /**
     * Check if requirements are already covered by valid grants.
     */
    function checkGrants(requirements, principal) {
        return requirements.filter(req => {
            // Destructive actions require per-action approval by default.
            // Existing grants should not auto-authorize them.
            if (req.riskLevel === 'destructive') {
                return true;
            }
            const match = approvalStore.findMatchingGrant(principal, {
                extensionId: req.extensionId,
                capabilityId: req.capabilityId,
                userId: principal.userId,
                sessionId: principal.sessionId
            });
            return !match;
        });
    }

    /**
     * Skill registry authority states are the canonical source for capability projection.
     * Extension-gateway state snapshots remain supplemental adapter metadata.
     * @returns {readonly Record<string, unknown>[]}
     */
    function listAuthorityStates() {
        if (
            skillRegistry &&
            typeof skillRegistry === "object" &&
            typeof skillRegistry.listAuthorityStates === "function"
        ) {
            return skillRegistry.listAuthorityStates();
        }
        return [];
    }

    async function readConfigRecord(resourceType, resourceId) {
        if (gateway && typeof gateway.readConfigRecord === "function") {
            const record = gateway.readConfigRecord(resourceType, resourceId);
            return record || null;
        }
        if (gateway && typeof gateway.getConfig === "function") {
            const result = await gateway.getConfig({ resourceType, resourceId });
            if (result?.status === "found") {
                return {
                    resourceType,
                    resourceId,
                    version: result.version ?? 1,
                    config: result.config,
                };
            }
        }
        return null;
    }

    async function loadAgentRegistry() {
        const record = await readConfigRecord(
            AGENT_REGISTRY_RESOURCE_TYPE,
            AGENT_REGISTRY_RESOURCE_ID,
        );
        return normalizeAgentRegistry(record?.config);
    }

    const methods = {
        async orchestrate(envelope) {
            const { sessionId, userId, text, messageId, metadata = {} } = envelope;
            const polarSessionId = sessionId;
            const inboundThreadId =
                typeof metadata.threadId === "string" && metadata.threadId.length > 0
                    ? metadata.threadId
                    : undefined;
            const inboundThreadKey =
                typeof metadata.threadKey === "string" && metadata.threadKey.length > 0
                    ? metadata.threadKey
                    : undefined;
            const inboundMetadata = (() => {
                if (typeof metadata !== "object" || metadata === null) {
                    return undefined;
                }
                const safe = toJsonSafeValue(metadata);
                if (safe === undefined || safe === null || typeof safe !== "object") {
                    return undefined;
                }
                return Object.freeze(safe);
            })();
            const isPreviewMode = metadata?.previewMode === true;
            const suppressUserMessagePersist =
                metadata?.suppressUserMessagePersist === true || isPreviewMode;
            const suppressMemoryWrite =
                metadata?.suppressMemoryWrite === true || isPreviewMode;
            const suppressTaskWrites =
                metadata?.suppressTaskWrites === true || isPreviewMode;
            const suppressAutomationWrites =
                metadata?.suppressAutomationWrites === true || isPreviewMode;
            const suppressResponsePersist =
                suppressUserMessagePersist || suppressMemoryWrite || suppressTaskWrites;

            let sessionState = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
            let routingRecommendation = null;
            let currentTurnAnchor = null;
            let currentAnchorMessageId = null;
            const profile = await profileResolutionGateway.resolve({
                sessionId: polarSessionId,
                userId: String(userId),
            });
            const policy = profile.profileConfig?.modelPolicy || {};
            const providerId = policy.providerId || "openai";
            const model = policy.modelId || "gpt-4.1-mini";
            let effectivePersonality = null;
            if (
                personalityStore &&
                typeof personalityStore === "object" &&
                typeof personalityStore.getEffectiveProfile === "function"
            ) {
                effectivePersonality = await personalityStore.getEffectiveProfile({
                    userId: String(userId),
                    sessionId: polarSessionId,
                });
            }

            if (text) {
                const classification = classifyUserMessage({ text, sessionState });
                sessionState = applyUserTurn({ sessionState, classification, rawText: text, now });
                SESSION_THREADS.set(polarSessionId, sessionState);

                // Check if repair is needed (ambiguous short follow-up with multiple open offers)
                const repairDecision = suppressTaskWrites
                    ? null
                    : computeRepairDecision(sessionState, classification, text);
                if (repairDecision) {
                    // Attempt LLM-assisted phrasing (optional — code picks candidates, LLM only phrases)
                    let repairedQuestion = repairDecision.question;
                    let repairedLabels = null;
                    try {
                        const labelA = repairDecision.options[0].label;
                        const labelB = repairDecision.options[1].label;
                        const phrasingResult = await providerGateway.generate({
                            executionType: 'handoff',
                            providerId,
                            model,
                            system: 'You are a disambiguation assistant. You must respond with ONLY a valid JSON object, no markdown, no explanation.',
                            messages: [],
                            prompt: `The user said: "${text}"\nTwo possible topics exist:\n  A: "${labelA}"\n  B: "${labelB}"\n\nWrite a short, friendly disambiguation question and relabel the options clearly.\nRespond with ONLY this JSON shape:\n{"question": "...", "labelA": "...", "labelB": "..."}`
                        });
                        if (phrasingResult?.text) {
                            const parsed = parseJsonWithSchema(
                                phrasingResult.text,
                                repairPhrasingSchema
                            );
                            repairedQuestion = /** @type {string} */ (parsed.question);
                            repairedLabels = {
                                A: /** @type {string} */ (parsed.labelA),
                                B: /** @type {string} */ (parsed.labelB)
                            };
                        }
                    } catch {
                        // LLM phrasing failed — use canned fallback (deterministic)
                    }

                    // Apply LLM labels if valid
                    if (repairedLabels) {
                        repairDecision.options[0].label = repairedLabels.A;
                        repairDecision.options[1].label = repairedLabels.B;
                    }
                    repairDecision.question = repairedQuestion;

                    PENDING_REPAIRS.set(repairDecision.correlationId, {
                        ...repairDecision,
                        createdAt: now(),
                        sessionId: polarSessionId
                    });
                    await emitLineageEvent({
                        eventType: "repair.triggered",
                        sessionId: polarSessionId,
                        userId,
                        correlationId: repairDecision.correlationId,
                        question: repairDecision.question,
                        reasonCode: "ambiguous_low_information",
                        classificationType: classification.type,
                        threadId: sessionState.activeThreadId || undefined,
                        optionIds: repairDecision.options.map((option) => option.id),
                        optionThreadIds: repairDecision.options
                            .map((option) => option.threadId)
                            .filter((threadId) => typeof threadId === "string"),
                    });
                    const assistantMessageId = `msg_a_${crypto.randomUUID()}`;
                    if (!suppressResponsePersist) {
                        await chatManagementGateway.appendMessage({
                            sessionId: polarSessionId,
                            userId: "assistant",
                            messageId: assistantMessageId,
                            role: "assistant",
                            text: repairDecision.question,
                            timestampMs: now(),
                            ...(inboundThreadId !== undefined ? { threadId: inboundThreadId } : {}),
                            ...(inboundMetadata !== undefined ? { metadata: inboundMetadata } : {}),
                        });
                    }
                    return {
                        status: 'repair_question',
                        type: 'repair_question',
                        question: repairDecision.question,
                        correlationId: repairDecision.correlationId,
                        options: repairDecision.options,
                        assistantMessageId,
                        useInlineReply: false,
                    };
                }

                const anchor = selectReplyAnchor({ sessionState, classification });
                currentTurnAnchor = anchor.useInlineReply;
                currentAnchorMessageId = anchor.anchorMessageId || null;

                if (classification.type === "accept_offer") {
                    routingRecommendation = `[ROUTING_HINT] User accepted an offer on thread: ${classification.targetThreadId}. Continue with the offered action.`;
                } else if (classification.type === "reject_offer") {
                    routingRecommendation = `[ROUTING_HINT] User declined an offer on thread: ${classification.targetThreadId}. Acknowledge and move on.`;
                } else if (classification.type === "status_nudge") {
                    routingRecommendation = `[ROUTING_HINT] This is a status nudge. Answer from the context of thread: ${classification.targetThreadId}`;
                } else if (classification.type === "override") {
                    routingRecommendation = `[ROUTING_HINT] This is an override/steering message. Priority: Handle in current active thread.`;
                } else if (classification.type === "answer_to_pending") {
                    routingRecommendation = `[ROUTING_HINT] This is an explicit slot fill for thread: ${classification.targetThreadId}. No need to clarify intent.`;
                } else if (classification.type === "error_inquiry") {
                    const ed = classification.errorDetail || {};
                    routingRecommendation = `[ROUTING_HINT] User is asking about a recent error. Thread: ${classification.targetThreadId}. Error: ${ed.capabilityId || 'unknown'} on ${ed.extensionId || 'unknown'}. Output: ${(ed.output || '').slice(0, 200)}. Explain what went wrong.`;
                }
            }

            let systemPrompt = profile.profileConfig?.systemPrompt || "You are a helpful Polar AI assistant. Be concise and friendly.";
            systemPrompt = appendPersonalityBlock(systemPrompt, effectivePersonality);
            const laneThreadKey = deriveLaneThreadKey(polarSessionId, inboundThreadKey, inboundThreadId);

            const agentRegistry = await loadAgentRegistry();
            const multiAgentConfig = {
                allowlistedModels: [
                    "gpt-4.1-mini", "gpt-4.1-nano", "claude-sonnet-4-6", "claude-haiku-4-5",
                    "gemini-3.1-pro-preview", "gemini-3-flash-preview", "deepseek-reasoner", "deepseek-chat"
                ],
                availableProfiles: agentRegistry.agents.map((agent) => ({
                    agentId: agent.agentId,
                    description: agent.description,
                    ...(Array.isArray(agent.tags) ? { tags: agent.tags } : {}),
                })),
            };

            systemPrompt += `\n\n[MULTI-AGENT ORCHESTRATION ENGINE]
You are the Primary Orchestrator. You handle simple queries natively.
For complex flows, deep reviews, long-running tasks, or writing assignments, you should consider delegating to a sub-agent.
When delegating, explicitly forward skills/MCP servers to the sub-agent so they can complete the task securely.

Available pre-configured sub-agents:
${JSON.stringify(multiAgentConfig.availableProfiles, null, 2)}

Models allowlist (use these if spinning up a dynamic sub-agent or unpinned profile):
${JSON.stringify(multiAgentConfig.allowlistedModels, null, 2)}

To delegate to a sub-agent, propose a workflow step using the tool "delegate_to_agent":
{
  "tool": "delegate_to_agent",
  "args": {
    "agentId": "@writer_agent",
    "model_override": "gpt-4.1-mini",
    "task_instructions": "Review inbox...",
    "forward_skills": ["email_mcp", "search_web"]
  }
}

[WORKFLOW CAPABILITY ENGINE]
Propose workflows via <polar_action> blocks. Only use established templates. Arbitrary step chains are not supported.

Available Templates:
- lookup_weather(location)
- search_web(query)
- draft_email(to, subject, body)
- delegate_to_agent(agentId, task_instructions, forward_skills?, model_override?)

Example:
<polar_action>
{
  "template": "lookup_weather",
  "args": { "location": "Swansea" }
}
</polar_action>

For returning control after a task, use template "complete_task".

[CONVERSATION ROUTER & THREAD STATE]
The backend manages state machine deterministically. You may optionally output a <thread_state> block to suggest slot values or suggest a status change.
If you need to ask a question to fill a slot, suggest "pending_question", "slot_key", and "expected_type" (yes_no, location, date_time, freeform).

Example:
<thread_state>
{
  "status": "waiting_for_user",
  "pending_question": "Which city?",
  "slot_key": "location",
  "expected_type": "location"
}
</thread_state>

Current Session Threads:
${JSON.stringify(sessionState, null, 2)}
${routingRecommendation || ""}`;

            if (!suppressUserMessagePersist) {
                await chatManagementGateway.appendMessage({
                    sessionId: polarSessionId,
                    userId: userId.toString(),
                    messageId: messageId || `msg_u_${crypto.randomUUID()}`,
                    role: "user",
                    text,
                    timestampMs: now(),
                    ...(inboundThreadId !== undefined ? { threadId: inboundThreadId } : {}),
                    ...(inboundMetadata !== undefined ? { metadata: inboundMetadata } : {}),
                });
            }

            const automationProposal =
                !suppressAutomationWrites
                    ? (detectInboxAutomationProposal(text) ??
                        detectAutomationProposal(text))
                    : null;
            if (automationProposal) {
                const proposalId = `auto_prop_${crypto.randomUUID()}`;
                const assistantMessageId = `msg_a_${crypto.randomUUID()}`;
                const proposalText =
                    `I can create this automation proposal:\n` +
                    `- Schedule: ${automationProposal.schedule}\n` +
                    `- Prompt template: ${automationProposal.promptTemplate}\n` +
                    `- Limits: maxNotificationsPerDay=${automationProposal.limits.maxNotificationsPerDay}\n` +
                    `- Quiet hours: ${automationProposal.quietHours.startHour}:00-${automationProposal.quietHours.endHour}:00 ${automationProposal.quietHours.timezone}\n\n` +
                    `Approve to create the job.`;

                PENDING_AUTOMATION_PROPOSALS.set(proposalId, {
                    proposalId,
                    createdAt: now(),
                    sessionId: polarSessionId,
                    userId: userId.toString(),
                    schedule: automationProposal.schedule,
                    promptTemplate: automationProposal.promptTemplate,
                    limits: automationProposal.limits,
                    quietHours: automationProposal.quietHours,
                    templateType: automationProposal.templateType ?? "generic",
                });

                if (!suppressResponsePersist) {
                    await chatManagementGateway.appendMessage({
                        sessionId: polarSessionId,
                        userId: "assistant",
                        messageId: assistantMessageId,
                        role: "assistant",
                        text: proposalText,
                        timestampMs: now(),
                        ...(inboundThreadId !== undefined ? { threadId: inboundThreadId } : {}),
                        ...(inboundMetadata !== undefined ? { metadata: inboundMetadata } : {}),
                    });
                }

                return {
                    status: "automation_proposed",
                    type: "automation_proposed",
                    text: proposalText,
                    assistantMessageId,
                    proposalId,
                    proposal: Object.freeze({
                        schedule: automationProposal.schedule,
                        promptTemplate: automationProposal.promptTemplate,
                        limits: automationProposal.limits,
                        quietHours: automationProposal.quietHours,
                        templateType: automationProposal.templateType ?? "generic",
                    }),
                    useInlineReply: currentTurnAnchor ?? false,
                    anchorMessageId: currentAnchorMessageId,
                };
            }

            const historyData = await chatManagementGateway.getSessionHistory({
                sessionId: polarSessionId,
                limit: 250
            });
            const allHistoryItems = Array.isArray(historyData?.items) ? historyData.items : [];
            const laneMessages = allHistoryItems.filter((item) => isMessageInLane(item, laneThreadKey));

            let threadSummaryText = "";
            if (memoryGateway && typeof memoryGateway.search === "function") {
                try {
                    const summarySearch = await memoryGateway.search({
                        executionType: "handoff",
                        sessionId: polarSessionId,
                        userId: String(userId),
                        scope: "session",
                        query: `thread_summary ${laneThreadKey}`,
                        limit: 5,
                    });
                    const records = Array.isArray(summarySearch?.records) ? summarySearch.records : [];
                    const threadSummary = records.find((entry) => entry?.record?.type === "thread_summary" && entry?.metadata?.threadKey === laneThreadKey);
                    if (threadSummary?.record?.summary && typeof threadSummary.record.summary === "string") {
                        threadSummaryText = threadSummary.record.summary;
                    }
                } catch {
                    // non-fatal recall failure
                }
            }

            const recentLaneMessages = laneMessages.slice(-(profile.profileConfig?.contextWindow || LANE_RECENT_MESSAGE_LIMIT));
            const estimatedTokens = estimateMessageTokens(laneMessages);
            const shouldCompactLane = laneMessages.length > LANE_COMPACTION_MESSAGE_THRESHOLD || estimatedTokens > LANE_COMPACTION_TOKEN_THRESHOLD;

            if (shouldCompactLane && memoryGateway && typeof memoryGateway.upsert === "function") {
                const rollup = buildThreadSummaryRecord(laneMessages);
                if (rollup.summarizedCount > 0) {
                    try {
                        await memoryGateway.upsert({
                            executionType: "handoff",
                            sessionId: polarSessionId,
                            userId: String(userId),
                            scope: "session",
                            memoryId: `thread_summary:${polarSessionId}:${laneThreadKey}`,
                            record: {
                                type: "thread_summary",
                                threadKey: laneThreadKey,
                                summary: rollup.summary,
                                unsummarizedTailCount: rollup.unsummarizedTail.length,
                            },
                            metadata: {
                                threadKey: laneThreadKey,
                                summaryVersion: 1,
                                updatedAtMs: now(),
                                messageRange: {
                                    from: laneMessages[0]?.messageId,
                                    to: laneMessages[Math.max(0, laneMessages.length - LANE_UNSUMMARIZED_TAIL_COUNT - 1)]?.messageId,
                                },
                            },
                        });
                        threadSummaryText = rollup.summary;
                    } catch {
                        // non-fatal summary persistence failure
                    }
                }
            }

            const retrievalHints = [];
            if (memoryGateway && typeof memoryGateway.search === "function" && typeof text === "string" && text.trim().length > 0) {
                try {
                    const memoryResult = await memoryGateway.search({
                        executionType: "handoff",
                        sessionId: polarSessionId,
                        userId: String(userId),
                        scope: "session",
                        query: text,
                        limit: MEMORY_RETRIEVAL_LIMIT,
                    });
                    const records = Array.isArray(memoryResult?.records) ? memoryResult.records : [];
                    for (const entry of records) {
                        const entryThreadKey = entry?.metadata?.threadKey;
                        if (typeof entryThreadKey === "string" && entryThreadKey.length > 0 && entryThreadKey !== laneThreadKey) {
                            continue;
                        }
                        if (entry?.record?.type === "thread_summary" && entryThreadKey !== laneThreadKey) {
                            continue;
                        }
                        const detail = entry?.record?.fact || entry?.record?.summary || entry?.record?.content || JSON.stringify(entry?.record ?? {});
                        if (typeof detail === "string" && detail.trim().length > 0) {
                            retrievalHints.push(`- ${redactSecrets(detail).slice(0, 220)}`);
                        }
                        if (retrievalHints.length >= 5) {
                            break;
                        }
                    }
                } catch {
                    // non-fatal retrieval failure
                }
            }

            const replyContextBlock = buildReplyContextBlock(
                laneMessages,
                metadata?.replyToMessageId,
            );

            if (threadSummaryText) {
                systemPrompt += `\n\n[THREAD_SUMMARY threadKey=${laneThreadKey}]\n${threadSummaryText}\n[/THREAD_SUMMARY]`;
            }
            if (retrievalHints.length > 0) {
                systemPrompt += `\n\n[RETRIEVED_MEMORIES]\n${retrievalHints.join("\n")}\n[/RETRIEVED_MEMORIES]`;
            }

            let messages = recentLaneMessages.map(m => ({ role: m.role, content: m.text }));
            if (replyContextBlock) {
                messages = [
                    ...messages,
                    { role: "system", content: replyContextBlock },
                ];
            }

            const result = await providerGateway.generate({
                executionType: "handoff",
                providerId,
                model,
                system: systemPrompt,
                messages: messages.length > 0 && messages[messages.length - 1].role === 'user' ? messages.slice(0, -1) : messages,
                prompt: text || "Process user message."
            });

            if (result && result.text) {
                const responseText = result.text;
                const actionMatch = suppressTaskWrites ? null : responseText.match(/<polar_action>([\s\S]*?)<\/polar_action>/);
                const stateMatch = suppressTaskWrites ? null : responseText.match(/<thread_state>([\s\S]*?)<\/thread_state>/);
                const assistantMessageId = `msg_a_${crypto.randomUUID()}`;

                const cleanText = responseText
                    .replace(/<polar_action>[\s\S]*?<\/polar_action>/, '')
                    .replace(/<thread_state>[\s\S]*?<\/thread_state>/, '')
                    .trim();

                if (cleanText && !suppressResponsePersist) {
                    await chatManagementGateway.appendMessage({
                        sessionId: polarSessionId,
                        userId: "assistant",
                        messageId: assistantMessageId,
                        role: "assistant",
                        text: cleanText,
                        timestampMs: now(),
                        ...(inboundThreadId !== undefined ? { threadId: inboundThreadId } : {}),
                        ...(inboundMetadata !== undefined ? { metadata: inboundMetadata } : {}),
                    });
                }

                // Detect offers in assistant response and set open offer on active thread
                if (cleanText && !suppressTaskWrites && !suppressResponsePersist) {
                    const offerDetection = detectOfferInText(cleanText);
                    if (offerDetection.isOffer) {
                        let st = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                        const activeThread = st.threads.find(t => t.id === st.activeThreadId);
                        if (activeThread) {
                            setOpenOffer(activeThread, {
                                offerType: offerDetection.offerType,
                                target: offerDetection.offerText,
                                askedAtMessageId: assistantMessageId
                            }, now());
                            SESSION_THREADS.set(polarSessionId, st);
                        }
                    }
                }

                if (stateMatch) {
                    try {
                        const stateUpdate = parseJsonWithSchema(
                            stateMatch[1].trim(),
                            threadStateSuggestionSchema
                        );
                        let st = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                        // RESTRICTED: only active thread, model cannot switch threads
                        const threadRef = st.threads.find(t => t.id === st.activeThreadId);
                        if (threadRef) {
                            // Only 'done' and 'waiting_for_user' — model cannot set in_progress/failed/blocked
                            if (stateUpdate.status === "done") {
                                threadRef.status = "done";
                                delete threadRef.pendingQuestion;
                            } else if (stateUpdate.status === "waiting_for_user" && (stateUpdate.pending_question || stateUpdate.pendingQuestion)) {
                                threadRef.status = "waiting_for_user";
                                threadRef.pendingQuestion = {
                                    key: stateUpdate.slot_key || stateUpdate.slotKey || "latest_answer",
                                    expectedType: stateUpdate.expected_type || stateUpdate.expectedType || "freeform",
                                    text: stateUpdate.pending_question || stateUpdate.pendingQuestion,
                                    askedAtMessageId: assistantMessageId
                                };
                            }
                            // Allowlisted slot keys only — no arbitrary injection
                            const ALLOWED_SLOT_KEYS = ['location', 'query', 'date', 'time', 'subject', 'recipient', 'latest_answer'];
                            if (stateUpdate.slots && typeof stateUpdate.slots === 'object') {
                                for (const [key, val] of Object.entries(stateUpdate.slots)) {
                                    if (ALLOWED_SLOT_KEYS.includes(key)) {
                                        threadRef.slots[key] = val;
                                    }
                                }
                            }
                            threadRef.lastActivityTs = now();
                        }
                        SESSION_THREADS.set(polarSessionId, st);
                    } catch (e) { }
                }

                if (actionMatch) {
                    const proposal = parseModelProposal(actionMatch[0]);
                    if (!proposal || proposal.error) return { status: 'error', text: "⚠️ Failed to parse action proposal" };

                    const workflowSteps = expandTemplate(proposal.templateId, proposal.args);
                    const risk = evaluateWorkflowRisk(workflowSteps);
                    const principal = { userId, sessionId: polarSessionId };
                    const pendingRequirements = checkGrants(risk.requirements, principal);

                    const requiresManualApproval = pendingRequirements.length > 0 || risk.hasDelegation;
                    const workflowId = crypto.randomUUID();
                    const ownerThreadId = sessionState.activeThreadId;
                    PENDING_WORKFLOWS.set(workflowId, {
                        steps: workflowSteps,
                        createdAt: now(),
                        polarSessionId,
                        userId, // Store for grant issuance
                        multiAgentConfig,
                        threadId: ownerThreadId, // canonical thread→workflow link
                        risk: { ...risk, requirements: pendingRequirements }
                    });

                    // Auto-run rules: if no manual approval required, execute immediately
                    if (!requiresManualApproval) {
                        return methods.executeWorkflow(workflowId, { isAutoRun: true });
                    }

                    // Mark the owner thread as awaiting approval
                    let st = SESSION_THREADS.get(polarSessionId);
                    if (st && ownerThreadId) {
                        const thread = st.threads.find(t => t.id === ownerThreadId);
                        if (thread) {
                            thread.status = 'workflow_proposed';
                            thread.awaitingApproval = { workflowId, proposedAtMessageId: assistantMessageId };
                            thread.lastActivityTs = now();
                        }
                    }

                    return {
                        status: 'workflow_proposed',
                        assistantMessageId,
                        text: cleanText,
                        workflowId,
                        steps: workflowSteps,
                        risk: {
                            level: risk.riskLevel,
                            sideEffects: risk.sideEffects,
                            dataEgress: risk.dataEgress,
                            requirements: pendingRequirements
                        },
                        useInlineReply: currentTurnAnchor ?? false,
                        anchorMessageId: currentAnchorMessageId
                    };
                }

                return {
                    status: 'completed',
                    assistantMessageId,
                    text: cleanText || responseText,
                    useInlineReply: currentTurnAnchor ?? false,
                    anchorMessageId: currentAnchorMessageId
                };
            }
            return { status: 'error', text: "No generation results." };
        },

        async executeWorkflow(workflowId, options = {}) {
            const entry = PENDING_WORKFLOWS.get(workflowId);
            if (!entry) return { status: 'error', text: "Workflow not found" };

            const { steps: workflowSteps, polarSessionId, userId, multiAgentConfig, threadId: ownerThreadId, risk } = entry;
            PENDING_WORKFLOWS.delete(workflowId);

            // Resolve the target thread — use stored threadId, never rely on activeThreadId drift
            const runId = `run_${crypto.randomUUID()}`;
            const transientGrantIds = [];

            // If this was a manual approval, issue grants for the requirements.
            // Write-tier grants may be reusable; destructive grants are run-scoped and revoked in finally.
            if (!options.isAutoRun) {
                const principal = { userId, sessionId: polarSessionId };
                const allRequirements = Array.isArray(risk?.requirements) ? risk.requirements : [];
                const writeRequirements = allRequirements.filter(req => req.riskLevel !== 'destructive');
                const destructiveRequirements = allRequirements.filter(req => req.riskLevel === 'destructive');

                if (writeRequirements.length > 0) {
                    const capabilities = writeRequirements.map(req => ({
                        extensionId: req.extensionId,
                        capabilityId: req.capabilityId
                    }));
                    const maxTtl = 3600 * 24; // 24h default for plan approval
                    approvalStore.issueGrant(principal, {
                        capabilities
                    }, maxTtl, 'Plan Approval', {
                        workflowId,
                        threadId: ownerThreadId,
                        reason: 'User approved multi-step plan'
                    }, 'write');
                }

                for (const requirement of destructiveRequirements) {
                    const transientGrantId = approvalStore.issueGrant(principal, {
                        capabilities: [
                            {
                                extensionId: requirement.extensionId,
                                capabilityId: requirement.capabilityId
                            }
                        ],
                        constraints: {
                            workflowId,
                            runId
                        }
                    }, 300, 'Destructive Step Approval', {
                        workflowId,
                        runId,
                        threadId: ownerThreadId,
                        reason: 'User approved destructive workflow step'
                    }, 'destructive');
                    transientGrantIds.push(transientGrantId);
                }
            }

            let st = SESSION_THREADS.get(polarSessionId);
            const targetThreadId = ownerThreadId || st?.activeThreadId;
            const toErrorSnippet = (value, fallback = 'Unknown error') => {
                if (typeof value === 'string') return value.slice(0, 300);
                if (value === undefined || value === null) return fallback;
                try {
                    return JSON.stringify(value).slice(0, 300);
                } catch {
                    return String(value).slice(0, 300);
                }
            };
            const destructiveRequirementKeys = new Set(
                (Array.isArray(risk?.requirements) ? risk.requirements : [])
                    .filter(req => req.riskLevel === 'destructive')
                    .map(req => `${req.extensionId}::${req.capabilityId}`)
            );

            // Mark thread as in-flight and ensure it's active
            if (st && targetThreadId) {
                const thread = st.threads.find(t => t.id === targetThreadId);
                if (thread) {
                    thread.status = 'in_progress';
                    thread.inFlight = { runId, workflowId, startedAt: now() };
                    delete thread.awaitingApproval;
                    thread.lastActivityTs = now();
                }
                // Force active thread to the workflow's thread
                st.activeThreadId = targetThreadId;
            }

            try {
                const profile = await profileResolutionGateway.resolve({
                    sessionId: polarSessionId,
                    userId: String(userId),
                });
                const agentRegistry = await loadAgentRegistry();
                let effectivePersonality = null;
                if (
                    personalityStore &&
                    typeof personalityStore === "object" &&
                    typeof personalityStore.getEffectiveProfile === "function"
                ) {
                    effectivePersonality = await personalityStore.getEffectiveProfile({
                        userId: String(userId),
                        sessionId: polarSessionId,
                    });
                }
                const baseAllowedSkills = profile.profileConfig?.allowedSkills || multiAgentConfig?.globalAllowedSkills || [];
                const historyData = await chatManagementGateway.getSessionHistory({ sessionId: polarSessionId, limit: 15 });

                let msgActiveDelegation = null;
                if (historyData?.items) {
                    for (const msg of [...historyData.items].reverse()) {
                        if (msg.role === 'user') break;
                        if (msg.role === 'system' && msg.text.startsWith('[DELEGATION CLEARED]')) break;
                        if (msg.role === 'system' && msg.text.startsWith('[DELEGATION ACTIVE]')) {
                            try {
                                msgActiveDelegation = parseJsonWithSchema(
                                    msg.text.replace('[DELEGATION ACTIVE]', '').trim(),
                                    delegationStateSchema
                                );
                                break;
                            } catch {
                                // Ignore invalid persisted delegation metadata.
                            }
                        }
                    }
                }

                // Compute capability scope before validation — this is what extension-gateway enforces
                let activeDelegation = msgActiveDelegation;
                let capabilityScope = computeCapabilityScope({
                    sessionProfile: profile,
                    multiAgentConfig,
                    activeDelegation,
                    installedExtensions: extensionGateway.listStates(),
                    authorityStates: listAuthorityStates()
                });

                const validation = validateSteps(workflowSteps, { capabilityScope });
                if (!validation.ok) {
                    // Validation failure: clear inFlight, set lastError
                    st = SESSION_THREADS.get(polarSessionId);
                    if (st && targetThreadId) {
                        const thread = st.threads.find(t => t.id === targetThreadId);
                        if (thread) {
                            thread.lastError = {
                                runId, workflowId, threadId: targetThreadId,
                                extensionId: 'orchestrator', capabilityId: 'validateSteps',
                                output: validation.errors.join(', ').slice(0, 300),
                                messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                            };
                            thread.status = 'failed';
                            delete thread.inFlight;
                        }
                    }
                    return { status: 'error', text: "Workflow blocked: " + validation.errors.join(", ") };
                }

                const toolResults = [];

                for (const step of workflowSteps) {
                    const { capabilityId, extensionId, args: parsedArgs = {}, extensionType = "mcp" } = step;

                    if (capabilityId === "delegate_to_agent") {
                        const agentId = typeof parsedArgs.agentId === "string" ? parsedArgs.agentId : "";
                        if (!AGENT_ID_PATTERN.test(agentId)) {
                            toolResults.push({ tool: capabilityId, status: "error", output: "Delegation blocked: invalid agentId." });
                            continue;
                        }

                        const agentProfile = agentRegistry.agents.find((agent) => agent.agentId === agentId) || null;
                        let delegatedProfileConfig = profile.profileConfig || {};
                        let delegatedProfileId = null;
                        let registryAllowedForwardSkills = [];
                        let defaultForwardSkills = [];
                        if (agentProfile) {
                            delegatedProfileId = agentProfile.profileId;
                            registryAllowedForwardSkills = normalizeStringArray(agentProfile.allowedForwardSkills);
                            defaultForwardSkills = normalizeStringArray(agentProfile.defaultForwardSkills);
                            const delegatedProfileRecord = await readConfigRecord("profile", agentProfile.profileId);
                            if (!delegatedProfileRecord || !delegatedProfileRecord.config || typeof delegatedProfileRecord.config !== "object") {
                                toolResults.push({ tool: capabilityId, status: "error", output: `Delegation blocked: profile not found (${agentProfile.profileId}).` });
                                continue;
                            }
                            delegatedProfileConfig = delegatedProfileRecord.config;
                        }

                        const delegatedAllowedSkills = normalizeStringArray(delegatedProfileConfig.allowedSkills);
                        const parentAllowedSkills = normalizeStringArray(baseAllowedSkills);
                        const requestedForwardSkills = normalizeStringArray(
                            parsedArgs.forward_skills && Array.isArray(parsedArgs.forward_skills)
                                ? parsedArgs.forward_skills
                                : defaultForwardSkills,
                        );

                        const allowedSkills = requestedForwardSkills.filter((skill) => {
                            if (!parentAllowedSkills.includes(skill)) return false;
                            if (delegatedAllowedSkills.length > 0 && !delegatedAllowedSkills.includes(skill)) return false;
                            if (registryAllowedForwardSkills.length > 0 && !registryAllowedForwardSkills.includes(skill)) return false;
                            return true;
                        });
                        const rejectedSkills = requestedForwardSkills.filter((skill) => !allowedSkills.includes(skill));

                        if (requestedForwardSkills.length > 0 && allowedSkills.length === 0) {
                            const legacyForward = validateForwardSkills({
                                forwardSkills: requestedForwardSkills,
                                sessionProfile: profile,
                                multiAgentConfig,
                            });
                            if (legacyForward.isBlocked) {
                                toolResults.push({ tool: capabilityId, status: "error", output: "Delegation blocked by security policy." });
                                continue;
                            }
                            allowedSkills.splice(0, allowedSkills.length, ...legacyForward.allowedSkills);
                            rejectedSkills.splice(0, rejectedSkills.length, ...legacyForward.rejectedSkills);
                        }

                        if (allowedSkills.length === 0 && requestedForwardSkills.length > 0) {
                            toolResults.push({ tool: capabilityId, status: "error", output: "Delegation blocked by security policy." });
                            continue;
                        }

                        const delegatedModelPolicy =
                            delegatedProfileConfig.modelPolicy &&
                                typeof delegatedProfileConfig.modelPolicy === "object"
                                ? delegatedProfileConfig.modelPolicy
                                : {};
                        let providerId = delegatedModelPolicy.providerId || profile.profileConfig?.modelPolicy?.providerId || "openai";
                        let modelId = delegatedModelPolicy.modelId || profile.profileConfig?.modelPolicy?.modelId || "gpt-4.1-mini";
                        const requestedModelOverride =
                            typeof parsedArgs.model_override === "string" ? parsedArgs.model_override : "";
                        let modelRejectedReason;
                        if (agentProfile) {
                            modelRejectedReason =
                                requestedModelOverride && requestedModelOverride !== modelId
                                    ? `Model override clamped to delegated profile model (${modelId}).`
                                    : undefined;
                        } else {
                            const legacyModel = validateModelOverride({
                                modelOverride: requestedModelOverride,
                                multiAgentConfig,
                                basePolicy: profile.profileConfig?.modelPolicy || {},
                            });
                            providerId = legacyModel.providerId;
                            modelId = legacyModel.modelId;
                            modelRejectedReason = legacyModel.rejectedReason;
                        }

                        activeDelegation = {
                            ...parsedArgs,
                            agentId,
                            ...(delegatedProfileId ? { profileId: delegatedProfileId } : {}),
                            forward_skills: allowedSkills,
                            model_override: modelId,
                            pinnedProvider: providerId,
                        };
                        // Recompute capability scope after delegation change
                        capabilityScope = computeCapabilityScope({
                            sessionProfile: profile,
                            multiAgentConfig,
                            activeDelegation,
                            installedExtensions: extensionGateway.listStates(),
                            authorityStates: listAuthorityStates()
                        });
                        const output =
                            `Successfully delegated to ${agentId}.` +
                            (rejectedSkills.length ? ` Clamped skills: ${rejectedSkills.join(", ")}.` : "") +
                            (modelRejectedReason ? ` ${modelRejectedReason}` : "");
                        toolResults.push({ tool: capabilityId, status: "delegated", output });

                        await emitLineageEvent({
                            eventType: "delegation.activated",
                            sessionId: polarSessionId,
                            userId,
                            workflowId,
                            runId,
                            threadId: targetThreadId,
                            agentId,
                            ...(delegatedProfileId ? { profileId: delegatedProfileId } : {}),
                            allowedSkills,
                            rejectedSkills,
                            providerId,
                            modelId,
                            timestampMs: now(),
                        });

                        await chatManagementGateway.appendMessage({
                            sessionId: polarSessionId, userId: "system", role: "system",
                            text: `[DELEGATION ACTIVE] ${JSON.stringify(activeDelegation)}`, timestampMs: now()
                        });
                        continue;
                    }

                    if (capabilityId === "complete_task") {
                        activeDelegation = null;
                        // Recompute capability scope after delegation cleared
                        capabilityScope = computeCapabilityScope({
                            sessionProfile: profile,
                            multiAgentConfig,
                            activeDelegation,
                            installedExtensions: extensionGateway.listStates(),
                            authorityStates: listAuthorityStates()
                        });
                        toolResults.push({ tool: capabilityId, status: "completed", output: "Task completed." });
                        await chatManagementGateway.appendMessage({ sessionId: polarSessionId, userId: "system", role: "system", text: `[DELEGATION CLEARED]`, timestampMs: now() });
                        continue;
                    }

                    const stepKey = `${extensionId}::${capabilityId}`;
                    const metadata = {
                        lineage: {
                            workflowId,
                            runId,
                            ...(targetThreadId ? { threadId: targetThreadId } : {}),
                        },
                    };
                    if (destructiveRequirementKeys.has(stepKey) && !options.isAutoRun) {
                        metadata.approvalContext = { workflowId, runId };
                    }
                    const output = await extensionGateway.execute({
                        extensionId,
                        extensionType,
                        capabilityId,
                        sessionId: polarSessionId,
                        userId,
                        input: parsedArgs,
                        capabilityScope,
                        metadata,
                    });
                    const stepStatus = output?.status || "completed";
                    toolResults.push({ tool: capabilityId, status: stepStatus, output: output?.output || output?.error || "Done." });

                    // Record lastError on owning thread if step failed
                    if (stepStatus === 'failed' || stepStatus === 'error') {
                        st = SESSION_THREADS.get(polarSessionId);
                        if (st && targetThreadId) {
                            const thread = st.threads.find(t => t.id === targetThreadId);
                            if (thread) {
                                thread.lastError = {
                                    runId, workflowId, threadId: targetThreadId,
                                    extensionId, capabilityId,
                                    output: toErrorSnippet(output?.error || output?.output, 'Unknown error'),
                                    messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                                };
                                thread.status = 'failed';
                                delete thread.inFlight;
                            }
                        }
                    }
                }

                // Post-loop: clear inFlight on owning thread, set final status
                st = SESSION_THREADS.get(polarSessionId);
                const anyFailed = toolResults.some(r => r.status === 'failed' || r.status === 'error');
                if (st && targetThreadId) {
                    const thread = st.threads.find(t => t.id === targetThreadId);
                    if (thread) {
                        delete thread.inFlight;
                        if (anyFailed && !thread.lastError) {
                            const failedStep = toolResults.find(r => r.status === 'failed' || r.status === 'error');
                            thread.lastError = {
                                runId, workflowId, threadId: targetThreadId,
                                extensionId: failedStep?.tool || 'unknown',
                                capabilityId: failedStep?.tool || 'unknown',
                                output: toErrorSnippet(failedStep?.output, 'Execution failed'),
                                messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                            };
                            thread.status = 'failed';
                        } else if (!anyFailed) {
                            thread.status = 'in_progress'; // workflow done, thread continues
                        }
                        thread.lastActivityTs = now();
                    }
                }

                const deterministicHeader = "### 🛠️ Execution Results\n" + toolResults.map(r => (r.status === "failed" || r.status === "error" ? "❌ " : "✅ ") + `**${r.tool}**: ${typeof r.output === 'string' ? r.output.slice(0, 100) : 'Done.'}`).join("\n") + "\n\n";
                await chatManagementGateway.appendMessage({ sessionId: polarSessionId, userId: "system", role: "system", text: `[TOOL RESULTS] threadId=${targetThreadId} runId=${runId}\n${JSON.stringify(toolResults, null, 2)}`, timestampMs: now() });

                const finalSystemPromptBase = activeDelegation
                    ? `You are sub-agent ${activeDelegation.agentId}. Task: ${activeDelegation.task_instructions}. Skills: ${activeDelegation.forward_skills?.join(", ")}`
                    : profile.profileConfig?.systemPrompt;
                const finalSystemPrompt = appendPersonalityBlock(
                    finalSystemPromptBase || "You are a helpful Polar AI assistant. Be concise and friendly.",
                    effectivePersonality,
                );
                const finalResult = await providerGateway.generate({
                    executionType: "handoff",
                    providerId: activeDelegation?.pinnedProvider || profile.profileConfig?.modelPolicy?.providerId || "openai",
                    model: activeDelegation?.model_override || profile.profileConfig?.modelPolicy?.modelId || "gpt-4.1-mini",
                    system: finalSystemPrompt,
                    messages: historyData?.items ? historyData.items.map(m => ({ role: m.role, content: m.text })) : [],
                    prompt: `Analyze these execution results and summarize for the user. Do NOT hide any failures listed in the header.\n\n${deterministicHeader}`
                });

                const responseText = finalResult?.text || "Execution complete.";
                const cleanText = responseText.replace(/<polar_action>[\s\S]*?<\/polar_action>/, '').replace(/<thread_state>[\s\S]*?<\/thread_state>/, '').trim();

                const assistantMessageId = `msg_ast_${crypto.randomUUID()}`;
                await chatManagementGateway.appendMessage({
                    sessionId: polarSessionId, userId: "assistant", role: "assistant",
                    text: cleanText, messageId: assistantMessageId, timestampMs: now()
                });

                const sessionStateForReply = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                return {
                    status: 'completed',
                    text: deterministicHeader + cleanText,
                    assistantMessageId,
                    useInlineReply: selectReplyAnchor({
                        sessionState: sessionStateForReply,
                        classification: { type: 'status_nudge', targetThreadId: targetThreadId }
                    }).useInlineReply
                };
            } catch (err) {
                // Crash path: record lastError on the owning thread (using stored threadId)
                let internalMessageId;
                st = SESSION_THREADS.get(polarSessionId);
                if (st && targetThreadId) {
                    const thread = st.threads.find(t => t.id === targetThreadId);
                    if (thread) {
                        thread.lastError = {
                            runId, workflowId, threadId: targetThreadId,
                            extensionId: 'orchestrator', capabilityId: 'executeWorkflow',
                            output: err.message?.slice(0, 300) || 'Unknown crash',
                            messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                        };
                        internalMessageId = thread.lastError.messageId;
                        thread.status = 'failed';
                        delete thread.inFlight;
                        thread.lastActivityTs = now();
                    }
                    // Keep failed thread active — don't let next message spawn a greeting
                    st.activeThreadId = targetThreadId;
                }
                return { status: 'error', text: `Crashed: ${err.message}`, internalMessageId };
            } finally {
                for (const grantId of transientGrantIds) {
                    approvalStore.revokeGrant(grantId);
                }
            }
        },

        updateMessageChannelId(sessionId, messageId, channelMessageId) {
            let st = SESSION_THREADS.get(sessionId);
            if (st) {
                for (const t of st.threads) {
                    if (t.pendingQuestion?.askedAtMessageId === messageId) {
                        t.pendingQuestion.channelMessageId = channelMessageId;
                    }
                    if (t.lastError?.messageId === messageId) {
                        t.lastError.channelMessageId = channelMessageId;
                    }
                }
            }
            return chatManagementGateway.appendMessage({
                sessionId,
                userId: "system",
                messageId: `msg_sys_bind_${crypto.randomUUID()}`,
                role: "system",
                text: `[CHANNEL_BINDING] ${messageId} -> ${channelMessageId}`,
                timestampMs: now(),
                metadata: {
                    bindingType: "channel_message_id",
                    internalMessageId: messageId,
                    channelMessageId,
                },
            }).catch(() => undefined);
        },

        async rejectWorkflow(workflowId) {
            const entry = PENDING_WORKFLOWS.get(workflowId);
            if (entry) {
                // Clear awaitingApproval on the owning thread
                const st = SESSION_THREADS.get(entry.polarSessionId);
                if (st && entry.threadId) {
                    const thread = st.threads.find(t => t.id === entry.threadId);
                    if (thread) {
                        thread.status = 'in_progress';
                        delete thread.awaitingApproval;
                        thread.lastActivityTs = now();
                    }
                }
            }
            PENDING_WORKFLOWS.delete(workflowId);
            return { status: 'rejected' };
        },

        /**
         * Atomically consumes a pending automation proposal so approval cannot create duplicate jobs.
         * @param {string} proposalId
         * @returns {{ status: "found", proposal: Record<string, unknown> } | { status: "not_found", proposalId: string }}
         */
        consumeAutomationProposal(proposalId) {
            const proposal = PENDING_AUTOMATION_PROPOSALS.get(proposalId);
            if (!proposal) {
                return { status: "not_found", proposalId };
            }
            PENDING_AUTOMATION_PROPOSALS.delete(proposalId);
            return {
                status: "found",
                proposal: Object.freeze({
                    proposalId: proposal.proposalId,
                    sessionId: proposal.sessionId,
                    userId: proposal.userId,
                    schedule: proposal.schedule,
                    promptTemplate: proposal.promptTemplate,
                    limits: proposal.limits,
                    quietHours: proposal.quietHours,
                    templateType: proposal.templateType,
                    createdAt: proposal.createdAt,
                }),
            };
        },

        /**
         * @param {string} proposalId
         * @returns {{ status: "rejected"|"not_found", proposalId: string }}
         */
        rejectAutomationProposal(proposalId) {
            if (!PENDING_AUTOMATION_PROPOSALS.has(proposalId)) {
                return { status: "not_found", proposalId };
            }
            PENDING_AUTOMATION_PROPOSALS.delete(proposalId);
            return { status: "rejected", proposalId };
        },

        /**
         * Handle a repair selection event (button click: A or B).
         * Deterministic — no LLM call needed.
         * @param {{ sessionId: string, selection: 'A'|'B', correlationId: string }} event
         * @returns {{ status: string, selectedThreadId?: string }}
         */
        async handleRepairSelectionEvent({ sessionId, selection, correlationId }) {
            const repairContext = PENDING_REPAIRS.get(correlationId);
            if (!repairContext) {
                await emitLineageEvent({
                    eventType: "repair.outcome",
                    sessionId,
                    correlationId,
                    selection,
                    status: "error",
                    reasonCode: "context_missing",
                });
                return { status: 'error', text: 'Repair context not found or expired.' };
            }

            if (repairContext.sessionId !== sessionId) {
                await emitLineageEvent({
                    eventType: "repair.outcome",
                    sessionId,
                    correlationId,
                    selection,
                    status: "error",
                    reasonCode: "session_mismatch",
                    expectedSessionId: repairContext.sessionId,
                });
                return { status: 'error', text: 'Session mismatch for repair selection.' };
            }

            if (selection !== 'A' && selection !== 'B') {
                await emitLineageEvent({
                    eventType: "repair.outcome",
                    sessionId,
                    correlationId,
                    selection,
                    status: "error",
                    reasonCode: "invalid_selection",
                });
                return { status: 'error', text: 'Invalid selection. Must be A or B.' };
            }

            const selectedOption = repairContext.options.find(o => o.id === selection);
            await emitLineageEvent({
                eventType: "repair.selection",
                sessionId,
                correlationId,
                selection,
                selectedThreadId: selectedOption?.threadId,
                threadId: selectedOption?.threadId,
                status: "received",
            });

            let sessionState = SESSION_THREADS.get(sessionId) || { threads: [], activeThreadId: null };
            sessionState = handleRepairSelection(sessionState, selection, correlationId, repairContext, now());
            SESSION_THREADS.set(sessionId, sessionState);
            PENDING_REPAIRS.delete(correlationId);

            await emitLineageEvent({
                eventType: "repair.outcome",
                sessionId,
                correlationId,
                selection,
                selectedThreadId: selectedOption?.threadId,
                threadId: selectedOption?.threadId,
                status: "completed",
                reasonCode: "selection_applied",
            });

            return {
                status: 'completed',
                text: `Got it — continuing with: ${selectedOption?.label || selection}`,
                selectedThreadId: selectedOption?.threadId,
                useInlineReply: false
            };
        }
    };

    return Object.freeze(methods);
}
