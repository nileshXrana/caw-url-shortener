import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../main";
import { getDb } from "../db";
import { config } from "../config";
import jwt from "jsonwebtoken";
import { purgeOldAnalytics } from "../purge";
import { v4 as uuidv4 } from "uuid";
import { redis } from "../redis";

const TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/bootcamp_test?schema=public";
const db = getDb(TEST_DB_URL);

const tenantA = { id: "tenant-a", email: "a@example.com" };
const tenantB = { id: "tenant-b", email: "b@example.com" };

// Include "id" in JWT so "createdBy" constraint is satisfied
const tokenA = jwt.sign({ id: "user-a", tenantId: tenantA.id, email: tenantA.email }, config.jwtSecret, { algorithm: "HS256" });
const tokenB = jwt.sign({ id: "user-b", tenantId: tenantB.id, email: tenantB.email }, config.jwtSecret, { algorithm: "HS256" });

describe("Integration Tests", () => {
  beforeAll(async () => {
    // Cleanup
    await db.analyticsBucket.deleteMany();
    await db.linkClick.deleteMany();
    await db.link.deleteMany();
    await redis.flushdb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe("Link Creation & Retrieval", () => {
    it("should create a link for authenticated user", async () => {
      const res = await request(app)
        .post("/links")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          longUrl: "https://google.com",
          code: "tenant-a_google"
        });

      expect(res.status).toBe(201);
      expect(res.body.longUrl).toBe("https://google.com");
      expect(res.body.code).toBe("tenant-a_google");
      expect(res.body.tenantId).toBe(tenantA.id);
    });

    it("should return 401 for unauthenticated requests", async () => {
      // No Authorization header
      const res = await request(app)
        .post("/links")
        .send({ longUrl: "https://google.com" });
      expect(res.status).toBe(401);

      // Empty string
      const resEmpty = await request(app)
        .post("/links")
        .set("Authorization", "")
        .send({ longUrl: "https://google.com" });
      expect(resEmpty.status).toBe(401);

      // Bearer with space but no token
      const resBearerOnly = await request(app)
        .post("/links")
        .set("Authorization", "Bearer ")
        .send({ longUrl: "https://google.com" });
      expect(resBearerOnly.status).toBe(401);

      // Whitespace only
      const resWhitespace = await request(app)
        .post("/links")
        .set("Authorization", " ")
        .send({ longUrl: "https://google.com" });
      expect(resWhitespace.status).toBe(401);

      // Bearer with no space or token
      const resBearerNoSpace = await request(app)
        .post("/links")
        .set("Authorization", "Bearer")
        .send({ longUrl: "https://google.com" });
      expect(resBearerNoSpace.status).toBe(401);

      // Wrong scheme
      const resMalformed = await request(app)
        .post("/links")
        .set("Authorization", "Basic dXNlcjpwYXNz")
        .send({ longUrl: "https://google.com" });
      expect(resMalformed.status).toBe(401);
    });
  });

  describe("Redirect", () => {
    it("should redirect to long URL and record analytics", async () => {
      const code = "tenant-a_ex";
      const createRes = await request(app)
        .post("/links")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ longUrl: "https://example.com", code });

      expect(createRes.status).toBe(201);

      const res = await request(app).get(`/r/${code}`);
      expect(res.status).toBe(302);
      expect(res.header.location).toBe("https://example.com");
    });
  });

  describe("Security: IDOR", () => {
    it("should not allow Tenant B to access Tenant A's link", async () => {
      const code = "tenant-a_private";
      const createRes = await request(app)
        .post("/links")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ longUrl: "https://private.com", code });
      
      const linkId = createRes.body.id;

      const getRes = await request(app)
        .get(`/links/${linkId}/analytics`)
        .set("Authorization", `Bearer ${tokenB}`);
      
      expect(getRes.status).toBe(404);
    });

    it("should not allow Tenant B to delete Tenant A's link", async () => {
      const code = "tenant-a_del";
      const createRes = await request(app)
        .post("/links")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ longUrl: "https://delete-me.com", code });
      
      const linkId = createRes.body.id;

      const delRes = await request(app)
        .delete(`/links/${linkId}`)
        .set("Authorization", `Bearer ${tokenB}`);
      
      expect(delRes.status).toBe(404);

      const verifyRes = await request(app)
        .get("/links")
        .set("Authorization", `Bearer ${tokenA}`);
      
      const found = verifyRes.body.find((l: any) => l.id === linkId);
      expect(found).toBeDefined();
    });
  });

  describe("URL Validation", () => {
    it("should reject encoded bypass attempts", async () => {
      const bypassUrl = "http%3A%2F%2Fevil.example.com";
      const res = await request(app)
        .post("/links")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ longUrl: bypassUrl, code: "tenant-a_bad2" });
      
      expect(res.status).toBe(400);
    });

    it("should reject file:// scheme bypass", async () => {
      const bypassUrl = "file://localhost/etc/passwd";
      const res = await request(app)
        .post("/links")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ longUrl: bypassUrl, code: "tenant-a_bad3" });
      
      expect(res.status).toBe(400);
    });

    it("should reject gopher:// scheme bypass", async () => {
      const bypassUrl = "gopher://evil.com/1";
      const res = await request(app)
        .post("/links")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ longUrl: bypassUrl, code: "tenant-a_bad4" });
      
      expect(res.status).toBe(400);
    });

    it("should reject URLs longer than 2048 characters", async () => {
      const longUrl = "https://example.com/" + "a".repeat(2048);
      const res = await request(app)
        .post("/links")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ longUrl, code: "tenant-a_toolong" });
      
      expect(res.status).toBe(400);
    });
  });

  describe("Retention Enforcement", () => {
    it("should purge analytics older than retention period", async () => {
      const code = "tenant-a_ret";
      const createRes = await request(app)
        .post("/links")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ longUrl: "https://retention.com", code });
      
      const linkId = createRes.body.id;

      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      await db.linkClick.create({
        data: {
          linkId,
          requestId: uuidv4(),
          ipHash: "test-ip-hash",
          userAgent: "test-ua",
          timestamp: oldDate,
        }
      });

      await purgeOldAnalytics(30);

      const count = await db.linkClick.count({ where: { linkId } });
      expect(count).toBe(0);
    });
  });

  describe("Worker Idempotency", () => {
    it("should ignore duplicate click records (P2002)", async () => {
      const { processClickJob } = await import("../jobs/analytics" as any);
      
      const link = await db.link.create({
        data: {
          id: uuidv4(),
          tenantId: "tenant-a",
          code: "tenant-a_idemp",
          longUrl: "https://test.com",
          createdBy: "user-a"
        }
      });

      const payload = {
        data: {
          linkId: link.id,
          requestId: "unique-request-id",
          ip: "1.2.3.4",
          timestamp: new Date().toISOString()
        }
      };

      await processClickJob(payload);
      await processClickJob(payload);

      const count = await db.linkClick.count({
        where: { requestId: "unique-request-id" }
      });
      expect(count).toBe(1);
    });

    it("should aggregate concurrent clicks into one analytics bucket", async () => {
      const { processClickJob } = await import("../jobs/analytics" as any);

      const link = await db.link.create({
        data: {
          id: uuidv4(),
          tenantId: "tenant-a",
          code: "tenant-a_race",
          longUrl: "https://race-test.com",
          createdBy: "user-a"
        }
      });

      const timestamp = "2026-01-15T14:23:45.000Z";
      const jobs = Array.from({ length: 10 }, (_, index) =>
        processClickJob({
          data: {
            linkId: link.id,
            requestId: `race-request-${index}`,
            ip: "1.2.3.4",
            userAgent: "vitest",
            timestamp,
          }
        })
      );

      await Promise.all(jobs);

      const bucket = await db.analyticsBucket.findUnique({
        where: {
          linkId_timestampBucket: {
            linkId: link.id,
            timestampBucket: new Date("2026-01-15T14:00:00.000Z"),
          },
        },
      });

      const clickCount = await db.linkClick.count({
        where: { linkId: link.id },
      });

      expect(clickCount).toBe(10);
      expect(bucket?.count).toBe(10);
      expect(bucket?.lastAccessedAt.toISOString()).toBe(timestamp);
    });

    it("should keep the newest lastAccessedAt under out-of-order concurrency", async () => {
      const { processClickJob } = await import("../jobs/analytics" as any);

      const link = await db.link.create({
        data: {
          id: uuidv4(),
          tenantId: "tenant-a",
          code: "tenant-a_last-access",
          longUrl: "https://last-access-test.com",
          createdBy: "user-a"
        }
      });

      const earlyTimestamp = "2026-01-15T14:23:45.000Z";
      const lateTimestamp = "2026-01-15T14:23:45.900Z";

      await Promise.all([
        processClickJob({
          data: {
            linkId: link.id,
            requestId: "last-access-early",
            ip: "1.2.3.4",
            userAgent: "vitest",
            timestamp: earlyTimestamp,
          }
        }),
        processClickJob({
          data: {
            linkId: link.id,
            requestId: "last-access-late",
            ip: "1.2.3.4",
            userAgent: "vitest",
            timestamp: lateTimestamp,
          }
        }),
      ]);

      const bucket = await db.analyticsBucket.findUnique({
        where: {
          linkId_timestampBucket: {
            linkId: link.id,
            timestampBucket: new Date("2026-01-15T14:00:00.000Z"),
          },
        },
      });

      expect(bucket?.count).toBe(2);
      expect(bucket?.lastAccessedAt.toISOString()).toBe(lateTimestamp);
    });

    it("should prevent duplicate analytics events when link is deleted and recreated using isolated namespaces", async () => {
      const { processClickJob } = await import("../jobs/analytics");
      const { cacheService } = await import("../redis");

      // 1. Create link
      const link1 = await db.link.create({
        data: {
          id: uuidv4(),
          tenantId: "tenant-a",
          code: "tenant-a_recreate_test",
          longUrl: "https://url1.com",
          createdBy: "user-a"
        }
      });

      // 2. Fetch redirect to cache it
      await request(app).get(`/r/tenant-a_recreate_test`);

      // 3. Process click job
      const jobId = "recreate-test-job-id";
      await processClickJob({
        id: jobId,
        data: {
          linkId: link1.id,
          requestId: jobId,
          ip: "1.2.3.4",
          timestamp: new Date().toISOString()
        }
      });

      // Verify click was processed
      const clickCount1 = await db.linkClick.count({ where: { linkId: link1.id } });
      expect(clickCount1).toBe(1);

      // Verify dedup key is set and redirect cache is set
      const isJobProcessed = await cacheService.isJobProcessed(jobId);
      expect(isJobProcessed).toBe(true);

      const redirectTarget = await cacheService.getRedirectTarget("tenant-a_recreate_test");
      expect(redirectTarget).not.toBeNull();

      // 4. Delete the link
      await request(app)
        .delete(`/links/${link1.id}`)
        .set("Authorization", `Bearer ${tokenA}`);

      // Verify redirect cache is invalidated, but dedup is NOT invalidated
      const redirectTargetAfterDelete = await cacheService.getRedirectTarget("tenant-a_recreate_test");
      expect(redirectTargetAfterDelete).toBeNull();

      const isJobProcessedAfterDelete = await cacheService.isJobProcessed(jobId);
      expect(isJobProcessedAfterDelete).toBe(true); // Should remain true!

      // 5. Recreate link with same short code
      const link2 = await db.link.create({
        data: {
          id: uuidv4(),
          tenantId: "tenant-a",
          code: "tenant-a_recreate_test",
          longUrl: "https://url2.com",
          createdBy: "user-a"
        }
      });

      // Try processing the same job again
      await processClickJob({
        id: jobId,
        data: {
          linkId: link2.id,
          requestId: jobId,
          ip: "1.2.3.4",
          timestamp: new Date().toISOString()
        }
      });

      // Click should be ignored since dedup flag was preserved
      const clickCount2 = await db.linkClick.count({ where: { linkId: link2.id } });
      expect(clickCount2).toBe(0);
    });
  });

  describe("Observability & Instrumentation", () => {
    it("should generate X-Request-ID if not provided and pass it back in the header", async () => {
      const res = await request(app).get("/live");
      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(typeof res.headers["x-request-id"]).toBe("string");
    });

    it("should preserve incoming X-Request-ID and propagate it", async () => {
      const customReqId = "custom-uuid-123456";
      const res = await request(app)
        .get("/live")
        .set("X-Request-ID", customReqId);
      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBe(customReqId);
    });

    it("should expose /metrics with Prometheus formatted text", async () => {
      const res = await request(app).get("/metrics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.text).toContain("http_requests_total");
      expect(res.text).toContain("http_request_duration_seconds");
      expect(res.text).toContain("active_requests");
    });

    it("should track request duration and count metrics", async () => {
      // Hit /live multiple times
      for (let i = 0; i < 5; i++) {
        await request(app).get("/live");
      }

      const res = await request(app).get("/metrics");
      expect(res.status).toBe(200);
      
      // Look for the count of GET /live requests
      const match = res.text.match(/http_requests_total\{method="GET",path="\/live",status="200"\}\s+(\d+)/);
      expect(match).not.toBeNull();
      const count = parseInt(match![1], 10);
      expect(count).toBeGreaterThanOrEqual(5);
    });

    it("should handle error gracefully and increment 500 metric", async () => {
      const res = await request(app).get("/error-test");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal_error");
      expect(res.body.details).toBe("Triggered test 500 error");
      expect(res.body.stack).toBeDefined();

      const metricsRes = await request(app).get("/metrics");
      const match = metricsRes.text.match(/http_requests_total\{method="GET",path="\/error-test",status="500"\}\s+(\d+)/);
      expect(match).not.toBeNull();
      const count = parseInt(match![1], 10);
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });
});