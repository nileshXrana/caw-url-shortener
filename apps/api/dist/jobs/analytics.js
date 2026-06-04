"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAnalyticsWorker = exports.processClickJob = exports.analyticsQueue = void 0;
const bullmq_1 = require("bullmq");
const config_1 = require("../config");
const logger_1 = require("../logger");
const db_1 = require("../db");
const crypto_1 = require("crypto");
const redis_1 = require("../redis");
const REDIS_OPTIONS = {
    connection: {
        url: config_1.config.redisUrl,
    },
};
exports.analyticsQueue = new bullmq_1.Queue("analytics", {
    ...REDIS_OPTIONS,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
    },
});
const hashIp = (ip) => {
    return (0, crypto_1.createHash)("sha256").update(ip).digest("hex");
};
const getTimestampBucket = (timestamp) => {
    const bucket = new Date(timestamp);
    bucket.setUTCMinutes(0, 0, 0);
    return bucket;
};
const processClickJob = async (job) => {
    const jobId = job.id;
    if (jobId) {
        const isProcessed = await redis_1.cacheService.isJobProcessed(jobId);
        if (isProcessed) {
            logger_1.logger.warn("Duplicate job execution prevented via Redis dedup namespace", { jobId });
            return;
        }
    }
    const { linkId, requestId, ip, userAgent, referer, timestamp } = job.data;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl, 3);
    const ipHash = hashIp(ip);
    const timestampBucket = getTimestampBucket(timestamp);
    const clickedAt = new Date(timestamp);
    try {
        await db.$transaction(async (transaction) => {
            await transaction.linkClick.create({
                data: {
                    linkId,
                    requestId,
                    ipHash,
                    userAgent,
                    referer,
                    timestamp: clickedAt,
                },
            });
            await transaction.$executeRaw `
        INSERT INTO "AnalyticsBucket" ("id", "linkId", "timestampBucket", "count", "lastAccessedAt")
        VALUES (${crypto.randomUUID()}, ${linkId}, ${timestampBucket}, 1, ${clickedAt})
        ON CONFLICT ("linkId", "timestampBucket")
        DO UPDATE SET
          "count" = "AnalyticsBucket"."count" + 1,
          "lastAccessedAt" = GREATEST("AnalyticsBucket"."lastAccessedAt", EXCLUDED."lastAccessedAt")
      `;
        });
        if (jobId) {
            await redis_1.cacheService.markJobProcessed(jobId);
        }
        logger_1.logger.info("Recorded click", { linkId, requestId });
    }
    catch (err) {
        if (err.code === "P2002") {
            logger_1.logger.warn("Duplicate click ignored", { requestId });
            return;
        }
        logger_1.logger.error("Failed to record click", err, { requestId });
        throw err;
    }
};
exports.processClickJob = processClickJob;
const startAnalyticsWorker = () => {
    const worker = new bullmq_1.Worker("analytics", exports.processClickJob, {
        ...REDIS_OPTIONS,
        concurrency: 5,
    });
    worker.on("completed", (job) => {
        logger_1.logger.info(`Job ${job.id} completed`);
    });
    worker.on("failed", (job, err) => {
        logger_1.logger.error(`Job ${job?.id} failed`, err);
    });
    return worker;
};
exports.startAnalyticsWorker = startAnalyticsWorker;
//# sourceMappingURL=analytics.js.map