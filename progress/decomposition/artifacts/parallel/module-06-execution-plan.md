# Module 06 — Parallel Execution Plan

## Parallelism Strategy Decision
**Decision:** `isolated_branches`

Each agent works in its own git branch. The only shared artifacts are the interface contracts defined in `artifacts/contracts/module-06-interface-contracts.md`. No agent sees another agent's in-progress code. Integration happens at merge time, validated by CI.

**Rationale:** With 2 backend streams + 1 frontend stream and strict interface contracts already defined, isolated branches prevent mid-execution conflicts on shared files (migrations, `prisma/schema.prisma`, shared utilities). Contract violations are caught at the merge checkpoint, not mid-flight.

---

## Sync Point Design Decision
**Decision:** `checkpoint_syncs`

Two explicit synchronization checkpoints are defined below. "End-only sync" (big bang integration) was rejected — if a contract violation is baked in at agent launch, discovering it at the end wastes all execution time.

---

## Parallel Ticket Selection

Three tickets from Module 5 are confirmed parallelizable. Dependency graph check:

| Ticket | Depends On |
|--------|------------|
| T-01: Frontend Gallery UI | `GET /api/providers` shape (contract only, not T-02 runtime) |
| T-02: Backend `POST /api/bookings` | T-03 (schema) — schema must be deployed first |
| T-05: Backend Stripe Handler | Nothing — fully isolated |

**Parallelization plan:**
- **Pre-condition:** T-03 (schema setup) must be merged and deployed to local dev DB before T-02 launches.
- **Stream A — Agent Alpha:** T-02 `POST /api/bookings` (backend)
- **Stream B — Agent Beta:** T-05 `POST /api/payments/checkout` (backend)
- **Stream C — Agent Gamma:** T-01 Provider Gallery UI (frontend)

Streams A, B, and C have no hard runtime dependencies on each other during development. They share only the interface contracts.

---

## Checkpoint Schedule

### Checkpoint 1 — First Output Verification (est. ~15 min into execution)
**Trigger:** Each agent has produced its first working endpoint / component shell.

**What to verify:**
- [ ] Agent Alpha: `POST /api/bookings` returns any response (even stub) at the correct path
- [ ] Agent Beta: `POST /api/payments/checkout` returns any response at the correct path
- [ ] Agent Gamma: Gallery UI renders at least a static card layout in the browser

**Contract check at CP1:**
- Alpha: Is `bookingId` a UUID string? Is `referenceNumber` formatted `SB-YYYYMMDD-XXXX`?
- Beta: Is `url` a string field (not `redirect_url` or `checkout_url`)?
- Gamma: Is the provider card calling `GET /api/providers` (not `/providers` or `/api/v1/providers`)?

### Checkpoint 2 — Integration Merge (est. after all streams complete)
**Trigger:** All three agents have finished their tickets.

**What to verify:**
- [ ] Merge branch-alpha → main (no schema conflicts)
- [ ] Merge branch-beta → main (no conflicts)
- [ ] Merge branch-gamma → main (no conflicts)
- [ ] Run full integration: gallery loads → click Book Now → booking API creates row → confirmed status returned
- [ ] Stripe handler returns `{ "url": "..." }` when called from the payment UI

---

## Agent Briefing Template

Each agent receives exactly:
1. Their assigned ticket (full spec from Module 5)
2. Their relevant interface contract section
3. This shared context block:

```
Tech stack: Node.js / TypeScript / Express / Prisma ORM / React
Database: PostgreSQL (local dev instance)
Base API URL: http://localhost:3001
Frontend dev URL: http://localhost:3000
Datetime format: ISO 8601 UTC (e.g. "2025-03-15T14:30:00Z")
UUID format: v4 (e.g. "550e8400-e29b-41d4-a716-446655440000"), exactly 36 characters
Do NOT add endpoints, fields, or features not specified in the ticket.
Do NOT accept user IDs from client payloads — see ticket constraints.
```

---

## Coordinator Monitoring Checklist

During execution, watch each agent for:

- [ ] **Agent drift:** Agent adds endpoints or features not in the ticket → redirect: "That is out of scope. Stick to the contract."
- [ ] **Contract ambiguity:** Agent asks about datetime format, UUID type, or field name → fix the contract immediately, update both other agents if shared.
- [ ] **Scope creep:** Agent writes tests, Dockerfiles, or deployment configs not in the ticket → decide: keep if fast, discard if distracting.
- [ ] **Status awareness:** Can you answer "what % complete is each stream?" at any moment? If not, ask each agent for a status line.
