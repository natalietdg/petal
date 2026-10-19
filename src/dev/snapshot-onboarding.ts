// Launch checks for a stranger: an older install goes straight to Get started, the organizer stays off, and Workflow › Setup on an empty ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import * as configStore from '../main/config-store';
import * as organizer from '../main/session-organizer';
import { counters, setupFixture } from '../main/snapshot-mode';
import type { Kit } from './snapshot';

const FIRST_PASS_DELAY_S = 20; // session-organizer's FIRST_RUN_DELAY_MS

const launchState = `(() => ({
  open: PastelTerm.overlays.current(),
  welcome: Boolean(PastelTerm.welcome || document.querySelector('.welcome-cat, .welcome-styles')),
  reader: !document.getElementById('reader').hidden,
  reopens: PastelTerm.getStarted.reopensOnLaunch(),
  emDashes: (document.getElementById('get-started').innerText.match(/—/g) ?? []).length,
}))()`;

async function captureBoth({ capture, applyTheme, wait }: Kit, name: string): Promise<void> {
  for (const [id, look] of [['paleSky', 'light'], ['nightPastel', 'dark']]) {
    applyTheme(id, { persist: false });
    await wait(600);
    await capture(`${name}-${look}`);
  }
  applyTheme('paleSky', { persist: false });
}

// The run's fresh launch is an older install that hasn't finished setup: Get started comes up, never the old welcome screen.
// What the welcome offered beyond that, Petal's reply styles, stays reachable in Customize › Formatting.
export async function launchCheck(kit: Kit): Promise<void> {
  const { js, log, waitFor } = kit;
  const first = await js(launchState);
  const expected = first.reopens ? 'get-started' : null;
  log(`${first.open === expected && !first.welcome && first.emDashes === 0 ? 'ok' : 'FAIL'} launch opens Get started exactly while setup is unfinished, no welcome screen: ${JSON.stringify(first)}`);
  if (first.open === 'get-started') await captureBoth(kit, 'launch-get-started');
  await js('PastelTerm.getStarted.close()');
  const closed = await js(launchState);
  log(`${closed.open === null && closed.reader ? 'ok' : 'FAIL'} closing Get started shows the reader: ${JSON.stringify({ open: closed.open, reader: closed.reader })}`);

  await js("PastelTerm.customize.open('formatting')");
  await waitFor(() => js("document.querySelector('#customize-body .cz-preview') ? true : null"), 5000);
  const installable = (await js('window.pastel.config.get()')).petalStyles?.installable === true;
  const button = await js("document.querySelector('#customize-body .cz-petal-add')?.textContent ?? null");
  log(`${(button === 'Add Petal’s reply styles') === installable ? 'ok' : 'FAIL'} Customize › Formatting offers Petal's reply styles while some are missing: ${JSON.stringify({ installable, button })}`);
  await js('PastelTerm.customize.close()');
}

// A new user's config: no schedule, and no organizer pass all run long (the first one would come after 20s).
export function organizerOffCheck({ log }: Kit, when: 'start' | 'end'): void {
  const enabled = configStore.load().organizer.enabled;
  const schedule = organizer.status().schedule;
  const passes = counters.organizerPassesSkipped;
  const longEnough = when === 'start' || process.uptime() > FIRST_PASS_DELAY_S + 5;
  log(`${!enabled && schedule?.enabled === false && passes === 0 && longEnough ? 'ok' : 'FAIL'} organizer default off (${when}): enabled=${enabled} schedule=${JSON.stringify(schedule)} passes=${passes} uptime=${Math.round(process.uptime())}s`);
}

const setupState = `(() => {
  const body = document.getElementById('workflow-body');
  return {
    empty: Boolean(body.querySelector('.wf-setup-empty')),
    text: body.querySelector('.wf-setup-empty .wf-empty-lead')?.textContent ?? null,
    links: [...body.querySelectorAll('.wf-doc-link')].map((a) => a.getAttribute('href')),
    summary: body.querySelector('.wf-summary')?.textContent ?? null,
    graph: Boolean(body.querySelector('.wf-graph')),
    graphSvg: Boolean(body.querySelector('.wf-graph svg')),
    routingNode: (body.querySelector('.wf-graph')?.textContent ?? '').includes('Routing table'),
  };
})()`;

async function showSetup({ js, waitFor, wait }: Kit, ready: string): Promise<{ [key: string]: unknown }> {
  await js('PastelTerm.workflow.close()');
  await js('PastelTerm.workflow.open()');
  await js(`document.querySelector('#workflow-tabs button[data-tab="setup"]').click()`);
  await waitFor(async () => ((await js(ready)) ? true : null), 15000);
  await wait(400);
  return js(setupState);
}

const DOCS = ['https://code.claude.com/docs/en/memory', 'https://code.claude.com/docs/en/skills', 'https://code.claude.com/docs/en/sub-agents', 'https://code.claude.com/docs/en/output-styles'];

// Fake ~/.claude folders live in the snapshot dir; her real one is only read.
export async function setupEmptyCheck(kit: Kit): Promise<void> {
  const { js, log, capture, outDir } = kit;
  const empty = path.join(outDir, 'fake-claude-empty');
  fs.mkdirSync(empty, { recursive: true });
  setupFixture.claudeDir = empty;
  const none = await showSetup(kit, "Boolean(document.querySelector('#workflow-body .wf-setup-empty'))");
  const linksOk = JSON.stringify(none.links) === JSON.stringify(DOCS);
  log(`${none.empty && !none.graph && linksOk && none.text === 'Your Claude Code setup shows here: CLAUDE.md, skills, agents and output style.' ? 'ok' : 'FAIL'} Setup empty state on an empty ~/.claude: ${JSON.stringify(none)}`);
  await capture('setup-empty');

  const partial = path.join(outDir, 'fake-claude-partial');
  fs.mkdirSync(path.join(partial, 'skills', 'notes'), { recursive: true });
  fs.writeFileSync(path.join(partial, 'CLAUDE.md'), '# Me\n## Style\n- short answers\n## Tests\n- run them\n');
  fs.writeFileSync(path.join(partial, 'skills', 'notes', 'SKILL.md'), '---\nname: notes\ndescription: Keeps notes.\n---\n');
  setupFixture.claudeDir = partial;
  const some = await showSetup(kit, "Boolean(document.querySelector('#workflow-body .wf-graph svg'))");
  log(`${!some.empty && some.graphSvg && !some.routingNode && /^CLAUDE\.md has 2 sections\. 1 skill and 0 agents installed\./.test(String(some.summary)) ? 'ok' : 'FAIL'} Setup without routing: ${JSON.stringify(some)}`);
  await capture('setup-no-routing');

  setupFixture.claudeDir = writeRoutedClaudeDir(path.join(outDir, 'fake-claude-routed'));
  const routed = await showSetup(kit, "Boolean(document.querySelector('#workflow-body .wf-graph svg'))");
  log(`${!routed.empty && routed.graphSvg && routed.routingNode && /route requests to 2 skills/.test(String(routed.summary)) ? 'ok' : 'FAIL'} Setup with a routing table, skills and agents: ${JSON.stringify(routed)}`);
  await capture('setup-routed');
  setupFixture.claudeDir = null;
  await js('PastelTerm.workflow.close()');
}

// A full setup like a power user's: CLAUDE.md with a skills routing table, three skills (two routed) and an agent.
function writeRoutedClaudeDir(dir: string): string {
  const skill = (name: string) => {
    fs.mkdirSync(path.join(dir, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: The ${name} skill.\n---\n`);
  };
  ['deploy', 'triage', 'notes'].forEach(skill);
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews diffs.\n---\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
    '# Me', '## Style', '- short answers', '## Custom skills routing',
    '- Shipping a build → **deploy**', '- A failing URL → **triage**', '',
  ].join('\n'));
  return dir;
}
