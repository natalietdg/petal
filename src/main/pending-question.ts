// Tracks the AskUserQuestion Claude is waiting on: a tool_use whose tool_result hasn't arrived yet.
import { contentItems, isUserTurn } from './prompts';
import type { TranscriptEntry } from './transcript-entry';
import type { AskQuestion, PendingQuestion, QuestionOption } from '../shared/prompt-answer';

const TOOL_NAME = 'AskUserQuestion';
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 9; // the picker is driven by single digits

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function toOption(raw: unknown): QuestionOption | null {
  if (!isRecord(raw) || !text(raw.label).trim()) return null;
  return { label: text(raw.label), description: text(raw.description) };
}

function toQuestion(raw: unknown): AskQuestion | null {
  if (!isRecord(raw) || !text(raw.question).trim() || !Array.isArray(raw.options)) return null;
  const options = raw.options.map(toOption);
  if (options.length < 2 || options.length > MAX_OPTIONS || options.some((o) => !o)) return null;
  return { question: text(raw.question), header: text(raw.header), options: options as QuestionOption[], multiSelect: raw.multiSelect === true };
}

// The input as Petal can answer it, or null when anything is off (then no card, and no keys can be sent).
export function toQuestions(input: unknown): AskQuestion[] | null {
  const raw = isRecord(input) ? input.questions : null;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_QUESTIONS) return null;
  const questions = raw.map(toQuestion);
  return questions.every(Boolean) ? (questions as AskQuestion[]) : null;
}

export class PendingQuestionTracker {
  private pending: PendingQuestion | null = null;

  // Returns true when the pending question changed.
  add(entry: TranscriptEntry): boolean {
    if (entry.isSidechain) return false;
    const before = this.pending;
    // A new prompt means the picker is gone, even if no tool_result was written.
    if (isUserTurn(entry)) this.pending = null;
    for (const item of contentItems(entry)) {
      if (item.type === 'tool_result' && item.tool_use_id === this.pending?.toolUseId) this.pending = null;
      if (item.type === 'tool_use' && item.name === TOOL_NAME && item.id) {
        const questions = toQuestions(item.input);
        this.pending = questions ? { toolUseId: item.id, questions } : null;
      }
    }
    return before !== this.pending;
  }

  current(): PendingQuestion | null {
    return this.pending;
  }
}
