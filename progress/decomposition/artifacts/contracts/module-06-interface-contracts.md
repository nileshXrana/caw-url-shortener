# Module 06 — Interface Contracts

> These contracts are the single source of truth for all parallel agent sessions.
> Each agent receives only the contract sections relevant to their ticket.
> Any ambiguity found during execution must be resolved here first, then communicated to affected agents.

---

## CONTRACT A: `POST /api/bookings` (Agent Alpha — T-02)

### Shared Types
```
providerId : string (UUID v4, exactly 36 characters, e.g. "550e8400-e29b-41d4-a716-446655440000")
serviceId  : string (UUID v4, exactly 36 characters)
slottime   : string (ISO 8601 UTC datetime, e.g. "2025-03-15T14:30:00Z")
bookingId  : string (UUID v4, exactly 36 characters, server-generated)
```

### Endpoint
```
POST /api/bookings
Content-Type: application/json
```

### Request Body
```json
{
  "providerId": "string (UUID v4, required)",
  "serviceId":  "string (UUID v4, required)",
  "slottime":   "string (ISO 8601 UTC, required)"
}
```

### Response — 201 Created
```json
{
  "bookingId":       "string (UUID v4)",
  "status":          "confirmed",
  "referenceNumber": "string (format: SB-YYYYMMDD-XXXX)"
}
```
> `referenceNumber` format rule: `SB-` + UTC date of request (`YYYYMMDD`) + `-` + last 4 characters of `bookingId` uppercased.
> Example: bookingId = `"...a3f9"` on 2025-03-15 → `"SB-20250315-A3F9"`

### Response — 400 Bad Request
```json
{
  "error":   "BAD_REQUEST",
  "message": "Missing or invalid: <comma-separated field names>"
}
```
> Triggered when: any required field is absent, UUID fields are not exactly 36 characters, or `slottime` is not a valid ISO 8601 string.

### Response — 409 Conflict
```json
{
  "error":   "CONFLICT",
  "message": "Booking already exists for this slot."
}
```
> Triggered when: a row with the same `(providerId, serviceId, slottime)` combination already exists in the database.

### Authorization Constraint
The booking's `ownerId` (creator field) is **always** hardcoded to `"mock-consumer-uuid"` on the backend insert. This field is **never** accepted from the client payload.

### Assumptions
- The Prisma `Booking` model has a unique index on `(providerId, serviceId, slottime)`.
- The database is PostgreSQL running locally.
- No authentication middleware is present; this endpoint is publicly accessible in dev.

---

## CONTRACT B: `POST /api/payments/checkout` (Agent Beta — T-05)

### Shared Types
```
url : string (Stripe Checkout session URL, begins with "https://checkout.stripe.com/pay/cs_test_...")
```

### Endpoint
```
POST /api/payments/checkout
Content-Type: application/json (body is empty — no fields required)
```

### Request Body
```json
{}
```
> Empty body. The endpoint requires no client input.

### Response — 200 OK
```json
{
  "url": "string (Stripe Checkout session URL)"
}
```
> Field name is `url` — not `redirect_url`, `checkoutUrl`, or `session_url`.

### Response — 500 Internal Server Error
```json
{
  "error": "STRIPE_ERROR"
}
```
> Triggered when: Stripe SDK throws any exception (unreachable API, invalid credentials, network timeout).

### Configuration Constraint
- Stripe secret key is read from `process.env.STRIPE_TEST_SECRET_KEY`.
- Amount is hardcoded: `$10.00 USD` (1000 cents).
- `success_url` and `cancel_url` are static hardcoded strings.
- Uses the official backend `stripe` npm package (not `@stripe/stripe-js`).

### Assumptions
- `STRIPE_TEST_SECRET_KEY` is set in `.env` before agent runs.
- No database interactions of any kind.
- No webhook handling.

---

## CONTRACT C: `GET /api/providers` (Agent Gamma — T-01 consumption)

> Agent Gamma (Frontend) **consumes** this endpoint. The schema setup (T-03) seeds 3 providers. Agent Gamma does not implement this endpoint — it only reads it.

### Endpoint
```
GET /api/providers
```

### Response — 200 OK
```json
[
  {
    "id":            "string (UUID v4)",
    "name":          "string",
    "price":         "number (flat-rate, e.g. 50)",
    "availableSlot": "string (human-readable, e.g. 'Mon 10:00 AM')"
  }
]
```
> The array always contains exactly 3 providers in the seeded dev environment.

### Frontend Integration Notes
- Base URL: `http://localhost:3001` (backend dev server)
- Frontend dev URL: `http://localhost:3000`
- On "Book Now" click: transition to booking confirmation view (no actual API call required in T-01 scope)
- Do NOT add search, filter, or authentication UI

---

## Contract Violation Seed (Simulated — for Module 06 verification)

The following is an intentionally introduced contract violation to be detected during checkpoint sync:

> **Seeded violation:** Agent Beta initially returns `{ "redirect_url": "..." }` instead of `{ "url": "..." }`.
>
> **Detection method:** At Checkpoint 1, the payment UI (T-04) calls the endpoint and tries to read `response.url` — it gets `undefined` because the field is named `redirect_url`.
>
> **Resolution:** Correct Agent Beta's response shape to use `url` as specified in Contract B. No frontend change needed.
