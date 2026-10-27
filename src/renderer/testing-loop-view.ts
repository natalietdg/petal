// The Testing tab's Loop panel: start a test loop (focus, rounds) and its round progress from Claude's Loop lines.
// Scenarios, bugs and suite results show once each, in their own sections. testing.ts owns the state.
import { el } from './dom';
import { loopBarHtml, phaseWord, type LoopPhase, type LoopProgress } from '../shared/loop-line';
import { DEFAULT_ROUNDS, MAX_ROUNDS, FOCUS_CAP, type LoopStatus } from '../shared/test-loop';

export interface LoopModel {
  status: LoopStatus;
  progress: LoopProgress | null;
  openBugs: number | null; // from the criteria file, when Claude's Loop line has no count
  canStart: boolean;
  why: string; // why Start is off, or where the brief goes
  stopping: boolean;
  note: string;
}

export interface LoopHandlers { start: (focus: string, rounds: number) => void; stop: () => void }

const STATUS_WORD: Record<LoopStatus, string> = { idle: 'Not started', starting: 'Starting', running: 'Running', done: 'Done', stopped: 'Stopped' };
const STEPS: LoopPhase[] = ['scenarios', 'testing', 'fixing', 'verifying'];

export function createLoopPanel(handlers: LoopHandlers): { element: HTMLElement; update: (model: LoopModel) => void } {
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
    const open = p.open ?? model.openBugs;
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
    body.hidden = model.status === 'idle';
    body.replaceChildren(...(body.hidden ? [] : [progressBlock(model)]));
  }

  return { element: panel, update };
}
