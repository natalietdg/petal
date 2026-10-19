// Formatting guide data: every markdown shape the reader treats specially, then the colour labels a reply can carry.
// Pure data: formatting-guide.ts renders it, test/formatting-guide.test.ts checks the shapes cover the renderer, the snapshot checks each preview and colour.

export interface ShapeEntry {
  id: string;
  name: string;
  use: string; // one line: what the shape is for
  markdown: string; // the raw example, 1–3 lines where the shape allows
  expects: string[]; // selectors the rendered preview must contain
  shows?: string; // text the preview must show as typed
  absent?: string[]; // selectors the preview must not contain
}

const LEDE = 'The first paragraph after the dek, once it runs to 160 characters or more, opens with a drop cap. A shorter one starts plainly, so the cap never hangs below the text.';

export const SHAPE_ENTRIES: readonly ShapeEntry[] = [
  { id: 'headline', name: 'Headline and dek', use: 'The answer, then its short version. A long headline steps down a size.', markdown: '**Petal reads the prompt from Customize.**\n\nEdits apply on the next pass.', expects: ['header.story-head', 'p.headline', '.headline + p'] },
  { id: 'lede', name: 'Lede', use: 'The first body paragraph after the dek; 160+ characters gets a drop cap.', markdown: `**Short answer.**\n\nThe dek.\n\n${LEDE}`, expects: ['p.lede'] },
  { id: 'status', name: 'Status lines', use: 'Doing, Recommend, Next. The newest also pins in the strip above the reader.', markdown: '**Doing:** tracing it.\n**Recommend:** keep it.\n**Next:** run it.', expects: ['.status-block', '.status-row.status-doing', '.status-row.status-recommend', '.status-row.status-next', '.status-chip', '.status-text'] },
  { id: 'station', name: 'Station line', use: 'Factory progress: station, total, pass check. Pins as a bar in the strip.', markdown: '**Next:** run it.\n**Station:** 3/7 Build · not yet', expects: ['.status-row.status-station'] },
  { id: 'loop', name: 'Loop line', use: 'Test loop progress: round, total, phase, open bugs. Pins as a bar in the strip.', markdown: '**Next:** fix the coupon cap.\n**Loop:** round 2/5 · fixing · 3 open', expects: ['.status-row.status-loop'] },
  { id: 'task', name: 'Task line', use: 'After Petal gives a task: its title and working, blocked or done. Moves it on the Board.', markdown: '**Next:** wire the form.\n**Task:** Fix the login · working', expects: ['.status-row.status-task'] },
  { id: 'section', name: 'Section', use: 'One part of the story. Each folds under its heading.', markdown: '## What changed\n\nThe prompt moved; the parser did not.', expects: ['section.story-section.folded', 'h2.foldable', '.fold-toggle', '.fold-bar .fold-all', '.section-body'] },
  { id: 'numbered', name: 'Numbered section', use: 'Research-paper parts; a look may swap in its own numbering.', markdown: '## 1. Method\n\nOne paragraph.', expects: ['h2 .h-num'] },
  { id: 'steps', name: 'Steps', use: 'Things to do in order, with how to tell each worked. Badges tick off.', markdown: '## Steps\n\n1. Run `npm test`\n   Check: it passes', expects: ['section.steps-section', 'ol.steps > li.step', '.step-badge', '.step-body', '.step-check', '.step-check-label'] },
  { id: 'checked', name: 'Checked line', use: 'What was actually verified: files, commands, sources. A small line under the dek.', markdown: '**The prompt moved.**\n\nEdits apply next pass.\n\n**Checked:** `src/main/prompts.ts`, `npm test`', expects: ['header.story-head > p.checked-line', '.checked-label'] },
  { id: 'sidebar', name: 'Sidebar', use: 'Facts, checks and numbers at a glance.', markdown: '> **At a glance**\n> - Interval 1–240 minutes', expects: ['blockquote.sidebar'] },
  { id: 'assumed', name: 'Assumed', use: 'Anything taken on trust, in a sidebar tinted apart from the facts.', markdown: '> **Assumed**\n> - The staging key is current', expects: ['blockquote.sidebar.assumed'] },
  { id: 'pull-quote', name: 'Pull quote', use: 'The one line to remember.', markdown: "> A custom prompt can't break the parser.", expects: ['blockquote.pull-quote'] },
  { id: 'watch', name: 'Watch out', use: 'A real risk, inside the section it belongs to.', markdown: '**Watch out:** this skips the cache.', expects: ['p.callout.callout-watch', '.callout-watch > .pill'] },
  { id: 'decide', name: 'Decide', use: 'Something only you can choose, last and on its own line.', markdown: '**Decide:** ship today or wait?', expects: ['p.callout.callout-decide', '.callout-decide > .pill'] },
  { id: 'labels', name: 'Done, Why, Next labels', use: 'Quiet labelled notes. Next as its own line is a status line instead.', markdown: '**Done:** tests pass.\n\n**Why:** the cache was stale.\n\n- **Next:** run it again.', expects: ['p.callout-done > .pill', 'p.callout-why > .pill', 'li.callout-next > .pill'] },
  { id: 'highlight', name: 'Highlight', use: 'The single most important phrase.', markdown: 'Keep ==this one line== in mind.', expects: ['mark'] },
  { id: 'code', name: 'Inline code', use: 'Every file, command, flag and identifier, exactly as typed.', markdown: 'Run `npm test` first.', expects: ['p > code'] },
  { id: 'links', name: 'Links', use: 'A named link keeps its words; a bare URL shows a short label.', markdown: 'See [the PR](https://github.com/acme/petal/pull/12) or https://github.com/acme/petal/pull/12', expects: ['a[href]:not(.bare-link)', 'a.bare-link[title]'] },
  { id: 'table', name: 'Table and caption', use: 'Parallel facts side by side; an italic line under it is the caption.', markdown: '| Setting | Default |\n|---|---|\n| Model | haiku |\n\n*Table 1. Organizer defaults.*', expects: ['table th', 'table td', 'table + p > em:only-child'] },
  { id: 'code-block', name: 'Code block', use: 'Code, logs and traces, as typed.', markdown: '```\nnpm test -- --run\n```', expects: ['pre > code'] },
  { id: 'figure', name: 'Figure and caption', use: 'A mermaid diagram when three or more parts relate.', markdown: '```mermaid\nflowchart LR\n  A[Prompt] --> B[Reply]\n```\n\n*Figure 1. One turn.*', expects: ['figure.diagram svg', 'figure.diagram + p > em:only-child'] },
  { id: 'open-threads', name: 'Open threads', use: 'Questions left open, each with its check. Click a card to ask it next.', markdown: '## Open threads\n\n- Does the cache expire? *Check: read `cache.ts`.*', expects: ['section.threads-section', 'h2.threads-heading', 'ul.threads > li.thread', 'button.thread-card', '.thread-question', '.thread-check', '.thread-check-label', '.thread-ask'] },
  { id: 'back-matter', name: 'Sources and references', use: 'Files and links touched, as quiet back matter. Also References, Limitations.', markdown: '## Sources\n\n- `src/main/session-organizer.ts`', expects: ['section.story-section.back > h2.back-matter'] },
  { id: 'end-mark', name: 'End mark', use: "Nothing to write: the story's last paragraph gets it.", markdown: 'That is the whole story.', expects: ['p.end-mark'] },
  { id: 'html', name: 'HTML tags', use: 'Never rendered: a tag shows as plain text.', markdown: 'Line one<br>still line one.', expects: ['p'], shows: '<br>', absent: ['br'] },
];

// A colour label: what the colour means, and a live sample whose colours the snapshot matches against a real reply.
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

// A colour label samples its shape's own example, so the two halves of the guide never drift apart.
const shapeMarkdown = (id: string): string => SHAPE_ENTRIES.find((entry) => entry.id === id)?.markdown ?? '';

// The four treatments that carry colour in every look.
export const KEY_ENTRIES: readonly KeyEntry[] = [
  { id: 'highlight', label: 'Highlight', meaning: 'the one phrase that matters most', markdown: shapeMarkdown('highlight'), inSection: true, probes: ['mark'] },
  { id: 'decide', label: 'Decide', meaning: "something only you can choose, like Claude's questions", markdown: shapeMarkdown('decide'), inSection: true, probes: ['.callout-decide', '.callout-decide .pill'] },
  { id: 'watch', label: 'Watch out', meaning: 'a risk or catch to keep in view', markdown: shapeMarkdown('watch'), inSection: true, probes: ['.callout-watch', '.callout-watch .pill'] },
  { id: 'code', label: 'Code', meaning: 'a name, path or command, exactly as typed', markdown: shapeMarkdown('code'), inSection: true, probes: ['p > code'] },
];

// Lifestyle only: the colour blocks it keeps, listed under "In this look".
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
