import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  agentEnv,
  cloneChecked,
  GIT_CREDENTIAL_HELPER,
  GIT_EMAIL,
  GIT_NAME,
  gitAuthPrefix,
  gitChildEnv,
  parseGitHubRepo,
  pullFastForward,
  redactToken,
  removeWorkspace,
  validBranch,
} from './github';

const TOKEN = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const REMOTE = 'https://github.com/octocat/Hello-World.git';
const roots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'shirei-git-'));
  roots.push(dir);
  return dir;
}

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' },
  });
}

function seedRepo(): string {
  const source = tempDir();
  git(['init', '-b', 'main'], source);
  writeFileSync(path.join(source, 'README.md'), 'hello from the fixture\n');
  git(['add', 'README.md'], source);
  git(['commit', '-m', 'initial'], source);
  git(['checkout', '-b', 'feature/one'], source);
  return source;
}

afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseGitHubRepo', () => {
  it('accepts owner/repo and a plain https URL', () => {
    for (const input of ['octocat/Hello-World', 'https://github.com/octocat/Hello-World.git', 'https://github.com/octocat/Hello-World']) {
      expect(parseGitHubRepo(input)).toEqual({
        owner: 'octocat',
        repo: 'Hello-World',
        remote: REMOTE,
        dirName: 'octocat-Hello-World',
      });
    }
    expect(parseGitHubRepo('other/Hello-World')?.dirName).toBe('other-Hello-World');
  });

  it('rejects userinfo, other hosts, query strings, and tokens in the URL', () => {
    expect(parseGitHubRepo(`https://x-access-token:${TOKEN}@github.com/octocat/Hello-World.git`)).toBeNull();
    expect(parseGitHubRepo('https://github.com/octocat/Hello-World.git?token=1')).toBeNull();
    expect(parseGitHubRepo('https://github.com/octocat/Hello-World.git#main')).toBeNull();
    expect(parseGitHubRepo('https://gitlab.com/octocat/Hello-World.git')).toBeNull();
    expect(parseGitHubRepo('http://github.com/octocat/Hello-World.git')).toBeNull();
    expect(parseGitHubRepo('git@github.com:octocat/Hello-World.git')).toBeNull();
    expect(parseGitHubRepo('../etc')).toBeNull();
    expect(parseGitHubRepo('/tmp/repo')).toBeNull();
  });

  it('rejects leading-dash branches and branches that contain ..', () => {
    expect(validBranch('main')).toBe(true);
    expect(validBranch('feature/one')).toBe(true);
    expect(validBranch('-rf')).toBe(false);
    expect(validBranch('feature/../main')).toBe(false);
    expect(validBranch('feature//main')).toBe(false);
  });
});

describe('redactToken', () => {
  it('strips ghp_ and github_pat_ values', () => {
    const pat = 'github_pat_AAAAAAAAAAAAAAAAAAAA';
    expect(redactToken(`failed ${TOKEN} and ${pat}`, TOKEN)).toBe('failed [REDACTED] and [REDACTED]');
    expect(redactToken(`x-access-token:${TOKEN}@github.com`)).toBe('x-access-token:[REDACTED]@github.com');
  });
});

describe('agentEnv', () => {
  it('omits the GitHub token and sets the commit identity', () => {
    const env = agentEnv({
      GITHUB_TOKEN: TOKEN,
      SHIREI_GIT_TOKEN: TOKEN,
      GIT_ASKPASS: '/tmp/askpass',
      PATH: '/usr/bin',
    });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.SHIREI_GIT_TOKEN).toBeUndefined();
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(env.GIT_AUTHOR_NAME).toBe(GIT_NAME);
    expect(env.GIT_AUTHOR_EMAIL).toBe(GIT_EMAIL);
    expect(env.GIT_COMMITTER_NAME).toBe(GIT_NAME);
    expect(env.GIT_COMMITTER_EMAIL).toBe(GIT_EMAIL);
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('git auth', () => {
  it('puts the credential helper on clone and pull without the token text', () => {
    const pat = 'github_pat_AAAAAAAAAAAAAAAAAAAA';
    const prefix = gitAuthPrefix(pat);
    expect(prefix).toEqual(['-c', 'credential.helper=', '-c', GIT_CREDENTIAL_HELPER]);
    expect(prefix.join(' ')).toContain('password=$GITHUB_TOKEN');
    expect(prefix.join(' ')).not.toContain(pat);
    expect(gitAuthPrefix().join(' ')).not.toContain('password=');
    const env = gitChildEnv(pat);
    expect(env.GITHUB_TOKEN).toBe(pat);
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(env.SHIREI_GIT_TOKEN).toBeUndefined();
    expect(gitChildEnv().GITHUB_TOKEN).toBeUndefined();
    expect(agentEnv(env).GITHUB_TOKEN).toBeUndefined();
  });

  it('omits the token from a failed clone error', async () => {
    const workspace = tempDir();
    const pat = 'github_pat_AAAAAAAAAAAAAAAAAAAA';
    let message = '';
    try {
      await cloneChecked({
        workspaceRoot: workspace,
        dirName: 'octocat-Hello-World',
        remote: REMOTE,
        fetchUrl: path.join(workspace, 'missing-repo'),
        token: pat,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : '';
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(pat);
    expect(message).not.toContain('github_pat_');
    expect(message).not.toContain('GIT_ASKPASS');
  });
});

describe('cloneChecked', () => {
  it('clones into owner-repo and keeps a plain https origin with no stored password', async () => {
    const source = seedRepo();
    const workspace = tempDir();
    const result = await cloneChecked({
      workspaceRoot: workspace,
      dirName: 'octocat-Hello-World',
      remote: REMOTE,
      fetchUrl: source,
      branch: 'feature/one',
      token: TOKEN,
    });
    expect(result.output).not.toContain(TOKEN);
    const dest = path.join(workspace, 'octocat-Hello-World');
    const empty = path.join(workspace, 'empty-config');
    writeFileSync(empty, '');
    const isolated = { ...process.env, GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_SYSTEM: empty, GIT_TERMINAL_PROMPT: '0' };
    expect(git(['config', '--get', 'remote.origin.url'], dest).trim()).toBe(REMOTE);
    let helper = '';
    try {
      helper = execFileSync('git', ['config', '--get-regexp', 'credential|helper'], { cwd: dest, encoding: 'utf8', env: isolated });
    } catch (err) {
      expect((err as { status?: number }).status).toBe(1);
    }
    expect(helper.trim()).toBe('');
    const raw = readFileSync(path.join(dest, '.git', 'config'), 'utf8');
    expect(raw).toContain(`url = ${REMOTE}`);
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain('ghp_');
    expect(raw).not.toContain('github_pat_');
    expect(raw).not.toContain('x-access-token');
    expect(raw).not.toContain('credential');
    expect(git(['config', 'user.name'], dest).trim()).toBe(GIT_NAME);
    expect(git(['config', 'user.email'], dest).trim()).toBe(GIT_EMAIL);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], dest).trim()).toBe('feature/one');
    const leftovers = readdirSync(tmpdir()).filter((name) => name.startsWith(`shirei-askpass-${process.pid}-`));
    expect(leftovers).toEqual([]);
  });

  it('refuses a symlink destination and leaves the outside target untouched', async () => {
    const workspace = tempDir();
    const outside = tempDir();
    writeFileSync(path.join(outside, 'keep'), 'safe');
    symlinkSync(outside, path.join(workspace, 'octocat-Hello-World'));
    await expect(
      cloneChecked({ workspaceRoot: workspace, dirName: 'octocat-Hello-World', remote: REMOTE, token: TOKEN }),
    ).rejects.toThrow('exists');
    expect(readFileSync(path.join(outside, 'keep'), 'utf8')).toBe('safe');
  });

  it('rejects a destination that escapes the workspace', async () => {
    const workspace = tempDir();
    const outside = path.join(path.dirname(workspace), 'outside-target');
    await expect(
      cloneChecked({ workspaceRoot: workspace, dirName: '../outside-target', remote: REMOTE }),
    ).rejects.toThrow('invalid_name');
    expect(() => readFileSync(outside)).toThrow();
  });

  it('deletes the destination when the clone is too large', async () => {
    const source = seedRepo();
    const workspace = tempDir();
    await expect(
      cloneChecked({
        workspaceRoot: workspace,
        dirName: 'octocat-Hello-World',
        remote: REMOTE,
        fetchUrl: source,
        maxBytes: 20,
        pollMs: 10,
      }),
    ).rejects.toThrow('too_large');
    expect(() => readFileSync(path.join(workspace, 'octocat-Hello-World', 'README.md'))).toThrow();
  });

  it('stops a clone that does not finish and removes the partial folder', async () => {
    const workspace = tempDir();
    const server = createServer((socket) => {
      socket.pause();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        cloneChecked({
          workspaceRoot: workspace,
          dirName: 'octocat-Hello-World',
          remote: REMOTE,
          fetchUrl: `http://127.0.0.1:${port}/Hello-World.git`,
          timeoutMs: 400,
        }),
      ).rejects.toThrow('timeout');
      expect(() => readFileSync(path.join(workspace, 'octocat-Hello-World', 'README.md'))).toThrow();
    } finally {
      server.close();
    }
  });
});

describe('pull and remove', () => {
  it('refuses to pull a dirty checkout and does not reset it', async () => {
    const source = seedRepo();
    const workspace = tempDir();
    await cloneChecked({ workspaceRoot: workspace, dirName: 'octocat-Hello-World', remote: REMOTE, fetchUrl: source });
    const dest = path.join(workspace, 'octocat-Hello-World');
    writeFileSync(path.join(dest, 'local.txt'), 'keep me\n');
    await expect(pullFastForward({ workspaceRoot: workspace, projectPath: 'octocat-Hello-World' })).rejects.toThrow('dirty');
    expect(readFileSync(path.join(dest, 'local.txt'), 'utf8')).toBe('keep me\n');
  });

  it('removes one workspace directory', async () => {
    const source = seedRepo();
    const workspace = tempDir();
    await cloneChecked({ workspaceRoot: workspace, dirName: 'octocat-Hello-World', remote: REMOTE, fetchUrl: source });
    writeFileSync(path.join(workspace, 'keep.txt'), 'stay');
    removeWorkspace(workspace, 'octocat-Hello-World');
    expect(() => readFileSync(path.join(workspace, 'octocat-Hello-World', 'README.md'))).toThrow();
    expect(readFileSync(path.join(workspace, 'keep.txt'), 'utf8')).toBe('stay');
  });
});

describe('spawn env', () => {
  it('does not put the token on the agent command line', async () => {
    const child = spawn('node', ['-e', 'process.exit(0)'], { env: agentEnv({ PATH: process.env.PATH, GITHUB_TOKEN: TOKEN }) });
    expect(child.spawnargs.join(' ')).not.toContain(TOKEN);
    expect(child.spawnargs.join(' ')).not.toContain('GITHUB_TOKEN');
    await new Promise((resolve) => child.once('exit', resolve));
  });
});
