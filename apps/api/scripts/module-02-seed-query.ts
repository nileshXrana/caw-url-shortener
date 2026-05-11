import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
