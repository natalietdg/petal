// "Reply · Code review (N)" on a reply that changed code, in the reader and in History, including what the subagents
// it launched wrote. The reply's own blocks stay
// where they are (hidden, not moved), so the reader's layout and print styles are untouched.
import { el, isIpcError } from './dom';
import { functionCard, reasoningList, skippedLine } from './code-review-cards';
import * as explainButton from './code-review-explain';
import { reviewGroups, sourceKey, type ReviewGroup, type TurnMatch } from './code-review-groups';
import type { ExplainTarget, ReviewSource, SessionSummary, TurnReview } from '../shared/code-review';

export type { TurnMatch } from './code-review-groups';

interface Mount {
  host: HTMLElement;
  parts: HTMLElement[];
  source: ReviewSource;
  match: TurnMatch;
  tabs: HTMLElement | null;
  panel: HTMLElement | null;
}

const REFRESH_MS = 1500;
const summaries = new Map<string, SessionSummary>(); // by source key
const reviews = new Map<string, TurnReview>(); // by source key + turn id
const fetching = new Map<string, number>(); // source key -> when its summary was last asked for
const trailing = new Map<string, ReturnType<typeof setTimeout>>(); // one catch-up ask after a burst of redraws
const shown = new Map<string, 'reply' | 'review'>(); // which tab each reply shows, across redraws
let mounts: Mount[] = [];

const matchKey = (mount: Pick<Mount, 'source' | 'match'>): string => `${sourceKey(mount.source)}|${JSON.stringify(mount.match)}`;
const groupsFor = (mount: Mount): ReviewGroup[] => reviewGroups(mount.source, summaries.get(sourceKey(mount.source)), mount.match);
const reviewKey = (group: ReviewGroup, turnId: string): string => `${sourceKey(group.source)}#${turnId}`;
const loadedAll = (mount: Mount): boolean => groupsFor(mount).every((g) => g.turnIds.every((id) => reviews.has(reviewKey(g, id))));

async function refreshSummary(source: ReviewSource, force = false): Promise<void> {
  const key = sourceKey(source);
  const wait = (fetching.get(key) ?? 0) + REFRESH_MS - Date.now();
  if (!force && wait > 0) {
    if (!trailing.has(key)) trailing.set(key, setTimeout(() => { trailing.delete(key); void refreshSummary(source, true); }, wait));
    return;
  }
  fetching.set(key, Date.now());
  const result = await window.pastel.codeReview.summary(source);
  if (isIpcError(result)) return; // no log yet, or the folder is off: no tabs
  const before = JSON.stringify(summaries.get(key));
  summaries.set(key, result);
  if (JSON.stringify(result) === before) return;
  paintAll(key);
  for (const mount of openMounts(key)) void loadReviews(mount); // a turn still being written gained cards
}

const openMounts = (key: string): Mount[] => mounts.filter((m) => m.host.isConnected && sourceKey(m.source) === key && shown.get(matchKey(m)) === 'review');

async function loadReviews(mount: Mount): Promise<void> {
  const asks = groupsFor(mount).flatMap((g) => g.turnIds.map(async (turnId) => ({ key: reviewKey(g, turnId), review: await window.pastel.codeReview.turn(g.source, turnId) })));
  for (const { key, review } of await Promise.all(asks)) if (!isIpcError(review)) reviews.set(key, review);
  paintAll(sourceKey(mount.source));
}

const unanswered = (t: TurnReview): string[] => t.cards.filter((c) => !t.answers[c.key]).map((c) => c.key);

function reviewPanel(mount: Mount): HTMLElement {
  const panel = el('section', 'cr-panel');
  panel.setAttribute('aria-label', 'Code review');
  if (!loadedAll(mount)) {
    panel.append(el('p', 'cr-loading', 'Reading the changes…'));
    return panel;
  }
  const groups = groupsFor(mount).map((g) => ({ ...g, turns: g.turnIds.map((id) => reviews.get(reviewKey(g, id)) as TurnReview) }));
  const all = groups.flatMap((g) => g.turns.map((turn) => ({ source: g.source, turn })));
  const repaint = () => void loadReviews(mount);
  const targets: ExplainTarget[] = all.filter(({ turn }) => unanswered(turn).length).map(({ source, turn }) => ({ source, turnId: turn.turnId, only: unanswered(turn) }));
  const running = all.some(({ turn }) => turn.running);
  panel.append(explainButton.explainBar(matchKey(mount), { estimate: all.reduce((sum, { turn }) => sum + turn.estimate, 0), running, targets, repaint }));
  for (const group of groups) {
    if (group.heading) panel.append(el('h3', 'cr-subagent', group.heading));
    for (const turn of group.turns) {
      const extras = [skippedLine(turn.skipped), reasoningList(turn.reasoning)].filter((x): x is HTMLElement => x !== null);
      panel.append(...extras, ...turn.cards.map((card) => functionCard(card, {
        answer: turn.answers[card.key] ?? null, explained: turn.explained, running,
        onRetry: () => void explainButton.run(matchKey(mount), [{ source: group.source, turnId: turn.turnId, only: [card.key] }]).then(repaint),
      })));
    }
  }
  return panel;
}

function setShown(mount: Mount, view: 'reply' | 'review'): void {
  shown.set(matchKey(mount), view);
  if (view === 'review') void loadReviews(mount);
  paint(mount);
}

function tabSwitch(mount: Mount, count: number, view: 'reply' | 'review'): HTMLElement {
  const tabs = el('div', 'cr-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Reply or code review');
  const button = (id: 'reply' | 'review', label: string) => {
    const b = el('button', 'cr-tab', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(view === id));
    b.addEventListener('click', () => setShown(mount, id));
    return b;
  };
  tabs.append(button('reply', 'Reply'), el('span', 'cr-tab-sep', '·'), button('review', `Code review (${count})`));
  return tabs;
}

function paint(mount: Mount): void {
  mount.tabs?.remove();
  mount.panel?.remove();
  mount.tabs = null;
  mount.panel = null;
  const count = groupsFor(mount).reduce((sum, g) => sum + g.functions, 0);
  const view = count ? shown.get(matchKey(mount)) ?? 'reply' : 'reply';
  for (const part of mount.parts) part.hidden = view === 'review';
  if (!count) return;
  const first = mount.parts[0];
  mount.tabs = tabSwitch(mount, count, view);
  if (first?.parentElement === mount.host) first.before(mount.tabs);
  else mount.host.append(mount.tabs);
  if (view !== 'review') return;
  mount.panel = reviewPanel(mount);
  const last = mount.parts.at(-1);
  if (last?.parentElement === mount.host) last.after(mount.panel);
  else mount.host.append(mount.panel);
}

function paintAll(key: string | null = null): void {
  mounts = mounts.filter((m) => m.host.isConnected);
  for (const mount of mounts) if (!key || sourceKey(mount.source) === key) paint(mount);
}

// Adds the switch to one reply's blocks once its session's summary says the turn changed code; repaints when it does.
export function attach(host: HTMLElement, parts: HTMLElement[], source: ReviewSource | null, match: TurnMatch): void {
  if (!source || ('replyId' in match && !match.replyId)) return;
  const mount: Mount = { host, parts, source, match, tabs: null, panel: null };
  mounts = [...mounts.filter((m) => m.host.isConnected && m.host !== host), mount];
  paint(mount);
  if (shown.get(matchKey(mount)) === 'review' && !loadedAll(mount)) void loadReviews(mount);
  void refreshSummary(source);
}

// Answers landed, or a run started or stopped: fresh summaries, and open panels showing that session or subagent.
window.pastel.codeReview.onChanged(({ sessionId }) => {
  const keys = new Set<string>();
  for (const [key, summary] of summaries) if (summary.sessionId === sessionId) keys.add(key);
  for (const key of keys) {
    const source = mounts.find((m) => sourceKey(m.source) === key)?.source;
    if (source) void refreshSummary(source, true);
  }
  const touched = (m: Mount) => keys.has(sourceKey(m.source)) || groupsFor(m).some((g) => g.turnIds.some((id) => reviews.get(reviewKey(g, id))?.sessionId === sessionId));
  for (const mount of mounts) if (mount.host.isConnected && shown.get(matchKey(mount)) === 'review' && touched(mount)) void loadReviews(mount);
});
