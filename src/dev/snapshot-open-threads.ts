// Open threads: in every theme and every reading style, the cards render visible, unclipped and
// readable, the Checked line and Assumed sidebar get their classes, a card click goes out through the reply box's
// send path (her draft left alone), every width and focus mode keep the cards whole, and a reply without them is unchanged.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { claudeStarts, pasteWrites } from '../main/snapshot-mode';
import { READING_CHOICES } from '../main/menu';

const MIN_RATIO = 4.5;
const WIDTHS = [800, 990, 1280, 1600];
const LONG_PATH = '/Users/you/Code/side-projects/pastel-threads/src/renderer/some/deeply/nested/folder/with/a/very-long-file-name.ts';
export const FIRST_THREAD = 'Does the History preview send to the right session? Check: open History and click a card.';

export const THREADS_REPLY = [
  '**Open threads now close each reply.**',
  '',
  'Each reply ends with the questions it left open, as cards you click to ask next.',
  '',
  '**Checked:** `src/renderer/fold.ts`, `npx vitest run`, the shape guide',
  '',
  '## What changed',
  '',
  'The reader turns the last section into cards. A click sends the question and its check through the reply box, so Claude knows what to run.',
  '',
  '> **Assumed**',
  '> - The reader shows the active tab',
  '> - Cards should send the check too',
  '',
  '> **At a glance**',
  '> - Three cards at most',
  '',
  '## Open threads',
  '',
  '- Does the History preview send to the right session? *Check: open History and click a card.*',
  '- Should a card hide once asked? *Check: a week of use.*',
  `- Is a long question with \`inline code\` and ${LONG_PATH} still readable? *Check: resize to 800px.*`,
  '',
  '## References',
  '',
  '- `src/renderer/open-threads.ts`',
].join('\n');

// No blocks: a plain list, a plain sidebar, a "Checked out" paragraph and References stay as they were.
const PLAIN_REPLY = [
  '**Nothing open here.**',
  '',
  'A reply without the new blocks.',
  '',
  '**Checked out** the branch first.',
  '',
  '## Notes',
  '',
  '- A plain item. Check: it stays plain.',
  '',
  '> **At a glance**',
  '> - One fact',
  '',
  '## References',
  '',
  '- `src/renderer/markdown.ts`',
].join('\n');

const updateOf = (id: string, markdown: string) => ({
  state: 'live',
  replies: [{ id, timestamp: '2026-10-15T10:30:00.000Z', prompt: 'add open threads', markdown }],
});

// Cards, Checked line and Assumed box of #latest: classes, visibility, clipping and text contrast on what's behind.
const PROBE = `(() => {
  const prose = document.querySelector('#latest .prose');
  if (!prose) return null;
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const shown = (el) => Boolean(el) && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const box = prose.getBoundingClientRect();
  const reader = document.getElementById('reader');
  const cards = [...prose.querySelectorAll('ul.threads > li.thread > button.thread-card')];
  const section = prose.querySelector('.story-section.threads-section');
  const checked = prose.querySelector('p.checked-line');
  const assumed = prose.querySelector('blockquote.sidebar.assumed');
  const plainSidebar = prose.querySelector('blockquote.sidebar:not(.assumed)');
  const texts = (card) => [card.querySelector('.thread-question'), card.querySelector('.thread-check'), card.querySelector('.thread-ask')].filter(Boolean);
  return {
    sectionOpen: Boolean(section) && !section.classList.contains('folded'),
    headingBack: Boolean(section?.querySelector(':scope > h2.back-matter.threads-heading')),
    beforeRefs: Boolean(section) && [...prose.querySelectorAll(':scope > .story-section')].indexOf(section) === prose.querySelectorAll(':scope > .story-section').length - 2,
    cards: cards.length,
    shown: cards.every(shown),
    clipped: cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1 || c.scrollWidth > c.clientWidth + 1; }).length,
    questions: cards.map((c) => c.querySelector('.thread-question')?.textContent.trim() ?? ''),
    checks: cards.map((c) => c.querySelector('.thread-check')?.textContent.trim() ?? null),
    cardRatio: Math.min(...cards.flatMap((c) => texts(c).map(ratio))),
    checked: checked ? { inHead: Boolean(checked.closest('header.story-head')), label: checked.querySelector('.checked-label')?.textContent ?? null, shown: shown(checked), ratio: ratio(checked) } : null,
    assumed: assumed ? { shown: shown(assumed), ratio: Math.min(...[...assumed.querySelectorAll('p, li')].map(ratio)), tinted: getComputedStyle(assumed).backgroundColor !== (plainSidebar ? getComputedStyle(plainSidebar).backgroundColor : '') || getComputedStyle(assumed).borderTopColor !== getComputedStyle(plainSidebar ?? assumed).borderTopColor, inRail: Boolean(assumed.closest('.rail')) && getComputedStyle(assumed.closest('.rail')).display === 'block' } : null,
    readerOverflow: reader ? reader.scrollWidth - reader.clientWidth : null,
  };
})()`;

const PLAIN_PROBE = `(() => {
  const prose = document.querySelector('#latest .prose');
  if (!prose) return null;
  return {
    added: prose.querySelectorAll('.threads, .thread-card, .threads-section, .threads-heading, .checked-line, .checked-label, .assumed').length,
    plainItem: prose.querySelector('.story-section:not(.back) ul > li')?.textContent.trim() ?? null,
    sidebars: prose.querySelectorAll('blockquote.sidebar').length,
    refs: Boolean(prose.querySelector('.story-section.back > h2.back-matter')),
    checkedOut: [...prose.querySelectorAll('p')].some((p) => /Checked out/.test(p.textContent) && p.firstElementChild?.nodeName === 'STRONG'),
  };
})()`;

export async function openThreadsCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} open threads: ${what}`);
  let shownId = 0;
  // The fixture feed can redraw its own reply: send ours and wait until #latest shows it, every section open.
  const show = async (markdown: string) => {
    const id = `threads-${++shownId}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      await js(`PastelTerm.reader.update(${JSON.stringify(updateOf(id, markdown))})`);
      const ok = await waitFor(async () => (await js(`document.getElementById('latest').dataset.replyId === ${JSON.stringify(id)}`)) || null, 5000);
      if (ok) break;
    }
    await js(`(() => { const all = document.querySelector('#latest .fold-all'); if (all && /Expand/.test(all.textContent)) all.click(); })()`);
    await wait(250);
  };
  const setReading = async (look: string) => {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
  };
  const scrollToHead = () => js(`(() => { const r = document.getElementById('reader'); r.scrollTop += document.querySelector('#latest .story-head').getBoundingClientRect().top - r.getBoundingClientRect().top - 16; })()`);
  // A feed redraw can land during the capture's wait: retake it with our reply back in place.
  const captureShown = async (name: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await capture(name);
      if (await js(`document.getElementById('latest').dataset.replyId === 'threads-${shownId}'`)) return;
      await show(THREADS_REPLY);
      await scrollToHead();
    }
    log(`FAIL open threads: ${name} kept losing the reply to a feed redraw`);
  };
  const assertLook = async (name: string) => {
    const p = await js(PROBE);
    check(p && p.sectionOpen && p.headingBack && p.beforeRefs && p.cards === 3 && p.shown && p.clipped === 0 && p.readerOverflow === 0,
      `${name} three cards open, visible, unclipped, before References: ${JSON.stringify({ open: p?.sectionOpen, cards: p?.cards, shown: p?.shown, clipped: p?.clipped, overflow: p?.readerOverflow })}`);
    check(p && p.cardRatio >= MIN_RATIO, `${name} card text contrast ${p?.cardRatio}:1`);
    check(p?.checked && p.checked.inHead && p.checked.label === 'Checked' && p.checked.shown && p.checked.ratio >= MIN_RATIO, `${name} Checked line under the dek: ${JSON.stringify(p?.checked)}`);
    check(p?.assumed && p.assumed.shown && p.assumed.tinted && p.assumed.ratio >= MIN_RATIO, `${name} Assumed sidebar tinted and readable: ${JSON.stringify(p?.assumed)}`);
    return p;
  };

  await js('PastelTerm.welcome.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  await js("PastelTerm.reader.setView('replies')");
  const [startWidth, startHeight] = win.getContentSize();
  const terminalWasMin = await js('PastelTerm.layout.isTerminalMinimised()');
  if (!terminalWasMin) await js('PastelTerm.layout.toggleTerminalMinimised()'); // the reader gets the window
  try {
    resizeOffscreen(win, 990, 1600);
    await show(THREADS_REPLY);

    // Parsing: questions and checks split, the label not repeated.
    const parsed = await js(PROBE);
    check(parsed?.questions[0] === 'Does the History preview send to the right session?' && parsed.checks[0] === 'Check open History and click a card.' && parsed.checks[2] === 'Check resize to 800px.',
      `questions and checks split: ${JSON.stringify({ q: parsed?.questions, c: parsed?.checks })}`);

    // Every theme by every reading style.
    for (const theme of ['paleSky', 'blush', 'nightPastel']) {
      applyTheme(theme, { persist: false });
      for (const [look] of READING_CHOICES) {
        await setReading(look);
        await show(THREADS_REPLY);
        await assertLook(`${theme} ${look}`);
        const shots = [...(look === 'newspaper' ? [`threads-theme-${theme}`] : []), ...(theme === 'paleSky' ? [`threads-reading-${look}`] : [])];
        if (shots.length) await scrollToHead();
        for (const shot of shots) await captureShown(shot);
      }
    }
    applyTheme('paleSky', { persist: false });

    // The width sweep in every reading style; the magazine rails take the Assumed box when they open.
    for (const [look] of READING_CHOICES) {
      await setReading(look);
      for (const width of WIDTHS) {
        resizeOffscreen(win, width, 1600);
        await wait(300);
        await show(THREADS_REPLY);
        const p = await assertLook(`${look} at ${width}px`);
        if (look === 'editorial' && width >= 1280) check(p?.assumed?.inRail, `editorial at ${width}px hangs Assumed in the rail`);
      }
    }
    resizeOffscreen(win, 990, 1600);

    // Focus mode.
    await setReading('newspaper');
    await js('PastelTerm.focusMode.setLevel("focus")');
    await wait(400);
    await show(THREADS_REPLY);
    await assertLook('focus');
    await js('PastelTerm.focusMode.setLevel("normal")');
    await wait(300);

    // A click sends through the reply box's path: pasted to a live Claude, else Claude starts with it.
    await show(THREADS_REPLY);
    await js("document.getElementById('composer-input').value = 'my draft'");
    const live = await js("PastelTerm.tabs.active()?.update?.state === 'live'");
    const tabId = await js('PastelTerm.tabs.active()?.id');
    const pastesBefore = pasteWrites.length;
    const startsBefore = claudeStarts.length;
    await js("document.querySelector('#latest ul.threads > li.thread:first-child > .thread-card').click()");
    const sent = live
      ? await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.tabId === tabId) ?? null, 6000)
      : await waitFor(() => claudeStarts.slice(startsBefore).find((s) => s.tabId === tabId) ?? null, 6000);
    const text = sent && 'data' in sent ? sent.data : sent && 'command' in sent ? sent.command : '';
    const want = live ? `\x1b[200~${FIRST_THREAD}\x1b[201~\r` : FIRST_THREAD;
    check(live ? text === want : text.includes(FIRST_THREAD), `card click sends ${live ? 'a paste to the live Claude' : 'a Claude start'}: ${JSON.stringify(text)}`);
    check(await js("document.getElementById('composer-input').value === 'my draft'"), 'her draft in the reply box stays');
    await js("document.getElementById('composer-input').value = ''");

    // A link inside a card opens its page instead of sending; the send's echo redrew the reader, so show the reply again.
    await show(THREADS_REPLY);
    const linkBefore = pasteWrites.length + claudeStarts.length;
    await js(`(() => { const a = document.createElement('a'); a.href = '#'; a.textContent = 'x'; a.addEventListener('click', (e) => e.preventDefault()); document.querySelector('#latest .thread-question').append(a); a.click(); a.remove(); })()`);
    await wait(500);
    check(pasteWrites.length + claudeStarts.length === linkBefore, 'a link inside a card does not send');

    // A reply without the blocks renders as before.
    await show(PLAIN_REPLY);
    const plain = await js(PLAIN_PROBE);
    check(plain && plain.added === 0 && plain.plainItem === 'A plain item. Check: it stays plain.' && plain.sidebars === 1 && plain.refs && plain.checkedOut,
      `reply without the section unchanged: ${JSON.stringify(plain)}`);
  } finally {
    if (!terminalWasMin) await js('PastelTerm.layout.toggleTerminalMinimised()');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
