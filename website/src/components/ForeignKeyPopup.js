// src/components/ForeignKeyPopup.js
import React, { useState, useEffect, useMemo } from "react";
import { FieldInput } from "./FieldInput";
import { formatDateTimeLocal, formatDateTimeUTC } from "../lib/insert/insertNormalization";
import { autoPopulateColumns, excludedTablesUpdate, lockedColumns } from "../lib/insert/insertConstants";
import { customUpdateHandlers, customUpdateFormFields, customFetchHandlers } from "../lib/insert/customTableLogic";
import "../styles/ForeignKeyPopup.css";
import { apiRequest } from '../lib/api';

function normalizeBitValueForForm(v) {
    if (v === "" || v === null || typeof v === "undefined") return v;
    if (Buffer.isBuffer(v)) return v[0] ? 1 : 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v ? 1 : 0;
    return v;
}

export default function ForeignKeyPopup({
    table,
    pkColumn,
    pkValue,
    onClose,
    onSuccess
}) {
    const [columnsMeta, setColumnsMeta] = useState([]);
    const [formData, setFormData] = useState({});
    const [initialFormData, setInitialFormData] = useState({}); // Store initial loaded data
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [showVerifyModal, setShowVerifyModal] = useState(false);
    const [pendingData, setPendingData] = useState(null);
    const [uniqueValues, setUniqueValues] = useState([]);

    // Check if this table is excluded from updates
    const isExcluded = useMemo(() => {
        const normalized = String(table).toLowerCase();
        return Array.isArray(excludedTablesUpdate) &&
            excludedTablesUpdate.map(s => String(s).toLowerCase()).includes(normalized);
    }, [table]);

    // Determine which fields to render based on custom logic or all columns
    const fieldsToRender = useMemo(() => {
        const tableKey = table.toLowerCase();
        return (customUpdateFormFields && customUpdateFormFields[tableKey])
            ? customUpdateFormFields[tableKey]
            : columnsMeta;
    }, [table, columnsMeta]);

    // Identify unique columns for quantity handling
    const uniqueColumns = useMemo(() => {
        return columnsMeta.filter(
            (c) =>
                Boolean(c.isUnique) &&
                !c.isPrimary &&
                !c.isAutoIncrement &&
                c.name.toLowerCase() !== "id"
        );
    }, [columnsMeta]);

    // Initial quantity from originally loaded data (not current formData)
    const initialQuantity = useMemo(() => {
        return Number(initialFormData["Quantity"]) || 1;
    }, [initialFormData]);

    // Check if this table has custom update handlers
    const hasCustomUpdate = useMemo(() => {
        const tableKey = table.toLowerCase();
        return customUpdateHandlers && typeof customUpdateHandlers[tableKey] === 'function';
    }, [table]);

    // Load column metadata and record data
    useEffect(() => {
        async function loadData() {
            if (isExcluded) {
                setError(`Updates are not allowed for table "${table}"`);
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setError("");

                // Load columns
                const colsRes = await fetch(`/api/columns?table=${encodeURIComponent(table)}`);
                const colsJson = await colsRes.json();
                if (!colsRes.ok) throw new Error(colsJson.error || "Failed to load columns");

                setColumnsMeta(Array.isArray(colsJson) ? colsJson : []);

                // Load record
                const recordRes = await fetch(
                    `/api/record?table=${encodeURIComponent(table)}&key=${encodeURIComponent(pkColumn)}&value=${encodeURIComponent(pkValue)}`
                );

                if (recordRes.status === 404) {
                    throw new Error("Record not found");
                }

                let recordJson = await recordRes.json();
                if (!recordRes.ok) throw new Error(recordJson.error || "Failed to load record");

                // Run custom fetch handler if it exists (like in InsertPage)
                const tableKey = table.toLowerCase();
                const customFetch = customFetchHandlers && customFetchHandlers[tableKey];
                if (typeof customFetch === 'function') {
                    try {
                        // Custom fetch can augment the record and populate uniqueValues via setUniqueValues
                        const augmented = await customFetch(recordJson, setUniqueValues, { fetch: window.fetch });

                        // Check if handler explicitly returned an error (ok: false means error)
                        if (augmented && typeof augmented === 'object' && augmented.ok === false) {
                            throw new Error(augmented.message || "Custom fetch handler failed");
                        }

                        // If handler returned a modified record (or the original), use it
                        // Success case: handler returns the record directly (no ok property)
                        if (augmented && typeof augmented === 'object' && augmented.ok !== false) {
                            recordJson = augmented;
                        }
                    } catch (err) {
                        console.error("Custom fetch handler error:", err);
                        throw new Error(err.message || "Failed to process custom fetch");
                    }
                }

                // Store both initial and current form data
                setInitialFormData(recordJson);
                setFormData(recordJson);

            } catch (err) {
                setError(err.message || "Failed to load data");
            } finally {
                setLoading(false);
            }
        }

        if (table && pkColumn && pkValue) {
            loadData();
        }
    }, [table, pkColumn, pkValue, isExcluded]);

    // Handle quantity changes for unique value duplication
    useEffect(() => {
        const hasQuantityField = columnsMeta.some(c => c.name.toLowerCase() === "quantity");
        if (!hasQuantityField) return;

        const rawQty = formData["Quantity"];
        if (rawQty === "" || rawQty === undefined || rawQty === null) {
            return;
        }

        const qtyNum = parseInt(String(rawQty).trim(), 10);
        if (isNaN(qtyNum) || qtyNum <= 0) {
            setError("Quantity must be a positive integer.");
            setTimeout(() => setError(""), 4000);
            return;
        }

        // Validate that quantity is not less than initial quantity
        if (qtyNum < initialQuantity) {
            setError(`Quantity cannot be less than the original quantity of ${initialQuantity}.`);
            // Reset to initial quantity
            setFormData(prev => ({ ...prev, Quantity: initialQuantity }));
            setTimeout(() => setError(""), 4000);
            return;
        }

        setError("");

        // Build uniqueValues as needed
        const minLength = initialQuantity;
        const targetLength = qtyNum > minLength ? qtyNum : minLength;

        setUniqueValues(prev => {
            const copy = [...prev];
            while (copy.length > targetLength) {
                copy.pop();
            }
            while (copy.length < targetLength) {
                copy.push({});
            }
            return copy;
        });

    }, [formData["Quantity"], columnsMeta, initialQuantity]);

    function onFieldChange(col, val) {
        // Special validation for Quantity field
        if (col.toLowerCase() === "quantity") {
            const newQty = parseInt(val, 10);
            
            // Allow empty input temporarily (user might be typing)
            if (val === "" || val === null || val === undefined) {
                setFormData((prev) => ({ ...prev, [col]: val }));
                return;
            }
            
            // Check if new quantity is valid
            if (!isNaN(newQty) && newQty < initialQuantity) {
                setError(`Quantity cannot be less than the original quantity of ${initialQuantity}.`);
                setTimeout(() => setError(""), 4000);
                // Don't update the form data
                return;
            }
        }
        
        setFormData((prev) => ({ ...prev, [col]: val }));
    }

    function onUniqueValueChange(index, colName, value) {
        setUniqueValues((arr) => {
            const copy = [...arr];
            if (!copy[index]) copy[index] = {};
            copy[index][colName] = value;
            return copy;
        });
    }

    function formatValueForDisplay(key, val) {
        if (val === null || val === "") return "";
        const meta = columnsMeta.find(c => c.name === key);
        const type = meta?.type?.toLowerCase() || "";

        if (type === "date") {
            try {
                const d = new Date(val);
                if (!isNaN(d)) return d.toISOString().split("T")[0];
            } catch { }
            return val;
        }

        if (["datetime", "timestamp"].includes(type)) {
            try {
                const d = new Date(val);
                if (!isNaN(d)) return formatDateTimeLocal(d);
            } catch { }
            return String(val);
        }

        if (val instanceof File) return val.name;
        if (typeof val === "object") return JSON.stringify(val);
        return val?.toString() ?? "";
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError("");

        // Final validation before submission
        const currentQty = Number(formData["Quantity"]);
        if (!isNaN(currentQty) && currentQty < initialQuantity) {
            setError(`Quantity cannot be less than the original quantity of ${initialQuantity}.`);
            return;
        }

        // Prepare data for verification
        const normalizedData = { ...formData };

        // Auto-update fields (like last_modified)
        const tableAutoCols = autoPopulateColumns[table] || autoPopulateColumns.default || [];
        for (const colName of tableAutoCols) {
            const colMeta = columnsMeta.find(c => c.name.toLowerCase() === colName[0].toLowerCase());
            if (!colMeta) continue;

            if (colMeta.name.toLowerCase() === "last_modified" && ["datetime", "timestamp"].includes(colMeta.type)) {
                normalizedData[colMeta.name] = formatDateTimeUTC();
            } else if (["bit"].includes(colMeta.type)) {
                if (colName[1] != null) {
                    normalizedData[colMeta.name] = (normalizedData[colName[1]] !== "") ? 1 : 0;
                }
            }
        }

        setPendingData(normalizedData);
        setShowVerifyModal(true);
    }

    async function handleConfirmSubmit() {
        if (!pendingData) return;

        setSubmitting(true);
        setError("");

        try {
            const normalizedData = { ...pendingData };

            // Coerce bit columns to 0/1
            for (const c of columnsMeta) {
                if ((c.type || "").toLowerCase() === "bit") {
                    normalizedData[c.name] = normalizeBitValueForForm(normalizedData[c.name]);
                }
            }

            // Check if there's a custom update handler
            const tableKey = table.toLowerCase();
            const customHandler = customUpdateHandlers && customUpdateHandlers[tableKey];

            if (typeof customHandler === 'function') {
                try {
                    console.log("Using custom update handler for table:", table);
                    const result = await customHandler(normalizedData, uniqueValues, window.fetch);

                    if (!result || result.ok === false) {
                        throw new Error(result?.message || "Custom update failed");
                    }

                    // Success
                    else if (typeof onSuccess === "function") {
                        onSuccess(result.message || "Updated successfully");
                        onClose();
                    }
                    return;
                } catch (err) {
                    throw new Error(err.message || "Custom update failed");
                }
            }

            // Standard update
            const payload = {
                table,
                pkColumn,
                pkValue,
                data: normalizedData,
            };

            const res = await fetch("/api/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            let json;
            try {
                json = await res.json();
            } catch (err) {
                throw new Error("Invalid JSON response from update endpoint");
            }

            if (!res.ok) {
                throw new Error(json.error || json.message || "Update failed");
            }

            // Success
            if (typeof onSuccess === "function") {
                onSuccess("Record updated successfully");
            }
            onClose();
        } catch (err) {
            setError(err.message || "Failed to update record");
        } finally {
            setSubmitting(false);
            setShowVerifyModal(false);
            setPendingData(null);
        }
    }

    // Filter fields exactly like InsertPage does for update mode
    const editableFields = fieldsToRender.filter((meta) => {
        // Hide auto-increment fields
        if (meta.isAutoIncrement) return false;

        // Hide auto-populated fields
        const autoTableCols = autoPopulateColumns[table] || [];
        const allAutoCols = [...autoTableCols, ...autoPopulateColumns.default];

        for (const colName of allAutoCols) {
            if (colName[0].toLowerCase() === meta.name.toLowerCase()) return false;
        }

        return true;
    });

    // Don't render popup at all if excluded
    if (isExcluded) {
        return (
            <div className="fk-popup-overlay" onClick={onClose}>
                <div className="fk-popup-content" onClick={(e) => e.stopPropagation()}>
                    <div className="fk-popup-header">
                        <h3>Cannot Edit {table}</h3>
                        <button className="fk-popup-close" onClick={onClose}>✕</button>
                    </div>
                    <div className="fk-popup-loading">
                        Updates are not allowed for this table.
                    </div>
                    <div className="fk-popup-actions">
                        <button className="btn btn-ghost" onClick={onClose}>Close</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="fk-popup-overlay" onClick={onClose}>
                <div className="fk-popup-content" onClick={(e) => e.stopPropagation()}>
                    <div className="fk-popup-header">
                        <h3>Edit {table}</h3>
                        <button className="fk-popup-close" onClick={onClose}>✕</button>
                    </div>

                    {loading && <div className="fk-popup-loading">Loading...</div>}

                    {!loading && (
                        <>
                            {error && <div className="error-note" style={{ margin: "20px" }}>{error}</div>}

                            <form className="fk-popup-form" onSubmit={handleSubmit}>
                                <div className="fk-popup-fields">
                                    {editableFields.map((meta) => {
                                        const col = meta.name;
                                        const value = formData[col];
                                        const isPk = col === pkColumn;

                                        // Check if this column is locked
                                        const tableLockedCols = lockedColumns && lockedColumns[table] ? lockedColumns[table] : [];
                                        const isLocked = tableLockedCols.some(lc => lc.toLowerCase() === col.toLowerCase());

                                        const showRequiredAsterisk =
                                            (meta.isPrimary && !meta.isAutoIncrement) ||
                                            (!meta.isNullable && !meta.isPrimary);

                                        // Handle unique fields with quantity duplication (like in InsertPage)
                                        if (meta.isUnique && !meta.isAutoIncrement) {
                                            const qty = Number(formData["Quantity"]) > initialQuantity
                                                ? Number(formData["Quantity"])
                                                : initialQuantity;

                                            if (qty > 1 || (hasCustomUpdate && qty > 0)) {
                                                return (
                                                    <div key={col} className="fk-field-group-duplicated">
                                                        {Array.from({ length: qty }, (_, i) => (
                                                            <div key={`${col}_${i}`} className="fk-field-row">
                                                                <label className="fk-field-label">
                                                                    {`${col}_${i + 1}`}
                                                                    {meta.isPrimary && <span className="pk-tag">PK</span>}
                                                                    {showRequiredAsterisk && <span className="required-tag">*</span>}
                                                                </label>
                                                                <div className="fk-field-input-wrap">
                                                                    <input
                                                                        className="fk-field-input"
                                                                        type="text"
                                                                        value={uniqueValues[i]?.[col] || ""}
                                                                        onChange={
                                                                            (i < initialQuantity && hasCustomUpdate)
                                                                                ? undefined
                                                                                : (e) => onUniqueValueChange(i, col, e.target.value)
                                                                        }
                                                                        placeholder={`Enter ${col} for item #${i + 1}`}
                                                                        readOnly={i < initialQuantity && hasCustomUpdate}
                                                                        required
                                                                    />
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            }
                                        }

                                        // Special rendering for Quantity field to show min constraint
                                        if (col.toLowerCase() === "quantity") {
                                            return (
                                                <div className="fk-field-row" key={col}>
                                                    <label className="fk-field-label">
                                                        {col}
                                                        {showRequiredAsterisk && <span className="required-tag">*</span>}
                                                        <span className="field-hint" style={{ 
                                                            fontSize: "0.8rem", 
                                                            color: "var(--text-secondary, #aaa)",
                                                            fontWeight: "normal",
                                                            marginLeft: "8px"
                                                        }}>
                                                            (min: {initialQuantity})
                                                        </span>
                                                    </label>
                                                    <div className="fk-field-input-wrap">
                                                        <FieldInput
                                                            meta={meta}
                                                            value={value}
                                                            onChange={(v) => onFieldChange(col, v)}
                                                            mode="edit"
                                                            table={table}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        }

                                        // Normal field rendering
                                        return (
                                            <div className="fk-field-row" key={col}>
                                                <label className="fk-field-label">
                                                    {col}
                                                    {meta.isPrimary && <span className="pk-tag">PK</span>}
                                                    {showRequiredAsterisk && <span className="required-tag">*</span>}
                                                    {isLocked && <span className="pk-tag">LOCKED</span>}
                                                </label>
                                                <div className="fk-field-input-wrap">
                                                    {(isPk || isLocked) ? (
                                                        <input
                                                            className="fk-field-input"
                                                            type="text"
                                                            value={value || ""}
                                                            disabled
                                                            title={isPk ? "Primary key (not editable)" : "This field is locked"}
                                                        />
                                                    ) : (
                                                        <FieldInput
                                                            meta={meta}
                                                            value={value}
                                                            onChange={(v) => onFieldChange(col, v)}
                                                            mode="edit"
                                                            table={table}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="fk-popup-actions">
                                    <button
                                        className="btn"
                                        type="submit"
                                        disabled={submitting}
                                    >
                                        {submitting ? "Saving..." : "Save Changes"}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-ghost"
                                        onClick={onClose}
                                        disabled={submitting}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </>
                    )}
                </div>
            </div>

            {showVerifyModal && (
                <div className="modal-overlay" style={{ zIndex: 10001 }}>
                    <div className="modal-content">
                        <h3>Verify Changes</h3>
                        <div className="modal-body">
                            <table className="verify-table">
                                <thead>
                                    <tr>
                                        <th>Field</th>
                                        <th>Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(pendingData || {}).map(([key, val]) => (
                                        <tr key={key}>
                                            <td className="verify-field">{key}</td>
                                            <td className="verify-value">
                                                {formatValueForDisplay(key, val)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="modal-actions">
                            <button
                                className="btn"
                                onClick={handleConfirmSubmit}
                                disabled={submitting}
                            >
                                {submitting ? "Submitting..." : "Confirm"}
                            </button>
                            <button
                                className="btn btn-ghost"
                                onClick={() => {
                                    setShowVerifyModal(false);
                                    setPendingData(null);
                                }}
                                disabled={submitting}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}