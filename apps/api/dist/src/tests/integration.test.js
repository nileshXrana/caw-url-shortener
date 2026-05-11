"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const main_1 = require("../main");
const db_1 = require("../db");
const config_1 = require("../config");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const purge_1 = require("../purge");
const uuid_1 = require("uuid");
const TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/bootcamp_test?schema=public";
const db = (0, db_1.getDb)(TEST_DB_URL);
const tenantA = { id: "tenant-a", email: "a@example.com" };
const tenantB = { id: "tenant-b", email: "b@example.com" };
const tokenA = jsonwebtoken_1.default.sign({ id: "user-a", tenantId: tenantA.id, email: tenantA.email }, config_1.config.jwtSecret);
const tokenB = jsonwebtoken_1.default.sign({ id: "user-b", tenantId: tenantB.id, email: tenantB.email }, config_1.config.jwtSecret);
(0, vitest_1.describe)("Integration Tests", () => {
    (0, vitest_1.beforeAll)(async () => {
        await db.linkClick.deleteMany();
        await db.link.deleteMany();
    });
    (0, vitest_1.afterAll)(async () => {
        await db.$disconnect();
    });
    (0, vitest_1.describe)("Link Creation & Retrieval", () => {
        (0, vitest_1.it)("should create a link for authenticated user", async () => {
            const res = await (0, supertest_1.default)(main_1.app)
                .post("/links")
                .set("Authorization", `Bearer ${tokenA}`)
                .send({
                longUrl: "https://google.com",
                code: "tenant-a_google"
            });
            (0, vitest_1.expect)(res.status).toBe(201);
            (0, vitest_1.expect)(res.body.longUrl).toBe("https://google.com");
            (0, vitest_1.expect)(res.body.code).toBe("tenant-a_google");
            (0, vitest_1.expect)(res.body.tenantId).toBe(tenantA.id);
        });
        (0, vitest_1.it)("should return 401 for unauthenticated requests", async () => {
            const res = await (0, supertest_1.default)(main_1.app)
                .post("/links")
                .send({ longUrl: "https://google.com" });
            (0, vitest_1.expect)(res.status).toBe(401);
        });
    });
    (0, vitest_1.describe)("Redirect", () => {
        (0, vitest_1.it)("should redirect to long URL and record analytics", async () => {
            const code = "tenant-a_ex";
            const createRes = await (0, supertest_1.default)(main_1.app)
                .post("/links")
                .set("Authorization", `Bearer ${tokenA}`)
                .send({ longUrl: "https://example.com", code });
            (0, vitest_1.expect)(createRes.status).toBe(201);
            const res = await (0, supertest_1.default)(main_1.app).get(`/r/${code}`);
            (0, vitest_1.expect)(res.status).toBe(302);
            (0, vitest_1.expect)(res.header.location).toBe("https://example.com");
        });
    });
    (0, vitest_1.describe)("Security: IDOR", () => {
        (0, vitest_1.it)("should not allow Tenant B to access Tenant A's link", async () => {
            const code = "tenant-a_private";
            const createRes = await (0, supertest_1.default)(main_1.app)
                .post("/links")
                .set("Authorization", `Bearer ${tokenA}`)
                .send({ longUrl: "https://private.com", code });
            const linkId = createRes.body.id;
            const getRes = await (0, supertest_1.default)(main_1.app)
                .get(`/links/${linkId}/analytics`)
                .set("Authorization", `Bearer ${tokenB}`);
            (0, vitest_1.expect)(getRes.status).toBe(404);
        });
        (0, vitest_1.it)("should not allow Tenant B to delete Tenant A's link", async () => {
            const code = "tenant-a_del";
            const createRes = await (0, supertest_1.default)(main_1.app)
                .post("/links")
                .set("Authorization", `Bearer ${tokenA}`)
                .send({ longUrl: "https://delete-me.com", code });
            const linkId = createRes.body.id;
            const delRes = await (0, supertest_1.default)(main_1.app)
                .delete(`/links/${linkId}`)
                .set("Authorization", `Bearer ${tokenB}`);
            (0, vitest_1.expect)(delRes.status).toBe(404);
            const verifyRes = await (0, supertest_1.default)(main_1.app)
                .get("/links")
                .set("Authorization", `Bearer ${tokenA}`);
            const found = verifyRes.body.find((l) => l.id === linkId);
            (0, vitest_1.expect)(found).toBeDefined();
        });
    });
    (0, vitest_1.describe)("URL Validation", () => {
        (0, vitest_1.it)("should reject encoded bypass attempts", async () => {
            const bypassUrl = "http%3A%2F%2Fevil.example.com";
            const res = await (0, supertest_1.default)(main_1.app)
                .post("/links")
                .set("Authorization", `Bearer ${tokenA}`)
                .send({ longUrl: bypassUrl, code: "tenant-a_bad2" });
            (0, vitest_1.expect)(res.status).toBe(400);
        });
        (0, vitest_1.it)("should reject file:// scheme bypass", async () => {
            const bypassUrl = "file://localhost/etc/passwd";
            const res = await (0, supertest_1.default)(main_1.app)
                .post("/links")
                .set("Authorization", `Bearer ${tokenA}`)
                .send({ longUrl: bypassUrl, code: "tenant-a_bad3" });
            (0, vitest_1.expect)(res.status).toBe(400);
        });
        (0, vitest_1.it)("should reject gopher:// scheme bypass", async () => {
            const bypassUrl = "gopher://evil.com/1";
            const res = await (0, supertest_1.default)(main_1.app)
                .post("/links")
                .set("Authorization", `Bearer ${tokenA}`)
                .send({ longUrl: bypassUrl, code: "tenant-a_bad4" });
            (0, vitest_1.expect)(res.status).toBe(400);
        });
    });
    (0, vitest_1.describe)("Retention Enforcement", () => {
        (0, vitest_1.it)("should purge analytics older than retention period", async () => {
            const code = "tenant-a_ret";
            const createRes = await (0, supertest_1.default)(main_1.app)
                .post("/links")
                .set("Authorization", `Bearer ${tokenA}`)
                .send({ longUrl: "https://retention.com", code });
            const linkId = createRes.body.id;
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 40);
            await db.linkClick.create({
                data: {
                    linkId,
                    requestId: (0, uuid_1.v4)(),
                    ipHash: "test-ip-hash",
                    userAgent: "test-ua",
                    timestamp: oldDate,
                }
            });
            await (0, purge_1.purgeOldAnalytics)(30);
            const count = await db.linkClick.count({ where: { linkId } });
            (0, vitest_1.expect)(count).toBe(0);
        });
    });
    (0, vitest_1.describe)("Worker Idempotency", () => {
        (0, vitest_1.it)("should ignore duplicate click records (P2002)", async () => {
            const { processClickJob } = await import("../jobs/analytics");
            const link = await db.link.create({
                data: {
                    id: (0, uuid_1.v4)(),
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
            (0, vitest_1.expect)(count).toBe(1);
        });
    });
});
//# sourceMappingURL=integration.test.js.map