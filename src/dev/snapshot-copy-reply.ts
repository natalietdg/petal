// Copy on a reply: one click hands the clipboard the whole reply as styled HTML (page background, heading colour, folded
// sections included) plus its markdown as plain text. The clipboard API is stubbed in the page, so her clipboard is never touched.
import type { Kit } from './snapshot';

const THEMES = ['paleSky', 'nightPastel']; // one light, one dark

const COPY_REPLY = [
  '**Copying a reply keeps its look.**',
  '',
  'One click puts the whole reply on the clipboard, colours and all, ready to paste into a doc.',
  '',
  '## What travels',
  '',
  'The ==highlight==, the heading colour and this folded section all come along.',
  '',
  '**Next:** paste it into Google Docs.',
].join('\n');

const copyUpdate = {
  state: 'live',
  replies: [{ id: 'copy-reply', timestamp: '2026-10-19T09:30:00.000Z', prompt: 'can I copy this?', markdown: COPY_REPLY }],
};

// What was copied, read back the way a paste target would, beside the live reply it came from.
const READ_BACK = `(() => {
  const got = window.__copied;
  if (!got) return null;
  const doc = new DOMParser().parseFromString(got.html, 'text/html');
  const box = doc.body.firstElementChild;
  // A copied element's colour is its own inline one, or the nearest ancestor's.
  const inlineColour = (el) => { for (let n = el; n && n.style; n = n.parentElement) if (n.style.color) return n.style.color; return ''; };
  const painted = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return ''; };
  const liveH2 = document.querySelector('#latest .prose h2');
  const copiedH2 = doc.querySelector('h2');
  return {
    text: got.text,
    boxBackground: box?.style.backgroundColor ?? '',
    liveBackground: painted(document.querySelector('#latest .prose')),
    h2Colour: copiedH2 ? inlineColour(copiedH2) : '',
    liveH2Colour: liveH2 ? getComputedStyle(liveH2).color : '',
    h2HasInlineStyle: Boolean(copiedH2?.getAttribute('style') || box?.getAttribute('style')?.includes('color')),
    markStyled: Boolean(doc.querySelector('mark')?.getAttribute('style')),
    foldedIncluded: got.html.includes('this folded section'),
    noControls: !doc.querySelector('button') && !got.html.includes('Copy</'),
    noClasses: !doc.querySelector('[class]'),
  };
})()`;

export async function copyReplyCheck(kit: Kit): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} copy reply: ${what}`);
  const button = "document.querySelector('#latest .reply-copy')";

  // The fixture feed can redraw its own reply; re-send the sample whenever it is gone.
  const showSample = async () => {
    if (await js("document.getElementById('latest').dataset.replyId === 'copy-reply'")) return true;
    await js(`PastelTerm.reader.update(${JSON.stringify(copyUpdate)})`);
    return waitFor(() => js(`Boolean(${button})`), 5000);
  };

  await js(`window.__copied = null; navigator.clipboard.write = async (items) => {
    const item = items[0];
    window.__copied = { html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() };
  }; true`);
  try {
    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      check(await showSample(), `${theme}: the sample reply shows a Copy button`);
      check(await js("Boolean(document.querySelector('#latest .story-section.folded'))"), `${theme}: its section starts folded`);
      await js(`window.__copied = null; ${button}.click()`);
      const got = await waitFor(() => js(READ_BACK), 3000);
      const label = await js(`${button}.textContent`);
      check(got && label === 'Copied', `${theme}: one click copies and the button says Copied (${label})`);
      if (!got) continue;
      check(got.text === COPY_REPLY, `${theme}: text/plain is the reply's markdown exactly`);
      check(got.boxBackground && got.boxBackground === got.liveBackground, `${theme}: the copied section carries the page background inline (${got.boxBackground} vs ${got.liveBackground})`);
      check(got.h2HasInlineStyle && got.h2Colour === got.liveH2Colour, `${theme}: the heading's colour is inline and matches the reader (${got.h2Colour} vs ${got.liveH2Colour})`);
      check(got.markStyled, `${theme}: the highlight keeps its inline style`);
      check(got.foldedIncluded, `${theme}: a folded section is copied too`);
      check(got.noControls && got.noClasses, `${theme}: no buttons or class names travel with it`);
      check(await js("Boolean(document.querySelector('#latest .story-section.folded'))"), `${theme}: the section is still folded on screen after copying`);
      if (theme === THEMES[0]) {
        await js(`${button}.scrollIntoView({ block: 'center' })`);
        await capture('copy-reply-button');
      }
    }

    // Both routes refused: the button says so, and the copy event never reaches her clipboard.
    await js("navigator.clipboard.write = () => Promise.reject(new Error('denied')); document.execCommand = () => false; true");
    await js(`${button}.click()`);
    check(await waitFor(async () => (await js(`${button}.textContent`)) === 'Copy failed' || null, 3000), 'a refused copy says so');
    await wait(50);
  } finally {
    await js('delete navigator.clipboard.write; delete document.execCommand; delete window.__copied; true');
    applyTheme('paleSky', { persist: false });
  }
}
