// Messages between sessions (PASTEL_SNAPSHOT_MODE=mentions): the "@" picker, the To line, exactly what each tab gets pasted,
// Board's Message…, a reply's Send to button, skipping a tab that is asking, and an image mention's late Enter. Every paste is recorded, none typed.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import { extraTabFixtures, pasteWrites, slashFixture } from '../main/snapshot-mode';
import { listActivity } from '../main/activity-feed';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { seedSlashFixture } from './snapshot-slash';
import { pasted } from '../main/mentions';
import { wrapMessage } from '../shared/mentions';

interface Fixture { id: string; folder: string; branch: string | null; status: 'idle' | 'busy'; prompt: string; reply: string }
const id = (n: number) => `m3e7d000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PRICES: Fixture = { id: id(1), folder: 'billing-service', branch: 'fix-prices', status: 'idle', prompt: 'fix the stale prices', reply: '**The nightly job reads the old table.**' };
const EMAIL: Fixture = { id: id(2), folder: 'widget-service', branch: null, status: 'busy', prompt: 'welcome email locale', reply: '**Adding the locale to the welcome email.**' };
const DOCS: Fixture = { id: id(3), folder: 'docs-site', branch: null, status: 'idle', prompt: 'docs site build', reply: '**The docs build is green.**' };
const FIXTURES = [PRICES, EMAIL, DOCS];
// A permission prompt on a target's screen: an Enter pasted now would approve it.
const ASK_SCREEN = ['─'.repeat(40), ' Bash command', '', '   npm test', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'];

const entry = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;
const turn = (sessionId: string, n: string, prompt: string, reply: string, cwd?: string) =>
  entry({ type: 'user', uuid: `${n}-u`, cwd, sessionId, message: { role: 'user', content: prompt } })
  + entry({ type: 'assistant', uuid: `${n}-a`, cwd, sessionId, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } });

// WCAG contrast of each element's text on the nearest opaque background behind it.
const CONTRAST = (selector: string) => `(() => {
  const rgb = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bg = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || c[3] > 0.9) return c; } return [255, 255, 255]; };
  return [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getClientRects().length && e.textContent.trim()).map((e) => {
    const a = lum(rgb(getComputedStyle(e).color)); const b = lum(bg(e));
    return { text: e.textContent.trim().slice(0, 30), ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 };
  });
})()`;

export async function mentionsCheck(kit: Kit, { win, openTab, sessions, fixtureFile }: Pick<TabsDeps, 'openTab' | 'sessions'> & { win: BrowserWindow; fixtureFile: string }): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, themes, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} mentions: ${what}`);
  const dir = path.join(outDir, 'mentions');
  const cwdOf = (f: Fixture) => path.join(dir, 'repos', f.folder);
  const transcriptOf = (f: Fixture) => path.join(dir, 'tabs', `${f.id}.jsonl`);
  const input = "document.getElementById('composer-input')";
  const type = async (value: string) => js(`(() => { const i = ${input}; i.focus(); i.value = ${JSON.stringify(value)}; i.setSelectionRange(i.value.length, i.value.length); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const key = async (name: string) => js(`${input}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true, cancelable: true }))`);
  const menu = (): Promise<{ open: boolean; groups: { label: string; names: string[]; descs: string[] }[] }> => js(`(() => {
    const m = document.querySelector('.slash-menu');
    return { open: Boolean(m && !m.hidden), groups: [...(m?.querySelectorAll('.slash-group') ?? [])].map((g) => ({ label: g.querySelector('.slash-group-label').textContent,
      names: [...g.querySelectorAll('.slash-name')].map((n) => n.textContent), descs: [...g.querySelectorAll('.slash-desc')].map((n) => n.textContent) })) };
  })()`);
  const toLine = (): Promise<{ shown: boolean; chips: string[]; here: boolean; result: string }> => js(`(() => {
    const bar = document.getElementById('composer-to');
    return { shown: !bar.hidden && !bar.querySelector('.composer-to-row').hidden, chips: [...bar.querySelectorAll('.mention-chip')].map((c) => c.textContent.replace('×', '').trim()),
      here: document.getElementById('composer-to-here').checked, result: bar.querySelector('.composer-to-result').hidden ? '' : bar.querySelector('.composer-to-result').textContent };
  })()`);
  const pastesSince = (n: number) => pasteWrites.slice(n);
  const startTabs: string[] = await js('PastelTerm.tabs.ids()');
  const startActive: string | null = await js('PastelTerm.tabs.active()?.id ?? null');

  try {
    applyTheme('paleSky', { persist: false });
    await js('PastelTerm.getStarted.close()');
    fs.rmSync(dir, { recursive: true, force: true });
    const claudeDir = path.join(dir, 'claude-home', '.claude');
    seedSlashFixture(claudeDir, path.join(dir, 'project'));
    slashFixture.claudeDir = claudeDir;
    for (const f of FIXTURES) {
      fs.mkdirSync(cwdOf(f), { recursive: true });
      if (f.branch) { fs.mkdirSync(path.join(cwdOf(f), '.git'), { recursive: true }); fs.writeFileSync(path.join(cwdOf(f), '.git', 'HEAD'), `ref: refs/heads/${f.branch}\n`); }
      assertFixtureOutsideClaude(transcriptOf(f));
      fs.mkdirSync(path.dirname(transcriptOf(f)), { recursive: true });
      fs.writeFileSync(transcriptOf(f), turn(f.id, f.id, f.prompt, f.reply, cwdOf(f)));
    }
    extraTabFixtures.push(...FIXTURES.map((f) => ({ sessionId: f.id, transcript: transcriptOf(f), status: f.status, cwd: cwdOf(f) })));
    const sender: string = await js('PastelTerm.tabs.active().id');
    for (const _ of FIXTURES) openTab(win.webContents, { background: true });
    const tabOf = async (f: Fixture): Promise<string | null> => js(`PastelTerm.tabs.ids().find((t) => PastelTerm.tabs.get(t).update?.sessionId === ${JSON.stringify(f.id)}) ?? null`);
    const up = await waitFor(async () => ((await Promise.all(FIXTURES.map(tabOf))).every(Boolean) ? true : null), 15000);
    check(up, 'a tab follows each fixture session');
    const [pricesTab, emailTab, docsTab] = await Promise.all(FIXTURES.map(tabOf));
    const nameOf = async (tabId: string | null): Promise<string> => js(`PastelTerm.tabs.get(${JSON.stringify(tabId)}).update.label`);
    const [prices, email, docs, me] = await Promise.all([pricesTab, emailTab, docsTab, sender].map(nameOf));
    await js(`PastelTerm.tabs.activate(${JSON.stringify(sender)})`);
    check((await js('PastelTerm.tabs.active().id')) === sender, `the first tab is the sender: ${me}`);

    // The docs tab's Claude exits: it stays listed by name, as not running.
    const docsSession = sessions.get(`${win.webContents.id}:${docsTab}`);
    if (docsSession) Object.assign(docsSession.feed, { fixture: null });
    check(await waitFor(async () => ((await js(`PastelTerm.tabs.get(${JSON.stringify(docsTab)}).update?.state`)) === 'ended' ? true : null), 8000), 'the docs tab’s Claude has ended');

    // 1 "@" opens the picker: Sessions (the other tabs, not this one) then Agents.
    await type('@');
    const picked = await waitFor(async () => { const m = await menu(); return m.open && m.groups.some((g) => g.label === 'Agents') ? m : null; }, 5000);
    const sessionsGroup = picked?.groups.find((g) => g.label === 'Sessions');
    check(picked?.groups[0]?.label === 'Sessions' && picked.groups[1]?.label === 'Agents', `groups read Sessions, then Agents: ${JSON.stringify(picked?.groups.map((g) => g.label))}`);
    check(JSON.stringify(sessionsGroup?.names) === JSON.stringify([prices, email, docs]) && !sessionsGroup?.names.includes(me), `Sessions lists the other tabs by name, never this one: ${JSON.stringify(sessionsGroup?.names)}`);
    check(sessionsGroup?.descs[2]?.endsWith('· not running') && !sessionsGroup?.descs[0]?.includes('not running'), `the ended tab says not running: ${JSON.stringify(sessionsGroup?.descs)}`);
    check(picked?.groups[1]?.names.includes('@agent-reviewer'), `agents still offer @agent-<name>: ${JSON.stringify(picked?.groups[1]?.names)}`);
    await capture('mentions-picker');

    // 2 Filtering by a word of the name; Enter inserts the mention and the To line names it.
    await type('@wel');
    const filtered = await waitFor(async () => { const m = await menu(); return m.groups[0]?.names.length === 1 ? m : null; }, 3000);
    check(filtered?.groups[0]?.names[0] === email, `"@wel" narrows Sessions to the email session: ${JSON.stringify(filtered?.groups)}`);
    await key('Enter');
    const afterPick: string = await js(`${input}.value`);
    check(/^@session:[a-z0-9-]+ $/.test(afterPick) && !(await menu()).open, `Enter inserts @session:<slug> and closes the menu: ${JSON.stringify(afterPick)}`);
    const emailToken = afterPick.trim();

    // 3 "@rev" picks the agent: @agent-reviewer, as the "/" menu inserts it.
    await type('ask @rev');
    await waitFor(async () => ((await menu()).groups.find((g) => g.label === 'Agents')?.names[0] === '@agent-reviewer' ? true : null), 3000);
    await key('Enter');
    check((await js(`${input}.value`)) === 'ask @agent-reviewer ', 'an agent picked from "@" inserts @agent-reviewer');
    await type('/');
    const slash = await waitFor(async () => { const m = await menu(); return m.groups.find((g) => g.label === 'Agents') ? m : null; }, 3000);
    check(slash?.groups.find((g) => g.label === 'Agents')?.names.includes('@agent-reviewer') && !slash.groups.some((g) => g.label === 'Sessions'), 'the "/" menu keeps its Agents group and shows no sessions');
    await key('Escape');

    // 4 The To line: chips for each mention, not running marked, Also send unticked.
    await type('@');
    await waitFor(async () => ((await menu()).groups[0]?.names.length === 3 ? true : null), 3000);
    const tokens: string[] = await js(`[...document.querySelectorAll('.slash-session .slash-desc')].map((d) => d.textContent.split(' ')[0])`);
    await key('Escape');
    const [tPrices, tEmail, tDocs] = tokens;
    check(tEmail === emailToken, `the picked token matches the picker's: ${JSON.stringify(tokens)}`);
    const body = 'which table holds the v2 prices?';
    await type(`${tPrices} ${tEmail} ${tDocs} ${body}`);
    const line = await toLine();
    check(line.shown && JSON.stringify(line.chips) === JSON.stringify([prices, email, `${docs}not running`]) && !line.here, `To line names each mention, the ended one as not running, Also send unticked: ${JSON.stringify(line)}`);
    await capture('mentions-to-line');
    const lightContrast = await js(CONTRAST('#composer-to .composer-to-label, #composer-to .mention-chip-name, #composer-to .mention-chip-state, #composer-to .composer-to-here'));
    check(lightContrast.length >= 4 && lightContrast.every((c: { ratio: number }) => c.ratio >= 4.5), `To line text is 4.5:1 or more (paleSky): ${JSON.stringify(lightContrast)}`);

    // 5 Send: exactly the wrapped paste for each running target, nothing for the sender or the ended tab.
    const before = pasteWrites.length;
    const activityBefore = new Set(listActivity().map((e) => e.id));
    await js("document.getElementById('composer-send').click()");
    const sent = await waitFor(() => (pastesSince(before).length >= 2 ? pastesSince(before) : null), 5000);
    await wait(400);
    const senderPlace: string | null = await js('PastelTerm.tabs.active().update.repo');
    const wrapped = pasted(wrapMessage({ name: me, place: senderPlace }, body));
    check(JSON.stringify(pastesSince(before)) === JSON.stringify([{ tabId: pricesTab, data: wrapped }, { tabId: emailTab, data: wrapped }]), `each running target got exactly the wrapped paste: ${JSON.stringify(sent)}`);
    check(!pastesSince(before).some((p) => p.tabId === sender || p.tabId === docsTab), 'none for the sender (not chosen) or the ended tab');
    const result = (await toLine()).result;
    check(result.includes(`Sent to ${prices}`) && result.includes(`Queued for ${email}`) && result.includes(`Not running, not sent: ${docs}`), `the result line says who got it: ${JSON.stringify(result)}`);
    check((await js(`${input}.value`)) === '' && !(await toLine()).shown, 'the box clears and the To line goes');
    const activity = listActivity().filter((e) => !activityBefore.has(e.id));
    const reached = activity.map((e) => e.toSessionName).sort();
    check(activity.length === 2 && activity.every((e) => e.kind === 'message' && e.text === body && e.sessionName === me) && JSON.stringify(reached) === JSON.stringify([prices, email].sort()),
      `one Activity message per session reached, none for the ended one: ${JSON.stringify(activity)}`);

    // 6 Also send to this session: the sender gets her plain message too; mentions alone send nothing.
    const before2 = pasteWrites.length;
    await type(`${tPrices} also: check the cron`);
    await js("document.getElementById('composer-to-here').click()");
    await js("document.getElementById('composer-send').click()");
    await waitFor(() => (pastesSince(before2).length >= 2 ? true : null), 5000);
    await wait(300);
    const both = pastesSince(before2);
    check(both.length === 2 && both.some((p) => p.tabId === pricesTab && p.data === pasted(wrapMessage({ name: me, place: senderPlace }, 'also: check the cron')))
      && both.some((p) => p.tabId === sender && p.data === pasted('also: check the cron')), `Also send adds the plain message for this session: ${JSON.stringify(both)}`);
    const before3 = pasteWrites.length;
    await type(`${tPrices}`);
    await js("document.getElementById('composer-to-here').click()");
    await js("document.getElementById('composer-send').click()");
    await wait(500);
    check(pastesSince(before3).length === 0 && (await js(`${input}.value`)) === tPrices && (await toLine()).result.startsWith('Write a message'), 'a mention with no message sends nothing and says why');
    await type('');

    // 7 A mention to a tab with no Claude is refused by main as well, even if the renderer asks.
    const shellTab = openTab(win.webContents, { background: true });
    await waitFor(async () => ((await js(`PastelTerm.tabs.ids().includes(${JSON.stringify(shellTab)})`)) ? true : null), 5000);
    const before4 = pasteWrites.length;
    const direct = await js(`window.pastel.sendMention(${JSON.stringify(sender)}, [${JSON.stringify(shellTab)}, ${JSON.stringify(docsTab)}, 'no-such-tab'], 'hello')`);
    check(JSON.stringify(direct.deliveries?.map((d: { outcome: string }) => d.outcome)) === '["not-running","not-running","closed"]' && pastesSince(before4).length === 0, `main sends nothing to a shell tab, an ended tab or a closed one: ${JSON.stringify(direct)}`);

    // 8 Board: Message… on another session's card opens a small composer; none on this session's card.
    await js('PastelTerm.sessionsBoard.open()');
    const boardButtons = await waitFor(async () => {
      const got: { tab: string | null; message: boolean }[] = await js(`[...document.querySelectorAll('#board .board-item')].map((i) => ({ tab: i.querySelector('.board-card')?.dataset.tabId ?? null, message: Boolean(i.querySelector('.board-message-open')) }))`);
      return got.some((g) => g.tab === pricesTab) ? got : null;
    }, 6000);
    check(boardButtons?.find((b) => b.tab === pricesTab)?.message && boardButtons.find((b) => b.tab === emailTab)?.message && !boardButtons.find((b) => b.tab === sender)?.message, `Message… on other sessions' cards, not this one: ${JSON.stringify(boardButtons)}`);
    await js(`document.querySelector('#board .board-card[data-tab-id="${pricesTab}"]').parentElement.querySelector('.board-message-open').click()`);
    const popup = await waitFor(() => js("(() => { const p = document.querySelector('.board-message'); return p && !p.hidden ? { title: p.querySelector('.board-message-title').textContent, focused: document.activeElement === p.querySelector('textarea') } : null; })()"), 3000);
    check(popup?.title.startsWith(`Message ${prices}`) && popup.focused, `the composer opens focused, naming the card: ${JSON.stringify(popup)}`);
    const before5 = pasteWrites.length;
    await js("(() => { const p = document.querySelector('.board-message'); p.querySelector('textarea').value = 'is the job fixed yet?'; p.requestSubmit(); })()");
    await waitFor(() => (pastesSince(before5).length ? true : null), 4000);
    check(JSON.stringify(pastesSince(before5)) === JSON.stringify([{ tabId: pricesTab, data: pasted(wrapMessage({ name: me, place: senderPlace }, 'is the job fixed yet?')) }]), `Board's Send pastes the wrapped message into that tab only: ${JSON.stringify(pastesSince(before5))}`);
    check((await js("document.querySelector('.board-message .board-message-status').textContent")).startsWith('Sent to'), 'the composer says it was sent');
    await capture('mentions-board-message');
    check(await waitFor(async () => ((await js("document.querySelector('.board-message').hidden")) ? true : null), 3000), 'the composer closes after sending');
    check(await js("PastelTerm.overlays.current() === 'board'"), 'the board stays open under it');
    await js('PastelTerm.sessionsBoard.close()');

    // 9 A reply ending in a To line shows a Send to button; nothing is sent until it is clicked.
    const ask = 'which table holds the v2 prices?';
    const before6 = pasteWrites.length;
    fs.appendFileSync(fixtureFile, turn('snapshot-fixture', 'mention-ask', 'ask the prices session', `**Asking the prices session.**\n\nThe job reads a table I can't see from here.\n\n**To @${prices}:** ${ask}`));
    const button = await waitFor(() => js("(() => { const b = document.querySelector('#latest .reply-mention-send'); return b ? { text: b.textContent, disabled: b.disabled } : null; })()"), 8000);
    check(button?.text === `Send to ${prices}` && !button.disabled, `the To line becomes a Send to button: ${JSON.stringify(button)}`);
    await wait(1200);
    check(pastesSince(before6).length === 0, 'it never sends by itself');
    await js("document.querySelector('#latest .reply-mention').scrollIntoView({ block: 'center' })");
    await capture('mentions-reply-send');
    await js("document.querySelector('#latest .reply-mention-send').click()");
    await waitFor(() => (pastesSince(before6).length ? true : null), 4000);
    check(JSON.stringify(pastesSince(before6)) === JSON.stringify([{ tabId: pricesTab, data: pasted(wrapMessage({ name: me, place: senderPlace }, ask)) }]), `clicking sends the wrapped question to that session: ${JSON.stringify(pastesSince(before6))}`);
    const afterClick = await js("(() => { const b = document.querySelector('#latest .reply-mention-send'); return { disabled: b.disabled, note: b.parentElement.querySelector('.reply-mention-note').textContent }; })()");
    check(afterClick.disabled && afterClick.note.startsWith('Sent to'), `then it says sent and can't double-send: ${JSON.stringify(afterClick)}`);

    // 10 A target showing a prompt gets nothing, from the box or straight from main, and the result line says why.
    const drawIn = (tabId: string | null, text: string) => js(`new Promise((done) => PastelTerm.tabs.get(${JSON.stringify(tabId)}).term.write(${JSON.stringify(text)}, done))`);
    await drawIn(emailTab, `\x1b[2J\x1b[H${ASK_SCREEN.join('\r\n')}`);
    const before7 = pasteWrites.length;
    await type(`${tEmail} ${tPrices} is the cron back?`);
    await js("document.getElementById('composer-send').click()");
    await waitFor(() => (pastesSince(before7).length ? true : null), 4000);
    await wait(300);
    check(JSON.stringify(pastesSince(before7)) === JSON.stringify([{ tabId: pricesTab, data: pasted(wrapMessage({ name: me, place: senderPlace }, 'is the cron back?')) }]), `the asking tab gets nothing, the other gets its paste: ${JSON.stringify(pastesSince(before7))}`);
    const askingResult = (await toLine()).result;
    check(askingResult.includes(`Sent to ${prices}`) && askingResult.includes(`${email} is asking something; answer it there first`), `the result line says who is asking: ${JSON.stringify(askingResult)}`);
    const before8 = pasteWrites.length;
    const refused = await js(`window.pastel.sendMention(${JSON.stringify(sender)}, [${JSON.stringify(emailTab)}], 'hello', [${JSON.stringify(emailTab)}])`);
    check(refused.deliveries?.[0]?.outcome === 'asking' && pastesSince(before8).length === 0, `main skips a tab reported asking: ${JSON.stringify(refused)}`);
    await drawIn(emailTab, '\x1b[2J\x1b[3J\x1b[H');

    // 11 An image path: the paste goes first, its Enter only once the target shows its [Image #n].
    const shot = 'look at /tmp/petal-mention-shot.png';
    const before9 = pasteWrites.length;
    await type(`${tPrices} ${shot}`);
    await js("document.getElementById('composer-send').click()");
    await waitFor(() => (pastesSince(before9).length ? true : null), 4000);
    await wait(500);
    check(JSON.stringify(pastesSince(before9)) === JSON.stringify([{ tabId: pricesTab, data: pasted(wrapMessage({ name: me, place: senderPlace }, shot), false) }]), `the image mention is pasted without its Enter, which waits: ${JSON.stringify(pastesSince(before9))}`);
    await drawIn(pricesTab, '\r\n[Image #1]');
    await waitFor(() => (pastesSince(before9).length >= 2 ? true : null), 3000);
    check(JSON.stringify(pastesSince(before9).slice(1)) === JSON.stringify([{ tabId: pricesTab, data: '\r' }]), `the Enter follows on its own once Claude has read the image: ${JSON.stringify(pastesSince(before9))}`);

    // 12 Every theme: To line and Send to text stay readable.
    await type(`${tPrices} ${tDocs} hi`);
    const failing: unknown[] = [];
    for (const theme of Object.keys(themes)) {
      applyTheme(theme, { persist: false });
      await wait(120);
      const rows = await js(CONTRAST('#composer-to .composer-to-label, #composer-to .mention-chip-name, #composer-to .mention-chip-state, #composer-to .composer-to-here, #latest .reply-mention-send, #latest .reply-mention-note'));
      for (const row of rows as { text: string; ratio: number }[]) if (row.ratio < 4.5) failing.push({ theme, ...row });
    }
    check(!failing.length, `To line and Send to text are 4.5:1 or more in every theme: ${JSON.stringify(failing)}`);
    applyTheme('paleSky', { persist: false });
    await type('');
  } finally {
    // Back to the tabs the run had, so the full sequence's later steps start clean.
    slashFixture.claudeDir = null;
    applyTheme('paleSky', { persist: false });
    await js('PastelTerm.sessionsBoard.close()');
    extraTabFixtures.length = 0;
    const opened: string[] = (await js('PastelTerm.tabs.ids()')).filter((t: string) => !startTabs.includes(t));
    for (const t of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(t)})`);
    await waitFor(async () => ((await js('PastelTerm.tabs.ids()')).length === startTabs.length ? true : null), 8000); // closing is async
    if (startActive) await js(`PastelTerm.tabs.activate(${JSON.stringify(startActive)})`);
  }
}
