// One line under the reader's status strip when another live session in this repo edited a file this one did.
// Its button sends that session a heads-up through the reply box's send path; nothing is ever stopped.
import * as tabs from './tabs';
import * as coord from './coord';
import { pasteToClaude } from './composer';
import { byId, el } from './dom';
import { clashNotice, headsUpText, type Clash } from '../shared/file-clash';

const line = el('div', 'clash-notice');
line.id = 'reader-clash';
line.setAttribute('role', 'status');
line.hidden = true;
byId('reader-status-strip').after(line);

const sent = new Set<string>(); // heads-ups already sent this run, by session + file + other

const tabOf = (sessionId: string): tabs.Tab | null =>
  tabs.ids().map((id) => tabs.get(id)).find((tab) => tab?.update?.state === 'live' && tab.update.sessionId === sessionId) ?? null;

function headsUp(from: string, clash: Clash, key: string, button: HTMLButtonElement): void {
  const other = tabOf(clash.otherSessionId);
  if (!other) return;
  button.disabled = true;
  void pasteToClaude(other, headsUpText(from, clash.file)).then((ok) => {
    if (ok) sent.add(key);
    paint();
  });
}

export function paint(): void {
  const tab = tabs.active();
  const here = coord.session(tab?.update?.state === 'live' ? tab.update.sessionId : null);
  const clash = here?.clashes[0];
  line.hidden = !here || !clash;
  if (!here || !clash) { line.replaceChildren(); return; }
  const text = el('span', 'clash-text', clashNotice(clash));
  const more = here.clashes.length - 1;
  text.title = here.clashes.map(clashNotice).join('\n');
  const parts: HTMLElement[] = [el('span', 'clash-chip', 'Clash'), text];
  if (more > 0) parts.push(el('span', 'clash-more', `+${more} more`));
  const key = `${here.sessionId}:${clash.otherSessionId}:${clash.file}`;
  if (sent.has(key)) parts.push(el('span', 'clash-sent', 'Heads-up sent'));
  else if (tabOf(clash.otherSessionId)) {
    const button = el('button', 'clash-headsup', 'Send heads-up');
    button.type = 'button';
    button.title = `Tell ${clash.otherName} that this session is editing ${clash.file} too`;
    button.addEventListener('click', () => headsUp(here.name, clash, key, button));
    parts.push(button);
  }
  line.replaceChildren(...parts);
}

coord.onChange(paint);
// A tab switch flips aria-selected on the tab strip; repaint for the newly active session.
new MutationObserver(paint).observe(byId('tab-strip'), { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
window.pastel.onReplies(() => setTimeout(paint, 0)); // after the tab takes its update
