import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE, SESSION_TTL_MS } from './sessions';

export function setSessionCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Context, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure, sameSite: 'Strict' });
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export const requireJson: MiddlewareHandler = async (c, next) => {
  if (!BODY_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  const type = c.req.header('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  await next();
};
