// Plain-words activity lines from the tail of a Claude Code jsonl (read-only, last 64KB).
const path = require('node:path');
const { readTail } = require('./jsonl-window');

const TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 256 * 1024; // big attachment entries can push the last reply past 64KB
const SNIPPET = 60;

const clip = (text) => {
  const flat = String(text ?? '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET)}…` : flat;
};

const readTailEntries = (file, bytes) => readTail(file, bytes).entries;

function describeTool({ name, input = {} }) {
  const base = (file) => path.basename(String(file ?? ''));
  switch (name) {
    case 'Bash': return clip(input.description || input.command);
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return `Editing ${base(input.file_path ?? input.notebook_path)}`;
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Grep': case 'Glob': return 'Searching';
    case 'Agent': case 'Task': return `Subagent: ${clip(input.description)}`;
    default: return name;
  }
}

function activitiesOf(entry) {
  if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) return [];
  return entry.message.content.flatMap((item) => {
    if (item.type === 'tool_use') return [{ text: describeTool(item), at: entry.timestamp }];
    if (item.type === 'text' && item.text?.trim()) return [{ text: `Replied: ${clip(item.text)}`, at: entry.timestamp }];
    return [];
  });
}

// Newest-last activity lines found in the file's tail; widens the tail once if it holds none.
function recentActivity(file, count) {
  const found = readTailEntries(file, TAIL_BYTES).flatMap(activitiesOf);
  const lines = found.length ? found : readTailEntries(file, MAX_TAIL_BYTES).flatMap(activitiesOf);
  return lines.slice(-count);
}

module.exports = { recentActivity };
