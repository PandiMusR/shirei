#!/usr/bin/env node
import { writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
let resume = null;
let workspace = null;
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--resume') resume = argv[i + 1] ?? null;
  if (arg === '--workspace') workspace = argv[i + 1] ?? null;
}
const prompt = argv[argv.length - 1] ?? '';
const sessionId = resume || randomUUID();

function emit(obj) {
  writeSync(1, `${JSON.stringify(obj)}\n`);
}

function base() {
  return { session_id: sessionId };
}

emit({
  type: 'system',
  subtype: 'init',
  apiKeySource: 'env',
  cwd: workspace,
  model: 'fake',
  permissionMode: 'default',
  ...base(),
});
emit({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: prompt }] },
  ...base(),
});

function assistantMessage(text) {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

/** Deltas, then the two real-CLI flushes that repeat the full turn and must not be appended. */
function emitAssistant(chunks) {
  let full = '';
  for (const chunk of chunks) {
    full += chunk;
    emit({ type: 'assistant', message: assistantMessage(chunk), timestamp_ms: Date.now(), ...base() });
  }
  emit({
    type: 'assistant',
    message: assistantMessage(full),
    timestamp_ms: Date.now(),
    model_call_id: 'fake-flush',
    ...base(),
  });
  emit({ type: 'assistant', message: assistantMessage(full), ...base() });
  return full;
}

function emitRead(subtype, result) {
  emit({
    type: 'tool_call',
    subtype,
    call_id: 'fake-1',
    tool_call: { readToolCall: { args: { path: 'README.md' }, ...(result ? { result } : {}) } },
    ...base(),
  });
}

if (prompt.includes('HANG')) {
  emit({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'fake-hang',
    tool_call: { shellToolCall: { args: { command: 'sleep infinity' } } },
    timestamp_ms: Date.now(),
    ...base(),
  });
  process.on('SIGTERM', () => {
    emit({
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'fake-hang',
      tool_call: {
        shellToolCall: { args: { command: 'sleep infinity' }, result: { failure: { exitCode: 143 } } },
      },
      ...base(),
    });
    emit({ type: 'result', subtype: 'success', is_error: true, duration_ms: 1, result: 'stopped', ...base() });
    process.exit(0);
  });
  setInterval(() => {}, 1 << 30);
} else if (prompt.includes('FAIL')) {
  const answer = 'fake failure';
  emitAssistant([answer.slice(0, 5), answer.slice(5)]);
  emit({ type: 'result', subtype: 'error', is_error: true, duration_ms: 5, result: answer, ...base() });
  process.exit(1);
} else {
  emitRead('started');
  emitRead('completed', { success: { totalLines: 1 } });
  const answer = `fake answer: ${prompt}`;
  const mid = Math.max(1, Math.floor(answer.length / 2));
  emitAssistant([answer.slice(0, mid), answer.slice(mid)]);
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 12,
    result: answer,
    ...base(),
  });
  process.exit(0);
}
