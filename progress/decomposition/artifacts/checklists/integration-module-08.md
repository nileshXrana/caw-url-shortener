# Module 08 — Integration Checklist

> **Integration strategy:** Incremental (Stream C → Stream A → Stream B)
> **Source:** artifacts/parallel/module-06-agent-output-bundle.md + artifacts/adaptation/module-07-updated-plan.md

---

## Phase 1: Pre-Integration Contract Check

### Contract Point 1: Frontend Gallery → `GET /api/providers`

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| HTTP method | GET | GET | ✅ |
| Path | `/api/providers` | `/api/providers` | ✅ |
| Response field: `id` | string (UUID v4) | string (UUID v4) | ✅ |
| Response field: `name` | string | string | ✅ |
| Response field: `price` | number | number | ✅ |
| Response field: `availableSlot` | string | string | ✅ |
| Error handling (no providers) | Empty array `[]` | Empty array `[]` | ✅ |

**Result: ✅ No mismatches**

---

### Contract Point 2: Frontend Booking Form → `POST /api/bookings`

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| HTTP method | POST | POST | ✅ |
| Path | `/api/bookings` | `/api/bookings` | ✅ |
| Request field: `providerId` | string UUID v4 (36 chars) | string UUID v4 | ✅ |
| Request field: `serviceId` | string UUID v4 (36 chars) | string UUID v4 | ✅ |
| Request field: `slottime` | string ISO 8601 UTC | string ISO 8601 UTC | ✅ |
| Request field: `booked_for_name` | string (optional) | string (optional) | ✅ |
| Request field: `booked_for_email` | string (optional) | string (optional) | ✅ |
| Response 201: `bookingId` | string UUID v4 | string UUID v4 | ✅ |
| Response 201: `status` | `"confirmed"` (lowercase) | `"confirmed"` (lowercase) | ✅ |
| Response 201: `referenceNumber` | `SB-YYYYMMDD-XXXX` | `SB-YYYYMMDD-XXXX` | ✅ |
| Response 400: `error` | `"BAD_REQUEST"` | `"BAD_REQUEST"` | ✅ |
| Response 409: `error` | `"CONFLICT"` | `"CONFLICT"` | ✅ |

**Result: ✅ No mismatches** *(Note: enum casing violation was caught and fixed in Module 6 CP1)*

---

### Contract Point 3: Payment UI → `POST /api/payments/checkout`

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| HTTP method | POST | POST | ✅ |
| Path | `/api/payments/checkout` | `/api/payments/checkout` | ✅ |
| Request body | empty `{}` | empty `{}` | ✅ |
| Response 200: `url` | string (Stripe URL) | string (Stripe URL) | ✅ |
| Response 500: `error` | `"STRIPE_ERROR"` | `"STRIPE_ERROR"` | ✅ |

**Result: ✅ No mismatches** *(Note: `redirect_url` → `url` field fix applied in Module 6)*

---

### Pre-Integration Summary

All 3 contract points verified clean. No type mismatches, no path deviations, no enum casing issues. The two violations caught in Module 6 (field naming + enum case) were already corrected before this integration phase.

---

## Phase 2: Incremental Merge Log

### Merge 1: Stream C — Frontend Gallery UI (branch-gamma → main)

**Merge result:** ✅ Clean, no conflicts

**Acceptance criteria check (in integrated environment):**
- [x] `GET /api/providers` returns 3 seeded providers
- [x] Gallery renders 3 cards with name, price, availableSlot
- [x] "Book Now" transitions to booking form view

**Cross-component smoke test:** Gallery loads → API call to `GET /api/providers` → 3 providers returned → cards render. ✅

---

### Merge 2: Stream A — Booking API (branch-alpha → main)

**Merge result:** ✅ Clean, no conflicts

**Acceptance criteria check (in integrated environment):**
- [x] `POST /api/bookings` with valid payload → 201 + `confirmed` status
- [x] Missing required field → 400 `BAD_REQUEST`
- [x] Duplicate booking → 409 `CONFLICT`
- [x] `booked_for_name` and `booked_for_email` accepted as optional fields (NEW-01 migration applied)
- [x] `ownerId` hardcoded to `"mock-consumer-uuid"` on DB insert

**Cross-component smoke test:** Gallery "Book Now" → booking form submits `POST /api/bookings` → 201 response → confirmation view renders with `referenceNumber`. ✅

---

### Merge 3: Stream B — Stripe Handler (branch-beta → main)

**Merge result:** ✅ Clean, no conflicts

**Acceptance criteria check (in integrated environment):**
- [x] `POST /api/payments/checkout` → 200 with `url` field
- [x] Stripe error condition → 500 with `{ "error": "STRIPE_ERROR" }`

**Cross-component smoke test:** Payment UI triggers `POST /api/payments/checkout` → receives `{ "url": "https://checkout.stripe.com/..." }` → UI redirects. ✅

---

## Phase 3: End-to-End Scenario Testing

### Scenario 1: Happy Path Booking Flow

| Step | Component | Expected | Result |
|------|-----------|----------|--------|
| User opens gallery | Frontend (T-01) | 3 provider cards render | ✅ |
| Click "Book Now" | Frontend (T-01) | Booking form renders | ✅ |
| Submit booking | Backend (T-02) | 201 + bookingId + referenceNumber | ✅ |
| Company user books for employee | Frontend+Backend (T-01+T-02) | booked_for fields in request and response | ✅ |
| Proceed to payment | Frontend (T-04) | Payment UI loads | ✅ |
| Checkout initiated | Backend (T-05) | Stripe URL returned | ✅ |

**Result: ✅ All steps pass**

---

### Scenario 2: Duplicate Booking (Conflict)

| Step | Component | Expected | Result |
|------|-----------|----------|--------|
| Submit booking for already-taken slot | Backend (T-02) | 409 `CONFLICT` response | ✅ |
| Frontend handles 409 | Frontend (T-01) | Error message renders ("Slot already booked") | ✅ |

**Result: ✅ Pass**

---

### Scenario 3: Concurrent Booking (Race Condition)

| Step | Component | Expected | Result |
|------|-----------|----------|--------|
| Two simultaneous POST /api/bookings for same slot | Backend (T-02) | One 201, one 409 | ✅ |
| DB unique constraint prevents duplicate | Prisma + PostgreSQL | Only one row created | ✅ |
| No corrupt booking state | DB | Single clean row with `confirmed` status | ✅ |

**Result: ✅ Pass** — Unique constraint on `(providerId, serviceId, slottime)` handles the race correctly.

---

## Phase 4: Integration Issues Log

No integration failures encountered. All previously caught violations were pre-resolved:
1. ~~`redirect_url` vs `url` field name~~ — fixed in Module 6 CP1
2. ~~`CONFIRMED` vs `confirmed` enum casing~~ — fixed in Module 6 BREAK/FIX steps
3. `booked_for_name`/`booked_for_email` — added in Module 7 NEW-01 migration and contract delta
