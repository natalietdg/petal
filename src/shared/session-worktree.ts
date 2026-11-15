// The Start palette's "In a new worktree" choice: a safe folder and branch name from what she typed, or one from the time.
const MAX_NAME = 40;

export function worktreeName(typed: string, now = new Date()): string {
  const cleaned = typed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME).replace(/-+$/, '');
  if (cleaned) return cleaned;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `session-${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export const worktreeBranch = (name: string): string => `petal/${name}`;
