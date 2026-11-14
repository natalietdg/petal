// Snap probe: drags the reader/terminal divider with real mouse events and checks the terminal never flips between open and minimised mid-drag.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';

const FRAME = `(() => {
  const app = document.getElementById('app');
  const d = document.getElementById('divider').getBoundingClientRect();
  return { minimised: app.classList.contains('reader-only'), rows: app.style.gridTemplateRows, dividerY: Math.round(d.top + d.height / 2), dividerH: Math.round(d.height), appH: app.clientHeight };
})()`;

interface Frame { minimised: boolean; rows: string; dividerY: number; dividerH: number; appH: number }

export async function dividerDragCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, log } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} divider drag: ${what}`);
  const frame = (): Promise<Frame> => js(FRAME);
  const mouse = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', y: number) =>
    win.webContents.sendInputEvent({ type, x: 400, y, button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftbuttondown'] : [] });

  // Drags from the divider to each y in turn, sampling after every move; returns the frames seen.
  const drag = async (path: number[]): Promise<Frame[]> => {
    const start = await frame();
    const seen: Frame[] = [start];
    mouse('mouseDown', start.dividerY);
    await wait(50);
    for (const y of path) {
      mouse('mouseMove', y);
      await wait(40);
      seen.push(await frame());
    }
    mouse('mouseUp', path.at(-1) ?? start.dividerY);
    await wait(300);
    seen.push(await frame());
    return seen;
  };
  const flips = (seen: Frame[]) => seen.slice(1).filter((f, i) => f.minimised !== seen[i].minimised).length;
  const steps = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * (i + 1)) / n));

  await js('PastelTerm.layout.setTerminalMinimised(false, false)');
  await wait(400);
  const start = await frame();
  log(`divider start ${JSON.stringify(start)}`);

  // Opening the terminal wider: drag the divider up.
  const up = await drag(steps(start.dividerY, Math.round(start.appH * 0.25), 20));
  log(`drag up frames ${JSON.stringify(up.map((f) => [f.dividerY, f.minimised ? 'min' : 'open']))}`);
  check(flips(up) === 0 && !up.at(-1)?.minimised, `drag up never minimises (${flips(up)} flips)`);
  const moved = Math.abs((up.at(-1)?.dividerY ?? 0) - start.dividerY);
  check(moved > 50, `drag up moves the divider ${moved}px`);

  // Down and back up again without letting go: still open at the end, no flicker.
  const now = await frame();
  const wobble = await drag([...steps(now.dividerY, Math.round(now.appH * 0.8), 15), ...steps(Math.round(now.appH * 0.8), Math.round(now.appH * 0.4), 15)]);
  log(`wobble frames ${JSON.stringify(wobble.map((f) => [f.dividerY, f.minimised ? 'min' : 'open']))}`);
  check(flips(wobble) === 0 && !wobble.at(-1)?.minimised, `drag down then up stays open (${flips(wobble)} flips)`);

  // From minimised: the strip can be dragged back open.
  await js('PastelTerm.layout.setTerminalMinimised(true, false)');
  await wait(400);
  const folded = await frame();
  log(`minimised ${JSON.stringify(folded)}`);
  const reopen = await drag(steps(folded.dividerY, Math.round(folded.appH * 0.5), 15));
  log(`reopen frames ${JSON.stringify(reopen.map((f) => [f.dividerY, f.minimised ? 'min' : 'open']))}`);
  check(!reopen.at(-1)?.minimised && flips(reopen) <= 1, `dragging up from minimised opens it once (${flips(reopen)} flips)`);

  await js('PastelTerm.layout.setTerminalMinimised(false, false)');
}
