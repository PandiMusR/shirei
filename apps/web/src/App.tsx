import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { api, ApiError } from './api';
import { syncDebugFlag } from './debug';
import { Boot } from './components/Header';
import { UpdateBanner } from './components/UpdateBanner';
import { Home } from './screens/Home';
import { Shell } from './Shell';
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

function DebugSync() {
  const { search } = useLocation();
  useEffect(() => {
    syncDebugFlag(search);
  }, [search]);
  return null;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <DebugSync />
        <UpdateBanner />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Gate>
                <Shell />
              </Gate>
            }
          >
            <Route path="/" element={<Home />} />
            <Route path="/tasks/new" element={<NewTask />} />
            <Route path="/tasks/:id" element={<TaskScreen />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
