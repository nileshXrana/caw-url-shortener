import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const clients = new Map<string, { pool: Pool; prisma: PrismaClient }>();

export function getDb(databaseUrl: string, maxConnections = 17): PrismaClient {
  const cacheKey = `${databaseUrl}:${maxConnections}`;
  if (clients.has(cacheKey)) return clients.get(cacheKey)!.prisma;

  // Added query_timeout: 1000 to force driver-level cancellation at 1 second
  const pool = new Pool({ 
    connectionString: databaseUrl, 
    max: maxConnections,
    query_timeout: 1000 
  });
  
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  clients.set(cacheKey, { pool, prisma });
  return prisma;
}

export async function disconnectAll(): Promise<void> {
  await Promise.all(
    Array.from(clients.values()).map(async ({ prisma, pool }) => {
      await prisma.$disconnect();
      await pool.end();
    })
  );
  clients.clear();
}