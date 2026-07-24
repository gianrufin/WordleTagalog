import { SOLUTIONS, VALID_GUESSES, WORD_LENGTH } from '../dist/src/words.js';

const errors = [];
if (SOLUTIONS.length !== 365) errors.push(`Expected 365 solutions, found ${SOLUTIONS.length}.`);
const solutionSet = new Set(SOLUTIONS);
if (solutionSet.size !== SOLUTIONS.length) errors.push('Solutions contain duplicates.');

for (const word of SOLUTIONS) {
  if (word.length !== WORD_LENGTH) errors.push(`${word} is not ${WORD_LENGTH} letters.`);
  if (!/^[A-Z]+$/.test(word)) errors.push(`${word} contains unsupported characters.`);
}

for (const word of VALID_GUESSES) {
  if (word.length !== WORD_LENGTH) errors.push(`${word} in VALID_GUESSES is not ${WORD_LENGTH} letters.`);
  if (!/^[A-Z]+$/.test(word)) errors.push(`${word} in VALID_GUESSES contains unsupported characters.`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Validated ${SOLUTIONS.length} solutions and ${VALID_GUESSES.length} accepted guesses.`);
