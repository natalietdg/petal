// Counts Petal's own headless Claude calls per local day, for Customize's "Background work used N calls today". Only a number, in <userData>.
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';

interface Tally { day: string; calls: number }

const tallyFile = () => path.join(app.getPath('userData'), 'background-calls.json');
// YYYY-MM-DD in her time zone, so "today" turns over at her midnight.
export const localDay = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

function read(): Tally | null {
  const data = readJsonOrSetAside(tallyFile()) as Partial<Tally> | undefined;
  return data && typeof data.day === 'string' && Number.isInteger(data.calls) ? { day: data.day, calls: data.calls as number } : null;
}

export function callsToday(now = new Date()): number {
  const tally = read();
  return tally?.day === localDay(now) ? tally.calls : 0;
}

// Never throws: a count that can't be saved must not stop the run it counts.
export function recordCall(now = new Date()): void {
  try {
    writeJsonAtomic(tallyFile(), { day: localDay(now), calls: callsToday(now) + 1 });
  } catch (error) {
    console.warn('[petal] could not count a background call:', error);
  }
}
