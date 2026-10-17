// Launch checks for a stranger: the first-run screen, the organizer staying off, and Workflow › Setup on an empty ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import * as configStore from '../main/config-store';
import * as organizer from '../main/session-organizer';
import { counters, setupFixture } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { send } from '../main/ipc';
import type { Kit } from './snapshot';

const TAGLINE = 'A terminal for Claude Code, with a reader for its replies and a pet who keeps you company.';
const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';
const FIRST_PASS_DELAY_S = 20; // session-organizer's FIRST_RUN_DELAY_MS

const welcomeState = `(() => {
  const view = document.getElementById('welcome');
  return {
    shown: !view.hidden,
    tagline: view.querySelector('.welcome-tagline')?.textContent ?? null,
    cats: [...view.querySelectorAll('.welcome-cat')].map((b) => ({ name: b.querySelector('.welcome-cat-name')?.textContent, picture: Boolean(b.querySelector('.cat-portrait svg rect')) })),
    scenes: view.querySelectorAll('.welcome-section .cz-chip').length,
    claude: (() => {
      const list = view.querySelector('.gs-list');
      const install = list?.querySelector('.gs-step[data-step="install"]');
      if (!list) return 'none';
      return list.classList.contains('all-set') || install?.classList.contains('done') ? 'found' : install ? 'missing' : 'none';
    })(),
    command: view.querySelector('.gs-command code')?.textContent ?? null,
    recheck: Boolean(view.querySelector('.gs-recheck')),
    organizerBox: view.querySelector('.welcome-switch input')?.checked ?? null,
    organizerLabel: view.querySelector('.welcome-switch span')?.textContent ?? null,
    emDashes: (view.innerText.match(/—/g) ?? []).length,
    reader: !document.getElementById('reader').hidden,
  };
})()`;

async function captureBoth({ capture, applyTheme, wait }: Kit, name: string): Promise<void> {
  for (const [id, look] of [['paleSky', 'light'], ['nightPastel', 'dark']]) {
    applyTheme(id, { persist: false });
    await wait(600);
    await capture(`${name}-${look}`);
  }
  applyTheme('paleSky', { persist: false });
}

// Window sizes Start and the organizer switch must fit without scrolling: the default and a small laptop window.
const FOOTER_SIZES: [width: number, height: number][] = [[1280, 900], [990, 800]];

const footerRects = `(() => {
  const inside = (r, box) => r.width > 0 && r.height > 0 && r.top >= box.top && r.left >= box.left && r.bottom <= box.bottom && r.right <= box.right;
  const view = document.getElementById('welcome').getBoundingClientRect();
  const port = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
  const start = document.querySelector('.welcome-start').getBoundingClientRect();
  const toggle = document.querySelector('.welcome-switch').getBoundingClientRect();
  const cat = document.getElementById('cat').getBoundingClientRect();
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  return {
    window: [window.innerWidth, window.innerHeight],
    start: [Math.round(start.left), Math.round(start.top), Math.round(start.right), Math.round(start.bottom)],
    startVisible: inside(start, port) && inside(start, view),
    switchVisible: inside(toggle, port) && inside(toggle, view),
    startUnderCat: overlaps(start, cat),
    scrolled: document.querySelector('.welcome-pane').scrollTop,
  };
})()`;

async function footerInViewCheck({ js, log, wait, capture }: Kit, win: BrowserWindow): Promise<void> {
  const [width, height] = win.getContentSize();
  for (const [w, h] of FOOTER_SIZES) {
    resizeOffscreen(win, w, h);
    await wait(700);
    const r = await js(footerRects);
    const ok = r.startVisible && r.switchVisible && !r.startUnderCat && r.scrolled === 0;
    log(`${ok ? 'ok' : 'FAIL'} welcome Start and organizer switch in view without scrolling at ${w}x${h}: ${JSON.stringify(r)}`);
    await capture(`welcome-${w}x${h}`);
  }
  resizeOffscreen(win, width, height);
  await wait(500);
}

// Needs a fresh userData (a new PASTEL_SNAPSHOT_DIR); a reused one has already seen the screen.
export async function welcomeCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, waitFor, wait } = kit;
  const first = await js(welcomeState);
  const catsOk = first.cats.length === 4 && first.cats.every((c: { picture: boolean }) => c.picture) && first.cats.map((c: { name: string }) => c.name).join() === 'Mika,Miki,Kira,Hoshi';
  log(`${first.shown && !first.reader ? 'ok' : 'FAIL'} first launch shows the welcome screen over the reader: ${JSON.stringify({ shown: first.shown, reader: first.reader })}`);
  log(`${first.tagline === TAGLINE ? 'ok' : 'FAIL'} welcome tagline: ${JSON.stringify(first.tagline)}`);
  log(`${catsOk ? 'ok' : 'FAIL'} welcome cats each show their picture: ${JSON.stringify(first.cats)}`);
  log(`${first.scenes > 1 && first.emDashes === 0 ? 'ok' : 'FAIL'} welcome scenes and copy: scenes=${first.scenes} emDashes=${first.emDashes}`);
  log(`${first.organizerBox === false && /uses your Claude plan/.test(first.organizerLabel ?? '') ? 'ok' : 'FAIL'} welcome organizer switch starts off: ${JSON.stringify([first.organizerBox, first.organizerLabel])}`);
  log(`${first.claude === 'found' ? 'ok' : 'FAIL'} welcome's Get started finds claude on this Mac: ${first.claude}`);
  const styleOffer = await js("({ installable: null, button: document.querySelector('#welcome .welcome-styles-add')?.textContent ?? null })");
  styleOffer.installable = (await js('window.pastel.config.get()')).petalStyles?.installable;
  log(`${(styleOffer.button === 'Add Petal’s reply styles') === styleOffer.installable ? 'ok' : 'FAIL'} welcome offers Petal's reply styles only while some are missing, opt-in: ${JSON.stringify(styleOffer)}`);
  log(`${configStore.load().welcome.seen ? 'ok' : 'FAIL'} welcome.seen saved once shown`);
  await captureBoth(kit, 'welcome');
  await footerInViewCheck(kit, win);

  await js('PastelTerm.welcome.open({ claudeFound: false })');
  const missing = await js(welcomeState);
  log(`${missing.claude === 'missing' && missing.command === INSTALL_COMMAND && missing.recheck ? 'ok' : 'FAIL'} PATH-missing variant: Get started step 1 shows the install command and Check again: ${JSON.stringify({ claude: missing.claude, command: missing.command, recheck: missing.recheck })}`);
  await captureBoth(kit, 'welcome-no-claude');
  await js("document.querySelector('#welcome .gs-recheck').click()");
  const rechecked = await waitFor(async () => ((await js(welcomeState)).claude === 'found' ? true : null), 8000);
  log(`${rechecked ? 'ok' : 'FAIL'} Check again looks for claude afresh and finds it`);

  await js("document.querySelector('.welcome-start').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  const afterEsc = await js(welcomeState);
  log(`${!afterEsc.shown && afterEsc.reader ? 'ok' : 'FAIL'} Esc closes the welcome screen: ${JSON.stringify({ shown: afterEsc.shown, reader: afterEsc.reader })}`);

  send(win.webContents, 'welcome:open'); // what Help › Welcome sends
  const reopened = await waitFor(async () => ((await js(welcomeState)).shown ? true : null), 5000);
  await js("document.querySelector('.welcome-start').click()");
  await wait(300);
  const started = await js(`({ shown: !document.getElementById('welcome').hidden, tabs: document.querySelectorAll('#tab-strip [role="tab"]').length, active: Boolean(PastelTerm.tabs.active()) })`);
  log(`${reopened && !started.shown && started.active ? 'ok' : 'FAIL'} Help › Welcome reopens it and Start goes to the tab: ${JSON.stringify({ reopened: Boolean(reopened), ...started })}`);
}

// PASTEL_SNAPSHOT_MODE=welcome-relaunch on the same userData: the second launch skips it.
export async function welcomeRelaunchCheck({ js, log }: Kit): Promise<void> {
  const state = await js(welcomeState);
  log(`${!state.shown && state.reader && configStore.load().welcome.seen ? 'ok' : 'FAIL'} second launch skips the welcome screen: ${JSON.stringify({ shown: state.shown, reader: state.reader })}`);
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
