import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, explain, type Task } from '../api';
import { useAuth } from '../App';
import { Header } from '../components/Header';
import { StatusChip } from '../components/StatusChip';
import { TimelineView } from '../components/TimelineView';
import { syncDebugFlag } from '../debug';
import { readEventStream } from '../sse';
import { clipLine, formatElapsed } from '../time';
import {
  emptyTimeline,
  promptEvent,
  reduceTimeline,
  systemInit,
  type TimelineEvent,
  type TimelineState,
} from '../timeline';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function clock(date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

type Arrival = { seq: number; type: string; offset: number; gap: number; clock: string; phase: 'replay' | 'live' | 'open' };

type PriorTurn = { task: Task; timeline: TimelineState };

function timelineFrom(prompt: string, events: TimelineEvent[]): TimelineState {
  let state = reduceTimeline(emptyTimeline(), promptEvent(prompt));
  for (const event of events) state = reduceTimeline(state, event);
  return state;
}

function fitFollow(el: HTMLTextAreaElement) {
  const style = getComputedStyle(el);
  const line = parseFloat(style.lineHeight) || 22;
  const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  const max = line * 5 + pad + border;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
}

function AgentStatus({ startedAt, ready, model }: { startedAt: number | null; ready: boolean; model: string }) {
  const fallback = useRef(Date.now());
  const origin = startedAt ?? fallback.current;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ready) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ready]);
  return (
    <p className="agent-status" role="status">
      {ready ? `Agent ready · ${model}` : `Starting agent… ${formatElapsed(now - origin)}`}
    </p>
  );
}

function DebugOverlay({ rows }: { rows: Arrival[] }) {
  const events = rows.filter((row) => row.phase !== 'open');
  const first = events[0];
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  const span = first && last ? last.offset - first.offset : 0;
  const maxGap = events.reduce((max, row) => Math.max(max, row.gap), 0);
  const replay = events.filter((row) => row.phase === 'replay').length;
  const live = events.filter((row) => row.phase === 'live').length;
  return (
    <aside className="debug" aria-label="Stream debug">
      <p>
        {events.length} events · {replay} replay · {live} live · span {span}ms · max gap {maxGap}ms
      </p>
      <ol>
        {rows.map((row, index) => (
          <li key={`${row.clock}-${row.seq}-${index}`}>
            {row.clock} +{row.offset}ms Δ{row.gap}ms {row.type}
            {row.phase === 'open' ? '' : ` #${row.seq} ${row.phase}`}
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function TaskScreen() {
  const { id = '' } = useParams();
  const { search } = useLocation();
  const [debug, setDebug] = useState(() => syncDebugFlag(search));
  const navigate = useNavigate();
  const { setState } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [projectName, setProjectName] = useState('');
  const [timeline, setTimeline] = useState<TimelineState>(emptyTimeline());
  const [prior, setPrior] = useState<PriorTurn[]>([]);
  const [agent, setAgent] = useState<{ ready: boolean; model: string | null }>({ ready: false, model: null });
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [missing, setMissing] = useState(false);
  const [follow, setFollow] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const followBox = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    setDebug(syncDebugFlag(search));
  }, [search]);

  useEffect(() => {
    let stopped = false;
    let ended = false;
    let running = false;
    let ctrl: AbortController | null = null;
    const last = { seq: 0 };
    const origin = { t: 0 };
    let previous = 0;

    function note(seq: number, type: string, phase: Arrival['phase']) {
      if (!debug) return;
      const at = performance.now();
      if (origin.t === 0) {
        origin.t = at;
        previous = at;
      }
      const offset = Math.round(at - origin.t);
      const gap = Math.round(at - previous);
      previous = at;
      setArrivals((rows) => [...rows, { seq, type, offset, gap, clock: clock(), phase }]);
    }

    async function refresh() {
      const next = await api.task(id);
      if (stopped) return;
      setTask(next);
      if (next.status === 'running') {
        await sleep(250);
        const again = await api.task(id);
        if (!stopped) setTask(again);
      }
    }

    async function connect() {
      if (stopped || ended || running) return;
      running = true;
      const ac = new AbortController();
      ctrl = ac;
      note(0, 'open', 'open');
      try {
        await readEventStream(`/api/tasks/${id}/stream?after=${last.seq}`, ac.signal, (event, phase) => {
          note(event.seq, event.type, phase);
          if (event.seq > last.seq) last.seq = event.seq;
          const init = systemInit(event);
          if (init) setAgent({ ready: true, model: init.model });
          setTimeline((prev) => reduceTimeline(prev, event));
          if (event.type === 'runner') {
            ended = true;
            void refresh();
          }
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          stopped = true;
          setState('out');
          navigate('/login', { replace: true });
        }
      } finally {
        running = false;
      }
      if (stopped || ended) return;
      if (!ac.signal.aborted) await sleep(600);
      if (!stopped && !ended) void connect();
    }

    function reconnect() {
      if (stopped || ended || document.visibilityState === 'hidden') return;
      if (running) ctrl?.abort();
      else void connect();
    }

    async function boot() {
      setTimeline(emptyTimeline());
      setTask(null);
      setProjectName('');
      setPrior([]);
      setAgent({ ready: false, model: null });
      setArrivals([]);
      setMissing(false);
      setFollow('');
      origin.t = 0;
      previous = 0;
      if (followBox.current) followBox.current.style.height = 'auto';
      try {
        const loaded = await api.task(id);
        if (stopped) return;
        setTask(loaded);
        setTimeline(reduceTimeline(emptyTimeline(), promptEvent(loaded.prompt)));
        void api
          .projects()
          .then((body) => {
            if (stopped) return;
            setProjectName(body.projects.find((project) => project.id === loaded.projectId)?.name ?? '');
          })
          .catch(() => undefined);
        if (loaded.sessionId) {
          void api
            .thread(id)
            .then((body) => {
              if (stopped) return;
              setPrior(body.turns.map((turn) => ({ task: turn.task, timeline: timelineFrom(turn.task.prompt, turn.events) })));
            })
            .catch((err) => {
              if (!stopped) setError(explain(err));
            });
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else if (err instanceof ApiError && err.status === 401) {
          setState('out');
          navigate('/login', { replace: true });
        } else setError(explain(err));
        return;
      }
      void connect();
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') reconnect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    void boot();
    return () => {
      stopped = true;
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [debug, id, navigate, setState]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline, prior]);

  async function stop() {
    setPending(true);
    setError('');
    try {
      await api.stop(id);
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!task) return;
    setPending(true);
    setError('');
    try {
      const next = await api.createTask({
        projectId: task.projectId,
        prompt: follow.trim(),
        mode: task.mode === 'plan' || task.mode === 'ask' || task.mode === 'agent' ? task.mode : 'agent',
        model: task.model,
        force: false,
        resumeTaskId: task.id,
      });
      setFollow('');
      navigate(`/tasks/${next.id}`);
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  const running = task?.status === 'running' || task?.status === 'queued';
  const hasOutput = timeline.items.some((item) => item.kind === 'assistant' || item.kind === 'tool');
  const chosen = task?.model ?? 'auto';
  const title = task ? (projectName ? `${projectName} · ${chosen}` : chosen) : 'Task';

  return (
    <main className="screen">
      <Header title={title} back />
      {task ? (
        <div className="task-meta">
          <StatusChip status={task.status} />
          <span className="quiet">{task.mode}</span>
          <span className="quiet model-id">{task.model ?? 'auto'}</span>
        </div>
      ) : null}
      {running && !hasOutput ? (
        <AgentStatus startedAt={task?.startedAt ?? null} ready={agent.ready} model={agent.model ?? chosen} />
      ) : null}
      <div
        className="scroll thread-scroll"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {debug ? <DebugOverlay rows={arrivals} /> : null}
        {missing ? <p className="quiet">This task is gone.</p> : null}
        {prior.map((turn) => (
          <details key={turn.task.id} className="prior">
            <summary>{clipLine(turn.task.prompt)}</summary>
            <TimelineView timeline={turn.timeline} status={turn.task.status} error={turn.task.error} />
          </details>
        ))}
        <TimelineView timeline={timeline} status={task?.status ?? null} error={task?.error ?? null} />
      </div>
      {running ? (
        <div className="bar">
          {error ? <p className="form-error">{error}</p> : null}
          <button type="button" className="danger" disabled={pending} onClick={() => void stop()}>
            {pending ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      ) : task ? (
        <form className="bar follow" onSubmit={(event) => void send(event)}>
          {error ? <p className="form-error">{error}</p> : null}
          <textarea
            ref={followBox}
            aria-label="Follow up"
            placeholder="Follow up"
            rows={1}
            value={follow}
            onChange={(event) => {
              setFollow(event.target.value);
              fitFollow(event.currentTarget);
            }}
          />
          <button type="submit" className="primary slim" disabled={pending || follow.trim().length === 0}>
            Send
          </button>
        </form>
      ) : null}
    </main>
  );
}
