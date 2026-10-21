import { describe, expect, it } from 'vitest';
import { parseDeployOrder, UNPLACED_REASON } from '../src/shared/deploy-order';
import { prsFlowMermaid } from '../src/shared/pr-flow';
import { deployOrderPrompt } from '../src/main/deploy-order-prompt';
import { groupServices, type SessionPr } from '../src/shared/session-prs';

const pr = (repoId: string, number: number, extra: Partial<SessionPr> = {}): SessionPr => {
  const repo = repoId.split('/').pop() ?? repoId;
  return { host: 'github', url: `https://github.com/${repoId}/pull/${number}`, repoId, repo, number, title: `${repo} change`, branch: null, localPath: `/repos/${repo}`, at: null, created: true, ...extra };
};

const API = pr('acme/payouts-api', 7);
const WEB = pr('acme/admin-web', 31);
const WEB2 = pr('acme/admin-web', 32);
const PRS = [WEB, API, WEB2];
const SERVICES = groupServices(PRS, null);

describe('parseDeployOrder', () => {
  it('reads the order and links from a fenced answer, keeping only this session’s PRs once each', () => {
    const answer = `Here you go:\n\`\`\`json\n${JSON.stringify({
      order: [
        { pr: API.url, reason: 'Adds the endpoint the web app calls.' },
        { pr: 'https://github.com/acme/other/pull/1', reason: 'not ours' },
        { pr: WEB.url.toUpperCase().replace('HTTPS://GITHUB.COM', 'https://github.com'), reason: 'Calls the new endpoint.' },
        { pr: API.url, reason: 'duplicate' },
      ],
      links: [{ from: 'admin-web', to: 'payouts-api', label: 'calls its API' }, { from: 'admin-web', to: 'nowhere' }, { from: 'admin-web', to: 'admin-web' }],
    })}\n\`\`\``;
    const order = parseDeployOrder(answer, PRS, SERVICES, 'heads1', 'now');
    expect(order.steps).toEqual([
      { url: API.url, reason: 'Adds the endpoint the web app calls.' },
      { url: WEB.url, reason: 'Calls the new endpoint.' },
      { url: WEB2.url, reason: UNPLACED_REASON },
    ]);
    expect(order.links).toEqual([{ from: 'github:acme/admin-web', to: 'github:acme/payouts-api', label: 'calls its API' }]);
    expect(order).toMatchObject({ headsKey: 'heads1', at: 'now' });
  });

  it('refuses an answer that is not JSON or names none of the PRs', () => {
    expect(() => parseDeployOrder('I could not read the PRs.', PRS, SERVICES, 'h')).toThrow('expected format');
    expect(() => parseDeployOrder('{"order":[{"pr":"https://github.com/x/y/pull/1"}]}', PRS, SERVICES, 'h')).toThrow('didn’t name any');
  });
});

describe('prsFlowMermaid', () => {
  it('draws one box per service with its PR numbers and an arrow per link', () => {
    const source = prsFlowMermaid(SERVICES, PRS, [{ from: 'github:acme/admin-web', to: 'github:acme/payouts-api', label: 'calls "its" API' }]);
    expect(source).toBe([
      'flowchart LR',
      '  s0["admin-web<br/>PR 31, PR 32"]',
      '  s1["payouts-api<br/>PR 7"]',
      '  s0 -->|"calls its API"| s1',
    ].join('\n'));
  });

  it('keeps quotes and brackets in repo names from breaking the diagram', () => {
    const odd = groupServices([pr('acme/we"ird[repo]', 1)], null);
    expect(prsFlowMermaid(odd, [pr('acme/we"ird[repo]', 1)], [])).toContain('s0["we ird repo<br/>PR 1"]');
  });
});

describe('deployOrderPrompt', () => {
  it('lists every PR with its folder and asks for JSON only', () => {
    const prompt = deployOrderPrompt([API, pr('acme/admin-web', 33, { localPath: null, branch: 'feat/x', title: '' })], SERVICES);
    expect(prompt).toContain(`1. ${API.url}`);
    expect(prompt).toContain('local folder: /repos/admin-web'); // borrowed from its repo's other PRs
    expect(prompt).toContain('branch: feat/x');
    expect(prompt).toContain('Answer with JSON only');
  });
});
