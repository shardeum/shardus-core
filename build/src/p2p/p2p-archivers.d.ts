export = P2PArchivers;
declare class P2PArchivers {
    constructor(logger: any, p2p: any, state: any, crypto: any);
    mainLogger: any;
    p2p: any;
    state: any;
    crypto: any;
    joinRequests: any[];
    archiversList: any[];
    dataRecipients: any[];
    recipientTypes: {};
    logDebug(msg: any): void;
    logError(msg: any): void;
    reset(): void;
    resetJoinRequests(): void;
    addJoinRequest(joinRequest: any, tracker: any, gossip?: boolean): Promise<boolean>;
    getArchiverUpdates(): any[];
    updateArchivers(joinedArchivers: any): void;
    addDataRecipient(nodeInfo: any, dataRequest: any): void;
    removeDataRecipient(publicKey: any): void;
    sendData(cycle: any): void;
    sendPartitionData(partitionReceipt: any, paritionObject: any): void;
    sendTransactionData(partitionNumber: any, cycleNumber: any, transactions: any): void;
    registerRoutes(): void;
}
