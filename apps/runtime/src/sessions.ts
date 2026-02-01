import crypto from 'node:crypto';
import { Session } from '@polar/core';

const sessions = new Map<string, Session>();

export function createSession(subject = 'main-session'): Session {
  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    subject,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}
