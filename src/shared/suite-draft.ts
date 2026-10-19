// A task's testing agent drawing up its suite, pure: how its brief reaches the testing-suite skill, when the draft has
// ended with no suite, what Petal pastes back to it, and which one session may write the suite file.
import { suitePath } from './task-suite';
import type { AgentRecord, SavedLoop } from './testing';

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

export type DraftTab = 'open' | 'starting' | 'gone';
export interface DraftFacts { suite: boolean; tab: DraftTab; busy: boolean; asking: boolean; worked: boolean }

// Ended with no suite: its tab is gone, or it worked since the last ask and now sits idle (not asking her something).
export const draftEnded = (f: DraftFacts): boolean => !f.suite && (f.tab === 'gone' || (f.tab === 'open' && !f.busy && !f.asking && f.worked));

export const askAgainText = (taskId: string): string =>
  `You stopped without writing ${suitePath(taskId)}. Finish drawing up this task's suite and write that file, as your instructions say.`;

export const suiteProblemText = (taskId: string, problem: string): string =>
  `Petal couldn't use ${suitePath(taskId)}: ${problem} Fix the file so it has this shape: {"stages": [{"name": "Unit", "command": "npm test"}]}, then save it again.`;

// The one session that may change the task's suite: the current loop's or draft's testing agent, else the newest one.
export function suiteWriters(loop: SavedLoop | null | undefined, agents: readonly AgentRecord[]): string[] {
  if (loop?.tester) return [loop.tester.sessionId];
  const newest = agents.filter((a) => a.role === 'tester').at(-1);
  return newest ? [newest.sessionId] : [];
}
