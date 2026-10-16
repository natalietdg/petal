// The reply box's "/" menu: what an item is, Claude Code's own commands, and the filter that ranks what she types.

export type SlashKind = 'skill' | 'command' | 'agent' | 'builtin';

export interface SlashItem {
  kind: SlashKind;
  name: string; // as typed after the "/" (or "@agent-"), e.g. "my-plugin:review"
  description: string;
  source: string; // user, project, plugin <name>, or Claude Code
  insert: string; // what lands in the box, trailing space included
}

// allowed false: the Claude folder is off, so main read nothing and the menu offers Allow.
export interface SlashList {
  allowed: boolean;
  items: SlashItem[];
}

export const SLASH_GROUPS: { kind: SlashKind; label: string }[] = [
  { kind: 'skill', label: 'Skills' },
  { kind: 'command', label: 'Commands' },
  { kind: 'agent', label: 'Agents' },
  { kind: 'builtin', label: 'Claude Code' },
];

export const slashInsert = (kind: SlashKind, name: string): string => (kind === 'agent' ? `@agent-${name} ` : `/${name} `);

// From the Commands reference at code.claude.com/docs/en/commands (checked 2026-10-16).
const BUILTIN_ROWS: [string, string][] = [
  ['clear', 'Start a new conversation with empty context.'],
  ['compact', 'Free up context by summarizing the conversation so far.'],
  ['context', 'Show current context usage as a coloured grid.'],
  ['model', 'Switch the AI model.'],
  ['resume', 'Resume a conversation by ID or name, or open the picker.'],
  ['agents', 'A reminder to ask Claude to create or manage subagents.'],
  ['mcp', 'Manage MCP server connections and sign-in.'],
  ['memory', 'Edit CLAUDE.md files and auto memory.'],
  ['config', 'Open Settings: theme, model, output style and more.'],
  ['cost', 'Session cost and plan usage. Alias of /usage.'],
  ['help', 'Show help and available commands.'],
  ['init', 'Start a CLAUDE.md guide for this project.'],
  ['review', 'Review the current diff, a PR, branch or path. Alias of /code-review.'],
  ['output-style', 'List output styles or switch to one.'],
  ['skills', 'List available skills.'],
  ['plugin', 'Manage Claude Code plugins.'],
];

export const BUILTINS: SlashItem[] = BUILTIN_ROWS.map(([name, description]) => ({
  kind: 'builtin', name, description, source: 'Claude Code', insert: slashInsert('builtin', name),
}));

const isSubsequence = (needle: string, hay: string): boolean => {
  let at = 0;
  for (const ch of hay) if (ch === needle[at]) at += 1;
  return at === needle.length;
};

// Lower is better; null is no match. Name matches beat description matches.
function score(item: SlashItem, query: string): number | null {
  const name = item.name.toLowerCase();
  const description = item.description.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(/[:\-_ ]/).some((part) => part.startsWith(query))) return 2;
  if (name.includes(query)) return 3;
  if (isSubsequence(query, name)) return 4;
  if (description.includes(query)) return 5;
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => description.includes(w) || name.includes(w))) return 6;
  return null;
}

// Best matches first, ties kept in list order; an empty query keeps the whole list as it was.
export function filterSlash(items: SlashItem[], rawQuery: string): SlashItem[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return items;
  return items
    .map((item, index) => ({ item, index, rank: score(item, query) }))
    .filter((row): row is { item: SlashItem; index: number; rank: number } => row.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.item);
}

// The "/word" she is typing at the very start of the box, while the caret is still inside it; else null.
export function slashQuery(value: string, caret: number): string | null {
  if (!value.startsWith('/')) return null;
  const token = /^\/\S*/.exec(value)?.[0] ?? '/';
  return caret >= 1 && caret <= token.length ? token.slice(1) : null;
}

// Swaps the leading "/word" for the item; without one, the item goes in front of her text.
export function applySlash(value: string, insert: string): string {
  const rest = value.startsWith('/') ? value.replace(/^\/\S*\s?/, '') : value.trimStart();
  return `${insert}${rest}`;
}
