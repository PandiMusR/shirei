import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { clearSessionCookie, readSessionCookie, requireJson, setSessionCookie } from './auth/middleware';
import { verifyPassword } from './auth/password';
import { createRateLimiter } from './auth/rateLimit';
import { endSession, resolveSession, startSession } from './auth/sessions';
import type { Database } from './db/client';
import type { Task } from './db/schema';
import type { Env } from './env';
import { cloneProject, fetchModels, RunnerRequestError, statPath, type RunnerClient } from './runnerClient';
import {
  beginShutdown,
  eventsAfter,
  getProject,
  getTask,
  insertProject,
  listProjects,
  listTasks,
  markInterrupted,
  requestStop,
  RunnerBusyError,
  sessionTurns,
  startTask,
  subscribe,
} from './tasks';
import { mountWeb } from './web';

const loginBody = z.object({ password: z.string().min(1).max(256) });
const projectBody = z.object({
  name: z.string().min(1).max(80),
  source: z.enum(['folder', 'git']),
  path: z.string().min(1).max(512).optional(),
  repoUrl: z.string().min(1).max(300).optional(),
});
const taskBody = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(20_000),
  mode: z.enum(['agent', 'ask', 'plan']).default('agent'),
  model: z.string().min(1).max(80).nullable().optional(),
  force: z.boolean().default(false),
  resumeTaskId: z.string().min(1).optional(),
});

const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._][A-Za-z0-9._/-]{0,200}$/;

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

function taskJson(task: Task) {
  return {
    id: task.id,
    projectId: task.projectId,
    prompt: task.prompt,
    mode: task.mode,
    model: task.model,
    force: task.force,
    sessionId: task.sessionId,
    status: task.status,
    error: task.error,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    durationMs: task.durationMs,
    createdAt: task.createdAt,
  };
}

function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function createApp(opts: { env: Env; db: Database; now?: () => number }) {
  const { env, db } = opts;
  const now = opts.now ?? Date.now;
  const runner: RunnerClient = { url: env.RUNNER_URL.replace(/\/$/, ''), token: env.RUNNER_TOKEN };
  const loginLimit = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000, now });
  const app = new Hono();
  if (env.webRoot) {
    app.use('*', async (c, next) => {
      await next();
      const pathname = c.req.path;
      if (pathname.startsWith('/api') || pathname === '/healthz') return;
      if (c.res.headers.has('Cache-Control')) return;
      const hashed = pathname.startsWith('/assets/');
      c.res.headers.set('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    });
  }

  app.onError((err, c) => {
    console.error(err.name);
    return c.json({ error: 'internal' }, 500);
  });

  app.get('/healthz', (c) => c.json({ ok: true }));

  const requireSession: MiddlewareHandler = async (c, next) => {
    const token = readSessionCookie(c);
    const session = token ? await resolveSession(db, { secret: env.SESSION_SECRET, token, nowMs: now() }) : null;
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    await next();
  };

  const api = new Hono();
  api.use('*', requireJson);
  api.post('/login', async (c) => {
    const limit = loginLimit.hit(`login:${clientIp(c)}`);
    if (!limit.ok) {
      c.header('retry-after', String(limit.retryAfterS));
      return c.json({ error: 'rate_limited' }, 429);
    }
    const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const ok = await verifyPassword(parsed.data.password, env.AUTH_PASSWORD_HASH);
    if (!ok) return c.json({ error: 'unauthorized' }, 401);
    const token = await startSession(db, { secret: env.SESSION_SECRET, nowMs: now() });
    setSessionCookie(c, token, env.cookieSecure);
    return c.json({ ok: true });
  });

  const authed = new Hono();
  authed.use('*', requireSession);
  authed.post('/logout', async (c) => {
    const token = readSessionCookie(c);
    if (token) await endSession(db, { secret: env.SESSION_SECRET, token });
    clearSessionCookie(c, env.cookieSecure);
    return c.json({ ok: true });
  });

  authed.get('/models', async (c) => {
    try {
      return c.json(await fetchModels(runner));
    } catch {
      return c.json({ error: 'runner_error' }, 502);
    }
  });

  authed.get('/projects', async (c) => c.json({ projects: await listProjects(db) }));

  authed.post('/projects', async (c) => {
    const parsed = projectBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const body = parsed.data;
    try {
      if (body.source === 'folder') {
        if (!body.path || !RELATIVE_PATH.test(body.path)) return c.json({ error: 'invalid_path' }, 400);
        const stat = await statPath(runner, body.path);
        if (!stat.exists || !stat.isDirectory) return c.json({ error: 'not_found' }, 404);
        const project = await insertProject(db, { name: body.name, path: body.path, source: 'folder', repoUrl: null });
        return c.json({ project }, 201);
      }
      if (!body.repoUrl || !RELATIVE_PATH.test(body.name)) return c.json({ error: 'invalid_body' }, 400);
      await cloneProject(runner, body.name, body.repoUrl);
      const project = await insertProject(db, { name: body.name, path: body.name, source: 'git', repoUrl: body.repoUrl });
      return c.json({ project }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'runner_error';
      if (message === 'exists' || message.includes('UNIQUE')) return c.json({ error: 'exists' }, 409);
      if (message === 'invalid_path') return c.json({ error: 'invalid_path' }, 400);
      return c.json({ error: 'runner_error' }, 502);
    }
  });

  authed.get('/tasks', async (c) => {
    const rows = await listTasks(db);
    return c.json({ tasks: rows.map(taskJson) });
  });

  authed.post('/tasks', async (c) => {
    const parsed = taskBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const body = parsed.data;
    if (body.force && body.mode !== 'agent') return c.json({ error: 'force_not_allowed' }, 400);
    const project = await getProject(db, body.projectId);
    if (!project) return c.json({ error: 'not_found' }, 404);
    let resumeId: string | null = null;
    if (body.resumeTaskId) {
      const previous = await getTask(db, body.resumeTaskId);
      if (!previous?.sessionId) return c.json({ error: 'no_session' }, 409);
      resumeId = previous.sessionId;
    }
    try {
      const task = await startTask(db, runner, {
        project,
        prompt: body.prompt,
        mode: body.mode,
        model: body.model ?? null,
        force: body.force,
        resumeId,
      });
      return c.json({ task: taskJson(task) }, 201);
    } catch (err) {
      if (err instanceof RunnerBusyError) return c.json({ error: 'busy' }, 429);
      if (err instanceof RunnerRequestError && err.message === 'invalid_model') return c.json({ error: 'invalid_model' }, 400);
      return c.json({ error: 'runner_error' }, 502);
    }
  });

  authed.get('/tasks/:id', async (c) => {
    const task = await getTask(db, c.req.param('id'));
    if (!task) return c.json({ error: 'not_found' }, 404);
    return c.json({ task: taskJson(task) });
  });

  authed.get('/tasks/:id/thread', async (c) => {
    const task = await getTask(db, c.req.param('id'));
    if (!task) return c.json({ error: 'not_found' }, 404);
    const turns = await sessionTurns(db, task.id);
    return c.json({
      turns: turns.map(({ task: row, events: rows }) => ({
        task: taskJson(row),
        events: rows.map((event) => ({ seq: event.seq, type: event.type, payload: parsePayload(event.payload) })),
      })),
    });
  });

  authed.post('/tasks/:id/stop', async (c) => {
    const task = await getTask(db, c.req.param('id'));
    if (!task) return c.json({ error: 'not_found' }, 404);
    const result = await requestStop(db, runner, task);
    if (result === 'not_running') return c.json({ error: 'not_running' }, 409);
    return c.json({ ok: true }, 202);
  });

  authed.get('/tasks/:id/stream', async (c) => {
    const task = await getTask(db, c.req.param('id'));
    if (!task) return c.json({ error: 'not_found' }, 404);
    const header = c.req.header('last-event-id');
    const query = c.req.query('after');
    const raw = header ?? query ?? '0';
    const after = Number(raw);
    const startAfter = Number.isInteger(after) && after >= 0 ? after : 0;

    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const pending: Array<{ seq: number; type: string; subtype: string | null; payload: string }> = [];
      let wake: (() => void) | null = null;
      let aborted = false;
      const unsub = subscribe(task.id, (event) => {
        pending.push(event);
        const notify = wake;
        wake = null;
        notify?.();
      });
      stream.onAbort(() => {
        aborted = true;
        const notify = wake;
        wake = null;
        notify?.();
      });
      const seen = new Set<number>();
      const send = async (event: { seq: number; type: string; payload: string }) => {
        if (seen.has(event.seq)) return;
        seen.add(event.seq);
        await stream.writeSSE({ id: String(event.seq), event: event.type, data: event.payload });
      };
      await stream.write(': open\n\n');
      const ping = setInterval(() => {
        if (aborted) return;
        void stream.write(': ping\n\n');
      }, 15_000);
      try {
        for (const row of await eventsAfter(db, task.id, startAfter)) await send(row);
        while (!aborted) {
          while (pending.length > 0) {
            const event = pending.shift();
            if (!event) break;
            await send(event);
            if (event.type === 'runner' && event.subtype === 'exit') return;
          }
          const current = await getTask(db, task.id);
          if (!current || current.status !== 'running') return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        clearInterval(ping);
        unsub();
      }
    });
  });

  api.route('/', authed);
  app.route('/api', api);
  if (env.webRoot) mountWeb(app, env.webRoot);
  return app;
}

export async function prepareDatabase(db: Database): Promise<void> {
  await markInterrupted(db);
}

export async function shutdown(db: Database): Promise<void> {
  beginShutdown();
  await markInterrupted(db);
}
