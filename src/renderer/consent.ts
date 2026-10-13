// First launch, before Petal reads anything under ~/.claude: may it? Allow or Not now; Esc counts as Not now.
// Customize › Get started changes the answer later; the reader offers Allow while it's off.
import * as overlays from './overlays';
import { byId, el, isIpcError } from './dom';
import type { FolderChoice } from '../shared/claude-folder';

const view = byId('consent');
let answered: (() => void) | null = null; // the launch screens waiting behind this one

export const READS = [
  'Session logs, for the reader, History, Agents and conclusions.',
  'Settings and output styles, for Customize.',
];

export async function choice(): Promise<FolderChoice> {
  const state = await window.pastel.config.get();
  return isIpcError(state) ? 'unasked' : state.config.claudeFolder.choice;
}

// Saved in Petal's config; main tells every window, and the readers follow on their next tick.
export async function setChoice(next: FolderChoice): Promise<void> {
  await window.pastel.config.save({ claudeFolder: { choice: next } });
}

async function answer(next: FolderChoice): Promise<void> {
  await setChoice(next);
  overlays.unlock('consent');
  overlays.hide('consent');
  const then = answered;
  answered = null;
  then?.();
}

function render(): void {
  const pane = el('div', 'welcome-pane consent-pane');
  const list = el('ul', 'consent-reads');
  list.append(...READS.map((line) => el('li', null, line)));
  pane.append(
    el('h1', 'welcome-title', 'Read your Claude folder?'),
    el('p', 'welcome-tagline', 'Petal shows Claude’s replies by reading what Claude Code saves in ~/.claude on this Mac.'),
    el('h2', 'welcome-label', 'What Petal reads'),
    list,
    el('p', 'consent-line', 'Everything stays on this Mac. Nothing is uploaded.'),
    el('p', 'consent-line', 'Petal writes nothing there unless you ask it to: switching your output style, or adding Petal’s reply styles.'),
    el('p', 'welcome-note', 'Not now keeps the terminal working as usual; the reader stays empty. You can change this in Customize › Get started.'),
  );
  const footer = el('footer', 'welcome-footer');
  const allow = el('button', 'welcome-start consent-allow', 'Allow');
  allow.type = 'button';
  allow.addEventListener('click', () => void answer('allowed'));
  const later = el('button', 'flow-button consent-later', 'Not now');
  later.type = 'button';
  later.addEventListener('click', () => void answer('declined'));
  footer.append(allow, later);
  view.replaceChildren(pane, footer);
  view.focus({ preventScroll: true }); // not Allow: a stray Enter while the window takes focus mustn't answer for her
}

// Shows the question; then() runs once she answers. Nothing else replaces it until she does.
export function open(then: (() => void) | null = null): void {
  answered = then;
  overlays.showLocked('consent');
  render();
}

// Esc anywhere in it answers Not now, so the launch screens behind it still follow.
export const decline = (): Promise<void> => answer('declined');
view.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void decline();
}, true);

export const isOpen = (): boolean => overlays.isOpen('consent');
