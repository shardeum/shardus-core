export = Shardus;
declare class Shardus {
    constructor({ server: config, logs: logsConfig, storage: storageConfig }: {
        server: any;
        logs: any;
        storage: any;
    });
    profiler: import("../utils/profiler");
    config: any;
    verboseLogs: boolean;
    logger: import("../logger");
    mainLogger: import("log4js").Logger;
    fatalLogger: import("log4js").Logger;
    appLogger: import("log4js").Logger;
    exitHandler: import("../exit-handler");
    storage: import("../storage");
    crypto: import("../crypto") | null;
    network: import("../network");
    p2p: import("../p2p") | null;
    debug: import("../debug") | null;
    consensus: import("../consensus") | null;
    appProvided: boolean | null;
    app: any;
    reporter: import("../reporter") | null;
    stateManager: any;
    statistics: import("../statistics") | null;
    loadDetection: import("../load-detection") | null;
    rateLimiting: import("../rate-limiting") | null;
    _listeners: {};
    heartbeatInterval: any;
    heartbeatTimer: NodeJS.Timeout | null;
    registerExternalGet: (route: any, handler: any) => void;
    registerExternalPost: (route: any, handler: any) => void;
    registerExternalPut: (route: any, handler: any) => void;
    registerExternalDelete: (route: any, handler: any) => void;
    registerExternalPatch: (route: any, handler: any) => void;
    /**
     * @typedef {import('./index').App} App
     */
    setup(app: any): Shardus;
    start(exitProcOnFail?: boolean): Promise<void>;
    _registerListener(emitter: any, event: any, callback: any): void;
    _unregisterListener(event: any): void;
    _cleanupListeners(): void;
    _attemptCreateAppliedListener(): void;
    _attemptRemoveAppliedListener(): void;
    _unlinkStateManager(): void;
    _createAndLinkStateManager(): void;
    syncAppData(): Promise<void>;
    set(tx: any): {
        success: boolean;
        reason: string;
    };
    log(...data: any[]): void;
    /**
     * Submit a transaction into the network
     * Returns an object that tells whether a tx was successful or not and the reason why.
     * Throws an error if an application was not provided to shardus.
     *
     * {
     *   success: boolean,
     *   reason: string
     * }
     *
     */
    put(tx: any, set?: boolean): {
        success: boolean;
        reason: string;
    };
    getNodeId(): any;
    getNode(id: any): any;
    getLatestCycles(amount?: number): any[];
    /**
   * @typedef {import('../shardus/index').Node} Node
   */
    /**
     * getClosestNodes finds the closes nodes to a certain hash value
     * @param {string} hash any hash address (256bit 64 characters)
     * @param {number} count how many nodes to return
     * @returns {string[]} returns a list of nodes ids that are closest. roughly in order of closeness
     */
    getClosestNodes(hash: string, count?: number): string[];
    getClosestNodesGlobal(hash: any, count: any): any;
    /**
     * isNodeInDistance
     * @param {string} hash any hash address (256bit 64 characters)
     * @param {string} nodeId id of a node
     * @param {number} distance how far away can this node be to the home node of the hash
     * @returns {boolean} is the node in the distance to the target
     */
    isNodeInDistance(hash: string, nodeId: string, distance: number): boolean;
    createApplyResponse(txId: any, txTimestamp: any): {
        stateTableResults: never[];
        txId: any;
        txTimestamp: any;
        accountData: never[];
    };
    applyResponseAddState(resultObject: any, accountData: any, localCache: any, accountId: any, txId: any, txTimestamp: any, stateBefore: any, stateAfter: any, accountCreated: any): void;
    resetAppRelatedState(): Promise<void>;
    getLocalOrRemoteAccount(address: any): Promise<any>;
    getRemoteAccount(address: any): Promise<any>;
    createWrappedResponse(accountId: any, accountCreated: any, hash: any, timestamp: any, fullData: any): {
        accountId: any;
        accountCreated: any;
        isPartial: boolean;
        stateId: any;
        timestamp: any;
        data: any;
    };
    setPartialData(response: any, partialData: any, userTag: any): void;
    genericApplyPartialUpate(fullObject: any, updatedPartialObject: any): void;
    isActive(): boolean;
    shutdown(exitProcess?: boolean): Promise<void>;
    /**
     * @param {App} application
     * @returns {App}
     */
    _getApplicationInterface(application: any): any;
    _registerRoutes(): void;
    registerExceptionHandler(): void;
    _writeHeartbeat(): Promise<void>;
    _setupHeartbeat(): void;
    _stopHeartbeat(): void;
    _isTransactionTimestampExpired(timestamp: any): boolean;
}
