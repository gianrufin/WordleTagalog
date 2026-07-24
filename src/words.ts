import { SCHEDULE, FALLBACK_POOL } from './schedule-data.js';

export const WORD_LENGTH = 6;
export const MAX_GUESSES = 6;

// Extra six-letter Filipino words accepted as guesses without ever being a
// daily answer. Keeps guessing flexible beyond the scheduled/fallback pool.
export const EXTRA_GUESSES: string[] = [];

export const VALID_GUESSES = Array.from(
  new Set([
    ...SCHEDULE.map((entry) => entry.word),
    ...FALLBACK_POOL.map((entry) => entry.word),
    ...EXTRA_GUESSES.map((word) => word.toUpperCase())
  ])
);
