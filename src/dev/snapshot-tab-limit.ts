// ⌘T (its menu item) and the + button: at her limit no tab and the limit note; below it, one more tab.
import { Menu, type MenuItem } from 'electron';
import * as configStore from '../main/config-store';
import { panelFixture } from '../main/snapshot-mode';
import type { Kit } from './snapshot';

const STATE = `(() => {
  const panel = document.getElementById('sessions-panel');
  return {
    ids: PastelTerm.tabs.ids(),
    active: PastelTerm.tabs.active()?.id ?? null,
    panelOpen: !panel.hidden,
    banner: panel.querySelector('.sessions-limit-text')?.textContent ?? null,
    blockedHint: panel.querySelector('.sessions-add-blocked')?.textContent ?? null,
  };
})()`;

const menuItem = (label: string): MenuItem | undefined =>
  Menu.getApplicationMenu()?.items.flatMap((m): MenuItem[] => m.submenu?.items ?? []).find((i) => i.label === label);

export async function tabLimitCheck(kit: Kit): Promise<void> {
  const { js, wait, waitFor, log, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} tab limit: ${what}`);
  // any: the probe's shape is built in the script above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = (): Promise<any> => js(STATE);
  const fake = (n: number) => `bdbdbdbd-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const session = (n: number) => ({ pid: 0, sessionId: fake(n), cwd: `/tmp/petal-fixture/t${n}`, kind: 'interactive' as const, status: 'idle' as const, name: `Fixture ${n}`, updatedAt: Date.now() });
  const newTabItem = menuItem('New Tab');
  check(newTabItem?.accelerator === 'CmdOrCtrl+T', `File › New Tab carries ⌘T: ${JSON.stringify(newTabItem?.accelerator)}`);
  const paths: [string, () => Promise<unknown>][] = [
    ['⌘T menu item', async () => newTabItem?.click()],
    ['+ button', () => js("document.querySelector('#tab-strip .tab-new').click()")],
  ];
  const start = await state();
  const opened: string[] = [];

  // At the limit: 2 open (fixture sessions only, never hers), limit 2.
  panelFixture.sessions = [session(1), session(2)];
  configStore.save({ sessions: { maxOpen: 2 } });
  for (const [name, open] of paths) {
    await js('PastelTerm.sessionsPanel.setOpen(false)');
    const before = (await state()).ids.length;
    await open();
    const blocked = await waitFor(async () => { const s = await state(); return s.panelOpen && s.blockedHint ? s : null; }, 6000);
    await wait(500); // a late tab would show up by now
    const after = await state();
    check(blocked && after.ids.length === before && blocked.banner === '2 open, your limit is 2' && blocked.blockedHint === 'Close one to add a session.',
      `${name} at the limit: no new tab (${before} -> ${after.ids.length}), note shown: ${JSON.stringify({ banner: blocked?.banner, hint: blocked?.blockedHint })}`);
  }
  await capture('tab-limit-blocked');

  // Below the limit: 1 open, limit 8.
  panelFixture.sessions = [session(1)];
  configStore.save({ sessions: { maxOpen: 8 } });
  await js('PastelTerm.sessionsPanel.setOpen(false)');
  for (const [name, open] of paths) {
    const before = (await state()).ids;
    await open();
    const grown = await waitFor(async () => { const s = await state(); return s.ids.length === before.length + 1 ? s : null; }, 6000);
    const fresh = grown?.ids.find((id: string) => !before.includes(id));
    if (fresh) opened.push(fresh);
    check(grown && !grown.panelOpen, `${name} below the limit: tabs ${before.length} -> ${grown?.ids.length}, panel stays shut`);
  }

  panelFixture.sessions = null;
  for (const id of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
  const closed = await waitFor(async () => ((await state()).ids.length === start.ids.length ? true : null), 8000);
  check(closed, `test tabs closed again: ${JSON.stringify((await state()).ids)}`);
  if (start.active) await js(`PastelTerm.tabs.activate(${JSON.stringify(start.active)})`);
}
