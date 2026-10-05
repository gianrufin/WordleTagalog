import { MAX_GUESSES, VALID_GUESSES, WORD_LENGTH } from './words.js';
import {
  buildManilaDateInfo,
  daysBetweenDateKeys,
  formatCountdown,
  getManilaDateInfo,
  getManilaDateInfoForDateKey,
  getPreviousDateKey,
  type ManilaDateInfo
} from './time.js';
import { readJson, removeKey, writeJson } from './storage.js';
import { tokenize } from './tokenize.js';
import { getPuzzleForDate, type Difficulty } from './schedule.js';
import { SCHEDULE_START_DATE } from './schedule-data.js';

type LetterState = 'correct' | 'present' | 'absent';
type TileState = LetterState | 'filled' | 'empty';
type GameStatus = 'playing' | 'won' | 'lost';

type GameState = {
  dateKey: string;
  puzzleNumber: number;
  solution: string;
  definition: string;
  source: string;
  difficulty: Difficulty;
  isFallback: boolean;
  guesses: string[];
  evaluations: LetterState[][];
  currentGuess: string;
  status: GameStatus;
  completedAtEpochMs?: number;
};

type Settings = {
  hardMode: boolean;
  darkMode: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
};

type ResultEntry = {
  status: Exclude<GameStatus, 'playing'>;
  guesses: number;
  puzzleNumber: number;
};

type Stats = {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  lastPlayedDateKey?: string;
  lastWinDateKey?: string;
  guessDistribution: Record<string, number>;
  resultsByDate: Record<string, ResultEntry>;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const SETTINGS_KEY = 'wordle-tagalog:settings:v1';
const STATS_KEY = 'wordle-tagalog:stats:v1';
const VALID_WORD_SET = new Set(VALID_GUESSES);
const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'NG', 'BACKSPACE']
];
const RESULT_EMOJI: Record<LetterState, string> = {
  correct: '🟩',
  present: '🟨',
  absent: '⬛'
};
const HIGH_CONTRAST_EMOJI: Record<LetterState, string> = {
  correct: '🟧',
  present: '🟦',
  absent: '⬛'
};
const statePriority: Record<LetterState, number> = {
  absent: 1,
  present: 2,
  correct: 3
};
const FLIP_DURATION_MS = 480;
const FLIP_STAGGER_MS = 260;
const BOUNCE_DURATION_MS = 620;
const BOUNCE_STAGGER_MS = 90;

let todayDateInfo: ManilaDateInfo;
let dateInfo: ManilaDateInfo;
let game: GameState;
let settings: Settings;
let stats: Stats;
let appLoadedDeviceEpochMs = Date.now();
let trustedBaseEpochMs = Date.now();
let installPromptEvent: InstallPromptEvent | null = null;
let activeModal: string | null = null;
let ticker: number | undefined;
let revealingRowIndex: number | null = null;
let isAnimating = false;
let showingLanding = true;
let lastAddedTileIndex: number | null = null;
let archiveYear = 2026;
let archiveMonth = 10;

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('App root not found.');
const app: HTMLDivElement = appRoot;

void initialize();

async function initialize(): Promise<void> {
  settings = loadSettings();
  stats = loadStats();
  todayDateInfo = await getManilaDateInfo();
  dateInfo = todayDateInfo;
  const [initYear, initMonth] = todayDateInfo.dateKey.split('-').map(Number);
  archiveYear = initYear;
  archiveMonth = initMonth;
  appLoadedDeviceEpochMs = Date.now();
  trustedBaseEpochMs = dateInfo.epochMs;
  game = loadGame(dateInfo);
  applySettings();
  bindEvents();
  renderLanding();
  registerServiceWorker();
}

function getActiveStreak(): number {
  if (!stats.currentStreak || !stats.lastWinDateKey) return 0;
  const previousDateKey = getPreviousDateKey(todayDateInfo.dateKey);
  if (stats.lastWinDateKey === todayDateInfo.dateKey || stats.lastWinDateKey === previousDateKey) {
    return stats.currentStreak;
  }
  return 0;
}

function renderLanding(): void {
  const isArchiveSelected = game.dateKey !== todayDateInfo.dateKey;
  const alreadyPlayed = game.status !== 'playing';
  const streak = getActiveStreak();
  const streakLine = streak > 0
    ? `<p class="landing-streak">🔥 Streak: ${streak} ${streak === 1 ? 'day' : 'days'}</p>`
    : '';
  const previewStates: LetterState[] = ['correct', 'present', 'absent', 'present', 'absent', 'correct'];
  const previewLetters = ['T', 'A', 'NG', 'G', 'A', 'P'];
  const preview = previewLetters.map((letter, index) =>
    `<div class="tile${letter.length > 1 ? ' tile-wide-letter' : ''}" data-state="${previewStates[index]}">${letter}</div>`
  ).join('');

  const todayGame = isArchiveSelected ? loadGame(todayDateInfo) : game;
  const todayAlreadyPlayed = todayGame.status !== 'playing';

  let buttonsHtml = '';
  if (isArchiveSelected) {
    buttonsHtml = `
      <button class="primary-button landing-play" type="button" data-action="play">
        Resume Archive #${game.puzzleNumber} (${dateInfo.displayDate})
      </button>
      <button class="landing-archive-btn" type="button" data-action="return-today">
        Play Today's Word #${todayGame.puzzleNumber} (${todayAlreadyPlayed ? "Solved" : "Play"})
      </button>
      <button class="landing-archive-btn" type="button" data-action="archive">
        📅 Calendar Archive
      </button>
    `;
  } else {
    buttonsHtml = `
      <button class="primary-button landing-play" type="button" data-action="play">
        ${alreadyPlayed ? "See today's result" : 'Play'}
      </button>
      <button class="landing-archive-btn" type="button" data-action="archive">
        📅 Calendar Archive
      </button>
    `;
  }

  app.innerHTML = `
    <div class="landing">
      <div class="landing-card">
        <div class="landing-preview" aria-hidden="true">${preview}</div>
        <p class="eyebrow">${isArchiveSelected ? `Archived Puzzle #${game.puzzleNumber}` : `Daily Filipino word puzzle`}</p>
        <h1 class="landing-title">Wordle Tagalog</h1>
        <p class="landing-tagline">Guess the 6-letter Filipino word in 6 tries. Ñ and NG each count as one letter. A new word drops every midnight in Manila.</p>
        <div class="landing-actions">
          ${buttonsHtml}
        </div>
        ${streakLine}
        <p class="landing-meta">Today: Puzzle #${todayGame.puzzleNumber} · ${todayDateInfo.displayDate}</p>
      </div>
      <div class="credits landing-credits">
        <p>Made by <a href="https://instagram.com/gianrufin" target="_blank" rel="noopener noreferrer">Gian Rufin</a></p>
      </div>
    </div>
  `;
}

function exitToLanding(): void {
  showingLanding = true;
  closeModal();
  renderLanding();
}

function enterGame(): void {
  if (!showingLanding) return;
  showingLanding = false;
  renderShell();
  render();
  startTicker();

  if (game.status !== 'playing') {
    window.setTimeout(() => showStatsModal(), settings.reduceMotion ? 0 : 300);
  }
}

function switchToDate(targetDateKey: string): void {
  if (targetDateKey === todayDateInfo.dateKey) {
    dateInfo = todayDateInfo;
  } else {
    dateInfo = getManilaDateInfoForDateKey(targetDateKey);
  }
  game = loadGame(dateInfo);
  closeModal();
  showingLanding = false;
  renderShell();
  render();
  startTicker();
  if (dateInfo.dateKey !== todayDateInfo.dateKey) {
    showToast(`Loaded puzzle #${game.puzzleNumber} (${dateInfo.displayDate})`);
  }
}

function renderShell(): void {
  const isArchive = game.dateKey !== todayDateInfo.dateKey;

  const archiveBanner = isArchive ? `
    <div class="archive-bar" role="status">
      <div class="archive-bar-info">
        <span class="archive-dot" aria-hidden="true"></span>
        <span>Archive: <strong>${dateInfo.displayDate}</strong> (Puzzle #${game.puzzleNumber})</span>
      </div>
      <button class="archive-return-pill" type="button" data-action="return-today">
        Today's Word ➔
      </button>
    </div>
  ` : '';

  const thirdCard = isArchive ? `
    <div>
      <span class="label">Return</span>
      <button class="archive-inline-return" type="button" data-action="return-today">Today ➔</button>
    </div>
  ` : `
    <div>
      <span class="label">Next word</span>
      <strong id="countdown">--:--:--</strong>
    </div>
  `;

  app.innerHTML = `
    <header class="topbar" aria-label="Wordle Tagalog header">
      <div class="header-nav-left">
        <button class="icon-button" type="button" data-action="home" aria-label="Back to home" title="Back to home">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </button>
        <button class="icon-button" type="button" data-action="help" aria-label="How to play" title="How to play">?</button>
      </div>
      <div class="title-lockup clickable-title" data-action="home" role="button" tabindex="0" aria-label="Wordle Tagalog - Back to Home" title="Back to Home">
        <p class="eyebrow">${isArchive ? `Archived Puzzle` : `Daily Filipino word puzzle`}</p>
        <h1>Wordle Tagalog</h1>
      </div>
      <div class="header-actions">
        <button class="icon-button" type="button" data-action="archive" aria-label="Calendar Archive" title="Calendar Archive">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
        </button>
        <button class="icon-button" type="button" data-action="stats" aria-label="Statistics" title="Statistics">▥</button>
        <button class="icon-button" type="button" data-action="settings" aria-label="Settings" title="Settings">⚙</button>
      </div>
    </header>

    <main class="game" aria-live="polite">
      ${archiveBanner}
      <section class="status-card" aria-label="Puzzle status">
        <div>
          <span class="label">Puzzle</span>
          <strong id="puzzleNumber">#${game.puzzleNumber}</strong>
        </div>
        <div>
          <span class="label">${isArchive ? 'Archived date' : 'Manila date'}</span>
          <strong id="manilaDate">${dateInfo.displayDate}</strong>
        </div>
        ${thirdCard}
      </section>

      <section id="board" class="board" role="grid" aria-label="Wordle Tagalog board"></section>
      <section id="message" class="message" aria-live="assertive"></section>
      <section id="keyboard" class="keyboard" aria-label="Keyboard"></section>
    </main>

    <div id="modalRoot" class="modal-root hidden" aria-hidden="true"></div>
  `;
}

function bindEvents(): void {
  document.addEventListener('keydown', handlePhysicalKeyboard);
  app.addEventListener('click', handleClick);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPromptEvent = event as InstallPromptEvent;
    updateInstallButton();
  });
}

function render(): void {
  renderBoard();
  renderKeyboard();
  renderStatus();
}

function renderStatus(): void {
  const puzzleNumber = document.querySelector('#puzzleNumber');
  const manilaDate = document.querySelector('#manilaDate');
  const countdown = document.querySelector('#countdown');
  if (puzzleNumber) puzzleNumber.textContent = `#${game.puzzleNumber}`;
  if (manilaDate) manilaDate.textContent = dateInfo.displayDate;
  if (countdown) countdown.textContent = formatCountdown(todayDateInfo.nextMidnightEpochMs - getEstimatedEpochMs());
}

function renderBoard(): void {
  const board = document.querySelector<HTMLDivElement>('#board');
  if (!board) return;

  const rows = Array.from({ length: MAX_GUESSES }, (_, rowIndex) => {
    const submittedGuess = game.guesses[rowIndex];
    const isCurrentRow = rowIndex === game.guesses.length && game.status === 'playing';
    const word = submittedGuess ?? (isCurrentRow ? game.currentGuess : '');
    const wordTokens = tokenize(word);
    const evaluation = rowIndex === revealingRowIndex ? undefined : game.evaluations[rowIndex];
    const tiles = Array.from({ length: WORD_LENGTH }, (_, tileIndex) => {
      const letter = wordTokens[tileIndex] ?? '';
      const tileState: TileState = evaluation?.[tileIndex] ?? (letter ? 'filled' : 'empty');
      const aria = letter ? `${letter}, ${tileState}` : 'empty';
      const wideClass = letter.length > 1 ? ' tile-wide-letter' : '';
      const popClass = isCurrentRow && tileIndex === lastAddedTileIndex && !settings.reduceMotion ? ' tile-pop' : '';
      return `<div class="tile${wideClass}${popClass}" data-state="${tileState}" role="gridcell" aria-label="${aria}">${letter}</div>`;
    }).join('');
    return `<div class="board-row" data-row="${rowIndex}" role="row">${tiles}</div>`;
  }).join('');

  board.innerHTML = rows;
}

function renderKeyboard(): void {
  const keyboard = document.querySelector<HTMLDivElement>('#keyboard');
  if (!keyboard) return;
  const keyStates = getKeyboardStates();

  keyboard.innerHTML = KEYBOARD_ROWS.map((row) => {
    const keys = row.map((key) => {
      const state = keyStates.get(key) ?? 'empty';
      const label = key === 'BACKSPACE' ? '⌫' : key;
      const isWide = key === 'ENTER' || key === 'BACKSPACE';
      const isDouble = key.length > 1 && !isWide;
      const className = isWide ? 'key wide-key' : isDouble ? 'key double-key' : 'key';
      return `<button class="${className}" type="button" data-key="${key}" data-state="${state}" aria-label="${key}">${label}</button>`;
    }).join('');
    return `<div class="keyboard-row">${keys}</div>`;
  }).join('');
}

function getKeyboardStates(): Map<string, LetterState> {
  const keys = new Map<string, LetterState>();
  game.guesses.forEach((guess, rowIndex) => {
    const tokens = tokenize(guess);
    const evaluation = game.evaluations[rowIndex];
    evaluation.forEach((state, letterIndex) => {
      const token = tokens[letterIndex];
      const current = keys.get(token);
      if (!current || statePriority[state] > statePriority[current]) keys.set(token, state);
    });
  });
  return keys;
}

function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const actionButton = target.closest<HTMLElement>('[data-action]');
  const keyButton = target.closest<HTMLElement>('[data-key]');
  const modalBackdrop = target.classList.contains('modal-root');

  if (modalBackdrop) {
    closeModal();
    return;
  }

  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === 'home') exitToLanding();
    if (action === 'play') enterGame();
    if (action === 'archive') showArchiveModal();
    if (action === 'archive-prev-month') {
      archiveMonth -= 1;
      if (archiveMonth < 1) {
        archiveMonth = 12;
        archiveYear -= 1;
      }
      showArchiveModal();
    }
    if (action === 'archive-next-month') {
      archiveMonth += 1;
      if (archiveMonth > 12) {
        archiveMonth = 1;
        archiveYear += 1;
      }
      showArchiveModal();
    }
    if (action === 'pick-archive-date') {
      const targetDate = actionButton.dataset.date;
      if (targetDate) switchToDate(targetDate);
    }
    if (action === 'return-today') {
      switchToDate(todayDateInfo.dateKey);
    }
    if (action === 'help') showHelpModal();
    if (action === 'stats') showStatsModal();
    if (action === 'settings') showSettingsModal();
    if (action === 'close-modal') closeModal();
    if (action === 'share') void shareResults();
    if (action === 'install') void promptInstall();
    if (action === 'reset-stats') resetStats();
    if (action === 'play-again-info') showToast('A new puzzle unlocks at 12:00 AM Manila time.');
    return;
  }

  if (keyButton) {
    handleInput(keyButton.dataset.key ?? '');
  }
}

function handlePhysicalKeyboard(event: KeyboardEvent): void {
  if (showingLanding) {
    if (event.key === 'Enter') {
      event.preventDefault();
      enterGame();
    }
    return;
  }

  if (event.key === 'Escape' && activeModal) {
    closeModal();
    return;
  }

  if (activeModal) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const key = event.key === 'Backspace' ? 'BACKSPACE' : event.key === 'Enter' ? 'ENTER' : event.key.toUpperCase();
  if (key === 'BACKSPACE' || key === 'ENTER' || /^[A-ZÑ]$/.test(key)) {
    event.preventDefault();
    handleInput(key);
  }
}

function handleInput(key: string): void {
  if (isAnimating) return;

  if (game.status !== 'playing') {
    showToast(game.status === 'won' ? 'You already solved today\'s word.' : `Today's word was ${game.solution}.`);
    return;
  }

  if (key === 'ENTER') {
    submitGuess();
    return;
  }

  if (key === 'BACKSPACE') {
    const tokens = tokenize(game.currentGuess);
    tokens.pop();
    game.currentGuess = tokens.join('');
    lastAddedTileIndex = null;
    saveGame();
    renderBoard();
    return;
  }

  const isLetterKey = key === 'NG' || /^[A-ZÑ]$/.test(key);
  const currentTokens = tokenize(game.currentGuess);
  if (isLetterKey && currentTokens.length < WORD_LENGTH) {
    lastAddedTileIndex = currentTokens.length;
    game.currentGuess += key;
    saveGame();
    renderBoard();
    lastAddedTileIndex = null;
  }
}

function submitGuess(): void {
  const guess = game.currentGuess.toUpperCase();

  if (tokenize(guess).length < WORD_LENGTH) {
    rejectGuess('Not enough letters.');
    return;
  }

  if (!VALID_WORD_SET.has(guess)) {
    rejectGuess('Not in the Filipino word list.');
    return;
  }

  const hardModeProblem = settings.hardMode ? getHardModeProblem(guess) : null;
  if (hardModeProblem) {
    rejectGuess(hardModeProblem);
    return;
  }

  const rowIndex = game.guesses.length;
  const evaluation = evaluateGuess(guess, game.solution);
  game.guesses.push(guess);
  game.evaluations.push(evaluation);
  game.currentGuess = '';

  const won = guess === game.solution;
  const lost = !won && game.guesses.length === MAX_GUESSES;
  if (won) game.status = 'won';
  else if (lost) game.status = 'lost';

  saveGame();
  revealingRowIndex = rowIndex;
  renderBoard();

  revealRow(rowIndex, evaluation, () => {
    renderKeyboard();
    if (won) {
      finishGame();
      showToast(getWinMessage(game.guesses.length));
      bounceRow(rowIndex);
    } else if (lost) {
      finishGame();
      showToast(`The word was ${game.solution}.`);
    }

    if (game.status !== 'playing') {
      window.setTimeout(() => showStatsModal(), settings.reduceMotion ? 0 : 700);
    }
  });
}

function revealRow(rowIndex: number, evaluation: LetterState[], onComplete: () => void): void {
  const row = document.querySelector<HTMLElement>(`.board-row[data-row="${rowIndex}"]`);

  if (!row || settings.reduceMotion) {
    revealingRowIndex = null;
    renderBoard();
    onComplete();
    return;
  }

  isAnimating = true;
  const tiles = Array.from(row.querySelectorAll<HTMLElement>('.tile'));

  tiles.forEach((tile, index) => {
    const delay = index * FLIP_STAGGER_MS;
    tile.style.animationDelay = `${delay}ms`;
    tile.classList.add('flip');
    window.setTimeout(() => {
      tile.dataset.state = evaluation[index];
    }, delay + FLIP_DURATION_MS / 2);
  });

  const totalDuration = (tiles.length - 1) * FLIP_STAGGER_MS + FLIP_DURATION_MS;
  window.setTimeout(() => {
    revealingRowIndex = null;
    isAnimating = false;
    renderBoard();
    onComplete();
  }, totalDuration);
}

function bounceRow(rowIndex: number): void {
  if (settings.reduceMotion) return;
  const row = document.querySelector<HTMLElement>(`.board-row[data-row="${rowIndex}"]`);
  if (!row) return;

  const tiles = Array.from(row.querySelectorAll<HTMLElement>('.tile'));
  tiles.forEach((tile, index) => {
    tile.style.animationDelay = `${index * BOUNCE_STAGGER_MS}ms`;
    tile.classList.add('bounce');
  });

  window.setTimeout(() => {
    tiles.forEach((tile) => {
      tile.classList.remove('bounce');
      tile.style.animationDelay = '';
    });
  }, BOUNCE_DURATION_MS + tiles.length * BOUNCE_STAGGER_MS);
}

function rejectGuess(message: string): void {
  showToast(message);
  const row = document.querySelector<HTMLElement>(`.board-row[data-row="${game.guesses.length}"]`);
  if (!row) return;
  row.classList.remove('shake');
  void row.offsetWidth;
  row.classList.add('shake');
}

function evaluateGuess(guess: string, solution: string): LetterState[] {
  const guessTokens = tokenize(guess);
  const solutionTokens = tokenize(solution);
  const result: LetterState[] = Array(WORD_LENGTH).fill('absent') as LetterState[];
  const remaining = new Map<string, number>();

  for (let index = 0; index < WORD_LENGTH; index += 1) {
    if (guessTokens[index] === solutionTokens[index]) {
      result[index] = 'correct';
    } else {
      remaining.set(solutionTokens[index], (remaining.get(solutionTokens[index]) ?? 0) + 1);
    }
  }

  for (let index = 0; index < WORD_LENGTH; index += 1) {
    if (result[index] === 'correct') continue;
    const token = guessTokens[index];
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      result[index] = 'present';
      remaining.set(token, count - 1);
    }
  }

  return result;
}

function getHardModeProblem(nextGuess: string): string | null {
  const nextTokens = tokenize(nextGuess);
  const requiredCounts = new Map<string, number>();

  for (let row = 0; row < game.guesses.length; row += 1) {
    const previousTokens = tokenize(game.guesses[row]);
    const previousEvaluation = game.evaluations[row];
    const rowCounts = new Map<string, number>();

    for (let column = 0; column < WORD_LENGTH; column += 1) {
      const token = previousTokens[column];
      const state = previousEvaluation[column];
      if (state === 'correct' && nextTokens[column] !== token) {
        return `${token} must stay in spot ${column + 1}.`;
      }
      if (state === 'correct' || state === 'present') {
        rowCounts.set(token, (rowCounts.get(token) ?? 0) + 1);
      }
    }

    rowCounts.forEach((count, token) => {
      requiredCounts.set(token, Math.max(requiredCounts.get(token) ?? 0, count));
    });
  }

  for (const [token, count] of requiredCounts.entries()) {
    const actual = nextTokens.filter((character) => character === token).length;
    if (actual < count) return `Guess must contain ${token}.`;
  }

  return null;
}

function finishGame(): void {
  if (game.completedAtEpochMs || stats.resultsByDate[game.dateKey]) return;

  game.completedAtEpochMs = getEstimatedEpochMs();
  const finalStatus = game.status as Exclude<GameStatus, 'playing'>;
  stats.resultsByDate[game.dateKey] = {
    status: finalStatus,
    guesses: game.guesses.length,
    puzzleNumber: game.puzzleNumber
  };
  stats.played += 1;
  stats.lastPlayedDateKey = game.dateKey;

  if (finalStatus === 'won') {
    stats.wins += 1;
    stats.guessDistribution[String(game.guesses.length)] = (stats.guessDistribution[String(game.guesses.length)] ?? 0) + 1;
    if (game.dateKey === todayDateInfo.dateKey) {
      const previousDateKey = getPreviousDateKey(game.dateKey);
      stats.currentStreak = stats.lastWinDateKey === previousDateKey ? stats.currentStreak + 1 : 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
      stats.lastWinDateKey = game.dateKey;
    }
  } else if (game.dateKey === todayDateInfo.dateKey) {
    stats.currentStreak = 0;
  }

  writeJson(STATS_KEY, stats);
}

function showArchiveModal(): void {
  const [currentYear, currentMonth] = (game.dateKey || todayDateInfo.dateKey).split('-').map(Number);
  if (!archiveYear) archiveYear = currentYear;
  if (!archiveMonth) archiveMonth = currentMonth;
  showModal('archive', buildArchiveModalContent());
}

function buildArchiveModalContent(): string {
  const [todayYear, todayMonth] = todayDateInfo.dateKey.split('-').map(Number);
  const canGoPrev = archiveYear > 2026 || (archiveYear === 2026 && archiveMonth > 7);
  const canGoNext = archiveYear < todayYear || (archiveYear === todayYear && archiveMonth < todayMonth);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthTitle = `${monthNames[archiveMonth - 1]} ${archiveYear}`;

  const daysInMonth = new Date(archiveYear, archiveMonth, 0).getDate();
  const firstDayOfWeek = new Date(archiveYear, archiveMonth - 1, 1).getDay();

  const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map((day) => `<div class="cal-weekday">${day}</div>`)
    .join('');

  let cells = '';
  for (let index = 0; index < firstDayOfWeek; index += 1) {
    cells += `<div class="cal-cell empty" aria-hidden="true"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayString = String(day).padStart(2, '0');
    const monthString = String(archiveMonth).padStart(2, '0');
    const cellDateKey = `${archiveYear}-${monthString}-${dayString}`;

    const isBeforeLaunch = cellDateKey < SCHEDULE_START_DATE;
    const isFuture = cellDateKey > todayDateInfo.dateKey;
    const isToday = cellDateKey === todayDateInfo.dateKey;
    const isCurrentActive = cellDateKey === game.dateKey;

    if (isBeforeLaunch) {
      cells += `<div class="cal-cell disabled"><span class="cal-num">${day}</span></div>`;
      continue;
    }

    if (isFuture) {
      cells += `<div class="cal-cell locked" title="Unlocks at midnight Manila time"><span class="cal-num">${day}</span><span class="cal-badge">🔒</span></div>`;
      continue;
    }

    const result = stats.resultsByDate[cellDateKey];
    let statusClass = 'unplayed';
    let statusLabel = 'Unplayed';
    let statusIcon = '';

    if (result) {
      if (result.status === 'won') {
        statusClass = 'won';
        statusLabel = `Solved in ${result.guesses} tries`;
        statusIcon = `<span class="cal-score">${result.guesses}/6</span>`;
      } else {
        statusClass = 'lost';
        statusLabel = 'Unsolved';
        statusIcon = `<span class="cal-score">X/6</span>`;
      }
    } else {
      const saved = readJson<GameState | null>(getGameKey(cellDateKey), null);
      if (saved && saved.guesses && saved.guesses.length > 0) {
        statusClass = 'in-progress';
        statusLabel = 'In progress';
        statusIcon = `<span class="cal-score">${saved.guesses.length}…</span>`;
      } else {
        statusClass = 'unplayed';
        statusLabel = 'Playable';
      }
    }

    const currentClass = isCurrentActive ? ' is-active' : '';
    const todayClass = isToday ? ' is-today' : '';

    cells += `
      <button class="cal-cell ${statusClass}${currentClass}${todayClass}"
              type="button"
              data-action="pick-archive-date"
              data-date="${cellDateKey}"
              aria-label="${cellDateKey}: ${statusLabel}"
              title="${cellDateKey}: ${statusLabel}">
        <span class="cal-num">${day}</span>
        ${statusIcon}
        ${isToday ? '<span class="cal-today-tag">TODAY</span>' : ''}
      </button>
    `;
  }

  const totalPlayableDays = daysBetweenDateKeys(SCHEDULE_START_DATE, todayDateInfo.dateKey) + 1;
  const completedEntries = Object.keys(stats.resultsByDate).filter(
    (key) => key >= SCHEDULE_START_DATE && key <= todayDateInfo.dateKey
  ).length;

  return `
    <div class="archive-container">
      <div class="archive-header">
        <h2>Calendar Archive</h2>
        <p class="muted">Play any previous puzzle since launch on July 25, 2026. (${completedEntries} of ${totalPlayableDays} solved)</p>
      </div>

      <div class="cal-month-nav">
        <button class="icon-button cal-nav-btn" type="button" data-action="archive-prev-month" aria-label="Previous month" ${canGoPrev ? '' : 'disabled'}>
          ◀
        </button>
        <span class="cal-month-title">${monthTitle}</span>
        <button class="icon-button cal-nav-btn" type="button" data-action="archive-next-month" aria-label="Next month" ${canGoNext ? '' : 'disabled'}>
          ▶
        </button>
      </div>

      <div class="cal-weekdays">${dayHeaders}</div>
      <div class="cal-grid">${cells}</div>

      <div class="cal-legend">
        <span><i class="legend-swatch won"></i> Won</span>
        <span><i class="legend-swatch lost"></i> Missed</span>
        <span><i class="legend-swatch in-progress"></i> In progress</span>
        <span><i class="legend-swatch unplayed"></i> Unplayed</span>
      </div>

      <div class="modal-actions archive-actions">
        ${game.dateKey !== todayDateInfo.dateKey ? '<button class="primary-button" type="button" data-action="return-today">Back to Today\'s Word</button>' : ''}
        <button class="text-button" type="button" data-action="close-modal">Close</button>
      </div>
    </div>
  `;
}

function showHelpModal(): void {
  showModal('help', `
    <h2>How to play</h2>
    <p>Guess the six-letter Filipino or Tagalog word in six tries.</p>
    <div class="example-grid" aria-hidden="true">
      <div class="tile" data-state="correct">T</div>
      <div class="tile" data-state="empty">A</div>
      <div class="tile tile-wide-letter" data-state="empty">NG</div>
      <div class="tile" data-state="empty">G</div>
      <div class="tile" data-state="empty">A</div>
      <div class="tile" data-state="empty">P</div>
    </div>
    <p><strong>Green</strong> means the letter is in the right spot.</p>
    <div class="example-grid" aria-hidden="true">
      <div class="tile" data-state="empty">S</div>
      <div class="tile" data-state="present">A</div>
      <div class="tile tile-wide-letter" data-state="empty">NG</div>
      <div class="tile" data-state="empty">K</div>
      <div class="tile" data-state="empty">A</div>
      <div class="tile" data-state="empty">P</div>
    </div>
    <p><strong>Yellow</strong> means the letter is in the word but in a different spot.</p>
    <div class="example-grid" aria-hidden="true">
      <div class="tile" data-state="empty">B</div>
      <div class="tile" data-state="absent">U</div>
      <div class="tile" data-state="empty">K</div>
      <div class="tile" data-state="empty">A</div>
      <div class="tile" data-state="empty">N</div>
      <div class="tile" data-state="empty">A</div>
    </div>
    <p><strong>Gray</strong> means the letter is not in the word.</p>
    <p class="muted"><strong>Ñ</strong> and the <strong>NG</strong> combination each count as a single letter, just like in Filipino dictionaries. Use the dedicated NG key on the keyboard, or type N then G and they'll combine automatically.</p>
    <p class="muted">A new word appears every 12:00 AM Philippine time. The date is calculated in Manila time, not your device timezone.</p>
  `);
}

function showStatsModal(): void {
  const winPercent = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const maxDistribution = Math.max(1, ...Object.values(stats.guessDistribution));
  const distribution = Array.from({ length: MAX_GUESSES }, (_, index) => {
    const guessNumber = index + 1;
    const count = stats.guessDistribution[String(guessNumber)] ?? 0;
    const width = count ? Math.max(12, Math.round((count / maxDistribution) * 100)) : 0;
    return `
      <div class="distribution-row">
        <span>${guessNumber}</span>
        <div class="distribution-track"><div class="distribution-bar" data-width="${width}">${count}</div></div>
      </div>`;
  }).join('');

  const isArchive = game.dateKey !== todayDateInfo.dateKey;
  const resultLine = game.status === 'playing'
    ? `<p class="muted">${isArchive ? `Playing archive puzzle #${game.puzzleNumber} (${dateInfo.displayDate}).` : `Keep going. Today's puzzle closes at midnight Manila time.`}</p>`
    : `
      <p class="result-line">${isArchive ? `Puzzle #${game.puzzleNumber} (${dateInfo.displayDate})` : 'Today'}: <strong>${game.status === 'won' ? `${game.guesses.length}/6` : `X/6`}</strong></p>
      <p class="word-meaning"><strong>${game.solution}</strong> — ${game.definition}</p>
    `;

  showModal('stats', `
    <h2>Statistics</h2>
    ${resultLine}
    <div class="stats-grid">
      <div><strong>${stats.played}</strong><span>Played</span></div>
      <div><strong>${winPercent}</strong><span>Win %</span></div>
      <div><strong>${stats.currentStreak}</strong><span>Current</span></div>
      <div><strong>${stats.maxStreak}</strong><span>Max</span></div>
    </div>
    <h3>Guess distribution</h3>
    <div class="distribution">${distribution}</div>
    <div class="modal-actions">
      ${game.status !== 'playing' ? '<button class="primary-button" type="button" data-action="share">Share result</button>' : '<button class="primary-button" type="button" data-action="play-again-info">Next puzzle info</button>'}
      <button class="text-button" type="button" data-action="archive">📅 Calendar Archive</button>
      <button class="text-button danger" type="button" data-action="reset-stats">Reset stats</button>
    </div>
  `);

  const modalRoot = document.querySelector('#modalRoot');
  const bars = Array.from(modalRoot?.querySelectorAll<HTMLElement>('.distribution-bar') ?? []);
  window.requestAnimationFrame(() => {
    bars.forEach((bar) => {
      bar.style.width = `${bar.dataset.width ?? '0'}%`;
    });
  });
}

function showSettingsModal(): void {
  const hardModeDisabled = game.guesses.length > 0 && !settings.hardMode ? 'disabled' : '';
  showModal('settings', `
    <h2>Settings</h2>
    <label class="setting-row">
      <span><strong>Hard mode</strong><small>Revealed hints must be used in future guesses.</small></span>
      <input type="checkbox" data-setting="hardMode" ${settings.hardMode ? 'checked' : ''} ${hardModeDisabled} />
    </label>
    <label class="setting-row">
      <span><strong>Dark theme</strong><small>Use a darker board and interface.</small></span>
      <input type="checkbox" data-setting="darkMode" ${settings.darkMode ? 'checked' : ''} />
    </label>
    <label class="setting-row">
      <span><strong>High contrast</strong><small>Use blue and orange tile colors.</small></span>
      <input type="checkbox" data-setting="highContrast" ${settings.highContrast ? 'checked' : ''} />
    </label>
    <label class="setting-row">
      <span><strong>Reduce motion</strong><small>Minimize animations.</small></span>
      <input type="checkbox" data-setting="reduceMotion" ${settings.reduceMotion ? 'checked' : ''} />
    </label>
    <div class="time-note">
      <strong>Daily reset</strong>
      <p>Uses Manila time (UTC+8) and network time when available. Current time source: ${formatTimeSource(dateInfo.source)}.</p>
    </div>
    <div class="modal-actions">
      <button id="installButton" class="primary-button" type="button" data-action="install" ${installPromptEvent ? '' : 'disabled'}>Install app</button>
    </div>
    <div class="credits">
      <p>Made by <a href="https://instagram.com/gianrufin" target="_blank" rel="noopener noreferrer">Gian Rufin</a></p>
    </div>
  `);

  const modal = document.querySelector('#modalRoot');
  modal?.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.setting as keyof Settings;
      if (key === 'hardMode' && game.guesses.length > 0 && input.checked !== settings.hardMode) {
        input.checked = settings.hardMode;
        showToast('Hard mode can only be changed before a puzzle.');
        return;
      }
      settings = { ...settings, [key]: input.checked };
      writeJson(SETTINGS_KEY, settings);
      applySettings();
    });
  });
}

function showModal(name: string, body: string): void {
  activeModal = name;
  const root = document.querySelector<HTMLDivElement>('#modalRoot');
  if (!root) return;
  root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <button class="icon-button modal-close" type="button" data-action="close-modal" aria-label="Close">×</button>
      ${body.replace('<h2>', '<h2 id="modalTitle">')}
    </div>
  `;
  root.classList.add('hidden');
  void root.offsetWidth;
  root.classList.remove('hidden');
}

function closeModal(): void {
  activeModal = null;
  const root = document.querySelector<HTMLDivElement>('#modalRoot');
  if (!root) return;
  root.classList.add('hidden');
  root.setAttribute('aria-hidden', 'true');

  const closedModal = root;
  window.setTimeout(() => {
    if (closedModal.classList.contains('hidden')) closedModal.innerHTML = '';
  }, settings.reduceMotion ? 0 : 260);
}

function showToast(message: string): void {
  const element = document.querySelector<HTMLDivElement>('#message');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  window.setTimeout(() => element.classList.remove('show'), 2200);
}

async function shareResults(): Promise<void> {
  if (game.status === 'playing') {
    showToast('Finish the puzzle before sharing.');
    return;
  }

  const palette = settings.highContrast ? HIGH_CONTRAST_EMOJI : RESULT_EMOJI;
  const score = game.status === 'won' ? `${game.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const grid = game.evaluations.map((row) => row.map((state) => palette[state]).join('')).join('\n');
  const text = `Wordle Tagalog #${game.puzzleNumber} ${score}\n${game.dateKey} Manila time\n\n${grid}\n\n${window.location.href}`;

  try {
    if (navigator.share) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(text);
      showToast('Result copied to clipboard.');
    }
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Result copied to clipboard.');
    } catch {
      showToast('Could not share from this browser.');
    }
  }
}

async function promptInstall(): Promise<void> {
  if (!installPromptEvent) {
    showToast('Use your browser menu to add this app to your home screen.');
    return;
  }

  await installPromptEvent.prompt();
  const choice = await installPromptEvent.userChoice;
  if (choice.outcome === 'accepted') showToast('Wordle Tagalog installed.');
  installPromptEvent = null;
  updateInstallButton();
}

function updateInstallButton(): void {
  const button = document.querySelector<HTMLButtonElement>('#installButton');
  if (button) button.disabled = !installPromptEvent;
}

function resetStats(): void {
  const confirmed = window.confirm('Reset all Wordle Tagalog stats? Your current board will stay.');
  if (!confirmed) return;
  stats = createDefaultStats();
  writeJson(STATS_KEY, stats);
  showStatsModal();
  showToast('Stats reset.');
}

function getWinMessage(tries: number): string {
  const messages = ['Galing!', 'Ang talino!', 'Ayos!', 'Nice!', 'Solved!', 'Clutch!'];
  return messages[Math.min(tries - 1, messages.length - 1)];
}

function loadSettings(): Settings {
  return readJson<Settings>(SETTINGS_KEY, {
    hardMode: false,
    darkMode: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
    highContrast: false,
    reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  });
}

function loadStats(): Stats {
  const fallback = createDefaultStats();
  const saved = readJson<Stats>(STATS_KEY, fallback);
  return {
    ...fallback,
    ...saved,
    guessDistribution: { ...fallback.guessDistribution, ...saved.guessDistribution },
    resultsByDate: { ...saved.resultsByDate }
  };
}

function createDefaultStats(): Stats {
  return {
    played: 0,
    wins: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
      '6': 0
    },
    resultsByDate: {}
  };
}

function loadGame(info: ManilaDateInfo): GameState {
  const key = getGameKey(info.dateKey);
  const fallback = createNewGame(info);
  const saved = readJson<GameState>(key, fallback);
  if (saved.dateKey !== info.dateKey || saved.solution !== fallback.solution) return fallback;
  return {
    ...fallback,
    ...saved,
    puzzleNumber: fallback.puzzleNumber,
    currentGuess: saved.status === 'playing' ? saved.currentGuess ?? '' : ''
  };
}

function createNewGame(info: ManilaDateInfo): GameState {
  const puzzle = getPuzzleForDate(info.dateKey);
  return {
    dateKey: info.dateKey,
    puzzleNumber: puzzle.puzzleNumber,
    solution: puzzle.word,
    definition: puzzle.definition,
    source: puzzle.source,
    difficulty: puzzle.difficulty,
    isFallback: puzzle.isFallback,
    guesses: [],
    evaluations: [],
    currentGuess: '',
    status: 'playing'
  };
}

function saveGame(): void {
  writeJson(getGameKey(game.dateKey), game);
}

function getGameKey(dateKey: string): string {
  return `wordle-tagalog:game:${dateKey}:v1`;
}

function applySettings(): void {
  document.documentElement.dataset.theme = settings.darkMode ? 'dark' : 'light';
  document.documentElement.dataset.contrast = settings.highContrast ? 'high' : 'normal';
  document.documentElement.dataset.motion = settings.reduceMotion ? 'reduced' : 'normal';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.darkMode ? '#020617' : '#f8fafc');
}

function startTicker(): void {
  if (ticker) window.clearInterval(ticker);
  ticker = window.setInterval(async () => {
    const estimatedEpochMs = getEstimatedEpochMs();
    const remaining = todayDateInfo.nextMidnightEpochMs - estimatedEpochMs;
    const countdown = document.querySelector('#countdown');
    if (countdown) countdown.textContent = formatCountdown(remaining);

    if (remaining <= 0) {
      await refreshPuzzleIfNeeded();
    }
  }, 1000);
}

async function refreshPuzzleIfNeeded(): Promise<void> {
  const latestInfo = await getManilaDateInfo();
  appLoadedDeviceEpochMs = Date.now();
  trustedBaseEpochMs = latestInfo.epochMs;
  if (latestInfo.dateKey === todayDateInfo.dateKey) {
    todayDateInfo = latestInfo;
    if (dateInfo.dateKey === todayDateInfo.dateKey) {
      dateInfo = latestInfo;
      renderStatus();
    }
    return;
  }

  const wasOnToday = dateInfo.dateKey === todayDateInfo.dateKey;
  todayDateInfo = latestInfo;
  if (wasOnToday) {
    dateInfo = latestInfo;
    game = loadGame(dateInfo);
    closeModal();
    if (!showingLanding) {
      render();
      showToast('A new Wordle Tagalog puzzle is live.');
    } else {
      renderLanding();
    }
  }
}

function getEstimatedEpochMs(): number {
  return trustedBaseEpochMs + (Date.now() - appLoadedDeviceEpochMs);
}

function formatTimeSource(source: ManilaDateInfo['source']): string {
  if (source === 'network') return 'network time';
  if (source === 'cached-network') return 'recent network time';
  return 'device time fallback';
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        void registration.unregister();
      }
    });
    return;
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./service-worker.js');
  });
}

// Handy for QA during development. Does not run in production unless called manually.
(window as unknown as { WordleTagalogDebug?: unknown }).WordleTagalogDebug = {
  get game() {
    return game;
  },
  get stats() {
    return stats;
  },
  clearToday() {
    removeKey(getGameKey(game.dateKey));
    game = createNewGame(dateInfo);
    render();
  },
  evaluateGuess
};
