# Context Bundles - Team Collaboration

This document defines the "Briefcase" of files for the first three implementation tasks.

---

## Task 1: Team Data Model & Migration
- **Description**: Add the `Team` model to Prisma.
- **Files to Read**:
    - `apps/api/prisma/schema.prisma` (to match existing `Link` model patterns).
- **Files to Modify**:
    - `apps/api/prisma/schema.prisma`
- **Output**: Updated `schema.prisma` with `Team` model.

## Task 2: Team Membership Model & Roles
- **Description**: Add `TeamMember` and `TeamRole` enum.
- **Files to Read**:
    - `apps/api/prisma/schema.prisma` (reference `Team` created in Task 1).
- **Files to Modify**:
    - `apps/api/prisma/schema.prisma`
- **Output**: Updated `schema.prisma` with `TeamMember` and `TeamRole`.

## Task 3: Create Team API (POST /teams)
- **Description**: Implement the endpoint to create a team and assign the owner.
- **Files to Read**:
    - `apps/api/src/main.ts` (to replicate the `POST /links` pattern).
    - `apps/api/prisma/schema.prisma` (to reference `Team` and `TeamMember` models).
    - `apps/api/src/db.ts` (to see how Prisma is instantiated).
- **Files to Modify**:
    - `apps/api/src/main.ts`
- **Output**: New `app.post("/teams", ...)` handler in `main.ts`.
