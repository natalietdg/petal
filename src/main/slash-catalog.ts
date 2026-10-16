// What the reply box's "/" menu lists: skills, commands and agents from her Claude folder, the project and installed plugins.
// Read-only, and only reached through slash-ipc.ts, which asks the folder gate first.
import path from 'node:path';
import { readJson, readText } from './workflow-common';
import { frontmatter, oneLine } from './workflow-frontmatter';
import { agentsIn, isDir, isFile, listDir, skillsIn, type SkillInfo } from './workflow-setup';
import { slashInsert, type SlashItem, type SlashKind } from '../shared/slash';

const COMMAND_DEPTH = 3;
const SYNCED_DEPTH = 3;
const MANIFEST = path.join('.claude-plugin', 'plugin.json');

export interface PluginRoot {
  name: string; // the manifest name its skills, commands and agents are namespaced under
  root: string;
}

// The body's first line, for a command whose frontmatter has no description.
function firstLine(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? '';
}

// <dir>/**/*.md; a subfolder becomes part of the name ("frontend/component.md" is "frontend:component").
export function commandsIn(dir: string, prefix: string[] = []): SkillInfo[] {
  return listDir(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (entry.endsWith('.md') && isFile(full)) {
      const text = readText(full);
      const meta = frontmatter(text);
      return [{ name: [...prefix, path.basename(entry, '.md')].join(':'), description: oneLine(meta.description || firstLine(text)) }];
    }
    if (prefix.length < COMMAND_DEPTH && !entry.startsWith('.') && isDir(full)) return commandsIn(full, [...prefix, entry]);
    return [];
  });
}

type Enabled = Record<string, boolean>;

// enabledPlugins from user, then project, then local settings; a later file wins per plugin.
export function enabledPlugins(settingsFiles: string[]): Enabled {
  const merged: Enabled = {};
  for (const file of settingsFiles) {
    const map = readJson<{ enabledPlugins?: unknown } | null>(file, null)?.enabledPlugins;
    if (!map || typeof map !== 'object') continue;
    for (const [id, on] of Object.entries(map)) if (typeof on === 'boolean') merged[id] = on;
  }
  return merged;
}

const manifestName = (root: string, fallback: string): string => {
  const name = readJson<{ name?: unknown } | null>(path.join(root, MANIFEST), null)?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : fallback;
};

interface InstallRecord { installPath?: unknown; scope?: unknown; projectPath?: unknown }

// installed_plugins.json: { plugins: { "name@marketplace": [ { scope, installPath, projectPath? } ] } }; one record or a list.
function marketplacePlugins(pluginsDir: string, projectRoot: string | null, enabled: Enabled): PluginRoot[] {
  const installs = readJson<{ plugins?: Record<string, InstallRecord | InstallRecord[]> } | null>(path.join(pluginsDir, 'installed_plugins.json'), null)?.plugins;
  if (!installs || typeof installs !== 'object') return [];
  return Object.entries(installs).flatMap(([id, records]) => {
    if (enabled[id] === false) return [];
    const record = (Array.isArray(records) ? records : [records]).find((r) => {
      const scoped = r?.scope === 'project' || r?.scope === 'local';
      return typeof r?.installPath === 'string' && isDir(r.installPath) && (!scoped || r.projectPath === projectRoot);
    });
    if (!record) return [];
    const root = record.installPath as string;
    return [{ name: manifestName(root, id.split('@')[0]), root }];
  });
}

// plugins/synced/: plugins from her claude.ai account, found by their manifest a few folders down.
function syncedPlugins(pluginsDir: string, enabled: Enabled): PluginRoot[] {
  const found: PluginRoot[] = [];
  const walk = (dir: string, depth: number) => {
    if (isFile(path.join(dir, MANIFEST))) {
      const name = manifestName(dir, path.basename(dir));
      if (enabled[`${name}@synced`] !== false) found.push({ name, root: dir });
      return;
    }
    if (depth >= SYNCED_DEPTH) return;
    for (const entry of listDir(dir)) if (!entry.startsWith('.') && isDir(path.join(dir, entry))) walk(path.join(dir, entry), depth + 1);
  };
  walk(path.join(pluginsDir, 'synced'), 0);
  return found;
}

// projectDir: <cwd>/.claude, or null without a project.
export function installedPlugins(claudeDir: string, projectDir: string | null): PluginRoot[] {
  const settings = [path.join(claudeDir, 'settings.json'), ...(projectDir ? [path.join(projectDir, 'settings.json'), path.join(projectDir, 'settings.local.json')] : [])];
  const enabled = enabledPlugins(settings);
  const pluginsDir = path.join(claudeDir, 'plugins');
  const projectRoot = projectDir ? path.dirname(projectDir) : null;
  const all = [...marketplacePlugins(pluginsDir, projectRoot, enabled), ...syncedPlugins(pluginsDir, enabled)];
  return all.filter((p, i) => all.findIndex((q) => q.root === p.root) === i);
}

const item = (kind: SlashKind, source: string) => ({ name, description }: SkillInfo): SlashItem =>
  ({ kind, name, description, source, insert: slashInsert(kind, name) });

const byName = (a: SkillInfo, b: SkillInfo) => a.name.localeCompare(b.name);

// One folder's worth (a Claude folder, a project's .claude, or a plugin root); prefix namespaces a plugin's names.
function fromFolder(dir: string, source: string, prefix = ''): SlashItem[] {
  const named = (list: SkillInfo[]) => list.map((s) => ({ ...s, name: `${prefix}${s.name}` })).sort(byName);
  // A plugin's agent subfolder is part of its name; a user or project one is not.
  const agents = agentsIn(path.join(dir, 'agents')).map((a) => ({ ...a, name: prefix && a.group ? `${a.group}:${a.name}` : a.name }));
  return [
    ...named(skillsIn(path.join(dir, 'skills'))).map(item('skill', source)),
    ...named(commandsIn(path.join(dir, 'commands'))).map(item('command', source)),
    ...named(agents).map(item('agent', source)),
  ];
}

export function slashCatalog({ claudeDir, projectDir }: { claudeDir: string; projectDir: string | null }): SlashItem[] {
  const folders: [string, string, string][] = [
    [claudeDir, 'user', ''],
    ...(projectDir && projectDir !== claudeDir ? [[projectDir, 'project', ''] as [string, string, string]] : []),
    ...installedPlugins(claudeDir, projectDir).map((p): [string, string, string] => [p.root, `plugin ${p.name}`, `${p.name}:`]),
  ];
  const items = folders.flatMap(([dir, source, prefix]) => fromFolder(dir, source, prefix));
  const order: SlashKind[] = ['skill', 'command', 'agent'];
  return order.flatMap((kind) => items.filter((i) => i.kind === kind));
}
