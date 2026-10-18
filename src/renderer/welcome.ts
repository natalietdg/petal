// First-run screen: what Petal is, the Get started checklist, a cat and a scene, Petal's reply styles (opt-in), the organizer switch.
// Shown once on an older install (config welcome.seen). Esc or Start closes it.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as getStarted from './get-started';
import { portrait } from './cat';
import { byId, el, isIpcError } from './dom';
import type { CustomizeState } from '../shared/ipc';

export const TAGLINE = 'A terminal for Claude Code, with a reader for its replies and a pet who keeps you company.';
const WELCOME_CATS = ['mika', 'miki', 'kira', 'hoshi'];

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

// Opt-in only: nothing is copied until the button is clicked, and the active style never changes here.
function replyStylesOffer(state: CustomizeState): HTMLElement | null {
  if (!state.petalStyles.installable) return null;
  const box = el('div', 'welcome-styles');
  const add = el('button', 'flow-button welcome-styles-add', 'Add Petal’s reply styles');
  add.type = 'button';
  const line = el('p', 'welcome-note', 'Optional. Copies four reply styles (Research Paper, Pyramid, Magazine, Landing Page) into ~/.claude/output-styles. Pick one later under Customize › Formatting.');
  add.addEventListener('click', async () => {
    add.disabled = true;
    const result = await window.pastel.config.addPetalStyles();
    if (isIpcError(result)) {
      line.textContent = `Couldn’t add them: ${result.error}`;
      add.disabled = false;
      return;
    }
    state.petalStyles = result;
    add.remove();
    line.textContent = 'Added. Pick one under Customize › Formatting with Use this style.';
  });
  box.append(add, line);
  return box;
}

function start(): void {
  overlays.hide('welcome');
  if (!tabs.active()) tabs.create();
}

function render(state: CustomizeState): void {
  const pane = el('div', 'welcome-pane');
  const startButton = el('button', 'welcome-start', 'Start');
  startButton.type = 'button';
  startButton.addEventListener('click', start);
  pane.append(
    el('h1', 'welcome-title', 'Welcome to Petal'),
    el('p', 'welcome-tagline', TAGLINE),
    el('p', 'welcome-line', 'Petal is a terminal, and Claude Code runs inside it. It has no login of its own: you sign in to Claude Code.'),
    section('Get started', getStarted.checklist()),
    section('Pick a cat', catPicker(state)),
    section('Pick a scene', scenePicker(state)),
  );
  const styles = replyStylesOffer(state);
  if (styles) pane.append(section('Reply styles', styles));
  // Pinned to the bottom so Start and the switch never need a scroll.
  const footer = el('footer', 'welcome-footer');
  const choices = el('div', 'welcome-footer-text');
  choices.append(el('p', 'welcome-note', 'Esc also closes this.'));
  footer.append(startButton, choices); // Start on the left, clear of the cat in the right corner
  view.replaceChildren(pane, footer);
  startButton.focus({ preventScroll: true }); // Esc and Enter work at once; the title stays in view
  pane.scrollTop = 0;
}

// claudeFound: the snapshot run passes false to draw the not-installed variant.
export async function open({ claudeFound }: { claudeFound?: boolean } = {}): Promise<void> {
  const state = await window.pastel.config.get();
  if (isIpcError(state)) return;
  await getStarted.load();
  if (claudeFound !== undefined) getStarted.setInstalled(claudeFound);
  if (!overlays.show('welcome')) return;
  render(state);
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
