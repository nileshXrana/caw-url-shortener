import { Queue, Worker, Job } from "bullmq";
import { config } from "../config";
import { logger } from "../logger";
import { getDb } from "../db";
import { createHash } from "crypto";

const REDIS_OPTIONS = {
  connection: {
    url: config.redisUrl,
  },
};

export const analyticsQueue = new Queue("analytics", REDIS_OPTIONS);

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

export const processClickJob = async (job: { data: ClickJobData }) => {
  const { linkId, requestId, ip, userAgent, referer, timestamp } = job.data;
  const db = getDb(config.databaseUrl);
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
    logger.info("Recorded click", { linkId, requestId });
  } catch (err: any) {
    // P2002 is Prisma's unique constraint violation (idempotency)
    if (err.code === "P2002") {
      logger.warn("Duplicate click ignored", { requestId });
      return;
    }
    logger.error("Failed to record click", err, { requestId });
    throw err; // BullMQ will retry
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
