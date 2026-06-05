# Service Overview & Operations Manual

This document is the operational guide for the URL Shortener API. It contains everything an operator needs to know at 3 AM to understand, debug, deploy, and roll back this service.

---

## 1. Service Overview

### Purpose
URL shortener API that accepts long URLs and returns shortened aliases. Handles redirect resolution, click tracking, and alias expiration.

### Dependencies
| Dependency | Type | What happens without it | Fallback |
|---|---|---|---|
| PostgreSQL | Primary Datastore | Complete outage: redirects fail, link creation fails. | Wrapped in an `opossum` circuit breaker (`executeResilientDb` in `resilience.ts`) with a 1s driver query timeout and 3-attempt exponential backoff retry. On failure, the breaker trips in 3ms and returns a fast-failing HTTP 503 error payload to prevent cascading starvation. |
| Redis | Cache & Queue | Performance degradation: all requests hit database directly. Analytics enqueues fail. | Degradation is handled gracefully: cache misses default to PG reads, and analytics queue enqueue errors are caught and logged without failing the user-facing HTTP request. |

### Endpoints
*   `GET /live`: Liveness check. Returns `200 OK` with body `OK` when the process is running.
*   `GET /ready`: Readiness check. Performs a raw database query (`SELECT 1`) and a Redis `PING` check. Returns `200 OK` with body `READY` if both are healthy, or `503 Service Unavailable` with body `NOT_READY` if either is down.
*   `GET /metrics`: Exposes Prometheus metrics (`http_requests_total`, `http_request_duration_seconds`, `active_requests`).
*   `GET /r/:code`: Public redirect endpoint. Resolves short-code to long URL, updates local cache, and enqueues tracking jobs asynchronously.
*   `POST /links`: Authenticated creation of shortened links.
*   `GET /error-test`: Testing endpoint that explicitly throws an internal 500 error.

### Configuration
*   Refer to [.env.example](file:///Users/nileXrana/Desktop/caw/apps/api/.env.example) for the environment template.
*   **Operational Variables (require process restart to take effect)**:
    *   `PORT`: Port the server listens on (default: `3000`).
    *   `DATABASE_URL`: PostgreSQL connection string.
    *   `REDIS_URL`: Redis connection string.
    *   `JWT_SECRET`: Token signature key.
    *   `LOG_LEVEL`: Logging verbosity level (`debug`, `info`, `warn`, `error`).
*   **Timeouts & Circuit Breakers**:
    *   Currently hardcoded in the codebase (1s pg query timeout, 1s circuit breaker timeout, 50% error threshold, 10s cooldown reset). Changing these requires a code deployment.

### Deploy
Deployments are triggered automatically on push to the `main` branch.
To manually deploy or verify:
```bash
git push origin main
```
To verify the deployment status:
```bash
curl -i http://localhost:3000/live
curl -i http://localhost:3000/ready
```
Expected healthy output:
*   `/live` -> `HTTP/1.1 200 OK` with body `OK`
*   `/ready` -> `HTTP/1.1 200 OK` with body `READY`

### Rollback
If a deployment introduces a critical regression, roll back immediately.
On Railway:
```bash
railway status
railway rollback --to <previous-deployment-id>
```
To verify rollback:
```bash
curl -i http://localhost:3000/live
curl -i http://localhost:3000/ready
```

### Ownership
*   **Team**: LinkOps Platform Engineering
*   **Slack**: #linkops-oncall
*   **Escalation Path**: Primary On-call -> Nile (Developer) | Secondary On-call -> Tech Lead (Engineering Manager).
*   **SLA**: Primary on-call has 5 minutes to respond before paging the secondary contact.

---

## 2. Runbook: Database Connection Failure

### Alert / Detection
*   **Alert Name**: `HighErrorRate` (or `ServiceDown` if process crashed)
*   **Symptoms**: Users see `{"error": "service_unavailable", "message": "Database connection failed..."}` when resolving links. Readiness check `GET /ready` returns `503 Service Unavailable`.
*   **Indicator**: Error rate of HTTP 5xx responses exceeds 5% over 5 minutes.

### Diagnosis
Run these commands in order:

**Step 1: Check application readiness status**
```bash
curl -i http://localhost:3000/ready
```
*   If this IS the problem, you will see:
    ```http
    HTTP/1.1 503 Service Unavailable
    Content-Length: 9

    NOT_READY
    ```
*   If this is NOT the problem, you will see:
    ```http
    HTTP/1.1 200 OK
    Content-Length: 5

    READY
    ```

**Step 2: Check PostgreSQL container state**
```bash
docker inspect --format='{{.State.Status}}' linkops-db-postgres
```
*   If this IS the problem (container stopped/crashed), you will see:
    `exited`
*   If this is NOT the problem, you will see:
    `running`

**Step 3: Check database connectivity from host**
```bash
docker exec linkops-db-postgres pg_isready -U postgres -d linkops
```
*   Expected output if problem (DB rejecting connections / shutting down):
    `Error response from daemon: container linkops-db-postgres is not running` (if stopped) or `/var/run/postgresql:5432 - no response` (if running but rejecting connections)
*   Expected output if healthy:
    `/var/run/postgresql:5432 - accepting connections`

### Fix
Follow these steps in order:

**Step 1: Restart the PostgreSQL container**
```bash
docker restart linkops-db-postgres
```
*   Expected output:
    `linkops-db-postgres`
*   If this command hangs or fails, proceed to Escalation.

**Step 2: Check PostgreSQL logs for startup errors**
```bash
docker logs --tail 50 linkops-db-postgres
```
*   Expected output for healthy recovery:
    `database system is ready to accept connections`

### Verification
Confirm the fix worked:
```bash
curl -i http://localhost:3000/ready
```
*   Expected output:
    ```http
    HTTP/1.1 200 OK

    READY
    ```

Wait 2 minutes and check again:
```bash
curl -i http://localhost:3000/ready
```
*   Expected output should remain the same.

### Escalation
If this runbook does not resolve the issue within 5 minutes:
1.  Post in Slack channel `#linkops-oncall` with output logs and timestamps.
2.  Page Nile (Primary On-call) via PagerDuty/Slack.
3.  If no response in 10 minutes, page Tech Lead (Secondary On-call).

---

## 3. Runbook: Redis Cache/Queue Down

### Alert / Detection
*   **Alert Name**: `HighLatency` (due to cache bypass causing database read spikes)
*   **Symptoms**: Response times increase, and `GET /ready` returns `503 Service Unavailable`.
*   **Indicator**: Log search shows `Failed to record click` or `Redis Error` logs.

### Diagnosis
Run these commands in order:

**Step 1: Check application readiness status**
```bash
curl -i http://localhost:3000/ready
```
*   If this IS the problem, you will see:
    ```http
    HTTP/1.1 503 Service Unavailable

    NOT_READY
    ```

**Step 2: Check Redis container state**
```bash
docker inspect --format='{{.State.Status}}' linkops-redis
```
*   If this IS the problem (container stopped/crashed), you will see:
    `exited`
*   If this is NOT the problem, you will see:
    `running`

**Step 3: Check Redis ping response**
```bash
docker exec linkops-redis redis-cli ping
```
*   Expected output if problem:
    `Error: Connection refused` or no response
*   Expected output if healthy:
    `PONG`

### Fix
Follow these steps in order:

**Step 1: Restart the Redis container**
```bash
docker restart linkops-redis
```
*   Expected output:
    `linkops-redis`

**Step 2: Verify Redis responds**
```bash
docker exec linkops-redis redis-cli ping
```
*   Expected output:
    `PONG`

### Verification
Confirm the fix worked:
```bash
curl -i http://localhost:3000/ready
```
*   Expected output:
    ```http
    HTTP/1.1 200 OK

    READY
    ```

Wait 2 minutes and check again:
```bash
curl -i http://localhost:3000/ready
```
*   Expected output should remain the same.

### Escalation
If this runbook does not resolve the issue within 5 minutes:
1.  Post in `#linkops-oncall`.
2.  Page Nile (Primary On-call).
3.  If no response in 10 minutes, page Tech Lead.

---

## 4. Runbook: High Latency / Slow Responses

### Alert / Detection
*   **Alert Name**: `HighLatency`
*   **Symptoms**: 95th percentile request latency exceeds 2 seconds. Users see slow redirects.
*   **Indicator**: Prometheus shows `http_request_duration_seconds` spike.

### Diagnosis
Run these commands in order:

**Step 1: Check active request counts**
```bash
curl -s http://localhost:3000/metrics | grep active_requests
```
*   If this IS the problem (concurrency overload / thread pool block), you will see:
    `active_requests` with a value greater than 50 (e.g., `active_requests 75`).
*   If this is NOT the problem, you will see:
    `active_requests 0` or low single-digits.

**Step 2: Check database active connections**
```bash
docker exec linkops-db-postgres psql -U postgres -d linkops -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
```
*   Expected output if database connections are saturated:
    `active` state count close to the connection pool limit of `17`.
*   Expected output if healthy:
    `active` count low (e.g., 1-2).

**Step 3: Check for slow active queries**
```bash
docker exec linkops-db-postgres psql -U postgres -d linkops -c "SELECT pid, query, state, age(clock_timestamp(), query_start) FROM pg_stat_activity WHERE state != 'idle' ORDER BY age DESC LIMIT 5;"
```
*   Expected output if query storm or locking:
    Queries showing age > 1s.

### Fix
Follow these steps in order:

**Step 1: Terminate slow active queries taking more than 5 seconds**
```bash
docker exec linkops-db-postgres psql -U postgres -d linkops -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state != 'idle' AND age(clock_timestamp(), query_start) > interval '5 seconds';"
```
*   Expected output:
    List of terminated process IDs or `0 rows` if none.

**Step 2: Force-restart the local API service to clear connection limits**
```bash
kill $(lsof -t -i:3000) && npm run dev
```
*   Expected output:
    API logs showing server start and listening on port 3000.

### Verification
Confirm the fix worked:
```bash
curl -s http://localhost:3000/metrics | grep http_request_duration_seconds
```
*   Expected output:
    Latency counts within low-duration buckets (<0.1s).

Wait 2 minutes and check readiness:
```bash
curl -i http://localhost:3000/ready
```
*   Expected output:
    ```http
    HTTP/1.1 200 OK

    READY
    ```

### Escalation
If this runbook does not resolve the issue within 5 minutes:
1.  Post in `#linkops-oncall`.
2.  Page Nile (Primary On-call).
3.  If no response in 10 minutes, page Tech Lead.
