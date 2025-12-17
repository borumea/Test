// src/utils/storage.js
// Simple cookie helpers for JSON data
const COOKIE_NAME = "dashboard_view_v1";
const COOKIE_MAX_AGE_DAYS = 365 * 2; // 2 years

function setCookie(name, value, days) {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; samesite=lax`;
}

function getCookie(name) {
    const pairs = document.cookie ? document.cookie.split("; ") : [];
    for (const p of pairs) {
        const [k, v] = p.split("=");
        if (decodeURIComponent(k) === name) return decodeURIComponent(v || "");
    }
    return null;
}

export function saveDashboardView(obj) {
    try {
        setCookie(COOKIE_NAME, JSON.stringify(obj), COOKIE_MAX_AGE_DAYS);
    } catch (e) {
        console.warn("Failed to save cookie", e);
    }
}

export function loadDashboardView() {
    try {
        const raw = getCookie(COOKIE_NAME);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn("Failed to load dashboard cookie", e);
        return null;
    }
}

export function clearDashboardView() {
    setCookie(COOKIE_NAME, "", -1);
}