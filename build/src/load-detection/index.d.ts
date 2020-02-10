export = LoadDetection;
declare class LoadDetection {
    constructor(config: any, statistics: any);
    highThreshold: any;
    lowThreshold: any;
    desiredTxTime: any;
    queueLimit: any;
    statistics: any;
    load: number;
    /**
     * Returns a number between 0 and 1 indicating the current load.
     */
    updateLoad(): void;
    getCurrentLoad(): number;
}
