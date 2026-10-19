// Library token cost (PASTEL_SNAPSHOT_MODE=library-cost): Read past sessions' confirm shows the local token estimate before
// any call, matching main's own count; after the run the note line and the head show what the stubbed calls reported.
// A stubbed extractor only, never a real claude; offsets start empty and are put back, the stores by keepingStores.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { folderFixture, libraryFixture } from '../main/snapshot-mode';
import { libraryDir } from '../main/library-store';
import { listPastSessions } from '../main/library-backfill';
import { estimateSessions } from '../main/library-estimate';
import { estimateText } from '../shared/library-cost';
import { PROBE, seedLibrary, seedPastSessions } from './snapshot-library';

const MIN_RATIO = 4.5;
// What each stubbed call reports, in the CLI's usage names: 12,522 tokens a call.
const USAGE = { input_tokens: 12, output_tokens: 310, cache_creation_input_tokens: 2400, cache_read_input_tokens: 9800 };

export async function libraryCostCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} library cost: ${what}`);
  type Probe = { state: { confirm: string; cost: string; backfill: { running: boolean } }; note: string; minRatio: number; worst: unknown };
  const settle = (want: (p: Probe) => boolean) => waitFor(async () => { const p = await js(PROBE) as Probe | null; return p && want(p) ? p : null; }, 8000);
  const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);

  const offsetsFile = path.join(app.getPath('userData'), 'library-offsets.json');
  const offsetsBefore = fs.existsSync(offsetsFile) ? fs.readFileSync(offsetsFile, 'utf8') : null;
  const savedHome = folderFixture.home;
  const pastHome = path.join(app.getPath('userData'), 'past-claude-cost');
  const prompts: string[] = [];
  const [startWidth, startHeight] = win.getContentSize();
  seedLibrary(libraryDir());
  seedPastSessions(pastHome);
  fs.rmSync(offsetsFile, { force: true }); // earlier steps read these same session ids; unread again whatever ran first
  folderFixture.home = pastHome;
  libraryFixture.extract = async (prompt) => {
    prompts.push(prompt);
    return JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ topics: [] }), usage: USAGE });
  };
  try {
    await js('PastelTerm.getStarted.close()');
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, 1280, 900);
    await wait(300);
    await click('#library-button');
    await settle(() => true);

    // Before: the confirm names the tokens, counted in main from the same chunks the build reads; no call yet.
    const want = estimateText(estimateSessions(listPastSessions(pastHome, { days: 30 })));
    check(!/About 0 tokens/.test(want), `the expected estimate counts the seeded sessions: ${want}`);
    await click('#library .lib-past');
    const asked = await settle((p) => p.state.confirm.endsWith(want));
    check(asked && /^Read 4 sessions from the last 30 days\? This uses your Claude plan, about 4 calls\. About [\d,]+ tokens to read, [\d,]+ to write\.$/.test(asked.state.confirm),
      `the confirm shows the estimate: ${JSON.stringify(asked?.state.confirm ?? (await js(PROBE) as Probe | null)?.state.confirm)} (want …${want})`);
    check(prompts.length === 0, `nothing was sent to Claude to make the estimate: ${prompts.length} calls`);
    check(asked && !/—/.test(asked.state.confirm), 'no em dash in the confirm');
    check(asked && asked.minRatio >= MIN_RATIO, `the confirm is readable: ${asked?.minRatio}:1 ${JSON.stringify(asked?.worst)}`);
    await capture('library-cost');

    // After: four calls at 12,522 tokens each, summed into the note line and kept as the last build.
    await click('#library .lib-confirm-go');
    const done = await settle((p) => !p.state.backfill.running && /Used about/.test(p.note) && Boolean(p.state.cost));
    check(done && prompts.length === 4 && /^Read 4 past sessions: no new domain knowledge\. Used about 50,000 tokens\.$/.test(done.note), `the done line says what it used: ${JSON.stringify(done?.note)}`);
    check(done && done.state.cost === 'Last build: Reading past sessions, 4 sessions, used about 50,000 tokens.', `the head keeps the last build: ${JSON.stringify(done?.state.cost)}`);
    check(done && done.minRatio >= MIN_RATIO, `the cost line is readable: ${done?.minRatio}:1`);
    await capture('library-cost-after');
    await js('PastelTerm.library.close()');
    await click('#library-button');
    const reopened = await settle((p) => Boolean(p.state.cost));
    check(reopened && reopened.state.cost === done?.state.cost, 'the last build stays after closing and reopening the Library');
  } finally {
    folderFixture.home = savedHome;
    libraryFixture.extract = null;
    fs.rmSync(pastHome, { recursive: true, force: true });
    if (offsetsBefore === null) fs.rmSync(offsetsFile, { force: true }); else fs.writeFileSync(offsetsFile, offsetsBefore);
    await js('PastelTerm.overlays.hideCurrent()');
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
