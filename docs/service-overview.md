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
*   `GET /live`: Liveness check. Returns `200 OK` with JSON `{ "ok": true }` when the process is running.
*   `GET /ready`: Readiness check. Performs a raw database query (`SELECT 1`) and a Redis `PING` check. Returns `200 OK` with JSON `{ "ok": true, "checks": { "database": "connected", "cache": "connected" }, "uptime_seconds": ... }` if healthy, or `503 Service Unavailable` with JSON `{ "ok": false, "checks": { ... } }` if either is down.
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
curl -s http://localhost:3000/live
curl -s http://localhost:3000/ready
```
Expected healthy output:
*   `/live` -> `{ "ok": true }`
*   `/ready` -> `{ "ok": true, "checks": { "database": "connected", "cache": "connected" }, ... }`

### Rollback
If a deployment introduces a critical regression, roll back immediately.
On Railway:
```bash
railway status
railway rollback --to <previous-deployment-id>
```
To verify rollback:
```bash
curl -s http://localhost:3000/live
curl -s http://localhost:3000/ready
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

### Action Plan (Checklist with Failure fallbacks)

**Step 1: Check application readiness status**
```bash
curl -i http://localhost:3000/ready
```
*   **Expected Outcome**: Returns HTTP 503 and JSON showing `"database": "disconnected"`.
*   *If this fails (e.g., connection timed out or port closed)*: The API process itself is down or blocked. Immediately skip to **High Latency Runbook** or restart the API server.

**Step 2: Check PostgreSQL container state**
```bash
docker inspect --format='{{.State.Status}}' linkops-db-postgres
```
*   **Expected Outcome**: Output is `running`.
*   *If this fails (e.g., output is `exited`, `paused`, or container not found)*: The Postgres container is down. Run `docker start linkops-db-postgres`. If it fails to start, check disk space (`df -h`) and Docker daemon status.

**Step 3: Check database connectivity from within the container**
```bash
docker exec linkops-db-postgres pg_isready -U postgres -d linkops
```
*   **Expected Outcome**: Output contains `/var/run/postgresql:5432 - accepting connections`.
*   *If this fails (e.g., no response or rejection error)*: PostgreSQL database process inside the container is frozen or crashed. Proceed to Step 4 (Restart).

**Step 4: Restart the PostgreSQL container**
```bash
docker restart linkops-db-postgres
```
*   **Expected Outcome**: Prints `linkops-db-postgres` and restarts successfully.
*   *If this fails (e.g., command hangs or times out)*: Force-stop the container via `docker kill linkops-db-postgres` and then run `docker-compose -f infra/docker-compose.yml up -d db`. If it still fails, escalate immediately.

**Step 5: Check database logs for corruption or startup failures**
```bash
docker logs --tail 50 linkops-db-postgres
```
*   **Expected Outcome**: Ends with `database system is ready to accept connections`.
*   *If this fails (e.g., log shows disk full or write-ahead-log corruption)*: DO NOT attempt to write or drop schemas. Escalate to Tech Lead immediately for WAL recovery.

---

## 3. Runbook: Redis Cache/Queue Down

### Alert / Detection
*   **Alert Name**: `HighLatency` (due to cache bypass causing database read spikes)
*   **Symptoms**: Response times increase, and `GET /ready` returns `503 Service Unavailable`.
*   **Indicator**: Log search shows `Failed to record click` or `Redis Error` logs.

### Action Plan (Checklist with Failure fallbacks)

**Step 1: Check application readiness status**
```bash
curl -i http://localhost:3000/ready
```
*   **Expected Outcome**: Returns HTTP 503 and JSON showing `"cache": "disconnected"`.
*   *If this fails (e.g., no response)*: Verify the API process is alive.

**Step 2: Check Redis container state**
```bash
docker inspect --format='{{.State.Status}}' linkops-redis
```
*   **Expected Outcome**: Output is `running`.
*   *If this fails (e.g., output is `exited`)*: Run `docker start linkops-redis`. If it fails to start, verify port conflicts or container name drift in the Docker configuration.

**Step 3: Check Redis ping response**
```bash
docker exec linkops-redis redis-cli ping
```
*   **Expected Outcome**: Output is `PONG`.
*   *If this fails (e.g., `Error: Connection refused`)*: The Redis server process inside the container has crashed or is out of memory. Proceed to Step 4 (Restart).

**Step 4: Restart the Redis container**
```bash
docker restart linkops-redis
```
*   **Expected Outcome**: Prints `linkops-redis` and restarts successfully.
*   *If this fails (e.g., hangs)*: Run `docker kill linkops-redis` followed by `docker start linkops-redis`. If still unresolved, escalate.

**Step 5: Verify Redis responds post-restart**
```bash
docker exec linkops-redis redis-cli ping
```
*   **Expected Outcome**: Returns `PONG`.
*   *If this fails*: Escalate immediately.

---

## 4. Runbook: High Latency / Slow Responses

### Alert / Detection
*   **Alert Name**: `HighLatency`
*   **Symptoms**: 95th percentile request latency exceeds 2 seconds. Users see slow redirects.
*   **Indicator**: Prometheus shows `http_request_duration_seconds` spike.

### Action Plan (Checklist with Failure fallbacks)

**Step 1: Check active request counts**
```bash
curl -s http://localhost:3000/metrics | grep active_requests
```
*   **Expected Outcome**: Output is `active_requests` with a value less than 10.
*   *If this fails (e.g., returns high values like >50)*: The server is experiencing a thundering herd or starvation. Proceed to Step 2.

**Step 2: Check database active connections**
```bash
docker exec linkops-db-postgres psql -U postgres -d linkops -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
```
*   **Expected Outcome**: Active connections are low (< 5).
*   *If this fails (e.g., active connections count is at the pool limit of 17)*: Queries are stacking up. Proceed to Step 3.

**Step 3: Identify slow running queries**
```bash
docker exec linkops-db-postgres psql -U postgres -d linkops -c "SELECT pid, query, state, age(clock_timestamp(), query_start) FROM pg_stat_activity WHERE state != 'idle' ORDER BY age DESC LIMIT 5;"
```
*   **Expected Outcome**: Query list displays with age information.
*   *If this fails (e.g., database query times out or command hangs)*: The database is locked. Skip directly to Step 5 (Server Restart).

**Step 4: Terminate slow active queries taking more than 5 seconds**
```bash
docker exec linkops-db-postgres psql -U postgres -d linkops -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state != 'idle' AND age(clock_timestamp(), query_start) > interval '5 seconds';"
```
*   **Expected Outcome**: Prints terminated process IDs.
*   *If this fails (e.g., queries cannot be terminated or keep spawning)*: A heavy transaction lock is active. Proceed to Step 5.

**Step 5: Restart the local API service and check connection health**
```bash
kill $(lsof -t -i:3000) && npm run dev
```
*   **Expected Outcome**: API restarts and metrics latency buckets go down.
*   *If this fails*: Verify that database pool sizes or Prisma adapter configurations haven't been altered recently in Git history.
