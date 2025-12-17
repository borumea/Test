export const addedSearchCols = {
    "Ebay_Individual_Items": ["Rack Number", "Location ID", "Model"],
    "Ebay_Inventory": ["Barcodes"],
};

export const defaultOrderBy = {
    "Ebay_Individual_Items": ["Rack Number ASC", "Location ID ASC"],
    "Ebay_Inventory": ["Rack Number ASC", "Location ID ASC"],
    "Ebay_Sold": ["Date Sold DESC", "Last Modified DESC"],
    "Full_Ebay_View": ["Rack Number ASC", "Location ID ASC"],
    "Class_and_Mtg_Availability": ['Reservation DESC']
};

export const excludedTables = [
    "Employees",
    "Tags",
    "Ratings",
    "Class_Reservations",
    "Class_Reservation_Participants",
];