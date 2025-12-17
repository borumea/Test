// src/pages/SearchPage.js
import React, { useEffect, useState, useMemo, useRef } from "react";
import "../styles/HomePage.css";
import "../styles/SearchPage.css";
import { formatNumber, formatDateLocal } from "../lib/format";
import { formatDateTimeLocal } from "../lib/insert/insertNormalization.js";
import { addedSearchCols, defaultOrderBy, excludedTables } from "../lib/search/searchConstants.js";
import { printAllResultsTable } from "../lib/print.js";
import Dropdown from "../components/Dropdown";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import TagManager from "../components/TagManager";
import "../styles/TagManager.css";
import ForeignKeyPopup from "../components/ForeignKeyPopup";
import { FilterRow } from "../components/FilterRow";
import { apiRequest } from '../lib/api';

const SEARCH_STATE_KEY = "searchPageState";
const MemoFilterRow = React.memo(FilterRow);

export default function SearchPage() {
    const navigate = useNavigate();

    const [tables, setTables] = useState([]);
    const [table, setTable] = useState("");
    const [columns, setColumns] = useState([]);
    const [displayCols, setDisplayCols] = useState([]);
    const [filters, setFilters] = useState([]);
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [columnsMeta, setColumnsMeta] = useState([]);
    const [page, setPage] = useState(1);
    const [allowedPermissions, setAllowedPermissions] = useState([]);
    const [orderBy1, setOrderBy1] = useState("");
    const [orderBy2, setOrderBy2] = useState("");
    const [orderBy3, setOrderBy3] = useState("");
    const [contextMenu, setContextMenu] = useState(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [showPanel, setShowPanel] = useState(true);
    const [fkPopup, setFkPopup] = useState(null);
    const [editMode, setEditMode] = useState(false);
    const [tagColumns, setTagColumns] = useState(new Set());
    const [loadingTagColumns, setLoadingTagColumns] = useState(false);
    const [ratingColumns, setRatingColumns] = useState(new Map());
    const [loadingRatingColumns, setLoadingRatingColumns] = useState(false);
    const [selectedRow, setSelectedRow] = useState(null);
    const [selectedRowGlobalIndex, setSelectedRowGlobalIndex] = useState(null);

    // NEW: Track metadata about current table/view
    const [entityMetadata, setEntityMetadata] = useState(null);
    const [isMultiTableView, setIsMultiTableView] = useState(false);

    const hydratingRef = useRef(true);

    function normalizeTableNameToPermissionKey(name) {
        return String(name).toLowerCase().replace(/[-\s]/g, '_');
    }

    function getPrimaryKeyColumn() {
        if (!Array.isArray(columnsMeta) || columnsMeta.length === 0) return null;
        const byIsPrimary = columnsMeta.find(c => c.isPrimary || c.is_primary || c.isPrimaryKey);
        if (byIsPrimary) return byIsPrimary.name;
        const byKeyPRI = columnsMeta.find(c => (c.key && String(c.key).toUpperCase() === "PRI"));
        if (byKeyPRI) return byKeyPRI.name;
        const byIdName = columnsMeta.find(c => String(c.name).toLowerCase() === "id");
        if (byIdName) return byIdName.name;
        return null;
    }

    // Load saved cookie
    useEffect(() => {
        if (tables.length === 0 || allowedPermissions.length === 0) return;

        const savedState = Cookies.get(SEARCH_STATE_KEY);
        if (!savedState) {
            hydratingRef.current = false;
            return;
        }

        try {
            const parsed = JSON.parse(savedState);
            const normalized = normalizeTableNameToPermissionKey(parsed.table || "");

            if (parsed.table && allowedPermissions.includes(normalized) && tables.includes(parsed.table)) {
                setTable(parsed.table);
            }

            if (Array.isArray(parsed.displayCols)) setDisplayCols(parsed.displayCols);
            if (typeof parsed.orderBy1 === "string") setOrderBy1(parsed.orderBy1);
            if (typeof parsed.orderBy2 === "string") setOrderBy2(parsed.orderBy2);
            if (typeof parsed.orderBy3 === "string") setOrderBy3(parsed.orderBy3);
            if (Array.isArray(parsed.filters)) setFilters(parsed.filters);
            if (Number.isFinite(Number(parsed.rowsPerPage))) setRowsPerPage(Number(parsed.rowsPerPage));

        } catch (err) {
            console.warn("Failed to parse saved search state", err);
        } finally {
            hydratingRef.current = false;
        }
    }, [tables, allowedPermissions]);

    // Save cookie
    useEffect(() => {
        if (hydratingRef.current) return;

        const stateToSave = {
            table,
            displayCols,
            filters,
            orderBy1,
            orderBy2,
            orderBy3,
            rowsPerPage,
        };

        try {
            Cookies.set(SEARCH_STATE_KEY, JSON.stringify(stateToSave), { expires: 7 });
        } catch (e) {
            console.warn("Failed to save search state cookie", e);
        }
    }, [table, displayCols, filters, orderBy1, orderBy2, orderBy3, rowsPerPage]);

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem("allowedPermissions") || "[]");
            setAllowedPermissions(Array.isArray(saved) ? saved.map(s => String(s).toLowerCase()) : []);
        } catch (e) {
            setAllowedPermissions([]);
        }
    }, []);

    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener("click", handleClick);
        return () => window.removeEventListener("click", handleClick);
    }, []);

    useEffect(() => {
        if (table && !allowedPermissions.includes(normalizeTableNameToPermissionKey(table))) {
            setTable("");
        }
    }, [allowedPermissions, table]);

    // Load tables
    useEffect(() => {
        async function loadTables() {
            try {
                const res = await apiRequest('tables', { method: 'GET' });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || "Failed to load tables");

                const allowed = JSON.parse(localStorage.getItem("allowedPermissions") || "[]");
                const allowedSet = new Set(Array.isArray(allowed) ? allowed.map(a => String(a).toLowerCase()) : []);
                const filteredTables = Array.isArray(json)
                    ? json.filter(t => allowedSet.has(normalizeTableNameToPermissionKey(t)))
                    : [];
                setTables(filteredTables);
            } catch (e) {
                setError(e.message || "Failed to load tables");
            }
        }
        loadTables();
    }, []);

    // Load columns and metadata when table changes
    useEffect(() => {
        async function loadColumns() {
            if (!table) {
                setColumns([]);
                setDisplayCols([]);
                setOrderBy1("");
                setOrderBy2("");
                setOrderBy3("");
                setEntityMetadata(null);
                setIsMultiTableView(false);
                return;
            }

            try {
                // Fetch full metadata (includes columnTableMap for views)
                const metaRes = await apiRequest(`metadata?table=${encodeURIComponent(table)}`, {
                    method: 'GET',
                });
                const metaJson = await metaRes.json();
                if (!metaRes.ok) throw new Error(metaJson.error || "Failed to load metadata");

                setEntityMetadata(metaJson);
                setIsMultiTableView(metaJson.isMultiTable || false);

                // Get column list
                const cols = Array.isArray(metaJson.columns) ? metaJson.columns : [];
                const extraCols = addedSearchCols[table] || [];
                const availableNames = cols.map(c => (typeof c === "string" ? c : (c.name || ""))).concat(extraCols);

                setColumns(availableNames);
                setColumnsMeta(cols);

                // Restore saved state
                let usedDisplayCols = availableNames.slice();
                let usedFilters = [];
                let usedRowsPerPage = 10;

                try {
                    const savedStateRaw = Cookies.get(SEARCH_STATE_KEY);
                    const savedState = savedStateRaw ? JSON.parse(savedStateRaw) : null;

                    if (savedState && savedState.table === table) {
                        if (Array.isArray(savedState.displayCols) && savedState.displayCols.length > 0) {
                            const intersected = savedState.displayCols.filter(c => availableNames.includes(c));
                            usedDisplayCols = intersected.length > 0 ? intersected : availableNames.slice();
                        }

                        if (Array.isArray(savedState.filters)) {
                            usedFilters = savedState.filters.slice();
                        }

                        if (typeof savedState.orderBy1 === "string") setOrderBy1(savedState.orderBy1);
                        if (typeof savedState.orderBy2 === "string") setOrderBy2(savedState.orderBy2);
                        if (typeof savedState.orderBy3 === "string") setOrderBy3(savedState.orderBy3);
                        usedRowsPerPage = savedState.rowsPerPage;
                    }

                    // Check for tags
                    setLoadingTagColumns(true);
                    const tagCheckPromises = availableNames.map(async (colName) => {
                        const res = await apiRequest('query', {
                            method: 'POST',
                            body: {
                                table: "Tags",
                                columns: ["id"],
                                filters: [
                                    { column: "table_name", operator: "=", value: table },
                                    { column: "column_name", operator: "=", value: colName }
                                ]
                            }
                        });

                        if (res.ok) {
                            const json = await res.json();
                            return Array.isArray(json.rows) && json.rows.length > 0 ? colName : null;
                        }
                        return null;
                    });

                    const tagColumnResults = await Promise.all(tagCheckPromises);
                    setTagColumns(new Set(tagColumnResults.filter(Boolean)));
                    setLoadingTagColumns(false);

                    // Check for ratings
                    setLoadingRatingColumns(true);
                    const ratingCheckPromises = availableNames.map(async (colName) => {
                        const colType = cols.find(c => c.name === colName)?.type?.toLowerCase();
                        if (!["int", "bigint", "smallint", "mediumint", "tinyint"].includes(colType)) {
                            return null;
                        }

                        const res = await apiRequest('query', {
                            method: 'POST',
                            body: {
                                table: "Ratings",
                                columns: ["id", "shape", "max_value"],
                                filters: [
                                    { column: "table_name", operator: "=", value: table },
                                    { column: "column_name", operator: "=", value: colName }
                                ]
                            }
                        });

                        if (res.ok) {
                            const json = await res.json();
                            if (Array.isArray(json.rows) && json.rows.length > 0) {
                                return { colName, config: json.rows[0] };
                            }
                        }
                        return null;
                    });

                    const ratingColumnResults = await Promise.all(ratingCheckPromises);
                    const ratingsMap = new Map();
                    ratingColumnResults.filter(Boolean).forEach(({ colName, config }) => {
                        ratingsMap.set(colName, config);
                    });
                    setRatingColumns(ratingsMap);
                    setLoadingRatingColumns(false);

                } catch (e) {
                    usedDisplayCols = availableNames.slice();
                    usedFilters = [];
                    setOrderBy1("");
                    setOrderBy2("");
                    setOrderBy3("");
                }

                setDisplayCols(usedDisplayCols.length > 0 ? usedDisplayCols : availableNames.slice());
                setFilters(usedFilters);
                setRowsPerPage(usedRowsPerPage);

            } catch (e) {
                setError(e.message || "Failed to load columns");
                setColumns([]);
                setDisplayCols([]);
            } finally {
                hydratingRef.current = false;
            }
        }
        loadColumns();
    }, [table]);

    useEffect(() => {
        const effectiveRowsPerPage = rowsPerPage === 0 ? results.length || 1 : Math.max(1, rowsPerPage);
        const totalPages = Math.max(1, Math.ceil(results.length / effectiveRowsPerPage));
        setPage((p) => {
            if (results.length === 0) return 1;
            if (p < 1) return 1;
            if (p > totalPages) return totalPages;
            return p;
        });
    }, [results, rowsPerPage]);

    useEffect(() => {
        if (!showAdvanced && table) {
            runSearch();
        }
    }, [showAdvanced]);

    useEffect(() => {
        if (orderBy1) {
            runSearch();
        }
    }, [orderBy1]);

    function addFilter() {
        setFilters((s) => [...s, { column: columns[0] || "", operator: "=", value: "" }]);
    }

    function updateFilter(index, newFilter) {
        setFilters((s) => s.map((f, i) => (i === index ? newFilter : f)));
    }

    function removeFilter(index) {
        setFilters((s) => s.filter((_, i) => i !== index));
    }

    function handlePrint() {
        printAllResultsTable({
            allResults: results,
            headerCols,
            columnsMeta,
            renderCell: renderCellForPrint,
            title: `${table} - Search Results`
        });
    }

    function handleHeaderClick(col) {
        setOrderBy1((prev) => {
            const match = typeof prev === "string" ? prev.match(/^(.+)\s+(ASC|DESC)$/i) : null;
            const currentCol = match ? match[1] : prev;
            const currentDir = match ? match[2].toUpperCase() : "ASC";

            if (currentCol === col) {
                const newDir = currentDir === "ASC" ? "DESC" : "ASC";
                return `${col} ${newDir}`;
            } else {
                return `${col} ASC`;
            }
        });
    }

    function handleHeaderRightClick(e, col) {
        e.preventDefault();
        if (orderBy1 && orderBy1.startsWith(col)) {
            setOrderBy1(null);
            runSearch();
        }
    }

    function toggleColumn(col) {
        const filterCols = new Set(filters.map((f) => f.column).filter(Boolean));
        if (filterCols.has(col)) return;
        setDisplayCols((prev) => {
            if (prev.includes(col)) {
                const next = prev.filter((c) => c !== col);
                return next.length === 0 ? columns.slice() : next;
            }
            return [...prev, col];
        });
    }

    async function runSearch(e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!table) {
            setError("Please select a table.");
            return;
        }

        setError(null);
        setLoading(true);
        setPage(1);
        setSelectedRow(null);
        setSelectedRowGlobalIndex(null);

        try {
            const effectiveFilters = filters
                .filter((f) => f && f.column && (f.operator || f.op) && f.value !== undefined && f.value !== "")
                .map((f) => ({
                    column: f.column,
                    operator: f.operator || f.op || "=",
                    value: f.value,
                }));

            const userOrderBy = [orderBy1, orderBy2, orderBy3].filter(Boolean);
            const defaultOrderByArray = defaultOrderBy[table] || [];

            const userOrderByCols = userOrderBy.map(ob => {
                const match = ob.match(/^(.+?)\s+(ASC|DESC)$/i);
                return match ? match[1].trim() : ob.trim();
            });

            let finalOrderBy = [...userOrderBy];

            for (const defaultOb of defaultOrderByArray) {
                if (finalOrderBy.length >= 3) break;
                const match = defaultOb.match(/^(.+?)\s+(ASC|DESC)$/i);
                const defaultCol = match ? match[1].trim() : defaultOb.trim();
                if (!userOrderByCols.includes(defaultCol)) {
                    finalOrderBy.push(defaultOb);
                }
            }

            finalOrderBy = finalOrderBy.slice(0, 3);

            const payload = {
                table,
                columns: columns,
                filters: effectiveFilters,
                orderBy: finalOrderBy
            };

            const res = await apiRequest('query', {
                method: 'POST',
                body: payload
            });

            let json;
            try {
                json = await res.json();
            } catch (err) {
                throw new Error("Invalid JSON response from the server");
            }
            if (!res.ok) throw new Error(json.error || json.message || "Search failed");

            let rows = [];
            if (Array.isArray(json)) {
                rows = json;
            } else {
                rows = json.rows || json.result || json.data || json.results || json.payload || [];
            }

            if ((!rows || rows.length === 0) && (typeof json.value === "number" || typeof json.total === "number")) {
                rows = [{ value: json.value ?? json.total }];
            }

            setResults(rows || []);

        } catch (err) {
            setError(err.message || "Search failed");
            setResults([]);
        } finally {
            setLoading(false);
        }
    }

    const headerCols = useMemo(() => {
        const available = columns.slice();
        const filterCols = filters.map((f) => f.column).filter(Boolean);
        let next = displayCols && displayCols.length ? displayCols.slice() : available.slice();
        next = available.filter((c) => next.includes(c));
        filterCols.forEach((fc) => {
            if (!next.includes(fc)) next.unshift(fc);
            else {
                next = next.filter((c) => c !== fc);
                next.unshift(fc);
            }
        });
        return next;
    }, [columns, displayCols, filters]);

    const visibleResults = useMemo(() => {
        if (!results.length) return [];
        if (rowsPerPage === 0) return results.slice();
        const start = (page - 1) * rowsPerPage;
        return results.slice(start, start + rowsPerPage);
    }, [results, page, rowsPerPage]);

    function renderCell(val, colMeta, columnName, rowData) {
        if (val === null || val === undefined) return "";

        // Foreign key button
        if (colMeta?.isForeignKey && colMeta?.referencedTable && colMeta?.referencedColumn) {
            const referencedPkColumn = colMeta.referencedColumn;
            const hasPermission = allowedPermissions.includes(
                normalizeTableNameToPermissionKey(colMeta.referencedTable)
            );

            return (
                <button
                    className="fk-link-button"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!hasPermission) return;
                        setFkPopup({
                            table: colMeta.referencedTable,
                            pkColumn: referencedPkColumn,
                            pkValue: val
                        });
                    }}
                    title={
                        hasPermission
                            ? `View/Edit ${colMeta.referencedTable} record`
                            : `View ${colMeta.referencedTable} record (no edit permission)`
                    }
                    style={{
                        cursor: hasPermission ? 'pointer' : 'default',
                        opacity: hasPermission ? 1 : 0.6
                    }}
                >
                    {val}
                </button>
            );
        }

        // Tags
        if (tagColumns.has(columnName)) {
            let tagArray = [];
            try {
                if (Array.isArray(val)) {
                    tagArray = val;
                } else if (typeof val === 'string' && val.trim()) {
                    tagArray = val.split(',').map(t => t.trim()).filter(Boolean);
                }
            } catch (err) {
                tagArray = [];
            }

            if (tagArray.length > 0) {
                return (
                    <div className="tag-cell-display">
                        {tagArray.map((tagValue, idx) => (
                            <span key={idx} className="tag-chip-readonly" title={tagValue}>
                                {tagValue}
                            </span>
                        ))}
                    </div>
                );
            }
        }

        // Ratings
        if (ratingColumns.has(columnName)) {
            const ratingConfig = ratingColumns.get(columnName);
            const numVal = parseInt(val) || 0;
            const SHAPES = {
                star: { symbol: "★", emptySymbol: "☆", color: "#FFD700" },
                heart: { symbol: "♥", emptySymbol: "♡", color: "#FF69B4" },
                circle: { symbol: "●", emptySymbol: "○", color: "#3B82F6" },
                diamond: { symbol: "◆", emptySymbol: "◇", color: "#9333EA" },
                square: { symbol: "■", emptySymbol: "□", color: "#10B981" }
            };
            const shapeInfo = SHAPES[ratingConfig.shape] || SHAPES.star;
            const maxValue = ratingConfig.max_value || 10;

            return (
                <div className="rating-cell-display">
                    {Array.from({ length: maxValue }, (_, i) => {
                        const isFilled = (i + 1) <= numVal;
                        return (
                            <span
                                key={i}
                                className="rating-shape-readonly"
                                style={{ color: isFilled ? shapeInfo.color : '#D1D5DB' }}
                            >
                                {isFilled ? shapeInfo.symbol : shapeInfo.emptySymbol}
                            </span>
                        );
                    })}
                    <span className="rating-value-small">{numVal}/{maxValue}</span>
                </div>
            );
        }

        // Buffer/bit fields
        if (typeof val === "object" && val !== null) {
            if (val.type === "Buffer" && Array.isArray(val.data)) {
                return val.data[0] === 1 ? "Yes" : "No";
            }
            return JSON.stringify(val);
        }

        if (typeof val === "string" && val.includes('"type":"Buffer"')) {
            try {
                const parsed = JSON.parse(val);
                if (parsed?.type === "Buffer" && Array.isArray(parsed.data)) {
                    return parsed.data[0] === 1 ? "Yes" : "No";
                }
            } catch { }
        }

        const type = colMeta?.type?.toLowerCase?.();

        if (type === "date") {
            return formatDateLocal(val);
        }

        if (["datetime", "timestamp"].includes(type)) {
            if (/00:00:00(\.0+)?$/.test(val)) {
                return formatDateLocal(val);
            }
            return formatDateTimeLocal(new Date(val));
        }

        if (typeof val === "number") return formatNumber(val);

        return String(val);
    }

    function renderCellForPrint(val, colMeta, columnName, rowData) {
        if (val === null || val === undefined) return "";
        if (colMeta?.isForeignKey) return String(val);

        if (tagColumns.has(columnName)) {
            let tagArray = [];
            try {
                if (Array.isArray(val)) {
                    tagArray = val;
                } else if (typeof val === 'string' && val.trim()) {
                    tagArray = val.split(',').map(t => t.trim()).filter(Boolean);
                }
            } catch (err) {
                tagArray = [];
            }
            return tagArray.join(', ');
        }

        if (ratingColumns.has(columnName)) {
            const ratingConfig = ratingColumns.get(columnName);
            const numVal = parseInt(val) || 0;
            const maxValue = ratingConfig.max_value || 10;
            return `${numVal}/${maxValue}`;
        }

        if (typeof val === "object" && val !== null) {
            if (val.type === "Buffer" && Array.isArray(val.data)) {
                return val.data[0] === 1 ? "Yes" : "No";
            }
            return JSON.stringify(val);
        }

        if (typeof val === "string" && val.includes('"type":"Buffer"')) {
            try {
                const parsed = JSON.parse(val);
                if (parsed?.type === "Buffer" && Array.isArray(parsed.data)) {
                    return parsed.data[0] === 1 ? "Yes" : "No";
                }
            } catch { }
        }

        const type = colMeta?.type?.toLowerCase?.();

        if (type === "date") {
            return formatDateLocal(val);
        }

        if (["datetime", "timestamp"].includes(type)) {
            if (/00:00:00(\.0+)?$/.test(val)) {
                return formatDateLocal(val);
            }
            return formatDateTimeLocal(new Date(val));
        }

        if (typeof val === "number") return formatNumber(val);

        return String(val);
    }

    const totalPages = Math.max(
        1,
        Math.ceil(results.length / (rowsPerPage === 0 ? (results.length || 1) : Math.max(1, rowsPerPage)))
    );

    const startIndex = rowsPerPage === 0 ? 0 : (page - 1) * rowsPerPage;

    function onSelectRow(localIndex) {
        const globalIndex = startIndex + localIndex;
        setSelectedRow(results[globalIndex]);
        setSelectedRowGlobalIndex(globalIndex);
    }

    function onRightClickRow(e, localIndex) {
        e.preventDefault();
        onSelectRow(localIndex);
        setContextMenu({
            x: e.clientX,
            y: e.clientY - 67,
        });
    }

    async function goToUpdate() {
        if (!selectedRow) return;

        navigate("/update", {
            state: {
                table,
                record: selectedRow,
                columnsMeta,
                reason: "update",
                entityMetadata // Include full metadata for multi-table views
            }
        });
    }

    async function goToDuplicate() {
        if (!selectedRow) return;

        const uniqueCols = columnsMeta
            .filter(c => c.isPrimaryKey || c.isUnique || c.key === "PRI" || c.key === "UNI")
            .map(c => c.name);

        const cloneRecord = Object.fromEntries(
            Object.entries(selectedRow).filter(([key]) => !uniqueCols.includes(key))
        );

        navigate("/insert", {
            state: {
                table,
                record: cloneRecord,
                columnsMeta,
                reason: "insert",
                entityMetadata
            },
        });
    }

    async function handleCellCommit(globalIndex, col, newRawValue) {
        try {
            const row = results[globalIndex];
            if (!row) {
                setError("Row not found for editing");
                return;
            }

            // Determine which table this column belongs to (for views)
            let targetTable = table;
            let pkColumn = getPrimaryKeyColumn();

            if (isMultiTableView && entityMetadata?.columnTableMap) {
                // For multi-table views, route to the correct base table
                targetTable = entityMetadata.columnTableMap[col] || table;
            }

            if (!pkColumn) {
                setError("Primary key column not determined");
                return;
            }

            const pkValue = row[pkColumn];
            if (pkValue === undefined || pkValue === null) {
                setError("Primary key value missing for this row");
                return;
            }

            const currentVal = row[col];
            if (String(currentVal) === String(newRawValue)) {
                return; // No change
            }

            const payload = {
                table: targetTable, // Use the base table for views
                pkColumn,
                pkValue,
                data: { [col]: newRawValue },
            };

            const res = await apiRequest('update', {
                method: 'POST',
                body: payload
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

            // Refresh search to get updated data
            await runSearch();
            setError(null);

        } catch (err) {
            setError(err.message || "Failed to save cell");
        }
    }

    return (
        <div className={showPanel ? "search-page" : "search-page-just-results"}>
            {!showAdvanced && (<>
                {showPanel && <div className="search-panel">
                    <h2>Search</h2>

                    <div className="control-grid">
                        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                            <label>Table</label>
                            <Dropdown
                                options={tables.filter(t => !excludedTables.includes(t))}
                                value={table}
                                onChange={(val) => {
                                    const normalized = String(val).toLowerCase().replace(/[-\s]/g, "_");
                                    if (!allowedPermissions.includes(normalized)) {
                                        setError("You do not have permission to access that table.");
                                        return;
                                    }
                                    setError("");
                                    setTable(val);
                                    setFilters([]);
                                    setDisplayCols([]);
                                    setOrderBy1("");
                                    setOrderBy2("");
                                    setOrderBy3("");
                                    setResults([]);
                                    setPage(1);
                                    setSelectedRow(null);
                                    setSelectedRowGlobalIndex(null);
                                }}
                                placeholder="Select table..."
                            />
                        </div>

                        {error && <div className="error-note">{String(error)}</div>}
                    </div>

                    <div className="filter-row filter-search" style={{ marginTop: "16px" }}>
                        <button className="btn" onClick={runSearch} disabled={loading}>
                            {loading ? "Searching..." : "Search"}
                        </button>
                        <button
                            className="btn"
                            onClick={() => {
                                setResults([]);
                                setError(null);
                                setPage(1);
                                setSelectedRow(null);
                                setSelectedRowGlobalIndex(null);
                            }}
                        >
                            Clear
                        </button>
                    </div>

                    <button className="btn" style={{ marginTop: "8px" }} onClick={handlePrint}>
                        Print Results
                    </button>

                    {isMultiTableView && (
                        <div className="info-note" style={{ marginTop: "8px", fontSize: "0.9em", color: "#666" }}>
                            ℹ️ Multi-table view detected. Updates will route to base tables automatically.
                        </div>
                    )}
                </div>}

                <div className="results-panel">
                    <div className="results-header">
                        <h3>Results</h3>

                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <button
                                className="btn"
                                onClick={() => setShowPanel((s) => !s)}
                                title={showPanel ? "Hide search panel" : "Show search panel"}
                            >
                                {showPanel ? "Hide Search Panel" : "Show Search Panel"}
                            </button>

                            <button
                                className="btn"
                                style={{ marginRight: 8 }}
                                onClick={() => setShowAdvanced(true)}
                            >
                                Advanced Search
                            </button>

                            {allowedPermissions.includes('edit_mode') && (
                                <button
                                    className="btn"
                                    onClick={() => setEditMode((s) => !s)}
                                    title={editMode ? "Enter View Mode" : "Enter Edit Mode (inline editing)"}
                                >
                                    {editMode ? "Edit Mode" : "View Mode"}
                                </button>
                            )}

                            <div className="paging-controls static" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <button
                                    className="btn"
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    disabled={results.length === 0 || page <= 1}
                                >
                                    Prev
                                </button>
                                <span>
                                    Page{" "}
                                    <input
                                        className="small-textbox"
                                        type="text"
                                        inputMode="numeric"
                                        min="1"
                                        max={totalPages}
                                        value={page}
                                        onChange={(e) => {
                                            const v = Number(e.target.value || 1);
                                            if (v < 1) setPage(1);
                                            else if (v > totalPages) setPage(totalPages);
                                            else setPage(v);
                                        }}
                                    />{" "}
                                    of {totalPages}
                                </span>
                                <button
                                    className="btn"
                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={results.length === 0 || page >= totalPages}
                                >
                                    Next
                                </button>
                            </div>

                            <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
                                <button
                                    className="btn"
                                    onClick={goToUpdate}
                                    disabled={!selectedRow}
                                    title={selectedRow ? "Update selected record" : "Select a row to update"}
                                >
                                    Update
                                </button>
                                <button
                                    className="btn"
                                    onClick={goToDuplicate}
                                    disabled={!selectedRow}
                                    title={selectedRow ? "Duplicate selected record" : "Select a row to duplicate"}
                                >
                                    Duplicate
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="results-table-wrap scrollable" role="region" aria-label="Results table">
                        {contextMenu && (
                            <div
                                className="context-menu"
                                style={{
                                    '--context-menu-x': `${contextMenu.x}px`,
                                    '--context-menu-y': `${contextMenu.y}px`
                                }}
                            >
                                <button className="context-menu-item" onClick={() => { goToUpdate(); setContextMenu(null); }}>
                                    Update
                                </button>
                                <button className="context-menu-item" onClick={() => { goToDuplicate(); setContextMenu(null); }}>
                                    Duplicate
                                </button>
                            </div>
                        )}

                        <table className="results-table">
                            <thead>
                                <tr>
                                    {headerCols.map((hc, ci) => {
                                        let arrow = "";
                                        if (typeof orderBy1 === "string") {
                                            const [col, dir] = orderBy1.split(/\s+/);
                                            if (col === hc) {
                                                arrow = dir?.toUpperCase() === "DESC" ? " ▼" : " ▲";
                                            }
                                        }

                                        return (
                                            <th
                                                key={ci}
                                                className={ci === 0 ? "sticky-col sticky-col-header sortable" : "sortable"}
                                                scope="col"
                                                title={`Sort by ${hc}`}
                                                onClick={() => handleHeaderClick(hc)}
                                                onContextMenu={(e) => handleHeaderRightClick(e, hc)}
                                                style={{ cursor: "pointer", userSelect: "none" }}
                                            >
                                                {String(hc)}
                                                {arrow && <span style={{ marginLeft: 4 }}>{arrow}</span>}
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>

                            <tbody>
                                {visibleResults.length === 0 && (
                                    <tr>
                                        <td colSpan={Math.max(1, headerCols.length)} className="no-results">
                                            No results
                                        </td>
                                    </tr>
                                )}

                                {visibleResults.map((row, localRi) => {
                                    const globalIndex = startIndex + localRi;
                                    const isSelected = selectedRowGlobalIndex === globalIndex;

                                    return (
                                        <tr
                                            key={globalIndex}
                                            onClick={() => onSelectRow(localRi)}
                                            onDoubleClick={() => {
                                                onSelectRow(localRi);
                                                if (!editMode) goToUpdate();
                                            }}
                                            onContextMenu={(e) => onRightClickRow(e, localRi)}
                                            className={isSelected ? "selected-row" : ""}
                                            style={{ cursor: "pointer" }}
                                        >
                                            {headerCols.map((col, ci) => {
                                                const val = row[col];
                                                const colMeta = columnsMeta.find(c => c.name === col);
                                                const display = renderCell(val, colMeta, col);
                                                const pkColumn = getPrimaryKeyColumn();
                                                const isPK = pkColumn === col;

                                                if (editMode && !isPK) {
                                                    const meta = columnsMeta.find(c => c.name === col);
                                                    const type = meta?.type?.toLowerCase() || "";

                                                    if (tagColumns.has(col)) {
                                                        let tagArray = [];
                                                        try {
                                                            if (Array.isArray(val)) {
                                                                tagArray = val;
                                                            } else if (typeof val === 'string' && val.trim()) {
                                                                tagArray = val.split(',').map(t => t.trim()).filter(Boolean);
                                                            }
                                                        } catch (err) {
                                                            tagArray = [];
                                                        }

                                                        return (
                                                            <td key={col} className={ci === 0 ? "sticky-col" : ""}>
                                                                <div className="edit-cell-tag-wrapper">
                                                                    <TagManager
                                                                        table={table}
                                                                        column={col}
                                                                        value={tagArray}
                                                                        onChange={(tags) => {
                                                                            const tagString = tags.length > 0 ? tags.join(', ') : '';
                                                                            handleCellCommit(globalIndex, col, tagString);
                                                                        }}
                                                                        required={false}
                                                                        readOnly={false}
                                                                    />
                                                                </div>
                                                            </td>
                                                        );
                                                    }

                                                    let inputType = "text";
                                                    switch (type) {
                                                        case "integer":
                                                        case "number":
                                                        case "float":
                                                        case "double":
                                                        case "decimal":
                                                            inputType = "number";
                                                            break;
                                                        case "date":
                                                            inputType = "date";
                                                            break;
                                                        case "datetime":
                                                        case "timestamp":
                                                            inputType = "datetime-local";
                                                            break;
                                                        case "boolean":
                                                        case "bit":
                                                        case "bool":
                                                            inputType = "checkbox";
                                                            break;
                                                        case "email":
                                                            inputType = "email";
                                                            break;
                                                        case "password":
                                                            inputType = "password";
                                                            break;
                                                        default:
                                                            inputType = "text";
                                                            break;
                                                    }

                                                    return (
                                                        <td key={col} className={ci === 0 ? "sticky-col" : ""}>
                                                            {inputType === "checkbox" ? (
                                                                <label className="col-checkbox checkbox-item">
                                                                    <input
                                                                        type="checkbox"
                                                                        defaultChecked={display === "Yes"}
                                                                        onChange={(e) => handleCellCommit(globalIndex, col, e.target.checked)}
                                                                    />
                                                                </label>
                                                            ) : (
                                                                <input
                                                                    className="edit-cell-input"
                                                                    type={inputType}
                                                                    defaultValue={
                                                                        inputType === "date"
                                                                            ? (() => {
                                                                                if (!val) return "";
                                                                                const d = new Date(val);
                                                                                return !isNaN(d) ? d.toISOString().split("T")[0] : "";
                                                                            })()
                                                                            : inputType === "datetime-local"
                                                                                ? (() => {
                                                                                    if (!val) return "";
                                                                                    const d = new Date(val);
                                                                                    if (isNaN(d)) return "";
                                                                                    return formatDateTimeLocal(d);
                                                                                })()
                                                                                : val ?? ""
                                                                    }
                                                                    onBlur={(e) => handleCellCommit(globalIndex, col, e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === "Enter") {
                                                                            e.preventDefault();
                                                                            e.target.blur();
                                                                        }
                                                                        if (e.key === "Escape") {
                                                                            e.target.value = val ?? "";
                                                                            e.target.blur();
                                                                        }
                                                                    }}
                                                                />
                                                            )}
                                                        </td>
                                                    );
                                                }

                                                if (editMode && isPK) {
                                                    return (
                                                        <td key={col} className={ci === 0 ? "sticky-col" : ""} title={`${display} (primary key - not editable)`}>
                                                            {renderCell(val, colMeta, col, row)}
                                                        </td>
                                                    );
                                                }

                                                return (
                                                    <td key={col} className={ci === 0 ? "sticky-col" : ""} title={typeof display === 'string' ? display : ''}>
                                                        {renderCell(val, colMeta, col, row)}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </>)}

            {showAdvanced && (
                <div className="modal-overlay" onClick={() => setShowAdvanced(false)}>
                    <div className="advanced-popup" onClick={(e) => e.stopPropagation()}>
                        <div className="advanced-popup-header">
                            <h3>Advanced Search Options</h3>
                            <button className="advanced-popup-close" onClick={() => setShowAdvanced(false)}>✕</button>
                        </div>

                        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            Show
                            <input
                                className="small-textbox"
                                type="text"
                                inputMode="numeric"
                                min="0"
                                step="1"
                                value={rowsPerPage}
                                onChange={(e) => {
                                    const v = Number(e.target.value);
                                    if (Number.isNaN(v) || v < 0) return;
                                    setRowsPerPage(v);
                                    setPage(1);
                                }}
                                title="Number of items per page (0 means show all)"
                            />
                            rows per page
                        </label>

                        {columns.length > 0 && <>
                            <section>
                                <label className="control-label">Columns</label>
                                <div className="cols-list scrollable">
                                    {columns.map((c) => (
                                        <label key={c} className="col-checkbox perm-item">
                                            <input
                                                type="checkbox"
                                                checked={displayCols.includes(c)}
                                                onChange={() => toggleColumn(c)}
                                            />
                                            {c}
                                        </label>
                                    ))}
                                </div>
                                <div className="filter-row">
                                    <button className="btn" onClick={() => setDisplayCols(columns.slice())}>Show all</button>
                                    <button
                                        className="btn"
                                        onClick={() => {
                                            setResults([]);
                                            setError(null);
                                            setPage(1);
                                            setSelectedRow(null);
                                            setSelectedRowGlobalIndex(null);
                                            setTable("");
                                            setDisplayCols([]);
                                            setFilters([]);
                                            Cookies.remove(SEARCH_STATE_KEY);
                                        }}
                                    >
                                        Clear
                                    </button>
                                </div>
                            </section>

                            <section>
                                <label className="control-label">Filters</label>
                                {filters.length > 0 && <div className="advanced-filters-scroll">
                                    {filters.map((f, i) => (
                                        <MemoFilterRow
                                            key={i}
                                            index={i}
                                            filter={f}
                                            columns={columns}
                                            columnsMeta={columnsMeta}
                                            onChange={updateFilter}
                                            onRemove={removeFilter}
                                        />
                                    ))}
                                </div>}
                                <div className="filter-row">
                                    <button className="btn" onClick={addFilter}>+ Add filter</button>
                                </div>
                            </section>

                            <div style={{ marginTop: "8px", marginBottom: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                                <label>Secondary Sorting</label>
                                <Dropdown
                                    options={["", ...columns.filter(c => {
                                        const ob1Col = orderBy1 ? (orderBy1.match(/^(.+?)\s+(ASC|DESC)$/i)?.[1] || orderBy1).trim() : null;
                                        const ob3Col = orderBy3 ? (orderBy3.match(/^(.+?)\s+(ASC|DESC)$/i)?.[1] || orderBy3).trim() : null;
                                        return c !== ob1Col && c !== ob3Col;
                                    })]}
                                    value={orderBy2}
                                    onChange={(val) => setOrderBy2(val)}
                                    placeholder="Select column..."
                                />
                            </div>

                            <div style={{ marginTop: "8px", marginBottom: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                                <label>Tertiary Sorting</label>
                                <Dropdown
                                    options={["", ...columns.filter(c => {
                                        const ob1Col = orderBy1 ? (orderBy1.match(/^(.+?)\s+(ASC|DESC)$/i)?.[1] || orderBy1).trim() : null;
                                        const ob2Col = orderBy2 ? (orderBy2.match(/^(.+?)\s+(ASC|DESC)$/i)?.[1] || orderBy2).trim() : null;
                                        return c !== ob1Col && c !== ob2Col;
                                    })]}
                                    value={orderBy3}
                                    onChange={(val) => setOrderBy3(val)}
                                    placeholder="Select column..."
                                />
                            </div>
                        </>}
                    </div>
                </div>
            )}

            {fkPopup && (
                <ForeignKeyPopup
                    table={fkPopup.table}
                    pkColumn={fkPopup.pkColumn}
                    pkValue={fkPopup.pkValue}
                    onClose={() => setFkPopup(null)}
                    onSuccess={(msg) => {
                        runSearch();
                    }}
                />
            )}
        </div>
    );
}