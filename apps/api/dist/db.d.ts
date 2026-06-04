import { PrismaClient } from "@prisma/client";
export declare function getDb(databaseUrl: string, maxConnections?: number): PrismaClient;
export declare function disconnectAll(): Promise<void>;
