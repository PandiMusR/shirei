import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  emptyTimeline,
  filesChanged,
  joinedAssistantText,
  lastLines,
  reduceTimeline,
  shellHasOutput,
  systemInit,
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
    expect(tools[0]).toMatchObject({ state: 'ok', label: '/workspace/hello/hello.js', view: { kind: 'read', path: '/workspace/hello/hello.js' } });
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
    expect(filesChanged(state)).toEqual([
      { path: '/workspace/hello/hello.js', file: 'hello.js', added: 5, removed: 1 },
      { path: '/workspace/hello/hello.test.js', file: 'hello.test.js', added: 5, removed: 0 },
    ]);
    const shells = tools.filter((item) => item.kind === 'tool' && item.view.kind === 'shell');
    expect(shells.map((item) => (item.kind === 'tool' && item.view.kind === 'shell' ? item.view.exitCode : null))).toEqual([1, 127, 0]);
    expect(shells.map((item) => (item.kind === 'tool' ? item.state : ''))).toEqual(['error', 'error', 'ok']);
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

  it('keeps a tool start time after the call completes', () => {
    let state = reduceTimeline(emptyTimeline(), {
      seq: 1,
      type: 'tool_call',
      payload: {
        subtype: 'started',
        call_id: 'c',
        timestamp_ms: 1_000,
        tool_call: { shellToolCall: { args: { command: 'ls' } } },
      },
    });
    state = reduceTimeline(state, {
      seq: 2,
      type: 'tool_call',
      payload: {
        subtype: 'completed',
        call_id: 'c',
        timestamp_ms: 5_000,
        tool_call: { shellToolCall: { args: { command: 'ls' }, result: { success: {} } } },
      },
    });
    expect(state.items.find((item) => item.kind === 'tool')).toMatchObject({ state: 'ok', startedAt: 1_000 });
  });

  it('renders an edit as file counts and a shell rejection as an error', () => {
    let state = reduceTimeline(emptyTimeline(), {
      seq: 1,
      type: 'tool_call',
      payload: {
        subtype: 'completed',
        call_id: 'edit-1',
        tool_call: {
          editToolCall: {
            args: { path: '/workspace/hello/hello.js' },
            result: {
              success: {
                path: '/workspace/hello/hello.js',
                linesAdded: 2,
                linesRemoved: 1,
                diffString: '--- a/hello.js\n+++ b/hello.js\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n',
              },
            },
          },
        },
      },
    });
    state = reduceTimeline(state, {
      seq: 2,
      type: 'tool_call',
      payload: {
        subtype: 'completed',
        call_id: 'sh-1',
        tool_call: {
          shellToolCall: {
            args: { command: 'npm test' },
            result: { rejected: { command: 'npm test', reason: '' } },
          },
        },
      },
    });
    state = reduceTimeline(state, {
      seq: 3,
      type: 'tool_call',
      payload: {
        subtype: 'completed',
        call_id: 'glob-1',
        tool_call: {
          globToolCall: {
            args: { globPattern: '*.js' },
            result: { success: { pattern: '*.js', files: ['a.js'], totalFiles: 1 } },
          },
        },
      },
    });
    const edit = state.items.find((item) => item.kind === 'tool' && item.callId === 'edit-1');
    expect(edit).toMatchObject({ label: 'hello.js +2 −1', state: 'ok', view: { kind: 'edit', added: 2, removed: 1 } });
    const shell = state.items.find((item) => item.kind === 'tool' && item.callId === 'sh-1');
    expect(shell).toMatchObject({ state: 'error', view: { kind: 'shell', command: 'npm test', rejected: true, exitCode: null } });
    const glob = state.items.find((item) => item.kind === 'tool' && item.callId === 'glob-1');
    expect(glob).toMatchObject({ label: '*.js', view: { kind: 'glob', pattern: '*.js', total: 1 } });
    expect(filesChanged(state)).toEqual([{ path: '/workspace/hello/hello.js', file: 'hello.js', added: 2, removed: 1 }]);
  });

  it('keeps the last 50 lines of shell output', () => {
    const stdout = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n');
    const state = reduceTimeline(emptyTimeline(), {
      seq: 1,
      type: 'tool_call',
      payload: {
        subtype: 'completed',
        call_id: 'sh',
        tool_call: {
          shellToolCall: {
            args: { command: 'yes' },
            result: { success: { command: 'yes', exitCode: 0, stdout, stderr: '' } },
          },
        },
      },
    });
    const tool = state.items.find((item) => item.kind === 'tool');
    expect(tool?.kind).toBe('tool');
    if (tool?.kind === 'tool' && tool.view.kind === 'shell') {
      expect(tool.view.stdoutHidden).toBe(10);
      expect(tool.view.stdout.startsWith('line 11')).toBe(true);
      expect(tool.view.stdout.endsWith('line 60')).toBe(true);
      expect(tool.view.exitCode).toBe(0);
      expect(tool.state).toBe('ok');
    }
    expect(lastLines('a\nb', 50)).toEqual({ text: 'a\nb', hidden: 0 });
  });

  it('hides shell output when stdout and stderr are blank', () => {
    expect(shellHasOutput('', '')).toBe(false);
    expect(shellHasOutput('\n  ', '\n')).toBe(false);
    expect(shellHasOutput('ok', '')).toBe(true);
    const state = reduceTimeline(emptyTimeline(), {
      seq: 1,
      type: 'tool_call',
      payload: {
        subtype: 'completed',
        call_id: 'sh',
        tool_call: {
          shellToolCall: {
            args: { command: 'true' },
            result: { success: { command: 'true', exitCode: 0, stdout: '\n', stderr: '' } },
          },
        },
      },
    });
    const tool = state.items.find((item) => item.kind === 'tool');
    expect(tool?.kind).toBe('tool');
    if (tool?.kind === 'tool' && tool.view.kind === 'shell') {
      expect(tool.view.exitCode).toBe(0);
      expect(shellHasOutput(tool.view.stdout, tool.view.stderr)).toBe(false);
    }
  });

  it('reads the model from system/init and ignores other events', () => {
    expect(systemInit({ seq: 1, type: 'system', payload: { subtype: 'init', model: 'Grok 4.7' } })).toEqual({
      model: 'Grok 4.7',
    });
    expect(systemInit({ seq: 2, type: 'assistant', payload: { subtype: 'init', model: 'nope' } })).toBeNull();
    const state = reduceTimeline(emptyTimeline(), { seq: 1, type: 'system', payload: { subtype: 'init', model: 'Grok 4.7' } });
    expect(state.items).toEqual([]);
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
