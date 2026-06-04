# Module 01 Diagnosis Notes

## Bug 1
- Symptom: Service crashed on startup with ORM/database connection error (cannot connect to DB).
- Hypothesis A:
  - Command: `docker compose -f infra/docker-compose.yml ps`
  - Observation: Postgres container was running and healthy.
- Hypothesis B:
  - Command: Checked `apps/api/.env` and container DB list (`docker exec linkops-postgres psql -U postgres -c "\\l"`).
  - Observation: App `DATABASE_URL` pointed to `upsk_sdf`, but compose created DB `linkops` (mismatch / missing DB).
- Fix:
  - Created the missing database: `docker exec linkops-postgres psql -U postgres -c "CREATE DATABASE upsk_sdf;"`.
- Verification proof:
  - API started (`npm run dev` in `apps/api`) and `curl http://localhost:3000/health` returned `OK`.

## Bug 2
- Symptom:
- Hypothesis A:
  - Command:
  - Observation:
- Hypothesis B:
  - Command:
  - Observation:
- Fix:
- Verification proof:
## Bug 2
- Symptom: Duplicate items appearing across pagination pages intermittently under concurrent inserts.
- Hypothesis A:
  - Command: Inspect generated SQL and compare page 1 and page 2 results (`curl /links/search?page=1&page_size=10`, `curl /links/search?page=2&page_size=10`).
  - Observation: Offset math was correct (no overlap in offsets) but results could shift when concurrent writes occur.
- Hypothesis B:
  - Command: Check query `orderBy` clause in code.
  - Observation: Queries used `orderBy: { createdAt: 'desc' }` which is non-deterministic when `createdAt` values tie; ties can reorder under concurrent inserts.
- Fix:
  - Made ordering deterministic by adding `id` as a tiebreaker in `orderBy` (changed to `[{ createdAt: 'desc' }, { id: 'desc' }]` in `apps/api/src/main.ts`).
- Verification proof:
  - Simulated concurrent inserts and fetched pages: `Page1` and `Page2` responses showed distinct items with no duplicates under concurrent load.
  - Example: concurrent insert test created 30 links and `/links/search?page=1&page_size=10` and `/links/search?page=2&page_size=10` returned non-overlapping results (total 30, total_pages 3).
