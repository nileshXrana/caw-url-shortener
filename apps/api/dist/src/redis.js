"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheService = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const redis = new ioredis_1.default(config_1.config.redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => {
        if (times > 3) {
            logger_1.logger.error("Redis connection failed, giving up after 3 retries", null, { times });
            return null;
        }
        return Math.min(times * 50, 2000);
    },
});
redis.on("error", (err) => {
    logger_1.logger.error("Redis Error", err);
});
exports.cacheService = {
    getRedirectTarget: async (code) => {
        try {
            const data = await redis.get(`redirect:${code}`);
            if (data) {
                const parsed = JSON.parse(data);
                logger_1.logger.info("Cache hit", { code, ...parsed });
                return parsed;
            }
            logger_1.logger.info("Cache miss", { code });
            return null;
        }
        catch (err) {
            logger_1.logger.error("Redis get error", err, { code });
            return null;
        }
    },
    setRedirectTarget: async (code, link, ttlSeconds = 3600) => {
        try {
            await redis.set(`redirect:${code}`, JSON.stringify(link), "EX", ttlSeconds);
            logger_1.logger.info("Cache set", { code, ...link, ttlSeconds });
        }
        catch (err) {
            logger_1.logger.error("Redis set error", err, { code, ...link });
        }
    },
    invalidateRedirectTarget: async (code) => {
        try {
            await redis.del(`redirect:${code}`);
            logger_1.logger.info("Cache invalidated", { code });
        }
        catch (err) {
            logger_1.logger.error("Redis delete error", err, { code });
        }
    },
};
//# sourceMappingURL=redis.js.map