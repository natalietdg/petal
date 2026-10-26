// The repo suite's filters and criteria: level and ticket chips, opt-in stages with their notes, scenarios with the
// coverage line, the manual checklist she ticks, and bugs in Azure DevOps' shape with a copy button.
import { el } from './dom';
import { LEVELS, type Level, type SuiteStage } from '../shared/repo-suite';
import { MANUAL_STATUSES, adoBugText, isOpenBug, untested, type Criteria, type CriteriaItem, type ManualStatus } from '../shared/test-loop';

const COPIED_MS = 1500;
const LEVEL_WORD: Record<Level, string> = { smoke: 'Smoke', regression: 'Regression', staging: 'Staging' };
const MANUAL_WORD: Record<ManualStatus, string> = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked', todo: 'Not run' };
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
  [item.ticket ?? '', item.level && item.level !== 'manual' ? LEVEL_WORD[item.level] : '', ...extra].filter(Boolean).join(' · ');

const statusPill = (status: string): HTMLElement => el('span', `tst-crit-status is-${status}`, status);

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
    const tests = s.tests.length ? plural(s.tests.length, 'test') : 'no test';
    const why = handlers.blocked(s);
    const run = el('button', 'tst-link tst-run-scenario', 'Run');
    run.type = 'button';
    run.disabled = why !== null;
    run.title = why ?? 'Runs only this scenario’s tests';
    run.addEventListener('click', () => handlers.run(s.name));
    row.append(statusPill(s.status), el('span', 'tst-crit-name', s.name), el('span', 'tst-crit-meta', metaLine(s, [tests])), run);
    list.append(row);
  }
  return list;
}

export interface ManualHandlers { save: (name: string, status: ManualStatus, result: string) => void }

// One manual case: its steps, a Pass / Fail / Blocked choice and her Result note, saved together.
function manualCase(item: CriteriaItem, handlers: ManualHandlers, busy: boolean): HTMLElement {
  const row = el('li', 'tst-crit-item tst-manual');
  row.dataset.manual = item.name;
  row.append(statusPill(item.status), el('span', 'tst-crit-name', item.name), el('span', 'tst-crit-meta', metaLine(item)));
  const steps = details(item, ['Prereq', 'Steps', 'Expected']);
  if (steps) row.append(steps);
  const result = el('input', 'tst-input tst-manual-result');
  Object.assign(result, { value: item.details.Result ?? '', placeholder: 'Result note (optional)', spellcheck: true, disabled: busy });
  result.setAttribute('aria-label', `Result for ${item.name}`);
  const choices = el('div', 'tst-chip-row');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', `Mark ${item.name}`);
  for (const status of MANUAL_STATUSES.filter((s) => s !== 'todo')) {
    const button = chip(MANUAL_WORD[status], item.status === status, () => handlers.save(item.name, status, result.value), `is-${status}`);
    button.disabled = busy;
    choices.append(button);
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

function bugList(bugs: readonly CriteriaItem[]): HTMLElement {
  const list = el('ul', 'tst-crit-list');
  for (const bug of bugs) {
    const row = el('li', 'tst-crit-item tst-bug');
    const test = bug.test ? `${bug.test.path}${bug.test.name ? `::${bug.test.name}` : ''}` : '';
    row.append(statusPill(isOpenBug(bug) ? 'open' : bug.status), el('span', 'tst-crit-name', bug.name), el('span', 'tst-crit-meta', metaLine(bug, test ? [test] : [])));
    const fields = details(bug, ['Steps', 'Expected', 'Actual', 'Env', 'Evidence']);
    if (fields) row.append(fields);
    row.append(copyButton(() => adoBugText(bug)));
    list.append(row);
  }
  return list;
}

// The repo's criteria under her filter: scenarios and the coverage line, the manual checklist, then bugs.
export function criteriaPanel(criteria: Criteria | null, handlers: ManualHandlers & ScenarioHandlers, busy: boolean): HTMLElement {
  const box = el('section', 'tst-criteria-panel');
  box.setAttribute('aria-label', 'Scenarios, manual checks and bugs');
  if (!criteria || (!criteria.scenarios.length && !criteria.manual.length && !criteria.bugs.length)) {
    box.append(el('p', 'tst-muted', 'No scenarios, manual checks or bugs here yet. Say “testing suite” in any Claude session to add them.'));
    return box;
  }
  const missing = untested(criteria).length;
  const passing = criteria.scenarios.filter((s) => s.status === 'pass').length;
  box.append(el('h3', 'tst-sub', `Scenarios · ${passing}/${criteria.scenarios.length} pass`));
  if (criteria.scenarios.length) box.append(el('p', `tst-coverage${missing ? ' is-gap' : ''}`, missing ? `${plural(missing, 'scenario')} with no test` : 'Every scenario has a test'), scenarioList(criteria.scenarios, handlers));
  if (criteria.manual.length) {
    const done = criteria.manual.filter((m) => m.status === 'pass').length;
    const list = el('ul', 'tst-crit-list');
    list.append(...criteria.manual.map((item) => manualCase(item, handlers, busy)));
    box.append(el('h3', 'tst-sub', `Manual · ${done}/${criteria.manual.length} pass`), list);
  }
  if (criteria.bugs.length) {
    const open = criteria.bugs.filter(isOpenBug).length;
    box.append(el('h3', 'tst-sub', `Bugs · ${open} open`), bugList(criteria.bugs));
  }
  const notes = [criteria.malformed ? `${plural(criteria.malformed, 'line')} not in the item format` : '', criteria.truncated ? 'file is long, showing its start' : ''].filter(Boolean);
  if (notes.length) box.append(el('p', 'tst-muted', notes.join(' · ')));
  return box;
}
