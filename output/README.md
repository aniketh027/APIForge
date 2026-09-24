# APIForge Generated Backend

This project is an Express REST API backed by MySQL.

## Setup

1. Install the runtime dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and set the MySQL connection values. For example, use `cp .env.example .env` on macOS/Linux or `Copy-Item .env.example .env` in PowerShell.

3. Create the MySQL database named by `DB_NAME` and import the generated schema. With the example database name and root user:

   ```sh
   mysql -u root -p -e "CREATE DATABASE apiforge_db;"
   ```

   In Command Prompt, Git Bash, or a Unix shell:

   ```sh
   mysql -u root -p apiforge_db < database/schema.sql
   ```

   In PowerShell:

   ```powershell
   mysql.exe -u root -p apiforge_db -e "source database/schema.sql"
   ```

   If you change `DB_NAME` or `DB_USER` in `.env`, use the same values when creating and importing the database.

4. Start the backend:

   ```sh
   npm start
   ```

The server listens on `PORT` from `.env` (default `3000`).

## Routes and API specification

- `/students` (CRUD collection route; item operations use `/students/:id`)
- `/courses` (CRUD collection route; item operations use `/courses/:id`)
- `/health` reports server health.

The OpenAPI document is at `swagger.json` in the project root. The generated server does not serve Swagger UI or expose that file over HTTP.
