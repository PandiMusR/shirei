import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError, explain, type Task } from '../api';
import { useAuth } from '../App';
import { Header } from '../components/Header';
import { StatusChip } from '../components/StatusChip';
import { TimelineView } from '../components/TimelineView';
import { readEventStream } from '../sse';
import { emptyTimeline, promptEvent, reduceTimeline, type TimelineState } from '../timeline';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function TaskScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { setState } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>(emptyTimeline());
  const [missing, setMissing] = useState(false);
  const [follow, setFollow] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let stopped = false;
    let ended = false;
    let running = false;
    let ctrl: AbortController | null = null;
    const last = { seq: 0 };

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
      try {
        await readEventStream(`/api/tasks/${id}/stream?after=${last.seq}`, ac.signal, (event) => {
          if (event.seq > last.seq) last.seq = event.seq;
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
      setMissing(false);
      try {
        const loaded = await api.task(id);
        if (stopped) return;
        setTask(loaded);
        setTimeline(reduceTimeline(emptyTimeline(), promptEvent(loaded.prompt)));
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
  }, [id, navigate, setState]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline]);

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
      navigate(`/tasks/${next.id}`);
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  const running = task?.status === 'running' || task?.status === 'queued';

  return (
    <main className="screen">
      <Header title={task ? task.prompt.replace(/\s+/g, ' ').trim() : 'Task'} back />
      {task ? (
        <div className="task-meta">
          <StatusChip status={task.status} />
          <span className="quiet">{task.mode}</span>
        </div>
      ) : null}
      <div
        className="scroll thread-scroll"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {missing ? <p className="quiet">This task is gone.</p> : null}
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
            aria-label="Follow up"
            placeholder="Follow up"
            rows={1}
            value={follow}
            onChange={(event) => {
              setFollow(event.target.value);
              const el = event.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
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
