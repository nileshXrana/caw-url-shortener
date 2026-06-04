# Postmortem: OrderProcessor Silent Order Drop
**Incident Date:** Wednesday [date]  
**Duration:** 2 hours (14:00 – 16:02)  
**Severity:** SEV-1  
**Status:** Resolved  

---

## 1. Summary

On Wednesday afternoon, OrderProcessor v2.14 was deployed with a configuration change that removed a field still read by the service's order creation logic. The service did not crash — it silently swallowed the error, returned `HTTP 200` to clients, and discarded the order. Approximately 1,400 customer orders were silently dropped over 2 hours. Customer credit cards were charged; no orders were created; no confirmation emails were sent. Total revenue impact: approximately $186,000. Detection took 22 minutes because monitoring covered only HTTP status codes and latency, not business-level outcomes. Recovery took 94 additional minutes because the rollback automation had not been validated since an infrastructure migration 4 months prior, requiring manual platform team intervention. All 1,400 orders were eventually reprocessed from payment processor logs.

---

## 2. Five-Whys Analysis

**Symptom:** Customers were charged but orders were not created.

**Why 1:** The order creation logic could not find the `warehouse_routing` field it required.  
→ The field was removed from the config in v2.14 as part of a planned deprecation.

**Why 2:** The missing field did not cause the service to fail or alert.  
→ A broad `try/except` block caught the `KeyError`, logged a `DEBUG`-level warning, and returned `HTTP 200` to the caller — making the failure invisible to both the client and the monitoring system.

**Why 3:** The broad `try/except` was not caught in staging.  
→ The staging environment uses a different config schema than production and never had `warehouse_routing` to begin with. Staging could not reproduce a production-specific field removal.

**Why 4:** The monitoring system did not detect that orders had stopped being created.  
→ Monitoring was instrumented on HTTP response codes and latency only. There was no alerting on business-level outcomes such as orders-per-minute dropping to zero.

**Why 5 (Systemic Root):** Operators had no mechanism to verify that a config change in one service would not silently break a dependent business flow in another.  
→ The deprecation process marked `warehouse_routing` as deprecated but did not enforce a contract check verifying all consumers had stopped using it before removal. The staging/production config divergence made automated contract verification impossible.

---

## 3. Root Cause(s)

The service was architecturally capable of silently discarding business-critical operations. Two systemic gaps made this possible:

**Root Cause 1 — Missing business-level monitoring:** The monitoring system checked infrastructure health (HTTP codes, latency, CPU) but had no visibility into whether the service was actually completing its core function. An "orders created per minute" metric dropping to zero for 22 minutes went undetected.

**Root Cause 2 — Config/code contract unenforced:** The deprecation policy allowed a field to be removed from a config without verifying all active consumers had migrated. The staging environment's divergent schema meant no automated test could catch the removal's impact before it reached production.

---

## 4. Contributing Factors

| Factor | Impact |
|--------|--------|
| `DEBUG`-level log for a business-critical failure | The `KeyError` was recorded but not surfaced to any alert or on-call dashboard. A `CRITICAL`-level log or direct error return would have triggered alerts immediately. |
| Initial misclassification as email delay | The first 15 minutes of customer reports were assumed to be a known email delivery lag. This delayed investigation by 15 minutes and extended customer impact. |
| Rollback automation not validated post-infrastructure migration | The rollback script referenced a deprecated artifact path. What should have been a 7-minute automated rollback (14:02–14:09) took 32 additional minutes of manual platform team work. |
| `HTTP 200` returned on silent failure | Clients received success signals while orders were discarded. This masked the incident from external monitoring tools that check endpoint health. |
| Staging/production config divergence | A missing field that would have caused immediate failures in a production-equivalent staging environment went undetected because staging had never had the field in the first place. |

---

## 5. Action Items

| # | Description | Owner | Deadline | Definition of Done |
|---|-------------|-------|----------|--------------------|
| A1 | Add business-level alerting: orders-per-minute widget with zero-order alert firing after 5 consecutive minutes | Observability team lead | 7 days | Dashboard widget live in production monitoring, alert verified to fire in a staging drill where order creation is intentionally blocked |
| A2 | Replace broad `try/except` on `warehouse_routing` lookup with explicit field validation that returns `HTTP 500` on missing required config | OrderProcessor team lead | 3 days | Unit test confirms service returns `500` when `warehouse_routing` absent; integration test confirms this surfaces in monitoring |
| A3 | Test and repair rollback automation against current infrastructure | Platform team lead | 14 days | Full rollback drill executed end-to-end for the last 3 major services; rollback time under 10 minutes documented |
| A4 | Enforce config contract check in deployment pipeline: deprecation of a config field requires a scan confirming zero active reads before removal is permitted | Platform team lead | 30 days | Deployment pipeline blocks removal of any config field still referenced in service code across all environments |
| A5 | Align staging and production config schemas: staging must include all production fields (optionally mock values) | Infrastructure team lead | 21 days | Staging config passes a schema diff check against production config with zero unexpected field gaps |
| A6 | Raise `warehouse_routing` lookup failure from `DEBUG` to `CRITICAL` log level as immediate patch | OrderProcessor team lead | 1 day | Deployed to production; verified in log stream |

---

## 6. Lessons Learned

**What surprised the team:**
- A service can return `HTTP 200` while silently failing to perform its core function. Health checks that cover only response codes and latency do not validate business correctness.
- Staging parity with production matters for more than functional testing. Config schema divergence created a category of failure that staging was structurally incapable of catching.
- Rollback automation that was not tested for 4 months was effectively non-functional. Untested rollback is not rollback — it is a plan that has never been verified.

**What worked well:**
- Payment processor logs contained complete records of all affected transactions, enabling full order reprocessing without permanent customer impact.
- The customer support escalation channel surfaced the issue before any automated alert would have. The human signal (user reports on social media) arrived faster than the monitoring system.

**What the team would do differently before action items are complete:**
- Treat zero-order periods as a manual monitoring check during any deployment, until A1 is live.
- Require an explicit "order creation verified" signal (manual DB check) in the post-deployment checklist for any OrderProcessor release, until A4 is complete.
- Maintain a rollback contact list for platform team manual intervention during off-hours, until A3 is complete.

---

*No individual names appear in this document. Findings are systemic.*
