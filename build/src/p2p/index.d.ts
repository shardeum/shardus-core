export = P2P;
declare class P2P {
    constructor(config: any, logger: any, storage: any, crypto: any);
    logger: any;
    mainLogger: any;
    fatalLogger: any;
    storage: any;
    crypto: any;
    network: any;
    ipInfo: any;
    id: any;
    ipServer: any;
    timeServers: any;
    existingArchivers: any;
    syncLimit: any;
    maxRejoinTime: any;
    difficulty: any;
    queryDelay: any;
    minNodesToAllowTxs: any;
    seedNodes: any[] | null;
    isFirstSeed: boolean;
    acceptInternal: boolean;
    scalingRequested: boolean;
    gossipHandlers: {};
    gossipRecipients: any;
    gossipTimeout: number;
    gossipedHashes: Map<any, any>;
    gossipedHashesSent: Map<any, any>;
    joinRequestToggle: boolean;
    verboseLogs: boolean;
    state: import("./p2p-state");
    lostNodes: import("./p2p-lost-nodes");
    archivers: import("./p2p-archivers");
    InternalRecvCounter: number;
    keyCounter: number;
    init(network: any): Promise<void>;
    _registerRoutes(): void;
    _verifyExternalInfo(ipInfo: any): boolean;
    _verifyInternalInfo(ipInfo: any): boolean;
    _discoverIp(ipServer: any): Promise<any>;
    _checkWithinSyncLimit(time1: any, time2: any): boolean;
    _checkTimeSynced(timeServers: any): Promise<boolean>;
    _getSeedListSigned(): Promise<any>;
    _getSeedNodes(): Promise<any>;
    _fetchSeedNodeInfo(seedNode: any): Promise<any>;
    _fetchSeedNodesInfo(seedNodes: any): Promise<any[]>;
    _setNodeId(id: any, updateDb?: boolean): Promise<void>;
    getNodeId(): any;
    getCycleMarker(): any;
    getIpInfo(): any;
    getPublicNodeInfo(): any;
    getCycleMarkerInfo(): {
        currentCycleMarker: any;
        nextCycleMarker: any;
        cycleCounter: any;
        cycleStart: any;
        cycleDuration: any;
        nodesJoined: any;
        currentTime: number;
    };
    getLatestCycles(amount: any): any[];
    getCycleChain(start: any, end: any): any[] | null;
    getCycleMarkerCerts(start: any, end: any): any[] | null;
    getCycleChainHash(start: any, end: any): any;
    _getThisNodeInfo(): {
        publicKey: any;
        externalIp: any;
        externalPort: any;
        internalIp: any;
        internalPort: any;
        address: any;
        joinRequestTimestamp: number;
        activeTimestamp: number;
    };
    _ensureIpKnown(): Promise<void>;
    _checkIfNeedJoin(): Promise<boolean>;
    _getNonSeedNodes(seedNodes?: any[]): any;
    getNodelistHash(): any;
    _submitJoin(nodes: any, joinRequest: any): Promise<void>;
    _isInUpdatePhase(currentTime?: number, cycleStart?: any, cycleDuration?: any): boolean;
    _isInLastPhase(currentTime: any, cycleStart: any, cycleDuration: any): boolean;
    _waitUntilUpdatePhase(currentTime?: number, cycleStart?: any, cycleDuration?: any): Promise<void>;
    _waitUntilSecondPhase(currentTime: any, cycleStart: any, cycleDuration: any): Promise<void>;
    _waitUntilThirdPhase(currentTime: any, cycleStart: any, cycleDuration: any): Promise<void>;
    _waitUntilLastPhase(currentTime?: number, cycleStart?: any, cycleDuration?: any): Promise<void>;
    _waitUntilEndOfCycle(currentTime?: number, cycleStart?: any, cycleDuration?: any): Promise<void>;
    _submitWhenUpdatePhase(route: any, message: any): Promise<void>;
    _attemptJoin(seedNodes: any, joinRequest: any, timeOffset: any, cycleStart: any, cycleDuration: any): Promise<any>;
    _join(seedNodes: any): Promise<any>;
    _checkIfFirstSeedNode(seedNodes: any): boolean;
    _createJoinRequest(cycleMarker: any): Promise<any>;
    _createApoptosisMessage(): any;
    initApoptosis(): Promise<void>;
    isActive(): boolean;
    robustQuery(nodes?: any[], queryFn: any, equalityFn: any, redundancy?: number, shuffleNodes?: boolean): Promise<any[]>;
    _sequentialQuery(nodes: any, queryFn: any, verifyFn: any): Promise<any>;
    _verifyNodelist(nodelist: any, nodelistHash: any): boolean;
    _verifyCycleChain(cycleChain: any, cycleChainHash: any): boolean;
    _fetchNodelistHash(nodes: any): Promise<any>;
    _fetchVerifiedNodelist(nodes: any, nodelistHash: any): Promise<any>;
    _isSameCycleMarkerInfo(info1: any, info2: any): boolean;
    _fetchCycleMarker(nodes: any): Promise<any>;
    _fetchNodeId(seedNodes: any): Promise<any>;
    _fetchCycleMarkerInternal(nodes: any): Promise<any>;
    _fetchCycleChainHash(nodes: any, start: any, end: any): Promise<any>;
    _fetchVerifiedCycleChain(nodes: any, cycleChainHash: any, start: any, end: any): Promise<any>;
    _fetchLatestCycleChain(seedNodes: any, nodes: any): Promise<any>;
    _fetchUnfinalizedCycle(nodes: any): Promise<any>;
    _fetchNodeByPublicKey(nodes: any, publicKey: any): Promise<any>;
    _fetchFinalizedChain(seedNodes: any, nodes: any, chainStart: any, chainEnd: any): Promise<any>;
    _syncUpChainAndNodelist(): any;
    _requestCycleUpdates(nodeId: any): Promise<any>;
    _requestUpdatesAndAdd(nodeId: any): Promise<void>;
    requestUpdatesFromRandom(): Promise<void>;
    _validateJoinRequest(joinRequest: any): boolean;
    addJoinRequest(joinRequest: any, tracker: any, fromExternal?: boolean): Promise<boolean>;
    _discoverNetwork(seedNodes: any): Promise<boolean>;
    _joinNetwork(seedNodes: any): Promise<boolean>;
    _syncToNetwork(seedNodes: any): Promise<boolean>;
    _createStatusUpdate(type: any): any;
    _submitStatusUpdate(type: any): Promise<void>;
    goActive(): Promise<boolean>;
    _constructScalingRequest(upOrDown: any): any;
    _requestNetworkScaling(upOrDown: any): Promise<void>;
    requestNetworkUpsize(): Promise<void>;
    requestNetworkDownsize(): Promise<void>;
    allowTransactions(): boolean;
    allowSet(): boolean;
    _findNodeInGroup(nodeId: any, group: any): any;
    _authenticateByNode(message: any, node: any): any;
    _extractPayload(wrappedPayload: any, nodeGroup: any): any[];
    _wrapAndTagMessage(msg: any, tracker?: string, recipientNode: any): any;
    createMsgTracker(): string;
    createGossipTracker(): string;
    tell(nodes: any, route: any, message: any, logged?: boolean, tracker?: string): Promise<void>;
    ask(node: any, route: any, message?: {}, logged?: boolean, tracker?: string): Promise<any>;
    registerInternal(route: any, handler: any): void;
    unregisterInternal(route: any): void;
    /**
     * Send Gossip to all nodes
     */
    sendGossip(type: any, payload: any, tracker?: string, sender?: any, nodes?: any[]): Promise<void>;
    /**
     * Send Gossip to all nodes, using gossip in
     */
    sendGossipIn(type: any, payload: any, tracker?: string, sender?: any, nodes?: any[]): Promise<void>;
    /**
     * Send Gossip to all nodes in this list, special case broadcast, never use this for regular gossip.
     */
    sendGossipAll(type: any, payload: any, tracker?: string, sender?: any, nodes?: any[]): Promise<void>;
    /**
   * Handle Goosip Transactions
   * Payload: {type: ['receipt', 'trustedTransaction'], data: {}}
   */
    handleGossip(payload: any, sender: any, tracker?: string): Promise<void>;
    /**
   * Callback for handling gossip.
   *
   * @callback handleGossipCallback
   * @param {any} data the data response of the callback
   * @param {Node} sender
   * @param {string} tracker the tracking string
   */
    /**
     * @param {string} type
     * @param {handleGossipCallback} handler
     */
    registerGossipHandler(type: string, handler: (data: any, sender: any, tracker: string) => any): void;
    unregisterGossipHandler(type: any): void;
    startup(): Promise<boolean>;
    cleanupSync(): void;
    restart(): Promise<void>;
    _reportLostNode(node: any): Promise<boolean>;
    setJoinRequestToggle(bool: any): void;
}
