import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export type PathGuardCode = 'invalid' | 'escape' | 'missing';

export class PathGuardError extends Error {
  readonly code: PathGuardCode;

  constructor(code: PathGuardCode) {
    super(code);
    this.name = 'PathGuardError';
    this.code = code;
  }
}

/** Resolve `projectPath` to a real directory strictly inside `workspaceRoot`. */
export function resolveWorkspacePath(workspaceRoot: string, projectPath: string): string {
  if (typeof projectPath !== 'string' || projectPath.length === 0 || projectPath.length > 512) {
    throw new PathGuardError('invalid');
  }
  if (projectPath.includes('\0') || projectPath.startsWith('~')) throw new PathGuardError('invalid');
  if (path.isAbsolute(projectPath) || path.win32.isAbsolute(projectPath)) throw new PathGuardError('escape');

  const parts = projectPath.split(/[\\/]+/).filter((part) => part.length > 0);
  if (parts.length === 0) throw new PathGuardError('invalid');
  if (parts.some((part) => part === '.' || part === '..')) throw new PathGuardError('escape');

  let root: string;
  try {
    root = realpathSync(workspaceRoot);
  } catch {
    throw new PathGuardError('missing');
  }
  const joined = path.resolve(root, ...parts);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (joined !== root && !joined.startsWith(rootPrefix)) throw new PathGuardError('escape');

  let real: string;
  try {
    real = realpathSync(joined);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new PathGuardError('missing');
    throw new PathGuardError('invalid');
  }
  if (real !== root && !real.startsWith(rootPrefix)) throw new PathGuardError('escape');
  if (real === root) throw new PathGuardError('escape');
  return real;
}

export function workspaceStat(resolved: string): { isDirectory: boolean } {
  const stat = statSync(resolved);
  return { isDirectory: stat.isDirectory() };
}
