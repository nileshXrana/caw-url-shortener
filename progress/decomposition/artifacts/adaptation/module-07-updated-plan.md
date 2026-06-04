# Module 07 — Updated Execution Plan (Post-Adaptation)

> **Trigger:** Mid-build requirement change — Meridian Corp company accounts + 6-day investor demo deadline.
> **Strategy chosen:** Minimal Bridge (Option B) + Replan From Current State (Option B).
> **Replanned on:** Day 1 of 6.

---

## Section 1: Preserved (Completed — No Changes)

| Ticket | Status | Notes |
|--------|--------|-------|
| T-03: Database Schema Setup & Seeding | ✅ DONE | Schema migration ran. 3 providers seeded. **A follow-on migration (NEW-01) will add company account fields.** |

---

## Section 2: Modified (In-Progress Tickets — Changes Required)

### T-02: Backend `POST /api/bookings` (MODIFIED)

**Original scope:** Accept `providerId`, `serviceId`, `slottime`. Return `bookingId`, `status`, `referenceNumber`.

**Added scope:**
- Request body: add optional `booked_for_name: string` (max 100 chars) and `booked_for_email: string` (valid email format, max 254 chars).
- Validation: if the booking user's `can_book_for_others = true`, then `booked_for_name` and `booked_for_email` are required. If `can_book_for_others = false` and these fields are present, ignore them (do not error — forward-compatibility).
- Response 201: add `booked_for_name` and `booked_for_email` fields (nullable) to the response body.
- Interface contract `module-06-interface-contracts.md` Contract A must be updated to reflect these changes.

**Estimate delta:** +4 hours (validation logic + contract update + re-testing).

---

### T-01: Frontend Provider Gallery + Booking UI (MODIFIED)

**Original scope:** Render 3 provider cards, "Book Now" transitions to confirmation view.

**Added scope:**
- After clicking "Book Now", check if the logged-in user has `can_book_for_others = true` (read from a demo flag in local state for now — no auth in this slice).
- If true: render a delegation section in the booking form — "Booking for someone else?" with `booked_for_name` (text input) and `booked_for_email` (email input).
- Booking submission payload conditionally includes `booked_for_name` and `booked_for_email`.
- For the demo: pre-set the demo user as a company-account user so the delegation form is always visible.

**Estimate delta:** +3 hours (form expansion + conditional rendering + local demo flag).

---

### T-05: Backend Stripe Checkout Handler (UNMODIFIED)

**Original scope:** `POST /api/payments/checkout` → Stripe session URL.

**No changes.** Company accounts do not affect the Stripe handler. Billing stays on the booking user's account. T-05 ships as-is.

---

## Section 3: Cut (Descoped from 6-Day Window)

| Ticket | Cut Reason | When |
|--------|-----------|------|
| **Provider analytics dashboard** | No analytics data exists yet; zero impact on demo or Meridian deal. Non-blocking to cut. | Post-funding Sprint 1 |
| **Advanced search filters** | Demo uses 3 seeded providers — static display is sufficient. No search needed to demonstrate the booking flow. | Post-funding Sprint 1 |
| **Email notification system** | No email infrastructure exists. Not in any acceptance criteria for the 6-day scope. | Post-funding Sprint 2 |

---

## Section 4: Added (New Tickets for Company Accounts)

### NEW-01: Company Account Schema Migration (Size: S — ~2 hours)

**Scope:** Add `company_name: String?` and `can_book_for_others: Boolean @default(false)` to the `User` model. Add `booked_for_name: String?` and `booked_for_email: String?` to the `Booking` model. Create and apply the Prisma migration. Update the database seed to add one demo company-account user (`meridian-demo@skillswap.com`, `can_book_for_others = true`).

**Dependency:** Must complete before T-02 (MODIFIED) and T-01 (MODIFIED) can be tested end-to-end.

---

### NEW-02: T-04 Payment UI (Size: M — ~4 hours, SHOULD SHIP)

**Scope:** Frontend payment confirmation screen. Triggered after `POST /api/payments/checkout` returns a session URL. Shows confirmation message including `booked_for_name` when present ("Payment initiated for [booked_for_name]"). Redirects to Stripe checkout URL or shows simulated confirmation if Stripe URL is unavailable.

**Risk:** Depends on Stripe test key being active. Fallback: render a static "Payment Demo" screen with a hardcoded success state.

---

## Revised 6-Day Execution Timeline

| Day | Stream A (Backend) | Stream B (Frontend) | Stream C (Infra/Schema) |
|-----|--------------------|---------------------|-------------------------|
| **Day 1** | T-02 modifications (validation + contract update) | T-01 delegation form UI | NEW-01 schema migration |
| **Day 2** | T-02 complete + test | T-01 complete + test | Seed demo company user |
| **Day 3** | T-05 Stripe integration test | NEW-02 Payment UI (start) | Environment variables setup |
| **Day 4** | Integration smoke test (all three streams) | NEW-02 Payment UI (complete) | CP2 verification pass |
| **Day 5** | Bug fixes from CP2 | Demo script rehearsal | Final contract validation |
| **Day 6** | 🎯 Demo day | 🎯 Demo day | 🎯 Demo day |

---

## Updated Interface Contract Delta

Contract A (`POST /api/bookings`) additions:

```diff
  Request Body:
    {
      "providerId": "string (UUID v4, required)",
      "serviceId":  "string (UUID v4, required)",
      "slottime":   "string (ISO 8601 UTC, required)",
+     "booked_for_name":  "string (max 100 chars, optional)",
+     "booked_for_email": "string (valid email, max 254 chars, optional)"
    }

  Response 201:
    {
      "bookingId":       "string (UUID v4)",
      "status":          "confirmed",
      "referenceNumber": "string (SB-YYYYMMDD-XXXX)",
+     "booked_for_name":  "string | null",
+     "booked_for_email": "string | null"
    }
```
