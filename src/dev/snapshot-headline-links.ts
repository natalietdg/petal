// Every reading look × light/dark × width: a bare URL in the headline shows its short label at dek size and stays inside the card.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeTo } from './snapshot-tables';
import { READING_CHOICES } from '../main/menu';

const WIDTHS = [990, 1280];
const THEMES = ['paleSky', 'nightPastel']; // one light, one dark
const EDGE_TOLERANCE_PX = 0.5;
const MAX_LINK_TO_HEADLINE = 0.7;

const PR_URL = 'https://github.com/acme-labs/Widget-Ledger-Service/pull/17';
const PR_LABEL = 'Widget-Ledger-Service #17';
const LONG_URL = 'https://example.com/a/very/long/path/that/keeps/going/forever/and/ever?with=query&params=1';
const LONG_LABEL = 'example.com/…/ever…';
const LONG_TOKEN = 'Averyveryveryveryverylongunbrokenidentifierthatmustwrapinsidetheheadingwithoutoverflowing';

const LINKS_REPLY = [
  `**PR is up: ${PR_URL}**`,
  '',
  `Opened from \`headline-links\`; the long reference ${LONG_URL} stays inside the dek.`,
  '',
  `## Checks on ${LONG_TOKEN}`,
  '',
  `The labelled [Widget-Ledger-Service pull request](${PR_URL}) keeps its own words, and <${PR_URL}> shortens like the autolink.`,
].join('\n');

const linksUpdate = {
  state: 'live',
  replies: [{ id: 'headline-links', timestamp: '2026-10-08T09:40:00.000Z', prompt: 'is the PR up?', markdown: LINKS_REPLY }],
};

// CSS px. Each block's inked right edge (from its text rects) against its container's content box.
const MEASURE = `(() => {
  const r = (n) => Math.round(n * 10) / 10;
  const contentRight = (el) => { const cs = getComputedStyle(el); return el.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth); };
  const inkRight = (el) => { const range = document.createRange(); range.selectNodeContents(el); return Math.max(...[...range.getClientRects()].map((q) => q.right)); };
  const headline = document.querySelector('#latest .headline');
  const dek = document.querySelector('#latest .headline + p');
  const h2 = document.querySelector('#latest .story-section > h2');
  const head = headline.closest('.story-head');
  const section = h2.closest('.story-section');
  const link = headline.querySelector('a');
  const links = [...document.querySelectorAll('#latest a')].map((a) => ({ text: a.textContent, href: a.getAttribute('href'), title: a.getAttribute('title') }));
  return {
    headlineRight: r(inkRight(headline)), dekRight: r(inkRight(dek)), headRight: r(contentRight(head)),
    h2Right: r(inkRight(h2)), sectionRight: r(contentRight(section)),
    latestRight: r(document.getElementById('latest').getBoundingClientRect().right),
    headlineSize: parseFloat(getComputedStyle(headline).fontSize), linkSize: link ? parseFloat(getComputedStyle(link).fontSize) : null,
    dekSize: parseFloat(getComputedStyle(dek).fontSize), linkWeight: link ? Number(getComputedStyle(link).fontWeight) : null,
    links,
  };
})()`;

export async function headlineLinksCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} headline links: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const rows: unknown[] = [];

  // The fixture feed can redraw its own reply; re-send the sample whenever it is gone.
  const showSample = async () => {
    if (await js("document.getElementById('latest').dataset.replyId === 'headline-links'")) return true;
    await js(`PastelTerm.reader.update(${JSON.stringify(linksUpdate)})`);
    return waitFor(() => js("Boolean(document.querySelector('#latest .headline a'))"), 5000);
  };
  check(await showSample(), 'sample reply with a GitHub PR URL in the headline');

  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      for (const width of WIDTHS) {
        const tag = `${look} ${theme} ${width}px`;
        check(await resizeTo(kit, win, width), `${tag} window resized`);
        await showSample();
        await wait(350);
        const m = await js(MEASURE);
        rows.push({ look, theme, width, ...m });
        const inside = (right: number, box: number) => right <= box + EDGE_TOLERANCE_PX;
        check(inside(m.headlineRight, m.headRight) && inside(m.headRight, m.latestRight), `${tag} headline inside its card: ink ${m.headlineRight}, card ${m.headRight}, reply ${m.latestRight}`);
        check(inside(m.dekRight, m.headRight), `${tag} dek inside its card: ink ${m.dekRight}, card ${m.headRight}`);
        check(inside(m.h2Right, m.sectionRight), `${tag} long heading wraps inside its section: ink ${m.h2Right}, section ${m.sectionRight}`);
        const [headlineLink, dekLink, labelled, angled] = m.links;
        check(headlineLink?.text === PR_LABEL && headlineLink.href === PR_URL && headlineLink.title === PR_URL, `${tag} headline link reads "${headlineLink?.text}", href and tooltip unchanged`);
        check(dekLink?.text === LONG_LABEL && dekLink.href === LONG_URL, `${tag} dek link reads "${dekLink?.text}"`);
        check(labelled?.text === 'Widget-Ledger-Service pull request' && angled?.text === PR_LABEL, `${tag} labelled link kept, <url> shortened: "${labelled?.text}" / "${angled?.text}"`);
        check(m.linkSize <= m.headlineSize * MAX_LINK_TO_HEADLINE && m.linkWeight <= 450,
          `${tag} headline link ${m.linkSize}px weight ${m.linkWeight} under headline ${m.headlineSize}px (dek ${m.dekSize}px)`);
        if (width === 1280) {
          await js("document.getElementById('reader').scrollTop = 0");
          win.webContents.invalidate();
          await capture(`headline-links-${look}-${theme}-1280`);
        }
      }
    }
  }

  fs.writeFileSync(path.join(outDir, 'headline-links.json'), JSON.stringify(rows, null, 2));
  win.setContentSize(startWidth, startHeight);
  applyTheme('paleSky', { persist: false });
  await js("window.pastel.look.setReading('newspaper')");
}
