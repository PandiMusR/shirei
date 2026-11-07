import { describe, expect, it } from 'vitest';
import { bindUpdateChecks, networkOnlyPattern, pwaRegisterType, pwaWorkbox, reloadApp, UPDATE_LABEL } from './swUpdate';

describe('service worker update', () => {
  it('prompts, and reload calls updateSW(true)', async () => {
    expect(pwaRegisterType).toBe('prompt');
    expect(UPDATE_LABEL).toBe('Update available · Reload');
    const calls: unknown[] = [];
    await reloadApp(async (reloadPage) => {
      calls.push(reloadPage);
    });
    expect(calls).toEqual([true]);
  });

  it('checks for an update on focus and when the page becomes visible', () => {
    const handlers = new Map<string, () => void>();
    let updates = 0;
    let visible = false;
    const stop = bindUpdateChecks({
      update: () => {
        updates += 1;
      },
      visible: () => visible,
      listen(target, type, handler) {
        const key = `${target}:${type}`;
        handlers.set(key, handler);
        return () => handlers.delete(key);
      },
    });
    handlers.get('window:focus')?.();
    handlers.get('document:visibilitychange')?.();
    expect(updates).toBe(0);
    visible = true;
    handlers.get('window:focus')?.();
    handlers.get('document:visibilitychange')?.();
    expect(updates).toBe(2);
    stop();
    expect(handlers.size).toBe(0);
  });

  it('does not cache the API, health check, or index.html', () => {
    expect(pwaWorkbox.navigateFallback).toBeNull();
    expect(pwaWorkbox.globPatterns.join(' ')).not.toContain('html');
    expect(pwaWorkbox.globIgnores).toContain('**/index.html');
    expect(pwaWorkbox.runtimeCaching[0]?.handler).toBe('NetworkOnly');
    const match = pwaWorkbox.runtimeCaching[0]?.urlPattern;
    if (!match) throw new Error('missing route');
    expect(match).toBe(networkOnlyPattern);
    expect(networkOnlyPattern.toString()).toMatch(/startsWith\(["']\/api\/["']\)/);
    const url = (path: string) => new URL(path, 'https://shirei.hakanam.my.id');
    expect(match({ url: url('/api/tasks'), request: { mode: 'cors' } })).toBe(true);
    expect(match({ url: url('/healthz'), request: { mode: 'cors' } })).toBe(true);
    expect(match({ url: url('/'), request: { mode: 'navigate' } })).toBe(true);
    expect(match({ url: url('/tasks/abc'), request: { mode: 'navigate' } })).toBe(true);
    expect(match({ url: url('/index.html'), request: { mode: 'same-origin' } })).toBe(true);
    expect(match({ url: url('/assets/index-abc.js'), request: { mode: 'same-origin' } })).toBe(false);
  });
});
