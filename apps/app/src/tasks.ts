import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from './db/client';
import { events, projects, tasks, type EventRow, type Project, type Task } from './db/schema';
import { parseNdjsonLine, type RunnerLine } from './ndjson';
import { openRun, RunnerBusyError, stopRun, type RunnerClient } from './runnerClient';
import { scrubSecrets } from './scrub';

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';

type Listener = (event: EventRow) => void;
const listeners = new Map<string, Set<Listener>>();
const aborts = new Set<AbortController>();
let shuttingDown = false;

export function subscribe(taskId: string, listener: Listener): () => void {
  let set = listeners.get(taskId);
  if (!set) {
    set = new Set();
    listeners.set(taskId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(taskId);
  };
}

function publish(event: EventRow): void {
  const set = listeners.get(event.taskId);
  if (!set) return;
  for (const listener of set) listener(event);
}

export async function markInterrupted(db: Database, nowMs = Date.now()): Promise<void> {
  await db
    .update(tasks)
    .set({ status: 'interrupted', endedAt: nowMs, error: 'app restarted' })
    .where(eq(tasks.status, 'running'));
}

export function beginShutdown(): void {
  shuttingDown = true;
  for (const controller of aborts) controller.abort();
}

export async function listProjects(db: Database): Promise<Project[]> {
  return db.select().from(projects).orderBy(desc(projects.createdAt));
}

export async function getProject(db: Database, id: string): Promise<Project | undefined> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return rows[0];
}

export async function insertProject(
  db: Database,
  input: { name: string; path: string; source: 'folder' | 'git'; repoUrl: string | null },
): Promise<Project> {
  const row = {
    id: uuidv7(),
    name: input.name,
    path: input.path,
    source: input.source,
    repoUrl: input.repoUrl,
    createdAt: Date.now(),
  };
  await db.insert(projects).values(row);
  return row;
}

export async function listTasks(db: Database): Promise<Task[]> {
  return db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(50);
}

export async function getTask(db: Database, id: string): Promise<Task | undefined> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return rows[0];
}

export async function eventsAfter(db: Database, taskId: string, after: number): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(and(eq(events.taskId, taskId), gt(events.seq, after)))
    .orderBy(asc(events.seq));
}

async function nextSeq(db: Database, taskId: string): Promise<number> {
  const rows = await db
    .select({ seq: events.seq })
    .from(events)
    .where(eq(events.taskId, taskId))
    .orderBy(desc(events.seq))
    .limit(1);
  return (rows[0]?.seq ?? 0) + 1;
}

async function appendEvent(
  db: Database,
  taskId: string,
  input: { type: string; subtype: string | null; payload: unknown },
): Promise<EventRow> {
  const row: EventRow = {
    taskId,
    seq: await nextSeq(db, taskId),
    type: input.type,
    subtype: input.subtype,
    payload: JSON.stringify(input.payload),
    ts: Date.now(),
  };
  await db.insert(events).values(row);
  publish(row);
  return row;
}

function finishStatus(line: Extract<RunnerLine, { kind: 'exit' }>, isError: boolean | null): { status: TaskStatus; error: string | null } {
  if (line.stopped) return { status: 'stopped', error: null };
  if (line.timedOut) return { status: 'failed', error: 'timeout' };
  if (line.code === 0 && isError !== true) return { status: 'succeeded', error: null };
  return { status: 'failed', error: line.error ? scrubSecrets(line.error).slice(0, 500) : 'agent failed' };
}

async function consume(db: Database, taskId: string, lines: AsyncGenerator<RunnerLine>): Promise<void> {
  let isError: boolean | null = null;
  let durationMs: number | null = null;
  let sawExit = false;
  try {
    for await (const line of lines) {
      if (line.kind === 'cli') {
        const parsed = parseNdjsonLine(line.raw);
        if (parsed.kind === 'blank') continue;
        if (parsed.kind === 'unparsed') {
          await appendEvent(db, taskId, { type: 'unparsed', subtype: null, payload: parsed.payload });
          continue;
        }
        await appendEvent(db, taskId, { type: parsed.type, subtype: parsed.subtype, payload: parsed.payload });
        if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.sessionId) {
          await db.update(tasks).set({ sessionId: parsed.sessionId }).where(eq(tasks.id, taskId));
        }
        if (parsed.type === 'result' && parsed.payload && typeof parsed.payload === 'object') {
          const record = parsed.payload as Record<string, unknown>;
          if (typeof record.is_error === 'boolean') isError = record.is_error;
          if (typeof record.duration_ms === 'number') durationMs = record.duration_ms;
        }
        continue;
      }
      if (line.kind === 'exit') {
        sawExit = true;
        if (shuttingDown) return;
        const finished = finishStatus(line, isError);
        const endedAt = Date.now();
        const current = await getTask(db, taskId);
        const duration = durationMs ?? (current?.startedAt ? endedAt - current.startedAt : null);
        await db
          .update(tasks)
          .set({ status: finished.status, error: finished.error, endedAt, durationMs: duration })
          .where(eq(tasks.id, taskId));
        await appendEvent(db, taskId, {
          type: 'runner',
          subtype: 'exit',
          payload: { code: line.code, signal: line.signal, timedOut: line.timedOut, stopped: line.stopped },
        });
        console.log(`task ${taskId} ${finished.status}`);
      }
    }
    if (!sawExit && !shuttingDown) {
      await db
        .update(tasks)
        .set({ status: 'failed', error: 'stream closed', endedAt: Date.now() })
        .where(and(eq(tasks.id, taskId), eq(tasks.status, 'running')));
    }
  } catch (err) {
    if (shuttingDown) return;
    const message = scrubSecrets(err instanceof Error ? err.message : 'runner_error').slice(0, 500);
    await db
      .update(tasks)
      .set({ status: 'failed', error: message, endedAt: Date.now() })
      .where(and(eq(tasks.id, taskId), eq(tasks.status, 'running')));
    console.log(`task ${taskId} failed`);
  }
}

export async function startTask(
  db: Database,
  client: RunnerClient,
  input: {
    project: Project;
    prompt: string;
    mode: 'agent' | 'ask' | 'plan';
    model: string | null;
    force: boolean;
    resumeId: string | null;
  },
): Promise<Task> {
  const controller = new AbortController();
  aborts.add(controller);
  let opened: { runId: string; lines: AsyncGenerator<RunnerLine> };
  try {
    opened = await openRun(
      client,
      {
        projectPath: input.project.path,
        prompt: input.prompt,
        mode: input.mode,
        model: input.model,
        resumeId: input.resumeId,
        force: input.force,
      },
      controller.signal,
    );
  } catch (err) {
    aborts.delete(controller);
    throw err;
  }

  const now = Date.now();
  const task: Task = {
    id: uuidv7(),
    projectId: input.project.id,
    prompt: input.prompt,
    mode: input.mode,
    model: input.model,
    force: input.force,
    sessionId: input.resumeId,
    runnerRunId: opened.runId,
    status: 'running',
    error: null,
    startedAt: now,
    endedAt: null,
    durationMs: null,
    createdAt: now,
  };
  try {
    await db.insert(tasks).values(task);
  } catch (err) {
    aborts.delete(controller);
    await stopRun(client, opened.runId).catch(() => undefined);
    throw err;
  }
  void consume(db, task.id, opened.lines).finally(() => aborts.delete(controller));
  return task;
}

export { RunnerBusyError };

export async function requestStop(db: Database, client: RunnerClient, task: Task): Promise<'stopped' | 'accepted' | 'not_running'> {
  if (task.status !== 'running' || !task.runnerRunId) return 'not_running';
  const status = await stopRun(client, task.runnerRunId);
  if (status === 404) {
    await db
      .update(tasks)
      .set({ status: 'stopped', endedAt: Date.now(), error: null })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, 'running')));
    return 'stopped';
  }
  return 'accepted';
}
