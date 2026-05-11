import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

let cached:
  | { url: string; pool: Pool; prisma: PrismaClient }
  | null = null;

export function getDb(databaseUrl: string): PrismaClient {
  if (cached?.url === databaseUrl) return cached.prisma;

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  cached = { url: databaseUrl, pool, prisma };
  return prisma;
}

