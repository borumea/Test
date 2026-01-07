import React, { useState, useEffect, useRef } from "react";
import { formatDateTimeLocal } from "../lib/insert/insertNormalization";
import "../styles/TagManager.css";
import { getStoredUser } from "../lib/auth";
import { apiRequest } from '../lib/api';
import { clearColumnMetadataCache } from './FieldInput';  

// User-friendly color palette for auto-generated colors
const DEFAULT_COLORS = [
    "#3B82F6", // Blue
    "#10B981", // Green
    "#F59E0B", // Amber
    "#EF4444", // Red
    "#8B5CF6", // Purple
    "#EC4899", // Pink
    "#14B8A6", // Teal
    "#F97316", // Orange
    "#6366F1", // Indigo
    "#84CC16", // Lime
];

/**
 * TagManager Component
 * Renders a tag input with dropdown for existing tags and ability to manage tags.
 * 
 * @param {string} table - The table name
 * @param {string} column - The column name
 * @param {string[]} value - Array of selected tag values
 * @param {function} onChange - Callback when tags change (receives array of tag values)
 * @param {boolean} required - Whether the field is required
 * @param {boolean} readOnly - Whether the field is read-only
 * @param {function} onTagsSaved - Callback when tags are saved (receives boolean indicating if tags exist)
 * @param {function} onCancel - Callback when tag creation is cancelled
 * @param {boolean} isCreatingTags - Whether we're in tag creation mode
 */
export default function TagManager({
    table,
    column,
    value = [],
    onChange,
    required = false,
    readOnly = false,
    onTagsSaved,
    onCancel,
    isCreatingTags = false
}) {
    const [availableTags, setAvailableTags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showDropdown, setShowDropdown] = useState(false);
    const [showManageModal, setShowManageModal] = useState(isCreatingTags);
    const [inputValue, setInputValue] = useState("");
    const [error, setError] = useState("");

    const dropdownRef = useRef(null);
    const inputRef = useRef(null);

    // Ensure value is always an array
    const selectedTags = Array.isArray(value) ? value : [];

    // Open modal immediately if we're in tag creation mode
    useEffect(() => {
        if (isCreatingTags) {
            setShowManageModal(true);
        }
    }, [isCreatingTags]);

    // Load tags for this table/column combination
    useEffect(() => {
        loadTags();
    }, [table, column]);

    // Click outside handler to close dropdown
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowDropdown(false);
            }
        }

        if (showDropdown) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [showDropdown]);

    async function loadTags() {
        setLoading(true);
        setError("");
        try {
            const res = await apiRequest("query", {
                method: "POST",
                body: {
                    table: "Tags",
                    columns: ["id", "table_name", "column_name", "tag_value", "color", "created_by", "created_at"],
                    filters: [
                        { column: "table_name", operator: "=", value: table },
                        { column: "column_name", operator: "=", value: column }
                    ],
                    orderBy: [{ column: "created_at", direction: "DESC" }]
                }
            });

            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                throw new Error(json.error || "Failed to load tags");
            }

            const json = await res.json();
            const rows = json.rows || json.data || json;
            setAvailableTags(Array.isArray(rows) ? rows : []);
        } catch (err) {
            console.error("Error loading tags:", err);
            setError(err.message);
            setAvailableTags([]);
        } finally {
            setLoading(false);
        }
    }

    function handleAddTag(tagValue) {
        if (readOnly) return;

        // Check for duplicates
        if (selectedTags.includes(tagValue)) {
            return;
        }

        const newTags = [...selectedTags, tagValue];
        onChange(newTags);
        setInputValue("");
        setShowDropdown(false);
    }

    function handleRemoveTag(tagValue) {
        if (readOnly) return;
        const newTags = selectedTags.filter(t => t !== tagValue);
        onChange(newTags);
    }

    function handleInputFocus() {
        if (!readOnly) {
            setShowDropdown(true);
        }
    }

    function handleInputChange(e) {
        setInputValue(e.target.value);
        setShowDropdown(true);
    }

    // Filter available tags based on input and exclude already selected
    const filteredTags = availableTags.filter(tag => {
        const matchesInput = tag.tag_value.toLowerCase().includes(inputValue.toLowerCase());
        const notSelected = !selectedTags.includes(tag.tag_value);
        return matchesInput && notSelected;
    });

    // Get tag metadata for display
    function getTagMeta(tagValue) {
        return availableTags.find(t => t.tag_value === tagValue);
    }

    const handleModalClose = () => {
        setShowManageModal(false);
        if (isCreatingTags && onCancel) {
            onCancel();
        }
    };

    const handleModalSave = async () => {
        await loadTags();

        // Clear the FieldInput cache so new tags are detected
        clearColumnMetadataCache(table);

        // Check if tags exist after save
        const res = await apiRequest("query", {
            method: "POST",
            body: {
                table: "Tags",
                columns: ["id"],
                filters: [
                    { column: "table_name", operator: "=", value: table },
                    { column: "column_name", operator: "=", value: column }
                ]
            }
        });

        const json = await res.json();
        const tagsExist = Array.isArray(json.rows) && json.rows.length > 0;

        setShowManageModal(false);

        if (onTagsSaved) {
            onTagsSaved(tagsExist);
        }
    };

    return (
        <div className="tag-manager-wrapper">
            <div className="tag-manager-container">
                <div className="tag-input-wrapper" ref={dropdownRef}>
                    {/* Display selected tags */}
                    <div className="selected-tags">
                        {selectedTags.map(tagValue => {
                            const meta = getTagMeta(tagValue);
                            return (
                                <span
                                    key={tagValue}
                                    className="tag-chip"
                                    style={{
                                        backgroundColor: meta?.color || "#6B7280",
                                        color: "#FFFFFF"
                                    }}
                                >
                                    {tagValue}
                                    {!readOnly && (
                                        <button
                                            type="button"
                                            className="tag-remove-btn"
                                            onClick={() => handleRemoveTag(tagValue)}
                                            aria-label={`Remove ${tagValue}`}
                                        >
                                            ×
                                        </button>
                                    )}
                                </span>
                            );
                        })}

                        {/* Input for adding new tags */}
                        {!readOnly && (
                            <input
                                ref={inputRef}
                                type="text"
                                className="tag-input-field"
                                value={inputValue}
                                onChange={handleInputChange}
                                onFocus={handleInputFocus}
                                placeholder={selectedTags.length === 0 ? "Select or type tags..." : ""}
                                disabled={loading}
                                required={required && selectedTags.length === 0}
                            />
                        )}
                    </div>

                    {/* Dropdown with available tags */}
                    {showDropdown && !readOnly && filteredTags.length > 0 && (
                        <div className="tag-dropdown">
                            {filteredTags.map(tag => (
                                <div
                                    key={tag.id}
                                    className="tag-dropdown-item"
                                    onClick={() => handleAddTag(tag.tag_value)}
                                >
                                    <span
                                        className="tag-color-indicator"
                                        style={{ backgroundColor: tag.color }}
                                    />
                                    <span className="tag-dropdown-value">{tag.tag_value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {error && <div className="tag-error">{error}</div>}
            </div>

            {/* Manage tags button */}
            {!readOnly && (
                <button
                    type="button"
                    className="btn btn-centered"
                    onClick={() => setShowManageModal(true)}
                    title="Configure Tags"
                >
                    ⚙️
                </button>
            )}

            {/* Tag management modal */}
            {showManageModal && (
                <TagManagementModal
                    table={table}
                    column={column}
                    availableTags={availableTags}
                    onClose={handleModalClose}
                    onSave={handleModalSave}
                />
            )}
        </div>
    );
}

/**
 * Modal for managing (adding/deleting) tags
 */
function TagManagementModal({ table, column, availableTags, onClose, onSave }) {
    const [tags, setTags] = useState([...availableTags]);
    const [newTagValue, setNewTagValue] = useState("");
    const [newTagColor, setNewTagColor] = useState("");
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");

    function getNextAutoColor() {
        return DEFAULT_COLORS[tags.length % DEFAULT_COLORS.length];
    }

    function handleAddNewTag() {
        if (!newTagValue.trim()) {
            setError("Tag value cannot be empty");
            return;
        }

        // Check for duplicate tag values
        if (tags.some(t => t.tag_value === newTagValue.trim())) {
            setError("Tag with this value already exists");
            return;
        }

        const color = newTagColor || getNextAutoColor();

        // Create a temporary tag object (id will be assigned by server)
        const newTag = {
            id: `temp-${Date.now()}`,
            table_name: table,
            column_name: column,
            tag_value: newTagValue.trim(),
            color: color,
            isNew: true
        };

        setTags([...tags, newTag]);
        setNewTagValue("");
        setNewTagColor("");
        setError("");
    }

    function handleRemoveTag(tagId) {
        setTags(tags.map(t =>
            t.id === tagId ? { ...t, isDeleted: true } : t
        ));
    }

    function handleUndoRemove(tagId) {
        setTags(tags.map(t =>
            t.id === tagId ? { ...t, isDeleted: false } : t
        ));
    }

    async function handleSave() {
        setSaving(true);
        setError("");

        try {
            // Get current user
            const currentUser = getStoredUser()["username"] || "unknown";

            // Insert new tags
            const newTags = tags.filter(t => t.isNew && !t.isDeleted);
            for (const tag of newTags) {
                const createdAt = formatDateTimeLocal();

                const res = await apiRequest("insert", {
                    method: "POST",
                    body: {
                        table: "Tags",
                        data: {
                            table_name: tag.table_name,
                            column_name: tag.column_name,
                            tag_value: tag.tag_value,
                            color: tag.color,
                            created_by: currentUser,
                            created_at: createdAt
                        }
                    }
                });

                if (!res.ok) {
                    const json = await res.json();
                    throw new Error(json.error || "Failed to insert tag");
                }
            }

            // Delete removed tags (only those that existed in DB)
            const deletedTags = tags.filter(t => t.isDeleted && !t.isNew);
            if (deletedTags.length > 0) {
                setDeleting(true);
                const deleteIds = deletedTags.map(t => t.id);

                const res = await apiRequest("delete", {
                    method: "POST",
                    body: {
                        table: "Tags",
                        pkColumn: "id",
                        pkValues: deleteIds
                    }
                });

                if (!res.ok) {
                    const json = await res.json();
                    throw new Error(json.error || "Failed to delete tags");
                }
            }

            onSave();
        } catch (err) {
            console.error("Error saving tags:", err);
            setError(err.message || "Failed to save tags");
        } finally {
            setSaving(false);
            setDeleting(false);
        }
    }

    const visibleTags = tags.filter(t => !t.isDeleted);
    const hasChanges = tags.some(t => t.isNew || t.isDeleted);

    return (
        <div className="modal-overlay">
            <div className="modal-content tag-modal">
                <h3>Manage Tags: {table}.{column}</h3>

                <div className="modal-body">
                    {/* Add new tag section */}
                    <div className="add-tag-section">
                        <h4>Add New Tag</h4>
                        <div className="add-tag-form">
                            <input
                                type="text"
                                className="field-input"
                                placeholder="Tag value"
                                value={newTagValue}
                                onChange={(e) => setNewTagValue(e.target.value)}
                                onKeyPress={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleAddNewTag();
                                    }
                                }}
                            />
                            <input
                                type="color"
                                className="color-picker"
                                value={newTagColor || getNextAutoColor()}
                                onChange={(e) => setNewTagColor(e.target.value)}
                                title="Choose tag color"
                            />
                            <button
                                type="button"
                                className="btn btn-small"
                                onClick={handleAddNewTag}
                            >
                                Add
                            </button>
                        </div>
                    </div>

                    {/* Existing tags list */}
                    <div className="existing-tags-section">
                        <h4>Existing Tags</h4>
                        {visibleTags.length === 0 ? (
                            <p className="muted">No tags yet. Add one above.</p>
                        ) : (
                            <div className="tags-list">
                                {visibleTags.map(tag => (
                                    <div key={tag.id} className="tag-list-item">
                                        <span
                                            className="tag-chip"
                                            style={{
                                                backgroundColor: tag.color,
                                                color: "#FFFFFF"
                                            }}
                                        >
                                            {tag.tag_value}
                                            {tag.isNew && <span className="tag-badge">New</span>}
                                        </span>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-small btn-danger"
                                            onClick={() => handleRemoveTag(tag.id)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Deleted tags (with undo option) */}
                    {tags.some(t => t.isDeleted) && (
                        <div className="deleted-tags-section">
                            <h4>Deleted Tags (will be removed on save)</h4>
                            <div className="tags-list">
                                {tags.filter(t => t.isDeleted).map(tag => (
                                    <div key={tag.id} className="tag-list-item deleted">
                                        <span
                                            className="tag-chip"
                                            style={{
                                                backgroundColor: tag.color,
                                                color: "#FFFFFF",
                                                opacity: 0.5
                                            }}
                                        >
                                            {tag.tag_value}
                                        </span>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-small"
                                            onClick={() => handleUndoRemove(tag.id)}
                                        >
                                            Undo
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {error && <div className="error-note">{error}</div>}
                </div>

                <div className="modal-actions">
                    <button
                        className="btn"
                        onClick={handleSave}
                        disabled={saving || deleting || !hasChanges}
                    >
                        {saving || deleting ? "Saving..." : "Save Changes"}
                    </button>
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