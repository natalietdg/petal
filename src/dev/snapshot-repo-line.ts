// Repo line: the fixture session gets a cwd inside a scratch repo; the reader names it, follows a branch switch, and keeps it pinned while scrolled.
import fs from 'node:fs';
import path from 'node:path';
import type { Kit } from './snapshot';
import type { ReaderFeed } from '../main/reader-feed';

const LOOKS: [reading: string, theme: string][] = [['newspaper', 'paleSky'], ['editorial', 'paleSky'], ['print', 'paleSky'], ['print', 'nightPastel'], ['newspaper', 'nightPastel']];

const LINE = `(() => {
  const line = document.getElementById('reader-repo');
  const reader = document.getElementById('reader');
  const style = getComputedStyle(line);
  return {
    text: line.textContent,
    shown: !line.hidden && line.getBoundingClientRect().height > 0,
    offsetFromTop: Math.round(line.getBoundingClientRect().top - reader.getBoundingClientRect().top),
    scrollTop: Math.round(reader.scrollTop),
    scrollable: reader.scrollHeight - reader.clientHeight,
    bg: style.backgroundColor,
    font: style.fontFamily,
  };
})()`;

export async function repoLineCheck(kit: Kit, { feed }: { feed: ReaderFeed }): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} repo line: ${what}`);
  if (!feed.fixture) throw new Error('repo line check: no fixture feed');

  // Toplevel petal-fixture, followed from a subfolder, as Claude often runs below the root.
  const repo = path.join(kit.outDir, 'repo-line', 'petal-fixture');
  const head = path.join(repo, '.git', 'HEAD');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.dirname(head), { recursive: true });
  fs.writeFileSync(head, 'ref: refs/heads/reader-polish\n');
  feed.fixture.cwd = path.join(repo, 'src');

  const textIs = (want: string) => waitFor(async () => {
    const now = await js(LINE);
    return now.shown && now.text === want ? now : null;
  }, 5000);
  const first = await textIs('petal-fixture · reader-polish');
  check(first, `names the fixture repo and branch: ${JSON.stringify(first ?? await js(LINE))}`);

  fs.writeFileSync(head, 'ref: refs/heads/main\n');
  const switched = await textIs('petal-fixture · main');
  check(switched, `follows a branch switch on the tick: ${JSON.stringify(switched ?? await js(LINE))}`);

  for (const [reading, theme] of LOOKS) {
    applyTheme(theme, { persist: false });
    await js(`window.pastel.look.setReading(${JSON.stringify(reading)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === reading, 3000);
    await wait(300);
    await js("document.getElementById('reader').scrollTop = 0");
    const top = await js(LINE);
    await js("(() => { const r = document.getElementById('reader'); r.scrollTop = Math.min(700, r.scrollHeight - r.clientHeight); })()");
    await wait(200);
    const scrolled = await js(LINE);
    const sticky = scrolled.scrollTop > 100 && Math.abs(scrolled.offsetFromTop - top.offsetFromTop) <= 1 && scrolled.shown;
    check(sticky, `${reading}/${theme} stays put in the header when scrolled ${scrolled.scrollTop}px (at rest ${top.offsetFromTop}px from the reader top): ${JSON.stringify(scrolled)}`);
    await capture(`repo-line-${reading}-${theme}`);
  }

  // Back to no cwd: the line goes away with it.
  delete feed.fixture.cwd;
  const gone = await waitFor(async () => (await js("document.getElementById('reader-repo').hidden")) || null, 5000);
  check(gone, 'hidden again without a cwd');
  applyTheme('paleSky', { persist: false });
  await js("window.pastel.look.setReading('newspaper')");
  await js("document.getElementById('reader').scrollTop = 0");
}
