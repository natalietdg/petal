// Reader steps: in every look, a reply's ## Steps section starts open while other sections fold, each step is a row
// with a numbered badge and its Check line muted underneath, a badge click ticks it and a redraw keeps the tick,
// a plain numbered list elsewhere is unchanged, and nothing runs off the side at 800px. Earlier turns and History too.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { addStatusFixture, FIXTURE_STATUS } from './snapshot-history-fixture';
import { READING_CHOICES } from '../main/menu';

const LONG_PATH = '/Users/you/Code/side-projects/pastel-reader-steps/src/renderer/some/deeply/nested/folder/with/a/very-long-file-name.ts';

// Check lines in each form she might get: under the action, a blank line apart, a sub-item, and outside the list.
const SECTIONED = [
  '**Steps now read as a checklist.**',
  '',
  '**Abstract.** Anything to do in order sits under ## Steps, one action per numbered row, ticked off as you go.',
  '',
  '## 1. What changed',
  '',
  'Plain numbered lists elsewhere stay plain:',
  '',
  '1. A first plain item',
  '2. A second plain item',
  '',
  '## 2. Steps',
  '',
  '1. Open a reply that has a Steps section.',
  '   Check: the Steps section is already open.',
  '2. Click the first badge.',
  '',
  '   **Check:** it turns into a tick.',
  '3. Run `npm test` in the worktree.',
  '   - Check: vitest passes.',
  '4. Open the file at ' + LONG_PATH + ' and save it.',
  '',
  'Check: the window reloads.',
  '',
  '## References',
  '',
  '- `src/renderer/steps.ts`',
  '',
  '**Doing:** rendering Steps as rows.',
  '**Recommend:** tick as you go.',
  '**Next:** open a reply with steps.',
].join('\n');

// The same reply after one more step streamed in.
const STREAMED = SECTIONED.replace('\n\nCheck: the window reloads.', '\n\nCheck: the window reloads.\n\n5. Arrived mid-stream.');

const OLDER = '**Earlier turn.**\n\nIts own summary.\n\n## Detail\n\nFolded.\n\n## Steps to try it\n\n1. Do one thing.\n2. Do another.';

const updateOf = (look: string, latest: string) => ({
  state: 'live',
  replies: [
    { id: `steps-new-${look}`, timestamp: '2026-10-09T10:30:00.000Z', prompt: 'make it step by step where relevant', markdown: latest },
    { id: `steps-old-${look}`, timestamp: '2026-10-09T10:12:00.000Z', prompt: 'earlier', markdown: OLDER },
  ],
});

// Fold state, step rows, Check lines and overflow of one rendered reply.
const PROBE = (root: string) => `(() => {
  const prose = document.querySelector(${JSON.stringify(`${root} .prose`)});
  if (!prose) return null;
  const shown = (el) => Boolean(el) && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const sections = [...prose.querySelectorAll(':scope > .story-section')];
  const stepsSection = prose.querySelector(':scope > .story-section.steps-section');
  const rows = [...prose.querySelectorAll('ol.steps > li.step')];
  const muted = (() => { const s = document.createElement('span'); s.style.color = 'var(--muted)'; prose.append(s); const c = getComputedStyle(s).color; s.remove(); return c; })();
  const plain = prose.querySelector('.story-section:not(.steps-section) ol');
  const proseBox = prose.getBoundingClientRect();
  const reader = document.getElementById('reader');
  return {
    sections: sections.length,
    steps: sections.map((s) => s.classList.contains('steps-section')),
    folded: sections.map((s) => s.classList.contains('folded')),
    stepsShown: rows.length > 0 && rows.every(shown),
    lists: stepsSection ? stepsSection.querySelectorAll('ol.steps').length : 0,
    badges: rows.map((r) => r.querySelector(':scope > button.step-badge[type=button]')?.textContent ?? null),
    pressed: rows.map((r) => r.querySelector(':scope > .step-badge')?.getAttribute('aria-pressed')),
    done: rows.map((r) => r.classList.contains('done')),
    strike: rows.map((r) => getComputedStyle(r.querySelector(':scope > .step-body')).textDecorationLine),
    checks: rows.map((r) => {
      const check = r.querySelector(':scope > .step-check');
      if (!check) return null;
      const body = r.querySelector(':scope > .step-body').getBoundingClientRect();
      const box = check.getBoundingClientRect();
      return { text: check.textContent.trim(), below: box.top >= body.bottom - 1, tight: box.top - body.bottom < 14, muted: getComputedStyle(check).color === muted, indented: box.left >= body.left - 1 };
    }),
    leftoverChecks: [...(stepsSection?.querySelectorAll('.section-body > p') ?? [])].filter((p) => /^\\s*check\\s*:/i.test(p.textContent)).length,
    plain: plain ? { steps: plain.classList.contains('steps'), items: plain.children.length, rows: plain.querySelectorAll('.step, .step-badge').length, marker: getComputedStyle(plain).listStyleType, display: getComputedStyle(plain.firstElementChild).display } : null,
    overflow: {
      reader: reader ? reader.scrollWidth - reader.clientWidth : null,
      rows: rows.filter((r) => r.getBoundingClientRect().right > proseBox.right + 1 || r.scrollWidth > r.clientWidth + 1).length,
    },
    allLabel: prose.querySelector('.fold-all')?.textContent ?? null,
  };
})()`;

const click = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.click()`;

export async function readerStepsCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} reader steps: ${what}`);
  const probe = (root: string) => js(PROBE(root));
  // The fixture feed can redraw its own reply: send ours and wait until #latest shows it.
  const show = async (look: string, markdown: string) => {
    await js(`PastelTerm.reader.update(${JSON.stringify(updateOf(look, markdown))})`);
    return waitFor(async () => (await js(`document.getElementById('latest').dataset.replyId === ${JSON.stringify(`steps-new-${look}`)}`)) || null, 5000);
  };
  const captureSteps = async (look: string, markdown: string, name: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await show(look, markdown);
      await js(`(() => { const r = document.getElementById('reader'); r.scrollTop += document.querySelector('#latest .story-head').getBoundingClientRect().top - r.getBoundingClientRect().top - 16; })()`);
      await wait(300);
      await capture(name);
      if (await js(`document.getElementById('latest').dataset.replyId === ${JSON.stringify(`steps-new-${look}`)}`)) return;
    }
    log(`FAIL reader steps: ${name} kept losing the reply to a feed redraw`);
  };
  const stepsOnlyOpen = (p: { steps: boolean[]; folded: boolean[] }) => p.steps.every((isSteps, i) => p.folded[i] === !isSteps);

  await js('PastelTerm.welcome.close()'); // a fresh profile opens on the welcome screen, over the reader
  await js("PastelTerm.reader.setView('replies')");
  const [startWidth, startHeight] = win.getContentSize();
  resizeOffscreen(win, 800, 2000); // the narrow width she reads at; tall enough for a whole reply
  try {
    for (const [look] of READING_CHOICES) {
      await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
      await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
      check(await show(look, SECTIONED), `${look} reply with steps shown`);
      await wait(300);

      const start = await probe('#latest');
      check(start?.sections === 3 && start.steps.join() === 'false,true,false' && stepsOnlyOpen(start) && start.stepsShown && start.allLabel === 'Expand all',
        `${look} Steps open, other sections folded: ${JSON.stringify({ steps: start?.steps, folded: start?.folded, label: start?.allLabel })}`);
      check(start?.lists === 1 && start.badges.join() === '1,2,3,4' && start.pressed.every((p: string) => p === 'false'),
        `${look} four step rows, badges 1-4: ${JSON.stringify(start?.badges)}`);
      const checks = start?.checks ?? [];
      check(checks.length === 4 && checks.every((c: { below: boolean; tight: boolean; muted: boolean; indented: boolean } | null) => c && c.below && c.tight && c.muted && c.indented) && start?.leftoverChecks === 0,
        `${look} each step's Check line muted, right under it: ${JSON.stringify(checks)}`);
      check(/^Check the Steps section is already open\.$/.test(checks[0]?.text ?? '') && /^Check it turns into a tick\.$/.test(checks[1]?.text ?? ''),
        `${look} the Check label is a tag, not repeated: ${JSON.stringify(checks.map((c: { text: string } | null) => c?.text))}`);
      check(start?.overflow.reader === 0 && start.overflow.rows === 0, `${look} nothing overflows at 800px: ${JSON.stringify(start?.overflow)}`);
      const older = await probe('#older .older-turn');
      check(older && older.steps.join() === 'false,true' && stepsOnlyOpen(older) && older.badges.join() === '1,2',
        `${look} earlier turn: Steps to… open with its badges: ${JSON.stringify({ steps: older?.steps, folded: older?.folded, badges: older?.badges })}`);
      if (look === 'newspaper') await captureSteps(look, SECTIONED, `steps-${look}-fresh`);

      // A badge click ticks the step; the rest stay as they were.
      await js(click('#latest ol.steps > li.step:nth-child(1) > .step-badge'));
      const ticked = await probe('#latest');
      check(ticked?.done.join() === 'true,false,false,false' && ticked.badges[0] === '✓' && ticked.pressed[0] === 'true' && ticked.strike[0] === 'line-through' && ticked.strike[1] === 'none',
        `${look} clicking badge 1 ticks it: ${JSON.stringify({ done: ticked?.done, badges: ticked?.badges, strike: ticked?.strike })}`);

      // A step streaming in keeps the tick and the fold state.
      await show(look, STREAMED);
      await wait(200);
      const streamed = await probe('#latest');
      check(streamed && streamed.badges.join() === '✓,2,3,4,5' && streamed.done[0] && stepsOnlyOpen(streamed),
        `${look} redraw with a new step keeps the tick and folds: ${JSON.stringify({ badges: streamed?.badges, folded: streamed?.folded })}`);
      await captureSteps(look, STREAMED, `steps-${look}-ticked`);

      // A plain numbered list outside Steps renders as before.
      await js(click('#latest .story-section:nth-of-type(1) > h2'));
      const plain = (await probe('#latest'))?.plain;
      check(plain && !plain.steps && plain.items === 2 && plain.rows === 0 && plain.marker === 'decimal' && plain.display === 'list-item',
        `${look} plain <ol> outside Steps unchanged: ${JSON.stringify(plain)}`);

      // Collapse all covers Steps too; Expand all opens it again with the tick still there.
      await js(click('#latest .fold-all'));
      const all = await probe('#latest');
      check(all && all.folded.every((f: boolean) => !f), `${look} Expand all opens all: ${JSON.stringify(all?.folded)}`);
      await js(click('#latest .fold-all'));
      const none = await probe('#latest');
      check(none && none.folded.every(Boolean) && !none.stepsShown, `${look} Collapse all folds Steps too: ${JSON.stringify(none?.folded)}`);
      await js(click('#latest .fold-all'));
      const back = await probe('#latest');
      check(back && back.done[0] && back.badges[0] === '✓', `${look} the tick survives Collapse all: ${JSON.stringify(back?.badges)}`);
    }

    // History's preview: Steps open, rows built.
    await js("window.pastel.look.setReading('newspaper')");
    const removeFixture = addStatusFixture(outDir, SECTIONED);
    try {
      await js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(FIXTURE_STATUS)}); return PastelTerm.history.setPreviewMode('replies'); })`);
      const root = '#history-preview .history-reply';
      const ready = await waitFor(() => js(`Boolean(document.querySelector(${JSON.stringify(`${root} ol.steps`)}))`), 8000);
      const history = await probe(root);
      check(ready && history && stepsOnlyOpen(history) && history.badges.join() === '1,2,3,4' && history.stepsShown,
        `History preview: Steps open with four rows: ${JSON.stringify({ folded: history?.folded, badges: history?.badges })}`);
      await js(click(`${root} ol.steps > li.step:nth-child(2) > .step-badge`));
      const ticked = await probe(root);
      check(ticked?.done.join() === 'false,true,false,false', `History preview badge ticks its step: ${JSON.stringify(ticked?.done)}`);
      await capture('steps-history');
    } finally {
      await js('PastelTerm.history.close()');
      removeFixture();
    }
  } finally {
    resizeOffscreen(win, startWidth ?? 1280, startHeight ?? 900);
  }
}
