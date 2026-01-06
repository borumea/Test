# Server API

This document describes the Express API implemented in `server/index.js`. It provides RESTful endpoints for database operations, user authentication, and schema management with comprehensive security features.

## Summary

- **Framework**: Node.js + Express.js 4
- **Database**: MySQL (mysql2/promise with connection pooling)
- **Authentication**: JWT tokens with 24 hour expiration (configurable)
- **Security**: bcrypt hashing, rate limiting, helmet headers, CORS
- **Logging**: Structured console logging with levels (ERROR, WARN, INFO, DEBUG)
- **File Upload**: multer support for multipart/form-data
- **Validation**: express validator for input sanitization
- **Schema Detection**: Automatically detects employees table and permissions

## Configuration

### Environment Variables (.env file)
Create a `.env` file in the server directory:

```env
# Server Configuration
PORT=3001                  # API server port
HOST=0.0.0.0              # Bind address (0.0.0.0 for all interfaces)

# Database Configuration
DB_HOST=localhost
DB_USER=your_db_user
DB_PASS=your_db_password
DB_NAME=your_database

# JWT Configuration
JWT_SECRET=your_secure_secret  # CHANGE IN PRODUCTION!
JWT_EXPIRES_IN=24h             # Token lifetime (e.g., 24h, 7d)

# CORS Configuration
CORS_ORIGIN=http://localhost:3000   # Frontend URL
# CORS_ALLOW_ALL=true                # Allow all origins (dev only!)

# Logging
LOG_LEVEL=INFO            # DEBUG | INFO | WARN | ERROR
NODE_ENV=development      # development | production
```

This file can be encrypted using 

```
cd server
node Utils/encrypt-config.js
# Select option 1 to encryp sensitive values in .env file
```

### Alternative: db.config.js
Instead of environment variables, create `Config/db.config.js`:
```javascript
module.exports = {
    host: 'localhost',
    user: 'your_user',
    password: 'your_password',
    database: 'your_database',
    port: 3001
};
```

**Note**: These files are in `.gitignore` and should not be committed.

### Security Configuration

Located in `Config/security.js`:
- **JWT**: Token secret, expiration, issuer, audience
- **bcrypt**: Salt rounds (currently 10)
- **Rate Limits**:
  - General API: 100 requests/minute
  - Login endpoint: 5 failed attempts/15 minutes
- **CORS**: Origin validation with credentials support

### Authentication & user management (employees table)

- The server attempts to detect an "employees" table by scanning INFORMATION_SCHEMA for a table with both `username` and `password` columns. Falls back to common names such as "Employees".

- Password handling
  - Supports bcrypt hashed passwords and old plaintext passwords
  - On successful login with a plaintext password, the server hashes the password using bcrypt and updates the DB

## Endpoints

### POST /api/auth/login

#### Payload

- JSON { username, password }

#### Behavior

- Finds employees table, retrieves user row by username.
- Verifies password (bcrypt or plaintext).
- On success returns permissions (other boolean/bit columns decoded to 0/1) and first_time_login flag.

#### Responses

- Response (200):
  ```{json}
  {
      "success": true,
      "username": "jdoe@email",
      "first_time_login": 1,
      "permissions": { "employees": 1,"someFlag": 0, ... }
  }
  ```
- Errors:
  - 400: missing fields
  - 401: invalid credentials
  - 500: server error / employees table not found

### POST /api/auth/change-password

#### Payload
- JSON { username, newPassword }

#### Behavior
- Hashes newPassword and updates `password`. Sets `first_time_login` = 0

#### Responses
- Success: `{ "success": true }`
- Errors: 400 missing, 500 failure

### POST /api/auth/keep-current-password

#### Payload
- JSON { username }

#### Behavior
- Sets `first_time_login` = 0 without changing password

#### Responses
- Success: `{ "success": true }`

### POST /api/auth/refresh-token

#### Authentication
- Requires valid JWT token in Authorization header

#### Payload
- None (user info extracted from JWT)

#### Behavior
- Verifies current JWT token is valid
- Retrieves latest user data and permissions from database
- Generates new JWT token with fresh expiration time
- Returns new token with updated permissions

#### Responses
- Success (200):
  ```json
  {
      "success": true,
      "token": "eyJhbGc...",
      "username": "user@example.com",
      "permissions": { "employees": 1, "table1": 1, ... }
  }
  ```
- Errors:
  - 401/403: Invalid or expired token
  - 404: User not found
  - 500: Server error

**Usage**: Call this endpoint before token expiration to extend user session without requiring a new login.

### GET /api/employees

#### Payload
- none

#### Behavior
- Returns all employee rows with `password` hidden and non-username columns decoded to 0/1 where appropriate

#### Response

```
[ 
    { username: "jdoe@techfortroops.org", emp_id: 1, employees: 1, ... }, 
    ... 
]
```

### POST /api/auth/create-or-update-user

#### Payload

```{json}
{ 
    creator,
    adminPassword,
    username,
    oneTimePassword?,
    permissions: { colName: 0|1, ... }
}
```

#### Behavior
  - Verifies `creator` exists and has `employees` permission (bit field)
  - Verifies adminPassword against creator's stored password
  - If user exists: update permission columns only (no password changes)
  - If new user: create row with hashed oneTimePassword, first_time_login = 1, and provided permission bits

#### Responses
- Success: { "success": true }
- Errors: 400 missing fields, 403 permission/invalid admin password, 500 on DB errors

### POST /api/auth/delete-user

#### Payload
```{json}
{ creator, adminPassword, username }
```

#### Behavior
  - Prevents creator deleting own account.
  - Verifies creator has `employees` permission and adminPassword.
  - Deletes target user.
- Response: { "success": true }
- Errors: 400 missing, 403 invalid/permission, 404 if user not found, 500 on failure

## Schema / metadata endpoints

### GET /api/tables

#### Query
- none

#### Response
`[ "table1", "table2", ... ]`

### GET /api/columns?table=TABLE_NAME

#### Query
- table (required)

#### Responses: 
- Success: array of column metadata objects:
  ```{json}
    {
        name, 
        type, 
        columnType, 
        isPrimary, 
        isNullable, 
        maxLength, 
        isAutoIncrement, 
        isUnique 
    }
    ```
- Errors: 400 missing/unknown table

### GET /api/primaryKey?table=TABLE_NAME

#### Query
- table (required)

#### Responses
- `{ primaryKey: "colname" }` or 204 if cannot be determined
    - Uses explicit PRIMARY KEY column, falls back to column named `id`, or the first column.

## Record fetch

### GET /api/record?table=TABLE&key=columnName&value=someValue

#### Query
  - table (required)
  - value (or potentially `pk`) (required)
  - key (optional) column to search by. If omitted, server uses primary key/id/first column.

#### Response 
- Success: single row object
- Errors: 400 missing params / unknown table / invalid column, 404 if not found

## Querying

### POST /api/query

#### Payload
- JSON describing a query (compatible with dashboard-style config). Example structure:
  ```{json}
  {
    "table": "orders",
    "columns": ["id","name"], // optional
    "groupBy": "category", // optional
    "aggregate": { "type": "SUM", "column": "amt" }, // optional
    "filters": [ { "column":"status","operator":"=","value":"paid" }, ... ],
    "orderBy": "amt DESC" // optional
  }
  ```
    - Supported filter operators: =, >, <, >=, <=, !=, <>, LIKE, IN, IS, IS NOT, BETWEEN
        - IN expects an array of values
        - BETWEEN expects array [low, high]
        - IS / IS NOT: if value is null → emits IS NULL / IS NOT NULL, otherwise parameterized
    - Aggregate functions supported: COUNT, SUM, AVG, MIN, MAX
#### Responses
  - Grouped aggregate:
    ```
    {
        rows: [{ 
            group: "...", 
            value: 123 }, 
            ... ], 
        columns: ["group","value"] 
    }
    ```
  - Single aggregate:
    ``` 
    {
        rows: [{ value: 123 }],
        columns: ["value"] 
    }
    ```
  - Regular select: 
    ```
    {
        rows: [ {...}, ... ], 
        columns: ["col1","col2", ...] 
    }
    ```
- Errors: 400 invalid table/columns/aggregate, 500 server error

## Insert / Update / Delete

### POST /api/insert

#### Payload: 
    {
        table: "name", 
        data: { col1: val1, col2: val2, ... } 
    }
- Or multipart/form-data: field `table`, other fields (JSON or strings) and files (buffers)

#### Behavior:
- Validates table
- Loads table column metadata
- Skips auto-increment and server-managed `Last Modified` (which will be set to CURRENT_TIMESTAMP())
- Converts empty strings to NULL for nullable columns (also treats "null" as null)
- Performs parameterized INSERT

#### Responses
    { 
        insertedId: <primaryKeyValue>, 
        affectedRows: N 
    }
  - `insertedId` derived from result.insertId if primary key is AUTOINCREMENT, otherwise server returns provided PK value.
- Errors: 400 missing table/data/no valid columns, 500 DB error

### POST /api/update

#### Payload 
    { 
        table, 
        pkColumn?, 
        pkValue, 
        data: { col: val, ... } 
    }
- Or multipart/form-data with the same fields and file buffers

#### Behavior
  - Determines pkColumn if not provided (primary / id / first column)
  - Will not update primary key
  - Sets `Last Modified` = CURRENT_TIMESTAMP() if present in schema
  - Converts empty strings to NULL for nullable columns
  - Executes parameterized UPDATE WHERE pkColumn = pkValue

#### Responses
    { 
        pkCol: "id", 
        pkVal: "123", 
        affectedRows: N 
    }
- Errors: 400 missing required fields or no valid columns, 500 DB error

### POST /api/delete

#### Payload
    { 
        table, 
        pkColumn?, 
        pkValue? 
    } 
or 

    { 
        table, 
        pkColumn?, 
        pkValues? 
    }
where pkValues is an array
- Or multipart/form-data (fields as strings or JSON-parsed)

#### Behavior
  - Accepts single value (pkValue) or multiple (pkValues array)
  - Determines pkColumn automatically if not provided
  - Executes parameterized DELETE ... WHERE pkColumn IN (?, ?, ...)

#### Responses
    {
        "table":"name",
        "pkColumn":"id",
        "pkValues":[1,2,3],
        "affectedRows": N
    }
- Errors: 400 missing table or pkValues, 500 DB error

## Utility and behavior notes
- Schema metadata is cached in-memory (tables, columnsMeta)
- All SQL uses parameterized queries to avoid injection
- Filters, ordering, and column lists are validated against allowed columns for a given table
- Buffer values (uploaded files) are sent as Buffer objects when using multipart/form-data
- sanitizeValueForColumn converts empty string to NULL for nullable columns to avoid type errors
- Server logs errors to console. API returns generic 500 messages on internal errors
- Server binds to 127.0.0.1 only (no external exposure unless changed)

## Security considerations

- Ensure DB credentials are protected and not committed to source
- Default bcrypt salt rounds = 10 (adjust as needed).
- If deploying publicly, consider:
  - Binding to 0.0.0.0 only behind a reverse proxy with TLS
  - Protecting endpoints with session or token based auth (this API returns user permissions but does not implement sessions)
  - Rate limiting admin/user endpoints and CSRF protection if used from browsers

### Common error codes
- 400 - client input invalid or missing parameters
- 401 - authentication failed (login)
- 403 - permission denied or invalid admin password
- 404 - record not found
- 500 - server/database error