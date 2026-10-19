// Customize › Formatting › Shape guide (PASTEL_SNAPSHOT_MODE=shape-guide): in every reading look and theme each row shows its raw
// markdown and a preview holding the element the reader renders; Copy copies the raw text; previews stay inert; nothing overflows at 800px.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { applyReading, settings } from '../main/look';
import { READING_CHOICES } from '../main/menu';
import { resizeOffscreen } from '../main/snapshot-window';
import { SHAPE_ENTRIES } from '../renderer/shape-guide-entries';

const WIDTH = 800;
const HEIGHT = 900;
const CAPTURE_LOOKS = ['newspaper', 'lifestyle'];

// any: the page scripts below build their own shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

const ENTRIES = JSON.stringify(SHAPE_ENTRIES);

// Per row: raw text, which expected selectors the preview lacks, and any sideways overflow.
const ROWS = `(() => {
  const entries = ${ENTRIES};
  const pane = document.getElementById('customize');
  const card = document.querySelector('#customize .sg-list')?.closest('.cz-card');
  if (!card) return null;
  const cardRight = card.getBoundingClientRect().right;
  const rows = entries.map((entry) => {
    const row = document.querySelector('#customize .sg-row[data-shape="' + entry.id + '"]');
    if (!row) return { id: entry.id, found: false };
    const raw = row.querySelector('.sg-md');
    const preview = row.querySelector('.sg-preview');
    const prose = preview?.querySelector(':scope > .prose');
    const wide = [raw, preview, row].filter((n) => n && (n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > cardRight + 1)).map((n) => n.className);
    return {
      id: entry.id, found: true,
      rawOk: raw?.textContent === entry.markdown && raw.children.length === 1 && raw.firstElementChild.children.length === 0,
      copy: Boolean(row.querySelector('button.sg-copy')),
      missing: entry.expects.filter((s) => !prose?.querySelector(s)),
      present: (entry.absent ?? []).filter((s) => prose?.querySelector(s)),
      shows: entry.shows ? (prose?.textContent ?? '').includes(entry.shows) : true,
      wide,
    };
  });
  return {
    rows,
    page: [pane.scrollWidth, pane.clientWidth],
    doc: [document.documentElement.scrollWidth, window.innerWidth],
    title: card.querySelector('.cz-card-title')?.textContent,
    cards: document.querySelectorAll('#customize .sg-list').length,
    oldTable: Boolean(document.querySelector('#customize .cz-table')),
  };
})()`;

const rowSel = (id: string): string => `#customize .sg-row[data-shape="${id}"]`;

export async function shapeGuideCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, wait, waitFor, capture, themes, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} shape guide: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const startReading = settings().reading;
  const showFormatting = async () => {
    await js("PastelTerm.customize.open('formatting')");
    await waitFor(() => js("document.querySelector('#customize-tabs [aria-selected=\"true\"]')?.dataset.section === 'formatting' && document.querySelector('#customize .sg-list') !== null"), 5000);
    // The mermaid chunk loads on first use.
    return waitFor(() => js(`Boolean(document.querySelector('${rowSel('figure')} figure.diagram svg'))`), 15000);
  };

  try {
    await js('PastelTerm.getStarted.close()');
    resizeOffscreen(win, WIDTH, HEIGHT);
    check(await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === WIDTH; }, 3000), `${WIDTH}px window sized`);

    for (const [look] of READING_CHOICES) {
      applyReading(look);
      await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
      for (const theme of Object.keys(themes)) {
        applyTheme(theme, { persist: false });
        check(await showFormatting(), `${look} ${theme}: Formatting open, diagram drawn`);
        await wait(150);
        const state: Page = await js(ROWS);
        if (!state) { check(false, `${look} ${theme}: no guide card`); continue; }
        const bad = state.rows.filter((r: Page) => !r.found || !r.rawOk || !r.copy || r.missing.length || r.present.length || !r.shows || r.wide.length);
        check(bad.length === 0, `${look} ${theme}: ${state.rows.length - bad.length}/${SHAPE_ENTRIES.length} rows show raw markdown, a Copy button and the expected rendered element, no overflow${bad.length ? ` ${JSON.stringify(bad)}` : ''}`);
        check(state.page[0] <= state.page[1] && state.doc[0] <= state.doc[1], `${look} ${theme}: no horizontal overflow at ${WIDTH}px ${JSON.stringify({ page: state.page, doc: state.doc })}`);
        check(state.cards === 1 && !state.oldTable && state.title === 'Shape guide', `${look} ${theme}: one Shape guide card, old table gone (${state.title})`);
        await js('PastelTerm.customize.close()');
      }
      if (CAPTURE_LOOKS.includes(look)) {
        applyTheme('paleSky', { persist: false });
        await showFormatting();
        // The card is taller than the pane: one picture per screenful, top to bottom.
        const span: Page = await js(`(() => {
          const pane = document.getElementById('customize');
          const card = document.querySelector('#customize .sg-list').closest('.cz-card');
          const top = card.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
          return { top, height: card.getBoundingClientRect().height, view: pane.clientHeight };
        })()`);
        const pages = Math.ceil(span.height / span.view);
        for (let i = 0; i < pages; i++) {
          await js(`document.getElementById('customize').scrollTop = ${Math.round(span.top + i * span.view)}`);
          await capture(`shape-guide-${look}-paleSky-${i + 1}`);
        }
        await js('PastelTerm.customize.close()');
      }
    }

    // Inert: the real reader's reply is byte for byte the same after the previews are clicked.
    applyReading('newspaper');
    applyTheme('paleSky', { persist: false });
    await js('PastelTerm.reader.rerender()');
    await wait(200);
    // Mermaid numbers every diagram it draws, the previews' included; the ids are the only thing allowed to move.
    const readerHtml = async (): Promise<string> => (await js("document.getElementById('latest').innerHTML")).replace(/petal-diagram-\d+/g, 'petal-diagram-n');
    const readerBefore = await readerHtml();
    await showFormatting();
    await js(`document.querySelector('${rowSel('steps')} .step-badge').click()`);
    const ticked = await js(`document.querySelector('${rowSel('steps')} li.step').classList.contains('done')`);
    check(ticked, 'a step badge ticks inside its preview');
    await js(`document.querySelector('${rowSel('section')} h2.foldable').click()`);
    const opened = await js(`!document.querySelector('${rowSel('section')} section.story-section').classList.contains('folded')`);
    check(opened, 'a section heading opens inside its preview');
    const link: Page = await js(`(() => {
      const a = document.querySelector('${rowSel('links')} a[href]');
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      const before = location.href;
      a.dispatchEvent(event);
      return { prevented: event.defaultPrevented, same: location.href === before };
    })()`);
    check(link.prevented && link.same, `a link click stays put: ${JSON.stringify(link)}`);
    await js('PastelTerm.customize.close()');
    await js('PastelTerm.reader.rerender()');
    await wait(200);
    const readerAfter = await readerHtml();
    const at = [...readerAfter].findIndex((c, i) => c !== readerBefore[i]);
    check(readerAfter === readerBefore, `the reader's reply (and its folds) is unchanged${at >= 0 ? ` (differs at ${at}: ${JSON.stringify(readerBefore.slice(at - 40, at + 60))} vs ${JSON.stringify(readerAfter.slice(at - 40, at + 60))})` : ''}`);

    // Copy: each button hands its row's raw markdown to the clipboard API, stubbed in the page so her clipboard is never touched.
    await showFormatting();
    await js("window.__copied = []; navigator.clipboard.writeText = (text) => { window.__copied.push(text); return Promise.resolve(); }; true");
    try {
      const wrong: string[] = [];
      for (const entry of SHAPE_ENTRIES) {
        await js(`document.querySelector('${rowSel(entry.id)} .sg-copy').click()`);
        await wait(50);
        const got = await js('window.__copied.at(-1)');
        const label = await js(`document.querySelector('${rowSel(entry.id)} .sg-copy').textContent`);
        if (got !== entry.markdown || label !== 'Copied') wrong.push(`${entry.id}: ${JSON.stringify({ got, label })}`);
      }
      check(wrong.length === 0, `Copy copies the raw markdown, ${SHAPE_ENTRIES.length - wrong.length}/${SHAPE_ENTRIES.length} rows${wrong.length ? ` ${wrong.join('; ')}` : ''}`);
      await js("navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); true");
      await js(`document.querySelector('${rowSel('code')} .sg-copy').click()`);
      check(await waitFor(async () => (await js(`document.querySelector('${rowSel('code')} .sg-copy').textContent`)) === 'Copy failed' || null, 3000), 'a refused copy says so');
    } finally {
      await js('delete navigator.clipboard.writeText; delete window.__copied; true');
      await js('PastelTerm.customize.close()');
    }
  } finally {
    applyReading(startReading);
    resizeOffscreen(win, startWidth, startHeight);
  }
}
