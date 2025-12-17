// ViewsOverlay.js
import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Dropdown from "./Dropdown";
import { FilterRow } from "./FilterRow";
import "../styles/InsertPage.css";
import "../styles/ViewsOverlay.css";
import "../styles/ManageUsersPage.css";

function ViewsOverlay({ isOpen, onClose, api, excludedViews, userHasPermission, username, onPermissionsRefresh }) {
    const [views, setViews] = useState([]);
    const [baseTables, setBaseTables] = useState([]);
    const [columnsMeta, setColumnsMeta] = useState({});
    const [loadingColumns, setLoadingColumns] = useState(false);
    const [mode, setMode] = useState("create");
    const [form, setForm] = useState({
        oldViewName: "",
        newViewName: "",
        baseTable: "",
        columns: [],
        filters: [],
    });

    // Load list of views when overlay opens
    useEffect(() => {
        if (isOpen) {
            api.listViews().then((list) => {
                // Filter by excluded views AND user permissions
                const filtered = list.rows.filter(r => {
                    // Exclude system views
                    if (excludedViews.includes(r.name)) return false;

                    // Check user permission (column name is lowercase view name)
                    const permissionKey = r.name.toLowerCase();

                    // If userHasPermission is a boolean, use it directly
                    // If it's an object with permission keys, check the specific permission
                    if (typeof userHasPermission === 'boolean') {
                        return userHasPermission;
                    } else if (typeof userHasPermission === 'object') {
                        // Check if user has permission for this specific view
                        return userHasPermission[permissionKey] === 1;
                    }

                    return false;
                });

                setViews(filtered);
            });

            api.loadBaseTables().then((tbls) => {
                setBaseTables(tbls);
            });
        }
    }, [isOpen, api, excludedViews, userHasPermission]);

    // When baseTable changes, load its columns meta (if not loaded)
    useEffect(() => {
        const tbl = form.baseTable;
        if (tbl && !columnsMeta[tbl] && !loadingColumns) {
            setLoadingColumns(true);
            api.loadColumnsMeta(tbl)
                .then(meta => {
                    // Ensure meta is an array
                    if (Array.isArray(meta)) {
                        setColumnsMeta(prev => ({ ...prev, [tbl]: meta }));
                    } else {
                        console.error(`Expected array for columns of ${tbl}, got:`, meta);
                        setColumnsMeta(prev => ({ ...prev, [tbl]: [] }));
                    }
                })
                .catch(err => {
                    console.error(`Failed to load columns for ${tbl}:`, err);
                    setColumnsMeta(prev => ({ ...prev, [tbl]: [] }));
                })
                .finally(() => {
                    setLoadingColumns(false);
                });
        }
    }, [form.baseTable, api, columnsMeta, loadingColumns]);

    const resetForm = () => {
        setForm({
            oldViewName: "",
            newViewName: "",
            baseTable: "",
            columns: [],
            filters: []
        });
        setMode("create");
        setLoadingColumns(false);
        setColumnsMeta({});
    };

    const handleOpenEdit = async (view) => {
        setMode("edit");

        const baseTable = view.base_table || "";
        const columns = Array.isArray(view.columns) ? view.columns : [];
        const filters = Array.isArray(view.filters) ? view.filters : [];

        setForm({
            oldViewName: view.name,
            newViewName: view.name,
            baseTable: baseTable,
            columns: columns,
            filters: filters,
        });

        // If we have a base table but no columns meta yet, pre-fetch it
        if (baseTable && !columnsMeta[baseTable]) {
            setLoadingColumns(true);
            try {
                const meta = await api.loadColumnsMeta(baseTable);
                if (Array.isArray(meta)) {
                    setColumnsMeta(prev => ({ ...prev, [baseTable]: meta }));
                } else {
                    console.error(`Expected array for columns of ${baseTable}, got:`, meta);
                    setColumnsMeta(prev => ({ ...prev, [baseTable]: [] }));
                }
            } catch (err) {
                console.error(`Failed to load columns for ${baseTable}:`, err);
                setColumnsMeta(prev => ({ ...prev, [baseTable]: [] }));
            } finally {
                setLoadingColumns(false);
            }
        }
    };

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    const addFilter = () => {
        setForm(prev => ({
            ...prev,
            filters: [...prev.filters, { column: "", operator: "=", value: "" }]
        }));
    };

    const updateFilter = (index, updatedFilter) => {
        setForm(prev => ({
            ...prev,
            filters: prev.filters.map((f, i) => i === index ? updatedFilter : f)
        }));
    };

    const removeFilter = (index) => {
        setForm(prev => ({
            ...prev,
            filters: prev.filters.filter((_, i) => i !== index)
        }));
    };

    const toggleColumn = (col) => {
        setForm(prev => {
            const cols = prev.columns.includes(col)
                ? prev.columns.filter(c => c !== col)
                : [...prev.columns, col];
            return { ...prev, columns: cols };
        });
    };

    const handleSubmit = async () => {
        try {
            if (mode === "create") {
                const resp = await api.createView({
                    baseTable: form.baseTable,
                    columns: form.columns,
                    viewName: form.newViewName,
                    filters: form.filters,
                });
            } else if (mode === "edit") {
                await api.updateView({
                    oldViewName: form.oldViewName,
                    newViewName: form.newViewName,
                    baseTable: form.baseTable,
                    columns: form.columns,
                    filters: form.filters,
                });
            }

            // Refresh permissions if callback provided
            if (username && api.refreshPermissions && onPermissionsRefresh) {
                try {
                    // Small delay to ensure DB transaction is fully committed
                    await new Promise(resolve => setTimeout(resolve, 100));

                    const result = await api.refreshPermissions(username);
                    if (result.success && result.permissions) {
                        onPermissionsRefresh(result.permissions);
                    }
                } catch (permErr) {
                    console.warn("Failed to refresh permissions:", permErr);
                }
            }

            // Refresh list
            const list = await api.listViews();
            const filtered = list.rows.filter(r => {
                if (excludedViews.includes(r.name)) return false;
                const permissionKey = r.name.toLowerCase();
                if (typeof userHasPermission === 'boolean') {
                    return userHasPermission;
                } else if (typeof userHasPermission === 'object') {
                    return userHasPermission[permissionKey] === 1;
                }
                return false;
            });
            setViews(filtered);
            resetForm();
        } catch (err) {
            console.error("ViewsOverlay submit error:", err);
            alert("Error: " + (err.message || JSON.stringify(err)));
        }
    };

    const handleDelete = async () => {
        if (mode !== "edit") return;
        const confirmed = window.confirm(
            `Are you sure you want to delete the view "${form.oldViewName}"? This will also remove its Employees column.`
        );
        if (!confirmed) return;

        try {
            const deletedViewName = form.oldViewName;
            await api.deleteView({ viewName: deletedViewName });
            console.log("Deleted view:", deletedViewName);

            // Handle permission updates differently for delete
            if (username && onPermissionsRefresh) {
                // For delete, we need to REMOVE the permission, not refresh all
                // Get the permission key (lowercase view name)
                const deletedPermissionKey = deletedViewName.toLowerCase();

                if (api.refreshPermissions) {
                    try {
                        // Small delay to ensure DB transaction is complete
                        await new Promise(resolve => setTimeout(resolve, 100));

                        const result = await api.refreshPermissions(username);
                        if (result.success && result.permissions) {
                            // The deleted view column won't be in the response anymore
                            // so this should be safe
                            onPermissionsRefresh(result.permissions);
                        }
                    } catch (permErr) {
                        console.warn("Failed to refresh permissions:", permErr);
                        // Fallback: manually remove the deleted permission
                        const existingPermissions = JSON.parse(localStorage.getItem("allowedPermissions") || "{}");
                        delete existingPermissions[deletedPermissionKey];
                        localStorage.setItem("allowedPermissions", JSON.stringify(existingPermissions));
                    }
                } else {
                    // No refresh API available, manually remove permission
                    const existingPermissions = JSON.parse(localStorage.getItem("allowedPermissions") || "{}");
                    delete existingPermissions[deletedPermissionKey];
                    localStorage.setItem("allowedPermissions", JSON.stringify(existingPermissions));
                }
            }

            // Refresh view list
            const list = await api.listViews();
            const filtered = list.rows.filter(r => {
                if (excludedViews.includes(r.name)) return false;
                const permissionKey = r.name.toLowerCase();
                if (typeof userHasPermission === 'boolean') {
                    return userHasPermission;
                } else if (typeof userHasPermission === 'object') {
                    return userHasPermission[permissionKey] === 1;
                }
                return false;
            });
            setViews(filtered);
            resetForm();
        } catch (err) {
            console.error("ViewsOverlay delete error:", err);
            alert("Error deleting view: " + (err.message || JSON.stringify(err)));
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="modal-overlay" onClick={onClose} />
            <div className="views-overlay-modal" onClick={e => e.stopPropagation()}>
                <div className="views-overlay-header">
                    <h2>{mode === "create" ? "Create New View" : `Edit View: ${form.oldViewName}`}</h2>
                    <button onClick={onClose} className="btn close-btn">×</button>
                </div>

                <div className="views-overlay-content">
                    {/* List of existing views */}
                    <div className="views-section">
                        <h3>Existing Views</h3>
                        <div className="views-list">
                            {views.length > 0 ? (
                                views.map((v) => (
                                    <button
                                        key={v.name}
                                        className="btn view-item-btn"
                                        type="button"
                                        onClick={() => handleOpenEdit(v)}
                                    >
                                        {v.name}
                                    </button>
                                ))
                            ) : (
                                <p className="muted">No views available</p>
                            )}
                        </div>
                    </div>

                    <div className="divider" />

                    {/* Form */}
                    <div className="form-section">
                        <div className="control">
                            <label className="control-label">
                                Base Table
                            </label>
                            <Dropdown
                                options={baseTables}
                                value={form.baseTable}
                                onChange={(val) => handleChange("baseTable", val)}
                                placeholder="Select a table..."
                                disabled={mode === "edit"}
                            />
                        </div>

                        <div className="control">
                            <label className="control-label">
                                View Name
                            </label>
                            <input
                                className="field-input"
                                type="text"
                                value={form.newViewName}
                                onChange={(e) => handleChange("newViewName", e.target.value)}
                                placeholder="Enter view name..."
                            />
                        </div>

                        {form.baseTable && (
                            <div className="control">
                                <label className="control-label">
                                    Select Columns
                                </label>
                                {loadingColumns ? (
                                    <div className="info-note">Loading columns...</div>
                                ) : columnsMeta[form.baseTable] && Array.isArray(columnsMeta[form.baseTable]) && columnsMeta[form.baseTable].length > 0 ? (
                                    <div className="columns-selector">
                                        {columnsMeta[form.baseTable].map((col) => (
                                            <label key={col.name} className="perm-item">
                                                <input
                                                    type="checkbox"
                                                    checked={form.columns.includes(col.name)}
                                                    onChange={() => toggleColumn(col.name)}
                                                // className="field-checkbox"
                                                />
                                                <span>{col.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="info-note">
                                        No columns available or failed to load columns for this table.
                                    </div>
                                )}
                            </div>
                        )}

                        {form.baseTable && columnsMeta[form.baseTable] && (
                            <div className="control">
                                <label className="control-label">
                                    Filters (Optional)
                                </label>
                                <div className="filters-section">
                                    {form.filters.map((filter, index) => (
                                        <FilterRow
                                            key={index}
                                            index={index}
                                            filter={filter}
                                            columns={columnsMeta[form.baseTable].map(c => c.name)}
                                            columnsMeta={columnsMeta[form.baseTable]}
                                            onChange={updateFilter}
                                            onRemove={removeFilter}
                                        />
                                    ))}
                                    <button
                                        type="button"
                                        className="btn btn-ghost"
                                        onClick={addFilter}
                                        style={{ marginTop: "8px" }}
                                    >
                                        + Add Filter
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="modal-actions">
                        {mode === "edit" && (
                            <button className="btn btn-delete" type="button" onClick={handleDelete}>
                                Delete View
                            </button>
                        )}
                        <button className="btn" type="button" onClick={resetForm}>
                            {mode === "edit" ? "Cancel" : "Reset"}
                        </button>
                        <button
                            className="btn btn-primary"
                            type="button"
                            onClick={handleSubmit}
                            disabled={!form.baseTable || form.columns.length === 0 || !form.newViewName}
                        >
                            {mode === "create" ? "Create View" : "Update View"}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

ViewsOverlay.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    api: PropTypes.shape({
        listViews: PropTypes.func.isRequired,
        createView: PropTypes.func.isRequired,
        updateView: PropTypes.func.isRequired,
        deleteView: PropTypes.func.isRequired,
        loadTables: PropTypes.func.isRequired,
        loadBaseTables: PropTypes.func.isRequired,
        loadColumnsMeta: PropTypes.func.isRequired,
        refreshPermissions: PropTypes.func,
    }).isRequired,
    excludedViews: PropTypes.arrayOf(PropTypes.string),
    userHasPermission: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.object
    ]).isRequired,
    username: PropTypes.string,
    onPermissionsRefresh: PropTypes.func,
};

ViewsOverlay.defaultProps = {
    excludedViews: [],
    username: null,
    onPermissionsRefresh: null,
};

export default ViewsOverlay;