// src/components/DashboardBuilder.js
import React, { useEffect, useState } from "react";
import ErrorPopup from "./ErrorPopup";
import { apiRequest } from '../lib/api';

export default function DashboardBuilder({ onSave, onError }) {
    const [tables, setTables] = useState([]);
    const [columns, setColumns] = useState([]);
    const [selectedTable, setSelectedTable] = useState("");
    const [selectedColumns, setSelectedColumns] = useState([]);
    const [chartType, setChartType] = useState("table");
    const [xAxis, setXAxis] = useState("");
    const [yAxis, setYAxis] = useState("");
    const [aggregateType, setAggregateType] = useState("COUNT");
    const [error, setError] = useState("");

    useEffect(() => {
        fetch("/api/tables")
            .then(res => res.json())
            .then(setTables)
            .catch(() => setError("Failed to load tables"));
    }, []);

    useEffect(() => {
        if (!selectedTable) return;
        fetch(`/api/columns?table=${encodeURIComponent(selectedTable)}`)
            .then(res => res.json())
            .then(cols => {
                setColumns(cols);
                setSelectedColumns([]);
                setXAxis("");
                setYAxis("");
            })
            .catch(() => setError("Failed to load columns"));
    }, [selectedTable]);

    function handleSave() {
        if (!selectedTable) {
            return setError("Please select a table");
        }
        if (chartType !== "metric" && selectedColumns.length === 0) {
            return setError("Please select at least one column");
        }
        if ((chartType === "bar" || chartType === "line" || chartType === "pie") && !xAxis) {
            return setError("Please select a column for grouping (X Axis)");
        }

        // Construct widget configuration
        const widget = {
            id: Date.now().toString(),
            table: selectedTable,
            columns: selectedColumns,
            chartType,
            xAxis,
            yAxis,
        };

        // Smart defaults for grouped charts
        if (chartType === "bar" || chartType === "line" || chartType === "pie") {
            widget.groupBy = xAxis;
            widget.aggregate = {
                type: aggregateType,
                column: yAxis || "*"
            };
        }

        onSave(widget);
    }

    return (
        <div className="bg-white p-6 rounded-2xl shadow space-y-4">
            <h2 className="text-xl font-bold">Create Dashboard Widget</h2>

            {/* Table selection */}
            <div>
                <label className="block mb-1">Select Table</label>
                <select
                    value={selectedTable}
                    onChange={e => setSelectedTable(e.target.value)}
                    className="border rounded p-2 w-full"
                >
                    <option value="">-- Select Table --</option>
                    {tables.map(t => (
                        <option key={t} value={t}>{t}</option>
                    ))}
                </select>
            </div>

            {/* Column selection */}
            {selectedTable && (
                <div>
                    <label className="block mb-1">Select Columns</label>
                    <select
                        multiple
                        value={selectedColumns}
                        onChange={e => setSelectedColumns([...e.target.selectedOptions].map(o => o.value))}
                        className="border rounded p-2 w-full"
                    >
                        {columns.map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Chart type */}
            {selectedTable && (
                <div>
                    <label className="block mb-1">Chart Type</label>
                    <select
                        value={chartType}
                        onChange={e => setChartType(e.target.value)}
                        className="border rounded p-2 w-full"
                    >
                        <option value="table">Table</option>
                        <option value="metric">Metric (Single Value)</option>
                        <option value="bar">Bar Chart</option>
                        <option value="line">Line Chart</option>
                        <option value="pie">Pie Chart</option>
                    </select>
                </div>
            )}

            {/* Axis selectors (only for charts that need them) */}
            {(chartType === "bar" || chartType === "line" || chartType === "pie") && (
                <>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block mb-1">X Axis / Group By</label>
                            <select
                                value={xAxis}
                                onChange={e => setXAxis(e.target.value)}
                                className="border rounded p-2 w-full"
                            >
                                <option value="">-- Select Column --</option>
                                {columns.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block mb-1">Y Axis (Numeric Column)</label>
                            <select
                                value={yAxis}
                                onChange={e => setYAxis(e.target.value)}
                                className="border rounded p-2 w-full"
                            >
                                <option value="">-- Select Column --</option>
                                {columns.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Aggregate type */}
                    <div>
                        <label className="block mb-1 mt-3">Aggregate Function</label>
                        <select
                            value={aggregateType}
                            onChange={e => setAggregateType(e.target.value)}
                            className="border rounded p-2 w-full"
                        >
                            <option value="COUNT">COUNT</option>
                            <option value="SUM">SUM</option>
                            <option value="AVG">AVG</option>
                            <option value="MAX">MAX</option>
                            <option value="MIN">MIN</option>
                        </select>
                    </div>
                </>
            )}

            {/* Save button */}
            <div>
                <button
                    onClick={handleSave}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                >
                    Save Widget
                </button>
            </div>

            {/* Error popup */}
            <ErrorPopup message={error} onClose={() => setError("")} />
        </div>
    );
}
