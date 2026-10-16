// Messages between sessions in this window: who can be mentioned, and the one send main wraps and pastes.
import * as tabs from './tabs';
import { el, isIpcError } from './dom';
import { assignSlugs, deliverySummary, type Delivery, type MentionTarget } from '../shared/mentions';
import { parseMentionLine, resolveMentionName } from '../shared/mention-line';
import type { SlashItem } from '../shared/slash';

// Last session name per tab, so a tab whose Claude exited still shows by name as "not running".
const lastNames = new Map<string, string>();
window.pastel.onReplies((update) => { if (update.sessionId && update.label) lastNames.set(update.tabId, update.label); });

// Every other tab here that has had a Claude session; slugs are unique in this window.
export function targets(exceptTabId: string | null = tabs.active()?.id ?? null): MentionTarget[] {
  const open = tabs.ids().flatMap((tabId) => {
    const update = tabs.get(tabId)?.update;
    const name = update?.sessionId ? update.label : lastNames.get(tabId);
    if (tabId === exceptTabId || !update || !name || (update.state !== 'live' && update.state !== 'ended')) return [];
    return [{ tabId, name, place: update.repo, running: update.state === 'live' && Boolean(update.sessionId) }];
  });
  return assignSlugs(open);
}

// The "@" picker's Sessions group.
export const pickerItems = (): SlashItem[] => targets().map((t) => ({
  kind: 'session',
  name: t.slug,
  label: t.name,
  description: `@session:${t.slug}${t.running ? '' : ' · not running'}`,
  source: t.place ?? 'this window',
  insert: `@session:${t.slug} `,
}));

// One send to several tabs; main looks each tab up, skips any without Claude, and records it in the activity feed.
export async function send(from: string | null, to: readonly string[], text: string): Promise<Delivery[] | { error: string }> {
  const result = await window.pastel.sendMention(from, [...to], text);
  return isIpcError(result) ? result : result.deliveries;
}

// Under a reply that ends with `**To @<session>:** message`: a button that sends it there. Never sends by itself.
const sentFromReplies = new Map<string, string>(); // reply id + target -> the summary shown after sending

export function replyAction(reply: { id?: string; markdown: string }, fromTabId: string | null): HTMLElement | null {
  const line = parseMentionLine(reply.markdown);
  if (!line) return null;
  const box = el('div', 'reply-mention');
  const target = resolveMentionName(line.name, targets(fromTabId));
  const key = `${reply.id ?? reply.markdown.slice(0, 80)}→${target?.tabId ?? line.name}`;
  const note = el('span', 'reply-mention-note');
  note.setAttribute('role', 'status');
  const button = el('button', 'reply-mention-send', `Send to ${target?.name ?? line.name}`);
  button.type = 'button';
  button.title = `Sends “${line.message}” to that session’s Claude`;
  const done = sentFromReplies.get(key);
  if (!target) { button.disabled = true; note.textContent = `No session named “${line.name}” is open in this window.`; }
  else if (!target.running) { button.disabled = true; note.textContent = 'Not running'; }
  else if (done) { button.disabled = true; note.textContent = done; }
  button.addEventListener('click', async () => {
    if (!target) return;
    button.disabled = true;
    const result = await send(fromTabId, [target.tabId], line.message);
    const summary = 'error' in result ? `Couldn’t send: ${result.error}` : deliverySummary(result);
    if (!('error' in result) && result.some((d) => d.outcome === 'sent' || d.outcome === 'queued')) sentFromReplies.set(key, summary);
    else button.disabled = false;
    note.textContent = summary;
  });
  box.append(button, note);
  return box;
}
