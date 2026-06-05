import CircuitBreaker from "opossum";
import { logger } from "./logger";

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 100
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = error?.message || "";
    const errorCode = error?.code || "";
    
    // Catch common network/timeout signatures
    const isTransient = 
      ["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "503"].some(code => errorMsg.includes(code) || errorCode.includes(code)) ||
      error?.name === "PrismaClientInitializationError";

    if (retries <= 0 || !isTransient) throw error;

    const dynamicMaxDelay = baseDelay * Math.pow(2, 4 - retries);
    const delay = Math.random() * Math.min(3000, dynamicMaxDelay);
    
    logger.warn(`Retry attempt ${4 - retries} due to transient database error`, {
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

const dbBreaker = new CircuitBreaker(async (queryFn: () => Promise<any>) => {
  return retryWithBackoff(queryFn);
}, breakerOptions);

// Log state transitions
dbBreaker.on("open", () => logger.error("Circuit breaker opened for database operations", undefined, { event: "circuit_opened", dependency: "database" }));
dbBreaker.on("halfOpen", () => logger.info("Circuit breaker half-opened for database operations", { event: "circuit_half_open", dependency: "database" }));
dbBreaker.on("close", () => logger.info("Circuit breaker closed for database operations", { event: "circuit_closed", dependency: "database" }));

dbBreaker.fallback(() => {
  throw new Error("503: Circuit breaker open. System is shedding database load.");
});

// Exposing the explicitly typed wrapper to enforce TypeScript compliance
export async function executeResilientDb<T>(queryFn: () => Promise<T>): Promise<T> {
  return dbBreaker.fire(queryFn) as Promise<T>;
}