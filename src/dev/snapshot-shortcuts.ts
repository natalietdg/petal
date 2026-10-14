// Shortcuts guide: ⌘/ (Help › Keyboard Shortcuts) opens it, every group and every menu accelerator is drawn, "conclude" is there,
// Esc closes it, it fits an 800px window with no sideways scroll, and Customize › Get started links to it.
import { Menu, type BrowserWindow, type MenuItem } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { ACCEL, GUIDE } from '../shared/shortcuts';

const STATE = `(() => {
  const view = document.getElementById('shortcuts');
  return {
    shown: !view.hidden && view.getClientRects().length > 0,
    current: PastelTerm.overlays.current(),
    groups: [...view.querySelectorAll('.sc-group')].map((g) => g.dataset.group),
    rows: view.querySelectorAll('.sc-row').length,
    combos: [...view.querySelectorAll('.sc-combo')].map((c) => c.textContent),
    text: view.textContent,
    focusInside: view.contains(document.activeElement),
  };
})()`;

// Anything wider than the window, and the overlay's own sideways scroll.
const FIT = `(() => {
  const W = window.innerWidth;
  const view = document.getElementById('shortcuts');
  const outside = [...view.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > W + 1); }).map((e) => e.className);
  const pane = view.querySelector('.sc-pane');
  return { inner: W, outside, docScroll: document.documentElement.scrollWidth - W, paneScroll: pane.scrollWidth - pane.clientWidth };
})()`;

function menuAccelerators(items: MenuItem[]): string[] {
  return items.flatMap((item) => [...(typeof item.accelerator === 'string' ? [item.accelerator] : []), ...(item.submenu ? menuAccelerators(item.submenu.items) : [])]);
}

export async function shortcutsCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} shortcuts: ${what}`);
  // any: the probe's shape is built in the script above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = (): Promise<any> => js(STATE);
  const [startWidth, startHeight] = win.getContentSize();
  await js('PastelTerm.overlays.hideCurrent()');

  // ⌘/ is the Help item's accelerator, and nothing else in the menu binds it.
  const menu = Menu.getApplicationMenu();
  const item = menu?.items.find((m) => m.role === 'help')?.submenu?.items.find((i: MenuItem) => i.label === 'Keyboard Shortcuts');
  const all = menuAccelerators(menu?.items ?? []);
  check(item?.accelerator === ACCEL.shortcuts && all.filter((a) => a === ACCEL.shortcuts).length === 1, `Help › Keyboard Shortcuts carries ⌘/ alone: ${JSON.stringify(item?.accelerator)}`);
  item?.click();
  check(await waitFor(async () => ((await state()).shown || null), 3000), '⌘/ (Help › Keyboard Shortcuts) opens the guide');
  const open = await state();
  check(open.current === 'shortcuts' && open.focusInside, `it is the open overlay and holds focus: ${open.current}`);
  check(JSON.stringify(open.groups) === JSON.stringify(GUIDE.map((g) => g.title)), `every group: ${open.groups.join(', ')}`);
  check(open.rows === GUIDE.reduce((n, g) => n + g.rows.length, 0), `every row drawn: ${open.rows}`);
  check(/\bconclude\b/.test(open.text) && open.text.includes('/factory'), 'lists "conclude" and /factory');

  // Every accelerator the live menu binds is a row whose chips are on screen.
  const missing = all.filter((accelerator) => {
    const row = GUIDE.flatMap((g) => g.rows).find((r) => r.accelerators?.includes(accelerator));
    return !row || !(row.keys ?? []).every((keys) => open.combos.includes(keys.join('')));
  });
  check(all.length > 15 && missing.length === 0, `all ${all.length} menu accelerators drawn${missing.length ? `; missing ${missing.join(', ')}` : ''}`);

  for (const width of [1280, 800]) {
    resizeOffscreen(win, width, 900);
    await waitFor(async () => ((await js('window.innerWidth')) === width || null), 3000);
    await wait(200);
    const fit = await js(FIT);
    check(fit.inner === width && fit.outside.length === 0 && fit.docScroll <= 1 && fit.paneScroll <= 1, `fits ${width}px with no sideways scroll ${JSON.stringify(fit)}`);
    await capture(`shortcuts-${width}`);
  }

  // Esc, as a real key on the focused Close button.
  for (const type of ['keyDown', 'keyUp'] as const) win.webContents.sendInputEvent({ type, keyCode: 'Escape' });
  check(await waitFor(async () => (!(await state()).shown || null), 3000), 'Esc closes it');

  // Help › Keyboard Shortcuts again, over History: History gives way.
  await js('PastelTerm.history.open()');
  item?.click();
  check(await waitFor(async () => ((await state()).current === 'shortcuts' || null), 3000), 'Help menu opens it over History');
  item?.click();
  check(await waitFor(async () => (!(await state()).shown || null), 3000), 'a second ⌘/ closes it');

  // Customize › Get started has a small Shortcuts link.
  await js("PastelTerm.customize.open('start')");
  check(await waitFor(() => js("document.querySelector('#customize-body .cz-open-shortcuts') ? true : null"), 5000), 'Customize › Get started has a Shortcuts link');
  await js("document.querySelector('#customize-body .cz-open-shortcuts').click()");
  check(await waitFor(async () => ((await state()).current === 'shortcuts' || null), 3000), 'the link opens the guide');
  await js('PastelTerm.shortcuts.close()');

  resizeOffscreen(win, startWidth, startHeight);
}
