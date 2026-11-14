// "Will Petal use my tokens?" for people worried about cost. Every line is checked against the code, see AUDIT for the evidence.
import { styleTokenRange } from './petal-style-choices';

export const TOKEN_TITLE = 'Will Petal use my tokens?';

export const tokenLead = (): string => 'Petal itself makes no calls to Claude. It reads the replies Claude Code already saves on this Mac.';

export function styleLine(): string {
  const { low, high } = styleTokenRange();
  return `A Petal reply style adds about ${low.toLocaleString('en-US')} to ${high.toLocaleString('en-US')} tokens of instructions to every turn, and replies run a little longer. Turn it off in Customize › Formatting.`;
}

// What starts Claude on your plan, and how to turn each off.
export const TOKEN_USERS: readonly { what: string; off: string }[] = [
  { what: 'Organizer, which names and tags sessions in the background', off: 'Off unless you turn it on. Customize › Organizer, Name and tidy sessions with Claude.' },
  { what: 'Build my Library and Learn lessons, after each session ends', off: 'Both off unless you turn them on. Same page.' },
  { what: 'Testing loop and its fixer agents', off: 'Start only when you click. Once running, agents pick work back up by themselves. Stop loop, then Close agents.' },
  { what: 'Add to Library, Read past sessions, Explain every function, Is main safe, Propose deploy order, Create flow', off: 'Only when you click them.' },
];

export const TOKEN_OWN = 'Your own sessions, and anything you type into them like conclude, use your plan as they would in any terminal.';
