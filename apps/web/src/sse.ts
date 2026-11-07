import { ApiError } from './api';
import type { TimelineEvent } from './timeline';

export type SseFrame = { id: string | null; event: string; data: string };
export type SsePiece = { kind: 'comment'; text: string } | { kind: 'frame'; frame: SseFrame };
export type StreamPhase = 'replay' | 'live';

export function consumeSseBuffer(buffer: string): { frames: SseFrame[]; pieces: SsePiece[]; rest: string } {
  const frames: SseFrame[] = [];
  const pieces: SsePiece[] = [];
  let rest = buffer;
  while (true) {
    const split = rest.indexOf('\n\n');
    if (split < 0) break;
    const block = rest.slice(0, split);
    rest = rest.slice(split + 2);
    const parsed = parseBlock(block);
    for (const text of parsed.comments) pieces.push({ kind: 'comment', text });
    if (parsed.frame) {
      frames.push(parsed.frame);
      pieces.push({ kind: 'frame', frame: parsed.frame });
    }
  }
  return { frames, pieces, rest };
}

function parseBlock(block: string): { frame: SseFrame | null; comments: string[] } {
  let id: string | null = null;
  let event = 'message';
  const data: string[] = [];
  const comments: string[] = [];
  for (const line of block.split('\n')) {
    if (!line) continue;
    if (line.startsWith(':')) {
      const text = line.slice(1);
      comments.push(text.startsWith(' ') ? text.slice(1) : text);
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'id') id = value;
    else if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return { frame: null, comments };
  return { frame: { id, event, data: data.join('\n') }, comments };
}

/** Events before the `: live` comment are the backlog. Later events are live. */
export function labelStream(
  pieces: SsePiece[],
  phase: StreamPhase = 'replay',
): { phase: StreamPhase; events: Array<{ event: TimelineEvent; phase: StreamPhase }> } {
  const events: Array<{ event: TimelineEvent; phase: StreamPhase }> = [];
  for (const piece of pieces) {
    if (piece.kind === 'comment') {
      if (piece.text === 'live') phase = 'live';
      continue;
    }
    const event = frameToEvent(piece.frame);
    if (event) events.push({ event, phase });
  }
  return { phase, events };
}

export function frameToEvent(frame: SseFrame): TimelineEvent | null {
  if (!frame.id) return null;
  const seq = Number(frame.id);
  if (!Number.isInteger(seq) || seq < 0) return null;
  let payload: unknown = { raw: frame.data };
  try {
    payload = JSON.parse(frame.data) as unknown;
  } catch {
    payload = { raw: frame.data };
  }
  return { seq, type: frame.event, payload };
}

export async function readEventStream(
  url: string,
  signal: AbortSignal,
  onEvent: (event: TimelineEvent, phase: StreamPhase) => void,
): Promise<void> {
  const res = await fetch(url, {
    signal,
    credentials: 'same-origin',
    headers: { accept: 'text/event-stream' },
  });
  if (res.status === 401) throw new ApiError(401, 'unauthorized');
  if (!res.ok || !res.body) throw new ApiError(res.status, 'stream_error');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let phase: StreamPhase = 'replay';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const consumed = consumeSseBuffer(buf);
    buf = consumed.rest;
    const labeled = labelStream(consumed.pieces, phase);
    phase = labeled.phase;
    for (const item of labeled.events) onEvent(item.event, item.phase);
  }
}
