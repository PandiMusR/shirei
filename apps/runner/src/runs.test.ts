import { expect, it } from 'vitest';
import { KILL_GRACE_MS } from './runs';

it('sends SIGKILL 10 seconds after SIGTERM', () => {
  expect(KILL_GRACE_MS).toBe(10_000);
});
