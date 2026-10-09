// Colour key: opens from the header button and Help > Colour key, lists the four coded treatments (Lifestyle adds its own under
// "In this look"), and each sample's colours equal the same element in a real rendered reply, in every look × light and dark.
// Newspaper, Editorial and Print: every other treatment uses only ink and paper. Lifestyle: its restored colours equal the pre-cut tokens.
// Esc and an outside click close it.
import fs from 'node:fs';
import path from 'node:path';
import { Menu, type BrowserWindow, type MenuItem } from 'electron';
import type { Kit } from './snapshot';
import { OPEN_SECTIONS } from './snapshot-reader-collapse';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { DECIDE_PROBES, KEY_ENTRIES, LIFESTYLE_ENTRIES, LIFESTYLE_EXPECT, NEUTRAL_PROBES, type KeyEntry } from '../renderer/colour-key-entries';
import { SINGLE_SCREEN } from './snapshot-prompts';

// A real reply carrying every treatment where replies put it: callouts, quotes and tables inside sections.
const REPLY = [
  '**The key matches the reply.**',
  '',
  'Every colour in the key comes from the same CSS that draws this reply.',
  '',
  '**Doing:** cutting the colour codes to four.',
  '**Recommend:** keep the rest in plain type.',
  '**Next:** open the key in each look.',
  '',
  'Only four treatments carry colour now, so a tint always means something: the highlighter, a choice for you, a risk to watch, and code typed exactly. The rest is type.',
  '',
  '## What changed',
  '',
  'Keep ==the one phrase== in mind, see [the docs](https://example.com), and run `npm test` first.',
  '',
  '**Done:** the samples render live.',
  '',
  '**Why:** a key drawn separately would drift.',
  '',
  '**Watch out:** Print swaps pills for mono labels.',
  '',
  '> **At a glance**',
  '> - one fact',
  '> - another fact',
  '',
  '## Why it matters',
  '',
  '> A key that lies is worse than none.',
  '',
  '| Item | State |',
  '|---|---|',
  '| Tests | pass |',
  '',
  '*Table 1. Checks by look.*',
  '',
  '```',
  'npm test',
  '```',
  '',
  '**Decide:** keep the key in the header, or only in Help?',
  '',
  '- **Next:** the same label inside a list stays a callout.',
  '',
  '## Sources',
  '',
  '- `src/renderer/colour-key.ts`',
].join('\n');

const keyUpdate = { state: 'live', replies: [{ id: 'colour-key-reply', timestamp: '2026-10-08T09:00:00.000Z', prompt: 'add an index for the colour code\n<pasted_content id="p1">\nthe colours inside replies\n</pasted_content id="p1">', markdown: REPLY }] };

// Colours of an element and its generated content; a border counts only where it is drawn.
const SIG = `const sig = (node, pseudo) => {
  const s = getComputedStyle(node, pseudo);
  if (pseudo && (s.content === 'none' || s.content === 'normal')) return '';
  const side = (k) => parseFloat(s['border' + k + 'Width']) > 0 ? s['border' + k + 'Color'] : '-';
  return [s.color, s.backgroundColor, side('Top'), side('Right'), side('Bottom'), side('Left')].join(' ');
};
const full = (node) => [sig(node), sig(node, '::before'), sig(node, '::after')].join(' / ');`;

// Every colour an element (or its generated content) paints: text, fill, and each border that is drawn.
const PAINT = `const paint = (node, pseudo) => {
  const s = getComputedStyle(node, pseudo);
  if (pseudo && pseudo !== '::first-letter' && (s.content === 'none' || s.content === 'normal')) return [];
  const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((k) => parseFloat(s['border' + k + 'Width']) > 0).map((k) => s['border' + k + 'Color']);
  return [s.color, s.backgroundColor, ...sides];
};`;

// The look's own ink and paper, resolved where the reply sits: anything else on a neutral treatment is an accent.
const NEUTRAL = `(() => {
  ${PAINT}
  const host = document.getElementById('latest');
  const swatch = document.createElement('span');
  host.append(swatch);
  const base = ['--reader-fg', '--reader-bg', '--muted', '--rule'].map((v) => { swatch.style.color = 'var(' + v + ')'; return getComputedStyle(swatch).color; });
  swatch.remove();
  const allowed = new Set([...base, 'rgba(0, 0, 0, 0)']);
  const probes = ${JSON.stringify(NEUTRAL_PROBES)};
  const found = [];
  const accents = [];
  for (const probe of probes) {
    const nodes = probe.startsWith('#') ? [document.querySelector(probe)] : [...host.querySelectorAll(probe)];
    if (!nodes[0]) { accents.push({ probe, missing: true }); continue; }
    found.push(probe);
    for (const node of nodes) for (const pseudo of [null, '::before', '::after', '::first-letter']) {
      const colours = paint(node, pseudo);
      const bad = colours.filter((c) => !allowed.has(c));
      if (bad.length) accents.push({ probe, pseudo, bad });
    }
  }
  return { base, found: found.length, total: probes.length, accents };
})()`;

// The question card, drawn from a captured picker screen: every colour is the look's base or one of Decide's.
const DECIDE = `(() => {
  ${PAINT}
  const swatch = document.createElement('span');
  document.getElementById('prompt-dock').append(swatch);
  const resolve = (v) => { swatch.style.color = 'var(' + v + ')'; return getComputedStyle(swatch).color; };
  const allowed = new Set(['--reader-fg', '--reader-bg', '--muted', '--rule', '--decide-ink', '--decide-pill', '--decide-wash'].map(resolve).concat('rgba(0, 0, 0, 0)'));
  swatch.remove();
  const card = document.querySelector('.question-card');
  if (!card || card.hidden) return { shown: false };
  const probes = ${JSON.stringify(DECIDE_PROBES)};
  const accents = [];
  let found = 0;
  for (const probe of probes) {
    const nodes = probe === '.question-card' ? [card] : [...card.querySelectorAll(probe)];
    if (nodes.length) found++; else accents.push({ probe, missing: true });
    for (const node of nodes) for (const pseudo of [null, '::before', '::after']) {
      const bad = paint(node, pseudo).filter((c) => !allowed.has(c));
      if (bad.length) accents.push({ probe, pseudo, bad });
    }
  }
  return { shown: true, found, total: probes.length, accents };
})()`;

// Per entry and probe: the sample's colours next to the real reply's (by default its last match, past the first section's quirks).
const compare = (entries: readonly KeyEntry[]) => `(() => {
  ${SIG}
  const entries = ${JSON.stringify(entries.map(({ id, probes, real }) => ({ id, probes, real: real ?? { scope: '#latest', pick: 'last' } })))};
  return entries.flatMap(({ id, probes, real: where }) => probes.map((probe) => {
    const sample = document.querySelector('#colour-key [data-key="' + id + '"] ' + probe);
    const reals = document.querySelectorAll(where.scope + ' ' + probe);
    const real = where.pick === 'first' ? reals[0] : reals[reals.length - 1];
    return { id, probe, sample: sample ? full(sample) : null, real: real ? full(real) : null };
  }));
})()`;

// Lifestyle: each restored colour equals its pre-cut token, resolved where the reply sits.
const LIFESTYLE = `(() => {
  const swatch = document.createElement('span');
  document.getElementById('latest').append(swatch);
  const resolve = (v) => { swatch.style.color = 'var(' + v + ')'; return getComputedStyle(swatch).color; };
  const rows = ${JSON.stringify(LIFESTYLE_EXPECT)}.map(([selector, pseudo, prop, token]) => {
    const node = document.querySelector(selector);
    const got = node ? getComputedStyle(node, pseudo)[prop] : null;
    return { selector, pseudo, prop, token, want: resolve(token), got };
  });
  swatch.remove();
  return rows;
})()`;

const STATE = `(() => {
  const popover = document.getElementById('colour-key');
  const button = document.getElementById('colour-key-button');
  const toggle = document.querySelector('#reader-head .view-toggle');
  const r = popover.getBoundingClientRect();
  return {
    shown: !popover.hidden && r.height > 0,
    keys: [...popover.querySelectorAll('.ck-entry')].filter((li) => li.getClientRects().length > 0).map((li) => li.dataset.key),
    meanings: [...popover.querySelectorAll('.ck-meaning')].filter((p) => p.getClientRects().length > 0).map((p) => p.textContent),
    lookHead: [...popover.querySelectorAll('.ck-look-head')].filter((p) => p.getClientRects().length > 0).map((p) => p.textContent),
    text: popover.innerText,
    buttonHeight: Math.round(button.getBoundingClientRect().height),
    toggleHeight: Math.round(toggle.getBoundingClientRect().height),
    expanded: button.getAttribute('aria-expanded'),
    history: !document.getElementById('history').hidden,
  };
})()`;

const clickButton = "document.getElementById('colour-key-button').dispatchEvent(new MouseEvent('click', { bubbles: true }))";
const escape = "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))";
const clickOutside = "document.getElementById('reader').dispatchEvent(new MouseEvent('click', { bubbles: true }))";

// Captures just the popover, after a repaint so the unfocused window hands back a fresh frame.
async function capturePopover(kit: Kit, win: BrowserWindow, name: string): Promise<string> {
  win.webContents.invalidate();
  await kit.wait(400);
  await win.webContents.capturePage();
  await kit.wait(300);
  const box = await kit.js("(() => { const r = document.getElementById('colour-key').getBoundingClientRect(); return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()");
  const file = path.join(kit.outDir, `snapshot-${name}.png`);
  fs.writeFileSync(file, (await win.webContents.capturePage(box)).toPNG());
  kit.log(`captured ${name}: ${file}`);
  return file;
}

export async function colourKeyCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, themes, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} colour key: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  resizeOffscreen(win, 1280, 1100);
  await waitFor(async () => (await js('window.innerWidth')) === 1280, 3000);
  await js('PastelTerm.overlays.hideCurrent()'); // an open overlay hides the header the key hangs from
  await js("PastelTerm.reader.setView('replies')");
  // The fixture feed can redraw its own reply; re-send the sample before each look and theme.
  const showReply = async () => {
    await js(`PastelTerm.reader.update(${JSON.stringify(keyUpdate)}); ${OPEN_SECTIONS}`);
    return waitFor(() => js("Boolean(document.querySelector('#latest .callout-done'))"), 5000);
  };
  check(await showReply(), 'real reply with every treatment is on screen');

  const light = Object.keys(themes).find((id) => !themes[id].dark) ?? 'paleSky';
  const dark = Object.keys(themes).find((id) => themes[id].dark) ?? 'nightPastel';
  const expectedKeys = KEY_ENTRIES.map((entry) => entry.id);
  const lifestyleKeys = [...expectedKeys, ...LIFESTYLE_ENTRIES.map((entry) => entry.id)];

  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    for (const theme of [light, dark]) {
      applyTheme(theme, { persist: false });
      await showReply();
      await wait(250);
      await js(clickButton);
      await wait(200);
      const state = await js(STATE);
      check(state.shown && state.expanded === 'true', `${look} ${theme}: header button opens it`);
      const lifestyle = look === 'lifestyle';
      const wantKeys = lifestyle ? lifestyleKeys : expectedKeys;
      check(JSON.stringify(state.keys) === JSON.stringify(wantKeys) && state.lookHead.length === (lifestyle ? 1 : 0),
        `${look} ${theme}: lists ${wantKeys.length} treatments${lifestyle ? ' (the four, then "In this look")' : ''}: ${state.keys.join(', ')}`);
      const rows = await js(compare(lifestyle ? [...KEY_ENTRIES, ...LIFESTYLE_ENTRIES] : KEY_ENTRIES));
      // any: the rows' shape is built in COMPARE above.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrong = rows.filter((r: any) => !r.sample || !r.real || r.sample !== r.real);
      check(wrong.length === 0, `${look} ${theme}: ${rows.length - wrong.length}/${rows.length} sample colours equal the real reply's${wrong.length ? ` ${JSON.stringify(wrong)}` : ''}`);
      await js(`PastelTerm.promptDock.readScreen(PastelTerm.tabs.active().id, ${JSON.stringify(SINGLE_SCREEN)})`);
      const decide = await waitFor(async () => { const d = await js(DECIDE); return d.shown ? d : null; }, 3000);
      check(decide && decide.found === decide.total && decide.accents.length === 0,
        `${look} ${theme}: question card ${decide?.found}/${decide?.total} parts use only Decide's colours and the base${decide?.accents.length ? ` accents: ${JSON.stringify(decide.accents)}` : ''}`);
      await js('PastelTerm.promptDock.readScreen(PastelTerm.tabs.active().id, [])');
      if (lifestyle) {
        const restored = await js(LIFESTYLE);
        // any: the rows' shape is built in LIFESTYLE above.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const off = restored.filter((r: any) => r.got !== r.want);
        check(off.length === 0, `${look} ${theme}: ${restored.length - off.length}/${restored.length} restored colours equal their pre-cut tokens${off.length ? ` ${JSON.stringify(off)}` : ''}`);
      } else {
        const neutral = await js(NEUTRAL);
        check(neutral.found === neutral.total && neutral.accents.length === 0,
          `${look} ${theme}: ${neutral.found}/${neutral.total} uncoded treatments use only ink and paper ${JSON.stringify(neutral.base)}${neutral.accents.length ? ` accents: ${JSON.stringify(neutral.accents)}` : ''}`);
      }
      await capturePopover(kit, win, `colour-key-${look}-${theme}`);
      await js(escape);
      await wait(200);
      check(!(await js(STATE)).shown, `${look} ${theme}: Esc closes it`);
    }
  }
  applyTheme(light, { persist: false });
  await js("window.pastel.look.setReading('newspaper')");
  await wait(250);

  await js(clickButton);
  await wait(200);
  const opened = await js(STATE);
  check(opened.buttonHeight <= opened.toggleHeight, `button (${opened.buttonHeight}px) is no taller than the view toggle (${opened.toggleHeight}px)`);
  check(opened.meanings.length === expectedKeys.length && !/[–—]/.test(opened.text), `every row has a meaning line and the copy has no em dashes: ${JSON.stringify(opened.meanings)}`);
  await js(clickOutside);
  await wait(200);
  check(!(await js(STATE)).shown, 'a click outside closes it');

  // Help > Colour key, from over an open overlay: the overlay gives way and the key opens.
  const item = Menu.getApplicationMenu()?.items.find((m) => m.role === 'help')?.submenu?.items.find((i: MenuItem) => i.label === 'Colour key');
  check(item, 'Help menu has a Colour key item');
  await js('PastelTerm.history.open()');
  await wait(300);
  item?.click();
  const fromMenu = await waitFor(async () => {
    const now = await js(STATE);
    return now.shown ? now : null;
  }, 3000);
  check(fromMenu && !fromMenu.history && fromMenu.keys.length === expectedKeys.length, `Help > Colour key closes History and opens the key: ${JSON.stringify(fromMenu && { history: fromMenu.history, keys: fromMenu.keys.length })}`);
  await js(escape);
  await wait(200);
  check(!(await js(STATE)).shown, 'Esc closes the key opened from Help');

  resizeOffscreen(win, startWidth, startHeight);
}
