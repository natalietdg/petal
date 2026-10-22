// @vitest-environment jsdom
// Pins the reader's markdown output so the incremental-render work cannot change what a reply looks like.
import { describe, expect, it } from 'vitest';
import { render } from '../../src/renderer/markdown';

const STORY = [
  '**The reader now redraws only the reply that changed.**',
  '',
  'Older replies keep their rendered nodes, so streaming stays smooth.',
  '',
  '**Checked:** reader.ts, `npx vitest run`',
  '',
  'Doing: caching each rendered reply',
  'Recommend: ship it behind nothing, it is invisible',
  'Next: run the full gate',
  '',
  'This opening paragraph is long enough to carry a drop cap, because it wraps across more than two lines of the column and so the cap has somewhere to hang without dangling below the text.',
  '',
  '## 1. What changed',
  '',
  'A ==highlighted== phrase and a bare link https://example.com/some/very/long/path/to/a/page.',
  '',
  '**Decide:** keep the cache per window.',
  '',
  '- **Watch out:** a theme switch still redraws everything.',
  '',
  '> **Assumed**',
  '> - mermaid output is stable per theme',
  '',
  '> One striking line as a pull quote.',
  '',
  'Raw <b>html</b> shows as text.',
  '',
  'A closing paragraph inside the story.',
  '',
  '## Steps',
  '',
  '1. Open the reader',
  '   Check: it shows the newest reply',
  '2. Scroll up',
  '',
  'Check: older turns are there',
  '',
  '## Open threads',
  '',
  '- Should History index transcripts? Check: search finds a prompt word',
  '',
  '## References',
  '',
  '- marked docs',
].join('\n');

describe('markdown.render: pinned output', () => {
  it('renders a full magazine reply unchanged', () => {
    expect(render(STORY).outerHTML).toMatchSnapshot();
  });

  it('renders the folded reply unchanged', () => {
    expect(render(STORY, { fold: 'pin-folded' }).outerHTML).toMatchSnapshot();
  });

  it('renders plain prose with no sections unchanged', () => {
    expect(render('Just a short answer with `code` and **bold**.').outerHTML).toMatchSnapshot();
  });
});

describe('markdown.render: parts', () => {
  const root = render(STORY);

  it('turns a Doing / Recommend / Next run into one status block', () => {
    const rows = [...root.querySelectorAll('.status-block .status-row')];
    expect(rows.map((row) => row.className)).toEqual(['status-row status-doing', 'status-row status-recommend', 'status-row status-next']);
    expect(rows.map((row) => row.querySelector('.status-chip')?.textContent)).toEqual(['Doing', 'Recommend', 'Next']);
  });

  it('tags the Checked line and moves it under the dek', () => {
    const checked = root.querySelector('header.story-head > p.checked-line');
    expect(checked?.querySelector('.checked-label')?.textContent).toBe('Checked');
  });

  it('tints an Assumed sidebar and keeps other quotes as pull quotes', () => {
    expect(root.querySelector('blockquote.sidebar.assumed')).not.toBeNull();
    expect(root.querySelector('blockquote.pull-quote')?.textContent?.trim()).toBe('One striking line as a pull quote.');
  });

  it('turns a leading label into a callout pill', () => {
    expect(root.querySelector('p.callout-decide > .pill')?.textContent).toBe('Decide');
    expect(root.querySelector('li.callout-watch > .pill')?.textContent).toBe('Watch out');
  });

  it('turns ==text== into a highlighter mark', () => {
    expect(root.querySelector('mark')?.textContent).toBe('highlighted');
  });

  it('marks References and Open threads as back matter', () => {
    const back = [...root.querySelectorAll('h2.back-matter')].map((h) => h.textContent);
    expect(back).toEqual(['Open threads', 'References']);
    expect(root.querySelector('h2.threads-heading')?.textContent).toBe('Open threads');
  });

  it('shows raw HTML as text', () => {
    expect(root.querySelector('b')).toBeNull();
    expect(root.textContent).toContain('Raw <b>html</b> shows as text.');
  });

  it('gives the headline, lede and end mark their classes', () => {
    expect(root.querySelector('.headline')?.textContent).toBe('The reader now redraws only the reply that changed.');
    expect(root.querySelector('.lede')?.textContent).toMatch(/^This opening paragraph/);
    expect(root.querySelector('.end-mark')?.textContent).toBe('Check: older turns are there'); // last plain paragraph before back matter
  });
});

describe('fold and steps', () => {
  it('folds sections behind a toggle and lifts the status block under the abstract', () => {
    const root = render(STORY, { fold: 'parts-folded' });
    expect(root.querySelector('.fold-bar > .fold-all')?.textContent).toBe('Expand all');
    expect(root.querySelector('header.story-head + .status-block, header.story-head ~ .status-block')).not.toBeNull();
    const sections = [...root.querySelectorAll(':scope > .story-section')];
    expect(sections.map((s) => s.classList.contains('folded'))).toEqual([true, false, false, true]);
  });

  it('opens a folded section when its heading is clicked and remembers it for the same key', () => {
    const first = render(STORY, { fold: 'remembered' });
    first.querySelector<HTMLElement>('.story-section h2')?.click();
    expect(first.querySelector('.story-section')?.classList.contains('folded')).toBe(false);
    const again = render(STORY, { fold: 'remembered' });
    expect(again.querySelector('.story-section')?.classList.contains('folded')).toBe(false);
  });

  it('builds step rows with badges and Check lines, and ticks survive a redraw', () => {
    const root = render(STORY, { fold: 'steps-key' });
    const steps = [...root.querySelectorAll('.steps-section ol.steps > li.step')];
    expect(steps).toHaveLength(2);
    expect(steps[0]?.querySelector('.step-check')?.textContent).toBe('Check it shows the newest reply');
    expect(steps[1]?.querySelector('.step-check')?.textContent).toBe('Check older turns are there');
    const badge = steps[0]?.querySelector<HTMLButtonElement>('.step-badge');
    badge?.click();
    expect(badge?.textContent).toBe('✓');
    const redrawn = render(STORY, { fold: 'steps-key' });
    expect(redrawn.querySelector('.step-badge')?.getAttribute('aria-pressed')).toBe('true');
  });
});
