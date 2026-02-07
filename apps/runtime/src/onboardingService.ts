import crypto from 'node:crypto';
import {
  completeOnboarding,
  completeOnboardingTopic,
  getOrCreatePreferences,
  startOnboarding,
  updateUserContext,
} from './userPreferences.js';
import { syncGoalCheckInsForUser } from './goalCheckInService.js';

type OnboardingTopic = 'work' | 'personal' | 'goals';

export type OnboardingUpdateResult = {
  onboardingStarted: boolean;
  updated: boolean;
  topicsCompleted: OnboardingTopic[];
  goalsAdded: number;
  checkInsScheduled: number;
  onboardingCompleted: boolean;
};

function cleanExtractedValue(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[,.!?;:]+$/g, '')
    .slice(0, 180);
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function extractWorkContext(text: string): {
  role?: string;
  industry?: string;
  typicalHours?: string;
  timezone?: string;
} {
  const rolePatterns = [
    /\b(?:i am|i'm|my role is|i work as)\s+(?:an?\s+)?([a-z][a-z0-9/&,\- ]{2,80})/i,
    /\b(?:my job is|i do)\s+(?:an?\s+)?([a-z][a-z0-9/&,\- ]{2,80})/i,
  ];
  const industryPattern = /\b(?:in|within)\s+(?:the\s+)?([a-z][a-z0-9/&,\- ]{2,50})\s+industry\b/i;
  const hoursPatterns = [
    /\b(\d{1,2}\s*(?:am|pm)\s*(?:-|to|–|—)\s*\d{1,2}\s*(?:am|pm))\b/i,
    /\b(\d{1,2}\s*(?:-|to|–|—)\s*\d{1,2}\s*(?:am|pm)?)\b/i,
  ];
  const timezonePattern = /\b(?:timezone(?:\s+is)?|tz)\s*[:\-]?\s*([A-Za-z0-9_\/+\-]{2,50})\b/i;

  const result: {
    role?: string;
    industry?: string;
    typicalHours?: string;
    timezone?: string;
  } = {};

  for (const pattern of rolePatterns) {
    const match = text.match(pattern);
    const candidate = match?.[1] ? cleanExtractedValue(match[1]) : '';
    if (candidate.length >= 3 && candidate.length <= 80) {
      result.role = candidate;
      break;
    }
  }

  const industryMatch = text.match(industryPattern);
  if (industryMatch?.[1]) {
    const candidate = cleanExtractedValue(industryMatch[1]);
    if (candidate.length >= 3) {
      result.industry = candidate;
    }
  }

  for (const pattern of hoursPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = cleanExtractedValue(match[1]);
      if (candidate.length >= 3) {
        result.typicalHours = candidate;
        break;
      }
    }
  }

  const timezoneMatch = text.match(timezonePattern);
  if (timezoneMatch?.[1]) {
    const candidate = cleanExtractedValue(timezoneMatch[1]);
    if (candidate.length >= 2) {
      result.timezone = candidate;
    }
  }

  return result;
}

function extractPersonalContext(text: string): {
  familyContext?: string;
  preferredContactTimes?: string;
} {
  const sentences = splitSentences(text);
  const familyKeywords = /\b(family|kids|children|spouse|partner|roommate|parents|live with)\b/i;
  const contactPattern = /\b(?:prefer(?:red)?\s+(?:contact\s+)?times?|best time(?:s)?|don't notify me|do not notify me|message me|contact me)\b[:\s-]*([^.!?\n]{4,120})/i;

  const result: {
    familyContext?: string;
    preferredContactTimes?: string;
  } = {};

  const familySentence = sentences.find((sentence) => familyKeywords.test(sentence));
  if (familySentence) {
    result.familyContext = cleanExtractedValue(familySentence);
  }

  const contactMatch = text.match(contactPattern);
  if (contactMatch?.[1]) {
    result.preferredContactTimes = cleanExtractedValue(contactMatch[1]);
  }

  return result;
}

function normalizeGoalText(goal: string): string {
  return goal.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function inferGoalCategory(goal: string): 'professional' | 'personal' | 'learning' {
  const lower = goal.toLowerCase();
  if (/\b(learn|learning|study|course|certification|practice)\b/.test(lower)) {
    return 'learning';
  }
  if (/\b(work|job|client|project|career|business|team|code|product|quarter|deadline)\b/.test(lower)) {
    return 'professional';
  }
  return 'personal';
}

function extractGoalCandidates(text: string): string[] {
  const sentences = splitSentences(text);
  const trigger = /\b(goal|working on|focused on|trying to|want to|plan to|planning to|learning|learn|improve|build|launch|finish|complete)\b/i;
  const leadIn = /^(?:my goals?\s+(?:are|is)\s+|my goals?\s*:\s*|i(?:'m| am)?\s+(?:currently\s+)?(?:working on|focused on|trying to|want to|plan to|planning to|learning)\s+|goal:\s*)/i;

  const extracted: string[] = [];
  for (const sentence of sentences) {
    if (!trigger.test(sentence)) continue;
    let candidate = sentence.replace(leadIn, '').trim();
    candidate = candidate.replace(/^to\s+/i, '').trim();
    candidate = cleanExtractedValue(candidate);
    if (candidate.length < 8 || candidate.length > 160) continue;
    extracted.push(candidate);
  }

  return Array.from(new Set(extracted)).slice(0, 4);
}

function isTopicCovered(prefs: Awaited<ReturnType<typeof getOrCreatePreferences>>, topic: OnboardingTopic): boolean {
  if (topic === 'work') {
    return Boolean(
      prefs.userContext.work.role
      || prefs.userContext.work.industry
      || prefs.userContext.work.typicalHours
      || prefs.userContext.work.timezone,
    );
  }
  if (topic === 'personal') {
    return Boolean(
      prefs.userContext.personal.familyContext
      || prefs.userContext.personal.preferredContactTimes,
    );
  }
  return prefs.userContext.goals.length > 0;
}

export async function processOnboardingMessage(
  userId: string,
  message: string,
): Promise<OnboardingUpdateResult> {
  const text = message.trim();
  if (!text) {
    return {
      onboardingStarted: false,
      updated: false,
      topicsCompleted: [],
      goalsAdded: 0,
      checkInsScheduled: 0,
      onboardingCompleted: false,
    };
  }

  let prefs = await getOrCreatePreferences(userId);
  let onboardingStarted = false;
  if (prefs.onboarding.phase === 'not_started') {
    await startOnboarding(userId);
    onboardingStarted = true;
    prefs = await getOrCreatePreferences(userId);
  }

  const workUpdate = extractWorkContext(text);
  const personalUpdate = extractPersonalContext(text);
  const goalCandidates = extractGoalCandidates(text);

  const existingGoalKeys = new Set(prefs.userContext.goals.map((goal) => normalizeGoalText(goal.description)));
  const newGoals = goalCandidates
    .map((description) => ({
      id: crypto.randomUUID(),
      description,
      category: inferGoalCategory(description),
      createdAt: new Date().toISOString(),
      checkInScheduled: false,
    }))
    .filter((goal) => {
      const key = normalizeGoalText(goal.description);
      if (!key || existingGoalKeys.has(key)) return false;
      existingGoalKeys.add(key);
      return true;
    })
    .slice(0, 3);

  const hasWorkUpdate = Object.values(workUpdate).some((value) => typeof value === 'string' && value.trim().length > 0);
  const hasPersonalUpdate = Object.values(personalUpdate).some((value) => typeof value === 'string' && value.trim().length > 0);

  const contextUpdate: {
    work?: { role?: string; industry?: string; typicalHours?: string; timezone?: string };
    personal?: { familyContext?: string; preferredContactTimes?: string };
    goals?: Array<{
      id: string;
      description: string;
      category: 'professional' | 'personal' | 'learning';
      createdAt: string;
      checkInScheduled: boolean;
    }>;
  } = {};
  if (hasWorkUpdate) contextUpdate.work = workUpdate;
  if (hasPersonalUpdate) contextUpdate.personal = personalUpdate;
  if (newGoals.length > 0) {
    contextUpdate.goals = [...prefs.userContext.goals, ...newGoals];
  }

  const updated = hasWorkUpdate || hasPersonalUpdate || newGoals.length > 0;
  if (updated) {
    await updateUserContext(userId, contextUpdate);
    prefs = await getOrCreatePreferences(userId);
  }

  const topicsCompleted: OnboardingTopic[] = [];
  for (const topic of ['work', 'personal', 'goals'] as const) {
    if (!prefs.onboarding.coveredTopics.includes(topic) && isTopicCovered(prefs, topic)) {
      await completeOnboardingTopic(userId, topic);
      topicsCompleted.push(topic);
    }
  }

  if (topicsCompleted.length > 0) {
    prefs = await getOrCreatePreferences(userId);
  }

  let onboardingCompleted = false;
  const allTopicsCovered = (['work', 'personal', 'goals'] as const).every((topic) =>
    prefs.onboarding.coveredTopics.includes(topic),
  );
  if (allTopicsCovered && !prefs.onboarding.completed) {
    await completeOnboarding(userId);
    onboardingCompleted = true;
  }

  const scheduleResult = await syncGoalCheckInsForUser(userId);

  return {
    onboardingStarted,
    updated,
    topicsCompleted,
    goalsAdded: newGoals.length,
    checkInsScheduled: scheduleResult.scheduled,
    onboardingCompleted,
  };
}
