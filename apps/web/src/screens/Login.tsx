import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api, ApiError, explain } from '../api';
import { useAuth } from '../App';

export function Login() {
  const { state, setState } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  if (state === 'in') return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await api.login(password);
      setState('in');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Too many tries.' : explain(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login">
      <span className="seal" aria-hidden="true">
        指
      </span>
      <p className="word">Shirei</p>
      <p className="quiet">指令</p>
      <form onSubmit={submit}>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="primary" disabled={pending || password.length === 0}>
          {pending ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </main>
  );
}
