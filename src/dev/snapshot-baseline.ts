// Step isolation for the full run: after every step the window must be back where the run started.
// A step that leaves something behind gets a FAIL under its own name, then the baseline is put back,
// so a leak is caught where it happened instead of breaking a later step.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { flush as flushActivity, listActivity, resetForTests as forgetActivity } from '../main/activity-feed';
import { libraryDir } from '../main/library-store';
import { applyReading, settings } from '../main/look';
import * as fixtures from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { testingDir } from '../main/testing-store';
import type { Kit } from './snapshot';
import { keepActivity } from './snapshot-activity';

// The page's side of the baseline; every field here has a restore below.
const PAGE_STATE = `(() => {
  const P = PastelTerm;
  return {
    tabs: P.tabs.ids(),
    active: P.tabs.active()?.id ?? null,
    overlay: P.overlays.current(),
    sessionsPanel: P.sessionsPanel.isOpen(),
    terminalMinimised: P.layout.isTerminalMinimised(),
    headersMinimised: P.headersMin.isMinimised(),
    focusMode: P.focusMode.isOn(),
    split: document.getElementById('divider').getAttribute('aria-valuenow'),
    reading: document.documentElement.dataset.reading ?? null,
    readerView: P.reader.currentView(),
    board: P.sessionsBoard.filters(),
    testing: P.testing.leftovers(),
    text: P.textSize.current(),
  };
})()`;

// Stand-in folders and fixtures a step points the app at; each must be unset again when the step ends.
const fixtureState = () => ({
  setup: fixtures.setupFixture.claudeDir,
  styles: fixtures.stylesFixture.claudeDir,
  factory: [fixtures.factoryFixture.claudeDir, fixtures.factoryFixture.repo],
  slash: fixtures.slashFixture.claudeDir,
  testing: [fixtures.testingFixture.project, fixtures.testingFixture.claudeDir],
  library: fixtures.libraryFixture.extract !== null,
  panel: [fixtures.panelFixture.sessions?.length ?? null, fixtures.panelFixture.subagentsRoot],
  claudeInstalled: fixtures.claudeFixture.installed,
  folderHome: fixtures.folderFixture.home,
  folderChoice: fixtures.folderFixture.choice,
  history: [fixtures.historyFixture.records.length, fixtures.historyFixture.live.length],
  extraTabs: fixtures.extraTabFixtures.length,
});

// Puts every fixture pointer back as the baseline had it.
function fixtureRestorer(): () => void {
  const f = fixtures;
  const saved = {
    setup: f.setupFixture.claudeDir, styles: f.stylesFixture.claudeDir, factory: { ...f.factoryFixture }, slash: f.slashFixture.claudeDir,
    testing: [f.testingFixture.project, f.testingFixture.claudeDir] as const, extract: f.libraryFixture.extract, panel: { ...f.panelFixture },
    installed: f.claudeFixture.installed, folder: { ...f.folderFixture }, records: [...f.historyFixture.records], live: [...f.historyFixture.live], extraTabs: [...f.extraTabFixtures],
  };
  return () => {
    f.setupFixture.claudeDir = saved.setup;
    f.stylesFixture.claudeDir = saved.styles;
    Object.assign(f.factoryFixture, saved.factory);
    f.slashFixture.claudeDir = saved.slash;
    [f.testingFixture.project, f.testingFixture.claudeDir] = saved.testing;
    f.libraryFixture.extract = saved.extract;
    Object.assign(f.panelFixture, saved.panel);
    f.claudeFixture.installed = saved.installed;
    Object.assign(f.folderFixture, saved.folder);
    f.historyFixture.records = [...saved.records];
    f.historyFixture.live = [...saved.live];
    f.extraTabFixtures.splice(0, Infinity, ...saved.extraTabs);
  };
}

// The stores a step's fixtures land in; compared by content, restored from a copy. cost: the last Library build's tokens.
const STORES = {
  activity: () => path.join(path.dirname(libraryDir()), 'activity.json'), library: libraryDir, testing: testingDir,
  cost: () => path.join(path.dirname(libraryDir()), 'library-last-run.json'),
};
type StoreName = keyof typeof STORES;

function fingerprint(target: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (at: string, rel: string) => {
    if (!fs.existsSync(at)) return;
    if (fs.statSync(at).isDirectory()) {
      for (const name of fs.readdirSync(at).sort()) walk(path.join(at, name), `${rel}/${name}`);
    } else hash.update(rel).update(fs.readFileSync(at));
  };
  walk(target, '');
  return hash.digest('hex').slice(0, 12);
}

// Activity by its events, not its file: a reload rewrites the file in its own order and shape.
const storePrint = (name: StoreName): string => (name === 'activity'
  ? crypto.createHash('sha256').update(JSON.stringify(listActivity().map((e) => [e.id, e.at, e.text]))).digest('hex').slice(0, 12)
  : fingerprint(STORES[name]()));

const lookState = () => ({ theme: settings().theme, reading: settings().reading, cat: settings().cat, scene: settings().scene });

// any: the page probe's shape is built in PAGE_STATE.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PageState = any;

interface Baseline {
  page: PageState;
  look: ReturnType<typeof lookState>;
  fixtures: string;
  size: number[];
  stores: Record<StoreName, string>;
}

export interface StepIsolation {
  check: (step: string) => Promise<void>;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// Call once the run is at its resting state (after the launch step closes Get started).
export async function captureBaseline(kit: Kit, win: BrowserWindow): Promise<StepIsolation> {
  const { js, log, waitFor } = kit;
  flushActivity();
  const copies = path.join(kit.outDir, 'baseline-stores');
  fs.rmSync(copies, { recursive: true, force: true });
  fs.mkdirSync(copies, { recursive: true });
  const stores = {} as Record<StoreName, string>;
  for (const [name, at] of Object.entries(STORES) as [StoreName, () => string][]) {
    stores[name] = storePrint(name);
    if (fs.existsSync(at())) fs.cpSync(at(), path.join(copies, name), { recursive: true });
  }
  const restoreFixtures = fixtureRestorer();
  const baselineEvents = new Set(listActivity().map((e) => e.id));
  // What a step added to the Activity feed, so the FAIL names the event that leaked.
  const newEvents = () => listActivity().filter((e) => !baselineEvents.has(e.id)).slice(0, 4).map((e) => `${e.kind}: ${String(e.text).slice(0, 60)}`);
  const baseline: Baseline = { page: await js(PAGE_STATE), look: lookState(), fixtures: JSON.stringify(fixtureState()), size: win.getContentSize(), stores };
  const tabsOk = sameJson(baseline.page.tabs, ['t1']) && baseline.page.active === 't1' && baseline.page.overlay === null;
  log(`${tabsOk ? 'ok' : 'FAIL'} step baseline: one tab t1, no overlay open: ${JSON.stringify({ ...baseline.page, look: baseline.look, size: baseline.size })}`);

  const restoreStore = (name: StoreName) => {
    const at = STORES[name]();
    if (name === 'activity') forgetActivity(); // drops the pending save, so the restored file is what the next read sees
    fs.rmSync(at, { recursive: true, force: true });
    const copy = path.join(copies, name);
    if (fs.existsSync(copy)) fs.cpSync(copy, at, { recursive: true });
  };

  const check = async (step: string): Promise<void> => {
    const leaks: string[] = [];
    const page: PageState = await js(PAGE_STATE);
    const want = baseline.page;

    if (!sameJson(page.tabs, want.tabs) || page.active !== want.active) {
      leaks.push(`tabs ${JSON.stringify({ ids: page.tabs, active: page.active })}`);
      for (const id of page.tabs) if (!want.tabs.includes(id)) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
      await waitFor(async () => sameJson(await js('PastelTerm.tabs.ids()'), want.tabs) || null, 8000);
      if (want.active) await js(`PastelTerm.tabs.activate(${JSON.stringify(want.active)})`);
    }
    if (page.overlay !== want.overlay) {
      leaks.push(`overlay ${page.overlay} open`);
      await js(`(() => { const o = PastelTerm.overlays; const id = o.current(); if (id) { o.unlock(id); o.hide(id); } })()`);
    }
    if (page.sessionsPanel !== want.sessionsPanel) {
      leaks.push('Sessions panel open');
      await js(`PastelTerm.sessionsPanel.expandedIds.clear(); PastelTerm.sessionsPanel.setOpen(${want.sessionsPanel})`);
    }
    if (page.terminalMinimised !== want.terminalMinimised) {
      leaks.push(`terminal minimised=${page.terminalMinimised}`);
      await js(`PastelTerm.layout.setTerminalMinimised(${want.terminalMinimised})`);
    }
    if (page.headersMinimised !== want.headersMinimised) {
      leaks.push(`headers minimised=${page.headersMinimised}`);
      await js(`PastelTerm.headersMin.set(${want.headersMinimised})`);
    }
    if (page.focusMode !== want.focusMode) {
      leaks.push(`focus mode=${page.focusMode}`);
      await js(`PastelTerm.focusMode.set(${want.focusMode})`);
    }
    if (page.readerView !== want.readerView) {
      leaks.push(`reader view ${page.readerView}`);
      await js(`PastelTerm.reader.setView(${JSON.stringify(want.readerView)})`);
    }
    if (!sameJson(page.board, want.board)) {
      leaks.push(`Board filters ${JSON.stringify(page.board)}`);
      await js('PastelTerm.sessionsBoard.resetFilters()');
    }
    if (!sameJson(page.testing, want.testing)) {
      leaks.push(`Testing choices ${JSON.stringify(page.testing)}`);
      await js('PastelTerm.testing.resetLeftovers()');
    }
    if (!sameJson(page.text, want.text)) {
      leaks.push(`text sizes ${JSON.stringify(page.text)}`);
      await js(`PastelTerm.textSize.restore(${JSON.stringify(want.text)})`);
    }

    const look = lookState();
    if (!sameJson(look, baseline.look) || page.reading !== want.reading) {
      leaks.push(`look ${JSON.stringify({ ...look, page: page.reading })}`);
      Object.assign(settings(), { cat: baseline.look.cat, scene: baseline.look.scene });
      kit.applyTheme(baseline.look.theme, { persist: false });
      applyReading(baseline.look.reading); // also resets the page's data-reading a step may have set directly
      await js(`PastelTerm.cat.setCat(${JSON.stringify(baseline.look.cat)}); PastelTerm.cat.setScene(${JSON.stringify(baseline.look.scene)})`);
    }

    const size = win.getContentSize();
    if (!sameJson(size, baseline.size)) {
      leaks.push(`window ${size.join('x')}`);
      resizeOffscreen(win, baseline.size[0], baseline.size[1]);
      await waitFor(() => sameJson(win.getContentSize(), baseline.size) || null, 5000);
    }

    const fixtureNow = JSON.stringify(fixtureState());
    if (fixtureNow !== baseline.fixtures) {
      leaks.push(`fixtures ${fixtureNow}`);
      restoreFixtures();
    }

    flushActivity();
    for (const name of Object.keys(STORES) as StoreName[]) {
      if (storePrint(name) === baseline.stores[name]) continue;
      leaks.push(`${name} store changed${name === 'activity' ? ` ${JSON.stringify(newEvents())}` : ''}`);
      restoreStore(name);
    }

    // The split is checked last: the bands above (overlays, headers, terminal) move its floor.
    const split = await js("document.getElementById('divider').getAttribute('aria-valuenow')");
    if (split !== want.split) {
      leaks.push(`split ${split}%`);
      await js("document.getElementById('divider').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
    }

    log(`${leaks.length ? 'FAIL' : 'ok'} step ${step} ends at the baseline${leaks.length ? `; it left (now restored): ${leaks.join('; ')}` : ''}`);
  };
  return { check };
}

// A step whose job is to write a store (Library notes, test runs, their Activity events) declares it here; each goes back as it was after.
export function keepingStores(names: readonly StoreName[], step: () => Promise<unknown>, outDir: string): () => Promise<void> {
  return async () => {
    const restoreActivity = names.includes('activity') ? keepActivity() : () => {};
    const copies = names.filter((name) => name !== 'activity').map((name) => ({ at: STORES[name](), copy: path.join(outDir, `kept-${name}`) }));
    for (const { at, copy } of copies) {
      fs.rmSync(copy, { recursive: true, force: true });
      if (fs.existsSync(at)) fs.cpSync(at, copy, { recursive: true });
    }
    try {
      await step();
    } finally {
      for (const { at, copy } of copies) {
        fs.rmSync(at, { recursive: true, force: true });
        if (fs.existsSync(copy)) fs.renameSync(copy, at);
      }
      restoreActivity();
    }
  };
}
