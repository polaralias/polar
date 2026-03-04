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
import { normalizeToolWorkflowError } from './tool-workflow-error-normalizer.mjs';

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

const routerDecisionSchema = createStrictObjectSchema({
    schemaId: 'orchestrator.router.decision',
    fields: {
        decision: enumField(["respond", "delegate", "tool", "workflow", "clarify"]),
        target: jsonField({ required: false }),
        confidence: jsonField(),
        rationale: stringField({ minLength: 1 }),
        references: jsonField({ required: false }),
        scores: jsonField({ required: false }),
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
const DEFAULT_GENERIC_AGENT_ID = "@generic_sub_agent";
const DEFAULT_GENERIC_PROFILE_ID = "profile.generic_sub_agent";
const ROUTER_CONFIDENCE_THRESHOLD = 0.65;
const ROUTER_DECISION_MARGIN_THRESHOLD = 0.12;
const TEMPORAL_ATTENTION_WINDOW_MS = 30 * 60 * 1000;
const TEMPORAL_ATTENTION_RECENT_ACTION_LIMIT = 5;

const ROUTING_DECISIONS = /** @type {const} */ (["respond", "delegate", "tool", "workflow", "clarify"]);

/**
 * @param {string} text
 * @returns {"low"|"medium"|"high"|"destructive"}
 */
function classifyRoutingRisk(text = "") {
    const normalized = String(text || "").toLowerCase();
    const destructiveIntent = /\b(delete|remove|destroy|wipe|drop)\b/.test(normalized);
    if (destructiveIntent) {
        return "destructive";
    }
    const highRiskIntent = /\b(write|draft|create|compose|send|edit|update|workflow|plan|multi-step|delegate)\b/.test(normalized);
    if (highRiskIntent) {
        return "high";
    }
    const mediumRiskIntent = /\b(tool|search|look up|again|that|it)\b/.test(normalized);
    if (mediumRiskIntent) {
        return "medium";
    }
    return "low";
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasRoutingCue(text = "") {
    const normalized = String(text || "").toLowerCase();
    return /\b(sub-agent|sub agent|delegate|workflow|tool|do that|that|it|again|plan|step by step|multi-step|search|look up|weather|version|variant|research|compare|analy[sz]e|proposal|calendar|email|inbox|travel|code|debug|refactor)\b/.test(normalized);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasSpecialistDelegationCue(text = "") {
    const normalized = String(text || "").toLowerCase();
    return /\b(research|compare|analy[sz]e|proposal|strategy|travel|calendar|inbox|email triage|code review|refactor|debug|root cause|investigate)\b/.test(normalized);
}

/**
 * @param {string} text
 * @param {Set<string>} installedAgentIds
 * @returns {string|null}
 */
function resolveMentionedAgentId(text, installedAgentIds) {
    if (!(installedAgentIds instanceof Set) || installedAgentIds.size === 0) {
        return null;
    }
    const normalizedText = String(text || "").toLowerCase();
    const matches = normalizedText.match(/@[a-z0-9_-]{2,32}/g) || [];
    for (const match of matches) {
        if (installedAgentIds.has(match)) {
            return match;
        }
    }
    for (const agentId of installedAgentIds) {
        const plain = String(agentId || "").toLowerCase().replace(/^@/, "");
        if (!plain) continue;
        const phrase = plain.replace(/[_-]+/g, " ").trim();
        const plainPattern = new RegExp(`\\b${plain.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
        const phrasePattern = phrase
            ? new RegExp(`\\b${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i")
            : null;
        if (plainPattern.test(normalizedText) || (phrasePattern && phrasePattern.test(normalizedText))) {
            return agentId;
        }
    }
    return null;
}

/**
 * @param {Record<string, number>} scores
 * @returns {{ topDecision: string, topScore: number, secondScore: number, margin: number }}
 */
function extractTopDecision(scores) {
    const ranked = Object.entries(scores)
        .sort((left, right) => right[1] - left[1]);
    const [topDecision = "respond", topScore = 0] = ranked[0] || [];
    const secondScore = ranked[1]?.[1] ?? 0;
    return {
        topDecision,
        topScore,
        secondScore,
        margin: topScore - secondScore,
    };
}

/**
 * @param {{ text: string, classification: Record<string, unknown>|null, stageADelegationSignal: boolean, availableToolsCount: number, policyFlags: Record<string, unknown> }} input
 * @returns {Record<string, number>}
 */
function deriveHeuristicRoutingScores(input) {
    const { text, classification, stageADelegationSignal, availableToolsCount, policyFlags } = input;
    const normalized = String(text || "").toLowerCase();
    const specialistCue = hasSpecialistDelegationCue(normalized);
    const scores = {
        respond: 0.45,
        delegate: 0.2,
        tool: 0.2,
        workflow: 0.2,
        clarify: 0.15,
    };

    if (classification?.type === "answer_to_pending" || classification?.type === "accept_offer") {
        scores.respond += 0.4;
    }
    if (classification?.type === "override" || classification?.type === "status_nudge") {
        scores.respond += 0.2;
    }
    if (stageADelegationSignal) {
        scores.delegate += 0.7;
        scores.workflow += 0.25;
    }
    if (/\b(workflow|plan|step by step|multi-step|research and compare|deep dive|proposal|10 versions|10 different versions)\b/.test(normalized)) {
        scores.workflow += 0.55;
    }
    if (/\b(tool|search|look up|weather|email|inbox|calendar|web)\b/.test(normalized) && availableToolsCount > 0) {
        scores.tool += 0.55;
    }
    if (specialistCue) {
        scores.delegate += 0.35;
        scores.workflow += 0.25;
        scores.respond -= 0.15;
    }
    if (/\b(that|it|again)\b/.test(normalized)) {
        scores.clarify += 0.35;
    }
    if (policyFlags?.highRisk === true) {
        scores.workflow += 0.2;
        scores.delegate += 0.15;
        scores.respond -= 0.15;
    }
    for (const key of Object.keys(scores)) {
        scores[key] = Math.max(0, Math.min(1, scores[key]));
    }
    return scores;
}

/**
 * @param {Record<string, unknown>|null} routerDecision
 * @returns {{ scores: Record<string, number>, decision: string|null, confidence: number }}
 */
function deriveLlmRoutingScores(routerDecision) {
    const scores = {
        respond: 0,
        delegate: 0,
        tool: 0,
        workflow: 0,
        clarify: 0,
    };
    if (!routerDecision) {
        return { scores, decision: null, confidence: 0 };
    }
    const confidence = Number.isFinite(routerDecision.confidence) ? Number(routerDecision.confidence) : 0;
    for (const decision of ROUTING_DECISIONS) {
        scores[decision] = 0.05;
    }
    const decision = typeof routerDecision.decision === "string" ? routerDecision.decision : null;
    if (decision && Object.prototype.hasOwnProperty.call(scores, decision)) {
        scores[decision] = Math.max(scores[decision], Math.max(0, Math.min(1, confidence)));
    }
    const llmScores = routerDecision?.scores;
    if (llmScores && typeof llmScores === "object") {
        for (const decision of ROUTING_DECISIONS) {
            const raw = Number(llmScores?.[decision]);
            if (Number.isFinite(raw)) {
                scores[decision] = Math.max(scores[decision], Math.max(0, Math.min(1, raw)));
            }
        }
    }
    return { scores, decision, confidence: Math.max(0, Math.min(1, confidence)) };
}

/**
 * @param {{ riskClass: "low"|"medium"|"high"|"destructive", hasRouterDecision: boolean }} input
 * @returns {{ heuristicWeight: number, llmWeight: number }}
 */
function deriveRoutingWeights(input) {
    if (!input.hasRouterDecision) {
        return { heuristicWeight: 1, llmWeight: 0 };
    }
    if (input.riskClass === "destructive") {
        return { heuristicWeight: 1, llmWeight: 0 };
    }
    if (input.riskClass === "high") {
        return { heuristicWeight: 0.65, llmWeight: 0.35 };
    }
    if (input.riskClass === "medium") {
        return { heuristicWeight: 0.5, llmWeight: 0.5 };
    }
    return { heuristicWeight: 0.4, llmWeight: 0.6 };
}

/**
 * @param {{ agentId: string, text: string, focusSnippet?: string, forwardSkills?: readonly string[] }} input
 * @returns {string}
 */
function buildForcedDelegationActionText(input) {
    const baseInstruction = String(input.text || "").trim();
    const focusSnippet = typeof input.focusSnippet === "string" ? input.focusSnippet.trim() : "";
    const taskInstructions = focusSnippet && focusSnippet.length > 0 && !baseInstruction.toLowerCase().includes(focusSnippet.toLowerCase())
        ? `${baseInstruction}\n\nFocus anchor: ${focusSnippet}`
        : baseInstruction;
    const proposal = {
        template: "delegate_to_agent",
        args: {
            agentId: input.agentId,
            task_instructions: taskInstructions || "Please handle this user request.",
            forward_skills: Array.isArray(input.forwardSkills) ? [...input.forwardSkills] : [],
        },
    };
    return `Delegating this to ${input.agentId}.\n<polar_action>\n${JSON.stringify(proposal, null, 2)}\n</polar_action>`;
}

const CAPABILITY_TO_TEMPLATE_ID = Object.freeze({
    lookup_weather: "lookup_weather",
    search_web: "search_web",
    draft_email: "draft_email",
    send_email: "send_email",
    delegate_to_agent: "delegate_to_agent",
});

/**
 * @param {string} text
 * @returns {string|null}
 */
function inferWeatherLocation(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return null;
    const inMatch = normalized.match(/\b(?:in|for|at)\s+([A-Za-z][A-Za-z\s,'-]{1,80})$/i);
    if (inMatch && typeof inMatch[1] === "string" && inMatch[1].trim().length >= 2) {
        return inMatch[1].trim();
    }
    const weatherMatch = normalized.match(/\bweather\s+([A-Za-z][A-Za-z\s,'-]{1,80})$/i);
    if (weatherMatch && typeof weatherMatch[1] === "string" && weatherMatch[1].trim().length >= 2) {
        return weatherMatch[1].trim();
    }
    return null;
}

/**
 * @param {string} text
 * @returns {string|null}
 */
function inferSearchQuery(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return null;
    const explicit = normalized.match(/\b(?:search(?:\s+the\s+web)?\s+(?:for\s+)?)\s+(.+)$/i)
        || normalized.match(/\blook\s+up\s+(.+)$/i)
        || normalized.match(/\bfind\s+(.+)$/i);
    if (explicit && typeof explicit[1] === "string" && explicit[1].trim().length > 0) {
        return explicit[1].trim();
    }
    return normalized.length > 0 ? normalized : null;
}

/**
 * @param {string} text
 * @returns {{ to: string, subject: string, body: string }|null}
 */
function inferEmailArgs(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return null;
    const explicit =
        normalized.match(/\b(?:send|draft|write)\s+(?:an?\s+)?email\s+to\s+([^\s,]+)\s+(?:about|re)\s+(.+)$/i) ||
        normalized.match(/\bemail\s+([^\s,]+)\s+(?:about|re)\s+(.+)$/i);
    if (!explicit || typeof explicit[1] !== "string" || typeof explicit[2] !== "string") {
        return null;
    }
    const to = explicit[1].trim();
    const topic = explicit[2].trim();
    if (!to || !topic) {
        return null;
    }
    const subject = topic.length > 120 ? topic.slice(0, 120) : topic;
    return {
        to,
        subject,
        body: `Hi,\n\n${topic}\n\nBest,`,
    };
}

/**
 * @param {string|undefined} templateId
 * @param {Record<string, unknown>|undefined} targetArgs
 * @param {string} text
 * @returns {Record<string, unknown>|null}
 */
function deriveTemplateArgs(templateId, targetArgs, text) {
    if (!templateId || typeof templateId !== "string") {
        return null;
    }
    const args = typeof targetArgs === "object" && targetArgs !== null ? { ...targetArgs } : {};
    if (templateId === "lookup_weather") {
        const location = typeof args.location === "string" && args.location.trim().length > 0
            ? args.location.trim()
            : inferWeatherLocation(text);
        return location ? { location } : null;
    }
    if (templateId === "search_web") {
        const query = typeof args.query === "string" && args.query.trim().length > 0
            ? args.query.trim()
            : inferSearchQuery(text);
        return query ? { query } : null;
    }
    if (templateId === "draft_email" || templateId === "send_email") {
        const inferred = inferEmailArgs(text);
        const to = typeof args.to === "string" ? args.to.trim() : (inferred?.to || "");
        const subject = typeof args.subject === "string" ? args.subject.trim() : (inferred?.subject || "");
        const body = typeof args.body === "string" ? args.body.trim() : (inferred?.body || "");
        if (!to || !subject || !body) {
            return null;
        }
        return { to, subject, body };
    }
    if (templateId === "delegate_to_agent") {
        const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
        const taskInstructions = typeof args.task_instructions === "string" ? args.task_instructions.trim() : "";
        if (!agentId || !taskInstructions) {
            return null;
        }
        return {
            agentId,
            task_instructions: taskInstructions,
            forward_skills: Array.isArray(args.forward_skills) ? args.forward_skills : [],
            ...(typeof args.model_override === "string" && args.model_override.trim().length > 0
                ? { model_override: args.model_override.trim() }
                : {}),
        };
    }
    return null;
}

/**
 * @param {{ templateId: string, args: Record<string, unknown>, intro: string }} input
 * @returns {string}
 */
function buildForcedTemplateActionText(input) {
    const proposal = {
        template: input.templateId,
        args: input.args,
    };
    return `${input.intro}\n<polar_action>\n${JSON.stringify(proposal, null, 2)}\n</polar_action>`;
}

/**
 * @param {{ text: string, finalRoutingDecision: string, routerDecision: Record<string, unknown>|null, selectedDelegateAgentId: string|null, classification: Record<string, unknown>|null, profileAllowedSkills: readonly string[] }} input
 * @returns {{ kind: "action", text: string }|{ kind: "clarify", question: string }|null}
 */
function resolveAuthoritativeRoutingOutput(input) {
    const { text, finalRoutingDecision, routerDecision, selectedDelegateAgentId, classification, profileAllowedSkills } = input;
    if (finalRoutingDecision === "delegate" && selectedDelegateAgentId) {
        return {
            kind: "action",
            text: buildForcedDelegationActionText({
                agentId: selectedDelegateAgentId,
                text: String(text || ""),
                focusSnippet: classification?.focusContext?.focusAnchorTextSnippet,
                forwardSkills: profileAllowedSkills,
            }),
        };
    }
    if (finalRoutingDecision === "tool" || finalRoutingDecision === "workflow") {
        const target = (routerDecision?.target && typeof routerDecision.target === "object")
            ? routerDecision.target
            : {};
        let templateId =
            typeof target.templateId === "string" && target.templateId.length > 0
                ? target.templateId
                : null;
        if (!templateId && finalRoutingDecision === "tool" && typeof target.capabilityId === "string") {
            templateId = CAPABILITY_TO_TEMPLATE_ID[target.capabilityId] || null;
        }
        if (!templateId && finalRoutingDecision === "workflow") {
            const normalized = String(text || "").toLowerCase();
            if (/\b(weather)\b/.test(normalized)) templateId = "lookup_weather";
            else if (/\b(search|look up|find)\b/.test(normalized)) templateId = "search_web";
            else if (/\b(draft email|compose email)\b/.test(normalized)) templateId = "draft_email";
            else if (/\b(send email)\b/.test(normalized)) templateId = "send_email";
        }
        if (!templateId) {
            return {
                kind: "clarify",
                question: "Quick check: which workflow should I run (weather lookup, web search, or email draft)?",
            };
        }
        const targetArgs =
            typeof target.args === "object" && target.args !== null
                ? target.args
                : {};
        const args = deriveTemplateArgs(templateId, targetArgs, text);
        if (!args) {
            if (templateId === "lookup_weather") {
                return { kind: "clarify", question: "Which location should I use for the weather lookup?" };
            }
            if (templateId === "draft_email" || templateId === "send_email") {
                return { kind: "clarify", question: "Please provide recipient, subject, and body for the email." };
            }
            return { kind: "clarify", question: "Please provide the missing details so I can run that workflow." };
        }
        try {
            expandTemplate(templateId, args);
        } catch {
            return { kind: "clarify", question: "I need a bit more detail before I can run that workflow safely." };
        }
        const intro = finalRoutingDecision === "tool"
            ? `Running ${templateId} now.`
            : `Starting workflow: ${templateId}.`;
        return {
            kind: "action",
            text: buildForcedTemplateActionText({ templateId, args, intro }),
        };
    }
    return null;
}

/**
 * @param {{ text: string, laneThreadKey: string, laneMessages: Record<string, unknown>[], sessionState: Record<string, unknown>, nowMs: number }} input
 * @returns {{ summary: string, windowStartMs: number, windowEndMs: number, focusCandidates: readonly string[], unresolved: readonly string[], riskHints: Record<string, boolean>, activeDelegation: Record<string, unknown>|null }}
 */
function buildTemporalAttentionRecord(input) {
    const { text, laneThreadKey, laneMessages, sessionState, nowMs } = input;
    const windowStartMs = nowMs - TEMPORAL_ATTENTION_WINDOW_MS;
    const windowEndMs = nowMs;
    const recentLaneMessages = laneMessages
        .filter((entry) => typeof entry?.timestampMs === "number" ? entry.timestampMs >= windowStartMs : true)
        .slice(-TEMPORAL_ATTENTION_RECENT_ACTION_LIMIT);
    const recentActions = recentLaneMessages
        .filter((entry) => typeof entry?.text === "string" && entry.text.trim().length > 0)
        .map((entry) => `${entry.role || "unknown"}: ${redactSecrets(String(entry.text)).slice(0, 120)}`);
    const laneThreads = Array.isArray(sessionState?.threads)
        ? sessionState.threads.filter((thread) => thread?.laneThreadKey === laneThreadKey)
        : [];
    const unresolved = laneThreads
        .filter((thread) => thread?.pendingQuestion || thread?.awaitingApproval || thread?.inFlight || thread?.openOffer)
        .sort((left, right) => (right?.lastActivityTs || 0) - (left?.lastActivityTs || 0))
        .slice(0, 4)
        .map((thread) => {
            if (thread?.pendingQuestion?.text) return `pending_question: ${thread.pendingQuestion.text}`;
            if (thread?.awaitingApproval?.workflowId) return `workflow_waiting: ${thread.awaitingApproval.workflowId}`;
            if (thread?.inFlight?.workflowId) return `workflow_cancellable: ${thread.inFlight.workflowId}`;
            if (thread?.openOffer?.target) return `delegation_candidate: ${thread.openOffer.target}`;
            return `thread: ${thread?.id || "unknown"}`;
        });
    const focusCandidates = laneThreads
        .sort((left, right) => (right?.lastActivityTs || 0) - (left?.lastActivityTs || 0))
        .slice(0, 3)
        .map((thread) => thread?.summary || thread?.pendingQuestion?.text || thread?.openOffer?.target || thread?.id)
        .filter((entry) => typeof entry === "string" && entry.length > 0);
    let activeDelegation = null;
    for (const entry of [...recentLaneMessages].reverse()) {
        const messageText = typeof entry?.text === "string" ? entry.text : "";
        if (!messageText) {
            continue;
        }
        if (messageText.startsWith("[DELEGATION CLEARED]")) {
            break;
        }
        if (messageText.startsWith("[DELEGATION ACTIVE]")) {
            try {
                const parsed = parseJsonWithSchema(
                    messageText.replace("[DELEGATION ACTIVE]", "").trim(),
                    delegationStateSchema,
                );
                activeDelegation = {
                    agentId: parsed.agentId,
                    task_instructions: parsed.task_instructions,
                };
            } catch {
                activeDelegation = null;
            }
            break;
        }
    }
    const riskHints = Object.freeze({
        hasPendingApproval: laneThreads.some((thread) => Boolean(thread?.awaitingApproval?.workflowId)),
        hasInFlightWorkflow: laneThreads.some((thread) => Boolean(thread?.inFlight?.workflowId)),
        mayRequireWriteApproval: laneThreads.some(
            (thread) => Boolean(thread?.awaitingApproval?.workflowId) || Boolean(thread?.openOffer?.target),
        ),
    });
    const summary = [
        `windowStartMs=${windowStartMs}`,
        `windowEndMs=${windowEndMs}`,
        `laneThreadKey=${laneThreadKey}`,
        `query=${redactSecrets(String(text || "")).slice(0, 120)}`,
        `activeDelegation=${activeDelegation?.agentId || "none"}`,
        "focusCandidates:",
        ...(focusCandidates.length > 0 ? focusCandidates.map((entry) => `- ${entry}`) : ["- (none)"]),
        "unresolved:",
        ...(unresolved.length > 0 ? unresolved.map((entry) => `- ${entry}`) : ["- (none)"]),
        "riskHints:",
        `- hasPendingApproval=${riskHints.hasPendingApproval}`,
        `- hasInFlightWorkflow=${riskHints.hasInFlightWorkflow}`,
        `- mayRequireWriteApproval=${riskHints.mayRequireWriteApproval}`,
        "recentActions:",
        ...(recentActions.length > 0 ? recentActions.map((entry) => `- ${entry}`) : ["- (none)"]),
    ].join("\n");

    return Object.freeze({
        summary,
        windowStartMs,
        windowEndMs,
        focusCandidates: Object.freeze(focusCandidates),
        unresolved: Object.freeze(unresolved),
        riskHints,
        activeDelegation,
    });
}

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
        return {
            version: 1,
            agents: Object.freeze([{
                agentId: DEFAULT_GENERIC_AGENT_ID,
                profileId: DEFAULT_GENERIC_PROFILE_ID,
                description: "General-purpose fallback sub-agent for delegated tasks.",
                tags: ["general", "fallback"],
            }]),
        };
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
    if (!seen.has(DEFAULT_GENERIC_AGENT_ID)) {
        agents.push({
            agentId: DEFAULT_GENERIC_AGENT_ID,
            profileId: DEFAULT_GENERIC_PROFILE_ID,
            description: "General-purpose fallback sub-agent for delegated tasks.",
            tags: ["general", "fallback"],
        });
    }
    return {
        version: 1,
        agents: Object.freeze(agents),
    };
}

function deriveDelegationApprovalPolicy(text = "") {
    const normalized = text.toLowerCase();
    const readIntent = /\b(read|summari[sz]e|review|inspect|analy[sz]e|compare|research)\b/.test(normalized);
    const writeIntent = /\b(write|draft|create|compose|send|edit|update|delete|remove)\b/.test(normalized);
    const destructiveIntent = /\b(delete|remove|destroy|wipe|drop)\b/.test(normalized);
    const complexIntent = /\b(plan|workflow|step by step|multi-step|10 versions|10 different versions)\b/.test(normalized);
    if (destructiveIntent || writeIntent || complexIntent) {
        return { requiresApproval: true, reason: "write_or_complex_or_destructive" };
    }
    if (readIntent) {
        return { requiresApproval: false, reason: "read_only" };
    }
    return { requiresApproval: true, reason: "default_safe" };
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
const SESSION_COMPACTION_MESSAGE_THRESHOLD = 30;
const SESSION_COMPACTION_TOKEN_THRESHOLD = 3000;
const SESSION_UNSUMMARIZED_TAIL_COUNT = 20;
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

function buildSessionSummaryRecord(sessionMessages) {
    const olderMessages = sessionMessages.slice(0, Math.max(0, sessionMessages.length - SESSION_UNSUMMARIZED_TAIL_COUNT));
    const latestMessages = sessionMessages.slice(-SESSION_UNSUMMARIZED_TAIL_COUNT);
    const userPoints = olderMessages
        .filter((item) => item.role === "user")
        .slice(-10)
        .map((item) => `- ${redactSecrets(item.text).slice(0, 220)}`);
    const assistantPoints = olderMessages
        .filter((item) => item.role === "assistant")
        .slice(-10)
        .map((item) => `- ${redactSecrets(item.text).slice(0, 220)}`);

    const summary = [
        "Session goals / open requests:",
        ...(userPoints.length > 0 ? userPoints : ["- (none captured)"]),
        "Session outcomes / decisions:",
        ...(assistantPoints.length > 0 ? assistantPoints : ["- (none captured)"]),
        "Continuity notes:",
        "- Preserve active lane constraints and unresolved asks.",
        "Pending follow-up:",
        "- Continue from recent unsummarized messages when user resumes.",
    ].join("\n");

    return {
        summary,
        unsummarizedTail: latestMessages,
        summarizedCount: olderMessages.length,
    };
}

function buildReplyContextBlock(replyToMetadata) {
    if (!replyToMetadata || typeof replyToMetadata !== "object") {
        return null;
    }
    const snippet = typeof replyToMetadata.snippet === "string" ? redactSecrets(replyToMetadata.snippet).trim() : "";
    if (snippet.length === 0) {
        return null;
    }
    const role = replyToMetadata?.from?.role === "assistant" ? "assistant" : "user";
    const displayName = typeof replyToMetadata?.from?.displayName === "string" && replyToMetadata.from.displayName.length > 0
        ? ` (${replyToMetadata.from.displayName})`
        : "";
    return [
        "[REPLY_CONTEXT]",
        "Reply context:",
        `- User replied to (${role}${displayName}): \"${snippet}\"`,
        "[/REPLY_CONTEXT]",
    ].join("\n");
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
    const IN_FLIGHT_WORKFLOWS = new Map();
    const WORKFLOW_CANCEL_REQUESTS = new Map();
    const WORKFLOW_TTL_MS = 30 * 60 * 1000;
    const WORKFLOW_MAX_SIZE = 100;
    const PENDING_AUTOMATION_PROPOSALS = new Map();
    const AUTOMATION_PROPOSAL_TTL_MS = 30 * 60 * 1000;

    const SESSION_THREADS = new Map();
    const THREAD_TTL_MS = 60 * 60 * 1000;
    const PENDING_REPAIRS = new Map();
    const REPAIR_TTL_MS = 5 * 60 * 1000;
    const PENDING_ROUTING_STATES = new Map();
    const ROUTING_STATE_TTL_MS = 10 * 60 * 1000;
    const cleanupInterval = setInterval(() => {
        const currentTime = now();
        for (const [id, entry] of PENDING_WORKFLOWS) {
            if (currentTime - entry.createdAt > WORKFLOW_TTL_MS) {
                PENDING_WORKFLOWS.delete(id);
            }
        }
        for (const [id, entry] of WORKFLOW_CANCEL_REQUESTS) {
            if (currentTime - entry.requestedAt > WORKFLOW_TTL_MS) {
                WORKFLOW_CANCEL_REQUESTS.delete(id);
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
        for (const [id, entry] of PENDING_ROUTING_STATES) {
            if (currentTime > (entry.expiresAtMs || 0)) {
                PENDING_ROUTING_STATES.delete(id);
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

    const DURABLE_STATE_SESSION_ID = "__polar_runtime_state__";
    const DURABLE_STATE_USER_ID = "__polar_runtime_state__";
    const THREAD_STATE_VERSION = 1;

    function buildSessionThreadStateMemoryId(sessionId) {
        return `thread_state:session:${sessionId}`;
    }

    function buildRoutingThreadStateMemoryId(sessionId, laneThreadKey) {
        return `thread_state:routing:${sessionId}:${encodeURIComponent(laneThreadKey)}`;
    }

    function buildWorkflowThreadStateMemoryId(workflowId) {
        return `thread_state:workflow:${workflowId}`;
    }

    function normalizeSessionStateValue(value) {
        const fallback = { threads: [], activeThreadId: null };
        if (typeof value !== "object" || value === null) {
            return fallback;
        }
        const threads = Array.isArray(value.threads) ? value.threads : [];
        const activeThreadId =
            typeof value.activeThreadId === "string" && value.activeThreadId.length > 0
                ? value.activeThreadId
                : null;
        return {
            threads,
            activeThreadId,
        };
    }

    async function readThreadStateRecord(memoryId) {
        if (!memoryGateway || typeof memoryGateway.get !== "function") {
            return null;
        }
        try {
            const response = await memoryGateway.get({
                executionType: "handoff",
                sessionId: DURABLE_STATE_SESSION_ID,
                userId: DURABLE_STATE_USER_ID,
                scope: "session",
                memoryId,
            });
            if (response?.status === "completed" && response.record && typeof response.record === "object") {
                return response.record;
            }
        } catch {
            // non-fatal durable state read failure
        }
        return null;
    }

    async function writeThreadStateRecord(memoryId, record, metadata = {}) {
        if (!memoryGateway || typeof memoryGateway.upsert !== "function") {
            return;
        }
        try {
            await memoryGateway.upsert({
                executionType: "handoff",
                sessionId: DURABLE_STATE_SESSION_ID,
                userId: DURABLE_STATE_USER_ID,
                scope: "session",
                memoryId,
                record,
                metadata: {
                    stateVersion: THREAD_STATE_VERSION,
                    updatedAtMs: now(),
                    ...metadata,
                },
            });
        } catch {
            // non-fatal durable state write failure
        }
    }

    async function hydrateSessionThreadsState(sessionId) {
        if (SESSION_THREADS.has(sessionId)) {
            return;
        }
        const record = await readThreadStateRecord(buildSessionThreadStateMemoryId(sessionId));
        if (!record || record.type !== "thread_state" || record.stateKind !== "session_threads") {
            return;
        }
        const restored = normalizeSessionStateValue(record.state);
        SESSION_THREADS.set(sessionId, restored);
    }

    async function persistSessionThreadsState(sessionId) {
        const sessionState = normalizeSessionStateValue(SESSION_THREADS.get(sessionId));
        await writeThreadStateRecord(
            buildSessionThreadStateMemoryId(sessionId),
            {
                type: "thread_state",
                stateKind: "session_threads",
                sessionId,
                state: toJsonSafeValue(sessionState),
            },
            { sessionId },
        );
    }

    async function hydrateRoutingState(sessionId, laneThreadKey) {
        const routingStateKey = buildRoutingStateKey(sessionId, laneThreadKey);
        const current = PENDING_ROUTING_STATES.get(routingStateKey);
        if (current && now() <= (current.expiresAtMs || 0)) {
            return;
        }
        const record = await readThreadStateRecord(buildRoutingThreadStateMemoryId(sessionId, laneThreadKey));
        if (!record || record.type !== "thread_state" || record.stateKind !== "routing_pending") {
            return;
        }
        const pendingState =
            typeof record.pendingState === "object" && record.pendingState !== null
                ? record.pendingState
                : null;
        if (!pendingState || now() > (pendingState.expiresAtMs || 0)) {
            return;
        }
        PENDING_ROUTING_STATES.set(routingStateKey, Object.freeze(pendingState));
    }

    async function persistRoutingState(sessionId, laneThreadKey, pendingState) {
        const routingStateKey = buildRoutingStateKey(sessionId, laneThreadKey);
        if (pendingState && typeof pendingState === "object") {
            PENDING_ROUTING_STATES.set(routingStateKey, Object.freeze(pendingState));
        } else {
            PENDING_ROUTING_STATES.delete(routingStateKey);
        }
        await writeThreadStateRecord(
            buildRoutingThreadStateMemoryId(sessionId, laneThreadKey),
            {
                type: "thread_state",
                stateKind: "routing_pending",
                sessionId,
                laneThreadKey,
                pendingState: pendingState ? toJsonSafeValue(pendingState) : null,
                expiresAtMs: pendingState?.expiresAtMs || now(),
            },
            { sessionId, threadKey: laneThreadKey, expiresAtMs: pendingState?.expiresAtMs || now() },
        );
    }

    async function hydratePendingWorkflow(workflowId) {
        if (PENDING_WORKFLOWS.has(workflowId)) {
            return;
        }
        const record = await readThreadStateRecord(buildWorkflowThreadStateMemoryId(workflowId));
        if (!record || record.type !== "thread_state" || record.stateKind !== "pending_workflow") {
            return;
        }
        const entry = record.entry;
        if (!entry || typeof entry !== "object") {
            return;
        }
        if (now() - (entry.createdAt || 0) > WORKFLOW_TTL_MS) {
            return;
        }
        PENDING_WORKFLOWS.set(workflowId, entry);
    }

    async function persistPendingWorkflow(workflowId, entry) {
        await writeThreadStateRecord(
            buildWorkflowThreadStateMemoryId(workflowId),
            {
                type: "thread_state",
                stateKind: "pending_workflow",
                workflowId,
                entry: toJsonSafeValue(entry),
            },
            {
                sessionId: entry?.polarSessionId || "unknown",
                threadKey: entry?.laneThreadKey || "unknown",
                workflowId,
                expiresAtMs: (entry?.createdAt || now()) + WORKFLOW_TTL_MS,
            },
        );
    }

    async function clearPendingWorkflow(workflowId) {
        await writeThreadStateRecord(
            buildWorkflowThreadStateMemoryId(workflowId),
            {
                type: "thread_state",
                stateKind: "pending_workflow",
                workflowId,
                entry: null,
                clearedAtMs: now(),
            },
            { workflowId, expiresAtMs: now() },
        );
    }

    function buildRoutingStateKey(sessionId, laneThreadKey) {
        return `${sessionId}::${laneThreadKey}`;
    }

    /**
     * @param {{ text: string }} input
     * @returns {"delegate"|"respond"|null}
     */
    function parseRoutingSelectionIntent(input) {
        const normalized = String(input.text || "").toLowerCase().trim();
        if (!normalized) return null;
        if (/^(a|option a)$/.test(normalized)) return "respond";
        if (/^(b|option b)$/.test(normalized)) return "delegate";
        if (/\b(delegate|sub-agent|sub agent)\b/.test(normalized)) return "delegate";
        if (/\b(continue|inline|here|this one|current)\b/.test(normalized)) return "respond";
        if (/^(yes|yep|yeah|sure|ok|okay|do it)$/.test(normalized)) return "respond";
        return null;
    }

    function clearTerminalPendingState(sessionId, threadId) {
        const state = SESSION_THREADS.get(sessionId);
        if (!state || !threadId) {
            return;
        }
        const thread = state.threads.find((candidate) => candidate.id === threadId);
        if (!thread) {
            return;
        }
        delete thread.pendingQuestion;
        delete thread.openOffer;
        if (Array.isArray(thread.recentOffers)) {
            thread.recentOffers = thread.recentOffers.map((offer) =>
                offer?.outcome === 'pending'
                    ? { ...offer, outcome: 'rejected' }
                    : offer
            );
        }
        thread.lastActivityTs = now();
    }

    /**
     * Compute risk summary for a list of workflow steps.
     */
    function evaluateWorkflowRisk(steps) {
        let maxRisk = 'read';
        let maxEffects = 'none';
        let maxEgress = 'none';
        let hasDelegation = false;
        let delegationRequiresApproval = false;
        const requirements = [];

        for (const step of steps) {
            if (step.capabilityId === 'delegate_to_agent') {
                hasDelegation = true;
                const policy = deriveDelegationApprovalPolicy(String(step.args?.task_instructions || ''));
                if (policy.requiresApproval) {
                    delegationRequiresApproval = true;
                    requirements.push({ capabilityId: 'delegate_to_agent', extensionId: 'system', riskLevel: 'write', sideEffects: 'internal' });
                }
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
            delegationRequiresApproval,
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
            const laneThreadKey = deriveLaneThreadKey(polarSessionId, inboundThreadKey, inboundThreadId);

            await hydrateSessionThreadsState(polarSessionId);
            await hydrateRoutingState(polarSessionId, laneThreadKey);
            let sessionState = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
            let routingRecommendation = null;
            let classification = null;
            let currentTurnAnchor = null;
            let currentAnchorMessageId = null;
            let forcedRoutingDecision = null;
            let forcedRoutingTargetAgentId = null;
            const routingStateKey = buildRoutingStateKey(polarSessionId, laneThreadKey);
            const pendingRoutingState = PENDING_ROUTING_STATES.get(routingStateKey);
            if (pendingRoutingState && now() <= (pendingRoutingState.expiresAtMs || 0) && text) {
                let selectionIntent = parseRoutingSelectionIntent({ text });
                if (
                    selectionIntent === "respond" &&
                    pendingRoutingState.type === "delegation_candidate" &&
                    /^(yes|yep|yeah|sure|ok|okay|do it)$/i.test(String(text || "").trim())
                ) {
                    selectionIntent = "delegate";
                }
                if (selectionIntent) {
                    forcedRoutingDecision = selectionIntent;
                    if (
                        selectionIntent === "delegate" &&
                        typeof pendingRoutingState.targetAgentId === "string" &&
                        pendingRoutingState.targetAgentId.length > 0
                    ) {
                        forcedRoutingTargetAgentId = pendingRoutingState.targetAgentId;
                    }
                    await persistRoutingState(polarSessionId, laneThreadKey, null);
                    await emitLineageEvent({
                        eventType: "routing.pending_state.consumed",
                        sessionId: polarSessionId,
                        userId,
                        laneThreadKey,
                        stateType: pendingRoutingState.type,
                        selectionIntent,
                        createdAtMs: pendingRoutingState.createdAtMs,
                        timestampMs: now(),
                    });
                }
            } else if (pendingRoutingState) {
                await persistRoutingState(polarSessionId, laneThreadKey, null);
            }
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
                classification = classifyUserMessage({
                    text,
                    sessionState,
                    replyToMessageId: metadata?.replyToMessageId,
                    laneThreadKey: inboundThreadKey,
                });
                sessionState = applyUserTurn({
                    sessionState,
                    classification,
                    rawText: text,
                    now,
                    laneThreadKey,
                });
                SESSION_THREADS.set(polarSessionId, sessionState);
                await persistSessionThreadsState(polarSessionId);

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

                const focusAnchorSnippet = typeof classification.focusContext?.focusAnchorTextSnippet === "string"
                    ? classification.focusContext.focusAnchorTextSnippet.slice(0, 180)
                    : "";
                if (focusAnchorSnippet || classification.focusContext?.focusAnchorInternalId || classification.focusContext?.focusAnchorChannelId) {
                    const focusHints = [
                        `focusAnchorInternalId=${classification.focusContext?.focusAnchorInternalId || "none"}`,
                        `focusAnchorChannelId=${classification.focusContext?.focusAnchorChannelId || "none"}`,
                    ];
                    if (focusAnchorSnippet) {
                        focusHints.push(`focusAnchorSnippet=${JSON.stringify(focusAnchorSnippet)}`);
                    }
                    routingRecommendation = `${routingRecommendation ? `${routingRecommendation}\n` : ""}[FOCUS_HINT] ${focusHints.join(" ")}`;
                }
            }

            const agentRegistry = await loadAgentRegistry();
            const installedAgentIds = new Set(agentRegistry.agents.map((agent) => agent.agentId));
            const installedToolPairs = (extensionGateway.listStates() || [])
                .filter((state) => !state?.lifecycleState || state.lifecycleState === "installed")
                .flatMap((state) => (state?.capabilities || []).map((capability) => ({
                    extensionId: state.extensionId,
                    capabilityId: capability.capabilityId,
                })));

            const lowerText = String(text || "").toLowerCase();
            const specialistDelegationCue = hasSpecialistDelegationCue(lowerText);
            const stageADelegationSignal = /\b(do that via sub-agent|via sub-agent|delegate this|delegate to)\b/.test(lowerText)
                || /\bwrite\s+10\b/.test(lowerText)
                || /\b10\s+(versions|version|variants|variant)\b/.test(lowerText)
                || specialistDelegationCue;
            const riskClass = classifyRoutingRisk(text);
            const hasDelegateCue = stageADelegationSignal || /\b(sub-agent|sub agent|delegate)\b/.test(lowerText);
            const hasWorkflowCue = /\b(workflow|plan|step by step|multi-step|research and compare|deep dive|proposal)\b/.test(lowerText);
            const hasToolCue = /\b(tool|search|look up|weather|email|inbox|calendar|web)\b/.test(lowerText) && installedToolPairs.length > 0;
            const hasAmbiguousReferenceText = /\b(that|it|again)\b/.test(lowerText);
            const lowRiskUnambiguousInline = riskClass === "low" && !hasRoutingCue(lowerText);

            const shouldRunRouter =
                classification?.type === "new_request" &&
                !lowRiskUnambiguousInline &&
                (hasDelegateCue || hasWorkflowCue || hasToolCue || hasAmbiguousReferenceText);
            const temporalAttentionHint = buildTemporalAttentionRecord({
                text,
                laneThreadKey,
                laneMessages: [],
                sessionState,
                nowMs: now(),
            });

            let routerDecision = null;
            if (shouldRunRouter) {
                try {
                    const routerResponse = await providerGateway.generate({
                        executionType: "handoff",
                        providerId,
                        model,
                        system: "You are a routing model. Output strict JSON only.",
                        prompt:
                            `Route this message using JSON schema only: ${JSON.stringify({
                                text,
                                focusContext: classification.focusContext || null,
                                temporalAttention: {
                                    summary: temporalAttentionHint.summary,
                                    unresolved: temporalAttentionHint.unresolved,
                                    focusCandidates: temporalAttentionHint.focusCandidates,
                                    riskHints: temporalAttentionHint.riskHints,
                                    activeDelegation: temporalAttentionHint.activeDelegation,
                                },
                                availableAgents: [...installedAgentIds],
                                availableTools: installedToolPairs,
                                confidenceThreshold: ROUTER_CONFIDENCE_THRESHOLD,
                            })}`,
                    });
                    const parsed = parseJsonWithSchema(routerResponse?.text || "{}", routerDecisionSchema);
                    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence);
                    if (Number.isFinite(confidence)) {
                        routerDecision = { ...parsed, confidence };
                    }
                } catch {
                    routerDecision = null;
                }
            }

            if (routerDecision?.decision === "delegate") {
                const requestedAgentId = routerDecision?.target?.agentId;
                if (!installedAgentIds.has(requestedAgentId)) {
                    routerDecision.target = { agentId: DEFAULT_GENERIC_AGENT_ID };
                }
            }
            if (routerDecision?.decision === "tool") {
                const extensionId = routerDecision?.target?.extensionId;
                const capabilityId = routerDecision?.target?.capabilityId;
                const installed = installedToolPairs.some(
                    (entry) => entry.extensionId === extensionId && entry.capabilityId === capabilityId,
                );
                if (!installed) {
                    routerDecision = {
                        decision: "clarify",
                        confidence: 1,
                        rationale: "Requested tool is not installed.",
                    };
                }
            }

            const policyFlags = Object.freeze({
                highRisk: riskClass === "high" || riskClass === "destructive",
                requiresApproval: riskClass !== "low",
                missingCapability: installedToolPairs.length === 0,
                pendingMatch: classification?.type === "answer_to_pending",
            });
            const heuristicScores = deriveHeuristicRoutingScores({
                text,
                classification,
                stageADelegationSignal,
                availableToolsCount: installedToolPairs.length,
                policyFlags,
            });
            const llmRouting = deriveLlmRoutingScores(routerDecision);
            const weights = deriveRoutingWeights({ riskClass, hasRouterDecision: Boolean(routerDecision) });
            const fusedScores = {};
            for (const decision of ROUTING_DECISIONS) {
                fusedScores[decision] =
                    heuristicScores[decision] * weights.heuristicWeight +
                    llmRouting.scores[decision] * weights.llmWeight;
            }
            const heuristicTop = extractTopDecision(heuristicScores);
            const fusedTop = extractTopDecision(fusedScores);
            let finalRoutingDecision = forcedRoutingDecision || fusedTop.topDecision;
            const hasValidRouterDecision = Boolean(routerDecision && llmRouting.decision);
            const shouldClarifyByConflict =
                hasValidRouterDecision &&
                (
                    fusedTop.margin < ROUTER_DECISION_MARGIN_THRESHOLD ||
                    (llmRouting.decision && heuristicTop.topDecision !== llmRouting.decision && policyFlags.highRisk)
                );
            if (!forcedRoutingDecision && shouldClarifyByConflict) {
                finalRoutingDecision = "clarify";
            }
            if (
                !forcedRoutingDecision &&
                hasValidRouterDecision &&
                Number.isFinite(routerDecision.confidence) &&
                routerDecision.confidence < ROUTER_CONFIDENCE_THRESHOLD
            ) {
                finalRoutingDecision = "clarify";
            }
            if (!forcedRoutingDecision && !hasValidRouterDecision && hasAmbiguousReferenceText && classification?.type === "new_request") {
                finalRoutingDecision = "clarify";
            }
            const routerAffirmedDecision = hasValidRouterDecision && llmRouting.decision === finalRoutingDecision;

            await emitLineageEvent({
                eventType: "routing.arbitration",
                sessionId: polarSessionId,
                userId,
                laneThreadKey,
                riskClass,
                heuristicDecision: heuristicTop.topDecision,
                llmDecision: llmRouting.decision || "none",
                fusedDecision: finalRoutingDecision,
                heuristicScores,
                llmScores: llmRouting.scores,
                fusedScores,
                llmConfidence: llmRouting.confidence,
                decisionMargin: fusedTop.margin,
                forcedByPending: forcedRoutingDecision !== null,
                timestampMs: now(),
            });

            let forcedClarificationQuestion = null;
            if (finalRoutingDecision === "clarify") {
                const focusSnippet = classification.focusContext?.focusAnchorTextSnippet;
                const optionA = focusSnippet ? `Continue with "${focusSnippet.slice(0, 36)}"` : "Continue inline here";
                const optionB = "Delegate to a sub-agent";
                const clarificationQuestion = `Quick check: should I ${optionA} or ${optionB}?`;
                const assistantMessageId = `msg_a_${crypto.randomUUID()}`;
                const pendingTargetAgentId =
                    routerDecision?.decision === "delegate" &&
                        typeof routerDecision?.target?.agentId === "string" &&
                        routerDecision.target.agentId.length > 0
                        ? routerDecision.target.agentId
                        : undefined;
                await persistRoutingState(polarSessionId, laneThreadKey, Object.freeze({
                    type: "clarification_needed",
                    createdAtMs: now(),
                    expiresAtMs: now() + ROUTING_STATE_TTL_MS,
                    laneThreadKey,
                    options: Object.freeze([
                        Object.freeze({ id: "A", decision: "respond", label: optionA }),
                        Object.freeze({ id: "B", decision: "delegate", label: optionB }),
                    ]),
                    ...(pendingTargetAgentId ? { targetAgentId: pendingTargetAgentId } : {}),
                }));
                if (!suppressResponsePersist) {
                    await chatManagementGateway.appendMessage({
                        sessionId: polarSessionId,
                        userId: "assistant",
                        messageId: assistantMessageId,
                        role: "assistant",
                        text: clarificationQuestion,
                        timestampMs: now(),
                        ...(inboundThreadId !== undefined ? { threadId: inboundThreadId } : {}),
                        ...(inboundMetadata !== undefined ? { metadata: inboundMetadata } : {}),
                    });
                }
                return {
                    status: "ok",
                    type: "clarification_needed",
                    text: clarificationQuestion,
                    assistantMessageId,
                    useInlineReply: false,
                };
            }

            let selectedDelegateAgentId = null;
            if (finalRoutingDecision === "delegate") {
                const mentionedAgentId = resolveMentionedAgentId(text, installedAgentIds);
                const delegatedAgentId =
                    forcedRoutingTargetAgentId ||
                    routerDecision?.target?.agentId ||
                    mentionedAgentId ||
                    DEFAULT_GENERIC_AGENT_ID;
                selectedDelegateAgentId = delegatedAgentId;
                const approvalPolicy = deriveDelegationApprovalPolicy(text);
                const decisionConfidence = Number.isFinite(routerDecision?.confidence)
                    ? routerDecision.confidence
                    : Math.max(0.5, fusedTop.topScore);
                routingRecommendation = `${routingRecommendation ? `${routingRecommendation}\n` : ""}[ROUTER_DECISION] Delegate this request to ${delegatedAgentId}. Confidence=${decisionConfidence}. ${approvalPolicy.requiresApproval ? "This requires approval before execution." : "Simple read delegation may execute without manual approval."}`;
                await persistRoutingState(polarSessionId, laneThreadKey, Object.freeze({
                    type: "delegation_candidate",
                    createdAtMs: now(),
                    expiresAtMs: now() + ROUTING_STATE_TTL_MS,
                    laneThreadKey,
                    targetAgentId: delegatedAgentId,
                }));
            }

            if ((finalRoutingDecision === "tool" || finalRoutingDecision === "workflow") && routerAffirmedDecision) {
                const authoritativeResolution = resolveAuthoritativeRoutingOutput({
                    text: String(text || ""),
                    finalRoutingDecision,
                    routerDecision,
                    selectedDelegateAgentId,
                    classification,
                    profileAllowedSkills: normalizeStringArray(profile.profileConfig?.allowedSkills),
                });
                if (authoritativeResolution?.kind === "clarify") {
                    forcedClarificationQuestion = authoritativeResolution.question;
                }
            }

            if (forcedClarificationQuestion) {
                const assistantMessageId = `msg_a_${crypto.randomUUID()}`;
                if (!suppressResponsePersist) {
                    await chatManagementGateway.appendMessage({
                        sessionId: polarSessionId,
                        userId: "assistant",
                        messageId: assistantMessageId,
                        role: "assistant",
                        text: forcedClarificationQuestion,
                        timestampMs: now(),
                        ...(inboundThreadId !== undefined ? { threadId: inboundThreadId } : {}),
                        ...(inboundMetadata !== undefined ? { metadata: inboundMetadata } : {}),
                    });
                }
                return {
                    status: "ok",
                    type: "clarification_needed",
                    text: forcedClarificationQuestion,
                    assistantMessageId,
                    useInlineReply: false,
                };
            }

            let systemPrompt = profile.profileConfig?.systemPrompt || "You are a helpful Polar AI assistant. Be concise and friendly.";
            systemPrompt = appendPersonalityBlock(systemPrompt, effectivePersonality);
            systemPrompt += "\n\n[REPLY_CONTEXT_RULES]\nTreat any Reply context block as quoted reference text, not new user-authored claims. Do not attribute quoted assistant statements to the user. If attribution is unclear, ask a short clarifying question.\n[/REPLY_CONTEXT_RULES]";

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
            let sessionSummaryText = "";
            let temporalAttentionText = "";
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
                try {
                    const sessionSummarySearch = await memoryGateway.search({
                        executionType: "handoff",
                        sessionId: polarSessionId,
                        userId: String(userId),
                        scope: "session",
                        query: "session_summary",
                        limit: 3,
                    });
                    const sessionRecords = Array.isArray(sessionSummarySearch?.records) ? sessionSummarySearch.records : [];
                    const sessionSummary = sessionRecords.find((entry) => entry?.record?.type === "session_summary");
                    if (sessionSummary?.record?.summary && typeof sessionSummary.record.summary === "string") {
                        sessionSummaryText = sessionSummary.record.summary;
                    }
                } catch {
                    // non-fatal recall failure
                }
                try {
                    const temporalSearch = await memoryGateway.search({
                        executionType: "handoff",
                        sessionId: polarSessionId,
                        userId: String(userId),
                        scope: "session",
                        query: `temporal_attention ${laneThreadKey}`,
                        limit: 3,
                    });
                    const temporalRecords = Array.isArray(temporalSearch?.records) ? temporalSearch.records : [];
                    const temporalAttention = temporalRecords.find((entry) =>
                        entry?.record?.type === "temporal_attention" && entry?.metadata?.threadKey === laneThreadKey,
                    );
                    if (temporalAttention?.record?.summary && typeof temporalAttention.record.summary === "string") {
                        temporalAttentionText = temporalAttention.record.summary;
                    }
                } catch {
                    // non-fatal recall failure
                }
            }

            const recentLaneMessages = laneMessages.slice(-(profile.profileConfig?.contextWindow || LANE_RECENT_MESSAGE_LIMIT));
            const estimatedTokens = estimateMessageTokens(laneMessages);
            const shouldCompactLane = laneMessages.length > LANE_COMPACTION_MESSAGE_THRESHOLD || estimatedTokens > LANE_COMPACTION_TOKEN_THRESHOLD;
            const estimatedSessionTokens = estimateMessageTokens(allHistoryItems);
            const shouldCompactSession =
                allHistoryItems.length > SESSION_COMPACTION_MESSAGE_THRESHOLD ||
                estimatedSessionTokens > SESSION_COMPACTION_TOKEN_THRESHOLD;

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

            if (shouldCompactSession && memoryGateway && typeof memoryGateway.upsert === "function") {
                const sessionRollup = buildSessionSummaryRecord(allHistoryItems);
                if (sessionRollup.summarizedCount > 0) {
                    try {
                        await memoryGateway.upsert({
                            executionType: "handoff",
                            sessionId: polarSessionId,
                            userId: String(userId),
                            scope: "session",
                            memoryId: `session_summary:${polarSessionId}`,
                            record: {
                                type: "session_summary",
                                summary: sessionRollup.summary,
                                unsummarizedTailCount: sessionRollup.unsummarizedTail.length,
                            },
                            metadata: {
                                summaryVersion: 1,
                                updatedAtMs: now(),
                                messageRange: {
                                    from: allHistoryItems[0]?.messageId,
                                    to: allHistoryItems[Math.max(0, allHistoryItems.length - SESSION_UNSUMMARIZED_TAIL_COUNT - 1)]?.messageId,
                                },
                            },
                        });
                        sessionSummaryText = sessionRollup.summary;
                    } catch {
                        // non-fatal session summary persistence failure
                    }
                }
            }
            const temporalAttention = buildTemporalAttentionRecord({
                text,
                laneThreadKey,
                laneMessages,
                sessionState,
                nowMs: now(),
            });
            temporalAttentionText = temporalAttention.summary;
            if (memoryGateway && typeof memoryGateway.upsert === "function") {
                try {
                    await memoryGateway.upsert({
                        executionType: "handoff",
                        sessionId: polarSessionId,
                        userId: String(userId),
                        scope: "session",
                        memoryId: `temporal_attention:${polarSessionId}:${laneThreadKey}`,
                        record: {
                            type: "temporal_attention",
                            threadKey: laneThreadKey,
                            summary: temporalAttention.summary,
                            focusCandidates: temporalAttention.focusCandidates,
                            unresolved: temporalAttention.unresolved,
                            riskHints: temporalAttention.riskHints,
                            activeDelegation: temporalAttention.activeDelegation,
                            window: {
                                startAtMs: temporalAttention.windowStartMs,
                                endAtMs: temporalAttention.windowEndMs,
                            },
                        },
                        metadata: {
                            threadKey: laneThreadKey,
                            summaryVersion: 1,
                            updatedAtMs: now(),
                            windowStartMs: temporalAttention.windowStartMs,
                            windowEndMs: temporalAttention.windowEndMs,
                        },
                    });
                } catch {
                    // non-fatal temporal attention persistence failure
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
                metadata?.replyTo,
            );

            if (threadSummaryText) {
                systemPrompt += `\n\n[THREAD_SUMMARY threadKey=${laneThreadKey}]\n${threadSummaryText}\n[/THREAD_SUMMARY]`;
            }
            if (sessionSummaryText) {
                systemPrompt += `\n\n[SESSION_SUMMARY]\n${sessionSummaryText}\n[/SESSION_SUMMARY]`;
            }
            if (temporalAttentionText) {
                systemPrompt += `\n\n[TEMPORAL_ATTENTION threadKey=${laneThreadKey}]\n${temporalAttentionText}\n[/TEMPORAL_ATTENTION]`;
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

            const authoritativeRoutingOutput = resolveAuthoritativeRoutingOutput({
                text: String(text || ""),
                finalRoutingDecision,
                routerDecision,
                selectedDelegateAgentId,
                classification,
                profileAllowedSkills: normalizeStringArray(profile.profileConfig?.allowedSkills),
            });
            const canForceToolWorkflow =
                finalRoutingDecision === "delegate" ||
                ((finalRoutingDecision === "tool" || finalRoutingDecision === "workflow") && routerAffirmedDecision);
            const forcedActionText = canForceToolWorkflow && authoritativeRoutingOutput?.kind === "action"
                ? authoritativeRoutingOutput.text
                : null;

            const result = forcedActionText
                ? { text: forcedActionText }
                : await providerGateway.generate({
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
                            await persistSessionThreadsState(polarSessionId);
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
                        await persistSessionThreadsState(polarSessionId);
                    } catch (e) { }
                }

                if (actionMatch) {
                    const proposal = parseModelProposal(actionMatch[0]);
                    if (!proposal || proposal.error) return { status: 'error', text: "⚠️ Failed to parse action proposal" };

                    const workflowSteps = expandTemplate(proposal.templateId, proposal.args);
                    const risk = evaluateWorkflowRisk(workflowSteps);
                    const principal = { userId, sessionId: polarSessionId };
                    const pendingRequirements = checkGrants(risk.requirements, principal);

                    const requiresManualApproval = pendingRequirements.length > 0 || risk.delegationRequiresApproval;
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
                    await persistPendingWorkflow(workflowId, PENDING_WORKFLOWS.get(workflowId));

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
                        SESSION_THREADS.set(polarSessionId, st);
                        await persistSessionThreadsState(polarSessionId);
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
            await hydratePendingWorkflow(workflowId);
            const entry = PENDING_WORKFLOWS.get(workflowId);
            if (!entry) return { status: 'error', text: "Workflow not found" };

            const { steps: workflowSteps, polarSessionId, userId, multiAgentConfig, threadId: ownerThreadId, risk } = entry;
            await hydrateSessionThreadsState(polarSessionId);
            PENDING_WORKFLOWS.delete(workflowId);
            await clearPendingWorkflow(workflowId);

            // Resolve the target thread — use stored threadId, never rely on activeThreadId drift
            const runId = `run_${crypto.randomUUID()}`;
            const transientGrantIds = [];
            IN_FLIGHT_WORKFLOWS.set(workflowId, {
                runId,
                sessionId: polarSessionId,
                threadId: ownerThreadId,
                startedAt: now(),
            });

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
            const isCancellationRequested = () => WORKFLOW_CANCEL_REQUESTS.has(workflowId);
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
                SESSION_THREADS.set(polarSessionId, st);
                await persistSessionThreadsState(polarSessionId);
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
                        SESSION_THREADS.set(polarSessionId, st);
                        await persistSessionThreadsState(polarSessionId);
                    }
                    return { status: 'error', text: "Workflow blocked: " + validation.errors.join(", ") };
                }

                const toolResults = [];
                let wasCancelled = isCancellationRequested();

                for (const step of workflowSteps) {
                    if (wasCancelled || isCancellationRequested()) {
                        wasCancelled = true;
                        break;
                    }
                    const { capabilityId, extensionId, args: parsedArgs = {}, extensionType = "mcp" } = step;

                    if (capabilityId === "delegate_to_agent") {
                        const agentId = typeof parsedArgs.agentId === "string" ? parsedArgs.agentId : "";
                        if (!AGENT_ID_PATTERN.test(agentId)) {
                            toolResults.push({ tool: capabilityId, status: "error", output: "Delegation blocked: invalid agentId." });
                            continue;
                        }

                        const requestedAgentProfile = agentRegistry.agents.find((agent) => agent.agentId === agentId) || null;
                        const fallbackAgentProfile = agentRegistry.agents.find((agent) => agent.agentId === DEFAULT_GENERIC_AGENT_ID) || null;
                        const agentProfile = requestedAgentProfile || fallbackAgentProfile;
                        const resolvedAgentId = agentProfile?.agentId || agentId;
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
                                if (agentProfile.agentId !== DEFAULT_GENERIC_AGENT_ID) {
                                    toolResults.push({ tool: capabilityId, status: "error", output: `Delegation blocked: profile not found (${agentProfile.profileId}).` });
                                    continue;
                                }
                            } else {
                                delegatedProfileConfig = delegatedProfileRecord.config;
                            }
                        } else {
                            toolResults.push({ tool: capabilityId, status: "error", output: "Delegation blocked: no fallback agent profile registered." });
                            continue;
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
                            agentId: resolvedAgentId,
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
                            `Successfully delegated to ${resolvedAgentId}.` +
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
                            agentId: resolvedAgentId,
                            ...(delegatedProfileId ? { profileId: delegatedProfileId } : {}),
                            allowedSkills,
                            rejectedSkills,
                            providerId,
                            modelId,
                            timestampMs: now(),
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
                        await emitLineageEvent({
                            eventType: "delegation.cleared",
                            sessionId: polarSessionId,
                            userId,
                            workflowId,
                            runId,
                            threadId: targetThreadId,
                            timestampMs: now(),
                        });
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
                    try {
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
                            break;
                        }
                    } catch (error) {
                        const normalized = normalizeToolWorkflowError({
                            error,
                            extensionId,
                            capabilityId,
                            workflowId,
                            runId,
                            threadId: targetThreadId,
                        });
                        toolResults.push({
                            tool: capabilityId,
                            status: 'error',
                            output: normalized.userMessage,
                            category: normalized.category,
                            retryEligible: normalized.retryEligible,
                        });
                        if (normalized.clearPending) {
                            clearTerminalPendingState(polarSessionId, targetThreadId);
                            await persistSessionThreadsState(polarSessionId);
                        }
                        await emitLineageEvent({
                            eventType: 'workflow.execution.error_normalized',
                            sessionId: polarSessionId,
                            userId,
                            workflowId,
                            runId,
                            threadId: targetThreadId,
                            extensionId,
                            capabilityId,
                            metadata: normalized.auditMetadata,
                        });
                        st = SESSION_THREADS.get(polarSessionId);
                        if (st && targetThreadId) {
                            const thread = st.threads.find(t => t.id === targetThreadId);
                            if (thread) {
                                thread.lastError = {
                                    runId, workflowId, threadId: targetThreadId,
                                    extensionId, capabilityId,
                                    output: normalized.userMessage,
                                    messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                                };
                                thread.status = 'failed';
                                delete thread.inFlight;
                            }
                            SESSION_THREADS.set(polarSessionId, st);
                            await persistSessionThreadsState(polarSessionId);
                        }
                        break;
                    }
                }

                // Post-loop: clear inFlight on owning thread, set final status
                st = SESSION_THREADS.get(polarSessionId);
                const anyFailed = toolResults.some(r => r.status === 'failed' || r.status === 'error');
                if (st && targetThreadId) {
                    const thread = st.threads.find(t => t.id === targetThreadId);
                    if (thread) {
                        delete thread.inFlight;
                        if (wasCancelled) {
                            thread.status = 'done';
                        } else if (anyFailed && !thread.lastError) {
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
                    SESSION_THREADS.set(polarSessionId, st);
                    await persistSessionThreadsState(polarSessionId);
                }
                if (wasCancelled) {
                    await emitLineageEvent({
                        eventType: "workflow.execution.cancelled",
                        sessionId: polarSessionId,
                        userId,
                        workflowId,
                        runId,
                        threadId: targetThreadId,
                        timestampMs: now(),
                    });
                    const assistantMessageId = `msg_ast_${crypto.randomUUID()}`;
                    const cancelText = "Workflow cancelled by user.";
                    await chatManagementGateway.appendMessage({
                        sessionId: polarSessionId, userId: "assistant", role: "assistant",
                        text: cancelText, messageId: assistantMessageId, timestampMs: now()
                    });
                    const sessionStateForReply = SESSION_THREADS.get(polarSessionId) || { threads: [], activeThreadId: null };
                    return {
                        status: 'cancelled',
                        text: cancelText,
                        assistantMessageId,
                        workflowId,
                        runId,
                        useInlineReply: selectReplyAnchor({
                            sessionState: sessionStateForReply,
                            classification: { type: 'status_nudge', targetThreadId: targetThreadId }
                        }).useInlineReply
                    };
                }

                const deterministicHeader = "### 🛠️ Execution Results\n" + toolResults.map(r => (r.status === "failed" || r.status === "error" ? "❌ " : "✅ ") + `**${r.tool}**: ${typeof r.output === 'string' ? r.output.slice(0, 100) : 'Done.'}`).join("\n") + "\n\n";
                await emitLineageEvent({
                    eventType: "workflow.execution.results",
                    sessionId: polarSessionId,
                    userId,
                    workflowId,
                    runId,
                    threadId: targetThreadId,
                    metadata: {
                        toolResults,
                        failedCount: toolResults.filter((result) => result.status === "failed" || result.status === "error").length,
                    },
                    timestampMs: now(),
                });

                const finalSystemPromptBase = activeDelegation
                    ? `You are sub-agent ${activeDelegation.agentId}. Task: ${activeDelegation.task_instructions}. Skills: ${activeDelegation.forward_skills?.join(", ")}`
                    : profile.profileConfig?.systemPrompt;
                const finalSystemPrompt = appendPersonalityBlock(
                    finalSystemPromptBase || "You are a helpful Polar AI assistant. Be concise and friendly.",
                    effectivePersonality,
                );
                const normalizedFailures = toolResults.filter((result) => result.status === 'error' && typeof result.category === 'string');
                const shouldUseDeterministicFailureText = normalizedFailures.length > 0;
                const responseText = shouldUseDeterministicFailureText
                    ? normalizedFailures
                        .map((failure) => `- ${failure.output}`)
                        .join('\n')
                    : (await providerGateway.generate({
                        executionType: "handoff",
                        providerId: activeDelegation?.pinnedProvider || profile.profileConfig?.modelPolicy?.providerId || "openai",
                        model: activeDelegation?.model_override || profile.profileConfig?.modelPolicy?.modelId || "gpt-4.1-mini",
                        system: finalSystemPrompt,
                        messages: historyData?.items ? historyData.items.map(m => ({ role: m.role, content: m.text })) : [],
                        prompt: `Analyze these execution results and summarize for the user. Do NOT hide any failures listed in the header.\n\n${deterministicHeader}`
                    }))?.text || "Execution complete.";
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
                const normalized = normalizeToolWorkflowError({
                    error: err,
                    extensionId: 'orchestrator',
                    capabilityId: 'executeWorkflow',
                    workflowId,
                    runId,
                    threadId: targetThreadId,
                });
                // Crash path: record lastError on the owning thread (using stored threadId)
                let internalMessageId;
                st = SESSION_THREADS.get(polarSessionId);
                if (st && targetThreadId) {
                    const thread = st.threads.find(t => t.id === targetThreadId);
                    if (thread) {
                        thread.lastError = {
                            runId, workflowId, threadId: targetThreadId,
                            extensionId: 'orchestrator', capabilityId: 'executeWorkflow',
                            output: normalized.userMessage,
                            messageId: `msg_err_${crypto.randomUUID()}`, timestampMs: now()
                        };
                        internalMessageId = thread.lastError.messageId;
                        thread.status = 'failed';
                        delete thread.inFlight;
                        thread.lastActivityTs = now();
                    }
                    // Keep failed thread active — don't let next message spawn a greeting
                    st.activeThreadId = targetThreadId;
                    SESSION_THREADS.set(polarSessionId, st);
                    await persistSessionThreadsState(polarSessionId);
                }
                if (normalized.clearPending) {
                    clearTerminalPendingState(polarSessionId, targetThreadId);
                    await persistSessionThreadsState(polarSessionId);
                }
                await emitLineageEvent({
                    eventType: 'workflow.execution.error_normalized',
                    sessionId: polarSessionId,
                    userId,
                    workflowId,
                    runId,
                    threadId: targetThreadId,
                    extensionId: 'orchestrator',
                    capabilityId: 'executeWorkflow',
                    metadata: normalized.auditMetadata,
                });
                return { status: 'error', text: normalized.userMessage, internalMessageId };
            } finally {
                IN_FLIGHT_WORKFLOWS.delete(workflowId);
                WORKFLOW_CANCEL_REQUESTS.delete(workflowId);
                for (const grantId of transientGrantIds) {
                    approvalStore.revokeGrant(grantId);
                }
            }
        },

        async updateMessageChannelId(sessionId, messageId, channelMessageId) {
            await hydrateSessionThreadsState(sessionId);
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
                SESSION_THREADS.set(sessionId, st);
                await persistSessionThreadsState(sessionId);
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
            await hydratePendingWorkflow(workflowId);
            const entry = PENDING_WORKFLOWS.get(workflowId);
            if (entry) {
                await hydrateSessionThreadsState(entry.polarSessionId);
                // Clear awaitingApproval on the owning thread
                const st = SESSION_THREADS.get(entry.polarSessionId);
                if (st && entry.threadId) {
                    const thread = st.threads.find(t => t.id === entry.threadId);
                    if (thread) {
                        thread.status = 'in_progress';
                        delete thread.awaitingApproval;
                        thread.lastActivityTs = now();
                    }
                    SESSION_THREADS.set(entry.polarSessionId, st);
                    await persistSessionThreadsState(entry.polarSessionId);
                }
            }
            PENDING_WORKFLOWS.delete(workflowId);
            WORKFLOW_CANCEL_REQUESTS.delete(workflowId);
            await clearPendingWorkflow(workflowId);
            return { status: 'rejected' };
        },

        async cancelWorkflow(workflowId) {
            await hydratePendingWorkflow(workflowId);
            const pending = PENDING_WORKFLOWS.get(workflowId);
            if (pending) {
                await hydrateSessionThreadsState(pending.polarSessionId);
                PENDING_WORKFLOWS.delete(workflowId);
                const st = SESSION_THREADS.get(pending.polarSessionId);
                if (st && pending.threadId) {
                    const thread = st.threads.find((candidate) => candidate.id === pending.threadId);
                    if (thread) {
                        delete thread.awaitingApproval;
                        delete thread.inFlight;
                        thread.status = "done";
                        thread.lastActivityTs = now();
                    }
                    SESSION_THREADS.set(pending.polarSessionId, st);
                    await persistSessionThreadsState(pending.polarSessionId);
                }
                await clearPendingWorkflow(workflowId);
                return { status: "cancelled", phase: "pending", workflowId };
            }

            if (IN_FLIGHT_WORKFLOWS.has(workflowId)) {
                WORKFLOW_CANCEL_REQUESTS.set(workflowId, { requestedAt: now() });
                return { status: "cancellation_requested", phase: "in_flight", workflowId };
            }

            return { status: "not_found", workflowId };
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
            await hydrateSessionThreadsState(sessionId);
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
            await persistSessionThreadsState(sessionId);
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
