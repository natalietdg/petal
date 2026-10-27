// Test loop: Claude writes scenarios, runs the pipeline, files real bugs, fixes them and runs again, round by round.
// Petal only sends the brief, reads the criteria file and the Loop lines, and can stop it. Pure helpers both sides share.
import { isTerminal, type LoopProgress } from './loop-line';
import type { StackItem, StageConfig } from './testing';
import { CRITERIA_NAME, SUITE_NAME, REPOS_HOME, inSuiteDir, isLevel, type Level } from './repo-suite';
import { DEFAULT_AGENT_NAMES, type AgentRole } from './agent-names';

export const LEGACY_CRITERIA_PATH = '.petal/test-criteria.md'; // the one shared file from before criteria were per task
export const CRITERIA_DIR = '.petal/criteria'; // one file per task, before criteria were per repo
export const CRITERIA_CAP = 64 * 1024; // bytes read; a bigger file shows its first part
export const ITEMS_CAP = 200; // per section
export const NAME_CAP = 300; // characters of an item's name
export const DETAIL_CAP = 2000; // characters of a sub-bullet's value
export const DEFAULT_ROUNDS = 5;
export const MAX_ROUNDS = 10;
export const FOCUS_CAP = 200;

export const STOP_MESSAGE = 'Stop the test loop now. Leave the code as it is and summarise: round reached, bugs fixed, bugs still open, files changed.';

// ---- The repo's criteria file: "## Scenarios", "## Manual" and "## Bugs", one "- [status] name · part · part" line per
// item, parts split by " · ". Scenarios: test: path::name (repeatable), ticket: AB#1, level:, from: prd|notes.
// Manual cases and bugs carry indented "  - Key: value" sub-bullets (Prereq/Steps/Expected/Result; Steps/Expected/
// Actual/Env/Evidence). Older files' "round n" and "task: <id>" parts still read.
export const CRITERIA_STATUSES = ['pass', 'fail', 'flaky', 'fixed', 'todo', 'blocked', 'open'] as const;
export type CriteriaStatus = typeof CRITERIA_STATUSES[number];
export type ScenarioSource = 'prd' | 'notes';
export type CriteriaSection = 'scenarios' | 'manual' | 'bugs';
export const SECTIONS: readonly CriteriaSection[] = ['scenarios', 'manual', 'bugs'];
export type ItemLevel = Level | 'manual';

interface CriteriaTest { path: string; name: string | null }

export interface CriteriaItem {
  status: CriteriaStatus;
  name: string;
  test: CriteriaTest | null; // the first of tests
  tests: CriteriaTest[];
  source: ScenarioSource | null; // where a scenario's rule came from; null for one the agent added
  round: number | null;
  regression: boolean; // a bug with a test that reproduces it
  taskId: string | null;
  ticket: string | null; // AB#1234
  level: ItemLevel | null;
  details: Record<string, string>; // sub-bullets by their key as written: Steps, Expected...
}

export interface Criteria { scenarios: CriteriaItem[]; manual: CriteriaItem[]; bugs: CriteriaItem[]; malformed: number; truncated: boolean }

export const emptyCriteria = (): Criteria => ({ scenarios: [], manual: [], bugs: [], malformed: 0, truncated: false });

const HEADING = /^\s*#{1,6}\s+(scenarios|manual|bugs)\b/i;
const OTHER_HEADING = /^\s*#{1,6}\s/;
const ITEM = /^\s*[-*]\s+\[([^\]]*)\]\s*(.*)$/;
const DETAIL = /^\s{2,}[-*]\s+([A-Za-z][\w ]{0,30}):\s*(.*)$/;
const SEP = /\s+[·•]\s+/;
const TICKET = /^[\w#.-]{1,40}$/;

export const sectionOf = (line: string): CriteriaSection | null => (HEADING.exec(line)?.[1]?.toLowerCase() as CriteriaSection | undefined) ?? null;

function parseItem(line: string, section: CriteriaSection): CriteriaItem | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  const status = ((match[1] ?? '').trim().toLowerCase() || 'todo') as CriteriaStatus; // "[ ]" is a scenario not tested yet
  if (!CRITERIA_STATUSES.includes(status)) return null;
  const [name = '', ...parts] = (match[2] ?? '').split(SEP).map((p) => p.trim());
  if (!name || /^([·•]|test:)/i.test(name)) return null; // a name is required
  const item: CriteriaItem = { status, name: name.slice(0, NAME_CAP), test: null, tests: [], source: null, round: null, regression: false, taskId: null, ticket: null, level: null, details: {} };
  for (const part of parts) {
    const [, key = '', value = ''] = /^(\w+):\s*(.+)$/.exec(part) ?? [];
    const roundPart = /^round\s+(\d{1,3})$/i.exec(part);
    if (key.toLowerCase() === 'task' && /^[\w-]{1,64}$/.test(value)) item.taskId = value;
    else if (key.toLowerCase() === 'test') {
      const [file, ...rest] = value.split('::');
      item.tests.push({ path: file.trim(), name: rest.length ? rest.join('::').trim() || null : null });
    } else if (key.toLowerCase() === 'ticket' && TICKET.test(value)) item.ticket = value;
    else if (key.toLowerCase() === 'level' && (isLevel(value.toLowerCase()) || value.toLowerCase() === 'manual')) item.level = value.toLowerCase() as ItemLevel;
    else if (key.toLowerCase() === 'from' && /^(prd|notes)$/i.test(value)) item.source = value.toLowerCase() as ScenarioSource;
    else if (roundPart?.[1]) item.round = Number(roundPart[1]);
    else return null;
  }
  item.test = item.tests[0] ?? null;
  item.regression = section === 'bugs' && item.test !== null;
  return item;
}

// Lines outside the three sections are ignored; a list line inside one that doesn't fit the format counts as malformed.
// An indented "- Key: value" right under an item is that item's detail.
export function parseCriteria(text: string, truncated = false): Criteria {
  const out: Criteria = { ...emptyCriteria(), truncated };
  let section: CriteriaSection | null = null;
  let last: CriteriaItem | null = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = sectionOf(line);
    if (heading) { section = heading; last = null; continue; }
    if (OTHER_HEADING.test(line)) { section = null; last = null; continue; }
    if (!section || !/^\s*[-*]\s/.test(line)) continue;
    const detail = ITEM.test(line) ? null : DETAIL.exec(line);
    if (detail && last) { last.details[detail[1].trim()] = detail[2].trim().slice(0, DETAIL_CAP); continue; }
    const item = parseItem(line, section);
    last = item;
    if (!item) { out.malformed += 1; continue; }
    if (out[section].length < ITEMS_CAP) out[section].push(item);
  }
  return out;
}

// ---- Writing items back, in the format the parser reads.
const DETAIL_ORDER: Record<CriteriaSection, string[]> = {
  scenarios: [],
  manual: ['Prereq', 'Steps', 'Expected', 'Result'],
  bugs: ['Steps', 'Expected', 'Actual', 'Env', 'Evidence'],
};

// The known keys first in their order, then any others as written.
const orderedDetails = (item: CriteriaItem, section: CriteriaSection): [string, string][] => {
  const order = DETAIL_ORDER[section];
  const entries = Object.entries(item.details);
  return [...order.flatMap((key) => entries.filter(([k]) => k === key)), ...entries.filter(([k]) => !order.includes(k))];
};

// The item's line and its sub-bullets.
export function itemLines(item: CriteriaItem, section: CriteriaSection): string[] {
  const parts = [
    item.name,
    ...item.tests.map((t) => `test: ${t.path}${t.name ? `::${t.name}` : ''}`),
    ...(item.ticket ? [`ticket: ${item.ticket}`] : []),
    ...(item.level ? [`level: ${item.level}`] : []),
    ...(item.source ? [`from: ${item.source}`] : []),
    ...(item.round !== null ? [`round ${item.round}`] : []),
    ...(item.taskId ? [`task: ${item.taskId}`] : []),
  ];
  return [`- [${item.status}] ${parts.join(' · ')}`, ...orderedDetails(item, section).map(([key, value]) => `  - ${key}: ${value}`)];
}

export const CRITERIA_SKELETON = '# Test criteria\n\nThe repo’s scenarios, manual checks and bugs. Any Claude session may add to it.\n\n## Scenarios\n\n## Manual\n\n## Bugs\n';

export function criteriaText(criteria: Criteria): string {
  const title = { scenarios: 'Scenarios', manual: 'Manual', bugs: 'Bugs' } as const;
  const blocks = SECTIONS.map((s) => [`## ${title[s]}`, ...criteria[s].flatMap((item) => itemLines(item, s))].join('\n'));
  return `# Test criteria\n\n${blocks.join('\n\n')}\n`;
}

// Each item at the end of its section; one whose name is already there is skipped, and a missing section is added.
export function addCriteriaItems(existing: string | null, add: Partial<Record<CriteriaSection, CriteriaItem[]>>): string {
  const lines = (existing ?? CRITERIA_SKELETON).replace(/\r\n?/g, '\n').split('\n');
  const have = parseCriteria(existing ?? '');
  for (const section of SECTIONS) {
    const names = new Set(have[section].map((i) => i.name));
    const fresh = (add[section] ?? []).filter((item) => !names.has(item.name) && names.add(item.name));
    if (!fresh.length) continue;
    const block = fresh.flatMap((item) => itemLines(item, section));
    const start = lines.findIndex((l) => sectionOf(l) === section);
    if (start < 0) { lines.push('', `## ${section[0].toUpperCase()}${section.slice(1)}`, ...block); continue; }
    let end = lines.findIndex((l, i) => i > start && OTHER_HEADING.test(l));
    if (end < 0) end = lines.length;
    while (end > start + 1 && !lines[end - 1].trim()) end -= 1; // before the blank lines ending the section
    lines.splice(end, 0, ...block);
  }
  const text = lines.join('\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}

export const MANUAL_STATUSES = ['pass', 'fail', 'todo', 'blocked'] as const;
export type ManualStatus = typeof MANUAL_STATUSES[number];

// Her tick on a manual case: its status, and its Result sub-bullet set (or removed when empty). The rest of the file stays
// as written. Null when the case isn't there.
export function setManualResult(text: string, name: string, status: ManualStatus, result: string): string | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let section: CriteriaSection | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const heading = sectionOf(lines[i]);
    if (heading || OTHER_HEADING.test(lines[i])) { section = heading; continue; }
    if (section !== 'manual' || DETAIL.test(lines[i])) continue;
    const item = parseItem(lines[i], 'manual');
    if (item?.name !== name) continue;
    lines[i] = lines[i].replace(/\[[^\]]*\]/, `[${status}]`);
    let end = i + 1;
    while (end < lines.length && DETAIL.test(lines[end]) && !ITEM.test(lines[end])) end += 1;
    const at = lines.slice(i + 1, end).findIndex((l) => DETAIL.exec(l)?.[1].trim().toLowerCase() === 'result');
    const clean = result.replace(/\s+/g, ' ').trim().slice(0, DETAIL_CAP);
    if (at >= 0) lines.splice(i + 1 + at, 1, ...(clean ? [`  - Result: ${clean}`] : []));
    else if (clean) lines.splice(end, 0, `  - Result: ${clean}`);
    return lines.join('\n');
  }
  return null;
}

// A scenario run's results: each named scenario's status set to pass or fail, the rest of the file as written.
export function setScenarioStatuses(text: string, statuses: Readonly<Record<string, 'pass' | 'fail'>>): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let section: CriteriaSection | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const heading = sectionOf(lines[i]);
    if (heading || OTHER_HEADING.test(lines[i])) { section = heading; continue; }
    if (section !== 'scenarios' || DETAIL.test(lines[i])) continue;
    const item = parseItem(lines[i], 'scenarios');
    const next = item && Object.hasOwn(statuses, item.name) ? statuses[item.name] : undefined;
    if (next) lines[i] = lines[i].replace(/\[[^\]]*\]/, `[${next}]`);
  }
  return lines.join('\n');
}

export const mergeCriteria = (list: readonly Criteria[]): Criteria => list.reduce((all, c) => ({
  scenarios: [...all.scenarios, ...c.scenarios], manual: [...all.manual, ...c.manual], bugs: [...all.bugs, ...c.bugs], malformed: all.malformed + c.malformed, truncated: all.truncated || c.truncated,
}), emptyCriteria());

// An open bug: [open], or [fail] as older files wrote it.
export const isOpenBug = (item: CriteriaItem): boolean => item.status === 'open' || item.status === 'fail';
export const openBugs = (criteria: Criteria): number => criteria.bugs.filter(isOpenBug).length;

// ---- Filters: by ticket, and by level for scenarios. No ticket, or no levels picked, keeps everything.
export interface CriteriaFilter { ticket: string | null; levels: readonly Level[] }

export function filterCriteria(criteria: Criteria, { ticket, levels }: CriteriaFilter): Criteria {
  const byTicket = (item: CriteriaItem) => !ticket || item.ticket === ticket;
  const byLevel = (item: CriteriaItem) => !levels.length || (item.level !== null && item.level !== 'manual' && levels.includes(item.level));
  return { ...criteria, scenarios: criteria.scenarios.filter((s) => byTicket(s) && byLevel(s)), manual: criteria.manual.filter(byTicket), bugs: criteria.bugs.filter(byTicket) };
}

// Every ticket named in the file, in first-seen order.
export const ticketsOf = (criteria: Criteria): string[] =>
  [...new Set([...criteria.scenarios, ...criteria.manual, ...criteria.bugs].flatMap((i) => (i.ticket ? [i.ticket] : [])))];

// The coverage line's count: scenarios that name no test.
export const untested = (criteria: Criteria): CriteriaItem[] => criteria.scenarios.filter((s) => !s.tests.length);

// The AB# id in a task's name, for its imported lines' ticket.
export const ticketInText = (text: string): string | null => /\bAB#\d{1,9}\b/.exec(text)?.[0] ?? null;

// A bug as plain text in Azure DevOps' repro-steps shape, for pasting into a new Bug.
export function adoBugText(bug: CriteriaItem): string {
  const d = (key: string) => bug.details[key]?.trim() || '(not recorded)';
  const test = bug.test ? `${bug.test.path}${bug.test.name ? `::${bug.test.name}` : ''}` : '(none)';
  return [
    `Title: ${bug.name}`,
    ...(bug.ticket ? [`Related: ${bug.ticket}`] : []),
    '',
    'Steps to reproduce:', d('Steps'),
    '',
    'Expected result:', d('Expected'),
    '',
    'Actual result:', d('Actual'),
    '',
    `Environment: ${d('Env')}`,
    `Failing test: ${test}`,
    `Evidence: ${d('Evidence')}`,
  ].join('\n');
}


// ---- The brief Petal sends once; Claude runs the loop.
// agent: the task's testing agent, which owns the tests and suite and works beside the bug fix agent.
export interface BriefInput { focus: string; rounds: number; stages: StageConfig[]; stack: StackItem[]; taskId?: string | null; agent?: boolean; names?: Record<AgentRole, string>; sources?: SourceInput; review?: boolean; suiteDir?: string | null; ticket?: string | null }

export const clampRounds = (n: unknown): number => {
  const value = Math.round(Number(n));
  return Number.isFinite(value) ? Math.min(MAX_ROUNDS, Math.max(1, value)) : DEFAULT_ROUNDS;
};

// One line, no controls or long dashes, capped; the focus goes inside the brief as text.
// eslint-disable-next-line no-control-regex -- stripping controls is the point
export const cleanFocus = (focus: string): string => focus.replace(/[\x00-\x1F\x7F\s\u2014\u2013]+/g, ' ').trim().slice(0, FOCUS_CAP);

// ---- Where a task's scenarios come from: its notes and its PRD's, labelled for the testing agent, each capped.
export const SOURCE_CAP = 1200; // characters per source
export interface SourceInput { notes: string; prd: { title: string; notes: string } | null }

// Lines kept as written, controls and blank lines dropped, cut at the cap.
// eslint-disable-next-line no-control-regex -- stripping controls is the point
const sourceText = (text: string): string => { const t = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[\x00-\x1F\x7F]+/g, ' ').trim()).filter(Boolean).join('\n'); return t.length > SOURCE_CAP ? `${t.slice(0, SOURCE_CAP - 1)}…` : t; };

export function scenarioSources({ notes, prd }: SourceInput): string[] {
  const own = sourceText(notes);
  const fromPrd = prd ? sourceText(prd.notes) : '';
  const title = prd ? prd.title.replace(/\s+/g, ' ').trim() : '';
  if (!own && !title) return [];
  return [
    'Source of scenarios: write at least one scenario for each rule below, marked "from: notes" or "from: prd" on its line. Add your own edge cases and failure paths too, with no "from:".',
    ...(own ? ['Task notes:', own] : []),
    ...(title ? [`PRD "${title}":`, fromPrd || '(no text beyond its title)'] : []),
  ];
}

// Scenarios first, for the testing agent: [todo] scenarios wait on her review in Petal before their tests are written.
// review: none approved yet, so round 1 writes them and stops; otherwise only scenarios added later stop it.
export function reviewBrief(review: boolean): string[] {
  const wait = 'end your reply with the Loop line in the phase scenarios and wait. I review them in Petal, and may edit the file, then send a message saying they look right. Read the file again then, and only then write their tests.';
  return [
    ...(review ? [`Scenarios first: before any test in round 1, write this task's scenarios under Scenarios in the criteria file as [todo] lines, one plain-language rule each, observable behaviour, with edge cases and failure paths. Keep the ones already there. Then ${wait}`] : ['The scenarios already in the criteria file are the ones I approved.']),
    `A scenario you add in a later round goes in as [todo] too: once you have added them, ${wait}`,
  ];
}

// Each round's self-review; Petal reads the section and the Course line (shared/distillation.ts).
export const DISTILL_BRIEF = [
  '6. Distillation: before you end the round, review it yourself. From round 2 on, start by revisiting every open thread from your previous round: settle it with evidence, carry it forward (and list it again under Open threads), or drop it with a reason, as a Q/A whose answer starts with settled, carried or dropped. Then ask yourself 3 to 6 pointed questions, such as: what changed this round, what is still untested for the focus, why did a test fail, is that failure flaky or real, does the fix cover the cause or only the symptom, what would a user hit next. Answer each one yourself from evidence (test output, the code, the criteria file), never from memory.',
  '   Any question you could not settle from evidence goes under Open threads instead, with the check that would settle it. A thread only I can settle has a check that starts with "needs you · " and says what you need from me.',
  '   Write it in your reply, before the Loop line, exactly like this:',
  '   ## Distillation',
  '   - Q: an open thread from last round · A: settled · the evidence that settled it',
  '   - Q: the question · A: your answer',
  '   **Course:** retest · one clause saying why',
  '   ## Open threads',
  '   - A question you could not settle? *Check: the command or file that would settle it*',
  '   - A question only I can settle? *Check: needs you · what you need from me*',
  '   The course is one of add scenarios, retest, fix bug, hand to you. Then act on it yourself: add scenarios, rerun, or fix the bug in the next step. For hand to you, stop there and wait for my answer. A needs-you thread with another course: keep going and use my answer when it arrives.',
];

export function buildLoopBrief({ focus, rounds, stages, stack, taskId = null, agent = false, names = DEFAULT_AGENT_NAMES, sources, review = false, suiteDir = null, ticket = null }: BriefInput): string {
  const n = clampRounds(rounds);
  const what = cleanFocus(focus);
  const tools = stack.filter((s) => !s.insert && s.kind !== 'ci');
  const maestro = tools.some((s) => /maestro/i.test(s.label));
  const tester = Boolean(taskId && agent); // the testing agent, working beside the bug fix agent
  const lines = [
    tester
      ? `You are ${names.tester}, this task's testing agent. Run a test loop, up to ${n} round${n === 1 ? '' : 's'}, while ${names.fixer} fixes the bugs you find in its own session. Petal shows your progress from the lines below, so keep their format exactly.`
      : `Run a test loop on this project, up to ${n} round${n === 1 ? '' : 's'}. Petal shows your progress from the lines below, so keep their format exactly.`,
    '',
    `Focus: ${what || 'the whole project; start with the riskiest untested paths'}.`,
    ...(sources ? scenarioSources(sources) : []),
    ...(tools.length ? [`Stack: ${tools.map((t) => `${t.label} (${t.foundIn})`).join(', ')}.`] : []),
    `${taskId ? 'The repo’s suite' : 'Pipeline'}, in this order:`,
    ...stages.map((s, i) => `${i + 1}. ${s.name}: \`${s.command}\``),
    ...(tester && taskId ? [`The suite lives in ${inSuiteDir(suiteDir, SUITE_NAME)}, in Petal and shared by every session in this repo. Never write suite or criteria files inside the repo. You may add or fix stages during the loop, keeping its shape: {"stages": [{"name": "Unit", "command": "npm test", "level": "regression"}]}. Petal shows the change with an Undo. Never remove a stage or weaken a test.`] : []),
    `Criteria file: ${inSuiteDir(suiteDir, CRITERIA_NAME)}`,
    ...(tester ? ['', ...reviewBrief(review)] : []),
    '',
    'Each round:',
    tester
      ? `1. Scenarios: give every approved [todo] scenario its tests, as real tests in the project's existing test folders, using its own frameworks${maestro ? ', plus Maestro flows next to the existing ones' : ''}, and name each test on its scenario's line. New scenarios for the focus go in as [todo] and wait for my review, as above.`
      : `1. Scenarios: ${taskId ? 'keep the scenarios already under Scenarios in the criteria file and give any still [todo] its tests first. Then ' : ''}write new scenarios for the focus as real tests in the project's existing test folders, using its own frameworks${maestro ? ', plus Maestro flows next to the existing ones' : ''}. Add each under Scenarios in the criteria file, with every test that covers it.`,
    `2. Testing: run the ${taskId ? 'suite' : 'pipeline'} commands above, in order.`,
    '3. Before calling a failure a bug, run that test once more. If it passes, record it as flaky, not a bug.',
    tester
      ? `4. For each real bug: write or keep a regression test that reproduces it and fails, and add it under Bugs as [open] with that test and its Steps, Expected, Actual, Env and Evidence sub-bullets. Never edit app code: Petal hands each bug to ${names.fixer}, then asks you to verify its fix. Keep going; never wait for the fixes.`
      : '4. For each real bug: add it under Bugs, write or keep a regression test that reproduces it and fails first, fix the code, then run the pipeline again.',
    '5. A stage that fails for an environment reason (missing dependency, wrong command, port in use) is not a product bug: diagnose it, repair the environment or command, and say what you changed. Never weaken, skip or delete a test to get green. Never edit snapshot baselines without saying why.',
    ...(tester ? DISTILL_BRIEF.map((line) => line.replace('or fix the bug in the next step', `or file the bug for ${names.fixer}`)) : DISTILL_BRIEF),
    '',
    'Criteria file format: "## Scenarios", "## Manual" and "## Bugs" sections, one line per item. Keep lines you didn’t write as they are:',
    `- [status] name · test: path::test name · ticket: ${ticket ?? 'AB#1234'} · level: regression`,
    `where status is pass or fail, or todo for a scenario with no test yet, and level is smoke, regression or staging. A scenario covered by more than one test lists each, one "test:" part per test; it passes only when all of them do. A bug line is - [open] name · test: path::test name · ticket: …, then indented "  - Steps:", "  - Expected:", "  - Actual:", "  - Env:", "  - Evidence:" lines; [fixed] once its test passes.${ticket ? ` Tag every line you add with "ticket: ${ticket}".` : ''}`,
    '',
    `End each round, and every reply during the loop, with this line: **Loop:** round 1/${n} · scenarios · 0 open`,
    tester ? 'The phase is one of scenarios, testing, verifying, done, stopped. Open is the number of bugs not yet fixed.' : 'The phase is one of scenarios, testing, fixing, verifying, done, stopped. Open is the number of bugs not yet fixed.',
    '',
    tester
      ? `Stop when the suite is green, no bug is left open and your latest round found nothing new, or after round ${n}. Then use the phase done and give a short summary: rounds run, bugs filed, bugs verified, bugs still open, flaky tests, environment repairs, files changed. If I stop the loop, use the phase stopped.`
      : `Stop when the pipeline is green and the round found no new bugs, after round ${n}, or when a round fixed nothing. Then use the phase done and give a short summary: rounds run, bugs fixed, bugs still open, flaky tests, environment repairs, files changed. If I stop the loop, use the phase stopped.`,
    '',
    'Never commit, push, or change git history. Messages I send during the loop come first: read them before your next step and follow them.',
  ];
  return lines.join('\n');
}

export interface FixerBriefInput { taskId: string; taskTitle: string; stages: StageConfig[]; names?: Record<AgentRole, string> }

// The bug fix agent: one bug at a time from Petal, app code only, a Fix line when each is done.
export function buildFixerBrief({ taskId, taskTitle, stages, names = DEFAULT_AGENT_NAMES }: FixerBriefInput): string {
  return [
    `You are ${names.fixer}, the bug fix agent for the task "${taskTitle.replace(/[.!?]+$/, '')}" (${taskId}). ${names.tester} is testing the same task in its own session and files the bugs it finds.`,
    '',
    'Petal sends you one bug at a time: its name, the failing test and the failure output. For each:',
    '1. Read the failing test and find the cause in the app code.',
    `2. Fix the app code only. Never edit tests, test data, snapshot baselines or the suite files in ${REPOS_HOME}: they belong to ${names.tester}.`,
    '3. Run that one test to confirm, plus a quick check of the code around it.',
    '4. End your reply with this line: **Fix:** the bug name · done',
    '   If you can’t fix it, end with **Fix:** the bug name · blocked, and say why in one line.',
    '',
    `The task's suite, for reference: ${stages.map((s) => `${s.name} (\`${s.command}\`)`).join(', ') || 'none yet'}.`,
    'Until the first bug arrives, read the code this task touches and wait. Reply "Ready." now.',
    '',
    'Never commit, push, or change git history. Messages I send come first: read them before your next step and follow them.',
  ].join('\n');
}

export interface SentFixerBriefInput { taskId: string; taskTitle: string; bugName: string; prompt: string; names?: Record<AgentRole, string> }

// The bug fix agent started alone from her "Send to bug fix agent": the failure she sent, app code only, a Fix line to end on.
export function buildSentFixerBrief({ taskId, taskTitle, bugName, prompt, names = DEFAULT_AGENT_NAMES }: SentFixerBriefInput): string {
  return [
    `You are ${names.fixer}, the bug fix agent for the task "${taskTitle.replace(/[.!?]+$/, '')}" (${taskId}). She sent you this failure from Petal's Testing tab:`,
    '',
    prompt,
    '',
    `Fix the app code only. Never edit tests, test data, snapshot baselines or the suite files in ${REPOS_HOME}: only ${names.tester} changes those.`,
    'Run the failing tests to confirm, plus a quick check of the code around them.',
    `End your reply with this line: **Fix:** ${bugName} · done`,
    `If you can’t fix it, end with **Fix:** ${bugName} · blocked, and say why in one line.`,
    'Petal may send you more bugs after this one, one at a time, each with the Fix line to end on.',
    '',
    'Never commit, push, or change git history. Messages I send come first: read them before your next step and follow them.',
  ].join('\n');
}

// ---- Where the brief goes: the project's live Claude tab, else a new tab that starts claude with it.
export type LoopTarget = { kind: 'paste'; tabId: string } | { kind: 'new-tab' };

export function loopTarget(sessionTab: string | null, isLive: (tabId: string) => boolean): LoopTarget {
  return sessionTab && isLive(sessionTab) ? { kind: 'paste', tabId: sessionTab } : { kind: 'new-tab' };
}

// ---- Whether a loop is going: its latest Loop line, whether that claude is live, and what Petal itself did.
export type LoopStatus = 'idle' | 'starting' | 'running' | 'done' | 'stopped';
export const STARTING_GRACE_MS = 3 * 60 * 1000; // a new tab's claude may take a while to write its first line

export interface LoopFacts { progress: LoopProgress | null; live: boolean; startedAt: number | null; stoppedAt: number | null; now: number }

export function loopStatus({ progress, live, startedAt, stoppedAt, now }: LoopFacts): LoopStatus {
  if (progress && isTerminal(progress.phase)) return progress.phase as 'done' | 'stopped';
  if (stoppedAt !== null) return 'stopped';
  if (progress) return live ? 'running' : 'stopped';
  if (startedAt !== null && (live || now - startedAt < STARTING_GRACE_MS)) return 'starting';
  return 'idle';
}

export const isActive = (status: LoopStatus): boolean => status === 'starting' || status === 'running';

// ---- Stop: one Esc interrupts the current step, then the stop message once that claude is idle.
export interface StopDeps {
  sendEsc: () => void;
  isIdle: () => boolean;
  send: (text: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
}
export const ESC_SETTLE_MS = 800; // Claude Code takes a moment to show the interrupt
export const IDLE_POLL_MS = 400;
export const IDLE_GIVE_UP_MS = 60_000; // still busy after this: send anyway, Claude Code queues it

export async function stopLoop({ sendEsc, isIdle, send, sleep }: StopDeps): Promise<'idle' | 'timeout'> {
  sendEsc();
  await sleep(ESC_SETTLE_MS);
  let waited = 0;
  while (!isIdle() && waited < IDLE_GIVE_UP_MS) {
    await sleep(IDLE_POLL_MS);
    waited += IDLE_POLL_MS;
  }
  const outcome = isIdle() ? 'idle' : 'timeout';
  await send(STOP_MESSAGE);
  return outcome;
}

// Stop halts both agents of a task's loop at once, each with its own Esc and stop message.
export const stopAll = (agents: readonly StopDeps[]): Promise<('idle' | 'timeout')[]> => Promise.all(agents.map(stopLoop));
