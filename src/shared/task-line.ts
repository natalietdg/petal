// The task progress line a reply carries once Petal gave the session a task: "**Task:** Fix the login · working".

export type TaskLineState = 'working' | 'blocked' | 'done';
export const TASK_LINE_STATES: readonly TaskLineState[] = ['working', 'blocked', 'done'];

export interface TaskLine {
  title: string;
  state: TaskLineState;
}

// Label as in status-lines.ts, then the title, then "· working|blocked|done", then an optional period.
const LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?task(?:\s*:\s*(?:\*\*|__)|(?:\*\*|__)\s*:|\s*:)\s*(.*?\S)\s*[·•]\s*(working|blocked|done)\s*\.?\s*$/i;
const FENCE = /^\s*(```|~~~)/;

// Null for anything else (no state, an unknown state, an empty title); the line then stays in the body as text.
export function parseTaskLine(line: string): TaskLine | null {
  const match = LINE.exec(line);
  if (!match?.[1] || !match[2]) return null;
  const title = match[1].replace(/\*\*|__|`/g, '').trim();
  if (!title) return null;
  return { title, state: match[2].toLowerCase() as TaskLineState };
}

// One reply's task line, outside code fences; the last one wins (a reply that finishes says so at the end).
export function parseTask(markdown: string): TaskLine | null {
  let fenced = false;
  let found: TaskLine | null = null;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced) continue;
    found = parseTaskLine(line) ?? found;
  }
  return found;
}

export const TASK_STATE_WORDS: Record<TaskLineState, string> = { working: 'Working', blocked: 'Blocked', done: 'Done' };
