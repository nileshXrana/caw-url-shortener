import client from "prom-client";
export declare const httpRequestsTotal: client.Counter<"method" | "path" | "status">;
export declare const httpRequestDurationSeconds: client.Histogram<"method" | "path" | "status">;
export declare const activeRequests: client.Gauge<string>;
export declare const register: client.Registry<"text/plain; version=0.0.4; charset=utf-8">;
