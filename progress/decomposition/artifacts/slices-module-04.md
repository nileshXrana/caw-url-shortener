# SkillSwap Vertical Slice Definitions

This document outlines the step-by-step vertical slices designed to build the SkillSwap marketplace from the ground up, starting from the thinnest possible end-to-end flow and scaling to a fully functional transactional system.

---

## Slice 1: Browse and Book (Seeded Data / Ultra-Thin)

### 1. Name
Browse and Book (Seeded Data)

### 2. Scope (What Is In)
*   **Database:** A single `Booking` table representing the relation between seeded users and providers.
*   **Backend:** Expose `GET /providers` (returns 3 seeded providers) and `POST /bookings` (creates a booking with static time/user fields).
*   **UI:** 
    *   Home page displays 3 hardcoded provider cards with basic categories.
    *   Clicking a provider shows a detail page with one service and a static list of 3 time slots.
    *   Clicking "Book Now" sends a REST request to persist the booking and redirects the user to a success page displaying a generated Booking ID, provider name, and time slot.

### 3. Anti-Scope (What Is Explicitly Out)
*   No user registration or authentication (all requests execute anonymously with a mock user ID).
*   No provider-side interface or signup (provider data is seeded directly to the database).
*   No payment processing (all bookings are free/unpaid).
*   No dynamic calendar libraries or availability validation (slots are static seed strings).
*   No cancellation, reschedule, or reviews.
*   No notifications (SMS/Email).

### 4. Dependencies
None.

### 5. Acceptance Criteria
1.  Open the homepage and see exactly 3 seeded providers.
2.  Click on any provider to open their details page, showing a single service and 3 slots.
3.  Select a time slot and click "Book Now."
4.  Verify redirect to a confirmation screen showing the Booking ID, correct provider name, and slot.
5.  Refresh the page and verify the booking persistence.

### 6. Estimated Complexity
S (Small — 2 hours)

---

## Slice 1.5: Stripe Payment Spike (Parallel Demo)

### 1. Name
Stripe Payment Spike

### 2. Scope (What Is In)
*   **Route:** A single, isolated route (`/test-payment`) containing a hardcoded "Pay $10" button.
*   **Backend:** Server-side initialization of a raw Stripe Checkout session using hardcoded API test keys.
*   **UI/Redirection:** Redirection to the hosted Stripe Checkout interface and back to a static success or cancel page (`/test-payment/success`) hosted on localhost.

### 3. Anti-Scope (What Is Explicitly Out)
*   No database writes, updates, or relations to a `Booking` table.
*   No Webhook endpoint implementation or handling of asymmetrical event states (e.g., payment failed, charge refunded).
*   No `User` or billing account association.
*   No dynamic amount or currency calculation.

### 4. Dependencies
None.

### 5. Acceptance Criteria
1.  Navigate to `/test-payment` and click the button to securely redirect to the external Stripe domain.
2.  Enter standard test card details and submit the payment to return to the local success landing page.

### 6. Estimated Complexity / Time box
XS (Extra Small — Strict 3-hour time-box execution limit)

---

## Slice 2: User Authentication & Personal Bookings List

### 1. Name
User Authentication & Personal Bookings

### 2. Scope (What Is In)
*   **Database:** Add `User` credentials mapping.
*   **Backend:** Implement JWT-based signup, login, and token validation. Secure the `POST /bookings` endpoint to associate bookings with the authenticated caller context.
*   **UI:** 
    *   Add basic login/register form overlay.
    *   Add a "My Bookings" profile page showing the logged-in user's historical booking cards (displaying status, provider, and slot).

### 3. Anti-Scope (What Is Explicitly Out)
*   No provider registration/login (providers are still seeded).
*   No OAuth or third-party auth (Google/GitHub).
*   No password reset flows.
*   No payments or calendar changes.

### 4. Dependencies
Slice 1 (Browse and Book).

### 5. Acceptance Criteria
1.  Register a new user account, then log in.
2.  Browse to a provider, choose a slot, and click "Book Now."
3.  Navigate to "My Bookings" page and verify the new booking appears with correct details.
4.  Log out and attempt to book a slot; verify the system rejects or redirects to login.

### 6. Estimated Complexity
S (Small — 3 hours)

---

## Slice 3: Provider Self-Service & Profile Management

### 1. Name
Provider Profile Builder

### 2. Scope (What Is In)
*   **Database:** Extend user records to support a `Provider` role and profile details (bio, category, services offered).
*   **Backend:** Add provider login validation and profile-update endpoints.
*   **UI:** 
    *   Add a toggle to switch profile mode to "Provider Mode."
    *   Add a simple provider dashboard form where providers can list/update their service description, rate, and select static weekly availability slots.

### 3. Anti-Scope (What Is Explicitly Out)
*   No dynamic calendar schedule changes (slots are configured as static day/time dropdown checkboxes).
*   No booking approvals (bookings made by users are auto-confirmed).
*   No dashboard analytics or payment payout configurations.

### 4. Dependencies
Slice 2 (User Authentication).

### 5. Acceptance Criteria
1.  Log in and toggle account role to "Provider."
2.  Fill out the profile (bio, rate, select 3 weekly slots) and click save.
3.  Log out, browse the marketplace as a separate user, and verify the newly configured provider now appears in the browse list with their exact services and slots.

### 6. Estimated Complexity
M (Medium — 1 day)

---

## Slice 4: Dynamic Availability & Race-Condition Hardening

### 1. Name
Dynamic Scheduling and Double-Booking Prevention

### 2. Scope (What Is In)
*   **Database:** Transition slots from static strings to a dynamic `TimeSlot` schema representing real-time availability states.
*   **Backend:** 
    *   When booking, check availability status. 
    *   Introduce a database transaction lock (pessimistic lock or atomic update) to prevent concurrent bookings on the same slot.
    *   Mark booked slots as unavailable immediately upon persistence.
*   **UI:** Gray out or hide slots that are already booked.

### 3. Anti-Scope (What Is Explicitly Out)
*   No external Google Calendar sync integrations.
*   No cancellation or slot release logic (once booked, it stays booked).

### 4. Dependencies
Slice 3 (Provider Profile Builder).

### 5. Acceptance Criteria
1.  User A logs in, views Provider X, and books the Monday 2:00 PM slot.
2.  User B logs in, views Provider X, and verifies the Monday 2:00 PM slot is disabled or hidden.
3.  Trigger two simultaneous API requests for the same slot; verify one succeeds while the other is rejected with a `409 Conflict` state.

### 6. Estimated Complexity
M (Medium — 1 day)

---

## Slice 5: Stripe Checkout Transaction Flow

### 1. Name
Stripe Payments Integration

### 2. Scope (What Is In)
*   **Database:** Add billing reference and payment status fields to the `Booking` schema.
*   **Backend:** 
    *   Initialize Stripe Checkout sessions on booking attempts.
    *   Handle Stripe webhooks (`checkout.session.completed`) to confirm booking state changes.
*   **UI:** Redirect to Stripe for checkout upon clicking "Book Now." Successful transaction returns user to confirmation page; failure directs back to provider slot selection.

### 3. Anti-Scope (What Is Explicitly Out)
*   No payment card storage inside our database (rely fully on Stripe vault).
*   No dispute handling, surcharges, or split payouts (all go to a single platform account for this slice).

### 4. Dependencies
Slice 4 (Dynamic Scheduling).

### 5. Acceptance Criteria
1.  Attempt to book a slot and verify browser redirects to the official Stripe payment page.
2.  Complete the booking with a mock test card.
3.  Verify redirect to success page and confirm the database status for the booking shifts to "Paid/Confirmed."
4.  Navigate away mid-checkout; verify slot is released and booking remains unconfirmed.

### 6. Estimated Complexity
M (Medium — 1.5 days)
