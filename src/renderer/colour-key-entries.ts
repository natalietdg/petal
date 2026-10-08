// The four treatments that carry colour in a reply; everything else is typography only.
// Pure data: the colour key renders it, and the snapshot check matches each probe against a real reply.

export interface KeyEntry {
  id: string;
  label: string;
  meaning: string;
  markdown: string;
  inSection: boolean; // sampled inside a ## section, where real replies usually put it
  probes: string[]; // elements whose colours must match the same elements in a real reply
}

export const KEY_ENTRIES: readonly KeyEntry[] = [
  { id: 'highlight', label: 'Highlight', meaning: 'the one phrase that matters most', markdown: 'Keep ==this one line== in mind.', inSection: true, probes: ['mark'] },
  { id: 'decide', label: 'Decide', meaning: 'something only you can choose', markdown: '**Decide:** ship today or wait?', inSection: true, probes: ['.callout-decide', '.callout-decide .pill'] },
  { id: 'watch', label: 'Watch out', meaning: 'a risk or catch to keep in view', markdown: '**Watch out:** this skips the cache.', inSection: true, probes: ['.callout-watch', '.callout-watch .pill'] },
  { id: 'code', label: 'Code', meaning: 'a name, path or command, exactly as typed', markdown: 'Run `npm test` first.', inSection: true, probes: ['p > code'] },
];

// Everything else in a reply: drawn in the look's ink and paper only (text, muted, rule colours), never an accent.
export const NEUTRAL_PROBES: readonly string[] = [
  '#reader-status',
  '.story-head', '.headline', '.headline + p', '.lede',
  '.story-section:not(.back)', '.story-section:not(.back) > h2',
  '.callout-done', '.callout-done .pill', '.callout-why', '.callout-why .pill', '.callout-next', '.callout-next .pill',
  'blockquote.sidebar', 'blockquote.sidebar > p:first-child > strong:first-child', 'blockquote.pull-quote',
  'p > a', 'pre', 'pre code', 'table', 'th', 'td', 'p:has(> em:only-child)',
  'h2.back-matter', '.story-section.back li', '.end-mark',
];
