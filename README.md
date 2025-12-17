# SQL Migration Project

## Overview
This repository is a working prototype intended for internal use: the React frontend and Node.js API work together for local development, but authentication, input validation, and production hardening are limited. 

Do not commit credentials. DB connection values live in ./server/db.config.js (or use environment variables such as DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT). For contributors: follow the quickstart steps to run locally, open a PR against feature/* or fix/* branches, and include testing steps and migration notes in the PR description.

## Tech stack
- Frontend: React, react-router, fetch, CSS
- Backend: NodeJS, SQL (Query construction)
- Database: MySQL (running on NDB clusters), using Dbeaver-ce for direct access
- Dev tooling: npm, Prettier
- Current Deployment: Apache2

## Quickstart (Development)
1. Clone repo:
     - ```git clone```
2. Install dependencies:
     - ```cd website``` && ```npm install```
     - ```cd ../server``` && ```npm install```
3. Run in separate terminals:
     - ```cd website``` && ```npm start```
     - ```cd server``` && ```npm start```
4. Open browser: http://localhost:3000 (frontend), API at http://localhost:4000

## Linting & Formatting
- Prettier commands:
    - ```npm run format```

## Deployment
- Current method of deployment is via an apache2 server accessible on local network
    - ```cd /website``` && ```npm run build```
    - ```sudo cp -r build /path/to/domain```
        - Path is usually something like /var/www/domain

## Contribution
- Branching: feature/*, fix/*
- PR template: include summary, testing steps, related issue

## Troubleshooting
- Common issues and fixes:
    - DB connection refused: check your custom ./server/db.config.js file for credentials

## License
- Add this when I push to github