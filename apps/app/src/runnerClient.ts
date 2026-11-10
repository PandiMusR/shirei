import { parseRunnerLine, type RunnerLine } from './ndjson';
import { scrubSecrets } from './scrub';

export class RunnerBusyError extends Error {
  constructor() {
    super('busy');
    this.name = 'RunnerBusyError';
  }
}

export class RunnerRequestError extends Error {
  readonly detail: string;

  constructor(message: string, detail = '') {
    super(message);
    this.name = 'RunnerRequestError';
    this.detail = detail;
  }
}

export type RunnerClient = {
  url: string;
  token: string;
};

async function* iterateRunner(body: ReadableStream<Uint8Array>): AsyncGenerator<RunnerLine> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const take = function* (block: string): Generator<RunnerLine> {
    let rest = block;
    let idx = rest.indexOf('\n');
    while (idx >= 0) {
      const parsed = parseRunnerLine(rest.slice(0, idx));
      if (parsed) yield parsed;
      rest = rest.slice(idx + 1);
      idx = rest.indexOf('\n');
    }
    buf = rest;
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    yield* take(buf);
  }
  buf += decoder.decode();
  const tail = parseRunnerLine(buf);
  if (tail) yield tail;
}

export async function openRun(
  client: RunnerClient,
  body: {
    projectPath: string;
    prompt: string;
    mode: 'agent' | 'ask' | 'plan';
    model: string | null;
    resumeId: string | null;
    force: boolean;
  },
  signal: AbortSignal,
): Promise<{ runId: string; lines: AsyncGenerator<RunnerLine> }> {
  const response = await fetch(`${client.url}/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${client.token}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 429) throw new RunnerBusyError();
  if (response.status === 400) {
    let code = 'invalid_body';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string' && /^[a-z0-9_]+$/.test(body.error)) code = body.error;
    } catch {
      code = 'invalid_body';
    }
    throw new RunnerRequestError(code);
  }
  if (!response.ok || !response.body) throw new RunnerRequestError('runner_rejected');
  const lines = iterateRunner(response.body);
  const first = await lines.next();
  if (first.done || first.value.kind !== 'started') throw new RunnerRequestError('runner_protocol');
  return { runId: first.value.runId, lines };
}

export async function stopRun(client: RunnerClient, runId: string): Promise<number> {
  const response = await fetch(`${client.url}/runs/${runId}/stop`, {
    method: 'POST',
    headers: { authorization: `Bearer ${client.token}` },
  });
  return response.status;
}

export async function fetchModels(client: RunnerClient): Promise<unknown> {
  const response = await fetch(`${client.url}/models`, { headers: { authorization: `Bearer ${client.token}` } });
  if (!response.ok) throw new RunnerRequestError('runner_rejected');
  return response.json();
}

export async function statPath(client: RunnerClient, projectPath: string): Promise<{ exists: boolean; isDirectory: boolean }> {
  const url = new URL('/fs', client.url);
  url.searchParams.set('path', projectPath);
  const response = await fetch(url, { headers: { authorization: `Bearer ${client.token}` } });
  if (response.status === 400) throw new RunnerRequestError('invalid_path');
  if (!response.ok) throw new RunnerRequestError('runner_rejected');
  const body = (await response.json()) as { exists?: boolean; isDirectory?: boolean };
  return { exists: body.exists === true, isDirectory: body.isDirectory === true };
}

export type GitSummary = { branch: string; head: string; dirty: boolean };

async function gitFailure(response: Response): Promise<RunnerRequestError> {
  let error = 'clone_failed';
  let detail = '';
  try {
    const body = (await response.json()) as { error?: unknown; detail?: unknown };
    if (typeof body.error === 'string' && /^[a-z0-9_]+$/.test(body.error)) error = body.error;
    if (typeof body.detail === 'string') detail = scrubSecrets(body.detail).slice(0, 500);
  } catch {
    error = 'clone_failed';
  }
  return new RunnerRequestError(error, detail);
}

export async function cloneProject(
  client: RunnerClient,
  repo: string,
  branch?: string,
): Promise<{ path: string; remote: string; output: string }> {
  const response = await fetch(`${client.url}/repos`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${client.token}`,
    },
    body: JSON.stringify(branch ? { repo, branch } : { repo }),
  });
  if (!response.ok) throw await gitFailure(response);
  const body = (await response.json()) as { path?: unknown; remote?: unknown; output?: unknown };
  if (typeof body.path !== 'string' || typeof body.remote !== 'string') throw new RunnerRequestError('clone_failed');
  return { path: body.path, remote: body.remote, output: typeof body.output === 'string' ? scrubSecrets(body.output).slice(0, 500) : '' };
}

export async function repoStatus(client: RunnerClient, projectPath: string): Promise<GitSummary | null> {
  const url = new URL('/repos/status', client.url);
  url.searchParams.set('path', projectPath);
  const response = await fetch(url, { headers: { authorization: `Bearer ${client.token}` } });
  if (!response.ok) return null;
  const body = (await response.json()) as { git?: unknown };
  const git = body.git;
  if (!git || typeof git !== 'object') return null;
  const row = git as { branch?: unknown; head?: unknown; dirty?: unknown };
  if (typeof row.branch !== 'string' || typeof row.head !== 'string' || typeof row.dirty !== 'boolean') return null;
  return { branch: row.branch, head: row.head, dirty: row.dirty };
}

export async function pullProject(client: RunnerClient, projectPath: string): Promise<{ output: string }> {
  const response = await fetch(`${client.url}/repos/pull`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${client.token}`,
    },
    body: JSON.stringify({ path: projectPath }),
  });
  if (!response.ok) throw await gitFailure(response);
  const body = (await response.json()) as { output?: unknown };
  return { output: typeof body.output === 'string' ? scrubSecrets(body.output).slice(0, 500) : '' };
}

export async function removeWorkspace(client: RunnerClient, projectPath: string): Promise<void> {
  const response = await fetch(`${client.url}/repos/remove`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${client.token}`,
    },
    body: JSON.stringify({ path: projectPath }),
  });
  if (!response.ok) throw await gitFailure(response);
}

export function publicError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'runner_error';
  return scrubSecrets(message).slice(0, 200);
}
