// src/components/ReportSelector.js
import React, { useState } from "react";
import { availableReports } from "../../config/reportsConfig.js";
import { ReportRunner } from "./ReportRunner.js";

export function ReportSelector({ onClose }) {
    const [selectedReport, setSelectedReport] = useState(null);

    if (selectedReport) {
        return <ReportRunner report={selectedReport} onBack={() => setSelectedReport(null)} />;
    }

    return (
        <div className="right-panel">
            <h2>Select a Report</h2>
            <ul className="catalog">
                {availableReports.map(r => (
                    <li className="link-card" key={r.id} onClick={() => setSelectedReport(r)}>
                        <strong>{r.name}</strong>
                        <p>{r.description}</p>
                    </li>
                ))}
            </ul>
            <button className="btn" onClick={onClose}>Close</button>
        </div>
    );
}