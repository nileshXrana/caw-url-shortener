# Team Collaboration Task Tree

This document outlines the progressive decomposition of the Team Collaboration feature for the Gharpayy Link Shortener.

## Strategy: Progressive (Option B)
## Granularity: Medium (8-12 Tasks)

---

## Interface Contracts (The "LEGO" Connections)

To prevent AI hallucinations and schema drift, we define the following explicit contracts between tasks:

### Contract: Task 1 → Task 2 (Data Foundation)
- **Upstream (Task 1) Produces**: `Team` model in Prisma with `id`, `name`, `slug`, `createdAt`, `updatedAt`.
- **Downstream (Task 2) Expects**: `Team.id` to exist and be a `String`.
- **Constraint**: Task 2 MUST NOT add fields to `Team` or assume logic for "default teams" or "ownership" not defined in Task 1.

### Contract: Task 2 → Task 3 (Membership API)
- **Upstream (Task 2) Produces**: `TeamMember` model and `TeamRole` enum.
- **Downstream (Task 3) Expects**: `TeamMember` table to handle roles (`ADMIN`, `MEMBER`).
- **Constraint**: Task 3 MUST use the `ADMIN` role for the creator and MUST NOT create its own membership table.

### Contract: Task 1 → Task 5 (Link Scoping)
- **Upstream (Task 1) Produces**: `Team` model.
- **Downstream (Task 5) Expects**: `Team.id` to be used as a foreign key `teamId` in the `Link` model.
- **Constraint**: `Link.teamId` must be optional during migration to prevent breaking existing single-tenant links.

---

## 1. Task 1: Team Data Model & Migration
- **Context Needed**: `apps/api/prisma/schema.prisma`
- **Expected Output**: 
    - Updated `schema.prisma` with `model Team`.
    - `Team` fields: `id` (cuid), `name` (string), `slug` (string, unique), `createdAt`, `updatedAt`.
- **Acceptance Criteria**:
    - `npx prisma migrate dev` runs successfully.
    - `Team` table exists in database.
- **Dependencies**: None.

## 2. Task 2: Team Membership Model & Roles
- **Context Needed**: `apps/api/prisma/schema.prisma`, `Task 1`
- **Expected Output**:
    - `model TeamMember` in `schema.prisma`.
    - Fields: `teamId`, `userId` (string, from `createdBy` pattern), `role` (Enum: ADMIN, MEMBER).
    - Unique constraint on `[teamId, userId]`.
- **Acceptance Criteria**:
    - `npx prisma generate` succeeds.
    - Database relations are established correctly.
- **Dependencies**: Task 1.

## 3. Task 3: Create Team API (POST /teams)
- **Context Needed**: `apps/api/src/main.ts`, `schema.prisma`
- **Expected Output**:
    - New endpoint `POST /teams`.
    - Payload: `{ name: string, slug: string }`.
    - Handler creates `Team` and adds the creator as `ADMIN`.
- **Acceptance Criteria**:
    - `curl -X POST /teams` returns 201 with the team object.
    - Database shows a new Team and a corresponding TeamMember entry.
- **Dependencies**: Task 1, Task 2.

## 4. Task 4: Team Member Management API
- **Context Needed**: `apps/api/src/main.ts`
- **Expected Output**:
    - `GET /teams/:id/members`
    - `DELETE /teams/:id/members/:userId`
- **Acceptance Criteria**:
    - Listing members returns the correct role.
    - Admins can remove members.
- **Dependencies**: Task 3.

## 5. Task 5: Link-to-Team Scoping Migration
- **Context Needed**: `schema.prisma`, `main.ts`
- **Expected Output**:
    - Add `teamId` (optional initially) to `Link` model.
    - Update handlers in `main.ts` to support `x-team-id` header alongside `x-tenant-id`.
- **Acceptance Criteria**:
    - Creating a link with `x-team-id` associates it with the team.
- **Dependencies**: Task 1.

## 6. Task 6: Invitation System Data Model
- **Context Needed**: `schema.prisma`
- **Expected Output**:
    - `model Invitation` with `token` (unique), `email`, `teamId`, `role`, `expiresAt`.
- **Acceptance Criteria**:
    - Migration succeeds.
- **Dependencies**: Task 1.

## 7. Task 7: Invitation API Flow
- **Context Needed**: `main.ts`, `Task 6`
- **Expected Output**:
    - `POST /teams/:id/invitations` (Create token)
    - `POST /invitations/accept` (Verify token and add member)
- **Acceptance Criteria**:
    - Sending invitation returns a token.
    - Accepting token with a `userId` adds that user to the team.
- **Dependencies**: Task 6, Task 2.

## 8. Task 8: Team Activity Feed
- **Context Needed**: `main.ts`, `schema.prisma`
- **Expected Output**:
    - `GET /teams/:id/activity`
    - Returns a list of recent `Link` creations and `ClickEvent` summaries for the team.
- **Acceptance Criteria**:
    - Returns 200 with chronological event list.
- **Dependencies**: Task 5.

---

## The Critical Path
**Task 1 → Task 2 → Task 3 → Task 4 → Task 7**
The core functionality (Creating teams and adding members) is the bottleneck. Invitations and Activity Feeds are secondary but the "Acceptance" flow (Task 7) depends on the membership logic being solid.

## Riskiest Task
**Task 7: Invitation API Flow**
*Why*: It involves token validation, state transitions (Pending -> Accepted), and ensuring idempotency (not joining twice). It’s the place where business logic and security (who can accept?) are most likely to clash.

---

## Prompt 1: Team Data Model (Task 1)
> \"Update `apps/api/prisma/schema.prisma` to add a new `Team` model. The model should include an `id` (String, cuid, primary key), `name` (String, required), `slug` (String, required, unique), `createdAt` (DateTime, default now), and `updatedAt` (DateTime, updated value). Follow the formatting and naming conventions used in the existing `Link` model. Do not add any relationships to other models yet. Run `npx prisma generate` after the change.\"

## Prompt 2: Team Membership Model (Task 2)
> \"Update `apps/api/prisma/schema.prisma` to implement team membership. Define an Enum `TeamRole` with values `ADMIN` and `MEMBER`. Create a `TeamMember` model with `teamId` (String), `userId` (String), and `role` (`TeamRole`, default `MEMBER`). Establish a many-to-one relationship from `TeamMember` to `Team`. Add a unique constraint on `[teamId, userId]` to prevent duplicate memberships. **Strictness: Do not add any fields, enums, or relationships beyond those explicitly listed here. Do not assume any business logic for default teams or status flags.** Run `npx prisma generate` after the change.\"

## Prompt 3: Create Team API (Task 3)
> \"Implement the `POST /teams` endpoint in `apps/api/src/main.ts`. The endpoint should accept a JSON body with `name` and `slug`. It must verify the `x-created-by` header is present. The handler should: 1) Create a new `Team` in the database. 2) Automatically create a `TeamMember` entry for the `x-created-by` user with the `ADMIN` role. 3) Return the created team object with a 201 status code. Use the existing Prisma client instance from `db.ts` and follow the error handling patterns seen in the `POST /links` handler.\"
