// Each window's reader/terminal split, saved in config.json under the window's slot.
// Slots are the lowest free number when a window opens, so window 1 reopens with window 1's split.
import * as configStore from './config-store';
import { handle } from './ipc';

const slots = new Map<number, number>(); // webContents id → slot

export function assignSlot(contentsId: number): void {
  const taken = new Set(slots.values());
  let slot = 0;
  while (taken.has(slot)) slot++;
  slots.set(contentsId, slot);
}

export function releaseSlot(contentsId: number): void {
  slots.delete(contentsId);
}

const slotOf = (contentsId: number): string => String(slots.get(contentsId) ?? 0);

export function registerLayoutIpc(): void {
  handle('layout:get-split', (event) => configStore.load().layout.splits[slotOf(event.sender.id)] ?? null);
  handle('layout:save-split', (event, fraction) => {
    const { splits } = configStore.load().layout;
    configStore.save({ layout: { splits: { ...splits, [slotOf(event.sender.id)]: fraction } } });
    return { ok: true };
  });
}
