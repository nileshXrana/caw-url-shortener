# Module 08 — Requirements Traceability Matrix

> Traces all requirements extracted in Module 1 through decomposition, implementation, and integration testing.
> Status key: **Built** | **Simplified** | **Deferred** | **Lost**

---

## Slice 1: Provider Booking

| Requirement | Module 1 Source | Ticket | Status | Notes |
|-------------|-----------------|--------|--------|-------|
| Browse provider listings | Original scope | T-01 (Gallery UI) | **Built** | 3 seeded providers, static gallery |
| View provider name, price, availability | Original scope | T-01 | **Built** | Card renders name, flat-rate price, availableSlot string |
| Book a provider service | Original scope | T-01 + T-02 | **Built** | Gallery → booking form → POST /api/bookings |
| Booking creates a confirmed record in DB | Original scope | T-02 | **Built** | Prisma write to Booking table, status = "confirmed" |
| Reference number generated on booking | Original scope | T-02 | **Built** | SB-YYYYMMDD-XXXX format, last 4 chars of bookingId |
| Duplicate booking prevented | Risk mitigation (Module 5) | T-02 | **Built** | Unique constraint + 409 CONFLICT response |
| Input validation on booking fields | Risk mitigation (Module 5) | T-02 | **Built** | UUID length check, ISO 8601 format validation |
| Mock tenant authorization | Risk mitigation (Module 5) | T-02 | **Built** | ownerId hardcoded to mock-consumer-uuid |
| Database schema for Booking and Provider | Original scope | T-03 | **Built** | Prisma schema, 3 seeded providers |

---

## Slice 1.5: Payment Spike

| Requirement | Module 1 Source | Ticket | Status | Notes |
|-------------|-----------------|--------|--------|-------|
| Stripe Checkout session initialization | Original scope | T-05 | **Built** | Hardcoded $10 USD, static URLs |
| Return Stripe checkout URL to frontend | Original scope | T-05 | **Built** | `{ "url": "..." }` response shape |
| Handle Stripe API failure gracefully | Interface contract addendum | T-05 | **Built** | 500 + `{ "error": "STRIPE_ERROR" }` |
| Payment confirmation UI | Original scope | T-04 | **Built** | Payment UI with Stripe redirect |

---

## Module 7 Additions: Company Accounts (Minimal Bridge)

| Requirement | Module 7 Source | Ticket | Status | Notes |
|-------------|-----------------|--------|--------|-------|
| Company user can book for an employee | Meridian requirement | T-01 (modified) + T-02 (modified) | **Built** | booked_for_name/email fields, delegation form UI |
| Schema supports company fields | Meridian requirement | NEW-01 | **Built** | company_name + can_book_for_others on User; booked_for fields on Booking |
| Demo company account seeded | Meridian requirement | NEW-01 | **Built** | meridian-demo@skillswap.com with can_book_for_others=true |

---

## Explicitly Deferred

| Requirement | Reason | Target |
|-------------|--------|--------|
| Role-based access control (manager/employee/dept-head) | Requires auth layer not in Slice 1 scope | Sprint 1 post-funding |
| Organization entity with proper RBAC | Same dependency on JWT/session infrastructure | Sprint 1 post-funding |
| Company admin console | Requires RBAC as prerequisite | Sprint 1 post-funding |
| Provider analytics dashboard | Descoped in Module 7 timeline compression | Sprint 1 post-funding |
| Advanced search and filters | Descoped in Module 7 timeline compression | Sprint 1 post-funding |
| Email notification system | No infrastructure; not in current acceptance criteria | Sprint 2 post-funding |
| Cancellation flow + refund logic | Out of Slice 1 scope | Sprint 2 post-funding |
| Scheduling conflict validation | Explicitly in T-02 anti-scope | Sprint 2 post-funding |
| Authentication layer | Excluded from Slice 1 ultra-thin scope | Sprint 1 post-funding |

---

## Lost Requirements

| Requirement | Where It Was Lost | Recovery Action |
|-------------|-------------------|-----------------|
| Provider sees new booking on dashboard | Dashboard was cut in Module 7 — no ticket written for it | Add `GET /api/providers/:id/bookings` to Sprint 1 backlog |
| User receives booking confirmation | Email notifications deferred but no explicit ticket exists to pick this up | Create T-06: Email notification ticket in Sprint 1 planning |

---

## Traceability Summary

| Status | Count |
|--------|-------|
| ✅ Built | 13 |
| 🔄 Simplified | 0 |
| 📅 Deferred | 9 |
| ❌ Lost | 2 |

**Total requirements tracked:** 24

**Coverage of core demo scope:** 100% — all MUST SHIP requirements are Built.

**Lost requirements recovery:** Both lost items are recoverable in Sprint 1 with single-ticket additions.
