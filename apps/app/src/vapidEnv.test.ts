import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mergeVapidEnv, vapidStatusLine } from './vapidEnv';

describe('vapid env writer', () => {
  it('appends escaped keys and leaves an existing public key untouched', () => {
    const keys = { publicKey: 'pub-key', privateKey: 'super-secret-private' };
    const added = mergeVapidEnv('AUTH=keep\n', { publicKey: 'ab', privateKey: 'a$b' }, 'mailto:shirei@hakanam.my.id');
    expect(added.wrote).toBe(true);
    expect(added.text).toBe('AUTH=keep\nVAPID_PUBLIC_KEY=ab\nVAPID_PRIVATE_KEY=a$$b\nVAPID_SUBJECT=mailto:shirei@hakanam.my.id\n');
    const line = vapidStatusLine(added.publicLength);
    expect(line).toBe('vapid public key length 2');
    expect(line.includes(keys.privateKey)).toBe(false);

    const source = 'VAPID_PUBLIC_KEY=ab$$cd\nVAPID_PRIVATE_KEY=keep\n';
    const kept = mergeVapidEnv(source, keys, 'mailto:shirei@hakanam.my.id');
    expect(kept.wrote).toBe(false);
    expect(kept.text).toBe(source);
    expect(kept.publicLength).toBe(5);
  });

  it('prints only the public key length', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shirei-vapid-'));
    const file = path.join(dir, '.env');
    writeFileSync(file, 'SESSION_SECRET=placeholder\n', { mode: 0o600 });
    const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
    const script = fileURLToPath(new URL('../scripts/write-vapid.ts', import.meta.url));
    const first = spawnSync(tsx, [script, file], { encoding: 'utf8' });
    const written = readFileSync(file, 'utf8');
    const privateKey = written.match(/^VAPID_PRIVATE_KEY=(.*)$/m)?.[1] ?? '';
    const publicKey = written.match(/^VAPID_PUBLIC_KEY=(.*)$/m)?.[1] ?? '';
    expect(first.status).toBe(0);
    expect(privateKey.length).toBeGreaterThan(20);
    expect(first.stdout).toBe(`${vapidStatusLine(publicKey.length)}\n`);
    expect(first.stdout.includes(privateKey)).toBe(false);
    expect(first.stderr.includes(privateKey)).toBe(false);
    const second = spawnSync(tsx, [script, file], { encoding: 'utf8' });
    expect(second.status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(written);
    expect(second.stdout.includes(privateKey)).toBe(false);
    rmSync(dir, { recursive: true });
  });
});
