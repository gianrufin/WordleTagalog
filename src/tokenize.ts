// Splits an uppercase Filipino word into letter-units for gameplay purposes.
// Every occurrence of the digraph "NG" counts as a single letter (standard
// Filipino dictionary/alphabetization convention), and "Ñ" is already a
// single Unicode character so it naturally counts as one letter too.
export function tokenize(word: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < word.length) {
    if (word[index] === 'N' && word[index + 1] === 'G') {
      tokens.push('NG');
      index += 2;
    } else {
      tokens.push(word[index]);
      index += 1;
    }
  }
  return tokens;
}
