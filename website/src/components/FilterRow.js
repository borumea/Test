import Dropdown from "./Dropdown";

export function FilterRow({ index, filter, columns, columnsMeta, onChange, onRemove }) {
    const ops_translated = ["=", "!=", ">", "<", "LIKE", "IS NULL", "IS NOT NULL"];
    const ops = ["is", "is not", "is greater than", "is less than", "contains", "is empty", "is not empty"];

    function updateField(field, value) {
        onChange(index, { ...filter, [field]: value });
    }

    // Get selected column metadata
    const colMeta = columnsMeta.find(c => c.name === filter.column);
    const type = colMeta?.type?.toLowerCase?.();

    function translateFilterOperator(op) {
        const index = ops.indexOf(op);
        const newVal = index !== -1 ? ops_translated[index] : op;
        return newVal;
    }

    function reverseTranslateFilterOperator(op) {
        const index = ops_translated.indexOf(op);
        const newVal = index !== -1 ? ops[index] : op;
        return newVal;
    }

    // Move the value input rendering logic into the JSX with conditional rendering
    const shouldShowValueInput = filter.operator !== "IS NULL" && filter.operator !== "IS NOT NULL";
    
    let valueInputElement = null;
    if (shouldShowValueInput) {
        if (!filter.column) {
            valueInputElement = (
                <input
                    key="value-input"
                    value={filter.value || ""}
                    onChange={(e) => updateField("value", e.target.value)}
                    placeholder="value"
                    className="filter-value-input"
                />
            );
        } else if (type === "date") {
            valueInputElement = (
                <input
                    key="value-input"
                    type="date"
                    value={filter.value || ""}
                    onChange={(e) => updateField("value", e.target.value)}
                    className="filter-value-input"
                />
            );
        } else if (["datetime", "timestamp"].includes(type)) {
            valueInputElement = (
                <input
                    key="value-input"
                    type="datetime-local"
                    value={filter.value || ""}
                    onChange={(e) => updateField("value", e.target.value)}
                    className="filter-value-input"
                />
            );
        } else if (type === "bit") {
            const bitOptions = ["Yes", "No"];
            valueInputElement = (
                <Dropdown
                    key="value-input"
                    className="filter-value-input"
                    options={bitOptions}
                    value={filter.value === 1 ? "Yes" : filter.value === 0 ? "No" : ""}
                    onChange={(val) => updateField("value", val === "Yes" ? 1 : 0)}
                    placeholder="Select..."
                />
            );
        } else {
            // fallback to text input
            valueInputElement = (
                <input
                    key="value-input"
                    value={filter.value || ""}
                    onChange={(e) => updateField("value", e.target.value)}
                    placeholder="value"
                    className="filter-value-input"
                />
            );
        }
    }

    return (
        <div className="filter-row" role="listitem" style={{ margin: "6px 0px 20px 0px", padding: "0px" }}>
            <div style={{ display: 'flex', gap: "4px" }}>
                <Dropdown
                    style={{ zIndex: "1000" }}
                    options={columns}
                    value={filter.column || ""}
                    onChange={(val) => updateField("column", val)}
                    placeholder="Column..."
                />
                <Dropdown
                    style={{ zIndex: "1000" }}
                    options={ops}
                    value={reverseTranslateFilterOperator(filter.operator) || "is"}
                    onChange={(val) => updateField("operator", translateFilterOperator(val))}
                    placeholder="is"
                />
                {valueInputElement}
                <button
                    className="filter-remove-btn"
                    onClick={() => onRemove(index)}
                    aria-label="Remove filter"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}