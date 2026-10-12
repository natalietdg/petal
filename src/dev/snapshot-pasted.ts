// Her message with a Claude Code paste wrapper: no raw tags, a "Pasted" label, long URLs wrapping inside the bubble.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeTo } from './snapshot-tables';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';

const WIDTHS = [990, 1280];
const THEMES = ['paleSky', 'nightPastel']; // one light, one dark
const EDGE_TOLERANCE_PX = 0.5;

// Made-up URLs; the img would set a flag if the paste were ever parsed as HTML.
const PASTED_PROMPT = [
  'Here are the two tickets',
  '<pasted_content id="2233">',
  'https://dev.example.test/ExampleOrg/Product%20Backlog/_workitems/edit/48213?view=edit&fullScreen=true&tracking=a-very-long-unbroken-token',
  'https://dev.example.test/ExampleOrg/Product%20Backlog/_git/sample-service?path=/src/deeply/nested/module/handler.ts&version=GBmain&line=120',
  '',
  'Can u figure out which api is being used by this screen <img src=x onerror="window.__pastedXss=1">',
  '</pasted_content id="2233">',
  'Answer short please.',
].join('\n');

const pastedUpdate = {
  state: 'live',
  replies: [
    { id: 'pasted-new', timestamp: '2026-10-08T10:00:00.000Z', prompt: PASTED_PROMPT, markdown: '**It is the work items API.**\n\nBoth links read from the same endpoint.' },
    { id: 'pasted-old', timestamp: '2026-10-08T09:50:00.000Z', prompt: `<pasted_content id="1">\n${PASTED_PROMPT.split('\n')[2]}\n</pasted_content>`, markdown: 'An earlier reply.' },
  ],
};

const MEASURE = `(() => [...document.querySelectorAll('#reader .reader-you')].map((b) => ({
  latest: Boolean(b.closest('#latest')),
  raw: b.textContent.includes('<pasted_content') || b.textContent.includes('</pasted_content'),
  labels: [...b.querySelectorAll('.prompt-pasted-label')].map((l) => l.textContent),
  typed: [...b.querySelectorAll('.prompt-typed')].map((t) => t.textContent),
  html: b.querySelectorAll('img, script').length,
  scrollWidth: b.scrollWidth, clientWidth: b.clientWidth,
  right: Math.round(b.getBoundingClientRect().right * 10) / 10,
  columnRight: Math.round(b.closest('.reader-column').getBoundingClientRect().right * 10) / 10,
})))()`;

export async function pastedCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} pasted: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();

  // The fixture feed can redraw its own reply; re-send the sample whenever it is gone.
  const showSample = async () => {
    if (await js("document.getElementById('latest').dataset.replyId === 'pasted-new'")) return true;
    await js(`PastelTerm.reader.update(${JSON.stringify(pastedUpdate)})`);
    return waitFor(() => js("document.getElementById('latest').dataset.replyId === 'pasted-new'"), 5000);
  };
  check(await showSample(), 'sample with a pasted_content prompt shown');

  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      for (const width of WIDTHS) {
        const tag = `${look} ${theme} ${width}px`;
        check(await resizeTo(kit, win, width), `${tag} window resized`);
        await showSample();
        await wait(300);
        const bubbles = await js(MEASURE);
        check(bubbles.length === 2, `${tag} two bubbles (${bubbles.length})`);
        bubbles.forEach((b: { raw: boolean; labels: string[]; typed: string[]; html: number; scrollWidth: number; clientWidth: number; right: number; columnRight: number }, i: number) => {
          const name = `${tag} bubble ${i + 1}`;
          check(!b.raw, `${name} shows no pasted_content tag`);
          check(b.labels.length === 1 && b.labels[0] === 'Pasted', `${name} has one "Pasted" label: ${JSON.stringify(b.labels)}`);
          check(b.html === 0, `${name} renders the paste as text, no img/script elements`);
          check(b.scrollWidth <= b.clientWidth, `${name} wraps inside: scrollWidth ${b.scrollWidth} <= clientWidth ${b.clientWidth}`);
          check(b.right <= b.columnRight + EDGE_TOLERANCE_PX, `${name} inside the column: ${b.right} <= ${b.columnRight}`);
        });
        const newest = bubbles.find((b: { latest: boolean }) => b.latest)?.typed; // older turns come first in the page
        check(JSON.stringify(newest) === JSON.stringify(['Here are the two tickets', 'Answer short please.']), `${tag} typed text kept as normal text: ${JSON.stringify(newest)}`);
        if (width === 990) {
          await js("document.querySelector('#latest .reader-you').scrollIntoView({ block: 'start' })");
          win.webContents.invalidate();
          await capture(`pasted-bubble-${look}-${theme}`);
        }
      }
    }
  }
  check(!(await js('Boolean(window.__pastedXss)')), 'pasted markup never ran');

  resizeOffscreen(win, startWidth, startHeight);
  applyTheme('paleSky', { persist: false });
  await js("window.pastel.look.setReading('newspaper')");
}
