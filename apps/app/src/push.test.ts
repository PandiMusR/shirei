import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DbHandle } from './db/client';
import { runMigrations } from './db/migrate';
import { events, projects, pushSubscriptions, tasks } from './db/schema';
import {
  assistantText,
  buildTaskPush,
  buildTestPush,
  deleteSubscription,
  deliverPush,
  firstLine,
  saveSubscription,
  type PushSender,
} from './push';
import { markInterrupted, setTaskFinishedHook } from './tasks';

const migrationsDir = fileURLToPath(new URL('../drizzle', import.meta.url));
const handles: DbHandle[] = [];

async function database(): Promise<DbHandle> {
  const handle = await openDatabase('file::memory:');
  await runMigrations(handle.client, migrationsDir);
  handles.push(handle);
  return handle;
}

afterEach(() => {
  setTaskFinishedHook(null);
  while (handles.length > 0) handles.pop()?.close();
});

const sub = {
  endpoint: 'https://push.example/a',
  keys: { p256dh: 'p256', auth: 'auth' },
};

describe('push subscriptions', () => {
  it('creates, updates keys for the same endpoint, and deletes', async () => {
    const { db } = await database();
    await saveSubscription(db, sub, 1);
    await saveSubscription(db, { ...sub, keys: { p256dh: 'next', auth: 'next-auth' } }, 2);
    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe('next');
    expect(rows[0]?.auth).toBe('next-auth');
    expect(rows[0]?.createdAt).toBe(1);
    await deleteSubscription(db, sub.endpoint);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });
});

describe('push payload', () => {
  it('uses the first non-empty assistant line, capped at 120 characters', () => {
    const long = 'a'.repeat(140);
    expect(firstLine(`\n  ${long}\nsecond`)).toBe('a'.repeat(120));
    const assistant = assistantText([
      { timestamp_ms: 1, message: { content: [{ type: 'text', text: 'Hello' }] } },
      { timestamp_ms: 2, model_call_id: 'call-1', message: { content: [{ type: 'text', text: 'Hello again' }] } },
      { message: { content: [{ type: 'text', text: 'no timestamp' }] } },
      { timestamp_ms: 3, message: { content: [{ type: 'text', text: '\nthere' }] } },
    ]);
    const message = buildTaskPush({
      projectName: 'Hello',
      status: 'succeeded',
      assistant,
      error: 'ignored',
      prompt: 'ignored prompt',
      taskId: 'task-1',
    });
    expect(assistant).toBe('Hello\nthere');
    expect(message).toEqual({ title: 'Hello · Done', body: 'Hello', url: '/tasks/task-1' });
  });

  it('falls back from an empty assistant to the error, then the prompt', () => {
    expect(
      buildTaskPush({
        projectName: 'Hello',
        status: 'failed',
        assistant: '   \n',
        error: 'stream closed',
        prompt: 'do the thing',
        taskId: 'task-2',
      }),
    ).toEqual({ title: 'Hello · Failed', body: 'stream closed', url: '/tasks/task-2' });
    expect(
      buildTaskPush({
        projectName: 'Hello',
        status: 'stopped',
        assistant: '',
        error: null,
        prompt: 'first line\nsecond',
        taskId: 'task-3',
      }).body,
    ).toBe('first line');
    expect(buildTestPush()).toEqual({ title: 'Shirei', body: 'Test notification', url: '/', test: true });
  });
});

describe('push pruning', () => {
  async function seed(): Promise<DbHandle> {
    const handle = await database();
    await saveSubscription(handle.db, sub, 1);
    await saveSubscription(
      handle.db,
      { endpoint: 'https://push.example/b', keys: { p256dh: 'p2', auth: 'a2' } },
      2,
    );
    return handle;
  }

  it('deletes a subscription on 404 and 410 and keeps it on 500', async () => {
    const gone = await seed();
    const sendGone: PushSender = async (subscription) => {
      if (subscription.endpoint.endsWith('/a')) {
        const err = new Error('gone') as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      }
    };
    await deliverPush(gone.db, buildTestPush(), sendGone);
    const left = await gone.db.select().from(pushSubscriptions);
    expect(left.map((row) => row.endpoint)).toEqual(['https://push.example/b']);

    const missing = await seed();
    const sendMissing: PushSender = async () => {
      const err = new Error('missing') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    };
    await deliverPush(missing.db, buildTestPush(), sendMissing);
    expect(await missing.db.select().from(pushSubscriptions)).toHaveLength(0);

    const kept = await seed();
    const sendBusy: PushSender = async () => {
      const err = new Error('busy') as Error & { statusCode: number };
      err.statusCode = 500;
      throw err;
    };
    await deliverPush(kept.db, buildTestPush(), sendBusy);
    expect(await kept.db.select().from(pushSubscriptions)).toHaveLength(2);
  });
});

describe('task finish hook', () => {
  it('notifies each task that actually left running', async () => {
    const { db } = await database();
    await db.insert(projects).values({
      id: 'p',
      name: 'Hello',
      path: 'hello',
      source: 'folder',
      repoUrl: null,
      createdAt: 1,
    });
    await db.insert(tasks).values({
      id: 't',
      projectId: 'p',
      prompt: 'hi',
      mode: 'agent',
      model: null,
      force: false,
      sessionId: null,
      runnerRunId: null,
      status: 'running',
      error: null,
      startedAt: 1,
      endedAt: null,
      durationMs: null,
      createdAt: 1,
    });
    await db.insert(events).values({
      taskId: 't',
      seq: 1,
      type: 'assistant',
      subtype: null,
      payload: JSON.stringify({ timestamp_ms: 1, message: { content: [{ type: 'text', text: 'All set' }] } }),
      ts: 1,
    });
    const seen: string[] = [];
    setTaskFinishedHook(async (taskId) => {
      seen.push(taskId);
    });
    await markInterrupted(db, 5);
    await markInterrupted(db, 6);
    expect(seen).toEqual(['t']);
    const row = await db.select().from(tasks).where(eq(tasks.id, 't'));
    expect(row[0]?.status).toBe('interrupted');
  });
});
