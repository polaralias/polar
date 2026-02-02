import crypto from 'node:crypto';
import { Session } from '@polar/core';

interface ExtendedSession extends Session {
  terminatedAt?: string;
}

const sessions = new Map<string, ExtendedSession>();

export function createSession(subject = 'main-session', projectPath?: string): ExtendedSession {
  const session: ExtendedSession = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    subject,
    projectPath,
    status: 'active',
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): ExtendedSession | undefined {
  return sessions.get(id);
}

export function terminateSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;

  session.status = 'terminated';
  session.terminatedAt = new Date().toISOString();
  sessions.set(id, session);
  return true;
}

export function listSessions(status?: 'active' | 'terminated'): ExtendedSession[] {
  const allSessions = Array.from(sessions.values());
  if (status) {
    return allSessions.filter(s => s.status === status);
  }
  return allSessions;
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}
