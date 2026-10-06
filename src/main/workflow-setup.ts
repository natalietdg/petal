// Workflow, Setup tab: how her Claude Code setup is wired (CLAUDE.md rules, routed skills, agents, output style).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { label, LABEL_CHARS, readJson, readText } from './workflow-common';
import { frontmatter, oneLine, parseClaudeMd, type ClaudeMdOutline } from './workflow-frontmatter';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

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
