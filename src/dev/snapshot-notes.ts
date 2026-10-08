// Notes: typed in History's preview, saved to userData/notes/<id>.md, shown again on reopen, separate per session,
// found by History's search, and shown in the reader's Notes view for the tab's session.
import fs from 'node:fs';
import path from 'node:path';
import { notesDir } from '../main/notes-store';
import { addHistoryFixture, FIXTURE_A, FIXTURE_B } from './snapshot-history-fixture';
import type { Kit } from './snapshot';

const NOTES_A = '# Garden\n- tomatoes before basil\n- ask about the pineapple bed';
const NOTES_B = 'Mika prefers the window seat.';

const PROBE = `(() => {
  const box = document.querySelector('#history-preview .notes-editor');
  return { session: document.querySelector('#history-preview .notes')?.dataset.sessionId ?? null, value: box?.value ?? null, enabled: box ? !box.disabled : false, status: document.querySelector('#history-preview .notes-status')?.textContent ?? null };
})()`;

export async function notesCheck(kit: Kit): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} notes: ${what}`);
  const removeFixture = addHistoryFixture(outDir);
  const fileOf = (id: string) => path.join(notesDir(), `${id}.md`);
  const readFile = (id: string) => { try { return fs.readFileSync(fileOf(id), 'utf8'); } catch { return null; } };
  // any: the probe's shape is built in the script above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const waitProbe = (test: (p: any) => boolean, ms = 6000) => waitFor(async () => { const p = await js(PROBE); return test(p) ? p : null; }, ms);
  const showNotes = async (id: string) => {
    await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(id)}); return PastelTerm.history.setPreviewMode('notes'); })`);
    return waitProbe((p) => p.session === id && p.enabled);
  };
  const type = (text: string) => js(`(() => { const box = document.querySelector('#history-preview .notes-editor'); box.focus(); box.value = ${JSON.stringify(text)}; box.dispatchEvent(new Event('input')); })()`);

  try {
    check(notesDir().startsWith(path.join(outDir, 'userData')), `notes folder is Petal's own userData: ${notesDir()}`);
    const tabsBefore = await js('PastelTerm.tabs.ids().length');
    check(await showNotes(FIXTURE_A), 'History preview has a Notes tab with an editor');
    await type(NOTES_A);
    const savedA = await waitFor(() => readFile(FIXTURE_A) === NOTES_A || null, 5000);
    check(savedA, `typed notes saved to ${fileOf(FIXTURE_A)}: ${JSON.stringify(readFile(FIXTURE_A))}`);
    await capture('notes-history');

    await js('PastelTerm.history.close()');
    const reopened = await showNotes(FIXTURE_A);
    check(reopened?.value === NOTES_A, `reopened History shows the saved notes: ${JSON.stringify(reopened?.value)}`);

    const other = await showNotes(FIXTURE_B);
    check(other?.value === '', `a different session starts with its own empty notes: ${JSON.stringify(other?.value)}`);
    await type(NOTES_B);
    await waitFor(() => readFile(FIXTURE_B) === NOTES_B || null, 5000);
    check(readFile(FIXTURE_B) === NOTES_B && readFile(FIXTURE_A) === NOTES_A, `each session keeps its own file: A=${JSON.stringify(readFile(FIXTURE_A))} B=${JSON.stringify(readFile(FIXTURE_B))}`);
    const backToA = await showNotes(FIXTURE_A);
    check(backToA?.value === NOTES_A, `switching back shows A's notes again: ${JSON.stringify(backToA?.value)}`);

    await js("(() => { const s = document.getElementById('history-search'); s.value = 'pineapple bed'; s.dispatchEvent(new Event('input')); })()");
    await wait(200);
    const found = await js("[...document.querySelectorAll('.history-row')].map((r) => r.dataset.sessionId)");
    check(found.length === 1 && found[0] === FIXTURE_A, `search finds the session by its notes: ${JSON.stringify(found)}`);
    await js("(() => { const s = document.getElementById('history-search'); s.value = ''; s.dispatchEvent(new Event('input')); })()");
    await js('PastelTerm.history.close()');

    // The reader's Notes view follows the shown tab's session.
    const tabId = await js('PastelTerm.tabs.active()?.id ?? null');
    await js(`PastelTerm.reader.update({ state: 'live', replies: [], sessionId: ${JSON.stringify(FIXTURE_A)}, tabId: 'notes-probe' })`);
    await js("PastelTerm.reader.setView('notes')");
    const inReader = await waitFor(async () => {
      const value = await js("document.querySelector('#notes-view .notes-editor:not([disabled])')?.value ?? null");
      return value === NOTES_A ? value : null;
    }, 5000);
    check(inReader, `reader Notes view shows the session's notes: ${JSON.stringify(inReader)}`);
    await capture('notes-reader');
    await js(`PastelTerm.reader.update({ state: 'live', replies: [], sessionId: ${JSON.stringify(FIXTURE_B)}, tabId: 'notes-probe' })`);
    const switched = await waitFor(async () => (await js("document.querySelector('#notes-view .notes-editor:not([disabled])')?.value ?? null")) === NOTES_B || null, 5000);
    const hint = await js("document.querySelector('#notes-view .notes-hint')?.textContent ?? null");
    check(switched && hint, `a new session id in the same tab shows its own notes and the hint: ${JSON.stringify(hint)}`);
    check((await js('PastelTerm.tabs.ids().length')) === tabsBefore, 'notes never opened a tab');
    await js("PastelTerm.reader.setView('replies')");
    if (tabId) await js(`PastelTerm.tabs.activate(${JSON.stringify(tabId)})`);
  } finally {
    removeFixture();
  }
}
