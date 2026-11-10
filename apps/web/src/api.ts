import type { ModelGroup } from './models';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;

  constructor(status: number, code: string, detail = '') {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export type GitSummary = { branch: string; head: string; dirty: boolean };

export type Project = {
  id: string;
  name: string;
  path: string;
  source: 'folder' | 'git';
  repoUrl: string | null;
  createdAt: number;
  git: GitSummary | null;
};

export type Task = {
  id: string;
  projectId: string;
  prompt: string;
  mode: string;
  model: string | null;
  force: boolean;
  sessionId: string | null;
  status: string;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  createdAt: number;
};

export function explain(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Can’t reach Shirei.';
  if (error.status === 429 && error.code === 'rate_limited') return 'Too many tries.';
  if (error.status === 429 || error.code === 'busy') return '2 tasks already running.';
  if (error.code === 'unauthorized') return 'Wrong password.';
  if (error.code === 'no_session') return 'This task has no session to resume.';
  if (error.code === 'not_found') return 'Not found.';
  if (error.code === 'exists') return 'That project already exists.';
  if (error.code === 'dirty') return 'This repo has local changes, so it was left as it is.';
  if (error.code === 'too_large') return 'That repo is larger than 500 MB, so it was not kept.';
  if (error.code === 'timeout') return 'The clone took too long and was stopped.';
  if (error.code === 'invalid_repo') return 'Use owner/repo or a https://github.com/owner/repo URL.';
  if (error.code === 'invalid_branch') return 'That branch name is not allowed.';
  if (error.code === 'remote_mismatch' || error.code === 'credential_stored') return 'The clone was discarded because git stored unexpected settings.';
  if (error.detail && (error.code === 'clone_failed' || error.code === 'pull_failed')) return error.detail;
  if (error.code === 'invalid_path') return 'That folder is outside the workspace.';
  if (error.code === 'force_not_allowed') return 'Force is only for agent mode.';
  if (error.code === 'invalid_model') return 'That model is not available.';
  if (error.code === 'runner_error') return 'The runner could not start.';
  return 'Something went wrong.';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (!res.ok) {
    let code = 'error';
    let detail = '';
    try {
      const body = (await res.json()) as { error?: unknown; detail?: unknown };
      if (typeof body.error === 'string') code = body.error;
      if (typeof body.detail === 'string' && !/ghp_|github_pat_|x-access-token/i.test(body.detail)) detail = body.detail.slice(0, 500);
    } catch {
      code = 'error';
    }
    throw new ApiError(res.status, code, detail);
  }
  return (await res.json()) as T;
}

export const api = {
  login(password: string) {
    return request<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
  },
  logout() {
    return request<{ ok: true }>('/api/logout', { method: 'POST', body: JSON.stringify({}) });
  },
  models() {
    return request<{ groups: ModelGroup[] }>('/api/models');
  },
  projects() {
    return request<{ projects: Project[] }>('/api/projects');
  },
  createProject(body: { name: string; source: 'folder'; path: string } | { source: 'git'; repo: string; branch?: string }) {
    return request<{ project: Project; output?: string }>('/api/projects', { method: 'POST', body: JSON.stringify(body) });
  },
  pullProject(id: string) {
    return request<{ ok: true; output: string }>(`/api/projects/${id}/pull`, { method: 'POST', body: JSON.stringify({}) });
  },
  removeProject(id: string) {
    return request<{ ok: true }>(`/api/projects/${id}/remove`, { method: 'POST', body: JSON.stringify({}) });
  },
  tasks() {
    return request<{ tasks: Task[] }>('/api/tasks');
  },
  task(id: string) {
    return request<{ task: Task }>(`/api/tasks/${id}`).then((body) => body.task);
  },
  createTask(body: {
    projectId: string;
    prompt: string;
    mode: 'agent' | 'ask' | 'plan';
    model: string | null;
    force: boolean;
    resumeTaskId?: string;
  }) {
    return request<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(body) }).then((data) => data.task);
  },
  stop(id: string) {
    return request<{ ok: true }>(`/api/tasks/${id}/stop`, { method: 'POST', body: JSON.stringify({}) });
  },
  pushKey() {
    return request<{ publicKey: string }>('/api/push/key');
  },
  subscribePush(body: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return request<{ ok: true }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify(body) });
  },
  unsubscribePush(endpoint: string) {
    return request<{ ok: true }>('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
  },
  pushTest() {
    return request<{ ok: true }>('/api/push/test', { method: 'POST', body: JSON.stringify({}) });
  },
  thread(id: string) {
    return request<{ turns: Array<{ task: Task; events: Array<{ seq: number; type: string; payload: unknown }> }> }>(
      `/api/tasks/${id}/thread`,
    );
  },
};
