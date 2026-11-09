import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { loginAddress } from './clientAddress';
import { hashPassword } from './password';
import { openDatabase, type DbHandle } from '../db/client';
import { runMigrations } from '../db/migrate';
import { parseEnv } from '../env';

const require = createRequire(import.meta.url);
const migrationsDir = fileURLToPath(new URL('../../drizzle', import.meta.url));
const handles: DbHandle[] = [];

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
});

async function buildApp() {
  const handle = await openDatabase('file::memory:');
  handles.push(handle);
  await runMigrations(handle.client, migrationsDir);
  const keys = (require('web-push') as { generateVAPIDKeys(): { publicKey: string; privateKey: string } }).generateVAPIDKeys();
  const password = 'correct-horse';
  const env = parseEnv({
    SESSION_SECRET: 's'.repeat(32),
    AUTH_PASSWORD_HASH: await hashPassword(password, { N: 1024, r: 8, p: 1 }),
    RUNNER_TOKEN: 't'.repeat(16),
    COOKIE_SECURE: 'false',
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: 'mailto:shirei@hakanam.my.id',
  });
  return { app: createApp({ env, db: handle.db }), password };
}

function post(app: ReturnType<typeof createApp>, ip: string, body: string) {
  return app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body,
  });
}

describe('login address', () => {
  it('uses X-Real-IP and otherwise the socket', () => {
    expect(loginAddress('172.18.0.1', '203.0.113.10')).toBe('203.0.113.10');
    expect(loginAddress('172.18.0.1', ' 203.0.113.10 ')).toBe('203.0.113.10');
    expect(loginAddress('172.18.0.1', undefined)).toBe('172.18.0.1');
    expect(loginAddress(null, '   ')).toBe('unknown');
  });
});

describe('login limit', () => {
  it('locks one X-Real-IP after five failures and a new process accepts the password', async () => {
    const first = await buildApp();
    const ip = '203.0.113.10';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await post(first.app, ip, '{}');
      expect(res.status).toBe(400);
    }
    const good = await post(first.app, ip, JSON.stringify({ password: first.password }));
    expect(good.status).toBe(200);
    const fifth = await post(first.app, ip, '{}');
    expect(fifth.status).toBe(400);
    const blocked = await post(first.app, ip, '{}');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    const other = await post(first.app, '203.0.113.11', '{}');
    expect(other.status).toBe(400);

    const second = await buildApp();
    const again = await post(second.app, ip, JSON.stringify({ password: second.password }));
    expect(again.status).toBe(200);
  });

  it('rejects a body over 256KB', async () => {
    const { app } = await buildApp();
    const body = JSON.stringify({ password: 'x'.repeat(300_000) });
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.12' },
      body,
    });
    expect(res.status).toBe(413);
  });
});
