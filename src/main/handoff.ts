// Hand one session to another: a clean markdown copy of its prompts and replies, without tool noise.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';
import { promptText, commandText } from './prompts';
import { assistantText } from './replies';
import { parseEntry, type TranscriptEntry } from './transcript-entry';

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
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry: TranscriptEntry | null;
    try { entry = line ? parseEntry(line) : null; } catch { entry = null; }
    if (!entry) continue;
    const prompt = promptText(entry) || commandText(entry);
    if (prompt) {
      turns.push({ prompt, reply: [] });
      continue;
    }
    const text = assistantText(entry);
    if (text) turns.at(-1)?.reply.push(text);
  }
  return turns;
}

export function toMarkdown(record: HandoffRecord, turns: Turn[]): string {
  const blocks = turns.map((t) => `## You\n\n${t.prompt}\n\n## Claude\n\n${t.reply.join('\n\n') || '_(no text reply)_'}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = blocks.length - 1; i >= 0 && size + blocks[i].length <= MAX_CHARS; i -= 1) {
    kept.unshift(blocks[i]);
    size += blocks[i].length;
  }
  const dropped = blocks.length - kept.length;
  const head = [
    `# Earlier session: ${record.title || 'Untitled session'}`,
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
  fs.mkdirSync(handoffsDir(), { recursive: true });
  const file = path.join(handoffsDir(), `${record.sessionId}.md`);
  fs.writeFileSync(file, toMarkdown(record, turns));
  return { file, turns: turns.length };
}
