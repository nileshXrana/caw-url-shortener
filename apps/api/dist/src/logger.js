"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.redact = void 0;
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
        return data;
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
        try {
            const logObj = {
                level: "info",
                timestamp: new Date().toISOString(),
                message: (0, exports.redact)(message),
                ...(0, exports.redact)(context),
            };
            const logLine = JSON.stringify(logObj) + "\n";
            process.stdout.write(logLine);
        }
        catch (e) {
            process.stdout.write(`{"level":"error","message":"failed_to_log_info","error":"${String(e)}"}\n`);
        }
    },
    warn: (message, context) => {
        try {
            const logObj = {
                level: "warn",
                timestamp: new Date().toISOString(),
                message: (0, exports.redact)(message),
                ...(0, exports.redact)(context),
            };
            const logLine = JSON.stringify(logObj) + "\n";
            process.stdout.write(logLine);
        }
        catch (e) {
            process.stdout.write(`{"level":"error","message":"failed_to_log_warn","error":"${String(e)}"}\n`);
        }
    },
    error: (message, error, context) => {
        try {
            const logObj = {
                level: "error",
                timestamp: new Date().toISOString(),
                message: (0, exports.redact)(message),
                error: error instanceof Error ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                } : String(error),
                ...(0, exports.redact)(context),
            };
            const logLine = JSON.stringify(logObj) + "\n";
            process.stderr.write(logLine);
        }
        catch (e) {
            process.stderr.write(`{"level":"error","message":"failed_to_log_error","error":"serialization_failed"}\n`);
        }
    },
};
//# sourceMappingURL=logger.js.map