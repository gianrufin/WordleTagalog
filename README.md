# Wordle Tagalog

A mobile-first TypeScript PWA inspired by Wordle, with one five-letter Filipino or Tagalog word per day for a 365-day cycle.

## Features

- 365-answer daily puzzle bank
- New puzzle every 12:00 AM Manila time
- Manila date calculation using `Asia/Manila`, not the device timezone
- Network time check when available, with cached and local fallbacks for offline play
- Six guesses, duplicate-letter scoring, and Wordle-style keyboard colors
- Hard mode, dark theme, high-contrast mode, reduced motion, stats, streaks, and shareable results
- Installable PWA with offline cache
- GitHub Pages-ready `dist` folder and GitHub Actions workflow

## Important note about time

The app always computes the puzzle date in Philippine time. Changing the device timezone will not change the puzzle date.

Because GitHub Pages is static, no client-only app can be perfectly cheat-proof if someone manually changes the actual device clock and blocks network access. This project uses network time when it can, caches the network offset for a short period, and falls back to device time only when offline or when time APIs are unavailable.

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

## Edit the word list

The answer list is in `src/words.ts`.

- `SOLUTIONS` must contain exactly 365 uppercase five-letter words.
- `EXTRA_GUESSES` can accept more five-letter words without making them daily answers.

Run this after editing:

```bash
npm run build
npm run validate:words
```
