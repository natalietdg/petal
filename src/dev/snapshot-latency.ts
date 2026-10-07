// Measures jsonl line appended -> reader DOM shows it, for her prompt lines and Claude's reply lines.
import fs from 'node:fs';
import type { ReaderFeed } from '../main/reader-feed';
import type { Kit } from './snapshot';

const SAMPLES = 8;
const TIMEOUT_MS = 3000;

interface Stats { n: number; shown: number; min: number; median: number; max: number }

function stats(values: (number | null)[]): Stats {
  const shown = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const at = (q: number) => shown[Math.min(shown.length - 1, Math.floor(q * shown.length))] ?? -1;
  return { n: values.length, shown: shown.length, min: shown[0] ?? -1, median: at(0.5), max: shown.at(-1) ?? -1 };
}

// Records when main emitted the update carrying a marker, to split watch delay from IPC + render.
function tapEmits(feed: ReaderFeed, emitted: Map<string, number>, markers: () => string[]): () => void {
  const original = Reflect.get(feed, 'send') as (channel: 'reader:replies', update: unknown) => void;
  Reflect.set(feed, 'send', (channel: 'reader:replies', update: unknown) => {
    const text = JSON.stringify(update);
    for (const marker of markers()) if (!emitted.has(marker) && text.includes(marker)) emitted.set(marker, Date.now());
    original(channel, update);
  });
  return () => Reflect.set(feed, 'send', original);
}

export async function latencyCheck(kit: Kit, { feed, file }: { feed: ReaderFeed; file: string }): Promise<void> {
  const { js, wait, log } = kit;
  await js("PastelTerm.tabs.activate(PastelTerm.tabs.ids()[0]); PastelTerm.reader.setView('replies')");
  await js(`(() => {
    window.__seen = {}; window.__want = [];
    const reader = document.getElementById('reader');
    new MutationObserver(() => {
      const text = reader.textContent;
      for (const m of window.__want) if (!window.__seen[m] && text.includes(m)) window.__seen[m] = Date.now();
    }).observe(reader, { subtree: true, childList: true, characterData: true });
  })()`);
  const emitted = new Map<string, number>();
  const outstanding: string[] = [];
  const untap = tapEmits(feed, emitted, () => outstanding);
  const line = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;

  // Appends one line and waits for the reader to show its marker; returns [append->emit, append->DOM].
  const measure = async (marker: string, fields: Record<string, unknown>): Promise<[number | null, number | null]> => {
    outstanding.push(marker);
    await js(`window.__want.push(${JSON.stringify(marker)})`);
    const start = Date.now();
    fs.appendFileSync(file, line(fields));
    let seen: number | null = null;
    while (Date.now() - start < TIMEOUT_MS && !seen) {
      await wait(20);
      seen = await js(`window.__seen[${JSON.stringify(marker)}] ?? null`);
    }
    const emit = emitted.get(marker);
    return [emit ? emit - start : null, seen ? seen - start : null];
  };

  const prompt: [number | null, number | null][] = [];
  const reply: [number | null, number | null][] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    await wait(300 + ((i * 263) % 1000)); // spread samples across the 1s tick phase
    const run = `${Date.now().toString(36)}${i}`;
    prompt.push(await measure(`latency-prompt-${run}`, { type: 'user', uuid: `lat-u-${run}`, message: { role: 'user', content: `latency-prompt-${run}` } }));
    reply.push(await measure(`latency-reply-${run}`, { type: 'assistant', uuid: `lat-a-${run}`, message: { role: 'assistant', content: [{ type: 'text', text: `latency-reply-${run}` }] } }));
  }
  untap();
  const report = (what: string, rows: [number | null, number | null][]) => {
    const dom = stats(rows.map((r) => r[1]));
    log(`latency ${what}: append->DOM ${JSON.stringify(dom)} append->emit ${JSON.stringify(stats(rows.map((r) => r[0])))} raw=${JSON.stringify(rows)}`);
    return dom;
  };
  const promptStats = report('her prompt line', prompt);
  const replyStats = report('reply text line', reply);
  log(`${promptStats.shown === SAMPLES ? 'ok' : 'FAIL'} her prompt line shows in the reader without waiting for a reply: ${promptStats.shown}/${SAMPLES}`);
  log(`${replyStats.shown === SAMPLES && replyStats.max < 500 ? 'ok' : 'FAIL'} reply line shows within 500ms: max ${replyStats.max}ms`);
}
