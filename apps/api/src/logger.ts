import pino from "pino";
import { config } from "./config";
import { AsyncLocalStorage } from "async_hooks";

export interface LogContext {
  requestId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  latencyMs?: number;
  [key: string]: any;
}

export const asyncLocalStorage = new AsyncLocalStorage<{ requestId: string }>();

const isDev = config.env === "development";

const pinoLogger = pino({
  level: config.logLevel.toLowerCase(),
  timestamp: pino.stdTimeFunctions.isoTime,
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

export const redact = (data: any): any => {
  if (!data) return data;
  const sensitiveKeys = ["authorization", "password", "token", "secret", "x-api-key", "authheader"];
  
  const isSensitiveValue = (val: any): boolean => {
    if (typeof val !== "string") return false;
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
      return data.map(item => redact(item));
    }
    const redacted = { ...data };
    for (const key of Object.keys(redacted)) {
      const val = redacted[key];
      if (sensitiveKeys.includes(key.toLowerCase()) || isSensitiveValue(val)) {
        redacted[key] = "[REDACTED]";
      } else if (typeof val === "object") {
        redacted[key] = redact(val);
      }
    }
    return redacted;
  }
  
  return data;
};

export const logger = {
  info: (message: string, context?: LogContext) => {
    const store = asyncLocalStorage.getStore();
    const requestId = store?.requestId || context?.requestId || context?.request_id;
    
    const cleanContext = { ...context };
    if (cleanContext.requestId) delete cleanContext.requestId;
    if (cleanContext.request_id) delete cleanContext.request_id;

    pinoLogger.info({
      request_id: requestId,
      ...redact(cleanContext),
    }, redact(message));
  },
  warn: (message: string, context?: LogContext) => {
    const store = asyncLocalStorage.getStore();
    const requestId = store?.requestId || context?.requestId || context?.request_id;

    const cleanContext = { ...context };
    if (cleanContext.requestId) delete cleanContext.requestId;
    if (cleanContext.request_id) delete cleanContext.request_id;

    pinoLogger.warn({
      request_id: requestId,
      ...redact(cleanContext),
    }, redact(message));
  },
  error: (message: string, error?: any, context?: LogContext) => {
    const store = asyncLocalStorage.getStore();
    const requestId = store?.requestId || context?.requestId || context?.request_id;

    const cleanContext = { ...context };
    if (cleanContext.requestId) delete cleanContext.requestId;
    if (cleanContext.request_id) delete cleanContext.request_id;

    const errObj = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : error;

    pinoLogger.error({
      request_id: requestId,
      error: redact(errObj),
      ...redact(cleanContext),
    }, redact(message));
  },
};
