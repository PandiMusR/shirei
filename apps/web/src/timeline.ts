export type TimelineEvent = {
  seq: number;
  type: string;
  payload: unknown;
};

export type ToolState = 'running' | 'ok' | 'error';

export type TimelineItem =
  | { kind: 'user'; seq: number; text: string }
  | { kind: 'assistant'; seq: number; text: string }
  | { kind: 'thinking'; seq: number; text: string; done: boolean }
  | { kind: 'tool'; seq: number; callId: string; label: string; state: ToolState; detail: string; startedAt: number | null }
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

function toolLabel(payload: unknown): string {
  const found = toolEntry(payload);
  if (!found) return 'tool';
  const name = found.key.replace(/ToolCall$/, '');
  const args = isRecord(found.body.args) ? found.body.args : {};
  if (typeof args.path === 'string' && args.path.length > 0) {
    const file = args.path.split('/').pop() || args.path;
    return `${name} ${file}`;
  }
  if (typeof args.command === 'string' && args.command.length > 0) {
    const first = args.command.split('\n')[0] ?? args.command;
    return first.length > 80 ? `${first.slice(0, 80)}…` : first;
  }
  return name;
}

function toolState(payload: unknown, completed: boolean): ToolState {
  if (!completed) return 'running';
  const found = toolEntry(payload);
  const result = found && isRecord(found.body.result) ? found.body.result : null;
  if (result && ('failure' in result || 'error' in result)) return 'error';
  return 'ok';
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

function withSeen(state: TimelineState, seq: number, items: TimelineItem[]): TimelineState {
  return { seen: [...state.seen, seq], items };
}

export function reduceTimeline(state: TimelineState, event: TimelineEvent): TimelineState {
  if (state.seen.includes(event.seq)) return state;
  const payload = event.payload;

  if (event.type === 'system' || event.type === 'runner') return withSeen(state, event.seq, state.items);

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
    const next: TimelineItem = {
      kind: 'tool',
      seq: event.seq,
      callId: id,
      label: toolLabel(payload),
      state: toolState(payload, completed),
      detail: detailOf(payload),
      startedAt: eventTime(payload),
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
