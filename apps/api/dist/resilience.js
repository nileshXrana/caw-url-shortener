"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryWithBackoff = retryWithBackoff;
exports.executeResilientDb = executeResilientDb;
const opossum_1 = __importDefault(require("opossum"));
const logger_1 = require("./logger");
async function retryWithBackoff(fn, retries = 3, baseDelay = 100) {
    try {
        return await fn();
    }
    catch (error) {
        const errorMsg = error?.message || "";
        const errorCode = error?.code || "";
        const isTransient = ["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "503"].some(code => errorMsg.includes(code) || errorCode.includes(code)) ||
            error?.name === "PrismaClientInitializationError";
        if (retries <= 0 || !isTransient)
            throw error;
        const dynamicMaxDelay = baseDelay * Math.pow(2, 4 - retries);
        const delay = Math.random() * Math.min(3000, dynamicMaxDelay);
        logger_1.logger.warn(`Retry attempt ${4 - retries} due to transient database error`, {
            event: "retry_attempt",
            attempt: 4 - retries,
            max_retries: 3,
            delay_ms: Math.round(delay),
            error_message: errorMsg,
            error_code: errorCode,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        return retryWithBackoff(fn, retries - 1, baseDelay);
    }
}
const breakerOptions = {
    timeout: 1000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000
};
const dbBreaker = new opossum_1.default(async (queryFn) => {
    return retryWithBackoff(queryFn);
}, breakerOptions);
dbBreaker.on("open", () => logger_1.logger.error("Circuit breaker opened for database operations", undefined, { event: "circuit_opened", dependency: "database" }));
dbBreaker.on("halfOpen", () => logger_1.logger.info("Circuit breaker half-opened for database operations", { event: "circuit_half_open", dependency: "database" }));
dbBreaker.on("close", () => logger_1.logger.info("Circuit breaker closed for database operations", { event: "circuit_closed", dependency: "database" }));
dbBreaker.fallback(() => {
    throw new Error("503: Circuit breaker open. System is shedding database load.");
});
async function executeResilientDb(queryFn) {
    return dbBreaker.fire(queryFn);
}
//# sourceMappingURL=resilience.js.map