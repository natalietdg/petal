// Where snapshot windows go: off every display, so a test run never covers her work.
import { screen, type BrowserWindow, type BrowserWindowConstructorOptions, type Rectangle } from 'electron';

const OFFSCREEN_GAP_PX = 200;

const overlaps = (a: Rectangle, b: Rectangle): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
export const onAnyDisplay = (bounds: Rectangle): boolean => screen.getAllDisplays().some((d) => overlaps(bounds, d.bounds));

// Snapshot windows live past the right edge of every display: never seen, clicked, focused or listed.
export function offscreenWindowOptions(): BrowserWindowConstructorOptions {
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  return {
    x: Math.max(...displays.map((b) => b.x + b.width)) + OFFSCREEN_GAP_PX,
    y: Math.min(...displays.map((b) => b.y)),
    frame: false, // macOS pulls titled windows back on-screen; frameless ones stay put
    enableLargerThanScreen: true,
    focusable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    paintWhenInitiallyHidden: true,
  };
}

// Moves the window back past every display, invisible while it is on one.
function park(win: BrowserWindow): void {
  if (win.isDestroyed() || !onAnyDisplay(win.getBounds())) return;
  win.setOpacity(0);
  const { x, y } = offscreenWindowOptions();
  win.setPosition(x ?? 0, y ?? 0);
  if (!onAnyDisplay(win.getBounds())) win.setOpacity(1);
}

// Shown without activating and transparent until it is confirmed off every display; re-parked if macOS moves it.
export function showOffscreen(win: BrowserWindow): void {
  win.setIgnoreMouseEvents(true);
  win.setOpacity(0);
  win.showInactive();
  if (!onAnyDisplay(win.getBounds())) win.setOpacity(1);
  keepOffscreen(win);
}

// macOS can move the window onto a display after a resize, a show or a display change: park it again, now and a beat later.
function keepOffscreen(win: BrowserWindow): void {
  if (process.env.PASTEL_SNAPSHOT_ONSCREEN === '1') return; // the idle CPU probe sits on-screen on purpose
  const repark = (): void => { park(win); setTimeout(() => park(win), 1000); };
  win.on('move', repark);
  win.on('resize', repark);
  win.on('show', repark);
  screen.on('display-added', repark);
  screen.on('display-removed', repark);
  screen.on('display-metrics-changed', repark);
}

// Resizes without leaving the off-screen spot: macOS can pull a resized window back onto a display.
export function resizeOffscreen(win: BrowserWindow, width: number, height: number): void {
  const { x, y } = win.getBounds();
  win.setContentSize(width, height);
  const moved = win.getBounds();
  if (moved.x !== x || moved.y !== y) win.setPosition(x, y);
}
