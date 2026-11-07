import { createHmac, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { sessions } from '../db/schema';

export const SESSION_COOKIE = 'shirei_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export async function startSession(db: Database, opts: { secret: string; nowMs: number }): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    id: hashToken(opts.secret, token),
    expiresAt: opts.nowMs + SESSION_TTL_MS,
    createdAt: opts.nowMs,
  });
  return token;
}

export async function resolveSession(
  db: Database,
  opts: { secret: string; token: string; nowMs: number },
): Promise<{ sessionId: string } | null> {
  if (!TOKEN.test(opts.token)) return null;
  const sessionId = hashToken(opts.secret, opts.token);
  const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt <= opts.nowMs) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  return { sessionId };
}

export async function endSession(db: Database, opts: { secret: string; token: string }): Promise<void> {
  if (!TOKEN.test(opts.token)) return;
  await db.delete(sessions).where(eq(sessions.id, hashToken(opts.secret, opts.token)));
}
