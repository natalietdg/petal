// The 22 Major Arcana for the Tarot Room, the card of the day and the birth card.
import { localDayNumber } from './daily';

export interface TarotCard {
  number: number;
  numeral: string;
  name: string;
}

const card = (number: number, numeral: string, name: string): TarotCard => ({ number, numeral, name });

export const DECK: readonly TarotCard[] = [
  card(0, '0', 'The Fool'),
  card(1, 'I', 'The Magician'),
  card(2, 'II', 'The High Priestess'),
  card(3, 'III', 'The Empress'),
  card(4, 'IV', 'The Emperor'),
  card(5, 'V', 'The Hierophant'),
  card(6, 'VI', 'The Lovers'),
  card(7, 'VII', 'The Chariot'),
  card(8, 'VIII', 'Strength'),
  card(9, 'IX', 'The Hermit'),
  card(10, 'X', 'Wheel of Fortune'),
  card(11, 'XI', 'Justice'),
  card(12, 'XII', 'The Hanged Man'),
  card(13, 'XIII', 'Death'),
  card(14, 'XIV', 'Temperance'),
  card(15, 'XV', 'The Devil'),
  card(16, 'XVI', 'The Tower'),
  card(17, 'XVII', 'The Star'),
  card(18, 'XVIII', 'The Moon'),
  card(19, 'XIX', 'The Sun'),
  card(20, 'XX', 'Judgement'),
  card(21, 'XXI', 'The World'),
];

// A step of 7 through 22 cards visits every card once per 22 days and never lands on the same card twice in a row.
const STEP = 7;
// Sets which card falls on which day; The Star on 2026-10-07, the day the room opened.
const OFFSET = 20;

// Wrapped twice so days before 1970 still land on a card.
const wrap = (n: number): number => ((n % DECK.length) + DECK.length) % DECK.length;

// birthNumber shifts the whole sequence, so a personal card still changes every day.
export const cardForDay = (day: number, birthNumber = 0): TarotCard => DECK[wrap(day * STEP + OFFSET + birthNumber)];

export const cardFor = (date: Date, birthNumber = 0): TarotCard => cardForDay(localDayNumber(date), birthNumber);

const digitSum = (n: number): number => [...String(n)].reduce((sum, digit) => sum + Number(digit), 0);

// Tarot numerology: add every digit of YYYY-MM-DD, keep adding digits until 22 or less; 22 is The Fool.
export function birthCardNumber(birthdate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return null;
  let n = digitSum(Number(birthdate.replaceAll('-', '')));
  while (n > 22) n = digitSum(n);
  return n % 22;
}

export const birthCard = (birthdate: string): TarotCard | null => {
  const n = birthCardNumber(birthdate);
  return n === null ? null : DECK[n];
};
