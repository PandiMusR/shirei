CREATE TABLE projects (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  path text NOT NULL UNIQUE,
  source text NOT NULL,
  repo_url text,
  created_at integer NOT NULL
);
CREATE TABLE tasks (
  id text PRIMARY KEY NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  prompt text NOT NULL,
  mode text NOT NULL,
  model text,
  force integer NOT NULL,
  session_id text,
  runner_run_id text,
  status text NOT NULL,
  error text,
  started_at integer,
  ended_at integer,
  duration_ms integer,
  created_at integer NOT NULL
);
CREATE TABLE events (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  type text NOT NULL,
  subtype text,
  payload text NOT NULL,
  ts integer NOT NULL,
  PRIMARY KEY (task_id, seq)
);
CREATE TABLE sessions (
  id text PRIMARY KEY NOT NULL,
  expires_at integer NOT NULL,
  created_at integer NOT NULL
);
CREATE TABLE push_subscriptions (
  id text PRIMARY KEY NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at integer NOT NULL
);
