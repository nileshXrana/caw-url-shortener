# Ticket 3: Database Schema Setup and Test Seeding

*   **Title:** Database Schema Setup and Test Seeding
*   **Context:** Prepares the backend database with the required tables and initial seed data for Slice 1.
*   **Scope:** Add `Provider`, `Service`, and `Booking` models to the Prisma schema and create a seed script containing the initial 3 test providers (plumber, web designer, guitar teacher) with their respective services.
*   **Interface Contract:**
    *   **Prisma Models:**
        *   `Provider`: `id` (UUID), `name` (String), `price` (Float), `availableSlot` (DateTime/String)
        *   `Booking`: `id` (UUID), `providerId` (UUID), `serviceId` (UUID), `slottime` (DateTime), `status` (String, default: "confirmed"), `referenceNumber` (String)
*   **Acceptance Criteria:**
    *   **Given** the database migrations are applied, **When** running the prisma seed command, **Then** three provider records (plumber, web designer, guitar teacher) must be populated in the database.
*   **Constraints:** Node.js/TypeScript, Prisma ORM, PostgreSQL database.
*   **Anti-Scope:** No user authentication tables, feedback tables, or webhook event logs tables.
