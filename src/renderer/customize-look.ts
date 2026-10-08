// Customize sections Look (chips that call the same apply* functions as the menus, plus the tarot birthday) and Formatting.
import * as markdown from './markdown';
import * as tarotReading from './tarot-reading';
import { portrait } from './cat';
import { el } from './dom';
import { actionButton, card, field, keepConfig, note, page, save } from './customize-kit';
import type { Config } from '../main/config-store';
import type { Choice } from '../shared/types';

// picture: a pixel portrait drawn before the name, so every chip naming a cat also shows her.
function chipGroup(label: string, choices: readonly Choice[], current: string, onPick: (id: string) => void, picture?: (id: string) => string): HTMLDivElement {
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
    if (picture) {
      const portraitBox = el('span', 'cat-portrait');
      portraitBox.dataset.cat = id;
      portraitBox.innerHTML = picture(id); // built from Petal's own pixel data, no outside text
      chip.prepend(portraitBox);
    }
    group.append(chip);
  }
  return card(label, group);
}

// Saved in config.json only; the Tarot Room popover picks it up at once.
function birthdayCard(): HTMLDivElement {
  const input = el('input', 'cz-input cz-date');
  Object.assign(input, { type: 'date', min: '1900-01-01', max: new Date().toLocaleDateString('en-CA'), value: page.state.config.tarot.birthdate });
  const show = (config: Config): void => {
    input.value = config.tarot.birthdate;
    tarotReading.setBirthdate(config.tarot.birthdate);
  };
  // A half-typed date reads as '', so only a whole date saves; Clear is the way to remove it.
  input.addEventListener('change', async () => { if (input.value) show(await save({ tarot: { birthdate: input.value } })); });
  const clear = actionButton('Clear', async () => show(keepConfig(await window.pastel.config.reset('tarot.birthdate'), 'clear the birthday')), 'flow-button cz-birthday-clear');
  const control = el('span', 'cz-birthday');
  control.append(input, clear);
  return card('Birthday', field('Date of birth', control, "For your Tarot Room reading. Kept in Petal's settings on this Mac, never sent anywhere."));
}

export function renderLook(): HTMLElement[] {
  const { choices, look } = page.state;
  const { look: set } = window.pastel;
  return [
    chipGroup('Theme', choices.themes, look.theme, (id) => { look.theme = id; set.setTheme(id); }),
    chipGroup('Reading style', choices.reading, look.reading, (id) => { look.reading = id; set.setReading(id); }),
    chipGroup('Pet', choices.cats, look.cat, (id) => { look.cat = id; set.setCat(id); }, portrait),
    chipGroup('Scene', choices.scenes, look.scene, (id) => { look.scene = id; set.setScene(id); }),
    birthdayCard(),
    note('Also in the menus: Theme (⌘1–3), View for reading style (⌥⌘1–4), Pet and Pet › Scene.'),
  ];
}

// ---- Formatting: markdown shape -> what each reading style does with it (from reader.css, magazine.css and print.css).
const SHAPES: readonly (readonly [shape: string, markdown: string, ...looks: string[]])[] = [
  ['Headline', '**Bold first line**', 'Large serif headline', 'Big light serif, centred', 'Oversized grotesk in a colour-block hero', 'Bold book serif under a “Words by Claude” mono byline'],
  ['Dek', 'Paragraph right after the headline', 'Larger standfirst with a rule under it', 'Italic, centred, “By Claude” byline', 'Big plain serif under a full ink rule'],
  ['Lede', 'First body paragraph, 160+ characters', 'Drop cap', 'Two-line sunk drop cap in the link colour', 'No drop cap: the essay opens plainly'],
  ['Sections', '## Short title', 'Serif head with a rule above', '“Part I” opener over an italic head', 'Bold serif head, no rule'],
  ['Sidebar', '> **Title** then a list', 'Ruled box, small-caps title', 'Ruled box; margin rail on wide windows', 'Ink-ruled box on a faint tint; margin rail when wide'],
  ['Pull quote', '> One sentence', 'Large serif line', 'Italic under a coloured rule; margin rail when wide', 'Large plain serif between two ink rules; margin rail when wide'],
  ['Callouts', '**Watch out:** / **Decide:**', 'Watch: pill and thin rule. Decide: tinted box, thick bar', 'Same as Newspaper', 'Mono labels; Decide ruled box, Next mustard box'],
  ['Tables', 'GFM table + *italic caption*', 'Horizontal rules only, bold first column', 'Same as Newspaper', 'Ink rules, mono header row'],
  ['Code', 'Fenced block', 'Code-colour block, long lines wrap', 'Same as Newspaper', 'Same as Newspaper', 'Square ink-ruled block'],
  ['Highlight', '==phrase==', 'Highlighter mark', 'Highlighter mark', 'Highlighter mark', 'Highlighter mark'],
  ['Sources', '## Sources (or References, Limitations)', 'Small, quiet back matter', 'Same as Newspaper', 'Mono head over an ink rule'],
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
  table.innerHTML = '<thead><tr><th>Shape</th><th>Write it as</th><th>Newspaper</th><th>Editorial</th><th>Lifestyle</th><th>Print</th></tr></thead>';
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
