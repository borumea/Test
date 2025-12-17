import { apiRequest } from '../api';

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

/**
 * Views API helpers using centralized apiRequest
 * All methods include JWT authentication automatically
 */
export const viewsAPI = {
    listViews: async () => {
        const response = await apiRequest("views/list");
        return response.json();
    },
    createView: async (payload) => {
        const response = await apiRequest("views/create", {
            method: "POST",
            body: payload
        });
        return response.json();
    },
    updateView: async (payload) => {
        const response = await apiRequest("views/update", {
            method: "POST",
            body: payload
        });
        return response.json();
    },
    deleteView: async (payload) => {
        const response = await apiRequest("views/delete", {
            method: "POST",
            body: payload
        });
        return response.json();
    },
    loadTables: async () => {
        const response = await apiRequest("tables");
        return response.json();
    },
    loadBaseTables: async () => {
        const response = await apiRequest("base-tables");
        return response.json();
    },
    loadColumnsMeta: async (table) => {
        const response = await apiRequest(`columns?table=${encodeURIComponent(table)}`);
        return response.json();
    },
    refreshPermissions: async (username) => {
        const response = await apiRequest("auth/refresh-permissions", {
            method: "POST",
            body: { username }
        });
        return response.json();
    },
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