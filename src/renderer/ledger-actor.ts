// Who a ledger row is attributed to: Claude, external, and any other name is the user.
export type Who = 'you' | 'claude' | 'external';

export function whoOf(actor: string): Who {
  const name = actor.trim().toLowerCase();
  if (name.startsWith('claude')) return 'claude';
  return name.startsWith('external') ? 'external' : 'you';
}
