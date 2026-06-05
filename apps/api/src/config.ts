import { z } from "zod";
import * as dotenv from "dotenv";

// Load local environment variables if present (not in production)
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

// 1. Define the strict validation schema
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection string URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid connection string URL"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters long for production security"),
  CORS_ORIGIN: z.string().url("CORS_ORIGIN must be a valid URL"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

// 2. Parse process.env safely
const parsed = envSchema.safeParse(process.env);

// Fail-Fast: Crash the process immediately if configuration is malformed
if (!parsed.success) {
  console.error("❌ CRITICAL CONFIGURATION ERROR: Invalid environment variables detected at startup!");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

const data = parsed.data;

// 3. Map to the camelCase keys expected by the application and export environment-aware properties
export const config = {
  env: data.NODE_ENV,
  port: data.PORT,
  databaseUrl: data.DATABASE_URL,
  redisUrl: data.REDIS_URL,
  jwtSecret: data.JWT_SECRET,
  corsOrigin: data.CORS_ORIGIN,
  logLevel: data.LOG_LEVEL,

  // Environment flags
  isDev: data.NODE_ENV === "development",
  isTest: data.NODE_ENV === "test",
  isProd: data.NODE_ENV === "production",
};

export type Config = typeof config;

// At the end of startup, after config is validated:
console.log(
  JSON.stringify({
    message: "Service starting",
    environment: config.env,
    port: config.port,
    log_level: config.logLevel,
  })
);
