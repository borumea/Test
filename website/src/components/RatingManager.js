import React, { useState, useEffect } from "react";
import { formatDateTimeLocal } from "../lib/insert/insertNormalization";
import "../styles/RatingManager.css";
import { getStoredUser } from "../lib/auth";
import { apiRequest } from '../lib/api';
import { clearColumnMetadataCache } from './FieldInput';

const SHAPES = {
    star: { label: "Stars", color: "#FFD700", symbol: "★", emptySymbol: "☆" },
    heart: { label: "Hearts", color: "#B01E28", symbol: "♥", emptySymbol: "♡" },
    // circle: { label: "Circles", color: "#3B82F6", symbol: "●", emptySymbol: "○" },
    // diamond: { label: "Diamonds", color: "#9333EA", symbol: "◆", emptySymbol: "◇" },
    // square: { label: "Squares", color: "#10B981", symbol: "■", emptySymbol: "□" }
};

/**
 * RatingManager Component
 * Renders an integer value as visual shapes (stars, hearts, circles, etc.)
 * 
 * @param {string} table - The table name
 * @param {string} column - The column name
 * @param {number} value - The numeric rating value
 * @param {function} onChange - Callback when rating changes
 * @param {boolean} required - Whether the field is required
 * @param {boolean} readOnly - Whether the field is read-only
 * @param {function} onRatingSaved - Callback when rating config is saved
 * @param {function} onCancel - Callback when rating creation is cancelled
 * @param {boolean} isCreatingRating - Whether we're in rating creation mode
 */
export default function RatingManager({
    table,
    column,
    value = 0,
    onChange,
    required = false,
    readOnly = false,
    onRatingSaved,
    onCancel,
    isCreatingRating = false
}) {
    const [ratingConfig, setRatingConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showManageModal, setShowManageModal] = useState(isCreatingRating);
    const [error, setError] = useState("");

    // Ensure value is a valid number
    const numericValue = parseInt(value) || 0;

    // Open modal immediately if we're in rating creation mode
    useEffect(() => {
        if (isCreatingRating) {
            setShowManageModal(true);
        }
    }, [isCreatingRating]);

    // Load rating configuration for this table/column combination
    useEffect(() => {
        loadRatingConfig();
    }, [table, column]);

    async function loadRatingConfig() {
        setLoading(true);
        setError("");
        try {
            const res = await apiRequest("query", {
                method: "POST",
                body: {
                    table: "Ratings",
                    columns: ["id", "table_name", "column_name", "shape", "max_value", "created_by", "created_at"],
                    filters: [
                        { column: "table_name", operator: "=", value: table },
                        { column: "column_name", operator: "=", value: column }
                    ]
                }
            });

            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                throw new Error(json.error || "Failed to load rating config");
            }

            const json = await res.json();
            const rows = json.rows || json.data || json;
            if (Array.isArray(rows) && rows.length > 0) {
                setRatingConfig(rows[0]);
            } else {
                setRatingConfig(null);
            }
        } catch (err) {
            console.error("Error loading rating config:", err);
            setError(err.message);
            setRatingConfig(null);
        } finally {
            setLoading(false);
        }
    }

    function handleRatingClick(newValue) {
        if (readOnly) return;
        onChange(newValue);
    }

    const handleModalClose = () => {
        setShowManageModal(false);
        if (isCreatingRating && onCancel) {
            onCancel();
        }
    };

    const handleModalSave = async () => {
        await loadRatingConfig();

        // Clear the FieldInput cache so new ratings are detected
        clearColumnMetadataCache(table);

        // Check if rating config exists after save
        const res = await apiRequest("query", {
            method: "POST",

            body: {
                table: "Ratings",
                columns: ["id"],
                filters: [
                    { column: "table_name", operator: "=", value: table },
                    { column: "column_name", operator: "=", value: column }
                ]
            }
        });

        const json = await res.json();
        const ratingExists = Array.isArray(json.rows) && json.rows.length > 0;

        setShowManageModal(false);

        if (onRatingSaved) {
            onRatingSaved(ratingExists);
        }
    };

    if (loading) {
        return <div className="rating-manager-loading">Loading...</div>;
    }

    if (!ratingConfig) {
        return (
            <div className="rating-manager-wrapper">
                <input
                    className="field-input"
                    type="number"
                    step="1"
                    value={numericValue}
                    onChange={readOnly ? undefined : (e) => onChange(parseInt(e.target.value) || 0)}
                    required={required}
                    readOnly={readOnly}
                />
                {!readOnly && (
                    <button
                        type="button"
                        className="btn btn-centered"
                        onClick={() => setShowManageModal(true)}
                    >
                        Create Rating Display
                    </button>
                )}
                {showManageModal && (
                    <RatingConfigModal
                        table={table}
                        column={column}
                        existingConfig={null}
                        onClose={handleModalClose}
                        onSave={handleModalSave}
                    />
                )}
            </div>
        );
    }

    const shapeInfo = SHAPES[ratingConfig.shape] || SHAPES.star;
    const maxValue = ratingConfig.max_value || 10;

    return (
        <div className="rating-manager-wrapper">
            <div className="rating-display">
                {Array.from({ length: maxValue }, (_, i) => {
                    const ratingValue = i + 1;
                    const isFilled = ratingValue <= numericValue;
                    return (
                        <span
                            key={i}
                            className={`rating-shape ${readOnly ? 'readonly' : 'interactive'} ${isFilled ? 'filled' : 'empty'}`}
                            style={{ color: isFilled ? shapeInfo.color : '#D1D5DB' }}
                            onClick={() => handleRatingClick(ratingValue)}
                            title={`${ratingValue} / ${maxValue}`}
                        >
                            {isFilled ? shapeInfo.symbol : shapeInfo.emptySymbol}
                        </span>
                    );
                })}
                <span className="rating-value-display">
                    {numericValue} / {maxValue}
                </span>

                {!readOnly && (
                    <button
                        type="button"
                        className="btn btn-centered"
                        style={{marginLeft: 'auto'}}
                        onClick={() => setShowManageModal(true)}
                        title="Configure Rating"
                    >
                        ⛭
                    </button>
                )}
            </div>

            {error && <div className="rating-error">{error}</div>}

            {showManageModal && (
                <RatingConfigModal
                    table={table}
                    column={column}
                    existingConfig={ratingConfig}
                    onClose={handleModalClose}
                    onSave={handleModalSave}
                />
            )}
        </div>
    );
}

/**
 * Modal for configuring rating display
 */
function RatingConfigModal({ table, column, existingConfig, onClose, onSave }) {
    const [shape, setShape] = useState(existingConfig?.shape || "star");
    const [maxValue, setMaxValue] = useState(existingConfig?.max_value || 10);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");

    async function handleSave() {
        if (maxValue < 1) {
            setError("Max value must be at least 1");
            return;
        }

        setSaving(true);
        setError("");

        try {
            const currentUser = getStoredUser()["username"] || "unknown";
            const createdAt = formatDateTimeLocal();

            if (existingConfig) {
                // Update existing config
                const res = await apiRequest("update", {
                    method: "POST",
                    
                    body: {
                        table: "Ratings",
                        pkColumn: "id",
                        pkValue: existingConfig.id,
                        data: {
                            shape,
                            max_value: maxValue
                        }
                    }
                });

                if (!res.ok) {
                    const json = await res.json();
                    throw new Error(json.error || "Failed to update rating config");
                }
            } else {
                // Insert new config
                const res = await apiRequest("insert", {
                    method: "POST",
                    
                    body: {
                        table: "Ratings",
                        data: {
                            table_name: table,
                            column_name: column,
                            shape,
                            max_value: maxValue,
                            created_by: currentUser,
                            created_at: createdAt
                        }
                    }
                });

                if (!res.ok) {
                    const json = await res.json();
                    throw new Error(json.error || "Failed to create rating config");
                }
            }

            onSave();
        } catch (err) {
            console.error("Error saving rating config:", err);
            setError(err.message || "Failed to save rating config");
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!existingConfig) return;

        const confirmed = window.confirm("Are you sure you want to delete this rating configuration?");
        if (!confirmed) return;

        setDeleting(true);
        setError("");

        try {
            const res = await apiRequest("delete", {
                method: "POST",
                
                body: {
                    table: "Ratings",
                    pkColumn: "id",
                    pkValues: [existingConfig.id]
                }
            });

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || "Failed to delete rating config");
            }

            onSave();
        } catch (err) {
            console.error("Error deleting rating config:", err);
            setError(err.message || "Failed to delete rating config");
        } finally {
            setDeleting(false);
        }
    }

    const currentShape = SHAPES[shape] || SHAPES.star;

    return (
        <div className="modal-overlay">
            <div className="modal-content rating-modal">
                <h3>{existingConfig ? "Edit" : "Create"} Rating Display: {table}.{column}</h3>

                <div className="modal-body">
                    <div className="rating-config-section">
                        <label className="control-label">Shape</label>
                        <div className="shape-selector">
                            {Object.entries(SHAPES).map(([key, info]) => (
                                <button
                                    key={key}
                                    type="button"
                                    className={`shape-option ${shape === key ? 'selected' : ''}`}
                                    onClick={() => setShape(key)}
                                >
                                    <span className="shape-preview" style={{ color: info.color }}>
                                        {info.symbol}
                                    </span>
                                    <span className="shape-label">{info.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rating-config-section">
                        <label className="control-label">Maximum Value</label>
                        <input
                            type="number"
                            className="field-input"
                            min="1"
                            max="20"
                            step="1"
                            value={maxValue}
                            onChange={(e) => setMaxValue(parseInt(e.target.value) || 1)}
                        />
                        <div className="muted">Range: 1 to {maxValue}</div>
                    </div>

                    <div className="rating-preview-section">
                        <label className="control-label">Preview</label>
                        <div className="rating-preview">
                            {Array.from({ length: maxValue }, (_, i) => (
                                <span
                                    key={i}
                                    className="rating-shape preview"
                                    style={{ color: currentShape.color }}
                                >
                                    {currentShape.symbol}
                                </span>
                            ))}
                        </div>
                    </div>

                    {error && <div className="error-note">{error}</div>}
                </div>

                <div className="modal-actions">
                    <button
                        className="btn"
                        onClick={handleSave}
                        disabled={saving || deleting}
                    >
                        {saving ? "Saving..." : "Save"}
                    </button>
                    {existingConfig && (
                        <button
                            className="btn btn-danger"
                            onClick={handleDelete}
                            disabled={saving || deleting}
                        >
                            {deleting ? "Deleting..." : "Delete"}
                        </button>
                    )}
                    <button
                        className="btn btn-ghost"
                        onClick={onClose}
                        disabled={saving || deleting}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}