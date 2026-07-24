export function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw)
            return fallback;
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
export function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}
export function removeKey(key) {
    localStorage.removeItem(key);
}
