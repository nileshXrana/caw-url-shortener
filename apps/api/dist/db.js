"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.disconnectAll = disconnectAll;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const clients = new Map();
function getDb(databaseUrl, maxConnections = 17) {
    const cacheKey = `${databaseUrl}:${maxConnections}`;
    if (clients.has(cacheKey))
        return clients.get(cacheKey).prisma;
    const pool = new pg_1.Pool({
        connectionString: databaseUrl,
        max: maxConnections,
        query_timeout: 1000
    });
    const adapter = new adapter_pg_1.PrismaPg(pool);
    const prisma = new client_1.PrismaClient({ adapter });
    clients.set(cacheKey, { pool, prisma });
    return prisma;
}
async function disconnectAll() {
    await Promise.all(Array.from(clients.values()).map(async ({ prisma, pool }) => {
        await prisma.$disconnect();
        await pool.end();
    }));
    clients.clear();
}
//# sourceMappingURL=db.js.map