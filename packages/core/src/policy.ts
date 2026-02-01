import path from 'node:path';
import {
  Grant,
  PolicyRule,
  PolicyStore,
  Resource,
  ResourceConstraint,
  FsResourceConstraint,
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

export function matchesResourceConstraint(
  constraint: ResourceConstraint,
  resource: Resource,
): boolean {
  if (constraint.type !== resource.type) {
    return false;
  }

  if (constraint.type === 'fs') {
    return matchesFsConstraint(constraint, resource.path);
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
  if (request.resource.type === 'fs') {
    const fsConstraint: FsResourceConstraint = {
      type: 'fs',
      paths: [normalizePath(request.resource.path)],
    };

    if (grant.resource.type === 'fs' && grant.resource.root) {
      fsConstraint.root = normalizePath(grant.resource.root);
    }

    return {
      resource: fsConstraint,
      fields: grant.fields,
    };
  }

  return {
    resource: grant.resource,
    fields: grant.fields,
  };
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
