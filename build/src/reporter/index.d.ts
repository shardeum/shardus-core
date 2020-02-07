export = Reporter;
/**
   * @typedef {import('../state-manager/index').CycleShardData} CycleShardData
   */
declare class Reporter {
    constructor(config: any, logger: any, p2p: any, statistics: any, stateManager: any, profiler: any, loadDetection: any);
    config: any;
    mainLogger: any;
    p2p: any;
    statistics: any;
    stateManager: any;
    profiler: any;
    loadDetection: any;
    logger: any;
    reportTimer: NodeJS.Timeout | null;
    lastTime: number;
    doConsoleReport: boolean;
    hasRecipient: boolean;
    _calculateAverageTps(txs: any): number;
    reportJoining(publicKey: any): Promise<void>;
    reportJoined(nodeId: any, publicKey: any): Promise<void>;
    reportActive(nodeId: any): Promise<void>;
    reportRemoved(nodeId: any): Promise<void>;
    _sendReport(data: any): Promise<void>;
    startReporting(): void;
    consoleReport(): void;
    stopReporting(): void;
}
declare namespace Reporter {
    export { CycleShardData };
}
type CycleShardData = {
    shardGlobals: import("../state-manager/shardFunctions").ShardGlobals;
    cycleNumber: number;
    ourNode: any;
    /**
     * our node's node shard data
     */
    nodeShardData: import("../state-manager/shardFunctions").NodeShardData;
    nodeShardDataMap: Map<string, import("../state-manager/shardFunctions").NodeShardData>;
    parititionShardDataMap: Map<number, import("../state-manager/shardFunctions").ShardInfo>;
    activeNodes: any[];
    syncingNeighbors: any[];
    syncingNeighborsTxGroup: any[];
    hasSyncingNeighbors: boolean;
    /**
     * hashlist index of the voters for this vote
     */
    voters: number[];
    /**
     * list of partitions that we do consensus on
     */
    ourConsensusPartitions?: number[];
    /**
     * list of stored parititions
     */
    ourStoredPartitions?: number[];
};
