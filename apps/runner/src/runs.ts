import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scrubSecrets } from './scrub';

export type RunMode = 'agent' | 'ask' | 'plan';

export type RunSpec = {
  workspaceDir: string;
  prompt: string;
  mode: RunMode;
  model: string | null;
  resumeId: string | null;
  force: boolean;
};

export type StopReason = 'stop' | 'timeout' | 'disconnect';

export type ExitInfo = {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  stopped: boolean;
  error?: string;
};

type LineQueue = {
  push: (line: string) => void;
  close: () => void;
  next: () => Promise<string | null>;
};

function createLineQueue(): LineQueue {
  const items: string[] = [];
  let waiter: ((value: string | null) => void) | null = null;
  let closed = false;
  return {
    push(line) {
      if (closed) return;
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve(line);
        return;
      }
      items.push(line);
    },
    close() {
      if (closed) return;
      closed = true;
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve(null);
      }
    },
    next() {
      const first = items.shift();
      if (first !== undefined) return Promise.resolve(first);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
  };
}

export type ActiveRun = {
  id: string;
  requestStop: (reason: StopReason) => void;
  lines: LineQueue;
  done: Promise<ExitInfo>;
};

export const KILL_GRACE_MS = 10_000;

export function buildAgentArgs(spec: RunSpec): string[] {
  const args = ['-p', '--trust', '--workspace', spec.workspaceDir, '--output-format', 'stream-json', '--stream-partial-output'];
  if (spec.mode === 'ask' || spec.mode === 'plan') args.push('--mode', spec.mode);
  if (spec.force) args.push('--force');
  if (spec.model) args.push('--model', spec.model);
  if (spec.resumeId) args.push('--resume', spec.resumeId);
  args.push(spec.prompt);
  return args;
}

export function createRunManager(opts: { agentBin: string; maxRuns: number; timeoutMs: number }) {
  let slots = 0;
  const active = new Map<string, ActiveRun>();

  function begin(spec: RunSpec): ActiveRun | 'busy' {
    if (slots >= opts.maxRuns) return 'busy';
    slots += 1;
    const id = randomUUID();
    const lines = createLineQueue();
    const child = spawn(opts.agentBin, buildAgentArgs(spec), {
      cwd: spec.workspaceDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!child.stdout || !child.stderr) {
      slots -= 1;
      throw new Error('stdio');
    }

    const state = { reason: null as StopReason | null, stderr: '', buf: '' };

    const flush = () => {
      if (!state.buf.trim()) {
        state.buf = '';
        return;
      }
      lines.push(state.buf.replace(/\n$/, ''));
      state.buf = '';
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      state.buf += chunk;
      let idx = state.buf.indexOf('\n');
      while (idx >= 0) {
        const line = state.buf.slice(0, idx);
        state.buf = state.buf.slice(idx + 1);
        if (line.trim()) lines.push(line);
        idx = state.buf.indexOf('\n');
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (state.stderr.length < 4000) state.stderr += chunk;
    });

    let killTimer: NodeJS.Timeout | undefined;
    const requestStop = (reason: StopReason) => {
      if (state.reason) return;
      state.reason = reason;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, KILL_GRACE_MS);
      killTimer.unref();
    };

    const timer = setTimeout(() => requestStop('timeout'), opts.timeoutMs);
    timer.unref();

    const done = new Promise<ExitInfo>((resolve) => {
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        flush();
        const info: ExitInfo = {
          code,
          signal,
          timedOut: state.reason === 'timeout',
          stopped: state.reason === 'stop' || state.reason === 'disconnect',
        };
        if ((code !== 0 && code !== null) || signal) {
          const scrubbed = scrubSecrets(state.stderr.trim());
          if (scrubbed) info.error = scrubbed.slice(0, 500);
        }
        lines.close();
        if (active.delete(id)) slots -= 1;
        console.log(`run exit ${id} code=${code ?? 'null'} stopped=${info.stopped} timedOut=${info.timedOut}`);
        resolve(info);
      };
      child.once('error', () => finish(null, null));
      child.once('exit', (code, signal) => finish(code, signal));
    });

    const run: ActiveRun = { id, requestStop, lines, done };
    active.set(id, run);
    console.log(`run start ${id} mode=${spec.mode}`);
    return run;
  }

  return {
    begin,
    get(id: string) {
      return active.get(id);
    },
    get size() {
      return slots;
    },
  };
}

export type RunManager = ReturnType<typeof createRunManager>;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;

export function validateClone(name: string, repoUrl: string): { name: string; repoUrl: string } {
  if (!NAME_RE.test(name) || name === '.' || name === '..') throw new Error('invalid_name');
  const match = REPO_RE.exec(repoUrl);
  const owner = match?.[1];
  const repo = match?.[2];
  if (!owner || !repo || owner.includes('..') || repo.includes('..')) throw new Error('invalid_repo');
  return { name, repoUrl };
}

export async function cloneRepo(opts: {
  workspaceRoot: string;
  name: string;
  repoUrl: string;
  token?: string;
}): Promise<void> {
  const { name, repoUrl } = validateClone(opts.name, opts.repoUrl);
  const root = realpathSync(opts.workspaceRoot);
  const dest = path.resolve(root, name);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!dest.startsWith(prefix)) throw new Error('invalid_name');
  if (existsSync(dest)) throw new Error('exists');

  let askpass: string | undefined;
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (opts.token) {
    askpass = path.join(tmpdir(), `shirei-askpass-${process.pid}-${randomUUID()}`);
    writeFileSync(
      askpass,
      '#!/bin/sh\ncase "$1" in\n*Username*) printf "%s\\n" "x-access-token" ;;\n*) printf "%s\\n" "$SHIREI_GIT_TOKEN" ;;\nesac\n',
      { mode: 0o700 },
    );
    env.GIT_ASKPASS = askpass;
    env.SHIREI_GIT_TOKEN = opts.token;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['clone', '--depth', '1', repoUrl, dest], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        if (stderr.length < 4000) stderr += chunk;
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(scrubSecrets(stderr.trim()).slice(0, 500) || `git exit ${code ?? 'null'}`));
      });
    });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw err;
  } finally {
    if (askpass) rmSync(askpass, { force: true });
  }
}
