// src/lib/print.js
import * as XLSX from 'xlsx';

/**
 * exportToExcel
 * -------------
 * Exports data to an Excel file (.xlsx) with proper formatting
 * 
 * @param {Object[]} allResults - The full dataset to export
 * @param {string[]} headerCols - Column headers
 * @param {Object[]} columnsMeta - Column metadata
 * @param {Function} renderCell - Function to format cell values (MUST USE THIS!)
 * @param {string} filename - Name for the exported file
 */
export function exportToExcel({ allResults, headerCols, columnsMeta, renderCell, filename = 'export.xlsx' }) {
    try {
        // Create worksheet data
        const worksheetData = [];

        // Add headers
        worksheetData.push(headerCols);

        // Add data rows - USE FORMATTED VALUES
        allResults.forEach(row => {
            const rowData = headerCols.map(col => {
                const val = row[col];
                const colMeta = columnsMeta.find(c => c.name === col);
                // This is the key: use renderCell to get formatted value
                const displayValue = renderCell(val, colMeta, col, row);

                // Convert to appropriate type for Excel
                if (displayValue === null || displayValue === undefined || displayValue === '') return '';

                // If it's already a number, keep it as number
                if (typeof displayValue === 'number') return displayValue;

                // Try to parse as number (for formatted numbers like "1,234.56")
                const strValue = String(displayValue);
                const numValue = parseFloat(strValue.replace(/,/g, ''));
                if (!isNaN(numValue) && strValue.match(/^[\d,.-]+$/)) {
                    return numValue;
                }

                // Otherwise return as formatted string
                return strValue;
            });
            worksheetData.push(rowData);
        });

        // Create workbook and worksheet
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(worksheetData);

        // Auto-size columns
        const colWidths = headerCols.map((header, i) => {
            const maxLength = Math.max(
                header.length,
                ...worksheetData.slice(1).map(row => String(row[i] || '').length)
            );
            return { wch: Math.min(maxLength + 2, 50) }; // Max width of 50
        });
        ws['!cols'] = colWidths;

        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Data');

        // Generate file and trigger download
        XLSX.writeFile(wb, filename);

        return true;
    } catch (error) {
        console.error('Error exporting to Excel:', error);
        alert('Failed to export to Excel. Please try again.');
        return false;
    }
}

/**
 * printAllResultsTable
 * --------------------
 * Prints all data from the results table with option to export instead
 */
export function printAllResultsTable({ allResults, headerCols, columnsMeta, renderCell, title }) {
    const printWindow = window.open('', '_blank');

    if (!printWindow) {
        alert('Please allow popups to print');
        return;
    }

    // Build table HTML for printing
    let tableHTML = '<table>';

    // Header row
    tableHTML += '<thead><tr>';
    headerCols.forEach(col => {
        tableHTML += `<th>${escapeHtml(String(col))}</th>`;
    });
    tableHTML += '</tr></thead>';

    // Data rows - using renderCell for consistent formatting
    tableHTML += '<tbody>';
    allResults.forEach(row => {
        tableHTML += '<tr>';
        headerCols.forEach(col => {
            const val = row[col];
            const colMeta = columnsMeta.find(c => c.name === col);
            const displayValue = renderCell(val, colMeta, col, row);
            tableHTML += `<td>${escapeHtml(String(displayValue))}</td>`;
        });
        tableHTML += '</tr>';
    });
    tableHTML += '</tbody></table>';

    // Pre-format data for Excel export using renderCell
    const formattedDataForExport = allResults.map(row => {
        const formattedRow = {};
        headerCols.forEach(col => {
            const val = row[col];
            const colMeta = columnsMeta.find(c => c.name === col);
            const displayValue = renderCell(val, colMeta, col, row);

            // Store formatted value
            if (displayValue === null || displayValue === undefined || displayValue === '') {
                formattedRow[col] = '';
            } else if (typeof displayValue === 'number') {
                formattedRow[col] = displayValue;
            } else {
                const strValue = String(displayValue);
                const numValue = parseFloat(strValue.replace(/,/g, ''));
                formattedRow[col] = (!isNaN(numValue) && strValue.match(/^[\d,.-]+$/)) ? numValue : strValue;
            }
        });
        return formattedRow;
    });

    // Complete HTML document with export button
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${escapeHtml(title || 'Print Results')}</title>
            <style>
                @media print {
                    @page {
                        size: landscape;
                        margin: 0.5cm;
                    }
                    .no-print {
                        display: none !important;
                    }
                }
                
                body {
                    font-family: Arial, sans-serif;
                    font-size: 10pt;
                    margin: 0;
                    padding: 10px;
                }
                
                .action-buttons {
                    text-align: center;
                    margin-bottom: 20px;
                    padding: 10px;
                    background: #f5f5f5;
                    border-radius: 4px;
                }
                
                .action-buttons button {
                    margin: 0 10px;
                    padding: 10px 20px;
                    font-size: 14px;
                    cursor: pointer;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    background: white;
                }
                
                .action-buttons button:hover {
                    background: #e9e9e9;
                }
                
                h1 {
                    font-size: 14pt;
                    margin-bottom: 10px;
                    text-align: center;
                }
                
                .info {
                    text-align: center;
                    margin-bottom: 10px;
                }
                
                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: auto;
                }
                
                th, td {
                    border: 1px solid #ddd;
                    padding: 4px 6px;
                    text-align: left;
                    word-wrap: break-word;
                    max-width: 200px;
                    overflow: hidden;
                    font-size: 9pt;
                }
                
                th {
                    background-color: #f2f2f2;
                    font-weight: bold;
                    position: sticky;
                    top: 0;
                }
                
                tr:nth-child(even) {
                    background-color: #f9f9f9;
                }
                
                tr {
                    page-break-inside: avoid;
                }
            </style>
            <script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
        </head>
        <body>
            <div class="action-buttons no-print">
                <button onclick="window.print()">🖨️ Print / Save as PDF</button>
                <button onclick="exportToExcel()">📊 Export to Excel</button>
                <button onclick="exportToCSV()">📄 Export to CSV</button>
                <button onclick="window.close()">✕ Close</button>
            </div>
            
            <h1>${escapeHtml(title || 'Search Results')}</h1>
            <p class="info">Total Records: ${allResults.length}</p>
            ${tableHTML}
            
            <script>
                // Pass FORMATTED data to the print window
                window.tableData = ${JSON.stringify({
        formattedData: formattedDataForExport,
        headerCols,
        title: title || 'export'
    })};
                
                function exportToExcel() {
                    try {
                        const { formattedData, headerCols, title } = window.tableData;
                        
                        // Create worksheet data using pre-formatted values
                        const worksheetData = [headerCols];
                        
                        formattedData.forEach(row => {
                            const rowData = headerCols.map(col => {
                                const val = row[col];
                                if (val === null || val === undefined || val === '') return '';
                                return val;
                            });
                            worksheetData.push(rowData);
                        });
                        
                        // Create workbook
                        const wb = XLSX.utils.book_new();
                        const ws = XLSX.utils.aoa_to_sheet(worksheetData);
                        
                        // Auto-size columns
                        const colWidths = headerCols.map((header, i) => {
                            const maxLength = Math.max(
                                header.length,
                                ...worksheetData.slice(1).map(row => String(row[i] || '').length)
                            );
                            return { wch: Math.min(maxLength + 2, 50) };
                        });
                        ws['!cols'] = colWidths;
                        
                        XLSX.utils.book_append_sheet(wb, ws, 'Data');
                        
                        // Generate filename with timestamp
                        const timestamp = new Date().toISOString().slice(0, 10);
                        const filename = title.replace(/[^a-z0-9]/gi, '_') + '_' + timestamp + '.xlsx';
                        
                        XLSX.writeFile(wb, filename);
                    } catch (error) {
                        console.error('Export error:', error);
                        alert('Failed to export. Please try again.');
                    }
                }
                
                function exportToCSV() {
                    try {
                        const { formattedData, headerCols, title } = window.tableData;
                        
                        // Create CSV content
                        let csvContent = headerCols.map(h => '"' + h.replace(/"/g, '""') + '"').join(',') + '\\n';
                        
                        formattedData.forEach(row => {
                            const rowData = headerCols.map(col => {
                                const val = row[col];
                                if (val === null || val === undefined || val === '') return '""';
                                // Escape quotes and wrap in quotes
                                return '"' + String(val).replace(/"/g, '""') + '"';
                            });
                            csvContent += rowData.join(',') + '\\n';
                        });
                        
                        // Create blob and download
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                        const link = document.createElement('a');
                        const url = URL.createObjectURL(blob);
                        
                        const timestamp = new Date().toISOString().slice(0, 10);
                        const filename = title.replace(/[^a-z0-9]/gi, '_') + '_' + timestamp + '.csv';
                        
                        link.setAttribute('href', url);
                        link.setAttribute('download', filename);
                        link.style.visibility = 'hidden';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    } catch (error) {
                        console.error('CSV export error:', error);
                        alert('Failed to export CSV. Please try again.');
                    }
                }
            </script>
        </body>
        </html>
    `;

    const doc = printWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * printReport
 * -----------
 * Prints a multi-section report with export option
 */
export function printReport({ report, params, results }) {
    const printFrame = document.createElement("iframe");
    printFrame.style.position = "fixed";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    document.body.appendChild(printFrame);

    const paramSummary = Object.entries(params)
        .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${v}</td></tr>`)
        .join("");

    const sectionsHtml = Object.entries(results)
        .map(([id, section]) => `
        <h2>${section.label}</h2>
        <p><strong>Total items:</strong> ${section.rows.length}</p>
        <table>
            <thead>
            <tr>${Object.keys(section.rows[0] || {}).map(c => `<th>${c}</th>`).join("")}</tr>
            </thead>
            <tbody>
            ${section.rows
                .map(
                    row =>
                        `<tr>${Object.values(row)
                            .map(v => `<td>${String(v)}</td>`)
                            .join("")}</tr>`
                )
                .join("")}
            </tbody>
        </table>
    `)
        .join("<hr/>");

    const runDate = new Date().toLocaleString();
    const html = `
    <html>
      <head>
        <title>${report.name}</title>
        <style>
            @media print {
                .no-print {
                    display: none !important;
                }
                @page { size: auto; margin: 15mm; }
            }

            body { 
                font-family: Arial, sans-serif; 
                padding: 20px; 
            }
            
            .action-buttons {
                text-align: center;
                margin-bottom: 20px;
                padding: 10px;
                background: #f5f5f5;
                border-radius: 4px;
            }
            
            .action-buttons button {
                margin: 0 10px;
                padding: 10px 20px;
                font-size: 14px;
                cursor: pointer;
                border: 1px solid #ccc;
                border-radius: 4px;
                background: white;
            }
            
            .action-buttons button:hover {
                background: #e9e9e9;
            }
            
            h1, h2, h3 { 
                text-align: center; 
                margin: 10px 0;
            }
            .run-date {
                text-align: center;
                font-style: italic;
                margin-bottom: 20px;
                color: #666;
            }
            table { 
                border-collapse: collapse; 
                width: 100%; 
                margin-bottom: 20px; 
            }
            th, td { 
                border: 1px solid #ccc; 
                padding: 8px; 
                text-align: left; 
                font-size: 0.9rem; 
            }
            th { background: #f5f5f5; }
            tr:nth-child(even) td { background: #fafafa; }
            hr { margin: 30px 0; border: none; border-top: 2px solid #eee; }
        </style>
        <script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
      </head>
      <body>
        <div class="action-buttons no-print">
            <button onclick="window.print()">🖨️ Print / Save as PDF</button>
            <button onclick="exportReportToExcel()">📊 Export to Excel</button>
            <button onclick="exportReportToCSV()">📄 Export to CSV</button>
        </div>
        
        <h1>${report.name}</h1>
        <div class="run-date">Generated on ${runDate}</div>
        <h3>Parameters</h3>
        <table>${paramSummary}</table>
        ${sectionsHtml}
        
        <script>
            // Results are already formatted by ReportRunner.normalizeRows()
            window.reportData = ${JSON.stringify({ report, params, results })};
            
            function exportReportToExcel() {
                try {
                    const { report, params, results } = window.reportData;
                    const wb = XLSX.utils.book_new();
                    
                    // Add parameters sheet
                    const paramsData = [
                        ['Parameter', 'Value'],
                        ...Object.entries(params)
                    ];
                    const paramsWs = XLSX.utils.aoa_to_sheet(paramsData);
                    XLSX.utils.book_append_sheet(wb, paramsWs, 'Parameters');
                    
                    // Add a sheet for each query result (data is already formatted)
                    Object.entries(results).forEach(([id, section]) => {
                        if (section.rows.length > 0) {
                            const headers = Object.keys(section.rows[0]);
                            const data = [
                                headers,
                                ...section.rows.map(row => headers.map(h => row[h] ?? ''))
                            ];
                            const ws = XLSX.utils.aoa_to_sheet(data);
                            
                            // Auto-size columns
                            const colWidths = headers.map((header, i) => {
                                const maxLength = Math.max(
                                    header.length,
                                    ...data.slice(1).map(row => String(row[i] || '').length)
                                );
                                return { wch: Math.min(maxLength + 2, 50) };
                            });
                            ws['!cols'] = colWidths;
                            
                            // Sanitize sheet name (Excel has limits)
                            const sheetName = section.label.substring(0, 31).replace(/[:\\/?*\\[\\]]/g, '_');
                            XLSX.utils.book_append_sheet(wb, ws, sheetName);
                        }
                    });
                    
                    // Generate filename
                    const timestamp = new Date().toISOString().slice(0, 10);
                    const filename = report.name.replace(/[^a-z0-9]/gi, '_') + '_' + timestamp + '.xlsx';
                    
                    XLSX.writeFile(wb, filename);
                } catch (error) {
                    console.error('Export error:', error);
                    alert('Failed to export report. Please try again.');
                }
            }
            
            function exportReportToCSV() {
                try {
                    const { report, params, results } = window.reportData;
                    let csvContent = '';
                    
                    // Add report title and date
                    csvContent += '"' + report.name + '"\\n';
                    csvContent += '"Generated on: ' + new Date().toLocaleString() + '"\\n\\n';
                    
                    // Add parameters
                    csvContent += '"Parameters"\\n';
                    Object.entries(params).forEach(([k, v]) => {
                        csvContent += '"' + k + '","' + String(v).replace(/"/g, '""') + '"\\n';
                    });
                    csvContent += '\\n';
                    
                    // Add each section
                    Object.entries(results).forEach(([id, section]) => {
                        csvContent += '"' + section.label + '"\\n';
                        
                        if (section.rows.length > 0) {
                            const headers = Object.keys(section.rows[0]);
                            csvContent += headers.map(h => '"' + h.replace(/"/g, '""') + '"').join(',') + '\\n';
                            
                            section.rows.forEach(row => {
                                const rowData = headers.map(h => {
                                    const val = row[h];
                                    if (val === null || val === undefined) return '""';
                                    return '"' + String(val).replace(/"/g, '""') + '"';
                                });
                                csvContent += rowData.join(',') + '\\n';
                            });
                        }
                        csvContent += '\\n';
                    });
                    
                    // Create blob and download
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    
                    const timestamp = new Date().toISOString().slice(0, 10);
                    const filename = report.name.replace(/[^a-z0-9]/gi, '_') + '_' + timestamp + '.csv';
                    
                    link.setAttribute('href', url);
                    link.setAttribute('download', filename);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } catch (error) {
                    console.error('CSV export error:', error);
                    alert('Failed to export CSV. Please try again.');
                }
            }
        </script>
      </body>
    </html>
  `;

    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    printFrame.onload = () => {
        printFrame.contentWindow.focus();
    };

    // Clean up after 30 seconds
    setTimeout(() => {
        if (document.body.contains(printFrame)) {
            document.body.removeChild(printFrame);
        }
    }, 30000);
}