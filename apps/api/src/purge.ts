import { getDb } from "./db";
import { config } from "./config";
import { logger } from "./logger";

export const purgeOldAnalytics = async (retentionDays: number = 30) => {
  const db = getDb(config.databaseUrl);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  try {
    const deleted = await db.linkClick.deleteMany({
      where: {
        timestamp: {
          lt: cutoff,
        },
      },
    });
    logger.info("Purged old analytics", { deletedCount: deleted.count, cutoff });
    return deleted.count;
  } catch (err) {
    logger.error("Failed to purge analytics", err);
    throw err;
  }
};

// If run directly
if (require.main === module) {
  const days = parseInt(process.argv[2] || "30", 10);
  purgeOldAnalytics(days).then(() => process.exit(0)).catch(() => process.exit(1));
}
