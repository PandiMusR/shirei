import { z } from 'zod';
import { parseModelFamilies } from './models';

const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  WORKSPACE_ROOT: z.string().min(1).default('/workspace'),
  AGENT_BIN: z.string().min(1).default('agent'),
  RUNNER_TOKEN: z.string().min(16),
  MAX_RUNS: z.coerce.number().int().min(1).max(8).default(2),
  RUN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30 * 60 * 1000),
  GITHUB_TOKEN: z.string().min(1).optional(),
  MODEL_FAMILIES: z.string().optional(),
});

type Parsed = z.infer<typeof schema>;
export type Env = Omit<Parsed, 'MODEL_FAMILIES'> & { modelFamilies: string[] };

export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const { MODEL_FAMILIES, ...rest } = parsed.data;
  return { ...rest, modelFamilies: parseModelFamilies(MODEL_FAMILIES) };
}
