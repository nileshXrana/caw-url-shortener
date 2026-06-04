"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeOldAnalytics = void 0;
const db_1 = require("./db");
const config_1 = require("./config");
const logger_1 = require("./logger");
const purgeOldAnalytics = async (retentionDays = 30) => {
    const db = (0, db_1.getDb)(config_1.config.databaseUrl);
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
        logger_1.logger.info("Purged old analytics", { deletedCount: deleted.count, cutoff });
        return deleted.count;
    }
    catch (err) {
        logger_1.logger.error("Failed to purge analytics", err);
        throw err;
    }
};
exports.purgeOldAnalytics = purgeOldAnalytics;
if (require.main === module) {
    const days = parseInt(process.argv[2] || "30", 10);
    (0, exports.purgeOldAnalytics)(days).then(() => process.exit(0)).catch(() => process.exit(1));
}
//# sourceMappingURL=purge.js.map