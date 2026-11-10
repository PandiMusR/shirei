import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { loginAddress } from './auth/clientAddress';
import { clearSessionCookie, readSessionCookie, requireJson, setSessionCookie } from './auth/middleware';
import { verifyPassword } from './auth/password';
import { createRateLimiter } from './auth/rateLimit';
import { endSession, resolveSession, startSession } from './auth/sessions';
import type { Database } from './db/client';
import type { Task } from './db/schema';
import type { Env } from './env';
import { parseGitHubRepo, validBranch } from './github';
import { buildTestPush, createWebPushSender, deleteSubscription, deliverPush, notifyTask, saveSubscription } from './push';
import {
  cloneProject,
  fetchModels,
  pullProject,
  removeWorkspace,
  repoStatus,
  RunnerRequestError,
  statPath,
  type GitSummary,
  type RunnerClient,
} from './runnerClient';
import {
  beginShutdown,
  eventsAfter,
  getProject,
  getTask,
  insertProject,
  listProjects,
  listTasks,
  markInterrupted,
  isUniqueError,
  markProjectRemoved,
  requestStop,
  RunnerBusyError,
  saveGitProject,
  sessionTurns,
  setTaskFinishedHook,
  startTask,
  subscribe,
} from './tasks';
import { mountWeb } from './web';

const loginBody = z.object({ password: z.string().min(1).max(256) });
const projectBody = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('folder'),
    name: z.string().min(1).max(80),
    path: z.string().min(1).max(512),
  }),
  z.object({
    source: z.literal('git'),
    repo: z.string().min(1).max(300),
    branch: z.string().min(1).max(200).optional(),
  }),
]);
const taskBody = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(20_000),
  mode: z.enum(['agent', 'ask', 'plan']).default('agent'),
  model: z.string().min(1).max(80).nullable().optional(),
  force: z.boolean().default(false),
  resumeTaskId: z.string().min(1).optional(),
});

const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._][A-Za-z0-9._/-]{0,200}$/;
const subscribeBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});
const endpointBody = z.object({ endpoint: z.string().url().max(2000) });

function projectJson(project: { id: string; name: string; path: string; source: string; repoUrl: string | null; createdAt: number }, git: GitSummary | null) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    source: project.source,
    repoUrl: project.repoUrl,
    createdAt: project.createdAt,
    git,
  };
}

function gitHttp(err: unknown): { status: 400 | 404 | 409 | 502; body: { error: string; detail?: string } } {
  if (err instanceof RunnerRequestError) {
    const status = err.message === 'exists' || err.message === 'dirty' ? 409 : err.message === 'missing' ? 404 : 400;
    return { status, body: err.detail ? { error: err.message, detail: err.detail } : { error: err.message } };
  }
  if (isUniqueError(err)) return { status: 409, body: { error: 'exists' } };
  return { status: 502, body: { error: 'runner_error' } };
}

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

const API_BODY_LIMIT = 256 * 1024;

function peerAddress(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

export function createApp(opts: { env: Env; db: Database; now?: () => number }) {
  const { env, db } = opts;
  const now = opts.now ?? Date.now;
  const runner: RunnerClient = { url: env.RUNNER_URL.replace(/\/$/, ''), token: env.RUNNER_TOKEN };
  const sendPush = createWebPushSender(env);
  setTaskFinishedHook((taskId) => notifyTask(db, sendPush, taskId));
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
  api.use(
    '*',
    bodyLimit({
      maxSize: API_BODY_LIMIT,
      onError: (c) => c.json({ error: 'too_large' }, 413),
    }),
  );
  api.use('*', requireJson);
  api.post('/login', async (c) => {
    const key = `login:${loginAddress(peerAddress(c), c.req.header('x-real-ip'))}`;
    const blocked = loginLimit.blocked(key);
    if (!blocked.ok) {
      c.header('retry-after', String(blocked.retryAfterS));
      return c.json({ error: 'rate_limited' }, 429);
    }
    const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      loginLimit.hit(key);
      return c.json({ error: 'invalid_body' }, 400);
    }
    const ok = await verifyPassword(parsed.data.password, env.AUTH_PASSWORD_HASH);
    if (!ok) {
      loginLimit.hit(key);
      return c.json({ error: 'unauthorized' }, 401);
    }
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

  authed.get('/projects', async (c) => {
    const rows = await listProjects(db);
    const listed = await Promise.all(
      rows.map(async (project) => {
        if (project.source !== 'git') return projectJson(project, null);
        try {
          return projectJson(project, await repoStatus(runner, project.path));
        } catch {
          return projectJson(project, null);
        }
      }),
    );
    return c.json({ projects: listed });
  });

  authed.post('/projects', async (c) => {
    const parsed = projectBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const body = parsed.data;
    try {
      if (body.source === 'folder') {
        if (!RELATIVE_PATH.test(body.path)) return c.json({ error: 'invalid_path' }, 400);
        const stat = await statPath(runner, body.path);
        if (!stat.exists || !stat.isDirectory) return c.json({ error: 'not_found' }, 404);
        const project = await insertProject(db, { name: body.name, path: body.path, source: 'folder', repoUrl: null });
        return c.json({ project: projectJson(project, null) }, 201);
      }
      const spec = parseGitHubRepo(body.repo);
      if (!spec) return c.json({ error: 'invalid_repo' }, 400);
      if (body.branch && !validBranch(body.branch)) return c.json({ error: 'invalid_branch' }, 400);
      const cloned = await cloneProject(runner, body.repo, body.branch);
      const project = await saveGitProject(db, {
        name: `${spec.owner}/${spec.repo}`,
        path: cloned.path,
        repoUrl: cloned.remote,
      });
      return c.json({ project: projectJson(project, null), output: cloned.output }, 201);
    } catch (err) {
      const failed = gitHttp(err);
      return c.json(failed.body, failed.status);
    }
  });

  authed.post('/projects/:id/pull', async (c) => {
    const project = await getProject(db, c.req.param('id'));
    if (!project || project.removedAt) return c.json({ error: 'not_found' }, 404);
    if (project.source !== 'git') return c.json({ error: 'invalid_body' }, 400);
    try {
      const result = await pullProject(runner, project.path);
      return c.json({ ok: true, output: result.output });
    } catch (err) {
      const failed = gitHttp(err);
      return c.json(failed.body, failed.status);
    }
  });

  authed.post('/projects/:id/remove', async (c) => {
    const project = await getProject(db, c.req.param('id'));
    if (!project || project.removedAt) return c.json({ error: 'not_found' }, 404);
    if (project.source !== 'git') return c.json({ error: 'invalid_body' }, 400);
    try {
      await removeWorkspace(runner, project.path);
    } catch (err) {
      if (!(err instanceof RunnerRequestError) || err.message !== 'missing') {
        const failed = gitHttp(err);
        return c.json(failed.body, failed.status);
      }
    }
    await markProjectRemoved(db, project.id);
    return c.json({ ok: true });
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
    if (!project || project.removedAt) return c.json({ error: 'not_found' }, 404);
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
      const flush = async () => {
        while (pending.length > 0) {
          const event = pending.shift();
          if (!event) break;
          await send(event);
          if (event.type === 'runner' && event.subtype === 'exit') return true;
        }
        return false;
      };
      try {
        for (const row of await eventsAfter(db, task.id, startAfter)) await send(row);
        if (await flush()) return;
        if (!aborted) await stream.write(': live\n\n');
        while (!aborted) {
          if (await flush()) return;
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

  authed.get('/push/key', (c) => c.json({ publicKey: env.VAPID_PUBLIC_KEY }));
  authed.post('/push/subscribe', async (c) => {
    const parsed = subscribeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    await saveSubscription(db, parsed.data, now());
    return c.json({ ok: true });
  });
  authed.delete('/push/subscribe', async (c) => {
    const parsed = endpointBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    await deleteSubscription(db, parsed.data.endpoint);
    return c.json({ ok: true });
  });
  authed.post('/push/test', async (c) => {
    await deliverPush(db, buildTestPush(), sendPush);
    return c.json({ ok: true });
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
