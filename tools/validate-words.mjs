import { VALID_GUESSES, WORD_LENGTH } from '../dist/src/words.js';
import { SCHEDULE, FALLBACK_POOL, INVALIDATED_DATES, SCHEDULE_START_DATE } from '../dist/src/schedule-data.js';
import { tokenize } from '../dist/src/tokenize.js';

const errors = [];
const CHAR_RE = /^[A-ZÑ]+$/;
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const SCHEDULE_DAYS = 730;

function checkWordEntry(entry, context) {
  if (!CHAR_RE.test(entry.word)) errors.push(`${context}: "${entry.word}" contains unsupported characters.`);
  else if (tokenize(entry.word).length !== WORD_LENGTH) errors.push(`${context}: "${entry.word}" does not tokenize to ${WORD_LENGTH} letters.`);
  if (!entry.definition) errors.push(`${context}: "${entry.word}" is missing a definition.`);
  if (!entry.source) errors.push(`${context}: "${entry.word}" is missing a source.`);
  if (!DIFFICULTIES.has(entry.difficulty)) errors.push(`${context}: "${entry.word}" has invalid difficulty "${entry.difficulty}".`);
}

if (SCHEDULE.length !== SCHEDULE_DAYS) {
  errors.push(`Expected ${SCHEDULE_DAYS} scheduled days, found ${SCHEDULE.length}.`);
}

const seenDates = new Set();
const seenWords = new Set();
let expectedDate = new Date(`${SCHEDULE_START_DATE}T00:00:00Z`);

for (const entry of SCHEDULE) {
  checkWordEntry(entry, `schedule ${entry.date}`);

  if (seenDates.has(entry.date)) errors.push(`Duplicate scheduled date: ${entry.date}`);
  seenDates.add(entry.date);

  if (seenWords.has(entry.word)) errors.push(`Duplicate scheduled word: ${entry.word}`);
  seenWords.add(entry.word);

  const expectedKey = expectedDate.toISOString().slice(0, 10);
  if (entry.date !== expectedKey) {
    errors.push(`Schedule is not sequential daily: expected ${expectedKey}, found ${entry.date}.`);
  }
  expectedDate = new Date(expectedDate.getTime() + 24 * 60 * 60 * 1000);
}

for (const entry of FALLBACK_POOL) {
  checkWordEntry(entry, 'fallback');
  if (seenWords.has(entry.word)) errors.push(`Fallback word duplicates a scheduled word: ${entry.word}`);
}

for (const date of INVALIDATED_DATES) {
  if (!seenDates.has(date)) errors.push(`Invalidated date ${date} is not in the schedule.`);
}

for (const word of VALID_GUESSES) {
  if (!CHAR_RE.test(word)) errors.push(`${word} in VALID_GUESSES contains unsupported characters.`);
  else if (tokenize(word).length !== WORD_LENGTH) errors.push(`${word} in VALID_GUESSES does not tokenize to ${WORD_LENGTH} letters.`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${SCHEDULE.length} scheduled days (from ${SCHEDULE_START_DATE}), ${FALLBACK_POOL.length} fallback words, ` +
  `${INVALIDATED_DATES.length} invalidated dates, and ${VALID_GUESSES.length} accepted guesses.`
);
