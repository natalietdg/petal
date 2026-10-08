// Two throwaway History sessions for the notes and reply steps; their logs live in the snapshot folder, never ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import { historyFixture } from '../main/snapshot-mode';
import { assertFixtureOutsideClaude } from './snapshot-views';

export const FIXTURE_A = 'f1f1f1f1-0000-4000-8000-00000000000a';
export const FIXTURE_B = 'f2f2f2f2-0000-4000-8000-00000000000b';

function writeLog(file: string, prompt: string, reply: string): void {
  assertFixtureOutsideClaude(file);
  const at = new Date().toISOString();
  const lines = [
    { type: 'user', uuid: `${path.basename(file)}-u`, timestamp: at, isSidechain: false, message: { role: 'user', content: prompt } },
    { type: 'assistant', uuid: `${path.basename(file)}-a`, timestamp: at, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}

// Adds both sessions to History, newest first; returns a function that takes them out again.
export function addHistoryFixture(outDir: string): () => void {
  const dir = path.join(outDir, 'history-fixture');
  const record = (sessionId: string, title: string, prompt: string, reply: string, ageMs: number) => {
    const file = path.join(dir, `${sessionId}.jsonl`);
    writeLog(file, prompt, reply);
    return { sessionId, file, cwd: path.join(dir, title.toLowerCase().replace(/\W+/g, '-')), title, firstPrompt: prompt, lastAt: Date.now() + 60_000 - ageMs, messages: 2, messagesExact: true };
  };
  historyFixture.records = [
    record(FIXTURE_A, 'Fixture session A', 'plan the garden', 'Plant **tomatoes** first.', 0),
    record(FIXTURE_B, 'Fixture session B', 'name the cat', 'Mika suits her.', 1000),
  ];
  historyFixture.live = [];
  historyFixture.resumes = [];
  return () => {
    historyFixture.records = [];
    historyFixture.live = [];
  };
}

export const FIXTURE_STATUS = 'f3f3f3f3-0000-4000-8000-00000000000c';
export const FIXTURE_PLAIN = 'f4f4f4f4-0000-4000-8000-00000000000d';

// One session whose reply carries Doing / Recommend / Next, one without; returns a function that takes them out.
export function addStatusFixture(outDir: string, statusReply: string): () => void {
  const dir = path.join(outDir, 'history-status-fixture');
  const record = (sessionId: string, title: string, prompt: string, reply: string, ageMs: number) => {
    const file = path.join(dir, `${sessionId}.jsonl`);
    writeLog(file, prompt, reply);
    return { sessionId, file, cwd: path.join(dir, title.toLowerCase().replace(/\W+/g, '-')), title, firstPrompt: prompt, lastAt: Date.now() + 60_000 - ageMs, messages: 2, messagesExact: true };
  };
  historyFixture.records = [
    record(FIXTURE_STATUS, 'Status fixture', 'where do cycles live?', statusReply, 0),
    record(FIXTURE_PLAIN, 'Plain fixture', 'name the cat', 'Mika suits her.', 1000),
  ];
  historyFixture.live = [];
  return () => { historyFixture.records = []; };
}
