# Shirei

Personal backend for running Cursor CLI headless. Two processes: `app` (login, SQLite, SSE) and `runner` (the CLI, inside the workspace jail). No frontend in this stage.

## Layout

- `apps/app` — Hono, Drizzle, libsql. Holds the password hash and session cookie. It never sees `CURSOR_API_KEY`.
- `apps/runner` — Hono on the private network. Spawns `agent`, clones git repos, and checks workspace paths.
- `docker-compose.yml` — project name `shirei`. Not started from this tree during development.

npm workspaces, one lockfile, same Node 22 path as Diurna.

## Environment

Copy the examples and fill them on the server. Do not commit the copies.

```bash
cp apps/app/.env.example apps/app/.env
cp apps/runner/.env.example apps/runner/.env
chmod 600 apps/app/.env apps/runner/.env
```

`COOKIE_SECURE` defaults to `true` (HTTPS cookie). Set `COOKIE_SECURE=false` only for local HTTP. A production cookie with `Secure` is not stored by a browser, or by curl, on `http://`.

Generate the password hash without writing it to the shell history:

```bash
printf '%s' 'your-password' | npm run hash-password
```

Put the printed scrypt string in `AUTH_PASSWORD_HASH`. `SESSION_SECRET` and `RUNNER_TOKEN` are random strings (`openssl rand -hex 32`). `CURSOR_API_KEY` and the optional `GITHUB_TOKEN` belong in `apps/runner/.env` only.

## In-flight runs

An app restart, or the app losing its HTTP connection to the runner, stops the CLI process and marks that task `interrupted`. That is intentional for this MVP: the phone can disconnect and the app keeps the run, but the app process itself is the owner of the run. On the next start, any row still marked `running` is set to `interrupted`. Resume with `resumeTaskId` only works when the task already has a `session_id`, which requires the runner's `~/.cursor` volume to still be there.

## Local run without a Cursor key

`apps/runner/scripts/fake-agent.mjs` prints the same NDJSON shapes as the CLI. A prompt containing `HANG` waits until SIGTERM. A prompt containing `FAIL` exits 1.

```bash
npm install
npm test
mkdir -p data/workspaces/hello data/app
printf '%s\n' 'console.log("hi")' > data/workspaces/hello/hello.js

# terminal A — runner
HOST=127.0.0.1 PORT=8787 \
  WORKSPACE_ROOT="$PWD/data/workspaces" \
  AGENT_BIN="$PWD/apps/runner/scripts/fake-agent.mjs" \
  RUNNER_TOKEN="$RUNNER_TOKEN" \
  npm run start -w apps/runner

# terminal B — app. COOKIE_SECURE=false so curl over HTTP keeps the cookie.
HOST=127.0.0.1 PORT=3099 COOKIE_SECURE=false \
  DATABASE_URL="file:$PWD/data/app/shirei.db" \
  SESSION_SECRET="$SESSION_SECRET" \
  AUTH_PASSWORD_HASH="$AUTH_PASSWORD_HASH" \
  RUNNER_URL=http://127.0.0.1:8787 \
  RUNNER_TOKEN="$RUNNER_TOKEN" \
  npm run start -w apps/app
```

```bash
curl -s -c /tmp/shirei.ck -H 'content-type: application/json' \
  -d '{"password":"your-password"}' http://127.0.0.1:3099/api/login

curl -s -b /tmp/shirei.ck -H 'content-type: application/json' \
  -d '{"name":"Hello","source":"folder","path":"hello"}' \
  http://127.0.0.1:3099/api/projects

curl -s -b /tmp/shirei.ck -H 'content-type: application/json' \
  -d '{"projectId":"<id>","prompt":"Say hi","mode":"ask","force":false}' \
  http://127.0.0.1:3099/api/tasks

curl -N -b /tmp/shirei.ck http://127.0.0.1:3099/api/tasks/<taskId>/stream
curl -N -b /tmp/shirei.ck -H 'Last-Event-ID: 2' http://127.0.0.1:3099/api/tasks/<taskId>/stream
```

`POST /api/tasks/<id>/stop` with `{}` sends SIGTERM to a `HANG` run. A later task can pass `resumeTaskId` of the ask task. The fake CLI repeats that `session_id`.

## Deploy later

Do not run this against the VPS as part of implementation. When you do:

1. Stop the spike (`docker compose -p shirei-spike down`) so two 1g limits are not both up. Leave `/srv/shirei/spike` until you delete it yourself.
2. Copy this repo to `/srv/shirei/app`. Create `data/workspaces`, `data/cursor-home`, and `data/app`. `chown` the first two to `10001:10001` and `data/app` to the image's `node` user.
3. Confirm `127.0.0.1:3070` is free, then `docker compose -p shirei up -d --build` from `/srv/shirei/app`.
4. The app is only on loopback. Nginx for `shirei.hakanam.my.id` is a later stage.

Rollback is `docker compose -p shirei down`. `./data` stays on disk.
