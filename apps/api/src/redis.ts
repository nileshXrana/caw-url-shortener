import Redis from "ioredis";
import { config } from "./config";
import { logger } from "./logger";

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => {
    if (times > 3) {
      logger.error("Redis connection failed, giving up after 3 retries", null, { times });
      return null; // Stop retrying
    }
    return Math.min(times * 50, 2000);
  },
});

redis.on("error", (err) => {
  logger.error("Redis Error", err);
});

export interface CachedLink {
  id: string;
  longUrl: string;
}

export const cacheService = {
  getRedirectTarget: async (code: string): Promise<CachedLink | null> => {
    try {
      const data = await redis.get(`redirect:${code}`);
      if (data) {
        const parsed = JSON.parse(data) as CachedLink;
        logger.info("Cache hit", { code, ...parsed });
        return parsed;
      }
      logger.info("Cache miss", { code });
      return null;
    } catch (err) {
      logger.error("Redis get error", err, { code });
      return null;
    }
  },

  setRedirectTarget: async (code: string, link: CachedLink, ttlSeconds: number = 3600): Promise<void> => {
    try {
      await redis.set(`redirect:${code}`, JSON.stringify(link), "EX", ttlSeconds);
      logger.info("Cache set", { code, ...link, ttlSeconds });
    } catch (err) {
      logger.error("Redis set error", err, { code, ...link });
    }
  },

  invalidateRedirectTarget: async (code: string): Promise<void> => {
    try {
      await redis.del(`redirect:${code}`);
      logger.info("Cache invalidated", { code });
    } catch (err) {
      logger.error("Redis delete error", err, { code });
    }
  },
};
