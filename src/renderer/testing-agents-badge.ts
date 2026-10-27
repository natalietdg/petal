// The dock's Testing button: a dot while any agent waits on her.
export function setDockBadge(count: number): void {
  const button = document.getElementById('testing-button');
  if (!button) return;
  let dot = button.querySelector<HTMLElement>('.dock-badge');
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'dock-badge';
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot);
  }
  dot.hidden = count === 0;
  button.dataset.needsYou = String(count);
  button.dataset.title ??= button.title; // its own tooltip, put back once nobody waits
  button.title = count ? `${count === 1 ? 'An agent needs' : `${count} agents need`} you in its terminal` : button.dataset.title;
}
