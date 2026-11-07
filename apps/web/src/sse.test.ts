import { describe, expect, it } from 'vitest';
import { consumeSseBuffer, frameToEvent, labelStream } from './sse';

describe('sse frames', () => {
  it('parses a frame split across chunks and ignores pings', () => {
    const first = consumeSseBuffer(': ping\n\nid: 3\nevent: assistant\ndata: {"type":"assi');
    expect(first.frames).toEqual([]);
    expect(consumeSseBuffer(': open\n\n').frames).toEqual([]);
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

  it('tags events before : live as replay and the rest as live', () => {
    const raw = ': open\n\nid: 1\nevent: system\ndata: {}\n\n: ping\n\n: live\n\nid: 2\nevent: assistant\ndata: {"type":"assistant"}\n\n';
    const consumed = consumeSseBuffer(raw);
    const comments = consumed.pieces.flatMap((piece) => (piece.kind === 'comment' ? [piece.text] : []));
    expect(comments).toEqual(['open', 'ping', 'live']);
    const labeled = labelStream(consumed.pieces);
    expect(labeled.phase).toBe('live');
    expect(labeled.events.map((item) => ({ seq: item.event.seq, type: item.event.type, phase: item.phase }))).toEqual([
      { seq: 1, type: 'system', phase: 'replay' },
      { seq: 2, type: 'assistant', phase: 'live' },
    ]);
  });
});
