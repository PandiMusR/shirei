export const DEBUG_KEY = 'shirei.debug';

type DebugStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** `?debug=1` turns the overlay on for later pages. `?debug=0` turns it off. */
export function syncDebugFlag(search: string, store: DebugStore = localStorage): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const flag = params.get('debug');
  if (flag === '1') store.setItem(DEBUG_KEY, '1');
  else if (flag === '0') store.removeItem(DEBUG_KEY);
  return store.getItem(DEBUG_KEY) === '1';
}
