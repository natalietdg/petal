// A "## Steps" section is what she does in order: its numbered lists render as tickable step rows.

// "Steps", "Steps to deploy", "3. Steps", any case; the number is what wrapStory leaves in front.
const STEPS_HEADING = /^(?:\d+[.)]\s*)?steps(?:\s+to\b.*)?$/i;
export const isStepsHeading = (text: string): boolean => STEPS_HEADING.test(text.trim().replace(/:$/, '').trim());

// "Check: it opens" (label bold or not) says how to tell a step worked.
const CHECK_LABEL = /^\s*check\s*:\s*/i;
export const isCheckLine = (text: string): boolean => CHECK_LABEL.test(text);
export const stripCheckLabel = (text: string): string => text.replace(CHECK_LABEL, '');

// Where a Check line starts inside a step written without a blank line ("Do X\nCheck: Y"); -1 when none.
export function checkLineStart(text: string): number {
  const match = /\n[ \t]*check\s*:/i.exec(text);
  return match ? match.index : -1;
}

// A Steps section's top-level blocks: a numbered list, a Check line, or anything else.
export type StepBlock = 'list' | 'check' | 'other';

// Lists, and Check lines between or after them, join into one run numbered straight through; anything else ends it.
export function stepRuns(blocks: readonly StepBlock[]): number[][] {
  const runs: number[][] = [];
  let run: number[] | null = null;
  blocks.forEach((kind, index) => {
    if (kind === 'list') {
      if (!run) runs.push((run = []));
      run.push(index);
    } else if (kind === 'check' && run) run.push(index);
    else run = null;
  });
  return runs;
}
