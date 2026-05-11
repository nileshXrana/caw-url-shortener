"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
let cached = null;
function getDb(databaseUrl) {
    if (cached?.url === databaseUrl)
        return cached.prisma;
    const pool = new pg_1.Pool({ connectionString: databaseUrl });
    const adapter = new adapter_pg_1.PrismaPg(pool);
    const prisma = new client_1.PrismaClient({ adapter });
    cached = { url: databaseUrl, pool, prisma };
    return prisma;
}
//# sourceMappingURL=db.js.map