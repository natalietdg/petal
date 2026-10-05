// Renders ```mermaid blocks (mainly mindmaps) as themed diagrams. Mermaid loads only when needed.
PastelTerm.diagrams = (() => {
  const MERMAID_SRC = '../../node_modules/mermaid/dist/mermaid.min.js';
  const UI_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
  const PILL_ORDER = ['next', 'why', 'done', 'watch', 'decide'];
  let loading = null;
  let renderCount = 0;

  function loadMermaid() {
    loading ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = MERMAID_SRC;
      script.onload = () => resolve(window.mermaid);
      script.onerror = reject;
      document.head.append(script);
    });
    return loading;
  }

  // Colours come from the live theme's CSS vars, so every theme gets a matching diagram.
  function themeVariables() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const vars = {
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

  async function renderBlock(mermaid, code) {
    const source = code.textContent;
    // A diagram that won't parse stays a plain code block.
    if (!(await mermaid.parse(source, { suppressErrors: true }))) return;
    try {
      const { svg } = await mermaid.render(`petal-diagram-${++renderCount}`, source);
      const figure = document.createElement('figure');
      figure.className = 'diagram';
      figure.innerHTML = svg;
      code.closest('pre').replaceWith(figure);
    } catch {
      document.getElementById(`dpetal-diagram-${renderCount}`)?.remove(); // mermaid's scratch node
    }
  }

  async function render(root) {
    const blocks = [...root.querySelectorAll('pre > code.language-mermaid')];
    if (!blocks.length) return;
    const mermaid = await loadMermaid();
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: UI_FONT, themeVariables: themeVariables() });
    for (const code of blocks) await renderBlock(mermaid, code);
  }

  async function validate(source) {
    const mermaid = await loadMermaid();
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: UI_FONT, themeVariables: themeVariables() });
    return Boolean(await mermaid.parse(source, { suppressErrors: true }));
  }

  // Renders arbitrary source (e.g. the flow export) into a container, for a visual check.
  async function renderSource(container, source) {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(`petal-diagram-${++renderCount}`, source);
    const figure = document.createElement('figure');
    figure.className = 'diagram';
    figure.innerHTML = svg;
    container.replaceChildren(figure);
  }

  return { render, validate, renderSource };
})();
