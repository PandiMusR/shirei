import { describe, expect, it } from 'vitest';
import { DEBUG_KEY, syncDebugFlag } from './debug';

function memory() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe('syncDebugFlag', () => {
  it('stores shirei.debug=1 and keeps it on later pages', () => {
    const store = memory();
    expect(syncDebugFlag('?debug=1', store)).toBe(true);
    expect(store.getItem(DEBUG_KEY)).toBe('1');
    expect(syncDebugFlag('', store)).toBe(true);
    expect(syncDebugFlag('project=hello', store)).toBe(true);
  });

  it('clears the flag when debug=0', () => {
    const store = memory();
    syncDebugFlag('debug=1', store);
    expect(syncDebugFlag('?debug=0', store)).toBe(false);
    expect(store.getItem(DEBUG_KEY)).toBeNull();
    expect(syncDebugFlag('', store)).toBe(false);
  });
});
