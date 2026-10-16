// The "/" menu's catalog from a fake ~/.claude and project in temp dirs (never the real ones).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { slashCatalog, commandsIn, installedPlugins } from '../src/main/slash-catalog';
import { removeTempDirs, tempDir } from './helpers';

afterEach(removeTempDirs);

const write = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const md = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\nBody.\n`;
const names = (items: { name: string }[]) => items.map((i) => i.name);

function pluginAt(root: string, name: string) {
  write(root, '.claude-plugin/plugin.json', JSON.stringify({ name }));
  write(root, 'skills/triage/SKILL.md', md('triage', 'Sorts bugs. Then more.'));
  write(root, 'commands/report.md', '---\ndescription: Daily report\n---\n');
  write(root, 'agents/reviewer.md', md('reviewer', 'Reviews code.'));
  write(root, 'agents/deep/security.md', md('security', 'Checks security.'));
}

describe('slashCatalog', () => {
  it('a missing Claude folder and no project: nothing, no throw', () => {
    expect(slashCatalog({ claudeDir: path.join(tempDir(), 'nope'), projectDir: null })).toEqual([]);
  });

  it('user and project skills, commands and agents, each with its source and insert text', () => {
    const home = tempDir();
    const project = path.join(tempDir(), 'repo', '.claude');
    write(home, 'skills/alpha/SKILL.md', md('alpha', 'Does alpha. Long tail.'));
    write(home, 'skills/no-skill-file/README.md', 'not a skill');
    write(home, 'commands/hello.md', '---\ndescription: Says hello\n---\n');
    write(home, 'commands/frontend/component.md', '# Make a component\nBody');
    write(home, 'agents/helper.md', md('helper', 'Helps.'));
    write(home, 'agents/marketing/writer.md', md('writer', 'Writes.'));
    write(project, 'skills/beta/SKILL.md', md('beta', 'Does beta.'));
    write(project, 'commands/deploy.md', 'Deploy it\n');
    write(project, 'agents/tester.md', md('tester', 'Tests.'));

    const items = slashCatalog({ claudeDir: home, projectDir: project });
    expect(items.map((i) => [i.kind, i.name, i.source, i.insert])).toEqual([
      ['skill', 'alpha', 'user', '/alpha '],
      ['skill', 'beta', 'project', '/beta '],
      ['command', 'frontend:component', 'user', '/frontend:component '],
      ['command', 'hello', 'user', '/hello '],
      ['command', 'deploy', 'project', '/deploy '],
      ['agent', 'helper', 'user', '@agent-helper '],
      ['agent', 'writer', 'user', '@agent-writer '], // a user subfolder is not part of the name
      ['agent', 'tester', 'project', '@agent-tester '],
    ]);
    expect(items.find((i) => i.name === 'alpha')?.description).toBe('Does alpha.');
    expect(items.find((i) => i.name === 'frontend:component')?.description).toBe('Make a component');
    expect(items.find((i) => i.name === 'deploy')?.description).toBe('Deploy it');
  });

  it('a project folder that is the Claude folder itself (cwd is home) is not listed twice', () => {
    const home = tempDir();
    write(home, 'skills/alpha/SKILL.md', md('alpha', 'A.'));
    expect(names(slashCatalog({ claudeDir: home, projectDir: home }))).toEqual(['alpha']);
  });

  it('bad frontmatter falls back to the folder or file name and an empty or body description', () => {
    const home = tempDir();
    write(home, 'skills/odd/SKILL.md', '---\nname odd without colon\n: : :\n');
    write(home, 'skills/unclosed/SKILL.md', '---\nname: never-closed\ndescription: x\n');
    write(home, 'commands/plain.md', '');
    write(home, 'agents/broken.md', '---\n---\n');
    const items = slashCatalog({ claudeDir: home, projectDir: null });
    expect(items.map((i) => [i.name, i.description])).toEqual([
      ['odd', ''], ['unclosed', ''], ['plain', ''], ['broken', ''],
    ]);
  });

  it('installed plugins: skills, commands and agents namespaced under the manifest name; subfolder agents scoped', () => {
    const home = tempDir();
    const root = path.join(home, 'plugins', 'cache', 'mkt', 'qa-entry', '1.0.0');
    pluginAt(root, 'qa');
    write(home, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'qa-entry@mkt': [{ scope: 'user', installPath: root, version: '1.0.0' }] } }));
    const items = slashCatalog({ claudeDir: home, projectDir: null });
    expect(items.map((i) => [i.kind, i.name, i.source, i.insert])).toEqual([
      ['skill', 'qa:triage', 'plugin qa', '/qa:triage '],
      ['command', 'qa:report', 'plugin qa', '/qa:report '],
      ['agent', 'qa:deep:security', 'plugin qa', '@agent-qa:deep:security '],
      ['agent', 'qa:reviewer', 'plugin qa', '@agent-qa:reviewer '],
    ]);
  });

  it('a plugin disabled in settings, a missing install path, or another project\'s install is left out', () => {
    const home = tempDir();
    const repo = tempDir();
    const on = path.join(home, 'plugins/cache/m/on/1');
    const off = path.join(home, 'plugins/cache/m/off/1');
    const elsewhere = path.join(home, 'plugins/cache/m/elsewhere/1');
    const local = path.join(home, 'plugins/cache/m/local/1');
    for (const [root, name] of [[on, 'on'], [off, 'off'], [elsewhere, 'elsewhere'], [local, 'local']]) pluginAt(root, name);
    write(home, 'plugins/installed_plugins.json', JSON.stringify({ plugins: {
      'on@m': { installPath: on },
      'off@m': [{ installPath: off }],
      'gone@m': [{ installPath: path.join(home, 'nowhere') }],
      'elsewhere@m': [{ scope: 'project', projectPath: '/some/other/repo', installPath: elsewhere }],
      'local@m': [{ scope: 'local', projectPath: repo, installPath: local }],
    } }));
    write(home, 'settings.json', JSON.stringify({ enabledPlugins: { 'off@m': false, 'local@m': false } }));
    write(repo, '.claude/settings.local.json', JSON.stringify({ enabledPlugins: { 'local@m': true } })); // local beats user
    const plugins = installedPlugins(home, path.join(repo, '.claude'));
    expect(plugins.map((p) => p.name)).toEqual(['on', 'local']);
  });

  it('synced plugins are found by their manifest under plugins/synced, and can be turned off', () => {
    const home = tempDir();
    pluginAt(path.join(home, 'plugins/synced/bucket-1/helper-kit'), 'helper-kit');
    pluginAt(path.join(home, 'plugins/synced/bucket-1/quiet-kit'), 'quiet-kit');
    write(home, 'plugins/synced/bucket-1/.marketplaces.json', '{}');
    write(home, 'settings.json', JSON.stringify({ enabledPlugins: { 'quiet-kit@synced': false } }));
    expect(installedPlugins(home, null).map((p) => p.name)).toEqual(['helper-kit']);
  });

  it('an unreadable installed_plugins.json reads as no plugins', () => {
    const home = tempDir();
    write(home, 'plugins/installed_plugins.json', '{ not json');
    expect(installedPlugins(home, null)).toEqual([]);
  });
});

describe('commandsIn', () => {
  it('nests subfolders into the name, skips dotfolders and non-markdown', () => {
    const dir = tempDir();
    write(dir, 'a.md', 'A');
    write(dir, 'notes.txt', 'no');
    write(dir, '.hidden/b.md', 'B');
    write(dir, 'x/y/c.md', 'C');
    expect(names(commandsIn(dir))).toEqual(['a', 'x:y:c']);
  });
});
