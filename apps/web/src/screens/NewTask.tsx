import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, explain, type Project } from '../api';
import { useAuth } from '../App';
import { Header } from '../components/Header';

const modes = ['agent', 'ask', 'plan'] as const;

export function NewTask() {
  const navigate = useNavigate();
  const { setState } = useAuth();
  const [params] = useSearchParams();
  const preset = params.get('project');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<(typeof modes)[number]>('agent');
  const [model, setModel] = useState('');
  const [force, setForce] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancel = false;
    api
      .projects()
      .then((body) => {
        if (cancel) return;
        setProjects(body.projects);
        const match = preset && body.projects.some((project) => project.id === preset) ? preset : body.projects[0]?.id ?? '';
        setProjectId(match);
      })
      .catch((err) => {
        if (!cancel) setError(explain(err));
      });
    return () => {
      cancel = true;
    };
  }, [preset]);

  async function logout() {
    await api.logout().catch(() => undefined);
    setState('out');
    navigate('/login', { replace: true });
  }

  function grow(event: FormEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const task = await api.createTask({
        projectId,
        prompt: prompt.trim(),
        mode,
        model: model.trim() ? model.trim() : null,
        force: mode === 'agent' && force,
      });
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="screen">
      <Header title="New task" back onLogout={() => void logout()} />
      <form className="scroll stack" onSubmit={(event) => void submit(event)}>
        {projects.length === 0 ? <p className="quiet">Add a project on the home screen first.</p> : null}
        <label htmlFor="task-project">Project</label>
        <select id="task-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <label htmlFor="task-prompt">Prompt</label>
        <textarea
          id="task-prompt"
          value={prompt}
          rows={4}
          onInput={grow}
          onChange={(event) => setPrompt(event.target.value)}
          required
        />
        <div className="segmented" role="group" aria-label="Mode">
          {modes.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => {
                setMode(item);
                if (item !== 'agent') setForce(false);
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <label htmlFor="task-model">Model</label>
        <input id="task-model" value={model} placeholder="Auto" onChange={(event) => setModel(event.target.value)} />
        {mode === 'agent' ? (
          <label className="check">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            <span>
              Force
              <small>The agent can run commands inside this sandbox.</small>
            </span>
          </label>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="primary" disabled={pending || !projectId || prompt.trim().length === 0}>
          {pending ? 'Starting…' : 'Start'}
        </button>
      </form>
    </main>
  );
}
