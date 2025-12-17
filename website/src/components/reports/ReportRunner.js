// src/components/ReportRunner.js
import React, { useState } from "react";
import { printReport } from "../../lib/print.js";
import { formatNumber, formatDateLocal, formatDateTimeLocal } from "../../lib/format.js";
import { apiRequest } from '../../lib/api';

export function ReportRunner({ report, onBack }) {
    const [params, setParams] = useState(
        Object.fromEntries(report.parameters.map(p => [p.name, p.default?.() ?? ""]))
    );
    const [loading, setLoading] = useState(false);

    function handleParamChange(name, value) {
        setParams(prev => ({ ...prev, [name]: value }));
    }

    // --- Helper: Normalize row data into readable format ---
    function normalizeValue(key, value) {
        if (value == null) return "-";

        // Try to detect numbers
        if (!isNaN(value) && value !== "") {
            return formatNumber(value);
        }

        // Detect ISO-like date or datetime strings
        if (key.toLowerCase().includes("date")) {
            return formatDateLocal(value);
        }
        else if (key.toLowerCase().includes("datetime") || key == "Last Modified") {
            return formatDateTimeLocal(value);
        }

        return String(value);
    }

    function normalizeRows(rows) {
        return rows.map(row =>
            Object.fromEntries(
                Object.entries(row).map(([key, value]) => [key, normalizeValue(key, value)])
            )
        );
    }

    async function runReport() {
        setLoading(true);
        try {
            const queryResults = {};

            for (const q of report.queries) {
                const filters = q.filters.map(f => {
                    const values = f.params.map(p => params[p]);
                    return {
                        column: f.column,
                        operator: f.operator,
                        value: (f.operator.toLowerCase() === "between" || f.operator.toLowerCase() === "in")
                            ? values
                            : values[0],
                    };
                });

                // const response = await fetch("/api/query", {
                //     method: "POST",
                //     headers: { "Content-Type": "application/json" },
                //     body: JSON.stringify({ table: q.table, filters: filters, orderBy: q.orderBy, columns: q.columns }),
                // });

                const response = await apiRequest('/api/query', {
                    method: 'POST',
                    body: { table: q.table, columns: ['*'], filters: [], orderBy: [] }
                });

                let data = await response.json();
                let rows = data.rows;

                // Handle dynamic joins
                if (q.joins && q.joins.length > 0) {
                    for (const join of q.joins) {
                        // Fetch join table data once
                        // const joinRes = await fetch("/api/query", {
                        //     method: "POST",
                        //     headers: { "Content-Type": "application/json" },
                        //     body: JSON.stringify({ table: join.fromTable, filters: [], orderBy: [] }),
                        // });

                        const joinRes = await apiRequest('/api/query', {
                            method: 'POST',
                            body: { table: join.fromTable, columns: ['*'], filters: [], orderBy: [] }
                        });
                        const joinData = await joinRes.json();

                        const joinLookup = Object.fromEntries(
                            joinData.rows.map(r => [r[join.fromKey], r])
                        );

                        // Merge join columns into base rows
                        rows = rows.map(r => {
                            const match = joinLookup[r[join.toKey]];
                            if (!match) return r;
                            const extras = Object.fromEntries(
                                join.columns.map(col => [col, match[col] ?? "-"])
                            );
                            return { ...r, ...extras };
                        });
                    }
                }

                const normalizedRows = normalizeRows(rows);
                queryResults[q.id] = { label: q.label, rows: normalizedRows };
            }

            // Directly trigger print with normalized results
            printReport({ report, params, results: queryResults });
        } catch (err) {
            console.error("Error generating report:", err);
            alert("Failed to generate report.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="panel">
            <button className="btn" style={{ width: "10%" }} onClick={onBack}>Back</button>
            <h2 style={{ margin: "20px" }}>{report.name}</h2>
            <div style={{ marginLeft: "20px" }} className="catalog-grid">
                {report.parameters.map(p => (
                    <div className="two-col-grid" key={p.name}>
                        <label style={{ marginBottom: "4px" }}>{p.label}</label>
                        <input
                            type={p.type}
                            value={params[p.name]}
                            onChange={e => handleParamChange(p.name, e.target.value)}
                        />
                    </div>
                ))}
            </div>

            <button
                className="btn"
                onClick={runReport}
                disabled={loading}
                style={{ width: "20%" }}
            >
                {loading ? "Generating..." : "Run Report"}
            </button>
        </div>
    );
}