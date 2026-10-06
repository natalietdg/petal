// Workflow dashboard data: today's sessions, how the Claude setup is wired, where time goes, and handoffs.
// Read-only everywhere: ~/.claude is only ever read, never written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { ListedSession } from './history';
import type { OrganizerStore } from './session-organizer';
import type { Link, LinkKind } from './links-store';
import type { TagsData } from './tags-store';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
export const IDLE_GAP_MS = 15 * 60 * 1000; // a longer pause counts as stepping away, not working
const MAX_SCAN_BYTES = 200 * 1024 * 1024; // bigger logs are skipped rather than read
const RECURRING_DAYS = 3;
const RECENT_TIDIED = 6;
const LABEL_CHARS = 40;
const STATUSES = ['in progress', 'blocked', 'done'] as const;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');

type Status = (typeof STATUSES)[number];
type Tags = Pick<TagsData, 'tags' | 'sessions'>;

export interface OpenTab {
  sessionId: string | null;
  title?: string;
  busy?: boolean;
}

interface GroupKey {
  name: string;
  color: string | null;
}

const tagsFile = () => path.join(app.getPath('userData'), 'tags.json');

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function cap(text: unknown, max = LABEL_CHARS): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function startOfDay(ms: number): number {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// Local calendar day, so "3 different days" matches her clock, not UTC.
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Grouping: tags when tags.json exists, else the organizer project, else the folder.

export function loadTags(): Tags | null {
  const data = readJson<Partial<TagsData> | null>(tagsFile(), null);
  if (!data || typeof data !== 'object' || typeof data.sessions !== 'object') return null;
  return { tags: data.tags ?? {}, sessions: data.sessions ?? {} };
}

const titleOf = (session: ListedSession, labels: OrganizerStore): string => labels[session.sessionId]?.title || session.title || 'Untitled session';
function folderName(cwd: string | null): string {
  if (!cwd) return 'Unsorted';
  return path.resolve(cwd) === os.homedir() ? 'Home folder' : path.basename(cwd);
}
const projectOf = (session: ListedSession, labels: OrganizerStore): string => labels[session.sessionId]?.project || folderName(session.cwd);

// A session can carry several tags, so it can sit in several groups.
function groupsFor(session: ListedSession, labels: OrganizerStore, tags: Tags | null): GroupKey[] {
  if (!tags) return [{ name: projectOf(session, labels), color: null }];
  const names = tags.sessions[session.sessionId]?.tags ?? [];
  if (!names.length) return [{ name: 'Untagged', color: null }];
  return names.map((name) => ({ name, color: tags.tags[name]?.color ?? null }));
}

function bucket<T extends object>(map: Map<string, GroupKey & T>, { name, color }: GroupKey, init: () => T): GroupKey & T {
  let entry = map.get(name);
  if (!entry) {
    entry = { name, color, ...init() };
    map.set(name, entry);
  }
  return entry;
}

// ---- 1. Today

export interface TodayRow {
  sessionId: string;
  title: string;
  status: Status | null;
  lastAt: number;
  live: boolean;
  open: boolean;
  busy: boolean;
}

export interface TodayData {
  groupedBy: 'tag' | 'project';
  total: number;
  counts: Record<Status | 'unlabeled', number>;
  groups: (GroupKey & { items: TodayRow[] })[];
  openTabs: { sessionId: string | null; title: string; busy: boolean }[];
  recentlyTidied: { sessionId: string; title: string; project: string | null; status: string | null; at: string }[];
}

interface DashboardInputs {
  sessions: ListedSession[];
  labels: OrganizerStore;
  tags: Tags | null;
  now?: number;
}

const isStatus = (value: unknown): value is Status => STATUSES.includes(value as Status);

export function todayData({ sessions, labels, tags, openTabs = [], now = Date.now() }: DashboardInputs & { openTabs?: (OpenTab | null)[] }): TodayData {
  const todays = sessions.filter((s) => s.lastAt >= startOfDay(now));
  const tabs = new Map(openTabs.flatMap((t) => (t?.sessionId ? [[t.sessionId, t] as const] : [])));
  const counts = { 'in progress': 0, blocked: 0, done: 0, unlabeled: 0 };
  const groups = new Map<string, GroupKey & { items: TodayRow[] }>();
  for (const session of todays) {
    const status = labels[session.sessionId]?.status ?? null;
    counts[isStatus(status) ? status : 'unlabeled'] += 1;
    const row: TodayRow = {
      sessionId: session.sessionId,
      title: titleOf(session, labels),
      status: isStatus(status) ? status : null,
      lastAt: session.lastAt,
      live: Boolean(session.live),
      open: tabs.has(session.sessionId),
      busy: Boolean(tabs.get(session.sessionId)?.busy),
    };
    for (const group of groupsFor(session, labels, tags)) bucket(groups, group, () => ({ items: [] as TodayRow[] })).items.push(row);
  }
  const recentlyTidied = Object.entries(labels)
    .filter(([, entry]) => typeof entry?.at === 'string')
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, RECENT_TIDIED)
    .map(([sessionId, entry]) => ({ sessionId, title: entry.title, project: entry.project ?? null, status: entry.status ?? null, at: entry.at }));
  return {
    groupedBy: tags ? 'tag' : 'project',
    total: todays.length,
    counts,
    groups: [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name)),
    openTabs: openTabs.map((t) => ({
      sessionId: t?.sessionId ?? null,
      title: cap(t?.title || (t?.sessionId ? labels[t.sessionId]?.title : undefined) || 'Shell', 80),
      busy: Boolean(t?.busy),
    })),
    recentlyTidied,
  };
}

// ---- 2. How my setup works

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
function oneLine(text: unknown, max = 140): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const stop = clean.search(/[.!?](\s|$)/);
  return cap(stop > 0 && stop < max ? clean.slice(0, stop + 1) : clean, max);
}

const isFile = (file: string) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const isDir = (dir: string) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };
const listDir = (dir: string) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };

export interface SkillInfo {
  name: string;
  description: string;
}

export interface AgentInfo extends SkillInfo {
  group: string | null;
}

function listSkills(claudeDir: string): SkillInfo[] {
  const dir = path.join(claudeDir, 'skills');
  return listDir(dir)
    .map((name) => ({ name, file: path.join(dir, name, 'SKILL.md') }))
    .filter(({ file }) => isFile(file))
    .map(({ name, file }) => {
      const meta = frontmatter(readText(file));
      return { name: meta.name || name, description: oneLine(meta.description) };
    });
}

// Top-level agents, plus one level of folders (e.g. a marketing pipeline) as a group.
function listAgents(claudeDir: string): AgentInfo[] {
  const dir = path.join(claudeDir, 'agents');
  const read = (file: string, group: string | null): AgentInfo => {
    const meta = frontmatter(readText(file));
    return { name: meta.name || path.basename(file, '.md'), description: oneLine(meta.description), group };
  };
  const agents = listDir(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name.endsWith('.md') && isFile(full)) return [read(full, null)];
    if (!isDir(full)) return [];
    return listDir(full).filter((f) => f.endsWith('.md')).map((f) => read(path.join(full, f), name));
  });
  return agents.sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '')); // ungrouped first, stable within groups
}

function activeOutputStyle(claudeDir: string): SkillInfo {
  const wanted = readJson<{ outputStyle?: string } | null>(path.join(claudeDir, 'settings.json'), {})?.outputStyle;
  if (!wanted) return { name: 'Default', description: 'Claude Code’s built-in style.' };
  const dir = path.join(claudeDir, 'output-styles');
  for (const file of listDir(dir).filter((f) => f.endsWith('.md'))) {
    const meta = frontmatter(readText(path.join(dir, file)));
    const names = [meta.name, path.basename(file, '.md')].filter(Boolean).map((n) => n.toLowerCase());
    if (names.includes(String(wanted).toLowerCase())) return { name: meta.name || wanted, description: oneLine(meta.description) };
  }
  return { name: wanted, description: '' };
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

// Mermaid labels sit in double quotes; these characters would end or confuse them.
const label = (text: unknown, max = LABEL_CHARS) => cap(text, max).replace(/"/g, '\'').replace(/[<>#;{}]/g, ' ');

const ROW_CHARS = 40;
const NB_HYPHEN = '‑'; // Mermaid then wraps between names, never inside "log-triage"

// Packs names into rows, stacked in one tidy column (~~~ is an invisible link).
function stackedRows(prefix: string, rawNames: string[]): string[] {
  const rows: string[] = [];
  for (const name of rawNames.map((n) => n.replace(/-/g, NB_HYPHEN))) {
    const last = rows.at(-1);
    if (last && `${last} · ${name}`.length <= ROW_CHARS) rows[rows.length - 1] = `${last} · ${name}`;
    else rows.push(name);
  }
  return [`    ${rows.map((row, i) => `${prefix}${i}["${label(row, LABEL_CHARS + 8)}"]`).join(' ~~~ ')}`];
}

function setupMermaid({ rulesCount, routedSkills, skillsTotal, agents, style }: { rulesCount: number; routedSkills: string[]; skillsTotal: number; agents: AgentInfo[]; style: SkillInfo }): string {
  const topAgents = agents.filter((a) => !a.group).map((a) => a.name);
  const groups = new Map<string, number>();
  for (const a of agents) if (a.group) groups.set(a.group, (groups.get(a.group) ?? 0) + 1);
  const agentNames = [...topAgents, ...[...groups].map(([g, n]) => `${g} pipeline · ${n} agents`)];
  return [
    'flowchart LR',
    '  req(["Request"]) --> rules["CLAUDE.md · ' + rulesCount + ' rule sections"]',
    '  rules --> route{{"Routing table"}}',
    '  route --> skills',
    '  route --> agents',
    `  subgraph skills["Skills · ${routedSkills.length} routed of ${skillsTotal}"]`,
    '    direction TB',
    ...(routedSkills.length ? stackedRows('s', routedSkills) : ['    s0["None yet"]']),
    '  end',
    `  subgraph agents["Agents · ${agents.length}"]`,
    '    direction TB',
    ...(agentNames.length ? stackedRows('a', agentNames) : ['    a0["None yet"]']),
    '  end',
    `  skills --> outstyle["Output style · ${label(style.name, 24)}"]`,
    '  agents --> outstyle',
    '  outstyle --> petal(["Petal reader"])',
  ].join('\n');
}

export interface SetupData extends ClaudeMdOutline {
  sections: string[];
  skills: SkillInfo[];
  agents: AgentInfo[];
  style: SkillInfo;
  routedSkills: string[];
  mermaid: string;
}

export function setupData({ claudeDir = CLAUDE_DIR }: { claudeDir?: string } = {}): SetupData {
  const { headings, routing } = parseClaudeMd(readText(path.join(claudeDir, 'CLAUDE.md')));
  const skills = listSkills(claudeDir);
  const agents = listAgents(claudeDir);
  const style = activeOutputStyle(claudeDir);
  const routedSkills = [...new Set(routing.flatMap((r) => r.skills))];
  const sections = headings.filter((h) => h.level === 2);
  return {
    headings,
    sections: sections.map((h) => h.text),
    routing,
    skills,
    agents,
    style,
    routedSkills,
    mermaid: setupMermaid({ rulesCount: sections.length, routedSkills, skillsTotal: skills.length, agents, style }),
  };
}

// ---- 3. Where my time goes

const STAMP = /"timestamp":"(\d{4}-\d{2}-\d{2}T[^"]{4,30})"/g;
const OVERLAP = 64; // longer than any whole match, so a stamp split across chunks is still found
const stampCache = new Map<string, { mtimeMs: number; size: number; stamps: number[] }>();

// Regex over raw chunks: no JSON.parse of huge tool results. Escaped quotes inside strings never match.
async function readStamps(file: string): Promise<number[]> {
  const stamps: number[] = [];
  let carry = '';
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 * 1024 })) {
    const text = carry + String(chunk);
    for (const m of text.matchAll(STAMP)) {
      if (m.index + m[0].length <= carry.length) continue; // already counted in the previous chunk
      const at = Date.parse(m[1]);
      if (!Number.isNaN(at)) stamps.push(at);
    }
    carry = text.slice(-OVERLAP);
  }
  return stamps.sort((a, b) => a - b);
}

// Cached by mtime and size; returns null for logs too big to scan.
async function stampsFor(file: string): Promise<number[] | null> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (stat.size > MAX_SCAN_BYTES) return null;
  const hit = stampCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.stamps;
  const stamps = await readStamps(file);
  stampCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, stamps });
  return stamps;
}

// Active time = the sum of gaps under 15 minutes between consecutive timestamps.
export function activity(stamps: number[], since: number): { ms: number; days: Set<string> } {
  const recent = stamps.filter((t) => t >= since);
  let ms = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const gap = recent[i] - recent[i - 1];
    if (gap < IDLE_GAP_MS) ms += gap;
  }
  return { ms, days: new Set(recent.map(dayKey)) };
}

const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;

export interface TimeGroup extends GroupKey {
  sessions: number;
  activeMs: number;
  activeHours: number;
}

export interface TimeData {
  since: number;
  groupedBy: 'tag' | 'project';
  sessions: number;
  skipped: number;
  totalMs: number;
  totalHours: number;
  groups: TimeGroup[];
  recurring: { kind: string; name: string; days: number }[];
}

export async function timeData({ sessions, labels, tags, now = Date.now() }: DashboardInputs): Promise<TimeData> {
  const since = now - WEEK_MS;
  const groups = new Map<string, GroupKey & { sessions: number; activeMs: number }>();
  const seenOn = new Map<string, Set<string>>(); // "project:x" or "title:y" -> Set of days
  let totalMs = 0;
  let counted = 0;
  let skipped = 0;
  for (const session of sessions.filter((s) => s.lastAt >= since)) {
    const stamps = await stampsFor(session.file); // one file at a time keeps memory flat
    if (!stamps) { skipped += 1; continue; }
    const { ms, days } = activity(stamps, since);
    if (!days.size) continue;
    counted += 1;
    totalMs += ms;
    for (const group of groupsFor(session, labels, tags)) {
      const entry = bucket(groups, group, () => ({ sessions: 0, activeMs: 0 }));
      entry.sessions += 1;
      entry.activeMs += ms;
    }
    const project = projectOf(session, labels);
    const title = titleOf(session, labels);
    for (const key of [`project:${project}`, ...(title !== project ? [`title:${title}`] : [])]) {
      let seen = seenOn.get(key);
      if (!seen) {
        seen = new Set();
        seenOn.set(key, seen);
      }
      for (const day of days) seen.add(day);
    }
  }
  const recurring = [...seenOn]
    .filter(([, days]) => days.size >= RECURRING_DAYS)
    .map(([key, days]) => ({ kind: key.slice(0, key.indexOf(':')), name: key.slice(key.indexOf(':') + 1), days: days.size }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  return {
    since,
    groupedBy: tags ? 'tag' : 'project',
    sessions: counted,
    skipped,
    totalMs,
    totalHours: hours(totalMs),
    groups: [...groups.values()]
      .map((g) => ({ ...g, activeHours: hours(g.activeMs) }))
      .sort((a, b) => b.activeMs - a.activeMs || b.sessions - a.sessions),
    recurring,
  };
}

// ---- 4. Handoffs

const EDGE: Record<LinkKind, string> = { send: '-->', resume: '-.->', fork: '==>' };

export interface HandoffData {
  total: number;
  counts: Record<LinkKind, number>;
  nodes: number;
  mermaid: string | null;
}

export function handoffData({ links, sessions, labels, now = Date.now() }: { links: Link[]; sessions: ListedSession[]; labels: OrganizerStore; now?: number }): HandoffData {
  const since = now - WEEK_MS;
  const recent = links.filter((l) => Date.parse(l.at) >= since);
  const counts = { send: 0, resume: 0, fork: 0 };
  for (const link of recent) counts[link.kind] += 1;
  if (!recent.length) return { total: 0, counts, mermaid: null, nodes: 0 };

  const titles = new Map(sessions.map((s) => [s.sessionId, titleOf(s, labels)]));
  const nameOf = (id: string | null) => (id ? titles.get(id) || labels[id]?.title || `Session ${id.slice(0, 8)}` : 'New tab');
  const ids = new Map<string, string>(); // sessionId (or "") -> mermaid node id
  const nodeFor = (id: string | null): string => {
    const key = id ?? '';
    let node = ids.get(key);
    if (!node) {
      node = `n${ids.size}`;
      ids.set(key, node);
    }
    return node;
  };
  // Repeats of the same hop collapse into one edge with a count.
  const edges = new Map<string, { from: string | null; to: string | null; kind: LinkKind; n: number }>();
  for (const { from, to, kind } of recent) {
    const key = `${from}|${to}|${kind}`;
    edges.set(key, { from, to, kind, n: (edges.get(key)?.n ?? 0) + 1 });
  }
  const edgeLines = [...edges.values()].map(({ from, to, kind, n }) =>
    `  ${nodeFor(from)} ${EDGE[kind]}|"${kind}${n > 1 ? ` ×${n}` : ''}"| ${nodeFor(to)}`);
  const nodeLines = [...ids].map(([id, node]) => (id ? `  ${node}["${label(nameOf(id))}"]` : `  ${node}(["New tab"])`));
  return { total: recent.length, counts, nodes: ids.size, mermaid: ['flowchart LR', ...nodeLines, ...edgeLines].join('\n') };
}
