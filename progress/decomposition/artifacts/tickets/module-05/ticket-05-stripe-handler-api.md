# Ticket 5: Backend - Stripe Test Checkout Session Handler (Revised)

*   **Title:** Backend - Stripe Test Checkout Session Handler (Revised)
*   **Context:** Backend endpoint initializing Stripe Checkout for the Slice 1.5 payment spike.
*   **Scope:** Instantiates a Stripe Checkout session using sandbox keys and returns the redirect URL.
*   **Interface Contract:**
    *   **In:** `POST /api/payments/checkout` (Empty Body)
    *   **Out (200 OK):**
        ```json
        {
          "url": "https://checkout.stripe.com/pay/cs_test_..."
        }
        ```
    *   **Out (500 Internal Server Error):**
        ```json
        {
          "error": "STRIPE_ERROR"
        }
        ```
*   **Acceptance Criteria:**
    *   **Given** an inbound request, **When** hit, **Then** initialize `stripe.checkout.sessions.create` with hardcoded `$10.00` USD, static success/cancel URLs, and return `200 OK` with the session URL.
    *   **Given** the Stripe API is unreachable or credentials are invalid, **When** a request hits the endpoint, **Then** the application must catch the exception and return a `500` status code with the `STRIPE_ERROR` JSON payload.
*   **Constraints:** Node.js/TypeScript, official backend `stripe` npm package (not `@stripe/stripe-js`), uses `process.env.STRIPE_TEST_SECRET_KEY`.
*   **Anti-Scope:** No database interactions, webhooks, user mapping, or metadata passing.
