// The update pill: hidden until an update is ready, then "Update ready · Restart" in the dock band, pill-shaped.
// The updater is off in snapshot runs, so a click must come back with a note and never restart.
import { NOT_READY_NOTE } from '../main/updater';
import { UPDATE_PILL_TEXT } from '../shared/ipc';
import type { Kit } from './snapshot';

const STATE = `(() => {
  const pill = document.getElementById('update-pill');
  const style = getComputedStyle(pill);
  return { hidden: pill.hidden, shown: pill.offsetWidth > 0, text: pill.textContent, radius: style.borderRadius,
    inDock: pill.parentElement?.id, beforeSessions: pill.nextElementSibling?.id };
})()`;

export async function updatePillCheck(kit: Kit): Promise<void> {
  const { js, waitFor, log, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} update pill: ${what}`);

  const start = await js(STATE);
  check(start.hidden && !start.shown, `hidden while no update is ready: ${JSON.stringify(start)}`);

  await js('PastelTerm.updatePill.show()');
  const shown = await js(STATE);
  check(shown.shown && shown.text === UPDATE_PILL_TEXT && shown.radius === '999px' && shown.inDock === 'sessions-dock' && shown.beforeSessions === 'sessions-pill',
    `shown in the dock band beside Sessions, pill-shaped: ${JSON.stringify(shown)}`);
  check(!/[—–]/.test(shown.text), 'no em or en dash in the label');
  await capture('update-pill');

  await js("document.getElementById('update-pill').click()");
  const noted = await waitFor(async () => { const s = await js(STATE); return s.text === NOT_READY_NOTE ? s : null; }, 4000);
  check(noted, `restart refused with a note while the updater is off: ${JSON.stringify(noted ?? await js(STATE))}`);

  await js("document.getElementById('update-pill').hidden = true");
}
