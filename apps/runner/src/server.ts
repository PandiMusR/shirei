import { timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import type { Env } from './env';
import { createModelCatalog, loadAgentModelList } from './modelCatalog';
import { buildFamilies, catalogGroups, knownModel, selectFamilies } from './models';
import { PathGuardError, resolveWorkspacePath } from './pathGuard';
import { cloneRepo, createRunManager, type RunManager, type RunMode } from './runs';

const runBody = z.object({
  projectPath: z.string().min(1).max(512),
  prompt: z.string().min(1).max(20_000),
  mode: z.enum(['agent', 'ask', 'plan']).default('agent'),
  model: z.string().min(1).max(80).nullable().optional(),
  resumeId: z.string().min(1).max(80).nullable().optional(),
  force: z.boolean().default(false),
});

const cloneBody = z.object({
  name: z.string().min(1).max(64),
  repoUrl: z.string().min(1).max(300),
});

function authorized(c: Context, token: string): boolean {
  const header = c.req.header('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/.exec(header);
  const presented = match?.[1];
  if (!presented) return false;
  const got = Buffer.from(presented);
  const expect = Buffer.from(token);
  if (got.length !== expect.length) return false;
  return timingSafeEqual(got, expect);
}

function writeLine(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

export function createApp(env: Env, manager: RunManager = createRunManager({
  agentBin: env.AGENT_BIN,
  maxRuns: env.MAX_RUNS,
  timeoutMs: env.RUN_TIMEOUT_MS,
}), catalog = createModelCatalog({ loadText: () => loadAgentModelList(env.AGENT_BIN) })) {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.use('*', async (c, next) => {
    if (c.req.path === '/healthz') return next();
    if (!authorized(c, env.RUNNER_TOKEN)) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  app.get('/models', async (c) => {
    try {
      const entries = await catalog.entries();
      const families = selectFamilies(buildFamilies(entries), env.modelFamilies);
      return c.json({ groups: catalogGroups(families) });
    } catch {
      return c.json({ error: 'runner_error' }, 502);
    }
  });

  app.get('/fs', (c) => {
    const projectPath = c.req.query('path') ?? '';
    try {
      const resolved = resolveWorkspacePath(env.WORKSPACE_ROOT, projectPath);
      return c.json({ exists: true, isDirectory: statSync(resolved).isDirectory() });
    } catch (err) {
      if (err instanceof PathGuardError && err.code === 'missing') return c.json({ exists: false, isDirectory: false });
      return c.json({ error: 'invalid_path' }, 400);
    }
  });

  app.post('/repos', async (c) => {
    const parsed = cloneBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    try {
      await cloneRepo({
        workspaceRoot: env.WORKSPACE_ROOT,
        name: parsed.data.name,
        repoUrl: parsed.data.repoUrl,
        ...(env.GITHUB_TOKEN ? { token: env.GITHUB_TOKEN } : {}),
      });
      return c.json({ ok: true, path: parsed.data.name }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'clone_failed';
      const status = message === 'exists' ? 409 : 400;
      return c.json({ error: message === 'exists' || message.startsWith('invalid') ? message : 'clone_failed' }, status);
    }
  });

  app.post('/runs/:id/stop', (c) => {
    const run = manager.get(c.req.param('id'));
    if (!run) return c.json({ error: 'not_found' }, 404);
    run.requestStop('stop');
    return c.json({ ok: true }, 202);
  });

  app.post('/runs', async (c) => {
    const parsed = runBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const body = parsed.data;
    const mode: RunMode = body.mode;
    if (body.force && mode !== 'agent') return c.json({ error: 'force_not_allowed' }, 400);
    const model = body.model ?? null;
    if (model) {
      let entries: Awaited<ReturnType<typeof catalog.entries>>;
      try {
        entries = await catalog.entries();
      } catch {
        return c.json({ error: 'runner_error' }, 502);
      }
      if (!knownModel(entries, model)) return c.json({ error: 'invalid_model' }, 400);
    }

    let workspaceDir: string;
    try {
      workspaceDir = resolveWorkspacePath(env.WORKSPACE_ROOT, body.projectPath);
      if (!statSync(workspaceDir).isDirectory()) return c.json({ error: 'not_a_directory' }, 400);
    } catch (err) {
      if (err instanceof PathGuardError && err.code === 'missing') return c.json({ error: 'not_found' }, 404);
      return c.json({ error: 'invalid_path' }, 400);
    }

    const begun = manager.begin({
      workspaceDir,
      prompt: body.prompt,
      mode,
      model: body.model ?? null,
      resumeId: body.resumeId ?? null,
      force: body.force,
    });
    if (begun === 'busy') return c.json({ error: 'busy' }, 429);

    c.header('content-type', 'application/x-ndjson; charset=utf-8');
    c.header('cache-control', 'no-cache');
    c.header('x-accel-buffering', 'no');
    return stream(c, async (out) => {
      const abort = () => begun.requestStop('disconnect');
      c.req.raw.signal.addEventListener('abort', abort);
      try {
        await out.write(writeLine({ kind: 'started', runId: begun.id }));
        while (true) {
          const line = await begun.lines.next();
          if (line === null) break;
          await out.write(writeLine({ kind: 'cli', raw: line }));
        }
        const info = await begun.done;
        await out.write(
          writeLine({
            kind: 'exit',
            runId: begun.id,
            code: info.code,
            signal: info.signal,
            timedOut: info.timedOut,
            stopped: info.stopped,
            ...(info.error ? { error: info.error } : {}),
          }),
        );
      } catch {
        abort();
      }
    });
  });

  return app;
}
