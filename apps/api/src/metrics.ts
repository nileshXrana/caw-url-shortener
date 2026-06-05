import client from "prom-client";

// Enable default metrics collection (CPU, memory, event loop, etc.)
client.collectDefaultMetrics();

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "path", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], // detailed duration buckets
});

export const activeRequests = new client.Gauge({
  name: "active_requests",
  help: "Number of active HTTP requests currently being processed",
});

export const register = client.register;
