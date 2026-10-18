import { describe, expect, it } from 'vitest';
import {
  BUBBLE_STEPS, CARD_STEPS, GUIDE_PETS, INSTALL_COMMAND, blindToClaude, bubbleCopy, bubbleStep, cardCopy, cardCounter, importSaid, isGuideStage,
  libraryConfirm, nextCard, personality, previousCard, resumeAt, showsImport, stageToSave, typeClaudeHelp, type GuideFacts, type PetWords,
} from '../src/shared/pet-guide';
import { CATS } from '../src/renderer/cat-art';

const FRESH: GuideFacts = { folderChoice: 'unasked', addedSession: false, claudeRunning: false, sessionStarted: false, replied: false, pastSessions: 0 };
const ALLOWED: GuideFacts = { ...FRESH, folderChoice: 'allowed' };
const MIKI: PetWords = { name: 'Miki', they: 'he', their: 'his' };
const MIKA: PetWords = { name: 'Mika', they: 'she', their: 'her' };

describe('the cards', () => {
  it('go welcome, pet, scene, then the folder question while it is unanswered', () => {
    expect(nextCard('welcome', 'unasked')).toBe('pet');
    expect(nextCard('pet', 'unasked')).toBe('scene');
    expect(nextCard('scene', 'unasked')).toBe('consent');
    expect(nextCard('consent', 'allowed')).toBe('bubbles');
  });

  it('skip the folder question when it was answered before', () => {
    expect(nextCard('scene', 'allowed')).toBe('bubbles');
    expect(nextCard('scene', 'declined')).toBe('bubbles');
  });

  it('go back one at a time, and not before the welcome', () => {
    expect(previousCard('scene')).toBe('pet');
    expect(previousCard('welcome')).toBeNull();
  });
});

describe('the import card', () => {
  it('follows the folder card only when the folder was allowed and past sessions were found', () => {
    expect(nextCard('consent', 'allowed', 5)).toBe('import');
    expect(nextCard('consent', 'allowed', 0)).toBe('bubbles');
    expect(nextCard('consent', 'declined', 5)).toBe('bubbles');
    expect(nextCard('import', 'allowed', 5)).toBe('bubbles');
    expect(showsImport('unasked', 5)).toBe(false);
  });

  it('a restart with the folder already allowed goes from the scene card straight to it', () => {
    expect(nextCard('scene', 'allowed', 3)).toBe('import');
    expect(nextCard('scene', 'unasked', 3)).toBe('consent');
  });

  it('has no Back: the folder question is answered', () => {
    expect(previousCard('import')).toBeNull();
    expect(previousCard('consent')).toBe('scene');
  });

  it('keeps Step N of M right: four cards, five once the import card shows', () => {
    expect(cardCounter('welcome', 'unasked', 0)).toEqual({ number: 1, total: 4 });
    expect(cardCounter('consent', 'unasked', 0)).toEqual({ number: 4, total: 4 });
    expect(cardCounter('import', 'allowed', 5)).toEqual({ number: 5, total: 5 });
    expect(cardCounter('pet', 'allowed', 5)).toEqual({ number: 2, total: 5 }); // a restart that knows it will show
    expect(cardCounter('scene', 'declined', 5)).toEqual({ number: 3, total: 4 });
  });

  it('resumes there only while it still applies', () => {
    expect(resumeAt('import', { ...ALLOWED, pastSessions: 4 })).toBe('import');
    expect(resumeAt('import', ALLOWED)).toBe('add-session');
    expect(resumeAt('consent', { ...ALLOWED, pastSessions: 4 })).toBe('import');
  });

  it('says what it found, in the pet’s words, with the Library cost before anything starts', () => {
    expect(importSaid({ sessions: 5, projects: 2 })).toBe('You’ve used Claude Code before! I found 5 past sessions in 2 projects.');
    expect(importSaid({ sessions: 1, projects: 1 })).toBe('You’ve used Claude Code before! I found 1 past session in 1 project.');
    expect(cardCopy('import', MIKI).title).toBe('Import your past sessions');
    expect(libraryConfirm({ days: 30, sessions: 5, calls: 7, estimate: { read: 31_234, write: 4200, calls: 7 } }))
      .toBe('Reads 5 sessions from the last 30 days: about 7 Claude calls, on your plan. About 31,000 tokens to read, 4,200 to write.');
    expect(libraryConfirm({ days: 30, sessions: 0, calls: 0, estimate: { read: 0, write: 0, calls: 0 } })).toBe('Nothing new to read from the last 30 days.');
  });
});

describe('which bubble shows on which app state', () => {
  it('Add Session first, on a fresh window with one plain tab', () => {
    expect(bubbleStep(ALLOWED)).toBe('add-session');
  });

  it('type claude once a new tab is open and nothing runs in it', () => {
    expect(bubbleStep({ ...ALLOWED, addedSession: true })).toBe('type-claude');
  });

  it('waits through Claude Code’s first-run screens: claude running with no session yet', () => {
    expect(bubbleStep({ ...ALLOWED, addedSession: true, claudeRunning: true })).toBe('claude-setup');
    expect(bubbleStep({ ...ALLOWED, claudeRunning: true })).toBe('claude-setup'); // claude started some other way
  });

  it('asks for a first message once a session is live, and celebrates the first reply', () => {
    expect(bubbleStep({ ...ALLOWED, claudeRunning: true, sessionStarted: true })).toBe('ask');
    expect(bubbleStep({ ...ALLOWED, claudeRunning: true, sessionStarted: true, replied: true })).toBe('celebrate');
  });
});

describe('resume and skip', () => {
  it('a new install starts at the welcome card', () => {
    expect(resumeAt('welcome', FRESH)).toBe('welcome');
  });

  it('a relaunch mid-cards comes back to the same card', () => {
    expect(resumeAt('pet', FRESH)).toBe('pet');
    expect(resumeAt('scene', FRESH)).toBe('scene');
    expect(resumeAt('consent', FRESH)).toBe('consent');
  });

  it('a folder question answered elsewhere moves on to the bubbles', () => {
    expect(resumeAt('consent', ALLOWED)).toBe('add-session');
  });

  it('a relaunch mid-bubbles follows what Petal sees now, not what was saved', () => {
    expect(resumeAt('claude-setup', ALLOWED)).toBe('add-session'); // a fresh window: no tab added, nothing running
    expect(resumeAt('add-session', { ...ALLOWED, claudeRunning: true, sessionStarted: true })).toBe('ask');
  });

  it('skipped, finished and older installs never show it on launch', () => {
    for (const stage of ['skipped', 'done', 'existing'] as const) expect(resumeAt(stage, FRESH)).toBeNull();
  });

  it('the celebration saves as done; every other step saves as itself', () => {
    expect(stageToSave('celebrate')).toBe('done');
    for (const step of [...CARD_STEPS, ...BUBBLE_STEPS.filter((s) => s !== 'celebrate')]) expect(stageToSave(step)).toBe(step);
  });

  it('only known stages load from config', () => {
    expect(isGuideStage('scene')).toBe(true);
    expect(isGuideStage('existing')).toBe(true);
    expect(isGuideStage('get-started')).toBe(false);
    expect(isGuideStage(3)).toBe(false);
  });
});

describe('claude missing from the tab’s PATH', () => {
  it('swaps the claude chip for the install line', () => {
    expect(typeClaudeHelp(true)).toBe('type');
    expect(typeClaudeHelp(false)).toBe('install');
    expect(bubbleCopy('type-claude', MIKI, { claudeFound: true, folder: 'allowed' }).say).toBe('Now type claude and press Enter');
    const missing = bubbleCopy('type-claude', MIKI, { claudeFound: false, folder: 'allowed' });
    expect(missing.say).toBe('Claude Code isn’t installed yet');
    expect(missing.note).toMatch(/Check again/);
    expect(INSTALL_COMMAND).toBe('curl -fsSL https://claude.ai/install.sh | bash');
  });
});

describe('copy', () => {
  it('says the brief’s lines', () => {
    const ctx = { claudeFound: true, folder: 'allowed' as const };
    expect(cardCopy('welcome', MIKI).title).toBe('Hi! Let’s set up Petal.');
    expect(cardCopy('consent', MIKI).line).toBe('I read Claude’s replies from your Claude folder on this Mac. Nothing leaves it.');
    expect(bubbleCopy('add-session', MIKI, ctx).say).toBe('Click Add Session');
    expect(bubbleCopy('claude-setup', MIKI, ctx).say).toBe('Pick a style and sign in, I’ll wait');
    expect(bubbleCopy('ask', MIKI, ctx).say).toBe('Ask Claude anything, like ‘what’s in this folder?’');
    expect(bubbleCopy('celebrate', MIKI, ctx).say).toBe('That’s it! Replies show up here.');
  });

  it('uses each pet’s pronoun when it talks about the pet', () => {
    expect(personality('miki', MIKI)).toBe('Miki brings his red ball.');
    expect(personality('mika', MIKA)).toBe('Mika keeps her fish close and naps between replies.');
    expect(cardCopy('pet', MIKI).line).toBe('Miki will show you around. He sits in the corner while you work.');
    expect(cardCopy('scene', MIKA).line).toMatch(/^Where should Mika hang out\? She tries/);
    expect(bubbleCopy('claude-setup', MIKI, { claudeFound: true, folder: 'allowed' }).note).toBe('Miki is waiting for you.');
  });

  it('every built-in pet has a line, and the pronoun in it matches the pet', () => {
    for (const id of GUIDE_PETS) {
      const pet = CATS[id];
      const words: PetWords = pet.pronoun === 'he' ? { name: pet.name, they: 'he', their: 'his' } : { name: pet.name, they: 'she', their: 'her' };
      const line = personality(id, words);
      expect(line.startsWith(pet.name), id).toBe(true);
      expect(line, id).toMatch(pet.pronoun === 'he' ? /\bhis\b/ : /\bher\b/);
    }
    expect(personality('someone-local', MIKA)).toBe('Mika keeps you company.');
  });

  it('with the Claude folder off, the pet says it can’t see Claude instead of pretending to wait', () => {
    expect(blindToClaude('ask', 'declined')).toBe(true);
    expect(blindToClaude('add-session', 'declined')).toBe(false);
    expect(bubbleCopy('claude-setup', MIKI, { claudeFound: true, folder: 'declined' }).note).toBe('Miki can’t see Claude’s replies while your Claude folder is off.');
  });

  it('no em dashes anywhere in it', () => {
    const all = [
      ...CARD_STEPS.flatMap((s) => Object.values(cardCopy(s, MIKI))),
      ...BUBBLE_STEPS.flatMap((s) => [true, false].flatMap((found) => Object.values(bubbleCopy(s, MIKI, { claudeFound: found, folder: 'declined' })))),
      ...GUIDE_PETS.map((id) => personality(id, MIKI)),
    ];
    for (const line of all) expect(line ?? '').not.toContain('—');
  });
});

describe('Help menu', () => {
  it('has Show setup again and the old checklist as Setup checklist, each wired to its own handler', async () => {
    const { menuTemplate } = await import('../src/main/menu');
    const calls: string[] = [];
    const options = new Proxy({ currentTheme: '', currentCat: '', currentScene: '', currentReading: '' } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => calls.push(String(key))),
    });
    const help = menuTemplate(options as never).find((item) => item.role === 'help');
    const items = (help?.submenu ?? []) as { label?: string; click?: () => void }[];
    expect(items.map((item) => item.label).filter(Boolean)).toEqual(['Welcome', 'Show setup again', 'Setup checklist', 'Colour key', 'Keyboard Shortcuts']);
    items.find((item) => item.label === 'Show setup again')?.click?.();
    items.find((item) => item.label === 'Setup checklist')?.click?.();
    expect(calls).toEqual(['onOpenPetGuide', 'onOpenGetStarted']);
  });
});
