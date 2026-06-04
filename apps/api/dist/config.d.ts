export interface Config {
    port: number;
    databaseUrl: string;
    redisUrl: string;
    jwtSecret: string;
}
export declare function loadConfig(): Config;
export declare const config: Config;
