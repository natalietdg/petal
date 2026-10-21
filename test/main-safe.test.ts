import { describe, expect, it } from 'vitest';
import { parseMainSafe } from '../src/shared/main-safe';
import { READ_ONLY_TOOLS, SKILL_PROMPT } from '../src/main/main-safe-run';
import { headlessArgs, NO_SECRETS, NO_WRITES, resultText } from '../src/main/headless-claude';

const AT = '2026-10-21T10:00:00.000Z';

const report = (verdict: string, newest: string, findings = '') => `# Main Safety Audit

**Verdict:** ${verdict}
**Baseline:** release/v20261014.01 (2026-10-14)
**Compared against:** origin/main @ abc1234
**Commits since baseline:** 5
**Newest safe commit:** ${newest}

## Why

Main adds a call to a payouts endpoint that is not live in production yet.
The rest is safe.

## Findings
${findings}
## Safe checks (no findings)

- Dependency / SDK changes
`;

const FINDINGS = `
### New API call sites
- **File:** \`src/api/payouts.ts:12\`
  - **Change:** \`fetch('/api/payouts/v2')\`
  - **Commit:** \`def5678\` — Add payouts v2
  - **Committer:** Someone <someone@example.com>
  - **Status:** UNVERIFIED — endpoint not found in the backend's release tag
  - **Action:** Ask if the backend shipped it

### Feature flags / unreleased toggles
- **File:** \`src/flags.ts:3\`
  - **Status:** VERIFIED — flag exists in prod at 0%
- **File:** \`src/env.ts:8\`
  - **Status:** MISSING — VITE_PAYOUTS_URL is not in the prod overlay
`;

describe('parseMainSafe', () => {
  it('reads NOT SAFE, the newest safe commit and the open findings only', () => {
    const parsed = parseMainSafe(report('🔴 NOT SAFE', '`abc1234` — Fix typo (2 of 5 commits)', FINDINGS), 'f'.repeat(40), AT);
    expect(parsed.verdict).toBe('not-safe');
    expect(parsed.newestSafe).toBe('abc1234 — Fix typo (2 of 5 commits)');
    expect(parsed.flagged).toEqual([
      { category: 'New API call sites', where: 'src/api/payouts.ts:12', status: 'UNVERIFIED', note: "endpoint not found in the backend's release tag" },
      { category: 'Feature flags / unreleased toggles', where: 'src/env.ts:8', status: 'MISSING', note: 'VITE_PAYOUTS_URL is not in the prod overlay' },
    ]);
    expect(parsed.summary).toBe('Main adds a call to a payouts endpoint that is not live in production yet. The rest is safe.');
    expect(parsed).toMatchObject({ mainSha: 'f'.repeat(40), at: AT });
  });

  it('reads SAFE and SAFE (self-owned)', () => {
    expect(parseMainSafe(report('🟢 SAFE', 'HEAD'), null)).toMatchObject({ verdict: 'safe', newestSafe: 'HEAD', flagged: [] });
    expect(parseMainSafe(report('🟡 SAFE (self-owned)', 'HEAD', FINDINGS), null).verdict).toBe('safe-self');
  });

  it('gives no verdict, and the report’s opening as its summary, when it can’t find one', () => {
    const parsed = parseMainSafe('There is no prior production release to compare against, so no verdict.', null);
    expect(parsed).toMatchObject({ verdict: null, newestSafe: null, flagged: [], summary: 'There is no prior production release to compare against, so no verdict.' });
  });

  it('does not read SAFE out of NOT SAFE', () => {
    expect(parseMainSafe('**Verdict:** NOT SAFE', null).verdict).toBe('not-safe');
  });
});

describe('the ismainsafe run', () => {
  it('invokes the skill by its full name', () => {
    expect(SKILL_PROMPT).toBe('/anthropic-skills:ismainsafe');
  });

  it('allows only read-only commands', () => {
    const bash = READ_ONLY_TOOLS.filter((tool) => tool.startsWith('Bash('));
    expect(bash.some((tool) => /push|fetch|commit|checkout|switch|reset|tag\*|tag \*|create|merge\*/.test(tool))).toBe(false);
    expect(bash).toContain('Bash(git log*)');
  });

  it('runs headless in plan mode with no saved session, no MCP servers and secrets denied', () => {
    const args = headlessArgs({ model: 'sonnet', tools: ['Read', 'Bash'], allowed: ['Read', 'Bash(git log*)'] });
    expect(args).toEqual(expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config', '--output-format', 'json']));
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Bash');
    expect(args.slice(args.indexOf('--disallowedTools') + 1)).toEqual([...NO_SECRETS, ...NO_WRITES]);
    expect(NO_SECRETS).toContain('Read(**/.env*)');
    expect(NO_WRITES).toEqual(expect.arrayContaining(['Bash(git push*)', 'Bash(git commit*)', 'Bash(gh release create*)', 'Bash(git tag release*)']));
    expect(NO_WRITES.some((deny) => READ_ONLY_TOOLS.some((allow) => allow.startsWith(deny.replace('*)', ''))))).toBe(false); // no read the skill needs is denied
  });

  it('reads the answer from the CLI envelope and turns an error into words', () => {
    expect(resultText(JSON.stringify({ result: '**Verdict:** SAFE' }))).toBe('**Verdict:** SAFE');
    expect(() => resultText(JSON.stringify({ is_error: true, result: 'Credit balance is too low' }))).toThrow('Claude Code reported an error: Credit balance is too low');
    expect(() => resultText('not json')).toThrow('Claude Code’s reply wasn’t readable.');
  });
});
