// Messages between sessions in this window: who can be mentioned, and the one send main wraps and pastes.
import * as tabs from './tabs';
import { el, isIpcError } from './dom';
import { assignSlugs, deliverySummary, type Delivery, type MentionTarget } from '../shared/mentions';
import { parseMentionLine, resolveMentionName } from '../shared/mention-line';
import type { SlashItem } from '../shared/slash';
import { screenIsAsking } from '../shared/prompt-answer';

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

// Claude Code drops an Enter that lands while it is still reading a pasted image, so the Enter waits for its [Image #n].
const IMAGE_READ_MAX_MS = 5000;
const IMAGE_POLL_MS = 100;
const IMAGE_SETTLE_MS = 150;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export const imageTags = (tab: tabs.Tab): number => tabs.screenLines(tab).join('\n').split('[Image #').length - 1;

// Resolves once a new [Image #n] shows in Claude's input, or after IMAGE_READ_MAX_MS if it never does.
export async function imagesRead(tab: tabs.Tab, before: number): Promise<void> {
  for (let waited = 0; waited < IMAGE_READ_MAX_MS; waited += IMAGE_POLL_MS) {
    await sleep(IMAGE_POLL_MS);
    if (imageTags(tab) > before) { await sleep(IMAGE_SETTLE_MS); return; }
  }
}

// A pasted Enter would answer the prompt on screen (a permission's focused "Yes"), so main skips these tabs.
const isAsking = (tab: tabs.Tab): boolean => screenIsAsking(tabs.screenLines(tab));

async function enterAfterImage(tabId: string, before: number): Promise<void> {
  const tab = tabs.get(tabId);
  if (!tab) return;
  await imagesRead(tab, before);
  if (!isAsking(tab)) await window.pastel.paste(tabId, '\r');
}

// One send to several tabs; main looks each tab up, skips any without Claude or asking, and records it in the activity feed.
export async function send(from: string | null, to: readonly string[], text: string): Promise<Delivery[] | { error: string }> {
  const open = to.flatMap((tabId) => tabs.get(tabId) ?? []);
  const asking = open.filter(isAsking).map((tab) => tab.id);
  const before = new Map(open.map((tab) => [tab.id, imageTags(tab)]));
  const result = await window.pastel.sendMention(from, [...to], text, asking);
  if (isIpcError(result)) return result;
  await Promise.all(result.deliveries.filter((d) => d.enterLater).map((d) => enterAfterImage(d.tabId, before.get(d.tabId) ?? 0)));
  return result.deliveries;
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
