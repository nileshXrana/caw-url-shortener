# Module 07 — Blast Radius Analysis

## Change 1: Company Accounts (Minimal Bridge Implementation)

**New requirement:** Meridian Corp needs company accounts that can book on behalf of employees.
**Chosen strategy:** Minimal Bridge — add `company_name`, `can_book_for_others` to user model; add `booked_for_name`, `booked_for_email` to bookings.

| Artifact | Status | Impact |
|----------|--------|--------|
| **User data model** (`prisma/schema.prisma`) | NOT STARTED | **MAJOR** — Add `company_name: String?` and `can_book_for_others: Boolean @default(false)` to the `User` model. New Prisma migration required. |
| **Auth/JWT system** | NOT IN SCOPE (Slice 1 has no auth) | **NO IMPACT** — Auth was explicitly excluded from the current slice. |
| **Booking flow API** (`POST /api/bookings`) | IN PROGRESS (T-02) | **MAJOR** — Add `booked_for_name: String?` and `booked_for_email: String?` to the create-booking endpoint. Validation must conditionally require these fields when the booking user has `can_book_for_others = true`. Response must include `booked_for_name` and `booked_for_email` in the 201 payload. Interface contract must be updated. |
| **Booking flow UI** (T-01 Gallery + booking form) | IN PROGRESS (T-01) | **MAJOR** — When `can_book_for_others` is true, the booking form must render an additional section: "Who is this booking for?" with Name and Email fields. The booking submission payload must include `booked_for_name` and `booked_for_email`. |
| **Provider dashboard** | NOT STARTED | **MINOR** — Provider's booking list should show `booked_for_name` when present (display: "Booked by [user] for [booked_for_name]"). One-line UI change once dashboard ticket is written. |
| **Search/listing** | NOT STARTED | **NO IMPACT** — Search operates on providers, not user accounts. Company accounts do not change listing behavior. |
| **Payment/billing** | IN PROGRESS (T-05 Stripe) | **MINOR** — Billing stays on the booking user's Stripe customer record. No change to the Stripe handler itself. The booked_for fields are purely metadata in this bridge implementation. |
| **Interface contracts between streams** (`module-06-interface-contracts.md`) | COMPLETE | **MAJOR** — Contract A (`POST /api/bookings`) must be updated: request body gains two optional fields (`booked_for_name`, `booked_for_email`), response body gains these same fields in the 201 payload. Enum and UUID type constraints are unchanged. |
| **Tickets: completed** (T-03 schema setup) | COMPLETE | **MAJOR** — Schema migration already ran. A new migration adding the two columns to `User` and two columns to `Booking` must be created and applied. The seed data should add one demo user with `can_book_for_others = true` (Meridian demo account). |
| **Tickets: in progress** (T-01, T-02, T-05) | IN PROGRESS | **MAJOR (T-01, T-02)** / **NO IMPACT (T-05)** — T-01 and T-02 both need changes (see above). T-05 Stripe handler is isolated and unaffected. |
| **Tickets: not started** (T-04 payment UI) | NOT STARTED | **MINOR** — The payment UI triggers after booking confirmation. `booked_for_name` can be displayed in the confirmation summary ("Booking confirmed for [name]"). Mostly presentational. |

---

## Change 2: Compressed Timeline (6-Day Window)

All not-started tickets are evaluated for the 6-day scope. Completed/in-progress tickets are fixed.

| Ticket | Category | Rationale |
|--------|----------|-----------|
| T-03 schema setup | ✅ DONE | Fixed — already merged |
| T-02 backend booking API | 🔄 IN PROGRESS → **MUST SHIP** | Core booking flow — demo fails without it |
| T-01 gallery + booking UI | 🔄 IN PROGRESS → **MUST SHIP** | Demo entry point — can't show anything without it |
| T-05 Stripe handler | 🔄 IN PROGRESS → **MUST SHIP** | Meridian needs to see payment flow (even simulated) |
| **NEW: Company account schema migration** | **MUST SHIP** | Unblocks Meridian demo — `can_book_for_others` flag required |
| **NEW: Booking API update (booked_for fields)** | **MUST SHIP** | Required for delegation booking to work |
| **NEW: Booking UI update (delegation form)** | **MUST SHIP** | PM-visible feature — Meridian contact will test this |
| T-04 payment UI | **SHOULD SHIP** | Demo is stronger with it; can simulate if Stripe setup delays |
| Provider analytics dashboard | **CUT** — not started | No impact on demo or Meridian deal. Post-funding sprint. |
| Advanced search filters | **CUT** — not started | Nice-to-have. Demo uses static seeded data. Post-funding. |
| Email notification system | **CUT** — not started | Nothing in the current spec requires it. Post-funding. |

---

## Blast Radius Summary

**Total artifacts affected by Company Accounts:** 5 of 11 (3 MAJOR, 2 MINOR, 6 NO IMPACT)

**Highest-risk change:** `POST /api/bookings` — it's already in-progress. Any changes to its interface contract must be propagated to the frontend agent before the delegation form is built, or the two streams will diverge again.

**Safest cut:** Provider analytics dashboard — it has no dependencies and zero user-visible impact on the booking or demo flow.

**Riskiest timeline item:** Stripe test environment setup. If `STRIPE_TEST_SECRET_KEY` activation is delayed by Stripe's sandbox approval process, T-04 and T-05 cannot go live. Fallback: simulate payment with a hardcoded `{ "url": "https://demo.skillswap.com/payment-success" }` response for the demo.
