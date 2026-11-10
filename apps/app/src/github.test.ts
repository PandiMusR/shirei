import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DbHandle } from './db/client';
import { runMigrations } from './db/migrate';
import { parseGitHubRepo, validBranch } from './github';
import { getProject, insertProject, listProjects, markProjectRemoved, saveGitProject } from './tasks';

const REMOTE = 'https://github.com/octocat/Hello-World.git';
const migrationsDir = fileURLToPath(new URL('../drizzle', import.meta.url));
const handles: DbHandle[] = [];

async function database(): Promise<DbHandle> {
  const handle = await openDatabase('file::memory:');
  await runMigrations(handle.client, migrationsDir);
  handles.push(handle);
  return handle;
}

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
});

describe('parseGitHubRepo', () => {
  it('uses an owner-repo directory and a plain https remote', () => {
    expect(parseGitHubRepo('octocat/Hello-World')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
      remote: REMOTE,
      dirName: 'octocat-Hello-World',
    });
    expect(parseGitHubRepo('https://github.com/octocat/Hello-World.git')?.dirName).toBe('octocat-Hello-World');
    expect(parseGitHubRepo(`https://user:ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAA@github.com/octocat/Hello-World`)).toBeNull();
    expect(parseGitHubRepo('https://github.com/octocat/Hello-World?x=1')).toBeNull();
    expect(validBranch('-main')).toBe(false);
    expect(validBranch('release/1.0')).toBe(true);
  });
});

describe('removed projects', () => {
  it('hides a removed project from the list and still returns it by id', async () => {
    const { db } = await database();
    const project = await insertProject(db, { name: 'octocat/Hello-World', path: 'octocat-Hello-World', source: 'git', repoUrl: REMOTE });
    expect(await listProjects(db)).toHaveLength(1);
    await markProjectRemoved(db, project.id);
    expect(await listProjects(db)).toHaveLength(0);
    expect((await getProject(db, project.id))?.name).toBe('octocat/Hello-World');
    const revived = await saveGitProject(db, { name: 'octocat/Hello-World', path: 'octocat-Hello-World', repoUrl: REMOTE });
    expect(revived.id).toBe(project.id);
    expect(await listProjects(db)).toHaveLength(1);
    await expect(saveGitProject(db, { name: 'octocat/Hello-World', path: 'octocat-Hello-World', repoUrl: REMOTE })).rejects.toThrow(/UNIQUE|Failed query/);
  });
});
