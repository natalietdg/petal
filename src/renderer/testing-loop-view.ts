// The Testing tab's Loop panel: start a test loop (focus, rounds), its round progress from Claude's Loop lines,
// the criteria file grouped Scenarios / Bugs, and the latest pipeline results Claude ran. testing.ts owns the state.
import { el } from './dom';
import { loopBarHtml, phaseWord, type LoopPhase, type LoopProgress } from '../shared/loop-line';
import { DEFAULT_ROUNDS, MAX_ROUNDS, FOCUS_CAP, openBugs, type Criteria, type CriteriaItem, type CriteriaStatus, type LoopStatus } from '../shared/test-loop';
import type { StageStatus } from '../shared/testing';

export interface LoopModel {
  status: LoopStatus;
  progress: LoopProgress | null;
  criteria: Criteria | null;
  canStart: boolean;
  why: string; // why Start is off, or where the brief goes
  stages: { name: string; status: StageStatus }[]; // Claude's latest result per stage since the loop started
  stopping: boolean;
  note: string;
}

export interface LoopHandlers { start: (focus: string, rounds: number) => void; stop: () => void }

const STATUS_WORD: Record<LoopStatus, string> = { idle: 'Not started', starting: 'Starting', running: 'Running', done: 'Done', stopped: 'Stopped' };
const STEPS: LoopPhase[] = ['scenarios', 'testing', 'fixing', 'verifying'];
const ITEM_WORD: Record<CriteriaStatus, string> = { pass: 'pass', fail: 'fail', flaky: 'flaky', fixed: 'fixed' };
const DOT_OF: Record<CriteriaStatus, string> = { pass: 'passed', fail: 'failed', flaky: 'flaky', fixed: 'fixed' };

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

  // Built once, so the 4s refresh never wipes what she is typing.
  const form = el('form', 'tst-loop-start');
  const focusInput = el('input', 'tst-input tst-loop-focus');
  Object.assign(focusInput, { type: 'text', placeholder: 'What to test, e.g. checkout flow (optional)', maxLength: FOCUS_CAP, spellcheck: false });
  focusInput.setAttribute('aria-label', 'What to test');
  const roundsLabel = el('label', 'tst-loop-rounds');
  const roundsInput = el('input', 'tst-input tst-loop-rounds-input');
  Object.assign(roundsInput, { type: 'number', min: '1', max: String(MAX_ROUNDS), value: String(DEFAULT_ROUNDS) });
  roundsLabel.append(el('span', null, 'Rounds'), roundsInput);
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
  panel.append(top, form, hint, note, body);

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
    row.setAttribute('aria-label', 'Latest pipeline results from Claude');
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
    row.append(line);
    const meta = [item.test ? `${item.test.path}${item.test.name ? ` › ${item.test.name}` : ''}` : '', item.round === null ? '' : `round ${item.round}`].filter(Boolean).join(' · ');
    if (meta) row.append(el('p', 'tst-crit-meta', meta));
    return row;
  }

  function criteriaBlock(criteria: Criteria | null): HTMLElement {
    const box = el('div', 'tst-criteria');
    if (!criteria || (!criteria.scenarios.length && !criteria.bugs.length)) {
      box.append(el('p', 'tst-muted', 'No scenarios or bugs in .petal/test-criteria.md yet. Claude adds them as the loop runs.'));
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
    note.textContent = model.note;
    note.hidden = !model.note;
    const showBody = model.status !== 'idle' || Boolean(model.criteria && (model.criteria.scenarios.length || model.criteria.bugs.length));
    body.hidden = !showBody;
    if (!showBody) { body.replaceChildren(); return; }
    const live = liveBlock(model);
    body.replaceChildren(...(model.status === 'idle' ? [] : [progressBlock(model)]), ...(live ? [live] : []), criteriaBlock(model.criteria));
  }

  return { element: panel, update, focusInput };
}
