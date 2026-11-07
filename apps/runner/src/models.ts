export const DEFAULT_MODEL_FAMILIES = [
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
] as const;

const EFFORTS = ['extra-high', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'extra-high', 'max', 'bare'] as const;
const GROUP_ORDER = ['Auto', 'Grok', 'Claude', 'GPT', 'Gemini', 'Other'] as const;

export type Effort = (typeof EFFORT_ORDER)[number];
export type ModelGroupName = (typeof GROUP_ORDER)[number];

export type ModelEntry = {
  id: string;
  label: string;
};

export type ModelOption = {
  effort: Effort;
  thinking: boolean;
  label: string;
  id: string;
  fastId: string | null;
};

export type ModelFamily = {
  id: string;
  label: string;
  options: ModelOption[];
};

export type ModelGroup = {
  name: ModelGroupName;
  families: ModelFamily[];
};

export function parseModelFamilies(raw: string | undefined): string[] {
  if (!raw) return [...DEFAULT_MODEL_FAMILIES];
  const names = raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  return names.length > 0 ? names : [...DEFAULT_MODEL_FAMILIES];
}

export function cleanLabel(label: string): string {
  return label.replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

export function parseModelList(text: string): ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('Available') || line.startsWith('Tip:')) continue;
    const sep = line.indexOf(' - ');
    if (sep <= 0) continue;
    const id = line.slice(0, sep).trim();
    if (!id || /\s/.test(id)) continue;
    entries.push({ id, label: cleanLabel(line.slice(sep + 3)) });
  }
  return entries;
}

function classify(id: string, known: Set<string>): { base: string; effort: Effort; thinking: boolean; fast: boolean } {
  let core = id;
  let fast = false;
  if (core.endsWith('-fast') && known.has(core.slice(0, -5))) {
    fast = true;
    core = core.slice(0, -5);
  }
  const parts = core.split('-');
  const thinkingAt = parts.indexOf('thinking');
  let thinking = false;
  if (thinkingAt >= 0) {
    thinking = true;
    parts.splice(thinkingAt, 1);
    core = parts.join('-');
  }
  let effort: Effort = 'bare';
  for (const candidate of EFFORTS) {
    const suffix = `-${candidate}`;
    if (core.endsWith(suffix) && core.length > suffix.length) {
      effort = candidate;
      core = core.slice(0, -suffix.length);
      break;
    }
  }
  return { base: core, effort, thinking, fast };
}

function commonLabel(labels: string[]): string {
  if (labels.length === 0) return '';
  let prefix = labels[0] ?? '';
  for (const label of labels.slice(1)) {
    let index = 0;
    const limit = Math.min(prefix.length, label.length);
    while (index < limit && prefix[index] === label[index]) index += 1;
    prefix = prefix.slice(0, index);
  }
  return prefix.trim();
}

export function buildFamilies(entries: ModelEntry[]): ModelFamily[] {
  const known = new Set(entries.map((entry) => entry.id));
  const families = new Map<string, { labels: string[]; options: Map<string, ModelOption> }>();
  const order: string[] = [];
  for (const entry of entries) {
    const part = classify(entry.id, known);
    let family = families.get(part.base);
    if (!family) {
      family = { labels: [], options: new Map() };
      families.set(part.base, family);
      order.push(part.base);
    }
    const key = `${part.effort}|${part.thinking}`;
    const existing = family.options.get(key) ?? {
      effort: part.effort,
      thinking: part.thinking,
      label: entry.label,
      id: part.fast ? entry.id.slice(0, -5) : entry.id,
      fastId: null,
    };
    if (part.fast) existing.fastId = entry.id;
    else {
      existing.id = entry.id;
      existing.label = entry.label;
      family.labels.push(entry.label);
    }
    family.options.set(key, existing);
  }
  return order.map((id) => {
    const family = families.get(id);
    const options = [...(family?.options.values() ?? [])].sort((a, b) => {
      const effort = EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort);
      if (effort !== 0) return effort;
      return Number(a.thinking) - Number(b.thinking);
    });
    return { id, label: commonLabel(family?.labels ?? []) || id, options };
  });
}

export function selectFamilies(families: ModelFamily[], names: string[]): ModelFamily[] {
  const byId = new Map(families.map((family) => [family.id, family]));
  const selected: ModelFamily[] = [];
  for (const name of names) {
    const family = byId.get(name);
    if (family) selected.push(family);
  }
  return selected;
}

export function groupOf(id: string): ModelGroupName {
  if (id === 'auto') return 'Auto';
  if (id.startsWith('grok') || id.startsWith('cursor-grok')) return 'Grok';
  if (id.startsWith('claude')) return 'Claude';
  if (id.startsWith('gpt')) return 'GPT';
  if (id.startsWith('gemini')) return 'Gemini';
  return 'Other';
}

export function catalogGroups(families: ModelFamily[]): ModelGroup[] {
  const buckets = new Map<ModelGroupName, ModelFamily[]>();
  for (const family of families) {
    const name = groupOf(family.id);
    const list = buckets.get(name) ?? [];
    list.push(family);
    buckets.set(name, list);
  }
  return GROUP_ORDER.flatMap((name) => {
    const list = buckets.get(name);
    return list && list.length > 0 ? [{ name, families: list }] : [];
  });
}

export function knownModel(entries: ModelEntry[], model: string | null): boolean {
  if (model === null) return true;
  return entries.some((entry) => entry.id === model);
}
