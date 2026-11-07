import { describe, expect, it } from 'vitest';
import { earlierTurns, type SessionTurn } from './tasks';

function turn(id: string, sessionId: string | null, createdAt: number): SessionTurn {
  return { id, sessionId, createdAt };
}

describe('earlierTurns', () => {
  const current = turn('c', 'sess', 30);

  it('returns earlier tasks in the same session, oldest first', () => {
    const rows = [turn('b', 'sess', 20), turn('a', 'sess', 10), current, turn('d', 'sess', 40), turn('z', 'other', 5)];
    expect(earlierTurns(current, rows).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('returns nothing when this task has no session yet', () => {
    expect(earlierTurns(turn('c', null, 30), [turn('a', null, 10)])).toEqual([]);
  });

  it('breaks a createdAt tie by id', () => {
    const rows = [turn('m', 'sess', 10), turn('a', 'sess', 10)];
    expect(earlierTurns(current, rows).map((row) => row.id)).toEqual(['a', 'm']);
  });
});
