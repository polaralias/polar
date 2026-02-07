import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { z } from 'zod';
import { runtimeConfig } from './config.js';
import { appendAudit } from './audit.js';
import { appendMessage } from './messageStore.js';
import { listSessions } from './sessions.js';
import { getOrCreatePreferences, updateUserContext } from './userPreferences.js';

const mutex = new Mutex();
const GOAL_CHECKINS_PATH = path.join(runtimeConfig.dataDir, 'goal_checkins.json');

const GoalCheckInStatusSchema = z.enum(['pending', 'sent']);

const GoalCheckInSchema = z.object({
  id: z.string(),
  userId: z.string(),
  goalId: z.string(),
  goalDescription: z.string(),
  goalCategory: z.enum(['professional', 'personal', 'learning']),
  dueAt: z.string(),
  createdAt: z.string(),
  status: GoalCheckInStatusSchema,
  sentAt: z.string().optional(),
});

export type GoalCheckIn = z.infer<typeof GoalCheckInSchema>;

function addMonths(base: Date, months: number): Date {
  const result = new Date(base);
  result.setMonth(result.getMonth() + months);
  return result;
}

async function loadGoalCheckInsUnsafe(): Promise<GoalCheckIn[]> {
  try {
    const raw = await fs.readFile(GOAL_CHECKINS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: GoalCheckIn[] = [];
    for (const entry of parsed) {
      const validated = GoalCheckInSchema.safeParse(entry);
      if (validated.success) {
        result.push(validated.data);
      }
    }
    return result;
  } catch {
    return [];
  }
}

async function saveGoalCheckInsUnsafe(entries: GoalCheckIn[]): Promise<void> {
  await fs.mkdir(runtimeConfig.dataDir, { recursive: true });
  const tempPath = `${GOAL_CHECKINS_PATH}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(entries, null, 2), 'utf-8');
  await fs.rename(tempPath, GOAL_CHECKINS_PATH);
}

export async function listGoalCheckIns(options: {
  userId?: string;
  status?: 'pending' | 'sent';
} = {}): Promise<GoalCheckIn[]> {
  return mutex.runExclusive(async () => {
    const entries = await loadGoalCheckInsUnsafe();
    return entries
      .filter((entry) => (!options.userId || entry.userId === options.userId) && (!options.status || entry.status === options.status))
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  });
}

export async function ensureGoalCheckInScheduled(params: {
  userId: string;
  goalId: string;
  goalDescription: string;
  goalCategory: 'professional' | 'personal' | 'learning';
  createdAt?: string;
}): Promise<{ created: boolean; checkIn: GoalCheckIn }> {
  return mutex.runExclusive(async () => {
    const entries = await loadGoalCheckInsUnsafe();
    const existing = entries.find((entry) => entry.userId === params.userId && entry.goalId === params.goalId);
    if (existing) {
      return { created: false, checkIn: existing };
    }

    const baseDate = params.createdAt ? new Date(params.createdAt) : new Date();
    const dueAt = addMonths(
      Number.isNaN(baseDate.getTime()) ? new Date() : baseDate,
      runtimeConfig.goalCheckInMonths,
    );
    const checkIn: GoalCheckIn = {
      id: crypto.randomUUID(),
      userId: params.userId,
      goalId: params.goalId,
      goalDescription: params.goalDescription,
      goalCategory: params.goalCategory,
      createdAt: new Date().toISOString(),
      dueAt: dueAt.toISOString(),
      status: 'pending',
    };

    entries.push(checkIn);
    await saveGoalCheckInsUnsafe(entries);
    return { created: true, checkIn };
  });
}

export async function syncGoalCheckInsForUser(userId: string): Promise<{ scheduled: number }> {
  const prefs = await getOrCreatePreferences(userId);
  const existing = await listGoalCheckIns({ userId });
  let scheduled = 0;
  let touched = false;

  const nextGoals = prefs.userContext.goals.map((goal) => {
    if (goal.checkInScheduled) {
      return goal;
    }

    const hasExisting = existing.some((entry) => entry.goalId === goal.id);
    if (hasExisting) {
      touched = true;
      return { ...goal, checkInScheduled: true };
    }

    return goal;
  });

  for (const goal of nextGoals) {
    if (!goal.checkInScheduled) {
      const result = await ensureGoalCheckInScheduled({
        userId,
        goalId: goal.id,
        goalDescription: goal.description,
        goalCategory: goal.category,
        createdAt: goal.createdAt,
      });
      if (result.created) {
        scheduled += 1;
      }
      touched = true;
      goal.checkInScheduled = true;
    }
  }

  if (touched) {
    await updateUserContext(userId, { goals: nextGoals });
  }

  return { scheduled };
}

async function markGoalCheckInSent(checkInId: string): Promise<void> {
  await mutex.runExclusive(async () => {
    const entries = await loadGoalCheckInsUnsafe();
    const index = entries.findIndex((entry) => entry.id === checkInId);
    if (index < 0) return;
    const current = entries[index];
    if (!current || current.status === 'sent') return;
    entries[index] = {
      ...current,
      status: 'sent',
      sentAt: new Date().toISOString(),
    };
    await saveGoalCheckInsUnsafe(entries);
  });
}

async function dispatchGoalCheckIn(checkIn: GoalCheckIn): Promise<void> {
  const notificationText = `[Goal Check-in] You said you were working on "${checkIn.goalDescription}". How is it going?`;

  let deliveredChannels = 0;
  try {
    const { broadcastUserMessage } = await import('./channelService.js');
    deliveredChannels = await broadcastUserMessage(checkIn.userId, notificationText);
  } catch (error) {
    console.error('Goal check-in channel delivery failed:', error);
  }

  const latestSession = listSessions('active')
    .filter((session) => session.subject === checkIn.userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (latestSession) {
    await appendMessage({
      sessionId: latestSession.id,
      role: 'assistant',
      content: notificationText,
    });
  }

  await appendAudit({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    subject: checkIn.userId,
    action: 'preferences.goal_checkin_dispatch',
    decision: 'allow',
    resource: { type: 'system', component: 'preferences' },
    ...(latestSession ? { sessionId: latestSession.id } : {}),
    requestId: crypto.randomUUID(),
    metadata: {
      checkInId: checkIn.id,
      goalId: checkIn.goalId,
      dueAt: checkIn.dueAt,
      deliveredChannels,
    },
  });

  await markGoalCheckInSent(checkIn.id);
}

let dispatchInProgress = false;
let serviceStarted = false;

export async function runGoalCheckInDispatchCycle(): Promise<void> {
  if (dispatchInProgress) return;
  dispatchInProgress = true;
  try {
    const now = Date.now();
    const due = await listGoalCheckIns({ status: 'pending' });
    const ready = due.filter((entry) => new Date(entry.dueAt).getTime() <= now);
    for (const checkIn of ready) {
      await dispatchGoalCheckIn(checkIn);
    }
  } finally {
    dispatchInProgress = false;
  }
}

export function startGoalCheckInService(): void {
  if (serviceStarted) return;
  serviceStarted = true;

  void runGoalCheckInDispatchCycle();
  const timer = setInterval(() => {
    void runGoalCheckInDispatchCycle();
  }, runtimeConfig.goalCheckInPollMs);
  timer.unref();
}
