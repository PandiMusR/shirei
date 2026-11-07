import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, explain, type Project, type Task } from '../api';
import { useAuth } from '../App';
import { Header } from '../components/Header';
import { Sheet } from '../components/Sheet';
import { StatusChip } from '../components/StatusChip';
import { clipLine, formatAgo } from '../time';

export function Home() {
  const navigate = useNavigate();
  const { setState } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(false);
  const [source, setSource] = useState<'folder' | 'git'>('folder');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [projectBody, taskBody] = await Promise.all([api.projects(), api.tasks()]);
    setProjects(projectBody.projects);
    setTasks(taskBody.tasks);
  }

  useEffect(() => {
    let cancel = false;
    load()
      .catch((err) => {
        if (!cancel) setError(explain(err));
      });
    return () => {
      cancel = true;
    };
  }, []);

  function lastStatus(projectId: string): string | null {
    return tasks.find((task) => task.projectId === projectId)?.status ?? null;
  }

  async function logout() {
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
        await api.createProject({ name: name.trim(), source: 'git', repoUrl: repoUrl.trim() });
      }
      setSheet(false);
      setName('');
      setPath('');
      setRepoUrl('');
      await load();
    } catch (err) {
      setFormError(explain(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="screen">
      <Header title="Shirei" onLogout={() => void logout()} />
      <div className="scroll">
        {error ? <p className="form-error">{error}</p> : null}
        <section>
          <div className="section-head">
            <h2>Projects</h2>
            <button type="button" className="text-btn" onClick={() => setSheet(true)}>
              New project
            </button>
          </div>
          {projects.length === 0 ? <p className="quiet">Add a folder on this machine, or a GitHub repo.</p> : null}
          <ul className="list">
            {projects.map((project) => {
              const status = lastStatus(project.id);
              return (
                <li key={project.id} className="row">
                  <div>
                    <p className="row-title">{project.name}</p>
                    <p className="quiet">
                      <span className="badge">{project.source}</span> {project.path}
                    </p>
                  </div>
                  <div className="row-side">
                    {status ? <StatusChip status={status} /> : null}
                    <button type="button" className="primary slim" onClick={() => navigate(`/tasks/new?project=${project.id}`)}>
                      New task
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <h2>Recent</h2>
          {tasks.length === 0 ? <p className="quiet">No tasks yet.</p> : null}
          <ul className="list">
            {tasks.map((task) => (
              <li key={task.id}>
                <button type="button" className="task-link" onClick={() => navigate(`/tasks/${task.id}`)}>
                  <span className="task-top">
                    <StatusChip status={task.status} />
                    <span className="quiet">{formatAgo(task.createdAt)}</span>
                  </span>
                  <span className="task-prompt">{clipLine(task.prompt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {sheet ? (
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
            <label htmlFor="project-name">Name</label>
            <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} required />
            {source === 'folder' ? (
              <>
                <label htmlFor="project-path">Folder path</label>
                <input
                  id="project-path"
                  value={path}
                  placeholder="hello"
                  onChange={(event) => setPath(event.target.value)}
                  required
                />
              </>
            ) : (
              <>
                <label htmlFor="project-url">GitHub URL</label>
                <input
                  id="project-url"
                  value={repoUrl}
                  placeholder="https://github.com/owner/repo"
                  onChange={(event) => setRepoUrl(event.target.value)}
                  required
                />
              </>
            )}
            {formError ? <p className="form-error">{formError}</p> : null}
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Adding…' : 'Add project'}
            </button>
          </form>
        </Sheet>
      ) : null}
    </main>
  );
}
