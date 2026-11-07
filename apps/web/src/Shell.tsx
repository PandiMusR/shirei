import { Outlet } from 'react-router';
import { LibraryProvider, ProjectLists } from './library';

export function Shell() {
  return (
    <LibraryProvider>
      <div className="shell">
        <aside className="sidebar">
          <ProjectLists variant="rail" />
        </aside>
        <div className="pane">
          <Outlet />
        </div>
      </div>
    </LibraryProvider>
  );
}
