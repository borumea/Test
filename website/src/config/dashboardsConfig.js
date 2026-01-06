// src/config/dashboardsConfig.js
// Each dashboard may list tables it requires (for permission checks).
// Widgets support `aggregate`, `groupBy`, `filters`, etc, and optional `params` schema for user-editable parameters.

const dashboardsConfig = [  
    {
        id: "donations_total_value",
        title: "Donation Total Value",
        description: "Grand total sum of the values of all received donations",
        tables: [
            "Donations"
        ],
        chartType: "metric",
        table: "Donations",
        aggregate: {
            type: "SUM",
            column: "Grand Total Value"
        },
        filters: [],  // No filters - sum all donations
        preferredSize: {
            width: 250,
            height: 300,
        },
        minWidth: 120,           // Minimum 250px wide
        minHeight: 100,          // Minimum 300px tall
        aspectRatio: 5/6,        // 5:6 aspect ratio
        lockAspectRatio: false,   // Enforce aspect ratio during resize
    },
    {
        id: "donations_total_value_2",
        title: "Donation Total Value",
        description: "Grand total sum of the values of all received donations",
        tables: [
            "Donations"
        ],
        chartType: "metric",
        table: "Donations",
        aggregate: {
            type: "SUM",
            column: "Grand Total Value"
        },
        filters: [],  // No filters - sum all donations
        preferredSize: {
            width: 250,
            height: 300,
        },
        minWidth: 120,           // Minimum 250px wide
        minHeight: 100,          // Minimum 300px tall
        aspectRatio: 5/6,        // 5:6 aspect ratio
        lockAspectRatio: false,   // Enforce aspect ratio during resize
    },
    {
        id: "inventory_pie_chart",
        title: "Inventory Product Categories Breakdown",
        description: "Shows the relative proportion of each category in the `item_name` column.",
        tables: [
            "Ebay_Inventory"
        ],
        table: "Ebay_Inventory",
        chartType: "pie",
        groupBy: "item_name",
        aggregate: { type: "COUNT", column: "*" },
        limit: 20,
        filters: [
            { column: "item_name", operator: "IS NOT", value: null },
        ],
        preferredSize: {
            width: 400,
            height: 400,
        },
        minWidth: 300,           // Minimum 320px wide
        minHeight: 300,          // Minimum 380px tall  
        aspectRatio: 2/2,    // Preserve original aspect ratio (1:1)
        lockAspectRatio: true,   // Keep consistent proportions
    },
    // {
    //     id: "sales_by_region",
    //     title: "Sales by Region",
    //     description: "Grouped sales totals by region (last 30 days default).",
    //     tables: ["orders"],
    //     table: "orders",
    //     chartType: "bar",
    //     groupBy: "region",
    //     aggregate: { type: "SUM", column: "amount" },
    //     params: {
    //         dateRange: { type: "daterange", default: { type: "last_n_days", n: 30 } },
    //         minAmount: { type: "number", default: 0 }
    //     },
    //     // optional hints used to normalize chart data
    //     xAxis: "region",
    //     yAxis: "amount"
    // },

    // {
    //     id: "orders_latest",
    //     title: "Recent Orders",
    //     description: "Table of recent orders.",
    //     tables: ["orders"],
    //     table: "orders",
    //     chartType: "table",
    //     columns: ["id", "customer_name", "amount", "created_at"],
    //     params: {
    //         limit: { type: "number", default: 20 }
    //     }
    // },

    // {
    //     id: "active_users_metric",
    //     title: "Active Users (7d)",
    //     description: "Number of active users in last 7 days.",
    //     tables: ["users", "sessions"],
    //     table: "sessions",
    //     chartType: "metric",
    //     aggregate: { type: "COUNT", column: "*" },
    //     params: {
    //         dateRange: { type: "daterange", default: { type: "last_n_days", n: 7 } }
    //     }
    // }
];

export default dashboardsConfig;

