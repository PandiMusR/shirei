import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

export function Header({
  title,
  back,
  onLogout,
}: {
  title: string;
  back?: boolean;
  onLogout?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <header className={onLogout ? 'top' : 'top no-logout'}>
      {back ? (
        <button
          type="button"
          className="icon-btn"
          aria-label="Back"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate('/');
          }}
        >
          ←
        </button>
      ) : (
        <span className="seal sm" aria-hidden="true">
          指
        </span>
      )}
      <h1>{title}</h1>
      {onLogout ? (
        <button type="button" className="text-btn" onClick={onLogout}>
          Log out
        </button>
      ) : null}
    </header>
  );
}

export function Boot({ children }: { children?: ReactNode }) {
  return (
    <div className="boot">
      <span className="seal" aria-hidden="true">
        指
      </span>
      <p>{children ?? 'Shirei'}</p>
    </div>
  );
}
