import { z } from 'zod';

export const FsResourceSchema = z.object({
  type: z.literal('fs'),
  path: z.string().min(1),
});

export const FsResourceConstraintSchema = z.object({
  type: z.literal('fs'),
  root: z.string().min(1).optional(),
  paths: z.array(z.string().min(1)).optional(),
});

export const ResourceSchema = z.discriminatedUnion('type', [FsResourceSchema]);
export const ResourceConstraintSchema = z.discriminatedUnion('type', [
  FsResourceConstraintSchema,
]);

export const SessionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  subject: z.string().min(1),
});

export const WorkerTemplateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  description: z.string().optional(),
});

export const CapabilitySchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  action: z.string().min(1),
  resource: ResourceConstraintSchema,
  fields: z.array(z.string().min(1)).optional(),
  expiresAt: z.number().int(),
});

export const CapabilityTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  act: z.string().min(1),
  res: ResourceConstraintSchema,
  fld: z.array(z.string().min(1)).optional(),
  exp: z.number().int(),
  jti: z.string().min(1),
});

export const CapabilityTokenSchema = z.string().min(1);

export const GrantSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  action: z.string().min(1),
  resource: ResourceConstraintSchema,
  fields: z.array(z.string().min(1)).optional(),
  expiresAt: z.number().int().optional(),
});

export const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  effect: z.enum(['deny', 'allow']),
  subject: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  resource: ResourceConstraintSchema.optional(),
  reason: z.string().optional(),
});

export const PolicyStoreSchema = z.object({
  grants: z.array(GrantSchema),
  rules: z.array(PolicyRuleSchema),
});

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  time: z.string().datetime(),
  subject: z.string().min(1),
  action: z.string().min(1),
  tool: z.string().optional(),
  decision: z.enum(['allow', 'deny']),
  reason: z.string().optional(),
  resource: z.object({
    type: z.string().min(1),
    path: z.string().optional(),
    root: z.string().optional(),
  }),
  sessionId: z.string().optional(),
  requestId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type FsResource = z.infer<typeof FsResourceSchema>;
export type FsResourceConstraint = z.infer<typeof FsResourceConstraintSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type ResourceConstraint = z.infer<typeof ResourceConstraintSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type WorkerTemplate = z.infer<typeof WorkerTemplateSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type CapabilityTokenPayload = z.infer<typeof CapabilityTokenPayloadSchema>;
export type CapabilityToken = z.infer<typeof CapabilityTokenSchema>;
export type Grant = z.infer<typeof GrantSchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type PolicyStore = z.infer<typeof PolicyStoreSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
