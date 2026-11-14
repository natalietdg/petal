// The one definition of "waiting on you", shared by the Waiting lane, Board cards, the dock count, subsession roll-up and notifications.
// Ranked: 1 permission prompt, 2 question or menu on screen, 3 a child agent stuck on 1 or 2, 4 a Decide line nothing was sent after.
// Idle at the prompt never counts; a silent child is a stall on its card, never waiting.
import type { ScreenAsk } from './prompt-answer';

export type NeedKind = 'permission' | 'question' | 'child' | 'decide';
export const NEED_RANK: Record<NeedKind, number> = { permission: 1, question: 2, child: 3, decide: 4 };

export interface OpenDecide {
  text: string; // markdown of the Decide line
  replyId: string | undefined;
  at: number | null; // the reply's time in ms
}

// A child (headless claude -p) session as its parent sees it.
export interface ChildSignal {
  sessionId: string;
  name: string;
  ask: ScreenAsk | null; // what it stopped on, read from its transcript
  since: number | null;
}

// Everything needsYou() reads about one session, from whichever Petal window holds it.
export interface SessionSignals {
  sessionId: string;
  tabId: string | null; // a tab in the reporting window
  windowId: number | null; // the Petal window holding the tab; null when no window does
  title: string;
  ask: ScreenAsk | null; // on its screen now
  askSince: number | null; // first seen on screen
  decide: OpenDecide | null;
  children: readonly ChildSignal[];
}

export interface Need {
  sessionId: string;
  tabId: string | null;
  windowId: number | null;
  title: string;
  kind: NeedKind;
  rank: number;
  reason: string; // one line: "Permission to run a tool", "<child> needs you"
  since: number | null; // when the wait began
  text?: string; // the Decide line, markdown
  replyId?: string;
  childSessionId?: string;
  here?: boolean; // set per window by main: the tab is in this window
}

const REASONS: Record<Exclude<NeedKind, 'child' | 'decide'>, string> = { permission: 'Asking permission', question: 'Asking a question' };

// The strongest reason this session waits on her, or null when nothing does.
export function needsYou(s: SessionSignals): Need | null {
  const base = { sessionId: s.sessionId, tabId: s.tabId, windowId: s.windowId, title: s.title };
  if (s.ask) return { ...base, kind: s.ask, rank: NEED_RANK[s.ask], reason: REASONS[s.ask], since: s.askSince };
  const child = [...s.children].filter((c) => c.ask).sort((a, b) => NEED_RANK[a.ask ?? 'question'] - NEED_RANK[b.ask ?? 'question'] || (a.since ?? 0) - (b.since ?? 0))[0];
  if (child) return { ...base, kind: 'child', rank: NEED_RANK.child, reason: `${child.name} needs you`, since: child.since, childSessionId: child.sessionId };
  if (s.decide) return { ...base, kind: 'decide', rank: NEED_RANK.decide, reason: 'Decide', since: s.decide.at, text: s.decide.text, replyId: s.decide.replyId };
  return null;
}

// The lane: one row per waiting session, by rank, then longest wait first. Unknown start times go last in their rank.
export function waitingLane(signals: readonly SessionSignals[]): Need[] {
  const seen = new Set<string>();
  const needs: Need[] = [];
  for (const s of signals) {
    if (seen.has(s.sessionId)) continue;
    const need = needsYou(s);
    if (need) { seen.add(s.sessionId); needs.push(need); }
  }
  return needs.sort((a, b) => a.rank - b.rank || (a.since ?? Infinity) - (b.since ?? Infinity) || a.title.localeCompare(b.title));
}

// The dock Board button and the app's dock badge show this.
export const badgeCount = (lane: readonly Need[]): number => lane.length;

// A wait is the same wait while its session, kind and start stay put; a new prompt is a new wait.
export const waitKey = (need: Need): string => `${need.sessionId}|${need.kind}|${need.childSessionId ?? ''}|${need.since ?? ''}`;

// "<session> · <reason>", the notification's title line.
export const noticeTitle = (need: Need): string => `${need.title} · ${need.reason}`;

// Notifies once per wait, and only while Petal is not focused. A wait that starts while she is looking is never notified later.
export class NotifyGate {
  private known = new Set<string>();

  next(lane: readonly Need[], focused: boolean): Need[] {
    const keys = new Set(lane.map(waitKey));
    const fresh = lane.filter((need) => !this.known.has(waitKey(need)));
    this.known = keys; // a wait that ended and starts again is new
    return focused ? [] : fresh;
  }
}
