// The repo suite's filters and the Scenarios & bugs section: level and ticket chips, opt-in stages with their notes,
// scenarios with the coverage line and her review of new ones, the manual checklist she ticks, and one bug list that
// joins the criteria file's bugs (Azure DevOps' shape, with a copy button) with the test loop's bug queue.
import { el } from './dom';
import { when } from './testing-view';
import { LEVELS, type Level, type SuiteStage } from '../shared/repo-suite';
import { MANUAL_STATUSES, adoBugText, isOpenBug, untested, type Criteria, type CriteriaItem, type ManualStatus } from '../shared/test-loop';
import { BUG_STATES, BUG_STATE_WORDS, queueCounts, type QueuedBug } from '../shared/bug-queue';
import { bugRows, type BugRow } from '../shared/bug-list';

const COPIED_MS = 1500;
const LEVEL_WORD: Record<Level, string> = { smoke: 'Smoke', regression: 'Regression', staging: 'Staging' };
const MANUAL_WORD: Record<ManualStatus, string> = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked', todo: 'Not run' };
const SOURCE_WORD = { prd: 'from the PRD', notes: 'from the task notes' } as const; // a scenario's from: part as its tag reads
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function chip(text: string, pressed: boolean, onClick: () => void, extra = ''): HTMLButtonElement {
  const button = el('button', `tst-chip${pressed ? ' is-on' : ''}${extra ? ` ${extra}` : ''}`, text);
  button.type = 'button';
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', onClick);
  return button;
}

// runTicket: null while no ticket is picked or a run is going.
export interface FilterHandlers { level: (level: Level) => void; ticket: (ticket: string | null) => void; runTicket: (() => void) | null }

// Level chips (none picked shows every level), then a ticket row when the criteria name any.
export function filterBar(levels: ReadonlySet<Level>, tickets: readonly string[], ticket: string | null, handlers: FilterHandlers): HTMLElement {
  const box = el('div', 'tst-filters');
  const levelRow = el('div', 'tst-chip-row');
  levelRow.setAttribute('role', 'group');
  levelRow.setAttribute('aria-label', 'Levels');
  levelRow.append(el('span', 'tst-chip-label', 'Level'), ...LEVELS.map((level) => chip(LEVEL_WORD[level], levels.has(level), () => handlers.level(level), `is-${level}`)));
  box.append(levelRow);
  if (tickets.length) {
    const ticketRow = el('div', 'tst-chip-row');
    ticketRow.setAttribute('role', 'group');
    ticketRow.setAttribute('aria-label', 'Tickets');
    const run = el('button', 'tst-link tst-run-ticket', ticket ? `Run ${ticket}` : 'Run ticket');
    run.type = 'button';
    run.disabled = !handlers.runTicket;
    run.title = ticket ? `Runs every scenario of ${ticket} that names a test. Staging ones only while the Staging chip is on.` : 'Pick a ticket first';
    if (handlers.runTicket) run.addEventListener('click', handlers.runTicket);
    ticketRow.append(el('span', 'tst-chip-label', 'Ticket'), chip('All', ticket === null, () => handlers.ticket(null)), ...tickets.map((t) => chip(t, ticket === t, () => handlers.ticket(t))), run);
    box.append(ticketRow);
  }
  return box;
}

// Each opt-in stage with its toggle and note; Run includes it only while it is on. Null when there are none.
export function optInList(stages: readonly SuiteStage[], optedIn: ReadonlySet<string>, toggle: (id: string, on: boolean) => void, busy: boolean): HTMLElement | null {
  const shown = stages.filter((s) => s.optIn);
  if (!shown.length) return null;
  const box = el('div', 'tst-optins');
  for (const stage of shown) {
    const label = el('label', 'tst-toggle tst-optin');
    const box2 = el('input');
    box2.type = 'checkbox';
    box2.checked = optedIn.has(stage.id);
    box2.disabled = busy;
    box2.dataset.stage = stage.id;
    box2.addEventListener('change', () => toggle(stage.id, box2.checked));
    label.append(box2, el('span', null, `Include ${stage.name} in Run`), el('span', 'tst-muted', [`Opt-in · ${LEVEL_WORD[stage.level]}`, stage.note ?? ''].filter(Boolean).join(' · ')));
    box.append(label);
  }
  return box;
}

const metaLine = (item: CriteriaItem, extra: string[] = []): string =>
  [item.ticket ?? '', item.level && item.level !== 'manual' ? LEVEL_WORD[item.level] : '', ...extra, item.round === null ? '' : `round ${item.round}`].filter(Boolean).join(' · ');

const statusPill = (status: string, word = status): HTMLElement => el('span', `tst-crit-status is-${status}`, word);
const testText = (t: { path: string; name: string | null }): string => `${t.path}${t.name ? `::${t.name}` : ''}`;

// Where a scenario came from, and a bug that has a test reproducing it.
function tags(item: CriteriaItem): HTMLElement[] {
  return [
    ...(item.source ? [el('span', `tst-crit-tag is-source is-${item.source}`, SOURCE_WORD[item.source])] : []),
    ...(item.regression ? [el('span', 'tst-crit-tag is-regression', 'regression')] : []),
  ];
}

function details(item: CriteriaItem, keys: readonly string[]): HTMLElement | null {
  const shown = keys.filter((k) => item.details[k]);
  if (!shown.length) return null;
  const list = el('dl', 'tst-crit-details');
  for (const key of shown) list.append(el('dt', null, key), el('dd', null, item.details[key] as string));
  return list;
}

// run: runs only this scenario's tests; blocked: why it can't, shown as its tooltip.
export interface ScenarioHandlers { run: (name: string) => void; blocked: (item: CriteriaItem) => string | null }

function scenarioList(scenarios: readonly CriteriaItem[], handlers: ScenarioHandlers): HTMLElement {
  const list = el('ul', 'tst-crit-list');
  for (const s of scenarios) {
    const row = el('li', 'tst-crit-item');
    row.dataset.scenario = s.name;
    const tests = s.tests.length ? s.tests.map(testText).join(', ') : 'no test';
    const why = handlers.blocked(s);
    const run = el('button', 'tst-link tst-run-scenario', 'Run');
    run.type = 'button';
    run.disabled = why !== null;
    run.title = why ?? 'Runs only this scenario’s tests';
    run.addEventListener('click', () => handlers.run(s.name));
    row.append(statusPill(s.status), el('span', 'tst-crit-name', s.name), ...tags(s), el('span', 'tst-crit-meta', metaLine(s, [tests])), run);
    list.append(row);
  }
  return list;
}

export interface ManualHandlers { save: (name: string, status: ManualStatus, result: string) => void }

// One manual case: its steps, a Pass / Fail / Blocked choice and her Result note, saved together.
function manualCase(item: CriteriaItem, handlers: ManualHandlers): HTMLElement {
  const row = el('li', 'tst-crit-item tst-manual');
  row.dataset.manual = item.name;
  row.append(statusPill(item.status), el('span', 'tst-crit-name', item.name), el('span', 'tst-crit-meta', metaLine(item)));
  const steps = details(item, ['Prereq', 'Steps', 'Expected']);
  if (steps) row.append(steps);
  const result = el('input', 'tst-input tst-manual-result');
  Object.assign(result, { value: item.details.Result ?? '', placeholder: 'Result note (optional)', spellcheck: true });
  result.setAttribute('aria-label', `Result for ${item.name}`);
  const choices = el('div', 'tst-chip-row');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', `Mark ${item.name}`);
  for (const status of MANUAL_STATUSES.filter((s) => s !== 'todo')) {
    choices.append(chip(MANUAL_WORD[status], item.status === status, () => handlers.save(item.name, status, result.value), `is-${status}`));
  }
  result.addEventListener('keydown', (event) => { if (event.key === 'Enter') handlers.save(item.name, item.status as ManualStatus, result.value); });
  row.append(choices, result);
  return row;
}

function copyButton(text: () => string): HTMLButtonElement {
  const button = el('button', 'tst-link tst-copy-ado', 'Copy for ADO');
  button.type = 'button';
  button.addEventListener('click', async () => {
    const copied = await navigator.clipboard.writeText(text()).then(() => true, () => false);
    button.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy for ADO'; }, COPIED_MS);
  });
  return button;
}

// One bug: its queue state while the loop holds it, else its criteria status; its criteria details and Copy for ADO.
function bugRow(row: BugRow): HTMLElement {
  const { item, queued } = row;
  const li = el('li', 'tst-crit-item tst-bug');
  li.dataset.bug = row.key;
  const pill = queued ? statusPill(queued.state, BUG_STATE_WORDS[queued.state]) : statusPill(item && !isOpenBug(item) ? item.status : 'open');
  const name = `${item?.name ?? queued?.name ?? ''}${queued?.rechecked ? ' · rechecked' : ''}`;
  const test = item?.test ? testText(item.test) : queued?.test ?? '';
  const extra = [test, queued ? when(queued.since) : ''].filter(Boolean);
  li.append(pill, el('span', 'tst-crit-name', name), ...(item ? tags(item) : []), el('span', 'tst-crit-meta', item ? metaLine(item, extra) : extra.join(' · ')));
  if (!item) return li;
  const fields = details(item, ['Steps', 'Expected', 'Actual', 'Env', 'Evidence']);
  if (fields) li.append(fields);
  li.append(copyButton(() => adoBugText(item)));
  return li;
}

// The loop's queue counts, once a loop has started: Open, Fixing, Awaiting verify, Verified (Rechecking when any).
function bugCounts(queue: readonly QueuedBug[]): HTMLElement {
  const counts = queueCounts(queue);
  const line = el('p', 'tst-bug-counts');
  line.append(...BUG_STATES.filter((s) => counts[s] || s !== 'recheck').map((s) => el('span', `tst-bug-count is-${s}`, `${BUG_STATE_WORDS[s]} ${counts[s]}`)));
  return line;
}

// The testing agent's [todo] scenarios waiting on her review; note: its last word on Edit or Looks right.
export interface ScenarioReview { tester: string; scenarios: CriteriaItem[]; note: string }
export interface ReviewHandlers { editScenarios: () => void; approveScenarios: () => void }

// Scenarios first: the rules tests will be written from, for her to read, edit or accept before their tests exist.
function scenarioReview(review: ScenarioReview, handlers: ReviewHandlers): HTMLElement {
  const { tester, scenarios, note } = review;
  const box = el('div', 'tst-scenario-review');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Scenarios to review');
  const many = scenarios.length !== 1;
  box.append(el('p', 'tst-scenario-intro', `${scenarios.length} scenario${many ? 's' : ''} from ${tester} wait${many ? '' : 's'} for your review. ${many ? 'Their' : 'Its'} tests get written once you say so.`));
  const list = el('ul', 'tst-scenario-list');
  for (const item of scenarios) {
    const row = el('li', 'tst-scenario');
    row.append(el('span', 'tst-scenario-name', item.name));
    if (item.source) row.append(el('span', `tst-crit-tag is-source is-${item.source}`, SOURCE_WORD[item.source]));
    list.append(row);
  }
  const actions = el('div', 'tst-actions');
  const edit = el('button', 'tst-button tst-edit-scenarios', 'Edit scenarios');
  edit.type = 'button';
  edit.title = 'Opens the repo’s criteria file in your editor';
  edit.addEventListener('click', () => handlers.editScenarios());
  const approve = el('button', 'tst-button tst-primary tst-approve-scenarios', 'Looks right · write the tests');
  approve.type = 'button';
  approve.title = `Tells ${tester} to write the tests`;
  approve.addEventListener('click', () => handlers.approveScenarios());
  actions.append(edit, approve);
  box.append(list, actions);
  if (note) box.append(el('p', 'tst-muted tst-agent-note', note));
  return box;
}

// criteria: under her filter; allBugs: every bug line, unfiltered; queue: the loop's bug queue, null before a loop starts.
export interface CriteriaModel { criteria: Criteria | null; allBugs: readonly CriteriaItem[]; queue: readonly QueuedBug[] | null; review: ScenarioReview | null; tester: string }

// The repo's criteria: her review of new scenarios, scenarios and the coverage line, the manual checklist, then one bug list.
export function criteriaPanel(model: CriteriaModel, handlers: ManualHandlers & ScenarioHandlers & ReviewHandlers): HTMLElement {
  const { criteria, queue, review } = model;
  const box = el('section', 'tst-criteria-panel');
  box.setAttribute('aria-label', 'Scenarios, manual checks and bugs');
  const reviewing = Boolean(review?.scenarios.length);
  if (review && reviewing) box.append(scenarioReview(review, handlers));
  const bugs = bugRows(criteria?.bugs ?? [], model.allBugs, queue);
  if (!criteria || (!criteria.scenarios.length && !criteria.manual.length && !bugs.length && !queue)) {
    if (!reviewing) box.append(el('p', 'tst-muted', 'No scenarios, manual checks or bugs here yet. Say “testing suite” in any Claude session to add them.'));
    return box;
  }
  const missing = untested(criteria).length;
  const passing = criteria.scenarios.filter((s) => s.status === 'pass').length;
  box.append(el('h3', 'tst-sub', `Scenarios · ${passing}/${criteria.scenarios.length} pass`));
  if (criteria.scenarios.length) box.append(el('p', `tst-coverage${missing ? ' is-gap' : ''}`, missing ? `${plural(missing, 'scenario')} with no test` : 'Every scenario has a test'), scenarioList(criteria.scenarios, handlers));
  if (criteria.manual.length) {
    const done = criteria.manual.filter((m) => m.status === 'pass').length;
    const list = el('ul', 'tst-crit-list');
    list.append(...criteria.manual.map((item) => manualCase(item, handlers)));
    box.append(el('h3', 'tst-sub', `Manual · ${done}/${criteria.manual.length} pass`), list);
  }
  if (bugs.length || queue) {
    const open = criteria.bugs.filter(isOpenBug).length;
    box.append(el('h3', 'tst-sub', `Bugs · ${open} open`));
    if (queue) box.append(bugCounts(queue));
    if (bugs.length) {
      const list = el('ul', 'tst-crit-list tst-bug-list');
      list.append(...bugs.map(bugRow));
      box.append(list);
    } else box.append(el('p', 'tst-muted', `No bugs yet. Bugs ${model.tester} files show here.`));
  }
  const notes = [criteria.malformed ? `${plural(criteria.malformed, 'line')} not in the item format` : '', criteria.truncated ? 'file is long, showing its start' : ''].filter(Boolean);
  if (notes.length) box.append(el('p', 'tst-muted tst-crit-notes', notes.join(' · ')));
  return box;
}
