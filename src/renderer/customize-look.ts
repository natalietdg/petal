// Customize sections Look (chips that call the same apply* functions as the menus) and Formatting.
import * as markdown from './markdown';
import { el } from './dom';
import { actionButton, card, note, page } from './customize-kit';
import type { Choice } from '../shared/types';

function chipGroup(label: string, choices: readonly Choice[], current: string, onPick: (id: string) => void): HTMLDivElement {
  const group = el('div', 'cz-chips');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const [id, name] of choices) {
    const chip = actionButton(name, () => {
      for (const c of group.children) c.setAttribute('aria-checked', String(c === chip));
      onPick(id);
    }, 'cz-chip');
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(id === current));
    group.append(chip);
  }
  return card(label, group);
}

export function renderLook(): HTMLElement[] {
  const { choices, look } = page.state;
  const { look: set } = window.pastel;
  return [
    chipGroup('Theme', choices.themes, look.theme, (id) => { look.theme = id; set.setTheme(id); }),
    chipGroup('Reading style', choices.reading, look.reading, (id) => { look.reading = id; set.setReading(id); }),
    chipGroup('Pet', choices.cats, look.cat, (id) => { look.cat = id; set.setCat(id); }),
    chipGroup('Scene', choices.scenes, look.scene, (id) => { look.scene = id; set.setScene(id); }),
    note('Also in the menus: Theme (⌘1–3), View for reading style (⇧⌘1–3), Pet and Pet › Scene.'),
  ];
}

// ---- Formatting: markdown shape -> what each reading style does with it (from reader.css + magazine.css).
const SHAPES: readonly (readonly [shape: string, markdown: string, ...looks: string[]])[] = [
  ['Headline', '**Bold first line**', 'Large serif headline', 'Big light serif, centred', 'Oversized grotesk in a colour-block hero'],
  ['Dek', 'Paragraph right after the headline', 'Larger standfirst with a rule under it', 'Italic, centred, “By Claude” byline', 'Inside the hero, a size up'],
  ['Lede', 'First body paragraph, 160+ characters', 'Drop cap', 'Two-line sunk drop cap in the link colour', 'Bold first letter, slightly larger'],
  ['Sections', '## Short title', 'Serif head with a rule above', '“Part I” opener over an italic head', 'Each section its own colour card'],
  ['Sidebar', '> **Title** then a list', 'Ruled box, small-caps title', 'Ruled box; margin rail on wide windows', 'Tinted rounded box'],
  ['Pull quote', '> One sentence', 'Large serif line', 'Italic under a coloured rule; margin rail when wide', 'Bold accent colour with a side bar'],
  ['Callouts', '**Watch out:** / **Decide:**', 'Watch: pill and thin rule. Decide: tinted box, thick bar', 'Same as Newspaper', 'Same; Decide sits on page colour inside a card'],
  ['Tables', 'GFM table + *italic caption*', 'Horizontal rules only, bold first column', 'Same as Newspaper', 'Tinted rounded panel, washed header row'],
  ['Code', 'Fenced block', 'Code-colour block, long lines wrap', 'Same as Newspaper', 'Same as Newspaper'],
  ['Highlight', '==phrase==', 'Highlighter mark', 'Highlighter mark', 'Highlighter mark'],
  ['Sources', '## Sources (or References, Limitations)', 'Small, quiet back matter', 'Same as Newspaper', 'Same, never a card'],
];

const PREVIEW = `**The organizer now reads its prompt from Customize.**

Edits apply on the next pass, and the ==JSON format stays fixed in code== so a custom prompt can never break parsing.

Petal used to keep the organizer prompt inside the source, so changing its tone meant editing code and rebuilding the app. Now the instructions live in config.json and the answer format is appended after them.

## What changed

The prompt moved; the parser did not.

> **At a glance**
> - Interval 1–240 minutes
> - Up to 50 sessions a pass

> A custom prompt can't break the parser.

**Watch out:** a much longer prompt costs a little more per session.

| Setting | Default |
|---|---|
| Model | haiku |
| Per pass | 12 |

\`\`\`
organizer.prompt + JSON contract + existing tags
\`\`\`

## Sources

- \`src/main/session-organizer.js\``;

export function renderFormatting(): HTMLElement[] {
  const readingName = Object.fromEntries(page.state.choices.reading)[page.state.look.reading] ?? page.state.look.reading;
  const table = el('table', 'cz-table');
  table.innerHTML = '<thead><tr><th>Shape</th><th>Write it as</th><th>Newspaper</th><th>Editorial</th><th>Lifestyle</th></tr></thead>';
  const tbody = el('tbody');
  for (const [shape, markdown, ...looks] of SHAPES) {
    const row = el('tr');
    row.append(el('td', 'cz-shape', shape));
    const md = el('td');
    md.append(el('code', null, markdown));
    row.append(md, ...looks.map((text, i) => {
      const cell = el('td', null, text);
      if (page.state.choices.reading[i]?.[0] === page.state.look.reading) cell.classList.add('cz-current');
      return cell;
    }));
    tbody.append(row);
  }
  table.append(tbody);

  const style = el('p', 'cz-note');
  style.append('Claude Code output style: ', el('strong', null, page.state.outputStyle ?? 'default'), ' (from ~/.claude/settings.json, read-only). ');
  if (page.state.magazinePath) style.append('Magazine guide: ', el('code', null, page.state.magazinePath), '.');
  else style.append('No magazine.md found in ~/.claude/output-styles.');

  const column = el('div', 'reader-column cz-preview');
  column.append(markdown.render(PREVIEW));
  return [
    card('Shapes and treatments', table, style),
    card(`Live preview · ${readingName}`, note('Switch the reading style under Look to see this change.'), column),
  ];
}
