// Customize section Sessions: how many Claude sessions can be open before the Sessions panel suggests closing one,
// and whether the Testing loop may send OS notifications.
import { el } from './dom';
import { card, field, note, numberInput, page, save } from './customize-kit';

const MAX_OPEN = { min: 1, max: 50 }; // same range as config-store

export function renderSessions(): HTMLElement[] {
  const { maxOpen } = page.state.config.sessions;
  const input = numberInput(maxOpen, MAX_OPEN.min, MAX_OPEN.max, async (n) => (await save({ sessions: { maxOpen: n } })).sessions.maxOpen);
  const notify = el('input', 'cz-testing-notify');
  Object.assign(notify, { type: 'checkbox', checked: page.state.config.testing.notify });
  notify.addEventListener('change', () => void save({ testing: { notify: notify.checked } }));
  return [
    card('Open sessions', field('Limit', input, '1–50 Claude sessions on this Mac'),
      note('Over the limit, the Sessions pill and panel say so and offer to close the oldest idle one. Nothing closes on its own, and busy sessions are never suggested.')),
    card('Notifications', field('Notify me when a testing agent needs me, a fix lands or a loop finishes', notify),
      note('Only while no Petal window is in front. The dock badge and the Needs you lane show either way.')),
  ];
}
