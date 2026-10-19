import { describe, expect, it } from 'vitest';
import {
  applyMention, assignSlugs, deliverySummary, mentionQuery, mentionSlug, parseMentions, planMentions, wrapMessage, type MentionTarget,
} from '../src/shared/mentions';
import { parseMentionLine, resolveMentionName } from '../src/shared/mention-line';
import { deliverMentions, pasted, MAX_TARGETS, type MentionPort } from '../src/main/mentions';

const targets: MentionTarget[] = assignSlugs([
  { tabId: 't2', name: 'Fix stale prices', place: 'billing-service · fix-prices', running: true },
  { tabId: 't3', name: 'Welcome email locale', place: 'widget-service', running: true },
  { tabId: 't4', name: 'Docs site', place: null, running: false },
]);

describe('mention slugs', () => {
  it('turns a session name into a short slug', () => {
    expect(mentionSlug('Fix stale prices')).toBe('fix-stale-prices');
    expect(mentionSlug('  Café · déjà vu!! ')).toBe('cafe-deja-vu');
    expect(mentionSlug('***')).toBe('session');
    expect(mentionSlug('a very long session name that keeps going on').length).toBeLessThanOrEqual(24);
  });

  it('keeps slugs unique in tab order', () => {
    const slugs = assignSlugs(['Petal', 'Petal', 'petal'].map((name, i) => ({ tabId: `t${i}`, name, place: null, running: true }))).map((t) => t.slug);
    expect(slugs).toEqual(['petal', 'petal-2', 'petal-3']);
  });
});

describe('the "@" query', () => {
  it('opens on "@" at the start or after a space, with the caret inside the word', () => {
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0, end: 1 });
    expect(mentionQuery('ask @fix now', 8)).toEqual({ query: 'fix', start: 4, end: 8 });
    expect(mentionQuery('ask @fix now', 6)).toEqual({ query: 'fix', start: 4, end: 8 });
  });

  it('stays shut for an email address, a caret past the word, or a "/" command', () => {
    expect(mentionQuery('me@example.com', 4)).toBeNull();
    expect(mentionQuery('ask @fix now', 11)).toBeNull();
    expect(mentionQuery('/review @x', 10)).toBeNull();
  });

  it('swaps the word for the pick, keeping the rest of her text', () => {
    expect(applyMention('ask @fi now', { start: 4, end: 7 }, '@session:fix-stale-prices ')).toEqual({ value: 'ask @session:fix-stale-prices now', caret: 30 });
    expect(applyMention('@rev', { start: 0, end: 4 }, '@agent-reviewer ')).toEqual({ value: '@agent-reviewer ', caret: 16 });
  });
});

describe('parseMentions', () => {
  it('finds each mentioned session once, in the order typed, and strips the mentions from the message', () => {
    const parsed = parseMentions('@session:welcome-email-locale @session:fix-stale-prices which table? @session:welcome-email-locale', targets);
    expect(parsed.targets.map((t) => t.tabId)).toEqual(['t3', 't2']);
    expect(parsed.body).toBe('which table?');
    expect(parsed.unknown).toEqual([]);
  });

  it('keeps line breaks, reports slugs that match no open session, and leaves @agent- alone', () => {
    const parsed = parseMentions('@session:ghost hi,\nsee @agent-reviewer too', targets);
    expect(parsed.targets).toEqual([]);
    expect(parsed.unknown).toEqual(['ghost']);
    expect(parsed.body).toBe('hi,\nsee @agent-reviewer too');
  });

  it('takes a mention followed by punctuation', () => {
    expect(parseMentions('ask @session:docs-site, please', targets).targets.map((t) => t.tabId)).toEqual(['t4']);
  });
});

describe('planMentions: who gets it', () => {
  it('is null without mentions, so the box sends as it always has', () => {
    expect(planMentions('just a message', targets, true)).toBeNull();
  });

  it('never sends to this session unless she chose Also send, and never with only mentions', () => {
    expect(planMentions('@session:docs-site check the build', targets, false)?.alsoHere).toBe(false);
    expect(planMentions('@session:docs-site check the build', targets, true)?.alsoHere).toBe(true);
    const bare = planMentions('@session:docs-site', targets, true);
    expect(bare?.body).toBe('');
    expect(bare?.alsoHere).toBe(false);
  });
});

describe('wrapMessage', () => {
  it('says which session it came from and where', () => {
    expect(wrapMessage({ name: 'Fix stale prices', place: 'billing-service · fix-prices' }, 'which table?'))
      .toBe('Message from session "Fix stale prices" (billing-service · fix-prices): which table?');
  });

  it('works without a place, and never lets a quote in the name break the wrapping', () => {
    expect(wrapMessage({ name: 'Say "hi"', place: null }, 'x')).toBe('Message from session "Say \'hi\'": x');
    expect(wrapMessage(null, 'x')).toBe('Message from Petal (no Claude session in the sending tab): x');
  });
});

describe('deliverMentions (main)', () => {
  const ports = (): Record<string, MentionPort & { written: string[] }> => {
    const port = (name: string, place: string | null, running: boolean, busy = false) => {
      const written: string[] = [];
      const sessionId = running ? `sid-${name}` : null;
      return { name, place, sessionId, branch: running ? 'main' : null, repo: place, running, busy, written, write: (data: string) => { written.push(data); } };
    };
    return {
      me: port('Sessions board', 'petal · mentions', true),
      a: port('Fix stale prices', 'billing-service', true),
      b: port('Welcome email', null, true, true),
      off: port('Docs site', null, false),
    };
  };

  it('pastes the same wrapped message into every mentioned tab, and none into the sender', () => {
    const p = ports();
    const at = new Date('2026-10-16T10:00:00Z');
    const { deliveries, messages } = deliverMentions({ from: 'me', to: ['a', 'b', 'a'], text: 'which table?' }, (id) => p[id], at);
    const want = pasted('Message from session "Sessions board" (petal · mentions): which table?');
    expect(want).toBe('\x1b[200~Message from session "Sessions board" (petal · mentions): which table?\x1b[201~\r');
    expect(p.a?.written).toEqual([want]);
    expect(p.b?.written).toEqual([want]);
    expect(p.me?.written).toEqual([]);
    expect(deliveries).toEqual([{ tabId: 'a', name: 'Fix stale prices', outcome: 'sent' }, { tabId: 'b', name: 'Welcome email', outcome: 'queued' }]);
    const from = { sessionId: 'sid-Sessions board', name: 'Sessions board', branch: 'main', repo: 'petal · mentions' };
    expect(messages).toEqual([
      { from, to: { sessionId: 'sid-Fix stale prices', name: 'Fix stale prices' }, text: 'which table?', at: at.getTime() },
      { from, to: { sessionId: 'sid-Welcome email', name: 'Welcome email' }, text: 'which table?', at: at.getTime() },
    ]);
  });

  it('skips a tab with no Claude running and a tab that closed, writing nothing to either', () => {
    const p = ports();
    const { deliveries, messages } = deliverMentions({ from: 'me', to: ['off', 'gone', 'a'], text: 'hi' }, (id) => p[id]);
    expect(deliveries.map((d) => d.outcome)).toEqual(['not-running', 'closed', 'sent']);
    expect(p.off?.written).toEqual([]);
    expect(messages.map((m) => m.to.name)).toEqual(['Fix stale prices']); // skipped tabs are not recorded
  });

  it('records nothing when no one was reached, and sends nothing to itself or with empty text', () => {
    const p = ports();
    expect(deliverMentions({ from: 'me', to: ['off'], text: 'hi' }, (id) => p[id]).messages).toEqual([]);
    expect(deliverMentions({ from: 'me', to: ['me'], text: 'hi' }, (id) => p[id]).deliveries).toEqual([]);
    expect(deliverMentions({ from: 'me', to: ['a'], text: '  \x1b ' }, (id) => p[id]).deliveries).toEqual([]);
    expect(p.me?.written).toEqual([]);
    expect(p.a?.written).toEqual([]);
  });

  it('strips controls that could end the paste early, and caps the targets', () => {
    const p = ports();
    deliverMentions({ from: 'me', to: ['a'], text: 'a\x1b[201~b\x07c' }, (id) => p[id]);
    expect(p.a?.written[0]).toBe(pasted('Message from session "Sessions board" (petal · mentions): a[201~bc'));
    const many = Array.from({ length: MAX_TARGETS + 5 }, (_, i) => `x${i}`);
    expect(deliverMentions({ from: 'me', to: many, text: 'hi' }, () => undefined).deliveries).toHaveLength(MAX_TARGETS);
  });

  it('writes nothing to a tab that is asking something, and records no message for it', () => {
    const p = ports();
    const { deliveries, messages } = deliverMentions({ from: 'me', to: ['a', 'b'], text: 'hi', asking: ['a'] }, (id) => p[id]);
    expect(deliveries.map((d) => d.outcome)).toEqual(['asking', 'queued']);
    expect(p.a?.written).toEqual([]);
    expect(messages.map((m) => m.to.name)).toEqual(['Welcome email']);
  });

  it('pastes an image-path message without its Enter, and says the Enter comes later', () => {
    const p = ports();
    const { deliveries } = deliverMentions({ from: 'me', to: ['a'], text: 'see /tmp/shot.png' }, (id) => p[id]);
    const message = 'Message from session "Sessions board" (petal · mentions): see /tmp/shot.png';
    expect(p.a?.written).toEqual([pasted(message, false)]);
    expect(p.a?.written[0]?.endsWith('\r')).toBe(false);
    expect(deliveries).toEqual([{ tabId: 'a', name: 'Fix stale prices', outcome: 'sent', enterLater: true }]);
  });

  it('wraps as Petal when the sending tab has no Claude', () => {
    const p = ports();
    deliverMentions({ from: 'off', to: ['a'], text: 'hi' }, (id) => p[id]);
    expect(p.a?.written[0]).toBe(pasted('Message from Petal (no Claude session in the sending tab): hi'));
  });
});

describe('deliverySummary', () => {
  it('reads as one line', () => {
    expect(deliverySummary([{ tabId: 'a', name: 'A', outcome: 'sent' }, { tabId: 'b', name: 'B', outcome: 'sent' }, { tabId: 'c', name: 'C', outcome: 'not-running' }], ['ghost']))
      .toBe('Sent to A, B · Not running, not sent: C · Not open in this window: @session:ghost');
  });

  it('names a session that is asking and tells her to answer it there', () => {
    expect(deliverySummary([{ tabId: 'a', name: 'A', outcome: 'sent' }, { tabId: 'b', name: 'B', outcome: 'asking' }])).toBe('Sent to A · B is asking something; answer it there first');
    expect(deliverySummary([{ tabId: 'b', name: 'B', outcome: 'asking' }, { tabId: 'c', name: 'C', outcome: 'asking' }])).toBe('B, C are asking something; answer it there first');
  });
});

describe('parseMentionLine', () => {
  it('reads `**To @name:** message` at the end of a reply', () => {
    expect(parseMentionLine('**Prices are fixed.**\n\nDone.\n\n**To @Fix stale prices:** which table holds v2 prices?'))
      .toEqual({ name: 'Fix stale prices', message: 'which table holds v2 prices?' });
  });

  it('takes the colon outside the bold, quotes, and a Decide line after it', () => {
    expect(parseMentionLine('**To @"Docs site"**: is the build green?\n\n**Decide:** ship today?')).toEqual({ name: 'Docs site', message: 'is the build green?' });
  });

  it('ignores a To line inside code, one with no message, and plain prose', () => {
    expect(parseMentionLine('```\n**To @x:** hi\n```')).toBeNull();
    expect(parseMentionLine('**To @x:**')).toBeNull();
    expect(parseMentionLine('I will write to @x later.')).toBeNull();
  });

  it('resolves the name by full name, slug or unique start', () => {
    expect(resolveMentionName('fix stale prices', targets)?.tabId).toBe('t2');
    expect(resolveMentionName('session:docs-site', targets)?.tabId).toBe('t4');
    expect(resolveMentionName('Welcome', targets)?.tabId).toBe('t3');
    expect(resolveMentionName('Nobody', targets)).toBeNull();
  });
});
