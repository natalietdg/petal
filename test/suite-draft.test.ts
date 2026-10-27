import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askAgainText, draftBrief, draftEnded, skillBody, skillUse, suiteProblemText, TESTING_SKILL, type DraftFacts } from '../src/shared/suite-draft';
import { installPetalSkills, petalSkills, updatePetalSkill, type PetalSkillPaths } from '../src/main/petal-skills';
import { openBugs, parseCriteria, CRITERIA_SKELETON } from '../src/shared/test-loop';
import { removeTempDirs, tempDir } from './helpers';

const BUNDLED = fs.readFileSync(path.join(__dirname, '..', 'resources', 'skills', TESTING_SKILL, 'SKILL.md'), 'utf8');

afterEach(removeTempDirs);

describe('skill state decision', () => {
  it('uses the installed skill only when it is current; updates Petal’s unedited copy; inlines the rest', () => {
    expect(skillUse('current')).toBe('skill');
    expect(skillUse('outdated')).toBe('update');
    expect(skillUse('missing')).toBe('inline');
    expect(skillUse('edited')).toBe('inline');
    expect(skillUse('foreign')).toBe('inline');
    expect(skillUse(null)).toBe('inline');
  });

  it('the slash brief names the skill; the inline brief carries the bundled instructions, frontmatter dropped', () => {
    const request = 'for task t-1a2b: "Checkout". Set up or extend this repo\'s suite in ~/.petal/repos/<repoKey>/suite.json.';
    expect(draftBrief(false, request, BUNDLED)).toBe(`/petal-testing-suite ${request}`);
    const inline = draftBrief(true, request, BUNDLED);
    expect(inline.startsWith(request)).toBe(true);
    expect(inline).not.toContain('/petal-testing-suite for');
    expect(inline).not.toMatch(/^name: petal-testing-suite$/m);
    expect(inline).toContain('Write `suite.json` in the suite folder from step 0, never in the repo');
    expect(inline).not.toContain('Write `.petal/pipeline.json`');
    expect(skillBody(BUNDLED).startsWith('# Testing suite')).toBe(true);
    expect(inline).not.toMatch(/[—–]/);
  });
});

describe('updatePetalSkill', () => {
  const skill = (body: string) => `---\nname: ${TESTING_SKILL}\ndescription: Suites.\n---\n${body}\n`;
  function setup(): PetalSkillPaths {
    const bundleDir = tempDir('suite-draft-bundle-');
    fs.mkdirSync(path.join(bundleDir, TESTING_SKILL));
    fs.writeFileSync(path.join(bundleDir, TESTING_SKILL, 'SKILL.md'), skill('Old.'));
    return { bundleDir, claudeDir: tempDir('suite-draft-claude-'), libraryDir: '/fake/library', recordFile: path.join(tempDir('suite-draft-userdata-'), 'petal-skills.json') };
  }
  const target = (paths: PetalSkillPaths) => path.join(paths.claudeDir, 'skills', TESTING_SKILL, 'SKILL.md');
  const ship = (paths: PetalSkillPaths, body: string) => fs.writeFileSync(path.join(paths.bundleDir, TESTING_SKILL, 'SKILL.md'), skill(body));

  it('updates Petal’s own old copy and nothing else', () => {
    const paths = setup();
    installPetalSkills(paths);
    ship(paths, 'New.');
    expect(petalSkills(paths).skills[0]?.state).toBe('outdated');
    expect(updatePetalSkill(paths, TESTING_SKILL)).toBe('outdated');
    expect(fs.readFileSync(target(paths), 'utf8')).toBe(skill('New.'));
    expect(petalSkills(paths).skills[0]?.state).toBe('current');
  });

  it('never touches an edited copy and never adds a missing one', () => {
    const paths = setup();
    installPetalSkills(paths);
    fs.appendFileSync(target(paths), 'Hers.\n');
    ship(paths, 'New.');
    expect(updatePetalSkill(paths, TESTING_SKILL)).toBe('edited');
    expect(fs.readFileSync(target(paths), 'utf8')).toBe(`${skill('Old.')}Hers.\n`);
    const fresh = setup();
    expect(updatePetalSkill(fresh, TESTING_SKILL)).toBe('missing');
    expect(fs.existsSync(target(fresh))).toBe(false);
    expect(updatePetalSkill(fresh, 'petal-nope')).toBeNull();
  });
});

describe('draft finished rule', () => {
  const base: DraftFacts = { suite: false, state: 'idle', worked: true };
  it('ends when it worked and sits idle, or no claude runs it any more, with no suite', () => {
    expect(draftEnded(base)).toBe(true);
    expect(draftEnded({ ...base, state: 'ended', worked: false })).toBe(true);
    expect(draftEnded({ ...base, state: 'closed', worked: false })).toBe(true);
  });
  it('keeps drawing while working, asking her, starting, not yet worked, or once a suite exists', () => {
    expect(draftEnded({ ...base, state: 'working' })).toBe(false);
    expect(draftEnded({ ...base, state: 'asking' })).toBe(false);
    expect(draftEnded({ ...base, worked: false })).toBe(false);
    expect(draftEnded({ ...base, state: 'starting' })).toBe(false);
    expect(draftEnded({ ...base, suite: true })).toBe(false);
    expect(draftEnded({ ...base, state: 'ended', suite: true })).toBe(false);
  });
  it('follow-ups name the repo’s suite file in Petal’s folder', () => {
    expect(askAgainText('/h/.petal/repos/-main')).toContain('/h/.petal/repos/-main/suite.json');
    expect(suiteProblemText(null, 'stage 1 has no command.')).toMatch(/^Petal couldn't use ~\/\.petal\/repos\/<repoKey>\/suite\.json: stage 1 has no command\. Fix the file/);
  });
});

describe('the skill’s bug line', () => {
  it('parses as an [open] bug with its test, ticket and ADO fields, as the bug queue reads it', () => {
    const at = BUNDLED.split('\n').findIndex((l) => /^- \[open\] /.test(l));
    const block = BUNDLED.split('\n').slice(at, at + 6).join('\n');
    const criteria = parseCriteria(`${CRITERIA_SKELETON}${block}\n`);
    expect(criteria.malformed).toBe(0);
    expect(criteria.bugs).toHaveLength(1);
    expect(criteria.bugs[0]).toMatchObject({ status: 'open', name: 'coupon can take the total below zero', test: { path: '~/.petal/repos/-home-me-shop-app/tests/src/checkout/coupon.test.ts', name: 'caps at the total' }, ticket: 'AB#1234', regression: true });
    expect(Object.keys(criteria.bugs[0].details)).toEqual(['Steps', 'Expected', 'Actual', 'Env', 'Evidence']);
    expect(openBugs(criteria)).toBe(1);
  });
});
