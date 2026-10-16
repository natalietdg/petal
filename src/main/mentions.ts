// Delivers one session's message to the sessions it mentions: wrapped, bracket-pasted, never to a tab without Claude.
import { wrapMessage, type Delivery, type Sender } from '../shared/mentions';
import type { MessageActivity } from './activity-feed';

// One tab as the send sees it; main builds these from its own tab table, never from renderer-supplied ptys.
export interface MentionPort {
  name: string;
  place: string | null;
  sessionId: string | null; // the Claude session in the tab, for the Activity feed
  branch: string | null;
  repo: string | null; // the repo's folder name
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

// One Activity message per session it reached; tabs it skipped are not recorded (the send's result line names them).
export function deliverMentions(request: MentionRequest, lookup: (tabId: string) => MentionPort | undefined, now = new Date()): { deliveries: Delivery[]; messages: MessageActivity[] } {
  const text = stripControls(String(request.text ?? '')).slice(0, MAX_TEXT).trim();
  const fromPort = request.from ? lookup(request.from) : undefined;
  const sender: Sender | null = fromPort?.running ? { name: fromPort.name, place: fromPort.place } : null;
  const to = [...new Set(request.to)].filter((tabId) => tabId !== request.from).slice(0, MAX_TARGETS);
  if (!text || !to.length) return { deliveries: [], messages: [] };
  const wrapped = pasted(wrapMessage(sender, text));
  const from: MessageActivity['from'] = fromPort?.running
    ? { sessionId: fromPort.sessionId, name: fromPort.name, branch: fromPort.branch, repo: fromPort.repo }
    : { sessionId: null, name: 'Petal' };
  const messages: MessageActivity[] = [];
  const deliveries = to.map((tabId): Delivery => {
    const port = lookup(tabId);
    if (!port) return { tabId, name: tabId, outcome: 'closed' };
    if (!port.running) return { tabId, name: port.name, outcome: 'not-running' };
    port.write(wrapped);
    messages.push({ from, to: { sessionId: port.sessionId, name: port.name }, text, at: now.getTime() });
    return { tabId, name: port.name, outcome: port.busy ? 'queued' : 'sent' };
  });
  return { deliveries, messages };
}
