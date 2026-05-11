import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config();

export interface Config {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
}

export function loadConfig(): Config {
  const port = parseInt(process.env.PORT || "3000", 10);
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }

  const jwtSecret = process.env.JWT_SECRET || "default-secret-for-dev-only";

  return { 
    port, 
    databaseUrl, 
    redisUrl,
    jwtSecret 
  };
}

export const config = loadConfig();
