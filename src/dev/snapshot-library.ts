// Library: fixture notes on the half dial A to Z, coloured by category, arrows turn it, sort and category filter reorder and narrow it,
// Enter reads a note and Back returns, the session header's Add to Library merges a stubbed answer (never a real claude),
// Read past sessions asks, runs and stops over fixture logs, consent off shows Allow and the empty state,
// and every theme, reading style and width stays readable and in the window.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import * as configStore from '../main/config-store';
import { resizeOffscreen } from '../main/snapshot-window';
import { folderFixture, libraryFixture } from '../main/snapshot-mode';
import { serializeNote } from '../main/library-store';
import { READING_CHOICES } from '../main/menu';

const MIN_RATIO = 4.5;
const WIDTHS = [800, 990, 1280, 1600];
const DAY_MS = 24 * 60 * 60 * 1000;

// Fake, realistic domain notes for a made-up company; no real data.
export const LIBRARY_NOTES: { title: string; category: string; daysAgo: number; facts: string[] }[] = [
  { title: 'ACH return codes', category: 'Payments', daysAgo: 9, facts: ['R01 means insufficient funds; retry at most twice, 3 business days apart.', 'R02 and R03 close the bank link; the customer must reconnect.', 'Returns can arrive up to 60 days after settlement for consumer accounts.'] },
  { title: 'Payout cutoff times', category: 'Payments', daysAgo: 2, facts: ['Payouts requested before 3pm local time settle the same day.', 'Later requests settle the next business day.', 'Public holidays follow the bank’s calendar, not the customer’s.'] },
  { title: 'Refund windows', category: 'Payments', daysAgo: 14, facts: ['Card refunds are allowed for 120 days after capture.', 'Partial refunds keep the original fee.'] },
  { title: 'Settlement batches', category: 'Payments', daysAgo: 5, facts: ['Batches close at 23:00 UTC and post by 06:00 UTC.', 'A batch with any failed row is held, never split.'] },
  { title: 'Access token lifetime', category: 'Auth', daysAgo: 1, facts: ['Access tokens last 15 minutes; refresh tokens last 30 days.', 'A password change revokes every refresh token for that user.'] },
  { title: 'OTP retry limits', category: 'Auth', daysAgo: 20, facts: ['Five wrong codes lock sign-in for 15 minutes.', 'A new code invalidates every earlier one.'] },
  { title: 'Session cookies', category: 'Auth', daysAgo: 30, facts: ['The session cookie is HttpOnly, Secure and SameSite=Lax.'] },
  { title: 'Customer ID format', category: 'Data', daysAgo: 7, facts: ['Customer IDs are cus_ followed by 14 base32 characters.', 'IDs are never reused, even after deletion.'] },
  { title: 'Ledger entries', category: 'Data', daysAgo: 3, facts: ['Every money movement is two ledger rows that sum to zero.', 'Rows are immutable; a correction is a new reversing pair.'] },
  { title: 'Soft deletes', category: 'Data', daysAgo: 40, facts: ['Deleted records keep a deleted_at time and drop out of every list.'] },
  { title: 'Deploy regions', category: 'Infra', daysAgo: 12, facts: ['Production runs in two regions; EU data never leaves the EU region.'] },
  { title: 'Queue retry policy', category: 'Infra', daysAgo: 6, facts: ['Jobs retry five times with exponential backoff from 30 seconds.', 'After the last retry a job lands in the dead-letter queue for 14 days.'] },
  { title: 'Webhook signatures', category: 'Integrations', daysAgo: 4, facts: ['Each webhook carries an HMAC-SHA256 signature of the raw body.', 'Receivers reject signatures older than five minutes.'] },
  { title: 'Carrier status codes', category: 'Integrations', daysAgo: 16, facts: ['DLV means delivered; EXC means an exception the carrier will retry.'] },
  { title: 'Plan tiers', category: 'Product', daysAgo: 25, facts: ['Starter, Team and Business; Team adds roles, Business adds SSO.'] },
  { title: 'Trial length', category: 'Product', daysAgo: 11, facts: ['Trials last 14 days and convert to Starter unless cancelled.'] },
  { title: 'Data retention', category: 'Compliance', daysAgo: 8, facts: ['Transaction records are kept for seven years.', 'Support chat transcripts are deleted after 18 months.'] },
  { title: 'SMS sender IDs', category: 'Messaging', daysAgo: 18, facts: ['Alphanumeric sender IDs need country registration before first use.'] },
  { title: 'Settlement instructions for cross-border payouts', category: 'Payments', daysAgo: 13, facts: ['Cross-border payouts carry the beneficiary bank’s SWIFT code and a purpose code.'] },
];
const LONG_TITLE = 'Settlement instructions for cross-border payouts';

// Fake past session logs under a stand-in Claude folder: four recent, one 40 days old, one subagent-only.
export function seedPastSessions(home: string, now = Date.now()): void {
  fs.rmSync(home, { recursive: true, force: true });
  const project = path.join(home, 'projects', '-demo-acme');
  fs.mkdirSync(project, { recursive: true });
  const line = (o: object) => `${JSON.stringify({ isSidechain: false, timestamp: new Date(now).toISOString(), ...o })}\n`;
  const write = (id: string, daysAgo: number, text: string) => {
    const file = path.join(project, `${id}.jsonl`);
    fs.writeFileSync(file, text);
    const at = new Date(now - daysAgo * DAY_MS);
    fs.utimesSync(file, at, at);
  };
  for (const [i, days] of [1, 3, 6, 12, 40].entries()) {
    write(`0a0b0c0d-0000-4000-8000-00000000010${i}`, days, line({ type: 'user', uuid: `u${i}`, message: { role: 'user', content: `question ${i} about payout cutoffs` } })
      + line({ type: 'assistant', uuid: `a${i}`, message: { role: 'assistant', content: [{ type: 'text', text: `Answer ${i}: payouts after 3pm settle the next day.` }] } }));
  }
  write('0a0b0c0d-0000-4000-8000-000000000199', 2, line({ type: 'user', uuid: 'su', isSidechain: true, message: { role: 'user', content: 'subagent task' } }));
}

// Each visible tab's category, colour stripe and fill; the chips' dots; the selected tab's ink and the long title's fit.
const COLOUR_PROBE = `(() => {
  const view = document.getElementById('library');
  const tabs = [...view.querySelectorAll('.lib-tab')].map((t) => ({ cat: t.querySelector('.lib-tab-cat').textContent, hue: t.dataset.hue, stripe: getComputedStyle(t).borderLeftColor, fill: getComputedStyle(t).backgroundColor, title: t.title, selected: t.classList.contains('selected') }));
  const chips = [...view.querySelectorAll('.lib-filter[data-hue]')].map((c) => ({ cat: c.dataset.category, hue: c.dataset.hue, dot: getComputedStyle(c.querySelector('.lib-dot')).backgroundColor }));
  const segs = [...view.querySelectorAll('.lib-seg')].map((g) => ({ hue: g.dataset.hue, fill: getComputedStyle(g).backgroundColor }));
  const sel = view.querySelector('.lib-tab.selected');
  const name = sel?.querySelector('.lib-tab-name');
  return {
    tabs, chips, segs,
    selectedFill: sel ? getComputedStyle(sel).backgroundColor : null,
    selectedCat: sel?.querySelector('.lib-tab-cat')?.textContent ?? null,
    selectedName: name?.textContent ?? null,
    nameFits: name ? name.scrollHeight <= name.clientHeight + 1 && name.scrollWidth <= name.clientWidth + 1 : false,
    nameLines: name ? Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight || '17')) : 0,
    previewCat: view.querySelector('.lib-preview .lib-chip')?.textContent ?? null,
    previewHue: view.querySelector('.lib-preview')?.dataset.hue ?? null,
    hub: view.querySelector('.lib-disc')?.dataset.hue ?? null,
    sectors: view.querySelector('.lib-disc')?.style.getPropertyValue('--sectors') ?? '',
  };
})()`;

// Text contrast for the session header's button and its status line, outside the Library.
const HEADER_PROBE = `(() => {
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const b = document.getElementById('library-add-session');
  const s = document.getElementById('library-add-status');
  const r = b.getBoundingClientRect();
  return {
    ...PastelTerm.libraryAdd.state(),
    visible: r.width > 0 && r.height > 0,
    nextTo: (() => { const n = document.getElementById('notes-toggle').getBoundingClientRect(); return Math.abs((n.top + n.bottom) / 2 - (r.top + r.bottom) / 2) < 3; })(),
    ratios: [b, ...(s.hidden ? [] : [...s.querySelectorAll('span, button')])].map(ratio),
  };
})()`;

// At a narrow window: the header row stays inside itself, and the status sits on its own line under the row.
const HEADER_FIT_PROBE = `(() => {
  const head = document.getElementById('reader-head');
  const row = head.querySelector('.reader-head-row').getBoundingClientRect();
  const column = head.querySelector('.reader-head-column').getBoundingClientRect();
  const s = document.getElementById('library-add-status');
  const b = s.getBoundingClientRect();
  const line = s.querySelector('span');
  return { sideways: head.scrollWidth - head.clientWidth, step: PastelTerm.headFit.state().step, shown: !s.hidden && b.width > 0,
    under: b.top >= row.bottom - 0.5, inside: b.left >= column.left - 0.5 && b.right <= column.right + 0.5, tooltip: line?.title === line?.textContent };
})()`;

export function seedLibrary(dir: string, now = Date.now()): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const note of LIBRARY_NOTES) {
    const updated = new Date(now - note.daysAgo * DAY_MS).toISOString();
    const slug = note.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    fs.writeFileSync(path.join(dir, `${slug}.md`), serializeNote({
      title: note.title,
      category: note.category,
      updated,
      sources: [`0f1e2d3c-0000-4000-8000-0000000000${String(note.daysAgo).padStart(2, '0')} ${updated.slice(0, 10)}`],
      facts: note.facts.map((f) => `- ${f}`).join('\n'),
      evidence: `- ${updated.slice(0, 10)} · confirmed in a working session`,
    }));
  }
}

export const PROBE = `(() => {
  const view = document.getElementById('library');
  if (!view || view.hidden) return null;
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const texts = [...view.querySelectorAll('.lib-title, .lib-summary, .lib-cost, .lib-sort-button, .lib-filter, .lib-add, .lib-tab-name, .lib-tab.selected .lib-tab-cat, .lib-letter, .lib-chip, .lib-preview-title, .lib-preview-meta, .lib-preview-facts li, .lib-read, .lib-note span, .lib-link, .lib-empty-title, .lib-empty-text, .lib-back, .lib-reading-title, .lib-reading .prose li, .lib-progress span, .lib-confirm-text, .lib-confirm .lib-sort-button, .lib-confirm-go, .lib-confirm-cancel, .lib-manage-button, .lib-manage-hint, .lib-tidy-names strong, .lib-tidy-names span, .lib-tidy-merge, .lib-tidy-keep, .lib-toast span, .lib-undo')].filter(visible);
  const worst = texts.map((t) => [ratio(t), t.className || t.tagName, t.textContent.slice(0, 30)]).sort((a, b) => a[0] - b[0])[0] ?? [99];
  const list = view.querySelector('.lib-list');
  const options = [...view.querySelectorAll('.lib-tab')];
  const sel = view.querySelector('.lib-tab.selected');
  const dial = view.querySelector('.lib-dial');
  const pointer = view.querySelector('.lib-pointer');
  const sb = sel?.getBoundingClientRect();
  const pb = pointer?.getBoundingClientRect();
  return {
    state: PastelTerm.library.state(),
    options: options.length,
    selected: sel?.querySelector('.lib-tab-name')?.textContent ?? null,
    activeId: list?.getAttribute('aria-activedescendant') ?? null,
    selectedId: sel?.id ?? null,
    role: list?.getAttribute('role'),
    // the selected tab sits level with the 3 o'clock pointer, to the right of it
    atThree: sb && pb ? Math.abs((sb.top + sb.bottom) / 2 - (pb.top + pb.bottom) / 2) < 3 && sb.left >= pb.right - 2 : false,
    threeGap: sb && pb ? [Math.round((sb.top + sb.bottom) / 2 - (pb.top + pb.bottom) / 2), Math.round(sb.left - pb.right)] : null,
    dialLeft: dial ? Math.round(dial.getBoundingClientRect().left) : null,
    // the notes drawn above and below the selected one, nearest first
    around: sb ? (() => {
      const mid = (b) => (b.top + b.bottom) / 2;
      const others = options.filter((o) => o !== sel).map((o) => ({ name: o.querySelector('.lib-tab-name')?.textContent, dy: mid(o.getBoundingClientRect()) - mid(sb) }));
      const above = others.filter((o) => o.dy < 0).sort((a, b) => b.dy - a.dy).map((o) => o.name);
      const below = others.filter((o) => o.dy > 0).sort((a, b) => a.dy - b.dy).map((o) => o.name);
      return { above, below };
    })() : null,
    preview: view.querySelector('.lib-preview-title')?.textContent ?? null,
    letters: [...view.querySelectorAll('.lib-letter')].map((l) => l.textContent),
    reading: !view.querySelector('.lib-reading').hidden,
    readingTitle: view.querySelector('.lib-reading-title')?.textContent ?? null,
    readingText: view.querySelector('.lib-reading .prose')?.textContent ?? '',
    note: view.querySelector('.lib-note')?.hidden ? '' : view.querySelector('.lib-note')?.textContent ?? '',
    allow: [...view.querySelectorAll('button')].some((b) => visible(b) && /^Allow/.test(b.textContent)),
    empty: visible(view.querySelector('.lib-empty')) ? view.querySelector('.lib-empty').textContent : '',
    minRatio: worst[0],
    worst,
    focused: document.activeElement === list ? 'list' : document.activeElement?.className ?? null,
    overflowX: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, view.scrollWidth - view.clientWidth),
    inWindow: [...view.querySelectorAll('.lib-tab, .lib-preview, .lib-head, .lib-chips')].filter(visible).every((n) => { const b = n.getBoundingClientRect(); return b.left >= -1 && b.right <= window.innerWidth + 1; }),
  };
})()`;

export async function libraryCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} library: ${what}`);
  const dir = path.join(app.getPath('userData'), 'library');
  seedLibrary(dir);
  // Add to Library records notes under the fixture session; put the record back so a later conclude starts clean.
  const sessionsFile = path.join(app.getPath('userData'), 'library-sessions.json');
  const sessionsBefore = fs.existsSync(sessionsFile) ? fs.readFileSync(sessionsFile, 'utf8') : null;
  type Probe = { state: { sort: string; category: string | null; text: string; selected: number; shown: string[] }; [k: string]: unknown };
  const probe = (): Promise<Probe | null> => js(PROBE);
  const settle = async (want: (p: Probe) => boolean = () => true) => waitFor(async () => { const p = await probe(); return p && want(p) ? p : null; }, 5000);
  const key = (k: string) => js(`document.querySelector('#library .lib-list').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const setReading = async (look: string) => {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
  };
  const select = (index: number) => js(`PastelTerm.library.select(${index})`);
  const az = LIBRARY_NOTES.map((n) => n.title).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  await js('PastelTerm.welcome.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  const [startWidth, startHeight] = win.getContentSize();
  try {
    resizeOffscreen(win, 1280, 900);
    await wait(300);

    // Opens from the dock button, A to Z, first note at 3 o'clock, on a listbox with an active descendant.
    await click('#library-button');
    const opened = await settle((p) => p.state.shown.length === az.length);
    check(opened && JSON.stringify(opened.state.shown) === JSON.stringify(az), `A to Z by default: ${JSON.stringify(opened?.state.shown.slice(0, 4))}…`);
    check(opened && opened.role === 'listbox' && opened.activeId === opened.selectedId && opened.selected === az[0] && opened.preview === az[0], `listbox, ${az[0]} selected and previewed`);
    const three = await settle((p) => Boolean(p.atThree)) ?? await probe(); // the first layout settles onto the pointer
    check(three?.atThree, `the selected note sits at 3 o'clock, right of the pointer: ${JSON.stringify(three?.threeGap)}`);
    check(opened && opened.dialLeft === 0, `the dial's flat side is on the window's left edge: ${opened?.dialLeft}`);
    check(opened && (opened.letters as string[]).includes('A') && (opened.letters as string[]).includes('C'), `rim letters: ${JSON.stringify(opened?.letters)}`);
    // How many fit is the window's height (7 at this size); wrapping puts Z's last note straight above A.
    const around = three?.around as { above: string[]; below: string[] } | null;
    check(three && (three.options as number) < az.length && around && around.above[0] === az.at(-1) && around.below[0] === az[1] && around.above.length >= 3 && around.below.length >= 3,
      `a full dial wraps, notes above and below 3 o'clock: ${three?.options} ${JSON.stringify(around && { above: around.above.slice(0, 2), below: around.below.slice(0, 2) })}`);
    check(await js("document.getElementById('library-button').getAttribute('aria-pressed')") === 'true', 'the Library button shows pressed');
    await capture('library-dial');

    // Arrows turn the dial.
    await key('ArrowDown');
    await key('ArrowDown');
    const turned = await settle((p) => p.state.selected === 2);
    check(turned && turned.selected === az[2] && turned.preview === az[2] && turned.activeId === turned.selectedId, `ArrowDown twice selects ${az[2]}: ${turned?.selected}`);
    await wait(400); // the glide
    check((await probe())?.atThree, 'after turning, the selected note is at 3 o\'clock');
    await key('ArrowUp');
    check((await settle((p) => p.state.selected === 1))?.selected === az[1], 'ArrowUp turns back');
    await key('End');
    check((await settle((p) => p.state.selected === az.length - 1))?.selected === az.at(-1), 'End reaches the last note');
    await key('ArrowDown');
    check((await settle((p) => p.state.selected === 0))?.selected === az[0], 'past the last note the wheel comes round to the first');
    await key('ArrowUp');
    check((await settle((p) => p.state.selected === az.length - 1)), 'and back the other way');
    await key('Home');

    // Sort.
    await click('#library .lib-sort-button[data-sort="za"]');
    const za = await settle((p) => p.state.sort === 'za');
    check(za && JSON.stringify(za.state.shown) === JSON.stringify([...az].reverse()), `Z to A reverses: ${JSON.stringify(za?.state.shown.slice(0, 3))}`);
    await click('#library .lib-sort-button[data-sort="recent"]');
    const recent = await settle((p) => p.state.sort === 'recent');
    const byRecent = [...LIBRARY_NOTES].sort((a, b) => a.daysAgo - b.daysAgo).map((n) => n.title);
    check(recent && JSON.stringify(recent.state.shown) === JSON.stringify(byRecent) && (recent.letters as string[]).length === 0, `Recently updated: newest first, no rim letters: ${JSON.stringify(recent?.state.shown.slice(0, 3))}`);
    await click('#library .lib-sort-button[data-sort="az"]');

    // Category filter, then words.
    await click('#library .lib-filter[data-category="Payments"]');
    const payments = await settle((p) => p.state.category === 'Payments');
    const wantPayments = az.filter((t) => LIBRARY_NOTES.find((n) => n.title === t)?.category === 'Payments');
    check(payments && JSON.stringify(payments.state.shown) === JSON.stringify(wantPayments), `Payments narrows to ${wantPayments.length}: ${JSON.stringify(payments?.state.shown)}`);
    await key('ArrowDown');
    await wait(400);
    await capture('library-filtered');
    await js("(() => { const s = document.querySelector('#library .lib-search'); s.value = 'cutoff'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
    const words = await settle((p) => p.state.text === 'cutoff');
    check(words && JSON.stringify(words.state.shown) === JSON.stringify(['Payout cutoff times']), `"cutoff" within Payments: ${JSON.stringify(words?.state.shown)}`);
    await js("(() => { const s = document.querySelector('#library .lib-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await click('#library .lib-filter[data-category=""]');
    await settle((p) => p.state.category === null && p.state.text === '' && p.state.shown.length === az.length);

    // Enter reads the selected note, rendered like a reply; Back and Esc return to the dial with focus on it.
    await js("document.querySelector('#library .lib-list').focus()");
    await key('Home');
    await key('ArrowDown');
    await settle((p) => p.state.selected === 1);
    await key('Enter');
    const read = await settle((p) => Boolean(p.reading && p.readingTitle));
    const note = LIBRARY_NOTES.find((n) => n.title === az[1]);
    check(read && read.readingTitle === az[1] && note?.facts.every((f) => (read.readingText as string).includes(f)), `Enter reads "${az[1]}" with its facts`);
    check(read && await js("Boolean(document.querySelector('#library .lib-reading .prose'))"), 'rendered through the reply renderer (.prose)');
    await capture('library-reading');
    await click('#library .lib-back');
    const back = await settle((p) => !p.reading);
    check(back && back.selected === az[1] && back.focused === 'list', `Back returns to the dial on ${az[1]}, focus on it: ${back?.focused}`);
    await key('Enter');
    await settle((p) => Boolean(p.reading));
    await js("document.querySelector('#library .lib-back').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
    const escBack = await settle((p) => !p.reading);
    check(escBack && await js("!document.getElementById('library').hidden"), 'Esc while reading goes back to the dial, the Library stays open');
    // A click on the selected note reads it too.
    await click('#library .lib-tab.selected');
    check(await settle((p) => Boolean(p.reading)), 'a click on the selected note reads it');
    await click('#library .lib-back');
    await settle((p) => !p.reading);

    // Colour: every tab of a category has the same stripe and fill, categories differ, chips are the legend, and it holds on reopening.
    const colourOf = async () => js(COLOUR_PROBE) as Promise<{ tabs: { cat: string; hue: string; stripe: string; fill: string; title: string; selected: boolean }[]; chips: { cat: string; hue: string; dot: string }[]; segs: { hue: string; fill: string }[]; selectedFill: string | null; selectedCat: string | null; selectedName: string | null; nameFits: boolean; nameLines: number; previewCat: string | null; previewHue: string | null; hub: string | null; sectors: string }>;
    const byCat = (list: { cat: string; stripe?: string; dot?: string }[], key: 'stripe' | 'dot') => {
      const map = new Map<string, Set<string>>();
      for (const item of list) map.set(item.cat.toLowerCase(), (map.get(item.cat.toLowerCase()) ?? new Set()).add(String(item[key])));
      return map;
    };
    const colours = await colourOf();
    const stripes = byCat(colours.tabs, 'stripe');
    check(colours.tabs.length > 4 && [...stripes.values()].every((set) => set.size === 1), `one stripe colour per category: ${JSON.stringify([...stripes].map(([c, v]) => [c, [...v][0]]))}`);
    const dots = byCat(colours.chips, 'dot');
    check(colours.chips.length >= 8 && colours.tabs.every((t) => dots.get(t.cat.toLowerCase())?.has(t.stripe)), 'each chip dot matches its category’s stripe, so the chips are the legend');
    check(new Set(['Payments', 'Auth', 'Data', 'Infra', 'Integrations'].map((c) => [...(dots.get(c.toLowerCase()) ?? [])][0])).size === 5, 'Payments, Auth, Data, Infra and Integrations each have their own colour');
    check(colours.segs.length > 4 && new Set(colours.segs.map((g) => g.fill)).size > 1, `the rim is a coloured band by category: ${colours.segs.length} segments, ${new Set(colours.segs.map((g) => g.fill)).size} colours`);
    const selectedTab = colours.tabs.find((t) => t.selected);
    check(selectedTab && colours.selectedFill === selectedTab.stripe && colours.selectedCat && colours.previewCat?.toLowerCase() === colours.selectedCat.toLowerCase(), `the selected tab fills with its category colour and names its category: ${colours.selectedFill} ${colours.selectedCat}`);
    check(colours.tabs.every((t) => t.title.endsWith(` · ${t.cat}`) && t.title.length > t.cat.length + 3), 'every tab carries its full title and category as a tooltip');
    // The disc body is filled with one slice per note; the slice under the pointer is lit in the selected category; the hub matches.
    const sectorHues = (text: string) => [...text.matchAll(/var\(--sector-(\w+?)(-on)?\)/g)].map((m) => `${m[1]}${m[2] ?? ''}`);
    const slices = sectorHues(colours.sectors);
    const lit = slices.filter((h) => h.endsWith('-on'));
    check(/^conic-gradient/.test(colours.sectors) && slices.length >= 7 && new Set(slices).size >= 4, `the disc is filled with category slices: ${slices.length} slices, ${new Set(slices).size} colours`);
    check(lit.length === 1 && lit[0] === `${selectedTab?.hue}-on` && colours.hub === selectedTab?.hue && colours.previewHue === selectedTab?.hue, `the selected slice, hub and preview card take the selected category: ${JSON.stringify({ lit, hub: colours.hub, preview: colours.previewHue })}`);
    await key('ArrowDown');
    await wait(450);
    const turnedColours = await colourOf();
    check(turnedColours.sectors !== colours.sectors && sectorHues(turnedColours.sectors).filter((h) => h.endsWith('-on'))[0] === `${turnedColours.tabs.find((t) => t.selected)?.hue}-on`, 'turning moves the slices and the lit one follows the pointer');
    await key('ArrowUp');
    await js('PastelTerm.library.close()');
    await click('#library-button');
    await settle((p) => p.state.shown.length === az.length);
    const again = await colourOf();
    check(JSON.stringify([...byCat(again.chips, 'dot')]) === JSON.stringify([...dots]), 'colours stay the same on reopening');
    // A long title gets room on the selected tab, two lines at most, without an ellipsis.
    await select(az.indexOf(LONG_TITLE));
    await wait(400);
    const long = await colourOf();
    check(long.selectedName === LONG_TITLE && long.nameFits && long.nameLines <= 2, `"${LONG_TITLE}" fits on the selected tab in ${long.nameLines} line(s): fits ${long.nameFits}`);
    await capture('library-dial-colour');
    await select(0);

    // Add to Library sits in the session header next to Notes; the stub answers; the status says so, then fades.
    const prompts: string[] = [];
    libraryFixture.extract = async (prompt) => {
      prompts.push(prompt);
      return JSON.stringify({ result: JSON.stringify({ topics: [{ topic: 'Invoice numbering', category: 'billing', facts: ['Invoice numbers are sequential per account and never reused.'], evidence: 'fixture session' }] }) });
    };
    check(await js("!document.querySelector('#library .lib-past')?.textContent.includes('this session')"), 'the Library no longer has Add from this session');
    await js('PastelTerm.library.close()');
    type Header = { hidden: boolean; disabled: boolean; title: string; status: string; visible: boolean; nextTo: boolean; ratios: number[] };
    const header = (): Promise<Header> => js(HEADER_PROBE);
    const live = await js('Boolean(PastelTerm.tabs.active()?.update?.sessionId)');
    if (live) {
      const before = await header();
      check(before.visible && !before.disabled && before.nextTo && before.title === 'Save this session’s domain knowledge to your Library', `Add to Library shows beside Notes with its tooltip: ${JSON.stringify(before)}`);
      check(before.ratios.every((r) => r >= MIN_RATIO), `the header button is readable: ${JSON.stringify(before.ratios)}`);
      await capture('library-header-button');
      await click('#library-add-session');
      const added = await waitFor(async () => { const h = await header(); return /Added 1 note/.test(h.status) ? h : null; }, 5000);
      check(added && prompts.length === 1 && /Open Library/.test(added.status), `Add to Library merges a stubbed answer: ${JSON.stringify(added?.status)}`);
      check(added && added.ratios.every((r) => r >= MIN_RATIO), `the status line is readable: ${JSON.stringify(added?.ratios)}`);
      check(fs.readFileSync(path.join(dir, 'invoice-numbering.md'), 'utf8').includes('category: Billing'), 'its category reuses the starter spelling (Billing)');
      await capture('library-header-status');
      const faded = await waitFor(async () => { const h = await header(); return h.status === '' ? h : null; }, 9000);
      check(faded, 'the status fades after a few seconds');
      resizeOffscreen(win, 800, 900);
      await wait(400);
      await click('#library-add-session');
      const again2 = await waitFor(async () => { const h = await header(); return /Nothing new since/.test(h.status) ? h : null; }, 5000);
      check(again2 && prompts.length === 1, 'a second add with nothing new calls nothing');
      const narrow = await js(HEADER_FIT_PROBE);
      check(narrow.sideways <= 1 && narrow.shown && narrow.under && narrow.inside && narrow.tooltip, `800px: the header row fits with its status on a line under it: ${JSON.stringify(narrow)}`);
      check(again2 && again2.visible && again2.nextTo && again2.ratios.every((r) => r >= MIN_RATIO), `800px: Add to Library still beside Notes and readable: ${JSON.stringify(again2)}`);
      await capture('library-header-status-800');
      resizeOffscreen(win, 1280, 900);
      await wait(400);
      await js("document.querySelector('#library-add-status .library-add-open')?.click()");
      const openedFromStatus = await settle((p) => p.state.shown.includes('Invoice numbering'));
      check(openedFromStatus, 'Open Library in the status opens the Library with the new note');
    } else check(false, 'the fixture tab has a session for Add to Library');
    libraryFixture.extract = null;

    // Read past sessions: asks with a count and a call estimate, runs newest first in the background, survives closing, stops.
    const savedHome = folderFixture.home;
    const pastHome = path.join(app.getPath('userData'), 'past-claude');
    seedPastSessions(pastHome);
    folderFixture.home = pastHome;
    const pastPrompts: string[] = [];
    let slow = true;
    libraryFixture.extract = async (prompt) => {
      pastPrompts.push(prompt);
      if (slow) await new Promise((r) => setTimeout(r, 900));
      return JSON.stringify({ result: JSON.stringify({ topics: [{ topic: 'Payout cutoff times', category: 'Payments', facts: [`Fact from past session ${pastPrompts.length}.`] }] }) });
    };
    try {
      await click('#library .lib-past');
      const asked = await settle((p) => /^Read 4 sessions from the last 30 days\? This uses your Claude plan, about 4 calls\. About [\d,]+ tokens to read, [\d,]+ to write\.$/.test((p.state as { confirm?: string }).confirm ?? ''));
      check(asked, `the confirm counts 4 recent sessions, leaving out the old and the subagent one: ${JSON.stringify((await probe())?.state)}`);
      await click('#library .lib-confirm [data-days="90"]');
      const ninety = await settle((p) => /^Read 5 sessions from the last 90 days/.test((p.state as { confirm?: string }).confirm ?? ''));
      check(ninety, 'the 90 day range counts the 40 day old one too');
      await click('#library .lib-confirm [data-days="30"]');
      await settle((p) => /last 30 days/.test((p.state as { confirm?: string }).confirm ?? ''));
      const confirmRatio = await probe();
      check(confirmRatio && (confirmRatio.minRatio as number) >= MIN_RATIO, `the confirm is readable: ${confirmRatio?.minRatio}:1 ${JSON.stringify(confirmRatio?.worst)}`);
      await capture('library-backfill-confirm');
      await click('#library .lib-confirm-go');
      type Fill = { running: boolean; stopping: boolean; done: number; total: number };
      const fill = (p: Probe) => (p.state as unknown as { backfill: Fill }).backfill;
      const running = await settle((p) => fill(p).running && fill(p).total === 4);
      const progressText = await js("document.querySelector('#library .lib-progress')?.textContent ?? ''");
      check(running && /^Reading past sessions: 1 of 4 · Stop$/.test(progressText), `progress in the header: ${JSON.stringify(progressText)}`);
      const progressRatio = await probe();
      check(progressRatio && (progressRatio.minRatio as number) >= MIN_RATIO, `the progress line is readable: ${progressRatio?.minRatio}:1`);
      await capture('library-backfill-progress');
      await js('PastelTerm.library.close()');
      await wait(1200);
      await click('#library-button');
      const reopened = await settle((p) => fill(p).running && fill(p).done >= 1);
      check(reopened && pastPrompts.length >= 2, `it keeps reading with the Library closed: ${pastPrompts.length} calls`);
      check(pastPrompts[0]?.includes('question 0'), 'the newest session is read first');
      await click('#library .lib-stop');
      const stopped = await settle((p) => !fill(p).running);
      const after = pastPrompts.length;
      await wait(1500);
      check(stopped && after < 4 && pastPrompts.length === after && /^Stopped after \d of 4 past sessions/.test(stopped.note as string), `Stop ends after the current run: ${JSON.stringify(stopped?.note)}`);
      // A rerun resumes: only what was not read.
      slow = false;
      await click('#library .lib-past');
      const rest = await settle((p) => /^Read \d sessions? from the last 30 days/.test((p.state as { confirm?: string }).confirm ?? ''));
      const restCount = Number(/^Read (\d)/.exec((rest?.state as { confirm?: string } | undefined)?.confirm ?? '')?.[1]);
      check(restCount === 4 - after, `a rerun offers only the ${4 - after} not read: ${restCount}`);
      await click('#library .lib-confirm-go');
      const finished = await settle((p) => !fill(p).running && /^Read \d past sessions?:/.test(p.note as string));
      check(finished && pastPrompts.length === 4, `the rerun reads the rest: ${pastPrompts.length} calls, ${JSON.stringify(finished?.note)}`);
    } finally {
      folderFixture.home = savedHome;
      libraryFixture.extract = null;
    }

    // Near duplicates (made up, in the shape of hers): Tidy duplicates lists them; Merge folds one; Keep both is remembered.
    const dupes = [
      { title: 'EU SI email', category: 'Payments', facts: ['The SI email goes to the finance inbox.', 'It is sent at 9am local time.'] },
      { title: 'EU Settlement Instruction email', category: 'Payments', facts: ['The SI email goes to the finance inbox.', 'It carries the PDF as an attachment.'] },
      { title: 'EU Settlement Instruction numbering', category: 'Payments', facts: ['SI numbers restart every calendar year.'] },
      { title: 'Settlement instruction numbering', category: 'Payments', facts: ['Numbers are zero padded to six digits.'] },
    ];
    const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    for (const d of dupes) {
      fs.writeFileSync(path.join(dir, `${slugOf(d.title)}.md`), serializeNote({ title: d.title, category: d.category, updated: new Date().toISOString(), sources: ['0f1e2d3c-0000-4000-8000-000000000077 2026-10-10'], facts: d.facts.map((f) => `- ${f}`).join('\n'), evidence: '' }));
    }
    await js('PastelTerm.library.load()');
    type Tidy = Probe & { state: Probe['state'] & { tidy: string[] | null; toast: string } };
    const tidyOf = (p: Probe) => (p as Tidy).state.tidy;
    await click('#library .lib-tidy-open');
    const tidy = await settle((p) => Array.isArray(tidyOf(p)) && (tidyOf(p) as string[]).length === 2);
    check(tidy && (tidyOf(tidy) as string[]).every((row) => /EU (SI|Settlement Instruction) email|Settlement instruction numbering/.test(row)), `Tidy duplicates lists the two pairs: ${JSON.stringify(tidyOf(tidy ?? (await probe()) as Probe))}`);
    const tidyRatio = await probe();
    check(tidyRatio && (tidyRatio.minRatio as number) >= MIN_RATIO, `Tidy duplicates is readable: ${tidyRatio?.minRatio}:1 ${JSON.stringify(tidyRatio?.worst)}`);
    await capture('library-tidy-duplicates');
    const before = (await probe())?.state.shown.length ?? 0;
    await click('#library .lib-tidy-row .lib-tidy-merge');
    const merged = await settle((p) => p.state.shown.length === before - 1 && (tidyOf(p) as string[]).length === 1);
    check(merged && /^Merged/.test((merged as Tidy).state.toast), `Merge folds one note into the other, with a toast: ${JSON.stringify(merged && (merged as Tidy).state.toast)}`);
    check(fs.readdirSync(path.join(dir, '.trash')).length === 1, 'the folded note is in the trash');
    await click('#library .lib-tidy-row .lib-tidy-keep');
    await settle((p) => (tidyOf(p) as string[]).length === 0);
    await click('#library .lib-tidy-open'); // closes
    await click('#library .lib-tidy-open');
    const none = await settle((p) => Array.isArray(tidyOf(p)) && (tidyOf(p) as string[]).length === 0);
    check(none && await js("document.querySelector('#library .lib-tidy .lib-confirm-text')?.textContent") === 'No likely duplicates left.', 'Keep both is remembered: nothing offered again');
    await click('#library .lib-tidy .lib-confirm-cancel');

    // Managing a note from its reading view: Rename moves the slug, Change category, Delete with Undo, Merge into.
    const openNote = async (title: string) => {
      const index = (await probe())?.state.shown.indexOf(title) ?? -1;
      await select(index);
      await key('Enter');
      return settle((p) => Boolean(p.reading) && p.readingTitle === title);
    };
    const manageClick = (label: string) => js(`[...document.querySelectorAll('#library .lib-manage-button')].find((b) => b.textContent === ${JSON.stringify(label)})?.click()`);
    const fillAndSave = async (value: string) => {
      await js(`(() => { const f = document.querySelector('#library .lib-manage-edit .lib-manage-input'); f.value = ${JSON.stringify(value)}; f.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#library .lib-manage-save').click(); })()`);
    };
    check(await openNote('Settlement instruction numbering'), 'a note opens to read with its manage buttons');
    check(JSON.stringify(await js("[...document.querySelectorAll('#library .lib-manage-button')].map((b) => b.textContent)")) === JSON.stringify(['Rename', 'Change category', 'Merge into…', 'Delete']), 'Rename, Change category, Merge into and Delete');
    await manageClick('Merge into…');
    await wait(200);
    const manageRatio = await probe();
    check(manageRatio && (manageRatio.minRatio as number) >= MIN_RATIO, `managing a note is readable: ${manageRatio?.minRatio}:1 ${JSON.stringify(manageRatio?.worst)}`);
    const firstPick = await js("document.querySelector('#library .lib-manage-edit select')?.options[0]?.textContent");
    check(firstPick === 'EU Settlement Instruction numbering (Payments)', `Merge into offers the likely duplicate first: ${JSON.stringify(firstPick)}`);
    await capture('library-manage-note');
    await manageClick('Rename');
    await fillAndSave('SI numbering rules');
    const renamed = await settle((p) => p.readingTitle === 'SI numbering rules');
    check(renamed && fs.existsSync(path.join(dir, 'si-numbering-rules.md')) && !fs.existsSync(path.join(dir, 'settlement-instruction-numbering.md')), 'Rename changes the title and moves the file to its new slug');
    await manageClick('Change category');
    await fillAndSave('operations');
    check(await waitFor(async () => (await js("document.querySelector('#library .lib-reading .lib-chip')?.textContent")) === 'Operations' || null, 3000), 'Change category reuses the starter spelling (Operations)');
    await manageClick('Delete');
    const gone = await settle((p) => !p.reading && !p.state.shown.includes('SI numbering rules') && /^Deleted/.test((p as Tidy).state.toast));
    check(gone && /^Deleted “SI numbering rules”\.Undo$/.test((gone as Tidy).state.toast), `Delete closes the note, toast with Undo: ${JSON.stringify(gone && (gone as Tidy).state.toast)}`);
    check(fs.readdirSync(path.join(dir, '.trash')).some((f) => f.startsWith('si-numbering-rules.')), 'the deleted note is in the trash');
    await js("document.querySelector('#library .lib-toast .lib-undo')?.click()");
    check(await settle((p) => p.state.shown.includes('SI numbering rules')), 'Undo brings it back');
    check(await openNote('SI numbering rules'), 'reopened');
    await manageClick('Merge into…');
    await js("(() => { const s = document.querySelector('#library .lib-manage-edit select'); s.value = [...s.options].find((o) => o.textContent.startsWith('EU Settlement Instruction numbering')).value; document.querySelector('#library .lib-manage-save').click(); })()");
    const into = await settle((p) => p.readingTitle === 'EU Settlement Instruction numbering');
    check(into && /restart every calendar year/.test(into.readingText as string) && /zero padded/.test(into.readingText as string), `Merge into opens the kept note with both notes’ facts: ${JSON.stringify(into ? into.readingText : (await probe())?.readingTitle)}`);
    await click('#library .lib-back');
    check(await settle((p) => !p.reading && !p.state.shown.includes('SI numbering rules')), 'the merged-away note leaves the dial');

    // Every theme and reading style.
    for (const theme of ['paleSky', 'blush', 'nightPastel']) {
      applyTheme(theme, { persist: false });
      for (const [look] of READING_CHOICES) {
        await setReading(look);
        await wait(150);
        const p = await probe();
        check(p && (p.minRatio as number) >= MIN_RATIO && (p.overflowX as number) <= 0, `${theme} ${look}: ${p?.minRatio}:1 ${JSON.stringify(p?.worst)}`);
        if (look === 'newspaper') {
          await key('Enter');
          await settle((q) => Boolean(q.reading));
          await wait(150);
          const r = await probe();
          check(r && (r.minRatio as number) >= MIN_RATIO && (r.overflowX as number) <= 0, `${theme} reading a note: ${r?.minRatio}:1`);
          if (theme === 'nightPastel') await capture('library-reading-night');
          await click('#library .lib-back');
          check(await settle((q) => !q.reading), `${theme}: Back returns from the note`);
        }
        if (look === 'newspaper' && theme === 'nightPastel') { await capture('library-night'); await capture('library-dial-colour-night'); }
        if (look === 'newspaper' && theme === 'blush') await capture('library-dial-colour-blush');
      }
    }
    applyTheme('paleSky', { persist: false });
    await setReading('newspaper');

    // Widths: no horizontal overflow, everything inside the window.
    for (const width of WIDTHS) {
      resizeOffscreen(win, width, 900);
      await wait(400);
      const p = await probe();
      check(p && (p.overflowX as number) <= 0 && p.inWindow && p.atThree, `${width}px: overflow ${p?.overflowX}, in window ${p?.inWindow}, at 3 o'clock ${p?.atThree}`);
      if (width === 800) await capture('library-800');
    }
    resizeOffscreen(win, 1280, 900);

    // Consent off: Allow shows, Add is off, notes stay readable; an empty Library offers Allow too.
    configStore.save({ claudeFolder: { choice: 'declined' } });
    await waitFor(async () => (await js("document.querySelector('#library .lib-past').disabled")) || null, 3000);
    const off = await settle((p) => Boolean(p.allow));
    check(off && /isn’t reading your Claude folder/.test(off.note as string) && await js("document.querySelector('#library .lib-past').disabled"), 'consent off: Allow line, Read past sessions disabled');
    const headerOff = await js("PastelTerm.libraryAdd.state()") as { disabled: boolean; title: string };
    check(headerOff.disabled && /Allow reading your Claude folder/.test(headerOff.title), `consent off: Add to Library is off and says why: ${JSON.stringify(headerOff)}`);
    fs.renameSync(dir, `${dir}-aside`);
    await js('PastelTerm.library.load()');
    const emptyOff = await settle((p) => Boolean(p.empty));
    check(emptyOff && /empty/.test(emptyOff.empty as string) && emptyOff.allow, `empty and consent off: ${JSON.stringify(emptyOff?.empty)}`);
    await capture('library-empty-off');
    configStore.save({ claudeFolder: { choice: 'allowed' } });
    const emptyOn = await settle((p) => !p.allow && /Turn on Build my Library/.test(p.empty as string));
    check(emptyOn, `empty, consent on, switch off: offers the setting: ${JSON.stringify(emptyOn?.empty)}`);
    fs.renameSync(`${dir}-aside`, dir);

    // The switch in Customize › Organizer saves, and stays off by default.
    check(configStore.load().library.autoBuild === false, 'Build my Library is off by default');
    await js("PastelTerm.customize.open('organizer')");
    const box = await waitFor(async () => (await js("(() => { const l = [...document.querySelectorAll('#customize label, #customize .cz-field')].find((n) => /Build my Library/.test(n.textContent)); return l ? Boolean(l.querySelector('input[type=checkbox]')) : null; })()")) || null, 3000);
    check(box, 'Customize › Organizer has the Build my Library switch');
    await js("(() => { const l = [...document.querySelectorAll('#customize label, #customize .cz-field')].find((n) => /Build my Library/.test(n.textContent)); const c = l.querySelector('input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()");
    check(await waitFor(() => configStore.load().library.autoBuild || null, 3000), 'turning it on saves library.autoBuild');
    configStore.save({ library: { autoBuild: false } });
    await js('PastelTerm.overlays.hideCurrent()');

    // Esc on the dial closes the Library.
    await click('#library-button');
    await settle();
    await key('Escape');
    check(await waitFor(async () => (await js("document.getElementById('library').hidden")) || null, 3000), 'Esc closes the Library');
  } finally {
    libraryFixture.extract = null;
    configStore.save({ claudeFolder: { choice: 'allowed' }, library: { autoBuild: false } });
    if (fs.existsSync(`${dir}-aside`)) fs.renameSync(`${dir}-aside`, dir);
    if (sessionsBefore === null) fs.rmSync(sessionsFile, { force: true }); else fs.writeFileSync(sessionsFile, sessionsBefore);
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
