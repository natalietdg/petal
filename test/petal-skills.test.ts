import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LIBRARY_DIR_TOKEN, installPetalSkills, petalSkills, renderSkill, type PetalSkillPaths } from '../src/main/petal-skills';
import { frontmatter } from '../src/main/workflow-frontmatter';
import { removeTempDirs, tempDir } from './helpers';

const REPO_BUNDLE = path.join(__dirname, '..', 'resources', 'skills');
const skill = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: Does ${name}. Use when asked.\n---\n${body}\n`;
const LIBRARY = '/fake/userData/library';

// A stand-in bundle, ~/.claude and userData record, all in temp dirs.
function setup(bundle: Record<string, string> = { 'petal-a': skill('petal-a'), 'petal-b': skill('petal-b', `Notes at ${LIBRARY_DIR_TOKEN}.`) }): PetalSkillPaths & { skillsDir: string } {
  const bundleDir = tempDir('petal-skill-bundle-');
  for (const [dir, text] of Object.entries(bundle)) {
    fs.mkdirSync(path.join(bundleDir, dir));
    fs.writeFileSync(path.join(bundleDir, dir, 'SKILL.md'), text);
  }
  const claudeDir = tempDir('petal-claude-');
  return { bundleDir, claudeDir, libraryDir: LIBRARY, recordFile: path.join(tempDir('petal-userdata-'), 'petal-skills.json'), skillsDir: path.join(claudeDir, 'skills') };
}

const tree = (dir: string): Record<string, string> => Object.fromEntries(
  fs.readdirSync(dir, { recursive: true }).map(String).sort()
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]),
);
const states = (paths: PetalSkillPaths) => Object.fromEntries(petalSkills(paths).skills.map((s) => [s.dir, s.state]));
const target = (paths: { skillsDir: string }, dir: string) => path.join(paths.skillsDir, dir, 'SKILL.md');

afterEach(removeTempDirs);

describe('installPetalSkills', () => {
  it('fresh install: creates skills/<name>/SKILL.md for each, with the Library path filled in', () => {
    const paths = setup();
    expect(petalSkills(paths)).toMatchObject({ installable: true, skills: [{ dir: 'petal-a', name: 'petal-a', summary: 'Does petal-a.', state: 'missing' }, { dir: 'petal-b', state: 'missing' }] });
    const result = installPetalSkills(paths);
    expect(result.installable).toBe(false);
    expect(tree(paths.claudeDir)).toEqual({ 'skills/petal-a/SKILL.md': skill('petal-a'), 'skills/petal-b/SKILL.md': skill('petal-b', `Notes at ${LIBRARY}.`) });
    expect(states(paths)).toEqual({ 'petal-a': 'current', 'petal-b': 'current' });
  });

  it('a foreign SKILL.md with the same name is left alone and reported', () => {
    const paths = setup();
    fs.mkdirSync(path.join(paths.skillsDir, 'petal-a'), { recursive: true });
    fs.writeFileSync(target(paths, 'petal-a'), 'my own skill\n');
    installPetalSkills(paths);
    expect(fs.readFileSync(target(paths, 'petal-a'), 'utf8')).toBe('my own skill\n');
    expect(states(paths)).toEqual({ 'petal-a': 'foreign', 'petal-b': 'current' });
    expect(petalSkills(paths).installable).toBe(false);
  });

  it('updates its own unedited copy, keeping the file mode', () => {
    const paths = setup();
    installPetalSkills(paths);
    fs.chmodSync(target(paths, 'petal-a'), 0o640);
    fs.writeFileSync(path.join(paths.bundleDir, 'petal-a', 'SKILL.md'), skill('petal-a', 'Better.'));
    expect(states(paths)['petal-a']).toBe('outdated');
    expect(petalSkills(paths).installable).toBe(true);
    installPetalSkills(paths);
    expect(fs.readFileSync(target(paths, 'petal-a'), 'utf8')).toBe(skill('petal-a', 'Better.'));
    expect(fs.statSync(target(paths, 'petal-a')).mode & 0o777).toBe(0o640);
    expect(states(paths)['petal-a']).toBe('current');
  });

  it('never overwrites a copy the user edited', () => {
    const paths = setup();
    installPetalSkills(paths);
    fs.writeFileSync(target(paths, 'petal-a'), 'edited by hand\n');
    fs.writeFileSync(path.join(paths.bundleDir, 'petal-a', 'SKILL.md'), skill('petal-a', 'Better.'));
    expect(states(paths)['petal-a']).toBe('edited');
    installPetalSkills(paths);
    expect(fs.readFileSync(target(paths, 'petal-a'), 'utf8')).toBe('edited by hand\n');
  });

  it('a new Library path makes its copy outdated, then rewrites it', () => {
    const paths = setup();
    installPetalSkills(paths);
    const moved = { ...paths, libraryDir: '/elsewhere/library' };
    expect(states(moved)).toEqual({ 'petal-a': 'current', 'petal-b': 'outdated' });
    installPetalSkills(moved);
    expect(fs.readFileSync(target(paths, 'petal-b'), 'utf8')).toContain('Notes at /elsewhere/library.');
  });

  it('only petal-* folders with a SKILL.md, and never deletes anything else', () => {
    const paths = setup({ 'petal-a': skill('petal-a'), other: skill('other'), 'petal-empty': '' });
    fs.rmSync(path.join(paths.bundleDir, 'petal-empty', 'SKILL.md'));
    fs.mkdirSync(path.join(paths.skillsDir, 'prove-it'), { recursive: true });
    fs.writeFileSync(path.join(paths.skillsDir, 'prove-it', 'SKILL.md'), 'hers\n');
    installPetalSkills(paths);
    expect(tree(paths.skillsDir)).toEqual({ 'petal-a/SKILL.md': skill('petal-a'), 'prove-it/SKILL.md': 'hers\n' });
  });

  it('renderSkill fills every token', () => {
    expect(renderSkill(`a ${LIBRARY_DIR_TOKEN} b ${LIBRARY_DIR_TOKEN}`, '/x')).toBe('a /x b /x');
  });
});

describe('the bundled skills', () => {
  const dirs = fs.readdirSync(REPO_BUNDLE).sort();
  const text = (dir: string) => fs.readFileSync(path.join(REPO_BUNDLE, dir, 'SKILL.md'), 'utf8');

  it('ships the testing suite and library skills, each named after its folder', () => {
    expect(dirs).toEqual(['petal-conclude', 'petal-library', 'petal-testing-suite']);
    for (const dir of dirs) expect(frontmatter(text(dir)).name).toBe(dir);
  });

  it('their descriptions carry the trigger phrases', () => {
    expect(frontmatter(text('petal-testing-suite')).description).toMatch(/"testing suite".*"update the testing suite".*"set up tests".*"add tests to this repo".*\/petal-testing-suite/);
    expect(frontmatter(text('petal-library')).description).toMatch(/"library".*"check the library".*"what do we know about X".*\/petal-library/);
    expect(frontmatter(text('petal-conclude')).description).toMatch(/"conclude".*\/petal-conclude/);
  });

  it('the library skill names the Library folder only through the token', () => {
    expect(text('petal-library')).toContain(LIBRARY_DIR_TOKEN);
    expect(text('petal-testing-suite')).not.toContain(LIBRARY_DIR_TOKEN);
  });

  it('the testing skill writes the repo’s suite in Petal’s folder, never in the repo, never weakens tests, and never commits', () => {
    expect(text('petal-testing-suite')).toContain('Write `suite.json` in the suite folder from step 0, never in the repo');
    expect(text('petal-testing-suite')).toContain('Never write suite or criteria files inside the repo');
    expect(text('petal-testing-suite')).not.toContain('they still go in the repo\'s own test folders');
    expect(text('petal-testing-suite')).toContain('`/home/me/shop-app` becomes `-home-me-shop-app`');
    expect(text('petal-testing-suite')).not.toContain('.gitignore');
    expect(text('petal-testing-suite')).toContain('git rev-parse --path-format=absolute --git-common-dir');
    expect(text('petal-testing-suite')).toContain('Never delete, skip or weaken a test');
    expect(text('petal-testing-suite')).not.toContain('testing agent may');
    expect(text('petal-testing-suite')).toMatch(/Never commit/);
  });

  it('the testing skill keeps test code in Petal: a suite-folder tests dir and a runner config rooted at the checkout', () => {
    const suite = text('petal-testing-suite');
    expect(suite).toContain('`<suite folder>/tests/`: the test code, mirroring the repo\'s test layout');
    expect(suite).toContain('nothing test-related is written in the repo');
    expect(suite).toContain('Tests already committed in the repo stay where they are');
    expect(suite).toContain('npx vitest run --config <suite folder>/vitest.config.mjs');
    expect(suite).toContain('root: repo,');
    expect(suite).toContain('`${repo}/node_modules/$1`');
    expect(suite).toContain('server: { fs: { allow: [repo, suite] } }');
    expect(suite).toContain("reporters: ['default']");
    expect(suite).toMatch(/test: ~\/\.petal\/repos\/-home-me-shop-app\/tests\/src\/refund\.test\.ts::/);
  });

  it('no em dashes and nothing the privacy scan bans', () => {
    for (const dir of dirs) {
      expect(text(dir)).not.toContain('—');
      expect(text(dir)).not.toMatch(/paywatch|natalie|\/Users\/|\bkero\b|\bsakura\b/i);
    }
  });
});
