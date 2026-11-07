import { useEffect, useRef, useState } from 'react';
import { formatDuration, formatElapsed } from '../time';
import { joinedAssistantText, type TimelineItem, type TimelineState } from '../timeline';
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

function ToolCard({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`card tool tool-${item.state}`}>
      <button type="button" className="tool-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className={item.state === 'running' ? 'spinner' : `mark mark-${item.state}`} aria-hidden="true" />
        <span className="tool-label">{item.label}</span>
        {item.state === 'running' ? <Elapsed startedAt={item.startedAt} /> : null}
      </button>
      {open ? <pre className="tool-detail">{item.detail}</pre> : null}
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
