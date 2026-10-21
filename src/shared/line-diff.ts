// A line diff for code review cards and the reviewer's prompt: exact LCS for function-sized text, trimmed ends otherwise.

export type DiffOp = ' ' | '+' | '-';
export interface DiffLine { op: DiffOp; text: string }
export type DiffRow = DiffLine | { op: 'gap'; count: number };

const MAX_CELLS = 2_000_000; // LCS table size; bigger pairs fall back to one changed block

const splitLines = (text: string): string[] => (text ? text.replace(/\n$/, '').split('\n') : []);

// The shared head and tail, then the middle as one removed block and one added block.
function trimmedDiff(a: string[], b: string[]): DiffLine[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  return [
    ...a.slice(0, head).map((text) => ({ op: ' ' as const, text })),
    ...a.slice(head, a.length - tail).map((text) => ({ op: '-' as const, text })),
    ...b.slice(head, b.length - tail).map((text) => ({ op: '+' as const, text })),
    ...a.slice(a.length - tail).map((text) => ({ op: ' ' as const, text })),
  ];
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width); // table[i][j]: LCS length of a[i..] and b[j..]
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: ' ', text: a[i] }); i += 1; j += 1; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { out.push({ op: '-', text: a[i] }); i += 1; }
    else { out.push({ op: '+', text: b[j] }); j += 1; }
  }
  while (i < a.length) out.push({ op: '-', text: a[i++] });
  while (j < b.length) out.push({ op: '+', text: b[j++] });
  return out;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  return (a.length + 1) * (b.length + 1) > MAX_CELLS ? trimmedDiff(a, b) : lcsDiff(a, b);
}

// Changed lines with `context` unchanged lines around them; longer unchanged runs become one gap row.
export function compactDiff(lines: readonly DiffLine[], context = 2): DiffRow[] {
  const near = lines.map(() => false);
  lines.forEach((line, i) => {
    if (line.op === ' ') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k += 1) near[k] = true;
  });
  const rows: DiffRow[] = [];
  let gap = 0;
  lines.forEach((line, i) => {
    if (near[i]) {
      if (gap) rows.push({ op: 'gap', count: gap });
      gap = 0;
      rows.push(line);
    } else gap += 1;
  });
  if (gap) rows.push({ op: 'gap', count: gap });
  return rows;
}

// Unified-style text for the reviewer, capped at maxLines rows.
export function diffText(before: string, after: string, maxLines = 160): string {
  const rows = compactDiff(diffLines(before, after), 3);
  const text = rows.map((row) => (row.op === 'gap' ? `@@ ${row.count} unchanged lines @@` : `${row.op}${row.text}`));
  return text.length > maxLines ? [...text.slice(0, maxLines), `@@ ${text.length - maxLines} more lines cut @@`].join('\n') : text.join('\n');
}
