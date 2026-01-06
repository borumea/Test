# SQL Migration Project

## Overview
This repository is a full-stack web application for managing MySQL database operations with a React frontend and Node.js Express backend. The application provides an interface for querying, inserting, updating, and deleting records with individualized access control.

**Key Features:**
- User authentication with JWT tokens (24-hour session)
- Individualized permissions for tables and views
- Dynamic query builder with filters and aggregations
- Support for multi-table views
- Rate limiting for security
- Structured logging system
- Automatic detection of database schema

**Security Notice:** Do not commit credentials. DB connection values should be configured in `./server/.env` or `./server/db.config.js`.

For contributors: follow the quickstart steps to run locally, open a PR against feature/* or fix/* branches, and include testing steps and migration notes in the PR description.

## Tech Stack
- **Frontend**: React 18, react-router-dom 6, fetch API, CSS
- **Backend**: Node.js, Express.js 4, JWT authentication
- **Database**: MySQL (mysql2), currently using NDB clusters
- **Security**: bcrypt password hashing, express-rate-limit, helmet, CORS
- **Dev Tools**: npm, Prettier, DBeaver-ce for database access
- **Deployment**: Apache2 (production), Development servers (local)

## Architecture
```
SQL-Migration-Site/
├── server/         # Express API backend
│   ├── Config/     # Security, database config
│   ├── Middleware/ # Auth, rate limiting, validation
│   ├── Routes/     # API endpoints
│   ├── Services/   # Business logic, database operations
│   └── index.js    # Server entry point
└── website/        # React frontend
    ├── public/     # Static assets
    └── src/
        ├── components/ # React components
        ├── pages/      # Page components
        └── lib/        # API client, auth helpers
```

## Quickstart (Development)
1. **Clone repository:**
   ```bash
   git clone <repository-url>
   cd SQL-Migration-Site
   ```

2. **Configure server environment:**
   ```bash
   cd server
   # Edit .env with your database credentials and settings
   ```

3. **Install dependencies:**
   ```bash
   # Terminal 1 - Server
   cd server
   npm install

   # Terminal 2 - Frontend
   cd website
   npm install
   ```

4. **Run development servers:**
   ```bash
   # Terminal 1 - API Server (runs on port 3001)
   cd server
   npm start

   # Terminal 2 - Frontend Dev Server (runs on port 3000)
   cd website
   npm start
   ```

5. **Access the application:**
   - Frontend: http://localhost:3000
   - API Health Check: http://localhost:3001/health

## Linting & Formatting
- Prettier commands:
    - ```npm run format```

## Configuration

### Server Environment Variables
Create a `.env` file in the `server/` directory based on the following example:

```env
# Server Configuration
PORT=3001
HOST=0.0.0.0          # Bind to all interfaces for remote access

# Database
DB_HOST=localhost
DB_USER=your_db_user
DB_PASS=your_db_password
DB_NAME=your_database
DB_PORT=3306

# JWT Authentication
JWT_SECRET=your_secure_secret_key_here
JWT_EXPIRES_IN=24h    # Token lifetime

# CORS
CORS_ORIGIN=http://localhost:3000  # Frontend URL
# CORS_ALLOW_ALL=true               # Allow all origins (development only!)

# Logging
LOG_LEVEL=INFO        # DEBUG, INFO, WARN, ERROR
```

### Database Requirements
- MySQL database with an "employees" table containing:
  - `username` (VARCHAR)
  - `password` (VARCHAR) - supports bcrypt hashing
  - `first_time_login` (BIT/TINYINT)
  - Additional columns for table permissions (BIT/TINYINT)

## Authentication & Permissions

### JWT Token System
- Tokens expire after 24 hours (configurable)
- Refresh endpoint available: `POST /api/auth/refresh-token`
- On expiration, users are automatically logged out and redirected to login

### Permission Model
- Permissions are stored as columns in the employees table
- Each table can have a corresponding permission column (BIT: 0 or 1)
- Single-table views inherit permissions from their base table
- Multi-table views require permissions for ALL base tables
- Special tables `Tags` and `Ratings` are publicly accessible

### Rate Limiting
- General API: 100 requests per minute
- Login endpoint: 5 failed attempts per 15 minutes

## Logging

The application uses a structured logging system with colored output:
- **ERROR** (red): Critical errors and failures
- **WARN** (yellow): Warnings and access denials
- **INFO** (blue): Important operations and events
- **DEBUG** (gray): Detailed debugging information

Set log level via `LOG_LEVEL` environment variable.

## Deployment

### Production Build
1. **Build frontend:**
   ```bash
   cd website
   npm run build
   # Output: website/build/
   ```

2. **Deploy to Apache2:**
   ```bash
   sudo cp -r build /var/www/test_domain.org
   ```

3. **Run API server:**
   ```bash
   cd server
   # Set production environment variables
   NODE_ENV=production npm start
   ```

### Production Considerations
- Set `NODE_ENV=production`
- Use better `JWT_SECRET`
- Configure appropriate `CORS_ORIGIN`
- Enable HTTPS/TLS
- Consider using PM2 or systemd for server process management
- Regular database backups

## Contribution

### Branching Strategy
- `feature/*` - New features
- `fix/*` - Bug fixes
- `claude/*` - AI-assisted development branches

### Pull Request Guidelines
- Include clear summary of changes
- Provide testing steps
- Reference related issues
- Include migration notes if database changes are required
- Update relevant documentation

## Troubleshooting

### Common Issues

**DB connection refused:**
- Check `./server/.env` or `./server/Config/db.config.js` for correct credentials
- Ensure MySQL server is running
- Verify firewall rules if accessing remote database

**CORS errors:**
- Set `CORS_ALLOW_ALL=true` in `.env` for local development
- Or set `CORS_ORIGIN` to your frontend URL

**401/403 errors (token expired):**
- Tokens expire after configured time (default 24h)
- Use `/api/auth/refresh-token` to extend session
- Clear browser cache and re-login if issues persist

**Cannot create/update users:**
- Ensure logged in user has `employees` permission
- Check that permission columns exist in employees table
- Single table views don't need permission columns

**Rate limit errors:**
- Wait 15 minutes after failed login attempts
- General API limit: 100 requests/minute per IP

## API Documentation
See `server/README.md` for complete API endpoint documentation.