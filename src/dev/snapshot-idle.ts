// Idle CPU probe: one scene, Claude resting, measured per process type with app.getAppMetrics.
// PASTEL_SNAPSHOT_ONSCREEN=1 puts the window in a screen corner (click-through, never focused), since
// an off-screen window's CPU is not what she sees. PASTEL_SNAPSHOT_FOCUS=1 emulates a focused terminal.
import path from 'node:path';
import { app, contentTracing, screen, type BrowserWindow } from 'electron';
import { snapshotOutDir } from '../main/snapshot-mode';
import type { Js, Log } from './snapshot';

const WARMUP_MS = 6000;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Seconds of CPU each process type has used so far.
function cpuSeconds(): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const metric of app.getAppMetrics()) totals[metric.type] = (totals[metric.type] ?? 0) + (metric.cpu.cumulativeCPUUsage ?? 0);
  return totals;
}

function placeOnScreen(win: BrowserWindow): void {
  const area = screen.getPrimaryDisplay().workArea;
  const { width, height } = win.getBounds();
  win.setBounds({ x: area.x + area.width - width, y: area.y + area.height - height, width, height });
  win.setIgnoreMouseEvents(true);
  win.setOpacity(1);
}

// A short Chromium trace of the idle page into trace.json, for where the frames go.
async function traceFor(ms: number): Promise<void> {
  await contentTracing.startRecording({ included_categories: ['blink', 'cc', 'viz', 'gpu', 'devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  await wait(ms);
  await contentTracing.stopRecording(path.join(snapshotOutDir(), 'trace.json'));
}

export async function sceneIdle({ win, js, log }: { win: BrowserWindow; js: Js; log: Log }): Promise<void> {
  const scene = process.env.PASTEL_SNAPSHOT_SCENE ?? 'none';
  const totalMs = Number(process.env.PASTEL_SNAPSHOT_IDLE_S ?? 36) * 1000;
  if (process.env.PASTEL_SNAPSHOT_ONSCREEN === '1') placeOnScreen(win);
  if (process.env.PASTEL_SNAPSHOT_FOCUS === '1') {
    win.webContents.debugger.attach();
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await js("document.querySelector('.xterm-helper-textarea')?.focus()");
  }
  await js(`PastelTerm.cat.setScene(${JSON.stringify(scene)})`);
  if (process.env.PASTEL_SNAPSHOT_AWAKE !== '1') await js("document.getElementById('cat').classList.remove('awake')"); // long idle: she dozes
  if (process.env.PASTEL_SNAPSHOT_IDLE_JS) await js(process.env.PASTEL_SNAPSHOT_IDLE_JS); // experiments: pause, hide, etc.
  await wait(WARMUP_MS);
  const before = cpuSeconds();
  const start = Date.now();
  await wait(totalMs - WARMUP_MS);
  const after = cpuSeconds();
  if (process.env.PASTEL_SNAPSHOT_TRACE === '1') await traceFor(5000); // after the measured window, so it doesn't skew it
  const seconds = (Date.now() - start) / 1000;
  const percent = Object.fromEntries(Object.keys(after).map((type) => [type, +((100 * (after[type] - (before[type] ?? 0))) / seconds).toFixed(2)]));
  const total = Object.values(percent).reduce((sum, value) => sum + value, 0);
  const state = await js("({ scene: document.getElementById('cat').dataset.scene, visibility: document.visibilityState, focus: document.hasFocus(), count: document.getAnimations().length, notRunning: document.getAnimations().filter((a) => a.playState !== 'running').map((a) => `${a.animationName}:${a.playState}`).join(' '), rects: document.querySelectorAll('#cat rect').length, animations: [...new Set(document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName))].join(' ') })");
  log(`IDLE ${JSON.stringify({ ...state, onscreen: process.env.PASTEL_SNAPSHOT_ONSCREEN === '1', bounds: win.getBounds(), seconds: +seconds.toFixed(1), total: +total.toFixed(2), percent })}`);
}
