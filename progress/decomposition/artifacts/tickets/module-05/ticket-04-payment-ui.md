# Ticket 4: Frontend - Test Payment Spike UI

*   **Title:** Frontend - Test Payment Spike UI
*   **Context:** Simple checkout button UI for the Slice 1.5 payment spike.
*   **Scope:** Adds a `/test-payment` page with a single "Pay $10" button, along with static success/cancel pages at `/test-payment/success` and `/test-payment/cancel`.
*   **Interface Contract:**
    *   **Routes:** `/test-payment`, `/test-payment/success`, `/test-payment/cancel`
    *   **API call:** `POST /api/payments/checkout` returning `{ "url": "string" }`
*   **Acceptance Criteria:**
    *   **Given** a user on `/test-payment`, **When** they click the "Pay $10" button, **Then** trigger a POST request to `/api/payments/checkout` and redirect the browser window to the returned Stripe Checkout URL.
    *   **Given** a successful stripe redirect back to the platform, **When** hit, **Then** render the `/test-payment/success` success page showing a confirmation message.
*   **Constraints:** React/TypeScript, custom CSS styling.
*   **Anti-Scope:** No payment form inputs (hosted by Stripe), no booking association, no dynamic pricing display.
