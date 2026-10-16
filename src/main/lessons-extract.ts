// The lessons half of a session run: the instructions Claude gets and the checks on its answer.
// library-extract.ts sends these alone, or with the Library's in one call when both switches are on.
import { replyJson } from './claude-reply';
import { squash } from './library-store';
import { isLessonScope, type LessonInput } from '../shared/lessons';

const MAX_LESSONS = 6;
const RULE_CHARS = 200;
const WHY_CHARS = 300;
const EVIDENCE_CHARS = 300;

export const LESSON_SHAPE = '{"rule": "<rule>", "why": "<why>", "evidence": "<evidence>", "scope": "global"}';

export const LESSONS_INSTRUCTIONS = `You also keep LESSONS about HOW to work with this user. They are separate from domain knowledge:
not facts about the subject, but rules for how Claude should work next time. A lesson comes only from one of these:
- a correction the user gave ("no, I meant...", "don't do X", "you forgot Y", "stop doing Z");
- a mistake Claude made, shown by evidence in the session (a check that failed, a claim the user or a tool overturned);
- an approach the user clearly approved or asked to keep ("yes, do it this way from now on").
"rule": one short imperative sentence Claude can follow, e.g. "Run the check before saying a deploy landed".
"why": one sentence on what went wrong or what the user wants.
"evidence": a short quote or pointer to the moment in the session, at most 25 words.
"scope": "global" when it applies to any work with this user, "project" when it only makes sense in this project or repo.
Skip one-off task instructions, domain facts, and anything the session does not clearly show. When there are none, "lessons" is [].`;

export function lessonsPromptFor(digest: string): string {
  return `You review work sessions between a user and Claude Code.
${LESSONS_INSTRUCTIONS}

Answer with JSON only, no prose:
{"lessons": [${LESSON_SHAPE}]}

Session:
${digest}`;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// Lessons from an already parsed answer: a rule is required; an unknown scope counts as global; capped in number and length.
export function lessonsFrom(list: unknown): LessonInput[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): LessonInput[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const rule = squash(textOf(item.rule), RULE_CHARS);
    if (!rule) return [];
    return [{ rule, why: squash(textOf(item.why), WHY_CHARS), evidence: squash(textOf(item.evidence), EVIDENCE_CHARS), scope: isLessonScope(item.scope) ? item.scope : 'global' }];
  }).slice(0, MAX_LESSONS);
}

// A lessons-only answer: {"lessons": [...]} or a bare array.
export function parseLessons(stdout: string): LessonInput[] {
  const json = replyJson(stdout);
  const list = Array.isArray(json) ? json : (json as { lessons?: unknown })?.lessons;
  if (!Array.isArray(list)) throw new Error('No lessons list in reply');
  return lessonsFrom(list);
}
