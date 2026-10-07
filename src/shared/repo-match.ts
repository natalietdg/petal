// Open Repo's search: fuzzy subsequence ranking over repo names and paths, and the `checkout <name>` / `cd <name>` reply-box shortcut.

export interface MatchableRepo {
  name: string;
  shortPath: string;
  modifiedMs: number;
}

const CONSECUTIVE_BONUS = 5;
const WORD_START_BONUS = 8;
const FIRST_CHAR_BONUS = 10;
const GAP_PENALTY = 1;
// A name hit always outranks a path-only hit.
const NAME_WEIGHT = 1000;

const isWordStart = (text: string, i: number): boolean => i === 0 || /[\s/\\._-]/.test(text[i - 1] ?? '');

// Greedy match of the query starting at `start`; null if the rest of the query doesn't fit after it.
function scoreFrom(q: string, t: string, text: string, start: number): number | null {
  let score = start === 0 ? FIRST_CHAR_BONUS : -start * GAP_PENALTY;
  let last = start;
  if (isWordStart(text, start)) score += WORD_START_BONUS;
  for (const char of q.slice(1)) {
    const at = t.indexOf(char, last + 1);
    if (at < 0) return null;
    if (at === last + 1) score += CONSECUTIVE_BONUS;
    if (isWordStart(text, at)) score += WORD_START_BONUS;
    score -= (at - last - 1) * GAP_PENALTY;
    last = at;
  }
  return score;
}

// Every query character in order, case-insensitive; null when it isn't a subsequence. Higher is better.
// Tries each place the first character occurs, so "term" finds the "-term" in "pastel-term", not the "t" in "past".
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let best: number | null = null;
  for (let start = t.indexOf(q[0] ?? ''); start >= 0; start = t.indexOf(q[0] ?? '', start + 1)) {
    const score = scoreFrom(q, t, text, start);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}

export function repoScore(query: string, repo: MatchableRepo): number | null {
  const name = fuzzyScore(query, repo.name);
  if (name !== null) return NAME_WEIGHT + name;
  return fuzzyScore(query, repo.shortPath);
}

// Best match first; ties (and an empty query) go to the most recently touched repo.
export function rankRepos<T extends MatchableRepo>(query: string, repos: readonly T[]): T[] {
  const trimmed = query.trim();
  return repos
    .map((repo) => ({ repo, score: repoScore(trimmed, repo) }))
    .filter((hit): hit is { repo: T; score: number } => hit.score !== null)
    .sort((a, b) => b.score - a.score || b.repo.modifiedMs - a.repo.modifiedMs || a.repo.name.localeCompare(b.repo.name))
    .map((hit) => hit.repo);
}

export const matchesAnyName = (query: string, repos: readonly MatchableRepo[]): boolean =>
  repos.some((repo) => fuzzyScore(query, repo.name) !== null);

// "checkout petal" / "cd Petal" -> "petal". A path (/x, ~/x, ../x, -flag, $VAR) or several words stay shell text.
export function parseRepoCommand(text: string): string | null {
  const match = /^\s*(?:checkout|cd)\s+(\S+)\s*$/i.exec(text);
  const name = match?.[1];
  if (!name || /^[/~.$-]/.test(name) || name.includes('/')) return null;
  return name;
}
