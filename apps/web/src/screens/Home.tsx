import { ProjectLists } from '../library';

export function Home() {
  return (
    <>
      <div className="phone-home">
        <ProjectLists variant="page" />
      </div>
      <main className="screen desk-home">
        <p className="pick">Pick a task</p>
      </main>
    </>
  );
}
