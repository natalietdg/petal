// Reply from History: a background tab opens (the shown tab stays), the message shows in the preview, it goes out
// once Claude is up there, Open in full switches. Also: the fork warning, her session limit, and a question waiting.
import * as configStore from '../main/config-store';
import { historyFixture, panelFixture, pasteWrites } from '../main/snapshot-mode';
import { addHistoryFixture, FIXTURE_A, FIXTURE_B } from './snapshot-history-fixture';
import { SINGLE_SCREEN } from './snapshot-prompts';
import type { Kit } from './snapshot';

const MESSAGE = 'hello from the history preview';

const STATE = `(() => {
  const t = PastelTerm.tabs;
  const you = [...document.querySelectorAll('#history-preview .history-you')].map((b) => ({ text: b.textContent, cls: b.className }));
  return {
    ids: t.ids(),
    active: t.active()?.id ?? null,
    shown: t.ids().filter((id) => !t.get(id).host.hidden),
    historyOpen: !document.getElementById('history').hidden,
    lastYou: you.at(-1) ?? null,
    note: document.querySelector('#history-preview .history-reply-note')?.textContent ?? '',
    status: document.querySelector('#history-preview .history-reply-status')?.textContent ?? '',
    fullShown: Boolean(document.querySelector('#history-preview .history-reply-row .history-open-full:not([hidden])')),
  };
})()`;

const fake = (n: number) => ({ pid: 0, sessionId: `adadadad-0000-4000-8000-${String(n).padStart(12, '0')}`, cwd: `/tmp/petal-fixture/s${n}`, kind: 'interactive' as const, status: 'idle' as const, name: `Fixture ${n}`, updatedAt: Date.now() });

export async function historyReplyCheck(kit: Kit): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} history reply: ${what}`);
  // any: the probe's shape is built in the script above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const waitState = (test: (s: any) => boolean, ms = 6000) => waitFor(async () => { const s = await js(STATE); return test(s) ? s : null; }, ms);
  const select = (id: string) => js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(id)}); return PastelTerm.history.setPreviewMode('replies'); })`);
  const send = (text: string) => js(`(() => { const box = document.querySelector('#history-preview .history-reply-input'); box.value = ${JSON.stringify(text)}; box.dispatchEvent(new Event('input')); box.closest('form').requestSubmit(); })()`);
  const removeFixture = addHistoryFixture(outDir);
  panelFixture.sessions = [fake(1)];
  configStore.save({ sessions: { maxOpen: 8 } });
  const start = await js(STATE);
  const opened: string[] = [];

  try {
    await select(FIXTURE_A);
    check(await waitFor(() => js("Boolean(document.querySelector('#history-preview .history-reply-input'))"), 8000), 'the preview has a reply box');
    await send(MESSAGE);
    const sent = await waitState((s) => s.ids.length === start.ids.length + 1 && s.lastYou?.text === MESSAGE);
    const bg = sent?.ids.at(-1);
    if (bg) opened.push(bg);
    check(sent && sent.active === start.active && !sent.shown.includes(bg) && sent.historyOpen,
      `background tab ${bg} opened, shown tab still ${sent?.active}, History still open: ${JSON.stringify(sent)}`);
    check(sent?.lastYou?.cls.includes('queued'), `her message shows in the preview, waiting for Claude: ${JSON.stringify(sent?.lastYou)}`);
    check(historyFixture.resumes.includes(FIXTURE_A), `the tab got the resume for that session (echoed in snapshot runs): ${JSON.stringify(historyFixture.resumes)}`);
    await capture('history-reply-queued');

    // Claude comes up in the background tab: the queued message is pasted there and echoes until it's in the log.
    const pastesBefore = pasteWrites.length;
    const live = { state: 'live', replies: [{ id: 'r1', timestamp: new Date().toISOString(), prompt: 'plan the garden', markdown: 'Plant **tomatoes** first.' }], waiting: [], promptCount: 1, busy: false, sessionId: FIXTURE_A, cwd: null, repo: null, tabId: bg, label: 'Fixture session A' };
    await js(`PastelTerm.tabs.setUpdate(${JSON.stringify(bg)}, ${JSON.stringify(live)}); PastelTerm.history.tabUpdated(${JSON.stringify(bg)})`);
    const pasted = await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.tabId === bg && w.data.includes(MESSAGE)) ?? null, 6000);
    check(pasted, `pasted into the background tab once Claude was up: ${JSON.stringify(pasted)}`);
    const echoed = await waitState((s) => s.lastYou?.text === MESSAGE && s.lastYou.cls.includes('pending') && s.fullShown);
    check(echoed, `the preview follows the tab: reply shown, message echoed, Open in full offered: ${JSON.stringify(echoed)}`);
    await capture('history-reply-live');

    // A question waiting in that tab can't be answered from here, so the preview says so.
    const drawInBg = (text: string) => js(`PastelTerm.tabs.get(${JSON.stringify(bg)}).term.write(${JSON.stringify(text)}, () => PastelTerm.history.tabScreen(${JSON.stringify(bg)}))`);
    await drawInBg(`\x1b[2J\x1b[H${SINGLE_SCREEN.join('\r\n')}\r\n`);
    const asking = await waitState((s) => s.status.includes('Claude is asking something'));
    check(asking, `a picker on that tab's screen shows "Claude is asking something · Open in full": ${JSON.stringify(asking?.status)}`);
    await drawInBg('\x1b[2J\x1b[H');
    check(await waitState((s) => !s.status.includes('Claude is asking something')), 'the note goes once the picker leaves the screen');

    // At her limit no tab opens for a reply.
    panelFixture.sessions = [fake(1), fake(2)];
    configStore.save({ sessions: { maxOpen: 2 } });
    await select(FIXTURE_B);
    await waitFor(() => js("Boolean(document.querySelector('#history-preview .history-reply-input'))"), 8000);
    const beforeLimit = (await js(STATE)).ids.length;
    await send('over the limit');
    const limited = await waitState((s) => s.note.includes('your limit is 2'));
    await wait(500);
    check(limited && (await js(STATE)).ids.length === beforeLimit, `at the limit: no tab, the note says why: ${JSON.stringify(limited?.note)}`);
    panelFixture.sessions = [fake(1)];
    configStore.save({ sessions: { maxOpen: 8 } });

    // Live in another terminal: the fork warning comes first, and Open anyway sends.
    historyFixture.live = [FIXTURE_B];
    await send('fork it please');
    const warned = await waitState((s) => s.note.includes('Opening it here as well forks it'));
    const anyway = await js("[...document.querySelectorAll('#history-preview .history-reply-note button')].map((b) => b.textContent)");
    check(warned && anyway.includes('Open anyway') && (await js(STATE)).ids.length === beforeLimit, `live elsewhere warns before replying: ${JSON.stringify(warned?.note)}`);
    await capture('history-reply-fork-warning');
    await js("[...document.querySelectorAll('#history-preview .history-reply-note button')].find((b) => b.textContent === 'Open anyway').click()");
    const forked = await waitState((s) => s.ids.length === beforeLimit + 1);
    if (forked) opened.push(forked.ids.at(-1));
    check(forked && forked.active === start.active && historyFixture.resumes.includes(FIXTURE_B), `Open anyway opens it in the background too: ${JSON.stringify(forked)}`);

    // Open in full: switches to the background tab and leaves History.
    await select(FIXTURE_A);
    await waitState((s) => s.fullShown);
    await js("document.querySelector('#history-preview .history-reply-row .history-open-full').click()");
    const full = await waitState((s) => s.active === bg && !s.historyOpen && s.shown.includes(bg));
    check(full, `Open in full shows tab ${bg} and closes History: ${JSON.stringify(full)}`);
    await capture('history-reply-open-full');
  } finally {
    removeFixture();
    panelFixture.sessions = null;
    configStore.save({ sessions: { maxOpen: 8 } });
    await js('PastelTerm.history.close()');
    for (const id of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
    const closed = await waitState((s) => s.ids.length === start.ids.length, 8000);
    check(closed, `test tabs closed again: ${JSON.stringify((await js(STATE)).ids)}`);
    if (start.active) await js(`PastelTerm.tabs.activate(${JSON.stringify(start.active)})`);
  }
}
