# RFC: Rate Limiting for the Public API

**Author:** Engineering  
**Status:** Proposed — Request for Comments  
**Reviewers needed:** Infrastructure, Platform, Product  
**Decision deadline:** [within 5 business days of circulation]

---

## 1. Problem Statement

Uncontrolled API traffic from a single client causes service degradation for all customers, and we have no automated mechanism to detect or throttle it.

Last month, one customer sent 50,000 requests per minute — roughly 30× the expected average load. Response times degraded across all clients during the incident. The on-call engineer resolved it by manually editing a config file and redeploying at 2 AM. That process takes 15–20 minutes under ideal conditions. During those minutes, every customer using the API is affected.

The business impact is threefold:

1. **Reliability**: Any customer can degrade the service for every other customer, with no automated response.
2. **Operational cost**: The current mitigation requires on-call intervention, a config change, and a deployment — that is unacceptable at 2 AM for a problem that should be handled automatically.
3. **Revenue**: The product team wants to launch a paid tier with guaranteed rate limits. Without rate limiting infrastructure, that tier cannot ship.

We need a rate limiter before the paid tier launch, and before the next incident.

---

## 2. Proposed Approach

**Where it sits:** API gateway layer, before requests reach application code.

Rate limiting at the gateway means abusive requests are rejected before they consume application server resources. This protects the entire stack — not just one service — and avoids duplicating enforcement logic across multiple API endpoints.

**Algorithm:** Token bucket.

Each API key receives a bucket that refills at a fixed rate (e.g., 1,000 tokens per minute). Each request consumes one token. When the bucket is empty, requests are rejected with `HTTP 429 Too Many Requests`. The bucket refills continuously, not at a clock boundary, so clients with bursty but infrequent traffic are not unfairly penalized.

The token bucket handles two distinct behaviors the product team needs:
- **Standard tier**: 1,000 requests/minute
- **Paid tier**: configurable per customer, up to 10,000 requests/minute

**Storage:** Redis (shared, in-memory data store).

Each API key maps to a bucket state stored in Redis. All gateway instances read and write the same Redis cluster, so limits are enforced correctly even when requests are distributed across multiple servers. Without shared storage, a client could exceed its limit by hitting different servers.

**On rejection:** Return `HTTP 429` with `Retry-After: <seconds>` header so well-behaved clients can back off automatically.

**Implementation target:** Two engineers, two weeks. No application code changes required — only gateway configuration and Redis integration.

---

## 3. Alternatives Considered

### Alternative A: Fixed Window Counter

Count requests per API key within a fixed time window (e.g., per minute, reset at :00). Simpler to implement than token bucket — a Redis `INCR` and `EXPIRE` per request.

**Why it was not chosen:** Fixed windows have a boundary vulnerability. A client can send 1,000 requests at 11:59 and 1,000 more at 12:00 — 2,000 requests in two seconds, double the intended limit, because the counter resets at the boundary. For API abuse prevention this is an exploitable gap. For a paid tier with guaranteed limits, it is a broken promise.

### Alternative B: Rate Limiting in Application Code

Add rate limiting middleware to each API service rather than at the gateway layer.

**Why it was not chosen:** Application-layer rate limiting requires each service to maintain its own counter state. With multiple API services and horizontal scaling, per-service counters cannot enforce a global limit without shared state — which re-introduces the same Redis dependency anyway, plus the implementation overhead of wiring it into every service. The gateway layer is the correct enforcement point for a cross-cutting concern that applies to all API traffic regardless of which service handles it.

---

## 4. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Redis becomes a single point of failure — if Redis goes down, the rate limiter fails | Medium | High | Deploy Redis in a replica set. Configure the gateway to fail open (allow all traffic) if Redis is unreachable, rather than blocking all traffic. Log and alert on fail-open events. |
| Legitimate clients are rate-limited during traffic spikes | Low | Medium | Set limits with headroom above the 99th percentile of observed legitimate traffic. Provide clients with `X-RateLimit-Remaining` headers so they can self-regulate. |
| Redis latency adds overhead to every request | Low | Low | Redis lookups are sub-millisecond for this use case. Add gateway-level latency monitoring; alert if p99 exceeds 5ms. |
| Limits are too aggressive and block legitimate paid customers | Medium | High | Pilot with 3 internal beta customers before paid tier launch. Limits are configurable per API key — no code change needed to adjust. |
| **Risk of doing nothing**: Next abuse incident requires 2 AM on-call intervention again; paid tier launch is blocked indefinitely | High | High | This is the forcing function. The paid tier cannot ship without this infrastructure. |

---

## 5. Open Questions

1. **Who owns the rate limit configuration?** The product team needs to set limits per customer tier, but engineering needs to ensure those limits are technically sound. Is there a self-serve dashboard, or does engineering manually configure each customer?

2. **What is the Redis budget?** We are already running Redis for session storage. Can the rate limiter share that cluster, or does it need dedicated infrastructure? (Infrastructure team input needed.)

3. **How do we handle API keys shared across multiple clients?** Some customers use a single API key across multiple applications. If the token bucket is per-key, shared keys may hit limits faster than expected. Do we track by key, by IP, or both?

4. **What is the SLA for 429 error handling in the client documentation?** Clients need to know they should implement exponential backoff. Does the developer docs team need to update the API reference before this ships?

---

## Next Steps

If this RFC is approved:

1. **Infrastructure team**: Confirm Redis cluster sizing and whether the rate limiter shares existing Redis or gets its own. Target: end of this week.
2. **Engineering**: Implement token bucket + Redis integration at gateway layer. Estimate: 2 engineers, 2 weeks.
3. **Product**: Define per-tier rate limits (standard and paid) with exact numbers. Target: before implementation starts.
4. **Developer Relations**: Update public API documentation with rate limit headers and retry guidance. Target: in parallel with implementation.

This RFC expires in 5 business days without a decision. If no objections are raised, implementation will proceed with the proposed approach.
