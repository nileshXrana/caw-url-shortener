import express from "express";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";
import { cacheService, CachedLink } from "./redis";
import { analyticsQueue, startAnalyticsWorker } from "./jobs/analytics";
import { config } from "./config";
import { getDb } from "./db";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import { isValidRedirectUrl } from "./url";
import { Redis } from "ioredis";

const app = express();
app.use(express.json());

// --- Observability Endpoints ---
app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/ready", async (req, res) => {
  try {
    const db = getDb(config.databaseUrl);
    await db.$queryRaw`SELECT 1`;
    
    const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 0 });
    await redis.ping();
    await redis.quit();
    
    res.status(200).send("READY");
  } catch (err) {
    logger.error("Readiness check failed", err);
    res.status(503).send("NOT_READY");
  }
});

// Request Context Middleware (Correlation ID)
app.use((req: any, _res, next) => {
  req.id = req.headers["x-request-id"] || uuidv4();
  next();
});

// Logger Middleware
app.use((req: any, res: any, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.info("request_completed", {
      requestId: req.id,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      latencyMs: Date.now() - start,
    });
  });
  next();
});

const authenticate = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
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
        // 3. Fallback to DB (with In-Flight tracking)
        const fetchPromise = (async () => {
          try {
            logger.info("Cache miss, querying DB...", { code });
            
            const tenantId = code.split("_", 1)[0] ?? "";
            if (!tenantId) return null;

            const db = getDb(config.databaseUrl);
            const link = await db.link.findUnique({
              where: { tenantId_code: { tenantId, code } },
              select: { id: true, longUrl: true, expiresAt: true },
            });

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
    logger.error("redirect_failed", err, { requestId: req.id, code });
    res.status(500).json({ error: "internal_error" });
  }
});

// 2. Admin: Link Management (Protected)
app.post("/links", authenticate, async (req: any, res: any) => {
  const { code, longUrl, expiresAt, tags } = req.body;
  const tenantId = req.user.tenantId;
  const createdBy = req.user.id;

  if (!longUrl || !isValidRedirectUrl(longUrl)) {
    return res.status(400).json({ error: "invalid_url" });
  }

  const db = getDb(config.databaseUrl);
  try {
    const link = await db.link.create({
      data: {
        tenantId,
        code,
        longUrl,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdAt: new Date(),
        tags: tags || [],
        createdBy,
      },
    });
    res.status(201).json(link);
  } catch (err) {
    logger.error("link_creation_failed", err, { tenantId, code });
    res.status(400).json({ error: "failed_to_create_link" });
  }
});

app.get("/links/search", authenticate, async (req: any, res: any) => {
  const tenantId = req.user.tenantId;
  const q = String(req.query.q || "");
  const tag = req.query.tag; // string or array
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.page_size || "10"))));
  
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  const db = getDb(config.databaseUrl);
  try {
    const where: any = { tenantId };

    if (q) {
      // Use plainto_tsquery logic: sanitize the input to remove special FTS operators
      // or replace them with safe versions.
      // For Prisma, the simplest way is to remove characters that have special meaning in to_tsquery.
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
      db.link.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      db.link.count({ where }),
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
    logger.error("search_failed", err, { tenantId, q });
    res.status(500).json({ error: "search_failed" });
  }
});

app.get("/links", authenticate, async (req: any, res: any) => {
  const tenantId = req.user.tenantId;
  const db = getDb(config.databaseUrl);
  try {
    const links = await db.link.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    res.json(links);
  } catch (err) {
    res.status(500).json({ error: "failed_to_fetch_links" });
  }
});

app.patch("/links/:id", authenticate, async (req: any, res: any) => {
  const tenantId = req.user.tenantId;
  const linkId = req.params.id;
  const { longUrl, expiresAt, tags } = req.body;

  const db = getDb(config.databaseUrl);
  try {
    const link = await db.link.findUnique({ where: { id: linkId } });
    if (!link || link.tenantId !== tenantId) {
      return res.status(404).json({ error: "not_found" });
    }

    const updated = await db.link.update({
      where: { id: linkId },
      data: { longUrl, expiresAt: expiresAt ? new Date(expiresAt) : null, tags },
    });

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
    const link = await db.link.findUnique({ where: { id: linkId } });
    if (!link || link.tenantId !== tenantId) {
      return res.status(404).json({ error: "not_found" });
    }

    await db.link.delete({ where: { id: linkId } });
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
    const link = await db.link.findUnique({
      where: { id: linkId, tenantId },
    });

    if (!link) {
      return res.status(404).json({ error: "not_found" });
    }

    const clicksCount = await db.linkClick.count({
      where: {
        linkId,
        timestamp: {
          gte: from ? new Date(String(from)) : new Date(0),
          lte: to ? new Date(String(to)) : new Date(),
        },
      },
    });

    const lastClick = await db.linkClick.findFirst({
      where: { linkId },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });

    res.json({
      link_id: linkId,
      total_clicks: clicksCount,
      last_click: lastClick?.timestamp || null,
    });
  } catch (err) {
    logger.error("failed_to_fetch_analytics", err, { linkId });
    res.status(500).json({ error: "internal_error" });
  }
});

app.post("/teams", limiters.createLink, authenticate, async (req: any, res: any) => {
  const { name, slug } = req.body;

  const db = getDb(config.databaseUrl);
  try {
    const team = await db.team.create({
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
    });
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
          const db = getDb(config.databaseUrl);
          await db.$disconnect();
          logger.info("Database connection closed.");
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
      // BullMQ handles shutdown gracefully if we don't force exit
      setTimeout(() => process.exit(0), 5000);
    });
  }
}

// Global Error Handler
app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error("unhandled_error", err);
  res.status(500).json({ error: "internal_error" });
});
