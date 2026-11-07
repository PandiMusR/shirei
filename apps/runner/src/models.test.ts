import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createModelCatalog } from './modelCatalog';
import {
  buildFamilies,
  catalogGroups,
  cleanLabel,
  knownModel,
  parseModelFamilies,
  parseModelList,
  selectFamilies,
} from './models';

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/models.txt'), 'utf8');

describe('model list', () => {
  const entries = parseModelList(fixture);
  const families = buildFamilies(entries);

  it('parses every listed id and rejects an unknown one', () => {
    expect(entries).toHaveLength(270);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(270);
    expect(knownModel(entries, null)).toBe(true);
    expect(knownModel(entries, 'auto')).toBe(true);
    expect(knownModel(entries, 'claude-opus-4-8-thinking-medium-fast')).toBe(true);
    expect(knownModel(entries, 'not-a-model')).toBe(false);
  });

  it('keeps thinking position, extra-high, and fast siblings from the real list', () => {
    const opus = families.find((family) => family.id === 'claude-opus-5');
    const legacy = families.find((family) => family.id === 'claude-4.6-opus');
    const sonnet = families.find((family) => family.id === 'claude-4.5-sonnet');
    const gpt55 = families.find((family) => family.id === 'gpt-5.5');
    const gpt54 = families.find((family) => family.id === 'gpt-5.4');
    expect(opus?.options.find((option) => option.id === 'claude-opus-5-thinking-high')).toMatchObject({
      effort: 'high',
      thinking: true,
      fastId: 'claude-opus-5-thinking-high-fast',
    });
    expect(legacy?.options.find((option) => option.id === 'claude-4.6-opus-high')).toMatchObject({
      effort: 'high',
      thinking: false,
    });
    expect(legacy?.options.find((option) => option.thinking && option.effort === 'high')?.id).toBe('claude-4.6-opus-high-thinking');
    expect(sonnet?.options.find((option) => option.thinking)?.id).toBe('claude-4.5-sonnet-thinking');
    expect(gpt55?.options.find((option) => option.effort === 'extra-high')).toMatchObject({
      id: 'gpt-5.5-extra-high',
      fastId: 'gpt-5.5-extra-high-fast',
    });
    expect(gpt54?.options.find((option) => option.effort === 'low')?.fastId).toBeNull();
    expect(gpt54?.options.find((option) => option.effort === 'medium')?.fastId).toBe('gpt-5.4-medium-fast');
  });

  it('filters MODEL_FAMILIES in order and skips names missing from the live list', () => {
    const shown = selectFamilies(families, ['auto', 'does-not-exist', 'grok-4.7', 'claude-opus-5-5']);
    expect(shown.map((family) => family.id)).toEqual(['auto', 'grok-4.7', 'claude-opus-5-5']);
    expect(catalogGroups(shown).map((group) => group.name)).toEqual(['Auto', 'Grok', 'Claude']);
    expect(knownModel(entries, 'claude-opus-4-8-thinking-high')).toBe(true);
    expect(parseModelFamilies(undefined)).toEqual([
      'auto',
      'grok-4.7',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-fable-5-1',
      'claude-haiku-5-5',
      'gpt-5.6-sol',
      'gpt-5.6-luna',
      'gpt-5.6-terra',
      'gemini-4-argon',
    ]);
  });

  it('strips zero-width characters from labels', () => {
    expect(cleanLabel('Grok 4.7 Low Fast\u200b\u200b')).toBe('Grok 4.7 Low Fast');
  });

  it('keeps the last good list when a refresh fails', async () => {
    let calls = 0;
    let now = 0;
    const catalog = createModelCatalog({
      now: () => now,
      ttlMs: 10 * 60 * 1000,
      loadText: async () => {
        calls += 1;
        if (calls > 1) throw new Error('nope');
        return 'auto - Auto (default)\n';
      },
    });
    expect(await catalog.entries()).toEqual([{ id: 'auto', label: 'Auto (default)' }]);
    now = 1_000;
    await catalog.entries();
    expect(calls).toBe(1);
    now = 10 * 60 * 1000;
    expect((await catalog.entries()).map((entry) => entry.id)).toEqual(['auto']);
    expect(calls).toBe(2);
  });
});
