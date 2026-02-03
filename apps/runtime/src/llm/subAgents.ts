/**
 * Specialized Sub-Agents
 * Pre-defined, lightweight agents optimized for specific internal tasks
 * 
 * ============================================================================
 * TIER PINNING vs ORCHESTRATOR RECOMMENDATIONS
 * ============================================================================
 * 
 * There are TWO types of model selection in the system:
 * 
 * 1. PRE-DEFINED SUB-AGENTS (this file):
 *    - Hard-pinned to specific tiers (e.g., 'cheap')
 *    - ALWAYS use the pinned tier, regardless of what orchestrator says
 *    - Examples: intent classifier, summarizer, entity extractor
 *    - Purpose: standardized, cost-optimized internal operations
 * 
 * 2. DYNAMICALLY SPAWNED WORKERS (via worker.spawn):
 *    - Orchestrator RECOMMENDS a tier based on task complexity assessment
 *    - Worker uses the recommended tier from the spawn request
 *    - Examples: file analysis, email drafting, code generation
 *    - Purpose: flexible, task-appropriate model selection
 * 
 * ============================================================================
 * 
 * Users configure tier models in Settings > Intelligence > Model Tiers.
 * Sub-agents here ALWAYS use the user-configured model for their PINNED tier.
 */

import { llmService } from './service.js';
import type {
    IntentClassifierResponse,
    SummarizerResponse,
    LLMMessage,
    ModelTier,
} from './types.js';

// =============================================================================
// Tier Configuration for Pre-Defined Sub-Agents
// These tiers are HARD-PINNED and cannot be overridden by orchestrator
// =============================================================================

/** Intent classifier always uses the cheapest model - simple yes/no */
const INTENT_CLASSIFIER_TIER: ModelTier = 'cheap';

/** Summarizer uses cheap models - text compression doesn't need reasoning */
const SUMMARIZER_TIER: ModelTier = 'cheap';

/** Entity extraction uses cheap models - pattern matching task */
const ENTITY_EXTRACTOR_TIER: ModelTier = 'cheap';

// =============================================================================
// Intent Classifier
// Validates if a user's ambiguous reply grants permission for a pending action
// =============================================================================

const INTENT_CLASSIFIER_SYSTEM = `You are an intent classifier. You have NO tools and cannot perform any actions.
Your ONLY task is to determine if the user's message indicates approval or rejection of a proposed action.

CONTEXT: The user was asked to approve a specific action.
You will receive:
1. proposal_context: A description of what was proposed
2. user_message: The user's reply

OUTPUT: Return a JSON object with exactly this format:
{
  "approved": boolean,
  "confidence": number between 0 and 1
}

GUIDELINES:
- approved=true ONLY if the user clearly indicates "yes", "do it", "go ahead", "sure", "ok", etc.
- approved=false if the user says "no", "stop", "cancel", "don't", or if the message is ambiguous
- If the message is completely unrelated to the proposal, set approved=false
- confidence should reflect how certain you are (0.9+ for clear responses, 0.5-0.7 for somewhat clear, <0.5 for ambiguous)

IMPORTANT: When in doubt, return approved=false. Safety first.`;

/**
 * Classify user intent for proactive action approval
 * 
 * PINNED TO: 'cheap' tier
 * This task is simple classification and should use the cheapest available model.
 */
export async function classifyIntent(
    proposalContext: string,
    userMessage: string,
    sessionId?: string,
): Promise<IntentClassifierResponse> {
    const userPrompt = `Proposal context: "${proposalContext}"
User reply: "${userMessage}"

Analyze the user's reply and output the JSON result.`;

    try {
        // Use chatWithTier for forced tier pinning
        const response = await llmService.chatWithTier(
            {
                messages: [
                    { role: 'system', content: INTENT_CLASSIFIER_SYSTEM },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.1, // Low temperature for consistent classification
                maxTokens: 100,
            },
            INTENT_CLASSIFIER_TIER, // PINNED to cheap model
            {
                ...(sessionId ? { sessionId } : {}),
                agentId: 'intent_classifier_v1',
            },
        );

        // Parse the JSON response
        const content = response.content?.trim() || '';

        // Try to extract JSON from the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('Intent classifier returned non-JSON response:', content);
            return { approved: false, confidence: 0 };
        }

        const result = JSON.parse(jsonMatch[0]);

        return {
            approved: Boolean(result.approved),
            confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
        };
    } catch (error) {
        console.error('Intent classification failed:', error);
        // Fail safe - don't approve if we can't classify
        return { approved: false, confidence: 0 };
    }
}

// =============================================================================
// Conversation Summarizer
// Compresses older conversation turns to maintain context efficiency
// =============================================================================

const SUMMARIZER_SYSTEM = `You are a conversation summarizer. Your task is to compress a series of messages into a concise summary while preserving all important information.

OUTPUT FORMAT:
{
  "summary": "A concise summary of the conversation",
  "keyFacts": ["Important fact 1", "Important fact 2", ...]
}

GUIDELINES:
- Preserve all key decisions, commitments, and action items
- Keep names, dates, numbers, and specific details
- Remove pleasantries, filler, and redundant information
- The summary should be clear enough that someone could continue the conversation
- keyFacts should list actionable or important items separately`;

/**
 * Summarize a batch of conversation messages
 * 
 * PINNED TO: 'cheap' tier
 * Summarization is a cost-effective operation that doesn't require advanced reasoning.
 */
export async function summarizeConversation(
    messages: LLMMessage[],
    sessionId?: string,
): Promise<SummarizerResponse> {
    if (messages.length === 0) {
        return { summary: '', keyFacts: [], tokensSaved: 0 };
    }

    // Format messages for summarization
    const formattedMessages = messages
        .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join('\n\n');

    const userPrompt = `Summarize the following conversation:\n\n${formattedMessages}`;

    // Estimate input tokens
    const inputTokens = Math.ceil((SUMMARIZER_SYSTEM.length + userPrompt.length) / 4);

    try {
        // Use chatWithTier for forced tier pinning
        const response = await llmService.chatWithTier(
            {
                messages: [
                    { role: 'system', content: SUMMARIZER_SYSTEM },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.3,
                maxTokens: 500,
            },
            SUMMARIZER_TIER, // PINNED to cheap model
            {
                ...(sessionId ? { sessionId } : {}),
                agentId: 'summarizer_v1',
            },
        );

        const content = response.content?.trim() || '';

        // Try to extract JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            // If no JSON, treat the whole response as the summary
            return {
                summary: content,
                keyFacts: [],
                tokensSaved: inputTokens - Math.ceil(content.length / 4),
            };
        }

        const result = JSON.parse(jsonMatch[0]);
        const outputTokens = Math.ceil(content.length / 4);

        return {
            summary: result.summary || content,
            keyFacts: Array.isArray(result.keyFacts) ? result.keyFacts : [],
            tokensSaved: inputTokens - outputTokens,
        };
    } catch (error) {
        console.error('Conversation summarization failed:', error);
        // Return a basic fallback summary
        return {
            summary: `[Summary unavailable - ${messages.length} messages]`,
            keyFacts: [],
            tokensSaved: 0,
        };
    }
}

// =============================================================================
// Entity Extractor
// Extracts structured entities from user messages
// =============================================================================

const ENTITY_EXTRACTOR_SYSTEM = `You are an entity extractor. Extract structured information from user messages.

OUTPUT FORMAT:
{
  "dates": ["any dates or times mentioned"],
  "people": ["names of people mentioned"],
  "locations": ["places mentioned"],
  "actions": ["actions or tasks mentioned"],
  "topics": ["main topics or subjects"]
}

Only include fields that have actual values. If nothing is found for a category, omit it.`;

export interface ExtractedEntities {
    dates?: string[];
    people?: string[];
    locations?: string[];
    actions?: string[];
    topics?: string[];
}

/**
 * Extract structured entities from a message
 * 
 * PINNED TO: 'cheap' tier
 * Entity extraction is simple pattern matching, doesn't need reasoning.
 */
export async function extractEntities(
    message: string,
    sessionId?: string,
): Promise<ExtractedEntities> {
    try {
        // Use chatWithTier for forced tier pinning
        const response = await llmService.chatWithTier(
            {
                messages: [
                    { role: 'system', content: ENTITY_EXTRACTOR_SYSTEM },
                    { role: 'user', content: message },
                ],
                temperature: 0.1,
                maxTokens: 200,
            },
            ENTITY_EXTRACTOR_TIER, // PINNED to cheap model
            {
                ...(sessionId ? { sessionId } : {}),
                agentId: 'entity_extractor_v1',
            },
        );

        const content = response.content?.trim() || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            return {};
        }

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error('Entity extraction failed:', error);
        return {};
    }
}

// =============================================================================
// Sentiment Analyzer (Additional sub-agent)
// Analyzes the sentiment and tone of user messages
// =============================================================================

const SENTIMENT_ANALYZER_SYSTEM = `You are a sentiment analyzer. Analyze the emotional tone and sentiment of user messages.

OUTPUT FORMAT:
{
  "sentiment": "positive" | "negative" | "neutral" | "mixed",
  "confidence": number between 0 and 1,
  "emotions": ["primary emotions detected"],
  "urgency": "low" | "medium" | "high"
}

Be objective and accurate. Consider context and nuance.`;

export interface SentimentAnalysis {
    sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
    confidence: number;
    emotions?: string[];
    urgency?: 'low' | 'medium' | 'high';
}

/**
 * Analyze sentiment of a message
 * 
 * PINNED TO: 'cheap' tier
 */
export async function analyzeSentiment(
    message: string,
    sessionId?: string,
): Promise<SentimentAnalysis> {
    try {
        const response = await llmService.chatWithTier(
            {
                messages: [
                    { role: 'system', content: SENTIMENT_ANALYZER_SYSTEM },
                    { role: 'user', content: message },
                ],
                temperature: 0.1,
                maxTokens: 150,
            },
            'cheap', // PINNED to cheap model
            {
                ...(sessionId ? { sessionId } : {}),
                agentId: 'sentiment_analyzer_v1',
            },
        );

        const content = response.content?.trim() || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            return { sentiment: 'neutral', confidence: 0 };
        }

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error('Sentiment analysis failed:', error);
        return { sentiment: 'neutral', confidence: 0 };
    }
}

// =============================================================================
// Task Classifier (For task-based routing)
// Classifies what type of task the user wants to perform
// =============================================================================

const TASK_CLASSIFIER_SYSTEM = `You are a task classifier. Determine what type of task the user wants to perform.

OUTPUT FORMAT:
{
  "taskType": string, // e.g., "web_search", "email", "calendar", "code", "general"
  "confidence": number,
  "description": string // brief description of what user wants
}

Common task types:
- "web_search": Looking up information, searching the internet
- "email": Composing, reading, or managing emails
- "calendar": Scheduling, viewing, or managing calendar events
- "code": Writing, reviewing, or debugging code
- "files": Reading, writing, or managing files
- "general": General conversation or questions`;

export interface TaskClassification {
    taskType: string;
    confidence: number;
    description?: string;
}

/**
 * Classify what type of task the user wants to perform
 * Used for routing to appropriate providers
 * 
 * PINNED TO: 'cheap' tier
 */
export async function classifyTask(
    message: string,
    sessionId?: string,
): Promise<TaskClassification> {
    try {
        const response = await llmService.chatWithTier(
            {
                messages: [
                    { role: 'system', content: TASK_CLASSIFIER_SYSTEM },
                    { role: 'user', content: message },
                ],
                temperature: 0.1,
                maxTokens: 150,
            },
            'cheap', // PINNED to cheap model
            {
                ...(sessionId ? { sessionId } : {}),
                agentId: 'task_classifier_v1',
            },
        );

        const content = response.content?.trim() || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            return { taskType: 'general', confidence: 0 };
        }

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error('Task classification failed:', error);
        return { taskType: 'general', confidence: 0 };
    }
}
