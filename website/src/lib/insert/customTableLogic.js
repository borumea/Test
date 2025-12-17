import { formatDateTimeLocal, formatDateTimeUTC } from "./insertNormalization";
import { apiRequest } from '../api';

/**
 * Map of custom insert logic handlers keyed by table name
 */
export const customInsertHandlers = {
    ebay_inventory: async (data, uniqueData, fetchFn) => {
        /**
         * data: normalized formData from InsertPage
         * fetchFn: function to call backend, e.g., fetch API
         * 
         * 1. Insert into Ebay_Inventory
         * 2. Use inserted id to create x rows in Ebay_Individual_Items
         */

        // singleLetter-singleDigitNumber format validation and uppercase letter
        var itemLocationId = data["Location ID"];
        const regex = /^[a-zA-Z]-\d$/;
        if (!regex.test(itemLocationId)) {
            return { ok: false, message: "Invalid format for Location ID. Expected 'Letter-Digit'" };
        }

        const parts = itemLocationId.split('-');
        const letter = parts[0];
        const digit = parts[1];
        itemLocationId = `${letter.toUpperCase()}-${digit}`;

        // Prepare inventory record
        const inventoryData = {
            "Quantity": Number(data["Quantity"]) || 1,
            "Rack Number": data["Rack Number"] ?? null,
            "Location ID": itemLocationId ?? null,
            "Model": data["Model"] ?? null,
        };
        const quantity = inventoryData["Quantity"];

        // Verify all barcodes are valid format before any insertion
        for (let i = 0; i < quantity; i++) {
            var barcodeToInsert = data["Item Barcode"];
            if (uniqueData[i] && uniqueData[i]["Item Barcode"]) {
                barcodeToInsert = uniqueData[i]["Item Barcode"]
            }

            // Verify barcode is EXXXXX oe eXXXXX format
            const barcodeRegex = /^[eE]\d{5}$/;
            if (!barcodeRegex.test(barcodeToInsert)) {
                return { ok: false, message: `Invalid format for Item Barcode: ${barcodeToInsert}. Expected 'EXXXXX'` };
            }

            // Verify barcode uniqueness compared to all barcodes recieved in payload
            for (let j = 0; j < i; j++) {
                var otherBarcode = uniqueData[j]["Item Barcode"] ?? data["Item Barcode"] ?? null;
                if (barcodeToInsert === otherBarcode) {
                    return { ok: false, message: `Duplicate barcode detected in input: ${barcodeToInsert}` };
                }
            }
        }

        // Insert inventory
        // const resInventory = await fetch("/api/insert", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify({ table: "Ebay_Inventory", data: inventoryData }),
        // });

        const resInventory = await apiRequest('insert', {
            method: 'POST',
            body: {
                table: "Ebay_Inventory",
                data: inventoryData
            }
        });

        const inventoryJson = await resInventory.json();
        if (!resInventory.ok) throw new Error(inventoryJson?.error || "Failed to insert into Ebay_Inventory");

        const itemId = inventoryJson.insertedId

        // Insert x individual items
        var counter = 0;
        for (let i = 0; i < quantity; i++) {
            var barcodeToInsert = data["Item Barcode"];
            if (uniqueData[i] && uniqueData[i]["Item Barcode"]) {
                barcodeToInsert = uniqueData[i]["Item Barcode"]
            }

            // Ensure uppercase E
            barcodeToInsert = barcodeToInsert.charAt(0).toUpperCase() + barcodeToInsert.slice(1);

            // Prepare individual item record
            const individualData = {
                "Item ID": itemId,
                "Item Barcode": barcodeToInsert,
                "Date Inventoried": formatDateTimeLocal(),
                "Date Listed": data["Date Listed"] || null,
                "Date Sold": data["Date Sold"] || null,
                "Price": data["Price"] ?? null,
                "Is Listed": data["Date Listed"] ? 1 : 0,
                "Last Modified": formatDateTimeLocal(),
            };

            // await fetch("/api/insert", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify({ table: "Ebay_Individual_Items", data: individualData }),
            // });

            const res = await apiRequest('insert', {
                method: 'POST',
                body: {
                    table: "Ebay_Individual_Items",
                    data: individualData
                }
            });

            // SQL trigger moves it to sold if date_sold, so we can delete it
            const sold = data["Date Sold"] != null && data["Date Sold"] != "";
            if (sold) {
                counter++;
                // const res = await fetch("/api/delete", {
                //     method: "POST",
                //     headers: { "Content-Type": "application/json" },
                //     body: JSON.stringify({
                //         table: "Ebay_Individual_Items",
                //         pkColumn: "Item Barcode",
                //         pkValue: uniqueData[i]["Item Barcode"],
                //     }),
                // });

                const res = await apiRequest('delete', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Individual_Items",
                        pkColumn: "Item Barcode",
                        pkValue: uniqueData[i]["Item Barcode"],
                    }
                });

                if (!res.ok) {
                    return { ok: false, message: `Failed to transfer sold item ${data["Iterm Barcode"]} to sold table` };
                }
            }
        }

        // Delete item group if it no longer has corresponding items
        if (counter == quantity) {
            // const res = await fetch("/api/delete", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify({
            //         table: "Ebay_Inventory",
            //         pkColumn: "Item ID",
            //         pkValue: data["Item ID"],
            //     }),
            // });

            const res = await apiRequest('delete', {
                method: 'POST',
                body: {
                    table: "Ebay_Inventory",
                    pkColumn: "Item ID",
                    pkValue: data["Item ID"],
                }
            });

            if (!res.ok) {
                return { ok: false, message: `Failed to delete empty item group ${data["Item ID"]}` };
            }
        }

        return { ok: true, message: `Inserted ${quantity} item(s)` };
    },
    class_and_mtg_availability: async (data, uniqueData, fetchFn) => {
        // Prepare inventory record
        const reservationData = {
            "Reservation": data["Reservation"],
        };
        const reservation = reservationData["Reservation"];

        const payload = {
            table: "Class_Reservations",
            columns: ["Auto ID", "Reservation"],
            filters: [{
                column: "Reservation",
                operator: "=",
                value: reservation
            }],
        };

        // const res = await fetch("/api/query", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify(payload),
        // });

        const res = await apiRequest('query', {
            method: 'POST',
            body: payload
        });

        if (!res.ok) {
            return { ok: false, message: "Class_Reservations handler: failed to check reservations" };
        }

        const itemsJson = await res.json().catch(() => ({}));
        const rows = itemsJson.rows;
        var ID = rows[0]?.["Auto ID"];

        if (ID === null || ID === undefined) {
            // Insert reservation (class)
            // const resReservation = await fetch("/api/insert", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify({ table: "Class_Reservations", data: reservationData }),
            // });

            const resReservation = await apiRequest('insert', {
                method: 'POST',
                body: {
                    table: "Class_Reservations",
                    data: reservationData
                }
            });

            const reservationJson = await resReservation.json();
            if (!resReservation.ok) throw new Error(reservationJson?.error || "Failed to insert into Class_Reservation");
            ID = reservationJson.insertedId
        }

        // Insert into Participants with ID
        const participantData = {
            "Reservation ID": ID,
            "Veteran Name": data["Veteran Name"] ?? null,
            "Email": data["Email"] ?? null,
            "Product Inventory Item": data["Product Inventory Item"] ?? null,
            "VIPLA": data["VIPLA"] ?? null,
            "Last Modified": formatDateTimeLocal(),
        };

        // const resParticipant = await fetch("/api/insert", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify({ table: "Class_Reservation_Participants", data: participantData }),
        // });

        const resParticipant = await apiRequest('insert', {
            method: 'POST',
            body: {
                table: "Class_Reservation_Participants",
                data: participantData
            }
        });

        const participantJson = await resParticipant.json();
        if (!resParticipant.ok) throw new Error(participantJson?.error || "Failed to insert into Class_Reservation_Participants");

        return { ok: true, message: `Inserted participant for reservation on ${reservation}` };
    },
};

/**
 * Map of custom update logic handlers keyed by table name
 */
export const customFetchHandlers = {
    ebay_inventory: async (rawRecord, setUniqueValues, { fetch: fetchFn }) => {
        // clones so we don't mutate external object
        const record = { ...rawRecord };

        const itemId = record["Item ID"];
        if (!itemId) {
            // No Item ID, just return the record as-is (this is valid for new records)
            return record;
        }

        try {
            const payload = {
                table: "Ebay_Individual_Items",
                columns: ["Item Barcode"],
                filters: [{
                    column: "Item ID",
                    operator: "=",
                    value: record["Item ID"]
                }],
                orderBy: "Item Barcode"
            };

            // const res = await fetchFn("/api/query", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify(payload),
            // });

            const res = await apiRequest('query', {
                method: 'POST',
                body: payload
            });

            if (!res.ok) {
                const errorText = await res.text().catch(() => "Unknown error");
                throw new Error(`Failed to fetch individual items: ${errorText}`);
            }

            const itemsJson = await res.json().catch(() => ({}));
            const rows = itemsJson.rows || [];

            // number of duplicated unique rows we must populate (guard against NaN)
            const qty = Number(record["Quantity"]) || 0;

            const colName = "Item Barcode";
            const uniqueArr = [];

            // Build array of objects keyed by column name to match InsertPage's expectation:
            // uniqueValues[i][col] should contain the value.
            for (let i = 0; i < qty; i++) {
                const it = rows[i];
                const barcode = it ? (it[colName] ?? null) : null;
                uniqueArr.push({ [colName]: barcode });
            }

            // setUniqueValues is the setter passed from InsertPage/ForeignKeyPopup
            if (typeof setUniqueValues === 'function') {
                setUniqueValues(uniqueArr);
            }

            // Return the record (success case - no ok property needed)
            return record;
        } catch (err) {
            // Return error object for the caller to handle
            return {
                ok: false,
                message: `Ebay_Inventory customFetchHandler error: ${err.message || err}`
            };
        }
    },
};

export const customUpdateHandlers = {
    ebay_inventory: async (data, uniqueData, fetchFn) => {
        // Retrive data from first item in item group
        const payload1 = {
            table: "Ebay_Individual_Items",
            columns: ["Price"],
            filters: [{
                column: "Item ID",
                operator: "=",
                value: data["Item ID"]
            }],
            limit: 1
        };

        // const res1 = await fetch("/api/query", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify(payload1),
        // });

        const res1 = await apiRequest('query', {
            method: 'POST',
            body: payload1
        });

        if (!res1.ok) {
            return { ok: false, message: "Ebay_Inventory handler: failed to update" };
        }

        const returnedDataItem = await res1.json().catch(() => ({}));
        const originalItemPrice = Number(returnedDataItem.rows[0]["Price"]);

        // Retrieve original quantity information
        const payload2 = {
            table: "Ebay_Inventory",
            columns: ["Quantity"],
            filters: [{
                column: "Item ID",
                operator: "=",
                value: data["Item ID"]
            }],
        };

        // const res2 = await fetch("/api/query", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify(payload2),
        // });

        const res2 = await apiRequest('query', {
            method: 'POST',
            body: payload2
        });

        if (!res2.ok) {
            return { ok: false, message: "Ebay_Inventory handler: failed to update" };
        }

        const returnedData = await res2.json().catch(() => ({}));
        const initialQuantity = Number(returnedData.rows[0]['Quantity']);
        const updatedQuantity = Number(data["Quantity"]) || initialQuantity;

        // singleLetter-singleDigitNumber format validation and uppercase letter
        var itemLocationId = data["Location ID"];
        const regex = /^[a-zA-Z]-\d$/;
        if (!regex.test(itemLocationId)) {
            return { ok: false, message: "Invalid format for Location ID. Expected 'Letter-Digit'" };
        }

        // Check barcode format for new items being added
        for (var i = 0; i < updatedQuantity; i++) {
            if (!(i < initialQuantity)) {
                var barcodeToInsert = data["Item Barcode"];
                if (uniqueData[i] && uniqueData[i]["Item Barcode"]) {
                    barcodeToInsert = uniqueData[i]["Item Barcode"]
                }

                // Verify barcode is EXXXXX oe eXXXXX format
                const barcodeRegex = /^[eE]\d{5}$/;
                if (!barcodeRegex.test(barcodeToInsert)) {
                    return { ok: false, message: `Invalid format for Item Barcode: ${barcodeToInsert}. Expected 'EXXXXX'` };
                }
            }
        }

        const parts = itemLocationId.split('-');
        const letter = parts[0];
        const digit = parts[1];
        itemLocationId = `${letter.toUpperCase()}-${digit}`;

        // Update item group first
        // const res = await fetch("/api/update", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify({
        //         table: "Ebay_Inventory",
        //         pkColumn: "Item ID",
        //         pkValue: data["Item ID"],
        //         data: data,
        //     }),
        // });

        const res = await apiRequest('update', {
            method: 'POST',
            body: {
                table: "Ebay_Inventory",
                pkColumn: "Item ID",
                pkValue: data["Item ID"],
                data: data,
            }
        });

        if (!res.ok) {
            return { ok: false, message: "Ebay_Inventory handler: failed to update" };
        }

        for (var i = 0; i < updatedQuantity; i++) {
            if (!(i < initialQuantity)) {
                var barcodeToInsert = data["Item Barcode"];
                if (uniqueData[i] && uniqueData[i]["Item Barcode"]) {
                    barcodeToInsert = uniqueData[i]["Item Barcode"]
                }

                const itemData = {
                    "Item ID": data["Item ID"],
                    "Item Barcode": barcodeToInsert,
                    "Date Inventoried": new Date().toISOString().split("T")[0],
                    "Date Listed": null,
                    "Date Sold": null,
                    "Price": originalItemPrice,
                    "Is Listed": 0,
                    "Last Modified": formatDateTimeLocal(),
                };

                // Insert items
                // const resItem = await fetch("/api/insert", {
                //     method: "POST",
                //     headers: { "Content-Type": "application/json" },
                //     body: JSON.stringify({ table: "Ebay_Individual_Items", data: itemData }),
                // });

                const resItem = await apiRequest('insert', {
                    method: 'POST',
                    body: {
                        table: "Ebay_Individual_Items",
                        data: itemData
                    }
                });

                const itemJson = await resItem.json();
                if (!resItem.ok) throw new Error(itemJson?.error || "Failed to insert into Ebay_Individual_Items from Ebay_Inventory update");
            }
        }

        return { ok: true, message: `Successfully updated inventory record` };
    },
    ebay_individual_items: async (data, uniqueData, fetchFn) => {
        // Update item first
        // const res = await fetch("/api/update", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify({
        //         table: "Ebay_Individual_Items",
        //         pkColumn: "Item Barcode",
        //         pkValue: data["Item Barcode"],
        //         data: data,
        //     }),
        // });

        const res = await apiRequest('update', {
            method: 'POST',
            body: {
                table: "Ebay_Individual_Items",
                pkColumn: "Item Barcode",
                pkValue: data["Item Barcode"],
                data: data,
            }
        });

        if (!res.ok) {
            return { ok: false, message: "Failed to update" };
        }

        const sold = data["Date Sold"] != null && data["Date Sold"] != "";
        if (sold) {
            // const res = await fetch("/api/delete", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify({
            //         table: "Ebay_Individual_Items",
            //         pkColumn: "Item Barcode",
            //         pkValue: data["Item Barcode"],
            //     }),
            // });

            const res = await apiRequest('delete', {
                method: 'POST',
                body: {
                    table: "Ebay_Individual_Items",
                    pkColumn: "Item Barcode",
                    pkValue: data["Item Barcode"],
                }
            });

            if (!res.ok) {
                return { ok: false, message: `Item delete after transfer to sold table failed` };
            } else {
                // Check if item group still has quantity > 0
                const payload = {
                    table: "Ebay_Inventory",
                    columns: ["Quantity"],
                    filters: [{
                        column: "Item ID",
                        operator: "=",
                        value: data["Item ID"]
                    }],
                };

                // const res2 = await fetch("/api/query", {
                //     method: "POST",
                //     headers: { "Content-Type": "application/json" },
                //     body: JSON.stringify(payload),
                // });

                const res2 = await apiRequest('query', {
                    method: 'POST',
                    body: payload
                });

                if (!res2.ok) {
                    return { ok: false, message: `Failed to retrieve quantity for item group ${data["Item ID"]}` };
                }

                const returnedData = await res2.json().catch(() => ({}));
                const quantity = Number(returnedData.rows[0]['Quantity']);

                // Delete item group if quantity <= 0
                if (quantity <= 0) {
                    // const res3 = await fetch("/api/delete", {
                    //     method: "POST",
                    //     headers: { "Content-Type": "application/json" },
                    //     body: JSON.stringify({
                    //         table: "Ebay_Inventory",
                    //         pkColumn: "Item ID",
                    //         pkValue: data["Item ID"],
                    //     }),
                    // });

                    const res3 = await apiRequest('delete', {
                        method: 'POST',
                        body: {
                            table: "Ebay_Inventory",
                            pkColumn: "Item ID",
                            pkValue: data["Item ID"],
                        }
                    });

                    if (!res3.ok) {
                        return { ok: false, message: `Failed to delete empty item group ${data["Item ID"]}` };
                    }
                }
            }
        }

        return { ok: true, message: `Successfully updated item record` };
    },
    ebay_sold: async (data, uniqueData, fetchFn) => {
        // const res = await fetch("/api/update", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify({
        //         table: "Ebay_Sold",
        //         pkColumn: "Item Barcode",
        //         pkValue: data["Item Barcode"],
        //         data: data,
        //     }),
        // });

        const res = await apiRequest('update', {
            method: 'POST',
            body: {
                table: "Ebay_Sold",
                pkColumn: "Item Barcode",
                pkValue: data["Item Barcode"],
                data: data,
            }
        });

        if (!res.ok) {
            return { ok: false, message: `"Ebay_Inventory handler: failed to update" ${await res.text().catch(() => "")}` }
        }

        const unsold = data["Date Sold"] == null || data["Date Sold"] == "";
        if (unsold) {
            // const res2 = await fetch("/api/delete", {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify({
            //         table: "Ebay_Sold",
            //         pkColumn: "Item Barcode",
            //         pkValue: data["Item Barcode"],
            //     }),
            // });

            const res2 = await apiRequest('delete', {
                method: 'POST',
                body: {
                    table: "Ebay_Sold",
                    pkColumn: "Item Barcode",
                    pkValue: data["Item Barcode"],
                }
            });

            if (!res2.ok) {
                return { ok: false, message: `Failed to delete item ${data["Item Barcode"]} from sold table after date_sold was null` };
            }
        }
        return { ok: true, message: `Successfully updated item record` };
    },
    class_and_mtg_availability: async (data, uniqueData, fetchFn) => {

    },
};

/**
 * Custom field metadata for rendering forms
 */
export const customInsertFormFields = {
    ebay_inventory: [
        { name: "Item ID", type: "int", required: true, isPrimary: true, isNullable: false, maxLength: null, isAutoIncrement: true, isUnique: true },
        { name: "Quantity", type: "int", required: true, isPrimary: false, isNullable: false, maxLength: null, isAutoIncrement: false, isUnique: false },
        { name: "Item Barcode", type: "varchar", required: true, isPrimary: true, isNullable: false, maxLength: 100, isAutoIncrement: false, isUnique: true },
        { name: "Rack Number", type: "int", required: true, isPrimary: false, isNullable: false, maxLength: null, isAutoIncrement: false, isUnique: false },
        { name: "Location ID", type: "varchar", required: true, isPrimary: false, isNullable: false, maxLength: 100, isAutoIncrement: false, isUnique: false },
        { name: "Date Inventoried", type: "date", required: true, isPrimary: false, isNullable: false, maxLength: null, isAutoIncrement: false, isUnique: false },
        { name: "Date Listed", type: "date", required: false, isPrimary: false, isNullable: true, maxLength: null, isAutoIncrement: false, isUnique: false },
        { name: "Date Sold", type: "date", required: false, isPrimary: false, isNullable: true, maxLength: null, isAutoIncrement: false, isUnique: false },
        { name: "Price", type: "decimal", required: false, isPrimary: false, isNullable: true, maxLength: null, isAutoIncrement: false, isUnique: false },
        { name: "Model", type: "varchar", required: false, isPrimary: false, isNullable: true, maxLength: 100, isAutoIncrement: false, isUnique: false },
        { name: "Last Modified", type: "datetime", required: true, isPrimary: false, isNullable: false, maxLength: null, isAutoIncrement: false, isUnique: false },
        { name: "Is Listed", type: "bit", required: true, isPrimary: false, isNullable: false, maxLength: null, isAutoIncrement: false, isUnique: false },
    ],
};

/**
 * Custom field metadata for rendering forms
 */
export const customUpdateFormFields = {
    ebay_inventory: [
        { name: "Item ID", type: "int", required: true, isPrimary: true, isNullable: false, maxLength: null, isAutoIncrement: true, isUnique: true },
        { name: "Quantity", type: "int", required: true, isPrimary: false, isNullable: false, maxLength: null, isAutoIncrement: false, isUnique: false },
        { name: "Item Barcode", type: "varchar", required: true, isPrimary: true, isNullable: false, maxLength: 100, isAutoIncrement: false, isUnique: true },
        { name: "Rack Number", type: "int", required: true, isPrimary: false, isNullable: false, maxLength: null, isAutoIncrement: false, isUnique: false },
        { name: "Location ID", type: "varchar", required: true, isPrimary: false, isNullable: false, maxLength: 100, isAutoIncrement: false, isUnique: false },
        { name: "Model", type: "varchar", required: false, isPrimary: false, isNullable: true, maxLength: 100, isAutoIncrement: false, isUnique: false },
        { name: "Last Modified", type: "datetime", required: true, isPrimary: false, isNullable: false, maxLength: null, isAutoIncrement: false, isUnique: false },
    ],
};