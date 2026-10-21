// A Claude Code session that edits code, shaped like Claude Code 2.1's jsonl: thinking (redacted and not), text,
// tool_use with caller, and tool_result entries carrying toolUseResult with the file's originalFile.
import type { TranscriptEntry } from '../../src/main/transcript-entry';

export const CWD = '/repo';
export const FILE = '/repo/src/cart.ts';

export const ORIGINAL = `import { round } from './money';

// The cart's total, in cents.
export function total(items: Item[]): number {
  return items.reduce((sum, i) => sum + i.price, 0);
}

export class Cart {
  private items: Item[] = [];

  add(item: Item): void {
    this.items.push(item);
  }

  clear(): void {
    this.items = [];
  }
}
`;

export const OLD_TOTAL = 'return items.reduce((sum, i) => sum + i.price, 0);';
export const NEW_TOTAL = 'return round(items.reduce((sum, i) => sum + i.price * i.qty, 0));';
export const REASON = 'Quantities were ignored, so a cart of three mugs cost the same as one. Multiply by qty and round once at the end.';

let n = 0;
const at = () => `2026-10-20T01:00:${String(n++).padStart(2, '0')}.000Z`;
const base = { isSidechain: false, cwd: CWD, sessionId: 'sess-1', version: '2.1.304', gitBranch: 'main', userType: 'external' };

const user = (uuid: string, text: string) => ({ ...base, type: 'user', uuid, timestamp: at(), promptId: `p-${uuid}`, message: { role: 'user', content: text } });
const assistant = (uuid: string, content: unknown[]) => ({
  ...base, type: 'assistant', uuid, timestamp: at(),
  message: { model: 'claude-opus-5-5', id: `msg_${uuid}`, type: 'message', role: 'assistant', content, stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 40 } },
});
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });
const result = (uuid: string, toolUseId: string, toolUseResult: unknown, isError = false) => ({
  ...base, type: 'user', uuid, timestamp: at(), sourceToolAssistantUUID: 'x',
  message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content: isError ? '<tool_use_error>String not found</tool_use_error>' : 'The file has been updated.', ...(isError ? { is_error: true } : {}) }] },
  toolUseResult,
});

export function sessionEntries(): TranscriptEntry[] {
  n = 0;
  const lines = [
    user('u1', 'the cart total ignores quantity, fix it'),
    assistant('a1-think', [{ type: 'thinking', thinking: '', signature: 'CAIS3goK' }]), // redacted thinking: not an excerpt
    assistant('a1', [{ type: 'text', text: REASON }]),
    assistant('a1-edit', [toolUse('t1', 'Edit', { replace_all: false, file_path: FILE, old_string: OLD_TOTAL, new_string: NEW_TOTAL })]),
    result('r1', 't1', { filePath: FILE, oldString: OLD_TOTAL, newString: NEW_TOTAL, originalFile: ORIGINAL, structuredPatch: [], userModified: false, replaceAll: false }),
    assistant('a1-bad', [toolUse('t2', 'Edit', { file_path: FILE, old_string: 'nope', new_string: 'never' })]),
    result('r2', 't2', 'Error: String to replace not found in file.', true), // failed: no card
    assistant('a1-env', [toolUse('t3', 'Write', { file_path: '/repo/.env.local', content: 'API_KEY=abc' })]),
    result('r3', 't3', { type: 'create', filePath: '/repo/.env.local', content: 'API_KEY=abc', structuredPatch: [], originalFile: null }),
    assistant('a1-done', [{ type: 'text', text: 'Fixed: the total now counts quantity.' }]),

    user('u2', 'also add a remove method and a README note'),
    assistant('a2', [{ type: 'thinking', thinking: 'Remove by id keeps callers from holding indexes that shift.', signature: 's' }, { type: 'text', text: 'Adding remove by id.' }]),
    assistant('a2-multi', [toolUse('t4', 'MultiEdit', { file_path: FILE, edits: [
      { old_string: '  clear(): void {', new_string: '  remove(id: string): void {\n    this.items = this.items.filter((i) => i.id !== id);\n  }\n\n  clear(): void {' },
      { old_string: "import { round } from './money';", new_string: "import { round } from './money';\nimport type { Item } from './item';" },
    ] })]),
    result('r4', 't4', { filePath: FILE, edits: [], originalFile: `${ORIGINAL.replace(OLD_TOTAL, NEW_TOTAL)}`, structuredPatch: [], userModified: false }),
    assistant('a2-write', [toolUse('t5', 'Write', { file_path: '/repo/README.md', content: '# Cart\n\nTotals count quantity.\n' })]),
    result('r5', 't5', { type: 'create', filePath: '/repo/README.md', content: '# Cart\n\nTotals count quantity.\n', structuredPatch: [], originalFile: null }),
  ];
  return lines.map((line) => JSON.parse(JSON.stringify(line)) as TranscriptEntry);
}
