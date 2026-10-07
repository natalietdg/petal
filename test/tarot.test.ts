import { afterEach, describe, expect, it, vi } from 'vitest';
import { svg } from '../src/renderer/scenes';
import { everyDay, localDayNumber } from '../src/renderer/scenes/daily';
import { DECK, cardFor } from '../src/renderer/scenes/tarot-deck';

const day = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min);
const nextDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12);

// Runs `body` with the process in another time zone; Node re-reads TZ when it changes.
function inZone(zone: string, body: () => void): void {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    body();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe('tarot deck', () => {
  it('has the 22 Major Arcana in order, each with a short reading and no em dashes', () => {
    expect(DECK.map((card) => card.number)).toEqual([...Array(22).keys()]);
    expect(DECK[0]?.name).toBe('The Fool');
    expect(DECK[21]?.name).toBe('The World');
    for (const card of DECK) {
      expect(card.reading.length).toBeGreaterThan(30);
      expect(card.reading.length).toBeLessThan(140);
      expect(`${card.name} ${card.reading}`).not.toMatch(/[–—]/);
    }
  });
});

describe('tarot card of the day', () => {
  it('opens on The Star on 2026-10-07', () => {
    expect(cardFor(day(2026, 10, 7)).name).toBe('The Star');
  });

  it('stays the same all day and changes at local midnight', () => {
    const today = cardFor(day(2026, 10, 7, 0, 0));
    expect(cardFor(day(2026, 10, 7, 23, 59))).toBe(today);
    expect(cardFor(new Date(2026, 9, 7, 23, 59, 59, 999))).toBe(today);
    expect(cardFor(day(2026, 10, 8, 0, 0))).not.toBe(today);
  });

  it('never repeats on consecutive days across a full year, and uses every card', () => {
    const seen = new Set<string>();
    let date = day(2026, 1, 1);
    for (let i = 0; i < 400; i += 1) {
      const next = nextDay(date);
      expect(cardFor(next).name).not.toBe(cardFor(date).name);
      seen.add(cardFor(date).name);
      date = next;
    }
    expect(seen.size).toBe(22);
  });

  it('changes across month, year and leap-day boundaries', () => {
    for (const [a, b] of [[day(2026, 10, 31), day(2026, 11, 1)], [day(2026, 12, 31), day(2027, 1, 1)], [day(2028, 2, 28), day(2028, 2, 29)], [day(2028, 2, 29), day(2028, 3, 1)]]) {
      expect(cardFor(b!)).not.toBe(cardFor(a!));
      expect(localDayNumber(b!) - localDayNumber(a!)).toBe(1);
    }
  });

  it.each(['Europe/London', 'America/New_York', 'Australia/Sydney'])('counts DST change days as one day each in %s', (zone) => {
    inZone(zone, () => {
      // Spring and autumn changes for each zone fall inside these windows.
      for (const [y, m] of [[2026, 3], [2026, 4], [2026, 10], [2026, 11]] as const) {
        for (let d = 1; d <= 28; d += 1) {
          const start = day(y, m, d, 0, 0);
          const end = new Date(y, m - 1, d, 23, 59, 59);
          expect(cardFor(end)).toBe(cardFor(start));
          expect(localDayNumber(day(y, m, d + 1, 0, 0)) - localDayNumber(start)).toBe(1);
          expect(cardFor(day(y, m, d + 1, 0, 0))).not.toBe(cardFor(start));
        }
      }
    });
  });
});

describe('daily tick', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('applies today at once, then only when the local day changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(day(2026, 10, 7, 23, 58));
    const seen: number[] = [];
    const stop = everyDay((d) => seen.push(d));
    expect(seen).toEqual([localDayNumber(day(2026, 10, 7))]);
    vi.advanceTimersByTime(60_000);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(2 * 60_000);
    expect(seen).toEqual([localDayNumber(day(2026, 10, 7)), localDayNumber(day(2026, 10, 8))]);
    stop();
    vi.advanceTimersByTime(3 * 86_400_000);
    expect(seen).toHaveLength(2);
  });
});

describe('tarot room scene', () => {
  it('draws every card face as its own variant group, numeral and emblem', () => {
    const { back } = svg('tarot');
    const groups = [...back.matchAll(/<g class="scene-variant" data-variant="(\d+)">(.*?)<\/g>/g)];
    expect(groups.map((g) => g[1])).toEqual(DECK.map((card) => String(card.number)));
    for (const [, , cells] of groups) expect((cells?.match(/<rect /g) ?? []).length).toBeGreaterThan(12);
  });

  it('gives every card a different emblem', () => {
    const { back } = svg('tarot');
    // Emblem rows only (below the numeral), so the numerals can't make two faces differ.
    const emblems = [...back.matchAll(/data-variant="\d+">(.*?)<\/g>/g)]
      .map((g) => [...(g[1] ?? '').matchAll(/<rect x="(\d+)" y="(\d+)"[^>]*class="([\w-]+)"/g)].filter((r) => Number(r[2]) >= 17).map((r) => r.slice(1).join()).join(';'));
    expect(new Set(emblems).size).toBe(22);
  });
});
