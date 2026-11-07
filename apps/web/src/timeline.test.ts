import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  emptyTimeline,
  joinedAssistantText,
  reduceTimeline,
  type TimelineEvent,
  type TimelineState,
} from './timeline';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function replay(name: string, start: TimelineState = emptyTimeline()): { state: TimelineState; resultText: string } {
  const text = readFileSync(join(fixtureDir, `${name}.ndjson`), 'utf8');
  expect(text).not.toMatch(/ghp_|github_pat_|CURSOR_API_KEY|Bearer |x-access-token/);
  expect(text).not.toContain('"request_id"');
  let state = start;
  let resultText = '';
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  lines.forEach((line, index) => {
    const payload = JSON.parse(line) as Record<string, unknown>;
    const type = typeof payload.type === 'string' ? payload.type : 'unknown';
    const event: TimelineEvent = { seq: index + 1, type, payload };
    state = reduceTimeline(state, event);
    if (type === 'result' && typeof payload.result === 'string') resultText = payload.result;
  });
  return { state, resultText };
}

describe('spike fixtures', () => {
  for (const name of ['ask', 'force', 'resume']) {
    it(`${name}: assistant text equals the CLI result, once`, () => {
      const { state, resultText } = replay(name);
      expect(resultText.length).toBeGreaterThan(0);
      expect(joinedAssistantText(state)).toBe(resultText);
      const again = replay(name, state);
      expect(joinedAssistantText(again.state)).toBe(resultText);
    });
  }

  it('ask pairs the read tool and keeps one user bubble', () => {
    const { state } = replay('ask');
    const tools = state.items.filter((item) => item.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ state: 'ok', label: 'read hello.js' });
    expect(state.items.filter((item) => item.kind === 'user')).toHaveLength(1);
  });

  it('force keeps thinking collapsed into one item and pairs each call', () => {
    const { state } = replay('force');
    const thinking = state.items.filter((item) => item.kind === 'thinking');
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toMatchObject({ done: true });
    const tools = state.items.filter((item) => item.kind === 'tool');
    expect(tools).toHaveLength(5);
    expect(tools.every((item) => item.kind === 'tool' && item.state !== 'running')).toBe(true);
  });
});

describe('duplicate assistant flushes', () => {
  it('skips a model_call_id flush and a flush with no timestamp', () => {
    const assistant = (seq: number, text: string, fields: Record<string, unknown>): TimelineEvent => ({
      seq,
      type: 'assistant',
      payload: {
        type: 'assistant',
        ...fields,
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      },
    });
    let state = emptyTimeline();
    state = reduceTimeline(state, assistant(1, 'Hello', { timestamp_ms: 1 }));
    state = reduceTimeline(state, assistant(2, ', there', { timestamp_ms: 2 }));
    state = reduceTimeline(state, assistant(3, 'Hello, there', { timestamp_ms: 3, model_call_id: 'call-1' }));
    state = reduceTimeline(state, assistant(4, 'Hello, there', {}));
    state = reduceTimeline(state, {
      seq: 5,
      type: 'result',
      payload: { type: 'result', result: 'Hello, there', duration_ms: 12, is_error: false },
    });
    expect(joinedAssistantText(state)).toBe('Hello, there');
    expect(state.items.filter((item) => item.kind === 'assistant')).toHaveLength(1);
  });

  it('starts a new assistant bubble after a tool call', () => {
    let state = emptyTimeline();
    state = reduceTimeline(state, {
      seq: 1,
      type: 'assistant',
      payload: {
        type: 'assistant',
        timestamp_ms: 1,
        message: { content: [{ type: 'text', text: 'Before' }] },
      },
    });
    state = reduceTimeline(state, {
      seq: 2,
      type: 'tool_call',
      payload: {
        type: 'tool_call',
        subtype: 'started',
        call_id: 'c1',
        tool_call: { shellToolCall: { args: { command: 'ls' } } },
      },
    });
    state = reduceTimeline(state, {
      seq: 3,
      type: 'assistant',
      payload: {
        type: 'assistant',
        timestamp_ms: 2,
        message: { content: [{ type: 'text', text: 'After' }] },
      },
    });
    const bubbles = state.items.filter((item) => item.kind === 'assistant');
    expect(bubbles.map((item) => (item.kind === 'assistant' ? item.text : ''))).toEqual(['Before', 'After']);
  });

  it('replays the same seq without appending', () => {
    const event: TimelineEvent = {
      seq: 1,
      type: 'assistant',
      payload: { timestamp_ms: 1, message: { content: [{ type: 'text', text: 'Once' }] } },
    };
    const once = reduceTimeline(emptyTimeline(), event);
    const twice = reduceTimeline(once, event);
    expect(joinedAssistantText(twice)).toBe('Once');
  });

  it('renders an unknown event as a short raw line', () => {
    const state = reduceTimeline(emptyTimeline(), {
      seq: 1,
      type: 'future_event',
      payload: { type: 'future_event', hello: 'x'.repeat(400) },
    });
    const raw = state.items.find((item) => item.kind === 'raw');
    expect(raw?.kind).toBe('raw');
    if (raw?.kind === 'raw') {
      expect(raw.type).toBe('future_event');
      expect(raw.text.length).toBeLessThanOrEqual(241);
    }
  });

  it('does not add a second user bubble for the same prompt', () => {
    let state = reduceTimeline(emptyTimeline(), {
      seq: 0,
      type: 'user',
      payload: { message: { content: [{ type: 'text', text: 'Say hi' }] } },
    });
    state = reduceTimeline(state, {
      seq: 1,
      type: 'user',
      payload: { message: { content: [{ type: 'text', text: 'Say hi' }] } },
    });
    expect(state.items.filter((item) => item.kind === 'user')).toHaveLength(1);
    expect(state.seen).toEqual([0, 1]);
  });
});
