// Replying from History's preview: the message goes to that session in a tab that isn't shown,
// so she stays in History. Messages wait here until Claude is up in the tab, then go out like the reply box's.
import * as tabs from './tabs';
import { pasteToClaude, stripControls } from './composer';
import { limitNote } from './sessions-panel';
import { isIpcError } from './dom';
import { parseQuestionPicker } from '../shared/prompt-answer';
import { READY_SETTLE_MS } from '../shared/agent-loop';
import type { Tab } from './tabs';

const following = new Map<string, string>(); // sessionId -> the tab this box opened for it
const queued = new Map<string, string[]>(); // sessionId -> messages waiting for Claude in its tab
const readySince = new Map<string, number>(); // tabId -> when its Claude became ready
const delivering = new Set<string>(); // tabIds mid-delivery, so a burst of updates sends once
let opening: string | null = null; // sessionId whose background tab main is opening

export const hooks = {
  redraw: (_tabId: string | null): void => {}, // the preview's replies for that tab changed
  repaint: (_tabId: string): void => {}, // only its screen changed (a picker may have appeared)
};

export type ReplyOutcome = { sent: true } | { note: string } | { confirm: string };

// The tab following a session: one this box opened, else a tab where it's running now.
export function tabFor(sessionId: string): Tab | null {
  const own = tabs.get(following.get(sessionId) ?? '');
  if (own) return own;
  return tabs.ids().map(tabs.get).find((tab) => tab?.update?.state === 'live' && tab.update.sessionId === sessionId) ?? null;
}

export const queuedFor = (sessionId: string): readonly string[] => queued.get(sessionId) ?? [];

const sessionOf = (tabId: string): string | null =>
  [...following].find(([, id]) => id === tabId)?.[0] ?? tabs.get(tabId)?.update?.sessionId ?? null;

// Ready: Claude is running there with its session file, and no question is waiting on her.
const isReady = (tab: Tab): boolean => tab.update?.state === 'live' && Boolean(tab.update.sessionId) && !parseQuestionPicker(tabs.screenLines(tab));

async function deliver(tabId: string): Promise<void> {
  const tab = tabs.get(tabId);
  const sessionId = sessionOf(tabId);
  const since = readySince.get(tabId);
  if (!tab || !sessionId || since === undefined || !isReady(tab) || delivering.has(tabId)) return;
  if (Date.now() - since < READY_SETTLE_MS) return;
  const messages = queued.get(sessionId) ?? [];
  if (!messages.length) return;
  queued.delete(sessionId);
  delivering.add(tabId);
  try {
    for (const text of messages) await pasteToClaude(tab, text);
  } finally {
    delivering.delete(tabId);
  }
  hooks.redraw(tabId);
}

// A tab's reader changed: send what waited for Claude once it's ready, then redraw.
export function tabUpdated(tabId: string): void {
  const tab = tabs.get(tabId);
  if (tab && isReady(tab)) {
    if (!readySince.has(tabId)) readySince.set(tabId, Date.now());
    const wait = (readySince.get(tabId) ?? 0) + READY_SETTLE_MS - Date.now();
    setTimeout(() => void deliver(tabId), Math.max(0, wait));
  } else {
    readySince.delete(tabId);
  }
  hooks.redraw(tabId);
}

// Main opened the background tab this box asked for.
export function adoptTab(tabId: string): void {
  if (!opening) return;
  following.set(opening, tabId);
  opening = null;
  tabUpdated(tabId);
}

export function tabClosed(tabId: string): void {
  for (const [sessionId, id] of following) if (id === tabId) following.delete(sessionId);
  readySince.delete(tabId);
  hooks.redraw(null); // unsent messages stay queued for the next reply
}

export function sendReply(sessionId: string, raw: string, confirmFork = false): Promise<ReplyOutcome> {
  const text = stripControls(raw).trim();
  if (!text) return Promise.resolve({ note: '' });
  const tab = tabFor(sessionId);
  if (tab) {
    queued.set(sessionId, [...queuedFor(sessionId), text]);
    tabUpdated(tab.id);
    return Promise.resolve({ sent: true });
  }
  return openAndSend(sessionId, text, confirmFork);
}

// No tab follows this session yet: the same checks as Open and Add Session, then a background tab.
async function openAndSend(sessionId: string, text: string, confirmFork: boolean): Promise<ReplyOutcome> {
  const limited = await limitNote('reply from here');
  if (limited) return { note: limited };
  opening = sessionId;
  const result = await window.pastel.history.resume(sessionId, confirmFork, true);
  const refused = isIpcError(result) ? { note: `Couldn’t reply: ${result.error}` }
    : 'confirm' in result ? { confirm: result.confirm }
      : 'note' in result ? { note: result.note } : null;
  if (refused) {
    opening = null;
    return refused;
  }
  queued.set(sessionId, [...queuedFor(sessionId), text]);
  if ('tabId' in result) {
    opening = null;
    following.set(sessionId, result.tabId);
  }
  const tabId = following.get(sessionId); // a new tab may already have been adopted
  if (tabId) tabUpdated(tabId);
  else hooks.redraw(null);
  return { sent: true };
}
