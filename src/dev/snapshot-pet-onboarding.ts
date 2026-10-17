// Dev-only snapshot step: the pet's setup guide on a brand-new install (PASTEL_SNAPSHOT_MODE=pet-onboarding, fresh PASTEL_SNAPSHOT_DIR).
// Fixture state only: a stand-in Claude folder, a faked install check, a stand-in process named claude that prints
// Claude Code's real first-run screen, and a session file and log the harness writes. Never a real claude or ~/.claude.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import * as configStore from '../main/config-store';
import { claudeFixture, claudeStarts, folderFixture, historyFixture } from '../main/snapshot-mode';
import { harnessLine } from '../main/snapshot-shell';
import { resizeOffscreen } from '../main/snapshot-window';
import { transcriptPath } from '../main/claude-session';
import { send } from '../main/ipc';
import { READING_CHOICES } from '../main/menu';
import type { ActiveSession } from '../main/tab-session';
import type { Kit } from './snapshot';

const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash'; // code.claude.com/docs/en/setup
const EXAMPLE_ASK = 'what’s in this folder?';
const THEME_SCREEN = 'test/fixtures/screens/firstrun-theme-18rows.txt';
const SESSION_ID = 'eeeeeeee-0000-4000-8000-0000000000aa';
const SESSION_CWD = '/tmp/petal-onboard';
const WIDTHS = [800, 1280, 1600];
const HEIGHT = 900;
const DEFAULT_SHOTS = '/private/tmp/claude-501/-Users-natalieleong/091d078c-ab24-4c62-aeac-05a980d6184f/scratchpad/onboard';

// Everything the guide shows, read off the page.
const STATE = `(() => {
  const view = document.getElementById('pet-guide');
  const bubble = document.getElementById('pet-bubble');
  const card = view.querySelector('.pg-card');
  const rect = (e) => { if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const pointer = document.querySelector('.pet-pointer');
  return {
    overlay: PastelTerm.overlays.current(),
    step: PastelTerm.petGuide.current(),
    card: view.hidden ? null : card?.dataset.step ?? null,
    title: view.querySelector('.pg-title')?.textContent ?? null,
    line: view.querySelector('.pg-line')?.textContent ?? null,
    said: view.querySelector('.pg-said-line')?.textContent ?? null,
    buttons: [...view.querySelectorAll('footer button')].map((b) => b.textContent),
    hello: view.querySelectorAll('.pg-hello-pet svg rect').length > 0 ? view.querySelectorAll('.pg-hello-pet').length : 0,
    pets: [...view.querySelectorAll('.pg-pet')].map((b) => ({ id: b.dataset.pet, name: b.querySelector('.pg-pet-name')?.textContent, line: b.querySelector('.pg-pet-line')?.textContent, on: b.getAttribute('aria-checked') === 'true', picture: Boolean(b.querySelector('svg rect')) })),
    scenes: [...view.querySelectorAll('.pg-scene')].map((b) => ({ id: b.dataset.scene, on: b.getAttribute('aria-checked') === 'true', rects: b.querySelectorAll('.pg-thumb .scene rect').length, pet: Boolean(b.querySelector('.pg-thumb-pet svg rect')) })),
    bubble: bubble.hidden ? null : {
      step: bubble.dataset.step, tail: bubble.dataset.tail, name: bubble.querySelector('.pb-name')?.textContent ?? null,
      say: bubble.querySelector('.pb-say')?.textContent ?? null, note: bubble.querySelector('.pb-note')?.textContent ?? null,
      chip: bubble.querySelector('.pg-chip code')?.textContent ?? null, copy: bubble.querySelector('.pg-copy')?.dataset.copy ?? null,
      buttons: [...bubble.querySelectorAll('.pb-actions button')].map((b) => b.textContent), rect: rect(bubble),
    },
    targets: [...document.querySelectorAll('.pg-target')].map((e) => e.id),
    targetRect: rect(document.querySelector('.pg-target')),
    pointer: pointer.hidden ? null : { dir: pointer.dataset.dir, rect: rect(pointer), animation: getComputedStyle(pointer).animationName },
    party: (() => { const p = document.querySelector('.pet-party'); return p.hidden ? null : { bits: p.children.length, still: p.classList.contains('still'), animation: p.firstElementChild ? getComputedStyle(p.firstElementChild).animationName : null }; })(),
    focus: document.activeElement ? (document.activeElement.id || document.activeElement.className || document.activeElement.tagName) : null,
    focusInBubble: bubble.contains(document.activeElement),
    announced: document.querySelector('.pet-announcer')?.textContent ?? '',
    cat: document.getElementById('cat').dataset.cat,
    scene: document.getElementById('cat').dataset.scene,
    catShown: document.getElementById('cat').getClientRects().length > 0,
    preview: (() => { const p = document.querySelector('#pet-guide:not([hidden]) .pg-preview'); return p ? { cat: p.querySelector('.cat-portrait')?.dataset.cat, scene: Boolean(p.querySelector('.scene')), rects: p.querySelectorAll('rect').length } : null; })(),
    catRect: rect(document.querySelector('#cat .cat-sprite')),
    composer: document.getElementById('composer-input').value,
    tabs: PastelTerm.tabs.ids(),
    emDashes: ((view.hidden ? '' : view.innerText) + (bubble.hidden ? '' : bubble.innerText)).split('—').length - 1,
  };
})()`;

// WCAG contrast of every text in the guide against the background it sits on.
const CONTRAST = `(() => {
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
  const sel = '#pet-guide:not([hidden]) :is(.pg-title, .pg-line, .pg-dots-text, .pg-pet-name, .pg-pet-line, .pg-scene-name, .pg-said-line, .pg-more summary, .consent-reads li, .consent-line, .pg-primary, .pg-secondary, .pg-skip), #pet-bubble:not([hidden]) :is(.pb-name span, .pb-say, .pb-note, .pg-chip code, .pg-copy, .pb-actions button)';
  const rows = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => ({ what: e.className || e.tagName, ratio: Math.round(ratio(rgb(getComputedStyle(e).color), bgOf(e)) * 100) / 100 }));
  return { checked: rows.length, worst: rows.sort((a, b) => a.ratio - b.ratio).slice(0, 3) };
})()`;

// Nothing wider than the window, nothing in the card running under the pet's corner, the bubble inside the window.
const FIT = `(() => {
  const view = document.getElementById('pet-guide');
  const pageScroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const preview = document.querySelector('#pet-guide:not([hidden]) .pg-preview');
  const cat = (preview || document.getElementById('cat')).getBoundingClientRect();
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const out = { width: window.innerWidth, pageScroll, sticking: [], underPet: [], bubbleOut: false };
  if (!view.hidden) {
    const card = view.querySelector('.pg-card');
    const box = card.getBoundingClientRect();
    out.cardScrollX = card.scrollWidth - card.clientWidth;
    out.sticking = [...view.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1) && !e.closest('.pg-footer, .pg-preview'); }).slice(0, 4).map((e) => e.className || e.tagName);
    const shown = Boolean(preview) || document.getElementById('cat').getClientRects().length > 0;
    out.underPet = shown ? [...view.querySelectorAll('button, .pg-title, .pg-line, .pg-said-line')].filter((e) => overlaps(e.getBoundingClientRect(), cat)).slice(0, 4).map((e) => e.className || e.tagName) : [];
  }
  const bubble = document.getElementById('pet-bubble');
  if (!bubble.hidden) {
    const r = bubble.getBoundingClientRect();
    out.bubbleOut = r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight;
    const target = document.querySelector('.pg-target');
    out.coversTarget = Boolean(target) && !['terminal-pane'].includes(target.id) && overlaps(r, target.getBoundingClientRect());
  }
  return out;
})()`;

const assistantLine = (text: string) => `${JSON.stringify({ type: 'assistant', uuid: `po-a-${Date.now()}`, timestamp: new Date().toISOString(), isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;
const userLine = (text: string) => `${JSON.stringify({ type: 'user', uuid: `po-u-${Date.now()}`, timestamp: new Date().toISOString(), isSidechain: false, message: { role: 'user', content: text } })}\n`;

// any: the probes' shapes are built in the scripts above.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function petOnboardingCheck(kit: Kit, { win, activeSession }: { win: BrowserWindow; activeSession: ActiveSession }): Promise<void> {
  const { js, log, wait, waitFor, capture, themes, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} pet onboarding: ${what}`);
  const state = (): Promise<any> => js(STATE);
  const until = (test: (s: any) => boolean, ms = 8000) => waitFor(async () => { const s = await state(); return test(s) ? s : null; }, ms);
  const shotsDir = process.env.PETAL_ONBOARD_SHOTS || DEFAULT_SHOTS;
  fs.mkdirSync(shotsDir, { recursive: true });
  const shot = async (name: string) => {
    await capture(`onboard-${name}`);
    fs.copyFileSync(path.join(outDir, `snapshot-onboard-${name}.png`), path.join(shotsDir, `${name}.png`));
  };
  const contrastOk = async (where: string) => {
    const c = await js(CONTRAST);
    check(c.checked > 0 && c.worst.every((row: { ratio: number }) => row.ratio >= 4.5), `${where}: every text in the guide is at least 4.5:1 (${c.checked} checked): ${JSON.stringify(c.worst)}`);
  };
  const fitsAtEveryWidth = async (where: string) => {
    for (const width of WIDTHS) {
      resizeOffscreen(win, width, HEIGHT);
      await wait(700);
      const fit = await js(FIT);
      check(fit.pageScroll <= 0 && !fit.cardScrollX && fit.sticking.length === 0 && fit.underPet.length === 0 && !fit.bubbleOut && !fit.coversTarget,
        `${where} at ${width}px: no overflow, nothing under the pet, the bubble in the window and off its target: ${JSON.stringify(fit)}`);
      if (width !== 1280) await capture(`onboard-${where}-${width}`);
    }
    resizeOffscreen(win, 1280, HEIGHT);
    await wait(600);
  };
  const everyLook = async (where: string) => {
    for (const id of Object.keys(themes)) {
      applyTheme(id, { persist: false });
      await wait(450);
      await contrastOk(`${where} in ${id}`);
      await capture(`onboard-${where}-${id}`);
    }
    applyTheme('paleSky', { persist: false });
    for (const [reading] of READING_CHOICES) {
      await js(`document.documentElement.dataset.reading = ${JSON.stringify(reading)}`);
      await wait(300);
      const fit = await js(FIT);
      check(fit.pageScroll <= 0 && fit.sticking.length === 0 && !fit.bubbleOut, `${where} in the ${reading} reading style fits: ${JSON.stringify(fit)}`);
      await capture(`onboard-${where}-reading-${reading}`);
    }
    await js("document.documentElement.dataset.reading = 'newspaper'");
    await wait(200);
  };

  // A stand-in Claude folder, empty: no past sessions, nothing to read until a session file appears.
  const home = path.join(outDir, 'fake-claude-onboard');
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  folderFixture.home = home;
  historyFixture.records.splice(0);
  claudeFixture.installed = false; // the PATH-missing branch first
  await js('PastelTerm.getStarted.recheckInstall()');

  // 1. A brand-new install opens on the hello card, and the old welcome never shows.
  const hello = await until((s) => s.card === 'welcome', 15000);
  check(hello && hello.overlay === 'pet-guide' && hello.title === 'Hi! Let’s set up Petal.' && hello.hello === 5 && hello.buttons.join() === 'Start,Skip setup' && hello.emDashes === 0,
    `fresh install shows "Hi! Let’s set up Petal." with five pets, Start and Skip setup: ${JSON.stringify(hello && { overlay: hello.overlay, title: hello.title, line: hello.line, hello: hello.hello, buttons: hello.buttons })}`);
  const saved0 = configStore.load();
  check(saved0.onboarding.step === 'welcome' && saved0.welcome.seen && saved0.claudeFolder.choice === 'unasked', `the hello card is saved as the step to resume, the old welcome marked seen, the folder unasked: ${JSON.stringify({ onboarding: saved0.onboarding, welcome: saved0.welcome, folder: saved0.claudeFolder })}`);
  check(hello?.focus === 'pg-primary pg-next' && /Hi! Let’s set up Petal/.test(hello.announced), `focus on Start, the card announced: ${JSON.stringify({ focus: hello?.focus, announced: hello?.announced })}`);
  await shot('01-welcome');
  await fitsAtEveryWidth('welcome');

  // 2. Pick your pet: five portraits with a line each; picking Miki changes the corner pet live.
  await js("document.querySelector('#pet-guide .pg-next').click()");
  const pets = await until((s) => s.card === 'pet');
  const names = pets?.pets.map((p: { name: string }) => p.name).join();
  check(names === 'Mika,Miki,Kira,Hoshi,Corgi' && pets.pets.every((p: { picture: boolean; line: string }) => p.picture && p.line) && pets.pets.find((p: { on: boolean }) => p.on)?.id === 'mika',
    `pet card: five pets with portraits and lines, Mika picked: ${JSON.stringify(pets?.pets)}`);
  check(pets?.preview?.cat === 'mika' && pets.preview.rects > 0, `the corner preview shows Mika while the card covers the reader: ${JSON.stringify(pets?.preview)}`);
  await js("document.querySelector('#pet-guide .pg-pet[data-pet=\"miki\"]').click()");
  const miki = await until((s) => s.cat === 'miki' && s.preview?.cat === 'miki' && s.pets.find((p: { on: boolean }) => p.on)?.id === 'miki');
  check(miki && miki.line === 'Miki will show you around. He sits in the corner while you work.' && miki.pets.find((p: { id: string }) => p.id === 'miki').line === 'Miki brings his red ball.',
    `picking Miki previews him in the corner and the copy says he/his: ${JSON.stringify(miki && { cat: miki.cat, line: miki.line })}`);
  await js("document.querySelector('#pet-guide .pg-pet[data-pet=\"miki\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
  const arrowed = await until((s) => s.cat === 'kira');
  check(arrowed, 'arrow keys move the pick like a radio group (Miki to Kira)');
  await js("document.querySelector('#pet-guide .pg-pet[data-pet=\"miki\"]').click()");
  await until((s) => s.cat === 'miki');
  await shot('02-pet');
  await fitsAtEveryWidth('pet');

  // 3. Pick a scene: a thumbnail for each, with Miki in it; picking one changes the corner live.
  await js("document.querySelector('#pet-guide .pg-next').click()");
  const scenesUp = await until((s) => s.card === 'scene');
  const allThumbs = scenesUp?.scenes.filter((s: { id: string }) => s.id !== 'none').every((s: { rects: number; pet: boolean }) => s.rects > 50 && s.pet);
  check(scenesUp && scenesUp.scenes.length === 13 && allThumbs && scenesUp.line?.startsWith('Where should Miki hang out? He tries'),
    `scene card: 13 thumbnails, each scene drawn with Miki in it: ${JSON.stringify(scenesUp && { count: scenesUp.scenes.length, line: scenesUp.line, sample: scenesUp.scenes.slice(0, 3) })}`);
  const borrowed = await js("getComputedStyle(document.querySelector('#pet-guide .pg-scene[data-scene=\"winter\"] .scene rect')).fill");
  check(borrowed && borrowed !== 'rgb(0, 0, 0)', `thumbnails borrow the scene colours: winter's first cell is ${borrowed}`);
  await js("document.querySelector('#pet-guide .pg-scene[data-scene=\"cherry\"]').click()");
  const cherry = await until((s) => s.scene === 'cherry' && s.preview?.scene && s.scenes.find((x: { on: boolean }) => x.on)?.id === 'cherry');
  check(cherry, `picking Cherry Blossom Picnic shows it behind the pet: ${JSON.stringify(cherry && cherry.scene)}`);
  await shot('03-scene');
  await fitsAtEveryWidth('scene');

  // 4. The folder question, said by the pet; Allow saves it exactly as the old question did.
  await js("document.querySelector('#pet-guide .pg-next').click()");
  const asked = await until((s) => s.card === 'consent');
  check(asked && asked.said === 'I read Claude’s replies from your Claude folder on this Mac. Nothing leaves it.' && asked.buttons.join() === 'Allow,Not now,Skip setup' && asked.focus === 'pet-guide',
    `folder card: the pet's one line, Allow and Not now, focus on the card not Allow: ${JSON.stringify(asked && { said: asked.said, buttons: asked.buttons, focus: asked.focus })}`);
  await shot('04-consent');
  await contrastOk('folder card');
  await fitsAtEveryWidth('consent');
  await js("document.querySelector('#pet-guide .pg-allow').click()");
  const allowed = await waitFor(() => (configStore.load().claudeFolder.choice === 'allowed' ? true : null), 5000);
  check(allowed, 'Allow saves claudeFolder.choice = allowed');

  // 5. The bubble: Add Session, pointed at and pulsing; focus on it; the bubble never covers it.
  const add = await until((s) => s.bubble?.step === 'add-session');
  check(add && add.overlay === null && add.bubble.say === 'Click Add Session' && add.bubble.name === 'Miki' && add.targets.join() === 'add-session-button' && add.focus === 'add-session-button',
    `the bubble says Click Add Session, the button pulses in its ring and has focus: ${JSON.stringify(add && { bubble: add.bubble, targets: add.targets, pointer: add.pointer, focus: add.focus })}`);
  check(add && /Miki says: Click Add Session/.test(add.announced), `screen readers hear it: ${JSON.stringify(add?.announced)}`);
  check(configStore.load().onboarding.step === 'add-session', `the bubble step is saved: ${configStore.load().onboarding.step}`);
  await shot('05-add-session');
  await contrastOk('Add Session bubble');
  await fitsAtEveryWidth('add-session');
  await everyLook('add-session');

  // 6. Add Session with claude missing from the tab's PATH: the install line and Check again; then found: type claude.
  const startsBefore = claudeStarts.length;
  await js("document.getElementById('add-session-button').click()");
  const missing = await until((s) => s.bubble?.step === 'type-claude' && s.tabs.length === 2);
  check(missing && missing.bubble.say === 'Claude Code isn’t installed yet' && missing.bubble.chip === INSTALL_COMMAND && missing.bubble.copy === INSTALL_COMMAND && missing.bubble.buttons.includes('Check again') && claudeStarts.length === startsBefore,
    `claude not found: the official install line with Copy and Check again, nothing typed: ${JSON.stringify(missing?.bubble)}`);
  check(missing?.pointer?.animation === 'pg-point', `the arrow bobs when motion is allowed: ${missing?.pointer?.animation}`);
  check(missing?.targets.join() === 'terminal-pane' && missing.pointer?.dir === 'down' && missing.focus === 'pg-copy', `it points at the terminal and focus is on Copy: ${JSON.stringify(missing && { targets: missing.targets, pointer: missing.pointer, focus: missing.focus })}`);
  await shot('06b-install');
  await contrastOk('install bubble');
  claudeFixture.installed = true;
  await js("document.querySelector('#pet-bubble .pb-recheck').click()");
  const typeIt = await until((s) => s.bubble?.say === 'Now type claude and press Enter');
  check(typeIt && typeIt.bubble.chip === 'claude' && typeIt.bubble.copy === 'claude' && typeIt.focus === 'pg-copy', `Check again finds claude: "Now type claude and press Enter" with a claude chip, Copy focused: ${JSON.stringify(typeIt?.bubble)}`);
  await shot('06-type-claude');
  await fitsAtEveryWidth('type-claude');

  // 7. "claude" runs: Claude Code's first-run screen in the tab and its card in the reader; the pet waits, keys stay with Claude.
  const session = activeSession(win.webContents.id);
  if (!session) throw new Error('pet onboarding: no active tab');
  const bin = path.join(outDir, 'onboard-bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync('/bin/sleep', path.join(bin, 'claude'));
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  execFileSync('codesign', ['-s', '-', '-f', path.join(bin, 'claude')]); // a copied system binary is killed until re-signed
  session.pty.write(harnessLine(`clear; cat '${path.join(app.getAppPath(), THEME_SCREEN)}'; '${path.join(bin, 'claude')}' 600`));
  const setup = await until((s) => s.bubble?.step === 'claude-setup', 15000);
  const card = await waitFor(() => js("(() => { const c = document.querySelector('.menu-card'); return c && !c.hidden ? c.querySelector('.qc-text')?.textContent : null; })()"), 8000);
  check(setup && setup.bubble.say === 'Pick a style and sign in, I’ll wait' && setup.bubble.note === 'Miki is waiting for you.' && !setup.focusInBubble,
    `Claude's first-run screens: "Pick a style and sign in, I’ll wait", Miki is waiting, focus left with Claude: ${JSON.stringify(setup && { bubble: setup.bubble, focus: setup.focus })}`);
  check(card === 'Choose the text style that looks best with your terminal', `the reader shows Claude's style picker as a card: ${JSON.stringify(card)}`);
  const cardClear = await js("(() => { const a = document.querySelector('.menu-card').getBoundingClientRect(); const b = document.getElementById('pet-bubble').getBoundingClientRect(); return !(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom); })()");
  check(cardClear, 'the bubble keeps clear of Claude’s style card');
  await shot('07-claude-setup');
  await contrastOk('waiting bubble');

  // 8. Signed in: a session file and an empty log. The pet asks for a first message; the example waits in the reply box.
  const pid = session.feed.claudePid;
  if (!pid) throw new Error('pet onboarding: the stand-in claude was not seen');
  fs.writeFileSync(path.join(home, 'sessions', `${pid}.json`), JSON.stringify({ sessionId: SESSION_ID, cwd: SESSION_CWD, kind: 'interactive', status: 'idle' }));
  const log1 = transcriptPath({ cwd: SESSION_CWD, sessionId: SESSION_ID });
  fs.mkdirSync(path.dirname(log1), { recursive: true });
  fs.writeFileSync(log1, '');
  const ask = await until((s) => s.bubble?.step === 'ask', 10000);
  check(ask && ask.bubble.say === `Ask Claude anything, like ‘${EXAMPLE_ASK}’` && ask.composer === EXAMPLE_ASK && ask.focus === 'composer-input' && ask.targets.join() === 'composer',
    `live, no reply yet: the ask bubble, the example ready in the reply box with focus there: ${JSON.stringify(ask && { bubble: ask.bubble, composer: ask.composer, focus: ask.focus, targets: ask.targets })}`);
  await shot('07b-ask');
  await fitsAtEveryWidth('ask');

  // 9. The first reply: a short party (still, with reduced motion), "That’s it! Replies show up here.", saved as done.
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await js("document.getElementById('composer-input').value = ''"); // she'd have sent it; the harness writes the turn itself
  fs.appendFileSync(log1, userLine(EXAMPLE_ASK) + assistantLine('**This folder holds one project, Petal.**\n\nIt has a `src` folder and a README.'));
  const party = await until((s) => s.bubble?.step === 'celebrate', 10000);
  check(party && party.bubble.say === 'That’s it! Replies show up here.' && party.bubble.buttons.join() === 'Yay!' && party.focus === 'pb-done' && configStore.load().onboarding.step === 'done',
    `first reply: the celebration, Yay! focused, onboarding saved as done: ${JSON.stringify(party && { bubble: party.bubble, focus: party.focus, saved: configStore.load().onboarding })}`);
  check(party?.party?.still && party.party.animation === 'none', `reduced motion: the hearts sit still: ${JSON.stringify(party?.party)}`);
  const stillPointer = await js("getComputedStyle(document.querySelector('.pet-pointer')).animationName");
  check(stillPointer === 'none', `reduced motion: the arrow stops bobbing: ${stillPointer}`);
  await shot('08-done');
  await contrastOk('celebration');
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  dbg.detach();
  await js("document.querySelector('#pet-bubble .pb-done').click()");
  const ended = await until((s) => s.step === null && s.bubble === null && s.targets.length === 0);
  check(ended && configStore.load().onboarding.step === 'done', 'Yay! ends the guide and clears the highlight');
  check((await js('PastelTerm.launchScreens.show()')) === false && (await state()).overlay === null, 'done: the next launch shows nothing, no checklist either');

  // 10. Help › Show setup again restarts from the hello card; Esc skips; Skip setup in a bubble skips too.
  send(win.webContents, 'pet-guide:open');
  const again = await until((s) => s.card === 'welcome');
  check(again, 'Help › Show setup again opens the hello card');
  await js("document.querySelector('#pet-guide .pg-next').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  const escaped = await until((s) => s.step === null && s.overlay === null);
  check(escaped && configStore.load().onboarding.step === 'skipped' && configStore.load().claudeFolder.choice === 'allowed', `Esc on a card skips setup and keeps the folder answer: ${JSON.stringify(configStore.load().onboarding)}`);
  send(win.webContents, 'pet-guide:open');
  await until((s) => s.card === 'welcome');
  for (const next of ['pet', 'scene']) {
    await js("document.querySelector('#pet-guide .pg-next').click()");
    await until((s) => s.card === next);
  }
  await js("document.querySelector('#pet-guide .pg-next').click()");
  const resumed = await until((s) => s.bubble?.step === 'ask');
  check(resumed && resumed.card === null, `with the folder answered, the cards go straight to the bubble, which follows the live session: ${JSON.stringify(resumed?.bubble?.step)}`);
  await shot('09-skip-from-bubble');
  await js("document.querySelector('#pet-bubble .pb-skip').click()");
  const skipped = await until((s) => s.step === null && s.bubble === null);
  check(skipped && configStore.load().onboarding.step === 'skipped', 'Skip setup in the bubble ends the guide');
  check((await js('PastelTerm.launchScreens.show()')) === false, 'skipped: the next launch shows nothing');

  // 11. Resume: a relaunch mid-cards comes back to the same card.
  configStore.save({ onboarding: { step: 'scene' } });
  check(await js('PastelTerm.launchScreens.show()'), 'saved at the scene card: launch resumes there');
  const back = await until((s) => s.card === 'scene');
  check(back, 'the scene card is back');
  await js("document.querySelector('#pet-guide .pg-skip').click()");
  await until((s) => s.step === null);

  // 12. An existing install never sees it: its config.json predates onboarding.
  const configPath = path.join(app.getPath('userData'), 'config.json');
  const savedConfig = fs.readFileSync(configPath, 'utf8');
  fs.writeFileSync(configPath, JSON.stringify({ welcome: { seen: true }, claudeFolder: { choice: 'allowed' }, getStarted: { done: ['add-session', 'sign-in', 'ask'] } }));
  const existing = configStore.load();
  check(existing.onboarding.step === 'existing', `an older config.json loads as existing: ${existing.onboarding.step}`);
  const shown = await js('PastelTerm.launchScreens.show()');
  await wait(600);
  const quiet = await state();
  check(!quiet.step && quiet.overlay !== 'pet-guide' && quiet.bubble === null, `existing install: launch never shows the guide: ${JSON.stringify({ shown, step: quiet.step, overlay: quiet.overlay })}`);
  await js('PastelTerm.overlays.hideCurrent()');
  fs.writeFileSync(configPath, savedConfig);

  session.pty.write('\x03');
  folderFixture.home = null;
}
