export type RateLimitResult = { ok: true } | { ok: false; retryAfterS: number };

export function createRateLimiter(opts: { limit: number; windowMs: number; now: () => number }) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    hit(key: string): RateLimitResult {
      const nowMs = opts.now();
      const current = windows.get(key);
      if (!current || nowMs - current.startedAt >= opts.windowMs) {
        windows.set(key, { startedAt: nowMs, count: 1 });
        return { ok: true };
      }
      if (current.count >= opts.limit) {
        return { ok: false, retryAfterS: Math.max(1, Math.ceil((current.startedAt + opts.windowMs - nowMs) / 1000)) };
      }
      current.count += 1;
      return { ok: true };
    },
  };
}
