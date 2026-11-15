// Following a session Petal did not start: the reader shows its replies read-only, a banner says where to answer,
// and the reply box steps aside, since nothing typed here could reach it. Any tab click, or Stop following, ends it.
import * as reader from './reader';
import { byId, el, isIpcError } from './dom';
import { FOLLOW_BANNER, FOLLOW_ENDED_BANNER, STOP_FOLLOWING } from '../shared/outside-sessions';

const banner = el('div', 'follow-banner');
banner.setAttribute('role', 'status');
banner.hidden = true;
const text = el('span', 'follow-banner-text');
const stopButton = el('button', 'follow-stop', STOP_FOLLOWING);
stopButton.type = 'button';
banner.append(text, stopButton);
byId('reader-head').after(banner);

let following: { sessionId: string; title: string } | null = null;
let onStop: (() => void) | null = null; // app.ts puts the active tab back in the reader

export const isActive = (): boolean => following !== null;
export const sessionId = (): string | null => following?.sessionId ?? null;
export const setOnStop = (callback: () => void): void => { onStop = callback; };

export function stop(): void {
  if (!following) return;
  following = null;
  window.pastel.follow.stop();
  banner.hidden = true;
  document.body.classList.remove('following-outside');
  onStop?.();
}

// A note when it can't be followed (folder off, log gone), else null once the first update is on its way.
export async function start(id: string, title: string): Promise<string | null> {
  const result = await window.pastel.follow.start(id);
  if (isIpcError(result)) return `Couldn’t follow it: ${result.error}`;
  if ('note' in result) return result.note;
  following = { sessionId: id, title };
  text.textContent = FOLLOW_BANNER;
  banner.hidden = false;
  document.body.classList.add('following-outside');
  return null;
}

stopButton.addEventListener('click', stop);

window.pastel.follow.onUpdate(({ sessionId: id, live, update }) => {
  if (following?.sessionId !== id) return;
  text.textContent = live ? FOLLOW_BANNER : FOLLOW_ENDED_BANNER;
  reader.update({ ...update, state: update.state === 'none' ? 'none' : live ? update.state : 'ended', tabId: `follow:${id}`, label: following.title, waiting: [], pending: [] });
});
