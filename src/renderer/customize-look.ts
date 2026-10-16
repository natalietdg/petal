// Customize sections Look (chips that call the same apply* functions as the menus, plus the tarot birthday) and Formatting (shape guide, output styles, preview).
import * as markdown from './markdown';
import * as tarotReading from './tarot-reading';
import { petWords, portrait, setSize } from './cat';
import { el } from './dom';
import { actionButton, card, field, keepConfig, note, page, save } from './customize-kit';
import { outputStylesCard } from './customize-styles';
import { petalSkillsCard } from './customize-skills';
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

// Pet size wording uses the chosen pet's name and pronoun.
function sizeNoteText(id: string): string {
  const { name, they, their } = petWords(id);
  const They = they[0].toUpperCase() + they.slice(1);
  return `Pet size is the biggest ${name} gets. ${They} shrinks on ${their} own when a line of text would sit under ${they === 'he' ? 'him' : 'her'}.`;
}

export function renderLook(): HTMLElement[] {
  const { choices, look } = page.state;
  const { look: set } = window.pastel;
  const sizeNote = note(sizeNoteText(look.cat));
  return [
    chipGroup('Theme', choices.themes, look.theme, (id) => { look.theme = id; set.setTheme(id); }),
    chipGroup('Reading style', choices.reading, look.reading, (id) => { look.reading = id; set.setReading(id); }),
    chipGroup('Pet', choices.cats, look.cat, (id) => { look.cat = id; set.setCat(id); sizeNote.textContent = sizeNoteText(id); }, portrait),
    chipGroup('Pet size', PET_SIZE_CHOICES, page.state.config.pet.size, async (id) => setSize((await save({ pet: { size: id } })).pet.size)),
    chipGroup('Scene', choices.scenes, look.scene, (id) => { look.scene = id; set.setScene(id); }),
    birthdayCard(),
    sizeNote,
    note('Also in the menus: Theme (⌘1–3), View for reading style (⌥⌘1–4), Pet and Pet › Scene.'),
  ];
}

// A neutral sample reply in Petal's research-paper shape: title, abstract, status lines, sections, sidebar, table, references.
const PREVIEW = `**A search box now filters notes as you type.**

**Abstract.** The notes list has a search box above it. Typing narrows the list to notes whose title or body contains the text, and ==an empty box shows every note again==. Search runs on the notes already loaded, so it adds no network calls.

**Doing:** nothing running.
**Recommend:** keep search local until the list grows past a few thousand notes.
**Next:** try it on a long list and check it still feels instant.

## 1. Where the search happens

The box filters the list in memory on each keystroke. Titles and bodies match without regard to letter case, so "Recipe" and "recipe" find the same note.

> **At a glance**
> - Matches title and body
> - Ignores letter case
> - Escape clears the box

> An empty box always shows every note.

## 2. What it costs

Filtering in memory is quick for everyday collections, and the list never waits on a server.

**Watch out:** a very long list may need a search index later.

*Table 1. Notes in the list and time to filter.*

| Notes | Time to filter |
|---|---|
| 100 | under 1 ms |
| 5,000 | a few ms |

\`\`\`
query → lowercase → match title or body → show
\`\`\`

## References

1. Notes app design notes, search section`;

// Petal ships petal-magazine.md; it lands in ~/.claude/output-styles only after the add action.
export const MISSING_MAGAZINE = 'Petal’s magazine style (petal-magazine.md) isn’t in ~/.claude/output-styles yet. Use “Add Petal’s reply styles” under Output styles to add it.';

export function renderFormatting(): HTMLElement[] {
  const readingName = Object.fromEntries(page.state.choices.reading)[page.state.look.reading] ?? page.state.look.reading;
  const style = el('p', 'cz-note');
  style.append('Claude Code output style: ', el('strong', null, page.state.outputStyle ?? 'default'), ' (from ~/.claude/settings.json; switch it under Output styles). ');
  if (page.state.magazinePath) style.append('Magazine style: ', el('code', null, page.state.magazinePath), '.');
  else if (page.state.config.claudeFolder.choice === 'allowed') style.append(MISSING_MAGAZINE);

  const column = el('div', 'reader-column cz-preview');
  column.append(markdown.render(PREVIEW));
  return [
    card('Shape guide', note(`Each shape as Claude types it, and how the reader shows it in ${readingName}. Switch the reading style under Look to compare.`), shapeGuide(), style),
    outputStylesCard(),
    petalSkillsCard(),
    card(`Live preview · ${readingName}`, note('Switch the reading style under Look to see this change.'), column),
  ];
}
