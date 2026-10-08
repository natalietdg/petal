// First-run screen: what Petal is, whether Claude Code is installed, a cat and a scene, the organizer switch.
// Shown once on a new install (config welcome.seen); Help › Welcome reopens it. Esc or Start closes it.
import * as overlays from './overlays';
import * as tabs from './tabs';
import { portrait } from './cat';
import { byId, el, isIpcError } from './dom';
import type { CustomizeState } from '../shared/ipc';

export const TAGLINE = 'A terminal for Claude Code, with a reader for its replies and a cat who keeps you company.';
// From code.claude.com/docs/en/setup (native install, macOS and Linux).
export const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';
const SETUP_DOCS = 'https://code.claude.com/docs/en/setup';
const WELCOME_CATS = ['mika', 'miki', 'kira'];

const view = byId('welcome');

function chip(label: string, selected: boolean, onPick: () => void, className = 'cz-chip'): HTMLButtonElement {
  const button = el('button', className, label);
  button.type = 'button';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', String(selected));
  button.addEventListener('click', () => {
    for (const sibling of button.parentElement?.children ?? []) sibling.setAttribute('aria-checked', String(sibling === button));
    onPick();
  });
  return button;
}

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const box = el('section', 'welcome-section');
  box.append(el('h2', 'welcome-label', title), ...children);
  return box;
}

// Found: one quiet line. Missing: the official install command and a re-check.
function claudeCheck(found: boolean, recheck: () => void): HTMLElement {
  const box = el('div', `welcome-claude ${found ? 'found' : 'missing'}`);
  if (found) {
    box.append(el('p', 'welcome-ok', 'Claude Code is installed. Type claude in the terminal below to start.'));
    return box;
  }
  const code = el('pre', 'welcome-command');
  code.append(el('code', null, INSTALL_COMMAND));
  const again = el('button', 'flow-button welcome-recheck', 'Check again');
  again.type = 'button';
  again.addEventListener('click', recheck);
  const guide = el('a', 'wf-doc-link', 'Install guide');
  guide.href = SETUP_DOCS;
  guide.addEventListener('click', (event) => { event.preventDefault(); window.pastel.openLink(SETUP_DOCS); });
  const actions = el('div', 'welcome-actions');
  actions.append(again, guide);
  box.append(el('p', 'welcome-missing', 'Claude Code isn’t installed yet. Paste this into the terminal below, then check again:'), code, actions);
  return box;
}

function catPicker(state: CustomizeState): HTMLElement {
  const group = el('div', 'welcome-cats');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Cat');
  const names = new Map(state.choices.cats);
  for (const id of WELCOME_CATS) {
    const button = chip('', state.look.cat === id, () => { state.look.cat = id; window.pastel.look.setCat(id); }, 'welcome-cat');
    const picture = el('span', 'cat-portrait');
    picture.dataset.cat = id;
    picture.innerHTML = portrait(id); // built from Petal's own pixel data, no outside text
    button.append(picture, el('span', 'welcome-cat-name', names.get(id) ?? id));
    group.append(button);
  }
  return group;
}

function scenePicker(state: CustomizeState): HTMLElement {
  const group = el('div', 'cz-chips');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Scene');
  for (const [id, name] of state.choices.scenes) group.append(chip(name, state.look.scene === id, () => { state.look.scene = id; window.pastel.look.setScene(id); }));
  return group;
}

function organizerSwitch(state: CustomizeState): HTMLElement {
  const label = el('label', 'welcome-switch');
  const box = el('input');
  Object.assign(box, { type: 'checkbox', checked: state.config.organizer.enabled });
  box.addEventListener('change', () => window.pastel.config.save({ organizer: { enabled: box.checked } }));
  label.append(box, el('span', null, 'Name and tidy sessions with Claude · uses your Claude plan'));
  return label;
}

function start(): void {
  overlays.hide('welcome');
  if (!tabs.active()) tabs.create();
}

function render(state: CustomizeState, claudeFound: boolean): void {
  const pane = el('div', 'welcome-pane');
  const startButton = el('button', 'welcome-start', 'Start');
  startButton.type = 'button';
  startButton.addEventListener('click', start);
  const claudeBox = claudeCheck(claudeFound, async () => {
    const found = await window.pastel.claudeInstalled(true);
    render(state, found === true);
  });
  pane.append(
    el('h1', 'welcome-title', 'Welcome to Petal'),
    el('p', 'welcome-tagline', TAGLINE),
    el('p', 'welcome-line', 'Petal is a terminal, and Claude Code runs inside it.'),
    claudeBox,
    section('Pick a cat', catPicker(state)),
    section('Pick a scene', scenePicker(state)),
  );
  // Pinned to the bottom so Start and the switch never need a scroll.
  const footer = el('footer', 'welcome-footer');
  const choices = el('div', 'welcome-footer-text');
  choices.append(organizerSwitch(state), el('p', 'welcome-note', 'Optional, off unless you turn it on. Esc also closes this; Help › Welcome brings it back.'));
  footer.append(startButton, choices); // Start on the left, clear of the cat in the right corner
  view.replaceChildren(pane, footer);
  startButton.focus({ preventScroll: true }); // Esc and Enter work at once; the title stays in view
  pane.scrollTop = 0;
}

// claudeFound: the snapshot run passes false to draw the not-installed variant.
export async function open({ claudeFound }: { claudeFound?: boolean } = {}): Promise<void> {
  const state = await window.pastel.config.get();
  if (isIpcError(state)) return;
  const installed = claudeFound ?? (await window.pastel.claudeInstalled()) === true;
  overlays.show('welcome');
  render(state, installed);
  if (!state.config.welcome.seen) await window.pastel.config.save({ welcome: { seen: true } }); // shown once is enough
}

// On launch: only for a new install.
export async function openIfFirstRun(): Promise<boolean> {
  const state = await window.pastel.config.get();
  if (isIpcError(state) || state.config.welcome.seen) return false;
  await open();
  return true;
}

export const isOpen = (): boolean => overlays.isOpen('welcome');
export const close = (): void => overlays.hide('welcome');

window.pastel.onOpenWelcome(() => open());
