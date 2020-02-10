/// <reference types="node" />
export = Statistics;
declare class Statistics {
    constructor(baseDir: any, config: any, { counters, watchers, timers }: {
        counters?: any[] | undefined;
        watchers?: {} | undefined;
        timers?: any[] | undefined;
    }, context: any);
    intervalDuration: any;
    context: any;
    counterDefs: any[];
    watcherDefs: {};
    timerDefs: any[];
    interval: NodeJS.Timeout | null;
    snapshotWriteFns: any[];
    stream: import("stream").Readable | null;
    streamIsPushable: boolean;
    initialize(): void;
    counters: {} | undefined;
    watchers: {} | undefined;
    timers: {} | undefined;
    getStream(): import("stream").Readable;
    writeOnSnapshot(writeFn: any, context: any): void;
    startSnapshots(): void;
    stopSnapshots(): void;
    incrementCounter(counterName: any): void;
    getCurrentCount(counterName: any): any;
    getCounterTotal(counterName: any): any;
    getWatcherValue(watcherName: any): any;
    startTimer(timerName: any, id: any): void;
    stopTimer(timerName: any, id: any): void;
    getAverage(name: any): any;
    getPreviousElement(name: any): any;
    _initializeCounters(counterDefs?: any[]): {};
    _initializeWatchers(watcherDefs?: {}, context: any): {};
    _initializeTimers(timerDefs?: any[]): {};
    _takeSnapshot(): void;
    _pushToStream(data: any): void;
}
