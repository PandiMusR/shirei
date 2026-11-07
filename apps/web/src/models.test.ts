import { describe, expect, it } from 'vitest';
import { choiceForFamily, composedId, effortsFor, hasBothThinking, nearestEffort, optionFor, resolveChoice, type ModelFamily, type ModelGroup } from './models';

const opus: ModelFamily = {
  id: 'claude-opus-5',
  label: 'Claude Opus 5 1M',
  options: [
    { effort: 'low', thinking: false, label: 'Low', id: 'claude-opus-5-low', fastId: 'claude-opus-5-low-fast' },
    { effort: 'medium', thinking: false, label: 'Medium', id: 'claude-opus-5-medium', fastId: 'claude-opus-5-medium-fast' },
    { effort: 'high', thinking: false, label: 'High', id: 'claude-opus-5-high', fastId: 'claude-opus-5-high-fast' },
    { effort: 'low', thinking: true, label: 'Low Thinking', id: 'claude-opus-5-thinking-low', fastId: 'claude-opus-5-thinking-low-fast' },
    { effort: 'medium', thinking: true, label: 'Medium Thinking', id: 'claude-opus-5-thinking-medium', fastId: null },
    { effort: 'high', thinking: true, label: 'High Thinking', id: 'claude-opus-5-thinking-high', fastId: 'claude-opus-5-thinking-high-fast' },
    { effort: 'xhigh', thinking: true, label: 'Extra High Thinking', id: 'claude-opus-5-thinking-xhigh', fastId: 'claude-opus-5-thinking-xhigh-fast' },
    { effort: 'max', thinking: true, label: 'Max Thinking', id: 'claude-opus-5-thinking-max', fastId: null },
  ],
};

const groups: ModelGroup[] = [{ name: 'Claude', families: [opus] }];

describe('model choice', () => {
  it('snaps to the nearest effort that exists when thinking toggles', () => {
    expect(hasBothThinking(opus)).toBe(true);
    expect(effortsFor(opus, false)).toEqual(['low', 'medium', 'high']);
    expect(nearestEffort('xhigh', effortsFor(opus, false))).toBe('high');
    expect(nearestEffort('medium', effortsFor(opus, true))).toBe('medium');
    expect(nearestEffort('low', ['high', 'max'])).toBe('high');
  });

  it('composes the exact fast or plain id', () => {
    const plain = optionFor(opus, 'high', true);
    expect(plain && composedId(plain, false)).toBe('claude-opus-5-thinking-high');
    expect(plain && composedId(plain, true)).toBe('claude-opus-5-thinking-high-fast');
    const noFast = optionFor(opus, 'max', true);
    expect(noFast && composedId(noFast, true)).toBe('claude-opus-5-thinking-max');
    expect(resolveChoice(groups, { familyId: 'claude-opus-5', effort: 'xhigh', thinking: true, fast: true })?.id).toBe(
      'claude-opus-5-thinking-xhigh-fast',
    );
  });

  it('starts a two-form family on a non-thinking level', () => {
    expect(choiceForFamily(opus)).toEqual({ familyId: 'claude-opus-5', effort: 'medium', thinking: false, fast: false });
  });
});
