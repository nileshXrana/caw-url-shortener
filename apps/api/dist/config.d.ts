export declare const config: {
    env: "development" | "test" | "staging" | "production";
    port: number;
    databaseUrl: string;
    redisUrl: string;
    jwtSecret: string;
    corsOrigin: string;
    logLevel: "error" | "debug" | "info" | "warn";
    isDev: boolean;
    isTest: boolean;
    isProd: boolean;
};
export type Config = typeof config;
