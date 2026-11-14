// Customize sections Look (chips that call the same apply* functions as the menus) and Formatting (formatting guide, preview).
import * as markdown from './markdown';
import * as textSize from './text-size';
import { NO_PET, petWords, portrait, setSize } from './cat';
import { el } from './dom';
import { actionButton, card, note, page, save } from './customize-kit';
import { formattingGuide } from './formatting-guide';
import type { Choice } from '../shared/types';
import { PET_SIZE_CHOICES } from '../shared/pet-size';
import { READER_PERCENT, TERMINAL_FONT, type SizeRange, type TextPane } from '../shared/text-size';

// picture: a pixel portrait drawn before the name, so every chip naming a cat also shows her ('' draws none).
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
    const art = picture?.(id);
    if (art) {
      const portraitBox = el('span', 'cat-portrait');
      portraitBox.dataset.cat = id;
      portraitBox.innerHTML = art; // built from Petal's own pixel data, no outside text
      chip.prepend(portraitBox);
    }
    group.append(chip);
  }
  return card(label, group);
}

// − value + and Reset for one pane; the value follows ⌘= ⌘- ⌘0 and other windows while the card is on screen.
function sizeStepper(pane: TextPane, label: string, range: SizeRange, show: (n: number) => string, hint: string): HTMLDivElement {
  const output = el('output', 'cz-size-value');
  const smaller = actionButton('−', () => textSize.step(pane, -1), 'flow-button cz-size-step');
  const bigger = actionButton('+', () => textSize.step(pane, 1), 'flow-button cz-size-step');
  const resetButton = actionButton('Reset', () => textSize.reset(pane), 'flow-button cz-size-reset');
  smaller.setAttribute('aria-label', `Smaller ${label.toLowerCase()}`);
  bigger.setAttribute('aria-label', `Bigger ${label.toLowerCase()}`);
  const row = el('div', 'cz-field cz-size');
  row.dataset.pane = pane;
  const paint = (): void => {
    const n = textSize.value(pane);
    output.textContent = show(n);
    smaller.disabled = n <= range.min;
    bigger.disabled = n >= range.max;
    resetButton.disabled = n === range.initial;
  };
  const stop = textSize.onChange(() => { if (row.isConnected) paint(); else stop(); });
  paint();
  const control = el('span', 'cz-size-control');
  control.append(smaller, output, bigger, resetButton);
  row.append(el('span', 'cz-label', label), control, el('span', 'cz-hint', hint));
  return row;
}

function textSizeCard(): HTMLDivElement {
  const rows = el('div', 'cz-fields');
  rows.append(
    sizeStepper('terminal', 'Terminal font', TERMINAL_FONT, (n) => `${n} px`, `${TERMINAL_FONT.min} to ${TERMINAL_FONT.max} px; ${TERMINAL_FONT.initial} is the usual size.`),
    sizeStepper('reader', 'Reader text', READER_PERCENT, (n) => `${n}%`, `${READER_PERCENT.min}% to ${READER_PERCENT.max}%. The live preview under Formatting follows it.`),
  );
  return card('Text size', rows, note('Also ⌘= bigger, ⌘- smaller and ⌘0 actual size, for the terminal when you last clicked or typed there, otherwise the reader.'));
}

const petPicture = (id: string): string => (id === NO_PET ? '' : portrait(id));

// Pet size wording uses the chosen pet's name and pronoun.
function sizeNoteText(id: string): string {
  if (id === NO_PET) return 'No pet in the corner. Pet size applies once you pick one.';
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
    textSizeCard(),
    chipGroup('Pet', choices.cats, look.cat, (id) => { look.cat = id; set.setCat(id); sizeNote.textContent = sizeNoteText(id); }, petPicture),
    chipGroup('Pet size', PET_SIZE_CHOICES, page.state.config.pet.size, async (id) => setSize((await save({ pet: { size: id } })).pet.size)),
    chipGroup('Scene', choices.scenes, look.scene, (id) => { look.scene = id; set.setScene(id); }),
    sizeNote,
    note(`Also in the menus: Theme (⌘1–${choices.themes.length}), View for reading style (⌥⌘1–${choices.reading.length}), Pet and Pet › Scene.`),
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
export const MISSING_MAGAZINE = 'Petal’s magazine style (petal-magazine.md) isn’t in ~/.claude/output-styles yet. Use “Add Petal’s reply styles” under Customize › Claude setup to add it.';

export function renderFormatting(): HTMLElement[] {
  const readingName = Object.fromEntries(page.state.choices.reading)[page.state.look.reading] ?? page.state.look.reading;
  const style = el('p', 'cz-note');
  style.append('Claude Code output style: ', el('strong', null, page.state.outputStyle ?? 'default'), ' (from ~/.claude/settings.json; switch it under Claude setup). ');
  if (page.state.magazinePath) style.append('Magazine style: ', el('code', null, page.state.magazinePath), '.');
  else if (page.state.config.claudeFolder.choice === 'allowed') style.append(MISSING_MAGAZINE);

  const column = el('div', 'reader-column cz-preview');
  column.append(markdown.render(PREVIEW));
  return [
    card('Formatting guide', note(`Each shape as Claude types it and how the reader shows it in ${readingName}, then what each colour means. Switch the reading style under Look to compare.`), formattingGuide(), style),
    card(`Live preview · ${readingName}`, note('Switch the reading style under Look to see this change.'), column),
  ];
}
