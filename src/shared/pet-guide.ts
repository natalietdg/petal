// The pet's setup guide for a new install: four cards (five with past sessions to import), then speech-bubble steps that follow
// what Petal sees until the first reply.
import type { FolderChoice } from './claude-folder';
import { rangeText, type BackfillPlan } from './library';
import { estimateText } from './library-cost';
export { INSTALL_COMMAND } from './get-started';

export const CARD_STEPS = ['welcome', 'pet', 'scene', 'consent', 'import'] as const;
export const BUBBLE_STEPS = ['add-session', 'type-claude', 'claude-setup', 'ask', 'celebrate'] as const;
export type CardStep = (typeof CARD_STEPS)[number];
export type BubbleStep = (typeof BUBBLE_STEPS)[number];
export type GuideStep = CardStep | BubbleStep;

// Saved in config onboarding.step: a step to resume at, or how it ended. 'existing' is an install from before the guide.
export const ENDED_STAGES = ['done', 'skipped', 'existing'] as const;
export type GuideStage = GuideStep | (typeof ENDED_STAGES)[number];
const STAGES: readonly string[] = [...CARD_STEPS, ...BUBBLE_STEPS, ...ENDED_STAGES];
export const isGuideStage = (value: unknown): value is GuideStage => typeof value === 'string' && STAGES.includes(value);
export const isCardStep = (step: GuideStage): step is CardStep => (CARD_STEPS as readonly string[]).includes(step);
export const isEnded = (stage: GuideStage): boolean => (ENDED_STAGES as readonly string[]).includes(stage);

// What Petal sees right now, from the tabs (get-started's facts) and the folder answer.
export interface GuideFacts {
  folderChoice: FolderChoice;
  addedSession: boolean; // a tab opened since the bubble said Add Session, or more than the first tab
  claudeRunning: boolean;
  sessionStarted: boolean; // past Claude Code's first-run screens
  replied: boolean;
  pastSessions: number; // History's count of her earlier Claude Code sessions; 0 until the folder is allowed and read
}

// Which bubble shows: the furthest thing Petal has seen happen.
export function bubbleStep(facts: GuideFacts): BubbleStep {
  if (facts.replied) return 'celebrate';
  if (facts.sessionStarted) return 'ask';
  if (facts.claudeRunning) return 'claude-setup';
  if (facts.addedSession) return 'type-claude';
  return 'add-session';
}

// The import card shows only when the folder was allowed and History found sessions from before Petal.
export const showsImport = (folder: FolderChoice, pastSessions: number): boolean => folder === 'allowed' && pastSessions > 0;

// The card after this one; the folder card only while the question is unanswered, then the bubbles take over.
export function nextCard(step: CardStep, folder: FolderChoice, pastSessions = 0): CardStep | 'bubbles' {
  const after = CARD_STEPS.slice(CARD_STEPS.indexOf(step) + 1);
  const next = after.find((card) => (card === 'consent' ? folder === 'unasked' : card === 'import' ? showsImport(folder, pastSessions) : true));
  return next ?? 'bubbles';
}

// The folder question has been answered by the import card, so there is no going back to it.
export const previousCard = (step: CardStep): CardStep | null => (step === 'import' ? null : CARD_STEPS[CARD_STEPS.indexOf(step) - 1] ?? null);

// "Step N of M": four cards, five once the import card is known to show.
export function cardCounter(step: CardStep, folder: FolderChoice, pastSessions: number): { number: number; total: number } {
  const counted = CARD_STEPS.filter((card) => card !== 'import' || step === 'import' || showsImport(folder, pastSessions));
  return { number: counted.indexOf(step) + 1, total: counted.length };
}

// A launch with this saved stage: the step to show, or null when the guide is over or predates this install.
export function resumeAt(stage: GuideStage, facts: GuideFacts): GuideStep | null {
  if (isEnded(stage)) return null;
  if (stage === 'consent' && facts.folderChoice !== 'unasked') return nextCard('consent', facts.folderChoice, facts.pastSessions) === 'import' ? 'import' : bubbleStep(facts);
  if (stage === 'import' && !showsImport(facts.folderChoice, facts.pastSessions)) return bubbleStep(facts);
  return isCardStep(stage) ? stage : bubbleStep(facts);
}

// The celebration is the end: once it shows, the guide never comes back on its own.
export const stageToSave = (step: GuideStep): GuideStage => (step === 'celebrate' ? 'done' : step);

// type-claude: the chip to copy, or the install line when the tab's shell can't find claude.
export const typeClaudeHelp = (claudeFound: boolean): 'type' | 'install' => (claudeFound ? 'type' : 'install');

// Claude's own first-run screens and replies come through the Claude folder; with it off the pet can't see them.
export const blindToClaude = (step: GuideStep, folder: FolderChoice): boolean => folder !== 'allowed' && (step === 'claude-setup' || step === 'ask');

// Words for copy about a pet, as cat.ts petWords gives them.
export interface PetWords {
  name: string;
  they: string; // she / he
  their: string; // her / his
}

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

// One line each in the pet picker; built-in pets only, private ones get a plain line.
const PERSONALITIES: Readonly<Record<string, (p: PetWords) => string>> = {
  mika: (p) => `${p.name} keeps ${p.their} fish close and naps between replies.`,
  miki: (p) => `${p.name} brings ${p.their} red ball.`,
  kira: (p) => `${p.name} sips ${p.their} tea and reads along.`,
  hoshi: (p) => `${p.name} waves ${p.their} star wand for luck.`,
  corgi: (p) => `${p.name} guards ${p.their} bone and cheers you on.`,
};
export const GUIDE_PETS = ['mika', 'miki', 'kira', 'hoshi', 'corgi'] as const;

export const personality = (id: string, pet: PetWords): string => PERSONALITIES[id]?.(pet) ?? `${pet.name} keeps you company.`;

export const EXAMPLE_ASK = 'what’s in this folder?';

export interface CardCopy {
  title: string;
  line: string;
}

export function cardCopy(step: CardStep, pet: PetWords): CardCopy {
  switch (step) {
    case 'welcome': return { title: 'Hi! Let’s set up Petal.', line: 'Petal is a terminal for Claude Code that shows Claude’s replies as easy pages to read, with a pet for company.' };
    case 'pet': return { title: 'Pick your pet', line: `${pet.name} will show you around. ${capital(pet.they)} sits in the corner while you work.` };
    case 'scene': return { title: 'Pick a scene', line: `Where should ${pet.name} hang out? ${capital(pet.they)} tries each one on in the corner.` };
    case 'consent': return { title: 'One quick question', line: 'I read Claude’s replies from your Claude folder on this Mac. Nothing leaves it.' };
    case 'import': return { title: 'Import your past sessions', line: 'They’re in History, up top. Press ⌘Y any time to open it.' };
  }
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// What the pet says on the import card.
export const importSaid = ({ sessions, projects }: { sessions: number; projects: number }): string =>
  `You’ve used Claude Code before! I found ${count(sessions, 'past session', 'past sessions')} in ${count(projects, 'project', 'projects')}.`;

export const IMPORT_LIBRARY_DAYS = 30;
// Read past sessions' own numbers, shown before it starts: what it reads and what it costs, in calls and tokens.
export const libraryConfirm = (plan: BackfillPlan): string => plan.sessions
  ? `Reads ${count(plan.sessions, 'session', 'sessions')} ${rangeText(plan.days)}: about ${count(plan.calls, 'Claude call', 'Claude calls')}, on your plan. ${estimateText(plan.estimate)}`
  : `Nothing new to read ${rangeText(plan.days)}.`;

export const IMPORT_LABELS = { show: 'Show them in History', later: 'Not now', library: 'Also build my Library from them' } as const;

export interface BubbleCopy {
  say: string; // what the pet says, first person
  note: string | null; // a small line under it, about the pet in the third person
}

export function bubbleCopy(step: BubbleStep, pet: PetWords, { claudeFound, folder }: { claudeFound: boolean; folder: FolderChoice }): BubbleCopy {
  const blind = blindToClaude(step, folder) ? `${pet.name} can’t see Claude’s replies while your Claude folder is off.` : null;
  switch (step) {
    case 'add-session': return { say: 'Click Add Session', note: `It’s up top, in the ring. ${pet.name} will open a new tab for Claude.` };
    case 'type-claude': return typeClaudeHelp(claudeFound) === 'type'
      ? { say: 'Now type claude and press Enter', note: 'In the terminal below.' }
      : { say: 'Claude Code isn’t installed yet', note: 'Paste this in the terminal below and press Enter, then click Check again.' };
    case 'claude-setup': return { say: 'Pick a style and sign in, I’ll wait', note: blind ?? `${pet.name} is waiting for you.` };
    case 'ask': return { say: `Ask Claude anything, like ‘${EXAMPLE_ASK}’`, note: blind ?? 'It’s in the reply box, ready to send.' };
    case 'celebrate': return { say: 'That’s it! Replies show up here.', note: `${pet.name} is so proud of you.` };
  }
}
