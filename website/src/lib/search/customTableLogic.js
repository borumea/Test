import React from "react";
import TagManager from "../../components/TagManager";
import { apiRequest } from '../api';

export const customSearch = {
    'ebay_inventory': async (payload) => {
        // payload: { table, columns, filters, orderBy } from the UI
        // 1) query the Ebay_Inventory rows using the same API
        // 2) collect item_ids and fetch matching rows in Ebay_Individual_Items to extract barcodes
        // 3) attach a `barcodes` array to each inventory row
        try {
            // 1) fetch inventory rows
            // const resInv = await fetch("/api/query", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify(payload),
            // });

            const resInv = await apiRequest('query', {
                method: 'POST',
                body: payload
            });

            const jsonInv = await resInv.json();
            if (!resInv.ok) throw new Error(jsonInv.error || jsonInv.message || "Inventory query failed");

            let invRows = [];
            if (Array.isArray(jsonInv)) invRows = jsonInv;
            else invRows = jsonInv.rows || jsonInv.result || jsonInv.data || jsonInv.results || jsonInv.payload || [];

            // normalize to array
            if (!Array.isArray(invRows)) invRows = [];

            // collect item ids
            const itemIds = Array.from(new Set(invRows.map(r => r["Item ID"]).filter(ids => ids !== undefined && ids !== null)));

            // prepare container
            const barcodesByItemId = {};

            if (itemIds.length > 0) {
                // 2) try batch fetch of individual items using an IN operator filter; backend may or may not support 'IN'.
                try {
                    const indPayload = {
                        table: "Ebay_Individual_Items",
                        columns: ["Item ID", "Item Barcode", "Price"],
                        filters: [
                            { column: "Item ID", operator: "IN", value: itemIds }
                        ],
                    };

                    // const resInd = await fetch("/api/query", {
                    //     method: "POST",
                    //     headers: { "Content-Type": "application/json" },
                    //     body: JSON.stringify(indPayload),
                    // });

                    const resInd = await apiRequest('query', {
                        method: 'POST',
                        body: indPayload
                    });

                    const jsonInd = await resInd.json();
                    if (!resInd.ok) throw new Error(jsonInd.error || jsonInd.message || "Individual items query failed");

                    let indRows = Array.isArray(jsonInd) ? jsonInd : (jsonInd.rows || jsonInd.result || jsonInd.data || jsonInd.results || jsonInd.payload || []);
                    if (!Array.isArray(indRows)) indRows = [];

                    // group barcodes by item_id
                    indRows.forEach(ir => {
                        const iid = ir["Item ID"];
                        const barcode = ir["Item Barcode"];
                        if (iid === undefined || iid === null) return;
                        if (!barcodesByItemId[iid]) barcodesByItemId[iid] = [];
                        if (barcode !== undefined && barcode !== null) barcodesByItemId[iid].push(barcode);
                    });
                } catch (e) {
                    // If the server didn't accept the IN filter, fall back: fetch all individual items and filter client-side.
                    try {
                        const fallbackPayload = { table: "Ebay_Individual_Items", columns: ["Item ID", "Item Barcode", "Price"], filters: [] };
                        // const resIndAll = await fetch("/api/query", {
                        //     method: "POST",
                        //     headers: { "Content-Type": "application/json" },
                        //     body: JSON.stringify(fallbackPayload),
                        // });

                        const resIndAll = await apiRequest('query', {
                            method: 'POST',
                            body: fallbackPayload
                        });

                        const jsonIndAll = await resIndAll.json();
                        let indRowsAll = Array.isArray(jsonIndAll) ? jsonIndAll : (jsonIndAll.rows || jsonIndAll.result || jsonIndAll.data || jsonIndAll.results || jsonIndAll.payload || []);
                        if (!Array.isArray(indRowsAll)) indRowsAll = [];
                        indRowsAll.forEach(ir => {
                            const iid = ir["Item ID"];
                            const barcode = ir["Item Barcode"];
                            if (iid === undefined || iid === null) return;
                            if (!itemIds.includes(iid)) return;
                            if (!barcodesByItemId[iid]) barcodesByItemId[iid] = [];
                            if (barcode !== undefined && barcode !== null) barcodesByItemId[iid].push(barcode);
                        });
                    } catch (e2) {
                        // If even fallback fails, we simply proceed with empty barcodesByItemId
                    }
                }
            }

            // attach barcodes array to each inventory row
            const augmented = invRows.map(r => {
                const iid = r["Item ID"];
                const Barcodes = (iid !== undefined && iid !== null && barcodesByItemId[iid]) ? Array.from(new Set(barcodesByItemId[iid])) : [];
                return { ...r, Barcodes };
            });

            return augmented;
        } catch (err) {
            // bubble error up so the caller handles it
            throw err;
        }
    },
    'ebay_individual_items': async (payload) => {
        try {
            // 1) Fetch individual item rows
            // CHANGED: Remove ORDER BY for columns that don't exist in this table yet
            const orderByColumnsToExclude = ['Rack Number', 'Location ID', 'Model'];
            const filteredOrderBy = Array.isArray(payload.orderBy)
                ? payload.orderBy.filter(ob => {
                    if (!ob || typeof ob !== 'string') return true;
                    const match = ob.match(/^(.+?)\s+(ASC|DESC)$/i);
                    const colName = match ? match[1].trim() : ob.trim();
                    return !orderByColumnsToExclude.includes(colName);
                })
                : payload.orderBy;

            const modifiedPayload = {
                ...payload,
                orderBy: filteredOrderBy
            };

            // const resItems = await fetch("/api/query", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify(modifiedPayload),
            // });

            const resItems = await apiRequest('query', {
                method: 'POST',
                body: modifiedPayload
            });

            const jsonItems = await resItems.json();
            if (!resItems.ok)
                throw new Error(jsonItems.error || jsonItems.message || "Individual items query failed");

            let itemRows = Array.isArray(jsonItems)
                ? jsonItems
                : jsonItems.rows ||
                jsonItems.result ||
                jsonItems.data ||
                jsonItems.results ||
                jsonItems.payload ||
                [];
            if (!Array.isArray(itemRows)) itemRows = [];

            // 2) Collect item_ids
            const itemIds = Array.from(
                new Set(
                    itemRows
                        .map((r) => r["Item ID"])
                        .filter((id) => id !== undefined && id !== null)
                )
            );

            const inventoryByItemId = {};

            // 3) Fetch corresponding Ebay_Inventory rows
            if (itemIds.length > 0) {
                try {
                    const invPayload = {
                        table: "Ebay_Inventory",
                        columns: ["Item ID", "Rack Number", "Location ID", "Model"],
                        filters: [{ column: "Item ID", operator: "IN", value: itemIds }],
                    };

                    // const resInv = await fetch("/api/query", {
                    //     method: "POST",
                    //     headers: { "Content-Type": "application/json" },
                    //     body: JSON.stringify(invPayload),
                    // });

                    const resInv = await apiRequest('query', {
                        method: 'POST',
                        body: invPayload
                    });

                    const jsonInv = await resInv.json();
                    if (!resInv.ok)
                        throw new Error(jsonInv.error || jsonInv.message || "Inventory query failed");

                    let invRows = Array.isArray(jsonInv)
                        ? jsonInv
                        : jsonInv.rows ||
                        jsonInv.result ||
                        jsonInv.data ||
                        jsonInv.results ||
                        jsonInv.payload ||
                        [];
                    if (!Array.isArray(invRows)) invRows = [];

                    // index inventory data by item_id
                    invRows.forEach((inv) => {
                        const iid = inv["Item ID"];
                        if (iid !== undefined && iid !== null) {
                            inventoryByItemId[iid] = {
                                "Rack Number": inv["Rack Number"],
                                "Location ID": inv["Location ID"],
                                "Model": inv["Model"],
                            };
                        }
                    });
                } catch (e) {
                    // fallback
                    try {
                        const fallbackPayload = {
                            table: "Ebay_Inventory",
                            columns: ["Item ID", "Rack Number", "Location ID", "Model"],
                            filters: [],
                        };
                        // const resAllInv = await fetch("/api/query", {
                        //     method: "POST",
                        //     headers: { "Content-Type": "application/json" },
                        //     body: JSON.stringify(fallbackPayload),
                        // });

                        const resAllInv = await apiRequest('query', {
                            method: 'POST',
                            body: fallbackPayload
                        });

                        const jsonAllInv = await resAllInv.json();
                        let invRowsAll = Array.isArray(jsonAllInv)
                            ? jsonAllInv
                            : jsonAllInv.rows ||
                            jsonAllInv.result ||
                            jsonAllInv.data ||
                            jsonAllInv.results ||
                            jsonAllInv.payload ||
                            [];
                        if (!Array.isArray(invRowsAll)) invRowsAll = [];
                        invRowsAll.forEach((inv) => {
                            const iid = inv["Item ID"];
                            if (iid === undefined || iid === null) return;
                            if (!itemIds.includes(iid)) return;
                            inventoryByItemId[iid] = {
                                "Rack Number": inv["Rack Number"],
                                "Location ID": inv["Location ID"],
                                "Model": inv["Model"],
                            };
                        });
                    } catch (e2) {
                        // fallback failed, continue with empty inventoryByItemId
                    }
                }
            }

            // 4) Combine data
            const augmented = itemRows.map((r) => {
                const iid = r["Item ID"];
                const invInfo = inventoryByItemId[iid] || {};
                return {
                    ...r,
                    "Rack Number": invInfo["Rack Number"] || null,
                    "Location ID": invInfo["Location ID"] || null,
                    "Model": invInfo["Model"] || null,
                };
            });

            // 5) ADDED: Apply client-side sorting for joined columns
            if (Array.isArray(payload.orderBy) && payload.orderBy.length > 0) {
                const originalOrderBy = payload.orderBy.find(ob => {
                    if (!ob || typeof ob !== 'string') return false;
                    const match = ob.match(/^(.+?)\s+(ASC|DESC)$/i);
                    const colName = match ? match[1].trim() : ob.trim();
                    return orderByColumnsToExclude.includes(colName);
                });

                if (originalOrderBy) {
                    const match = originalOrderBy.match(/^(.+?)\s+(ASC|DESC)$/i);
                    const sortColumn = match ? match[1].trim() : originalOrderBy.trim();
                    const sortDirection = match ? match[2].toUpperCase() : 'ASC';

                    augmented.sort((a, b) => {
                        const aVal = a[sortColumn];
                        const bVal = b[sortColumn];

                        // Handle nulls
                        if (aVal === null || aVal === undefined) return 1;
                        if (bVal === null || bVal === undefined) return -1;

                        // Compare values
                        let comparison = 0;
                        if (typeof aVal === 'string' && typeof bVal === 'string') {
                            comparison = aVal.localeCompare(bVal);
                        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
                            comparison = aVal - bVal;
                        } else {
                            comparison = String(aVal).localeCompare(String(bVal));
                        }

                        return sortDirection === 'DESC' ? -comparison : comparison;
                    });
                }
            }

            return augmented;
        } catch (err) {
            // bubble error up to caller
            throw err;
        }
    },
    'class_and_mtg_availability': async (payload) => {
        // Query the view and then fetch IDs from underlying tables
        try {
            // 1) Fetch all rows from the view
            // const res = await fetch("/api/query", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify(payload),
            // });

            const res = await apiRequest('query', {
                method: 'POST',
                body: payload
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || json.message || "Class availability query failed");

            let rows = Array.isArray(json)
                ? json
                : json.rows || json.result || json.data || json.results || json.payload || [];

            if (!Array.isArray(rows)) rows = [];

            console.log("Class and Meeting Availability Rows:", rows);

            if (rows.length === 0) return [];

            // 2) Fetch all Class_Reservations to map Reservation datetime -> Auto ID
            // const resReservations = await fetch("/api/query", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify({
            //         table: "Class_Reservations",
            //         columns: ["Auto ID", "Reservation"],
            //         filters: []
            //     }),
            // });

            const resReservations = await apiRequest('query', {
                method: 'POST',
                body: {
                    table: "Class_Reservations",
                    columns: ["Auto ID", "Reservation"],
                    filters: []
                }
            });

            const jsonReservations = await resReservations.json();
            if (!resReservations.ok) throw new Error("Failed to fetch reservations");

            const reservations = Array.isArray(jsonReservations)
                ? jsonReservations
                : jsonReservations.rows || [];

            // Create a map: Reservation datetime string -> Auto ID
            const reservationMap = new Map();
            reservations.forEach(r => {
                if (r.Reservation && r["Auto ID"]) {
                    reservationMap.set(r.Reservation, r["Auto ID"]);
                }
            });

            // 3) Fetch all Class_Reservation_Participants to map veteran details -> Auto ID
            // const resParticipants = await fetch("/api/query", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify({
            //         table: "Class_Reservation_Participants",
            //         columns: ["Auto ID", "Reservation ID", "Veteran Name", "Email", "Product Inventory Item", "VIPLA", "Last Modified"],
            //         filters: []
            //     }),
            // });

            const resParticipants = await apiRequest('query', {
                method: 'POST',
                body: {
                    table: "Class_Reservation_Participants",
                    columns: ["Auto ID", "Reservation ID", "Veteran Name", "Email", "Product Inventory Item", "VIPLA", "Last Modified"],
                    filters: []
                }
            });

            const jsonParticipants = await resParticipants.json();
            if (!resParticipants.ok) throw new Error("Failed to fetch participants");

            const participants = Array.isArray(jsonParticipants)
                ? jsonParticipants
                : jsonParticipants.rows || [];

            // 4) Group rows by reservation
            const grouped = {};

            rows.forEach(row => {
                const reservationDatetime = row["Reservation"];
                if (!reservationDatetime) return;

                // Look up the Auto ID for this reservation
                const reservationAutoId = reservationMap.get(reservationDatetime);
                if (!reservationAutoId) {
                    console.warn("No Auto ID found for reservation:", reservationDatetime);
                    return;
                }

                // Find matching participant by comparing veteran details and reservation ID
                const matchingParticipant = participants.find(p =>
                    p["Reservation ID"] === reservationAutoId &&
                    p["Veteran Name"] === row["Veteran Name"] &&
                    p["Email"] === row["Email"]
                );

                if (!matchingParticipant) {
                    console.warn("No matching participant found for:", row);
                    return;
                }

                // Use the reservation Auto ID as the grouping key
                if (!grouped[reservationAutoId]) {
                    grouped[reservationAutoId] = {
                        reservationAutoId: reservationAutoId,
                        reservation: reservationDatetime,
                        participants: []
                    };
                }

                // Add participant info with their Auto ID
                grouped[reservationAutoId].participants.push({
                    participantAutoId: matchingParticipant["Auto ID"],
                    veteranName: row["Veteran Name"],
                    email: row["Email"],
                    productInventoryItem: row["Product Inventory Item"],
                    vipla: row["VIPLA"],
                    lastModified: row["Last Modified"]
                });
            });

            // 5) Convert to array and sort by reservation datetime (newest first)
            const result = Object.values(grouped).sort((a, b) => {
                const dateA = new Date(a.reservation);
                const dateB = new Date(b.reservation);
                return dateB - dateA; // Descending order
            });

            return result;
        } catch (err) {
            console.error("Error in class_and_mtg_availability custom search:", err);
            throw err;
        }
    },
};

export const customDuplicateBehavior = {
    'ebay_inventory': async ({ selectedRow, columnsMeta, table, navigate }) => {
        if (!selectedRow) return;
        // Determine unique columns
        const uniqueCols = (columnsMeta || [])
            .filter(c => c.isPrimaryKey || c.isUnique || c.key === "PRI" || c.key === "UNI")
            .map(c => c.name);

        const cloneRecord = Object.fromEntries(
            Object.entries(selectedRow).filter(([key]) => !uniqueCols.includes(key))
        );

        // set quantity to 1
        cloneRecord["Quantity"] = 1;

        // try to fetch a matching individual item to get a price
        const iid = selectedRow["Item ID"];
        if (iid !== undefined && iid !== null) {
            try {
                const indPayload = {
                    table: "Ebay_Individual_Items",
                    columns: ["Price"],
                    filters: [{ column: "Item ID", operator: "=", value: iid }],
                };
                // const res = await fetch("/api/query", {
                //     method: "POST",
                //     headers: { "Content-Type": "application/json" },
                //     body: JSON.stringify(indPayload),
                // });

                const res = await apiRequest('query', {
                    method: 'POST',
                    body: indPayload
                });

                const json = await res.json();
                if (res.ok) {
                    const indRows = Array.isArray(json) ? json : (json.rows || json.result || json.data || json.results || json.payload || []);
                    if (Array.isArray(indRows) && indRows.length > 0) {
                        // take price from the first matching individual item
                        if (indRows[0]["Price"] !== undefined) cloneRecord["Price"] = indRows[0]["Price"];
                    }
                }
            } catch (e) {
                // ignore and continue (price will be absent)
            }
        }

        navigate("/insert", {
            state: {
                table,
                record: cloneRecord,
                columnsMeta,
                reason: "insert",
            },
        });
    }
};

export const customUpdateBehavior = {
    'ebay_inventory': async ({ selectedRow, columnsMeta, table, navigate }) => {
        if (!selectedRow) return;

        // Ensure we have barcodes: try to use selectedRow.barcodes else fetch them
        let barcodes = Array.isArray(selectedRow.barcodes) ? selectedRow.barcodes.slice() : [];

        if ((!barcodes || barcodes.length === 0) && selectedRow["Item ID"] !== undefined && selectedRow["Item ID"] !== null) {
            // fetch individual items for this item_id and collect barcodes
            try {
                const indPayload = {
                    table: "Ebay_Individual_Items",
                    columns: ["Item Barcode"],
                    filters: [{ column: "Item ID", operator: "=", value: selectedRow["Item ID"] }],
                };
                // const res = await fetch("/api/query", {
                //     method: "POST",
                //     headers: { "Content-Type": "application/json" },
                //     body: JSON.stringify(indPayload),
                // });

                const res = await apiRequest('query', {
                    method: 'POST',
                    body: indPayload
                });

                const json = await res.json();
                if (res.ok) {
                    const indRows = Array.isArray(json) ? json : (json.rows || json.result || json.data || json.results || json.payload || []);
                    if (Array.isArray(indRows)) {
                        barcodes = indRows.map(r => r["Item Barcode"]).filter(Boolean);
                    }
                }
            } catch (e) {
                // Continue with whatever barcodes we have
            }
        }

        const uniqueValues = [];
        if (Array.isArray(barcodes)) {
            barcodes.forEach((b, idx) => {
                uniqueValues.push({ ["Item Barcode"]: b })
            });
        }

        navigate("/update", {
            state: {
                table,
                record: selectedRow,
                columnsMeta,
                reason: "update",
                uniqueValues: uniqueValues,
            }
        });
    }
};

// Custom rendering logic for specific tables
export const customTableRendering = {
    'class_and_mtg_availability': {
        // Helper to render the grouped table rows
        renderGroupedRows: ({
            visibleResults,
            startIndex,
            headerCols,
            columnsMeta,
            selectedRowGlobalIndex,
            editMode,
            tagColumns,
            results,
            setResults,
            setSelectedRow,
            setSelectedRowGlobalIndex,
            setContextMenu,
            goToUpdate,
            renderCell,
            handleCellCommitForView,
            formatDateTimeLocal,
            table
        }) => {
            return visibleResults.map((group, groupIdx) => {
                const globalGroupIndex = startIndex + groupIdx;
                const isExpanded = group.expanded !== false; // Default to expanded

                return (
                    <React.Fragment key={globalGroupIndex}>
                        {/* Reservation Header Row */}
                        <tr
                            className="reservation-header-row"
                            onClick={() => {
                                // Toggle expansion state
                                setResults(prev => {
                                    const next = prev.slice();
                                    next[globalGroupIndex] = {
                                        ...next[globalGroupIndex],
                                        expanded: !isExpanded
                                    };
                                    return next;
                                });
                            }}
                        >
                            <td
                                colSpan={headerCols.length}
                                className="reservation-header-cell"
                            >
                                <div className="reservation-header-content">
                                    <span className="reservation-expand-icon">
                                        {isExpanded ? '▼' : '▶'}
                                    </span>
                                    <span className="reservation-datetime">
                                        {formatDateTimeLocal(new Date(group.reservation))}
                                    </span>
                                    <span className="reservation-count">
                                        {group.participants.length} participant{group.participants.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            </td>
                        </tr>

                        {/* Participant Rows (only shown when expanded) */}
                        {isExpanded && group.participants.map((participant, pIdx) => {
                            const participantGlobalIndex = `${globalGroupIndex}-${pIdx}`;
                            const isSelected = selectedRowGlobalIndex === participantGlobalIndex;

                            // Construct full row data for selection
                            const fullRowData = {
                                "Reservation ID": group.reservationAutoId,
                                "Reservation": group.reservation,
                                "Participant Auto ID": participant.participantAutoId,
                                "Veteran Name": participant.veteranName,
                                "Email": participant.email,
                                "Product Inventory Item": participant.productInventoryItem,
                                "VIPLA": participant.vipla,
                                "Last Modified": participant.lastModified
                            };

                            return (
                                <tr
                                    key={participantGlobalIndex}
                                    onClick={() => {
                                        setSelectedRow(fullRowData);
                                        setSelectedRowGlobalIndex(participantGlobalIndex);
                                    }}
                                    onDoubleClick={() => {
                                        setSelectedRow(fullRowData);
                                        setSelectedRowGlobalIndex(participantGlobalIndex);
                                        if (!editMode) goToUpdate();
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setSelectedRow(fullRowData);
                                        setSelectedRowGlobalIndex(participantGlobalIndex);
                                        setContextMenu({
                                            x: e.clientX,
                                            y: e.clientY - 67,
                                        });
                                    }}
                                    className={isSelected ? "selected-row participant-row" : "participant-row"}
                                >
                                    {/* Render participant columns */}
                                    {headerCols.map((col, ci) => {
                                        let val;
                                        let sourceTable = null; // Track which underlying table this column belongs to
                                        let sourcePK = null;
                                        let sourcePKValue = null;

                                        // Map columns to participant data and determine source
                                        switch (col) {
                                            case "Reservation":
                                                val = group.reservation;
                                                sourceTable = "Class_Reservations";
                                                sourcePK = "Auto ID";
                                                sourcePKValue = group.reservationAutoId;
                                                break;
                                            case "Reservation ID":
                                                val = group.reservationAutoId;
                                                sourceTable = "Class_Reservations";
                                                sourcePK = "Auto ID";
                                                sourcePKValue = group.reservationAutoId;
                                                break;
                                            case "Veteran Name":
                                                val = participant.veteranName;
                                                sourceTable = "Class_Reservation_Participants";
                                                sourcePK = "Auto ID";
                                                sourcePKValue = participant.participantAutoId;
                                                break;
                                            case "Email":
                                                val = participant.email;
                                                sourceTable = "Class_Reservation_Participants";
                                                sourcePK = "Auto ID";
                                                sourcePKValue = participant.participantAutoId;
                                                break;
                                            case "Product Inventory Item":
                                                val = participant.productInventoryItem;
                                                sourceTable = "Class_Reservation_Participants";
                                                sourcePK = "Auto ID";
                                                sourcePKValue = participant.participantAutoId;
                                                break;
                                            case "VIPLA":
                                                val = participant.vipla;
                                                sourceTable = "Class_Reservation_Participants";
                                                sourcePK = "Auto ID";
                                                sourcePKValue = participant.participantAutoId;
                                                break;
                                            case "Last Modified":
                                                val = participant.lastModified;
                                                sourceTable = "Class_Reservation_Participants";
                                                sourcePK = "Auto ID";
                                                sourcePKValue = participant.participantAutoId;
                                                break;
                                            case "Auto ID":
                                                val = participant.participantAutoId;
                                                sourceTable = "Class_Reservation_Participants";
                                                sourcePK = "Auto ID";
                                                sourcePKValue = participant.participantAutoId;
                                                break;
                                            default:
                                                val = fullRowData[col];
                                        }

                                        const colMeta = columnsMeta.find(c => c.name === col);
                                        const display = renderCell(val, colMeta, col);

                                        // Determine if this is a primary key (either table's PK or Auto ID columns)
                                        const isPK = col === "Participant Auto ID" || col === "Reservation ID" || col === "Auto ID";

                                        if (editMode && !isPK && sourceTable) {
                                            const meta = columnsMeta.find(c => c.name === col);
                                            const type = meta?.type?.toLowerCase() || "";

                                            // Check for tags
                                            if (tagColumns.has(col)) {
                                                let tagArray = [];
                                                try {
                                                    if (Array.isArray(val)) {
                                                        tagArray = val;
                                                    } else if (typeof val === 'string' && val.trim()) {
                                                        tagArray = val.split(',').map(t => t.trim()).filter(Boolean);
                                                    }
                                                } catch (err) {
                                                    tagArray = [];
                                                }

                                                return (
                                                    <td key={col} className={ci === 0 ? "sticky-col participant-cell" : "participant-cell"}>
                                                        <div className="edit-cell-tag-wrapper">
                                                            <TagManager
                                                                table={table}
                                                                column={col}
                                                                value={tagArray}
                                                                onChange={(tags) => {
                                                                    const tagString = tags.length > 0 ? tags.join(', ') : '';
                                                                    handleCellCommitForView(
                                                                        sourceTable,
                                                                        sourcePK,
                                                                        sourcePKValue,
                                                                        col,
                                                                        tagString
                                                                    );
                                                                }}
                                                                required={false}
                                                                readOnly={false}
                                                            />
                                                        </div>
                                                    </td>
                                                );
                                            }

                                            let inputType = "text";
                                            switch (type) {
                                                case "int":
                                                case "integer":
                                                case "bigint":
                                                case "smallint":
                                                case "mediumint":
                                                case "tinyint":
                                                case "number":
                                                case "float":
                                                case "double":
                                                case "decimal":
                                                    inputType = "number";
                                                    break;
                                                case "date":
                                                    inputType = "date";
                                                    break;
                                                case "datetime":
                                                case "timestamp":
                                                    inputType = "datetime-local";
                                                    break;
                                                case "boolean":
                                                case "bit":
                                                case "bool":
                                                    inputType = "checkbox";
                                                    break;
                                                case "email":
                                                    inputType = "email";
                                                    break;
                                                default:
                                                    inputType = "text";
                                            }

                                            return (
                                                <td key={col} className={ci === 0 ? "sticky-col participant-cell" : "participant-cell"}>
                                                    {inputType === "checkbox" ? (
                                                        <label className="col-checkbox checkbox-item">
                                                            <input
                                                                type="checkbox"
                                                                defaultChecked={display === "Yes"}
                                                                onChange={(e) => {
                                                                    handleCellCommitForView(
                                                                        sourceTable,
                                                                        sourcePK,
                                                                        sourcePKValue,
                                                                        col,
                                                                        e.target.checked
                                                                    );
                                                                }}
                                                            />
                                                        </label>
                                                    ) : (
                                                        <input
                                                            className="edit-cell-input"
                                                            type={inputType}
                                                            defaultValue={
                                                                inputType === "date"
                                                                    ? (() => {
                                                                        if (!val) return "";
                                                                        const d = new Date(val);
                                                                        return !isNaN(d) ? d.toISOString().split("T")[0] : "";
                                                                    })()
                                                                    : inputType === "datetime-local"
                                                                        ? (() => {
                                                                            if (!val) return "";
                                                                            const d = new Date(val);
                                                                            if (isNaN(d)) return "";
                                                                            return formatDateTimeLocal(d);
                                                                        })()
                                                                        : val ?? ""
                                                            }
                                                            onBlur={(e) => {
                                                                handleCellCommitForView(
                                                                    sourceTable,
                                                                    sourcePK,
                                                                    sourcePKValue,
                                                                    col,
                                                                    e.target.value
                                                                );
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Enter") {
                                                                    e.preventDefault();
                                                                    e.target.blur();
                                                                }
                                                                if (e.key === "Escape") {
                                                                    e.target.value = val ?? "";
                                                                    e.target.blur();
                                                                }
                                                            }}
                                                        />
                                                    )}
                                                </td>
                                            );
                                        }

                                        if (editMode && isPK) {
                                            return (
                                                <td key={col} className={ci === 0 ? "sticky-col participant-cell" : "participant-cell"}
                                                    title={`${display} (primary key - not editable)`}
                                                >
                                                    <span className="pk-value">{display}</span>
                                                </td>
                                            );
                                        }

                                        return (
                                            <td key={col} className={ci === 0 ? "sticky-col participant-cell" : "participant-cell"}
                                                title={typeof display === 'string' ? display : ''}
                                            >
                                                {display}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </React.Fragment>
                );
            });
        }
    }
};