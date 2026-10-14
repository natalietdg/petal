// The factory's progress line a reply carries after Doing / Recommend / Next: "**Station:** 3/7 Build · met".

export type PassState = 'met' | 'not yet';

export interface StationProgress {
  index: number; // 1-based
  total: number;
  name: string;
  state: PassState | null; // null when the line leaves the pass check out
}

// Label as in status-lines.ts, then "n/N Name", then an optional "· met" or "· not yet", then an optional period.
const LINE = /^\s*(?:\*\*|__)?station(?:\s*:\s*(?:\*\*|__)|(?:\*\*|__)\s*:|\s*:)\s*(\d{1,3})\s*\/\s*(\d{1,3})\s+([^·•]*?[^\s·•.])\s*(?:[·•]\s*(met|not\s+yet)\s*)?\.?\s*$/i;
const FENCE = /^\s*(```|~~~)/;

// Null for anything malformed (n above N, zero, a state other than met / not yet); the line then stays in the body as text.
export function parseStationLine(line: string): StationProgress | null {
  const match = LINE.exec(line);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (index < 1 || index > total) return null;
  const state = match[4] ? (match[4].toLowerCase().replace(/\s+/, ' ') as PassState) : null;
  return { index, total, name: match[3].replace(/\*\*|__|`/g, ''), state };
}

// One reply's station line, outside code fences; the first one wins.
export function parseStation(markdown: string): StationProgress | null {
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced) continue;
    const station = parseStationLine(line);
    if (station) return station;
  }
  return null;
}

export const stationCaption = (s: StationProgress): string => `${s.name} · ${s.index}/${s.total}`;

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// N segments: earlier stations filled, the current one filled when met and outlined when not yet.
export function stationBarHtml(s: StationProgress): string {
  const segments = Array.from({ length: s.total }, (_, i) => {
    const step = i + 1;
    const kind = step < s.index ? 'done' : step === s.index ? `current ${s.state === 'met' ? 'met' : 'pending'}` : 'todo';
    return `<span class="station-seg ${kind}"></span>`;
  }).join('');
  const check = s.state ? `, pass check ${s.state}` : '';
  const caption = escapeHtml(stationCaption(s));
  return `<span class="station-progress" role="progressbar" aria-label="Factory station" aria-valuemin="0" aria-valuemax="${s.total}" aria-valuenow="${s.index}" aria-valuetext="Station ${s.index} of ${s.total}, ${escapeHtml(s.name)}${check}">`
    + `<span class="station-segs" aria-hidden="true">${segments}</span><span class="station-caption">${caption}</span></span>`;
}
