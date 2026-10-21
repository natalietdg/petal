// Code review for one session: which turns changed code, one turn's cards with cached answers, and explaining them.
// The renderer names a tab or a session id; the log is always found here.
import fs from 'node:fs';
import os from 'node:os';
import { codeTurns } from './code-review-index';
import { cachedAnswers, saveAnswers, turnHash } from './code-review-store';
import { estimateTokens, reviewPrompts } from './code-review-prompt';
import { ReviewCanceled, answerJson, beginRun, cancel, resultText, runReviewer, wasCanceled } from './code-review-run';
import { repoRoot } from './repo-label';
import { checkAnswers, redactSecrets, type ExplainResult, type ExplainTarget, type ReviewSource, type SessionSummary, type TurnReview } from '../shared/code-review';
import type { CodeTurn } from './code-changes';

export interface ReviewSession {
  sessionId: string;
  transcript: string;
  cwd: string | null;
}

export type Resolve = (source: ReviewSource) => ReviewSession | null;

let active: Set<string> | null = null; // "<sessionId>:<turnId>" of the run in progress

const runKey = (sessionId: string, turnId: string): string => `${sessionId}:${turnId}`;
export const isRunning = (): boolean => active !== null;

export async function sessionSummary(session: ReviewSession): Promise<SessionSummary> {
  const turns = await codeTurns(session.transcript);
  return {
    sessionId: session.sessionId,
    turns: turns.map((t) => ({ turnId: t.turnId, replyId: t.replyId, historyIndex: t.historyIndex, at: t.at, functions: t.cards.length })),
  };
}

async function findTurn(session: ReviewSession, turnId: string): Promise<CodeTurn> {
  const turn = (await codeTurns(session.transcript)).find((t) => t.turnId === turnId);
  if (!turn) throw new Error('That turn changed no code, or its log moved.');
  return turn;
}

export function reviewOf(sessionId: string, turn: CodeTurn): TurnReview {
  const hash = turnHash(turn.cards, turn.reasoning);
  const cached = cachedAnswers(sessionId, turn.turnId, hash);
  const answers = cached ?? {};
  const unanswered = turn.cards.filter((c) => !answers[c.key]);
  return {
    sessionId, turnId: turn.turnId, cards: turn.cards, reasoning: turn.reasoning, answers, explained: cached !== null, skipped: turn.skipped,
    estimate: unanswered.length ? estimateTokens(reviewPrompts(unanswered, turn.reasoning)) : 0,
    running: active?.has(runKey(sessionId, turn.turnId)) ?? false,
  };
}

export const turnReview = async (session: ReviewSession, turnId: string): Promise<TurnReview> => reviewOf(session.sessionId, await findTurn(session, turnId));

// The repo when the folder is still there, so the reviewer can read around the change; else a folder with nothing in it.
function reviewerCwd(cwd: string | null): string {
  const root = repoRoot(cwd) ?? cwd;
  return root && fs.existsSync(root) ? root : os.tmpdir();
}

// Asks the reviewer about one turn's cards (or only the keys given), a batch per call; answers are saved as they land.
async function explainTurn(session: ReviewSession, target: ExplainTarget, changed: (sessionId: string) => void): Promise<{ explained: number; missing: number }> {
  const turn = await findTurn(session, target.turnId);
  const hash = turnHash(turn.cards, turn.reasoning);
  const cards = target.only ? turn.cards.filter((c) => target.only?.includes(c.key)) : turn.cards;
  const reasoning = turn.reasoning.map((r) => ({ ...r, text: redactSecrets(r.text) })); // quotes are checked against what was sent
  let explained = 0;
  let missing = 0;
  for (const prompt of reviewPrompts(cards, turn.reasoning)) {
    const stdout = await runReviewer(prompt.text, reviewerCwd(turn.cwd ?? session.cwd));
    const check = checkAnswers(answerJson(resultText(stdout)), prompt.ids, reasoning);
    if (check.extra.length) console.warn(`[petal] code review: ignored answers for ${check.extra.join(', ')}`);
    saveAnswers(session.sessionId, turn.turnId, hash, check.answers); // an empty save still marks the content as asked
    explained += Object.keys(check.answers).length;
    missing += check.missing.length;
    changed(session.sessionId);
  }
  return { explained, missing };
}

// One run at a time over every target, in order; Cancel stops the current call and the rest.
export async function explain(targets: readonly ExplainTarget[], resolve: Resolve, changed: (sessionId: string) => void): Promise<ExplainResult> {
  if (active) return { error: 'A review is already running. Wait for it, or cancel it first.' };
  const sessions = targets.map((t) => ({ target: t, session: resolve(t.source) }));
  const lost = sessions.find((s) => !s.session);
  if (lost) return { error: 'That session’s log isn’t readable any more.' };
  active = new Set(sessions.map(({ target, session }) => runKey(session?.sessionId ?? '', target.turnId)));
  beginRun();
  for (const { session } of sessions) if (session) changed(session.sessionId);
  let explained = 0;
  let missing = 0;
  try {
    for (const { target, session } of sessions) {
      if (!session || wasCanceled()) break;
      const result = await explainTurn(session, target, changed);
      explained += result.explained;
      missing += result.missing;
    }
    return wasCanceled() ? { canceled: true } : { explained, missing };
  } catch (error) {
    return error instanceof ReviewCanceled ? { canceled: true } : { error: (error as Error).message };
  } finally {
    active = null;
    for (const { session } of sessions) if (session) changed(session.sessionId);
  }
}

export const cancelRun = (): void => { if (active) cancel(); };
