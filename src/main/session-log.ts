// What the Board's coordination needs from one session's log: files its edit tools touched (per turn) and its Task lines.
// Fed entries in order; it keeps only the recent window, so a long session stays small in memory.
import { contentItems, isUserTurn } from './prompts';
import { CLASH_WINDOW_MS, EDIT_TOOLS, type FileEdit } from '../shared/file-clash';
import { parseTask, type TaskLine } from '../shared/task-line';
import type { TranscriptEntry } from './transcript-entry';

export interface TurnEdit extends FileEdit {
  turnId: string; // her prompt's uuid, or 'start' for edits before the first prompt read
  replyId: string | null; // the turn's first text, where the reader's reply begins
}

export interface SeenTaskLine {
  line: TaskLine;
  at: number;
  replyId: string | null;
}

const KEEP_MS = 2 * CLASH_WINDOW_MS;

export class SessionLog {
  private turnId = 'start';
  private replyId: string | null = null;
  private recent: TurnEdit[] = [];
  private taskLines: SeenTaskLine[] = [];
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  add(entry: TranscriptEntry): void {
    if (isUserTurn(entry)) {
      this.turnId = entry.uuid ?? `turn-${entry.timestamp ?? this.recent.length}`;
      this.replyId = null;
      return;
    }
    if (entry.type !== 'assistant' || entry.isSidechain) return;
    const parsed = Date.parse(entry.timestamp ?? '');
    const at = Number.isNaN(parsed) ? this.now() : parsed;
    for (const item of contentItems(entry)) {
      if (item.type === 'tool_use' && EDIT_TOOLS.includes(item.name ?? '')) {
        const file = item.input?.file_path ?? item.input?.notebook_path;
        if (typeof file === 'string' && file) this.recent.push({ file, at, turnId: this.turnId, replyId: this.replyId });
      } else if (item.type === 'text' && item.text?.trim()) {
        this.replyId ??= entry.uuid ?? null;
        const line = parseTask(item.text);
        if (line) this.taskLines.push({ line, at, replyId: this.replyId });
      }
    }
  }

  // A rewritten log starts over.
  reset(): void {
    this.turnId = 'start';
    this.replyId = null;
    this.recent = [];
    this.taskLines = [];
  }

  // Edits newer than the window, oldest first; older ones are dropped for good.
  edits(): TurnEdit[] {
    const cutoff = this.now() - KEEP_MS;
    this.recent = this.recent.filter((e) => e.at >= cutoff);
    return [...this.recent];
  }

  // Task lines seen since the last call, oldest first.
  takeTaskLines(): SeenTaskLine[] {
    return this.taskLines.splice(0);
  }
}

export interface TurnFiles {
  turnId: string;
  replyId: string | null;
  files: string[]; // in first-edit order
  at: number; // the turn's newest edit
}

// Edits grouped per turn, for the activity feed.
export function editsByTurn(edits: readonly TurnEdit[]): TurnFiles[] {
  const turns = new Map<string, TurnFiles>();
  for (const edit of edits) {
    const turn = turns.get(edit.turnId) ?? { turnId: edit.turnId, replyId: edit.replyId, files: [], at: edit.at };
    if (!turn.files.includes(edit.file)) turn.files.push(edit.file);
    turn.at = Math.max(turn.at, edit.at);
    turn.replyId ??= edit.replyId;
    turns.set(edit.turnId, turn);
  }
  return [...turns.values()];
}
