import { spawn } from 'node:child_process';
import { parseModelList, type ModelEntry } from './models';

const TTL_MS = 10 * 60 * 1000;

export function loadAgentModelList(agentBin: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(agentBin, ['--list-models'], { env: process.env });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('model_list_timeout'));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr.on('data', () => undefined);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out);
      else reject(new Error('model_list_failed'));
    });
  });
}

export function createModelCatalog(opts: {
  loadText: () => Promise<string>;
  now?: () => number;
  ttlMs?: number;
}) {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? TTL_MS;
  let cached: { at: number; entries: ModelEntry[] } | null = null;
  let pending: Promise<ModelEntry[]> | null = null;

  async function refresh(): Promise<ModelEntry[]> {
    const entries = parseModelList(await opts.loadText());
    if (entries.length === 0) throw new Error('model_list_failed');
    cached = { at: now(), entries };
    return entries;
  }

  return {
    async entries(): Promise<ModelEntry[]> {
      const at = now();
      if (cached && at - cached.at < ttlMs) return cached.entries;
      if (!pending) {
        pending = refresh().finally(() => {
          pending = null;
        });
      }
      try {
        return await pending;
      } catch (err) {
        if (cached) return cached.entries;
        throw err;
      }
    },
  };
}
