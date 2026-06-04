# OrderFlow 3 AM On-Call Runbook

**Service Owner:** Platform Payments Team  
**On-Call Slack Channel:** `#orderflow-oncall`  
**Escalation Policy:** PagerDuty policy "OrderFlow Primary"

---

## 1. Quick Diagnostics (Verify System Health)

Perform these steps in order to diagnose the root cause of the alert:

### 1.1 Check API Service Port Status
Find the port the API is running on (default is `8080`):
```bash
export API_PORT=8080
```
Run this command to check if the API is listening on the expected port:
```bash
curl -i http://localhost:$API_PORT/healthz
```
* **If the response is HTTP 200 (OK):** The API is running. Go to **Step 1.2**.
* **If connection is refused or returns HTTP 5xx:** The API service is unhealthy or down. Skip to **Section 2.3 (API Service Down / 5xx Errors)**.

### 1.2 Check Redis Status
Run this command to check if the Redis cache and worker broker (default port `6379`) is responding:
```bash
docker exec -it redis-orderflow redis-cli ping
```
*Alternatively, if running natively:*
```bash
redis-cli -p 6379 ping
```
* **If response is `PONG`:** Redis is healthy. Go to **Step 1.3**.
* **If connection fails or times out:** Redis is down. Go to **Section 2.1 (Redis/Cache Down)**.

### 1.3 Check PostgreSQL Status
Run this command to check database connection (default port `5432`):
```bash
pg_isready -h localhost -p 5432 -U postgres
```
* **If response is `accepting connections`:** Database is healthy. Go to **Step 1.4**.
* **If response is `no response` or `rejecting connections`:** PostgreSQL is down. Go to **Section 2.2 (Database Connection Lost)**.

### 1.4 Check Celery Worker Status
Verify if the background worker process is running and actively consuming tasks:
```bash
celery -A orderflow.worker inspect ping
```
* **If response is `pong`:** Worker is healthy.
* **If worker does not respond or command errors out:** Background worker is down. Go to **Section 2.4 (Celery Background Worker Down)**.

---

## 2. Common Failure Scenarios & Recovery Procedures

### 2.1 Redis/Cache Down (Symptoms: API response is slow; rate limiting disabled)
If Redis fails, the API service continues to run but experiences degradation, and background refunds will queue up.
1. Attempt to restart the Redis container:
   ```bash
   docker restart redis-orderflow
   ```
   *If running via systemd natively:*
   ```bash
   sudo systemctl restart redis
   ```
2. Verify Redis is up:
   ```bash
   docker exec -it redis-orderflow redis-cli ping
   ```
3. If Redis restarts successfully, Celery worker processes must also be restarted to reconnect to the broker. Go to **Section 2.4 (Step 2)**.
4. If Redis fails to start or remains unresponsive after restart, escalate. Go to **Section 3 (Escalation)**.

### 2.2 Database Connection Lost (Symptoms: Database connection error logs; alembic migration failure)
1. Verify the PostgreSQL container status:
   ```bash
   docker ps -a --filter name=postgres
   ```
2. If the container is stopped, start it:
   ```bash
   docker start postgres-orderflow
   ```
   *If running via systemd natively:*
   ```bash
   sudo systemctl restart postgresql
   ```
3. Verify connection readiness:
   ```bash
   pg_isready -h localhost -p 5432 -U postgres
   ```
4. If the database was restarted after a crash, verify schema migrations:
   ```bash
   alembic upgrade head
   ```
5. If the database remains unreachable or fails to boot, escalate immediately. Go to **Section 3 (Escalation)**.

### 2.3 API Service Down / 5xx Errors (Symptoms: Connection refused on port 8080; HTTP 5xx status codes)
1. Fetch the last 100 lines of API error logs:
   ```bash
   docker logs --tail 100 orderflow-api
   ```
   *If running via systemctl natively:*
   ```bash
   journalctl -u orderflow-api -n 100 --no-pager
   ```
2. If logs show `DATABASE_URL` or `REDIS_URL` connection errors, verify infrastructure services using **Section 1.2** and **Section 1.3**.
3. If logs show local Python syntax errors or runtime exceptions immediately following a recent deployment, perform a rollback to the last stable release:
   ```bash
   helm rollback orderflow --namespace production
   ```
4. If the rollback completes successfully, verify API health status:
   ```bash
   curl -i http://localhost:8080/healthz
   ```
5. If the service is still down or returning 5xx after rollback, escalate. Go to **Section 3 (Escalation)**.

### 2.4 Celery Background Worker Down (Symptoms: Asynchronous refunds queue up in Redis and do not process)
1. Inspect the Celery worker process logs:
   ```bash
   docker logs --tail 100 orderflow-worker
   ```
2. Restart the Celery background worker process:
   ```bash
   docker restart orderflow-worker
   ```
   *If running natively in the shell:*
   ```bash
   celery -A orderflow.worker worker --loglevel=info &
   ```
3. Check the active Celery worker queue size to verify queue drainage:
   ```bash
   celery -A orderflow.worker inspect active
   ```
4. If refunds are still not processing or the worker logs continue to show connection failures, verify Redis connectivity using **Section 2.1**.

---

## 3. Escalation Path

If the recovery procedures above do not resolve the issue within **15 minutes** of the initial page, escalate:

1. **Slack Escalation:** Post a thread in `#orderflow-oncall` with the diagnostic outputs from Section 1.
2. **Database Escalation:** If PostgreSQL remains down and is not accepting connections, page the Database team in `#data-eng`.
3. **Deployment Escalation:** If Helm rollback fails or Kubernetes cluster deployment issues persist, page the Infrastructure team in `#platform-infra`.
4. **Primary Escalation:** Trigger a page via PagerDuty for the **OrderFlow Primary** escalation policy.
