export type TimelineEvent = {
  seq: number;
  type: string;
  payload: unknown;
};

export type ToolState = 'running' | 'ok' | 'error';

export type ToolView =
  | {
      kind: 'edit';
      path: string;
      file: string;
      added: number | null;
      removed: number | null;
      diff: string | null;
    }
  | {
      kind: 'shell';
      command: string;
      exitCode: number | null;
      rejected: boolean;
      stdout: string;
      stderr: string;
      stdoutHidden: number;
      stderrHidden: number;
    }
  | { kind: 'read'; path: string; startLine: number | null; endLine: number | null }
  | { kind: 'glob'; pattern: string; total: number | null; files: string[] }
  | { kind: 'other' };

export type FileChange = { path: string; file: string; added: number; removed: number };

export type TimelineItem =
  | { kind: 'user'; seq: number; text: string }
  | { kind: 'assistant'; seq: number; text: string }
  | { kind: 'thinking'; seq: number; text: string; done: boolean }
  | {
      kind: 'tool';
      seq: number;
      callId: string;
      label: string;
      state: ToolState;
      detail: string;
      startedAt: number | null;
      view: ToolView;
    }
  | { kind: 'result'; seq: number; text: string; durationMs: number | null; isError: boolean }
  | { kind: 'raw'; seq: number; type: string; text: string };

export type TimelineState = {
  seen: number[];
  items: TimelineItem[];
};

export function emptyTimeline(): TimelineState {
  return { seen: [], items: [] };
}

export function joinedAssistantText(state: TimelineState): string {
  let text = '';
  for (const item of state.items) {
    if (item.kind === 'assistant') text += item.text;
  }
  return text;
}

/** Synthetic user row so the prompt is on screen before the matching CLI event arrives. */
export function promptEvent(prompt: string): TimelineEvent {
  return {
    seq: 0,
    type: 'user',
    payload: { message: { role: 'user', content: [{ type: 'text', text: prompt }] } },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function textFromMessage(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.message) || !Array.isArray(payload.message.content)) return '';
  let text = '';
  for (const part of payload.message.content) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') text += part.text;
  }
  return text;
}

/**
 * Real CLI assistant events come in three shapes.
 * A timestamp and no model_call_id is a new delta. The other two repeat text already streamed.
 */
export function assistantDisposition(payload: unknown): 'delta' | 'skip' {
  if (!isRecord(payload)) return 'skip';
  const hasTimestamp = typeof payload.timestamp_ms === 'number';
  const hasModelCall = typeof payload.model_call_id === 'string' && payload.model_call_id.length > 0;
  return hasTimestamp && !hasModelCall ? 'delta' : 'skip';
}

function subtypeOf(payload: unknown): string | null {
  if (isRecord(payload) && typeof payload.subtype === 'string') return payload.subtype;
  return null;
}

function toolEntry(payload: unknown): { key: string; body: Record<string, unknown> } | null {
  if (!isRecord(payload) || !isRecord(payload.tool_call)) return null;
  const key = Object.keys(payload.tool_call).find((name) => name.endsWith('ToolCall'));
  if (!key) return null;
  const body = payload.tool_call[key];
  return { key, body: isRecord(body) ? body : {} };
}

const OUTPUT_LINES = 50;

export function shellHasOutput(stdout: string, stderr: string): boolean {
  return stdout.trim().length > 0 || stderr.trim().length > 0;
}

export function lastLines(text: string, max = OUTPUT_LINES): { text: string; hidden: number } {
  if (!text) return { text: '', hidden: 0 };
  const lines = text.split('\n');
  if (lines.length <= max) return { text, hidden: 0 };
  return { text: lines.slice(lines.length - max).join('\n'), hidden: lines.length - max };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fileName(path: string): string {
  const base = path.split('/').pop();
  return base && base.length > 0 ? base : path;
}

function resultOf(body: Record<string, unknown>): { key: string; inner: Record<string, unknown> } | null {
  if (!isRecord(body.result)) return null;
  const key = Object.keys(body.result)[0];
  if (!key) return null;
  const inner = body.result[key];
  return { key, inner: isRecord(inner) ? inner : {} };
}

function countDiff(diff: string | null, mark: '+' | '-'): number {
  if (!diff) return 0;
  const fence = mark === '+' ? '+++' : '---';
  let count = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith(mark) && !line.startsWith(fence)) count += 1;
  }
  return count;
}

function toolView(key: string, body: Record<string, unknown>): ToolView {
  const args = isRecord(body.args) ? body.args : {};
  const result = resultOf(body);
  if (key === 'editToolCall') {
    const path = asString(result?.inner.path) ?? asString(args.path) ?? '';
    return {
      kind: 'edit',
      path,
      file: fileName(path),
      added: asNumber(result?.inner.linesAdded),
      removed: asNumber(result?.inner.linesRemoved),
      diff: asString(result?.inner.diffString),
    };
  }
  if (key === 'shellToolCall') {
    const stdout = lastLines(asString(result?.inner.stdout) ?? '');
    const stderr = lastLines(asString(result?.inner.stderr) ?? '');
    return {
      kind: 'shell',
      command: asString(args.command) ?? asString(result?.inner.command) ?? '',
      exitCode: asNumber(result?.inner.exitCode),
      rejected: result?.key === 'rejected',
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutHidden: stdout.hidden,
      stderrHidden: stderr.hidden,
    };
  }
  if (key === 'readToolCall') {
    const range = result && isRecord(result.inner.readRange) ? result.inner.readRange : null;
    return {
      kind: 'read',
      path: asString(args.path) ?? asString(result?.inner.path) ?? '',
      startLine: range ? asNumber(range.startLine) : null,
      endLine: range ? asNumber(range.endLine) : null,
    };
  }
  if (key === 'globToolCall') {
    const files = Array.isArray(result?.inner.files)
      ? result.inner.files.filter((file): file is string => typeof file === 'string')
      : [];
    return {
      kind: 'glob',
      pattern: asString(args.globPattern) ?? asString(result?.inner.pattern) ?? '',
      total: asNumber(result?.inner.totalFiles),
      files,
    };
  }
  return { kind: 'other' };
}

function toolLabel(key: string, view: ToolView): string {
  if (view.kind === 'edit') {
    const name = view.file || 'edit';
    if (view.added == null && view.removed == null) return name;
    return `${name} +${view.added ?? 0} −${view.removed ?? 0}`;
  }
  if (view.kind === 'shell') {
    const first = view.command.split('\n')[0] ?? view.command;
    if (!first) return 'shell';
    return first.length > 80 ? `${first.slice(0, 80)}…` : first;
  }
  if (view.kind === 'read') return view.path || 'read';
  if (view.kind === 'glob') return view.pattern || 'glob';
  return key.replace(/ToolCall$/, '') || 'tool';
}

function toolState(body: Record<string, unknown> | null, completed: boolean): ToolState {
  if (!completed) return 'running';
  const result = body && isRecord(body.result) ? body.result : null;
  if (result && ('failure' in result || 'error' in result || 'rejected' in result)) return 'error';
  return 'ok';
}

export function systemInit(event: TimelineEvent): { model: string | null } | null {
  if (event.type !== 'system' || !isRecord(event.payload) || event.payload.subtype !== 'init') return null;
  const model = typeof event.payload.model === 'string' && event.payload.model.length > 0 ? event.payload.model : null;
  return { model };
}

export function filesChanged(state: TimelineState): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const item of state.items) {
    if (item.kind !== 'tool' || item.view.kind !== 'edit' || item.state === 'running') continue;
    const added = item.view.added ?? countDiff(item.view.diff, '+');
    const removed = item.view.removed ?? countDiff(item.view.diff, '-');
    const prev = byPath.get(item.view.path);
    if (prev) {
      prev.added += added;
      prev.removed += removed;
      continue;
    }
    byPath.set(item.view.path, { path: item.view.path, file: item.view.file || item.view.path, added, removed });
  }
  return [...byPath.values()];
}

function eventTime(payload: unknown): number | null {
  if (!isRecord(payload) || typeof payload.timestamp_ms !== 'number' || !Number.isFinite(payload.timestamp_ms)) return null;
  return payload.timestamp_ms;
}

function callIdOf(payload: unknown): string {
  if (isRecord(payload) && typeof payload.call_id === 'string' && payload.call_id.length > 0) return payload.call_id;
  const found = toolEntry(payload);
  const args = found && isRecord(found.body.args) ? found.body.args : null;
  if (args && typeof args.toolCallId === 'string' && args.toolCallId.length > 0) return args.toolCallId;
  return 'unknown';
}

function detailOf(payload: unknown): string {
  const found = toolEntry(payload);
  const raw = JSON.stringify(found?.body ?? payload, null, 2);
  return raw.length > 4000 ? `${raw.slice(0, 4000)}…` : raw;
}

function rawText(type: string, payload: unknown): string {
  const text =
    type === 'unparsed' && isRecord(payload) && typeof payload.raw === 'string' ? payload.raw : JSON.stringify(payload);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export function runEndLine(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (payload.timedOut === true) return 'Stopped: timed out after 30 min';
  if (payload.reason === 'runner disconnected') return 'Interrupted: runner disconnected';
  return null;
}

function withSeen(state: TimelineState, seq: number, items: TimelineItem[]): TimelineState {
  return { seen: [...state.seen, seq], items };
}

export function reduceTimeline(state: TimelineState, event: TimelineEvent): TimelineState {
  if (state.seen.includes(event.seq)) return state;
  const payload = event.payload;

  if (event.type === 'runner') {
    const line = runEndLine(payload);
    if (!line) return withSeen(state, event.seq, state.items);
    return withSeen(state, event.seq, [
      ...state.items,
      { kind: 'result', seq: event.seq, text: line, durationMs: null, isError: true },
    ]);
  }

  if (event.type === 'system') return withSeen(state, event.seq, state.items);

  if (event.type === 'user') {
    const text = textFromMessage(payload);
    if (state.items.some((item) => item.kind === 'user' && item.text === text)) {
      return withSeen(state, event.seq, state.items);
    }
    return withSeen(state, event.seq, [...state.items, { kind: 'user', seq: event.seq, text }]);
  }

  if (event.type === 'assistant') {
    if (assistantDisposition(payload) === 'skip') return withSeen(state, event.seq, state.items);
    const text = textFromMessage(payload);
    if (!text) return withSeen(state, event.seq, state.items);
    const last = state.items[state.items.length - 1];
    if (last && last.kind === 'assistant') {
      const items = state.items.slice(0, -1);
      items.push({ ...last, text: last.text + text });
      return withSeen(state, event.seq, items);
    }
    return withSeen(state, event.seq, [...state.items, { kind: 'assistant', seq: event.seq, text }]);
  }

  if (event.type === 'thinking') {
    const sub = subtypeOf(payload);
    if (sub === 'completed') {
      const items = state.items.map((item) => (item.kind === 'thinking' ? { ...item, done: true } : item));
      return withSeen(state, event.seq, items);
    }
    const text = isRecord(payload) && typeof payload.text === 'string' ? payload.text : '';
    const last = state.items[state.items.length - 1];
    if (last && last.kind === 'thinking' && !last.done) {
      const items = state.items.slice(0, -1);
      items.push({ ...last, text: last.text + text });
      return withSeen(state, event.seq, items);
    }
    return withSeen(state, event.seq, [...state.items, { kind: 'thinking', seq: event.seq, text, done: false }]);
  }

  if (event.type === 'tool_call') {
    const id = callIdOf(payload);
    const completed = subtypeOf(payload) === 'completed';
    const found = toolEntry(payload);
    const view = found ? toolView(found.key, found.body) : { kind: 'other' as const };
    const next: TimelineItem = {
      kind: 'tool',
      seq: event.seq,
      callId: id,
      label: found ? toolLabel(found.key, view) : 'tool',
      state: toolState(found?.body ?? null, completed),
      detail: detailOf(payload),
      startedAt: eventTime(payload),
      view,
    };
    const index = state.items.findIndex((item) => item.kind === 'tool' && item.callId === id);
    if (index >= 0) {
      const items = state.items.slice();
      const prev = items[index];
      if (prev && prev.kind === 'tool') {
        items[index] = { ...next, seq: prev.seq, startedAt: prev.startedAt ?? next.startedAt };
      }
      return withSeen(state, event.seq, items);
    }
    return withSeen(state, event.seq, [...state.items, next]);
  }

  if (event.type === 'result') {
    const text = isRecord(payload) && typeof payload.result === 'string' ? payload.result : '';
    const durationMs = isRecord(payload) && typeof payload.duration_ms === 'number' ? payload.duration_ms : null;
    const isError = isRecord(payload) && payload.is_error === true;
    return withSeen(state, event.seq, [...state.items, { kind: 'result', seq: event.seq, text, durationMs, isError }]);
  }

  return withSeen(state, event.seq, [
    ...state.items,
    { kind: 'raw', seq: event.seq, type: event.type, text: rawText(event.type, payload) },
  ]);
}
