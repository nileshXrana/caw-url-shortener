"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAnalyticsWorker = exports.processClickJob = exports.analyticsQueue = void 0;
const bullmq_1 = require("bullmq");
const config_1 = require("../config");
const logger_1 = require("../logger");
const db_1 = require("../db");
const crypto_1 = require("crypto");
const REDIS_OPTIONS = {
    connection: {
        url: config_1.config.redisUrl,
    },
};
exports.analyticsQueue = new bullmq_1.Queue("analytics", REDIS_OPTIONS);
const hashIp = (ip) => {
    return (0, crypto_1.createHash)("sha256").update(ip).digest("hex");
};
const processClickJob = async (job) => {
    const { linkId, requestId, ip, userAgent, referer, timestamp } = job.data;
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
    const ipHash = hashIp(ip);
    try {
        await db.linkClick.create({
            data: {
                linkId,
                requestId,
                ipHash,
                userAgent,
                referer,
                timestamp: new Date(timestamp),
            },
        });
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