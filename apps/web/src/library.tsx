import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { api, explain, type Project, type Task } from './api';
import { useAuth } from './App';
import { Header } from './components/Header';
import { NotifyToggle } from './components/NotifyToggle';
import { Sheet } from './components/Sheet';
import { StatusChip, statusLabel } from './components/StatusChip';
import { LIST_POLL_MS, patchTaskList, taskListNeedsPoll } from './taskList';
import { clipLine, formatAgo } from './time';

type LibraryValue = {
  projects: Project[];
  tasks: Task[];
  ready: boolean;
  error: string;
  reload: () => Promise<void>;
  noteTask: (task: Task) => void;
};

const LibraryContext = createContext<LibraryValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const ticket = useRef(0);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    const [projectBody, taskBody] = await Promise.all([api.projects(), api.tasks()]);
    if (mine !== ticket.current) return;
    setProjects(projectBody.projects);
    setTasks(taskBody.tasks);
  }, []);

  const noteTask = useCallback((next: Task) => {
    if (!tasksRef.current.some((task) => task.id === next.id)) return;
    ticket.current += 1;
    setTasks((current) => patchTaskList(current, next));
  }, []);

  useEffect(() => {
    let cancel = false;
    reload()
      .catch((err) => {
        if (!cancel) setError(explain(err));
      })
      .finally(() => {
        if (!cancel) setReady(true);
      });
    return () => {
      cancel = true;
    };
  }, [location.pathname, reload]);

  useEffect(() => {
    function onFocus() {
      void reload().catch(() => undefined);
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  useEffect(() => {
    if (!taskListNeedsPoll(tasks)) return;
    const id = window.setInterval(() => {
      void reload().catch(() => undefined);
    }, LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [tasks, reload]);

  return (
    <LibraryContext.Provider value={{ projects, tasks, ready, error, reload, noteTask }}>{children}</LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('Library is missing');
  return value;
}

export function ProjectLists({ variant }: { variant: 'page' | 'rail' }) {
  const { projects, tasks, ready, error, reload } = useLibrary();
  const { setState } = useAuth();
  const navigate = useNavigate();
  const match = useMatch('/tasks/:id');
  const activeId = match?.params.id && match.params.id !== 'new' ? match.params.id : '';
  const [sheet, setSheet] = useState(false);
  const [source, setSource] = useState<'folder' | 'git'>('folder');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [actionNote, setActionNote] = useState<{ id: string; text: string } | null>(null);
  const idPrefix = variant === 'rail' ? 'rail-' : '';

  function lastTask(projectId: string): Task | undefined {
    return tasks.find((task) => task.projectId === projectId);
  }

  async function logout() {
    if (!window.confirm('Log out?')) return;
    await api.logout().catch(() => undefined);
    setState('out');
    navigate('/login', { replace: true });
  }

  async function addProject(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (source === 'folder') {
        await api.createProject({ name: name.trim(), source: 'folder', path: path.trim() });
      } else {
        const trimmedBranch = branch.trim();
        await api.createProject({
          source: 'git',
          repo: repo.trim(),
          ...(trimmedBranch ? { branch: trimmedBranch } : {}),
        });
      }
      setSheet(false);
      setName('');
      setPath('');
      setRepo('');
      setBranch('');
      await reload();
    } catch (err) {
      setFormError(explain(err));
    } finally {
      setSaving(false);
    }
  }

  async function pull(project: Project) {
    setBusyId(project.id);
    setActionNote(null);
    try {
      const result = await api.pullProject(project.id);
      setActionNote({ id: project.id, text: result.output || 'Already up to date.' });
      await reload();
    } catch (err) {
      setActionNote({ id: project.id, text: explain(err) });
    } finally {
      setBusyId('');
    }
  }

  async function remove(project: Project) {
    if (!window.confirm(`Remove ${project.name}? The files will be deleted. Task history stays.`)) return;
    setBusyId(project.id);
    setActionNote(null);
    try {
      await api.removeProject(project.id);
      await reload();
    } catch (err) {
      setActionNote({ id: project.id, text: explain(err) });
    } finally {
      setBusyId('');
    }
  }

  const projectsSection = (
    <section>
      <div className="section-head">
        <h2>Projects</h2>
        <button type="button" className="text-btn" onClick={() => setSheet(true)}>
          New project
        </button>
      </div>
      {!ready ? (
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton" />
          <div className="skeleton short" />
        </div>
      ) : null}
      {ready && projects.length === 0 ? <p className="quiet">Add a folder on this machine, or a GitHub repo.</p> : null}
      <ul className="list">
        {projects.map((project) => {
          const last = lastTask(project.id);
          return (
            <li key={project.id} className="row">
              <div>
                <p className="row-title">{project.name}</p>
                <p className="quiet">
                  <span className="badge">{project.source}</span> {project.path}
                </p>
                {project.git ? (
                  <p className="quiet git-meta">
                    {project.git.branch} · {project.git.head} · {project.git.dirty ? 'dirty' : 'clean'}
                  </p>
                ) : null}
                {project.source === 'git' ? (
                  <div className="row-actions">
                    <button type="button" className="text-btn" disabled={busyId === project.id} onClick={() => void pull(project)}>
                      Pull latest
                    </button>
                    <button type="button" className="text-btn" disabled={busyId === project.id} onClick={() => void remove(project)}>
                      Remove project
                    </button>
                  </div>
                ) : null}
                {actionNote?.id === project.id ? <p className="quiet git-meta">{actionNote.text}</p> : null}
                {last ? (
                  <p className="quiet last-line">
                    last: {statusLabel(last.status)} · {formatAgo(last.endedAt ?? last.startedAt ?? last.createdAt)}
                  </p>
                ) : null}
              </div>
              <button type="button" className="primary slim" onClick={() => navigate(`/tasks/new?project=${project.id}`)}>
                New task
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  const recentSection = (
    <section>
      <h2>Recent</h2>
      {tasks.length === 0 ? <p className="quiet">No tasks yet.</p> : null}
      <ul className="list">
        {tasks.map((task) => {
          const active = variant === 'rail' && task.id === activeId;
          return (
            <li key={task.id}>
              <button
                type="button"
                className={active ? 'task-link active' : 'task-link'}
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                <span className="task-top">
                  <StatusChip status={task.status} />
                  <span className="quiet">{formatAgo(task.createdAt)}</span>
                </span>
                <span className="task-prompt">{clipLine(task.prompt)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  const sheetNode = sheet ? (
    <Sheet title="New project" onClose={() => setSheet(false)}>
      <form onSubmit={(event) => void addProject(event)} className="stack">
        <div className="segmented" role="group" aria-label="Source">
          <button type="button" aria-pressed={source === 'folder'} onClick={() => setSource('folder')}>
            Folder
          </button>
          <button type="button" aria-pressed={source === 'git'} onClick={() => setSource('git')}>
            GitHub
          </button>
        </div>
        {source === 'folder' ? (
          <>
            <label htmlFor={`${idPrefix}project-name`}>Name</label>
            <input id={`${idPrefix}project-name`} value={name} onChange={(event) => setName(event.target.value)} required />
            <label htmlFor={`${idPrefix}project-path`}>Folder path</label>
            <input
              id={`${idPrefix}project-path`}
              value={path}
              placeholder="hello"
              onChange={(event) => setPath(event.target.value)}
              required
            />
          </>
        ) : (
          <>
            <label htmlFor={`${idPrefix}project-repo`}>Repository</label>
            <input
              id={`${idPrefix}project-repo`}
              value={repo}
              placeholder="owner/repo"
              onChange={(event) => setRepo(event.target.value)}
              required
            />
            <label htmlFor={`${idPrefix}project-branch`}>Branch (optional)</label>
            <input
              id={`${idPrefix}project-branch`}
              value={branch}
              placeholder="main"
              onChange={(event) => setBranch(event.target.value)}
            />
          </>
        )}
        {formError ? <p className="form-error">{formError}</p> : null}
        <button type="submit" className="primary" disabled={saving}>
          {saving ? (source === 'git' ? 'Cloning…' : 'Adding…') : 'Add project'}
        </button>
      </form>
    </Sheet>
  ) : null;

  if (variant === 'rail') {
    return (
      <div className="rail">
        <header className="rail-head">
          <span className="seal sm" aria-hidden="true">
            令
          </span>
          <strong>Shirei</strong>
          <button type="button" className="text-btn" onClick={() => void logout()}>
            Log out
          </button>
        </header>
        <button type="button" className="primary rail-new" onClick={() => navigate('/tasks/new')}>
          New task
        </button>
        {error ? <p className="form-error">{error}</p> : null}
        {projectsSection}
        {recentSection}
        <NotifyToggle />
        {sheetNode}
      </div>
    );
  }

  return (
    <main className="screen">
      <Header title="Shirei" onLogout={() => void logout()} />
      <div className="scroll">
        {error ? <p className="form-error">{error}</p> : null}
        {projectsSection}
        {recentSection}
        <NotifyToggle />
      </div>
      {sheetNode}
    </main>
  );
}
