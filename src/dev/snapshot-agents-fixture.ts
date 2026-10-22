// Made-up subagent transcripts for the Agents step, beside the fixture jsonl (never ~/.claude, no real paths).
import fs from 'node:fs';
import path from 'node:path';
import { assertFixtureOutsideClaude } from './snapshot-views';

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const line = (fields: Record<string, unknown>): string => `${JSON.stringify({ isSidechain: true, ...fields })}\n`;
const prompt = (text: string, msAgo: number) => line({ type: 'user', timestamp: ago(msAgo), message: { role: 'user', content: text } });
const say = (content: unknown[], msAgo: number, stop: string | null = 'tool_use') => line({ type: 'assistant', timestamp: ago(msAgo), message: { role: 'assistant', content, stop_reason: stop } });
const use = (id: string, name: string, input: Record<string, string>) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: unknown, msAgo: number) => line({ type: 'user', timestamp: ago(msAgo), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });

// Tool output with markup in it: the timeline must show it as text, never as HTML.
export const HOSTILE_OUTPUT = `<img src="x" id="agents-xss-probe" onerror="window.__agentsXss = 1">${' 12 tests passed'.repeat(60)}`;

export const RUNNING_ID = 'fx1running';
export const FINISHED_ID = 'fx2finished';
export const NEWER_ID = 'fx3newer'; // finished, but started after the running one: running still lists first

function writeAgent(dir: string, id: string, description: string, body: string, mtimeMsAgo: number): string {
  const file = path.join(dir, `agent-${id}.jsonl`);
  assertFixtureOutsideClaude(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, body);
  fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description }));
  const when = new Date(Date.now() - mtimeMsAgo);
  fs.utimesSync(file, when, when);
  return file;
}

// <fixture dir>/snapshot-fixture/subagents: where the fixture session's agents live, like a real session's.
export function writeAgentsFixture(dir: string): { running: string; finished: string; newer: string } {
  fs.rmSync(dir, { recursive: true, force: true });
  const running = writeAgent(dir, RUNNING_ID, 'Tidy the print styles', [
    prompt('<system-reminder>context</system-reminder>\nTidy the print stylesheet, then run the tests.', 240_000),
    say([{ type: 'text', text: 'Looking at the **print sheet** first.' }, use('r1', 'Read', { file_path: '/demo/app/src/print.css' })], 230_000),
    result('r1', 'body { margin: 0 }', 229_000),
    say([use('b1', 'Bash', { command: 'npm test', description: 'Run the unit tests' })], 200_000),
    result('b1', [{ type: 'text', text: HOSTILE_OUTPUT }], 190_000),
  ].join(''), 5_000);
  const finished = writeAgent(dir, FINISHED_ID, 'Check the header spacing', [
    prompt('Check the header spacing at 800px.', 600_000),
    say([use('e1', 'Edit', { file_path: '/demo/app/src/header.css' })], 560_000),
    result('e1', 'ok', 559_000),
    say([use('h1', 'SubagentHandback', { message: '**Header spacing checked.** Nothing overlaps at 800px.' })], 540_000),
    result('h1', 'Report delivered to your caller.', 539_000),
  ].join(''), 180_000);
  const newer = writeAgent(dir, NEWER_ID, 'Proof the colour key', [
    prompt('Proof the colour key labels.', 60_000),
    say([use('n1', 'Read', { file_path: '/demo/app/src/colour-key.ts' })], 50_000),
    result('n1', 'ok', 49_000),
    say([{ type: 'text', text: 'Labels read fine.' }], 40_000, 'end_turn'),
  ].join(''), 40_000);
  return { running, finished, newer };
}

// Lines the step appends while the timeline is open.
export const appendedStep = (): string => say([use('e2', 'Edit', { file_path: '/demo/app/src/print.css' })], 0);
export const appendedReport = (): string => say([{ type: 'text', text: '**Print styles tidied.** All tests pass.' }], 0, 'end_turn');

// A finished agent from yesterday: the chip and dropdown still list it.
export const YESTERDAY_ID = 'fxyesterday';
export function writeYesterdayAgent(dir: string): void {
  const hours30 = 30 * 3600_000;
  writeAgent(dir, YESTERDAY_ID, 'Sweep from yesterday', [prompt('Sweep the old notes.', hours30 + 60_000), say([{ type: 'text', text: 'Done.' }], hours30, 'end_turn')].join(''), hours30);
}

// Many finished agents, so the dropdown has to scroll inside its cap.
export function writeManyAgents(dir: string, count: number): void {
  for (let i = 0; i < count; i++) {
    writeAgent(dir, `fxmany${i}`, `Filler agent ${i + 1}`, [prompt(`Filler ${i + 1}.`, 900_000 + i * 1000), say([{ type: 'text', text: 'Done.' }], 850_000 + i * 1000, 'end_turn')].join(''), 850_000 + i * 1000);
  }
}
