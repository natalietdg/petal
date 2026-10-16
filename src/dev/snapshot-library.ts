// Library: fixture notes on the half dial A to Z, arrows turn it, sort and category filter reorder and narrow it,
// Enter reads a note and Back returns, Add from this session merges a stubbed answer (never a real claude),
// consent off shows Allow and the empty state, and every theme, reading style and width stays readable and in the window.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import * as configStore from '../main/config-store';
import { resizeOffscreen } from '../main/snapshot-window';
import { libraryFixture } from '../main/snapshot-mode';
import { serializeNote } from '../main/library-store';
import { READING_CHOICES } from '../main/menu';

const MIN_RATIO = 4.5;
const WIDTHS = [800, 1280, 1600];
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
];

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

const PROBE = `(() => {
  const view = document.getElementById('library');
  if (!view || view.hidden) return null;
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const texts = [...view.querySelectorAll('.lib-title, .lib-summary, .lib-sort-button, .lib-filter, .lib-add, .lib-tab-name, .lib-tab.selected .lib-tab-cat, .lib-letter, .lib-chip, .lib-preview-title, .lib-preview-meta, .lib-preview-facts li, .lib-read, .lib-note span, .lib-link, .lib-empty-title, .lib-empty-text, .lib-back, .lib-reading-title, .lib-reading .prose li')].filter(visible);
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
  type Probe = { state: { sort: string; category: string | null; text: string; selected: number; shown: string[] }; [k: string]: unknown };
  const probe = (): Promise<Probe | null> => js(PROBE);
  const settle = async (want: (p: Probe) => boolean = () => true) => waitFor(async () => { const p = await probe(); return p && want(p) ? p : null; }, 5000);
  const key = (k: string) => js(`document.querySelector('#library .lib-list').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const setReading = async (look: string) => {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
  };
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
    await wait(400); // the first layout settles
    const three = await probe();
    check(three?.atThree, `the selected note sits at 3 o'clock, right of the pointer: ${JSON.stringify(three?.threeGap)}`);
    check(opened && opened.dialLeft === 0, `the dial's flat side is on the window's left edge: ${opened?.dialLeft}`);
    check(opened && (opened.letters as string[]).includes('A') && (opened.letters as string[]).includes('C'), `rim letters: ${JSON.stringify(opened?.letters)}`);
    check(three && (three.options as number) < az.length && (three.options as number) >= 8, `a full dial wraps, notes above and below 3 o'clock: ${three?.options}`);
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

    // Add from this session: the stub answers; the note appears; the prompt carried the session.
    const prompts: string[] = [];
    libraryFixture.extract = async (prompt) => {
      prompts.push(prompt);
      return JSON.stringify({ result: JSON.stringify({ topics: [{ topic: 'Invoice numbering', category: 'billing', facts: ['Invoice numbers are sequential per account and never reused.'], evidence: 'fixture session' }] }) });
    };
    const live = await js('Boolean(PastelTerm.tabs.active()?.update?.sessionId)');
    if (live) {
      await click('#library .lib-add');
      const added = await settle((p) => p.state.shown.includes('Invoice numbering'));
      check(added && prompts.length === 1 && /Added 1 note/.test(added.note as string), `Add from this session merges a stubbed answer: ${JSON.stringify(added?.note)}`);
      check(fs.readFileSync(path.join(dir, 'invoice-numbering.md'), 'utf8').includes('category: Billing'), 'its category reuses the starter spelling (Billing)');
      await click('#library .lib-add');
      const again = await settle((p) => /No new domain knowledge/.test(p.note as string));
      check(again && prompts.length === 1, 'a second add with nothing new calls nothing');
    } else check(false, 'the fixture tab has a session for Add from this session');
    libraryFixture.extract = null;

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
          await settle((q) => !q.reading);
        }
        if (look === 'newspaper' && theme === 'nightPastel') await capture('library-night');
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
    await waitFor(async () => (await js("document.querySelector('#library .lib-add').disabled")) || null, 3000);
    const off = await settle((p) => Boolean(p.allow));
    check(off && /isn’t reading your Claude folder/.test(off.note as string) && await js("document.querySelector('#library .lib-add').disabled"), 'consent off: Allow line, Add disabled');
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
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
