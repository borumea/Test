/**
 * src/components/MetricSelector.js
 *
 * A simple UI component listing available metric keys.
 * In a real app this list could be fetched from the backend.
 *
 * Props:
 *  - available: string[] (list of metric names)
 *  - onAdd({ metricName, compact })
 */

import React, { useState } from 'react';
import '../styles/MetricSelector.css';

export default function MetricSelector({ available = [], onAdd }) {
    const [selected, setSelected] = useState(available[0] || '');
    const [compact, setCompact] = useState(false);

    return (
        <div className="metric-selector">
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {available.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
            <label className="compact-checkbox">
                <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
                compact
            </label>
            <button className="btn" onClick={() => onAdd && onAdd({ metricName: selected, compact })}>Add</button>
        </div>
    );
}
