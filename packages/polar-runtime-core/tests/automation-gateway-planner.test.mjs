import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createAutomationGateway } from '../src/automation-gateway.mjs';

function createPassThroughMiddleware() {
  return {
    async run(context, handler) {
      return handler(context.input);
    },
  };
}

describe('automation gateway planner adaptation', () => {
  it('accepts high-confidence propose decision', async () => {
    const gateway = createAutomationGateway({
      middlewarePipeline: createPassThroughMiddleware(),
      automationAuthoring: {
        async draftFromIntent() {
          return {
            decision: 'propose',
            confidence: 0.82,
            summary: 'Check inbox and notify me.',
            schedule: { kind: 'interval', expression: 'every 2 hours' },
            runScope: { sessionId: 'attempted-override', userId: 'attempted-override' },
            limits: {
              maxNotificationsPerDay: 9,
              quietHours: { startHour: 23, endHour: 6, timezone: 'UTC' },
            },
            riskHints: { mayWrite: false, requiresApproval: false },
          };
        },
      },
    });

    const result = await gateway.draftFromIntent({
      sessionId: 's-1',
      userId: 'u-1',
      defaultProfileId: 'p-1',
      intentText: 'Please check every two hours',
    });

    assert.strictEqual(result.status, 'drafted');
    assert.deepStrictEqual(result.schedule, { kind: 'hourly', intervalHours: 2 });
    assert.strictEqual(result.runScope.sessionId, 's-1');
    assert.strictEqual(result.runScope.userId, 'u-1');
  });

  it('rejects skip decision', async () => {
    const gateway = createAutomationGateway({
      middlewarePipeline: createPassThroughMiddleware(),
      automationAuthoring: {
        async draftFromIntent() {
          return {
            decision: 'skip',
            confidence: 0.9,
            summary: 'Not enough scope to build a safe automation.',
            schedule: { kind: 'daily', expression: '09:00' },
            runScope: { sessionId: 's-1', userId: 'u-1' },
            limits: {},
            riskHints: { mayWrite: false, requiresApproval: false },
          };
        },
      },
    });

    const result = await gateway.draftFromIntent({
      sessionId: 's-1',
      userId: 'u-1',
      defaultProfileId: 'p-1',
      intentText: 'skip this',
    });

    assert.strictEqual(result.status, 'rejected');
    assert.match(result.reason, /Not enough scope/i);
  });

  it('clamps clarify and low-confidence responses into confirmation reason', async () => {
    const gateway = createAutomationGateway({
      middlewarePipeline: createPassThroughMiddleware(),
      automationAuthoring: {
        async draftFromIntent() {
          return {
            decision: 'clarify',
            confidence: 0.24,
            summary: 'Draft needs confirmation.',
            schedule: { kind: 'daily', expression: '09:00' },
            runScope: { sessionId: 's-1', userId: 'u-1' },
            limits: {},
            riskHints: { mayWrite: false, requiresApproval: false },
            clarificationQuestion: 'Should this run every day at 09:00 UTC?',
          };
        },
      },
    });

    const result = await gateway.draftFromIntent({
      sessionId: 's-1',
      userId: 'u-1',
      defaultProfileId: 'p-1',
      intentText: 'clarify this',
    });

    assert.strictEqual(result.status, 'drafted');
    assert.strictEqual(result.reason, 'Should this run every day at 09:00 UTC?');
  });
});
