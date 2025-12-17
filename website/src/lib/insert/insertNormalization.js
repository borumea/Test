// Insert page normalization helpers (extracted from InsertPage.js)
export function _tryParseJSONIfString(val) {
    if (typeof val !== "string") return val;
    const trimmed = val.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return val;
    try {
        return JSON.parse(val);
    } catch (e) {
        return val;
    }
}

export function normalizeBitValueForForm(raw) {
    // Accept Buffer-like objects: { type: "Buffer", data: [1] }, Buffer-like arrays, numbers, booleans, or strings "0"/"1"
    const v = _tryParseJSONIfString(raw);
    if (v && typeof v === "object" && typeof v.data !== "undefined") {
        // Buffer-like
        if (Array.isArray(v.data) && v.data.length === 0) return "";
        if (Array.isArray(v.data)) return Number(Boolean(v.data[0]));
        if (typeof v.data === "number") return v.data === 0 ? 0 : 1;
        return Number(Boolean(v.data));
    }
    if (Array.isArray(v)) {
        if (v.length === 0) return "";
        return Number(Boolean(v[0]));
    }
    if (typeof v === "number") return v === 0 ? 0 : 1;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
        const s = v.trim();
        if (s === "") return "";
        if (s === "0" || s.toLowerCase() === "false") return 0;
        if (s === "1" || s.toLowerCase() === "true") return 1;
        // maybe stringified Buffer — try parse above already
    }
    return v;
}

export function normalizeRecordForForm(record = {}, colsMeta = []) {
    if (!record || typeof record !== "object") return record;
    const out = { ...record };
    const metaByName = {};
    (colsMeta || []).forEach((c) => {
        if (c && c.name) metaByName[c.name] = c;
    });

    for (const k of Object.keys(out)) {
        const meta = metaByName[k];
        const val = out[k];

        // Handle datetime/timestamp columns
        if (meta && ["datetime", "timestamp"].includes((meta.type || "").toLowerCase())) {
            if (val && typeof val === "string") {
                try {
                    // Parse as UTC, then format as local YYYY-MM-DD HH:mm:ss
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) {
                        // Format in local timezone for the form
                        out[k] = formatDateTimeLocal(d);
                        continue;
                    }
                } catch (e) {
                    // Keep original if parsing fails
                }
            }
        }

        // Handle date columns
        if (meta && (meta.type || "").toLowerCase() === "date") {
            if (val && typeof val === "string") {
                try {
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) {
                        out[k] = d.toISOString().split("T")[0];
                        continue;
                    }
                } catch (e) {
                    // Keep original if parsing fails
                }
            }
        }

        if (meta && (meta.type || "").toLowerCase() === "bit") {
            out[k] = normalizeBitValueForForm(val);
            continue;
        }

        if (val && typeof val === "object" && typeof val.data !== "undefined") {
            out[k] = val;
            continue;
        }

        // Strings that look like JSON should be parsed so form editors can show objects/arrays properly
        if (typeof val === "string") {
            const maybe = _tryParseJSONIfString(val);
            out[k] = maybe;
            continue;
        }

        out[k] = val;
    }
    return out;
}

export function parseColumnsResponse(raw) {
    if (!Array.isArray(raw)) return [];
    if (raw.length === 0) return [];
    const first = raw[0];
    if (typeof first === "string") {
        return raw.map((name) => ({
            name,
            type: null,
            columnType: null,
            isPrimary: false,
            isNullable: true,
            maxLength: null,
            isAutoIncrement: false,
            isUnique: false,
        }));
    }
    if (typeof first === "object" && first !== null) {
        return raw
            .map((c) => {
                if (typeof c === "string")
                    return {
                        name: c,
                        type: null,
                        columnType: null,
                        isPrimary: false,
                        isNullable: true,
                        maxLength: null,
                        isAutoIncrement: false,
                        isUnique: false,
                    };

                const extra = (c.extra ?? c.EXTRA ?? c.EXTRA_INFO ?? "") || "";
                const isAuto = !!(
                    c.isAutoIncrement ||
                    c.is_auto_increment ||
                    String(extra).toLowerCase().includes("auto_increment")
                );

                const colKey = String(c.COLUMN_KEY || c.columnKey || "").toUpperCase();

                const isUniqueFlag =
                    Boolean(c.isUnique) ||
                    Boolean(c.is_unique) ||
                    Boolean(c.unique) ||
                    colKey === "UNI" ||
                    String(c.constraint_type || "").toUpperCase() === "UNIQUE";

                return {
                    name: c.name ?? c.column_name ?? c.COLUMN_NAME ?? c.field ?? "",
                    type:
                        (c.type ?? c.dataType ?? c.DATA_TYPE ?? null) &&
                        String(c.type ?? c.dataType ?? c.DATA_TYPE).toLowerCase(),
                    columnType: c.columnType ?? c.COLUMN_TYPE ?? null,
                    isPrimary: colKey === "PRI" || !!(c.isPrimary || c.primary || c.pk),
                    isUnique: isUniqueFlag,
                    isNullable:
                        typeof c.isNullable !== "undefined"
                            ? !!c.isNullable
                            : typeof c.IS_NULLABLE !== "undefined"
                                ? String(c.IS_NULLABLE).toUpperCase() === "YES"
                                : true,
                    maxLength: c.maxLength ?? c.CHARACTER_MAXIMUM_LENGTH ?? null,
                    isAutoIncrement: isAuto,
                };
            })
            .filter((c) => c.name);
    }
    return [];
}

export function guessPrimaryKeyColumn(colsMeta = []) {
    if (!colsMeta || colsMeta.length === 0) return "id";
    const byIsPrimary = colsMeta.find((c) => c.isPrimary);
    if (byIsPrimary) return byIsPrimary.name;
    const lower = colsMeta.map((c) => (c.name || "").toLowerCase());
    const idIndex = lower.indexOf("id");
    if (idIndex >= 0) return colsMeta[idIndex].name;
    const underscId = lower.findIndex((n) => n.endsWith("_id"));
    if (underscId >= 0) return colsMeta[underscId].name;
    return colsMeta[0].name;
}

export function formatDateTimeUTC(date = new Date()) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mi = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export function formatDateTimeLocal(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}