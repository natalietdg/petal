// The 22 Major Arcana for the Tarot Room, each with an original reading, and the rule for the card of the day.
import { localDayNumber } from './daily';

export interface TarotCard {
  number: number;
  numeral: string;
  name: string;
  reading: string;
}

const card = (number: number, numeral: string, name: string, reading: string): TarotCard => ({ number, numeral, name, reading });

export const DECK: readonly TarotCard[] = [
  card(0, '0', 'The Fool', 'Start the thing before you feel ready. The first commit is allowed to be a little silly.'),
  card(1, 'I', 'The Magician', 'Every tool you need is already open in some tab. Today you remember which one.'),
  card(2, 'II', 'The High Priestess', 'Trust the quiet hunch about that function. Read it once more before you ask anyone.'),
  card(3, 'III', 'The Empress', 'Tend the small things: a clear name, a kind review comment, a glass of actual water.'),
  card(4, 'IV', 'The Emperor', 'Make one firm decision and write it down. Future you will salute present you.'),
  card(5, 'V', 'The Hierophant', 'The old convention is there for a reason. Follow it today, and ask about the reason over tea.'),
  card(6, 'VI', 'The Lovers', 'A good pairing is coming, whether it is a teammate, a rubber duck or tea with a biscuit.'),
  card(7, 'VII', 'The Chariot', 'Pick one lane and drive it all the way to done. The other tickets will still be there after lunch.'),
  card(8, 'VIII', 'Strength', 'Gentle beats forceful today. Coax the flaky test instead of shouting at it.'),
  card(9, 'IX', 'The Hermit', 'Close the chat, put the headphones on, and enjoy one deep, quiet hour with your code.'),
  card(10, 'X', 'Wheel of Fortune', 'Yesterday\'s mystery bug may fix itself today. Write down why before it changes its mind.'),
  card(11, 'XI', 'Justice', 'Weigh both options fairly, then pick the one that is easier to undo.'),
  card(12, 'XII', 'The Hanged Man', 'Stuck? Turn the problem upside down and read the stack trace from the bottom.'),
  card(13, 'XIII', 'Death', 'Delete the dead code. It had a good run, and everything feels lighter without it.'),
  card(14, 'XIV', 'Temperance', 'Balance the day: one hard task, one easy win, and a proper break in between.'),
  card(15, 'XV', 'The Devil', 'Beware the shortcut that whispers "just this once". It says that every single time.'),
  card(16, 'XVI', 'The Tower', 'Something may topple today. Good news: you have backups, and now you know where the cracks were.'),
  card(17, 'XVII', 'The Star', 'A hopeful, steady day. Small fixes shine, and someone notices the care you put in.'),
  card(18, 'XVIII', 'The Moon', 'Not everything in the logs is what it seems. Check the timestamps before you believe the story.'),
  card(19, 'XIX', 'The Sun', 'Green checks all round. Enjoy it, and maybe let the cat sit in a sunbeam for a while.'),
  card(20, 'XX', 'Judgement', 'Revisit an old decision with fresh eyes. You know more now than you did then.'),
  card(21, 'XXI', 'The World', 'Something reaches done today. Ship it, say thank you, and let yourself feel finished.'),
];

// A step of 7 through 22 cards visits every card once per 22 days and never lands on the same card twice in a row.
const STEP = 7;
// Sets which card falls on which day; The Star on 2026-10-07, the day the room opened.
const OFFSET = 20;

// Wrapped twice so days before 1970 still land on a card.
export const cardForDay = (day: number): TarotCard => DECK[(((day * STEP + OFFSET) % DECK.length) + DECK.length) % DECK.length];

export const cardFor = (date: Date): TarotCard => cardForDay(localDayNumber(date));
