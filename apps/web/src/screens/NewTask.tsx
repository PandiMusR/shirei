import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, explain, type Project } from '../api';
import { Header } from '../components/Header';
import {
  choiceForFamily,
  effortsFor,
  EFFORT_LABEL,
  findFamily,
  hasBothThinking,
  matchChoice,
  nearestEffort,
  optionFor,
  resolveChoice,
  type Effort,
  type ModelChoice,
  type ModelGroup,
} from '../models';

const modes = ['agent', 'ask', 'plan'] as const;

export function NewTask() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preset = params.get('project');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<(typeof modes)[number]>('agent');
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [choice, setChoice] = useState<ModelChoice>({ familyId: 'auto', effort: 'bare', thinking: false, fast: false });
  const [force, setForce] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [projectsReady, setProjectsReady] = useState(false);

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
      })
      .finally(() => {
        if (!cancel) setProjectsReady(true);
      });
    return () => {
      cancel = true;
    };
  }, [preset]);

  useEffect(() => {
    let cancel = false;
    api
      .models()
      .then((body) => {
        if (cancel) return;
        setGroups(body.groups);
        const saved = window.localStorage.getItem('shirei.model');
        const restored = saved ? matchChoice(body.groups, saved) : null;
        const first = body.groups[0]?.families[0];
        if (restored) setChoice(restored);
        else if (first) setChoice(choiceForFamily(first));
      })
      .catch((err) => {
        if (!cancel) setError(explain(err));
      });
    return () => {
      cancel = true;
    };
  }, []);

  const family = findFamily(groups, choice.familyId);
  const thinkingChoices = family ? hasBothThinking(family) : false;
  const effortChoices = family ? effortsFor(family, choice.thinking) : [];
  const option = family ? optionFor(family, choice.effort, choice.thinking) : undefined;
  const showEffort = effortChoices.some((effort) => effort !== 'bare') || effortChoices.length > 1;
  const composed = option ? resolveChoice(groups, choice)?.id ?? option.id : 'auto';

  useEffect(() => {
    if (groups.length === 0) return;
    window.localStorage.setItem('shirei.model', composed);
  }, [composed, groups.length]);

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
        model: composed,
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
      <Header title="New task" back />
      <form className="scroll stack" onSubmit={(event) => void submit(event)}>
        {!projectsReady ? (
          <div className="skeleton-stack" aria-hidden="true">
            <div className="skeleton" />
          </div>
        ) : null}
        {projectsReady && projects.length === 0 ? <p className="quiet">Add a project on the home screen first.</p> : null}
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
        <select
          id="task-model"
          value={choice.familyId}
          onChange={(event) => {
            const next = findFamily(groups, event.target.value);
            if (next) setChoice(choiceForFamily(next));
          }}
        >
          {groups.map((group) => (
            <optgroup key={group.name} label={group.name}>
              {group.families.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {showEffort ? (
          <>
            <label htmlFor="task-effort">Effort</label>
            <select
              id="task-effort"
              value={choice.effort}
              onChange={(event) => {
                const effort = event.target.value as Effort;
                const next = family ? optionFor(family, effort, choice.thinking) : undefined;
                setChoice({ ...choice, effort, fast: choice.fast && Boolean(next?.fastId) });
              }}
            >
              {effortChoices.map((effort) => (
                <option key={effort} value={effort}>
                  {EFFORT_LABEL[effort]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {thinkingChoices && family ? (
          <label className="check">
            <input
              type="checkbox"
              checked={choice.thinking}
              onChange={(event) => {
                const thinking = event.target.checked;
                const effort = nearestEffort(choice.effort, effortsFor(family, thinking));
                const next = optionFor(family, effort, thinking);
                setChoice({ ...choice, thinking, effort, fast: choice.fast && Boolean(next?.fastId) });
              }}
            />
            <span>Thinking</span>
          </label>
        ) : null}
        {option?.fastId ? (
          <label className="check">
            <input type="checkbox" checked={choice.fast} onChange={(event) => setChoice({ ...choice, fast: event.target.checked })} />
            <span>Fast</span>
          </label>
        ) : null}
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
        <p className="quiet choice-id">{composed}</p>
        <button type="submit" className="primary" disabled={pending || !projectId || prompt.trim().length === 0}>
          {pending ? 'Starting…' : 'Start'}
        </button>
      </form>
    </main>
  );
}
