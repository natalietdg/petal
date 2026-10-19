// Customize: every setting and the Workflow tabs in one place. Replaces the reader while open; Esc or Cmd+, goes back.
// Each section renders from its own file; this is the overlay shell that loads settings and switches sections.
import * as overlays from './overlays';
import * as workflow from './workflow';
import { byId, el, isIpcError } from './dom';
import { body, errorLine, page, summary, tabsBar } from './customize-kit';
import { renderFormatting, renderLook } from './customize-look';
import { renderFlowTitles, renderHandoff, renderOrganizer } from './customize-prompts';
import { renderHook } from './customize-hook';
import { renderSessions } from './customize-sessions';
import { renderStart } from './customize-start';

type SettingsId = 'look' | 'formatting' | 'sessions' | 'organizer' | 'prompts' | 'hook' | 'start';
type SectionId = SettingsId | workflow.TabId;

const button = byId('customize-button');

// Workflow tabs carry their own one-line summary, so theirs is empty and the line hides.
const workflowSection = (id: workflow.TabId): { id: SectionId; name: string; summary: string } => ({ id, name: workflow.TABS.find((t) => t.id === id)?.name ?? id, summary: '' });
const SECTIONS: { id: SectionId; name: string; summary: string }[] = [
  { id: 'look', name: 'Look', summary: 'Theme, reading style, text size, pet and pet size, scene and your tarot birthday. Changes apply at once and tick the same menu items.' },
  { id: 'formatting', name: 'Formatting', summary: 'How each markdown shape in a reply is drawn in each reading style, and the Claude Code output styles that ask for them.' },
  workflowSection('setup'), // beside Formatting: both show the output style Claude answers in
  { id: 'sessions', name: 'Sessions', summary: 'How many Claude sessions can be open before the Sessions panel suggests closing one.' },
  { id: 'organizer', name: 'Organizer', summary: 'Optional background agents: one titles, files and tags your recent sessions for History; one builds your Library and lessons from them. All are off by default and use your Claude plan.' },
  { id: 'prompts', name: 'Prompts', summary: 'The prompt that turns each step of a session into the state changes on the Flow view, and what Send to Claude writes when one session hands its history to another.' },
  { id: 'hook', name: 'Response hook', summary: 'A shell command of yours that runs each time Claude finishes a reply.' },
  { id: 'start', name: 'Get started', summary: 'The Get started steps, and whether Petal may read your Claude folder.' },
  workflowSection('today'),
  workflowSection('time'),
  workflowSection('handoffs'),
  workflowSection('factory'),
];

for (const s of SECTIONS) {
  const b = el('button', null, s.name);
  b.type = 'button';
  b.dataset.section = s.id;
  b.setAttribute('role', 'tab');
  tabsBar.append(b);
}

let section: SectionId = 'look';

const renderPrompts = (): HTMLElement[] => [...renderFlowTitles(), ...renderHandoff()];
const RENDER: Record<SettingsId, () => HTMLElement[]> = { look: renderLook, formatting: renderFormatting, sessions: renderSessions, organizer: renderOrganizer, prompts: renderPrompts, hook: renderHook, start: renderStart };
page.redraw = () => { if (!workflow.isTabId(section)) body.replaceChildren(...RENDER[section]()); };

export async function show(id: SectionId = section): Promise<void> {
  section = id;
  for (const b of tabsBar.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-selected', String(b.dataset.section === id));
  summary.textContent = SECTIONS.find((s) => s.id === id)?.summary ?? '';
  summary.hidden = !summary.textContent;
  errorLine.hidden = true;
  body.classList.toggle('customize-body-workflow', workflow.isTabId(id));
  if (workflow.isTabId(id)) return workflow.show(id, body);
  workflow.cancel();
  try {
    const result = await window.pastel.config.get();
    if (isIpcError(result)) throw new Error(result.error);
    if (section !== id) return; // she switched tabs while settings loaded
    page.state = result;
    body.replaceChildren(...RENDER[id]());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    body.replaceChildren(el('p', 'wf-error', `Couldn’t load settings: ${message}`));
  }
}

export async function open(id?: SectionId): Promise<void> {
  if (!overlays.show('customize')) return;
  workflow.reset();
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

