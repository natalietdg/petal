// Puts a session's name on the page: the shared cut-down label as text, the full title on hover.
import { el } from './dom';
import { sessionLabelText } from '../shared/session-label';

export function setSessionName(element: HTMLElement, fullTitle: string): void {
  element.textContent = sessionLabelText(fullTitle);
  element.title = fullTitle;
}

export function sessionNameEl<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, fullTitle: string): HTMLElementTagNameMap[K] {
  const element = el(tag, className);
  setSessionName(element, fullTitle);
  return element;
}
