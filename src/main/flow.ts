// Deterministic "flow of outcomes" for one session: steps per real prompt, with labelled outcomes.
// Stream-parses the jsonl line by line, so large logs are never loaded whole.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { contentItems, isHandback, isUserTurn, promptText, commandText, trimTo } from './prompts';
import { assistantText } from './replies';
import { parseEntry, type TranscriptEntry } from './transcript-entry';
import { counters } from './snapshot-mode';
import type { OutcomeLabel } from '../shared/types';

const LABELS: Record<string, OutcomeLabel> = { 'done': 'done', 'decide': 'decide', 'watch out': 'watch', 'next': 'next', 'why': 'why' };
const CALLOUT = /^\s*(?:[-*]\s+)?\*\*(done|decide|watch out|next|why):?\*\*:?\s*(.+)$/i;
const HEADLINE = /^\s*\*\*(.+?)\*\*/;
const AUDIT = /^\s*#(\d+)\s*\|\s*([^|]+?)\s*\|\s*(ACTION|DECISION)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*(?:\|.*)?$/;
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

export interface Outcome {
  label: OutcomeLabel;
  text: string;
}

export interface AuditRow {
  n: number;
  date: string;
  kind: string;
  actor: string;
  what: string;
}

export interface StateChange {
  what: string;
  from: string;
  to: string;
}

export interface FlowStep {
  index: number;
  label: string;
  title: string;
  excerpt?: string; // input for AI titles; dropped before storing
  headline: string | null;
  outcomes: Outcome[];
  files: string[];
  audit: AuditRow[];
  replyIds: (string | undefined)[];
  waitingOnYou: boolean;
  quiet: boolean;
  changes?: StateChange[]; // written by flow-titles
}

export interface Flow {
  steps: FlowStep[];
  finalNext: Outcome | null;
}

interface RawStep {
  index: number;
  label: string;
  replies: string[];
  replyIds: (string | undefined)[];
  files: Set<string>;
}

const cache = new Map<string, { mtimeMs: number; size: number; flow: Flow }>();

function newStep(prompt: string, index: number): RawStep {
  return { index, label: trimTo(prompt, 70), replies: [], replyIds: [], files: new Set() };
}

// Audit ledger lines only count inside fenced code blocks.
function auditLines(text: string): AuditRow[] {
  const rows: AuditRow[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    const match = inFence && AUDIT.exec(line);
    if (match) rows.push({ n: Number(match[1]), date: match[2], kind: match[3], actor: match[4], what: match[5] });
  }
  return rows;
}

function callouts(text: string): Outcome[] {
  return text.split('\n').flatMap((line) => {
    const match = CALLOUT.exec(line);
    return match ? [{ label: LABELS[match[1].toLowerCase()], text: trimTo(match[2].replace(/\*\*/g, ''), OUTCOME_CHARS) }] : [];
  });
}

const FILLER = /^(?:yes|no|ok(?:ay)?|got it|done|right|sure|fair enough)[,.!:]?\s+/i;
const TITLE_WORDS = 8;
const OUTCOME_CHARS = 160;
const EXCERPT_CHARS = 600;
const HEADLINE_CHARS = 140;

// Short node title: first sentence of the headline, filler dropped, cut at a clause if long.
function titleFrom(headline: string | undefined): string | null {
  if (!headline) return null;
  let text = headline.replace(FILLER, '').split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, '');
  for (const sep of [': ', '; ', ', ']) {
    const [head] = text.split(sep);
    if (text.split(/\s+/).length > TITLE_WORDS && head.split(/\s+/).length >= 3) text = head;
  }
  const words = text.split(/\s+/);
  const short = words.slice(0, TITLE_WORDS).join(' ') + (words.length > TITLE_WORDS ? '…' : '');
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function summarise(step: RawStep): FlowStep {
  const lastReply = step.replies.at(-1) ?? '';
  const outcomes = step.replies.flatMap(callouts);
  const audit = step.replies.flatMap(auditLines);
  const headline = HEADLINE.exec(lastReply)?.[1];
  const visible = outcomes.filter((o) => o.label !== 'why');
  return {
    index: step.index,
    label: step.label,
    title: titleFrom(headline) ?? trimTo(step.label, 50),
    excerpt: trimTo(lastReply.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' '), EXCERPT_CHARS),
    headline: headline ? trimTo(headline, HEADLINE_CHARS) : null,
    outcomes,
    files: [...step.files],
    audit,
    replyIds: step.replyIds,
    waitingOnYou: visible.at(-1)?.label === 'decide',
    quiet: !headline && !outcomes.length && !step.files.size && !audit.length,
  };
}

async function extract(file: string): Promise<Flow> {
  counters.flowExtractions += 1; // lets the snapshot prove a stored flow skipped the jsonl
  const steps: RawStep[] = [];
  let step: RawStep | null = null;
  let turnOpen = false;
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });

  for await (const line of lines) {
    let entry: TranscriptEntry;
    try { entry = parseEntry(line); } catch { continue; }

    if (isUserTurn(entry)) {
      turnOpen = false;
      const prompt = promptText(entry) || commandText(entry); // "/release" starts a step too
      if (prompt) {
        step = newStep(prompt, steps.length + 1);
        steps.push(step);
      }
      continue;
    }
    if (isHandback(entry)) turnOpen = false; // the reader starts a new reply here, so the step gets its id too
    if (entry.type !== 'assistant' || entry.isSidechain || !step) continue;

    for (const item of contentItems(entry)) {
      if (item.type === 'tool_use' && item.name && EDIT_TOOLS.has(item.name)) {
        const target = item.input?.file_path ?? item.input?.notebook_path;
        if (target) step.files.add(path.basename(target));
      }
    }
    const text = assistantText(entry);
    if (!text) continue;
    if (!turnOpen) step.replyIds.push(entry.uuid); // same ids the reader uses for its replies
    turnOpen = true;
    step.replies.push(text);
  }

  const summarised = steps.map(summarise);
  const finalNext = summarised.flatMap((s) => s.outcomes).filter((o) => o.label === 'next').at(-1) ?? null;
  return { steps: summarised, finalNext };
}

export async function flowFor(file: string): Promise<Flow> {
  const stat = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.flow;
  const flow = await extract(file);
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, flow });
  return flow;
}
