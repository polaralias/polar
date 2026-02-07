import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tempDir = path.join(os.tmpdir(), `polar-runtime-onboarding-test-${Date.now()}`);
process.env.RUNTIME_DATA_DIR = tempDir;

let processOnboardingMessage: (userId: string, message: string) => Promise<{
  onboardingStarted: boolean;
  updated: boolean;
  topicsCompleted: Array<'work' | 'personal' | 'goals'>;
  goalsAdded: number;
  checkInsScheduled: number;
  onboardingCompleted: boolean;
}>;
let getOrCreatePreferences: (userId: string) => Promise<{
  onboarding: { phase: string; completed: boolean; coveredTopics: string[] };
  userContext: {
    work: { role?: string; industry?: string; typicalHours?: string; timezone?: string };
    personal: { familyContext?: string; preferredContactTimes?: string };
    goals: Array<{ id: string; description: string; checkInScheduled: boolean }>;
  };
}>;
let listGoalCheckIns: (options?: { userId?: string; status?: 'pending' | 'sent' }) => Promise<Array<{ goalDescription: string; status: string; dueAt: string }>>;

describe('onboarding personalization extraction', () => {
  beforeAll(async () => {
    const onboarding = await import('../src/onboardingService.js');
    const preferences = await import('../src/userPreferences.js');
    const checkIns = await import('../src/goalCheckInService.js');

    processOnboardingMessage = onboarding.processOnboardingMessage;
    getOrCreatePreferences = preferences.getOrCreatePreferences;
    listGoalCheckIns = checkIns.listGoalCheckIns as (options?: { userId?: string; status?: 'pending' | 'sent' }) => Promise<Array<{ goalDescription: string; status: string; dueAt: string }>>;
  });

  beforeEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('extracts onboarding context and schedules goal check-ins', async () => {
    const userId = 'tester';

    const firstPass = await processOnboardingMessage(
      userId,
      "I'm a software engineer in fintech industry. I work 9am-5pm. Timezone is America/New_York. I'm working on learning Rust this year.",
    );

    expect(firstPass.onboardingStarted).toBe(true);
    expect(firstPass.updated).toBe(true);
    expect(firstPass.goalsAdded).toBeGreaterThan(0);
    expect(firstPass.checkInsScheduled).toBeGreaterThan(0);
    expect(firstPass.topicsCompleted).toContain('work');
    expect(firstPass.topicsCompleted).toContain('goals');
    expect(firstPass.onboardingCompleted).toBe(false);

    const prefsAfterFirst = await getOrCreatePreferences(userId);
    expect(prefsAfterFirst.userContext.work.role?.toLowerCase()).toContain('software engineer');
    expect(prefsAfterFirst.userContext.work.industry?.toLowerCase()).toContain('fintech');
    expect(prefsAfterFirst.userContext.goals.length).toBeGreaterThan(0);
    expect(prefsAfterFirst.userContext.goals[0]?.checkInScheduled).toBe(true);
    expect(prefsAfterFirst.onboarding.phase).toBe('in_progress');

    const secondPass = await processOnboardingMessage(
      userId,
      'I live with my partner and two kids. Do not notify me during dinner.',
    );

    expect(secondPass.topicsCompleted).toContain('personal');
    expect(secondPass.onboardingCompleted).toBe(true);

    const prefsAfterSecond = await getOrCreatePreferences(userId);
    expect(prefsAfterSecond.onboarding.completed).toBe(true);
    expect(prefsAfterSecond.onboarding.coveredTopics).toEqual(expect.arrayContaining(['work', 'personal', 'goals']));

    const checkIns = await listGoalCheckIns({ userId, status: 'pending' });
    expect(checkIns.length).toBeGreaterThan(0);
    expect(checkIns[0]?.status).toBe('pending');
    expect(typeof checkIns[0]?.dueAt).toBe('string');
  });
});
