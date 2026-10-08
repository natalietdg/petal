// Notes side panel: beside the replies without overlap, fixed while the reader scrolls, the reply box still on the
// column's axis (docked at 1280/1600, a drawer at 990/800), its open state saved in config, and beside History's preview.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { unclippedCheck } from './snapshot-divider';
import { load as loadConfig } from '../main/config-store';
import { resizeOffscreen } from '../main/snapshot-window';
import { printUpdate } from './snapshot-print';
import { FIXTURE_A, addHistoryFixture } from './snapshot-history-fixture';

const SCROLL_PX = 1500;
const TOLERANCE_PX = 2;
const DRAWER_BELOW_PX = 1000;

// CSS px relative to the window; "text" is the reply column's content box.
const MEASURE = `(() => {
  const r = (n) => Math.round(n * 10) / 10;
  const box = (el) => { const b = el.getBoundingClientRect(); return { left: r(b.left), right: r(b.right), top: r(b.top), bottom: r(b.bottom), width: r(b.width) }; };
  const column = document.querySelector('#reader .reader-column');
  const cs = getComputedStyle(column);
  const c = column.getBoundingClientRect();
  const text = { left: c.left + parseFloat(cs.paddingLeft), right: c.right - parseFloat(cs.paddingRight) };
  const panel = document.getElementById('notes-panel');
  const input = document.getElementById('composer-input').getBoundingClientRect();
  const editor = panel.querySelector('.notes-editor');
  return {
    viewport: window.innerWidth,
    open: !panel.hidden && panel.getBoundingClientRect().width > 0,
    pressed: document.getElementById('notes-toggle').getAttribute('aria-pressed'),
    panel: box(panel),
    reader: box(document.getElementById('reader')),
    cat: box(document.getElementById('cat')),
    text: { left: r(text.left), right: r(text.right), centre: r((text.left + text.right) / 2), width: r(text.right - text.left) },
    input: { centre: r((input.left + input.right) / 2), width: r(input.width) },
    editorScroll: editor ? editor.scrollTop : null,
  };
})()`;

// Long notes that never reach disk: no input event, no focus, so nothing saves them; restored afterwards.
const FILL_EDITOR = `(() => {
  const e = document.querySelector('#notes-panel .notes-editor');
  const before = e.value;
  e.value = Array.from({ length: 80 }, (_, i) => 'line ' + (i + 1)).join('\\n');
  e.scrollTop = 120;
  return before;
})()`;

export async function notesSideCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} notes side: ${what}`);
  const removeFixture = addHistoryFixture(outDir);
  const [startWidth, startHeight] = win.getContentSize();
  // any: the probe's shape is built in the script above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const measure = (): Promise<any> => js(MEASURE);
  const sizeTo = async (width: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      resizeOffscreen(win, width, 900);
      const sized = await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000);
      if (sized) return true;
    }
    return false;
  };
  const showLongReply = () => js(`PastelTerm.reader.update(${JSON.stringify({ ...printUpdate, sessionId: FIXTURE_A, tabId: 'notes-side-probe' })})`);

  try {
    applyTheme('paleSky', { persist: false });
    await js("PastelTerm.reader.setView('replies')");
    check(!(await js("Boolean(document.querySelector('#reader-head .view-toggle [data-view=\"notes\"]'))")), 'Notes is no longer a view in the toggle');

    // Toggle: closed and open are both saved to config.
    await js('PastelTerm.notesPanel.setOpen(false)');
    const closed = await waitFor(() => loadConfig().notesPanel.open === 'closed' || null, 3000);
    check(closed && !(await measure()).open, `closing saves open=closed: ${JSON.stringify(loadConfig().notesPanel)}`);
    await js("document.getElementById('notes-toggle').click()");
    const opened = await waitFor(() => loadConfig().notesPanel.open === 'open' || null, 3000);
    const afterClick = await measure();
    check(opened && afterClick.open && afterClick.pressed === 'true', `the header's Notes button opens it and saves open=open: ${JSON.stringify(loadConfig().notesPanel)}`);
    await js("window.pastel.config.save({ notesPanel: { open: 'auto' } }).then(() => PastelTerm.notesPanel.loadPrefs())");
    await showLongReply();
    const auto = await waitFor(async () => ((await measure()).open ? true : null), 5000);
    check(auto, 'auto: a session with notes opens with the panel');
    await js('PastelTerm.notesPanel.setOpen(true)');

    for (const width of [1280, 1600, 990, 800]) {
      check(await sizeTo(width), `window at ${width}px`);
      await showLongReply();
      await wait(400);
      const m = await measure();
      const drawer = width < DRAWER_BELOW_PX;
      const tag = `${width}px ${drawer ? 'drawer' : 'docked'}`;
      await unclippedCheck(kit, `Notes ${tag}`, '#notes-panel');
      check(m.open && m.panel.right === m.viewport, `${tag} panel open at the right edge: ${JSON.stringify(m.panel)}`);
      check(Math.abs(m.text.centre - m.input.centre) <= TOLERANCE_PX && Math.abs(m.text.width - m.input.width) <= TOLERANCE_PX * 2,
        `${tag} column centre ${m.text.centre} == reply box centre ${m.input.centre}, width ${m.text.width} vs ${m.input.width}`);
      if (drawer) check(m.panel.width <= m.viewport * 0.88 + 1, `${tag} drawer ${m.panel.width}px leaves the column its measure`);
      else {
        check(m.text.right <= m.panel.left && m.reader.right <= m.panel.left, `${tag} text ends ${m.text.right}, reader ${m.reader.right}, panel starts ${m.panel.left}: no overlap`);
        check(m.cat.right <= m.panel.left, `${tag} cat ${m.cat.left}-${m.cat.right} stays left of the panel`);
      }
      check(m.panel.top >= m.reader.top - TOLERANCE_PX, `${tag} panel starts below the fixed header: panel ${m.panel.top}, reader ${m.reader.top}`);
      if (width === 1280) {
        await capture('notes-side-1280-light');
        applyTheme('nightPastel', { persist: false });
        await wait(300);
        await capture('notes-side-1280-dark');
        applyTheme('paleSky', { persist: false });
      }
      if (width === 990) await capture('notes-side-990');
    }

    // Scroll the reader: the panel stays put and keeps its own scroll.
    await sizeTo(1280);
    await showLongReply();
    await wait(300);
    const saved = await js(FILL_EDITOR);
    await js("document.getElementById('reader').scrollTop = 0");
    await wait(100);
    const before = await measure();
    await js(`document.getElementById('reader').scrollTop = ${SCROLL_PX}`);
    await wait(250);
    const scrolled = await js("document.getElementById('reader').scrollTop");
    const after = await measure();
    check(scrolled >= SCROLL_PX && after.open && after.panel.top === before.panel.top && after.panel.bottom === before.panel.bottom && after.editorScroll === before.editorScroll && before.editorScroll > 0,
      `reader scrolled ${scrolled}px; panel ${JSON.stringify(before.panel)} -> ${JSON.stringify(after.panel)}, its scroll ${before.editorScroll} -> ${after.editorScroll}`);
    await js(`document.querySelector('#notes-panel .notes-editor').value = ${JSON.stringify(saved)}`);
    await js("document.getElementById('reader').scrollTop = 0");

    // History: the same panel beside the preview, no Notes tab.
    await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(FIXTURE_A)}); return PastelTerm.history.setPreviewMode('replies'); })`);
    const side = await waitFor(() => js(`(() => {
      const n = document.getElementById('history-notes'), p = document.getElementById('history-preview');
      const e = n.querySelector('.notes-editor:not([disabled])');
      if (n.hidden || !e) return null;
      const nb = n.getBoundingClientRect(), pb = p.getBoundingClientRect();
      const tabs = [...p.querySelectorAll('.view-toggle button')].map((b) => b.textContent);
      return { previewRight: Math.round(pb.right), notesLeft: Math.round(nb.left), notesRight: Math.round(nb.right), tabs, hasNotes: e.value.length > 0, pressed: p.querySelector('.notes-toggle')?.getAttribute('aria-pressed') };
    })()`), 8000);
    check(side && side.previewRight <= side.notesLeft && side.hasNotes && side.pressed === 'true' && !side.tabs.includes('Notes'), `History notes beside the preview: ${JSON.stringify(side)}`);
    await capture('notes-side-history-1280');
    await js('PastelTerm.history.close()');
  } finally {
    await js('PastelTerm.notesPanel.setOpen(false)'); // later steps measure the reader without it
    removeFixture();
    resizeOffscreen(win, startWidth, startHeight);
  }
}
