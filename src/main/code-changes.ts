// Reads a session's code changes from its transcript, turn by turn: Edit, MultiEdit, Write and NotebookEdit calls that
// succeeded, split into function cards, with the text and thinking Claude wrote around them as the recorded reasoning.
// Turns break where the reader's replies break (main/replies.ts), so each reply knows its own changes.
import path from 'node:path';
import { commandText, contentItems, isAgentMessage, isUserTurn, queuedPromptText, rawPromptText } from './prompts';
import { assistantText } from './replies';
import { hunkCard, splitChange, type SplitCard } from './code-functions';
import { isSecretPath, type FunctionCard, type ReasoningExcerpt } from '../shared/code-review';
import type { ContentItem, TranscriptEntry } from './transcript-entry';

const CHANGE_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
const MAX_EXCERPT_CHARS = 1500;

export interface CodeTurn {
  turnId: string; // the uuid of the entry that opened it
  replyId: string | null; // its first text, where the reader's reply begins
  historyIndex: number; // History's turn index (main/handoff.ts readTurns); -1 before her first prompt
  at: string | null;
  cwd: string | null;
  reasoning: ReasoningExcerpt[];
  cards: FunctionCard[];
  skipped: string[];
}

// The file as it is now, when the transcript lacks the original; null when unreadable.
export type ReadCurrent = (file: string) => string | null;

interface Pending {
  turn: CodeTurn;
  tool: string;
  input: Record<string, unknown>;
  reasoning: number;
}

const field = (record: unknown, name: string): unknown => (typeof record === 'object' && record !== null ? (record as Record<string, unknown>)[name] : undefined);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

// old -> new on base; null when old isn't there (the file moved on, or the edit never applied).
function applyEdit(base: string, oldText: string, newText: string, all: boolean): string | null {
  if (!oldText) return base === '' ? newText : null;
  if (!base.includes(oldText)) return null;
  return all ? base.split(oldText).join(newText) : base.replace(oldText, () => newText);
}

type Edit = { oldText: string; newText: string; all: boolean };

const editsOf = (tool: string, input: Record<string, unknown>): Edit[] => {
  const one = (e: unknown): Edit => ({ oldText: text(field(e, 'old_string')) ?? '', newText: text(field(e, 'new_string')) ?? '', all: field(e, 'replace_all') === true });
  if (tool === 'Edit') return [one(input)];
  if (tool === 'MultiEdit') return Array.isArray(input.edits) ? input.edits.map(one) : [];
  return [];
};

export class CodeChangeCollector {
  readonly turns: CodeTurn[] = [];
  private turn: CodeTurn | null = null;
  private readonly pending = new Map<string, Pending>();
  private historyIndex = -1;
  private afterAgent = false;
  private cwd: string | null = null;
  private opener: TranscriptEntry | null = null; // the entry that ended the last turn; the next turn is keyed by it
  private readonly readCurrent: ReadCurrent;

  constructor(readCurrent: ReadCurrent = () => null) {
    this.readCurrent = readCurrent;
  }

  add(entry: TranscriptEntry): void {
    if (typeof entry.cwd === 'string') this.cwd = entry.cwd;
    this.countHistoryTurn(entry);
    if (isUserTurn(entry) || queuedPromptText(entry) || isAgentMessage(entry)) {
      this.turn = null; // the next text or edit opens a new turn, as in the reader
      this.opener = entry;
      return;
    }
    if (entry.type === 'assistant' && !entry.isSidechain) this.readAssistant(entry);
    else if (entry.type === 'user' && !entry.isSidechain) this.readResults(entry);
  }

  // Turns that changed code, oldest first.
  changed(): CodeTurn[] {
    return this.turns.filter((t) => t.cards.length || t.skipped.length);
  }

  // Mirrors readTurns: a prompt (or slash command) starts one; Claude's answer to another agent starts one with its first text.
  private countHistoryTurn(entry: TranscriptEntry): void {
    if (rawPromptText(entry) || commandText(entry)) {
      this.historyIndex += 1;
      this.afterAgent = false;
      return;
    }
    if (isAgentMessage(entry)) this.afterAgent = true;
    if (!assistantText(entry)) return;
    if (this.afterAgent) this.historyIndex += 1; // a prompt-less turn
    this.afterAgent = false;
  }

  private current(entry: TranscriptEntry): CodeTurn {
    if (this.turn) return this.turn;
    const opener = this.opener ?? entry;
    this.turn = {
      turnId: opener.uuid ?? `turn-${this.turns.length}`, replyId: null, historyIndex: this.historyIndex,
      at: entry.timestamp ?? null, cwd: this.cwd, reasoning: [], cards: [], skipped: [],
    };
    this.turns.push(this.turn);
    this.opener = null;
    return this.turn;
  }

  private readAssistant(entry: TranscriptEntry): void {
    for (const item of contentItems(entry)) {
      const said = item.type === 'text' ? item.text?.trim() : item.type === 'thinking' ? text(field(item, 'thinking'))?.trim() : '';
      if (said) {
        const turn = this.current(entry);
        if (item.type === 'text') turn.replyId ??= entry.uuid ?? null;
        turn.reasoning.push({ id: turn.reasoning.length + 1, kind: item.type === 'text' ? 'text' : 'thinking', text: said.slice(0, MAX_EXCERPT_CHARS) });
      } else if (item.type === 'tool_use' && item.id && CHANGE_TOOLS.includes(item.name ?? '')) {
        const turn = this.current(entry);
        turn.at = entry.timestamp ?? turn.at;
        this.pending.set(item.id, { turn, tool: item.name ?? '', input: (item.input ?? {}) as Record<string, unknown>, reasoning: turn.reasoning.length });
      }
    }
  }

  // A change counts once its result says it applied; the result carries the file as it was before.
  private readResults(entry: TranscriptEntry): void {
    for (const item of contentItems(entry)) {
      if (item.type !== 'tool_result' || !item.tool_use_id) continue;
      const call = this.pending.get(item.tool_use_id);
      if (!call) continue;
      this.pending.delete(item.tool_use_id);
      if (!isError(item)) this.record(call, entry.toolUseResult);
    }
  }

  private record({ turn, tool, input, reasoning }: Pending, result: unknown): void {
    const file = text(input.file_path) ?? text(input.notebook_path) ?? text(field(result, 'filePath'));
    if (!file) return;
    if (isSecretPath(file)) {
      if (!turn.skipped.includes(file)) turn.skipped.push(file);
      return;
    }
    const display = turn.cwd && file.startsWith(`${turn.cwd}${path.sep}`) ? path.relative(turn.cwd, file) : file;
    for (const card of this.cardsFor(tool, file, input, result)) this.merge(turn, { ...card, file, display, reasoning });
  }

  private cardsFor(tool: string, file: string, input: Record<string, unknown>, result: unknown): SplitCard[] {
    if (tool === 'NotebookEdit') {
      return [hunkCard('', text(input.new_source) ?? '', `Notebook cell ${text(input.cell_id) ?? ''} (${text(input.edit_mode) ?? 'replace'}): shown as a hunk.`.replace(' ()', ''))];
    }
    const pair = this.beforeAfter(tool, file, input, result);
    if (pair) return splitChange(file, pair.before, pair.after);
    const edits = editsOf(tool, input);
    if (tool === 'Write') return [hunkCard('', text(input.content) ?? '', 'No earlier version recorded: showing the file as written.')];
    return edits.map((e) => hunkCard(e.oldText, e.newText, 'Not split into functions: the full file wasn’t available.'));
  }

  // The whole file before and after: from the transcript's original, else rebuilt from the file on disk.
  private beforeAfter(tool: string, file: string, input: Record<string, unknown>, result: unknown): { before: string; after: string } | null {
    const original = text(field(result, 'originalFile'));
    if (tool === 'Write') {
      const content = text(input.content) ?? text(field(result, 'content'));
      if (content === null) return null;
      if (original !== null) return { before: original, after: content };
      return field(result, 'type') === 'create' ? { before: '', after: content } : null;
    }
    const edits = editsOf(tool, input);
    if (original !== null) {
      const after = edits.reduce<string | null>((base, e) => (base === null ? null : applyEdit(base, e.oldText, e.newText, e.all)), original);
      if (after !== null) return { before: original, after };
    }
    const now = this.readCurrent(file);
    if (now === null || edits.length !== 1) return null;
    const [edit] = edits;
    if (!edit.newText || !now.includes(edit.newText)) return null;
    return { before: now.replace(edit.newText, () => edit.oldText), after: now };
  }

  // A function changed twice in one turn is one card: the first before, the last after.
  private merge(turn: CodeTurn, card: Omit<FunctionCard, 'key'>): void {
    const base = `${card.file}::${card.name}`;
    const same = card.kind === 'hunk' ? undefined : turn.cards.find((c) => c.key === base);
    if (!same) {
      const taken = turn.cards.filter((c) => c.key === base || c.key.startsWith(`${base}@`)).length;
      turn.cards.push({ ...card, key: taken ? `${base}@${taken + 1}` : base });
      return;
    }
    same.after = card.after;
    same.reasoning = card.reasoning;
    if (same.before === same.after) turn.cards.splice(turn.cards.indexOf(same), 1); // put back as it was
  }
}

const isError = (item: ContentItem): boolean => item.is_error === true;
