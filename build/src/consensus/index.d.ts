export = Consensus;
declare class Consensus {
    constructor(app: any, config: any, logger: any, crypto: any, p2p: any, storage: any, profiler: any);
    profiler: any;
    app: any;
    config: any;
    logger: any;
    mainLogger: any;
    fatalLogger: any;
    crypto: any;
    p2p: any;
    storage: any;
    pendingTransactions: {};
    mainLogs: boolean;
    lastServed: number;
    inject(shardusTransaction: any): Promise<{
        stateId: any;
        targetStateId: any;
        txHash: any;
        time: number;
    }>;
    createReceipt(tx: any, state: any, targetStateId: any): {
        stateId: any;
        targetStateId: any;
        txHash: any;
        time: number;
    };
}
