// Magazine · Book look: picked from Customize, then the Print sample reply captured in light and dark.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { OPEN_SECTIONS } from './snapshot-reader-collapse';
import { printUpdate } from './snapshot-print';

const BOOK_PAPER = 'rgb(239, 239, 239)';

export async function bookLookCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} book look: ${what}`);

  await js("PastelTerm.customize.open('look')");
  await js("[...document.querySelectorAll('.cz-chip')].find((c) => c.textContent === 'Magazine · Book').click()");
  const picked = await waitFor(async () => (await js('document.documentElement.dataset.reading')) === 'book', 5000);
  check(picked, 'chip sets data-reading=book');
  await js('PastelTerm.customize.close()');

  await js(`PastelTerm.reader.update(${JSON.stringify(printUpdate)}); ${OPEN_SECTIONS}`);
  await waitFor(() => js("document.getElementById('latest').dataset.replyId === 'print-new' || null"), 5000);

  // The page's defining traits: justified body, indented follow-on paragraphs with no gap, an unboxed italic pull quote.
  const shape = await js(`(() => {
    const ps = [...document.querySelectorAll('#latest .section-body > p')];
    const second = ps.find((p) => p.previousElementSibling?.tagName === 'P');
    const quote = document.querySelector('#latest blockquote.pull-quote');
    const q = quote && getComputedStyle(quote);
    return {
      align: ps[0] && getComputedStyle(ps[0]).textAlign,
      indent: second && getComputedStyle(second).textIndent,
      gap: ps[0] && getComputedStyle(ps[0]).marginBottom,
      quote: q && { style: q.fontStyle, border: q.borderTopWidth, size: q.fontSize },
    };
  })()`);
  check(shape.align === 'justify' && shape.indent !== '0px' && shape.gap === '0px' && shape.quote?.style === 'italic' && shape.quote?.border === '0px', `book page shape: ${JSON.stringify(shape)}`);

  // Newest reply last at every width, like the other looks.
  const order = await js(`(() => {
    const older = document.getElementById('older');
    const latest = document.getElementById('latest').getBoundingClientRect();
    const hasOlder = older && older.getBoundingClientRect().height > 0;
    return { width: innerWidth, hasOlder, olderAbove: !hasOlder || older.getBoundingClientRect().bottom <= latest.top + 1 };
  })()`);
  check(order.olderAbove, `newest reply below earlier turns: ${JSON.stringify(order)}`);

  // Doing / Recommend / Next pin on the left of the text and stay on screen while the reply scrolls.
  const pin = await js(`(async () => {
    const r = document.getElementById('reader');
    const block = document.querySelector('#latest > .prose > .status-block');
    const text = document.querySelector('#latest > .prose > .story-section');
    if (!block || !text) return { found: false };
    const left = block.getBoundingClientRect().right <= text.getBoundingClientRect().left;
    const latest = document.getElementById('latest');
    r.scrollTop = latest.offsetTop + latest.offsetHeight / 2 - r.clientHeight / 2; // middle of the newest reply
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const b = block.getBoundingClientRect(), view = r.getBoundingClientRect();
    const strip = document.getElementById('reader-status-strip');
    return { found: true, left, pinned: b.top >= view.top && b.bottom <= view.bottom, stripHidden: !strip || getComputedStyle(strip).display === 'none', barHidden: getComputedStyle(document.getElementById('reader-banners-bar')).display === 'none' };
  })()`);
  check(pin.found && pin.left && pin.pinned && pin.stripHidden && pin.barHidden, `status lines pinned left of the text: ${JSON.stringify(pin)}`);
  await js("document.getElementById('reader').scrollTop = 0");

  for (const id of ['paleSky', 'nightPastel', 'black']) {
    applyTheme(id, { persist: false });
    const want = themes[id].dark ? null : BOOK_PAPER;
    await wait(400);
    const bg = await js("getComputedStyle(document.getElementById('reader')).backgroundColor");
    check(!want || bg === want, `${id} paper ${bg}`);
    // Latest reply's opening, then the section that holds the pull quote.
    for (const [suffix, target] of [['', '#latest .story-head'], ['-quote', '#latest blockquote.pull-quote']]) {
      await js(`(() => { const r = document.getElementById('reader'); const s = document.querySelector(${JSON.stringify(target)}); r.scrollTop = s.getBoundingClientRect().top - r.getBoundingClientRect().top + r.scrollTop - 24; })()`);
      win.webContents.invalidate();
      await wait(300);
      await capture(`book-${id}${suffix}`);
    }
  }

  // Other views take the same paper, not the theme's cream.
  applyTheme('paleSky', { persist: false });
  await js('PastelTerm.history.open()');
  await wait(400);
  const historyBg = await js("getComputedStyle(document.getElementById('history')).backgroundColor");
  check(historyBg === BOOK_PAPER, `History on book paper ${historyBg}`);
  await capture('book-paleSky-history');
  await js('PastelTerm.history.close()');

  await js("window.pastel.look.setReading('newspaper')");
  check(await waitFor(async () => (await js('document.documentElement.dataset.reading')) === 'newspaper', 5000), 'back to Newspaper');
}
