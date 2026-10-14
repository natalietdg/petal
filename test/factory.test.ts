// The factory model: defaults, validation, and the skill text Claude reads.
import { describe, expect, it } from 'vitest';
import { DEFAULT_STATIONS, GENERATED_MARKER, MAX_STATIONS, defaultFactory, isGenerated, newStationId, renderSkill, runnerLabel, validateFactory, type Station } from '../src/shared/factory';

const station = (over: Partial<Station> = {}): Station => ({ id: 'a', name: 'A', instructions: '', passCheck: '', runner: 'claude', ...over });
const problemOf = (raw: unknown): string => {
  const result = validateFactory(raw);
  return result.ok ? '' : result.problem;
};

describe('defaults', () => {
  it('seeds the seven stations in order, and they validate', () => {
    expect(DEFAULT_STATIONS.map((s) => s.name)).toEqual(['Intake', 'Research & plan', 'Build', 'Test queue', 'Integrate', 'Ship', 'Learn']);
    expect(validateFactory(defaultFactory())).toEqual({ ok: true, factory: defaultFactory() });
  });

  it('hands out copies, so editing one never changes the defaults', () => {
    defaultFactory().stations[0].name = 'changed';
    expect(DEFAULT_STATIONS[0].name).toBe('Intake');
  });
});

describe('validateFactory', () => {
  it('trims text, drops unknown keys and fields that do not belong to the runner', () => {
    const result = validateFactory({ version: 1, extra: true, stations: [{ ...station({ name: '  Build  ', runner: 'claude' }), agentType: 'x', command: 'y', colour: 'red' }] });
    expect(result).toEqual({ ok: true, factory: { version: 1, stations: [{ id: 'a', name: 'Build', instructions: '', passCheck: '', runner: 'claude' }] } });
  });

  it('accepts a file without a version and keeps subagent and script extras', () => {
    const result = validateFactory({ stations: [station({ runner: 'subagent', agentType: 'Explore' }), station({ id: 'b', runner: 'script', command: 'npm test' })] });
    expect(result.ok && result.factory.stations.map((s) => [s.agentType, s.command])).toEqual([['Explore', undefined], [undefined, 'npm test']]);
  });

  it.each([
    [null, 'isn’t a JSON object'],
    [[], 'isn’t a JSON object'],
    [{ version: 2, stations: [station()] }, 'Unknown factory version 2'],
    [{ stations: 'x' }, 'no stations list'],
    [{ stations: [] }, 'at least one station'],
    [{ stations: Array.from({ length: MAX_STATIONS + 1 }, (_, i) => station({ id: `s${i}` })) }, `over ${MAX_STATIONS} stations`],
    [{ stations: ['x'] }, 'Station 1 isn’t an object'],
    [{ stations: [station({ name: '   ' })] }, 'Station 1: name can’t be empty'],
    [{ stations: [station({ id: 'Bad Id' })] }, 'id may hold only'],
    [{ stations: [station({ runner: 'robot' as never })] }, 'who runs it must be one of claude, subagent, script, natalie'],
    [{ stations: [station({ runner: 'subagent' })] }, 'a subagent station needs an agent type'],
    [{ stations: [station({ runner: 'script', command: '  ' })] }, 'a script station needs a command'],
    [{ stations: [station({ runner: 'script', command: 'a\nb' })] }, 'the command must be one line'],
    [{ stations: [station(), station({ name: 'B' })] }, 'Two stations share the id “a”'],
    [{ stations: [station({ instructions: 'x'.repeat(4001) })] }, 'instructions is over 4000 characters'],
    [{ stations: [{ ...station(), passCheck: 3 }] }, 'passCheck must be text'],
  ])('refuses %j with one line naming the problem', (raw, expected) => {
    expect(problemOf(raw)).toContain(expected);
  });

  it('names the station by place and name', () => {
    expect(problemOf({ stations: [station(), station({ id: 'b', name: 'Ship', runner: 'subagent' })] })).toBe('Station 2 (“Ship”): a subagent station needs an agent type.');
  });
});

describe('renderSkill', () => {
  const skill = renderSkill(defaultFactory(), 'global');
  const lines = skill.split('\n');

  it('starts with frontmatter naming the factory skill, then the marker as the first body line', () => {
    expect(lines.slice(0, 2)).toEqual(['---', 'name: factory']);
    expect(lines[2]).toMatch(/^description: ".*build, add, change or fix.*"$/);
    expect(lines[3]).toBe('---');
    expect(lines[4]).toBe(GENERATED_MARKER);
    expect(JSON.parse(lines[2].slice('description: '.length))).toContain('Use for any request');
  });

  it('lists every station as a numbered step with who runs it, its instructions and pass check, in order', () => {
    const headings = lines.filter((l) => l.startsWith('## '));
    expect(headings).toEqual(DEFAULT_STATIONS.map((s, i) => `## ${i + 1}. ${s.name}`));
    for (const s of DEFAULT_STATIONS) {
      expect(skill).toContain(s.instructions);
      expect(skill).toContain(`**Pass check:** ${s.passCheck}`);
    }
    expect(skill).toContain('**Who runs it:** a `Plan` subagent');
    expect(skill).toContain('Run `npm run typecheck && npm test`');
    expect(skill).toContain('Petal never runs it');
    expect(skill).toContain('**Who runs it:** Natalie. Stop here');
  });

  it('points at the project override in the global skill only', () => {
    expect(skill).toContain('`.petal/factory.md`');
    const project = renderSkill(defaultFactory(), 'project', 'pastel-term');
    expect(project.split('\n')[0]).toBe(GENERATED_MARKER);
    expect(project).toContain('# Software factory for pastel-term');
    expect(project).not.toContain('.petal/factory.md');
    expect(project).not.toContain('name: factory');
  });

  it('carries edited text through verbatim and says when a pass check is missing', () => {
    const text = renderSkill({ version: 1, stations: [station({ name: 'Only', instructions: 'Say “hi” <b>twice</b>.' })] }, 'project');
    expect(text).toContain('## 1. Only\n\n**Who runs it:** Claude, in this session.\n\nSay “hi” <b>twice</b>.\n\n**Pass check:** none set');
  });
});

describe('isGenerated', () => {
  it('knows Petal’s files and nobody else’s', () => {
    expect(isGenerated(renderSkill(defaultFactory(), 'global'))).toBe(true);
    expect(isGenerated(renderSkill(defaultFactory(), 'project'))).toBe(true);
    expect(isGenerated(`\uFEFF${renderSkill(defaultFactory(), 'project')}`)).toBe(true); // an editor's byte-order mark
    expect(isGenerated('---\nname: factory\n---\n# My own factory\n')).toBe(false);
    expect(isGenerated(`# Mine\n${GENERATED_MARKER}\n`)).toBe(false); // the marker only counts on the first body line
    expect(isGenerated(`---\nname: x\n${GENERATED_MARKER}`)).toBe(false); // unclosed frontmatter
  });
});

describe('labels and ids', () => {
  it('names who runs each station for the card badge', () => {
    expect(DEFAULT_STATIONS.map(runnerLabel)).toEqual(['Claude', 'Subagent · Plan', 'Subagent · general-purpose', 'Script', 'Claude', 'Natalie approves', 'Claude']);
  });

  it('makes a unique slug id from the name', () => {
    expect(newStationId('Code review!', [])).toBe('code-review');
    expect(newStationId('Code review', ['code-review', 'code-review-2'])).toBe('code-review-3');
    expect(newStationId('✨', [])).toBe('station');
  });
});
