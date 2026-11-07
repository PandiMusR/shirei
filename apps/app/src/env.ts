import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1).default('file:./data/shirei.db'),
    MIGRATIONS_DIR: z.string().min(1).default('drizzle'),
    SESSION_SECRET: z.string().min(32),
    AUTH_PASSWORD_HASH: z.string().min(1),
    COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
    RUNNER_URL: z
      .string()
      .min(1)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
          return false;
        }
      }, 'must be an http(s) URL')
      .default('http://127.0.0.1:8787'),
    RUNNER_TOKEN: z.string().min(16),
    WEB_ROOT: z.string().min(1).optional(),
  })
  .transform((value) => ({
    ...value,
    cookieSecure: value.COOKIE_SECURE === 'true',
    webRoot: value.WEB_ROOT ?? null,
  }));

export type Env = z.output<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
