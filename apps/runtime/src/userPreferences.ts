/**
 * User Preferences Service
 * Stores and manages user personalization settings including custom instructions,
 * response style preferences, and onboarding state.
 * 
 * Data is stored per-user and injected into the agent's system prompt to shape
 * behavior without compromising security invariants.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Mutex } from 'async-mutex';
import { runtimeConfig } from './config.js';

const mutex = new Mutex();

// =============================================================================
// Schemas
// =============================================================================

/**
 * Custom instructions that define how the agent should behave
 */
export const CustomInstructionsSchema = z.object({
    /**
     * Facts about the user the agent should know
     * E.g., "I'm a software engineer who prefers TypeScript"
     */
    aboutUser: z.string().max(2000).default(''),

    /**
     * How the user wants responses formatted
     * E.g., "Be concise. No yapping. Use bullet points."
     */
    responseStyle: z.string().max(1000).default(''),
});

export type CustomInstructions = z.infer<typeof CustomInstructionsSchema>;

/**
 * User context gathered during onboarding
 */
export const UserContextSchema = z.object({
    /**
     * Work/professional info
     */
    work: z.object({
        role: z.string().optional(),
        industry: z.string().optional(),
        typicalHours: z.string().optional(),
        timezone: z.string().optional(),
    }).default({}),

    /**
     * Personal context (for scheduling, reminders)
     */
    personal: z.object({
        familyContext: z.string().optional(),
        preferredContactTimes: z.string().optional(),
    }).default({}),

    /**
     * Current goals and projects
     */
    goals: z.array(z.object({
        id: z.string(),
        description: z.string(),
        category: z.enum(['professional', 'personal', 'learning']),
        createdAt: z.string(),
        checkInScheduled: z.boolean().default(false),
    })).default([]),
});

export type UserContext = z.infer<typeof UserContextSchema>;

/**
 * Onboarding state tracking
 */
export const OnboardingStateSchema = z.object({
    completed: z.boolean().default(false),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    phase: z.enum(['not_started', 'in_progress', 'completed']).default('not_started'),
    /**
     * Which topics have been covered
     */
    coveredTopics: z.array(z.enum(['work', 'personal', 'goals'])).default([]),
});

export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

/**
 * Complete user preferences
 */
export const UserPreferencesSchema = z.object({
    id: z.string(),
    userId: z.string(),
    customInstructions: CustomInstructionsSchema.default({}),
    userContext: UserContextSchema.default({}),
    onboarding: OnboardingStateSchema.default({}),
    /**
     * Whether personalization is enabled in the prompt
     */
    enabled: z.boolean().default(true),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// =============================================================================
// Storage
// =============================================================================

const PREFERENCES_PATH = path.join(runtimeConfig.dataDir, 'user_preferences.json');

/**
 * Load all user preferences from storage
 */
async function loadAllPreferences(): Promise<Map<string, UserPreferences>> {
    try {
        const data = await fs.readFile(PREFERENCES_PATH, 'utf-8');
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const map = new Map<string, UserPreferences>();

        for (const [userId, prefs] of Object.entries(parsed)) {
            try {
                const validated = UserPreferencesSchema.parse(prefs);
                map.set(userId, validated);
            } catch {
                // Skip invalid entries
            }
        }

        return map;
    } catch {
        return new Map();
    }
}

/**
 * Save all user preferences to storage
 */
async function saveAllPreferences(prefs: Map<string, UserPreferences>): Promise<void> {
    const obj: Record<string, UserPreferences> = {};
    for (const [userId, pref] of prefs) {
        obj[userId] = pref;
    }

    await fs.mkdir(path.dirname(PREFERENCES_PATH), { recursive: true });
    await fs.writeFile(PREFERENCES_PATH, JSON.stringify(obj, null, 2));
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get user preferences for a specific user
 */
export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
    const release = await mutex.acquire();
    try {
        const all = await loadAllPreferences();
        return all.get(userId) || null;
    } finally {
        release();
    }
}

/**
 * Get or create user preferences
 */
export async function getOrCreatePreferences(userId: string): Promise<UserPreferences> {
    const release = await mutex.acquire();
    try {
        const all = await loadAllPreferences();
        let prefs = all.get(userId);

        if (!prefs) {
            const now = new Date().toISOString();
            prefs = UserPreferencesSchema.parse({
                id: crypto.randomUUID(),
                userId,
                createdAt: now,
                updatedAt: now,
            });
            all.set(userId, prefs);
            await saveAllPreferences(all);
        }

        return prefs;
    } finally {
        release();
    }
}

/**
 * Update custom instructions
 */
export async function updateCustomInstructions(
    userId: string,
    instructions: Partial<CustomInstructions>,
): Promise<UserPreferences> {
    const release = await mutex.acquire();
    try {
        const all = await loadAllPreferences();
        let prefs = all.get(userId);

        if (!prefs) {
            const now = new Date().toISOString();
            prefs = UserPreferencesSchema.parse({
                id: crypto.randomUUID(),
                userId,
                createdAt: now,
                updatedAt: now,
            });
        }

        prefs = {
            ...prefs,
            customInstructions: {
                ...prefs.customInstructions,
                ...instructions,
            },
            updatedAt: new Date().toISOString(),
        };

        all.set(userId, prefs);
        await saveAllPreferences(all);

        return prefs;
    } finally {
        release();
    }
}

/**
 * Update user context (work, personal, goals)
 */
export async function updateUserContext(
    userId: string,
    context: Partial<UserContext>,
): Promise<UserPreferences> {
    const release = await mutex.acquire();
    try {
        const all = await loadAllPreferences();
        let prefs = all.get(userId);

        if (!prefs) {
            const now = new Date().toISOString();
            prefs = UserPreferencesSchema.parse({
                id: crypto.randomUUID(),
                userId,
                createdAt: now,
                updatedAt: now,
            });
        }

        prefs = {
            ...prefs,
            userContext: {
                work: { ...prefs.userContext.work, ...context.work },
                personal: { ...prefs.userContext.personal, ...context.personal },
                goals: context.goals || prefs.userContext.goals,
            },
            updatedAt: new Date().toISOString(),
        };

        all.set(userId, prefs);
        await saveAllPreferences(all);

        return prefs;
    } finally {
        release();
    }
}

/**
 * Update onboarding state
 */
export async function updateOnboardingState(
    userId: string,
    state: Partial<OnboardingState>,
): Promise<UserPreferences> {
    const release = await mutex.acquire();
    try {
        const all = await loadAllPreferences();
        let prefs = all.get(userId);

        if (!prefs) {
            const now = new Date().toISOString();
            prefs = UserPreferencesSchema.parse({
                id: crypto.randomUUID(),
                userId,
                createdAt: now,
                updatedAt: now,
            });
        }

        prefs = {
            ...prefs,
            onboarding: {
                ...prefs.onboarding,
                ...state,
            },
            updatedAt: new Date().toISOString(),
        };

        all.set(userId, prefs);
        await saveAllPreferences(all);

        return prefs;
    } finally {
        release();
    }
}

/**
 * Toggle personalization on/off
 */
export async function setPersonalizationEnabled(
    userId: string,
    enabled: boolean,
): Promise<UserPreferences> {
    const release = await mutex.acquire();
    try {
        const all = await loadAllPreferences();
        let prefs = all.get(userId);

        if (!prefs) {
            const now = new Date().toISOString();
            prefs = UserPreferencesSchema.parse({
                id: crypto.randomUUID(),
                userId,
                createdAt: now,
                updatedAt: now,
            });
        }

        prefs = {
            ...prefs,
            enabled,
            updatedAt: new Date().toISOString(),
        };

        all.set(userId, prefs);
        await saveAllPreferences(all);

        return prefs;
    } finally {
        release();
    }
}

/**
 * Add a goal to track
 */
export async function addGoal(
    userId: string,
    goal: { description: string; category: 'professional' | 'personal' | 'learning' },
): Promise<UserPreferences> {
    const prefs = await getOrCreatePreferences(userId);

    const newGoal = {
        id: crypto.randomUUID(),
        description: goal.description,
        category: goal.category,
        createdAt: new Date().toISOString(),
        checkInScheduled: false,
    };

    return updateUserContext(userId, {
        goals: [...prefs.userContext.goals, newGoal],
    });
}

/**
 * Check if user needs onboarding
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
    const prefs = await getUserPreferences(userId);

    if (!prefs) return true;
    if (!prefs.onboarding.completed && prefs.onboarding.phase !== 'in_progress') return true;

    return false;
}

/**
 * Start the onboarding process
 */
export async function startOnboarding(userId: string): Promise<void> {
    await updateOnboardingState(userId, {
        phase: 'in_progress',
        startedAt: new Date().toISOString(),
        coveredTopics: [],
    });
}

/**
 * Complete a topic during onboarding
 */
export async function completeOnboardingTopic(
    userId: string,
    topic: 'work' | 'personal' | 'goals',
): Promise<void> {
    const prefs = await getOrCreatePreferences(userId);
    const coveredTopics = [...prefs.onboarding.coveredTopics];

    if (!coveredTopics.includes(topic)) {
        coveredTopics.push(topic);
    }

    await updateOnboardingState(userId, {
        coveredTopics,
    });
}

/**
 * Complete the onboarding process
 */
export async function completeOnboarding(userId: string): Promise<void> {
    await updateOnboardingState(userId, {
        phase: 'completed',
        completed: true,
        completedAt: new Date().toISOString(),
    });
}

// =============================================================================
// Prompt Assembly Helpers
// =============================================================================

/**
 * Build the personalization block for the system prompt
 * This is sandwiched between security invariants and task context
 */
export async function buildPersonalizationPrompt(userId: string): Promise<string | null> {
    const prefs = await getUserPreferences(userId);

    if (!prefs || !prefs.enabled) {
        return null;
    }

    const parts: string[] = [];

    // Custom Instructions
    if (prefs.customInstructions.aboutUser.trim()) {
        parts.push('USER INFORMATION:');
        parts.push(prefs.customInstructions.aboutUser.trim());
        parts.push('');
    }

    if (prefs.customInstructions.responseStyle.trim()) {
        parts.push('RESPONSE PREFERENCES:');
        parts.push(prefs.customInstructions.responseStyle.trim());
        parts.push('');
    }

    // User Context
    const ctx = prefs.userContext;

    if (ctx.work.role || ctx.work.industry) {
        parts.push('WORK CONTEXT:');
        if (ctx.work.role) parts.push(`• Role: ${ctx.work.role}`);
        if (ctx.work.industry) parts.push(`• Industry: ${ctx.work.industry}`);
        if (ctx.work.typicalHours) parts.push(`• Hours: ${ctx.work.typicalHours}`);
        if (ctx.work.timezone) parts.push(`• Timezone: ${ctx.work.timezone}`);
        parts.push('');
    }

    // Active goals
    const activeGoals = ctx.goals.slice(0, 3); // Limit to avoid token bloat
    if (activeGoals.length > 0) {
        parts.push('ACTIVE GOALS:');
        for (const goal of activeGoals) {
            parts.push(`• [${goal.category}] ${goal.description}`);
        }
        parts.push('');
    }

    if (parts.length === 0) {
        return null;
    }

    return parts.join('\n').trim();
}

/**
 * Build onboarding prompt if the user needs it
 */
export async function buildOnboardingPrompt(userId: string): Promise<string | null> {
    const needs = await needsOnboarding(userId);

    if (!needs) {
        return null;
    }

    const prefs = await getOrCreatePreferences(userId);

    if (prefs.onboarding.phase === 'not_started') {
        return `ONBOARDING MODE:
This is a new user who hasn't completed setup yet. Before diving into their request, initiate a friendly conversation to learn about them:

1. Greet them warmly and explain you'd like to get to know them to be more helpful.
2. Ask about their work/profession (optional).
3. Ask what they're hoping to accomplish or any goals they're working on.
4. Confirm their preferences for how you should respond (concise/detailed, formal/casual).

Keep it conversational, not interrogative. After gathering this info, use memory.propose to store it.`;
    }

    const remaining = ['work', 'personal', 'goals'].filter(
        t => !prefs.onboarding.coveredTopics.includes(t as 'work' | 'personal' | 'goals'),
    );

    if (remaining.length > 0) {
        return `ONBOARDING IN PROGRESS:
You're still getting to know this user. Topics to explore: ${remaining.join(', ')}.
After discussing, use memory.propose to save key facts.`;
    }

    return null;
}
