import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scrubSecrets } from './scrub';

export const GIT_NAME = 'PandiMusR';
export const GIT_EMAIL = 'PandiMusR@users.noreply.github.com';
export const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
export const CLONE_MAX_BYTES = 500 * 1024 * 1024;

const SLUG = /^[A-Za-z0-9_.-]+$/;
const PAIR = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+$/;
const DIR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,139}$/;

export type GitHubRepo = { owner: string; repo: string; remote: string; dirName: string };

export function parseGitHubRepo(input: string): GitHubRepo | null {
  const trimmed = input.trim();
  let slug = trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    if (parts.length !== 2) return null;
    const owner = parts[0] ?? '';
    let repo = parts[1] ?? '';
    if (repo.endsWith('.git')) repo = repo.slice(0, -4);
    slug = `${owner}/${repo}`;
  }
  if (!PAIR.test(slug)) return null;
  const [owner, repo] = slug.split('/') as [string, string];
  if (!SLUG.test(owner) || !SLUG.test(repo)) return null;
  const dirName = `${owner}-${repo}`;
  if (!DIR_NAME.test(dirName)) return null;
  return { owner, repo, remote: `https://github.com/${owner}/${repo}.git`, dirName };
}

export function validBranch(branch: string): boolean {
  return branch.length > 0 && branch.length <= 200 && BRANCH.test(branch);
}

export function redactToken(text: string, token?: string): string {
  const scrubbed = scrubSecrets(text);
  if (!token) return scrubbed;
  return scrubbed.split(token).join('[REDACTED]');
}

export function agentEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.GITHUB_TOKEN;
  delete env.SHIREI_GIT_TOKEN;
  delete env.GIT_ASKPASS;
  env.GIT_AUTHOR_NAME = GIT_NAME;
  env.GIT_AUTHOR_EMAIL = GIT_EMAIL;
  env.GIT_COMMITTER_NAME = GIT_NAME;
  env.GIT_COMMITTER_EMAIL = GIT_EMAIL;
  return env;
}

type GitResult = { code: number | null; stdout: string; stderr: string; reason: 'timeout' | 'too_large' | null };

function directoryBytes(root: string): number {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) stack.push(full);
        else total += lstatSync(full).size;
      } catch {
        continue;
      }
    }
  }
  return total;
}

function runGit(
  args: string[],
  opts: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number; dest?: string; maxBytes?: number; pollMs?: number },
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let reason: GitResult['reason'] = null;
    const stopWatch = () => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
    };
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      stopWatch();
      resolve({ code, stdout, stderr, reason });
    };
    const kill = (next: Exclude<GitResult['reason'], null>) => {
      if (reason) return;
      reason = next;
      child.kill('SIGTERM');
      const later = setTimeout(() => child.kill('SIGKILL'), 5_000);
      later.unref();
    };
    const timer = setTimeout(() => kill('timeout'), opts.timeoutMs);
    timer.unref();
    const poll =
      opts.dest && opts.maxBytes
        ? setInterval(() => {
            if (directoryBytes(opts.dest as string) > (opts.maxBytes as number)) kill('too_large');
          }, opts.pollMs ?? 2_000)
        : undefined;
    poll?.unref();
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < 8_000) stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 8_000) stderr += chunk;
    });
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      stopWatch();
      reject(err);
    });
    child.once('exit', (code) => finish(code));
  });
}

function workspaceDest(workspaceRoot: string, dirName: string): string {
  if (!DIR_NAME.test(dirName)) throw new Error('invalid_name');
  const root = realpathSync(workspaceRoot);
  const dest = path.resolve(root, dirName);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (path.dirname(dest) !== root || !dest.startsWith(prefix)) throw new Error('invalid_name');
  return dest;
}

function assertInside(dest: string): void {
  let stat;
  try {
    stat = lstatSync(dest);
  } catch {
    throw new Error('missing');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('invalid_path');
  const root = path.dirname(dest);
  const real = realpathSync(dest);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (real !== dest && !real.startsWith(prefix)) throw new Error('invalid_path');
  if (path.dirname(real) !== root) throw new Error('invalid_path');
}

async function withAskpass<T>(token: string | undefined, run: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const env = agentEnv();
  env.GIT_TERMINAL_PROMPT = '0';
  let askpass: string | undefined;
  if (token) {
    askpass = path.join(tmpdir(), `shirei-askpass-${process.pid}-${randomUUID()}`);
    writeFileSync(
      askpass,
      '#!/bin/sh\ncase "$1" in\n*Username*) printf "%s\\n" "x-access-token" ;;\n*) printf "%s\\n" "$SHIREI_GIT_TOKEN" ;;\nesac\n',
      { mode: 0o700 },
    );
    env.GIT_ASKPASS = askpass;
    env.SHIREI_GIT_TOKEN = token;
  }
  try {
    return await run(env);
  } finally {
    if (askpass) rmSync(askpass, { force: true });
  }
}

function gitEnv(base: NodeJS.ProcessEnv, emptyConfig: string): NodeJS.ProcessEnv {
  return { ...base, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig, GIT_TERMINAL_PROMPT: '0' };
}

async function assertRemote(dest: string, remote: string, token: string | undefined, env: NodeJS.ProcessEnv): Promise<void> {
  const empty = path.join(tmpdir(), `shirei-gitconfig-${process.pid}-${randomUUID()}`);
  writeFileSync(empty, '');
  try {
    const isolated = gitEnv(env, empty);
    const url = await runGit(['config', '--get', 'remote.origin.url'], { cwd: dest, env: isolated, timeoutMs: 30_000 });
    if (url.code !== 0 || url.stdout.trim() !== remote) throw new Error('remote_mismatch');
    const cred = await runGit(['config', '--get-regexp', 'credential|helper'], { cwd: dest, env: isolated, timeoutMs: 30_000 });
    if (cred.stdout.trim()) throw new Error('credential_stored');
    const raw = readFileSync(path.join(dest, '.git', 'config'), 'utf8');
    if (token && raw.includes(token)) throw new Error('credential_stored');
    if (/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|x-access-token:/i.test(raw)) throw new Error('credential_stored');
  } finally {
    rmSync(empty, { force: true });
  }
}

export async function cloneChecked(opts: {
  workspaceRoot: string;
  dirName: string;
  remote: string;
  fetchUrl?: string;
  branch?: string;
  token?: string;
  timeoutMs?: number;
  maxBytes?: number;
  pollMs?: number;
}): Promise<{ output: string }> {
  const dest = workspaceDest(opts.workspaceRoot, opts.dirName);
  try {
    lstatSync(dest);
    throw new Error('exists');
  } catch (err) {
    if (err instanceof Error && err.message === 'exists') throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw new Error('invalid_name');
  }
  const timeoutMs = opts.timeoutMs ?? CLONE_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? CLONE_MAX_BYTES;
  const args = ['-c', 'credential.helper=', 'clone', '--depth', '50', '--single-branch'];
  if (opts.branch) {
    if (!validBranch(opts.branch)) throw new Error('invalid_branch');
    args.push('--branch', opts.branch);
  }
  args.push(opts.fetchUrl ?? opts.remote, dest);
  let output = '';
  try {
    const result = await withAskpass(opts.token, (env) =>
      runGit(args, { env, timeoutMs, dest, maxBytes, pollMs: opts.pollMs }),
    );
    output = redactToken(`${result.stderr}\n${result.stdout}`, opts.token).trim();
    if (result.reason === 'timeout') throw new Error('timeout');
    if (result.reason === 'too_large' || directoryBytes(dest) > maxBytes) throw new Error('too_large');
    if (result.code !== 0) throw new Error(output || 'clone_failed');
    const configured = await withAskpass(undefined, (env) =>
      runGit(['-c', 'credential.helper=', 'remote', 'set-url', 'origin', opts.remote], { cwd: dest, env, timeoutMs: 30_000 }),
    );
    if (configured.code !== 0) throw new Error('remote_mismatch');
    await withAskpass(undefined, async (env) => {
      const name = await runGit(['config', 'user.name', GIT_NAME], { cwd: dest, env, timeoutMs: 30_000 });
      const email = await runGit(['config', 'user.email', GIT_EMAIL], { cwd: dest, env, timeoutMs: 30_000 });
      if (name.code !== 0 || email.code !== 0) throw new Error('clone_failed');
    });
    await withAskpass(undefined, (env) => assertRemote(dest, opts.remote, opts.token, env));
    return { output };
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw err;
  }
}

export async function gitSummary(
  workspaceRoot: string,
  projectPath: string,
): Promise<{ branch: string; head: string; dirty: boolean } | null> {
  const dest = workspaceDest(workspaceRoot, projectPath);
  assertInside(dest);
  const branch = await withAskpass(undefined, (env) =>
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dest, env, timeoutMs: 30_000 }),
  );
  if (branch.code !== 0) return null;
  const head = await withAskpass(undefined, (env) =>
    runGit(['rev-parse', '--short=7', 'HEAD'], { cwd: dest, env, timeoutMs: 30_000 }),
  );
  if (head.code !== 0) return null;
  const porcelain = await withAskpass(undefined, (env) =>
    runGit(['status', '--porcelain'], { cwd: dest, env, timeoutMs: 30_000 }),
  );
  if (porcelain.code !== 0) return null;
  return { branch: branch.stdout.trim(), head: head.stdout.trim(), dirty: porcelain.stdout.trim().length > 0 };
}

export async function pullFastForward(opts: {
  workspaceRoot: string;
  projectPath: string;
  token?: string;
  timeoutMs?: number;
}): Promise<{ output: string }> {
  const dest = workspaceDest(opts.workspaceRoot, opts.projectPath);
  assertInside(dest);
  const status = await withAskpass(undefined, (env) =>
    runGit(['status', '--porcelain'], { cwd: dest, env, timeoutMs: 30_000 }),
  );
  if (status.code !== 0) throw new Error(redactToken(status.stderr, opts.token).trim() || 'pull_failed');
  if (status.stdout.trim()) throw new Error('dirty');
  const result = await withAskpass(opts.token, (env) =>
    runGit(['-c', 'credential.helper=', 'pull', '--ff-only'], {
      cwd: dest,
      env,
      timeoutMs: opts.timeoutMs ?? CLONE_TIMEOUT_MS,
    }),
  );
  const output = redactToken(`${result.stderr}\n${result.stdout}`, opts.token).trim();
  if (result.reason === 'timeout') throw new Error('timeout');
  if (result.code !== 0) throw new Error(output || 'pull_failed');
  return { output };
}

export function removeWorkspace(workspaceRoot: string, projectPath: string): void {
  const dest = workspaceDest(workspaceRoot, projectPath);
  assertInside(dest);
  rmSync(dest, { recursive: true, force: true });
}
