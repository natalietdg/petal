// The Library's token estimate before a run: walks the same chunks the build would read and measures the prompt it
// would send, all locally. No Claude call, nothing written.
import { listEntries } from './library-store';
import { DIGEST_CHARS, MAX_CHUNKS_PER_RUN, loadOffsets, promptOf, runChunks, runWants, type SessionTarget } from './library-extract';
import { NO_ESTIMATE, addEstimates, estimateCalls, perSessionRange, type CallText, type TokenEstimate } from '../shared/library-cost';

type Wants = { library: boolean; lessons: boolean };

// The instructions around each digest, as the build would send them now.
function promptChars(wants: Wants): number {
  const categories = wants.library ? listEntries().map((e) => e.category) : [];
  return promptOf(wants, '', categories).length;
}

// One call per chunk with something to say, from the session's saved offset.
export function sessionCalls(target: SessionTarget, prompt: number, offset = loadOffsets()[target.sessionId]?.offset ?? 0): CallText[] {
  return [...runChunks(target.transcript, offset)].filter((c) => c.digest).map((c) => ({ digestChars: c.digest.length, promptChars: prompt }));
}

// force: an explicit click (Read past sessions, Add to Library), which reads the Library even with Build my Library off.
export function estimateSessions(targets: readonly SessionTarget[], { force = true }: { force?: boolean } = {}): TokenEstimate {
  const wants = runWants(force);
  if (!wants.library && !wants.lessons) return NO_ESTIMATE;
  const prompt = promptChars(wants);
  return targets.reduce((sum, target) => addEstimates(sum, estimateCalls(sessionCalls(target, prompt))), NO_ESTIMATE);
}

// Build my Library's per-session range, for its setting: one short call up to the per-run cap of full ones.
export const autoBuildRange = (): { low: number; high: number } =>
  perSessionRange({ maxCalls: MAX_CHUNKS_PER_RUN, digestChars: DIGEST_CHARS, promptChars: promptChars({ library: true, lessons: false }) });
