export = P2PState;
/**
 * @typedef {import('../shardus/index').Node} Node
 */
declare class P2PState {
    constructor(config: any, logger: any, storage: any, p2p: any, crypto: any);
    mainLogger: any;
    p2p: any;
    crypto: any;
    storage: any;
    defaultCycleDuration: any;
    maxNodesPerCycle: any;
    maxSeedNodes: any;
    desiredNodes: any;
    nodeExpiryAge: any;
    maxNodesToRotate: any;
    maxPercentOfDelta: any;
    scaleReqsNeeded: any;
    maxScaleReqs: any;
    amountToScale: any;
    minNodes: any;
    maxNodes: any;
    seedNodeOffset: any;
    cycles: any[];
    certificates: any[];
    acceptChainUpdates: boolean;
    acceptJoinRequests: boolean;
    unfinalizedReady: boolean;
    cyclesStarted: boolean;
    shouldStop: boolean;
    validStatuses: string[];
    statusUpdateType: {
        'active': string;
    };
    cleanNodelist: {
        ordered: never[];
        addressOrdered: never[];
        current: {};
        byIp: {};
        byPubKey: {};
    };
    cleanCycle: {
        metadata: {
            bestCertDist: null;
            updateSeen: {};
            receivedCerts: boolean;
            toAccept: number;
            scalingSeen: {};
            apopSeen: {};
            lostSeen: {
                up: {};
                down: {};
            };
            startingDesired: number;
            scaling: boolean;
        };
        updates: {
            bestJoinRequests: never[];
            archiverJoinRequests: never[];
            active: never[];
            scaling: {
                up: never[];
                down: never[];
            };
            apoptosis: never[];
            lost: {
                up: never[];
                down: never[];
            };
        };
        data: {
            start: null;
            duration: null;
            counter: null;
            previous: null;
            joined: never[];
            joinedArchivers: never[];
            joinedConsensors: never[];
            removed: never[];
            lost: never[];
            refuted: never[];
            apoptosized: never[];
            returned: never[];
            activated: never[];
            activatedPublicKeys: never[];
            certificate: {};
            expired: number;
            desired: number;
        };
    };
    nodes: any;
    currentCycle: any;
    lostNodes: any;
    init(): Promise<void>;
    initLost(p2plostnodes: any): void;
    _resetNodelist(): void;
    _resetCycles(): void;
    _resetControlVars(): void;
    _resetState(): void;
    clear(): Promise<void>;
    _addJoinRequest(joinRequest: any): boolean;
    addNewJoinRequest(joinRequest: any): boolean;
    addExtScalingRequest(scalingRequest: any): Promise<boolean | undefined>;
    validateScalingRequest(scalingRequest: any): boolean;
    _checkScaling(): Promise<void>;
    _addToScalingRequests(scalingRequest: any): Promise<boolean>;
    _addScalingRequest(scalingRequest: any): Promise<boolean | undefined>;
    addGossipedJoinRequest(joinRequest: any): boolean;
    _addJoiningNodes(): void;
    isDuringThisCycle(timestamp: any): boolean;
    computeNodeId(publicKey: any, cycleMarker: any): any;
    getNodeStatus(nodeId: any): any;
    _wasSeenThisCycle(key: any): boolean;
    _markNodeAsSeen(key: any): void;
    addStatusUpdate(update: any): boolean;
    addCycleUpdates(updates: any): Promise<boolean>;
    addApoptosisMessage(msg: any): boolean;
    addExtApoptosisMessage(msg: any): boolean;
    addLostMessage(msg: any, validate?: boolean): boolean;
    addArchiverUpdate(joinRequest: any): void;
    _setNodeStatus(nodeId: any, status: any): Promise<boolean>;
    _setNodesToStatus(nodeIds: any, status: any): Promise<void>;
    _setNodesActiveTimestamp(nodeIds: any, timestamp: any): Promise<void>;
    directStatusUpdate(nodeId: any, status: any, updateDb?: boolean): Promise<boolean>;
    _updateNodeStatus(node: any, status: any, updateDb?: boolean): Promise<boolean>;
    _acceptNode(node: any, cycleMarker: any): Promise<void>;
    _acceptNodes(nodes: any, cycleMarker: any): Promise<void>;
    _getNodeOrderedIndex(node: any): number | false;
    /**
     * _getNodeAddressOrderedIndex
     * @param {Node} node
     * @returns {number|boolean} tricky because binary search can also return false
     */
    _getNodeAddressOrderedIndex(node: any): number | boolean;
    _getExpiredCountInternal(): number;
    getNodesNeeded(): number;
    _setJoinAcceptance(): void;
    _getOpenSlots(): number;
    _markNodesForRemoval(n: any): void;
    _removeExcessNodes(): void;
    _removeNodeFromNodelist(node: any): void;
    /**
     * @param {import("../shardus").Node} node
     */
    getOrderedSyncingNeighbors(node: any): any[];
    _removeNodesFromNodelist(nodes: any): void;
    removeNode(node: any): Promise<void>;
    removeNodes(nodes: any): Promise<void>;
    _addNodeToNodelist(node: any): void;
    _addNodesToNodelist(nodes: any): void;
    addNode(node: any): Promise<void>;
    addNodes(nodes: any): Promise<void>;
    _computeCycleMarker(fields: any): any;
    _resetCurrentCycle(): void;
    startCycles(): void;
    stopCycles(): void;
    _startNewCycle(): void;
    _startUpdatePhase(startTime: any, phaseLen: any): void;
    _getBestJoinRequests(): any;
    _isKnownNode(node: any): boolean;
    _isBetterThanLowestBest(request: any, lowest: any): boolean;
    _addToBestJoinRequests(joinRequest: any): boolean;
    _getBestNodes(): any[];
    _endUpdatePhase(startTime: any, phaseLen: any): void;
    _startCycleSync(startTime: any, phaseLen: any): Promise<void>;
    _finalizeCycle(startTime: any, phaseLen: any): Promise<void>;
    _createCycleMarker(gossip?: boolean): (string | boolean)[] | undefined;
    addUnfinalizedAndStart(cycle: any): Promise<false | undefined>;
    addCycle(cycle: any, certificate?: any, updateDb?: boolean): Promise<void>;
    addCycles(cycles: any, certificates?: any, updateDb?: boolean): Promise<void>;
    _createCycle(): Promise<void>;
    getCycleInfo(withCert?: boolean): {
        previous: any;
        counter: any;
        start: any;
        duration: any;
        active: number;
        desired: any;
        joined: any;
        joinedArchivers: any;
        joinedConsensors: any;
        removed: any;
        lost: any;
        refuted: any;
        apoptosized: any;
        returned: any;
        activated: any;
        activatedPublicKeys: any;
        expired: any;
    };
    _createCertificate(cycleMarker: any): any;
    addCertificate(certificate: any, fromNetwork?: boolean): (string | boolean)[];
    getCycles(start?: number, end?: number): any[];
    getCertificates(start?: number, end?: number): any[];
    getCurrentCertificate(): any;
    getActiveCount(): number;
    getDesiredCount(): any;
    getNextDesiredCount(): any;
    getExpiredCount(): any;
    getLastCycles(amount: any): any[];
    getJoined(): any;
    getJoinedArchivers(): any;
    getJoinedConsensors(): any;
    getRemoved(): any;
    getApoptosized(): any;
    getLost(): any;
    getRefuted(): any;
    getReturned(): any;
    getActivated(): any;
    getActivatedPublicKeys(): any;
    getLastCycle(): any;
    getCycleByTimestamp(timestamp: any): any;
    getCycleByCounter(counter: any): any;
    getCycleCounter(): any;
    getLastCycleStart(): any;
    getLastCycleCounter(): any;
    getCurrentCycleStart(): any;
    getLastCycleDuration(): any;
    getCurrentCycleDuration(): any;
    getCurrentCycleMarker(): any;
    getPreviousCycleMarker(): any;
    getNextCycleMarker(): any;
    getLastJoined(): any;
    _areEquivalentNodes(node1: any, node2: any): boolean;
    getNode(id: any): any;
    getNodeByPubKey(publicKey: any): any;
    _getSubsetOfNodelist(nodes: any, self?: any): any[];
    getAllNodes(self: any): any[];
    getActiveNodes(self: any): any[];
    getNodesOrdered(): any;
    _getRemovedNodes(): any[];
    _getApoptosizedNodes(): any[];
    _getLostNodes(): any[];
    _getRefutedNodes(): any[];
    getSeedNodes(forSeedList?: boolean): any;
    getRandomActiveNode(): any;
}
declare namespace P2PState {
    export { Node };
}
type Node = any;
