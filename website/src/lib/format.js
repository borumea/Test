// src/lib/format.js
//
// Central number formatter used across the app to ensure consistent
// thousands separators and decimal display.
//
// Improvements:
//  - null/undefined/NaN -> "-"
//  - Integers are shown without decimals (e.g. "157,175")
//  - Non-integers show up to 6 significant decimal places, trailing zeros removed
//  - Uses Intl.NumberFormat for locale-aware grouping/decimal separators

export function formatNumber(value) {
    if (value == null) return "-";
    const num = Number(value);
    if (!isFinite(num)) return "-";

    // If value is an integer, show no decimal places.
    if (Number.isInteger(num)) {
        return new Intl.NumberFormat(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(num);
    }

    // For non-integers, show up to 6 decimals but trim unnecessary trailing zeros.
    // Intl.NumberFormat will handle locale-specific separators.
    return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6,
    }).format(num);
}

export function formatDateLocal(isoStr) {
    // Handles pure "YYYY-MM-DD" or Date-compatible strings
    if (!isoStr) return "";
    try {
        // If string looks like a date only (no time)
        if (/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return isoStr;

        const d = new Date(isoStr);
        if (isNaN(d)) return isoStr;
        return d.toLocaleDateString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
    } catch {
        return isoStr;
    }
}

export function formatTimeLocal(isoStr) {
    if (!isoStr) return "";
    try {
        const d = new Date(isoStr);
        if (isNaN(d)) return isoStr;

        return d.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return isoStr;
    }
}

export function formatDateTimeLocal(isoStr) {
    if (!isoStr) return "";
    try {
        const d = new Date(isoStr);
        if (isNaN(d)) return isoStr;
        return d.toLocaleString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    } catch {
        return isoStr;
    }
}