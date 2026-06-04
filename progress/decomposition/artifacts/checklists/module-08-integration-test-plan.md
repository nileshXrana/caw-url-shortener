# Module 08 — Integration Test Plan

> **Verification strategy:** Combined (scenarios first, then requirements walkthrough)
> **Environment:** Local dev — `http://localhost:3001` (API), `http://localhost:3000` (Frontend)

---

## Part 1: Scenario-Based Integration Tests

### Test Suite 1: Booking Flow (Happy Path)

**Setup:** 3 seeded providers, Meridian demo user (`can_book_for_others = true`)

| Test ID | Scenario | Steps | Expected | Pass Condition |
|---------|----------|-------|----------|---------------|
| IT-01 | Individual booking end-to-end | Load gallery → select provider → submit booking with valid payload | 201 + bookingId + SB-referenceNumber | DB row confirmed, response matches contract |
| IT-02 | Company booking (delegation) | Load gallery as Meridian user → toggle delegation form → fill booked_for_name + booked_for_email → submit | 201 + booked_for fields in response | Both fields persisted in DB, returned in 201 |
| IT-03 | Gallery data integrity | Load gallery page | 3 cards render with correct name, price, availableSlot | No missing or extra cards |
| IT-04 | Payment flow | Submit valid booking → proceed to payment → trigger POST /api/payments/checkout | 200 + Stripe URL returned | URL field present, begins with https:// |

---

### Test Suite 2: Error Handling (Contract Enforcement)

| Test ID | Scenario | Input | Expected | Pass Condition |
|---------|----------|-------|----------|---------------|
| IT-05 | Missing required field | POST /api/bookings without serviceId | 400 BAD_REQUEST | `{ "error": "BAD_REQUEST", "message": "Missing or invalid: serviceId" }` |
| IT-06 | Malformed UUID | POST /api/bookings with providerId = "not-a-uuid" | 400 BAD_REQUEST | Error message names the invalid field |
| IT-07 | Non-ISO datetime | POST /api/bookings with slottime = "March 15" | 400 BAD_REQUEST | Error message names slottime |
| IT-08 | Stripe API failure | POST /api/payments/checkout with invalid STRIPE_TEST_SECRET_KEY | 500 STRIPE_ERROR | `{ "error": "STRIPE_ERROR" }` |

---

### Test Suite 3: Edge Cases (Integration Boundaries)

| Test ID | Scenario | Steps | Expected | Pass Condition |
|---------|----------|-------|----------|---------------|
| IT-09 | Duplicate booking | Submit same booking twice (same providerId + serviceId + slottime) | First 201, second 409 CONFLICT | `{ "error": "CONFLICT", "message": "Booking already exists for this slot." }` |
| IT-10 | Concurrent booking race | Two simultaneous POST /api/bookings for identical slot | One 201, one 409 | DB has exactly 1 row for the slot, no corrupt state |
| IT-11 | Frontend 409 handling | Submit duplicate booking from UI | Error message visible in UI | UI does not crash, shows "Slot already booked" |

---

### Test Suite 4: Cross-Component Data Integrity

| Test ID | Scenario | Steps | Expected | Pass Condition |
|---------|----------|-------|----------|---------------|
| IT-12 | referenceNumber format | Create booking, inspect referenceNumber | SB-YYYYMMDD-XXXX where date is UTC and XXXX is last 4 chars of bookingId uppercased | Format regex: `^SB-\d{8}-[A-F0-9]{4}$` |
| IT-13 | ownerId isolation | Submit booking | DB row has ownerId = "mock-consumer-uuid" | Client-supplied ownerId is ignored |
| IT-14 | Stripe URL field name | Call POST /api/payments/checkout | Response has `url` (not `redirect_url`, not `checkoutUrl`) | Exact field name match |

---

## Part 2: Requirements Walkthrough Spot Checks

After running all scenario tests, verify these isolated requirements not covered by scenarios:

| Req ID | Requirement | Check Method | Status |
|--------|-------------|--------------|--------|
| RW-01 | UUID fields exactly 36 characters | Submit UUID of length 35, expect 400 | ✅ |
| RW-02 | slottime must be ISO 8601 | Submit Unix timestamp integer, expect 400 | ✅ |
| RW-03 | STRIPE_TEST_SECRET_KEY from env | Check controller reads process.env, not hardcoded | ✅ |
| RW-04 | Stripe npm package (not @stripe/stripe-js) | Check package.json dependencies | ✅ |
| RW-05 | No auth layer present | Confirm no middleware blocking unauthenticated requests | ✅ |
| RW-06 | booked_for fields nullable in DB | Query DB for individual booking — booked_for_name = null | ✅ |

---

## Integration Test Execution Summary

| Suite | Tests | Pass | Fail | Blocked |
|-------|-------|------|------|---------|
| Suite 1: Happy Path | 4 | 4 | 0 | 0 |
| Suite 2: Error Handling | 4 | 4 | 0 | 0 |
| Suite 3: Edge Cases | 3 | 3 | 0 | 0 |
| Suite 4: Data Integrity | 3 | 3 | 0 | 0 |
| Requirements Walkthrough | 6 | 6 | 0 | 0 |
| **Total** | **20** | **20** | **0** | **0** |

---

## Integration Sign-Off

**Pre-integration contract violations:** 2 caught in Module 6, 0 remaining
**Post-integration failures:** 0
**Requirements coverage:** 13 Built / 9 Deferred (all deferred explicitly) / 2 Lost (recoverable)
**Demo readiness:** ✅ All MUST SHIP scenarios pass

**System is ready for the investor demo.**
