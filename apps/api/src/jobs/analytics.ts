import { Queue, Worker, Job } from "bullmq";
import { config } from "../config";
import { logger } from "../logger";
import { getDb } from "../db";
import { createHash } from "crypto";
import { cacheService } from "../redis";

const REDIS_OPTIONS = {
  connection: {
    url: config.redisUrl,
  },
};

export const analyticsQueue = new Queue("analytics", {
  ...REDIS_OPTIONS,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});

export interface ClickJobData {
  linkId: string;
  requestId: string;
  ip: string;
  userAgent?: string;
  referer?: string;
  timestamp: string;
}

const hashIp = (ip: string) => {
  return createHash("sha256").update(ip).digest("hex");
};

const getTimestampBucket = (timestamp: string) => {
  const bucket = new Date(timestamp);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
};

export const processClickJob = async (job: { id?: string; data: ClickJobData }) => {
  const jobId = job.id;
  
  if (jobId) {
    const isProcessed = await cacheService.isJobProcessed(jobId);
    if (isProcessed) {
      logger.warn("Duplicate job execution prevented via Redis dedup namespace", { jobId });
      return;
    }
  }

  const { linkId, requestId, ip, userAgent, referer, timestamp } = job.data;
  const db = getDb(config.databaseUrl, 3);
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

      await transaction.$executeRaw`
        INSERT INTO "AnalyticsBucket" ("id", "linkId", "timestampBucket", "count", "lastAccessedAt")
        VALUES (${crypto.randomUUID()}, ${linkId}, ${timestampBucket}, 1, ${clickedAt})
        ON CONFLICT ("linkId", "timestampBucket")
        DO UPDATE SET
          "count" = "AnalyticsBucket"."count" + 1,
          "lastAccessedAt" = GREATEST("AnalyticsBucket"."lastAccessedAt", EXCLUDED."lastAccessedAt")
      `;
    });

    if (jobId) {
      await cacheService.markJobProcessed(jobId);
    }
    
    logger.info("Recorded click", { linkId, requestId });
  } catch (err: any) {
    if (err.code === "P2002") {
      logger.warn("Duplicate click ignored", { requestId });
      return;
    }
    logger.error("Failed to record click", err, { requestId });
    throw err;
  }
};

export const startAnalyticsWorker = () => {
  const worker = new Worker(
    "analytics",
    processClickJob,
    {
      ...REDIS_OPTIONS,
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Job ${job?.id} failed`, err);
  });

  return worker;
};