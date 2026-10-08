// Workflow › Setup for setups of every size, from a fake ~/.claude in a temp dir (never the real one).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setupData } from '../src/main/workflow-setup';
import { removeTempDirs, tempDir } from './helpers';

afterEach(removeTempDirs);

const write = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const skill = (name: string) => `---\nname: ${name}\ndescription: Does ${name}.\n---\n`;

describe('setupData', () => {
  it('an empty ~/.claude: nothing found and no diagram', () => {
    const data = setupData({ claudeDir: tempDir() });
    expect(data).toMatchObject({ hasClaudeMd: false, sections: [], routing: [], skills: [], agents: [], routedSkills: [], mermaid: null });
    expect(data.style.name).toBe('Default');
  });

  it('a missing ~/.claude reads the same as an empty one', () => {
    expect(setupData({ claudeDir: path.join(tempDir(), 'nope') }).mermaid).toBeNull();
  });

  it('CLAUDE.md alone, without skills or agents: no diagram', () => {
    const dir = tempDir();
    write(dir, 'CLAUDE.md', '# Me\n## Style\n- short\n## Tests\n- run them\n');
    const data = setupData({ claudeDir: dir });
    expect(data.hasClaudeMd).toBe(true);
    expect(data.sections).toEqual(['Style', 'Tests']);
    expect(data.mermaid).toBeNull();
  });

  it('skills without routing: the diagram skips the routing table and lists every skill', () => {
    const dir = tempDir();
    write(dir, 'CLAUDE.md', '## Style\n');
    write(dir, 'skills/alpha/SKILL.md', skill('alpha'));
    const data = setupData({ claudeDir: dir });
    expect(data.mermaid).toContain('Skills · 1"');
    expect(data.mermaid).toContain('alpha');
    expect(data.mermaid).not.toContain('Routing table');
    expect(data.mermaid).not.toContain('Agents');
  });

  it('agents only, no CLAUDE.md: request goes straight to agents', () => {
    const dir = tempDir();
    write(dir, 'agents/helper.md', '---\nname: helper\ndescription: Helps.\n---\n');
    const data = setupData({ claudeDir: dir });
    expect(data.mermaid).toContain('req(["Request"])\n  req --> agents');
    expect(data.mermaid).not.toContain('CLAUDE.md');
  });

  it('a full setup keeps rules, routing, skills and agents', () => {
    const dir = tempDir();
    write(dir, 'CLAUDE.md', '## Custom skills routing\n- failing URL → **alpha**\n- a log → **beta**\n');
    write(dir, 'skills/alpha/SKILL.md', skill('alpha'));
    write(dir, 'skills/beta/SKILL.md', skill('beta'));
    write(dir, 'skills/gamma/SKILL.md', skill('gamma'));
    write(dir, 'agents/helper.md', '---\nname: helper\n---\n');
    const data = setupData({ claudeDir: dir });
    expect(data.routedSkills).toEqual(['alpha', 'beta']);
    for (const part of ['CLAUDE.md · 1 rule sections', 'Routing table', 'Skills · 2 routed of 3', 'Agents · 1', 'Output style · Default']) expect(data.mermaid).toContain(part);
  });
});
