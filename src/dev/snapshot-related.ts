// The reader's Related tab from a fixture: Overlap first, then Waiting on this, then Waits on, light and dark.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeTo } from './snapshot-tables';
import { resizeOffscreen } from '../main/snapshot-window';
import type { RelatedWork, SessionContext } from '../shared/context-store';

const THEMES = ['paleSky', 'nightPastel']; // one light, one dark
const WIDTH = 990;
const TALL_HEIGHT = 1400;

const session = (over: Partial<SessionContext> & Pick<SessionContext, 'sessionId' | 'title'>): SessionContext => ({
  cwd: null, repo: 'pastel-term', topics: ['pastel-term'], entries: [], files: [], firstAt: null, lastAt: Date.parse('2026-11-10T09:00:00Z'), ...over,
});

const SAMPLE: RelatedWork = {
  waitsOn: [
    session({
      sessionId: 'earlier-1', title: 'The reader parsers have no Electron dependency', lastAt: Date.parse('2026-11-03T04:00:00Z'),
      entries: [{ kind: 'decided', text: 'Lift src/shared as a library, port the renderer files one by one · yes' }, { kind: 'next', text: 'Write the Forge manifest' }],
    }),
  ],
  waitingOnThis: [
    session({
      sessionId: 'later-1', title: 'The build tab needs a spec', lastAt: Date.parse('2026-11-11T07:30:00Z'), topics: ['pastel-term', 'AB#10496'],
      entries: [{ kind: 'open', text: 'Does the context store key by repo or by ticket?' }, { kind: 'next', text: 'Natalie opens the build tab' }],
    }),
  ],
  sharedTopics: { 'earlier-1': ['pastel-term'], 'later-1': ['pastel-term', 'AB#10496'] },
  overlap: [{ file: '/Users/natalieleong/CascadeProjects/pastel-term/src/renderer/reader.ts', sessions: [session({ sessionId: 'later-1', title: 'The build tab needs a spec' })] }],
};

const MEASURE = `(() => {
  const view = document.getElementById('related-view');
  const titles = [...view.querySelectorAll('.related-section-title')].map((h) => h.firstChild.textContent);
  return {
    visible: !view.hidden && view.getBoundingClientRect().height > 100,
    headline: view.querySelector('.related-headline')?.textContent ?? null,
    titles,
    overlapRows: view.querySelectorAll('.related-overlap-row').length,
    cards: view.querySelectorAll('.related-card').length,
    pills: [...view.querySelectorAll('.related-pill')].map((p) => p.textContent),
    selected: document.querySelector('#reader-head .view-toggle [aria-selected="true"]').dataset.view,
  };
})()`;

export async function relatedCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} related: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  await js('PastelTerm.getStarted.close()');
  const show = () => js(`PastelTerm.reader.showRelated(${JSON.stringify(SAMPLE)}, 'codegeist')`);

  await show();
  check(await resizeTo(kit, win, WIDTH), `window resized to ${WIDTH}px`);
  const wasMinimised = await js('PastelTerm.layout.isTerminalMinimised()');
  await js('PastelTerm.layout.setTerminalMinimised(true, false)');
  await win.webContents.capturePage(); // warm-up
  for (const theme of THEMES) {
    applyTheme(theme, { persist: false });
    await wait(300);
    await show();
    const m = await js(MEASURE) as { visible: boolean; headline: string | null; titles: string[]; overlapRows: number; cards: number; pills: string[]; selected: string };
    log(`related ${theme}: ${JSON.stringify(m)}`);
    check(m.visible, `${theme} Related page is visible`);
    check(m.selected === 'related', `${theme} Related button is the selected tab`);
    check(m.headline === 'One file is being changed by another session too', `${theme} headline names the overlap`);
    check(m.titles.join(',') === 'Overlap,Waiting on this,Waits on', `${theme} sections in weight order`);
    check(m.overlapRows === 1 && m.cards === 2, `${theme} one overlap row and two session cards`);
    check(m.pills.join(',') === 'Open,Next,Decided,Next', `${theme} entries carry their kind`);
    resizeOffscreen(win, WIDTH, TALL_HEIGHT);
    await wait(300);
    await show();
    await js("document.getElementById('reader').scrollTop = 0");
    await capture(`related-${theme}`);
  }

  await js("PastelTerm.reader.setView('replies')");
  await js(`PastelTerm.layout.setTerminalMinimised(${Boolean(wasMinimised)}, false)`);
  applyTheme('paleSky', { persist: false });
  resizeOffscreen(win, startWidth, startHeight);
}
