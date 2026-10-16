// Messages between Claude sessions: `@session:<slug>` mentions in the reply box, and the text a mentioned session receives.

export const SESSION_PREFIX = '@session:';
const SLUG_MAX = 24;

// Another session open in this window, as the "@" picker and the To line show it.
export interface MentionTarget {
  tabId: string;
  name: string; // the shared session name
  slug: string; // what follows "@session:", unique in this window
  place: string | null; // "<repo> · <branch>"
  running: boolean; // a Claude is live in that tab
}

// How main's send went for one mentioned tab.
export type DeliveryOutcome = 'sent' | 'queued' | 'not-running' | 'closed';
export interface Delivery {
  tabId: string;
  name: string;
  outcome: DeliveryOutcome;
}

export const mentionSlug = (name: string): string =>
  name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '') || 'session';

// Slugs in tab order; a repeated one gets -2, -3, ...
export function assignSlugs(sessions: readonly Omit<MentionTarget, 'slug'>[]): MentionTarget[] {
  const used = new Set<string>();
  return sessions.map((session) => {
    const base = mentionSlug(session.name);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return { ...session, slug };
  });
}

export const mentionInsert = (target: Pick<MentionTarget, 'slug'>): string => `${SESSION_PREFIX}${target.slug} `;

// The "@word" the caret sits in (start of box or after a space); null otherwise. A leading "/" belongs to the "/" menu.
export function mentionQuery(value: string, caret: number): { query: string; start: number; end: number } | null {
  if (value.startsWith('/')) return null;
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1 || (at > 0 && !/\s/.test(value[at - 1] ?? ''))) return null;
  const token = /^@\S*/.exec(value.slice(at))?.[0] ?? '@';
  if (caret > at + token.length || /\s/.test(before.slice(at))) return null;
  return { query: token.slice(1), start: at, end: at + token.length };
}

// Swaps the "@word" for the picked item's insert, keeping one space after it.
export function applyMention(value: string, range: { start: number; end: number }, insert: string): { value: string; caret: number } {
  const rest = value.slice(range.end).replace(/^ /, '');
  const next = `${value.slice(0, range.start)}${insert}${rest}`;
  return { value: next, caret: range.start + insert.length };
}

const MENTION = /(^|\s)@session:([a-z0-9][a-z0-9-]*)(?=\s|$|[.,;:!?)])/gi;

// The mentioned sessions in the order typed (each once), slugs that match none, and the message without the mentions.
export function parseMentions(text: string, targets: readonly MentionTarget[]): { targets: MentionTarget[]; unknown: string[]; body: string } {
  const found: MentionTarget[] = [];
  const unknown: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const slug = (match[2] ?? '').toLowerCase();
    const target = targets.find((t) => t.slug === slug);
    if (target && !found.includes(target)) found.push(target);
    if (!target && !unknown.includes(slug)) unknown.push(slug);
  }
  const body = text.replace(MENTION, '$1').split('\n').map((line) => line.replace(/[ \t]{2,}/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { targets: found, unknown, body };
}

export interface Sender {
  name: string;
  place: string | null;
}

// What a mentioned session's Claude reads, so it knows the message came from another session and which one.
export function wrapMessage(sender: Sender | null, text: string): string {
  if (!sender) return `Message from Petal (no Claude session in the sending tab): ${text}`;
  const place = sender.place ? ` (${sender.place})` : '';
  return `Message from session "${sender.name.replace(/"/g, '\'')}"${place}: ${text}`;
}

// What one reply-box send does once it has mentions: who gets it, and whether this session gets it too.
export interface MentionPlan {
  to: MentionTarget[];
  unknown: string[];
  body: string;
  alsoHere: boolean; // only with something to say beyond the mentions, and only when she chose it
}

export function planMentions(text: string, targets: readonly MentionTarget[], alsoHere: boolean): MentionPlan | null {
  const parsed = parseMentions(text, targets);
  if (!parsed.targets.length && !parsed.unknown.length) return null;
  return { to: parsed.targets, unknown: parsed.unknown, body: parsed.body, alsoHere: alsoHere && parsed.body.length > 0 };
}

const OUTCOME_WORDS: Record<DeliveryOutcome, string> = { sent: 'Sent to', queued: 'Queued for', 'not-running': 'Not running, not sent:', closed: 'Closed, not sent:' };

// One line after a send: "Sent to A, B · Not running, not sent: C".
export function deliverySummary(deliveries: readonly Delivery[], unknown: readonly string[] = []): string {
  const parts = (Object.keys(OUTCOME_WORDS) as DeliveryOutcome[]).flatMap((outcome) => {
    const names = deliveries.filter((d) => d.outcome === outcome).map((d) => d.name);
    return names.length ? [`${OUTCOME_WORDS[outcome]} ${names.join(', ')}`] : [];
  });
  if (unknown.length) parts.push(`Not open in this window: ${unknown.map((slug) => `${SESSION_PREFIX}${slug}`).join(', ')}`);
  return parts.join(' · ');
}
