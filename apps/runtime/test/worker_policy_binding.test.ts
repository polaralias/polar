import { describe, expect, it } from 'vitest';
import { resolveWorkerPolicyVersionSubject } from '../src/workerRuntime.js';

describe('worker token policy binding', () => {
  it('binds worker token revocation to the spawning user subject', () => {
    const subject = resolveWorkerPolicyVersionSubject({
      id: 'agent-123',
      role: 'worker',
      status: 'pending',
      sessionId: 'session-1',
      userId: 'user-abc',
      createdAt: new Date().toISOString(),
    });

    expect(subject).toBe('user-abc');
  });
});
