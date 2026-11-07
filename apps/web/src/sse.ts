import { ApiError } from './api';
import type { TimelineEvent } from './timeline';

export type SseFrame = { id: string | null; event: string; data: string };

export function consumeSseBuffer(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let rest = buffer;
  while (true) {
    const split = rest.indexOf('\n\n');
    if (split < 0) break;
    const block = rest.slice(0, split);
    rest = rest.slice(split + 2);
    const frame = parseBlock(block);
    if (frame) frames.push(frame);
  }
  return { frames, rest };
}

function parseBlock(block: string): SseFrame | null {
  let id: string | null = null;
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'id') id = value;
    else if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { id, event, data: data.join('\n') };
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
  onEvent: (event: TimelineEvent) => void,
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
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const consumed = consumeSseBuffer(buf);
    buf = consumed.rest;
    for (const frame of consumed.frames) {
      const event = frameToEvent(frame);
      if (event) onEvent(event);
    }
  }
}
