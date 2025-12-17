// pages/InsertPage.jsx
import React, { useEffect, useState, useMemo } from "react";
import { useLocation } from "react-router-dom";
import Dropdown from "../components/Dropdown";
import "../styles/InsertPage.css";
import "../styles/HomePage.css";

import { 
    normalizeBitValueForForm, 
    normalizeRecordForForm, 
    parseColumnsResponse, 
    guessPrimaryKeyColumn, 
    formatDateTimeLocal 
} from "../lib/insert/insertNormalization";
import { 
    excludedTables, 
    excludedTablesInsert, 
    excludedTablesUpdate, 
    viewsAPI, 
    excludedViews, 
    autoPopulateColumns 
} from "../lib/insert/insertConstants";
import { getValidationRules, hasValidationRules } from "../lib/insert/validationRules";
import { getStoredUser } from "../lib/auth";
import { apiRequest } from '../lib/api';
import { FieldInput, parseLocalDateTime } from "../components/FieldInput";
import ViewsOverlay from "../components/ViewsOverlay";
import { hasAccessToEntity, normalizePermissionsArray, permissionsObjectToArray } from "../lib/permissions";

export default function InsertPage() {
    const [loaded, setLoaded] = useState(0);
    const [tables, setTables] = useState([]);
    const [table, setTable] = useState("");
    const [columnsMeta, setColumnsMeta] = useState([]);
    const [loadingColumns, setLoadingColumns] = useState(false);

    // action: insert | update
    const [action, setAction] = useState("insert");

    // update-specific
    const [pkLabel, setPkLabel] = useState("id");
    const [searchColumn, setSearchColumn] = useState("");
    const [pkValue, setPkValue] = useState("");
    const [verifyLoading, setVerifyLoading] = useState(false);
    const [verifyError, setVerifyError] = useState("");
    const [fetchedRecord, setFetchedRecord] = useState(null);

    const [loadingTables, setLoadingTables] = useState(false);
    const [pageError, setPageError] = useState("");
    const [message, setMessage] = useState("");
    const [messageType, setMessageType] = useState(""); // "success" or "error"

    const [allowedPermissions, setAllowedPermissions] = useState({});
    const [viewBaseTableMap, setViewBaseTableMap] = useState({});
    const [initialUniqueValues, setInitialUniqueValues] = useState({});
    const location = useLocation();

    // Views
    const [showViewsOverlay, setShowViewsOverlay] = useState(false);
    const openViewsOverlay = () => setShowViewsOverlay(true);
    const closeViewsOverlay = () => setShowViewsOverlay(false);

    const onPermissionsRefresh = (updatedPermissions) => {
        // Store as object format for new permission system
        localStorage.setItem("permissions", JSON.stringify(updatedPermissions));
        setAllowedPermissions(updatedPermissions);

        // Also store as array for backwards compatibility
        const permissionsArray = permissionsObjectToArray(updatedPermissions);
        localStorage.setItem("allowedPermissions", JSON.stringify(permissionsArray));
    };

    const userHasEditViews = allowedPermissions["edit_views"] === 1;

    /**
     * Check if user has permission to access a table/view
     * Uses the centralized permissions logic that matches the server
     */
    function userHasAccessToTable(tableName) {
        if (!tableName) return false;
        return hasAccessToEntity(tableName, allowedPermissions, viewBaseTableMap);
    }

    // Load view-to-base-table mapping on mount
    useEffect(() => {
        async function loadViewMapping() {
            try {
                const res = await apiRequest('views/base-table-map', { method: 'GET' });
                const mapping = await res.json();
                setViewBaseTableMap(mapping || {});
            } catch (err) {
                console.warn('Failed to load view mapping:', err);
            }
        }
        loadViewMapping();
    }, []);

    // Handle incoming record from SearchPage
    useEffect(() => {
        const incoming = location?.state?.record;
        const incomingTable = location?.state?.table;
        const incomingCols = location?.state?.columnsMeta;
        const reason = location?.state?.reason;

        if (!incoming) return;

        // Check if table is excluded
        if (incomingTable) {
            const excludedArr = reason === "insert" 
                ? excludedTables.concat(excludedTablesInsert)
                : excludedTables.concat(excludedTablesUpdate);
            
            const isExcluded = excludedArr.some(ex => 
                String(ex).toLowerCase() === String(incomingTable).toLowerCase()
            );

            if (isExcluded) {
                setPageError(`You cannot view or edit records for table "${incomingTable}".`);
                return;
            }
        }

        setAction(reason);

        if (incomingTable && userHasAccessToTable(incomingTable)) {
            setTable(incomingTable);
        }

        if (incomingCols && Array.isArray(incomingCols) && incomingCols.length > 0) {
            setColumnsMeta(incomingCols);
        }

        try {
            const normalized = normalizeRecordForForm(incoming, incomingCols || columnsMeta);
            setFetchedRecord(normalized);
            
            const incomingUnique = location?.state?.uniqueValues || incoming?.uniqueValues || null;
            if (incomingUnique) {
                setInitialUniqueValues(incomingUnique);
            }
        } catch (e) {
            setFetchedRecord(incoming);
        }
    }, [location?.state, columnsMeta, allowedPermissions, viewBaseTableMap]);

    function normalizeTableNameToPermissionKey(name) {
        return String(name).toLowerCase().replace(/[-\s]/g, '_');
    }

    // Load permissions from localStorage on mount
    useEffect(() => {
        try {
            // Try loading object format first (new system)
            const permissionsObj = JSON.parse(localStorage.getItem("permissions") || "{}");
            if (permissionsObj && typeof permissionsObj === 'object' && Object.keys(permissionsObj).length > 0) {
                setAllowedPermissions(permissionsObj);
                return;
            }

            // Fallback: load array format and convert (backwards compatibility)
            const savedArray = JSON.parse(localStorage.getItem("allowedPermissions") || "[]");
            if (Array.isArray(savedArray) && savedArray.length > 0) {
                const normalized = normalizePermissionsArray(savedArray);
                setAllowedPermissions(normalized);
            } else {
                setAllowedPermissions({});
            }
        } catch (err) {
            console.error("Failed to load permissions:", err);
            setAllowedPermissions({});
        }
    }, []);

    // Reset when table changes
    useEffect(() => {
        setSearchColumn("");
        setFetchedRecord(null);
        if (loaded < 2) { 
            setLoaded(loaded + 1); 
        } else if (location.state !== null) {
            location.state.record = null;
        }
        setPkValue("");
        setVerifyError("");
        if (table && pkLabel) {
            setSearchColumn(pkLabel);
        }
    }, [table]);

    useEffect(() => {
        if (table && pkLabel) {
            setSearchColumn(pkLabel);
        }
    }, [pkLabel, table]);

    useEffect(() => {
        if (table && !userHasAccessToTable(table)) {
            setTable("");
        }
    }, [allowedPermissions, table, viewBaseTableMap]);

    // Reset form when action changes
    useEffect(() => {
        try {
            if (!table) return;

            if (!userHasAccessToTable(table)) {
                setTable("");
            }

            const normalized = normalizeTableNameToPermissionKey(table);
            const isExcludedInsert = excludedTablesInsert
                .map(s => String(s).toLowerCase())
                .includes(normalized);
            const isExcludedUpdate = excludedTablesUpdate
                .map(s => String(s).toLowerCase())
                .includes(normalized);

            if (action === "insert" && isExcludedInsert) {
                setTable("");
            }

            if (action === "update" && isExcludedUpdate) {
                setTable("");
            }
        } catch (err) {
            console.warn('Action change effect error:', err);
        }
    }, [action]);

    // Load tables
    useEffect(() => {
        let mounted = true;
        async function loadTables() {
            setLoadingTables(true);
            setPageError("");
            try {
                const res = await apiRequest('tables', { method: 'GET' });
                const json = await res.json();
                if (!mounted) return;
                setTables(Array.isArray(json) ? json : []);
            } catch (err) {
                if (!mounted) return;
                setPageError(err.message || "Failed to load tables");
            } finally {
                if (mounted) setLoadingTables(false);
            }
        }
        loadTables();
        return () => { mounted = false; };
    }, []);

    // Load columns
    useEffect(() => {
        if (!table) {
            setColumnsMeta([]);
            return;
        }
        let mounted = true;
        async function loadColumns() {
            setLoadingColumns(true);
            setPageError("");
            try {
                const res = await apiRequest(`columns?table=${encodeURIComponent(table)}`, {
                    method: 'GET'
                });
                const raw = await res.json();
                const parsed = parseColumnsResponse(raw);
                if (!mounted) return;
                setColumnsMeta(parsed);

                // Get primary key
                try {
                    const pkRes = await apiRequest(`primaryKey?table=${encodeURIComponent(table)}`, {
                        method: 'GET'
                    });
                    if (pkRes.ok) {
                        const pkJson = await pkRes.json();
                        if (pkJson && pkJson.primaryKey) {
                            setPkLabel(pkJson.primaryKey);
                        } else {
                            setPkLabel(guessPrimaryKeyColumn(parsed));
                        }
                    } else {
                        setPkLabel(guessPrimaryKeyColumn(parsed));
                    }
                } catch (e) {
                    setPkLabel(guessPrimaryKeyColumn(parsed));
                }
            } catch (err) {
                if (!mounted) return;
                setPageError(err.message || "Failed to load columns");
                setColumnsMeta([]);
            } finally {
                if (mounted) setLoadingColumns(false);
            }
        }
        loadColumns();
        return () => { mounted = false; };
    }, [table]);

    async function handleVerifyPk() {
        setVerifyError("");
        setMessage("");
        setFetchedRecord(null);

        if (!table) {
            setVerifyError("Please choose a table first.");
            return;
        }
        if (!pkValue) {
            setVerifyError(`Please enter ${pkLabel}.`);
            return;
        }

        setVerifyLoading(true);
        try {
            const keyColumn = searchColumn || pkLabel;
            const res = await apiRequest(
                `record?table=${encodeURIComponent(table)}&key=${encodeURIComponent(keyColumn)}&value=${encodeURIComponent(pkValue)}`,
                { method: 'GET' }
            );
            
            if (res.status === 404) {
                setVerifyError("Record not found.");
                return;
            }
            
            const json = await res.json();

            // Check for custom fetch handler (validation rules)
            const rules = getValidationRules(table);
            let augmented = json;

            if (rules && typeof rules.onFetch === 'function') {
                const result = await rules.onFetch(json, setInitialUniqueValues);
                
                if (result?.ok === false) {
                    setPageError(result?.message || 'Failed to load record data');
                    return;
                }
                
                augmented = result.record || json;
            }

            setFetchedRecord(normalizeRecordForForm(augmented, columnsMeta));
            setMessage("");
        } catch (err) {
            setVerifyError(err.message || "Failed to verify record");
        } finally {
            setVerifyLoading(false);
        }
    }

    function onFormSuccess(msg = "") {
        setMessage(msg || "Operation completed");
        setMessageType("success");
        setFetchedRecord(null);
        setPkValue("");

        setTimeout(() => {
            setMessage("");
            setMessageType("");
        }, 4000);
    }

    function onFormError(msg = "") {
        setMessage(msg || "Submission failed");
        setMessageType("error");

        setTimeout(() => {
            setMessage("");
            setMessageType("");
        }, 4000);
    }

    function formatValueForDisplay(key, val, columnsMeta) {
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
                const d = parseLocalDateTime(val);
                if (d) return formatDateTimeLocal(d);
            } catch { }
            return String(val);
        }

        if (val instanceof File) return val.name;
        if (typeof val === "object") return JSON.stringify(val);
        return val?.toString() ?? "";
    }

    function getFieldMeta(col) {
        return columnsMeta.find((c) => c.name === col) || { 
            name: col, 
            type: null, 
            isNullable: true, 
            isAutoIncrement: false 
        };
    }

    function RecordForm({ mode = "insert", initial = {}, initialUnique = [], onSuccess }) {
        const initialQuantity = initial["Quantity"] || 1;
        const [uniqueValues, setUniqueValues] = useState(() => initialUnique);

        const [formData, setFormData] = useState(() => {
            const base = {};
            const normalizedInitial = normalizeRecordForForm(initial || {}, columnsMeta);
            for (const c of columnsMeta) {
                base[c.name] = normalizedInitial[c.name] ?? "";
            }
            return base;
        });

        const uniqueColumns = useMemo(() => {
            return columnsMeta.filter(
                (c) => Boolean(c.isUnique) && !c.isPrimary && !c.isAutoIncrement && 
                       c.name.toLowerCase() !== "id"
            );
        }, [columnsMeta]);

        // Manage unique values based on quantity
        useEffect(() => {
            const hasQuantityField = columnsMeta.some(c => c.name.toLowerCase() === "quantity");
            if (!hasQuantityField) {
                setFormError("");
                return;
            }

            const rawQty = formData["Quantity"];
            if (rawQty === "" || rawQty === undefined || rawQty === null) {
                setFormError("");
                return;
            }

            const qtyNum = parseInt(String(rawQty).trim(), 10);
            if (isNaN(qtyNum) || qtyNum <= 0) {
                setFormError("Quantity must be a positive integer.");
                setTimeout(() => setFormError(""), 4000);
                return;
            }

            setFormError("");

            const minLength = mode === "insert" ? 0 : initialQuantity;
            const targetLength = qtyNum > minLength ? qtyNum : minLength;
            
            setUniqueValues(prev => {
                const copy = [...prev];
                while (copy.length > targetLength) copy.pop();
                while (copy.length < targetLength) copy.push({});
                return copy;
            });
        }, [formData["Quantity"], mode, initialQuantity, columnsMeta]);

        // Reset unique values when mode changes
        useEffect(() => {
            if (mode !== "insert" && !hasValidationRules(table)) {
                setUniqueValues([]);
            }
        }, [mode, columnsMeta]);

        const [submitting, setSubmitting] = useState(false);
        const [formError, setFormError] = useState("");
        const [showVerifyModal, setShowVerifyModal] = useState(false);
        const [pendingData, setPendingData] = useState(null);

        const pkCol = useMemo(() => {
            if (!columnsMeta || columnsMeta.length === 0) return pkLabel || "id";
            const pkMeta = columnsMeta.find((c) => c.isPrimary);
            if (pkMeta) return pkMeta.name;
            if (pkLabel && columnsMeta.map(c => c.name).includes(pkLabel)) return pkLabel;
            return guessPrimaryKeyColumn(columnsMeta);
        }, [columnsMeta, pkLabel]);

        const usedPkValue = mode === "edit" ? (initial[pkCol] ?? formData[pkCol] ?? pkValue) : null;

        useEffect(() => {
            const normalizedInitial = normalizeRecordForForm(initial || {}, columnsMeta);
            setFormData((d) => {
                const copy = { ...d };
                for (const c of columnsMeta) {
                    copy[c.name] = normalizedInitial[c.name] ?? copy[c.name] ?? "";
                }
                return copy;
            });
        }, [initial, columnsMeta]);

        function onFieldChange(col, val) {
            setFormData((d) => ({ ...d, [col]: val }));
        }

        function onUniqueValueChange(index, colName, value) {
            setUniqueValues((arr) => {
                const copy = [...arr];
                if (!copy[index]) copy[index] = {};
                copy[index][colName] = value;
                return copy;
            });
        }

        async function handleSubmit(e) {
            e.preventDefault();
            setFormError("");
            setSubmitting(true);

            const normalizedData = { ...formData };

            // Auto-populate columns
            if (mode === "insert") {
                const autoTable = autoPopulateColumns[table] || [];
                const tableAutoCols = [...autoTable, ...autoPopulateColumns.default];
                
                for (const colDef of tableAutoCols) {
                    const colName = colDef[0];
                    const colMeta = columnsMeta.find(c => c.name.toLowerCase() === colName.toLowerCase());
                    if (!colMeta) continue;

                    if (colMeta.type === "date") {
                        normalizedData[colMeta.name] = new Date().toISOString().split("T")[0];
                    } else if (["datetime", "timestamp"].includes(colMeta.type)) {
                        normalizedData[colMeta.name] = formatDateTimeLocal();
                    } else if (colMeta.type === "bit" && colDef[1] != null) {
                        normalizedData[colMeta.name] = (normalizedData[colDef[1]] !== "") ? 1 : 0;
                    }
                }
            }

            // Validate quantity
            let qtyNum = parseInt(String(normalizedData["Quantity"] ?? "").trim(), 10);
            if (isNaN(qtyNum) || qtyNum <= 0) {
                setFormError("Quantity must be a positive integer. Defaulting to 1.");
                normalizedData["Quantity"] = 1;
                qtyNum = 1;
                setTimeout(() => setFormError(""), 4000);
            }

            try {
                setPendingData(normalizedData);
                setShowVerifyModal(true);
                setSubmitting(false);
            } catch (err) {
                setFormError(err.message || "Submission failed");
                setSubmitting(false);
            }
        }

        async function handleConfirmSubmit() {
            if (!pendingData) return;

            setSubmitting(true);
            setFormError("");

            try {
                const normalizedData = { ...pendingData };

                // Normalize bit columns
                for (const c of columnsMeta) {
                    if ((c.type || "").toLowerCase() === "bit") {
                        const v = normalizedData[c.name];
                        if (v === "" || v === null || v === undefined) continue;
                        normalizedData[c.name] = normalizeBitValueForForm(v);
                    }
                }

                // Auto-update last_modified on edit
                if (mode === "edit") {
                    const tableAutoCols = autoPopulateColumns[table] || autoPopulateColumns.default || [];
                    for (const colDef of tableAutoCols) {
                        const colMeta = columnsMeta.find(c => c.name.toLowerCase() === colDef[0].toLowerCase());
                        if (!colMeta) continue;

                        if (colMeta.name.toLowerCase() === "last modified" && 
                            ["datetime", "timestamp"].includes(colMeta.type)) {
                            normalizedData[colMeta.name] = formatDateTimeLocal();
                        } else if (colMeta.type === "bit" && colDef[1] != null) {
                            normalizedData[colMeta.name] = (normalizedData[colDef[1]] !== "") ? 1 : 0;
                        }
                    }
                }

                // Normalize date/datetime fields
                for (const c of columnsMeta) {
                    const type = (c.type || "").toLowerCase();
                    const name = c.name;
                    const val = normalizedData[name];

                    if (val === null || val === "") continue;

                    if (type === "date") {
                        if (val instanceof Date) {
                            normalizedData[name] = val.toISOString().split("T")[0];
                        } else if (typeof val === "string" && val.includes("T")) {
                            normalizedData[name] = val.split("T")[0];
                        }
                    } else if (["datetime", "timestamp"].includes(type)) {
                        const d = parseLocalDateTime(val);
                        if (d) normalizedData[name] = formatDateTimeLocal(d);
                    }
                }

                // Check for validation rules
                const rules = getValidationRules(table);
                let customHandled = false;

                if (mode === "insert") {
                    // Run beforeInsert validation
                    if (rules && typeof rules.beforeInsert === 'function') {
                        const result = await rules.beforeInsert(normalizedData, uniqueValues);
                        
                        if (!result.ok) {
                            setFormError(result.message || "Validation failed");
                            setShowVerifyModal(false);
                            setPendingData(null);
                            setSubmitting(false);
                            return;
                        }
                        
                        // Update data with any modifications from validation
                        Object.assign(normalizedData, result.data || {});
                    }

                    // Perform insert
                    const quantity = Number(normalizedData["Quantity"]) || 1;
                    const hasFile = columnsMeta.some(c => {
                        const t = c.type || "";
                        const ct = (c.columnType || "").toLowerCase();
                        return ["blob", "binary", "varbinary"].includes(t) || 
                               ct.includes("blob") || ct.includes("binary");
                    });

                    let insertResult;

                    if (quantity > 1 && uniqueValues.length === quantity && uniqueColumns.length > 0) {
                        // Multi-record insert
                        for (let i = 0; i < quantity; i++) {
                            const record = { ...normalizedData, Quantity: 1 };

                            for (const col of uniqueColumns) {
                                record[col.name] = uniqueValues[i][col.name] || `${col.name}_${i + 1}`;
                            }

                            if (hasFile) {
                                const fd = new FormData();
                                fd.append("table", table);
                                for (const k of Object.keys(record)) {
                                    const v = record[k];
                                    if (v instanceof File) fd.append(k, v, v.name);
                                    else fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
                                }
                                await apiRequest('insert', { method: 'POST', body: fd });
                            } else {
                                await apiRequest('insert', {
                                    method: 'POST',
                                    body: { table, data: record }
                                });
                            }
                        }
                        insertResult = { ok: true };
                    } else {
                        // Single insert
                        if (hasFile) {
                            const fd = new FormData();
                            fd.append("table", table);
                            for (const k of Object.keys(normalizedData)) {
                                const v = normalizedData[k];
                                if (v instanceof File) fd.append(k, v, v.name);
                                else fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
                            }
                            insertResult = await apiRequest('insert', { method: 'POST', body: fd });
                        } else {
                            insertResult = await apiRequest('insert', {
                                method: 'POST',
                                body: { table, data: normalizedData }
                            });
                        }
                    }

                    // Run afterInsert if available
                    if (rules && typeof rules.afterInsert === 'function') {
                        const json = await insertResult.json();
                        const afterResult = await rules.afterInsert(json, normalizedData, uniqueValues);
                        
                        if (!afterResult.ok) {
                            onSuccess(afterResult.message || "Post-insert operation failed", true);
                            return;
                        }
                        
                        onSuccess(afterResult.message || "Inserted successfully");
                        customHandled = true;
                    }

                } else if (mode === "edit") {
                    // Run beforeUpdate validation
                    if (rules && typeof rules.beforeUpdate === 'function') {
                        const result = await rules.beforeUpdate(normalizedData, uniqueValues);
                        
                        if (!result.ok) {
                            setFormError(result.message || "Validation failed");
                            setShowVerifyModal(false);
                            setPendingData(null);
                            setSubmitting(false);
                            return;
                        }
                        
                        Object.assign(normalizedData, result.data || {});
                    }

                    // Perform update
                    const hasFile = columnsMeta.some(c => {
                        const t = c.type || "";
                        const ct = (c.columnType || "").toLowerCase();
                        return ["blob", "binary", "varbinary"].includes(t) || 
                               ct.includes("blob") || ct.includes("binary");
                    });

                    let updateResult;

                    if (hasFile) {
                        const fd = new FormData();
                        fd.append("table", table);
                        fd.append("pkColumn", pkCol);
                        fd.append("pkValue", usedPkValue ?? pkValue);
                        for (const k of Object.keys(normalizedData)) {
                            const v = normalizedData[k];
                            if (v instanceof File) fd.append(k, v, v.name);
                            else fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
                        }
                        updateResult = await apiRequest('update', { method: 'POST', body: fd });
                    } else {
                        updateResult = await apiRequest('update', {
                            method: 'POST',
                            body: {
                                table,
                                pkColumn: pkCol,
                                pkValue: usedPkValue ?? pkValue,
                                data: normalizedData
                            }
                        });
                    }

                    // Run afterUpdate if available
                    if (rules && typeof rules.afterUpdate === 'function') {
                        const json = await updateResult.json();
                        const afterResult = await rules.afterUpdate(json, normalizedData, uniqueValues);
                        
                        if (!afterResult.ok) {
                            onSuccess(afterResult.message || "Post-update operation failed", true);
                            return;
                        }
                        
                        onSuccess(afterResult.message || "Updated successfully");
                        customHandled = true;
                    }
                }

                if (!customHandled) {
                    const successText = mode === "insert" ? "Inserted successfully!" : "Updated successfully!";
                    onSuccess(successText);
                }

                // Clear form
                setFormData(() => {
                    const cleared = {};
                    for (const c of columnsMeta) cleared[c.name] = "";
                    return cleared;
                });
                setUniqueValues([]);

            } catch (err) {
                const errorText = err.message || "Submission failed";
                onSuccess(errorText, true);
                setFormError(errorText);
            } finally {
                setShowVerifyModal(false);
                setPendingData(null);
                setSubmitting(false);
            }
        }

        return (
            <div className="insert-record-card">
                <h3>{mode === "insert" ? `Insert into ${table}` : `Edit ${table}`}</h3>

                <form className="record-form" onSubmit={handleSubmit}>
                    <div className="fields">
                        {columnsMeta
                            .filter((meta) => {
                                if (mode === "insert" && meta.isAutoIncrement) return false;
                                
                                // Check auto-populate columns
                                const defaultAuto = autoPopulateColumns.default || [];
                                const tableAuto = autoPopulateColumns[table] || [];
                                const allAuto = [...defaultAuto, ...tableAuto];
                                
                                return !allAuto.some(colDef => 
                                    colDef[0].toLowerCase() === meta.name.toLowerCase()
                                );
                            })
                            .map((meta) => {
                                const col = meta.name;
                                const value = formData[col];
                                const isPk = col === pkCol;

                                const showRequiredAsterisk =
                                    (meta.isPrimary && !meta.isAutoIncrement) ||
                                    (!meta.isNullable && !meta.isPrimary);

                                // Handle unique fields with quantity > 1
                                if (meta.isUnique && !meta.isAutoIncrement && !meta.isPrimary) {
                                    const qty = Number(formData["Quantity"]) || 1;
                                    const minQty = mode === "edit" ? initialQuantity : 1;
                                    
                                    if (qty > minQty || (hasValidationRules(table) && qty > 0 && mode === "edit")) {
                                        return (
                                            <div key={col} className="field-group-duplicated">
                                                {Array.from({ length: qty }, (_, i) => (
                                                    <div key={`${col}_${i}`} className="field-row">
                                                        <label className="field-label">
                                                            {`${col}_${i + 1}`}
                                                            {meta.isPrimary && <span className="pk-tag">PK</span>}
                                                            {showRequiredAsterisk && <span className="required-tag">*</span>}
                                                        </label>
                                                        <div className="field-input-wrap">
                                                            <input
                                                                className="field-input"
                                                                type="text"
                                                                value={uniqueValues[i]?.[col] || ""}
                                                                onChange={(i < initialQuantity && hasValidationRules(table) && mode === "edit") 
                                                                    ? undefined 
                                                                    : (e) => onUniqueValueChange(i, col, e.target.value)
                                                                }
                                                                placeholder={`Enter ${col} for item #${i + 1}`}
                                                                readOnly={i < initialQuantity && hasValidationRules(table) && mode === "edit"}
                                                                required
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    }
                                }

                                // Regular field
                                return (
                                    <div className="field-row" key={col}>
                                        <label className="field-label">
                                            {col}
                                            {meta.isPrimary && <span className="pk-tag">PK</span>}
                                            {showRequiredAsterisk && <span className="required-tag">*</span>}
                                        </label>
                                        <div className="field-input-wrap">
                                            <FieldInput
                                                meta={meta}
                                                value={value}
                                                onChange={(v) => onFieldChange(col, v)}
                                                mode={mode}
                                                table={table}
                                            />
                                        </div>
                                        {isPk && mode === "edit" && <div className="muted">primary key (locked)</div>}
                                    </div>
                                );
                            })}
                    </div>

                    <div className="form-actions">
                        <button className="btn" type="submit" disabled={submitting}>
                            {submitting 
                                ? (mode === "insert" ? "Submitting..." : "Updating...") 
                                : (mode === "insert" ? "Insert record" : "Update record")
                            }
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                                setFetchedRecord(null);
                                setFormData(() => {
                                    const base = {};
                                    for (const c of columnsMeta) base[c.name] = "";
                                    return base;
                                });
                                setUniqueValues([]);
                                setFormError("");
                            }}
                        >
                            Reset
                        </button>
                    </div>
                </form>

                {formError && <div className="error-note" style={{ marginTop: 8 }}>{formError}</div>}

                {showVerifyModal && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>Verify {mode === "insert" ? "New Record" : "Changes"}</h3>
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
                                                    {formatValueForDisplay(key, val, columnsMeta)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="modal-actions">
                                <button className="btn" onClick={handleConfirmSubmit} disabled={submitting}>
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
            </div>
        );
    }

    return (
        <div className="insert-page-root" style={{ marginTop: "8vh" }}>
            {showViewsOverlay && (
                <ViewsOverlay
                    isOpen={showViewsOverlay}
                    onClose={closeViewsOverlay}
                    api={viewsAPI}
                    excludedViews={excludedViews}
                    userHasPermission={userHasEditViews}
                    username={getStoredUser().username}
                    onPermissionsRefresh={onPermissionsRefresh}
                />
            )}

            {!showViewsOverlay && (
                <div className="insert-panel">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h2>Insert / Update records</h2>
                        {userHasEditViews && (
                            <button className="btn" onClick={openViewsOverlay}>
                                Manage Views
                            </button>
                        )}
                    </div>

                    {message && (
                        <div
                            className={messageType === "error" ? "error-note" : "success-note"}
                            style={{ marginBottom: "10px" }}
                        >
                            {message}
                        </div>
                    )}

                    {pageError && (
                        <div className="error-note" style={{ marginBottom: "10px" }}>
                            {pageError}
                        </div>
                    )}

                    <div className="top-controls">
                        <div className="control">
                            <label className="control-label">Table</label>
                            <Dropdown
                                options={tables.filter(t => {
                                    const excludedArr = action === "insert" 
                                        ? excludedTables.concat(excludedTablesInsert)
                                        : excludedTables.concat(excludedTablesUpdate);
                                    
                                    const isExcluded = excludedArr.some(ex => 
                                        ex.toLowerCase() === t.toLowerCase()
                                    );
                                    
                                    return !isExcluded && userHasAccessToTable(t);
                                })}
                                value={table}
                                onChange={(val) => {
                                    if (!userHasAccessToTable(val)) {
                                        setPageError("You do not have permission to access that table.");
                                        setTable("");
                                        return;
                                    }

                                    setPageError("");
                                    setTable(val);
                                    setFetchedRecord(null);
                                    setMessage("");
                                }}
                                placeholder={loadingTables ? "Loading tables..." : "Select a table..."}
                            />
                        </div>

                        <div className="control">
                            <label className="control-label">Action</label>
                            <div className="action-row themed-action-row">
                                <label className="radio-label">
                                    <input
                                        type="radio"
                                        name="action"
                                        value="insert"
                                        checked={action === "insert"}
                                        onChange={() => { 
                                            setAction("insert"); 
                                            setFetchedRecord(null);
                                        }}
                                    />
                                    Insert
                                </label>
                                <label className="radio-label">
                                    <input
                                        type="radio"
                                        name="action"
                                        value="update"
                                        checked={action === "update"}
                                        onChange={() => { 
                                            setAction("update"); 
                                            setFetchedRecord(null);
                                        }}
                                    />
                                    Update
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="form-area">
                        {loadingColumns && <div>Loading columns...</div>}

                        {!table && <div className="info-note">Choose a table above to begin.</div>}

                        {table && action === "insert" && (
                            <RecordForm
                                mode="insert"
                                initial={fetchedRecord || {}}
                                onSuccess={(msg, isError = false) => {
                                    if (isError) onFormError(msg);
                                    else onFormSuccess(msg);
                                }}
                            />
                        )}

                        {table && action === "update" && !fetchedRecord && (
                            <div className="verify-card">
                                <div className="control">
                                    <label className="control-label">Search by</label>
                                    <Dropdown
                                        options={columnsMeta
                                            .filter(c => c.isPrimary || c.isUnique)
                                            .map(c => c.name)}
                                        value={searchColumn}
                                        onChange={(val) => setSearchColumn(val)}
                                        placeholder="-- Select column --"
                                    />
                                </div>

                                {searchColumn && (() => {
                                    const searchMeta = getFieldMeta(searchColumn);
                                    return (
                                        <>
                                            <label className="control-label" style={{ marginTop: "8px" }}>
                                                Enter value
                                            </label>
                                            <FieldInput
                                                meta={searchMeta}
                                                value={pkValue}
                                                onChange={(val) => setPkValue(val)}
                                                mode="search"
                                                table={table}
                                            />
                                        </>
                                    );
                                })()}

                                {!searchColumn && (
                                    <>
                                        <label className="control-label" style={{ marginTop: "8px" }}>
                                            Enter value
                                        </label>
                                        <input
                                            className="field-input"
                                            value={pkValue}
                                            onChange={(e) => setPkValue(e.target.value)}
                                            placeholder="Enter value to search"
                                        />
                                    </>
                                )}

                                <div style={{ marginTop: 8 }}>
                                    <button className="btn" onClick={handleVerifyPk} disabled={verifyLoading}>
                                        {verifyLoading ? "Verifying..." : "Verify"}
                                    </button>
                                </div>
                                {verifyError && (
                                    <div className="error-note" style={{ marginTop: "8px" }}>
                                        {verifyError}
                                    </div>
                                )}
                            </div>
                        )}

                        {table && action === "update" && fetchedRecord && (
                            <RecordForm
                                mode="edit"
                                initial={fetchedRecord}
                                initialUnique={initialUniqueValues}
                                onSuccess={(msg, isError = false) => {
                                    if (isError) onFormError(msg);
                                    else onFormSuccess(msg);
                                }}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}