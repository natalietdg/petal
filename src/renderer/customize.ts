// Customize: every setting in one place. Replaces the reader while open; Esc or Cmd+, goes back.
// Each section renders from its own file; this is the overlay shell that loads settings and switches sections.
import * as overlays from './overlays';
import { byId, el, isIpcError } from './dom';
import { body, errorLine, page, summary, tabsBar } from './customize-kit';
import { renderFormatting, renderLook } from './customize-look';
import { renderFlowTitles, renderHandoff, renderOrganizer } from './customize-prompts';
import { renderHook } from './customize-hook';
import { renderSessions } from './customize-sessions';

type SectionId = 'look' | 'formatting' | 'sessions' | 'organizer' | 'flowTitles' | 'handoff' | 'hook';

const button = byId('customize-button');

const SECTIONS: { id: SectionId; name: string; summary: string }[] = [
  { id: 'look', name: 'Look', summary: 'Theme, reading style, pet and scene. Changes apply at once and tick the same menu items.' },
  { id: 'formatting', name: 'Formatting', summary: 'How each markdown shape in a reply is drawn in each reading style.' },
  { id: 'sessions', name: 'Sessions', summary: 'How many Claude sessions can be open before the Sessions panel suggests closing one.' },
  { id: 'organizer', name: 'Organizer', summary: 'The background agent that titles, files and tags your recent sessions for History.' },
  { id: 'flowTitles', name: 'Flow titles', summary: 'The prompt that turns each step of a session into the state changes on the Flow view.' },
  { id: 'handoff', name: 'Handoff', summary: 'What Send to Claude writes when one session hands its history to another.' },
  { id: 'hook', name: 'Response hook', summary: 'A shell command of yours that runs each time Claude finishes a reply.' },
];

for (const s of SECTIONS) {
  const b = el('button', null, s.name);
  b.type = 'button';
  b.dataset.section = s.id;
  b.setAttribute('role', 'tab');
  tabsBar.append(b);
}

let section: SectionId = 'look';

const RENDER: Record<SectionId, () => HTMLElement[]> = { look: renderLook, formatting: renderFormatting, sessions: renderSessions, organizer: renderOrganizer, flowTitles: renderFlowTitles, handoff: renderHandoff, hook: renderHook };

export async function show(id: SectionId = section): Promise<void> {
  section = id;
  for (const b of tabsBar.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-selected', String(b.dataset.section === id));
  summary.textContent = SECTIONS.find((s) => s.id === id)?.summary ?? '';
  errorLine.hidden = true;
  try {
    const result = await window.pastel.config.get();
    if (isIpcError(result)) throw new Error(result.error);
    page.state = result;
    body.replaceChildren(...RENDER[id]());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    body.replaceChildren(el('p', 'wf-error', `Couldn’t load settings: ${message}`));
  }
}

export async function open(id?: SectionId): Promise<void> {
  overlays.show('customize');
  await show(id ?? section);
  tabsBar.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
}

export const close = (): void => overlays.hide('customize');
export const isOpen = (): boolean => overlays.isOpen('customize');
export const toggle = (): Promise<void> | void => (isOpen() ? close() : open());

button.addEventListener('click', () => toggle());
window.pastel.onOpenCustomize(() => (isOpen() ? close() : open()));
const isSectionId = (value: string | undefined): value is SectionId => SECTIONS.some((s) => s.id === value);
tabsBar.addEventListener('click', (event) => {
  const id = (event.target as HTMLElement).dataset.section;
  if (isSectionId(id)) show(id);
});
// A menu change while Look or Formatting is open redraws the ticks and the preview.
const redraw = () => { if (isOpen() && (section === 'look' || section === 'formatting')) show(); };
for (const subscribe of ['onTheme', 'onReading', 'onCat', 'onScene'] as const) window.pastel[subscribe](redraw);

