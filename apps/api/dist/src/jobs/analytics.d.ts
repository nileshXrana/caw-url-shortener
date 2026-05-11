import { Queue, Worker } from "bullmq";
export declare const analyticsQueue: Queue<any, any, string, any, any, string>;
export interface ClickJobData {
    linkId: string;
    requestId: string;
    ip: string;
    userAgent?: string;
    referer?: string;
    timestamp: string;
}
export declare const processClickJob: (job: {
    data: ClickJobData;
}) => Promise<void>;
export declare const startAnalyticsWorker: () => Worker<ClickJobData, void, string>;
