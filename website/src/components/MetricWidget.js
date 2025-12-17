// src/components/MetricWidget.js
import React from "react";
import PropTypes from "prop-types";
import { formatNumber } from "../lib/format";
import "../styles/MetricWidget.css";

/**
 * MetricWidget
 *
 * Displays a single metric: title, formatted value, small sparkline (optional).
 * Ensures number formatting has commas and two decimals via formatNumber.
 *
 * Props:
 *  - metric: {
 *      name: string,
 *      value: number | string,
 *      datapoints: [{ ts: number|string, value: number }] (optional)
 *    }
 *  - compact: boolean
 *
 * Notes:
 *  - Sparkline is a tiny inline SVG. It avoids overflow by using a safe viewBox,
 *    clamping values when necessary, and not drawing if there are not enough points.
 */
export default function MetricWidget({ metric = {}, compact = false }) {
    const title = metric.name || "Metric";
    const rawValue = metric.value == null ? null : metric.value;

    // Interpret numeric-like strings as numbers when possible, otherwise leave as-is.
    function asNumberish(v) {
        if (v === null || v === undefined) return null;
        if (typeof v === "number") return v;
        // strip commas, whitespace
        if (typeof v === "string") {
            const s = v.replace(/,/g, "").trim();
            if (s === "") return null;
            const n = Number(s);
            if (!Number.isNaN(n)) return n;
            return null;
        }
        return null;
    }

    const numeric = asNumberish(rawValue);
    const displayValue =
        numeric !== null ? formatNumber(numeric) : rawValue === null ? "-" : String(rawValue);

    const datapoints = Array.isArray(metric.datapoints) ? metric.datapoints : [];

    // Sparkline drawing helper: returns an SVG polyline points string
    function sparklinePoints(data, width = 120, height = 28, padding = 4) {
        if (!data || data.length < 2) return null;

        // Extract numeric values, ignore invalid entries
        const vals = data
            .map((d) => {
                const v = asNumberish(d.value);
                return v !== null ? v : null;
            })
            .filter((v) => v !== null);

        if (vals.length < 2) return null;

        const min = Math.min(...vals);
        const max = Math.max(...vals);

        // Avoid zero-range which would collapse the line; create a tiny range
        const range = Math.max(1e-6, max - min);

        // Map points to coordinates within padded area
        const step = (width - padding * 2) / (vals.length - 1);
        const points = vals
            .map((v, i) => {
                const x = padding + i * step;
                // invert Y for SVG coordinate system (0 at top)
                const y = padding + (1 - (v - min) / range) * (height - padding * 2);
                // clamp to viewBox
                const clampedX = Math.max(0, Math.min(width, x));
                const clampedY = Math.max(0, Math.min(height, y));
                return `${clampedX},${clampedY}`;
            })
            .join(" ");

        return points;
    }

    const points = sparklinePoints(datapoints);

    return (
        <div className={`metric-widget ${compact ? "compact" : ""}`} title={title}>
            <div className="metric-top">
                <div className="metric-title">{title}</div>
            </div>

            <div className="metric-main">
                <div className="metric-value" aria-label={`${title} value`}>
                    {displayValue}
                </div>

                <div className="metric-spark" aria-hidden={!points}>
                    {/* Only render sparkline when there's enough points */}
                    {points ? (
                        <svg
                            className="sparkline-svg"
                            viewBox="0 0 120 28"
                            preserveAspectRatio="none"
                            width="120"
                            height="28"
                            role="img"
                            aria-hidden="true"
                            focusable="false"
                        >
                            <polyline
                                fill="none"
                                stroke="#7fd3d8"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                points={points}
                            />
                        </svg>
                    ) : (
                        // subtle placeholder to keep layout consistent
                        <div className="sparkline-placeholder" />
                    )}
                </div>
            </div>
        </div>
    );
}

MetricWidget.propTypes = {
    metric: PropTypes.shape({
        name: PropTypes.string,
        value: PropTypes.any,
        datapoints: PropTypes.arrayOf(PropTypes.object),
    }),
    compact: PropTypes.bool,
};