import { createRequire } from 'node:module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from './db/client';
import { pushSubscriptions } from './db/schema';
import { eventsAfter, getProject, getTask } from './tasks';

const require = createRequire(import.meta.url);

export type PushSubscriptionKeys = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushMessage = {
  title: string;
  body: string;
  url: string;
  test?: boolean;
};

export type PushSender = (subscription: PushSubscriptionKeys, message: PushMessage) => Promise<void>;

type WebPushLib = {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: PushSubscriptionKeys,
    payload: string,
    options?: { TTL?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' },
  ): Promise<unknown>;
};

const STATUS_LABEL: Record<string, string> = {
  succeeded: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
};

const PUSH_TTL_SECONDS = 12 * 60 * 60;

function loadWebPush(): WebPushLib {
  return require('web-push') as WebPushLib;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function firstLine(text: string, max = 120): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return (line ?? '').slice(0, max);
}

/** Same delta rule as the timeline: a timestamp and no model_call_id. */
export function assistantText(payloads: unknown[]): string {
  let text = '';
  for (const payload of payloads) {
    if (!isRecord(payload)) continue;
    if (typeof payload.timestamp_ms !== 'number') continue;
    if (typeof payload.model_call_id === 'string' && payload.model_call_id.length > 0) continue;
    const message = payload.message;
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') text += part.text;
    }
  }
  return text;
}

export function buildTaskPush(input: {
  projectName: string;
  status: string;
  assistant: string;
  error: string | null;
  prompt: string;
  taskId: string;
}): PushMessage {
  const label = STATUS_LABEL[input.status] ?? input.status;
  const body = firstLine(input.assistant) || firstLine(input.error ?? '') || firstLine(input.prompt) || 'Task finished';
  return { title: `${input.projectName} · ${label}`, body, url: `/tasks/${input.taskId}` };
}

export function buildTestPush(): PushMessage {
  return { title: 'Shirei', body: 'Test notification', url: '/', test: true };
}

export function createWebPushSender(env: {
  VAPID_SUBJECT: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
}): PushSender {
  const webpush = loadWebPush();
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return async (subscription, message) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(message), { TTL: PUSH_TTL_SECONDS, urgency: 'high' });
    } catch (err) {
      const status = statusCode(err);
      if (status === null) throw new Error('push_send');
      const wrapped = new Error('push_status') as Error & { statusCode: number };
      wrapped.statusCode = status;
      throw wrapped;
    }
  };
}

function statusCode(err: unknown): number | null {
  if (!isRecord(err) || typeof err.statusCode !== 'number') return null;
  return err.statusCode;
}

export async function saveSubscription(
  db: Database,
  input: PushSubscriptionKeys,
  nowMs: number,
): Promise<void> {
  const existing = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint));
  const row = existing[0];
  if (row) {
    await db
      .update(pushSubscriptions)
      .set({ p256dh: input.keys.p256dh, auth: input.keys.auth })
      .where(eq(pushSubscriptions.id, row.id));
    return;
  }
  await db.insert(pushSubscriptions).values({
    id: uuidv7(),
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    createdAt: nowMs,
  });
}

export async function deleteSubscription(db: Database, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function deliverPush(db: Database, message: PushMessage, send: PushSender): Promise<void> {
  const rows = await db.select().from(pushSubscriptions);
  for (const row of rows) {
    try {
      await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, message);
    } catch (err) {
      const status = statusCode(err);
      if (status === 404 || status === 410) {
        await deleteSubscription(db, row.endpoint);
        continue;
      }
      console.log(`push send failed ${status ?? 'error'}`);
    }
  }
}

export async function notifyTask(db: Database, send: PushSender, taskId: string): Promise<void> {
  const task = await getTask(db, taskId);
  if (!task) return;
  const project = await getProject(db, task.projectId);
  const rows = await eventsAfter(db, taskId, 0);
  const payloads: unknown[] = [];
  for (const row of rows) {
    if (row.type !== 'assistant') continue;
    try {
      payloads.push(JSON.parse(row.payload) as unknown);
    } catch {
      payloads.push(null);
    }
  }
  await deliverPush(
    db,
    buildTaskPush({
      projectName: project?.name ?? 'Shirei',
      status: task.status,
      assistant: assistantText(payloads),
      error: task.error,
      prompt: task.prompt,
      taskId: task.id,
    }),
    send,
  );
}
