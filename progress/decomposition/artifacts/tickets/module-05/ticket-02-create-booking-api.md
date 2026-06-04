# Ticket 2: Backend - `POST /api/bookings` Endpoint

*   **Title:** Backend - `POST /api/bookings` Endpoint
*   **Context:** Core endpoint for Slice 1 transaction flow.
*   **Scope:** Accepts client payloads, validates parameters, writes to the `Booking` table.
*   **Interface Contract:**
    *   **In:** `POST /api/bookings` ->
        ```json
        {
          "providerId": "UUID",
          "serviceId": "UUID",
          "slottime": "ISO8601"
        }
        ```
    *   **Out (201 Created):**
        ```json
        {
          "bookingId": "UUID",
          "status": "confirmed",
          "referenceNumber": "SB-YYYYMMDD-XXXX"
        }
        ```
        *Note on Reference Number Generation:* The `referenceNumber` must follow the format `SB-YYYYMMDD-XXXX` where `YYYYMMDD` is the UTC date of the transaction submission, and `XXXX` represents the last 4 characters of the generated `bookingId` (UUID) converted to uppercase.
    *   **Out (400 Bad Request):**
        ```json
        {
          "error": "BAD_REQUEST",
          "message": "Missing or invalid: <comma-separated field names>"
        }
        ```
    *   **Out (409 Conflict):**
        ```json
        {
          "error": "CONFLICT",
          "message": "Booking already exists for this slot."
        }
        ```
*   **Acceptance Criteria:**
    *   **Given** a valid payload, **When** posted, **Then** persist the row in the database with status `"confirmed"` and return `201`.
    *   **Given** a payload missing any of the required parameters (`providerId`, `serviceId`, `slottime`) or containing invalid parameter formats (e.g. string length not exactly 36 characters for UUIDs, or non-ISO8601 date strings), **When** posted, **Then** block the database write and return `400` status with the `BAD_REQUEST` JSON error payload.
    *   **Given** a duplicate booking request with the same `providerId`, `serviceId`, and `slottime`, **When** posted, **Then** block the database write and return `409` status with the `CONFLICT` JSON error payload.
*   **Constraints:**
    *   Node.js/TypeScript, Prisma ORM. No authentication layer.
    *   *Authorization Constraint:* Hardcode the booking creator's owner ID to a single system-wide mock tenant ID (`mock-consumer-uuid`) on the backend database insert; do not accept user ID from the client payload.
    *   *Sanitization Constraint:* Enforce exact UUID formatting and length rules at the controller gate prior to database operations.
*   **Anti-Scope:** No scheduling conflict validation, email notifications, or payment handling.
