import { z } from 'zod';

export const MemoryTypeSchema = z.enum(['profile', 'project', 'session', 'tool-derived']);
export const SensitivityLevelSchema = z.enum(['low', 'moderate', 'high']);

export const FsResourceSchema = z.object({
  type: z.literal('fs'),
  path: z.string().min(1),
});

export const FsResourceConstraintSchema = z.object({
  type: z.literal('fs'),
  root: z.string().min(1).optional(),
  paths: z.array(z.string().min(1)).optional(),
});

export const MemoryResourceSchema = z.object({
  type: z.literal('memory'),
  memoryType: MemoryTypeSchema,
  scopeId: z.string().optional(),
});

export const MemoryResourceConstraintSchema = z.object({
  type: z.literal('memory'),
  memoryType: MemoryTypeSchema.optional(),
  scopeIds: z.array(z.string().min(1)).optional(),
});

export const SystemResourceSchema = z.object({
  type: z.literal('system'),
  component: z.string().optional(),
});

export const HttpResourceSchema = z.object({
  type: z.literal('http'),
  url: z.string().min(1),
  method: z.string().optional(),
});

export const GenericResourceSchema = z.object({
  type: z.literal('connector'),
  connectorId: z.string().min(1),
  resourceId: z.string().min(1),
});

export const SystemResourceConstraintSchema = z.object({
  type: z.literal('system'),
  components: z.array(z.string().min(1)).optional(),
});

export const HttpResourceConstraintSchema = z.object({
  type: z.literal('http'),
  allowHosts: z.array(z.string().min(1)).optional(),
  allowMethods: z.array(z.string().min(1)).optional(),
  allowHeaders: z.array(z.string().min(1)).optional(),
});

export const GenericResourceConstraintSchema = z.object({
  type: z.literal('connector'),
  connectorId: z.string().min(1),
  constraints: z.record(z.any()),
});

export const ResourceSchema = z.discriminatedUnion('type', [
  FsResourceSchema,
  MemoryResourceSchema,
  SystemResourceSchema,
  HttpResourceSchema,
  GenericResourceSchema,
]);

export const ResourceConstraintSchema = z.discriminatedUnion('type', [
  FsResourceConstraintSchema,
  MemoryResourceConstraintSchema,
  SystemResourceConstraintSchema,
  HttpResourceConstraintSchema,
  GenericResourceConstraintSchema,
]);

export const SessionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  subject: z.string().min(1),
  projectPath: z.string().optional(),
  mainAgentId: z.string().optional(),
  status: z.enum(['active', 'terminated']).optional(),
});

export const WorkerTemplateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  description: z.string().optional(),
});

export const CapabilitySchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  action: z.string().min(1), // e.g., 'read', 'propose', 'delete'
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
  pol_ver: z.number().int().optional(),
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
  policyVersions: z.record(z.string(), z.number().int()).optional(),
});

export const MemoryItemSchema = z.object({
  id: z.string().min(1),
  type: MemoryTypeSchema,
  subjectId: z.string().min(1),
  scopeId: z.string().min(1),
  content: z.record(z.any()),
  provenance: z.object({
    agentId: z.string().optional(),
    skillId: z.string().optional(),
    sourceId: z.string().min(1),
    timestamp: z.string().datetime(),
  }),
  metadata: z.object({
    tags: z.array(z.string()),
    sensitivity: SensitivityLevelSchema,
    ttlSeconds: z.number().int().optional(),
    expiresAt: z.string().datetime().optional(),
  }),
});

export const MemoryProposalSchema = z.object({
  type: MemoryTypeSchema,
  scopeId: z.string().min(1),
  content: z.record(z.any()),
  sourceId: z.string().min(1),
  sensitivityHint: SensitivityLevelSchema.optional(),
  ttlSeconds: z.number().int().optional(),
});

export const MemoryQuerySchema = z.object({
  types: z.array(MemoryTypeSchema).optional(),
  scopeIds: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string()).optional(),
  queryText: z.string().optional(),
  limit: z.number().int().optional(),
  maxSensitivity: SensitivityLevelSchema.optional(),
});

export const AgentRoleSchema = z.enum(['main', 'worker', 'coordinator', 'external']);

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
    url: z.string().optional(),
    method: z.string().optional(),
    memoryType: MemoryTypeSchema.optional(),
    scopeId: z.string().optional(),
    component: z.string().optional(),
  }),
  sessionId: z.string().optional(),
  messageId: z.string().optional(),
  parentEventId: z.string().optional(),
  agentId: z.string().optional(),
  role: AgentRoleSchema.optional(),
  requestId: z.string().optional(),
  skillId: z.string().optional(),
  workerTemplate: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  previousHash: z.string().optional(),
  hash: z.string().optional(),
  redactedEventId: z.string().optional(),
});

export const SkillManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  workerTemplates: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      input: z.record(z.unknown()).optional(),
      output: z.record(z.unknown()).optional(),
      requiredCapabilities: z.array(z.string().min(1)),
    }),
  ).optional(), // Make optional as some skills might just be instructions
  requestedCapabilities: z.array(
    z.object({
      connector: z.string().min(1),
      action: z.string().min(1),
      resource: ResourceConstraintSchema,
      justification: z.string().min(1),
    }),
  ),
});

export const SkillContentSchema = z.object({
  instructions: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export const TrustLevelSchema = z.enum(['trusted', 'locally_trusted', 'untrusted']);

export const SkillProvenanceSchema = z.object({
  hash: z.string().min(1),
  signature: z.string().optional(),
  publicKey: z.string().optional(),
  trustLevel: TrustLevelSchema,
  verifiedAt: z.string().datetime(),
});

export const SkillSchema = z.object({
  manifest: SkillManifestSchema,
  status: z.enum(['enabled', 'disabled', 'pending_consent', 'emergency_disabled']),
  installedAt: z.string().datetime(),
  path: z.string().min(1),
  provenance: SkillProvenanceSchema.optional(),
});

export const PermissionDiffSchema = z.object({
  added: z.array(z.record(z.unknown())),
  removed: z.array(z.record(z.unknown())),
  changed: z.array(z.object({
    from: z.record(z.unknown()),
    to: z.record(z.unknown()),
  })),
});

export const SystemStatusSchema = z.object({
  mode: z.enum(['normal', 'emergency']),
  lastModeChange: z.string().datetime(),
  reason: z.string().optional(),
});

export const AgentStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'terminated']);

export const AgentSchema = z.object({
  id: z.string().min(1),
  role: AgentRoleSchema,
  status: AgentStatusSchema,
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  skillId: z.string().optional(),
  templateId: z.string().optional(),
  createdAt: z.string().datetime(),
  terminatedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const CoordinationPatternSchema = z.enum(['fan-out-fan-in', 'pipeline', 'supervisor']);

export const CoordinationEventSchema = z.object({
  id: z.string().min(1),
  pattern: CoordinationPatternSchema,
  initiatorAgentId: z.string().min(1),
  targetAgentIds: z.array(z.string().min(1)),
  status: z.enum(['proposed', 'active', 'completed', 'aborted']),
  metadata: z.record(z.unknown()).optional(),
});

export const ExternalAgentPrincipalSchema = z.object({
  type: z.literal('external_agent'),
  id: z.string().min(1),
  provider: z.string().min(1),
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  publicKey: z.string().optional(),
});

export const AgentManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
  authRequirements: z.array(z.string().min(1)),
  policyHints: z.record(z.unknown()).optional(),
});

export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type SensitivityLevel = z.infer<typeof SensitivityLevelSchema>;
export type FsResource = z.infer<typeof FsResourceSchema>;
export type FsResourceConstraint = z.infer<typeof FsResourceConstraintSchema>;
export type MemoryResource = z.infer<typeof MemoryResourceSchema>;
export type MemoryResourceConstraint = z.infer<typeof MemoryResourceConstraintSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type HttpResource = z.infer<typeof HttpResourceSchema>;
export type GenericResource = z.infer<typeof GenericResourceSchema>;
export type ResourceConstraint = z.infer<typeof ResourceConstraintSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type WorkerTemplate = z.infer<typeof WorkerTemplateSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type CapabilityTokenPayload = z.infer<typeof CapabilityTokenPayloadSchema>;
export type CapabilityToken = z.infer<typeof CapabilityTokenSchema>;
export type Grant = z.infer<typeof GrantSchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type PolicyStore = z.infer<typeof PolicyStoreSchema>;
export type MemoryItem = z.infer<typeof MemoryItemSchema>;
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;
export type MemoryQuery = z.infer<typeof MemoryQuerySchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type SkillProvenance = z.infer<typeof SkillProvenanceSchema>;
export type TrustLevel = z.infer<typeof TrustLevelSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type PermissionDiff = z.infer<typeof PermissionDiffSchema>;
export type SystemStatus = z.infer<typeof SystemStatusSchema>;
export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type CoordinationPattern = z.infer<typeof CoordinationPatternSchema>;
export type CoordinationEvent = z.infer<typeof CoordinationEventSchema>;
export type ExternalAgentPrincipal = z.infer<typeof ExternalAgentPrincipalSchema>;
export type AgentManifest = z.infer<typeof AgentManifestSchema>;
export type HttpResourceConstraint = z.infer<typeof HttpResourceConstraintSchema>;
export type GenericResourceConstraint = z.infer<typeof GenericResourceConstraintSchema>;
export type SkillContent = z.infer<typeof SkillContentSchema>;

