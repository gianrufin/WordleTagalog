export const MANILA_TIME_ZONE = 'Asia/Manila';
export const MANILA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const TRUSTED_TIME_OFFSET_KEY = 'wordle-tagalog:trusted-time-offset:v1';
const TRUSTED_TIME_API_URLS = [
    'https://worldtimeapi.org/api/timezone/Asia/Manila',
    'https://timeapi.io/api/Time/current/zone?timeZone=Asia/Manila'
];
const TIME_API_TIMEOUT_MS = 1800;
const OFFSET_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export async function getManilaDateInfo() {
    const trusted = await getTrustedEpochMs();
    return buildManilaDateInfo(trusted.epochMs, trusted.source);
}
export function buildManilaDateInfo(epochMs, source = 'device') {
    const parts = getManilaParts(epochMs);
    const dateKey = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    const displayDate = new Intl.DateTimeFormat('en-PH', {
        timeZone: MANILA_TIME_ZONE,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(new Date(epochMs));
    return {
        epochMs,
        source,
        dateKey,
        displayDate,
        nextMidnightEpochMs: getNextManilaMidnightEpochMs(parts.year, parts.month, parts.day)
    };
}
export function getMillisecondsUntilNextManilaMidnight(epochMs = Date.now()) {
    const info = buildManilaDateInfo(epochMs);
    return Math.max(0, info.nextMidnightEpochMs - epochMs);
}
export function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
export function getPreviousDateKey(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const utc = Date.UTC(year, month - 1, day) - 24 * 60 * 60 * 1000;
    const previous = new Date(utc);
    return `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-${pad(previous.getUTCDate())}`;
}
async function getTrustedEpochMs() {
    const networkEpochMs = await fetchNetworkEpochMs();
    if (typeof networkEpochMs === 'number' && Number.isFinite(networkEpochMs)) {
        saveTrustedOffset(networkEpochMs - Date.now());
        return { epochMs: networkEpochMs, source: 'network' };
    }
    const cachedOffset = loadTrustedOffset();
    if (cachedOffset && Date.now() - cachedOffset.savedAtEpochMs < OFFSET_MAX_AGE_MS) {
        return { epochMs: Date.now() + cachedOffset.offsetMs, source: 'cached-network' };
    }
    return { epochMs: Date.now(), source: 'device' };
}
async function fetchNetworkEpochMs() {
    for (const url of TRUSTED_TIME_API_URLS) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), TIME_API_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                cache: 'no-store',
                signal: controller.signal
            });
            if (!response.ok)
                continue;
            const data = await response.json();
            const epochMs = parseEpochMsFromTimeApi(data);
            if (epochMs)
                return epochMs;
        }
        catch {
            // GitHub Pages is static, so the app gracefully falls back when a time API is unreachable.
        }
        finally {
            window.clearTimeout(timeout);
        }
    }
    return null;
}
function parseEpochMsFromTimeApi(data) {
    const unixTime = data.unixtime;
    if (typeof unixTime === 'number')
        return unixTime * 1000;
    const epochMilliseconds = data.epochMilliseconds;
    if (typeof epochMilliseconds === 'number')
        return epochMilliseconds;
    const dateTime = data.datetime ?? data.dateTime;
    if (typeof dateTime === 'string') {
        const parsed = Date.parse(dateTime);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return null;
}
function saveTrustedOffset(offsetMs) {
    const payload = {
        offsetMs,
        savedAtEpochMs: Date.now()
    };
    localStorage.setItem(TRUSTED_TIME_OFFSET_KEY, JSON.stringify(payload));
}
function loadTrustedOffset() {
    try {
        const raw = localStorage.getItem(TRUSTED_TIME_OFFSET_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed.offsetMs !== 'number' || typeof parsed.savedAtEpochMs !== 'number')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function getManilaParts(epochMs) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: MANILA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date(epochMs));
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    return { year, month, day };
}
function getNextManilaMidnightEpochMs(year, month, day) {
    return Date.UTC(year, month - 1, day + 1, 0, 0, 0) - MANILA_UTC_OFFSET_MS;
}
export function daysBetweenDateKeys(startKey, endKey) {
    const [startYear, startMonth, startDay] = startKey.split('-').map(Number);
    const [endYear, endMonth, endDay] = endKey.split('-').map(Number);
    const start = Date.UTC(startYear, startMonth - 1, startDay);
    const end = Date.UTC(endYear, endMonth - 1, endDay);
    return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}
function pad(value) {
    return value.toString().padStart(2, '0');
}
