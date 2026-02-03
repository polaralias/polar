import path from 'node:path';
import {
  Grant,
  PolicyRule,
  PolicyStore,
  Resource,
  ResourceConstraint,
  FsResourceConstraint,
  MemoryResourceConstraint,
  MemoryResource,
  HttpResourceConstraint,
  HttpResource,
  GenericResourceConstraint,
  GenericResource,
  CliResourceConstraint,
  CliResource,
} from './schemas.js';

export type PolicyDecision = {
  allowed: boolean;
  reason?: string;
  capabilityConstraints?: {
    resource: ResourceConstraint;
    fields?: string[];
  };
};

export type PolicyRequest = {
  subject: string;
  action: string;
  resource: Resource;
};

export function normalizePath(inputPath: string): string {
  return path.resolve(inputPath);
}

export function isPathWithin(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? true
    : normalizedRoot === normalizedTarget;
}

function matchesFsConstraint(constraint: FsResourceConstraint, resourcePath: string): boolean {
  const normalizedTarget = normalizePath(resourcePath);
  const normalizedRoot = constraint.root ? normalizePath(constraint.root) : undefined;
  const normalizedPaths = constraint.paths?.map(normalizePath);

  const matchesRoot = normalizedRoot ? isPathWithin(normalizedRoot, normalizedTarget) : true;
  const matchesPaths = normalizedPaths
    ? normalizedPaths.some((allowedPath) => isPathWithin(allowedPath, normalizedTarget))
    : true;

  return matchesRoot && matchesPaths;
}

function matchesMemoryConstraint(
  constraint: MemoryResourceConstraint,
  resource: MemoryResource,
): boolean {
  const matchesType = constraint.memoryType ? constraint.memoryType === resource.memoryType : true;
  const matchesScope = constraint.scopeIds
    ? resource.scopeId
      ? constraint.scopeIds.includes(resource.scopeId)
      : false
    : true;

  return matchesType && matchesScope;
}

function matchesHttpConstraint(constraint: HttpResourceConstraint, resource: HttpResource): boolean {
  if (constraint.allowMethods && resource.method && !constraint.allowMethods.includes(resource.method)) {
    return false;
  }

  if (constraint.allowHosts) {
    try {
      const url = new URL(resource.url);
      const host = url.hostname;
      const matches = constraint.allowHosts.some(pattern => {
        if (pattern.startsWith('*.')) {
          const suffix = pattern.slice(2);
          return host === suffix || host.endsWith('.' + suffix);
        }
        return host === pattern;
      });
      if (!matches) return false;
    } catch {
      return false; // Invalid URL
    }
  }

  return true;
}

function matchesGenericConstraint(constraint: GenericResourceConstraint, resource: GenericResource): boolean {
  if (constraint.connectorId !== resource.connectorId) return false;
  if (constraint.constraints.resourceIds && Array.isArray(constraint.constraints.resourceIds)) {
    return constraint.constraints.resourceIds.includes(resource.resourceId);
  }
  return true;
}

function matchesCliConstraint(constraint: CliResourceConstraint, resource: CliResource): boolean {
  if (constraint.commands && !constraint.commands.includes(resource.command)) {
    return false;
  }
  return true;
}

export function matchesResourceConstraint(
  constraint: ResourceConstraint,
  resource: Resource,
): boolean {
  if (constraint.type !== resource.type) {
    return false;
  }

  if (constraint.type === 'fs' && resource.type === 'fs') {
    return matchesFsConstraint(constraint, resource.path);
  }

  if (constraint.type === 'memory' && resource.type === 'memory') {
    return matchesMemoryConstraint(constraint, resource);
  }

  if (constraint.type === 'http' && resource.type === 'http') {
    return matchesHttpConstraint(constraint, resource);
  }

  if (constraint.type === 'connector' && resource.type === 'connector') {
    return matchesGenericConstraint(constraint, resource);
  }

  if (constraint.type === 'cli' && resource.type === 'cli') {
    return matchesCliConstraint(constraint, resource);
  }

  return false;
}

function isGrantActive(grant: Grant, nowEpoch: number): boolean {
  return grant.expiresAt ? grant.expiresAt > nowEpoch : true;
}

function matchesPolicyRule(rule: PolicyRule, request: PolicyRequest): boolean {
  if (rule.subject && rule.subject !== request.subject) {
    return false;
  }
  if (rule.action && rule.action !== request.action) {
    return false;
  }
  if (rule.resource && !matchesResourceConstraint(rule.resource, request.resource)) {
    return false;
  }
  return true;
}

function buildCapabilityConstraints(
  grant: Grant,
  request: PolicyRequest,
): { resource: ResourceConstraint; fields?: string[] } {
  const constraints: { resource: ResourceConstraint; fields?: string[] } = {
    resource: grant.resource,
  };

  if (grant.fields) {
    constraints.fields = grant.fields;
  }

  if (request.resource.type === 'fs') {
    const fsConstraint: FsResourceConstraint = {
      type: 'fs',
      paths: [normalizePath(request.resource.path)],
    };

    if (grant.resource.type === 'fs' && grant.resource.root) {
      fsConstraint.root = normalizePath(grant.resource.root);
    }

    constraints.resource = fsConstraint;
  } else if (request.resource.type === 'memory') {
    const memoryConstraint: MemoryResourceConstraint = {
      type: 'memory',
      memoryType: request.resource.memoryType,
      scopeIds: request.resource.scopeId ? [request.resource.scopeId] : undefined,
    };

    constraints.resource = memoryConstraint;
  } else if (request.resource.type === 'http') {
    try {
      const httpConstraint: HttpResourceConstraint = {
        type: 'http',
        allowHosts: [new URL(request.resource.url).hostname],
        allowMethods: request.resource.method ? [request.resource.method] : undefined,
      };
      constraints.resource = httpConstraint;
    } catch {
      // Fallback
    }
  } else if (request.resource.type === 'connector') {
    const genericConstraint: GenericResourceConstraint = {
      type: 'connector',
      connectorId: request.resource.connectorId,
      constraints: { resourceIds: [request.resource.resourceId] },
    };
    constraints.resource = genericConstraint;
  } else if (request.resource.type === 'cli') {
    const cliConstraint: CliResourceConstraint = {
      type: 'cli',
      commands: [request.resource.command]
    };
    constraints.resource = cliConstraint;
  }

  return constraints;
}

export function evaluatePolicy(
  request: PolicyRequest,
  policy: PolicyStore,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): PolicyDecision {
  const denyRule = policy.rules.find(
    (rule) => rule.effect === 'deny' && matchesPolicyRule(rule, request),
  );

  if (denyRule) {
    return {
      allowed: false,
      reason: denyRule.reason ?? 'Denied by policy rule',
    };
  }

  const matchingGrant = policy.grants.find(
    (grant) =>
      grant.subject === request.subject &&
      grant.action === request.action &&
      isGrantActive(grant, nowEpochSeconds) &&
      matchesResourceConstraint(grant.resource, request.resource),
  );

  if (!matchingGrant) {
    return {
      allowed: false,
      reason: 'No matching grant',
    };
  }

  return {
    allowed: true,
    capabilityConstraints: buildCapabilityConstraints(matchingGrant, request),
  };
}
