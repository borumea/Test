/**
 * src/components/DashboardGrid.js
 * Simple responsive grid layout for dashboards.
 *
 * Props:
 *  - children (dashboard cards)
 */

import React from 'react';
import '../styles/DashboardGrid.css';

export default function DashboardGrid({ children }) {
    return <div className="dashboard-grid">{children}</div>;
}
