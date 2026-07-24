import { daysBetweenDateKeys } from './time.js';
import { SCHEDULE, FALLBACK_POOL, INVALIDATED_DATES, SCHEDULE_START_DATE } from './schedule-data.js';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type WordEntry = {
  word: string;
  definition: string;
  source: string;
  difficulty: Difficulty;
};

export type ScheduleEntry = WordEntry & { date: string };

export type PuzzleForDate = WordEntry & {
  puzzleNumber: number;
  isFallback: boolean;
};

const SCHEDULE_BY_DATE = new Map(SCHEDULE.map((entry) => [entry.date, entry]));
const INVALID_SET = new Set(INVALIDATED_DATES);

// Returns the word (and its metadata) that should be shown for a given Manila
// date key. Scheduled words are looked up directly; if a date has no
// scheduled word (outside the two-year run) or was flagged bad via
// INVALIDATED_DATES (data/invalidated.json), a stable fallback word is
// derived deterministically from the date so the same date always resolves
// to the same fallback, even though it isn't part of the guaranteed-unique
// primary schedule.
export function getPuzzleForDate(dateKey: string): PuzzleForDate {
  const puzzleNumber = daysBetweenDateKeys(SCHEDULE_START_DATE, dateKey) + 1;
  const scheduled = SCHEDULE_BY_DATE.get(dateKey);

  if (scheduled && !INVALID_SET.has(dateKey)) {
    return { ...scheduled, puzzleNumber, isFallback: false };
  }

  const fallback = pickFallback(dateKey);
  return { ...fallback, puzzleNumber, isFallback: true };
}

function pickFallback(dateKey: string): WordEntry {
  if (FALLBACK_POOL.length === 0) throw new Error('No fallback words configured.');
  const index = Math.abs(hashString(dateKey)) % FALLBACK_POOL.length;
  return FALLBACK_POOL[index];
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}
