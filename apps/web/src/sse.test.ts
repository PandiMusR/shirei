import { describe, expect, it } from 'vitest';
import { consumeSseBuffer, frameToEvent } from './sse';

describe('sse frames', () => {
  it('parses a frame split across chunks and ignores pings', () => {
    const first = consumeSseBuffer(': ping\n\nid: 3\nevent: assistant\ndata: {"type":"assi');
    expect(first.frames).toEqual([]);
    const second = consumeSseBuffer(`${first.rest}stant"}\n\n`);
    expect(second.frames).toHaveLength(1);
    const frame = second.frames[0];
    expect(frame).toBeDefined();
    if (!frame) return;
    expect(frameToEvent(frame)).toEqual({
      seq: 3,
      type: 'assistant',
      payload: { type: 'assistant' },
    });
  });
});
