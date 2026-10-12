// The header's Agents chip and its dropdown: today's agents for this session; picking one opens it in the right panel.
// It lives inside #reader-head, like the Colour key, so the current look's tokens reach it.
import * as agentPanel from './agent-panel';
import * as sessionsPanel from './sessions-panel';
import { menuRows, type MenuRow } from './agents-menu-rows';
import { byId, el, isIpcError } from './dom';
import { agentsChipText } from '../shared/ipc';
import type { AgentSummary } from '../main/agents';

const GAP_PX = 8;

const chip = byId<HTMLButtonElement>('agents-chip');
const menu = byId('agents-menu');
chip.setAttribute('aria-haspopup', 'menu');
chip.setAttribute('aria-expanded', 'false');
chip.setAttribute('aria-controls', 'agents-menu');

let agents: AgentSummary[] = [];

export const isOpen = (): boolean => !menu.hidden;
const rowButtons = (): HTMLButtonElement[] => [...menu.querySelectorAll<HTMLButtonElement>('.agents-menu-row')];

function rowButton(row: MenuRow): HTMLButtonElement {
  const button = el('button', 'agents-menu-row');
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  button.dataset.agentId = row.id;
  button.dataset.status = row.status;
  button.setAttribute('aria-label', `${row.task}, ${row.status}, ${row.time}`);
  const dot = el('span', `agents-dot ${row.status}`);
  dot.title = row.status;
  button.append(dot, el('span', 'agents-menu-task', row.task), el('span', 'agents-menu-time', row.time));
  button.tabIndex = -1;
  button.addEventListener('click', () => pick(row.id));
  return button;
}

// Rebuilt on each tick; focus stays on the same agent.
function render(): void {
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.agentId;
  const rows = menuRows(agents, Date.now());
  if (!rows.length) {
    menu.replaceChildren(el('p', 'agents-menu-empty', 'No agents in this session today.'));
    return;
  }
  const list = el('div', 'agents-menu-list');
  list.append(...rows.map(rowButton));
  menu.replaceChildren(list);
  const again = rowButtons().find((b) => b.dataset.agentId === focused);
  if (again) again.focus();
}

async function refresh(): Promise<void> {
  const result = await window.pastel.agents.list(null);
  if (isIpcError(result)) return;
  agents = result.agents;
  if (isOpen()) render();
}

export async function open(): Promise<void> {
  const anchor = chip.getBoundingClientRect();
  menu.style.top = `${Math.round(anchor.bottom + GAP_PX)}px`;
  menu.style.right = `${Math.round(window.innerWidth - anchor.right)}px`;
  render();
  menu.hidden = false;
  chip.setAttribute('aria-expanded', 'true');
  await refresh();
  if (isOpen() && !menu.contains(document.activeElement)) (rowButtons()[0] ?? menu).focus();
}

export function close(refocus = false): void {
  if (!isOpen()) return;
  menu.hidden = true;
  chip.setAttribute('aria-expanded', 'false');
  if (refocus) chip.focus();
}

function pick(agentId: string): void {
  close();
  void agentPanel.show(null, agentId);
}

// Arrow keys move, Home/End jump, Enter opens, Esc closes back to the chip.
function onKey(event: KeyboardEvent): void {
  const buttons = rowButtons();
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const move = (to: number) => { event.preventDefault(); buttons[(to + buttons.length) % buttons.length]?.focus(); };
  if (event.key === 'ArrowDown') move(at + 1);
  else if (event.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
  else if (event.key === 'Home') move(0);
  else if (event.key === 'End') move(-1);
  else if (event.key === 'Enter' && at >= 0) {
    event.preventDefault();
    pick(buttons[at].dataset.agentId ?? '');
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }
}

chip.addEventListener('click', () => (isOpen() ? close() : void open()));
menu.addEventListener('keydown', onKey);
// Dismiss on a click anywhere else, Esc, or a resize that would leave it detached from the chip.
document.addEventListener('click', (event) => {
  const target = event.target as Node;
  if (isOpen() && !menu.contains(target) && !chip.contains(target)) close();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isOpen()) close(true);
});
window.addEventListener('resize', () => close());

// The chip and the open dropdown ride the Sessions tick; no timer of their own.
sessionsPanel.onView(({ here }) => {
  chip.hidden = here.total === 0;
  chip.textContent = agentsChipText(here);
  chip.classList.toggle('has-running', here.running > 0);
  if (chip.hidden) close();
  if (isOpen()) void refresh();
});
