# Architecture Summary - Team Collaboration

## Folder Structure
- `apps/api/`: The core Express application.
    - `prisma/`: Contains `schema.prisma` (DB models) and migrations.
    - `src/`: Application source code.
        - `main.ts`: Entry point where all routes, server setup, and logic currently live.
        - `db.ts`: Prisma client initialization.
        - `config.ts`: Environment variable management.
        - `url.ts` & `code.ts`: Pure utility functions for URL validation and code generation.
- `progress/`: Directory for tracking our development milestones.

## Data Models (`prisma/schema.prisma`)
- **Link**: Represents a shortened URL.
    - `id` (String, CUID): Primary key.
    - `tenantId` (String): Scopes the link to a specific team/org.
    - `code` (String): The short identifier (unique per tenant).
    - `longUrl` (String): The destination.
    - `createdBy` (String): Identifier for the user who created the link.
    - `expiresAt` (DateTime?): Optional expiration.
    - `tags` (String[]): Metadata labels.
- **ClickEvent**: Tracks redirection events.
    - `linkId` (String): Foreign key to `Link`.
    - `userAgent`, `referrer`, `ipHash`: Tracking metadata.

## API Routes (`src/main.ts`)
- `GET /health`: Simple uptime check.
- `POST /links`: Creates a link. Requires `x-tenant-id` and `x-created-by` headers.
- `GET /links`: Lists links for a tenant/user.
- `GET /links/:id`: Fetches detailed metadata for a specific link.
- `GET /r/:code`: The public redirect endpoint. Scopes lookup by prefixing the code with `tenantId`.

## Authentication
- **Mechanism**: Manual header verification.
- **Strategy**: No external library (like Passport or JWT) is currently used.
- **Enforcement**: Hand-coded checks at the start of each route handler in `src/main.ts`.

## Database
- **Technology**: PostgreSQL.
- **Connection**: Managed via Prisma Client in `src/db.ts`.
- **Config**: Loaded from `apps/api/.env` via `src/config.ts`.
