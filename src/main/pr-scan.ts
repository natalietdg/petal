// Finds a session's PRs in its log: the ones a create command opened (from its output) and the ones Claude wrote down.
import { contentItems } from './prompts';
import { parseAzOutput, parseCreateCommand, type CreateCall } from './pr-command';
import { findPrLinks, prKey, type PrRef } from '../shared/pr-links';
import type { TranscriptEntry } from './transcript-entry';
import type { SessionPr } from '../shared/session-prs';

const MAX_TITLE = 120;

const resultText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part: { type?: string; text?: unknown }) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('\n');
};

// The words a reply puts beside a link: a markdown link's own text, else the rest of its line.
export function titleBeside(text: string, index: number, length: number): string {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const lineEnd = text.indexOf('\n', index + length);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const at = index - lineStart;
  const linkText = /\[([^\]]+)\]\($/.exec(line.slice(0, at))?.[1];
  const words = linkText && !/^https?:\/\//.test(linkText) && !/^#?\d+$/.test(linkText.trim()) ? linkText : line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return words
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\*\*|__|`|^\s*(?:[-*+]|\d+\.)\s+/g, ' ')
    .replace(/\b(?:PR|pull request)\b\s*(?:#\d+)?\s*[:-]?/gi, ' ')
    .replace(/[|()[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:·,.–—-]+|[\s:·,–—-]+$/g, '')
    .slice(0, MAX_TITLE);
}

interface PendingCreate { call: CreateCall; at: string | null }

export class PrScan {
  private readonly found = new Map<string, SessionPr>();
  private readonly pending = new Map<string, PendingCreate>(); // tool_use id -> the create call waiting for its output

  add(entry: TranscriptEntry): void {
    if (entry.isSidechain) return;
    const cwd = typeof entry.cwd === 'string' ? entry.cwd : null;
    for (const item of contentItems(entry)) {
      if (entry.type === 'assistant' && item.type === 'text' && item.text) this.mentioned(item.text, entry.timestamp ?? null);
      if (entry.type === 'assistant' && item.type === 'tool_use' && item.name === 'Bash' && item.id && typeof item.input?.command === 'string') {
        const call = parseCreateCommand(item.input.command, cwd);
        if (call) this.pending.set(item.id, { call, at: entry.timestamp ?? null });
      }
      const create = item.type === 'tool_result' && item.tool_use_id ? this.pending.get(item.tool_use_id) : undefined;
      if (create && item.tool_use_id) {
        this.pending.delete(item.tool_use_id);
        this.created(create, resultText(item.content));
      }
    }
  }

  prs(): SessionPr[] {
    return [...this.found.values()];
  }

  private mentioned(text: string, at: string | null): void {
    for (const { ref, index, length } of findPrLinks(text)) {
      this.upsert({ ...ref, title: titleBeside(text, index, length), branch: null, localPath: null, at, created: false });
    }
  }

  private created({ call, at }: PendingCreate, output: string): void {
    const az = call.tool === 'az' ? parseAzOutput(output) : null;
    const ref: PrRef | undefined = az?.ref ?? findPrLinks(output)[0]?.ref;
    if (!ref) return; // the create failed before naming a PR
    this.upsert({ ...ref, title: call.title ?? az?.title ?? '', branch: call.branch ?? az?.branch ?? null, localPath: call.dir, at, created: true });
  }

  // A PR seen twice keeps its first sighting's time; what its create command said wins over a reply's words.
  private upsert(pr: SessionPr): void {
    const key = prKey(pr);
    const before = this.found.get(key);
    if (!before) { this.found.set(key, pr); return; }
    const lead = pr.created && !before.created ? pr : before;
    const other = lead === pr ? before : pr;
    this.found.set(key, {
      ...lead,
      title: lead.title || other.title,
      branch: lead.branch ?? other.branch,
      localPath: lead.localPath ?? other.localPath,
      at: before.at ?? pr.at,
      created: before.created || pr.created,
    });
  }
}
