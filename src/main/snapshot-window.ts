// Where snapshot windows go: off every display, so a test run never covers her work.
import { screen, type BrowserWindow, type BrowserWindowConstructorOptions, type Rectangle } from 'electron';

const OFFSCREEN_GAP_PX = 200;

const overlaps = (a: Rectangle, b: Rectangle): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
export const onAnyDisplay = (bounds: Rectangle): boolean => screen.getAllDisplays().some((d) => overlaps(bounds, d.bounds));

const SETTLE_MS = 500;
const onscreenProbe = (): boolean => process.env.PASTEL_SNAPSHOT_ONSCREEN === '1'; // the idle CPU probe sits on-screen on purpose

// Past the right edge of every display, level with the highest one; read fresh, since displays come and go mid-run.
function offscreenSpot(): { x: number; y: number } {
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  return { x: Math.max(...displays.map((b) => b.x + b.width)) + OFFSCREEN_GAP_PX, y: Math.min(...displays.map((b) => b.y)) };
}

// Snapshot windows live past the right edge of every display: never seen, clicked, focused or listed.
export function offscreenWindowOptions(): BrowserWindowConstructorOptions {
  return {
    ...offscreenSpot(),
    frame: false, // macOS pulls titled windows back on-screen; frameless ones stay put
    enableLargerThanScreen: true,
    focusable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    paintWhenInitiallyHidden: true,
  };
}

const settling = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>();

// Opaque again only once the window has held one spot off every display for SETTLE_MS; captures paint either way.
function revealWhenSettled(win: BrowserWindow): void {
  clearTimeout(settling.get(win));
  const held = win.getBounds();
  settling.set(win, setTimeout(() => {
    if (win.isDestroyed()) return;
    const now = win.getBounds();
    if (onAnyDisplay(now) || now.x !== held.x || now.y !== held.y) {
      park(win);
      revealWhenSettled(win);
      return;
    }
    win.setOpacity(1);
  }, SETTLE_MS));
}

// Hides the window and moves it back past every display; it stays transparent until it has settled there.
function park(win: BrowserWindow): void {
  if (win.isDestroyed() || !onAnyDisplay(win.getBounds())) return;
  win.setOpacity(0);
  const { x, y } = offscreenSpot();
  win.setPosition(x, y);
  revealWhenSettled(win);
}

// Transparent before macOS gets a chance to move it, then parked and revealed once settled.
function hideUntilSettled(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.setOpacity(0);
  park(win);
  revealWhenSettled(win);
}

// Shown without activating and transparent until it has settled off every display; re-parked if macOS moves it.
export function showOffscreen(win: BrowserWindow): void {
  win.setIgnoreMouseEvents(true);
  win.setOpacity(0);
  win.showInactive();
  if (onscreenProbe()) {
    win.setOpacity(1);
    return;
  }
  hideUntilSettled(win);
  keepOffscreen(win);
}

// macOS can move the window onto a display after a resize, a show or a display change: park it again, now and a beat later.
function keepOffscreen(win: BrowserWindow): void {
  const repark = (): void => { park(win); setTimeout(() => park(win), 1000); };
  // macOS moves windows onto the remaining displays after a change, so hide first rather than wait for the move.
  const displaysChanged = (): void => { hideUntilSettled(win); setTimeout(() => park(win), 1000); };
  win.on('move', repark);
  win.on('resize', repark);
  win.on('show', repark);
  screen.on('display-added', displaysChanged);
  screen.on('display-removed', displaysChanged);
  screen.on('display-metrics-changed', displaysChanged);
}

// Resizes in one step at the current off-screen spot, transparent until it settles there; never at a stale or pulled-in position.
export function resizeOffscreen(win: BrowserWindow, width: number, height: number): void {
  if (onscreenProbe()) {
    win.setContentSize(width, height);
    return;
  }
  win.setOpacity(0);
  win.setContentBounds({ ...offscreenSpot(), width, height });
  park(win);
  revealWhenSettled(win);
}
