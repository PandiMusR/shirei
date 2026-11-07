import { describe, expect, it } from 'vitest';
import { createLineSplitter, parseNdjsonLine, parseRunnerLine } from './ndjson';

describe('parseNdjsonLine', () => {
  it('reads session_id from system/init and keeps subtypes', () => {
    const init = parseNdjsonLine(
      '{"type":"system","subtype":"init","session_id":"sess-1","model":"Auto","cwd":"/workspace/hello"}',
    );
    expect(init).toMatchObject({ kind: 'event', type: 'system', subtype: 'init', sessionId: 'sess-1' });

    const thinking = parseNdjsonLine('{"type":"thinking","subtype":"delta","text":"hmm","session_id":"sess-1"}');
    expect(thinking).toMatchObject({ kind: 'event', type: 'thinking', subtype: 'delta', sessionId: 'sess-1' });

    const tool = parseNdjsonLine('{"type":"tool_call","subtype":"started","call_id":"c1","session_id":"sess-1"}');
    expect(tool).toMatchObject({ kind: 'event', type: 'tool_call', subtype: 'started' });
  });

  it('stores unknown types as-is and non-JSON as unparsed', () => {
    const unknown = parseNdjsonLine('{"type":"future_event","hello":1}');
    expect(unknown).toMatchObject({ kind: 'event', type: 'future_event', subtype: null });
    if (unknown.kind === 'event') expect(unknown.payload).toMatchObject({ hello: 1 });

    expect(parseNdjsonLine('not-json')).toEqual({ kind: 'unparsed', payload: { raw: 'not-json' } });
    expect(parseNdjsonLine('   ')).toEqual({ kind: 'blank' });
    expect(parseNdjsonLine('[1,2]')).toEqual({ kind: 'unparsed', payload: { raw: '[1,2]' } });
  });

  it('joins partial chunks on newlines', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push('{"type":"user"');
    splitter.push('}\n{"type":"assi');
    splitter.push('stant"}\n');
    expect(lines).toEqual(['{"type":"user"}', '{"type":"assistant"}']);
    splitter.push('{"type":"result"}');
    splitter.flush();
    expect(lines[2]).toBe('{"type":"result"}');
  });
});

describe('parseRunnerLine', () => {
  it('accepts started, cli, and exit wrappers', () => {
    expect(parseRunnerLine('{"kind":"started","runId":"r1"}')).toEqual({ kind: 'started', runId: 'r1' });
    expect(parseRunnerLine('{"kind":"cli","raw":"{\\"type\\":\\"user\\"}"}')).toMatchObject({ kind: 'cli' });
    expect(parseRunnerLine('{"kind":"exit","runId":"r1","code":0,"signal":null,"timedOut":false,"stopped":true}')).toMatchObject({
      kind: 'exit',
      stopped: true,
      code: 0,
    });
    expect(parseRunnerLine('')).toBeNull();
  });
});
