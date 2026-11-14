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

  // Margin notes: every section's rail sits on the left page, beside and level with its own text.
  await js("document.getElementById('reader').scrollTop = 0"); // at rest; scrolled, sticky notes follow their section down
  await wait(200);
  const notes = await js(`(() => [...document.querySelectorAll('#latest .story-section:not(.folded) > .rail')].map((rail) => {
    const r = rail.getBoundingClientRect();
    const body = rail.parentElement.querySelector(':scope > .section-body').getBoundingClientRect();
    const head = document.querySelector('#latest .story-head').getBoundingClientRect();
    const h2 = rail.parentElement.querySelector(':scope > h2').getBoundingClientRect();
    return { left: r.right <= body.left, level: Math.abs(r.top - h2.top) < 40, offset: Math.round(r.top - h2.top), clearOfHead: r.top >= head.bottom - 1, shown: r.height > 0 };
  }))()`);
  check(notes.length > 0 && notes.every((n: Record<string, boolean | number>) => n.left && n.level && n.clearOfHead && n.shown), `margin notes on the left page: ${JSON.stringify(notes)}`);

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

  applyTheme('paleSky', { persist: false });
  await js("window.pastel.look.setReading('newspaper')");
  check(await waitFor(async () => (await js('document.documentElement.dataset.reading')) === 'newspaper', 5000), 'back to Newspaper');
}
