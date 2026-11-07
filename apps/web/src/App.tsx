import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { api, ApiError } from './api';
import { Boot } from './components/Header';
import { Home } from './screens/Home';
import { Login } from './screens/Login';
import { NewTask } from './screens/NewTask';
import { TaskScreen } from './screens/Task';

type AuthState = 'loading' | 'in' | 'out';

const AuthContext = createContext<{ state: AuthState; setState: (state: AuthState) => void } | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('auth missing');
  return value;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  useEffect(() => {
    let cancel = false;
    api
      .tasks()
      .then(() => {
        if (!cancel) setState('in');
      })
      .catch((err) => {
        if (cancel) return;
        setState(err instanceof ApiError && err.status === 401 ? 'out' : 'in');
      });
    return () => {
      cancel = true;
    };
  }, []);
  return <AuthContext.Provider value={{ state, setState }}>{children}</AuthContext.Provider>;
}

function Gate({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state === 'loading') return <Boot />;
  if (state === 'out') return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Gate>
                <Home />
              </Gate>
            }
          />
          <Route
            path="/tasks/new"
            element={
              <Gate>
                <NewTask />
              </Gate>
            }
          />
          <Route
            path="/tasks/:id"
            element={
              <Gate>
                <TaskScreen />
              </Gate>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
