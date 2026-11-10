const SLUG = /^[A-Za-z0-9_.-]+$/;
const PAIR = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+$/;
const DIR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,139}$/;

export type GitHubRepo = { owner: string; repo: string; remote: string; dirName: string };

export function parseGitHubRepo(input: string): GitHubRepo | null {
  const trimmed = input.trim();
  let slug = trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    if (parts.length !== 2) return null;
    const owner = parts[0] ?? '';
    let repo = parts[1] ?? '';
    if (repo.endsWith('.git')) repo = repo.slice(0, -4);
    slug = `${owner}/${repo}`;
  }
  if (!PAIR.test(slug)) return null;
  const [owner, repo] = slug.split('/') as [string, string];
  if (!SLUG.test(owner) || !SLUG.test(repo)) return null;
  const dirName = `${owner}-${repo}`;
  if (!DIR_NAME.test(dirName)) return null;
  return { owner, repo, remote: `https://github.com/${owner}/${repo}.git`, dirName };
}

export function validBranch(branch: string): boolean {
  return branch.length > 0 && branch.length <= 200 && BRANCH.test(branch);
}
