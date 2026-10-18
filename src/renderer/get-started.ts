// Get started: install to first reply as Steps rows that tick themselves from what Petal sees, or by her hand.
// In the welcome, and on launch for installs from before the pet guide until every step is done; Customize › Get started reopens it.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as reader from './reader';
import * as layout from './layout';
import { byId, el, isIpcError } from './dom';
import { INSTALL_COMMAND, allDone, factsFrom, needsReopen, needsSetupRoom, sameSteps, stepStates, toggle, toSave, type LiveFacts, type StepId, type StepState } from '../shared/get-started';

export { INSTALL_COMMAND };
export const SETUP_DOCS = 'https://code.claude.com/docs/en/setup';
const COPIED_MS = 1400;
export const UNSEEN_NOTE = 'Petal can’t see this while your Claude folder is off.';

const view = byId('get-started');
let saved: string[] = [];
let installed = false;
let pastSessions = false; // a conversation in History: an experienced user, all set from the first check
let folderOff = false; // reading the Claude folder is off: sign-in and ask can only be ticked by hand
let loaded = false;
let showSteps = false; // all set: the steps fold away until she asks to see them
const lists = new Set<HTMLElement>(); // every checklist on screen: the overlay's and the welcome's

function facts(): LiveFacts {
  const open = tabs.ids().flatMap((id) => {
    const update = tabs.get(id)?.update;
    return [{ state: update?.state ?? 'none', sessionId: update?.sessionId ?? null, replies: update?.replies.length ?? 0 }];
  });
  return factsFrom(open, installed, pastSessions, folderOff);
}

const states = (): StepState[] => stepStates(saved, facts());
export const currentFacts = facts; // for the snapshot run

function copyButton(text: string): HTMLButtonElement {
  const button = el('button', 'flow-button gs-copy', 'Copy');
  button.type = 'button';
  button.dataset.copy = text;
  button.addEventListener('click', async () => {
    const copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    button.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, COPIED_MS);
  });
  return button;
}

function link(label: string, href: string): HTMLAnchorElement {
  const a = el('a', 'wf-doc-link', label);
  a.href = href;
  a.addEventListener('click', (event) => { event.preventDefault(); window.pastel.openLink(href); });
  return a;
}

const para = (text: string, className: string | null = null): HTMLParagraphElement => el('p', className, text);

// The welcome's snapshot variant draws Claude Code as missing.
export function setInstalled(found: boolean): void {
  installed = found;
  refresh();
}

// Recheck after installing: the reader and step 1 both follow.
export async function recheckInstall(): Promise<boolean> {
  installed = (await window.pastel.claudeInstalled(true)) === true;
  reader.setClaudeMissing(!installed);
  refresh();
  return installed;
}

function installBody(done: boolean): Node[] {
  if (done) return [para('Claude Code is installed on this Mac.')];
  const command = el('div', 'gs-command');
  command.append(el('code', null, INSTALL_COMMAND), copyButton(INSTALL_COMMAND));
  const again = el('button', 'flow-button gs-recheck', 'Check again');
  again.type = 'button';
  again.addEventListener('click', () => void recheckInstall());
  const actions = el('div', 'gs-actions');
  actions.append(again, link('Install guide', SETUP_DOCS));
  return [para('Paste this into the terminal below and press Enter. It needs a Claude Pro, Max, Team, Enterprise or Console account.'), command, actions];
}

interface StepCopy {
  title: string;
  body: (done: boolean) => Node[];
}

const STEPS: Record<StepId, StepCopy> = {
  install: { title: 'Install Claude Code', body: installBody },
  'add-session': {
    title: 'Click Add Session',
    body: () => [para('Claude starts in the new tab by itself.')],
  },
  'sign-in': {
    title: 'First time only: sign in',
    body: () => [
      para('Claude Code asks how you want to sign in. Pick one and your browser opens; sign in there with your Claude account.'),
      para('Petal never sees your login. Claude Code and your browser handle it.', 'gs-private'),
    ],
  },
  ask: {
    title: 'Ask Claude something',
    body: () => [para('Type a question in the tab and press Enter.')],
  },
};

function onBadge(id: StepId): void {
  const next = toggle(saved, id, facts());
  if (sameSteps(next, saved)) return; // Petal saw it happen, so it stays ticked
  saved = next;
  void window.pastel.config.save({ getStarted: { done: next } });
  repaint(states());
}

function stepRow(step: StepState, number: number): HTMLLIElement {
  const copy = STEPS[step.id];
  const row = el('li', `step gs-step${step.done ? ' done' : ''}`);
  row.dataset.step = step.id;
  const badge = el('button', 'step-badge', step.done ? '✓' : String(number));
  badge.type = 'button';
  badge.setAttribute('aria-pressed', String(step.done));
  badge.setAttribute('aria-label', `Step ${number} done`);
  if (step.auto) badge.title = 'Petal saw this happen';
  badge.addEventListener('click', () => onBadge(step.id));
  const body = el('div', 'step-body');
  body.append(el('p', 'gs-title', copy.title), ...copy.body(step.done));
  if (step.unseen) body.append(para(UNSEEN_NOTE, 'gs-unseen'));
  row.append(badge, body);
  return row;
}

// The steps, or the all-set line with a way back to them.
function paintList(box: HTMLElement, all: StepState[]): void {
  const finished = allDone(all);
  box.classList.toggle('all-set', finished);
  const parts: HTMLElement[] = [];
  if (finished) {
    const line = el('div', 'gs-done-line');
    const toggleSteps = el('button', 'flow-button gs-show-steps', showSteps ? 'Hide the steps' : 'Show the steps');
    toggleSteps.type = 'button';
    toggleSteps.addEventListener('click', () => { showSteps = !showSteps; repaint(states()); });
    line.append(el('p', 'gs-all-set', 'You’re all set. Claude Code is running and its replies show in the reader.'), toggleSteps);
    parts.push(line);
  }
  if (!finished || showSteps) {
    const list = el('ol', 'steps gs-steps');
    list.append(...all.map((step, i) => stepRow(step, i + 1)));
    parts.push(list);
  }
  box.replaceChildren(...parts);
}

function repaint(all: StepState[]): void {
  for (const box of lists) {
    if (box.isConnected) paintList(box, all);
    else lists.delete(box);
  }
}

// A checklist to place anywhere (the welcome uses one); it repaints with every change.
export function checklist(): HTMLElement {
  const box = el('div', 'prose gs-list');
  lists.add(box);
  paintList(box, states());
  return box;
}

// Live state changed (a tab, a reply, the install check): tick what Petal saw and keep it for next launch.
export function refresh(): void {
  if (!loaded) return;
  const all = states();
  const setup = needsSetupRoom(all) && facts().claudeRunning; // only Claude's own first-run screens need the room
  layout.makeRoomForClaudeSetup(setup);
  reader.setClaudeSetup(setup);
  if (setup && layout.isTerminalMinimised()) layout.setTerminalMinimised(false, false); // its first-run screens are there
  const next = toSave(all, saved);
  if (!sameSteps(next, saved)) {
    saved = next;
    void window.pastel.config.save({ getStarted: { done: next } });
  }
  repaint(all);
}

export const isComplete = (): boolean => loaded && allDone(states());
export const reopensOnLaunch = (): boolean => loaded && needsReopen(states()); // for the snapshot run

// Any past conversation in History; empty while reading her Claude folder is off.
async function hasPastSessions(): Promise<boolean> {
  const list = await window.pastel.history.list();
  return !isIpcError(list) && list.sessions.some((s) => s.messages > 0);
}

// Everything the steps tick from, read before anything is drawn, so a finished checklist never flashes open.
export async function load(): Promise<void> {
  const state = await window.pastel.config.get();
  saved = isIpcError(state) ? [] : [...state.config.getStarted.done];
  folderOff = isIpcError(state) || state.config.claudeFolder.choice !== 'allowed';
  installed = (await window.pastel.claudeInstalled()) === true;
  pastSessions = await hasPastSessions();
  loaded = true;
  refresh();
}

function render(): void {
  const pane = el('div', 'welcome-pane gs-pane');
  pane.append(
    el('h1', 'welcome-title', 'Get started'),
    para('Four steps to your first reply.', 'welcome-line'),
    checklist(),
  );
  const footer = el('footer', 'welcome-footer');
  const done = el('button', 'cz-quiet-button gs-close', 'Close');
  done.type = 'button';
  done.addEventListener('click', close);
  footer.append(done, para('Customize › Get started brings this back.', 'welcome-note'));
  view.replaceChildren(pane, footer);
  done.focus({ preventScroll: true });
}

export async function open(): Promise<void> {
  if (!loaded) await load();
  showSteps = false;
  if (!overlays.show('get-started')) return;
  render();
}

// On launch, after the welcome and the folder question: only while a step Petal can tick is still open.
// Reloads, since Allow may have just made History readable.
export async function openIfIncomplete(): Promise<boolean> {
  await load();
  if (!needsReopen(states())) return false;
  await open();
  return true;
}

export const isOpen = (): boolean => overlays.isOpen('get-started');
export function close(): void { overlays.hide('get-started'); }

window.pastel.onOpenGetStarted(() => open());
