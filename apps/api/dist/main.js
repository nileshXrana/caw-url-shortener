"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const config_1 = require("./config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const uuid_1 = require("uuid");
const logger_1 = require("./logger");
const redis_1 = require("./redis");
const analytics_1 = require("./jobs/analytics");
const db_1 = require("./db");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const url_1 = require("./url");
const ioredis_1 = require("ioredis");
const resilience_1 = require("./resilience");
const metrics_1 = require("./metrics");
function isDatabaseConnectionError(err) {
    if (!err)
        return false;
    const msg = String(err.message || "");
    const code = String(err.code || "");
    const name = String(err.name || "");
    return (name.includes("PrismaClientInitializationError") ||
        (name.includes("PrismaClientKnownRequestError") && (code === "P1001" ||
            code === "P1008" ||
            msg.includes("Can't reach database server"))) ||
        msg.includes("ENOTFOUND") ||
        msg.includes("getaddrinfo") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("Circuit breaker open"));
}
function handleRouteError(res, err, logMessage, logMetadata = {}) {
    if (isDatabaseConnectionError(err)) {
        logger_1.logger.error(`${logMessage}_database_connection_failed`, err, { ...logMetadata, isDnsOrConnError: true });
        return res.status(503).json({
            error: "service_unavailable",
            message: "Database connection failed. Please try again later.",
        });
    }
    logger_1.logger.error(logMessage, err, logMetadata);
    res.status(500).json({ error: "internal_error" });
}
const app = (0, express_1.default)();
exports.app = app;
app.use((0, cors_1.default)({
    origin: config_1.config.corsOrigin,
}));
app.use(express_1.default.json());
app.use((req, res, next) => {
    const reqId = req.headers["x-request-id"] || (0, uuid_1.v4)();
    req.id = reqId;
    res.setHeader("X-Request-ID", reqId);
    metrics_1.activeRequests.inc();
    const startMs = Date.now();
    const startHr = process.hrtime();
    logger_1.asyncLocalStorage.run({ requestId: reqId }, () => {
        res.on("finish", () => {
            metrics_1.activeRequests.dec();
            const durationMs = Date.now() - startMs;
            const diff = process.hrtime(startHr);
            const durationSeconds = diff[0] + diff[1] / 1e9;
            if (req.path !== "/metrics") {
                logger_1.logger.info("request_completed", {
                    requestId: reqId,
                    method: req.method,
                    url: req.url,
                    statusCode: res.statusCode,
                    latencyMs: durationMs,
                });
            }
            let path = req.path;
            if (req.route && req.route.path) {
                path = req.route.path;
            }
            else if (path.startsWith("/r/")) {
                path = "/r/:code";
            }
            metrics_1.httpRequestsTotal.inc({
                method: req.method,
                path: path,
                status: res.statusCode.toString(),
            });
            metrics_1.httpRequestDurationSeconds.observe({
                method: req.method,
                path: path,
                status: res.statusCode.toString(),
            }, durationSeconds);
        });
        next();
    });
});
app.get("/health", (req, res) => res.status(200).send("OK"));
app.get("/live", (req, res) => res.status(200).send("OK"));
app.get("/error-test", (req, res) => {
    throw new Error("Triggered test 500 error");
});
app.get("/ready", async (req, res) => {
    try {
        const db = (0, db_1.getDb)(config_1.config.databaseUrl);
        await db.$queryRaw `SELECT 1`;
        const redis = new ioredis_1.Redis(config_1.config.redisUrl, { maxRetriesPerRequest: 0 });
        await redis.ping();
        await redis.quit();
        res.status(200).send("READY");
    }
    catch (err) {
        logger_1.logger.error("Readiness check failed", err);
        res.status(503).send("NOT_READY");
    }
});
app.get("/metrics", async (req, res) => {
    try {
        res.set("Content-Type", metrics_1.register.contentType);
        res.end(await metrics_1.register.metrics());
    }
    catch (err) {
        res.status(500).end(err);
    }
});
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== "string" ||
        !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "missing_token" });
    }
    const token = authHeader.split(" ")[1];
    if (!token || !token.trim()) {
        return res.status(401).json({ error: "missing_token" });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.config.jwtSecret, {
            algorithms: ["HS256"],
        });
        req.user = decoded;
        next();
    }
    catch (err) {
        res.status(401).json({ error: "invalid_token" });
    }
};
const limiters = {
    createLink: (req, res, next) => next(),
    redirect: (req, res, next) => next(),
};
const inFlight = new Map();
app.get("/r/:code", limiters.redirect, async (req, res) => {
    const code = String(req.params.code ?? "");
    try {
        let cachedLink = await redis_1.cacheService.getRedirectTarget(code);
        let targetLink = cachedLink;
        if (!targetLink) {
            if (inFlight.has(code)) {
                logger_1.logger.info("Thundering herd avoided, waiting for in-flight request", { code });
                targetLink = await inFlight.get(code);
            }
            else {
                const fetchPromise = (async () => {
                    try {
                        logger_1.logger.info("Cache miss, querying DB...", { code });
                        const tenantId = code.split("_", 1)[0] ?? "";
                        if (!tenantId)
                            return null;
                        const db = (0, db_1.getDb)(config_1.config.databaseUrl);
                        const link = await (0, resilience_1.executeResilientDb)(() => db.link.findUnique({
                            where: { tenantId_code: { tenantId, code } },
                            select: { id: true, longUrl: true, expiresAt: true },
                        }));
                        if (!link)
                            return null;
                        if (link.expiresAt && link.expiresAt.getTime() <= Date.now())
                            return null;
                        const result = { id: link.id, longUrl: link.longUrl };
                        await redis_1.cacheService.setRedirectTarget(code, result);
                        return result;
                    }
                    finally {
                        inFlight.delete(code);
                    }
                })();
                inFlight.set(code, fetchPromise);
                targetLink = await fetchPromise;
            }
        }
        if (!targetLink) {
            return res.status(404).send("Not Found");
        }
        const ip = req.ip || req.socket.remoteAddress || "0.0.0.0";
        try {
            await analytics_1.analyticsQueue.add("record-click", {
                linkId: targetLink.id,
                requestId: req.id,
                ip,
                userAgent: req.headers["user-agent"],
                referer: req.headers["referer"],
                timestamp: new Date().toISOString(),
            }, {
                jobId: req.id,
                attempts: 3,
                backoff: { type: "exponential", delay: 1000 },
            });
        }
        catch (err) {
            logger_1.logger.error("analytics_enqueue_failed", err, { requestId: req.id });
        }
        res.redirect(302, targetLink.longUrl);
    }
    catch (err) {
        handleRouteError(res, err, "redirect_failed", { requestId: req.id, code });
    }
});
app.post("/links", authenticate, async (req, res) => {
    const { code, longUrl, expiresAt, tags } = req.body;
    const tenantId = req.user.tenantId;
    const createdBy = req.user.id;
    const teamIdHeader = req.headers["x-team-id"];
    if (!longUrl || !(0, url_1.isValidRedirectUrl)(longUrl)) {
        return res.status(400).json({ error: "invalid_url" });
    }
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const link = await (0, resilience_1.executeResilientDb)(() => db.link.create({
            data: {
                tenantId,
                teamId: teamIdHeader || null,
                code,
                longUrl,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                createdAt: new Date(),
                tags: tags || [],
                createdBy,
            },
        }));
        res.status(201).json(link);
    }
    catch (err) {
        if (isDatabaseConnectionError(err)) {
            logger_1.logger.error("link_creation_failed_database_connection", err, { tenantId, code });
            return res.status(503).json({
                error: "service_unavailable",
                message: "Database connection failed. Please try again later.",
            });
        }
        logger_1.logger.error("link_creation_failed", err, { tenantId, code });
        res.status(400).json({ error: "failed_to_create_link" });
    }
});
app.get("/links/search", authenticate, async (req, res) => {
    const tenantId = req.user.tenantId;
    const teamIdHeader = req.headers["x-team-id"];
    const q = String(req.query.q || "");
    const tag = req.query.tag;
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.page_size || "10"))));
    const skip = (page - 1) * pageSize;
    const take = pageSize;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const where = { tenantId };
        if (teamIdHeader) {
            where.teamId = teamIdHeader;
        }
        if (q) {
            const safeQ = q.replace(/[&|!():*']/g, " ").trim();
            if (safeQ) {
                where.OR = [
                    { code: { search: safeQ.split(/\s+/).join(" & ") } },
                    { longUrl: { search: safeQ.split(/\s+/).join(" & ") } },
                ];
            }
        }
        if (tag) {
            const tagsToFilter = Array.isArray(tag) ? tag : [String(tag)];
            where.tags = { hasSome: tagsToFilter };
        }
        const [links, total] = await Promise.all([
            (0, resilience_1.executeResilientDb)(() => db.link.findMany({
                where,
                skip,
                take,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            })),
            (0, resilience_1.executeResilientDb)(() => db.link.count({ where })),
        ]);
        res.json({
            data: links,
            pagination: {
                page,
                page_size: pageSize,
                total,
                total_pages: Math.ceil(total / pageSize),
            },
        });
    }
    catch (err) {
        handleRouteError(res, err, "search_failed", { tenantId, q });
    }
});
app.get("/links", authenticate, async (req, res) => {
    const tenantId = req.user.tenantId;
    const teamIdHeader = req.headers["x-team-id"];
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const where = { tenantId };
        if (teamIdHeader)
            where.teamId = teamIdHeader;
        const links = await (0, resilience_1.executeResilientDb)(() => db.link.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }));
        res.json(links);
    }
    catch (err) {
        handleRouteError(res, err, "failed_to_fetch_links", { tenantId });
    }
});
app.get("/teams/:id/members", authenticate, async (req, res) => {
    const teamId = req.params.id;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const members = await (0, resilience_1.executeResilientDb)(() => db.teamMember.findMany({
            where: { teamId },
            select: { userId: true, role: true, joinedAt: true },
        }));
        res.json(members);
    }
    catch (err) {
        logger_1.logger.error("failed_to_list_members", err, { teamId });
        res.status(500).json({ error: "failed_to_list_members" });
    }
});
app.delete("/teams/:id/members/:userId", authenticate, async (req, res) => {
    const teamId = req.params.id;
    const targetUserId = req.params.userId;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const requesterMembership = await (0, resilience_1.executeResilientDb)(() => db.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: req.user.id } },
        }));
        if (!requesterMembership || requesterMembership.role !== "ADMIN") {
            return res.status(403).json({ error: "forbidden" });
        }
        await (0, resilience_1.executeResilientDb)(() => db.teamMember.delete({
            where: { teamId_userId: { teamId, userId: targetUserId } },
        }));
        res.status(204).send();
    }
    catch (err) {
        logger_1.logger.error("failed_to_remove_member", err, { teamId, targetUserId });
        res.status(500).json({ error: "failed_to_remove_member" });
    }
});
app.post("/teams/:id/invitations", authenticate, async (req, res) => {
    const teamId = req.params.id;
    const { email, role, expiresInDays } = req.body;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const requesterMembership = await (0, resilience_1.executeResilientDb)(() => db.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: req.user.id } },
        }));
        if (!requesterMembership || requesterMembership.role !== "ADMIN") {
            return res.status(403).json({ error: "forbidden" });
        }
        const token = (0, uuid_1.v4)();
        const expiresAt = expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const inv = await (0, resilience_1.executeResilientDb)(() => db.invitation.create({
            data: {
                token,
                email,
                teamId,
                role: role || "MEMBER",
                expiresAt,
            },
        }));
        res.status(201).json({ token: inv.token, expiresAt: inv.expiresAt });
    }
    catch (err) {
        logger_1.logger.error("failed_to_create_invitation", err, { teamId, email });
        res.status(500).json({ error: "failed_to_create_invitation" });
    }
});
app.post("/invitations/accept", authenticate, async (req, res) => {
    const { token } = req.body;
    const userId = req.user.id;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const inv = await (0, resilience_1.executeResilientDb)(() => db.invitation.findUnique({ where: { token } }));
        if (!inv)
            return res.status(404).json({ error: "invalid_token" });
        if (inv.expiresAt && inv.expiresAt.getTime() <= Date.now()) {
            return res.status(400).json({ error: "token_expired" });
        }
        const existing = await (0, resilience_1.executeResilientDb)(() => db.teamMember.findUnique({ where: { teamId_userId: { teamId: inv.teamId, userId } } }));
        if (existing) {
            await (0, resilience_1.executeResilientDb)(() => db.invitation.delete({ where: { id: inv.id } }));
            return res.status(200).json(existing);
        }
        const membership = await (0, resilience_1.executeResilientDb)(() => db.teamMember.create({
            data: { teamId: inv.teamId, userId, role: inv.role },
        }));
        await (0, resilience_1.executeResilientDb)(() => db.invitation.delete({ where: { id: inv.id } }));
        res.status(201).json(membership);
    }
    catch (err) {
        logger_1.logger.error("failed_to_accept_invitation", err, { token });
        res.status(500).json({ error: "failed_to_accept_invitation" });
    }
});
app.get("/teams/:id/activity", authenticate, async (req, res) => {
    const teamId = req.params.id;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const membership = await (0, resilience_1.executeResilientDb)(() => db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: req.user.id } } }));
        if (!membership)
            return res.status(403).json({ error: "forbidden" });
        const links = await (0, resilience_1.executeResilientDb)(() => db.link.findMany({
            where: { teamId },
            orderBy: { createdAt: "desc" },
            take: 50,
            include: {
                _count: { select: { clicks: true } },
                clicks: {
                    orderBy: { timestamp: "desc" },
                    take: 1,
                    select: { timestamp: true },
                },
            },
        }));
        const summaries = links.map((l) => ({
            type: "link_summary",
            linkId: l.id,
            code: l.code,
            longUrl: l.longUrl,
            createdAt: l.createdAt,
            totalClicks: l._count.clicks,
            lastClick: l.clicks[0]?.timestamp || null,
        }));
        res.json({ links: summaries });
    }
    catch (err) {
        logger_1.logger.error("failed_to_fetch_activity", err, { teamId });
        res.status(500).json({ error: "failed_to_fetch_activity" });
    }
});
app.patch("/links/:id", authenticate, async (req, res) => {
    const tenantId = req.user.tenantId;
    const linkId = req.params.id;
    const { longUrl, expiresAt, tags } = req.body;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const link = await (0, resilience_1.executeResilientDb)(() => db.link.findUnique({ where: { id: linkId } }));
        if (!link || link.tenantId !== tenantId) {
            return res.status(404).json({ error: "not_found" });
        }
        const updated = await (0, resilience_1.executeResilientDb)(() => db.link.update({
            where: { id: linkId },
            data: { longUrl, expiresAt: expiresAt ? new Date(expiresAt) : null, tags },
        }));
        await redis_1.cacheService.invalidateRedirectTarget(updated.code);
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: "update_failed" });
    }
});
app.delete("/links/:id", authenticate, async (req, res) => {
    const tenantId = req.user.tenantId;
    const linkId = req.params.id;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const link = await (0, resilience_1.executeResilientDb)(() => db.link.findUnique({ where: { id: linkId } }));
        if (!link || link.tenantId !== tenantId) {
            return res.status(404).json({ error: "not_found" });
        }
        await (0, resilience_1.executeResilientDb)(() => db.link.delete({ where: { id: linkId } }));
        await redis_1.cacheService.invalidateRedirectTarget(link.code);
        res.status(204).send();
    }
    catch (err) {
        res.status(500).json({ error: "failed_to_delete" });
    }
});
app.get("/links/:id/analytics", authenticate, async (req, res) => {
    const tenantId = req.user.tenantId;
    const linkId = req.params.id;
    const { from, to } = req.query;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const link = await (0, resilience_1.executeResilientDb)(() => db.link.findUnique({
            where: { id: linkId, tenantId },
        }));
        if (!link) {
            return res.status(404).json({ error: "not_found" });
        }
        const clicksCount = await (0, resilience_1.executeResilientDb)(() => db.linkClick.count({
            where: {
                linkId,
                timestamp: {
                    gte: from ? new Date(String(from)) : new Date(0),
                    lte: to ? new Date(String(to)) : new Date(),
                },
            },
        }));
        const lastClick = await (0, resilience_1.executeResilientDb)(() => db.linkClick.findFirst({
            where: { linkId },
            orderBy: { timestamp: "desc" },
            select: { timestamp: true },
        }));
        res.json({
            link_id: linkId,
            total_clicks: clicksCount,
            last_click: lastClick?.timestamp || null,
        });
    }
    catch (err) {
        handleRouteError(res, err, "failed_to_fetch_analytics", { linkId });
    }
});
app.post("/teams", limiters.createLink, authenticate, async (req, res) => {
    const { name, slug } = req.body;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    try {
        const team = await (0, resilience_1.executeResilientDb)(() => db.team.create({
            data: {
                name,
                slug,
                members: {
                    create: {
                        userId: req.user.id,
                        role: "ADMIN",
                    },
                },
            },
        }));
        res.status(201).json(team);
    }
    catch (err) {
        logger_1.logger.error("team_creation_failed", err, { slug });
        res.status(400).json({ error: "failed_to_create_team" });
    }
});
if (require.main === module) {
    const processType = process.env.PROCESS_TYPE || "api";
    if (processType === "api" || processType === "all") {
        const server = app.listen(config_1.config.port, "0.0.0.0", () => {
            logger_1.logger.info(`API Server running on http://0.0.0.0:${config_1.config.port}`);
        });
        const shutdown = async (signal) => {
            logger_1.logger.info(`Received ${signal}. Shutting down gracefully...`);
            server.close(async () => {
                logger_1.logger.info("HTTP server closed.");
                try {
                    await (0, db_1.disconnectAll)();
                    logger_1.logger.info("Database connections closed.");
                    process.exit(0);
                }
                catch (err) {
                    logger_1.logger.error("Error during shutdown", err);
                    process.exit(1);
                }
            });
            setTimeout(() => {
                logger_1.logger.error("Could not close connections in time, forcefully shutting down");
                process.exit(1);
            }, 10000);
        };
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    }
    if (processType === "worker" || processType === "all") {
        (0, analytics_1.startAnalyticsWorker)();
        logger_1.logger.info("Analytics Worker started");
        process.on("SIGTERM", () => {
            logger_1.logger.info("Worker received SIGTERM. Shutting down...");
            setTimeout(() => process.exit(0), 5000);
        });
    }
}
app.use((err, _req, res, _next) => {
    logger_1.logger.error("unhandled_error", err);
    const isDev = config_1.config.env === "development";
    const isTest = config_1.config.env === "test";
    const isStaging = config_1.config.env === "staging";
    res.status(500).json({
        error: "internal_error",
        ...((isDev || isTest || isStaging) ? { details: err.message, stack: err.stack } : {}),
    });
});
//# sourceMappingURL=main.js.map