// Customize sections Look (chips that call the same apply* functions as the menus, plus the tarot birthday) and Formatting (shape guide, output styles, preview).
import * as markdown from './markdown';
import * as tarotReading from './tarot-reading';
import { portrait, setSize } from './cat';
import { el } from './dom';
import { actionButton, card, field, keepConfig, note, page, save } from './customize-kit';
import { outputStylesCard } from './customize-styles';
import { shapeGuide } from './shape-guide';
import type { Config } from '../main/config-store';
import type { Choice } from '../shared/types';
import { PET_SIZE_CHOICES } from '../shared/pet-size';

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
    chipGroup('Pet size', PET_SIZE_CHOICES, page.state.config.pet.size, async (id) => setSize((await save({ pet: { size: id } })).pet.size)),
    chipGroup('Scene', choices.scenes, look.scene, (id) => { look.scene = id; set.setScene(id); }),
    birthdayCard(),
    note('Pet size is the biggest she gets. She shrinks on her own when a line of text would sit under her.'),
    note('Also in the menus: Theme (⌘1–3), View for reading style (⌥⌘1–4), Pet and Pet › Scene.'),
  ];
}

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
  const style = el('p', 'cz-note');
  style.append('Claude Code output style: ', el('strong', null, page.state.outputStyle ?? 'default'), ' (from ~/.claude/settings.json, read-only). ');
  if (page.state.magazinePath) style.append('Magazine guide: ', el('code', null, page.state.magazinePath), '.');
  else style.append('No magazine.md found in ~/.claude/output-styles.');

  const column = el('div', 'reader-column cz-preview');
  column.append(markdown.render(PREVIEW));
  return [
    card('Shape guide', note(`Each shape as Claude types it, and how the reader shows it in ${readingName}. Switch the reading style under Look to compare.`), shapeGuide(), style),
    outputStylesCard(),
    card(`Live preview · ${readingName}`, note('Switch the reading style under Look to see this change.'), column),
  ];
}
