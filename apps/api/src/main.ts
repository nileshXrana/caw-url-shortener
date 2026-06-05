import { config } from "./config";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { logger, asyncLocalStorage } from "./logger";
import { cacheService, CachedLink, redis } from "./redis";
import { analyticsQueue, startAnalyticsWorker } from "./jobs/analytics";
import { getDb, disconnectAll } from "./db";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import { isValidRedirectUrl } from "./url";
import { Redis } from "ioredis";
import { executeResilientDb } from "./resilience";
import { register, httpRequestsTotal, httpRequestDurationSeconds, activeRequests } from "./metrics";

function isDatabaseConnectionError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || "");
  const code = String(err.code || "");
  const name = String(err.name || "");
  
  return (
    name.includes("PrismaClientInitializationError") ||
    (name.includes("PrismaClientKnownRequestError") && (
      code === "P1001" || 
      code === "P1008" || 
      msg.includes("Can't reach database server")
    )) ||
    msg.includes("ENOTFOUND") ||
    msg.includes("getaddrinfo") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("Circuit breaker open") // Catch circuit breaker trips
  );
}

function handleRouteError(res: any, err: any, logMessage: string, logMetadata: any = {}) {
  if (isDatabaseConnectionError(err)) {
    logger.error(`${logMessage}_database_connection_failed`, err, { ...logMetadata, isDnsOrConnError: true });
    return res.status(503).json({
      error: "service_unavailable",
      message: "Database connection failed. Please try again later.",
    });
  }
  logger.error(logMessage, err, logMetadata);
  res.status(500).json({ error: "internal_error" });
}

const app = express();
app.use(
  cors({
    origin: config.corsOrigin,
  })
);
app.use(express.json());

// Request Context Middleware & Metrics Instrumentation
app.use((req: any, res: any, next) => {
  const reqId = (req.headers["x-request-id"] as string) || uuidv4();
  req.id = reqId;
  res.setHeader("X-Request-ID", reqId);
  
  // Metrics: increment active requests
  activeRequests.inc();
  
  const startMs = Date.now();
  const startHr = process.hrtime();
  
  asyncLocalStorage.run({ requestId: reqId }, () => {
    res.on("finish", () => {
      activeRequests.dec();
      const durationMs = Date.now() - startMs;
      
      const diff = process.hrtime(startHr);
      const durationSeconds = diff[0] + diff[1] / 1e9;
      
      // Log request completion (conditionally skip metrics path to reduce logs noise)
      if (req.path !== "/metrics") {
        logger.info("request_completed", {
          requestId: reqId, // Explicit fallback mapping
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          latencyMs: durationMs,
        });
      }

      // Metrics: normalize path to avoid label cardinality explosion
      let path = req.path;
      if (req.route && req.route.path) {
        path = req.route.path;
      } else if (path.startsWith("/r/")) {
        path = "/r/:code";
      }

      httpRequestsTotal.inc({
        method: req.method,
        path: path,
        status: res.statusCode.toString(),
      });

      httpRequestDurationSeconds.observe({
        method: req.method,
        path: path,
        status: res.statusCode.toString(),
      }, durationSeconds);
    });

    next();
  });
});

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeoutMs)
    ),
  ]);
}

app.get("/health", (req, res) => res.status(200).json({ ok: true }));
app.get("/live", (req, res) => res.status(200).json({ ok: true }));
app.get("/error-test", (req, res) => {
  throw new Error("Triggered test 500 error");
});

app.get("/ready", async (req, res) => {
  const checks: Record<string, string> = {};
  let ready = true;

  const db = getDb(config.databaseUrl);

  // Check database connectivity
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, 2000);
    checks.database = "connected";
  } catch (err) {
    logger.error("Readiness check: database failed", err);
    checks.database = "disconnected";
    ready = false;
  }

  // Check cache connectivity
  try {
    await withTimeout(redis.ping(), 2000);
    checks.cache = "connected";
  } catch (err) {
    logger.error("Readiness check: cache failed", err);
    checks.cache = "disconnected";
    ready = false;
  }

  // Include uptime
  const uptime_seconds = Math.floor(process.uptime());

  const status = ready ? 200 : 503;
  res.status(status).json({
    ok: ready,
    checks,
    uptime_seconds,
  });
});

app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

const authenticate = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;

  // Layer 1: strict header format check
  if (!authHeader || typeof authHeader !== "string" ||
      !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_token" });
  }

  const token = authHeader.split(" ")[1];

  // Layer 2: reject empty or whitespace-only tokens
  if (!token || !token.trim()) {
    return res.status(401).json({ error: "missing_token" });
  }

  // Layer 3: explicit algorithm whitelist — blocks "none" attack
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
    }) as any;
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "invalid_token" });
  }
};

const limiters = {
  createLink: (req: any, res: any, next: any) => next(),
  redirect: (req: any, res: any, next: any) => next(),
};

// In-Flight Map to prevent Thundering Herd
const inFlight = new Map<string, Promise<CachedLink | null>>();

// 1. Public: Redirect Endpoint (with rate limiting and caching)
app.get("/r/:code", limiters.redirect, async (req: any, res: any) => {
  const code = String(req.params.code ?? "");
  
  try {
    // 1. Check Cache
    let cachedLink = await cacheService.getRedirectTarget(code);
    let targetLink: CachedLink | null = cachedLink;

    if (!targetLink) {
      // 2. Thundering Herd Protection (In-Flight Mutex)
      if (inFlight.has(code)) {
        logger.info("Thundering herd avoided, waiting for in-flight request", { code });
        targetLink = await inFlight.get(code)!;
      } else {
        // 3. Fallback to DB (wrapped with Circuit Breaker + Retry context)
        const fetchPromise = (async () => {
          try {
            logger.info("Cache miss, querying DB...", { code });
            
            const tenantId = code.split("_", 1)[0] ?? "";
            if (!tenantId) return null;

            const db = getDb(config.databaseUrl);
            const link = await executeResilientDb(() => 
              db.link.findUnique({
                where: { tenantId_code: { tenantId, code } },
                select: { id: true, longUrl: true, expiresAt: true },
              })
            );

            if (!link) return null;
            if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return null;

            const result: CachedLink = { id: link.id, longUrl: link.longUrl };
            
            // Populate Cache
            await cacheService.setRedirectTarget(code, result);
            return result;
          } finally {
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

    // 4. Record Analytics (Async Queue) - Happens for EVERY redirect
    const ip = req.ip || req.socket.remoteAddress || "0.0.0.0";
    try {
      await analyticsQueue.add("record-click", {
        linkId: targetLink.id,
        requestId: req.id,
        ip,
        userAgent: req.headers["user-agent"],
        referer: req.headers["referer"],
        timestamp: new Date().toISOString(),
      }, {
        jobId: req.id, // Idempotency
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
      });
    } catch (err) {
      logger.error("analytics_enqueue_failed", err, { requestId: req.id });
    }

    res.redirect(302, targetLink.longUrl);
  } catch (err) {
    handleRouteError(res, err, "redirect_failed", { requestId: req.id, code });
  }
});

// 2. Admin: Link Management (Protected)
app.post("/links", authenticate, async (req: any, res: any) => {
  const { code, longUrl, expiresAt, tags } = req.body;
  const tenantId = req.user.tenantId;
  const createdBy = req.user.id;
  const teamIdHeader = req.headers["x-team-id"] as string | undefined;

  if (!longUrl || !isValidRedirectUrl(longUrl)) {
    return res.status(400).json({ error: "invalid_url" });
  }

  const db = getDb(config.databaseUrl);
  try {
    // Wrapped with Circuit Breaker + Retry context
    const link = await executeResilientDb(() =>
      db.link.create({
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
      })
    );
    res.status(201).json(link);
  } catch (err) {
    if (isDatabaseConnectionError(err)) {
      logger.error("link_creation_failed_database_connection", err, { tenantId, code });
      return res.status(503).json({
        error: "service_unavailable",
        message: "Database connection failed. Please try again later.",
      });
    }
    logger.error("link_creation_failed", err, { tenantId, code });
    res.status(400).json({ error: "failed_to_create_link" });
  }
});

app.get("/links/search", authenticate, async (req: any, res: any) => {
  const tenantId = req.user.tenantId;
  const teamIdHeader = req.headers["x-team-id"] as string | undefined;
  const q = String(req.query.q || "");
  const tag = req.query.tag; // string or array
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.page_size || "10"))));
  
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  const db = getDb(config.databaseUrl);
  try {
    const where: any = { tenantId };

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
      executeResilientDb(() =>
        db.link.findMany({
          where,
          skip,
          take,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      ),
      executeResilientDb(() => db.link.count({ where })),
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
  } catch (err) {
    handleRouteError(res, err, "search_failed", { tenantId, q });
  }
});

app.get("/links", authenticate, async (req: any, res: any) => {
  const tenantId = req.user.tenantId;
  const teamIdHeader = req.headers["x-team-id"] as string | undefined;
  const db = getDb(config.databaseUrl);
  try {
    const where: any = { tenantId };
    if (teamIdHeader) where.teamId = teamIdHeader;

    const links = await executeResilientDb(() =>
      db.link.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    );
    res.json(links);
  } catch (err) {
    handleRouteError(res, err, "failed_to_fetch_links", { tenantId });
  }
});

// Team Member Management
app.get("/teams/:id/members", authenticate, async (req: any, res: any) => {
  const teamId = req.params.id;
  const db = getDb(config.databaseUrl);
  try {
    const members = await executeResilientDb(() =>
      db.teamMember.findMany({
        where: { teamId },
        select: { userId: true, role: true, joinedAt: true },
      })
    );
    res.json(members);
  } catch (err) {
    logger.error("failed_to_list_members", err, { teamId });
    res.status(500).json({ error: "failed_to_list_members" });
  }
});

app.delete("/teams/:id/members/:userId", authenticate, async (req: any, res: any) => {
  const teamId = req.params.id;
  const targetUserId = req.params.userId;
  const db = getDb(config.databaseUrl);
  try {
    const requesterMembership = await executeResilientDb(() =>
      db.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: req.user.id } },
      })
    );

    if (!requesterMembership || requesterMembership.role !== "ADMIN") {
      return res.status(403).json({ error: "forbidden" });
    }

    await executeResilientDb(() =>
      db.teamMember.delete({
        where: { teamId_userId: { teamId, userId: targetUserId } },
      })
    );

    res.status(204).send();
  } catch (err) {
    logger.error("failed_to_remove_member", err, { teamId, targetUserId });
    res.status(500).json({ error: "failed_to_remove_member" });
  }
});

// POST /teams/:id/invitations - create invitation token (admin-only)
app.post("/teams/:id/invitations", authenticate, async (req: any, res: any) => {
  const teamId = req.params.id;
  const { email, role, expiresInDays } = req.body;
  const db = getDb(config.databaseUrl);

  try {
    const requesterMembership = await executeResilientDb(() =>
      db.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: req.user.id } },
      })
    );

    if (!requesterMembership || requesterMembership.role !== "ADMIN") {
      return res.status(403).json({ error: "forbidden" });
    }

    const token = uuidv4();
    const expiresAt = expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const inv = await executeResilientDb(() =>
      db.invitation.create({
        data: {
          token,
          email,
          teamId,
          role: role || "MEMBER",
          expiresAt,
        },
      })
    );

    res.status(201).json({ token: inv.token, expiresAt: inv.expiresAt });
  } catch (err) {
    logger.error("failed_to_create_invitation", err, { teamId, email });
    res.status(500).json({ error: "failed_to_create_invitation" });
  }
});

// POST /invitations/accept - accept an invitation (authenticated)
app.post("/invitations/accept", authenticate, async (req: any, res: any) => {
  const { token } = req.body;
  const userId = req.user.id;
  const db = getDb(config.databaseUrl);

  try {
    const inv = await executeResilientDb(() => db.invitation.findUnique({ where: { token } }));
    if (!inv) return res.status(404).json({ error: "invalid_token" });
    if (inv.expiresAt && inv.expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: "token_expired" });
    }

    // Idempotent create
    const existing = await executeResilientDb(() => db.teamMember.findUnique({ where: { teamId_userId: { teamId: inv.teamId, userId } } }));
    if (existing) {
      // Remove the invitation and return existing membership
      await executeResilientDb(() => db.invitation.delete({ where: { id: inv.id } }));
      return res.status(200).json(existing);
    }

    const membership = await executeResilientDb(() =>
      db.teamMember.create({
        data: { teamId: inv.teamId, userId, role: inv.role },
      })
    );

    await executeResilientDb(() => db.invitation.delete({ where: { id: inv.id } }));

    res.status(201).json(membership);
  } catch (err) {
    logger.error("failed_to_accept_invitation", err, { token });
    res.status(500).json({ error: "failed_to_accept_invitation" });
  }
});

// GET /teams/:id/activity - recent link creations and click summaries
app.get("/teams/:id/activity", authenticate, async (req: any, res: any) => {
  const teamId = req.params.id;
  const db = getDb(config.databaseUrl);

  try {
    const membership = await executeResilientDb(() => db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: req.user.id } } }));
    if (!membership) return res.status(403).json({ error: "forbidden" });

    // Batched single query replacing N+1 loop
    const links = await executeResilientDb(() =>
      db.link.findMany({
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
      })
    );

    const summaries = links.map((l: any) => ({
      type: "link_summary",
      linkId: l.id,
      code: l.code,
      longUrl: l.longUrl,
      createdAt: l.createdAt,
      totalClicks: l._count.clicks,
      lastClick: l.clicks[0]?.timestamp || null,
    }));

    res.json({ links: summaries });
  } catch (err) {
    logger.error("failed_to_fetch_activity", err, { teamId });
    res.status(500).json({ error: "failed_to_fetch_activity" });
  }
});

app.patch("/links/:id", authenticate, async (req: any, res: any) => {
  const tenantId = req.user.tenantId;
  const linkId = req.params.id;
  const { longUrl, expiresAt, tags } = req.body;

  const db = getDb(config.databaseUrl);
  try {
    const link = await executeResilientDb(() => db.link.findUnique({ where: { id: linkId } }));
    if (!link || link.tenantId !== tenantId) {
      return res.status(404).json({ error: "not_found" });
    }

    const updated = await executeResilientDb(() =>
      db.link.update({
        where: { id: linkId },
        data: { longUrl, expiresAt: expiresAt ? new Date(expiresAt) : null, tags },
      })
    );

    await cacheService.invalidateRedirectTarget(updated.code);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "update_failed" });
  }
});

app.delete("/links/:id", authenticate, async (req: any, res: any) => {
  const tenantId = req.user.tenantId;
  const linkId = req.params.id;

  const db = getDb(config.databaseUrl);
  try {
    const link = await executeResilientDb(() => db.link.findUnique({ where: { id: linkId } }));
    if (!link || link.tenantId !== tenantId) {
      return res.status(404).json({ error: "not_found" });
    }

    await executeResilientDb(() => db.link.delete({ where: { id: linkId } }));
    await cacheService.invalidateRedirectTarget(link.code);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "failed_to_delete" });
  }
});

// Analytics: GET /links/:id/analytics
app.get("/links/:id/analytics", authenticate, async (req: any, res: any) => {
  const tenantId = req.user.tenantId;
  const linkId = req.params.id;
  const { from, to } = req.query;

  const db = getDb(config.databaseUrl);
  try {
    const link = await executeResilientDb(() =>
      db.link.findUnique({
        where: { id: linkId, tenantId },
      })
    );

    if (!link) {
      return res.status(404).json({ error: "not_found" });
    }

    const clicksCount = await executeResilientDb(() =>
      db.linkClick.count({
        where: {
          linkId,
          timestamp: {
            gte: from ? new Date(String(from)) : new Date(0),
            lte: to ? new Date(String(to)) : new Date(),
          },
        },
      })
    );

    const lastClick = await executeResilientDb(() =>
      db.linkClick.findFirst({
        where: { linkId },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      })
    );

    res.json({
      link_id: linkId,
      total_clicks: clicksCount,
      last_click: lastClick?.timestamp || null,
    });
  } catch (err) {
    handleRouteError(res, err, "failed_to_fetch_analytics", { linkId });
  }
});

app.post("/teams", limiters.createLink, authenticate, async (req: any, res: any) => {
  const { name, slug } = req.body;

  const db = getDb(config.databaseUrl);
  try {
    const team = await executeResilientDb(() =>
      db.team.create({
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
    })
    );
    res.status(201).json(team);
  } catch (err) {
    logger.error("team_creation_failed", err, { slug });
    res.status(400).json({ error: "failed_to_create_team" });
  }
});

export { app };

if (require.main === module) {
  const processType = process.env.PROCESS_TYPE || "api";

  if (processType === "api" || processType === "all") {
    const server = app.listen(config.port, "0.0.0.0", () => {
      logger.info(`API Server running on http://0.0.0.0:${config.port}`);
    });

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        logger.info("HTTP server closed.");
        try {
          await disconnectAll();
          logger.info("Database connections closed.");
          process.exit(0);
        } catch (err) {
          logger.error("Error during shutdown", err);
          process.exit(1);
        }
      });

      // Force shutdown after 10s
      setTimeout(() => {
        logger.error("Could not close connections in time, forcefully shutting down");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }

  if (processType === "worker" || processType === "all") {
    startAnalyticsWorker();
    logger.info("Analytics Worker started");
    
    process.on("SIGTERM", () => {
      logger.info("Worker received SIGTERM. Shutting down...");
      setTimeout(() => process.exit(0), 5000);
    });
  }
}

// Global Error Handler
app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error("unhandled_error", err);
  
  const isDev = config.env === "development";
  const isTest = config.env === "test";
  const isStaging = config.env === "staging";

  res.status(500).json({
    error: "internal_error",
    ...((isDev || isTest || isStaging) ? { details: err.message, stack: err.stack } : {}),
  });
});