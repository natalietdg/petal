// What a launch shows over the first tab: on a new install the pet's setup guide; on an older one the folder question (once),
// the welcome (once), then Get started until done.
import * as consent from './consent';
import * as petGuide from './pet-guide';
import * as welcome from './welcome';
import * as getStarted from './get-started';

async function afterConsent(): Promise<boolean> {
  return (await welcome.openIfFirstRun()) || (!petGuide.endedHere() && getStarted.openIfIncomplete());
}

// True when a screen came up; the folder question doesn't wait for her answer to report it.
export async function show(): Promise<boolean> {
  if (await petGuide.resumeIfStarted()) return true;
  if ((await consent.choice()) === 'unasked') {
    consent.open(() => void afterConsent());
    return true;
  }
  return afterConsent();
}
