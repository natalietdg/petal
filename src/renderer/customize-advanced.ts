// Customize › Advanced: one switch for the power tools. Off hides them from the UI only; hooks and skills already in ~/.claude keep working.
import * as advanced from './advanced';
import { el } from './dom';
import { card, field, note, page, save } from './customize-kit';

const SHOWS = [
  'Factory, /factory and the Station bar',
  'Tasks, PRDs and subtasks',
  'The test loop, testing and bug-fix agents, lane chat, the bug queue and distillation',
  'The test lock',
  'PRs deploy order and “Is main safe for prod?”',
  'Manual checks and Azure DevOps bug copy',
  'Customize › Prompts, Time, Handoffs and Factory',
];

export function renderAdvanced(): HTMLElement[] {
  const toggle = el('input', 'cz-advanced-toggle');
  Object.assign(toggle, { type: 'checkbox', checked: page.state.config.advanced.on });
  toggle.addEventListener('change', async () => advanced.set((await save({ advanced: { on: toggle.checked } })).advanced.on));
  const list = el('ul', 'cz-list');
  list.append(...SHOWS.map((line) => el('li', null, line)));
  return [
    card('Advanced tools', field('Show advanced tools', toggle, 'For running many sessions, test loops and releases.'),
      note('Turning this on shows:'), list,
      note('Turning it off only hides them. Nothing is uninstalled, and hooks or skills already in your Claude folder keep running.')),
  ];
}
