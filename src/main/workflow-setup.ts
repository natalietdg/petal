// Workflow, Setup tab: how her Claude Code setup is wired (CLAUDE.md rules, routed skills, agents, output style).
import fs from 'node:fs';
import path from 'node:path';
import { label, LABEL_CHARS, readJson, readText } from './workflow-common';
import { frontmatter, oneLine, parseClaudeMd, type ClaudeMdOutline } from './workflow-frontmatter';

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

interface SetupShape {
  hasClaudeMd: boolean;
  rulesCount: number;
  routed: boolean;
  routedSkills: string[];
  skills: SkillInfo[];
  agents: AgentInfo[];
  style: SkillInfo;
}

function agentLabels(agents: AgentInfo[]): string[] {
  const groups = new Map<string, number>();
  for (const a of agents) if (a.group) groups.set(a.group, (groups.get(a.group) ?? 0) + 1);
  return [...agents.filter((a) => !a.group).map((a) => a.name), ...[...groups].map(([g, n]) => `${g} pipeline · ${n} agents`)];
}

// Draws only the parts that exist; null when there are no skills, agents or routing to show.
function setupMermaid({ hasClaudeMd, rulesCount, routed, routedSkills, skills, agents, style }: SetupShape): string | null {
  if (!routed && !skills.length && !agents.length) return null;
  const lines = ['flowchart LR', '  req(["Request"])'];
  let from = 'req';
  const step = (id: string, node: string) => { lines.push(`  ${from} --> ${id}${node}`); from = id; };
  if (hasClaudeMd) step('rules', `["CLAUDE.md · ${rulesCount} rule sections"]`);
  if (routed) step('route', '{{"Routing table"}}');
  const ends: string[] = [];
  if (skills.length) {
    const names = routed ? routedSkills : skills.map((s) => s.name);
    const title = routed ? `Skills · ${routedSkills.length} routed of ${skills.length}` : `Skills · ${skills.length}`;
    lines.push(`  ${from} --> skills`, `  subgraph skills["${title}"]`, '    direction TB', ...(names.length ? stackedRows('s', names) : ['    s0["None routed yet"]']), '  end');
    ends.push('skills');
  }
  if (agents.length) {
    lines.push(`  ${from} --> agents`, `  subgraph agents["Agents · ${agents.length}"]`, '    direction TB', ...stackedRows('a', agentLabels(agents)), '  end');
    ends.push('agents');
  }
  lines.push(`  outstyle["Output style · ${label(style.name, 24)}"]`);
  for (const end of ends.length ? ends : [from]) lines.push(`  ${end} --> outstyle`);
  lines.push('  outstyle --> petal(["Petal reader"])');
  return lines.join('\n');
}

export interface SetupData extends ClaudeMdOutline {
  hasClaudeMd: boolean;
  sections: string[];
  skills: SkillInfo[];
  agents: AgentInfo[];
  style: SkillInfo;
  routedSkills: string[];
  mermaid: string | null; // null: nothing to draw
}

// Nothing to show: what an empty ~/.claude reads as, without reading anything.
export const emptySetup = (): SetupData => ({
  hasClaudeMd: false, headings: [], sections: [], routing: [], skills: [], agents: [],
  style: { name: 'Default', description: 'Claude Code’s built-in style.' }, routedSkills: [], mermaid: null,
});

// claudeDir: her ~/.claude (from the gate) or a test's stand-in.
export function setupData({ claudeDir }: { claudeDir: string }): SetupData {
  const claudeMd = path.join(claudeDir, 'CLAUDE.md');
  const hasClaudeMd = isFile(claudeMd);
  const { headings, routing } = parseClaudeMd(readText(claudeMd));
  const skills = listSkills(claudeDir);
  const agents = listAgents(claudeDir);
  const style = activeOutputStyle(claudeDir);
  const routedSkills = [...new Set(routing.flatMap((r) => r.skills))];
  const sections = headings.filter((h) => h.level === 2);
  return {
    hasClaudeMd,
    headings,
    sections: sections.map((h) => h.text),
    routing,
    skills,
    agents,
    style,
    routedSkills,
    mermaid: setupMermaid({ hasClaudeMd, rulesCount: sections.length, routed: routing.length > 0, routedSkills, skills, agents, style }),
  };
}
