// Reader collapse: in every look, a reply's ## sections start folded under the summary and strip, open on click,
// open together with Expand all, keep what she opened while the reply streams, and a reply without ## is unchanged.
// The same in an earlier turn and in History's preview.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { addStatusFixture, FIXTURE_STATUS } from './snapshot-history-fixture';
import { READING_CHOICES } from '../main/menu';

// Other checks that measure inside sections open them first; idempotent, and the reader remembers it per reply.
export const OPEN_SECTIONS = "document.querySelectorAll('.story-section.folded > h2.foldable').forEach((h) => h.click())";

const SECTIONED = [
  '**Sections now fold under the summary.**',
  '',
  '**Abstract.** The headline, abstract and status lines stay open; every section below folds under its heading.',
  '',
  'One more intro paragraph that stays in the summary, above the first section.',
  '',
  '## 1. What changed',
  '',
  'Each heading is a row with a chevron. A ==highlighted phrase== keeps its colour once the section opens.',
  '',
  '> **At a glance**',
  '> - Folded by default',
  '> - Expand all opens every one',
  '',
  '## 2. Why it matters',
  '',
  'The summary is what she reads first; the detail is one click away.',
  '',
  '## References',
  '',
  '- `src/renderer/fold.ts`',
  '',
  '**Doing:** folding sections under the summary.',
  '**Recommend:** keep them folded by default.',
  '**Next:** open a long reply and try Expand all.',
].join('\n');

// The same reply after one more section streamed in.
const STREAMED = SECTIONED.replace('## References', '## 3. Arrived mid-stream\n\nThis section came in after she opened the first.\n\n## References');

const PLAIN = [
  '**No sections here.**',
  '',
  'A short reply with no headings renders exactly as before.',
  '',
  '**Doing:** nothing new.',
  '**Recommend:** leave it.',
  '**Next:** nothing.',
].join('\n');

const OLDER = '**Earlier turn.**\n\nIts own summary.\n\n## Detail\n\nFolded too.';

const updateOf = (look: string, latest: string) => ({
  state: 'live',
  replies: [
    { id: `collapse-new-${look}`, timestamp: '2026-10-09T09:30:00.000Z', prompt: 'make the paragraphs collapsible', markdown: latest },
    { id: `collapse-old-${look}`, timestamp: '2026-10-09T09:12:00.000Z', prompt: 'summary first please', markdown: OLDER },
  ],
});

// Folded state, visibility and order of one rendered reply.
const PROBE = (root: string) => `(() => {
  const prose = document.querySelector(${JSON.stringify(`${root} .prose`)});
  if (!prose) return null;
  const shown = (el) => Boolean(el) && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const sections = [...prose.querySelectorAll(':scope > .story-section')];
  const kids = [...prose.children];
  const at = (sel) => kids.findIndex((k) => k.matches(sel));
  const mark = prose.querySelector('.story-section mark');
  return {
    order: kids.map((k) => k.classList[0] ?? k.nodeName),
    sections: sections.length,
    folded: sections.map((s) => s.classList.contains('folded')),
    bodyShown: sections.map((s) => [...s.querySelectorAll(':scope > :not(h2) :is(p, li, blockquote)')].some(shown)), // body and rail are display: contents
    headingShown: sections.map((s) => shown(s.querySelector(':scope > h2'))),
    expanded: sections.map((s) => s.querySelector('.fold-toggle')?.getAttribute('aria-expanded')),
    toggleIsButton: sections.every((s) => s.querySelector(':scope > h2 > button.fold-toggle[type=button]')),
    head: at('.story-head'), strip: at('.status-block'), bar: at('.fold-bar'), first: at('.story-section'),
    stripInSection: Boolean(prose.querySelector('.story-section .status-block')),
    allLabel: prose.querySelector('.fold-all')?.textContent ?? null,
    bars: prose.querySelectorAll('.fold-bar').length,
    foldables: prose.querySelectorAll('.foldable').length,
    mark: mark ? { shown: shown(mark), bg: getComputedStyle(mark).backgroundColor } : null,
  };
})()`;

const click = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.click()`;

export async function readerCollapseCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} reader collapse: ${what}`);
  const probe = (root: string) => js(PROBE(root));
  // The fixture feed can redraw its own reply: send ours and wait until #latest shows it.
  const show = async (look: string, markdown: string) => {
    await js(`PastelTerm.reader.update(${JSON.stringify(updateOf(look, markdown))})`);
    return waitFor(async () => (await js(`document.getElementById('latest').dataset.replyId === ${JSON.stringify(`collapse-new-${look}`)}`)) || null, 5000);
  };
  // Picture of our reply from `from` down; recaptured if the fixture feed swapped the reply in the meantime.
  const captureReply = async (look: string, markdown: string, name: string, from: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await show(look, markdown);
      await js(`(() => { const r = document.getElementById('reader'); r.scrollTop += document.querySelector(${JSON.stringify(`#latest ${from}`)}).getBoundingClientRect().top - r.getBoundingClientRect().top - 16; })()`);
      await wait(300);
      await capture(name);
      if (await js(`document.getElementById('latest').dataset.replyId === ${JSON.stringify(`collapse-new-${look}`)}`)) return;
    }
    log(`FAIL reader collapse: ${name} kept losing the reply to a feed redraw`);
  };
  const allFolded = (p: { folded: boolean[]; bodyShown: boolean[] }) => p.folded.every(Boolean) && !p.bodyShown.some(Boolean);

  await js('PastelTerm.getStarted.close()'); // a fresh profile opens on Get started, over the reader
  await js("PastelTerm.reader.setView('replies')");
  const [startWidth, startHeight] = win.getContentSize();
  resizeOffscreen(win, 1280, 2000); // tall enough that the reader pane holds a whole reply
  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    check(await show(look, SECTIONED), `${look} sectioned reply shown`);
    await wait(300);

    const start = await probe('#latest');
    check(start?.sections === 3 && allFolded(start) && start.headingShown.every(Boolean) && start.expanded.every((e: string) => e === 'false'),
      `${look} sections start folded, headings visible: ${JSON.stringify({ folded: start?.folded, bodyShown: start?.bodyShown, headingShown: start?.headingShown, expanded: start?.expanded })}`);
    check(start && start.head === 0 && start.strip === 1 && start.bar > start.strip && start.bar < start.first && !start.stripInSection,
      `${look} summary, then the strip, then the control, then sections: ${JSON.stringify(start?.order)}`);
    check(start?.toggleIsButton && start.allLabel === 'Expand all', `${look} each row has a button chevron; control reads Expand all (${start?.allLabel})`);
    check(start?.mark && !start.mark.shown, `${look} highlight inside a folded section is hidden: ${JSON.stringify(start?.mark)}`);
    const older = await probe('#older .older-turn');
    check(older?.sections === 1 && allFolded(older), `${look} earlier turn folds too: ${JSON.stringify(older?.folded)}`);
    await captureReply(look, SECTIONED, `collapse-${look}-folded`, '.story-head');

    // Clicking the heading row opens that section only.
    await show(look, SECTIONED);
    await js(click('#latest .story-section:nth-of-type(1) > h2'));
    const one = await probe('#latest');
    check(one && one.folded.join() === 'false,true,true' && one.bodyShown[0] && !one.bodyShown[1] && one.expanded[0] === 'true',
      `${look} clicking the first heading opens it alone: ${JSON.stringify({ folded: one?.folded, bodyShown: one?.bodyShown })}`);
    check(one?.mark?.shown && one.mark.bg !== 'rgba(0, 0, 0, 0)', `${look} the highlight shows with its colour once open: ${JSON.stringify(one?.mark)}`);

    // A section streaming in keeps the first open and arrives folded.
    await show(look, STREAMED);
    await wait(200);
    const streamed = await probe('#latest');
    check(streamed && streamed.sections === 4 && streamed.folded.join() === 'false,true,true,true',
      `${look} redraw with a new section keeps what she opened: ${JSON.stringify(streamed?.folded)}`);

    // Expand all opens every section; the control then offers Collapse all.
    await show(look, STREAMED);
    await js(click('#latest .fold-all'));
    const opened = await probe('#latest');
    check(opened && opened.folded.every((f: boolean) => !f) && opened.bodyShown.every(Boolean) && opened.allLabel === 'Collapse all',
      `${look} Expand all opens all: ${JSON.stringify({ folded: opened?.folded, label: opened?.allLabel })}`);
    await captureReply(look, STREAMED, `collapse-${look}-expanded`, '.fold-bar');
    await js(click('#latest .fold-all'));
    const closed = await probe('#latest');
    check(closed && allFolded(closed) && closed.allLabel === 'Expand all', `${look} Collapse all folds them again: ${JSON.stringify(closed?.folded)}`);

    // No ## sections: no fold parts, and the strip stays where she wrote it.
    await show(look, PLAIN);
    await wait(200);
    const plain = await probe('#latest');
    check(plain && plain.sections === 0 && plain.bars === 0 && plain.foldables === 0 && plain.order.join() === 'story-head,status-block',
      `${look} reply without sections unchanged: ${JSON.stringify(plain?.order)}`);
  }

  // History's preview folds the same way.
  await js("window.pastel.look.setReading('newspaper')");
  const removeFixture = addStatusFixture(outDir, SECTIONED);
  try {
    await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(FIXTURE_STATUS)}); return PastelTerm.history.setPreviewMode('replies'); })`);
    const root = '#history-preview .history-reply';
    const ready = await waitFor(() => js(`Boolean(document.querySelector(${JSON.stringify(`${root} .story-section`)}))`), 8000);
    const history = await probe(root);
    check(ready && history?.sections === 3 && allFolded(history) && history.strip === 1 && history.bar < history.first,
      `History preview folds, strip under the abstract: ${JSON.stringify({ folded: history?.folded, order: history?.order })}`);
    await js(click(`${root} .story-section > h2`));
    const opened = await probe(root);
    check(opened?.folded[0] === false && opened.bodyShown[0], `History preview heading opens its section: ${JSON.stringify(opened?.folded)}`);
    await capture('collapse-history');
  } finally {
    await js('PastelTerm.history.close()');
    removeFixture();
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
