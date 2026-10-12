// Hand one session to another: a clean markdown copy of its prompts and replies, without tool noise.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';
import { rawPromptText, commandText, isHandback } from './prompts';
import { stripPasted } from '../shared/pasted-content';
import { sessionTitle } from '../shared/session-label';
import { assistantText } from './replies';
import { parseEntry, type TranscriptEntry } from './transcript-entry';
import { writeFileAtomic } from './atomic-file';

// Keep the newest turns only, so the copy stays small enough to read into another session.
const MAX_CHARS = 120 * 1024;

export interface Turn {
  prompt: string;
  reply: string[];
}

export interface HandoffRecord {
  title: string;
  cwd: string | null;
  sessionId: string;
  file: string;
}

const handoffsDir = () => path.join(app.getPath('userData'), 'handoffs');

// Streams the jsonl line by line: transcripts can be hundreds of MB.
export async function readTurns(file: string): Promise<Turn[]> {
  const turns: Turn[] = [];
  let afterHandback = false; // Claude's answer to a subagent's report is its own turn, with no prompt of hers
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry: TranscriptEntry | null;
    try { entry = line ? parseEntry(line) : null; } catch { entry = null; }
    if (!entry) continue;
    const prompt = rawPromptText(entry) || commandText(entry); // History's bubbles split out pasted blocks
    if (prompt) {
      turns.push({ prompt, reply: [] });
      afterHandback = false;
      continue;
    }
    if (isHandback(entry)) afterHandback = true;
    const text = assistantText(entry);
    if (!text) continue;
    if (afterHandback) turns.push({ prompt: '', reply: [] });
    afterHandback = false;
    turns.at(-1)?.reply.push(text);
  }
  return turns;
}

export function toMarkdown(record: HandoffRecord, turns: Turn[]): string {
  const blocks = turns.map((t) => `${t.prompt ? `## You\n\n${stripPasted(t.prompt)}\n\n` : ''}## Claude\n\n${t.reply.join('\n\n') || '_(no text reply)_'}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = blocks.length - 1; i >= 0 && size + blocks[i].length <= MAX_CHARS; i -= 1) {
    kept.unshift(blocks[i]);
    size += blocks[i].length;
  }
  const dropped = blocks.length - kept.length;
  const head = [
    `# Earlier session: ${sessionTitle({ title: record.title, cwd: record.cwd })}`, // the caller passes the shared name; this covers an empty one
    '',
    `- Folder: ${record.cwd ?? 'unknown'}`,
    `- Session id: ${record.sessionId}`,
    `- Full transcript: ${record.file}`,
    dropped ? `- Showing the newest ${kept.length} of ${blocks.length} turns; older ones are in the full transcript.` : `- All ${blocks.length} turns.`,
    '',
  ];
  return [...head, ...kept].join('\n');
}

// Writes <userData>/handoffs/<sessionId>.md and returns its path.
export async function writeHandoff(record: HandoffRecord): Promise<{ file: string; turns: number }> {
  const turns = await readTurns(record.file);
  const file = path.join(handoffsDir(), `${record.sessionId}.md`);
  writeFileAtomic(file, toMarkdown(record, turns));
  return { file, turns: turns.length };
}
