import { describe, expect, it } from 'vitest';
import { isTerminalStatus, LIST_POLL_MS, patchTaskList, taskListNeedsPoll } from './taskList';

describe('task list freshness', () => {
  it('treats a finished run as terminal and keeps queued work polling', () => {
    expect(LIST_POLL_MS).toBe(15_000);
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('stopped')).toBe(true);
    expect(isTerminalStatus('interrupted')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('queued')).toBe(false);
    expect(taskListNeedsPoll([{ status: 'succeeded' }, { status: 'failed' }])).toBe(false);
    expect(taskListNeedsPoll([{ status: 'running' }])).toBe(true);
    expect(taskListNeedsPoll([{ status: 'queued' }])).toBe(true);
  });

  it('replaces the matching task and leaves an unknown id alone', () => {
    const tasks = [
      { id: 'a', status: 'running' },
      { id: 'b', status: 'queued' },
    ];
    const next = patchTaskList(tasks, { id: 'a', status: 'succeeded' });
    expect(next).toEqual([
      { id: 'a', status: 'succeeded' },
      { id: 'b', status: 'queued' },
    ]);
    expect(next).not.toBe(tasks);
    expect(patchTaskList(tasks, { id: 'missing', status: 'succeeded' })).toBe(tasks);
  });
});
