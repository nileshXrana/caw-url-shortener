"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const zod_1 = require("zod");
const dotenv = __importStar(require("dotenv"));
if (process.env.NODE_ENV !== "production") {
    dotenv.config();
}
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(["development", "test", "staging", "production"]).default("development"),
    PORT: zod_1.z.coerce.number().int().positive().default(3000),
    DATABASE_URL: zod_1.z.string().url("DATABASE_URL must be a valid connection string URL"),
    REDIS_URL: zod_1.z.string().url("REDIS_URL must be a valid connection string URL"),
    JWT_SECRET: zod_1.z.string().min(32, "JWT_SECRET must be at least 32 characters long for production security"),
    CORS_ORIGIN: zod_1.z.string().url("CORS_ORIGIN must be a valid URL"),
    LOG_LEVEL: zod_1.z.enum(["debug", "info", "warn", "error"]).default("info"),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error("❌ CRITICAL CONFIGURATION ERROR: Invalid environment variables detected at startup!");
    console.error(JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
}
const data = parsed.data;
exports.config = {
    env: data.NODE_ENV,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    redisUrl: data.REDIS_URL,
    jwtSecret: data.JWT_SECRET,
    corsOrigin: data.CORS_ORIGIN,
    logLevel: data.LOG_LEVEL,
    isDev: data.NODE_ENV === "development",
    isTest: data.NODE_ENV === "test",
    isProd: data.NODE_ENV === "production",
};
console.log(JSON.stringify({
    message: "Service starting",
    environment: exports.config.env,
    port: exports.config.port,
    log_level: exports.config.logLevel,
}));
//# sourceMappingURL=config.js.map