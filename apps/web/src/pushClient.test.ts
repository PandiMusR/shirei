import { describe, expect, it } from 'vitest';
import { readyWithin, shouldNotify, urlBase64ToUint8Array } from './pushClient';

const task = 'https://shirei.hakanam.my.id/tasks/abc';

describe('shouldNotify', () => {
  it('stays quiet only when that task is already on screen', () => {
    expect(shouldNotify([{ visibilityState: 'visible', url: task }], '/tasks/abc', false)).toBe(false);
    expect(shouldNotify([{ visibilityState: 'visible', url: 'https://shirei.hakanam.my.id/' }], '/tasks/abc', false)).toBe(true);
    expect(shouldNotify([{ visibilityState: 'hidden', url: task }], '/tasks/abc', false)).toBe(true);
    expect(shouldNotify([{ visibilityState: 'visible', url: task }], '/tasks/abc', true)).toBe(true);
  });
});

describe('push client helpers', () => {
  it('decodes a base64url key and gives up when the worker is not ready', async () => {
    const bytes = urlBase64ToUint8Array('AQ');
    expect(Array.from(bytes)).toEqual([1]);
    const pending = new Promise<string>(() => undefined);
    await expect(readyWithin(pending, 20)).resolves.toBeNull();
  });
});
