# Module 06 — Agent Output Bundle (Simulated)

> **Mode:** `standalone_simulated`
> Simulates realistic output from 3 parallel AI agent sessions running Module 5 tickets simultaneously.
> One seeded contract violation is embedded for detection during Checkpoint 1.

---

## Stream A — Agent Alpha: `POST /api/bookings` (T-02)

**Branch:** `feature/booking-api-t02`
**Status at CP1:** ✅ Complete — endpoint live and returning correct shape

### Files Produced
- `apps/api/src/routes/bookings.ts`
- `apps/api/src/controllers/bookingController.ts`
- `apps/api/src/validators/bookingValidator.ts`

### Endpoint Output Sample

**Request:**
```bash
curl -X POST http://localhost:3001/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"providerId":"550e8400-e29b-41d4-a716-446655440001","serviceId":"550e8400-e29b-41d4-a716-446655440002","slottime":"2025-03-15T14:30:00Z"}'
```

**Response 201:**
```json
{
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567a3f",
  "status": "confirmed",
  "referenceNumber": "SB-20250315-7A3F"
}
```

**Response 400 (missing field):**
```json
{
  "error": "BAD_REQUEST",
  "message": "Missing or invalid: slottime"
}
```

**Response 409 (duplicate):**
```json
{
  "error": "CONFLICT",
  "message": "Booking already exists for this slot."
}
```

### Contract Compliance: ✅ PASS
- `bookingId` is UUID v4 ✅
- `referenceNumber` format `SB-YYYYMMDD-XXXX` where XXXX = last 4 chars of bookingId uppercased ✅
- `status` is the literal string `"confirmed"` ✅
- 400 and 409 error shapes match contract exactly ✅
- `ownerId` hardcoded to `"mock-consumer-uuid"` on DB insert — not accepted from client ✅

### Agent Questions During Execution
> **Q:** "Should the unique constraint on `(providerId, serviceId, slottime)` be enforced at the database level or only at the application level?"
> **A (Coordinator):** Both. Prisma unique constraint + application-level check before write to return a clean 409 instead of a Prisma `P2002` error.

---

## Stream B — Agent Beta: `POST /api/payments/checkout` (T-05)

**Branch:** `feature/stripe-handler-t05`
**Status at CP1:** ⚠️ CONTRACT VIOLATION DETECTED

### Files Produced
- `apps/api/src/routes/payments.ts`
- `apps/api/src/controllers/paymentController.ts`

### Endpoint Output Sample (initial — violating)

**Response 200 (VIOLATION):**
```json
{
  "redirect_url": "https://checkout.stripe.com/pay/cs_test_a1B2c3D4e5F6..."
}
```

> ❌ **Contract Violation:** Field is named `redirect_url` but Contract B specifies `url`.
> The payment UI reads `response.url` — it will receive `undefined`.

### Checkpoint 1 Resolution
**Action taken:** Coordinator identified the violation at CP1 by comparing Agent Beta's output against Contract B.

**Fix applied to Agent Beta:**
```diff
- return res.status(200).json({ redirect_url: session.url });
+ return res.status(200).json({ url: session.url });
```

**Response 200 (post-fix — correct):**
```json
{
  "url": "https://checkout.stripe.com/pay/cs_test_a1B2c3D4e5F6..."
}
```

**Response 500:**
```json
{
  "error": "STRIPE_ERROR"
}
```

### Contract Compliance: ✅ PASS (after CP1 fix)
- `url` field name correct ✅ (corrected at CP1)
- 500 error shape `{ "error": "STRIPE_ERROR" }` matches contract ✅
- Uses `process.env.STRIPE_TEST_SECRET_KEY` ✅
- No database interaction ✅

### Agent Questions During Execution
> **Q:** "Should I use `line_items` with a `price_data` object or a pre-created Stripe Price ID?"
> **A (Coordinator):** Use inline `price_data` — no pre-created Price IDs exist in test environment.

---

## Stream C — Agent Gamma: Provider Gallery UI (T-01)

**Branch:** `feature/gallery-ui-t01`
**Status at CP1:** ✅ Complete — rendering 3 provider cards

### Files Produced
- `apps/web/src/pages/GalleryPage.tsx`
- `apps/web/src/components/ProviderCard.tsx`
- `apps/web/src/styles/gallery.css`

### Runtime Behavior
- Calls `GET http://localhost:3001/api/providers` on mount
- Renders 3 cards with: provider name, flat-rate price, available slot
- "Book Now" button transitions to the confirmation view

### Sample API Call Shape (consumed)
```json
[
  { "id": "550e8400-...-0001", "name": "John (Plumber)", "price": 80, "availableSlot": "Mon 10:00 AM" },
  { "id": "550e8400-...-0002", "name": "Sara (Web Designer)", "price": 120, "availableSlot": "Tue 2:00 PM" },
  { "id": "550e8400-...-0003", "name": "Mike (Guitar Teacher)", "price": 50, "availableSlot": "Wed 4:00 PM" }
]
```

### Contract Compliance: ✅ PASS
- Consuming `GET /api/providers` at correct base URL (`http://localhost:3001`) ✅
- Reading `id`, `name`, `price`, `availableSlot` fields — all match Contract C ✅
- No search, filters, or auth UI added ✅

### Agent Questions During Execution
> **Q:** "Should the 'Book Now' button make an actual API call to `POST /api/bookings`?"
> **A (Coordinator):** No — T-01 is in anti-scope for booking submission. Transition to the confirmation view only. The actual booking call is a later integration ticket.

---

## Checkpoint Summary

### Checkpoint 1 Results
| Stream | Status | Issue |
|--------|--------|-------|
| Alpha (Booking API) | ✅ Pass | None |
| Beta (Stripe Handler) | ⚠️ Violation → Fixed | `redirect_url` → `url` field rename |
| Gamma (Gallery UI) | ✅ Pass | None |

**CP1 Resolution time:** ~5 minutes (single field rename in one controller file)

### Checkpoint 2 — Integration Merge
| Merge | Status | Conflicts |
|-------|--------|-----------|
| branch-alpha → main | ✅ Clean | None |
| branch-beta → main | ✅ Clean | None |
| branch-gamma → main | ✅ Clean | None |

**Full integration smoke test:**
1. Gallery loads → 3 cards visible ✅
2. "Book Now" → confirmation view renders ✅
3. `POST /api/bookings` → 201 response + DB row confirmed ✅
4. `POST /api/payments/checkout` → 200 response with `url` ✅

---

## Coordinator Debrief

**What the contract violation proved:**
The `redirect_url` vs `url` issue is exactly the class of error that big-bang end-only sync would have caught at the very end — after all three agents finished. With checkpoint syncs, it was caught after ~15 minutes and fixed in under 5. This is the compounding value of defined synchronization points.

**What agent questions revealed:**
- T-05 needed a clarification on `line_items` structure → gap in ticket constraints. The ticket should specify `price_data` vs Price ID explicitly in future rewrites.
- T-01 needed boundary clarification on "Book Now" behavior → anti-scope was defined but not explicit enough. Future tickets should state: "Clicking Book Now renders a static confirmation component — no API call."
