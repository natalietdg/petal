import { describe, expect, it } from 'vitest';
import { azurePrUrl, findPrLinks, prKey } from '../src/shared/pr-links';
import { parseAzOutput, parseCreateCommand } from '../src/main/pr-command';
import { PrScan, titleBeside } from '../src/main/pr-scan';
import { groupServices } from '../src/shared/session-prs';
import type { TranscriptEntry } from '../src/main/transcript-entry';

const GH = 'https://github.com/acme/shop-web/pull/412';
const ADO = 'https://dev.azure.com/acme/Shop/_git/shop-api/pullrequest/9001';

describe('findPrLinks', () => {
  it('reads GitHub and Azure DevOps PR links in order, canonical and without trailing tabs', () => {
    const found = findPrLinks(`see ${ADO}?_a=files and ${GH}/files#diff-1.`);
    expect(found.map((f) => f.ref)).toEqual([
      { host: 'azure', url: ADO, repoId: 'acme/Shop/shop-api', repo: 'shop-api', number: 9001 },
      { host: 'github', url: GH, repoId: 'acme/shop-web', repo: 'shop-web', number: 412 },
    ]);
  });

  it('ignores issues, compare pages and repo links', () => {
    expect(findPrLinks('https://github.com/a/b/issues/3 https://github.com/a/b/compare/x https://github.com/a/b')).toEqual([]);
  });

  it('decodes an Azure project with spaces in its id but keeps the link as written', () => {
    const [found] = findPrLinks('https://dev.azure.com/org/My%20Project/_git/api/pullrequest/7');
    expect(found?.ref.repoId).toBe('org/My Project/api');
    expect(found?.ref.url).toBe('https://dev.azure.com/org/My%20Project/_git/api/pullrequest/7');
  });

  it('keys a PR the same whatever its case', () => {
    const [a] = findPrLinks('https://GitHub.com/Acme/Shop-Web/pull/412');
    expect(a && prKey(a.ref)).toBe(prKey({ url: GH }));
  });

  it('joins an Azure repo web URL and PR id into the PR page', () => {
    expect(azurePrUrl('https://dev.azure.com/acme/Shop/_git/shop-api/', 9001)?.url).toBe(ADO);
    expect(azurePrUrl('https://example.com/x', 1)).toBeNull();
  });
});

describe('parseCreateCommand', () => {
  it('reads gh pr create: title, head branch and the folder of the cd before it', () => {
    expect(parseCreateCommand('cd /repos/shop-web && git push -u origin feat/x && gh pr create --title "Add payouts v2" --head feat/x --body "b"', '/elsewhere'))
      .toEqual({ tool: 'gh', title: 'Add payouts v2', branch: 'feat/x', dir: '/repos/shop-web' });
  });

  it('resolves a relative cd against the call folder and falls back to it', () => {
    expect(parseCreateCommand("cd ../api; gh pr create -t 'Fix: login'", '/repos/web')?.dir).toBe('/repos/api');
    expect(parseCreateCommand('gh pr create --fill', '/repos/web')).toEqual({ tool: 'gh', title: null, branch: null, dir: '/repos/web' });
  });

  it('reads az repos pr create and skips a heredoc title', () => {
    expect(parseCreateCommand('az repos pr create --source-branch feat/y --title="Sms switch" --target-branch main', '/r'))
      .toEqual({ tool: 'az', title: 'Sms switch', branch: 'feat/y', dir: '/r' });
    expect(parseCreateCommand('gh pr create --title "$(cat <<\'EOF\'\nx\nEOF\n)"', '/r')?.title).toBeNull();
  });

  it('is not fooled by other gh commands', () => {
    expect(parseCreateCommand('gh pr view 12 && echo "gh pr creates"', '/r')).toBeNull();
  });

  it('reads the PR from az output JSON', () => {
    const out = JSON.stringify({ pullRequestId: 9001, title: 'Sms switch', sourceRefName: 'refs/heads/feat/y', repository: { webUrl: 'https://dev.azure.com/acme/Shop/_git/shop-api' } });
    expect(parseAzOutput(out)).toEqual({ ref: expect.objectContaining({ url: ADO }), title: 'Sms switch', branch: 'feat/y' });
    expect(parseAzOutput('ERROR: TF401179')).toBeNull();
  });
});

describe('titleBeside', () => {
  const at = (text: string, url: string) => titleBeside(text, text.indexOf(url), url.length);
  it('takes a markdown link’s own words, else the rest of the line', () => {
    expect(at(`- [Payouts v2 endpoint](${GH})`, GH)).toBe('Payouts v2 endpoint');
    expect(at(`**PR #412:** Payouts v2 endpoint · ${GH}`, GH)).toBe('Payouts v2 endpoint');
    expect(at(`Opened ${GH}`, GH)).toBe('Opened');
    expect(at(`[#412](${GH}) Payouts v2`, GH)).toBe('#412 Payouts v2');
  });
});

let uuid = 0;
const entry = (fields: Partial<TranscriptEntry>): TranscriptEntry => ({ uuid: `u${++uuid}`, timestamp: `2026-10-21T10:0${uuid % 10}:00.000Z`, ...fields });
const bash = (id: string, command: string, cwd = '/repos/shop-web') =>
  entry({ type: 'assistant', cwd, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const result = (id: string, content: unknown) => entry({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const says = (text: string, extra: Partial<TranscriptEntry> = {}) => entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, ...extra });

describe('PrScan', () => {
  it('finds created and mentioned PRs once each, the create command’s facts winning', () => {
    const scan = new PrScan();
    scan.add(says(`Draft is up: [old words](${GH})`));
    scan.add(bash('t1', 'gh pr create --title "Payouts v2" --head feat/payouts'));
    scan.add(result('t1', [{ type: 'text', text: `${GH}\n` }]));
    scan.add(bash('t2', 'az repos pr create --title "Sms switch"', '/repos/bl-admin'));
    scan.add(result('t2', JSON.stringify({ pullRequestId: 9001, title: 'Sms switch', sourceRefName: 'refs/heads/feat/sms', repository: { webUrl: 'https://dev.azure.com/acme/Shop/_git/shop-api' } })));
    scan.add(says(`Both are open: ${GH.toUpperCase().replace('HTTPS://GITHUB.COM', 'https://github.com')} and ${ADO}`));
    const prs = scan.prs();
    expect(prs).toHaveLength(2);
    expect(prs[0]).toMatchObject({ url: GH, title: 'Payouts v2', branch: 'feat/payouts', localPath: '/repos/shop-web', created: true });
    expect(prs[1]).toMatchObject({ url: ADO, title: 'Sms switch', branch: 'feat/sms', localPath: '/repos/bl-admin', created: true });
  });

  it('keeps the first sighting’s time', () => {
    const scan = new PrScan();
    const first = says(`see ${GH}`);
    scan.add(first);
    scan.add(says(`again ${GH}`));
    expect(scan.prs()[0]?.at).toBe(first.timestamp);
  });

  it('skips links in tool output that no create command produced, failed creates and subagent lines', () => {
    const scan = new PrScan();
    scan.add(bash('t1', 'gh pr list'));
    scan.add(result('t1', `${GH}\n`));
    scan.add(bash('t2', 'gh pr create --title x'));
    scan.add(result('t2', 'pull request create failed: GraphQL: No commits between main and feat'));
    scan.add(says(`side note ${GH}`, { isSidechain: true }));
    scan.add(entry({ type: 'user', message: { role: 'user', content: `please review ${GH}` } }));
    expect(scan.prs()).toEqual([]);
  });
});

describe('groupServices', () => {
  it('groups PRs by repo and lends a mentioned PR its repo’s folder or the session folder', () => {
    const scan = new PrScan();
    scan.add(bash('t1', 'gh pr create --title a'));
    scan.add(result('t1', GH));
    scan.add(says('and https://github.com/acme/shop-web/pull/415 plus https://github.com/acme/shop-admin/pull/3'));
    scan.add(says(ADO));
    const services = groupServices(scan.prs(), '/repos/shop-admin');
    expect(services.map((s) => [s.repo, s.prUrls.length, s.localPath])).toEqual([
      ['shop-web', 2, '/repos/shop-web'],
      ['shop-admin', 1, '/repos/shop-admin'],
      ['shop-api', 1, null],
    ]);
  });
});
