// Window fit (PASTEL_SNAPSHOT_MODE=window-fit): wide content never widens the app past the window.
// A wide table, a long code line, an unbroken path (in a reply and her bubble) and long tab names once pushed the
// header, the Sessions chip and panel and the cat off the right edge; each is put on screen and the window measured.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { fixtureFile, panelFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { assertFixtureOutsideClaude } from './snapshot-views';
import type { SessionFile } from '../main/claude-session';

export const WIDTHS = [1920, 1728, 1440, 1280, 990, 800]; // widest first: narrowing is what strands content
const CONTENT_WIDTHS = [1440, 990];
const LONG_PATH = `/Users/you/Code/${'very-long-folder-name-'.repeat(13)}end/file.ts`.slice(0, 300);
const CASES: { name: string; prompt: string; reply: string }[] = [
  { name: 'a 40-column table', prompt: 'show the table', reply: `**A wide table.**\n\n| ${Array.from({ length: 40 }, (_, i) => `column_${i}`).join(' | ')} |\n|${'---|'.repeat(40)}\n| ${Array.from({ length: 40 }, (_, i) => `value_${i}_xx`).join(' | ')} |` },
  { name: 'a 400-character code line', prompt: 'show the code', reply: `**A long code line.**\n\n\`\`\`ts\nconst x = ${JSON.stringify('y'.repeat(380))};\n\`\`\`` },
  { name: 'a 300-character path in the reply and in her bubble', prompt: `why does ${LONG_PATH} fail?`, reply: `**An unbroken path.**\n\nIt lives at ${LONG_PATH} and nowhere else.` },
];
const TAB_NAME = 'Product name translations update to test on staging, part ';

// Every surface that must sit inside the window, and how far past it each one reaches.
const FIT = `(() => {
  const W = window.innerWidth, H = window.innerHeight;
  const out = { scrollWidth: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth, inner: W, outside: [] };
  const checkIn = (label, e, sidewaysOnly = false) => {
    if (!e || !e.getClientRects().length || getComputedStyle(e).display === 'none') return;
    const r = e.getBoundingClientRect();
    if (r.left < -1 || r.right > W + 1 || (!sidewaysOnly && (r.top < -1 || r.bottom > H + 1))) out.outside.push({ label, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) });
  };
  checkIn('app', document.getElementById('app'));
  checkIn('reader area', document.getElementById('reader-area'));
  checkIn('header row', document.querySelector('#reader-head .reader-head-row'));
  checkIn('sessions chip', document.getElementById('sessions-pill'));
  checkIn('sessions panel', document.getElementById('sessions-panel'));
  for (const b of document.querySelectorAll('#sessions-panel .session-status')) checkIn('panel badge', b, true); // rows scroll inside the panel
  checkIn('notes panel', document.getElementById('notes-panel'));
  checkIn('agent panel', document.getElementById('agent-panel'));
  checkIn('history', document.getElementById('history'));
  checkIn('cat', document.getElementById('cat'));
  checkIn('terminal', document.getElementById('terminal-pane'));
  if (out.scrollWidth > W + 1) out.outside.push({ label: 'document scrollWidth', by: out.scrollWidth - W });
  return out;
})()`;

function appendTurn(file: string, n: number, prompt: string, reply: string): void {
  assertFixtureOutsideClaude(file);
  const at = new Date().toISOString();
  const lines = [
    { type: 'user', uuid: `fit-u${n}`, timestamp: at, isSidechain: false, message: { role: 'user', content: prompt } },
    { type: 'assistant', uuid: `fit-a${n}`, timestamp: at, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
  ];
  fs.appendFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

export async function windowFitCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} window fit: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const file = fixtureFile();
  if (!file) return log('FAIL window fit: needs PASTEL_SNAPSHOT_FAKE_JSONL');
  const sizeTo = async (width: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      resizeOffscreen(win, width, 900);
      if (await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000)) return true;
    }
    return false;
  };
  const saved = { ...panelFixture };
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const startActive: string | null = await js('PastelTerm.tabs.active()?.id ?? null');
  // Each surface on its own: the reader with the Sessions panel open, Notes open, History open.
  const STATES: [string, string, string][] = [
    ['panel open', 'PastelTerm.sessionsPanel.setOpen(true)', 'PastelTerm.sessionsPanel.setOpen(false)'],
    ['Notes open', 'PastelTerm.notesPanel.setOpen(true)', 'PastelTerm.notesPanel.setOpen(false)'],
    ['History open', 'PastelTerm.history.open()', 'PastelTerm.history.close()'],
  ];
  const fits = async (tag: string) => {
    for (const [state, open, close] of STATES) {
      await js(open);
      await wait(300);
      const fit = await js(FIT);
      check(fit.outside.length === 0, `${tag}, ${state}: everything inside the ${fit.inner}px window (scrollWidth ${fit.scrollWidth}) ${JSON.stringify(fit.outside)}`);
      await js(close);
    }
  };

  try {
    await wait(2500); // login shell rc files
    await js('PastelTerm.welcome.close()');
    await js("PastelTerm.reader.setView('replies')");
    await js("PastelTerm.cat.setScene('cherry')");
    // Nine sessions with long names in the panel, and six tabs with long names in the strip.
    const now = Date.now();
    panelFixture.sessions = Array.from({ length: 9 }, (_, i): SessionFile => ({ pid: 0, sessionId: `f17f17f1-0000-4000-8000-${String(i).padStart(12, '0')}`, cwd: path.join(outDir, 'window-fit', `a-very-long-repository-folder-name-for-session-number-${i}`), kind: 'interactive', status: i % 3 ? 'idle' : 'busy', updatedAt: now - i * 60_000 }));
    await js(`(() => { for (let i = 1; i <= 6; i++) { const t = PastelTerm.tabs.create(); t.element.querySelector('.tab-label').textContent = ${JSON.stringify(TAB_NAME)} + i; } })()`);
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);
    check(await waitFor(async () => ((await js('PastelTerm.tabs.ids().length')) === startTabs.length + 6 ? true : null), 5000), '6 long-named tabs added');

    // Long tab names and 9 sessions, every width (narrowing) and look.
    for (const width of WIDTHS) {
      check(await sizeTo(width), `${width}px window sized`);
      for (const [look] of READING_CHOICES) {
        await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
        await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
        await fits(`long tab names, 9 sessions, ${width}px ${look}`);
      }
    }
    await js("window.pastel.look.setReading('newspaper')");

    // Each wide reply on screen as the newest, at 1440 then 990.
    for (const [n, c] of CASES.entries()) {
      check(await sizeTo(1440), '1440px window sized');
      appendTurn(file, n, c.prompt, c.reply);
      const shown = await waitFor(() => js(`document.getElementById('latest').innerText.includes(${JSON.stringify(c.reply.split('\n')[0].replace(/\*/g, ''))})`), 10000);
      check(shown, `${c.name} shown as the newest reply`);
      await js("document.getElementById('reader').scrollTop = 0");
      for (const width of CONTENT_WIDTHS) {
        check(await sizeTo(width), `${width}px window sized`);
        await fits(`${c.name}, ${width}px`);
        await capture(`window-fit-${n}-${width}`);
      }
    }
  } finally {
    for (const id of ((await js('PastelTerm.tabs.ids()')) as string[]).filter((t) => !startTabs.includes(t))) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
    check(await waitFor(async () => ((await js('PastelTerm.tabs.ids().length')) === startTabs.length ? true : null), 8000), 'test tabs closed again');
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);
    await js("window.pastel.look.setReading('newspaper')");
    panelFixture.sessions = saved.sessions;
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
