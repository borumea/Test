import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import {
    ResponsiveContainer,
    BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend
} from "recharts";
import { formatNumber } from "../lib/format";
import "../styles/Dashboard.css";
import { apiRequest } from '../lib/api';

const COLORS = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1"];

// helper to normalize rows -> chart friendly
function normalizeRowsToChart(rows = [], widget = {}) {
    if (!Array.isArray(rows)) return [];
    if (rows.length === 0) return [];

    const sample = rows[0];
    if (!sample || typeof sample !== 'object') return [];

    // If already in correct format, just ensure numbers are parsed
    if (sample.name !== undefined && sample.value !== undefined) {
        return rows.map((r) => ({
            name: String(r.name ?? ''),
            value: Number(r.value ?? r.count ?? r.total ?? 0)
        }));
    }

    const keys = Object.keys(sample);
    if (keys.length === 0) return [];

    // Try to intelligently find name/label column
    const nameKey = keys.find((k) => /^(name|group|label|category|type|item)$/i.test(k)) || keys[0];

    // Try to intelligently find value/numeric column
    const valueKey = keys.find((k) => /^(value|count|total|amount|sum|quantity)$/i.test(k)) || keys[1] || keys[0];

    return rows.map((r) => {
        const nameValue = r[nameKey];
        const rawValue = r[valueKey] ?? r.count ?? r.value ?? r.total ?? 0;

        return {
            name: nameValue !== null && nameValue !== undefined ? String(nameValue) : '(empty)',
            value: Number(rawValue) || 0
        };
    });
}

function CustomTooltip({ active, payload, label, total }) {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload || payload[0];
    const value = Number(p.value ?? p.count ?? p.total ?? 0);
    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
    return (
        <div className="chart-tooltip">
            <div className="tooltip-title">{p.name ?? label}</div>
            <div className="tooltip-row"><strong>Value:</strong> {formatNumber(value)}</div>
            <div className="tooltip-row"><strong>Percent:</strong> {pct}%</div>
        </div>
    );
}

function DashboardCard({ instance = {}, dashboard = {}, onRemove, onChangeParams, onError }) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [lastError, setLastError] = useState("");
    const [localParams, setLocalParams] = useState(instance.params || {});
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const cardRef = useRef();
    const bodyRef = useRef();

    // refresh every 30 minutes (1800000 ms)
    const REFRESH_MS = 30 * 60 * 1000;

    // Measure card dimensions for scaling
    useEffect(() => {
        if (!cardRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                setDimensions({ width, height });
            }
        });

        resizeObserver.observe(cardRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    // Calculate scale factor based on card size
    const scaleFactor = useMemo(() => {
        const baseWidth = dashboard.preferredSize?.width || 400;
        const baseHeight = dashboard.preferredSize?.height || 300;

        if (dimensions.width === 0 || dimensions.height === 0) return 1;

        // Calculate scale based on smaller dimension to prevent overflow
        const widthScale = dimensions.width / baseWidth;
        const heightScale = dimensions.height / baseHeight;

        return Math.min(widthScale, heightScale, 2); // Cap at 2x
    }, [dimensions, dashboard.preferredSize]);

    // Build payload for /api/query based on dashboard and params
    const buildQueryPayload = useCallback(() => {
        // Validate dashboard has required table field
        if (!dashboard || !dashboard.table) {
            throw new Error('Dashboard configuration missing required "table" field');
        }

        // Start with filters from dashboard config (if any)
        const filters = Array.isArray(dashboard.filters) ? [...dashboard.filters] : [];

        // apply dateRange param if defined (convert to filters)
        if (localParams && localParams.dateRange) {
            const d = localParams.dateRange;
            if (d.type === "last_n_days" && Number.isFinite(d.n)) {
                const n = Number(d.n);
                const from = new Date();
                from.setDate(from.getDate() - n);
                filters.push({ column: "created_at", operator: ">=", value: from.toISOString() });
            } else if (d.from || d.to) {
                if (d.from) filters.push({ column: "created_at", operator: ">=", value: d.from });
                if (d.to) filters.push({ column: "created_at", operator: "<=", value: d.to });
            }
        }

        // minAmount param example
        if (localParams && localParams.minAmount != null && dashboard.params && dashboard.params.minAmount) {
            filters.push({ column: "amount", operator: ">=", value: localParams.minAmount });
        }

        // Additional param handling for other common filter scenarios
        if (localParams) {
            for (const [paramKey, paramMeta] of Object.entries(dashboard.params || {})) {
                // Skip already handled params
                if (paramKey === 'dateRange' || paramKey === 'minAmount' || paramKey === 'limit') continue;

                const paramValue = localParams[paramKey];
                if (paramValue !== undefined && paramValue !== null && paramValue !== '') {
                    // For numeric params, add as filter if metadata specifies a column
                    if (paramMeta.filterColumn) {
                        const operator = paramMeta.filterOperator || '>=';
                        filters.push({
                            column: paramMeta.filterColumn,
                            operator: operator,
                            value: paramValue
                        });
                    }
                }
            }
        }

        // Determine limit: use dashboard.limit directly, or from params, or undefined
        let limitValue = undefined;
        if (dashboard.limit !== undefined && dashboard.limit !== null) {
            limitValue = dashboard.limit;
        } else if (dashboard.params && dashboard.params.limit) {
            limitValue = localParams.limit !== undefined ? localParams.limit : dashboard.params.limit.default;
        }

        // Determine orderBy if specified in dashboard config
        const orderBy = dashboard.orderBy || undefined;

        const payload = {
            table: dashboard.table,
            columns: dashboard.columns || [],
            groupBy: dashboard.groupBy || dashboard.xAxis,
            aggregate: dashboard.aggregate || null,
            filters: filters.length > 0 ? filters : undefined,
            orderBy: orderBy,
            limit: limitValue
        };

        return payload;
    }, [dashboard, localParams]);

    // Fetch function
    const fetchData = useCallback(async (signal) => {
        if (!dashboard || !dashboard.table) {
            setData([]);
            return;
        }
        setLoading(true);
        setLastError("");
        try {
            const payload = buildQueryPayload();
            Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
            const res = await apiRequest("query", {
                method: "POST",
                body: payload,
                signal
            });
            const json = await res.json();
            if (!res.ok) {
                throw new Error(json.error || "Failed to load widget data");
            }
            let rows = [];
            if (Array.isArray(json)) rows = json;
            else rows = json.rows || json.data || json.result || [];
            setData(rows);
        } catch (e) {
            if (e.name === "AbortError") return;
            console.error("widget fetch error", e);
            setLastError(e.message || "Failed to load data");
            setData([]);
            onError && onError(e.message || "Widget load failed");
        } finally {
            setLoading(false);
        }
    }, [dashboard, buildQueryPayload, onError]);

    // initial fetch and interval
    useEffect(() => {
        const controller = new AbortController();
        fetchData(controller.signal);

        const id = setInterval(() => {
            const c = new AbortController();
            fetchData(c.signal);
        }, REFRESH_MS);

        return () => {
            controller.abort();
            clearInterval(id);
        };
    }, [fetchData, REFRESH_MS]);

    // when instance.params change upstream, sync to local
    useEffect(() => {
        setLocalParams(instance.params || {});
    }, [instance.params]);

    // handle param edits
    function handleParamUpdate(patch) {
        const updated = { ...localParams, ...patch };
        setLocalParams(updated);
        onChangeParams && onChangeParams(updated);
    }

    // rendering
    const chartType = dashboard.chartType || dashboard.type || (dashboard.aggregate ? "bar" : "table");
    const chartData = useMemo(() => normalizeRowsToChart(data, dashboard), [data, dashboard]);
    const totalPie = useMemo(() => (chartData || []).reduce((s, r) => s + Number(r.value || 0), 0), [chartData]);

    // Calculate responsive font sizes
    const fontSize = {
        title: Math.max(12, Math.min(20, 16 * scaleFactor)),
        subtitle: Math.max(10, Math.min(14, 12 * scaleFactor)),
        metric: Math.max(24, Math.min(72, 48 * scaleFactor)),
        label: Math.max(10, Math.min(14, 11 * scaleFactor)),
        axis: Math.max(9, Math.min(12, 10 * scaleFactor)),
    };

    function renderMetric() {
        if (!data || data.length === 0) return (
            <div className="card-metric-only">
                <div className="metric-large" style={{ fontSize: `${fontSize.metric}px` }}>-</div>
            </div>
        );
        const first = data[0];
        let raw = null;
        if (typeof first === "object") {
            raw = first.value ?? first.count ?? first.total ?? Object.values(first)[0];
        } else {
            raw = first;
        }
        return (
            <div className="card-metric-only">
                <div className="metric-large" style={{ fontSize: `${fontSize.metric}px` }}>
                    {formatNumber(raw)}
                </div>
            </div>
        );
    }

    // Calculate chart dimensions based on available space
    const chartHeight = useMemo(() => {
        if (!bodyRef.current) return 220;
        const bodyHeight = bodyRef.current.clientHeight;
        const paramsHeight = dashboard.params ? 60 : 0;
        return Math.max(150, bodyHeight - paramsHeight - 40);
    }, [dashboard.params]);

    return (
        <div
            ref={cardRef}
            className="dashboard-card"
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                fontSize: `${fontSize.label}px`,
                boxSizing: 'border-box'
            }}
        >
            <header className="card-header" style={{ fontSize: `${fontSize.title}px` }}>
                <div>
                    <div className="card-title">{dashboard.title}</div>
                    {dashboard.description && (
                        <div className="card-sub" style={{ fontSize: `${fontSize.subtitle}px` }}>
                            {dashboard.description}
                        </div>
                    )}
                </div>
                <div className="card-actions">
                    <button
                        className="btn"
                        onClick={() => onRemove && onRemove(instance.id)}
                        style={{ fontSize: `${fontSize.label}px` }}
                    >
                        Remove
                    </button>
                </div>
            </header>

            <div ref={bodyRef} className="card-body" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {/* Parameter editors */}
                {dashboard.params && (
                    <div className="params-row" style={{ fontSize: `${fontSize.label}px` }}>
                        {Object.entries(dashboard.params).map(([k, meta]) => {
                            const val = localParams[k];
                            if (meta.type === "number") {
                                return (
                                    <label key={k} className="param-item">
                                        {k}: <input type="number" value={val ?? ""} onChange={(e) => handleParamUpdate({ [k]: e.target.value === "" ? null : Number(e.target.value) })} />
                                    </label>
                                );
                            }
                            if (meta.type === "daterange") {
                                const cur = val || meta.default || {};
                                return (
                                    <div key={k} className="param-item">
                                        <label>{k}:</label>
                                        <select value={cur.type || ""} onChange={(e) => {
                                            const t = e.target.value;
                                            if (t === "last_n_days") handleParamUpdate({ [k]: { type: "last_n_days", n: (cur && cur.n) || meta.default.n || 7 } });
                                            else handleParamUpdate({ [k]: { type: "manual", from: "", to: "" } });
                                        }}>
                                            <option value="last_n_days">Last N days</option>
                                            <option value="manual">Manual range</option>
                                        </select>
                                        {(localParams[k] && localParams[k].type === "last_n_days") && (
                                            <input type="number" value={localParams[k].n ?? meta.default.n} onChange={(e) => handleParamUpdate({ [k]: { ...(localParams[k] || {}), n: Number(e.target.value) } })} style={{ width: 80, marginLeft: 6 }} />
                                        )}
                                        {(localParams[k] && localParams[k].type === "manual") && (
                                            <>
                                                <input type="date" value={localParams[k].from || ""} onChange={(e) => handleParamUpdate({ [k]: { ...(localParams[k] || {}), from: e.target.value } })} />
                                                <input type="date" value={localParams[k].to || ""} onChange={(e) => handleParamUpdate({ [k]: { ...(localParams[k] || {}), to: e.target.value } })} />
                                            </>
                                        )}
                                    </div>
                                );
                            }
                            return (
                                <label key={k} className="param-item">
                                    {k}: <input type="text" value={val ?? ""} onChange={(e) => handleParamUpdate({ [k]: e.target.value })} />
                                </label>
                            );
                        })}
                        <button className="btn btn-small" onClick={() => fetchData()}>Refresh</button>
                    </div>
                )}

                {/* Loading / Error */}
                {loading && <div className="note" style={{ fontSize: `${fontSize.label}px` }}>Loading...</div>}
                {lastError && <div className="error-note" style={{ fontSize: `${fontSize.label}px` }}>{lastError}</div>}

                {/* Content */}
                {chartType === "table" && (
                    <div className="table-view" style={{ fontSize: `${fontSize.label}px` }}>
                        <table>
                            <thead>
                                <tr>
                                    {data && data[0] && Object.keys(data[0]).map((k) => <th key={k}>{k}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {data.map((r, i) => (
                                    <tr key={i}>
                                        {Object.keys(r).map((k) => <td key={k}>{typeof r[k] === "number" ? formatNumber(r[k]) : String(r[k])}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {chartType === "metric" && renderMetric()}

                {chartType === "pie" && (
                    <ResponsiveContainer width="100%" height={chartHeight}>
                        <PieChart>
                            <Pie
                                data={chartData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                outerRadius={Math.min(chartHeight * 0.35, 120 * scaleFactor)}
                                label={(entry) => `${((entry.value / totalPie) * 100).toFixed(1)}%`}
                                labelStyle={{ fontSize: `${fontSize.axis}px` }}
                            >
                                {chartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}
                            </Pie>
                            <Tooltip content={(props) => <CustomTooltip {...props} total={totalPie} />} />
                            <Legend wrapperStyle={{ fontSize: `${fontSize.label}px` }} />
                        </PieChart>
                    </ResponsiveContainer>
                )}

                {chartType === "bar" && (
                    <ResponsiveContainer width="100%" height={chartHeight}>
                        <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="name"
                                tick={{ fontSize: fontSize.axis }}
                                angle={chartData.length > 10 ? -45 : 0}
                                textAnchor={chartData.length > 10 ? "end" : "middle"}
                                height={chartData.length > 10 ? 80 : 60}
                            />
                            <YAxis
                                tickFormatter={(v) => formatNumber(v)}
                                tick={{ fontSize: fontSize.axis }}
                            />
                            <Tooltip
                                formatter={(v) => formatNumber(v)}
                                content={(props) => <CustomTooltip {...props} total={chartData.reduce((s, r) => s + Number(r.value || 0), 0)} />}
                                contentStyle={{ fontSize: `${fontSize.label}px` }}
                            />
                            <Bar dataKey="value" fill={COLORS[0]} />
                        </BarChart>
                    </ResponsiveContainer>
                )}

                {chartType === "line" && (
                    <ResponsiveContainer width="100%" height={chartHeight}>
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="name"
                                tick={{ fontSize: fontSize.axis }}
                                angle={chartData.length > 10 ? -45 : 0}
                                textAnchor={chartData.length > 10 ? "end" : "middle"}
                                height={chartData.length > 10 ? 80 : 60}
                            />
                            <YAxis
                                tickFormatter={(v) => formatNumber(v)}
                                tick={{ fontSize: fontSize.axis }}
                            />
                            <Tooltip
                                content={(props) => <CustomTooltip {...props} total={chartData.reduce((s, r) => s + Number(r.value || 0), 0)} />}
                                contentStyle={{ fontSize: `${fontSize.label}px` }}
                            />
                            <Line
                                type="monotone"
                                dataKey="value"
                                stroke={COLORS[0]}
                                strokeWidth={Math.max(1, 2 * scaleFactor)}
                                dot={{ r: Math.max(2, 4 * scaleFactor) }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}

DashboardCard.propTypes = {
    instance: PropTypes.object,
    dashboard: PropTypes.object.isRequired,
    onRemove: PropTypes.func,
    onChangeParams: PropTypes.func,
    onError: PropTypes.func,
};

export default React.memo(DashboardCard);