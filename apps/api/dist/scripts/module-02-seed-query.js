"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const tenantId = "t_demo";
    const code = `t_demo_demo_${Date.now()}`;
    const longUrl = "https://example.com/long-url";
    const inserted = await prisma.link.create({
        data: {
            tenantId,
            code,
            longUrl,
            createdBy: "user_demo",
            tags: ["module-02"],
        },
        select: { id: true, tenantId: true, code: true, longUrl: true },
    });
    const selected = await prisma.link.findUnique({
        where: { tenantId_code: { tenantId, code } },
        select: { tenantId: true, code: true, longUrl: true },
    });
    console.log(`inserted code: ${inserted.code}`);
    console.log(`selected code: ${selected?.code ?? "null"}`);
    console.log(`matched long_url: ${selected?.longUrl ?? "null"}`);
}
main()
    .catch((error) => {
    console.error(error);
    process.exitCode = 1;
})
    .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
});
//# sourceMappingURL=module-02-seed-query.js.map