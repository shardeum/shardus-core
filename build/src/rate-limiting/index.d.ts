export = RateLimiting;
declare class RateLimiting {
    constructor(config: any, loadDetection: any);
    loadDetection: any;
    limitRate: any;
    loadLimit: any;
    isOverloaded(): boolean;
}
