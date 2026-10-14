// DOM-free, so the node test suite can check it: what entering focus mode does with the keyboard.
export interface FocusTarget {
  tabIndex: number;
  focus(options?: { preventScroll?: boolean }): void;
  blur(): void;
  hasAttribute(name: string): boolean;
}

// The hidden terminal must not keep the keyboard: Space and arrows scroll the reply instead of typing into Claude.
export function focusReader<T extends FocusTarget>(active: T | null, terminalPane: { contains(node: T | null): boolean }, reader: FocusTarget): void {
  if (active && terminalPane.contains(active)) active.blur();
  if (!reader.hasAttribute('tabindex')) reader.tabIndex = -1; // focusable, but not a Tab stop
  reader.focus({ preventScroll: true });
}
