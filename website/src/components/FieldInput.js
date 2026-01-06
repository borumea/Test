import React, { useEffect, useState } from "react";
import TagManager from "./TagManager.js";
import RatingManager from "./RatingManager.js";
import { lockedColumns } from "../lib/insert/insertConstants";
import { excludedRatingsTables, excludedTagsTables } from "../lib/constants.js";
import { apiRequest } from "../lib/api.js";
import "../styles/TagManager.css";

// Module-level cache for column metadata to avoid redundant API calls
// Cache both the data AND in-flight promises to prevent race conditions
const columnMetadataCache = {};
const columnMetadataPromises = {};

/**
 * Clear the metadata cache for a specific table (or all tables)
 * Call this after creating/updating/deleting tags or ratings
 */
export function clearColumnMetadataCache(table = null) {
    if (table) {
        delete columnMetadataCache[table];
        delete columnMetadataPromises[table];
    } else {
        // Clear all caches
        Object.keys(columnMetadataCache).forEach(key => delete columnMetadataCache[key]);
        Object.keys(columnMetadataPromises).forEach(key => delete columnMetadataPromises[key]);
    }
}

/**
 * Fetch column metadata for a table (cached with promise deduplication)
 * Uses promise cache to ensure only 1 API call per table, even if called simultaneously
 */
async function getColumnMetadata(table) {
    // Return cached data if available
    if (columnMetadataCache[table]) {
        return columnMetadataCache[table];
    }

    // Return in-flight promise if one exists (prevents duplicate requests)
    if (columnMetadataPromises[table]) {
        return columnMetadataPromises[table];
    }

    // Create and cache the promise
    const promise = (async () => {
        try {
            const res = await apiRequest(`column-metadata?table=${encodeURIComponent(table)}`);
            if (res.ok) {
                const metadata = await res.json();
                columnMetadataCache[table] = metadata;
                return metadata;
            }
        } catch (err) {
            console.error('Failed to fetch column metadata:', err);
        } finally {
            // Clear the promise from cache after completion
            delete columnMetadataPromises[table];
        }

        return { tags: {}, ratings: {} };
    })();

    columnMetadataPromises[table] = promise;
    return promise;
}

/**
 * FieldInput Component
 * Handles rendering the appropriate input type for a given column,
 * including TagManager for text fields with tags.
 */
export function FieldInput({ meta, value, onChange, mode, table }) {
    const type = meta.type || "";
    const ct = (meta.columnType || "").toLowerCase();
    const name = meta.name;

    // Check for tags in text fields
    const [hasTags, setHasTags] = useState(false);
    const [checkingTags, setCheckingTags] = useState(true);
    const [showTagManager, setShowTagManager] = useState(false);

    // Check for ratings in integer fields
    const [hasRating, setHasRating] = useState(false);
    const [checkingRating, setCheckingRating] = useState(true);
    const [showRatingManager, setShowRatingManager] = useState(false);

    // State for file inputs
    const [fileName, setFileName] = useState("");

    // Determine if field is required
    const isRequired = (mode === "insert" && meta.isPrimary && !meta.isAutoIncrement) || (!meta.isNullable && !meta.isPrimary);

    // Determine if field is readonly
    const tableLockedCols = (lockedColumns[table]?.concat(lockedColumns.default) || lockedColumns.default) || [];
    const isLocked = tableLockedCols.map(n => n.toLowerCase()).includes(meta.name.toLowerCase());
    const isReadonly = (mode === "edit" && meta.isPrimary) || (mode === "edit" && isLocked);
    const isDisabled = isReadonly;

    // Check for tags and ratings on mount using batch endpoint
    useEffect(() => {
        async function checkMetadata() {
            const metadata = await getColumnMetadata(table);

            // Check for tags in text-type fields
            if (["varchar", "char", "text", "mediumtext", "longtext"].includes(type)) {
                const tags = metadata.tags[name] || [];
                setHasTags(tags.length > 0);
            }
            setCheckingTags(false);

            // Check for ratings in integer-type fields
            if (["int", "bigint", "smallint", "mediumint", "tinyint"].includes(type)) {
                setHasRating(!!metadata.ratings[name]);
            }
            setCheckingRating(false);
        }

        checkMetadata();
    }, [table, name, type]);

    // Effect to track file names for blob fields
    useEffect(() => {
        const isBlob = ["blob", "binary", "varbinary", "tinyblob", "mediumblob", "longblob"].includes(type) ||
            ct.includes("blob") || ct.includes("binary");

        if (!isBlob) return;

        if (value instanceof File) {
            setFileName(value.name);
        } else if (value && typeof value === "object" && value.type === "Buffer") {
            setFileName("(existing file)");
        } else if (value) {
            setFileName("(existing file)");
        } else {
            setFileName("");
        }
    }, [value, type, ct]);

    // Handler when tags are saved from the modal
    const handleTagsSaved = (tagsExist) => {
        if (tagsExist) {
            setHasTags(true);
            setShowTagManager(false);
        } else {
            setHasTags(false);
            setShowTagManager(false);
        }
    };

    // Handler to cancel tag creation
    const handleCancelTagCreation = () => {
        setShowTagManager(false);
    };

    // Handler when rating is saved from the modal
    const handleRatingSaved = (ratingExists) => {
        if (ratingExists) {
            setHasRating(true);
            setShowRatingManager(false);
        } else {
            setHasRating(false);
            setShowRatingManager(false);
        }
    };

    // Handler to cancel rating creation
    const handleCancelRatingCreation = () => {
        setShowRatingManager(false);
    };

    // TEXT TYPES (with potential tag support)
    if (["varchar", "char", "text", "mediumtext", "longtext"].includes(type)) {
        if (checkingTags) {
            return <div className="field-input">Loading...</div>;
        }

        if (hasTags || showTagManager) {
            let tagArray = [];
            try {
                if (Array.isArray(value)) {
                    tagArray = value;
                } else if (typeof value === 'string' && value.trim()) {
                    tagArray = value.split(',').map(t => t.trim()).filter(Boolean);
                }
            } catch (err) {
                console.error("Error parsing tag value:", err);
                tagArray = [];
            }

            return (
                <TagManager
                    table={table}
                    column={name}
                    value={tagArray}
                    onChange={(tags) => {
                        const tagString = tags.length > 0 ? tags.join(', ') : '';
                        onChange(tagString);
                    }}
                    required={isRequired}
                    readOnly={isReadonly}
                    onTagsSaved={handleTagsSaved}
                    onCancel={handleCancelTagCreation}
                    isCreatingTags={showTagManager}
                />
            );
        }

        const canBeTagged = excludedTagsTables[table] ? excludedTagsTables[table].includes(name) === false : true;
        if (["text", "mediumtext", "longtext"].includes(type)) {
            return (
                <div className="field-with-tags-option">
                    <textarea
                        className="field-input textarea"
                        value={value || ""}
                        onChange={isDisabled ? undefined : (e) => onChange(e.target.value)}
                        placeholder={name}
                        required={isRequired}
                        readOnly={isReadonly}
                    />
                    {!isReadonly && canBeTagged && (
                        <button
                            type="button"
                            className="btn btn-centered"
                            onClick={() => setShowTagManager(true)}
                        >
                            Create Tags
                        </button>
                    )}
                </div>
            );
        }

        return (
            <div className="field-with-tags-option">
                <input
                    className="field-input"
                    type="text"
                    value={value ?? ""}
                    onChange={isDisabled ? undefined : (e) => onChange(e.target.value)}
                    placeholder={name}
                    required={isRequired}
                    readOnly={isReadonly}
                />
                {!isReadonly && canBeTagged && (
                    <button
                        type="button"
                        className="btn btn-centered"
                        onClick={() => setShowTagManager(true)}
                    >
                        Create Tags
                    </button>
                )}
            </div>
        );
    }

    // BLOB/BINARY TYPES (file uploads)
    if (["blob", "binary", "varbinary", "tinyblob", "mediumblob", "longblob"].includes(type) ||
        ct.includes("blob") || ct.includes("binary")) {

        return (
            <div>
                <div>
                    <input
                        id="fileInput"
                        className="custom-file-upload"
                        type="file"
                        onChange={isDisabled ? undefined : (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                                onChange(file);
                            } else {
                                onChange(null);
                            }
                        }}
                        disabled={isDisabled}
                        readOnly={isReadonly}
                        style={{ display: 'none' }} // Hide the actual file input
                    />
                    <button
                        type="button"
                        className="btn" // Apply your custom button style
                        onClick={() => document.getElementById('fileInput').click()} // Trigger the file input click
                    >
                        Browse
                    </button>

                    {fileName && (
                        <div className="muted" style={{ fontSize: "0.85em", marginTop: "4px" }}>
                            {fileName}
                        </div>
                    )}
                    {value && !isReadonly && (
                        <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ marginTop: "4px" }}
                            onClick={() => {
                                onChange(null);
                            }}
                        >
                            Clear file
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // INTEGER TYPES (with potential rating support)
    if (["int", "bigint", "smallint", "mediumint", "tinyint"].includes(type)) {
        if (checkingRating) {
            return <div className="field-input">Loading...</div>;
        }

        if (hasRating || showRatingManager) {
            return (
                <RatingManager
                    table={table}
                    column={name}
                    value={parseInt(value) || 0}
                    onChange={(rating) => onChange(rating)}
                    required={isRequired}
                    readOnly={isReadonly}
                    onRatingSaved={handleRatingSaved}
                    onCancel={handleCancelRatingCreation}
                    isCreatingRating={showRatingManager}
                />
            );
        }

        const canBeRated = excludedRatingsTables[table] ? excludedRatingsTables[table].includes(name) === false : true;
        return (
            <div className="field-with-tags-option">
                <input
                    className="field-input"
                    type="number"
                    step="1"
                    value={value ?? ""}
                    onChange={
                        isDisabled
                            ? undefined
                            : (e) => {
                                const val = e.target.value;
                                if (name === "quantity") {
                                    onChange(val === "" ? "" : val);
                                } else {
                                    onChange(val);
                                }
                            }
                    }
                    placeholder={name}
                    required={isRequired}
                    readOnly={isReadonly}
                />
                {!isReadonly && canBeRated && (
                    <button
                        type="button"
                        className="btn btn-centered"
                        onClick={() => setShowRatingManager(true)}
                    >
                        Create Rating Display
                    </button>
                )}
            </div>
        );
    }

    // BIT/BOOLEAN TYPES
    if (["bit"].includes(type)) {
        return (
            <label className="perm-item">
                <input
                    type="checkbox"
                    checked={Boolean(value) && String(value) !== "0"}
                    onChange={isDisabled ? undefined : (e) => onChange(e.target.checked ? 1 : 0)}
                    disabled={isDisabled}
                    readOnly={isReadonly}
                />
            </label>
        );
    }

    // DECIMAL/FLOAT TYPES
    if (["decimal", "float", "double"].includes(type)) {
        return (
            <input
                className="field-input"
                type="number"
                step=".01"
                value={value ?? ""}
                onChange={
                    isDisabled
                        ? undefined
                        : (e) => {
                            const val = e.target.value;
                            if (val === "" || /^-?\d*\.?\d*$/.test(val)) {
                                onChange(val === "" ? "" : Number(val));
                            }
                        }
                }
                placeholder={name}
                required={isRequired}
                readOnly={isReadonly}
            />
        );
    }

    // DATE TYPE
    if (["date"].includes(type)) {
        return (
            <input
                className="field-input"
                type="date"
                value={value ? value.split("T")[0] : ""}
                onChange={isDisabled ? undefined : (e) => onChange(e.target.value)}
                placeholder={name}
                required={isRequired}
                readOnly={isReadonly}
            />
        );
    }

    // TIME TYPE
    if (["time"].includes(type)) {
        return (
            <input
                className="field-input"
                type="time"
                value={value ? value.split("T")[0] : ""}
                onChange={isDisabled ? undefined : (e) => onChange(e.target.value)}
                placeholder={name}
                required={isRequired}
                readOnly={isReadonly}
            />
        );
    }

    // DATETIME/TIMESTAMP TYPES
    if (["datetime", "timestamp"].includes(type)) {
        let v = "";
        if (value) {
            const dt = parseLocalDateTime(value);
            if (dt) {
                const yyyy = dt.getFullYear();
                const mm = String(dt.getMonth() + 1).padStart(2, "0");
                const dd = String(dt.getDate()).padStart(2, "0");
                const hh = String(dt.getHours()).padStart(2, "0");
                const mi = String(dt.getMinutes()).padStart(2, "0");
                const ss = String(dt.getSeconds()).padStart(2, "0");
                v = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
            }
        }
        return (
            <input
                className="field-input"
                type="datetime-local"
                step="1"
                value={v}
                onChange={isDisabled ? undefined : (e) => onChange(e.target.value)}
                placeholder={name}
                required={isRequired}
                readOnly={isReadonly}
            />
        );
    }

    // DEFAULT: TEXT INPUT
    return (
        <input
            className="field-input"
            type="text"
            value={value ?? ""}
            onChange={isDisabled ? undefined : (e) => onChange(e.target.value)}
            placeholder={name}
            required={isRequired}
            readOnly={isReadonly}
        />
    );
}

// Parse a local date-time string safely into a Date object.
// Accepts:
//  - Date instance -> returned as-is
//  - "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS"
//  - "YYYY-MM-DD HH:MM:SS" (space instead of T)
//  - fallback to new Date(...) if it doesn't match known formats (still guarded)
export function parseLocalDateTime(input) {
    if (!input && input !== 0) return null;
    if (input instanceof Date) return isNaN(input) ? null : input;

    if (typeof input !== "string") {
        // fallback
        const d = new Date(input);
        return isNaN(d) ? null : d;
    }

    // Normalize separator
    const s = input.replace(/\s+/, "T");

    // Match YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS (optionally with fraction or Z)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
        const [, Y, M, D, hh, mm, ss] = m;
        const year = parseInt(Y, 10);
        const month = parseInt(M, 10) - 1;
        const day = parseInt(D, 10);
        const hour = parseInt(hh, 10);
        const minute = parseInt(mm, 10);
        const second = ss ? parseInt(ss, 10) : 0;
        const dt = new Date(year, month, day, hour, minute, second);
        return isNaN(dt) ? null : dt;
    }

    // As a last resort, try Date.parse
    const fallback = new Date(input);
    return isNaN(fallback) ? null : fallback;
}