// src/pages/HomePage.js
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import DashboardCard from "../components/DashboardCard";
import dashboardsConfig from "../config/dashboardsConfig";
import { saveDashboardView, loadDashboardView } from "../lib/storage.js";
import GridLayout from "react-grid-layout";
import { ReportSelector } from "../components/reports/ReportSelector.js";
import { apiRequest } from '../lib/api';
import { hasAccessToEntity, normalizePermissionsArray } from '../lib/permissions';
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "../styles/HomePage.css";
import "../styles/DashboardGrid.css";

/**
 * HomePage: Manages available tables, dashboard catalog, and the user canvas (grid).
 *
 * Behavior:
 * - Loads available tables from /api/tables (filtered by allowedPermissions saved in localStorage)
 * - Right-side panel togglable to pick tables & add dashboards
 * - Uses react-grid-layout to place widgets. Layout + widget params persist to cookie.
 * - On load, re-validates saved dashboards for permission changes and drops any disallowed ones.
 */

/**
 * Helper function to convert pixel dimensions to grid units
 */
function pixelsToGridUnits({ widthPx, heightPx, gridWidthPx, cols, margin, rowHeight }) {
    // Calculate actual column width (accounting for margins between columns)
    const totalMarginWidth = margin[0] * (cols - 1);
    const colWidth = (gridWidthPx - totalMarginWidth) / cols;

    // Convert pixels to grid units, ensuring minimum of 1
    const w = Math.max(1, Math.round(widthPx / (colWidth + margin[0])));
    const h = Math.max(1, Math.round(heightPx / (rowHeight + margin[1])));

    return { w, h };
}

/**
 * Helper function to convert grid units to pixel dimensions
 */
function gridUnitsToPixels({ w, h, gridWidthPx, cols, margin, rowHeight }) {
    // Calculate actual column width
    const totalMarginWidth = margin[0] * (cols - 1);
    const colWidth = (gridWidthPx - totalMarginWidth) / cols;

    // Convert grid units to pixels (margins are between items, not around them)
    const widthPx = w * colWidth + (w - 1) * margin[0];
    const heightPx = h * rowHeight + (h - 1) * margin[1];

    return { widthPx, heightPx };
}

export default function HomePage() {
    const [availableTables, setAvailableTables] = useState([]);
    const [selectedTables, setSelectedTables] = useState([]);
    const [allowedPermissions, setAllowedPermissions] = useState({});
    const [viewBaseTableMap, setViewBaseTableMap] = useState({});
    const [error, setError] = useState("");
    const [panelOpen, setPanelOpen] = useState(true);
    const [showSelector, setShowSelector] = useState(false);
    const [gridWidth, setGridWidth] = useState(1200);
    const gridContainerRef = useRef(null);

    // Canvas state: widgetInstances = [{ id, dashId, layout:{x,y,w,h,i}, params }]
    const [widgetInstances, setWidgetInstances] = useState([]);

    // Grid settings
    const GRID_COLS = 30;
    const GRID_ROW_HEIGHT = 30;
    const GRID_MARGIN = [6, 6];

    // Computed grid configuration based on current width
    const GRID_CONFIG = useMemo(() => ({
        gridWidthPx: gridWidth,
        cols: GRID_COLS,
        margin: GRID_MARGIN,
        rowHeight: GRID_ROW_HEIGHT,
    }), [gridWidth]);

    // Update grid width based on container size
    useEffect(() => {
        const updateGridWidth = () => {
            if (gridContainerRef.current) {
                const width = gridContainerRef.current.offsetWidth;
                setGridWidth(width);
            }
        };

        updateGridWidth();
        window.addEventListener('resize', updateGridWidth);
        return () => window.removeEventListener('resize', updateGridWidth);
    }, []);

    /**
     * Normalize table name to permission key
     */
    function normalizeTableNameToPermissionKey(name) {
        return String(name).toLowerCase().replace(/[-\s]/g, "_");
    }

    /**
     * Load allowedPermissions (saved on login) from localStorage
     */
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

    /**
     * Load view-to-base-table mapping
     */
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

    /**
     * Fetch DB tables (filter by allowedPermissions using new permission system)
     */
    useEffect(() => {
        async function loadTables() {
            try {
                const res = await apiRequest("tables");
                if (!res.ok) throw new Error("tables fetch failed");
                const tables = await res.json();

                // Filter tables using new permission system
                const filtered = Array.isArray(tables)
                    ? tables.filter((t) => hasAccessToEntity(t, allowedPermissions, viewBaseTableMap))
                    : [];
                setAvailableTables(filtered);
            } catch (e) {
                console.error("Failed to load tables", e);
                setError("Failed to load database tables. Is the API server running?");
            }
        }

        // Only load tables after permissions and view mapping are loaded
        if (Object.keys(allowedPermissions).length > 0) {
            loadTables();
        }
    }, [allowedPermissions, viewBaseTableMap]);

    /**
     * Load saved view from cookie and validate permissions
     */
    useEffect(() => {
        const saved = loadDashboardView();
        if (!saved || !Array.isArray(saved.widgetInstances)) {
            setWidgetInstances([]);
            return;
        }

        // Validate each saved instance: dashboard exists and user has table permissions
        const validated = [];
        for (const wi of saved.widgetInstances) {
            const dash = dashboardsConfig.find((d) => d.id === wi.dashId);
            if (!dash) continue;
            const requiredOk = (dash.tables || []).every((tbl) =>
                hasAccessToEntity(tbl, allowedPermissions, viewBaseTableMap)
            );
            if (!requiredOk) continue;

            // Validate and correct layout dimensions
            let layout = { ...wi.layout };

            // Calculate minimum grid units
            const minWidthPx = dash.minWidth || 200;
            const minHeightPx = dash.minHeight || 150;

            const minW = pixelsToGridUnits({
                widthPx: minWidthPx,
                heightPx: 100,
                ...GRID_CONFIG
            }).w;

            const minH = pixelsToGridUnits({
                widthPx: 100,
                heightPx: minHeightPx,
                ...GRID_CONFIG
            }).h;

            // Enforce minimums
            layout.w = Math.max(layout.w || minW, minW);
            layout.h = Math.max(layout.h || minH, minH);
            layout.minW = minW;
            layout.minH = minH;

            // Enforce aspect ratio if locked
            if (dash.lockAspectRatio && dash.aspectRatio) {
                const targetH = Math.round(layout.w / dash.aspectRatio);
                layout.h = Math.max(targetH, minH);

                // Re-check width if height was constrained
                if (targetH < minH) {
                    layout.w = Math.max(Math.round(layout.h * dash.aspectRatio), minW);
                }
            }

            // merge dash defaults with saved params
            const merged = {
                ...wi,
                layout,
                params: {
                    ...(dash.params ? Object.fromEntries(Object.entries(dash.params).map(([k, v]) => [k, v.default])) : {}),
                    ...(wi.params || {})
                },
                resizeConstraints: {
                    minWidth: minWidthPx,
                    minHeight: minHeightPx,
                    aspectRatio: dash.aspectRatio || null,
                    lockAspectRatio: dash.lockAspectRatio || false
                }
            };
            validated.push(merged);
        }
        setWidgetInstances(validated);
    }, [allowedPermissions, GRID_CONFIG]);

    /**
     * Persist widgetInstances to cookie on changes
     */
    useEffect(() => {
        saveDashboardView({ widgetInstances });
    }, [widgetInstances]);

    /**
     * Revalidate instances when permissions change
     */
    useEffect(() => {
        setWidgetInstances((prev) => {
            const keep = prev.filter((wi) => {
                const dash = dashboardsConfig.find((d) => d.id === wi.dashId);
                return hasPermissionForDashboard(dash);
            });
            return keep;
        });
    }, [allowedPermissions]);

    /**
     * Toggle table selection
     */
    function toggleTable(name) {
        setSelectedTables((prev) => {
            if (prev.includes(name)) return prev.filter((p) => p !== name);
            return [...prev, name];
        });
    }

    /**
     * Handle batch layout changes
     */
    const handleBatchLayoutChange = useCallback((updatedWidgetInstances) => {
        setWidgetInstances(updatedWidgetInstances);
    }, []);

    /**
     * Check if user has permission for a dashboard
     */
    function hasPermissionForDashboard(dash) {
        if (!dash || !Array.isArray(dash.tables) || dash.tables.length === 0) return true;
        return dash.tables.every((tbl) =>
            hasAccessToEntity(tbl, allowedPermissions, viewBaseTableMap)
        );
    }

    /**
     * Compute applicable dashboards for current selection, excluding already added dashboards
     */
    const addedDashboardIds = new Set(widgetInstances.map((w) => w.dashId));
    const applicableDashboards = dashboardsConfig.filter((d) => {
        if (addedDashboardIds.has(d.id)) return false;
        if (!selectedTables || selectedTables.length === 0) return true;
        return d.tables.every((t) => selectedTables.includes(t));
    });

    /**
     * Add dashboard instance to canvas
     */
    const addDashboardToCanvas = useCallback((dashId) => {
        const dash = dashboardsConfig.find((d) => d.id === dashId);
        if (!dash) return setError("Unknown dashboard");

        const nextI = String(Date.now());

        // Base pixel size from dashboard metadata
        let preferredWidth = dash.preferredSize?.width || 450;
        let preferredHeight = dash.preferredSize?.height || 300;

        // Enforce minimum sizes in pixels first
        const minWidthPx = dash.minWidth || 200;
        const minHeightPx = dash.minHeight || 150;

        preferredWidth = Math.max(preferredWidth, minWidthPx);
        preferredHeight = Math.max(preferredHeight, minHeightPx);

        // Apply aspect ratio if locked
        if (dash.lockAspectRatio && dash.aspectRatio) {
            const ratio = dash.aspectRatio;
            const calculatedHeight = preferredWidth / ratio;
            if (calculatedHeight >= minHeightPx) {
                preferredHeight = calculatedHeight;
            } else {
                preferredHeight = minHeightPx;
                preferredWidth = Math.max(preferredHeight * ratio, minWidthPx);
            }
        }

        // Convert to grid units using current grid config
        let { w, h } = pixelsToGridUnits({
            widthPx: preferredWidth,
            heightPx: preferredHeight,
            ...GRID_CONFIG
        });

        // Calculate minimum grid units from pixel constraints
        const minGridUnits = pixelsToGridUnits({
            widthPx: minWidthPx,
            heightPx: minHeightPx,
            ...GRID_CONFIG
        });

        const minW = minGridUnits.w;
        const minH = minGridUnits.h;

        // Ensure initial size meets minimums in grid units
        w = Math.max(w, minW);
        h = Math.max(h, minH);

        // Re-enforce aspect ratio with grid units if locked
        if (dash.lockAspectRatio && dash.aspectRatio) {
            const targetH = Math.round(w / dash.aspectRatio);
            if (targetH >= minH) {
                h = targetH;
            } else {
                h = minH;
                w = Math.max(Math.round(h * dash.aspectRatio), minW);
            }
        }

        // Double-check we're still above minimums after aspect ratio adjustment
        w = Math.max(w, minW);
        h = Math.max(h, minH);

        setWidgetInstances((prev) => {
            const GRID_COLS = 12;
            const nextIndex = prev.length;
            const nextX = (nextIndex * w) % GRID_COLS;
            const nextY = Math.floor((nextIndex * w) / GRID_COLS) * h;

            const layout = {
                x: nextX,
                y: nextY,
                w,
                h,
                i: nextI,
                minW,
                minH,
                static: false
            };

            const defaultParams = dash.params
                ? Object.fromEntries(Object.entries(dash.params).map(([k, v]) => [k, v.default]))
                : {};

            const instance = {
                id: nextI,
                dashId,
                layout,
                params: defaultParams,
                resizeConstraints: {
                    minWidth: minWidthPx,
                    minHeight: minHeightPx,
                    aspectRatio: dash.aspectRatio || null,
                    lockAspectRatio: dash.lockAspectRatio || false
                }
            };

            return [...prev, instance];
        });
    }, [GRID_CONFIG, dashboardsConfig]);

    /**
     * Remove instance from canvas
     */
    const removeInstance = useCallback((id) => {
        setWidgetInstances((prev) => prev.filter((w) => w.id !== id));
    }, []);

    /**
     * Update instance with partial data
     */
    const updateInstance = useCallback((id, patch) => {
        setWidgetInstances((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    }, []);

    return (
        <div className="home-root">
            <div className="home-header">
                <h1>Dashboard Center</h1>

                <div className="header-controls">
                    <button className="btn"
                        onClick={() => setPanelOpen(!panelOpen)}
                        style={{ marginBottom: "6px" }}
                    >
                        {panelOpen ? "Hide" : "Show"} Panel
                    </button>

                    <button className="btn"
                        onClick={() => setShowSelector(true)}
                        style={{ marginBottom: "6px" }}
                    >
                        Generate Report
                    </button>
                </div>
            </div>

            <div className="main-area">
                {/* Right-side panel */}
                <aside className={`right-panel ${panelOpen ? "open" : "closed"}`}>
                    <section className="tables-section">
                        <h3>Available Tables</h3>
                        {availableTables.length === 0 ? (
                            <div className="note">No tables available</div>
                        ) : (
                            <div className="tables-list">
                                {availableTables.map((t) => (
                                    <label key={t} className="perm-item">
                                        <input
                                            type="checkbox"
                                            checked={selectedTables.includes(t)}
                                            onChange={() => toggleTable(t)}
                                        />
                                        {t}
                                    </label>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="dash-list">
                        <h3>Dashboards</h3>
                        <div className="dash-catalog">
                            {applicableDashboards.map((d) => {
                                const permittedToAdd = d.tables.every(tbl =>
                                    hasAccessToEntity(tbl, allowedPermissions, viewBaseTableMap)
                                );
                                return (
                                    <div key={d.id} className="dash-card">
                                        <div className="meta">
                                            <strong>{d.title}</strong>
                                            <div className="sub-font">{d.description}</div>
                                            <div className="sub-font">Tables: {d.tables.join(", ")}</div>
                                        </div>
                                        <div className="action">
                                            <button
                                                className="btn"
                                                disabled={!permittedToAdd}
                                                onClick={() => addDashboardToCanvas(d.id)}
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </aside>

                {/* Canvas - fixed to screen height */}
                <section className="canvas-area" ref={gridContainerRef}>
                    {showSelector && <ReportSelector onClose={() => setShowSelector(false)} />}
                    {!showSelector && <CanvasArea
                        widgetInstances={widgetInstances}
                        dashboardsConfig={dashboardsConfig}
                        onRemove={removeInstance}
                        onUpdate={updateInstance}
                        setError={setError}
                        onBatchLayoutChange={handleBatchLayoutChange}
                        gridConfig={GRID_CONFIG}
                    />}
                </section>
            </div>

            {error && <div className="error-toast">{error} <button className="btn btn-small" onClick={() => setError("")}>x</button></div>}
        </div>
    );
}

/**
 * CanvasArea: Renders the grid layout with dashboard cards
 */
function CanvasArea({ widgetInstances, dashboardsConfig, onRemove, onUpdate, setError, onBatchLayoutChange, gridConfig }) {
    const gridContainerRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(1200);
    const [containerHeight, setContainerHeight] = useState(600);

    // Measure actual container dimensions
    useEffect(() => {
        const updateDimensions = () => {
            if (gridContainerRef.current) {
                setContainerWidth(gridContainerRef.current.offsetWidth);
                setContainerHeight(gridContainerRef.current.offsetHeight);
            }
        };

        updateDimensions();
        const resizeObserver = new ResizeObserver(updateDimensions);
        if (gridContainerRef.current) {
            resizeObserver.observe(gridContainerRef.current);
        }

        return () => resizeObserver.disconnect();
    }, []);

    // Calculate maximum rows that fit in viewport
    const maxRows = Math.floor(containerHeight / (30 + 6)); // rowHeight + margin

    // Prepare layouts array
    const layout = widgetInstances.map((wi) => ({ ...wi.layout, i: wi.id }));

    /**
     * Handle layout changes (batch update)
     */
    function handleLayoutChange(newLayout) {
        const map = {};
        newLayout.forEach((l) => { map[String(l.i)] = l; });

        const updated = widgetInstances.map((wi) => {
            const l = map[String(wi.id)];
            return l ? { ...wi, layout: l } : wi;
        });

        if (typeof onBatchLayoutChange === "function") {
            onBatchLayoutChange(updated);
        }
    }

    /**
     * Handle resize in progress (maintains aspect ratio)
     */
    function onResize(layoutArr, oldItem, newItem, placeholder, e, element) {
        const wi = widgetInstances.find(w => String(w.id) === String(newItem.i));
        if (!wi || !wi.resizeConstraints) return;

        const { lockAspectRatio, aspectRatio, minWidth, minHeight } = wi.resizeConstraints;

        // Calculate minimum grid units using actual container width
        const minW = minWidth ? pixelsToGridUnits({
            widthPx: minWidth,
            heightPx: 100,
            gridWidthPx: containerWidth,
            cols: 12,
            margin: [6, 6],
            rowHeight: 30,
        }).w : 2;

        const minH = minHeight ? pixelsToGridUnits({
            widthPx: 100,
            heightPx: minHeight,
            gridWidthPx: containerWidth,
            cols: 12,
            margin: [6, 6],
            rowHeight: 30,
        }).h : 3;

        // Enforce minimums first
        newItem.w = Math.max(newItem.w, minW);
        newItem.h = Math.max(newItem.h, minH);
        newItem.minW = minW;
        newItem.minH = minH;

        // Apply aspect ratio if locked
        if (lockAspectRatio && aspectRatio) {
            const widthChange = Math.abs(newItem.w - oldItem.w);
            const heightChange = Math.abs(newItem.h - oldItem.h);

            if (widthChange >= heightChange) {
                // Width changed - adjust height
                const targetH = Math.round(newItem.w / aspectRatio);
                newItem.h = Math.max(targetH, minH);

                // If height was constrained, adjust width to maintain ratio
                if (targetH < minH) {
                    newItem.w = Math.max(Math.round(minH * aspectRatio), minW);
                }
            } else {
                // Height changed - adjust width
                const targetW = Math.round(newItem.h * aspectRatio);
                newItem.w = Math.max(targetW, minW);

                // If width was constrained, adjust height to maintain ratio
                if (targetW < minW) {
                    newItem.h = Math.max(Math.round(minW / aspectRatio), minH);
                }
            }
        }

        // Update placeholder to match
        placeholder.w = newItem.w;
        placeholder.h = newItem.h;
    }

    /**
     * Handle drag stop
     */
    function onDragStop(layoutArr, oldItem, newItem) {
        // Check for collisions with other items
        const hasCollision = layoutArr.some(item => {
            if (item.i === newItem.i) return false;

            return (
                newItem.x < item.x + item.w &&
                newItem.x + newItem.w > item.x &&
                newItem.y < item.y + item.h &&
                newItem.y + newItem.h > item.y
            );
        });

        // If collision detected, revert to old position
        if (hasCollision) {
            newItem.x = oldItem.x;
            newItem.y = oldItem.y;
        }

        onUpdate && onUpdate(String(newItem.i), { layout: newItem });
    }

    function onResizeStop(layoutArr, oldItem, newItem) {
        const wi = widgetInstances.find(w => String(w.id) === String(newItem.i));

        if (wi && wi.resizeConstraints) {
            const { lockAspectRatio, aspectRatio, minWidth, minHeight } = wi.resizeConstraints;

            const minW = minWidth ? pixelsToGridUnits({
                widthPx: minWidth,
                heightPx: 100,
                gridWidthPx: containerWidth,
                cols: 12,
                margin: [6, 6],
                rowHeight: 30,
            }).w : 2;

            const minH = minHeight ? pixelsToGridUnits({
                widthPx: 100,
                heightPx: minHeight,
                gridWidthPx: containerWidth,
                cols: 12,
                margin: [6, 6],
                rowHeight: 30,
            }).h : 3;

            newItem.w = Math.max(newItem.w, minW);
            newItem.h = Math.max(newItem.h, minH);
            newItem.minW = minW;
            newItem.minH = minH;

            // Final aspect ratio enforcement
            if (lockAspectRatio && aspectRatio) {
                const targetH = Math.round(newItem.w / aspectRatio);
                if (targetH >= minH) {
                    newItem.h = targetH;
                } else {
                    newItem.h = minH;
                    newItem.w = Math.max(Math.round(minH * aspectRatio), minW);
                }
            }
        }

        // Check for collisions after resize
        const hasCollision = layoutArr.some(item => {
            if (item.i === newItem.i) return false;

            return (
                newItem.x < item.x + item.w &&
                newItem.x + newItem.w > item.x &&
                newItem.y < item.y + item.h &&
                newItem.y + newItem.h > item.y
            );
        });

        // If collision detected, revert to old size
        if (hasCollision) {
            newItem.w = oldItem.w;
            newItem.h = oldItem.h;
        }

        onUpdate && onUpdate(String(newItem.i), { layout: newItem });
    }

    return (
        <div ref={gridContainerRef} className="canvas-wrapper">
            <GridLayout
                className="layout"
                layout={layout}
                cols={12}
                rowHeight={30}
                width={containerWidth}
                isResizable={true}
                isDraggable={true}
                draggableHandle=".card-header"
                draggableCancel=".btn, input, select, textarea, .param-item"
                resizeHandles={['se', 'sw']}
                preventCollision={true}
                compactType={null}
                margin={[6, 6]}
                containerPadding={[0, 0]}
                onLayoutChange={handleLayoutChange}
                onDragStop={onDragStop}
                onResizeStop={onResizeStop}
                onResize={onResize}
                transformScale={1}
                verticalCompact={false}
                autoSize={false}
            >
                {widgetInstances.map((wi) => {
                    const dash = dashboardsConfig.find((d) => d.id === wi.dashId);
                    if (!dash) return null;

                    return (
                        <div key={wi.id}>
                            <DashboardCard
                                instance={wi}
                                dashboard={dash}
                                onRemove={() => onRemove(wi.id)}
                                onChangeParams={(params) => onUpdate(wi.id, { params })}
                                onError={(e) => setError(e)}
                            />
                        </div>
                    );
                })}
            </GridLayout>
        </div>
    );
}