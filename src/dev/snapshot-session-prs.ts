// PRs tab (PASTEL_SNAPSHOT_MODE=session-prs): the fixture log gains 3 PRs across 2 repos (two made by gh pr create,
// one Azure DevOps PR Claude only named). The reader shows "PRs (3)"; opened, it lists 2 services, the notes headers
// on each PR and the flow diagram; ismainsafe and the deploy-order reviewer are the stubs below, never a real claude.
import fs from 'node:fs';
import path from 'node:path';
import type { Kit } from './snapshot';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { prsFixture, userDataDir } from '../main/snapshot-mode';

const GH_A = 'https://github.com/acme/admin-web/pull/31';
const GH_B = 'https://github.com/acme/admin-web/pull/32';
const ADO = 'https://dev.azure.com/acme/Payments/_git/payouts-api/pullrequest/7';

const MAIN_SAFE_REPORT = [
  '# Main Safety Audit', '', '**Verdict:** 🔴 NOT SAFE', '**Newest safe commit:** abc1234 (2 of 4 commits)', '',
  '## Why', '', 'Main calls a payouts endpoint that is not in production yet.', '',
  '## Findings', '', '### New API call sites', '- **File:** `src/api/payouts.ts:12`', '  - **Status:** UNVERIFIED — not in the backend release tag', '',
].join('\n');
const ORDER_ANSWER = JSON.stringify({
  order: [
    { pr: ADO, reason: 'Adds the endpoint the admin pages call.' },
    { pr: GH_A, reason: 'Calls the new endpoint.' },
    { pr: GH_B, reason: 'Copy changes only, any time after.' },
  ],
  links: [{ from: 'admin-web', to: 'payouts-api', label: 'calls its API' }],
});

const STATE = `(() => {
  const slot = document.getElementById('reader-prs');
  const shown = (e) => Boolean(e) && e.getClientRects().length > 0;
  return {
    shown: shown(slot),
    tab: slot?.querySelector('.prs-tab-text')?.textContent ?? null,
    open: shown(document.getElementById('reader-prs-panel')),
    services: [...document.querySelectorAll('#reader-prs .prs-service-name')].map((e) => e.textContent),
    servicesHeading: [...document.querySelectorAll('#reader-prs .prs-heading')].map((e) => e.textContent),
    cards: document.querySelectorAll('#reader-prs .prs-card').length,
    noteLabels: [...document.querySelectorAll('#reader-prs .prs-card')].map((c) => [...c.querySelectorAll('.prs-notes-label')].map((l) => l.textContent)),
    diagram: Boolean(document.querySelector('#reader-prs .prs-flow-figure figure.diagram svg')),
    arrows: document.querySelectorAll('#reader-prs .prs-flow-figure svg .flowchart-link, #reader-prs .prs-flow-figure svg path.edge-thickness-normal').length,
    verdict: document.querySelector('#reader-prs .prs-verdict-word')?.textContent ?? null,
    newestSafe: [...document.querySelectorAll('#reader-prs .prs-verdict .prs-line')].map((e) => e.textContent),
    order: [...document.querySelectorAll('#reader-prs .prs-order > li > strong')].map((e) => e.textContent),
    inferred: document.querySelector('#reader-prs .prs-inferred')?.textContent ?? null,
    bar: document.querySelector('#reader-banners-bar .banners-names')?.textContent ?? '',
    controls: document.getElementById('reader-banners-bar')?.getAttribute('aria-controls') ?? '',
  };
})()`;

const click = (selector: string, text: string) => `(() => {
  const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent === ${JSON.stringify(text)});
  target?.click();
  return Boolean(target);
})()`;

function appendPrTurns(file: string, repos: string): void {
  assertFixtureOutsideClaude(file);
  const line = (fields: Record<string, unknown>) => JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), cwd: repos, ...fields });
  const tool = (id: string, command: string, output: string) => [
    line({ type: 'assistant', uuid: `prs-a-${id}`, message: { role: 'assistant', content: [{ type: 'tool_use', id: `prs-tool-${id}`, name: 'Bash', input: { command } }] } }),
    line({ type: 'user', uuid: `prs-r-${id}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `prs-tool-${id}`, content: output }] } }),
  ];
  fs.appendFileSync(file, `${[
    line({ type: 'user', uuid: 'prs-u1', message: { role: 'user', content: 'open the PRs' } }),
    ...tool('1', 'cd admin-web && gh pr create --title "Payouts page" --head feat/payouts', `${GH_A}\n`),
    ...tool('2', 'cd admin-web && gh pr create --title "Payouts copy" --head feat/copy', `${GH_B}\n`),
    line({ type: 'assistant', uuid: 'prs-a3', message: { role: 'assistant', content: [{ type: 'text', text: `Both admin-web PRs are up. The API side is [Payouts endpoint](${ADO}).` }] } }),
  ].join('\n')}\n`);
}

export async function sessionPrsCheck(kit: Kit, file: string): Promise<void> {
  const { js, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} session prs: ${what}`);
  const repos = path.join(outDir, 'session-prs');
  fs.mkdirSync(path.join(repos, 'admin-web'), { recursive: true });
  const asked: { mainSafe: string[]; order: string[] } = { mainSafe: [], order: [] };
  prsFixture.mainSafe = async (dir) => { asked.mainSafe.push(dir); return MAIN_SAFE_REPORT; };
  prsFixture.deployOrder = async (prompt) => { asked.order.push(prompt); return ORDER_ANSWER; };
  try {
    // Run alone on a fresh home, Get started is still open over the reader; the full run has closed it already.
    await js("PastelTerm.overlays.hideCurrent(); PastelTerm.tabs.activate(PastelTerm.tabs.ids()[0]); PastelTerm.reader.setView('replies')");
    appendPrTurns(file, repos);
    const tab = await waitFor(async () => { const s = await js(STATE); return s.shown && s.tab === 'PRs (3)' ? s : null; }, 8000);
    check(tab && !tab.open && tab.bar.includes('PRs (3)') && tab.controls.split(' ').includes('reader-prs'), `the tab reads PRs (3), folded, and the banners bar names and controls it: ${JSON.stringify(tab)}`);

    await js("document.querySelector('#reader-prs .prs-tab').click()");
    const open = await waitFor(async () => { const s = await js(STATE); return s.open && s.diagram ? s : null; }, 8000);
    check(open && JSON.stringify(open.services) === JSON.stringify(['admin-web', 'payouts-api']) && open.servicesHeading.includes('Related services (2)'), `2 services listed: ${JSON.stringify(open?.services)}`);
    const headers = ['Risks', 'Env/config', 'Post-deploy checks'];
    check(open && open.cards === 3 && open.noteLabels.every((labels: string[]) => JSON.stringify(labels) === JSON.stringify(headers)), `each of the 3 PRs has the notes headers: ${JSON.stringify(open?.noteLabels)}`);
    check(open?.diagram, 'the flow diagram renders');

    check(await js(click('#reader-prs .prs-button', 'Is main safe for prod?')), 'the admin-web row offers the main check');
    const verdict = await waitFor(async () => { const s = await js(STATE); return s.verdict ? s : null; }, 8000);
    check(verdict?.verdict === 'NOT SAFE' && verdict.newestSafe.includes('Newest safe commit: abc1234 (2 of 4 commits)') && asked.mainSafe[0] === path.join(repos, 'admin-web'),
      `NOT SAFE and the newest safe commit, run in the repo's folder: ${JSON.stringify({ verdict, asked: asked.mainSafe })}`);

    check(await js(click('#reader-prs .prs-button', 'Propose deploy order')), 'the deploy order button is there');
    const order = await waitFor(async () => { const s = await js(STATE); return s.order.length === 3 && s.arrows > 0 ? s : null; }, 8000);
    check(order && order.order[0] === 'payouts-api PR 7' && order.inferred === 'inferred', `the proposed order, labelled inferred, and an arrow in the diagram: ${JSON.stringify(order)}`);

    await js(`(() => { const t = document.querySelector('#reader-prs .prs-notes-input'); t.value = 'drops the old payouts column'; t.dispatchEvent(new Event('input')); })()`);
    const notesFile = path.join(userDataDir(), 'session-prs', 'notes-snapshot-fixture.json');
    const saved = await waitFor(() => (fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : null), 5000);
    check(saved?.[GH_A]?.risks === 'drops the old payouts column', `Risks saved per PR in userData: ${JSON.stringify(saved)}`);
    await capture('session-prs-open');
    await js("document.querySelector('#reader-prs .prs-tab').click()"); // folded again for the steps after
  } finally {
    prsFixture.mainSafe = null;
    prsFixture.deployOrder = null;
  }
}
