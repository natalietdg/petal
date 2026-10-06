// Renders ```mermaid blocks (mainly mindmaps) as themed diagrams. Mermaid loads only when needed.
import type { Mermaid, MermaidConfig } from 'mermaid';

const UI_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const PILL_ORDER = ['next', 'why', 'done', 'watch', 'decide'];
let loading: Promise<Mermaid> | null = null;
let renderCount = 0;

// A separate chunk, fetched the first time a diagram shows up.
function loadMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then((module) => module.default);
  return loading;
}

// Colours come from the live theme's CSS vars, so every theme gets a matching diagram.
function themeVariables(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const vars: Record<string, string> = {
    fontFamily: UI_FONT,
    background: v('--reader-bg'),
    primaryColor: v('--next-pill'),
    primaryTextColor: v('--reader-fg'),
    primaryBorderColor: v('--rule'),
    lineColor: v('--rule'),
    textColor: v('--reader-fg'),
    git0: v('--next-pill'), // mindmap root node
    gitBranchLabel0: v('--reader-fg'),
  };
  for (let i = 0; i < 12; i += 1) {
    const label = PILL_ORDER[i % PILL_ORDER.length];
    vars[`cScale${i}`] = v(`--${label}-pill`);
    vars[`cScaleLabel${i}`] = v('--reader-fg');
    vars[`cScalePeer${i}`] = v('--rule');
  }
  return vars;
}

const config = (): MermaidConfig => ({ startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: UI_FONT, themeVariables: themeVariables() });

async function renderBlock(mermaid: Mermaid, code: Element): Promise<void> {
  const source = code.textContent ?? '';
  // A diagram that won't parse stays a plain code block.
  if (!(await mermaid.parse(source, { suppressErrors: true }))) return;
  try {
    const { svg } = await mermaid.render(`petal-diagram-${++renderCount}`, source);
    const figure = document.createElement('figure');
    figure.className = 'diagram';
    figure.innerHTML = svg;
    code.closest('pre')?.replaceWith(figure);
  } catch {
    document.getElementById(`dpetal-diagram-${renderCount}`)?.remove(); // mermaid's scratch node
  }
}

export async function render(root: ParentNode): Promise<void> {
  const blocks = [...root.querySelectorAll('pre > code.language-mermaid')];
  if (!blocks.length) return;
  const mermaid = await loadMermaid();
  mermaid.initialize(config());
  for (const code of blocks) await renderBlock(mermaid, code);
}

export async function validate(source: string): Promise<boolean> {
  const mermaid = await loadMermaid();
  mermaid.initialize(config());
  return Boolean(await mermaid.parse(source, { suppressErrors: true }));
}

// Renders arbitrary source (e.g. the flow export) into a container, for a visual check.
export async function renderSource(container: Element, source: string): Promise<void> {
  const mermaid = await loadMermaid();
  const { svg } = await mermaid.render(`petal-diagram-${++renderCount}`, source);
  const figure = document.createElement('figure');
  figure.className = 'diagram';
  figure.innerHTML = svg;
  container.replaceChildren(figure);
}
