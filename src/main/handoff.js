// Hand one session to another: a clean markdown copy of its prompts and replies, without tool noise.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { app } = require('electron');
const { promptText, commandText } = require('./prompts');
const { assistantText } = require('./replies');

// Keep the newest turns only, so the copy stays small enough to read into another session.
const MAX_CHARS = 120 * 1024;

const handoffsDir = () => path.join(app.getPath('userData'), 'handoffs');

// Streams the jsonl line by line: transcripts can be hundreds of MB.
async function readTurns(file) {
  const turns = [];
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry;
    try { entry = line ? JSON.parse(line) : null; } catch { entry = null; }
    if (!entry) continue;
    const prompt = promptText(entry) || commandText(entry);
    if (prompt) {
      turns.push({ prompt, reply: [] });
      continue;
    }
    const text = assistantText(entry);
    if (text && turns.length) turns.at(-1).reply.push(text);
  }
  return turns;
}

function toMarkdown(record, turns) {
  const blocks = turns.map((t) => `## You\n\n${t.prompt}\n\n## Claude\n\n${t.reply.join('\n\n') || '_(no text reply)_'}`);
  const kept = [];
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
async function writeHandoff(record) {
  const turns = await readTurns(record.file);
  fs.mkdirSync(handoffsDir(), { recursive: true });
  const file = path.join(handoffsDir(), `${record.sessionId}.md`);
  fs.writeFileSync(file, toMarkdown(record, turns));
  return { file, turns: turns.length };
}

module.exports = { writeHandoff, readTurns };
