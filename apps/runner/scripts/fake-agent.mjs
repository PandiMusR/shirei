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

if (prompt.includes('HANG')) {
  process.on('SIGTERM', () => {
    emit({ type: 'result', subtype: 'success', is_error: true, duration_ms: 1, result: 'stopped', ...base() });
    process.exit(0);
  });
  setInterval(() => {}, 1 << 30);
} else if (prompt.includes('FAIL')) {
  emit({ type: 'result', subtype: 'error', is_error: true, duration_ms: 5, result: 'fake failure', ...base() });
  process.exit(1);
} else {
  emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'fake ' }] }, timestamp_ms: Date.now(), ...base() });
  emit({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'fake-1',
    tool_call: { readToolCall: { args: { path: 'README.md' } } },
    ...base(),
  });
  emit({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'fake-1',
    tool_call: { readToolCall: { args: { path: 'README.md' }, result: { success: { totalLines: 1 } } } },
    ...base(),
  });
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 12,
    result: `fake answer: ${prompt}`,
    ...base(),
  });
  process.exit(0);
}
