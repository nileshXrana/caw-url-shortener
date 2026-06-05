"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.redact = exports.asyncLocalStorage = void 0;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("./config");
const async_hooks_1 = require("async_hooks");
exports.asyncLocalStorage = new async_hooks_1.AsyncLocalStorage();
const isDev = config_1.config.env === "development";
const pinoLogger = (0, pino_1.default)({
    level: config_1.config.logLevel.toLowerCase(),
    timestamp: pino_1.default.stdTimeFunctions.isoTime,
    formatters: {
        level: (label) => ({ level: label }),
    },
    base: {
        service_name: "url-shortener",
    },
    ...(isDev ? {
        transport: {
            target: "pino-pretty",
            options: {
                colorize: true,
                translateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'",
                ignore: "pid,hostname",
            },
        },
    } : {}),
});
const redact = (data) => {
    if (!data)
        return data;
    const sensitiveKeys = ["authorization", "password", "token", "secret", "x-api-key", "authheader"];
    const isSensitiveValue = (val) => {
        if (typeof val !== "string")
            return false;
        const lower = val.toLowerCase();
        return lower.includes("bearer ") || lower.includes("api_key") || lower.includes("jwt");
    };
    if (typeof data === "string") {
        if (isSensitiveValue(data)) {
            return "[REDACTED]";
        }
        return data.replace(/[\r\n\t]+/g, " ");
    }
    if (typeof data === "object" && data !== null) {
        if (Array.isArray(data)) {
            return data.map(item => (0, exports.redact)(item));
        }
        const redacted = { ...data };
        for (const key of Object.keys(redacted)) {
            const val = redacted[key];
            if (sensitiveKeys.includes(key.toLowerCase()) || isSensitiveValue(val)) {
                redacted[key] = "[REDACTED]";
            }
            else if (typeof val === "object") {
                redacted[key] = (0, exports.redact)(val);
            }
        }
        return redacted;
    }
    return data;
};
exports.redact = redact;
exports.logger = {
    info: (message, context) => {
        const store = exports.asyncLocalStorage.getStore();
        const requestId = store?.requestId || context?.requestId || context?.request_id;
        const cleanContext = { ...context };
        if (cleanContext.requestId)
            delete cleanContext.requestId;
        if (cleanContext.request_id)
            delete cleanContext.request_id;
        pinoLogger.info({
            request_id: requestId,
            ...(0, exports.redact)(cleanContext),
        }, (0, exports.redact)(message));
    },
    warn: (message, context) => {
        const store = exports.asyncLocalStorage.getStore();
        const requestId = store?.requestId || context?.requestId || context?.request_id;
        const cleanContext = { ...context };
        if (cleanContext.requestId)
            delete cleanContext.requestId;
        if (cleanContext.request_id)
            delete cleanContext.request_id;
        pinoLogger.warn({
            request_id: requestId,
            ...(0, exports.redact)(cleanContext),
        }, (0, exports.redact)(message));
    },
    error: (message, error, context) => {
        const store = exports.asyncLocalStorage.getStore();
        const requestId = store?.requestId || context?.requestId || context?.request_id;
        const cleanContext = { ...context };
        if (cleanContext.requestId)
            delete cleanContext.requestId;
        if (cleanContext.request_id)
            delete cleanContext.request_id;
        const errObj = error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
        } : error;
        pinoLogger.error({
            request_id: requestId,
            error: (0, exports.redact)(errObj),
            ...(0, exports.redact)(cleanContext),
        }, (0, exports.redact)(message));
    },
};
//# sourceMappingURL=logger.js.map