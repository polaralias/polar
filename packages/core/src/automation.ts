
import { z } from 'zod';

export const TriggerTypeSchema = z.enum(['webhook', 'schedule', 'event']);

export const TriggerSchema = z.object({
    type: TriggerTypeSchema,
    source: z.string().min(1), // e.g. "gmail", "cron"
    filter: z.record(z.unknown()).optional(), // JSON-based filter for payload
    schedule: z.string().optional(), // Cron expression if type is schedule
});

export const AutomationActionSchema = z.object({
    skillId: z.string().min(1),
    templateId: z.string().optional(),
    args: z.record(z.unknown()).optional(),
});

export const AutomationTierSchema = z.enum(['informational', 'intent_completion', 'delegated', 'autonomous']);

export const AutomationEnvelopeSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    ownerId: z.string().min(1), // UserId
    enabled: z.boolean(),
    trigger: TriggerSchema,
    action: AutomationActionSchema,
    tier: AutomationTierSchema,
    rateLimit: z.object({
        maxRuns: z.number(),
        windowSeconds: z.number()
    }).optional(),
    createdAt: z.string().datetime(),
});

export const IngestedEventSchema = z.object({
    id: z.string().min(1), // Unique Event ID (dedup)
    source: z.string().min(1),
    type: z.string().min(1), // e.g. "new_email"
    payload: z.record(z.unknown()),
    timestamp: z.string().datetime(),
});

export type Trigger = z.infer<typeof TriggerSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
export type AutomationTier = z.infer<typeof AutomationTierSchema>;
export type AutomationEnvelope = z.infer<typeof AutomationEnvelopeSchema>;
export type IngestedEvent = z.infer<typeof IngestedEventSchema>;
