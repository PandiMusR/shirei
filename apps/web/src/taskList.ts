export const LIST_POLL_MS = 15_000;

const TERMINAL = new Set(['succeeded', 'failed', 'stopped', 'interrupted']);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/** Queued work is about to run, so it keeps the list refresh going too. */
export function taskListNeedsPoll(tasks: Array<{ status: string }>): boolean {
  return tasks.some((task) => task.status === 'running' || task.status === 'queued');
}

export function patchTaskList<T extends { id: string }>(tasks: T[], next: T): T[] {
  const index = tasks.findIndex((task) => task.id === next.id);
  if (index < 0) return tasks;
  const copy = tasks.slice();
  copy[index] = next;
  return copy;
}
