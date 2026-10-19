import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askAgainText, draftBrief, draftEnded, skillBody, skillUse, suiteProblemText, suiteWriters, TESTING_SKILL, type DraftFacts } from '../src/shared/suite-draft';
import { installPetalSkills, petalSkills, updatePetalSkill, type PetalSkillPaths } from '../src/main/petal-skills';
import { parseCriteria, CRITERIA_SKELETON } from '../src/shared/test-loop';
import { forTask } from '../src/shared/task-suite';
import { noEvents } from '../src/shared/agent-loop';
import type { StoredLoop } from '../src/shared/testing';
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
    const request = 'for task t-1a2b: "Checkout". You are this task\'s testing agent, so you may write .petal/suites/t-1a2b.json.';
    expect(draftBrief(false, request, BUNDLED)).toBe(`/petal-testing-suite ${request}`);
    const inline = draftBrief(true, request, BUNDLED);
    expect(inline.startsWith(request)).toBe(true);
    expect(inline).not.toContain('/petal-testing-suite for');
    expect(inline).not.toMatch(/^name: petal-testing-suite$/m);
    expect(inline).toContain('Write `.petal/suites/<task id>.json`');
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
  const base: DraftFacts = { suite: false, tab: 'open', busy: false, asking: false, worked: true };
  it('ends when it worked and sits idle, or its tab is gone, with no suite', () => {
    expect(draftEnded(base)).toBe(true);
    expect(draftEnded({ ...base, tab: 'gone', worked: false })).toBe(true);
  });
  it('keeps drawing while busy, asking her, starting, not yet worked, or once a suite exists', () => {
    expect(draftEnded({ ...base, busy: true })).toBe(false);
    expect(draftEnded({ ...base, asking: true })).toBe(false);
    expect(draftEnded({ ...base, worked: false })).toBe(false);
    expect(draftEnded({ ...base, tab: 'starting' })).toBe(false);
    expect(draftEnded({ ...base, suite: true })).toBe(false);
    expect(draftEnded({ ...base, tab: 'gone', suite: true })).toBe(false);
  });
  it('follow-ups name the task’s suite file', () => {
    expect(askAgainText('t-1a2b')).toContain('.petal/suites/t-1a2b.json');
    expect(suiteProblemText('t-1a2b', 'stage 1 has no command.')).toMatch(/^Petal couldn't use \.petal\/suites\/t-1a2b\.json: stage 1 has no command\. Fix the file/);
  });
});

describe('suite write rights', () => {
  const loop = (kind: StoredLoop['kind'], tester: string | null): StoredLoop => ({
    kind, testerSessionId: tester, fixerSessionId: kind === 'loop' ? 'fixer' : null,
    startedAt: 1, stoppedAt: null, queue: [], events: noEvents(),
  });
  const agents = [{ sessionId: 'old-tester', role: 'tester' as const }, { sessionId: 'drafter', role: 'tester' as const }, { sessionId: 'fixer', role: 'fixer' as const }];

  it('only the current loop’s or draft’s testing agent may write; older testers lose the right', () => {
    expect(suiteWriters(loop('loop', 'drafter'), agents)).toEqual(['drafter']);
    expect(suiteWriters(loop('draft', 'drafter'), agents)).toEqual(['drafter']);
    expect(suiteWriters(loop('loop', 'old-tester'), agents)).toEqual(['old-tester']);
  });
  it('a loop with no testing agent falls back to the newest one; none at all, nobody', () => {
    expect(suiteWriters(loop('loop', null), agents)).toEqual(['drafter']);
    expect(suiteWriters(null, [{ sessionId: 'fixer', role: 'fixer' }])).toEqual([]);
  });
});

describe('the skill’s bug line', () => {
  it('parses as a [fail] bug filed under the task, with its test, as the bug queue reads it', () => {
    const line = /^- \[fail\] .*$/m.exec(BUNDLED)?.[0] ?? '';
    expect(line).toContain('· task: t-1a2b');
    const criteria = parseCriteria(`${CRITERIA_SKELETON}${line}\n`);
    expect(criteria.malformed).toBe(0);
    expect(criteria.bugs).toEqual([{ status: 'fail', name: 'coupon can take the total below zero', test: { path: 'src/checkout/coupon.test.ts', name: 'caps at the total' }, tests: [{ path: 'src/checkout/coupon.test.ts', name: 'caps at the total' }], source: null, round: null, regression: true, taskId: 't-1a2b' }]);
    expect(forTask(criteria.bugs, 't-1a2b')).toHaveLength(1);
  });
});
