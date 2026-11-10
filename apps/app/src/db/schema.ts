import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  source: text('source').notNull(),
  repoUrl: text('repo_url'),
  removedAt: integer('removed_at'),
  createdAt: integer('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  prompt: text('prompt').notNull(),
  mode: text('mode').notNull(),
  model: text('model'),
  force: integer('force', { mode: 'boolean' }).notNull(),
  sessionId: text('session_id'),
  runnerRunId: text('runner_run_id'),
  status: text('status').notNull(),
  error: text('error'),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at').notNull(),
});

export const events = sqliteTable(
  'events',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    subtype: text('subtype'),
    payload: text('payload').notNull(),
    ts: integer('ts').notNull(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.seq] })],
);

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at').notNull(),
});

export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type EventRow = typeof events.$inferSelect;
