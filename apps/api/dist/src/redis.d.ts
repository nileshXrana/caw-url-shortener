export interface CachedLink {
    id: string;
    longUrl: string;
}
export declare const cacheService: {
    getRedirectTarget: (code: string) => Promise<CachedLink | null>;
    setRedirectTarget: (code: string, link: CachedLink, ttlSeconds?: number) => Promise<void>;
    invalidateRedirectTarget: (code: string) => Promise<void>;
};
