export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'extra-high' | 'max' | 'bare';

export const EFFORT_ORDER: Effort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'extra-high', 'max', 'bare'];

export const EFFORT_LABEL: Record<Effort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  'extra-high': 'Extra High',
  max: 'Max',
  bare: 'Default',
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
  name: string;
  families: ModelFamily[];
};

export type ModelChoice = {
  familyId: string;
  effort: Effort;
  thinking: boolean;
  fast: boolean;
};

export function findFamily(groups: ModelGroup[], id: string): ModelFamily | undefined {
  for (const group of groups) {
    const family = group.families.find((item) => item.id === id);
    if (family) return family;
  }
  return undefined;
}

export function hasBothThinking(family: ModelFamily): boolean {
  let on = false;
  let off = false;
  for (const option of family.options) {
    if (option.thinking) on = true;
    else off = true;
  }
  return on && off;
}

export function effortsFor(family: ModelFamily, thinking: boolean): Effort[] {
  const present = new Set(family.options.filter((option) => option.thinking === thinking).map((option) => option.effort));
  return EFFORT_ORDER.filter((effort) => present.has(effort));
}

export function nearestEffort(current: Effort, available: Effort[]): Effort {
  const first = available[0];
  if (!first) return current;
  if (available.includes(current)) return current;
  if (current === 'bare') return available.includes('medium') ? 'medium' : first;
  const currentAt = EFFORT_ORDER.indexOf(current);
  let best = first;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const effort of available) {
    if (effort === 'bare') continue;
    const distance = Math.abs(EFFORT_ORDER.indexOf(effort) - currentAt);
    const better = distance < bestDistance || (distance === bestDistance && EFFORT_ORDER.indexOf(effort) > EFFORT_ORDER.indexOf(best));
    if (better) {
      best = effort;
      bestDistance = distance;
    }
  }
  return bestDistance === Number.POSITIVE_INFINITY ? first : best;
}

export function optionFor(family: ModelFamily, effort: Effort, thinking: boolean): ModelOption | undefined {
  return family.options.find((option) => option.effort === effort && option.thinking === thinking);
}

export function composedId(option: ModelOption, fast: boolean): string {
  return fast && option.fastId ? option.fastId : option.id;
}

export function choiceForFamily(family: ModelFamily): ModelChoice {
  const thinking = hasBothThinking(family) ? false : family.options.some((option) => option.thinking);
  const available = effortsFor(family, thinking);
  const effort = available.includes('medium') ? 'medium' : available.includes('high') ? 'high' : available[0] ?? 'bare';
  return { familyId: family.id, effort, thinking, fast: false };
}

export function matchChoice(groups: ModelGroup[], modelId: string): ModelChoice | null {
  for (const group of groups) {
    for (const family of group.families) {
      for (const option of family.options) {
        if (option.id === modelId) return { familyId: family.id, effort: option.effort, thinking: option.thinking, fast: false };
        if (option.fastId === modelId) return { familyId: family.id, effort: option.effort, thinking: option.thinking, fast: true };
      }
    }
  }
  return null;
}

export function resolveChoice(groups: ModelGroup[], choice: ModelChoice): { option: ModelOption; id: string } | null {
  const family = findFamily(groups, choice.familyId);
  if (!family) return null;
  const option = optionFor(family, choice.effort, choice.thinking);
  if (!option) return null;
  return { option, id: composedId(option, choice.fast) };
}
