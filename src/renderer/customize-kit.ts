// Customize's page skeleton, the loaded settings and the small builders every section uses.
import { byId, el, isIpcError, query } from './dom';
import type { Config, ConfigPatch } from '../main/config-store';
import type { CustomizeState } from '../shared/ipc';
import type { IpcError } from '../shared/types';

export const view = byId('customize');
view.innerHTML = `
  <div class="customize-pane">
    <div class="customize-head">
      <h1 class="customize-title">Customize</h1>
      <div id="customize-tabs" class="view-toggle customize-tabs" role="tablist" aria-label="Customize sections"></div>
    </div>
    <p id="customize-summary" class="cz-summary"></p>
    <p id="customize-error" class="wf-error" role="alert" hidden></p>
    <div id="customize-body" class="customize-body"></div>
  </div>`;
export const tabsBar = query(view, '#customize-tabs');
export const summary = query(view, '#customize-summary');
export const errorLine = query(view, '#customize-error');
export const body = query(view, '#customize-body');

// The config:get payload; customize.ts reads it before any section draws.
export const page = { state: null as unknown as CustomizeState };

export const actionButton = (label: string, onClick: () => unknown, className = 'flow-button'): HTMLButtonElement => {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

export const card = (title: string | null, ...children: Node[]): HTMLDivElement => {
  const box = el('div', 'cz-card');
  if (title) box.append(el('h2', 'cz-card-title', title));
  box.append(...children);
  return box;
};
export const field = (label: string, control: HTMLElement, hint?: string): HTMLLabelElement => {
  const row = el('label', 'cz-field');
  row.append(el('span', 'cz-label', label), control);
  if (hint) row.append(el('span', 'cz-hint', hint));
  return row;
};
// Shows whatever main saved, so a clamped or rejected value snaps back at once.
export function numberInput(value: number, min: number, max: number, onSave: (n: number) => Promise<number>): HTMLInputElement {
  const input = el('input', 'cz-input cz-number');
  Object.assign(input, { type: 'number', min: String(min), max: String(max), step: '1', value: String(value) });
  input.addEventListener('change', async () => { input.value = String(await onSave(Number(input.value))); });
  return input;
}
export const note = (text: string, className = 'cz-note'): HTMLParagraphElement => el('p', className, text);

// A failed save or reset in main shows above the section; the page keeps the last good config.
function report(text: string): void {
  errorLine.textContent = text;
  errorLine.hidden = false;
}

export function keepConfig(result: Config | IpcError, what: string): Config {
  if (isIpcError(result)) report(`Couldn’t ${what}: ${result.error}`);
  else page.state.config = result;
  return page.state.config;
}

export const save = async (patch: ConfigPatch): Promise<Config> => keepConfig(await window.pastel.config.save(patch), 'save this setting');
