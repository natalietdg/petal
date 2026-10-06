// State changes per step, written by Claude (Haiku) in one call per flow. Falls back to the audit log on any failure.
const { runClaude } = require('./claude-cli');
const configStore = require('./config-store');

// Fixed in code so an edited prompt can never break parseSteps.
const CONTRACT = 'Answer with JSON only: {"steps":[{"i":<index>,"t":"<title>","changes":[{"what":"","from":"","to":""}]}]}';

const promptText = () => `${configStore.load().flowTitles.prompt}\n${CONTRACT}`;

// Pulls {"steps":[...]} out of the reply even if the model wraps it in prose or a fence.
function parseSteps(stdout) {
  const text = String(JSON.parse(stdout).result ?? '');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return new Map(json.steps.map((step) => [Number(step.i), step]));
}

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Without AI, ACTION rows in the audit log are the best record of what changed.
function fallbackChanges(step) {
  return step.audit.filter((row) => row.kind === 'ACTION').map((row) => ({ what: '', from: '', to: clean(row.what, 80) }));
}

async function writeTitles(steps) {
  const wanted = steps.filter((s) => !s.quiet);
  for (const step of steps) step.changes = fallbackChanges(step);
  if (!wanted.length) return { ok: true, count: 0 };
  const payload = wanted.map((s) => ({ i: s.index, asked: s.label, reply: s.excerpt }));
  try {
    const answers = parseSteps(await runClaude(`${promptText()}\n\nSteps:\n${JSON.stringify(payload)}`));
    let count = 0;
    for (const step of wanted) {
      const answer = answers.get(step.index);
      if (!answer) continue;
      if (answer.t && String(answer.t).length <= 80) step.title = clean(answer.t, 80);
      if (Array.isArray(answer.changes)) {
        step.changes = answer.changes
          .map((c) => ({ what: clean(c.what, 40), from: clean(c.from, 60), to: clean(c.to, 60) }))
          .filter((c) => c.to);
      }
      count += 1;
    }
    return { ok: true, count };
  } catch (error) {
    return { ok: false, error: error.message.split('\n')[0] };
  }
}

module.exports = { writeTitles, promptText };
