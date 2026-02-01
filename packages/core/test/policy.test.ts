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
});
