export const excludedTables = [
    "Employees",
    "Tags",
    "Ratings",
    "Warehouse_Locations",
    "Full_Ebay_View",
];

export const excludedTablesInsert = [
    "Ebay_Sold",
    "Ebay_Individual_Items",
];

export const excludedTablesUpdate = [
    "Class_and_Mtg_Availability",
];

export const excludedViews = [
    "Warehouse_Locations",
    "Class_and_Mtg_Availability",
    "Imaging_Entry_View",
]

export const viewsAPI = {
    listViews: () => fetch("/api/views/list").then(r => r.json()),
    createView: (payload) => fetch("/api/views/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    }).then(r => r.json()),
    updateView: (payload) => fetch("/api/views/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    }).then(r => r.json()),
    deleteView: (payload) => fetch("/api/views/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    }).then(r => r.json()),
    loadTables: () => fetch("/api/tables").then(r => r.json()),
    loadBaseTables: () => fetch("/api/base-tables").then(r => r.json()),
    loadColumnsMeta: (table) => fetch(`/api/columns?table=${encodeURIComponent(table)}`).then(r => r.json()),
    refreshPermissions: (username) => fetch("/api/auth/refresh-permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
    }).then(r => r.json()),
};

// Columns that should be auto-populated on insert
// Key: table name (case-sensitive to match backend); Value: array of column names
export const autoPopulateColumns = {
    default: [["last_modified", null], ["Last Modified", null],],
    "Ebay_Sold": [],
    "Ebay_Individual_Items": [["Is Listed", "Date Listed"]],
    "Ebay_Inventory": [["Date Inventoried", null],
    ["Is Listed", "Date Listed"],],
    "COD": [],
    "Product_Inventory": [["Date Registered", null]],
    "Game_Corp": [],
    "Supply": [],
    "Shipment_Tracking": [],
    "Veterans": [],
    "Wholesale": [],
    "GovDeal_Auctions": [],
    "Windows_Product_Keys": [],
    "Class_and_Mtg_Availability": [],

    "Donations": [],
    "VIP_Applications": [],
    "Support": [],
};

// Columns that should be visible but locked (not editable)
export const lockedColumns = {
    default: ["last_modified", "Last Modified",],
    "Ebay_Sold": ["Rack Number", "Location ID", "Item Barcode", "Date Inventoried", "Date Listed", "Model",],
    "Ebay_Individual_Items": ["Item ID", "Date Inventoried"],
    "Ebay_Inventory": [],
    "CoD": [],
    "Product_Inventory": ["date_logged"],
    "Game_Corp": [],
    "Supply": [],
    "Shipment_Tracking": [],
    "Veterans": [],
    "Wholesale": [],
    "GovDeal_Auctions": [],
    "Windows_Product_Keys": [],
    "Class_and_Mtg_Availability": [],

    "Donations": [],
    "VIP_Applications": [],
    "Support": [],
};