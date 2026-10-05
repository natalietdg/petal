// Turns an extracted flow into `flowchart TD` Mermaid source that always parses.
const EXPORT_CAP = 40;
const OUTCOME_TITLES = { done: 'Done', decide: 'Decide', watch: 'Watch out', next: 'Next' };

// Characters that break Mermaid labels even inside quotes are replaced, never escaped.
const safe = (text, max = 60) => {
  const flat = String(text).replace(/["[\]{}|<>`#;]/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function classDefs(labels, reader) {
  const def = (name, { pill, ink }) => `  classDef ${name} fill:${pill},stroke:${ink},color:${reader.foreground}`;
  return [
    `  classDef step fill:${reader.codeBackground},stroke:${reader.rule},color:${reader.foreground}`,
    `  classDef quiet fill:${reader.background},stroke:${reader.rule},color:${reader.muted},stroke-dasharray:4 3`,
    ...Object.keys(OUTCOME_TITLES).map((name) => def(name, labels[name])),
  ];
}

// Runs of steps with no outcomes collapse into one node.
function groupQuiet(steps) {
  const groups = [];
  for (const step of steps) {
    const last = groups.at(-1);
    const quiet = step.quiet || (!(step.changes?.length) && !step.waitingOnYou);
    if (quiet && last?.quiet) last.steps.push(step);
    else groups.push(quiet ? { quiet: true, steps: [step] } : { quiet: false, step });
  }
  return groups;
}

function toMermaid(flow, theme, { all = false } = {}) {
  const total = flow.steps.length;
  const steps = all ? flow.steps : flow.steps.slice(-EXPORT_CAP);
  const lines = ['flowchart TD', ...classDefs(theme.reader.labels, theme.reader)];
  let previous = null;

  groupQuiet(steps).forEach((group, i) => {
    const id = `s${i + 1}`;
    if (group.quiet) {
      const count = group.steps.length;
      lines.push(`  ${id}["${count} step${count === 1 ? '' : 's'} with no changes"]:::quiet`);
    } else {
      const { step } = group;
      lines.push(`  ${id}["${step.index}. ${safe(step.title || step.label, 60)}"]:::step`);
      (step.changes ?? []).forEach((change, j) => {
        const text = `${change.what ? `${change.what}: ` : ''}${change.from ? `${change.from} → ` : ''}${change.to}`;
        lines.push(`  ${id}_${j + 1}["${safe(text, 80)}"]:::done`);
        lines.push(`  ${id} -.- ${id}_${j + 1}`);
      });
      if (step.waitingOnYou) {
        const decide = step.outcomes.filter((o) => o.label === 'decide').at(-1);
        if (decide) { lines.push(`  ${id}_d["Decide: ${safe(decide.text, 70)}"]:::decide`, `  ${id} -.- ${id}_d`); }
      }
    }
    if (previous) lines.push(`  ${previous} --> ${id}`);
    previous = id;
  });

  return { source: `${lines.join('\n')}\n`, total, exported: steps.length, capped: !all && total > EXPORT_CAP };
}

module.exports = { toMermaid, EXPORT_CAP };
