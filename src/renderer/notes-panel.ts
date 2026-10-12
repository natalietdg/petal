// The Notes side panel, beside the replies and beside History's preview. Both open and close together.
// Open state and width are saved in Petal's config; 'auto' opens it for a session that already has notes.
import { createNotesEditor, type NotesEditor } from './notes';
import { byId, el, isIpcError } from './dom';
import type { Config } from '../main/config-store';

type Prefs = Config['notesPanel'];
const WIDTH = { min: 260, max: 520 }; // main clamps to the same range

const prefs: Prefs = { open: 'auto', width: 320 };
const appliers: (() => void)[] = []; // one per panel: shows or hides it from prefs
const applyAll = (): void => { for (const apply of appliers) apply(); };

// The agent panel can borrow the reader's slot; Notes hides meanwhile and its button hands the slot back.
let slotLentTo: (() => void) | null = null;
export function lendReaderSlot(giveBack: (() => void) | null): void {
  slotLentTo = giveBack;
  applyAll();
}

interface Mount {
  sessionId: string | null;
  hint?: string;
  onSaved?: (text: string) => void;
}

export interface Panel {
  aside: HTMLElement;
  mount: (next: Mount) => void;
  bindToggle: (button: HTMLButtonElement) => void;
}

const setWidth = (px: number): void => {
  prefs.width = Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, px)));
  document.documentElement.style.setProperty('--notes-width', `${prefs.width}px`);
};

const save = (patch: Partial<Prefs>): void => void window.pastel.config.save({ notesPanel: patch });

export function setOpen(open: boolean): void {
  prefs.open = open ? 'open' : 'closed';
  save({ open: prefs.open });
  applyAll();
}

// aside: the panel element; host: the container that makes room for it (class notes-open); sharesSlot: the reader's.
export function createPanel(aside: HTMLElement, host: HTMLElement, sharesSlot = false): Panel {
  aside.classList.add('notes-panel');
  aside.setAttribute('aria-label', 'Your notes');
  const head = el('div', 'notes-panel-head');
  const close = el('button', 'notes-panel-close', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => setOpen(false));
  head.append(el('span', 'notes-panel-title', 'Notes'), close);
  const body = el('div', 'notes-panel-body');
  const grip = el('div', 'notes-panel-grip');
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  aside.append(grip, head, body);
  dragToResize(grip, aside);

  let editor: NotesEditor | null = null;
  let hasNotes = false;
  const toggles = new Set<HTMLButtonElement>();
  const open = (): boolean => prefs.open === 'open' || (prefs.open === 'auto' && hasNotes);
  const lent = (): boolean => sharesSlot && slotLentTo !== null;
  const apply = (): void => {
    const shown = open() && !lent();
    aside.hidden = !shown;
    host.classList.toggle('notes-open', shown || lent()); // the agent panel takes the same room
    for (const button of toggles) {
      if (!button.isConnected) toggles.delete(button); // History rebuilds its head on every preview
      else button.setAttribute('aria-pressed', String(shown));
    }
  };
  appliers.push(apply);

  return {
    aside,
    mount: ({ sessionId, hint, onSaved }) => {
      void editor?.flush(); // typing in the last notes is saved before they go
      hasNotes = false;
      editor = createNotesEditor(sessionId, { hint, onSaved, onLoaded: (text) => { hasNotes = text !== ''; apply(); } });
      body.replaceChildren(editor.element);
      apply();
    },
    bindToggle: (button) => {
      toggles.add(button);
      button.addEventListener('click', () => {
        if (!lent()) return setOpen(!open());
        slotLentTo?.();
        setOpen(true);
      });
      apply();
    },
  };
}

// Drag the panel's left edge; the width is saved when she lets go.
export function dragToResize(grip: HTMLElement, aside: HTMLElement): void {
  grip.addEventListener('pointerdown', (down) => {
    down.preventDefault();
    grip.setPointerCapture(down.pointerId);
    const right = aside.getBoundingClientRect().right;
    const move = (event: PointerEvent) => setWidth(right - event.clientX);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      save({ width: prefs.width });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
  });
}

// The reader's panel runs from the top of the fixed header (just under the dock) to the reply box's bottom.
const readerHead = byId('reader-head');
export const reader = createPanel(byId('notes-panel'), byId('reader-area'), true);
reader.bindToggle(byId<HTMLButtonElement>('notes-toggle'));
new ResizeObserver(() => { reader.aside.style.top = `${readerHead.offsetTop}px`; }).observe(byId('reader'));

// Reads the saved open state and width; runs once at startup.
export async function loadPrefs(): Promise<void> {
  const state = await window.pastel.config.get();
  if (isIpcError(state)) return;
  prefs.open = state.config.notesPanel.open;
  setWidth(state.config.notesPanel.width);
  applyAll();
}
void loadPrefs();
