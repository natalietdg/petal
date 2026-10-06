// The scene contract and the shared shape kit. Scene files import from here, scenes.ts collects them.

// A cell is painted with a class letter (see .sc-* in cat.css and the scene CSS), or null for empty.
export type CellClass = string;
export type Shape = (x: number, y: number) => CellClass | null;
export type Mask = (x: number, y: number) => unknown;
export type Cell = readonly [x: number, y: number, cell: CellClass];

export interface Scene {
  name: string;
  // Canvas in sprite pixels: [width, height].
  size: readonly [number, number];
  paint: Shape;
  // Cells in their own group so a scene can animate just those.
  moving: readonly Cell[];
  // Cells drawn in front of the cat instead of behind her.
  front?: (x: number, y: number) => boolean;
  // The beach crab, which walks on its own.
  crab?: readonly Cell[];
}

export type Segment = readonly [x1: number, y1: number, x2: number, y2: number];

export const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const inCircle = (x: number, y: number, cx: number, cy: number, r: number): boolean => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
export const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

// Every cell touching the shape (4-way) that it doesn't paint becomes `edge`.
// An optional `mask` sets the silhouette instead, so cut-outs inside it (leaf splits) stay see-through.
export const outlined = (shape: Shape, edge: CellClass, mask: Mask = shape): Shape => (x, y) => shape(x, y)
  ?? (!mask(x, y) && NEIGHBOURS.some(([dx, dy]) => mask(x + dx, y + dy)) ? edge : null);

// Smooths a yes/no mask: drops one-pixel nubs, fills one-pixel notches.
export const tidy = (inside: (x: number, y: number) => boolean) => (x: number, y: number): boolean => {
  const touching = NEIGHBOURS.filter(([dx, dy]) => inside(x + dx, y + dy)).length;
  return inside(x, y) ? touching >= 2 : touching >= 3;
};

// A hand-drawn bitmap at (left, top) as a shape; '.' is see-through.
export const stamp = (left: number, top: number, rows: readonly string[], legend: Record<string, CellClass>): Shape => (x, y) => {
  const ch = rows[y - top]?.[x - left];
  return ch && ch !== '.' ? legend[ch] ?? null : null;
};

// A shape's cells inside a box, for groups that animate (moving, crab).
export function cellsOf(shape: Shape, x1: number, y1: number, x2: number, y2: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const c = shape(x, y);
      if (c) cells.push([x, y, c]);
    }
  }
  return cells;
}

// Front to back: the first shape that paints a cell wins.
export const layers = (...shapes: Shape[]): Shape => (x, y) => {
  for (const s of shapes) {
    const c = s(x, y);
    if (c) return c;
  }
  return null;
};

export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function onSegments(x: number, y: number, segments: readonly Segment[]): boolean {
  return segments.some(([x1, y1, x2, y2]) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i += 1) {
      if (Math.round(x1 + ((x2 - x1) * i) / steps) === x && Math.round(y1 + ((y2 - y1) * i) / steps) === y) return true;
    }
    return false;
  });
}
