// A task's testing agent drawing up its suite, pure: how its brief reaches the testing-suite skill, when the draft has
// ended with no suite, what Petal pastes back to it, and which one session may write the suite file.
import { suitePath } from './task-suite';
import { criteriaPath, scenarioSources, type CriteriaItem } from './test-loop';
import type { AgentRecord, AgentState, StoredLoop } from './testing';
import type { Prd, Task } from './tasks';

export const TESTING_SKILL = 'petal-testing-suite';

// How the copy in ~/.claude/skills stands; the same words as Customize's Petal skills card.
export type SkillState = 'missing' | 'current' | 'outdated' | 'edited' | 'foreign';

// skill: run the slash command. update: Petal's unedited old copy, updated first. inline: the brief carries the instructions.
export type SkillUse = 'skill' | 'update' | 'inline';

export const skillUse = (state: SkillState | null): SkillUse => (state === 'current' ? 'skill' : state === 'outdated' ? 'update' : 'inline');

// The skill's instructions without its frontmatter.
export const skillBody = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();

// The drafting agent's first prompt: the slash command, or the request with the bundled instructions in it.
export function draftBrief(inline: boolean, request: string, skillText: string): string {
  if (!inline) return `/${TESTING_SKILL} ${request}`;
  return `${request}\n\nFollow these instructions, from Petal's testing-suite skill:\n\n${skillBody(skillText)}`;
}

// What Petal asks the testing agent to draw up: the task, the files it may write, and the notes and PRD its scenarios come from.
export function draftRequest(task: Pick<Task, 'id' | 'title' | 'notes'>, prd: Pick<Prd, 'title' | 'notes'> | null): string {
  return [
    `for task ${task.id}: "${task.title}". You are this task's testing agent, so you may write ${suitePath(task.id)}. Write its scenarios and record its bugs in ${criteriaPath(task.id)}.`,
    ...scenarioSources({ notes: task.notes, prd }),
  ].join('\n');
}

// state: its agent's, as main reports it. reviewing: idle because its scenarios wait on her review, as the skill says.
export interface DraftFacts { suite: boolean; state: AgentState; worked: boolean; reviewing?: boolean }

// Ended with no suite: closed, or no claude runs it any more, or it worked since the last ask and now sits idle (not
// asking her something). Scenarios waiting on her review keep it going: Looks right resumes it.
export const draftEnded = (f: DraftFacts): boolean =>
  !f.suite && (f.state === 'closed' || (!f.reviewing && (f.state === 'ended' || (f.state === 'idle' && f.worked))));

// ---- Scenarios first: the testing agent writes scenarios as [todo] and stops; she reviews them in Petal before any
// of their tests are written. Applies to a draft and to a loop's rounds alike.
export interface ReviewFacts {
  stopped: boolean;
  approved: readonly string[]; // scenario names she already said look right
  busy: boolean;
  asking: boolean;
}

// The [todo] scenarios she hasn't approved, once its agent sits idle on them; empty while nothing waits on her.
export function awaitingReview<T extends Pick<CriteriaItem, 'status' | 'name'>>(scenarios: readonly T[], f: ReviewFacts): T[] {
  if (f.stopped || f.busy || f.asking) return [];
  const approved = new Set(f.approved);
  return scenarios.filter((s) => s.status === 'todo' && !approved.has(s.name));
}

export const scenariosApprovedText = (taskId: string): string =>
  `I reviewed the scenarios in ${criteriaPath(taskId)} and they look right. Read the file again first, since I may have edited it. Then write their tests: one or more per scenario, each named on its scenario line with "test: path::test name", and carry on as your instructions say.`;

export const askAgainText = (taskId: string): string =>
  `You stopped without writing ${suitePath(taskId)}. Finish drawing up this task's suite and write that file, as your instructions say.`;

export const suiteProblemText = (taskId: string, problem: string): string =>
  `Petal couldn't use ${suitePath(taskId)}: ${problem} Fix the file so it has this shape: {"stages": [{"name": "Unit", "command": "npm test"}]}, then save it again.`;

// The one session that may change the task's suite: the current loop's or draft's testing agent, else the newest one.
export function suiteWriters(loop: Pick<StoredLoop, 'testerSessionId'> | null | undefined, agents: readonly AgentRecord[]): string[] {
  if (loop?.testerSessionId) return [loop.testerSessionId];
  const newest = agents.filter((a) => a.role === 'tester').at(-1);
  return newest ? [newest.sessionId] : [];
}
