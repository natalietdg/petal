// A Claude reply that asks another session something ends with `**To @<session name>:** message`.
import { codeFenceTracker } from './status-lines';
import { mentionSlug, type MentionTarget } from './mentions';

export interface MentionLine {
  name: string;
  message: string;
}

// "**To @name:** msg" or "**To @name**: msg"; quotes around the name are dropped.
const LINE = /^\s*(?:\*\*|__)To\s+@(.+?)(?:\s*:\s*(?:\*\*|__)|(?:\*\*|__)\s*:)\s*(\S.*)$/i;
const unquote = (name: string): string => name.trim().replace(/^["“'](.*)["”']$/, '$1').trim();

// The reply's last To line outside code (the styles ask for it at the very end); else null.
export function parseMentionLine(markdown: string): MentionLine | null {
  const inCode = codeFenceTracker();
  let found: MentionLine | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (inCode(line)) continue;
    const match = LINE.exec(line);
    const name = unquote(match?.[1] ?? '');
    const message = match?.[2]?.trim() ?? '';
    if (name && message) found = { name, message };
  }
  return found;
}

// The open session a To line names: its full name, its @session slug, or a name it starts with (when only one does).
export function resolveMentionName(name: string, targets: readonly MentionTarget[]): MentionTarget | null {
  const wanted = name.toLowerCase().replace(/^session:/, '');
  const exact = targets.find((t) => t.name.toLowerCase() === wanted || t.slug === wanted);
  if (exact) return exact;
  const bySlug = targets.find((t) => t.slug === mentionSlug(wanted));
  if (bySlug) return bySlug;
  const prefixed = targets.filter((t) => t.name.toLowerCase().startsWith(wanted));
  return prefixed.length === 1 ? prefixed[0] ?? null : null;
}
