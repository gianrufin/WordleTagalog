import { MAX_GUESSES, SOLUTIONS, VALID_GUESSES, WORD_LENGTH } from './words.js';
import { buildManilaDateInfo, formatCountdown, getManilaDateInfo, getPreviousDateKey, type ManilaDateInfo } from './time.js';
import { readJson, removeKey, writeJson } from './storage.js';

type LetterState = 'correct' | 'present' | 'absent';
type TileState = LetterState | 'filled' | 'empty';
type GameStatus = 'playing' | 'won' | 'lost';

type GameState = {
  dateKey: string;
  puzzleNumber: number;
  solution: string;
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
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACKSPACE']
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

let dateInfo: ManilaDateInfo;
let game: GameState;
let settings: Settings;
let stats: Stats;
let appLoadedDeviceEpochMs = Date.now();
let trustedBaseEpochMs = Date.now();
let installPromptEvent: InstallPromptEvent | null = null;
let activeModal: string | null = null;
let ticker: number | undefined;

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('App root not found.');
const app: HTMLDivElement = appRoot;

void initialize();

async function initialize(): Promise<void> {
  settings = loadSettings();
  stats = loadStats();
  dateInfo = await getManilaDateInfo();
  appLoadedDeviceEpochMs = Date.now();
  trustedBaseEpochMs = dateInfo.epochMs;
  game = loadGame(dateInfo);
  applySettings();
  renderShell();
  bindEvents();
  render();
  startTicker();
  registerServiceWorker();
}

function renderShell(): void {
  app.innerHTML = `
    <header class="topbar" aria-label="Wordle Tagalog header">
      <button class="icon-button" type="button" data-action="help" aria-label="How to play">?</button>
      <div class="title-lockup">
        <p class="eyebrow">Daily Filipino word puzzle</p>
        <h1>Wordle Tagalog</h1>
      </div>
      <div class="header-actions">
        <button class="icon-button" type="button" data-action="stats" aria-label="Statistics">▥</button>
        <button class="icon-button" type="button" data-action="settings" aria-label="Settings">⚙</button>
      </div>
    </header>

    <main class="game" aria-live="polite">
      <section class="status-card" aria-label="Puzzle status">
        <div>
          <span class="label">Puzzle</span>
          <strong id="puzzleNumber">#${dateInfo.puzzleNumber}</strong>
        </div>
        <div>
          <span class="label">Manila date</span>
          <strong id="manilaDate">${dateInfo.displayDate}</strong>
        </div>
        <div>
          <span class="label">Next word</span>
          <strong id="countdown">--:--:--</strong>
        </div>
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
  if (puzzleNumber) puzzleNumber.textContent = `#${dateInfo.puzzleNumber}`;
  if (manilaDate) manilaDate.textContent = dateInfo.displayDate;
  if (countdown) countdown.textContent = formatCountdown(dateInfo.nextMidnightEpochMs - getEstimatedEpochMs());
}

function renderBoard(): void {
  const board = document.querySelector<HTMLDivElement>('#board');
  if (!board) return;

  const rows = Array.from({ length: MAX_GUESSES }, (_, rowIndex) => {
    const submittedGuess = game.guesses[rowIndex];
    const isCurrentRow = rowIndex === game.guesses.length && game.status === 'playing';
    const word = submittedGuess ?? (isCurrentRow ? game.currentGuess : '');
    const evaluation = game.evaluations[rowIndex];
    const tiles = Array.from({ length: WORD_LENGTH }, (_, tileIndex) => {
      const letter = word[tileIndex] ?? '';
      const tileState: TileState = evaluation?.[tileIndex] ?? (letter ? 'filled' : 'empty');
      const aria = letter ? `${letter}, ${tileState}` : 'empty';
      return `<div class="tile" data-state="${tileState}" role="gridcell" aria-label="${aria}">${letter}</div>`;
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
      const className = key.length > 1 ? 'key wide-key' : 'key';
      return `<button class="${className}" type="button" data-key="${key}" data-state="${state}" aria-label="${key}">${label}</button>`;
    }).join('');
    return `<div class="keyboard-row">${keys}</div>`;
  }).join('');
}

function getKeyboardStates(): Map<string, LetterState> {
  const keys = new Map<string, LetterState>();
  game.guesses.forEach((guess, rowIndex) => {
    const evaluation = game.evaluations[rowIndex];
    evaluation.forEach((state, letterIndex) => {
      const letter = guess[letterIndex];
      const current = keys.get(letter);
      if (!current || statePriority[state] > statePriority[current]) keys.set(letter, state);
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
  if (event.key === 'Escape' && activeModal) {
    closeModal();
    return;
  }

  if (activeModal) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const key = event.key === 'Backspace' ? 'BACKSPACE' : event.key === 'Enter' ? 'ENTER' : event.key.toUpperCase();
  if (key === 'BACKSPACE' || key === 'ENTER' || /^[A-Z]$/.test(key)) {
    event.preventDefault();
    handleInput(key);
  }
}

function handleInput(key: string): void {
  if (game.status !== 'playing') {
    showToast(game.status === 'won' ? 'You already solved today\'s word.' : `Today's word was ${game.solution}.`);
    return;
  }

  if (key === 'ENTER') {
    submitGuess();
    return;
  }

  if (key === 'BACKSPACE') {
    game.currentGuess = game.currentGuess.slice(0, -1);
    saveGame();
    renderBoard();
    return;
  }

  if (/^[A-Z]$/.test(key) && game.currentGuess.length < WORD_LENGTH) {
    game.currentGuess += key;
    saveGame();
    renderBoard();
  }
}

function submitGuess(): void {
  const guess = game.currentGuess.toUpperCase();

  if (guess.length < WORD_LENGTH) {
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

  const evaluation = evaluateGuess(guess, game.solution);
  game.guesses.push(guess);
  game.evaluations.push(evaluation);
  game.currentGuess = '';

  if (guess === game.solution) {
    game.status = 'won';
    finishGame();
    showToast(getWinMessage(game.guesses.length));
  } else if (game.guesses.length === MAX_GUESSES) {
    game.status = 'lost';
    finishGame();
    showToast(`The word was ${game.solution}.`);
  }

  saveGame();
  render();

  if (game.status !== 'playing') {
    window.setTimeout(() => showStatsModal(), settings.reduceMotion ? 0 : 700);
  }
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
  const result: LetterState[] = Array(WORD_LENGTH).fill('absent') as LetterState[];
  const remaining = new Map<string, number>();

  for (let index = 0; index < WORD_LENGTH; index += 1) {
    if (guess[index] === solution[index]) {
      result[index] = 'correct';
    } else {
      remaining.set(solution[index], (remaining.get(solution[index]) ?? 0) + 1);
    }
  }

  for (let index = 0; index < WORD_LENGTH; index += 1) {
    if (result[index] === 'correct') continue;
    const letter = guess[index];
    const count = remaining.get(letter) ?? 0;
    if (count > 0) {
      result[index] = 'present';
      remaining.set(letter, count - 1);
    }
  }

  return result;
}

function getHardModeProblem(nextGuess: string): string | null {
  const requiredCounts = new Map<string, number>();

  for (let row = 0; row < game.guesses.length; row += 1) {
    const previousGuess = game.guesses[row];
    const previousEvaluation = game.evaluations[row];
    const rowCounts = new Map<string, number>();

    for (let column = 0; column < WORD_LENGTH; column += 1) {
      const letter = previousGuess[column];
      const state = previousEvaluation[column];
      if (state === 'correct' && nextGuess[column] !== letter) {
        return `${letter} must stay in spot ${column + 1}.`;
      }
      if (state === 'correct' || state === 'present') {
        rowCounts.set(letter, (rowCounts.get(letter) ?? 0) + 1);
      }
    }

    rowCounts.forEach((count, letter) => {
      requiredCounts.set(letter, Math.max(requiredCounts.get(letter) ?? 0, count));
    });
  }

  for (const [letter, count] of requiredCounts.entries()) {
    const actual = Array.from(nextGuess).filter((character) => character === letter).length;
    if (actual < count) return `Guess must contain ${letter}.`;
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
    const previousDateKey = getPreviousDateKey(game.dateKey);
    stats.currentStreak = stats.lastWinDateKey === previousDateKey ? stats.currentStreak + 1 : 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
    stats.lastWinDateKey = game.dateKey;
  } else {
    stats.currentStreak = 0;
  }

  writeJson(STATS_KEY, stats);
}

function showHelpModal(): void {
  showModal('help', `
    <h2>How to play</h2>
    <p>Guess the five-letter Filipino or Tagalog word in six tries.</p>
    <div class="example-grid" aria-hidden="true">
      <div class="tile" data-state="correct">S</div>
      <div class="tile" data-state="empty">U</div>
      <div class="tile" data-state="empty">L</div>
      <div class="tile" data-state="empty">A</div>
      <div class="tile" data-state="empty">T</div>
    </div>
    <p><strong>Green</strong> means the letter is in the right spot.</p>
    <div class="example-grid" aria-hidden="true">
      <div class="tile" data-state="empty">B</div>
      <div class="tile" data-state="present">A</div>
      <div class="tile" data-state="empty">Y</div>
      <div class="tile" data-state="empty">A</div>
      <div class="tile" data-state="empty">N</div>
    </div>
    <p><strong>Yellow</strong> means the letter is in the word but in a different spot.</p>
    <div class="example-grid" aria-hidden="true">
      <div class="tile" data-state="empty">P</div>
      <div class="tile" data-state="empty">U</div>
      <div class="tile" data-state="absent">S</div>
      <div class="tile" data-state="empty">O</div>
      <div class="tile" data-state="empty">K</div>
    </div>
    <p><strong>Gray</strong> means the letter is not in the word.</p>
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
        <div class="distribution-track"><div class="distribution-bar" style="width:${width}%">${count}</div></div>
      </div>`;
  }).join('');

  const resultLine = game.status === 'playing'
    ? `<p class="muted">Keep going. Today\'s puzzle closes at midnight Manila time.</p>`
    : `<p class="result-line">Today: <strong>${game.status === 'won' ? `${game.guesses.length}/6` : `X/6`}</strong></p>`;

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
      <button class="text-button danger" type="button" data-action="reset-stats">Reset stats</button>
    </div>
  `);
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
  root.classList.remove('hidden');
  root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <button class="icon-button modal-close" type="button" data-action="close-modal" aria-label="Close">×</button>
      ${body.replace('<h2>', '<h2 id="modalTitle">')}
    </div>
  `;
}

function closeModal(): void {
  activeModal = null;
  const root = document.querySelector<HTMLDivElement>('#modalRoot');
  if (!root) return;
  root.classList.add('hidden');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '';
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
  if (saved.dateKey !== info.dateKey || saved.solution !== SOLUTIONS[info.puzzleIndex]) return fallback;
  return {
    ...fallback,
    ...saved,
    currentGuess: saved.status === 'playing' ? saved.currentGuess ?? '' : ''
  };
}

function createNewGame(info: ManilaDateInfo): GameState {
  return {
    dateKey: info.dateKey,
    puzzleNumber: info.puzzleNumber,
    solution: SOLUTIONS[info.puzzleIndex],
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
    const remaining = dateInfo.nextMidnightEpochMs - estimatedEpochMs;
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
  if (latestInfo.dateKey === dateInfo.dateKey) {
    dateInfo = latestInfo;
    renderStatus();
    return;
  }

  dateInfo = latestInfo;
  game = loadGame(dateInfo);
  closeModal();
  render();
  showToast('A new Wordle Tagalog puzzle is live.');
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
