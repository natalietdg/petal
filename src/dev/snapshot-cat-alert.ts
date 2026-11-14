// The pet's "waiting on you" and "done" signals: asking shows "!", a finished turn shows a check, a tab switch shows nothing.
import type { Kit } from './snapshot';

const STATE = `(() => {
  const cat = document.getElementById('cat');
  const alert = cat.querySelector('.cat-alert');
  return {
    asking: cat.classList.contains('asking'), done: cat.classList.contains('done'),
    mark: alert && getComputedStyle(alert, '::before').content, shown: Boolean(alert?.getClientRects().length),
    tip: cat.querySelector('.cat-tip')?.textContent ?? '',
  };
})()`;

export async function catAlertCheck(kit: Kit): Promise<void> {
  const { js, wait, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} cat alert: ${what}`);
  const state = () => js(STATE);
  await js("PastelTerm.cat.setCat('mika')");

  await js("PastelTerm.cat.setBusy(true, 'cat-a'); PastelTerm.cat.setBusy(false, 'cat-b')");
  const switched = await state();
  check(!switched.done && !switched.shown, `a tab switch from busy to idle shows nothing: ${JSON.stringify(switched)}`);

  await js("PastelTerm.cat.setBusy(true, 'cat-a'); PastelTerm.cat.setBusy(false, 'cat-a')");
  const done = await state();
  check(done.done && done.shown && done.mark === '"✓"' && done.tip.endsWith('Claude is done'), `finishing shows a check: ${JSON.stringify(done)}`);

  await js("PastelTerm.cat.setAsking(true)");
  const asking = await state();
  check(asking.asking && !asking.done && asking.mark === '"!"' && asking.tip.endsWith('Claude is waiting on you'), `asking shows "!": ${JSON.stringify(asking)}`);
  for (const id of ['paleSky', 'black']) {
    applyTheme(id, { persist: false });
    await wait(500);
    await capture(`cat-asking-${id}`);
  }
  applyTheme('paleSky', { persist: false });

  await js("PastelTerm.cat.setBusy(true, 'cat-a'); PastelTerm.cat.setBusy(false, 'cat-a')");
  const stillAsking = await state();
  check(stillAsking.asking && !stillAsking.done, `finishing while asking keeps "!": ${JSON.stringify(stillAsking)}`);

  await js("PastelTerm.cat.setAsking(false)");
  const cleared = await state();
  check(!cleared.asking && !cleared.shown && cleared.tip.endsWith('Claude is resting'), `answering clears it: ${JSON.stringify(cleared)}`);
}
