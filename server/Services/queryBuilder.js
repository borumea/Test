// server/Services/queryBuilder.js
// Generalized SQL query builder for dynamic query construction

const { isValidOperator, isValidAggregateFunction } = require('../Utils/validators');

class QueryBuilder {
    constructor(table) {
        this.table = table;
        this.selectColumns = [];
        this.whereClauses = [];
        this.whereParams = [];
        this.orderByClauses = [];
        this.groupByColumn = null;
        this.aggregateFunc = null;
        this.aggregateColumn = null;
        this.limitValue = null;
        this.offsetValue = null;
    }

    /**
     * Set columns to select
     */
    select(columns) {
        if (Array.isArray(columns) && columns.length > 0) {
            this.selectColumns = columns.map(col => `\`${col}\``);
        } else if (columns === '*') {
            this.selectColumns = ['*'];
        }
        return this;
    }

    /**
     * Add WHERE conditions from filter objects
     * Filter format: { column, operator, value }
     */
    where(filters, allowedColumns) {
        if (!Array.isArray(filters)) return this;

        for (const filter of filters) {
            if (!filter || typeof filter !== 'object') continue;

            const { column, operator, value } = filter;
            
            // Validate column
            if (!allowedColumns.includes(column)) continue;

            // Validate operator
            const op = String(operator || '=').toUpperCase().trim();
            if (!isValidOperator(op)) continue;

            // Build condition based on operator type
            if (op === 'IN' && Array.isArray(value) && value.length > 0) {
                this.whereClauses.push(`\`${column}\` IN (${value.map(() => '?').join(',')})`);
                this.whereParams.push(...value);
            } else if (op === 'BETWEEN' && Array.isArray(value) && value.length >= 2) {
                this.whereClauses.push(`\`${column}\` BETWEEN ? AND ?`);
                this.whereParams.push(value[0], value[1]);
            } else if (op === 'IS' || op === 'IS NOT') {
                if (value === null || value === undefined) {
                    this.whereClauses.push(`\`${column}\` ${op} NULL`);
                } else {
                    this.whereClauses.push(`\`${column}\` ${op} ?`);
                    this.whereParams.push(value);
                }
            } else {
                this.whereClauses.push(`\`${column}\` ${op} ?`);
                this.whereParams.push(value);
            }
        }

        return this;
    }

    /**
     * Add ORDER BY clauses
     * Format: [{ column, direction: 'ASC'|'DESC' }] or ["column ASC", "column DESC"]
     */
    orderBy(orders, allowedColumns) {
        if (!orders) return this;

        const orderArray = Array.isArray(orders) ? orders : [orders];

        for (const order of orderArray) {
            if (!order) continue;

            let column, direction;

            if (typeof order === 'object' && order.column) {
                column = order.column;
                direction = (order.direction || 'ASC').toUpperCase();
            } else {
                // Parse "column ASC/DESC" format
                const parts = String(order).trim().split(/\s+/);
                column = parts.slice(0, -1).join(' ');
                const lastPart = parts[parts.length - 1].toUpperCase();
                direction = lastPart.startsWith('DESC') ? 'DESC' : 'ASC';
            }

            if (allowedColumns.includes(column)) {
                this.orderByClauses.push(`\`${column}\` ${direction}`);
            }
        }

        return this;
    }

    /**
     * Set GROUP BY column
     */
    groupBy(column, allowedColumns) {
        if (column && allowedColumns.includes(column)) {
            this.groupByColumn = column;
        }
        return this;
    }

    /**
     * Set aggregate function
     * Format: { func: 'COUNT', column: 'id' }
     */
    aggregate(aggConfig, allowedColumns) {
        if (!aggConfig || typeof aggConfig !== 'object') return this;

        const func = String(aggConfig.func || aggConfig.type || 'COUNT').toUpperCase();
        if (!isValidAggregateFunction(func)) return this;

        const column = aggConfig.column;
        if (column === '*' || allowedColumns.includes(column)) {
            this.aggregateFunc = func;
            this.aggregateColumn = column === '*' ? '*' : `\`${column}\``;
        }

        return this;
    }

    /**
     * Set LIMIT
     */
    limit(value) {
        if (typeof value === 'number' && value > 0) {
            this.limitValue = value;
        }
        return this;
    }

    /**
     * Set OFFSET
     */
    offset(value) {
        if (typeof value === 'number' && value >= 0) {
            this.offsetValue = value;
        }
        return this;
    }

    /**
     * Build final SQL query and parameters
     */
    build() {
        // Validate table name
        if (!this.table || typeof this.table !== 'string' || this.table.trim() === '') {
            throw new Error('Table name is required');
        }

        let sql = '';
        const params = [...this.whereParams];

        // Handle different query types
        if (this.aggregateFunc && this.groupByColumn) {
            // Grouped aggregate
            sql = `SELECT \`${this.groupByColumn}\` AS \`group\`, ${this.aggregateFunc}(${this.aggregateColumn}) AS \`value\``;
            sql += ` FROM \`${this.table}\``;

            if (this.whereClauses.length > 0) {
                sql += ` WHERE ${this.whereClauses.join(' AND ')}`;
            }

            sql += ` GROUP BY \`${this.groupByColumn}\``;

            // Use custom orderBy if provided, otherwise default to ORDER BY value DESC
            if (this.orderByClauses.length > 0) {
                sql += ` ORDER BY ${this.orderByClauses.join(', ')}`;
            } else {
                sql += ` ORDER BY \`value\` DESC`;
            }

        } else if (this.aggregateFunc && !this.groupByColumn) {
            // Single aggregate
            sql = `SELECT ${this.aggregateFunc}(${this.aggregateColumn}) AS \`value\``;
            sql += ` FROM \`${this.table}\``;

            if (this.whereClauses.length > 0) {
                sql += ` WHERE ${this.whereClauses.join(' AND ')}`;
            }

        } else if (!this.aggregateFunc && this.groupByColumn) {
            // Group without explicit aggregate (count)
            sql = `SELECT \`${this.groupByColumn}\` AS \`group\`, COUNT(*) AS \`value\``;
            sql += ` FROM \`${this.table}\``;

            if (this.whereClauses.length > 0) {
                sql += ` WHERE ${this.whereClauses.join(' AND ')}`;
            }

            sql += ` GROUP BY \`${this.groupByColumn}\``;

            // Use custom orderBy if provided, otherwise default to ORDER BY value DESC
            if (this.orderByClauses.length > 0) {
                sql += ` ORDER BY ${this.orderByClauses.join(', ')}`;
            } else {
                sql += ` ORDER BY \`value\` DESC`;
            }

        } else {
            // Regular SELECT
            const cols = this.selectColumns.length > 0 ? this.selectColumns.join(', ') : '*';
            sql = `SELECT ${cols} FROM \`${this.table}\``;

            if (this.whereClauses.length > 0) {
                sql += ` WHERE ${this.whereClauses.join(' AND ')}`;
            }

            if (this.orderByClauses.length > 0) {
                sql += ` ORDER BY ${this.orderByClauses.join(', ')}`;
            }
        }

        // Add LIMIT/OFFSET
        if (this.limitValue !== null) {
            sql += ` LIMIT ${this.limitValue}`;
        }
        if (this.offsetValue !== null) {
            sql += ` OFFSET ${this.offsetValue}`;
        }

        return { sql: sql.trim(), params };
    }
}

/**
 * Factory function to create a new query builder
 */
function createQueryBuilder(table) {
    return new QueryBuilder(table);
}

module.exports = {
    QueryBuilder,
    createQueryBuilder,
};