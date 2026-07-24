# Wordle Tagalog

A mobile-first TypeScript PWA inspired by Wordle, with one six-letter Filipino or Tagalog word per day for a two-year schedule (starting 2026-07-25).

## Features

- 730-day (two-year) scheduled daily puzzle, one guaranteed-unique word per day
- Full modern Filipino alphabet on the keyboard, including **Ñ** and the **NG** digraph — each counts as a single letter, exactly like in Filipino dictionaries
- New puzzle every 12:00 AM Manila time
- Manila date calculation using `Asia/Manila`, not the device timezone
- Network time check when available, with cached and local fallbacks for offline play
- Six guesses, duplicate-letter scoring, and Wordle-style keyboard colors
- Hard mode, dark theme, high-contrast mode, reduced motion, stats, streaks, and shareable results
- Word definitions shown after each puzzle, sourced from Wiktionary
- Installable PWA with offline cache
- GitHub Pages-ready `dist` folder and GitHub Actions workflow

## Important note about time

The app always computes the puzzle date in Philippine time. Changing the device timezone will not change the puzzle date.

Because GitHub Pages is static, no client-only app can be perfectly cheat-proof if someone manually changes the actual device clock and blocks network access. This project uses network time when it can, caches the network offset for a short period, and falls back to device time only when offline or when time APIs are unavailable.

## How Ñ and NG are counted

Filipino dictionaries alphabetize `ng` as its own letter, distinct from `n` and `g`. This app follows the same convention: `src/tokenize.ts` scans a word and merges every `n` immediately followed by `g` into a single `NG` letter-unit. `Ñ` is already one Unicode character, so it's naturally a single letter too. A word only counts as "six letters" once tokenized this way — e.g. `TANGGAP` is 7 characters but 6 letters: `T-A-NG-G-A-P`.

The on-screen keyboard has a dedicated `NG` key. On a physical keyboard, typing `N` then `G` combines into one `NG` tile automatically; there's no way to type it as a single physical keystroke, so the on-screen key is the direct way to enter it.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run validate:words
```

The deployable files will be in `dist/`.

## Deploy to GitHub Pages

### Option 1: Deploy the included `dist` folder

1. Upload the contents of `dist/` to a GitHub repository.
2. In GitHub, go to Settings > Pages.
3. Set the source to deploy from the branch and folder you uploaded.

### Option 2: Use the included GitHub Actions workflow

1. Upload the whole project to a GitHub repository.
2. In GitHub, go to Settings > Pages.
3. Set Build and deployment to GitHub Actions.
4. Push to `main`. The workflow builds and deploys `dist/` automatically.

## Editing the word schedule

The word database is **not** edited directly in TypeScript. It lives in three admin-friendly JSON files under `data/`:

- `data/schedule.json` — the two-year daily answer list. Each entry:
  ```json
  { "date": "2026-07-25", "word": "TANGGAP", "definition": "to receive or accept something", "source": "https://en.wiktionary.org/wiki/tanggap", "difficulty": "easy" }
  ```
  `date` must be a unique `YYYY-MM-DD` Manila date, `word` must be unique across the whole schedule, and must tokenize to exactly 6 letters (see above).
- `data/fallback.json` — a pool of extra verified words (same shape, minus `date`) used automatically whenever a date's scheduled word is unavailable — see "Fallback system" below.
- `data/invalidated.json` — a flat array of `YYYY-MM-DD` dates. Add a date here (e.g. if a scheduled word turns out to be wrong or unsuitable) and that day will use a fallback word instead, without needing to touch `schedule.json`.

After editing any of these files, regenerate the compiled data module and rebuild:

```bash
npm run generate:schedule
npm run build
npm run validate:words
```

`npm run generate:schedule` reads the three JSON files, validates every entry (character set, 6-letter tokenization, no duplicate dates/words, no fallback word duplicating a scheduled one, every invalidated date actually exists in the schedule), and writes the result to `src/schedule-data.ts` — a plain TypeScript module the app imports directly. This indirection exists because the production build ships native ES modules straight to the browser with no bundler, so the data has to be plain compiled JS rather than a runtime JSON import.

`npm run validate:words` re-checks the generated schedule as part of the normal build-verification step, plus every word in `VALID_GUESSES` (`src/words.ts`, built from the schedule + fallback pool + `EXTRA_GUESSES`).

### Fallback system

`src/schedule.ts`'s `getPuzzleForDate(dateKey)` is the single source of truth the app calls for "what word today":

1. If `dateKey` has a scheduled entry in `data/schedule.json` **and** isn't listed in `data/invalidated.json`, that word is used.
2. Otherwise (date outside the two-year run, or explicitly invalidated), a word is deterministically picked from `data/fallback.json` based on a hash of the date — so a given date always resolves to the same fallback word, without needing any extra state.

### Word sourcing and verification

The initial 730 scheduled words + 120 fallback words were selected from Tagalog-language lemmas on Wiktionary, filtered to those that tokenize to exactly 6 letters, then run through automated exclusion against Wiktionary's own proper-noun, surname, given-name, vulgarity/offensive/derogatory, abbreviation, and "needs verification" categories. Definitions and source links were pulled from Wiktionary's Tagalog-language entries. This is a solid automated first pass, but it is **not** a substitute for native-speaker review — treat it as a strong starting point and spot-check entries (especially spelling variants of the same root word, which this pipeline does not attempt to de-duplicate automatically) before or during the two-year run.
