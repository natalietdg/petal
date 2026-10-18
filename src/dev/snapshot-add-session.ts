// Add Session, from the dock and the tab strip's +: one more tab, shown, reply box focused; at her limit, no tab and the limit note.
import * as configStore from '../main/config-store';
import { panelFixture } from '../main/snapshot-mode';
import type { Kit } from './snapshot';

const STATE = `(() => {
  const t = PastelTerm.tabs;
  const panel = document.getElementById('sessions-panel');
  return {
    ids: t.ids(),
    active: t.active()?.id ?? null,
    shown: t.ids().filter((id) => !t.get(id).host.hidden),
    focused: document.activeElement?.id ?? null,
    dockLabel: document.getElementById('add-session-button')?.textContent ?? null,
    panelOpen: !panel.hidden,
    panelButtons: [...panel.querySelectorAll('button')].map((b) => b.textContent),
    banner: panel.querySelector('.sessions-limit-text')?.textContent ?? null,
    blockedHint: panel.querySelector('.sessions-add-blocked')?.textContent ?? null,
  };
})()`;

export async function addSessionCheck(kit: Kit): Promise<void> {
  const { js, wait, waitFor, log, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} add session: ${what}`);
  // any: the probe's shape is built in the script above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const waitState = (test: (s: any) => boolean, ms = 6000) => waitFor(async () => { const s = await js(STATE); return test(s) ? s : null; }, ms);
  const fake = (n: number) => `adadadad-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const session = (n: number) => ({ pid: 0, sessionId: fake(n), cwd: `/tmp/petal-fixture/s${n}`, kind: 'interactive' as const, status: 'idle' as const, name: `Fixture ${n}`, updatedAt: Date.now() });

  // Fixture sessions only, so her real ones never decide the outcome.
  panelFixture.sessions = [session(1)];
  configStore.save({ sessions: { maxOpen: 8 } });
  await js('PastelTerm.sessionsPanel.setOpen(false)');
  const start = await js(STATE);
  const opened: string[] = [];

  await js("document.getElementById('add-session-button').click()");
  const fromDock = await waitState((s) => s.ids.length === start.ids.length + 1);
  const dockTab = fromDock?.ids.at(-1);
  check(start.dockLabel === 'Add Session', `dock button labelled "Add Session": ${JSON.stringify(start.dockLabel)}`);
  check(fromDock && fromDock.active === dockTab && fromDock.shown.join() === dockTab && fromDock.focused === 'composer-input',
    `dock click: tabs ${start.ids.length} -> ${fromDock?.ids.length}, new tab active and shown, reply box focused: ${JSON.stringify(fromDock)}`);
  if (dockTab) opened.push(dockTab);
  await capture('add-session-dock');

  // The panel lists sessions only: Add Session lives in the header and the tab strip.
  await js('PastelTerm.sessionsPanel.setOpen(true)');
  const panelShown = await waitState((s) => s.panelOpen);
  check(panelShown && !panelShown.panelButtons.includes('Add Session') && !panelShown.panelButtons.includes('Board'),
    `Sessions panel has no Add Session or Board button: ${JSON.stringify(panelShown?.panelButtons)}`);
  await capture('add-session-panel');
  await js('PastelTerm.sessionsPanel.setOpen(false)');
  const before = (await js(STATE)).ids.length;
  await js("document.querySelector('#tab-strip .tab-new').click()");
  const fromPlus = await waitState((s) => s.ids.length === before + 1);
  const plusTab = fromPlus?.ids.at(-1);
  const plusTitle = await js("document.querySelector('#tab-strip .tab-new').title");
  check(fromPlus && fromPlus.active === plusTab && plusTitle === 'New session tab (⌘T)',
    `+ click: tabs ${before} -> ${fromPlus?.ids.length}, new tab active, its own tooltip: ${JSON.stringify({ plusTitle, fromPlus })}`);
  if (plusTab) opened.push(plusTab);

  // At the limit: 2 open, limit 2.
  panelFixture.sessions = [session(1), session(2)];
  configStore.save({ sessions: { maxOpen: 2 } });
  const atLimit = (await js(STATE)).ids.length;
  await js("document.getElementById('add-session-button').click()");
  const blocked = await waitState((s) => s.panelOpen && s.banner !== null);
  await wait(500); // a late tab would show up by now
  const after = await js(STATE);
  check(blocked && after.ids.length === atLimit && blocked.banner === '2 open, your limit is 2' && blocked.blockedHint === 'Close one to add a session.',
    `at the limit: no new tab (${atLimit} -> ${after.ids.length}), limit note shown: ${JSON.stringify({ banner: blocked?.banner, hint: blocked?.blockedHint })}`);
  await capture('add-session-limit');

  configStore.save({ sessions: { maxOpen: 8 } });
  panelFixture.sessions = null;
  await js('PastelTerm.sessionsPanel.setOpen(false)');
  for (const id of opened) await js(`PastelTerm.tabs.requestClose(${JSON.stringify(id)})`);
  const closed = await waitState((s) => s.ids.length === start.ids.length, 8000);
  check(closed, `test tabs closed again: ${JSON.stringify((await js(STATE)).ids)}`);
  if (start.active) await js(`PastelTerm.tabs.activate(${JSON.stringify(start.active)})`);
}
