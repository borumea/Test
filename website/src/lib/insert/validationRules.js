// lib/insert/validationRules.js
/**
 * Validation rules for table operations
 * Each table can define:
 * - beforeInsert/beforeUpdate: validate and format data before submission
 * - afterInsert/afterUpdate: handle post-submission logic
 * - onFetch: load additional data when fetching a record for update
 */

import { formatDateTimeLocal, formatDateTimeUTC } from "./insertNormalization";
import { apiRequest } from '../api';

/**
 * Validation and formatting rules for specific tables
 */
export const tableValidationRules = {
    ebay_inventory: {
        /**
         * Validate and format data before insert
         * @param {Object} data - Form data
         * @param {Array} uniqueValues - Array of unique field values for multi-quantity inserts
         * @returns {Promise<{ok: boolean, data?: Object, message?: string}>}
         */
        beforeInsert: async (data, uniqueValues) => {
            // Validate and format Location ID
            const locationId = data["Location ID"];
            const locationRegex = /^[a-zA-Z]-\d$/;

            if (!locationRegex.test(locationId)) {
                return {
                    ok: false,
                    message: "Invalid format for Location ID. Expected 'Letter-Digit' (e.g., A-1)"
                };
            }

            // Uppercase the letter in Location ID
            const [letter, digit] = locationId.split('-');
            data["Location ID"] = `${letter.toUpperCase()}-${digit}`;

            // Validate all barcodes before proceeding
            const quantity = Number(data["Quantity"]) || 1;
            const barcodeRegex = /^[eE]\d{5}$/;
            const seenBarcodes = new Set();

            for (let i = 0; i < quantity; i++) {
                const barcode = uniqueValues[i]?.["Item Barcode"] || data["Item Barcode"];

                // Format validation
                if (!barcodeRegex.test(barcode)) {
                    return {
                        ok: false,
                        message: `Invalid barcode format: ${barcode}. Expected 'EXXXXX'`
                    };
                }

                // Duplicate detection within this submission
                if (seenBarcodes.has(barcode.toUpperCase())) {
                    return {
                        ok: false,
                        message: `Duplicate barcode in submission: ${barcode}`
                    };
                }
                seenBarcodes.add(barcode.toUpperCase());

                // Check against existing barcodes in Ebay_Sold
                const existsInSold = await apiRequest('query', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Sold",
                        columns: ["Item Barcode"],
                        filters: [{
                            column: "Item Barcode",
                            operator: "=",
                            value: barcode.toUpperCase()
                        }]
                    }
                });

                const soldJson = await existsInSold.json();
                if (soldJson.rows && soldJson.rows.length > 0) {
                    return {
                        ok: false,
                        message: `Barcode ${barcode} already exists in sold items`
                    };
                }

                // Check against existing barcodes in Ebay_Individual_Items
                const existsInInventory = await apiRequest('query', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Individual_Items",
                        columns: ["Item Barcode"],
                        filters: [{
                            column: "Item Barcode",
                            operator: "=",
                            value: barcode.toUpperCase()
                        }]
                    }
                });

                const inventoryJson = await existsInInventory.json();
                if (inventoryJson.rows && inventoryJson.rows.length > 0) {
                    return {
                        ok: false,
                        message: `Barcode ${barcode} already exists in inventory`
                    };
                }
            }

            return { ok: true, data };
        },

        /**
         * Handle post-insert logic
         * @param {Object} insertResult - Result from the insert operation
         * @param {Object} originalData - Original form data
         * @param {Array} uniqueValues - Unique field values
         */
        afterInsert: async (insertResult, originalData, uniqueValues) => {
            const itemId = insertResult.insertedId;
            const quantity = Number(originalData["Quantity"]) || 1;
            let soldCount = 0;

            // Create individual item records
            for (let i = 0; i < quantity; i++) {
                const barcode = (uniqueValues[i]?.["Item Barcode"] || originalData["Item Barcode"])
                    .charAt(0).toUpperCase() +
                    (uniqueValues[i]?.["Item Barcode"] || originalData["Item Barcode"]).slice(1);

                const individualData = {
                    "Item ID": itemId,
                    "Item Barcode": barcode,
                    "Date Inventoried": formatDateTimeLocal(),
                    "Date Listed": originalData["Date Listed"] || null,
                    "Date Sold": originalData["Date Sold"] || null,
                    "Price": originalData["Price"] || null,
                    "Is Listed": originalData["Date Listed"] ? 1 : 0,
                };

                await apiRequest('insert', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Individual_Items",
                        data: individualData
                    }
                });

                // If item is already sold, SQL trigger will move it
                // We delete from individual items after trigger runs
                if (originalData["Date Sold"]) {
                    soldCount++;
                    await apiRequest('delete', {
                        method: 'POST',
                        body: {
                            table: "Ebay_Individual_Items",
                            pkColumn: "Item Barcode",
                            pkValue: barcode
                        }
                    });
                }
            }

            // If all items were sold, delete the parent inventory record
            if (soldCount === quantity) {
                await apiRequest('delete', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Inventory",
                        pkColumn: "Item ID",
                        pkValue: itemId
                    }
                });
            }

            return {
                ok: true,
                message: `Inserted ${quantity} item(s) successfully`
            };
        },

        /**
         * Validate and format data before update
         */
        beforeUpdate: async (data, uniqueValues) => {
            // Validate Location ID format
            const locationId = data["Location ID"];
            const locationRegex = /^[a-zA-Z]-\d$/;

            if (!locationRegex.test(locationId)) {
                return {
                    ok: false,
                    message: "Invalid format for Location ID. Expected 'Letter-Digit'"
                };
            }

            const [letter, digit] = locationId.split('-');
            data["Location ID"] = `${letter.toUpperCase()}-${digit}`;

            // Get original quantity
            const qtyResponse = await apiRequest('query', {
                method: 'POST',
                body: {
                    table: "Ebay_Inventory",
                    columns: ["Quantity"],
                    filters: [{
                        column: "Item ID",
                        operator: "=",
                        value: data["Item ID"]
                    }]
                }
            });

            const qtyJson = await qtyResponse.json();
            const initialQuantity = Number(qtyJson.rows[0]?.['Quantity']) || 0;
            const updatedQuantity = Number(data["Quantity"]) || initialQuantity;

            // Validate new barcodes being added
            const barcodeRegex = /^[eE]\d{5}$/;
            for (let i = initialQuantity; i < updatedQuantity; i++) {
                const barcode = uniqueValues[i]?.["Item Barcode"] || data["Item Barcode"];

                if (!barcodeRegex.test(barcode)) {
                    return {
                        ok: false,
                        message: `Invalid barcode format: ${barcode}. Expected 'EXXXXX'`
                    };
                }
            }

            // Store initial quantity in data for afterUpdate
            data._initialQuantity = initialQuantity;

            return { ok: true, data };
        },

        /**
         * Handle post-update logic
         */
        afterUpdate: async (updateResult, originalData, uniqueValues) => {
            const initialQuantity = originalData._initialQuantity || 0;
            const updatedQuantity = Number(originalData["Quantity"]) || initialQuantity;

            // Get original price for new items
            const priceResponse = await apiRequest('query', {
                method: 'POST',
                body: {
                    table: "Ebay_Individual_Items",
                    columns: ["Price"],
                    filters: [{
                        column: "Item ID",
                        operator: "=",
                        value: originalData["Item ID"]
                    }],
                    limit: 1
                }
            });

            const priceJson = await priceResponse.json();
            const originalPrice = Number(priceJson.rows[0]?.["Price"]) || null;

            // Insert additional items if quantity increased
            for (let i = initialQuantity; i < updatedQuantity; i++) {
                const barcode = (uniqueValues[i]?.["Item Barcode"] || originalData["Item Barcode"])
                    .charAt(0).toUpperCase() +
                    (uniqueValues[i]?.["Item Barcode"] || originalData["Item Barcode"]).slice(1);

                const itemData = {
                    "Item ID": originalData["Item ID"],
                    "Item Barcode": barcode,
                    "Date Inventoried": formatDateTimeLocal(),
                    "Date Listed": null,
                    "Date Sold": null,
                    "Price": originalPrice,
                    "Is Listed": 0
                };

                await apiRequest('insert', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Individual_Items",
                        data: itemData
                    }
                });
            }

            return {
                ok: true,
                message: "Inventory updated successfully"
            };
        },

        /**
         * Fetch additional data when loading a record for update
         */
        onFetch: async (record, setUniqueValues) => {
            const itemId = record["Item ID"];
            if (!itemId) return { ok: true, record };

            try {
                // Fetch all barcodes for this item group
                const response = await apiRequest('query', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Individual_Items",
                        columns: ["Item Barcode"],
                        filters: [{
                            column: "Item ID",
                            operator: "=",
                            value: itemId
                        }],
                        orderBy: [{ column: "Item Barcode", direction: "ASC" }]
                    }
                });

                const json = await response.json();
                const rows = json.rows || [];

                // Build unique values array
                const uniqueArr = rows.map(row => ({
                    "Item Barcode": row["Item Barcode"]
                }));

                if (typeof setUniqueValues === 'function') {
                    setUniqueValues(uniqueArr);
                }

                return { ok: true, record };
            } catch (err) {
                return {
                    ok: false,
                    message: `Failed to load item barcodes: ${err.message}`
                };
            }
        }
    },

    ebay_individual_items: {
        beforeUpdate: async (data, uniqueValues) => {
            // No special validation needed
            return { ok: true, data };
        },

        afterUpdate: async (updateResult, originalData, uniqueValues) => {
            const sold = originalData["Date Sold"] != null && originalData["Date Sold"] !== "";

            if (sold) {
                // Delete from individual items (trigger will have moved to sold)
                await apiRequest('delete', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Individual_Items",
                        pkColumn: "Item Barcode",
                        pkValue: originalData["Item Barcode"]
                    }
                });

                // Check if parent inventory record should be deleted
                const qtyResponse = await apiRequest('query', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Inventory",
                        columns: ["Quantity"],
                        filters: [{
                            column: "Item ID",
                            operator: "=",
                            value: originalData["Item ID"]
                        }]
                    }
                });

                const qtyJson = await qtyResponse.json();
                const quantity = Number(qtyJson.rows[0]?.['Quantity']) || 0;

                if (quantity <= 0) {
                    await apiRequest('delete', {
                        method: 'POST',
                        body: {
                            table: "Ebay_Inventory",
                            pkColumn: "Item ID",
                            pkValue: originalData["Item ID"]
                        }
                    });
                }
            }

            return { ok: true, message: "Item updated successfully" };
        }
    },

    ebay_sold: {
        afterUpdate: async (updateResult, originalData, uniqueValues) => {
            const unsold = !originalData["Date Sold"];

            if (unsold) {
                // Remove from sold table (trigger will move back to inventory)
                await apiRequest('delete', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Sold",
                        pkColumn: "Item Barcode",
                        pkValue: originalData["Item Barcode"]
                    }
                });
            }

            return { ok: true, message: "Sold item updated successfully" };
        }
    },

    class_and_mtg_availability: {
        beforeInsert: async (data, uniqueValues) => {
            // Check if reservation exists
            const response = await apiRequest('query', {
                method: 'POST',
                body: {
                    table: "Class_Reservations",
                    columns: ["Auto ID", "Reservation"],
                    filters: [{
                        column: "Reservation",
                        operator: "=",
                        value: data["Reservation"]
                    }]
                }
            });

            const json = await response.json();
            const existingId = json.rows[0]?.["Auto ID"];

            if (existingId) {
                // Store the ID for afterInsert
                data._reservationId = existingId;
            }

            return { ok: true, data };
        },

        afterInsert: async (insertResult, originalData, uniqueValues) => {
            let reservationId = originalData._reservationId;

            // Create reservation if it doesn't exist
            if (!reservationId) {
                const resResponse = await apiRequest('insert', {
                    method: 'POST',
                    body: {
                        table: "Class_Reservations",
                        data: { "Reservation": originalData["Reservation"] }
                    }
                });

                const resJson = await resResponse.json();
                reservationId = resJson.insertedId;
            }

            // Insert participant
            const participantData = {
                "Reservation ID": reservationId,
                "Veteran Name": originalData["Veteran Name"] || null,
                "Email": originalData["Email"] || null,
                "Product Inventory Item": originalData["Product Inventory Item"] || null,
                "VIPLA": originalData["VIPLA"] || null
            };

            await apiRequest('insert', {
                method: 'POST',
                body: {
                    table: "Class_Reservation_Participants",
                    data: participantData
                }
            });

            return {
                ok: true,
                message: `Added participant to ${originalData["Reservation"]} reservation`
            };
        }
    }
};

/**
 * Check if a table has validation rules
 */
export function hasValidationRules(tableName) {
    return tableName && tableValidationRules[tableName.toLowerCase()];
}

/**
 * Get validation rules for a table
 */
export function getValidationRules(tableName) {
    if (!tableName) return null;
    return tableValidationRules[tableName.toLowerCase()] || null;
}