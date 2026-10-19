// The Board's code review for a task: every turn of every session that worked on it (its owner, who finished it, and
// its testing agents), grouped by file then function, newest change first.
import * as coord from './coord';
import { loadTasks } from './tasks-store';
import { agentsOf } from './task-suites';
import { codeTurns } from './code-review-index';
import { reviewOf, isRunning, type ReviewSession } from './code-review';
import { estimateTokens, reviewPrompts } from './code-review-prompt';
import { groupTaskChanges, type ExplainTarget, type TaskChange, type TaskReview } from '../shared/code-review';

// The task's sessions, oldest role first: owner, the one who finished it, then its agents.
function taskSessions(sessionId: string, taskId: string): { title: string; ids: string[] } {
  const root = coord.current().sessions.find((s) => s.sessionId === sessionId)?.root;
  if (!root) throw new Error('That session isn’t in a git repo, so it has no tasks.');
  const task = loadTasks(root).tasks.find((t) => t.id === taskId);
  if (!task) throw new Error('That task is gone. It may have been deleted in another window.');
  const ids = [task.owner?.sessionId, task.doneBy?.sessionId, ...agentsOf(root, taskId).map((a) => a.sessionId)].filter((id): id is string => Boolean(id));
  return { title: task.title, ids: [...new Set(ids)] };
}

export async function taskReview(sessionId: string, taskId: string, find: (sessionId: string) => ReviewSession | null): Promise<TaskReview> {
  const { title, ids } = taskSessions(sessionId, taskId);
  const changes: TaskChange[] = [];
  const targets: ExplainTarget[] = [];
  const skipped = new Set<string>();
  let estimate = 0;
  let sessions = 0;
  for (const id of ids) {
    const session = find(id);
    if (!session) continue;
    sessions += 1;
    for (const turn of await codeTurns(session.transcript)) {
      const review = reviewOf(session.sessionId, turn);
      turn.skipped.forEach((file) => skipped.add(file));
      for (const card of turn.cards) {
        changes.push({ sessionId: session.sessionId, turnId: turn.turnId, at: turn.at, card, answer: review.answers[card.key] ?? null, explained: review.explained });
      }
      const open = turn.cards.filter((c) => !review.answers[c.key]);
      if (!open.length) continue;
      targets.push({ source: { sessionId: session.sessionId }, turnId: turn.turnId, only: open.map((c) => c.key) });
      estimate += estimateTokens(reviewPrompts(open, turn.reasoning));
    }
  }
  return { title, sessions, files: groupTaskChanges(changes), targets, skipped: [...skipped], estimate, running: isRunning() };
}
