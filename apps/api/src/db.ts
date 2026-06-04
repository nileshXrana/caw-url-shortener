import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const clients = new Map<string, { pool: Pool; prisma: PrismaClient }>();

export function getDb(databaseUrl: string): PrismaClient {
  if (clients.has(databaseUrl)) return clients.get(databaseUrl)!.prisma;

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  clients.set(databaseUrl, { pool, prisma });
  return prisma;
}

// Call during graceful shutdown to close all pools
export async function disconnectAll(): Promise<void> {
  await Promise.all(
    Array.from(clients.values()).map(async ({ prisma, pool }) => {
      await prisma.$disconnect();
      await pool.end();
    })
  );
  clients.clear();
}