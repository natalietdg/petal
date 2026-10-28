// Fenced code in a reply: ```diff rows are tinted by sign and ```ts tokens take the syntax palette, light and dark.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { OPEN_SECTIONS } from './snapshot-reader-collapse';
import { resizeTo } from './snapshot-tables';
import { resizeOffscreen } from '../main/snapshot-window';

const THEMES = ['paleSky', 'nightPastel']; // one light, one dark
const WIDTH = 1280;
const TALL_HEIGHT = 1500;

const CODE_REPLY = [
  '**The verification link now carries the canonical name.**',
  '',
  'The diff below is the whole change; the second block is the helper it calls.',
  '',
  '```diff',
  '@@ -760,6 +760,9 @@ userRegister',
  '+    const verificationUrl = `${process.env.EMAIL_VERIFICATION_ENDPOINT}${token}&countryCode=${countryCode}`;',
  '     // AB#10427: canonical actionUrl beside the legacy name until the template is switched',
  '-    email_verification_URL: `${process.env.EMAIL_VERIFICATION_ENDPOINT}${token}`,',
  '+    actionUrl: verificationUrl,',
  '+    email_verification_URL: verificationUrl,',
  '     recipientName: request.name,',
  '```',
  '',
  '```ts',
  '// Builds the link the email button opens.',
  'export function verificationLink(token: string, countryCode: string): string {',
  '  const base = process.env.EMAIL_VERIFICATION_ENDPOINT ?? "";',
  '  return `${base}${token}&countryCode=${countryCode}`;',
  '}',
  '```',
].join('\n');

const codeUpdate = {
  state: 'live',
  replies: [{ id: 'code-colours', timestamp: '2026-10-28T09:30:00.000Z', prompt: 'show me the change', markdown: CODE_REPLY }],
};

// Painted colours of the first add row, first remove row, a keyword in each block and the plain text.
const MEASURE = `(() => {
  const diff = document.querySelector('#latest pre code.code-diff');
  const ts = document.querySelector('#latest pre code.language-ts');
  const bg = (sel) => { const n = diff && diff.querySelector(sel); return n ? getComputedStyle(n).backgroundColor : null; };
  const fg = (root, sel) => { const n = root && root.querySelector(sel); return n ? getComputedStyle(n).color : null; };
  return {
    addBg: bg('.code-add'), delBg: bg('.code-del'), sameBg: bg('.code-same'),
    addRows: diff ? diff.querySelectorAll('.code-add').length : 0, delRows: diff ? diff.querySelectorAll('.code-del').length : 0,
    diffString: fg(diff, '.hljs-string'), tsKeyword: fg(ts, '.hljs-keyword'), tsComment: fg(ts, '.hljs-comment'),
    plain: ts ? getComputedStyle(ts).color : null,
  };
})()`;

const scrollToCode = (js: Kit['js']): Promise<unknown> => js(`(() => {
  const reader = document.getElementById('reader');
  const el = document.querySelector('#latest pre');
  reader.scrollTop = el.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 160;
})()`);

export async function codeColoursCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} code colours: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  await js('PastelTerm.getStarted.close()'); // a fresh profile opens on Get started, over the reader

  // A theme switch rebuilds the reader and the fixture feed can redraw its own reply; re-send the sample whenever it is gone.
  const showSample = async () => {
    if (await js("document.querySelectorAll('#latest pre code.code-syntax').length === 2")) return true;
    await js(`PastelTerm.reader.update(${JSON.stringify(codeUpdate)}); ${OPEN_SECTIONS}`);
    return waitFor(() => js("document.querySelectorAll('#latest pre code.code-syntax').length === 2"), 5000);
  };
  check(await showSample(), 'sample reply with a diff and a ts block, both highlighted');
  check(await resizeTo(kit, win, WIDTH), `window resized to ${WIDTH}px`);

  await win.webContents.capturePage(); // warm-up: the run's first offscreen frame can be stale
  for (const theme of THEMES) {
    applyTheme(theme, { persist: false });
    await wait(300);
    check(await showSample(), `${theme} sample reply shown`);
    const m = await js(MEASURE) as Record<string, string | number | null>;
    log(`code colours ${theme}: ${JSON.stringify(m)}`);
    check(m.addRows === 3 && m.delRows === 1, `${theme} diff has 3 added and 1 removed rows`);
    check(m.addBg && m.delBg && m.addBg !== m.delBg && m.addBg !== m.sameBg, `${theme} added and removed rows have their own tints`);
    check(m.diffString && m.diffString !== m.plain, `${theme} diff code takes syntax colours`);
    check(m.tsKeyword && m.tsKeyword !== m.plain && m.tsComment && m.tsComment !== m.tsKeyword, `${theme} ts keywords and comments are coloured`);
    resizeOffscreen(win, WIDTH, TALL_HEIGHT); // tall enough for both blocks in one picture
    await wait(300);
    // capture() waits before it shoots and the fixture feed can swap the reply out meanwhile; shoot again until the sample survives.
    let pictured = false;
    for (let attempt = 0; attempt < 3 && !pictured; attempt++) {
      await showSample();
      await scrollToCode(js);
      await capture(`code-colours-${theme}`);
      pictured = Boolean(await js("document.getElementById('latest').dataset.replyId === 'code-colours'"));
    }
    check(pictured, `${theme} picture shows the sample reply`);
  }
  resizeOffscreen(win, startWidth, startHeight);
}
