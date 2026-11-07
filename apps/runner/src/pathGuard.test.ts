import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PathGuardError, resolveWorkspacePath } from './pathGuard';

const root = mkdtempSync(path.join(tmpdir(), 'shirei-ws-'));
const outside = mkdtempSync(path.join(tmpdir(), 'shirei-out-'));

mkdirSync(path.join(root, 'hello', 'nested'), { recursive: true });
writeFileSync(path.join(root, 'hello', 'hello.js'), 'module.exports = {};\n');
symlinkSync(outside, path.join(root, 'escape'));
symlinkSync(path.join(root, 'hello'), path.join(root, 'alias'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('resolveWorkspacePath', () => {
  it('resolves a nested directory inside the workspace', () => {
    const resolved = resolveWorkspacePath(root, 'hello/nested');
    expect(resolved).toBe(path.join(root, 'hello', 'nested'));
  });

  it('follows a symlink that stays inside the workspace', () => {
    expect(resolveWorkspacePath(root, 'alias')).toBe(path.join(root, 'hello'));
  });

  it('rejects absolute paths, dot segments, and symlink escapes', () => {
    expect(() => resolveWorkspacePath(root, '/etc')).toThrow(PathGuardError);
    expect(() => resolveWorkspacePath(root, '../etc')).toThrowError(expect.objectContaining({ code: 'escape' }));
    expect(() => resolveWorkspacePath(root, 'hello/../../etc')).toThrowError(
      expect.objectContaining({ code: 'escape' }),
    );
    expect(() => resolveWorkspacePath(root, '.')).toThrowError(expect.objectContaining({ code: 'escape' }));
    expect(() => resolveWorkspacePath(root, 'escape')).toThrowError(expect.objectContaining({ code: 'escape' }));
    expect(() => resolveWorkspacePath(root, 'missing')).toThrowError(expect.objectContaining({ code: 'missing' }));
  });
});
