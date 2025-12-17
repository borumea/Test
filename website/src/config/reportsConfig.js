export const availableReports = [
    {
        id: "inventory_recent",
        name: "Recently Inventoried Items",
        description: "Lists items inventoried in the last X days or between specific dates.",
        parameters: [
            {
                name: "startDate",
                label: "Start Date",
                type: "date",
                default: () => {
                    const d = new Date();
                    d.setDate(d.getDate() - 7);
                    return d.toISOString().split("T")[0];
                }
            },
            {
                name: "endDate",
                label: "End Date",
                type: "date",
                default: () => new Date().toISOString().split("T")[0]
            }
        ],
        queries: [
            {
                id: "inventoriedItems",
                label: "Items Inventoried",
                table: "Ebay_Individual_Items",
                orderBy: ["Item Barcode"],
                columns: ["Item Barcode", "Date_inventoried", "Date Listed", "Price", "Last Modified", "Item ID"],
                filters: [
                    {
                        column: "Date Inventoried",
                        operator: "between",
                        params: ["startDate", "endDate"],
                    }
                ],
                joins: [
                    {
                        fromTable: "Ebay_Inventory",
                        fromKey: "Item ID",
                        toKey: "Item ID",
                        columns: ["Model"]
                    }
                ],
            },
            {
                id: "soldItems",
                label: "Items Sold",
                table: "Ebay_Sold",
                orderBy: ["Item Barcode"],
                columns: ["Item Barcode", "Date Inventoried", "Date Listed", "Date Sold", "Price", "Last Modified", "Model"],
                filters: [
                    {
                        column: "Date Inventoried",
                        operator: "between",
                        params: ["startDate", "endDate"],
                    }
                ],
            }
        ]
    }
];