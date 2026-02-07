import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/policy.js';
import type { PolicyStore } from '../src/schemas.js';

describe('policy evaluation', () => {
  it('allows reads under the allowed root and denies outside', () => {
    const allowedRoot = path.resolve('sandbox', 'allowed');
    const allowedFile = path.join(allowedRoot, 'a.txt');
    const deniedFile = path.resolve('sandbox', 'denied', 'b.txt');

    const policy: PolicyStore = {
      grants: [
        {
          id: 'grant-1',
          subject: 'main-session',
          action: 'fs.readFile',
          resource: {
            type: 'fs',
            root: allowedRoot,
          },
        },
      ],
      rules: [],
    };

    const allowedDecision = evaluatePolicy({
      subject: 'main-session',
      action: 'fs.readFile',
      resource: { type: 'fs', path: allowedFile },
    }, policy);

    const deniedDecision = evaluatePolicy({
      subject: 'main-session',
      action: 'fs.readFile',
      resource: { type: 'fs', path: deniedFile },
    }, policy);

    expect(allowedDecision.allowed).toBe(true);
    expect(deniedDecision.allowed).toBe(false);
  });

  it('denies when there are no grants', () => {
    const policy: PolicyStore = { grants: [], rules: [] };
    const decision = evaluatePolicy({
      subject: 'main-session',
      action: 'fs.readFile',
      resource: { type: 'fs', path: path.resolve('sandbox', 'allowed', 'a.txt') },
    }, policy);

    expect(decision.allowed).toBe(false);
  });

  it('allows system and skill resource grants', () => {
    const policy: PolicyStore = {
      grants: [
        {
          id: 'system-grant',
          subject: 'agent-1',
          action: 'coordination.propose',
          resource: { type: 'system', components: ['worker'] },
        },
        {
          id: 'skill-grant',
          subject: 'agent-1',
          action: 'skill.execute',
          resource: { type: 'skill', components: ['demo.skill'] },
        },
      ],
      rules: [],
    };

    const systemDecision = evaluatePolicy(
      {
        subject: 'agent-1',
        action: 'coordination.propose',
        resource: { type: 'system', component: 'worker' },
      },
      policy,
    );

    const skillDecision = evaluatePolicy(
      {
        subject: 'agent-1',
        action: 'skill.execute',
        resource: { type: 'skill', id: 'demo.skill' },
      },
      policy,
    );

    expect(systemDecision.allowed).toBe(true);
    expect(skillDecision.allowed).toBe(true);
  });
});
