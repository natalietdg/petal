// WCAG 2.x contrast check for every theme; exits 1 if any required pair fails.
import { readFileSync } from 'node:fs';

const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;
const BODY_TARGET = 7;
const themes = JSON.parse(readFileSync(new URL('../src/themes.json', import.meta.url)));

const channel = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// HSL lightness in percent; tinted light surfaces must stay at or below 96%.
const lightness = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255) * 100;
};

function terminalChecks(theme) {
  const t = theme.terminal;
  return [
    ['fg', t.foreground, t.background, TEXT_MIN],
    ['fg on selection', t.foreground, t.selectionBackground, TEXT_MIN],
    ['cursor', t.cursor, t.background, NON_TEXT_MIN],
    // ansi 0 (black) on a dark theme is a background colour, never text on bg.
    ...t.ansi.map((hex, i) => [`ansi ${i}`, hex, t.background, theme.dark && i === 0 ? 0 : TEXT_MIN]),
  ];
}

function readerChecks(theme) {
  const r = theme.reader;
  const labelChecks = Object.entries(r.labels).flatMap(([name, l]) => [
    [`${name} pill text`, l.ink, l.pill, TEXT_MIN],
    [`${name} body on wash`, r.foreground, l.wash, TEXT_MIN],
    [`${name} border`, l.ink, r.background, NON_TEXT_MIN],
    [`body on ${name} pill`, r.foreground, l.pill, TEXT_MIN], // mindmap node labels
  ]);
  return [
    ['body', r.foreground, r.background, TEXT_MIN],
    ['muted', r.muted, r.background, TEXT_MIN],
    ['link', r.link, r.background, TEXT_MIN],
    ['code', r.foreground, r.codeBackground, TEXT_MIN],
    ['muted on code', r.muted, r.codeBackground, TEXT_MIN],
    ['link on code', r.link, r.codeBackground, TEXT_MIN],
    ['highlight', r.highlightInk, r.highlight, TEXT_MIN],
    // A conclusion's This session line: its label and dots in done ink, its links in body colour, on the done wash.
    ['conclusion session label', r.labels.done.ink, r.labels.done.wash, TEXT_MIN],
    ['muted on done wash', r.muted, r.labels.done.wash, TEXT_MIN],
    ...labelChecks,
  ];
}

let failed = false;
const fail = (message) => { failed = true; console.log(`  FAIL ${message}`); };

for (const theme of Object.values(themes)) {
  console.log(`\n${theme.label}`);
  for (const [pane, checks] of [['terminal', terminalChecks(theme)], ['reader', readerChecks(theme)]]) {
    let minText = Infinity;
    for (const [name, fg, bg, min] of checks) {
      const r = ratio(fg, bg);
      const status = min === 0 ? 'exempt' : r >= min ? 'ok' : 'FAIL';
      if (status === 'FAIL') failed = true;
      if (min === TEXT_MIN) minText = Math.min(minText, r);
      console.log(`  ${pane.padEnd(8)} ${name.padEnd(20)} ${fg} on ${bg}  ${r.toFixed(2).padStart(5)}:1  ${status}`);
    }
    console.log(`  ${pane} min text ratio: ${minText.toFixed(2)}:1`);
  }

  const body = [theme.terminal.foreground, theme.terminal.background, theme.reader.foreground, theme.reader.background];
  if (ratio(body[0], body[1]) < BODY_TARGET || ratio(body[2], body[3]) < BODY_TARGET) fail(`body text below ${BODY_TARGET}:1 target`);
  if (!theme.dark) {
    for (const bg of [theme.terminal.background, theme.reader.background]) {
      if (lightness(bg) > 96) fail(`${bg} lightness ${lightness(bg).toFixed(1)}% > 96%`);
    }
  }
}
process.exit(failed ? 1 : 0);
