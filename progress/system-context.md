# Gharpayy API System Context

This document defines the architectural patterns and coding conventions for the Gharpayy Link Shortener API. Every AI agent must follow these rules without exception.

## 1. Architecture Summary
- **Framework**: Node.js with Express.
- **ORM**: Prisma (PostgreSQL).
- **Structure**: Flat file structure in `apps/api/src/`. No nested controller/service layers.
- **Database Access**: Use the Prisma client instance from `./db.ts` via `getDb(config.databaseUrl)`.

## 2. Coding Conventions
- **Variable Naming**: `camelCase` (e.g., `tenantId`, `createdBy`).
- **API Request Body**: `snake_case` (e.g., `long_url`, `expires_at`).
- **File Naming**: `kebab-case` (e.g., `main.ts`, `prisma/schema.prisma`).
- **Route Registration**: Handlers are registered directly in `main.ts` using `app.get`, `app.post`, etc.

## 3. Error Handling
- **Format**: All error responses MUST be JSON and follow this exact shape:
  ```json
  { "error": "snake_case_error_code" }
  ```
- **Status Codes**:
    - `400`: Missing headers or validation failure.
    - `404`: Resource not found.
    - `500`: Internal database or system failure.
- **Style**: Avoid large `try/catch` blocks for flow control. Use inline checks and early returns. Replicate the error codes seen in `main.ts` (e.g., `failed_to_create_link`).

## 4. Coding Style & Patterns
- **Assignment Style**: Do NOT use object destructuring for `req.body` or `req.header`. Use defensive optional chaining and individual assignments to match `main.ts` (e.g., `const longUrlRaw = req.body?.long_url;`).
- **Response Formatting**: Never return raw Prisma objects. Explicitly construct the response JSON to include only the fields required by the client. Match the `POST /links` return pattern.

## 5. Authentication & Authorization
- **Authentication**: Every protected route MUST verify `x-tenant-id` and `x-created-by` headers.
- **Authorization (IDOR Prevention)**: Never trust a resource ID in the URL without verifying ownership. For any write operation (POST, PUT, DELETE) on a resource (Team, Invitation, etc.), you MUST verify that the `x-created-by` user has the necessary permissions (e.g., is an ADMIN member of the team).
- **Example Authorization Check**:
  ```typescript
  const membership = await db.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: createdBy } }
  });
  if (!membership || membership.role !== "ADMIN") {
    return res.status(403).json({ error: "forbidden" });
  }
  ```

## 6. Shared Spec (Parallel Execution)
- **ActivityEvent**: `{ teamId, userId, type, metadata, createdAt }`
  - Types: `LINK_CREATED`, `MEMBER_INVITED`, `TEAM_CREATED`
- **Comment**: `{ linkId, userId, content, createdAt }`
  - Relation: Belongs to a `Link`.

## 7. Constraints
- **NO new dependencies**: Do not install new npm packages.
- **Consistency**: Match the formatting and indentation of existing files.
- **Migrations**: Every database schema change MUST be accompanied by a Prisma migration instruction.
