// The four treatments that carry colour in every look, plus the extra colour Lifestyle keeps.
// Pure data: the colour key renders it, and the snapshot check matches each probe against a real reply.

export interface KeyEntry {
  id: string;
  label: string;
  meaning: string;
  markdown: string;
  inSection: boolean; // sampled inside a ## section, where real replies usually put it
  probes: string[]; // elements whose colours must match the same elements in a real reply
  kicker?: boolean; // sampled as the reader's kicker line, not as markdown
  keepEnd?: boolean; // keeps the end mark the renderer adds to the last paragraph
  real?: { scope: string; pick: 'first' | 'last' }; // where the real reply's match lives (default: last in #latest)
}

export const KEY_ENTRIES: readonly KeyEntry[] = [
  { id: 'highlight', label: 'Highlight', meaning: 'the one phrase that matters most', markdown: 'Keep ==this one line== in mind.', inSection: true, probes: ['mark'] },
  { id: 'decide', label: 'Decide', meaning: "something only you can choose, like Claude's questions", markdown: '**Decide:** ship today or wait?', inSection: true, probes: ['.callout-decide', '.callout-decide .pill'] },
  { id: 'watch', label: 'Watch out', meaning: 'a risk or catch to keep in view', markdown: '**Watch out:** this skips the cache.', inSection: true, probes: ['.callout-watch', '.callout-watch .pill'] },
  { id: 'code', label: 'Code', meaning: 'a name, path or command, exactly as typed', markdown: 'Run `npm test` first.', inSection: true, probes: ['p > code'] },
];

// Lifestyle only: the colour blocks it keeps, listed in the key under "In this look".
export const LIFESTYLE_ENTRIES: readonly KeyEntry[] = [
  { id: 'kicker', label: 'Kicker', meaning: 'when the reply arrived', markdown: '', inSection: false, kicker: true, probes: ['.status'], real: { scope: '#replies-view', pick: 'last' } },
  { id: 'hero', label: 'Headline block', meaning: 'the answer and its short version, on a coloured hero', markdown: '**The answer goes here.**\n\nThe short version.', inSection: false, probes: ['.story-head', '.headline', '.headline + p'] },
  { id: 'status', label: 'Status lines', meaning: 'what Claude is doing, recommends, and does next', markdown: '**Doing:** tracing it.\n**Recommend:** keep it.\n**Next:** run it.', inSection: false, probes: ['.status-block', '.status-doing .status-chip', '.status-recommend .status-chip', '.status-next .status-chip'] },
  { id: 'section', label: 'Section card', meaning: 'each part of the reply on its own soft colour', markdown: '## A section\n\nIts text.', inSection: false, probes: ['.story-section:not(.back)', '.story-section:not(.back) > h2'], real: { scope: '#latest', pick: 'first' } },
  { id: 'sidebar', label: 'Sidebar', meaning: 'facts at a glance, boxed off', markdown: '> **At a glance**\n> - one fact', inSection: true, probes: ['blockquote.sidebar'] },
  { id: 'pull-quote', label: 'Pull quote', meaning: 'one line worth remembering', markdown: '> A line worth remembering.', inSection: true, probes: ['blockquote.pull-quote'] },
  { id: 'table', label: 'Table', meaning: 'facts side by side, in one box', markdown: '| Item | State |\n|---|---|\n| Tests | pass |', inSection: true, probes: ['table', 'th', 'td'] },
  { id: 'end', label: 'End mark', meaning: 'the end of the story', markdown: 'That is the whole story.', inSection: true, keepEnd: true, probes: ['.end-mark'] },
];

// Lifestyle's restored colours, as they were before the four-colour cut: [selector, pseudo, property, token].
export const LIFESTYLE_EXPECT: readonly [string, string | null, string, string][] = [
  ['#reader-status', null, 'backgroundColor', '--why-pill'], ['#reader-status', null, 'color', '--why-ink'],
  ['#latest .story-head', null, 'backgroundColor', '--why-wash'],
  ['#latest .story-section:not(.back)', null, 'backgroundColor', '--done-wash'],
  ['#latest .story-section:not(.back) ~ .story-section:not(.back)', null, 'backgroundColor', '--next-wash'],
  ['#latest .story-section:not(.back) > h2', '::before', 'backgroundColor', '--link'],
  ['#latest blockquote.sidebar', null, 'backgroundColor', '--reader-bg'],
  ['#latest blockquote.pull-quote', null, 'color', '--link'], ['#latest blockquote.pull-quote', null, 'borderLeftColor', '--link'],
  ['#latest table', null, 'backgroundColor', '--reader-bg'],
  ['#latest .end-mark', '::after', 'backgroundColor', '--link'],
  ['#latest .status-block', null, 'backgroundColor', '--code-bg'],
  ['#latest .status-doing .status-chip', null, 'backgroundColor', '--why-pill'], ['#latest .status-doing .status-chip', null, 'color', '--why-ink'],
  ['#latest .status-recommend .status-chip', null, 'backgroundColor', '--done-pill'], ['#latest .status-recommend .status-chip', null, 'color', '--done-ink'],
  ['#latest .status-next .status-chip', null, 'backgroundColor', '--next-pill'], ['#latest .status-next .status-chip', null, 'color', '--next-ink'],
];

// Everything else in a reply (Newspaper, Editorial, Print): drawn in the look's ink and paper only (text, muted, rule colours), never an accent.
export const NEUTRAL_PROBES: readonly string[] = [
  '#reader-status', '.reader-you', '.prompt-pasted', '.prompt-pasted-label', '.prompt-typed', '#reader-head .status-strip .status-chip', '#reader-head .status-strip .status-text',
  '.status-block', '.status-chip', '.status-text',
  '.story-head', '.headline', '.headline + p', '.lede',
  '.story-section:not(.back)', '.story-section:not(.back) > h2',
  '.callout-done', '.callout-done .pill', '.callout-why', '.callout-why .pill', '.callout-next', '.callout-next .pill',
  'blockquote.sidebar', 'blockquote.sidebar > p:first-child > strong:first-child', 'blockquote.pull-quote',
  'p > a', 'pre', 'pre code', 'table', 'th', 'td', 'p:has(> em:only-child)',
  'h2.back-matter', '.story-section.back li', '.end-mark',
];

// Claude's question card wears Decide's colours and nothing else.
export const DECIDE_PROBES: readonly string[] = [
  '.question-card', '.qc-chip', '.qc-text', '.qc-option', '.qc-label', '.qc-desc', '.qc-other-input', '.qc-send',
];
