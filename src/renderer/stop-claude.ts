// Stop: one Esc to a working Claude, from the reply box, the streaming reply, a Board card or ⌘.
// Main types it (prompt:answer interrupt) and refuses again unless that claude is busy.
import * as tabs from './tabs';
import * as overlays from './overlays';
import { el } from './dom';
import { screenIsAsking } from '../shared/prompt-answer';
import { STOP_TEXT, STOPPING_MS, stopPhase, type StopPhase } from '../shared/stop-claude';
import type { TabId } from '../shared/types';

export const CHANGED_EVENT = 'petal:stop-changed';
const stoppingUntil = new Map<TabId, number>();
const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>';

const changed = (): void => { window.dispatchEvent(new Event(CHANGED_EVENT)); };

export function phaseOf(tabId: TabId): StopPhase {
  const tab = tabs.get(tabId);
  const update = tab?.update;
  if (!tab || !update) return 'hidden';
  const busy = update.state === 'live' && update.busy;
  if (!busy) stoppingUntil.delete(tabId); // Claude stopped: a later turn starts fresh
  return stopPhase({ live: update.state === 'live', busy, asking: busy && screenIsAsking(tabs.screenLines(tab)), stoppingUntil: stoppingUntil.get(tabId) ?? null, now: Date.now() });
}

export function stop(tabId: TabId): boolean {
  if (phaseOf(tabId) !== 'offered') return false;
  stoppingUntil.set(tabId, Date.now() + STOPPING_MS);
  window.pastel.answerPrompt(tabId, { kind: 'interrupt' });
  setTimeout(changed, STOPPING_MS);
  changed();
  return true;
}

// ⌘.: the active tab, only while the reader is showing (History's box targets a past session).
export function stopActive(): boolean {
  const tab = tabs.active();
  return Boolean(tab && !overlays.current() && stop(tab.id));
}

// One Stop control; variant picks its look, the action is the same everywhere.
export function control(tabId: TabId, variant: 'reader' | 'board'): HTMLButtonElement | null {
  const phase = phaseOf(tabId);
  if (phase === 'hidden') return null;
  const button = el('button', `stop-claude stop-${variant}`);
  button.type = 'button';
  button.dataset.tabId = tabId;
  paint(button, phase);
  button.addEventListener('click', (event) => { event.stopPropagation(); stop(tabId); });
  return button;
}

function paint(button: HTMLButtonElement, phase: StopPhase): void {
  const stopping = phase === 'stopping';
  button.innerHTML = ICON;
  button.append(el('span', 'stop-label', stopping ? STOP_TEXT.stopping : STOP_TEXT.label));
  button.title = STOP_TEXT.title;
  button.setAttribute('aria-label', stopping ? STOP_TEXT.stopping : STOP_TEXT.name);
  button.setAttribute('aria-disabled', String(stopping)); // stays focusable and readable; stop() ignores it
  button.dataset.phase = phase;
}

// The reply box's Stop sits before Send, follows the active tab and is painted in place so it keeps focus.
const composerButton = el('button', 'stop-claude stop-composer');
composerButton.type = 'button';
composerButton.hidden = true;
composerButton.addEventListener('click', () => { const tab = tabs.active(); if (tab) stop(tab.id); });
document.getElementById('composer-send')?.before(composerButton);

export function paintComposer(): void {
  const tab = tabs.active();
  const phase = tab ? phaseOf(tab.id) : 'hidden';
  composerButton.hidden = phase === 'hidden';
  if (tab && phase !== 'hidden') {
    composerButton.dataset.tabId = tab.id;
    paint(composerButton, phase);
  }
  document.getElementById('composer')?.classList.toggle('has-stop', phase !== 'hidden');
}
