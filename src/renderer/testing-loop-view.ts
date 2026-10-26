// The Testing tab's Loop panel: start a test loop (focus, rounds), its round progress from Claude's Loop lines,
// the criteria file grouped Scenarios / Bugs, and the latest suite results Claude ran. testing.ts owns the state.
import { el } from './dom';
import { loopBarHtml, phaseWord, type LoopPhase, type LoopProgress } from '../shared/loop-line';
import { DEFAULT_ROUNDS, MAX_ROUNDS, FOCUS_CAP, openBugs, type Criteria, type CriteriaItem, type CriteriaStatus, type LoopStatus } from '../shared/test-loop';
import type { StageStatus } from '../shared/testing';
import type { DistillRecord } from '../shared/distillation';
import { distillSection } from './testing-distill-view';

export interface LoopModel {
  status: LoopStatus;
  progress: LoopProgress | null;
  criteria: Criteria | null;
  canStart: boolean;
  why: string; // why Start is off, or where the brief goes
  stages: { name: string; status: StageStatus }[]; // Claude's latest result per stage since the loop started
  stopping: boolean;
  note: string;
  distillation: DistillRecord[]; // this loop's rounds of self-review, oldest first
  distillKey: string; // which loop session they belong to, so the open/closed state follows it
}

export interface LoopHandlers { start: (focus: string, rounds: number) => void; stop: () => void; askThread: (prompt: string) => void }

const STATUS_WORD: Record<LoopStatus, string> = { idle: 'Not started', starting: 'Starting', running: 'Running', done: 'Done', stopped: 'Stopped' };
const STEPS: LoopPhase[] = ['scenarios', 'testing', 'fixing', 'verifying'];
const ITEM_WORD: Record<CriteriaStatus, string> = { pass: 'pass', fail: 'fail', flaky: 'flaky', fixed: 'fixed', todo: 'no test yet', blocked: 'blocked', open: 'open' };
const DOT_OF: Record<CriteriaStatus, string> = { pass: 'passed', fail: 'failed', flaky: 'flaky', fixed: 'fixed', todo: 'waiting', blocked: 'waiting', open: 'failed' };
export const SOURCE_WORD = { prd: 'from the PRD', notes: 'from the task notes' } as const; // a scenario's from: part as its tag reads

export function createLoopPanel(handlers: LoopHandlers): { element: HTMLElement; update: (model: LoopModel) => void; focusInput: HTMLInputElement } {
  const panel = el('section', 'tst-loop');
  panel.setAttribute('aria-label', 'Test loop');

  const top = el('div', 'tst-loop-top');
  const heading = el('h3', 'tst-section-title tst-loop-title', 'Test loop');
  const pill = el('span', 'tst-loop-state');
  const stop = el('button', 'tst-button tst-stop', 'Stop loop');
  stop.type = 'button';
  stop.title = 'Interrupts Claude with Esc, then asks it to stop and summarise';
  stop.addEventListener('click', () => handlers.stop());
  top.append(heading, pill, stop);
  const about = el('p', 'tst-muted tst-loop-about',
    'Claude writes new tests for what you name, runs the repo’s suite, and turns every bug it finds into a test before fixing it. Then it runs again, until everything passes or the rounds run out. It never commits.');

  // Built once, so the 4s refresh never wipes what she is typing.
  const form = el('form', 'tst-loop-start');
  const focusInput = el('input', 'tst-input tst-loop-focus');
  Object.assign(focusInput, { type: 'text', placeholder: 'What to test, e.g. checkout flow (optional)', maxLength: FOCUS_CAP, spellcheck: false });
  focusInput.setAttribute('aria-label', 'What to test');
  const roundsLabel = el('label', 'tst-loop-rounds');
  const roundsInput = el('input', 'tst-input tst-loop-rounds-input');
  Object.assign(roundsInput, { type: 'number', min: '1', max: String(MAX_ROUNDS), value: String(DEFAULT_ROUNDS) });
  roundsLabel.title = 'Most write, test and fix cycles before Claude stops. It stops sooner once everything passes.';
  roundsLabel.append(el('span', null, 'Max rounds'), roundsInput);
  const startButton = el('button', 'tst-button tst-primary tst-loop-go', 'Start test loop');
  startButton.type = 'submit';
  form.append(focusInput, roundsLabel, startButton);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!startButton.disabled) handlers.start(focusInput.value, Number(roundsInput.value));
  });
  const hint = el('p', 'tst-muted tst-loop-hint');
  const note = el('p', 'tst-loop-note');
  note.setAttribute('role', 'status');

  const body = el('div', 'tst-loop-body');
  panel.append(top, about, form, hint, note, body);

  function progressBlock(model: LoopModel): HTMLElement {
    const box = el('div', 'tst-loop-progress');
    const p = model.progress;
    if (!p) {
      box.append(el('p', 'tst-muted', model.status === 'starting' ? 'Brief sent. Waiting for Claude’s first Loop line.' : 'No Loop line from Claude yet.'));
      return box;
    }
    const bar = el('div', 'tst-loop-bar');
    bar.insertAdjacentHTML('beforeend', loopBarHtml(p)); // built from escaped text only
    const facts = el('p', 'tst-loop-facts');
    const open = p.open ?? (model.criteria ? openBugs(model.criteria) : null);
    facts.append(el('strong', null, `Round ${p.round} of ${p.total}`), el('span', null, phaseWord(p.phase)), ...(open === null ? [] : [el('span', `tst-loop-open${open ? ' has-open' : ''}`, `${open} open bug${open === 1 ? '' : 's'}`)]));
    const track = el('ol', 'tst-loop-steps');
    track.setAttribute('aria-label', 'Phases in a round');
    const at = STEPS.indexOf(p.phase);
    STEPS.forEach((step, i) => {
      const done = p.phase === 'done' || (at >= 0 && i < at);
      const item = el('li', `tst-loop-step${i === at ? ' is-current' : ''}${done ? ' is-done' : ''}`, phaseWord(step));
      if (i === at) item.setAttribute('aria-current', 'step');
      track.append(item);
    });
    box.append(bar, facts, track);
    return box;
  }

  function liveBlock(model: LoopModel): HTMLElement | null {
    if (!model.stages.length) return null;
    const row = el('ul', 'tst-loop-live');
    row.setAttribute('aria-label', 'Latest suite results from Claude');
    for (const stage of model.stages) {
      const item = el('li', `tst-loop-live-item is-${stage.status}`);
      const dot = el('span', `tst-dot is-${stage.status}`);
      dot.setAttribute('aria-hidden', 'true');
      item.append(dot, el('span', 'tst-loop-live-name', stage.name), el('span', 'tst-loop-live-word', stage.status === 'waiting' ? 'not run' : stage.status));
      row.append(item);
    }
    return row;
  }

  function itemRow(item: CriteriaItem): HTMLElement {
    const row = el('li', `tst-crit is-${item.status}`);
    const line = el('div', 'tst-crit-line');
    const dot = el('span', `tst-dot is-${DOT_OF[item.status]}`);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', ITEM_WORD[item.status]);
    line.append(dot, el('span', 'tst-crit-name', item.name), el('span', `tst-crit-tag is-${item.status}`, ITEM_WORD[item.status]));
    if (item.regression) line.append(el('span', 'tst-crit-tag is-regression', 'regression'));
    if (item.source) line.append(el('span', `tst-crit-tag is-source is-${item.source}`, SOURCE_WORD[item.source]));
    row.append(line);
    const tests = item.tests.map((t) => `${t.path}${t.name ? ` › ${t.name}` : ''}`);
    const meta = [...tests, item.round === null ? '' : `round ${item.round}`].filter(Boolean).join(' · ');
    if (meta) row.append(el('p', 'tst-crit-meta', meta));
    return row;
  }

  function criteriaBlock(criteria: Criteria | null): HTMLElement {
    const box = el('div', 'tst-criteria');
    if (!criteria || (!criteria.scenarios.length && !criteria.bugs.length)) {
      box.append(el('p', 'tst-muted', 'No scenarios or bugs in the repo’s criteria file yet. Claude adds them as the loop runs.'));
      return box;
    }
    const column = (title: string, items: CriteriaItem[], tally: string, empty: string) => {
      const col = el('section', 'tst-crit-col');
      col.setAttribute('aria-label', title);
      const head = el('h4', 'tst-sub tst-crit-head');
      head.append(el('span', null, title), el('span', 'tst-crit-count', tally));
      col.append(head);
      if (!items.length) { col.append(el('p', 'tst-muted', empty)); return col; }
      const list = el('ul', 'tst-crit-list');
      for (const item of items) list.append(itemRow(item));
      col.append(list);
      return col;
    };
    const open = openBugs(criteria);
    const fixed = criteria.bugs.filter((b) => b.status === 'fixed').length;
    const passing = criteria.scenarios.filter((s) => s.status === 'pass').length;
    box.append(
      column('Scenarios', criteria.scenarios, `${passing}/${criteria.scenarios.length} pass`, 'None yet.'),
      column('Bugs', criteria.bugs, `${open} open · ${fixed} fixed`, 'No bugs found so far.'),
    );
    const notes = [criteria.malformed ? `${criteria.malformed} line${criteria.malformed === 1 ? '' : 's'} not in the item format` : '', criteria.truncated ? 'file is long, showing its start' : ''].filter(Boolean);
    if (notes.length) box.append(el('p', 'tst-muted tst-crit-notes', `${notes.join(' · ')}.`));
    return box;
  }

  function update(model: LoopModel): void {
    const active = model.status === 'starting' || model.status === 'running';
    panel.classList.toggle('is-active', active);
    pill.className = `tst-loop-state is-${model.status}`;
    pill.textContent = model.stopping ? 'Stopping' : STATUS_WORD[model.status];
    pill.hidden = model.status === 'idle';
    stop.hidden = !active;
    stop.disabled = model.stopping;
    form.hidden = active;
    startButton.disabled = !model.canStart;
    hint.textContent = model.why;
    hint.hidden = active || !model.why;
    about.hidden = active; // explained before a loop starts, out of the way while one runs
    note.textContent = model.note;
    note.hidden = !model.note;
    const showBody = model.status !== 'idle' || model.distillation.length > 0 || Boolean(model.criteria && (model.criteria.scenarios.length || model.criteria.bugs.length));
    body.hidden = !showBody;
    if (!showBody) { body.replaceChildren(); return; }
    const live = liveBlock(model);
    const distill = distillSection(model.distillation, `loop:${model.distillKey}`, handlers.askThread);
    body.replaceChildren(...(model.status === 'idle' ? [] : [progressBlock(model)]), ...(live ? [live] : []), ...(distill ? [distill] : []), criteriaBlock(model.criteria));
  }

  return { element: panel, update, focusInput };
}
