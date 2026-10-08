// Every coloured treatment the reader gives reply markdown, with a tiny sample of the markdown that triggers it.
// Pure data: the colour key renders it, and the snapshot check matches each probe against a real reply.

export interface KeyEntry {
  id: string;
  label: string;
  meaning: string;
  markdown: string;
  inSection: boolean; // sampled inside a ## section, where real replies put it (some looks colour it differently there)
  probes: string[]; // elements whose colours must match the same elements in a real reply
}

export const KEY_ENTRIES: readonly KeyEntry[] = [
  { id: 'highlight', label: 'Highlight', meaning: 'the one phrase that matters most', markdown: 'Keep ==this one line== in mind.', inSection: true, probes: ['mark'] },
  { id: 'decide', label: 'Decide', meaning: 'something only you can choose', markdown: '**Decide:** ship today or wait?', inSection: true, probes: ['.callout-decide', '.callout-decide .pill'] },
  { id: 'next', label: 'Next', meaning: 'the one step to take now', markdown: '**Next:** run the tests.', inSection: true, probes: ['.callout-next', '.callout-next .pill'] },
  { id: 'watch', label: 'Watch out', meaning: 'a risk or catch to keep in view', markdown: '**Watch out:** this skips the cache.', inSection: true, probes: ['.callout-watch', '.callout-watch .pill'] },
  { id: 'done', label: 'Done', meaning: 'finished and checked', markdown: '**Done:** tests pass.', inSection: true, probes: ['.callout-done', '.callout-done .pill'] },
  { id: 'why', label: 'Why', meaning: 'the reason behind a call', markdown: '**Why:** it keeps your place.', inSection: true, probes: ['.callout-why', '.callout-why .pill'] },
  { id: 'headline', label: 'Headline', meaning: 'the answer, in one bold line', markdown: '**The answer goes here.**', inSection: false, probes: ['.story-head', '.headline'] },
  { id: 'dek', label: 'Abstract', meaning: 'the short version under the headline', markdown: '**Headline**\n\nThe short version, in a sentence.', inSection: false, probes: ['.headline + p'] },
  { id: 'section', label: 'Section', meaning: 'a new part of the reply', markdown: '## A section\n\nIts text.', inSection: false, probes: ['.story-section:not(.back) > h2'] },
  { id: 'sidebar', label: 'Sidebar', meaning: 'facts at a glance, boxed off', markdown: '> **At a glance**\n> - one fact\n> - another fact', inSection: true, probes: ['blockquote.sidebar', 'blockquote.sidebar > p:first-child > strong:first-child'] },
  { id: 'pull-quote', label: 'Pull quote', meaning: 'one line worth remembering', markdown: '> A line worth remembering.', inSection: true, probes: ['blockquote.pull-quote'] },
  { id: 'link', label: 'Link', meaning: 'opens in your browser', markdown: 'See [the docs](https://example.com).', inSection: true, probes: ['p > a'] },
  { id: 'code', label: 'Code', meaning: 'a name, path or command, exactly as typed', markdown: 'Run `npm test` first.', inSection: true, probes: ['p > code'] },
  { id: 'code-block', label: 'Code block', meaning: 'output or code to copy', markdown: '```\nnpm test\n```', inSection: true, probes: ['pre'] },
  { id: 'table', label: 'Table', meaning: 'facts side by side', markdown: '| Item | State |\n|---|---|\n| Tests | pass |', inSection: true, probes: ['table', 'th', 'td'] },
  { id: 'caption', label: 'Caption', meaning: 'a note on the table or figure above', markdown: '*Table 1. A caption.*', inSection: true, probes: ['p:has(> em:only-child)'] },
  { id: 'sources', label: 'Sources', meaning: 'where the facts came from', markdown: '## Sources\n\n- a reference', inSection: false, probes: ['h2.back-matter', '.story-section.back li'] },
];
