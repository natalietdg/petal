// Small DOM helpers shared by the renderer modules.
import type { IpcError } from '../shared/types';

// Looks up an element the page markup (index.html) always has.
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`index.html is missing #${id}`);
  return node as T;
}

// Looks up an element inside a container that was just built from a template.
export function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string | null, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// An invoke reply that failed in main comes back as { error } (see main/ipc-guard.ts).
export const isIpcError = (value: unknown): value is IpcError => typeof value === 'object' && value !== null && 'error' in value;

export const focusTerminal = (): boolean => window.dispatchEvent(new Event('petal:focus-terminal'));
