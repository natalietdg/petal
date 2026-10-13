// Reply latency under load: jsonl append -> text in #latest, for long replies, a growing reply, a hand-back, a peer message
// and a compact summary; each must also be visible there (not folded into a section, not behind a summary bubble),
// while a second tab follows a ~60MB session appended every second and the terminal streams output.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { ReaderFeed } from '../main/reader-feed';
import { send } from '../main/ipc';
import { assertFixtureOutsideClaude } from './snapshot-views';
import type { Kit, TabsDeps } from './snapshot';
import type { ReaderUpdate } from '../shared/types';

const BOUND_MS = 500;
const SAMPLES = 5;
const TIMEOUT_MS = 8000;
const PRIOR_TURNS = 20; // the reader keeps 20 replies, so every update carries a full history
const BIG_SESSION_BYTES = 60 * 1024 * 1024;
const BIG_APPEND_MS = 1000;

const stamp = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;
const user = (uuid: string, content: unknown) => stamp({ type: 'user', uuid, message: { role: 'user', content } });
const assistant = (uuid: string, text: string) => stamp({ type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolResult = (uuid: string, bytes: number) => user(uuid, [{ type: 'tool_result', tool_use_id: uuid, content: 'x'.repeat(bytes) }]);
const handback = (uuid: string) => stamp({ type: 'user', uuid, isMeta: true, origin: { kind: 'peer', handback: true }, message: { role: 'user', content: 'agent finished' } });
const peerMessage = (uuid: string) => stamp({ type: 'user', uuid, isMeta: true, origin: { kind: 'peer' }, message: { role: 'user', content: 'another session wrote' } });
const compactSummary = (uuid: string) => stamp({ type: 'user', uuid, isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation.' } });
const queuedPrompt = (uuid: string, prompt: string) => stamp({ type: 'attachment', uuid, attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin: { kind: 'human' }, humanTurn: true } });

// A long sectioned reply like hers: headline, abstract, six sections with lists, a table and code, a status block.
function longReply(n: number, marker: string, diagram = false): string {
  const section = (i: number) => [
    `## ${i}. Section ${i} of reply ${n}`,
    '',
    `Paragraph ${i} explains one part in plain words, with \`code\` and a [link](https://example.com/${n}/${i}). `.repeat(4),
    '',
    `- point one for ${i}`, `- point two for ${i}`, `- point three for ${i}`,
    '',
    '| file | line | change |', '| --- | --- | --- |',
    ...Array.from({ length: 6 }, (_, r) => `| src/main/file-${r}.ts | ${r * 10} | changed row ${r} |`),
    '',
    '```ts', ...Array.from({ length: 12 }, (_, r) => `const value${r} = compute(${r}); // line ${r}`), '```',
  ].join('\n');
  const mindmap = ['```mermaid', 'mindmap', `  root((Reply ${n}))`, '    Main', '      tail', '      watch', '    Renderer', '      fold', '      steps', '```'].join('\n');
  return [
    `**Reply ${n} headline ${marker}**`, '',
    `**Abstract.** What changed in reply ${n} and why it matters, in two sentences. `.repeat(2), '',
    ...(diagram ? [mindmap, ''] : []),
    ...Array.from({ length: 6 }, (_, i) => section(i + 1)), '',
    '**Doing:** measuring.', '**Recommend:** keep going.', '**Next:** read the numbers.',
  ].join('\n');
}

// ~3MB of earlier turns with big tool results between them, like her 3MB session.
function priorTurns(prefix: string): string {
  let out = '';
  for (let n = 0; n < PRIOR_TURNS; n += 1) {
    out += user(`${prefix}-u${n}`, `prompt ${n}`) + toolResult(`${prefix}-t${n}`, 150_000) + assistant(`${prefix}-a${n}`, longReply(n, '', n % 5 === 0));
  }
  return out;
}

function writeBigSession(file: string): void {
  assertFixtureOutsideClaude(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, priorTurns('big'));
  for (let i = 0; fs.statSync(file).size < BIG_SESSION_BYTES; i += 1) fs.appendFileSync(file, toolResult(`big-fill-${i}`, 1_000_000));
}

interface Sample { emit: number | null; dom: number | null; bytes: number; loopLag: number }

function summarize(rows: Sample[]) {
  const doms = rows.map((r) => r.dom).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const emits = rows.map((r) => r.emit).filter((v): v is number => v !== null).sort((a, b) => a - b);
  return {
    shown: `${doms.length}/${rows.length}`,
    domMedian: doms[Math.floor(doms.length / 2)] ?? -1,
    domMax: doms.at(-1) ?? -1,
    emitMax: emits.at(-1) ?? -1,
    payloadKB: Math.round(Math.max(...rows.map((r) => r.bytes)) / 1024),
    mainLoopLagMax: Math.max(...rows.map((r) => r.loopLag)),
  };
}

export async function replyLatencyCheck(kit: Kit, { win, feed, file, sessions, openTab }: Pick<TabsDeps, 'sessions' | 'openTab'> & { win: BrowserWindow; feed: ReaderFeed; file: string }): Promise<void> {
  const { js, wait, waitFor, log, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} reply latency: ${what}`);
  const contents = win.webContents;
  await js('PastelTerm.welcome.close()');
  await js("PastelTerm.tabs.activate(PastelTerm.tabs.ids()[0]); PastelTerm.reader.setView('replies')");
  assertFixtureOutsideClaude(file);
  fs.appendFileSync(file, priorTurns('fx'));
  check(await waitFor(() => js("document.querySelectorAll('#older .older-turn').length >= 15"), 15000), 'fixture shows its 20 long earlier turns');

  // Main side: when the feed emitted the update carrying a marker, and how big that IPC payload was.
  const emitted = new Map<string, { at: number; bytes: number }>();
  const outstanding = new Set<string>();
  const original = Reflect.get(feed, 'send') as (channel: 'reader:replies', update: ReaderUpdate) => void;
  Reflect.set(feed, 'send', (channel: 'reader:replies', update: ReaderUpdate) => {
    const at = Date.now();
    original(channel, update);
    for (const marker of outstanding) {
      if (!emitted.has(marker) && update.replies[0]?.markdown.includes(marker)) emitted.set(marker, { at, bytes: JSON.stringify(update).length });
    }
  });
  // Main event-loop stalls: anything synchronous on the update path shows up here.
  let loopLag = 0;
  let lastBeat = Date.now();
  const beat = setInterval(() => { const now = Date.now(); loopLag = Math.max(loopLag, now - lastBeat - 10); lastBeat = now; }, 10);

  await js(`(() => {
    window.__seen = {}; window.__want = new Set();
    const latest = document.getElementById('latest');
    new MutationObserver(() => {
      if (!window.__want.size) return;
      const text = latest.textContent;
      for (const m of window.__want) if (text.includes(m)) { window.__seen[m] = Date.now(); window.__want.delete(m); }
    }).observe(latest, { subtree: true, childList: true, characterData: true });
  })()`);

  // Appends the lines, then waits for the marker in #latest.
  const measure = async (marker: string, lines: string): Promise<Sample> => {
    outstanding.add(marker);
    await js(`window.__want.add(${JSON.stringify(marker)})`);
    loopLag = 0;
    lastBeat = Date.now();
    const start = Date.now();
    fs.appendFileSync(file, lines);
    let seen: number | null = null;
    while (Date.now() - start < TIMEOUT_MS && !seen) {
      await wait(20);
      seen = await js(`window.__seen[${JSON.stringify(marker)}] ?? null`);
    }
    outstanding.delete(marker);
    const emit = emitted.get(marker);
    return { emit: emit ? emit.at - start : null, dom: seen ? seen - start : null, bytes: emit?.bytes ?? 0, loopLag };
  };

  // Renderer side: one full reader redraw of the current state, timed in the page.
  const renderMs = (): Promise<number> => js(`(() => {
    const tab = PastelTerm.tabs.active();
    const t = performance.now();
    PastelTerm.reader.update({ ...tab.update, tabId: tab.id, pending: tab.pending });
    return Math.round(performance.now() - t);
  })()`);

  // 'visible' unless the marker sits in a folded section or a compact summary shows as her message.
  const visibility = (marker: string): Promise<string> => js(`(() => {
    const m = ${JSON.stringify(marker)};
    if ([...document.querySelectorAll('#latest .story-section.folded')].some((s) => s.textContent.includes(m))) return 'folded into a section';
    if ([...document.querySelectorAll('#latest .reader-you')].some((b) => b.textContent.includes('being continued'))) return 'behind a summary bubble';
    return 'visible';
  })()`);

  const scenarios: [string, (run: string) => Promise<{ sample: Sample; extra?: string }>][] = [
    ['new turn, long reply', async (run) => ({ sample: await measure(`lat-new-${run}`, user(`u-${run}`, `ask ${run}`) + assistant(`a-${run}`, longReply(99, `lat-new-${run}`))) })],
    // The reply above has ## sections: the new text must not land inside the last one, which starts folded.
    ['same turn, text grows', async (run) => {
      const sample = await measure(`lat-more-${run}`, toolResult(`t-${run}`, 20_000) + assistant(`m-${run}`, `More text arrives: lat-more-${run}`));
      return { sample, extra: await visibility(`lat-more-${run}`) };
    }],
    ['after a hand-back', async (run) => {
      const sample = await measure(`lat-hand-${run}`, handback(`h-${run}`) + assistant(`hb-${run}`, longReply(98, `lat-hand-${run}`)));
      const id = await js("document.getElementById('latest').dataset.replyId");
      return { sample, extra: id === `hb-${run}` ? 'new' : `merged:${id}` };
    }],
    // Another session's SendMessage between turns: Claude's answer is a new reply, not appended to the sectioned one.
    ['after a peer message', async (run) => {
      const sample = await measure(`lat-peer-${run}`, peerMessage(`p-${run}`) + toolResult(`pt-${run}`, 2_000) + assistant(`pa-${run}`, `Peer note read: lat-peer-${run}`));
      const id = await js("document.getElementById('latest').dataset.replyId");
      return { sample, extra: id === `pa-${run}` ? 'new' : `merged:${id}` };
    }],
    // An auto-compact mid-turn: the summary is not her message, so the rest of the turn shows with no bubble over it.
    ['after a compact summary', async (run) => {
      const sample = await measure(`lat-compact-${run}`, compactSummary(`c-${run}`) + assistant(`ca-${run}`, `After the compact: lat-compact-${run}`));
      return { sample, extra: await visibility(`lat-compact-${run}`) };
    }],
    // Sent from the reply box while Claude works: Claude Code logs it only as a queued_command attachment.
    ['reply-box message mid-turn', async (run) => {
      await js(`(() => { const tab = PastelTerm.tabs.active(); PastelTerm.tabs.addPending(tab, 'mid-turn ask ${run}'); window.dispatchEvent(new CustomEvent('petal:reader-refresh', { detail: tab.id })); })()`);
      const sample = await measure(`lat-queued-${run}`, queuedPrompt(`q-${run}`, `mid-turn ask ${run}`) + assistant(`qa-${run}`, longReply(97, `lat-queued-${run}`)));
      const left = await js('PastelTerm.tabs.active().pending.length');
      await js('PastelTerm.tabs.active().pending = []'); // a stuck echo would hide every later sample
      return { sample, extra: left ? `echo stuck:${left}` : 'new' };
    }],
  ];

  const runAll = async (phase: string): Promise<boolean> => {
    let pass = true;
    for (const [name, step] of scenarios) {
      const rows: Sample[] = [];
      const extras: string[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        await wait(250 + ((i * 337) % 900)); // spread samples across the 1s tick phase
        const { sample, extra } = await step(`${phase.slice(0, 4)}${Date.now().toString(36)}${i}`);
        rows.push(sample);
        if (extra) extras.push(extra);
      }
      const s = summarize(rows);
      const render = await renderMs();
      log(`reply latency [${phase}] ${name}: ${JSON.stringify({ ...s, renderMs: render })} raw=${JSON.stringify(rows.map((r) => [r.emit, r.dom]))}`);
      const newReply = !extras.length || extras.every((e) => e === 'new' || e === 'visible');
      if (!newReply) check(false, `[${phase}] ${name}: the answer is its own reply and in view, no echo left behind: ${extras.join()}`);
      const ok = s.shown === `${SAMPLES}/${SAMPLES}` && s.domMax < BOUND_MS && newReply;
      check(ok, `[${phase}] ${name} shows in #latest within ${BOUND_MS}ms: max ${s.domMax}ms, ${s.shown} shown`);
      pass &&= ok;
    }
    return pass;
  };

  if (feed.fixture) feed.fixture.status = 'busy'; // Claude is mid-turn while these lines land
  await wait(1500); // the next tick carries busy to the page
  await runAll('quiet');

  // Load: a second tab follows a 60MB session that grows every second, and the active terminal streams.
  const bigFile = path.join(outDir, 'reply-latency', 'big-session.jsonl');
  writeBigSession(bigFile);
  const ownTabs = () => [...sessions.values()].filter((s) => s.contentsId === contents.id);
  const before = new Set(ownTabs());
  openTab(contents, { background: true });
  const bg = await waitFor(() => ownTabs().find((s) => !before.has(s)) ?? null, 10000);
  let bgFeed: ReaderFeed | null = null;
  let grow: NodeJS.Timeout | undefined;
  try {
    check(bg, 'a background tab opened for the big session');
    if (bg) {
      bg.feed.stop();
      bgFeed = new ReaderFeed(bg.pty.pid, (channel, update) => {
        if (!contents.isDestroyed()) send(contents, channel, { ...update, tabId: bg.tabId, label: 'big session' });
      }, { fixture: { sessionId: 'reply-latency-big', transcript: bigFile, status: 'busy' } });
      bg.feed = bgFeed;
      check(await waitFor(() => (bgFeed?.session ? true : null), 15000), 'the background tab follows the 60MB session');
      let n = 0;
      grow = setInterval(() => {
        n += 1;
        fs.appendFileSync(bigFile, n % 2 ? assistant(`big-live-${n}`, longReply(200 + n, '')) : toolResult(`big-live-${n}`, 300_000));
      }, BIG_APPEND_MS);
    }
    await wait(2500); // login shell rc files
    await js(`window.pastel.write(PastelTerm.tabs.ids()[0], ${JSON.stringify("for i in $(seq 1 1500); do printf '\\033[2K\\r\\033[36m* streaming %s\\033[0m %s\\n' $i $(printf '%.0sx' $(seq 1 100)); sleep 0.03; done\r")})`);
    await wait(1500);
    const loaded = await runAll('loaded');
    log(`${loaded ? 'ok' : 'FAIL'} reply latency: every scenario under load within ${BOUND_MS}ms`);
  } finally {
    clearInterval(grow);
    clearInterval(beat);
    if (feed.fixture) feed.fixture.status = 'idle';
    Reflect.set(feed, 'send', original);
    await js(`window.pastel.write(PastelTerm.tabs.ids()[0], '\\x03')`);
    bgFeed?.stop();
    if (bg) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(bg.tabId)})`);
    await waitFor(() => (ownTabs().length === 1 ? true : null), 8000);
  }
}
