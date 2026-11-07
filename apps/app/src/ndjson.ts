export type ParsedCli =
  | { kind: 'blank' }
  | { kind: 'event'; type: string; subtype: string | null; sessionId: string | null; payload: unknown }
  | { kind: 'unparsed'; payload: { raw: string } };

export type RunnerLine =
  | { kind: 'started'; runId: string }
  | { kind: 'cli'; raw: string }
  | {
      kind: 'exit';
      runId: string;
      code: number | null;
      signal: string | null;
      timedOut: boolean;
      stopped: boolean;
      error?: string;
    };

/** Parse one CLI stdout line. Unknown objects are kept; non-JSON becomes `unparsed`. */
export function parseNdjsonLine(line: string): ParsedCli {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'blank' };
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { kind: 'unparsed', payload: { raw: trimmed } };
    }
    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' && record.type.length > 0 ? record.type : 'unknown';
    const subtype = typeof record.subtype === 'string' ? record.subtype : null;
    const sessionId = typeof record.session_id === 'string' ? record.session_id : null;
    return { kind: 'event', type, subtype, sessionId, payload: value };
  } catch {
    return { kind: 'unparsed', payload: { raw: trimmed } };
  }
}

export function parseRunnerLine(line: string): RunnerLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'started' && typeof record.runId === 'string') {
    return { kind: 'started', runId: record.runId };
  }
  if (record.kind === 'cli' && typeof record.raw === 'string') {
    return { kind: 'cli', raw: record.raw };
  }
  if (record.kind === 'exit' && typeof record.runId === 'string') {
    return {
      kind: 'exit',
      runId: record.runId,
      code: typeof record.code === 'number' ? record.code : null,
      signal: typeof record.signal === 'string' ? record.signal : null,
      timedOut: record.timedOut === true,
      stopped: record.stopped === true,
      ...(typeof record.error === 'string' ? { error: record.error } : {}),
    };
  }
  return null;
}

/** Reassemble newline-delimited text that may arrive in partial chunks. */
export function createLineSplitter(onLine: (line: string) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        onLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
        idx = buf.indexOf('\n');
      }
    },
    flush() {
      if (buf.length === 0) return;
      onLine(buf);
      buf = '';
    },
  };
}
