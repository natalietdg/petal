// Fixed header: after scrolling the reader 1500px, the dock and the view toggle sit at the same y and still take clicks, in every look.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { printUpdate } from './snapshot-print';
import { READING_CHOICES } from '../main/menu';

const SCROLL_PX = 1500;

// y of each header button, and whether elementFromPoint at its centre lands on it.
const PROBE = `(() => {
  const buttons = [...document.querySelectorAll('#sessions-dock > button, #reader-head .view-toggle button')];
  return buttons.map((b) => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { label: b.textContent.trim().slice(0, 24), top: Math.round(r.top), visible: r.height > 0 && r.bottom > 0, hit: hit === b || b.contains(hit) };
  });
})()`;

export async function headerCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} fixed header: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  win.setContentSize(1280, 900);
  await waitFor(async () => (await js('window.innerWidth')) === 1280, 3000);
  applyTheme('paleSky', { persist: false });
  await js("PastelTerm.reader.setView('replies')");
  await js(`PastelTerm.reader.update(${JSON.stringify(printUpdate)})`);

  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    await wait(300);
    await js("document.getElementById('reader').scrollTop = 0");
    await wait(100);
    const top = await js(PROBE);
    await js(`document.getElementById('reader').scrollTop = ${SCROLL_PX}`);
    await wait(200);
    const scrolled = await js(`document.getElementById('reader').scrollTop`);
    const after = await js(PROBE);
    // any: the probe's shape is built in the script above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const same = after.length === top.length && after.length >= 8 && after.every((b: any, i: number) => b.visible && b.hit && b.top === top[i].top);
    check(scrolled >= SCROLL_PX && same, `${look}: scrolled ${scrolled}px, ${after.length} header buttons visible, same y, clickable: ${JSON.stringify(after)}`);
    await capture(`header-scrolled-${look}-1280`);
  }

  await js("document.getElementById('reader').scrollTop = 0");
  await js("window.pastel.look.setReading('newspaper')");
  win.setContentSize(startWidth, startHeight);
}
