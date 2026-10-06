// Just enough Markdown parsing for the Setup tab: skill/agent frontmatter and the CLAUDE.md outline.
import { cap } from './workflow-common';

const DESCRIPTION_CHARS = 140;

// Just enough YAML for skill/agent frontmatter: plain, quoted and folded (>, |) values.
export function frontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!field) continue;
    let value = field[2].trim();
    if (/^[>|][-+]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[(i += 1)].trim());
      value = block.join(' ').trim();
    }
    fields[field[1]] = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return fields;
}

// First sentence, capped: enough to say what it is without the trigger list.
export function oneLine(text: unknown, max = DESCRIPTION_CHARS): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const stop = clean.search(/[.!?](\s|$)/);
  return cap(stop > 0 && stop < max ? clean.slice(0, stop + 1) : clean, max);
}

const stripMarkdown = (text: string) => text.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();

export interface ClaudeMdOutline {
  headings: { level: number; text: string }[];
  routing: { trigger: string; skills: string[] }[];
}

// Headings outside code fences, and the "trigger → **skill**" bullets under the routing heading.
export function parseClaudeMd(text: string): ClaudeMdOutline {
  const headings: ClaudeMdOutline['headings'] = [];
  const routing: ClaudeMdOutline['routing'] = [];
  let inFence = false;
  let inRouting = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      headings.push({ level: heading[1].length, text: stripMarkdown(heading[2]) });
      inRouting = /skills routing/i.test(heading[2]);
      continue;
    }
    if (!inRouting || !/^\s*[-*]\s/.test(line) || !line.includes('→')) continue;
    const [left, ...rest] = line.replace(/^\s*[-*]\s+/, '').split('→');
    const right = rest.join('→');
    const skills = [...right.matchAll(/\*\*([\w:.-]+)\*\*/g)].map((m) => m[1]);
    if (skills.length) routing.push({ trigger: stripMarkdown(left), skills });
  }
  return { headings, routing };
}
