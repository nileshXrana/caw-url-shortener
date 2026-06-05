export declare function retryWithBackoff<T>(fn: () => Promise<T>, retries?: number, baseDelay?: number): Promise<T>;
export declare function executeResilientDb<T>(queryFn: () => Promise<T>): Promise<T>;
