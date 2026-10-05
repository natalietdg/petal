PastelTerm.layout = (() => {
  const app = document.getElementById('app');
  const divider = document.getElementById('divider');
  const MIN_FRACTION = 0.2;
  const MAX_FRACTION = 0.85;
  let readerFraction = 0.65;

  function applySplit() {
    const reader = Math.round(readerFraction * 1000);
    app.style.gridTemplateRows = `minmax(0, ${reader}fr) auto minmax(0, ${1000 - reader}fr)`;
  }

  function toggleReaderOnly() {
    app.classList.toggle('reader-only');
  }

  divider.addEventListener('pointerdown', (event) => {
    divider.setPointerCapture(event.pointerId);
    const onMove = (move) => {
      const box = app.getBoundingClientRect();
      const fraction = (move.clientY - box.top) / box.height;
      readerFraction = Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, fraction));
      applySplit();
    };
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', () => divider.removeEventListener('pointermove', onMove), { once: true });
  });

  applySplit();
  return { toggleReaderOnly };
})();
