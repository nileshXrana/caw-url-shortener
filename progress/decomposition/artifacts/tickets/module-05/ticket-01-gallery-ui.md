# Ticket 1: Frontend - Provider Gallery View

*   **Title:** Frontend - Provider Gallery View
*   **Context:** Home page for Slice 1 demonstrating the browse and booking clickthrough path.
*   **Scope:** Renders a static view displaying the 3 seeded provider cards (plumber, web designer, guitar teacher).
*   **Interface Contract:**
    *   Fetches provider list from `GET /api/providers`.
    *   Expected JSON structure:
        ```json
        [
          {
            "id": "UUID",
            "name": "string",
            "price": "number",
            "availableSlot": "string"
          }
        ]
        ```
*   **Acceptance Criteria:**
    *   **Given** 3 seeded providers are returned from the API, **When** the page loads, **Then** render exactly 3 cards, each showing the provider's name, flat-rate price, and single available slot.
    *   **Given** a provider card, **When** the user clicks "Book Now", **Then** transition to the booking success/confirmation view.
*   **Constraints:** React/TypeScript, custom CSS styling, matches project layouts.
*   **Anti-Scope:** No user login views, search input fields, category filters, or calendar picker components.
