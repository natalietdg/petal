// Reply box under the reader: what she types here is pasted into the active tab's Claude, as if typed there.
PastelTerm.composer = (() => {
  const form = document.getElementById('composer');
  const input = document.getElementById('composer-input');
  const MAX_ROWS = 8;
  // Bracketed paste keeps multi-line replies as one message instead of sending at each newline.
  const PASTE_START = '\x1b[200~';
  const PASTE_END = '\x1b[201~';

  function fit() {
    input.style.height = 'auto';
    const line = parseFloat(getComputedStyle(input).lineHeight);
    input.style.height = `${Math.min(input.scrollHeight, line * MAX_ROWS + 20)}px`;
    document.documentElement.style.setProperty('--composer-height', `${form.offsetHeight}px`);
  }

  function send() {
    const text = input.value.trim();
    const tabId = PastelTerm.tabs.activeId();
    if (!text || !tabId) return;
    window.pastel.write(tabId, `${PASTE_START}${text}${PASTE_END}\r`);
    input.value = '';
    fit();
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); send(); });
  input.addEventListener('input', fit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape') {
      window.dispatchEvent(new Event('petal:focus-terminal'));
    }
  });
  new ResizeObserver(fit).observe(form);
  fit();

  return { focus: () => input.focus() };
})();
