import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createOrchestrator } from '../src/orchestrator.mjs';

function setupOrchestrator(plannerPayload) {
  const mockProviderGateway = {
    async generate() {
      return { text: JSON.stringify(plannerPayload) };
    },
  };

  return createOrchestrator({
    profileResolutionGateway: {
      async resolve() {
        return {
          profileConfig: {
            modelPolicy: { providerId: 'test', modelId: 'test-model' },
            allowedSkills: [],
            systemPrompt: 'system',
          },
        };
      },
    },
    chatManagementGateway: {
      async appendMessage() {
        return { status: 'appended' };
      },
      async getSessionHistory() {
        return { items: [] };
      },
    },
    providerGateway: mockProviderGateway,
    extensionGateway: {
      listStates() { return []; },
      async execute() { return { status: 'completed' }; },
      getState() { return null; },
    },
    approvalStore: {
      hasValidGrant() { return false; },
      issueGrant() { return { grantId: 'g-1' }; },
    },
    gateway: {
      async getConfig() {
        return { status: 'not_found' };
      },
    },
    now: () => 1000,
  });
}

describe('orchestrator automation planner integration', () => {
  it('creates automation proposal from high-confidence planner response and enforces caps', async () => {
    const orchestrator = setupOrchestrator({
      decision: 'propose',
      confidence: 0.9,
      summary: 'Check my inbox for critical updates',
      schedule: { kind: 'interval', expression: 'every 1 hours' },
      runScope: { sessionId: 'override', userId: 'override' },
      limits: {
        maxNotificationsPerDay: 100,
        quietHours: { startHour: 27, endHour: -2, timezone: '' },
      },
      riskHints: { mayWrite: true, requiresApproval: false },
    });

    const result = await orchestrator.orchestrate({
      sessionId: 's-1',
      userId: 'u-1',
      text: 'Please monitor my inbox hourly',
    });

    assert.strictEqual(result.status, 'automation_proposed');
    assert.strictEqual(result.proposal.schedule, 'every 1 hours');
    assert.strictEqual(result.proposal.limits.maxNotificationsPerDay, 3);
    assert.deepStrictEqual(result.proposal.quietHours, {
      startHour: 23,
      endHour: 0,
      timezone: 'UTC',
    });
    assert.strictEqual(result.proposal.approvalRequired, true);
  });

  it('returns deterministic clarification text on low confidence', async () => {
    const orchestrator = setupOrchestrator({
      decision: 'propose',
      confidence: 0.31,
      summary: 'Need confirmation',
      schedule: { kind: 'daily', expression: '09:00' },
      runScope: { sessionId: 's-1', userId: 'u-1' },
      limits: { maxNotificationsPerDay: 1 },
      riskHints: { mayWrite: false, requiresApproval: false },
      clarificationQuestion: 'Should I set this automation for 09:00 UTC daily?',
    });

    const result = await orchestrator.orchestrate({
      sessionId: 's-1',
      userId: 'u-1',
      text: 'Set a morning reminder',
    });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.type, 'automation_clarification');
    assert.strictEqual(result.text, 'Should I set this automation for 09:00 UTC daily?');
  });
});
