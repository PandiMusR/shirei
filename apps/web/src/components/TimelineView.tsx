import { useEffect, useRef, useState } from 'react';
import { formatDuration, formatElapsed } from '../time';
import { filesChanged, joinedAssistantText, shellHasOutput, type TimelineItem, type TimelineState, type ToolView } from '../timeline';
import { Markdown } from './Markdown';

function Elapsed({ startedAt }: { startedAt: number | null }) {
  const fallback = useRef(Date.now());
  const origin = startedAt ?? fallback.current;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tool-elapsed">{formatElapsed(now - origin)}</span>;
}

function diffKind(line: string): 'add' | 'del' | 'hunk' | 'meta' | 'ctx' {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="diff">
      {diff.split('\n').map((line, index) => (
        <div key={`${index}-${line.slice(0, 12)}`} className={`diff-${diffKind(line)}`}>
          {line.length > 0 ? line : ' '}
        </div>
      ))}
    </pre>
  );
}

function ShellBadge({ view, running }: { view: Extract<ToolView, { kind: 'shell' }>; running: boolean }) {
  if (running) return null;
  if (view.rejected) return <span className="badge badge-bad">rejected</span>;
  if (view.exitCode == null) return null;
  const ok = view.exitCode === 0;
  return <span className={ok ? 'badge badge-ok' : 'badge badge-bad'}>{view.exitCode}</span>;
}

function ShellBody({ view }: { view: Extract<ToolView, { kind: 'shell' }> }) {
  if (!shellHasOutput(view.stdout, view.stderr)) return null;
  return (
    <details className="tool-fold">
      <summary>Output</summary>
      {view.stdout ? (
        <pre className="tool-detail">
          {view.stdoutHidden > 0 ? `… ${view.stdoutHidden} earlier lines\n` : ''}
          {view.stdout}
        </pre>
      ) : null}
      {view.stderr ? (
        <pre className="tool-detail tool-stderr">
          {view.stderrHidden > 0 ? `… ${view.stderrHidden} earlier lines\n` : ''}
          {view.stderr}
        </pre>
      ) : null}
    </details>
  );
}

function GlobBody({ view }: { view: Extract<ToolView, { kind: 'glob' }> }) {
  if (view.total == null && view.files.length === 0) return null;
  const count = view.total ?? view.files.length;
  if (view.files.length === 0) return <p className="tool-note">{count} files</p>;
  return (
    <details className="tool-fold">
      <summary>
        {count} {count === 1 ? 'file' : 'files'}
      </summary>
      <ul className="tool-files">
        {view.files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </details>
  );
}

function ReadNote({ view }: { view: Extract<ToolView, { kind: 'read' }> }) {
  if (view.startLine == null || view.endLine == null) return null;
  return (
    <p className="tool-note">
      lines {view.startLine}–{view.endLine}
    </p>
  );
}

function ToolCard({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const [raw, setRaw] = useState(false);
  const view = item.view;
  return (
    <li className={`card tool tool-${item.state}`}>
      <div className="tool-head">
        <span className={item.state === 'running' ? 'spinner' : `mark mark-${item.state}`} aria-hidden="true" />
        <span className="tool-label">{item.label}</span>
        {view.kind === 'shell' ? <ShellBadge view={view} running={item.state === 'running'} /> : null}
        {item.state === 'running' ? <Elapsed startedAt={item.startedAt} /> : null}
      </div>
      {view.kind === 'edit' && view.diff ? <DiffBlock diff={view.diff} /> : null}
      {view.kind === 'shell' && view.command && view.command !== item.label ? <pre className="tool-command">{view.command}</pre> : null}
      {view.kind === 'shell' ? <ShellBody view={view} /> : null}
      {view.kind === 'read' ? <ReadNote view={view} /> : null}
      {view.kind === 'glob' ? <GlobBody view={view} /> : null}
      <button type="button" className="text-btn raw-toggle" aria-pressed={raw} onClick={() => setRaw((value) => !value)}>
        {raw ? 'Hide raw' : 'Raw'}
      </button>
      {raw ? <pre className="tool-detail">{item.detail}</pre> : null}
    </li>
  );
}

function resultLabel(status: string | null, isError: boolean): string {
  if (status === 'stopped') return 'Stopped';
  if (status === 'interrupted') return 'Interrupted';
  if (status === 'failed' || isError) return 'Failed';
  return 'Done';
}

export function TimelineView({
  timeline,
  status,
  error,
}: {
  timeline: TimelineState;
  status: string | null;
  error: string | null;
}) {
  const assistant = joinedAssistantText(timeline);
  const changed = filesChanged(timeline);
  return (
    <ol className="thread">
      {timeline.items.map((item) => {
        if (item.kind === 'user') {
          return (
            <li key={`user-${item.seq}`} className="bubble user">
              {item.text}
            </li>
          );
        }
        if (item.kind === 'assistant') {
          return (
            <li key={`assistant-${item.seq}`} className="bubble assistant">
              <Markdown text={item.text} />
            </li>
          );
        }
        if (item.kind === 'thinking') {
          return (
            <li key={`thinking-${item.seq}`} className="card thinking">
              <details>
                <summary>{item.done ? 'Thought' : 'Thinking'}</summary>
                <p>{item.text}</p>
              </details>
            </li>
          );
        }
        if (item.kind === 'tool') return <ToolCard key={`tool-${item.callId}`} item={item} />;
        if (item.kind === 'result') {
          const showText = item.text.length > 0 && item.text !== assistant;
          return (
            <li key={`result-${item.seq}`} className="result">
              <span className={item.isError || status === 'failed' ? 'result-bad' : 'result-ok'}>
                {resultLabel(status, item.isError)}
              </span>
              {item.durationMs != null ? <span>{formatDuration(item.durationMs)}</span> : null}
              {error ? <span className="result-note">{error}</span> : null}
              {showText ? <p className="result-text">{item.text}</p> : null}
              {changed.length > 0 ? (
                <div className="files-changed">
                  <p>Files changed</p>
                  <ul>
                    {changed.map((file) => (
                      <li key={file.path}>
                        {file.file} +{file.added} −{file.removed}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        }
        return (
          <li key={`raw-${item.seq}`} className="raw">
            <span>{item.type}</span> {item.text}
          </li>
        );
      })}
    </ol>
  );
}
