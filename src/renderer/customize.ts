// Customize: every setting and the Workflow tabs in one place. Replaces the reader while open; Esc or Cmd+, goes back.
// Each section renders from its own file; this is the overlay shell that loads settings and switches sections.
import * as overlays from './overlays';
import * as workflow from './workflow';
import { byId, el, isIpcError } from './dom';
import { body, errorLine, page, summary, tabsBar } from './customize-kit';
import { renderFormatting, renderLook } from './customize-look';
import { lessonsCard, renderFlowTitles, renderHandoff, renderOrganizer } from './customize-prompts';
import { renderHook } from './customize-hook';
import { sessionCards } from './customize-sessions';
import { renderStart } from './customize-start';
import { renderAdvanced } from './customize-advanced';
import { outputStylesCard } from './customize-styles';
import { petalSkillsCard } from './customize-skills';
import * as advanced from './advanced';

type SettingsId = 'look' | 'formatting' | 'claude' | 'organizer' | 'prompts' | 'hook' | 'start' | 'advanced';
type WorkflowSection = Exclude<workflow.TabId, 'today' | 'setup'>; // Today lives on the Board; Setup inside Claude setup
type SectionId = SettingsId | WorkflowSection;
interface Section { id: SectionId; name: string; summary: string; advancedOnly?: boolean }

const button = byId('customize-button');

// Workflow tabs carry their own one-line summary, so theirs is empty and the line hides.
const workflowSection = (id: WorkflowSection): Section => ({ id, name: workflow.TABS.find((t) => t.id === id)?.name ?? id, summary: '', advancedOnly: true });
const SECTIONS: Section[] = [
  { id: 'look', name: 'Look', summary: 'Theme, reading style, text size, pet and pet size, and scene. Changes apply at once and tick the same menu items.' },
  { id: 'formatting', name: 'Formatting', summary: 'How each markdown shape in a reply is drawn in each reading style, and what each colour means.' },
  { id: 'claude', name: 'Claude setup', summary: 'What Petal adds to Claude Code: the output style Claude answers in, Petal’s skills, lessons, and your CLAUDE.md, agents and skills.' },
  { id: 'organizer', name: 'Organizer', summary: 'How many sessions can be open, and optional background agents that title, file and tag your sessions and build your Library. The agents are off by default and use your Claude plan.' },
  { id: 'prompts', name: 'Prompts', summary: 'The prompt that turns each step of a session into the state changes on the Flow view, and what Send to Claude writes when one session hands its history to another.', advancedOnly: true },
  { id: 'hook', name: 'Response hook', summary: 'A shell command of yours that runs each time Claude finishes a reply.' },
  { id: 'start', name: 'First steps', summary: 'Whether Petal may read your Claude folder, what it costs in tokens, and the setup guide.' },
  workflowSection('time'),
  workflowSection('handoffs'),
  workflowSection('factory'),
  { id: 'advanced', name: 'Advanced', summary: 'Power tools for many sessions, test loops and releases. Off for new installs.' },
];

for (const s of SECTIONS) {
  const b = el('button', null, s.name);
  b.type = 'button';
  b.dataset.section = s.id;
  b.setAttribute('role', 'tab');
  if (s.advancedOnly) b.classList.add('advanced-only');
  tabsBar.append(b);
}

let section: SectionId = 'look';

// Claude setup: Petal's own cards, then the Setup tab (CLAUDE.md, agents, skills), which loads on its own.
const setupSlot = el('div', 'cz-setup-slot');
const renderClaudeSetup = (): HTMLElement[] => {
  void workflow.show('setup', setupSlot);
  return [outputStylesCard(), petalSkillsCard(), lessonsCard(), setupSlot];
};
const renderPrompts = (): HTMLElement[] => [...renderFlowTitles(), ...renderHandoff()];
const renderOrganizerSection = (): HTMLElement[] => [...sessionCards(), ...renderOrganizer()];
const RENDER: Record<SettingsId, () => HTMLElement[]> = { look: renderLook, formatting: renderFormatting, claude: renderClaudeSetup, organizer: renderOrganizerSection, prompts: renderPrompts, hook: renderHook, start: renderStart, advanced: renderAdvanced };
const isWorkflowSection = (id: SectionId): id is WorkflowSection => workflow.isTabId(id);
page.redraw = () => { if (!isWorkflowSection(section)) body.replaceChildren(...RENDER[section]()); };

export async function show(id: SectionId = section): Promise<void> {
  section = id;
  for (const b of tabsBar.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-selected', String(b.dataset.section === id));
  summary.textContent = SECTIONS.find((s) => s.id === id)?.summary ?? '';
  summary.hidden = !summary.textContent;
  errorLine.hidden = true;
  body.classList.toggle('customize-body-workflow', isWorkflowSection(id));
  if (isWorkflowSection(id)) return workflow.show(id, body);
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

// An Advanced section asked for while Advanced is off opens Look instead.
const reachable = (id: SectionId): SectionId => (SECTIONS.find((s) => s.id === id)?.advancedOnly && !advanced.isOn() ? 'look' : id);

export async function open(id?: SectionId): Promise<void> {
  if (!overlays.show('customize')) return;
  workflow.reset();
  await show(reachable(id ?? section));
  tabsBar.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
}

export const close = (): void => overlays.hide('customize');
export const isOpen = (): boolean => overlays.isOpen('customize');
export const toggle = (): Promise<void> | void => (isOpen() ? close() : open());

button.addEventListener('click', () => toggle());
window.pastel.onOpenCustomize(() => (isOpen() ? close() : open()));
const isSectionId = (value: string | undefined): value is SectionId => SECTIONS.some((s) => s.id === value);
// Advanced switched off while one of its sections is open: back to Look.
advanced.onChange((on) => {
  if (!on && isOpen() && SECTIONS.find((s) => s.id === section)?.advancedOnly) void show('look');
});
tabsBar.addEventListener('click', (event) => {
  const id = (event.target as HTMLElement).dataset.section;
  if (isSectionId(id)) show(id);
});
// A menu change while Look or Formatting is open redraws the ticks and the preview.
const redraw = () => { if (isOpen() && (section === 'look' || section === 'formatting')) show(); };
for (const subscribe of ['onTheme', 'onReading', 'onCat', 'onScene'] as const) window.pastel[subscribe](redraw);

