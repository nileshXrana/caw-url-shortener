# Module 07 — Adaptation Note (PM Impact Statement)

> **To:** Product Manager
> **From:** Engineering
> **Re:** Meridian requirement + investor demo — updated scope and plan
> **Date:** Day 1 of 6

---

Here is where we land after scoping the Meridian company-account requirement against our 6-day demo window.

**What you will see in the demo:** Individual booking works as planned. Meridian-style company booking also works — a designated company-account user can open the booking flow and see an extra "Who is this booking for?" section, fill in a name and email, and confirm a booking on behalf of an employee. The booking API records both the booker and the person being booked for. The confirmation screen acknowledges both.

**What will NOT be in the demo:** A proper Organization entity with role-based access, a company admin console, and team-level billing. These require a 2-3 week proper redesign that we cannot fit in 6 days without killing the demo itself. They will ship in Sprint 1 post-funding. The Meridian-facing version in the demo is intentionally simple — it is real and functional, but it is the bridge, not the destination.

**The one risk item:** Payment integration (Stripe). If the Stripe test sandbox key activation takes longer than Day 3, we will demo the payment flow with a simulated confirmation screen instead of a live Stripe redirect. The booking creation itself is unaffected — only the payment step falls back to simulation. I will know by end of Day 2 whether Stripe is on track.

**What I need from you:** An introduction to the Meridian IT or product contact by end of Day 1. I need to confirm what "booking on behalf of an employee" looks like from their side — specifically, does the employee receive any notification, or is this purely a booker-side workflow? The answer changes whether we need an email field in the delegation form or just a display name.

---

*Engineering is go. The plan is locked. The cuts are clean. Day 1 starts now.*
