// The reply box's "/" menu: from a fixture Claude folder, "/" opens every group, typing filters, arrows and Enter
// insert the right text, Send then pastes it, Esc closes, the "/" button browses, consent off shows Claude Code's
// commands only with an Allow line, and every theme and reading style keeps it readable and on screen.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import * as configStore from '../main/config-store';
import { resizeOffscreen } from '../main/snapshot-window';
import { claudeStarts, pasteWrites, slashFixture } from '../main/snapshot-mode';
import { READING_CHOICES } from '../main/menu';

const MIN_RATIO = 4.5;
const WIDTHS = [800, 1280, 1600];
const GROUPS = ['Skills', 'Commands', 'Agents', 'Claude Code'];

const write = (root: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
const md = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\nBody.\n`;

// A fake Claude folder with one of everything, plus a project folder; returns the project root.
export function seedSlashFixture(claudeDir: string, projectRoot: string): void {
  write(claudeDir, 'skills/log-triage/SKILL.md', md('log-triage', 'Diagnose a pasted log line or error blob.'));
  write(claudeDir, 'skills/code-quality/SKILL.md', md('code-quality', 'Audit the diff after writing code.'));
  write(claudeDir, 'commands/standup.md', '---\ndescription: Draft today\'s standup from git log\n---\n');
  write(claudeDir, 'commands/frontend/component.md', '# Scaffold a component with tests\n');
  write(claudeDir, 'agents/reviewer.md', md('reviewer', 'Reviews pull requests for correctness.'));
  const plugin = path.join(claudeDir, 'plugins', 'cache', 'demo-market', 'qa-kit', '1.0.0');
  write(plugin, '.claude-plugin/plugin.json', JSON.stringify({ name: 'qa-kit' }));
  write(plugin, 'skills/triage/SKILL.md', md('triage', 'Sort new bugs by severity.'));
  write(plugin, 'commands/report.md', '---\ndescription: Daily QA report\n---\n');
  write(plugin, 'agents/tester.md', md('tester', 'Writes test cases.'));
  write(claudeDir, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'qa-kit@demo-market': [{ scope: 'user', installPath: plugin, version: '1.0.0' }] } }));
  write(projectRoot, '.claude/skills/release-notes/SKILL.md', md('release-notes', 'Write release notes for this repo.'));
}

// What the menu shows: groups, option names and sources, aria wiring, and contrast of every text on its own backdrop.
const PROBE = `(() => {
  const menu = document.querySelector('.slash-menu');
  const input = document.activeElement;
  if (!menu) return null;
  const rgb = (s) => (s.match(/[\\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const ratio = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(backOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
  const box = menu.getBoundingClientRect();
  const texts = [...menu.querySelectorAll('.slash-name, .slash-source, .slash-desc, .slash-group-label, .slash-empty, .slash-footer > span, .slash-allow')];
  const options = [...menu.querySelectorAll('[role="option"]')];
  return {
    open: !menu.hidden && box.height > 0,
    groups: [...menu.querySelectorAll('.slash-group-label')].map((g) => g.textContent),
    names: options.map((o) => o.querySelector('.slash-name').textContent),
    sources: options.map((o) => o.querySelector('.slash-source').textContent),
    selected: options.findIndex((o) => o.getAttribute('aria-selected') === 'true'),
    activeId: input?.getAttribute('aria-activedescendant') ?? null,
    expanded: input?.getAttribute('aria-expanded') ?? null,
    controls: input?.getAttribute('aria-controls') ?? null,
    listbox: menu.querySelector('[role="listbox"]')?.id ?? null,
    allow: Boolean(menu.querySelector('.slash-allow')) && !menu.querySelector('.slash-footer').hidden,
    minRatio: Math.min(...texts.map(ratio)),
    onScreen: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    value: document.getElementById('composer-input').value,
  };
})()`;

export async function slashMenuCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} slash menu: ${what}`);
  const root = path.join(outDir, 'slash-fixture');
  const claudeDir = path.join(root, 'claude');
  const project = path.join(root, 'project');
  fs.rmSync(root, { recursive: true, force: true });
  seedSlashFixture(claudeDir, project);
  slashFixture.claudeDir = claudeDir;

  const probe = () => js(PROBE);
  const key = (k: string, extra = '') => js(`document.getElementById('composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true ${extra} }))`);
  // Types as she would: the value, the caret at its end, then the input event the box listens for.
  const type = (value: string) => js(`(() => { const box = document.getElementById('composer-input'); box.focus(); box.value = ${JSON.stringify(value)}; box.setSelectionRange(box.value.length, box.value.length); box.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  // The fixture tab's folder is the project, so its skills show; a feed update may reset it, so set it before each open.
  const pointAtProject = () => js(`(() => { const u = PastelTerm.tabs.active()?.update; if (u) u.cwd = ${JSON.stringify(project)}; })()`);
  const openWith = async (value: string, want: (p: { names: string[]; allow: boolean }) => boolean = () => true) => {
    await pointAtProject();
    await type(value);
    return waitFor(async () => { const p = await probe(); return p?.open && want(p) ? p : null; }, 5000);
  };
  const closed = () => waitFor(async () => (await js("document.querySelector('.slash-menu')?.hidden !== false")) || null, 3000);
  const setReading = async (look: string) => {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
  };

  await js('PastelTerm.getStarted.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  const [startWidth, startHeight] = win.getContentSize();
  try {
    resizeOffscreen(win, 1280, 1000);
    await wait(300);

    // "/" opens every group, with user, project and plugin sources and the aria wiring.
    const all = await openWith('/', (p) => p.names.includes('/qa-kit:triage'));
    check(all && GROUPS.every((g, i) => all.groups[i] === g), `"/" opens all four groups in order: ${JSON.stringify(all?.groups)}`);
    const want = ['/log-triage', '/code-quality', '/release-notes', '/qa-kit:triage', '/standup', '/frontend:component', '/qa-kit:report', '@agent-reviewer', '@agent-qa-kit:tester', '/clear', '/compact', '/model'];
    check(all && want.every((n) => all.names.includes(n)), `fixture items listed: missing ${JSON.stringify(want.filter((n) => !all?.names.includes(n)))}`);
    check(all && all.sources[all.names.indexOf('/release-notes')] === 'project' && all.sources[all.names.indexOf('/qa-kit:triage')] === 'plugin qa-kit' && all.sources[all.names.indexOf('/log-triage')] === 'user',
      'sources: user, project, plugin');
    check(all && all.expanded === 'true' && all.controls === all.listbox && all.activeId === 'slash-option-0' && all.selected === 0, `aria: ${JSON.stringify({ e: all?.expanded, c: all?.controls, a: all?.activeId })}`);
    check(all && all.minRatio >= MIN_RATIO && all.onScreen && all.overflowX <= 0, `paleSky readable and on screen: ${all?.minRatio}:1`);
    await capture('slash-open');

    // Typing filters; arrows move; Enter inserts the picked one with a trailing space.
    const filtered = await openWith('/tri', (p) => p.names.length > 0 && p.names.every((n) => /t.*r.*i/i.test(n)));
    check(filtered && filtered.names.length >= 2 && filtered.names.every((n: string) => /tri/.test(n)), `"/tri" filters: ${JSON.stringify(filtered?.names)}`);
    await capture('slash-filtered');
    await key('ArrowDown');
    const moved = await probe();
    check(moved?.activeId === 'slash-option-1' && moved.selected === 1, `ArrowDown moves to the second: ${moved?.activeId}`);
    const picked = moved?.names[1] ?? '';
    await key('Enter');
    await closed();
    const afterEnter = await probe();
    check(afterEnter && afterEnter.value === `${picked} ` && !afterEnter.open && afterEnter.expanded === 'false', `Enter inserts "${picked} " and closes: ${JSON.stringify(afterEnter?.value)}`);

    // Her arguments, then Send: the paste carries the command as she would type it.
    await js("(() => { const box = document.getElementById('composer-input'); box.value += 'today'; })()");
    const live = await js("PastelTerm.tabs.active()?.update?.state === 'live'");
    const tabId = await js('PastelTerm.tabs.active()?.id');
    const pastesBefore = pasteWrites.length;
    const startsBefore = claudeStarts.length;
    await key('Enter');
    const sent = live
      ? await waitFor(() => pasteWrites.slice(pastesBefore).find((w) => w.tabId === tabId) ?? null, 6000)
      : await waitFor(() => claudeStarts.slice(startsBefore).find((s) => s.tabId === tabId) ?? null, 6000);
    const text = sent && 'data' in sent ? sent.data : sent && 'command' in sent ? sent.command : '';
    check(live ? text === `\x1b[200~${picked} today\x1b[201~\r` : text.includes(`${picked} today`), `Send pastes "${picked} today": ${JSON.stringify(text)}`);

    // Tab inserts too; an agent goes in as an @agent- mention.
    await openWith('/review', (p) => p.names[0] === '@agent-reviewer');
    await key('Tab');
    await closed();
    check((await probe())?.value === '@agent-reviewer ', 'Tab inserts "@agent-reviewer "');

    // Esc closes and leaves the box (and focus) as it was.
    await openWith('/mo');
    await key('Escape');
    await closed();
    const esc = await js("({ value: document.getElementById('composer-input').value, focused: document.activeElement?.id })");
    check(esc.value === '/mo' && esc.focused === 'composer-input', `Esc closes, text and focus kept: ${JSON.stringify(esc)}`);

    // A click on an option picks it.
    await openWith('/standup', (p) => p.names[0] === '/standup');
    await js("document.querySelector('.slash-menu [role=\"option\"]').click()");
    await closed();
    check((await probe())?.value === '/standup ', 'click inserts "/standup "');

    // The "/" button browses the full list without typing, and puts the pick in front of her draft.
    await type('check the auth flow');
    await pointAtProject();
    await js("document.getElementById('composer-slash').click()");
    const browse = await waitFor(async () => { const p = await probe(); return p?.open && p.groups.length === 4 ? p : null; }, 5000);
    check(browse && browse.names.length === all?.names.length, `"/" button opens the full list: ${browse?.names.length}`);
    await key('Enter');
    await closed();
    check((await probe())?.value === `${browse?.names[0]} check the auth flow`, `browse pick goes in front: ${JSON.stringify((await probe())?.value)}`);

    // Every theme and reading style.
    for (const theme of ['paleSky', 'blush', 'nightPastel']) {
      applyTheme(theme, { persist: false });
      for (const [look] of READING_CHOICES) {
        await setReading(look);
        const p = await openWith('/');
        check(p && p.minRatio >= MIN_RATIO && p.onScreen && p.overflowX <= 0, `${theme} ${look}: ${p?.minRatio}:1, on screen ${p?.onScreen}`);
        if (look === 'newspaper' && theme === 'nightPastel') await capture('slash-dark');
        await key('Escape');
      }
    }
    applyTheme('paleSky', { persist: false });
    await setReading('newspaper');

    // Widths: the menu stays inside the window.
    for (const width of WIDTHS) {
      resizeOffscreen(win, width, 1000);
      await wait(300);
      const p = await openWith('/');
      check(p && p.onScreen && p.overflowX <= 0, `${width}px: on screen ${p?.onScreen}, overflow ${p?.overflowX}`);
      await key('Escape');
    }
    resizeOffscreen(win, 1280, 1000);

    // Consent off: Claude Code's commands only, and the Allow line.
    configStore.save({ claudeFolder: { choice: 'declined' } });
    await js('window.dispatchEvent(new Event("focus"))'); // the next open reads again
    const off = await openWith('/', (p) => !p.names.includes('/log-triage') && p.allow);
    check(off && off.groups.join() === 'Claude Code' && off.allow && off.names.every((n: string) => n.startsWith('/')), `consent off: built-ins and Allow only: ${JSON.stringify(off?.groups)}`);
    await key('Escape');
  } finally {
    configStore.save({ claudeFolder: { choice: 'allowed' } });
    slashFixture.claudeDir = null;
    await js("(() => { const box = document.getElementById('composer-input'); box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); })()");
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
