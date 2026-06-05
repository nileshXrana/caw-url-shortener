import { AsyncLocalStorage } from "async_hooks";
export interface LogContext {
    requestId?: string;
    method?: string;
    url?: string;
    statusCode?: number;
    latencyMs?: number;
    [key: string]: any;
}
export declare const asyncLocalStorage: AsyncLocalStorage<{
    requestId: string;
}>;
export declare const redact: (data: any) => any;
export declare const logger: {
    info: (message: string, context?: LogContext) => void;
    warn: (message: string, context?: LogContext) => void;
    error: (message: string, error?: any, context?: LogContext) => void;
};
