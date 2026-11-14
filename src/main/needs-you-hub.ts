// Merges every Petal window's waiting report with headless children into one ranked lane (shared/needs-you.ts),
// then sends it to every window, sets the app's dock badge, and notifies once per wait while Petal is not focused.
import { app, BrowserWindow, Notification, webContents } from 'electron';
import { on, send } from './ipc';
import { isSnapshotRun } from './snapshot-mode';
import { NotifyGate, noticeTitle, waitingLane, type Need, type SessionSignals } from '../shared/needs-you';
import { childSignals, type ChildRow } from '../shared/subsessions';
import type { SessionRow } from './sessions-monitor';

const NOTICE_MAX = 200;

export interface HubState {
  reports: Map<number, SessionSignals[]>; // by webContents id
  children: Map<string, { name: string; rows: ChildRow[] }>; // parent session id -> its children
  orphans: ChildRow[];
}

// Each reported session with its children; parents in no Petal window still count when a child asks; orphans stand alone.
export function laneFrom({ reports, children, orphans }: HubState): Need[] {
  const signals: SessionSignals[] = [];
  const reported = new Set<string>();
  for (const list of reports.values()) {
    for (const s of list) {
      if (reported.has(s.sessionId)) continue; // two windows showing one session: the first report wins
      reported.add(s.sessionId);
      signals.push({ ...s, children: childSignals(children.get(s.sessionId)?.rows ?? []) });
    }
  }
  for (const [sessionId, { name, rows }] of children) {
    if (reported.has(sessionId) || !rows.some((c) => c.ask)) continue;
    signals.push({ sessionId, tabId: null, windowId: null, title: name, ask: null, askSince: null, decide: null, children: childSignals(rows) });
  }
  for (const o of orphans) {
    if (o.ask) signals.push({ sessionId: o.sessionId, tabId: null, windowId: null, title: o.name, ask: o.ask, askSince: o.askSince, decide: null, children: [] });
  }
  return waitingLane(signals);
}

const state: HubState = { reports: new Map(), children: new Map(), orphans: [] };
const gate = new NotifyGate();
const notices = new Set<Notification>(); // held so a notice isn't collected before its click
let shownKey = '';

export const lane = (): Need[] => laneFrom(state);

// Each window learns which rows are its own tabs.
const laneFor = (needs: readonly Need[], contentsId: number): Need[] => needs.map((n) => ({ ...n, here: n.windowId === contentsId }));

function liveContents(): Electron.WebContents[] {
  return BrowserWindow.getAllWindows().flatMap((w) => (w.isDestroyed() || w.webContents.isDestroyed() ? [] : [w.webContents]));
}

// Shows the window holding the session and asks it to open the session (or the child's agent panel).
function openNeed(need: Need): void {
  const holder = need.windowId === null ? undefined : webContents.fromId(need.windowId);
  const target = holder && !holder.isDestroyed() ? holder : liveContents()[0];
  const win = target ? BrowserWindow.fromWebContents(target) : null;
  if (!target || !win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  send(target, 'waiting:open', need);
}

function notify(need: Need): void {
  if (!Notification.isSupported()) return;
  const notice = new Notification({ title: noticeTitle(need).slice(0, NOTICE_MAX), body: (need.text ?? '').replace(/\*\*|__|`/g, '').slice(0, NOTICE_MAX) });
  notices.add(notice);
  notice.on('close', () => notices.delete(notice));
  notice.on('click', () => { notices.delete(notice); openNeed(need); });
  notice.show();
}

function update(): void {
  const next = lane();
  const key = JSON.stringify(next);
  const changed = key !== shownKey;
  shownKey = key;
  if (changed) for (const contents of liveContents()) send(contents, 'waiting:lane', laneFor(next, contents.id));
  if (isSnapshotRun()) return; // never badges or notifies from a snapshot run
  app.dock?.setBadge(next.length ? String(next.length) : '');
  const focused = BrowserWindow.getFocusedWindow() !== null;
  for (const need of gate.next(next, focused)) notify(need);
}

// The sessions tick hands over each live parent's children and the orphans.
export function setChildren(rows: readonly SessionRow[], orphans: readonly ChildRow[]): void {
  state.children = new Map(rows.filter((r) => r.children.length).map((r) => [r.sessionId, { name: r.name, rows: r.children }]));
  state.orphans = [...orphans];
  update();
}

export function registerNeedsYou(): void {
  on('waiting:report', (event, signals) => {
    const id = event.sender.id;
    const list = Array.isArray(signals) ? signals.map((s) => ({ ...s, windowId: id, children: [] })) : [];
    if (!state.reports.has(id)) event.sender.once('destroyed', () => { state.reports.delete(id); update(); });
    state.reports.set(id, list);
    update();
    send(event.sender, 'waiting:lane', laneFor(lane(), id)); // a new window gets the lane even when nothing changed
  });
}
