// The "This session" line under a conclusion: what the Library gained and which tests ran, which Claude can't know.
// Shapes and pure helpers both sides share; main/session-info.ts gathers it, renderer/conclusion-banner.ts draws it.
import { isTerminal, phaseWord, type LoopProgress } from './loop-line';
import type { Counts, PipelineRun, RunState } from './testing';

export interface NoteRef { slug: string; title: string }

// One session's Library harvest, every run of it added together.
export interface LibrarySessionResult { added: NoteRef[]; updated: NoteRef[]; at: string }

export type LibraryLine = { state: 'reading' } | { state: 'done'; added: NoteRef[]; updated: NoteRef[] };

export interface TestsLine {
  runs: number;
  last: { id: string; name: string; state: RunState; totals: Counts };
}

export interface LoopLine { progress: LoopProgress; fixed: number | null } // fixed: from the criteria file, when there is one

export interface SessionInfo {
  sessionId: string;
  library: LibraryLine | null; // null: nothing to say (Build my Library off and nothing added)
  tests: TestsLine | null;
  loop: LoopLine | null;
}

export const hasInfo = (info: SessionInfo | null | undefined): info is SessionInfo => Boolean(info && (info.library || info.tests || info.loop));

// ---- The Library part.
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// Later runs add to earlier ones; a note added once stays added even if a later run updated it.
export function mergeLibraryResults(before: LibrarySessionResult | null, run: { added: NoteRef[]; updated: NoteRef[] }, at: string): LibrarySessionResult {
  const added = [...(before?.added ?? [])];
  for (const note of run.added) if (!added.some((n) => n.slug === note.slug)) added.push(note);
  const updated = [...(before?.updated ?? [])].filter((n) => !added.some((a) => a.slug === n.slug));
  for (const note of run.updated) if (!added.some((n) => n.slug === note.slug) && !updated.some((n) => n.slug === note.slug)) updated.push(note);
  return { added, updated, at };
}

// Reading wins while a run is going; with Build my Library off, only a session that already added something shows.
export function libraryLine({ reading, stored, autoBuild }: { reading: boolean; stored: LibrarySessionResult | null; autoBuild: boolean }): LibraryLine | null {
  if (reading) return { state: 'reading' };
  if (!stored) return null;
  const changed = stored.added.length + stored.updated.length > 0;
  if (!changed && !autoBuild) return null;
  return { state: 'done', added: stored.added, updated: stored.updated };
}

export function libraryText(line: LibraryLine): string {
  if (line.state === 'reading') return 'Library: reading…';
  const { added, updated } = line;
  if (!added.length && !updated.length) return 'Library: nothing new';
  if (!added.length) return `Library: ${plural(updated.length, 'note')} updated`;
  return `Library +${plural(added.length, 'note')}${updated.length ? `, ${updated.length} updated` : ''}`;
}

// ---- The Tests part.
export interface Span { start: number; end: number } // ms

// Petal's own runs that started inside the span, and Claude's runs from this session's log; newest first.
export function runsInSpan(runs: readonly PipelineRun[], span: Span, sessionId: string): PipelineRun[] {
  return runs
    .filter((run) => (run.by === 'claude' ? run.sessionId === sessionId : run.startedAt >= span.start && run.startedAt <= span.end))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export const runName = (run: PipelineRun): string => (run.stages.length === 1 ? run.stages[0]?.name ?? 'pipeline' : 'pipeline');

export function testsLine(newestFirst: readonly PipelineRun[]): TestsLine | null {
  const last = newestFirst[0];
  if (!last) return null;
  return { runs: newestFirst.length, last: { id: last.id, name: runName(last), state: last.state, totals: last.totals } };
}

const STATE_WORD: Record<RunState, string> = { passed: 'passed', failed: 'failed', stopped: 'stopped', running: 'still running' };

export function testsText({ runs, last }: TestsLine): string {
  const { passed, failed } = last.totals;
  const counts = last.state === 'failed' && passed + failed > 0 ? ` (${passed} passed, ${failed} failed)` : '';
  const outcome = `${last.name} ${STATE_WORD[last.state]}${counts}`;
  return runs === 1 ? `Tests: ${outcome}` : `Tests: ${runs} runs · last ${outcome}`;
}

// ---- The Test loop part.
export function loopText({ progress, fixed }: LoopLine): string {
  const phase = phaseWord(progress.phase).toLowerCase();
  const head = isTerminal(progress.phase) ? phase : `${phase} round ${progress.round}/${progress.total}`;
  const parts = [head, ...(fixed === null ? [] : [`${plural(fixed, 'bug')} fixed`]), ...(progress.open === null ? [] : [`${progress.open} open`])];
  return `Test loop: ${parts.join(', ')}`;
}
