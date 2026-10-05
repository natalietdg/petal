// Workflow dashboard data: today's sessions, how the Claude setup is wired, where time goes, and handoffs.
// Read-only everywhere: ~/.claude is only ever read, never written.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const IDLE_GAP_MS = 15 * 60 * 1000; // a longer pause counts as stepping away, not working
const MAX_SCAN_BYTES = 200 * 1024 * 1024; // bigger logs are skipped rather than read
const RECURRING_DAYS = 3;
const RECENT_TIDIED = 6;
const LABEL_CHARS = 40;
const STATUSES = ['in progress', 'blocked', 'done'];
const CLAUDE_DIR = path.join(os.homedir(), '.claude');

const tagsFile = () => path.join(app.getPath('userData'), 'tags.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function cap(text, max = LABEL_CHARS) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function startOfDay(ms) {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// Local calendar day, so "3 different days" matches her clock, not UTC.
function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Grouping: tags when tags.json exists, else the organizer project, else the folder.

function loadTags() {
  const data = readJson(tagsFile(), null);
  if (!data || typeof data !== 'object' || typeof data.sessions !== 'object') return null;
  return { tags: data.tags ?? {}, sessions: data.sessions ?? {} };
}

const titleOf = (session, labels) => labels[session.sessionId]?.title || session.title || 'Untitled session';
function folderName(cwd) {
  if (!cwd) return 'Unsorted';
  return path.resolve(cwd) === os.homedir() ? 'Home folder' : path.basename(cwd);
}
const projectOf = (session, labels) => labels[session.sessionId]?.project || folderName(session.cwd);

// A session can carry several tags, so it can sit in several groups.
function groupsFor(session, labels, tags) {
  if (!tags) return [{ name: projectOf(session, labels), color: null }];
  const names = tags.sessions[session.sessionId]?.tags ?? [];
  if (!names.length) return [{ name: 'Untagged', color: null }];
  return names.map((name) => ({ name, color: tags.tags[name]?.color ?? null }));
}

function bucket(map, { name, color }, init) {
  if (!map.has(name)) map.set(name, { name, color, ...init() });
  return map.get(name);
}

// ---- 1. Today

function todayData({ sessions, labels, tags, openTabs = [], now = Date.now() }) {
  const todays = sessions.filter((s) => s.lastAt >= startOfDay(now));
  const tabs = new Map(openTabs.filter((t) => t?.sessionId).map((t) => [t.sessionId, t]));
  const counts = { 'in progress': 0, blocked: 0, done: 0, unlabeled: 0 };
  const groups = new Map();
  for (const session of todays) {
    const status = labels[session.sessionId]?.status ?? null;
    counts[STATUSES.includes(status) ? status : 'unlabeled'] += 1;
    const row = {
      sessionId: session.sessionId,
      title: titleOf(session, labels),
      status: STATUSES.includes(status) ? status : null,
      lastAt: session.lastAt,
      live: Boolean(session.live),
      open: tabs.has(session.sessionId),
      busy: Boolean(tabs.get(session.sessionId)?.busy),
    };
    for (const group of groupsFor(session, labels, tags)) bucket(groups, group, () => ({ items: [] })).items.push(row);
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
      title: cap(t?.title || labels[t?.sessionId]?.title || 'Shell', 80),
      busy: Boolean(t?.busy),
    })),
    recentlyTidied,
  };
}

// ---- 2. How my setup works

// Just enough YAML for skill/agent frontmatter: plain, quoted and folded (>, |) values.
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const fields = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!field) continue;
    let value = field[2].trim();
    if (/^[>|][-+]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[(i += 1)].trim());
      value = block.join(' ').trim();
    }
    fields[field[1]] = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return fields;
}

// First sentence, capped: enough to say what it is without the trigger list.
function oneLine(text, max = 140) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const stop = clean.search(/[.!?](\s|$)/);
  return cap(stop > 0 && stop < max ? clean.slice(0, stop + 1) : clean, max);
}

const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const isDir = (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } };
const listDir = (dir) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };

function listSkills(claudeDir) {
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
function listAgents(claudeDir) {
  const dir = path.join(claudeDir, 'agents');
  const read = (file, group) => {
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

function activeOutputStyle(claudeDir) {
  const wanted = readJson(path.join(claudeDir, 'settings.json'), {})?.outputStyle;
  if (!wanted) return { name: 'Default', description: 'Claude Code’s built-in style.' };
  const dir = path.join(claudeDir, 'output-styles');
  for (const file of listDir(dir).filter((f) => f.endsWith('.md'))) {
    const meta = frontmatter(readText(path.join(dir, file)));
    const names = [meta.name, path.basename(file, '.md')].filter(Boolean).map((n) => n.toLowerCase());
    if (names.includes(String(wanted).toLowerCase())) return { name: meta.name || wanted, description: oneLine(meta.description) };
  }
  return { name: wanted, description: '' };
}

const stripMarkdown = (text) => text.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();

// Headings outside code fences, and the "trigger → **skill**" bullets under the routing heading.
function parseClaudeMd(text) {
  const headings = [];
  const routing = [];
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
const label = (text, max = LABEL_CHARS) => cap(text, max).replace(/"/g, '\'').replace(/[<>#;{}]/g, ' ');

const ROW_CHARS = 40;
const NB_HYPHEN = '\u2011'; // Mermaid then wraps between names, never inside "log-triage"

// Packs names into rows, stacked in one tidy column (~~~ is an invisible link).
function stackedRows(prefix, rawNames) {
  const rows = [];
  for (const name of rawNames.map((n) => n.replace(/-/g, NB_HYPHEN))) {
    const last = rows.at(-1);
    if (last && `${last} · ${name}`.length <= ROW_CHARS) rows[rows.length - 1] = `${last} · ${name}`;
    else rows.push(name);
  }
  return [`    ${rows.map((row, i) => `${prefix}${i}["${label(row, LABEL_CHARS + 8)}"]`).join(' ~~~ ')}`];
}

function setupMermaid({ rulesCount, routedSkills, skillsTotal, agents, style }) {
  const topAgents = agents.filter((a) => !a.group).map((a) => a.name);
  const groups = new Map();
  for (const a of agents.filter((x) => x.group)) groups.set(a.group, (groups.get(a.group) ?? 0) + 1);
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

function setupData({ claudeDir = CLAUDE_DIR } = {}) {
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
const stampCache = new Map(); // file -> { mtimeMs, size, stamps }

// Regex over raw chunks: no JSON.parse of huge tool results. Escaped quotes inside strings never match.
async function readStamps(file) {
  const stamps = [];
  let carry = '';
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 * 1024 })) {
    const text = carry + chunk;
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
async function stampsFor(file) {
  let stat;
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
function activity(stamps, since) {
  const recent = stamps.filter((t) => t >= since);
  let ms = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const gap = recent[i] - recent[i - 1];
    if (gap < IDLE_GAP_MS) ms += gap;
  }
  return { ms, days: new Set(recent.map(dayKey)) };
}

const hours = (ms) => Math.round((ms / 3_600_000) * 10) / 10;

async function timeData({ sessions, labels, tags, now = Date.now() }) {
  const since = now - WEEK_MS;
  const groups = new Map();
  const seenOn = new Map(); // "project:x" or "title:y" -> Set of days
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
      if (!seenOn.has(key)) seenOn.set(key, new Set());
      for (const day of days) seenOn.get(key).add(day);
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

const EDGE = { send: '-->', resume: '-.->', fork: '==>' };

function handoffData({ links, sessions, labels, now = Date.now() }) {
  const since = now - WEEK_MS;
  const recent = links.filter((l) => Date.parse(l.at) >= since);
  const counts = { send: 0, resume: 0, fork: 0 };
  for (const link of recent) counts[link.kind] += 1;
  if (!recent.length) return { total: 0, counts, mermaid: null, nodes: 0 };

  const titles = new Map(sessions.map((s) => [s.sessionId, titleOf(s, labels)]));
  const nameOf = (id) => (id ? titles.get(id) || labels[id]?.title || `Session ${id.slice(0, 8)}` : 'New tab');
  const ids = new Map(); // sessionId (or "") -> mermaid node id
  const nodeFor = (id) => {
    const key = id ?? '';
    if (!ids.has(key)) ids.set(key, `n${ids.size}`);
    return ids.get(key);
  };
  // Repeats of the same hop collapse into one edge with a count.
  const edges = new Map();
  for (const { from, to, kind } of recent) {
    const key = `${from}|${to}|${kind}`;
    edges.set(key, { from, to, kind, n: (edges.get(key)?.n ?? 0) + 1 });
  }
  const edgeLines = [...edges.values()].map(({ from, to, kind, n }) =>
    `  ${nodeFor(from)} ${EDGE[kind]}|"${kind}${n > 1 ? ` ×${n}` : ''}"| ${nodeFor(to)}`);
  const nodeLines = [...ids].map(([id, node]) => (id ? `  ${node}["${label(nameOf(id))}"]` : `  ${node}(["New tab"])`));
  return { total: recent.length, counts, nodes: ids.size, mermaid: ['flowchart LR', ...nodeLines, ...edgeLines].join('\n') };
}

module.exports = {
  loadTags,
  todayData,
  setupData,
  timeData,
  handoffData,
  // exported for tests
  parseClaudeMd,
  frontmatter,
  activity,
  IDLE_GAP_MS,
};
