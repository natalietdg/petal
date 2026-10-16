// Delivers one session's message to the sessions it mentions: wrapped, bracket-pasted, never to a tab without Claude.
import { wrapMessage, type Delivery, type Sender } from '../shared/mentions';
import type { MessageActivity } from './activity-feed';

// One tab as the send sees it; main builds these from its own tab table, never from renderer-supplied ptys.
export interface MentionPort {
  name: string;
  place: string | null;
  running: boolean; // a Claude session is live in the tab
  busy: boolean; // Claude Code queues a paste that lands mid-turn
  write: (data: string) => void;
}

export interface MentionRequest {
  from: string | null;
  to: readonly string[];
  text: string;
}

export const MAX_TARGETS = 12;
export const MAX_TEXT = 20_000;
// Bracketed paste keeps a multi-line message as one, as the reply box sends it.
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
// eslint-disable-next-line no-control-regex -- C0 controls other than newline and tab could end the paste early
const stripControls = (text: string): string => text.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');

export const pasted = (text: string): string => `${PASTE_START}${text}${PASTE_END}\r`;

export function deliverMentions(request: MentionRequest, lookup: (tabId: string) => MentionPort | undefined, now = new Date()): { deliveries: Delivery[]; activity: MessageActivity | null } {
  const text = stripControls(String(request.text ?? '')).slice(0, MAX_TEXT).trim();
  const fromPort = request.from ? lookup(request.from) : undefined;
  const sender: Sender | null = fromPort?.running ? { name: fromPort.name, place: fromPort.place } : null;
  const to = [...new Set(request.to)].filter((tabId) => tabId !== request.from).slice(0, MAX_TARGETS);
  if (!text || !to.length) return { deliveries: [], activity: null };
  const wrapped = pasted(wrapMessage(sender, text));
  const deliveries = to.map((tabId): Delivery => {
    const port = lookup(tabId);
    if (!port) return { tabId, name: tabId, outcome: 'closed' };
    if (!port.running) return { tabId, name: port.name, outcome: 'not-running' };
    port.write(wrapped);
    return { tabId, name: port.name, outcome: port.busy ? 'queued' : 'sent' };
  });
  const reached = deliveries.filter((d) => d.outcome === 'sent' || d.outcome === 'queued');
  const activity: MessageActivity | null = reached.length
    ? { kind: 'message', at: now.toISOString(), from: sender?.name ?? 'Petal', to: reached.map((d) => d.name), skipped: deliveries.filter((d) => !reached.includes(d)).map((d) => d.name), text }
    : null;
  return { deliveries, activity };
}
