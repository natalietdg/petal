// Every markdown shape the reader treats specially, with a tiny example and the elements it must render to.
// Pure data: the shape guide in Customize renders it, test/shape-guide.test.ts checks it covers the renderer, the snapshot checks each preview.

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
  { id: 'section', name: 'Section', use: 'One part of the story. Each folds under its heading.', markdown: '## What changed\n\nThe prompt moved; the parser did not.', expects: ['section.story-section.folded', 'h2.foldable', '.fold-toggle', '.fold-bar .fold-all', '.section-body'] },
  { id: 'numbered', name: 'Numbered section', use: 'Research-paper parts; a look may swap in its own numbering.', markdown: '## 1. Method\n\nOne paragraph.', expects: ['h2 .h-num'] },
  { id: 'steps', name: 'Steps', use: 'Things to do in order, with how to tell each worked. Badges tick off.', markdown: '## Steps\n\n1. Run `npm test`\n   Check: it passes', expects: ['section.steps-section', 'ol.steps > li.step', '.step-badge', '.step-body', '.step-check', '.step-check-label'] },
  { id: 'sidebar', name: 'Sidebar', use: 'Facts, checks and numbers at a glance.', markdown: '> **At a glance**\n> - Interval 1–240 minutes', expects: ['blockquote.sidebar'] },
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
  { id: 'back-matter', name: 'Sources and references', use: 'Files and links touched, as quiet back matter. Also References, Limitations.', markdown: '## Sources\n\n- `src/main/session-organizer.ts`', expects: ['section.story-section.back > h2.back-matter'] },
  { id: 'end-mark', name: 'End mark', use: "Nothing to write: the story's last paragraph gets it.", markdown: 'That is the whole story.', expects: ['p.end-mark'] },
  { id: 'html', name: 'HTML tags', use: 'Never rendered: a tag shows as plain text.', markdown: 'Line one<br>still line one.', expects: ['p'], shows: '<br>', absent: ['br'] },
];
