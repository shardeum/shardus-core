export = StateManager;
/**
   * @typedef {Object} SimpleRange A simple address range
   * @property {string} low Starting index
   * @property {string} high End index
   */
/**
   * @typedef {import('../shardus/index').App} App
   */
/**
   * @typedef {import('../shardus/index').Cycle} Cycle
   */
/**
   * @typedef {import('../shardus/index').Sign} Sign
   */
/**
 * @typedef {import('../shardus/index').Node} Node
 */
/**
   * @typedef {import('../shardus/index').AcceptedTx} AcceptedTx
   */
/**
   * @typedef {import('../shardus/index').ApplyResponse} ApplyResponse
   */
/**
   * @typedef {import('./shardFunctions.js').ShardGlobals} ShardGlobals
   */
/**
   * @typedef {import('./shardFunctions.js').NodeShardData} NodeShardData
   */
/**
   * @typedef {import('./shardFunctions.js').ShardInfo} ShardInfo
   */
/**
   * @typedef {import('./shardFunctions.js').AddressRange} AddressRange
   */
/**
   * @typedef {import('./shardFunctions.js').BasicAddressRange} BasicAddressRange
   */
/**
   * @typedef {Object} PartitionObject a partition object
   * @property {number} Partition_id
   * @property {number} Partitions
   * @property {number} Cycle_number
   * @property {string} Cycle_marker
   * @property {string[]} Txids
   * @property {number[]} Status
   * @property {string[]} States
   * @property {any[]} Chain todo more specific data type
   */
/**
   * @typedef {Object} PartitionResult a partition result
   * @property {number} Partition_id
   * @property {string} Partition_hash
   * @property {number} Cycle_number
   * @property {string} hashSet
   * @property {Sign} [sign]
   * // property {any} \[hashSetList\] this seems to be used as debug. considering commenting it out in solveHashSetsPrep for safety.
   */
/**
   * @typedef {Object} PartitionReceipt a partition reciept
   * @property {PartitionResult[]} resultsList
   * @property {Sign} [sign]
   */
/**
   * @typedef {Object} CombinedPartitionReceipt a partition reciept that contains one copy of of the data and all of the signatures for that data
   * @property {PartitionResult} result with signatures moved to a list
   * @property {Sign[]} signatures
   */
/**
   * @typedef {Object} RepairTracker a partition object
   * @property {string[]} triedHashes
   * @property {number} numNodes
   * @property {number} counter cycle number for the repair obbject
   * @property {number} partitionId partition id for the repair object
   * @property {string} key this key is based on the cycle counter in the form c###  where ### is the cycle number (can be as many digits as needed)
   * @property {string} key2 this key is based on the partition in the form p## where ## is the partition number (can be as many digits as needed)
   * @property {string[]} removedTXIds
   * @property {string[]} repairedTXs
   * @property {AcceptedTx[]} newPendingTXs
   * @property {AcceptedTx[]} newFailedTXs
   * @property {string[]} extraTXIds
   * @property {string[]} missingTXIds
   * @property {boolean} repairing
   * @property {boolean} repairsNeeded
   * @property {boolean} busy
   * @property {boolean} txRepairReady we have the TXs and TX data we need to apply data repairs
   * @property {boolean} txRepairComplete
   * @property {boolean} evaluationStarted
   * @property {boolean} evaluationComplete not sure if we really need this
   * @property {boolean} awaitWinningHash
   * @property {boolean} repairsFullyComplete
   * @property {SolutionDelta[]} [solutionDeltas]
   * @property {string} [outputHashSet]
   */
/**
 * @typedef {Object} SolutionDelta an object to hold a temp tx record for processing later
 * @property {number} i index into our request list: requestsByHost.requests
 * @property {AcceptedTx} tx
 * @property {boolean} pf
 * @property {string} state a string snipped from our solution hash set
 */
/**
 * @typedef {Object} TempTxRecord an object to hold a temp tx record for processing later
 * @property {number} txTS
 * @property {AcceptedTx} acceptedTx
 * @property {boolean} passed
 * @property {ApplyResponse} applyResponse
 * @property {number} redacted below 0 for not redacted. a value above zero indicates the cycle this was redacted
 */
/**
 * @typedef {Object} UpdateRepairData   newTXList, allAccountsToResetById, partitionId
 * @property {AcceptedTx[]} newTXList
 * @property {Object.<string, number>} allAccountsToResetById
 * @property {number} partitionId
 * @property {Object.<string, { sourceKeys:string[], targetKeys:string[] } >} txIDToAcc
 */
/**
 * @typedef {Object} TxTallyList an object that tracks our TXs that we are storing for later.
 * @property {string[]} hashes
 * @property {number[]} passed AcceptedTx?
 * @property {any[]} txs
 * @property {boolean} processed
 * @property {any[]} states below 0 for not redacted. a value above zero indicates the cycle this was redacted
 * @property {any} [newTxList] this gets added on when we are reparing something newTxList seems to have a different format than existing types.
 */
/**
 * @typedef {Object} QueueEntry
 * @property {AcceptedTx} acceptedTx
 * @property {any} txKeys
 * @property {any} collectedData
 * @property {any} originalData
 * @property {any} homeNodes
 * @property {boolean} hasShardInfo
 * @property {string} state
 * @property {number} dataCollected
 * @property {boolean} hasAll
 * @property {number} entryID based on the incrementing queueEntryCounter
 * @property {Object.<string,boolean>} localKeys
 * @property {any} localCachedData
 * @property {number} syncCounter
 * @property {boolean} didSync
 * @property {any[]} syncKeys
 * @property {any} [uniqueKeys]
 * @property {boolean} [ourNodeInvolved]
 * @property {Node[]} [transactionGroup]
 */
/**
 * @typedef {Object} SyncTracker
 * @property {boolean} syncStarted
 * @property {boolean} syncFinished
 * @property {any} range
 * @property {number} cycle
 * @property {number} index
 * @property {QueueEntry[]} queueEntries
 */
/**
   * @typedef {Object} GenericHashSetEntry some generic data that represents a vote for hash set comparison
   * @property {string} hash
   * @property {number} votePower
   * @property {string} hashSet
   * @property {string} lastValue
   * @property {HashSetEntryError[]} errorStack
   * @property {HashSetEntryCorrection[]} corrections
   * @property {number} indexOffset
   *  {string[]} owners a list of owner addresses that have this solution
   *  {boolean} ourRow
   * @property {number} waitForIndex
   * @property {boolean} [waitedForThis]
   * @property {number[]} [indexMap] this gets added when you call expandIndexMapping. index map is our index to the solution output
   * @property {number[]} [extraMap] this gets added when you call expandIndexMapping. extra map is the index in our list that is an extra
   * @property {number} [futureIndex]
   * @property {string} [futureValue]
   * @property {number} [pinIdx] current Pin index of this entry.. modified by solver.
   * @property {any} [pinObj] the object/vote we are pinned to.  todo make this a type!!
   * @property {object[]} [ownVotes]
   */
/**
   * @typedef {Object} IHashSetEntryPartitions extends GenericHashSetEntry some generic data that represents a vote for hash set comparison
   * @property {string[]} owners a list of owner addresses that have this solution
   * @property {boolean} [ourRow]
   * @property {boolean} [outRow]
   */
/**
 * @typedef {GenericHashSetEntry & IHashSetEntryPartitions} HashSetEntryPartitions
 */
/**
   * @typedef {Object} HashSetEntryCorrection some generic data that represents a vote for hash set comparison
   * @property {number} i index
   * @property {Vote} tv top vote index
   * @property {string} v top vote value
   * @property {string} t type 'insert', 'extra'
   * @property {string} bv last value
   * @property {number} if lat output count?
   * @property {number} [hi] another index.
   * @property {HashSetEntryCorrection} [c] reference to the correction that this one is replacing/overriding
   */
/**
   * @typedef {Object} HashSetEntryError some generic data that represents a vote for hash set comparison
   * @property {number} i index
   * @property {Vote} tv top vote index
   * @property {string} v top vote value
   */
/**
   * @typedef {Object} Vote vote for a value
   * @property {string} v vote value
   * @property {number} count number of votes
   * @property {CountEntry} [vote] reference to another vote object
   * @property {number} [ec] count based on vote power
   * @property {number[]} [voters] hashlist index of the voters for this vote
   */
/**
   * @typedef {Object} CountEntry vote count tracking
   * @property {number} count number of votes
   * @property {number} ec count based on vote power
   * @property {number[]} voters hashlist index of the voters for this vote
   */
/**
   * @typedef {Object} CycleShardData
   * @property {ShardGlobals} shardGlobals
   * @property {number} cycleNumber
   * @property {Node} ourNode
   * @property {NodeShardData} nodeShardData our node's node shard data
   * @property {Map<string, NodeShardData>} nodeShardDataMap
   * @property {Map<number, ShardInfo>} parititionShardDataMap
   * @property {Node[]} activeNodes
   * @property {Node[]} syncingNeighbors
   * @property {Node[]} syncingNeighborsTxGroup
   * @property {boolean} hasSyncingNeighbors
   * @property {number[]} voters hashlist index of the voters for this vote
   * @property {number[]} [ourConsensusPartitions] list of partitions that we do consensus on
   * @property {number[]} [ourStoredPartitions] list of stored parititions
   */
/**
 * StateManager
 */
declare class StateManager {
    /**
     * @param {boolean} verboseLogs
     * @param {import("../shardus").App} app
     * @param {import("../consensus")} consensus
     * @param {import("../p2p")} p2p
     * @param {import("../crypto")} crypto
     * @param {any} config
     */
    constructor(verboseLogs: boolean, profiler: any, app: any, consensus: import("../consensus"), logger: any, storage: any, p2p: import("../p2p"), crypto: import("../crypto"), config: any);
    verboseLogs: boolean;
    profiler: any;
    mainLogger: any;
    fatalLogger: any;
    p2p: import("../p2p");
    crypto: import("../crypto");
    storage: any;
    /**
     * @type {App}
     */
    app: App;
    consensus: import("../consensus");
    logger: any;
    shardLogger: any;
    config: any;
    _listeners: {};
    completedPartitions: any[];
    mainStartingTs: number;
    queueSitTime: number;
    syncSettleTime: number;
    newAcceptedTxQueue: any[];
    newAcceptedTxQueueTempInjest: any[];
    archivedQueueEntries: any[];
    newAcceptedTxQueueRunning: boolean;
    dataSyncMainPhaseComplete: boolean;
    queueEntryCounter: number;
    queueRestartCounter: number;
    lastSeenAccountsMap: {} | null | undefined;
    /** @type {SyncTracker[]} */
    syncTrackers: SyncTracker[];
    runtimeSyncTrackerSyncing: boolean;
    acceptedTXQueue: any;
    acceptedTXByHash: {};
    isSyncingAcceptedTxs: boolean;
    dataPhaseTag: string;
    applySoftLock: boolean;
    useHashSets: boolean;
    lastActiveNodeCount: number;
    queueStopped: boolean;
    extendedRepairLogging: boolean;
    shardInfo: {};
    /** @type {Map<number, CycleShardData>} */
    shardValuesByCycle: Map<number, CycleShardData>;
    /** @type {CycleShardData} */
    currentCycleShardData: CycleShardData;
    syncTrackerIndex: number;
    preTXQueue: any[];
    readyforTXs: boolean;
    sleepInterrupt: any;
    lastCycleReported: number;
    partitionReportDirty: boolean;
    nextCycleReportToSend: {
        res: never[];
        cycleNumber: any;
    } | null;
    canDataRepair: any;
    stateIsGood: boolean;
    resetAndApplyPerPartition: boolean;
    /** @type {RepairTracker[]} */
    dataRepairStack: RepairTracker[];
    /** @type {number} */
    dataRepairsCompleted: number;
    /** @type {number} */
    dataRepairsStarted: number;
    repairAllStoredPartitions: boolean;
    repairStartedMap: Map<any, any>;
    repairCompletedMap: Map<any, any>;
    /** @type {Object.<string, PartitionReceipt[]>} a map of cycle keys to lists of partition receipts.  */
    partitionReceiptsByCycleCounter: {
        [x: string]: PartitionReceipt[];
    };
    /** @type {Object.<string, PartitionReceipt>} a map of cycle keys to lists of partition receipts.  */
    ourPartitionReceiptsByCycleCounter: {
        [x: string]: PartitionReceipt;
    };
    doDataCleanup: boolean;
    sendArchiveData: boolean;
    purgeArchiveData: boolean;
    sentReceipts: Map<any, any>;
    clearPartitionData(): void;
    addressRange: SimpleRange | null | undefined;
    dataSourceNode: any;
    removedNodes: any[] | undefined;
    allFailedHashes: any[] | undefined;
    inMemoryStateTableData: any;
    combinedAccountData: any;
    lastStateSyncEndtime: any;
    visitedNodes: {} | undefined;
    accountsWithStateConflict: any[] | undefined;
    failedAccounts: any;
    mapAccountData: {} | undefined;
    fifoLocks: {} | undefined;
    updateShardValues(cycleNumber: any): void;
    /**
     * getShardDataForCycle
     * @param {number} cycleNumber
     * @returns {CycleShardData}
     */
    getShardDataForCycle(cycleNumber: number): CycleShardData;
    calculateChangeInCoverage(): void;
    syncRuntimeTrackers(): Promise<void>;
    getCurrentCycleShardData(): CycleShardData | null;
    hasCycleShardData(): boolean;
    shuffleArray(array: any): void;
    getRandomInt(max: any): number;
    getRandomIndex(list: any): number;
    getActiveNodesInRange(lowAddress: any, highAddress: any, exclude?: any[]): any[];
    getRandomNodesInRange(count: any, lowAddress: any, highAddress: any, exclude: any): any[];
    /**
     * createSyncTrackerByRange
     * @param {BasicAddressRange} range
     * @param {number} cycle
     * @return {SyncTracker}
     */
    createSyncTrackerByRange(range: import("./shardFunctions").BasicAddressRange, cycle: number): SyncTracker;
    getSyncTracker(address: any): SyncTracker | null;
    syncStateData(requiredNodeCount: any): Promise<void>;
    requiredNodeCount: any;
    startCatchUpQueue(): Promise<void>;
    /**
     * @param {SimpleRange} range
     */
    syncStateDataForRange(range: SimpleRange): Promise<void>;
    currentRange: SimpleRange | undefined;
    partitionStartTimeStamp: number | undefined;
    syncStateTableData(lowAddress: any, highAddress: any, startTime: any, endTime: any): Promise<void>;
    combinedAccountStateData: any;
    syncAccountData(lowAddress: any, highAddress: any): Promise<void>;
    failandRestart(): Promise<void>;
    failAndDontRestartSync(): void;
    recordPotentialBadnode(): void;
    processAccountData(): Promise<void>;
    missingAccountData: any[] | undefined;
    goodAccounts: any[] | undefined;
    writeCombinedAccountDataToBackups(failedHashes: any): Promise<void>;
    syncFailedAcccounts(lowAddress: any, highAddress: any): Promise<void>;
    getAccountDataByRangeSmart(accountStart: any, accountEnd: any, tsStart: any, maxRecords: any): Promise<{
        wrappedAccounts: any;
        lastUpdateNeeded: boolean;
        wrappedAccounts2: any;
        highestTs: number;
    }>;
    checkAndSetAccountData(accountRecords: any): Promise<any[]>;
    registerEndpoints(): void;
    _unregisterEndpoints(): void;
    enableSyncCheck(): void;
    restoreAccountDataByTx(nodes: any, accountStart: any, accountEnd: any, timeStart: any, timeEnd: any): Promise<void>;
    sortedArrayDifference(a: any, b: any, compareFn: any): any[];
    restoreAccountData(nodes: any, accountStart: any, accountEnd: any, timeStart: any, timeEnd: any): Promise<void>;
    getAccountsStateHash(accountStart?: string, accountEnd?: string, tsStart?: number, tsEnd?: number): Promise<any>;
    testAccountTimesAndStateTable(tx: any, accountData: any): Promise<{
        success: boolean;
        hasStateTableData: boolean;
    }>;
    testAccountTimesAndStateTable2(tx: any, wrappedStates: any): Promise<{
        success: boolean;
        hasStateTableData: boolean;
    }>;
    testAccountTime(tx: any, wrappedStates: any): Promise<boolean>;
    tryApplyTransaction(acceptedTX: any, hasStateTableData: any, repairing: any, filter: any, wrappedStates: any, localCachedData: any): Promise<boolean>;
    applyAcceptedTransaction(acceptedTX: any, wrappedStates: any, localCachedData: any, filter: any): Promise<{
        success: boolean;
        reason: string;
    } | undefined>;
    interruptibleSleep(ms: any, targetTime: any): {
        promise: Promise<any>;
        resolveFn: null;
        targetTime: any;
    };
    interruptSleepIfNeeded(targetTime: any): void;
    updateHomeInformation(txQueueEntry: any): void;
    queueAcceptedTransaction(acceptedTx: any, sendGossip?: boolean, sender: any): boolean | "notReady" | "lost" | "out of range";
    tryStartAcceptedQueue(): void;
    _firstTimeQueueAwait(): Promise<void>;
    getQueueEntry(txid: any, timestamp: any): any;
    getQueueEntryPending(txid: any, timestamp: any): any;
    getQueueEntrySafe(txid: any, timestamp: any): any;
    getQueueEntryArchived(txid: any, timestamp: any): any;
    queueEntryAddData(queueEntry: any, data: any): void;
    queueEntryHasAllData(queueEntry: any): boolean;
    queueEntryRequestMissingData(queueEntry: any): Promise<void>;
    /**
     * queueEntryGetTransactionGroup
     * @param {QueueEntry} queueEntry
     * @returns {Node[]}
     */
    queueEntryGetTransactionGroup(queueEntry: QueueEntry): any[];
    tellCorrespondingNodes(queueEntry: any): Promise<void>;
    removeFromQueue(queueEntry: any, currentIndex: any): void;
    processAcceptedTxQueue(): Promise<void>;
    dumpAccountDebugData(): Promise<void>;
    waitForShardData(): Promise<void>;
    getLocalOrRemoteAccount(address: any): Promise<any>;
    getAccountFailDump(address: any, message: any): void;
    getRemoteAccount(address: any): Promise<any>;
    /**
     * getClosestNodes
     * @param {string} hash
     * @param {number} count
     * @returns {Node[]}
     */
    getClosestNodes(hash: string, count?: number): any[];
    getClosestNodesGlobal(hash: any, count: any): any[];
    isNodeInDistance(shardGlobals: any, parititionShardDataMap: any, hash: any, nodeId: any, distance: any): boolean;
    setAccount(wrappedStates: any, localCachedData: any, applyResponse: any, accountFilter?: any): Promise<void>;
    fifoLock(fifoName: any): Promise<any>;
    fifoUnlock(fifoName: any, id: any): void;
    _clearState(): Promise<void>;
    _stopQueue(): void;
    _clearQueue(): void;
    _registerListener(emitter: any, event: any, callback: any): void;
    _unregisterListener(event: any): void;
    _cleanupListeners(): void;
    cleanup(): Promise<void>;
    /**
     * getPartitionReport used by reporting (monitor server) to query if there is a partition report ready
     * @param {boolean} consensusOnly
     * @param {boolean} smallHashes
     * @returns {any}
     */
    getPartitionReport(consensusOnly: boolean, smallHashes: boolean): any;
    /**
     * @param {PartitionObject} partitionObject
     */
    poMicroDebug(partitionObject: PartitionObject): void;
    /**
     * generatePartitionObjects
     * @param {Cycle} lastCycle
     */
    generatePartitionObjects(lastCycle: any): void;
    /**
     * generatePartitionResult
     * @param {PartitionObject} partitionObject
     * @returns {PartitionResult}
     */
    generatePartitionResult(partitionObject: PartitionObject): PartitionResult;
    /**
     * generatePartitionObject
     * @param {Cycle} lastCycle todo define cycle!!
     * @param {number} partitionId
     * @returns {PartitionObject}
     */
    generatePartitionObject(lastCycle: any, partitionId: number): PartitionObject;
    /**
     * partitionObjectToTxMaps
     * @param {PartitionObject} partitionObject
     * @returns {Object.<string,number>}
     */
    partitionObjectToTxMaps(partitionObject: PartitionObject): {
        [x: string]: number;
    };
    /**
     * partitionObjectToStateMaps
     * @param {PartitionObject} partitionObject
     * @returns {Object.<string,string>}
     */
    partitionObjectToStateMaps(partitionObject: PartitionObject): {
        [x: string]: string;
    };
    /**
     * tryGeneratePartitionReciept
     * Generate a receipt if we have consensus
     * @param {PartitionResult[]} allResults
     * @param {PartitionResult} ourResult
     * @param {boolean} [repairPassHack]
     * @returns {{ partitionReceipt: PartitionReceipt; topResult: PartitionResult; success: boolean }}
     */
    tryGeneratePartitionReciept(allResults: PartitionResult[], ourResult: PartitionResult, repairPassHack?: boolean | undefined): {
        partitionReceipt: PartitionReceipt;
        topResult: PartitionResult;
        success: boolean;
    };
    /**
     * startRepairProcess
     * @param {Cycle} cycle
     * @param {PartitionResult} topResult
     * @param {number} partitionId
     * @param {string} ourLastResultHash
     */
    startRepairProcess(cycle: any, topResult: PartitionResult, partitionId: number, ourLastResultHash: string): Promise<void>;
    testAndApplyRepairs(cycleNumber: any): Promise<void>;
    /**
     * checkForGoodPartitionReciept
     * @param {number} cycleNumber
     * @param {number} partitionId
     */
    checkForGoodPartitionReciept(cycleNumber: number, partitionId: number): Promise<void>;
    /**
     * syncTXsFromWinningHash
     * This is used when a simple vote of hashes revealse a most popular hash.  In this case we can just sync the txs from any of the nodes that had this winning hash
     * @param {PartitionResult} topResult
     */
    syncTXsFromWinningHash(topResult: PartitionResult): Promise<void>;
    /**
     * _mergeRepairDataIntoLocalState
     * used with syncTXsFromWinningHash in the simple case where a most popular hash wins.
     * @param {RepairTracker} repairTracker todo repair tracker type
     * @param {PartitionObject} ourPartitionObj
     * @param {*} otherStatusMap todo status map, but this is unused
     * @param {PartitionObject} otherPartitionObject
     */
    _mergeRepairDataIntoLocalState(repairTracker: RepairTracker, ourPartitionObj: PartitionObject, otherStatusMap: any, otherPartitionObject: PartitionObject): void;
    /**
     * _mergeRepairDataIntoLocalState2
     * used by syncTXsFromHashSetStrings in the complex case where we had to run consensus on individual transactions and request transactions from possibly multiple nodes
     * @param {RepairTracker} repairTracker
     * @param {PartitionObject} ourPartitionObj
     * @param {any} ourLastResultHash
     * @param {GenericHashSetEntry & IHashSetEntryPartitions} ourHashSet
     */
    _mergeRepairDataIntoLocalState2(repairTracker: RepairTracker, ourPartitionObj: PartitionObject, ourLastResultHash: any, ourHashSet: GenericHashSetEntry & IHashSetEntryPartitions, txListOverride?: any): boolean;
    initApoptosisAndQuitSyncing(): void;
    /**
     * syncTXsFromHashSetStrings
     * This is used when there is no clear winning hash and we must do consensus on each transaction
     *  This takes the various hashset strings we have collected and feeds them in to a general purpose solver
     *  The first pass in the solver finds the consensus merged string
     *  The secon pass of the solver helps generate the solution operations needed to make our data match the solved list (i.e. delete or insert certain elements)
     *  After the solvers are run we can build lists of requests to one or more nodes and ask for missing transactions. (get_transactions_by_partition_index)
     *  Finally we can call _mergeRepairDataIntoLocalState2 to to merge the results that we queried for into our set of data that is used for forming partition objects.
     * @param {number} cycleNumber
     * @param {number} partitionId
     * @param {RepairTracker} repairTracker
     * @param {string} ourLastResultHash
     */
    syncTXsFromHashSetStrings(cycleNumber: number, partitionId: number, repairTracker: RepairTracker, ourLastResultHash: string): Promise<100 | undefined>;
    /**
     * _getRepairTrackerForCycle
     * @param {number} counter
     * @param {number} partition
     * @returns {RepairTracker}
     */
    _getRepairTrackerForCycle(counter: number, partition: number): RepairTracker;
    /**
     * repairTrackerMarkFinished
     * @param {RepairTracker} repairTracker
     */
    repairTrackerMarkFinished(repairTracker: RepairTracker, debugTag: any): void;
    /**
     * repairTrackerClearForNextRepair
     * @param {RepairTracker} repairTracker
     */
    repairTrackerClearForNextRepair(repairTracker: RepairTracker): void;
    /**
     * mergeAndApplyTXRepairs
     * @param {number} cycleNumber
     * @param {number} specificParition the old version of this would repair all partitions but we had to wait.  this works on just one partition
     */
    mergeAndApplyTXRepairs(cycleNumber: number, specificParition: number): Promise<void>;
    /**
     * updateTrackingAndPrepareChanges
     * @param {number} cycleNumber
     * @param {number} specificParition the old version of this would repair all partitions but we had to wait.  this works on just one partition
     */
    updateTrackingAndPrepareRepairs(cycleNumber: number, specificParition: number): Promise<void>;
    /**
     * updateTrackingAndPrepareChanges
     * @param {number} cycleNumber
     */
    applyAllPreparedRepairs(cycleNumber: number): Promise<void>;
    applyAllPreparedRepairsRunning: boolean | undefined;
    /**
     * bulkFifoLockAccounts
     * @param {string[]} accountIDs
     */
    bulkFifoLockAccounts(accountIDs: string[]): Promise<any[]>;
    /**
     * bulkFifoUnlockAccounts
     * @param {string[]} accountIDs
     * @param {number[]} ourLocks
     */
    bulkFifoUnlockAccounts(accountIDs: string[], ourLocks: number[]): void;
    /**
     * _revertAccounts
     * @param {string[]} accountIDs
     * @param {number} cycleNumber
     */
    _revertAccounts(accountIDs: string[], cycleNumber: number): Promise<any>;
    periodicCycleDataCleanup(oldestCycle: any): void;
    /**
     * broadcastPartitionResults
     * @param {number} cycleNumber
     */
    broadcastPartitionResults(cycleNumber: number): Promise<void>;
    initStateSyncData(): void;
    /** @type { Object.<string,PartitionObject[]>} our partition objects by cycle.  index by cycle counter key to get an array */
    partitionObjectsByCycle: {
        [x: string]: PartitionObject[];
    };
    /** @type { Object.<string,PartitionResult[]>} our partition results by cycle.  index by cycle counter key to get an array */
    ourPartitionResultsByCycle: {
        [x: string]: PartitionResult[];
    };
    /** @type {Object.<string, Object.<string,RepairTracker>>} tracks state for repairing partitions. index by cycle counter key to get the repair object, index by parition */
    repairTrackingByCycleById: {
        [x: string]: {
            [x: string]: RepairTracker;
        };
    };
    /** @type {Object.<string, UpdateRepairData[]>}  */
    repairUpdateDataByCycle: {
        [x: string]: UpdateRepairData[];
    };
    /** @type {Object.<string, Object.<string,PartitionObject>>} our partition objects by cycle.  index by cycle counter key to get an array */
    recentPartitionObjectsByCycleByHash: {
        [x: string]: {
            [x: string]: PartitionObject;
        };
    };
    /** @type {TempTxRecord[]} temporary store for TXs that we put in a partition object after a cycle is complete. an array that holds any TXs (i.e. from different cycles), code will filter out what it needs @see TempTxRecord */
    tempTXRecords: TempTxRecord[];
    /** @type {Object.<string, Object.<string,TxTallyList>>} TxTallyList data indexed by cycle key and partition key. @see TxTallyList */
    txByCycleByPartition: {
        [x: string]: {
            [x: string]: TxTallyList;
        };
    };
    /** @type {Object.<string, Object.<string,PartitionResult[]>>} Stores the partition responses that other nodes push to us.  Index by cycle key, then index by partition id */
    allPartitionResponsesByCycleByPartition: {
        [x: string]: {
            [x: string]: PartitionResult[];
        };
    };
    startShardCalculations(): void;
    startSyncPartitions(): Promise<void>;
    /**
     * updateAccountsCopyTable
     * originally this only recorder results if we were not repairing but it turns out we need to update our copies any time we apply state.
     * with the update we will calculate the cycle based on timestamp rather than using the last current cycle counter
     * @param {any} accountDataList todo need to use wrapped account data here
     * @param {boolean} repairing
     * @param {number} txTimestamp
     */
    updateAccountsCopyTable(accountDataList: any, repairing: boolean, txTimestamp: number): Promise<void>;
    /**
   * tempRecordTXByCycle
   * we dont have a cycle yet to save these records against so store them in a temp place
   * @param {number} txTS
   * @param {AcceptedTx} acceptedTx
   * @param {boolean} passed
   * @param {ApplyResponse} applyResponse
   */
    tempRecordTXByCycle(txTS: number, acceptedTx: any, passed: boolean, applyResponse: any): void;
    /**
     * sortTXRecords
     * @param {TempTxRecord} a
     * @param {TempTxRecord} b
     * @returns {number}
     */
    sortTXRecords(a: TempTxRecord, b: TempTxRecord): number;
    /**
     * processTempTXs
     * call this before we start computing partitions so that we can make sure to get the TXs we need out of the temp list
     * @param {Cycle} cycle
     */
    processTempTXs(cycle: any): void;
    /**
     * getTXList
     * @param {number} cycleNumber
     * @param {number} partitionId
     * @returns {TxTallyList}
     */
    getTXList(cycleNumber: number, partitionId: number): TxTallyList;
    /**
     * getTXListByKey
     * just an alternative to getTXList where the calling code has alredy formed the cycle key
     * @param {string} key the cycle based key c##
     * @param {number} partitionId
     * @returns {TxTallyList}
     */
    getTXListByKey(key: string, partitionId: number): TxTallyList;
    /**
     * recordTXByCycle
     * @param {number} txTS
     * @param {AcceptedTx} acceptedTx
     * @param {boolean} passed
     * @param {ApplyResponse} applyResponse
     */
    recordTXByCycle(txTS: number, acceptedTx: any, passed: boolean, applyResponse: any): void;
    /**
     * getPartitionObject
     * @param {number} cycleNumber
     * @param {number} partitionId
     * @returns {PartitionObject}
     */
    getPartitionObject(cycleNumber: number, partitionId: number): PartitionObject;
    /**
     * storePartitionReceipt
     * TODO sharding perf.  may need to do periodic cleanup of this and other maps so we can remove data from very old cycles
     * TODO production need to do something with this data
     * @param {number} cycleNumber
     * @param {PartitionReceipt} partitionReceipt
     */
    storePartitionReceipt(cycleNumber: number, partitionReceipt: PartitionReceipt): void;
    storeOurPartitionReceipt(cycleNumber: any, partitionReceipt: any): void;
    getPartitionReceipt(cycleNumber: any): PartitionReceipt | null;
    /**
     * findMostCommonResponse
     * @param {number} cycleNumber
     * @param {number} partitionId
     * @param {string[]} ignoreList currently unused and broken todo resolve this.
     * @return {{topHash: string, topCount: number, topResult: PartitionResult}}
     */
    findMostCommonResponse(cycleNumber: number, partitionId: number, ignoreList: string[]): {
        topHash: string;
        topCount: number;
        topResult: PartitionResult;
    };
    /**
     * solveHashSetsPrep
     * todo cleanup.. just sign the partition object asap so we dont have to check if there is a valid sign object throughout the code (but would need to consider perf impact of this)
     * @param {number} cycleNumber
     * @param {number} partitionId
     * @param {string} ourNodeKey
     * @return {GenericHashSetEntry[]}
     */
    solveHashSetsPrep(cycleNumber: number, partitionId: number, ourNodeKey: string): GenericHashSetEntry[];
    /**
     * sendPartitionData
     * @param {PartitionReceipt} partitionReceipt
     * @param {PartitionObject} paritionObject
     */
    sendPartitionData(partitionReceipt: PartitionReceipt, paritionObject: PartitionObject): void;
    sendTransactionData(partitionNumber: any, cycleNumber: any, transactions: any): void;
    purgeTransactionData(): void;
    purgeStateTableData(): void;
    /**
     * trySendAndPurgeReciepts
     * @param {PartitionReceipt} partitionReceipt
     */
    trySendAndPurgeReceiptsToArchives(partitionReceipt: PartitionReceipt): void;
}

type App = any;
type SyncTracker = {
    syncStarted: boolean;
    syncFinished: boolean;
    range: any;
    cycle: number;
    index: number;
    queueEntries: QueueEntry[];
};
type CycleShardData = {
    shardGlobals: import("./shardFunctions").ShardGlobals;
    cycleNumber: number;
    ourNode: any;
    /**
     * our node's node shard data
     */
    nodeShardData: import("./shardFunctions").NodeShardData;
    nodeShardDataMap: Map<string, import("./shardFunctions").NodeShardData>;
    parititionShardDataMap: Map<number, import("./shardFunctions").ShardInfo>;
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
/**
 * a partition object
 */
type RepairTracker = {
    triedHashes: string[];
    numNodes: number;
    /**
     * cycle number for the repair obbject
     */
    counter: number;
    /**
     * partition id for the repair object
     */
    partitionId: number;
    /**
     * this key is based on the cycle counter in the form c###  where ### is the cycle number (can be as many digits as needed)
     */
    key: string;
    /**
     * this key is based on the partition in the form p## where ## is the partition number (can be as many digits as needed)
     */
    key2: string;
    removedTXIds: string[];
    repairedTXs: string[];
    newPendingTXs: any[];
    newFailedTXs: any[];
    extraTXIds: string[];
    missingTXIds: string[];
    repairing: boolean;
    repairsNeeded: boolean;
    busy: boolean;
    /**
     * we have the TXs and TX data we need to apply data repairs
     */
    txRepairReady: boolean;
    txRepairComplete: boolean;
    evaluationStarted: boolean;
    /**
     * not sure if we really need this
     */
    evaluationComplete: boolean;
    awaitWinningHash: boolean;
    repairsFullyComplete: boolean;
    solutionDeltas?: SolutionDelta[];
    outputHashSet?: string;
};
/**
 * a partition reciept
 */
type PartitionReceipt = {
    resultsList: PartitionResult[];
    sign?: any;
};
/**
 * A simple address range
 */
type SimpleRange = {
    /**
     * Starting index
     */
    low: string;
    /**
     * End index
     */
    high: string;
};
type QueueEntry = {
    acceptedTx: any;
    txKeys: any;
    collectedData: any;
    originalData: any;
    homeNodes: any;
    hasShardInfo: boolean;
    state: string;
    dataCollected: number;
    hasAll: boolean;
    /**
     * based on the incrementing queueEntryCounter
     */
    entryID: number;
    localKeys: {
        [x: string]: boolean;
    };
    localCachedData: any;
    syncCounter: number;
    didSync: boolean;
    syncKeys: any[];
    uniqueKeys?: any;
    ourNodeInvolved?: boolean;
    transactionGroup?: any[];
};
/**
 * a partition object
 */
type PartitionObject = {
    Partition_id: number;
    Partitions: number;
    Cycle_number: number;
    Cycle_marker: string;
    Txids: string[];
    Status: number[];
    States: string[];
    /**
     * todo more specific data type
     */
    Chain: any[];
};
/**
 * a partition result
 */
type PartitionResult = {
    Partition_id: number;
    Partition_hash: string;
    Cycle_number: number;
    hashSet: string;
    /**
     * // property {any} \[hashSetList\] this seems to be used as debug. considering commenting it out in solveHashSetsPrep for safety.
     */
    sign?: any;
};
/**
 * some generic data that represents a vote for hash set comparison
 */
type GenericHashSetEntry = {
    hash: string;
    votePower: number;
    hashSet: string;
    lastValue: string;
    errorStack: HashSetEntryError[];
    corrections: HashSetEntryCorrection[];
    /**
     * {string[]} owners a list of owner addresses that have this solution
     * {boolean} ourRow
     */
    indexOffset: number;
    waitForIndex: number;
    waitedForThis?: boolean;
    /**
     * this gets added when you call expandIndexMapping. index map is our index to the solution output
     */
    indexMap?: number[];
    /**
     * this gets added when you call expandIndexMapping. extra map is the index in our list that is an extra
     */
    extraMap?: number[];
    futureIndex?: number;
    futureValue?: string;
    /**
     * current Pin index of this entry.. modified by solver.
     */
    pinIdx?: number;
    /**
     * the object/vote we are pinned to.  todo make this a type!!
     */
    pinObj?: any;
    ownVotes?: any[];
};
/**
 * extends GenericHashSetEntry some generic data that represents a vote for hash set comparison
 */
type IHashSetEntryPartitions = {
    /**
     * a list of owner addresses that have this solution
     */
    owners: string[];
    ourRow?: boolean;
    outRow?: boolean;
};
/**
 * newTXList, allAccountsToResetById, partitionId
 */
type UpdateRepairData = {
    newTXList: any[];
    allAccountsToResetById: {
        [x: string]: number;
    };
    partitionId: number;
    txIDToAcc: {
        [x: string]: {
            sourceKeys: string[];
            targetKeys: string[];
        };
    };
};
/**
 * an object to hold a temp tx record for processing later
 */
type TempTxRecord = {
    txTS: number;
    acceptedTx: any;
    passed: boolean;
    applyResponse: any;
    /**
     * below 0 for not redacted. a value above zero indicates the cycle this was redacted
     */
    redacted: number;
};
/**
 * an object that tracks our TXs that we are storing for later.
 */
type TxTallyList = {
    hashes: string[];
    /**
     * AcceptedTx?
     */
    passed: number[];
    txs: any[];
    processed: boolean;
    /**
     * below 0 for not redacted. a value above zero indicates the cycle this was redacted
     */
    states: any[];
    /**
     * this gets added on when we are reparing something newTxList seems to have a different format than existing types.
     */
    newTxList?: any;
};
type Cycle = any;
type Sign = any;
type Node = any;
type AcceptedTx = any;
type ApplyResponse = any;
type ShardGlobals = {
    /**
     * number of active nodes
     */
    numActiveNodes: number;
    /**
     * number of nodes per consesus group
     */
    nodesPerConsenusGroup: number;
    /**
     * number of partitions
     */
    numPartitions: number;
    /**
     * default number of partitions that are visible to a node (ege or consensus)
     */
    numVisiblePartitions: number;
    /**
     * consenus radius (number of nodes to each side of us that hold consensus data)
     */
    consensusRadius: number;
    /**
     * Address range to look left and right (4 byte numeric)
     */
    nodeLookRange: number;
    /**
     * End address in numeric form (4 bytes)
     */
    endAddr: number;
};
type NodeShardData = {
    /**
     * our node
     */
    node: any;
    /**
     * numeric address prefix
     */
    nodeAddressNum: number;
    /**
     * number of partitions
     */
    homePartition: number;
    /**
     * the home partition
     */
    centeredAddress: number;
    /**
     * the home partition
     */
    ourNodeIndex: number;
    consensusStartPartition: number;
    consensusEndPartition: number;
    /**
     * have we calculated extended data yet
     */
    extendedData: boolean;
    /**
     * extended data below here
     */
    needsUpdateToFullConsensusGroup: boolean;
    /**
     * consenus radius (number of nodes to each side of us that hold consensus data)
     * property {Map<string,Node>} coveredBy the nodes that cover us for consenus // removed not sure this goes here
     */
    storedPartitions: import("./shardFunctions").StoredPartition;
    nodeThatStoreOurParition: any[];
    nodeThatStoreOurParitionFull: any[];
    consensusNodeForOurNode: any[];
    consensusNodeForOurNodeFull: any[];
    edgeNodes: any[];
    c2NodeForOurNode: any[];
    outOfDefaultRangeNodes: any[];
};
type ShardInfo = {
    /**
     * address used in calculation
     */
    address: string;
    /**
     * number of active nodes    todo get p2p node info
     */
    homeNodes: any[];
    /**
     * numeric address prefix
     */
    addressPrefix: number;
    /**
     * number of partitions
     */
    addressPrefixHex: string;
    /**
     * the home partition
     */
    homePartition: number;
    /**
     * consenus radius (number of nodes to each side of us that hold consensus data)
     */
    homeRange: import("./shardFunctions").AddressRange;
    /**
     * the nodes that cover us for consenus.
     */
    coveredBy: {
        [x: string]: any;
    };
    /**
     * the nodes that cover us for storage.
     */
    storedBy: {
        [x: string]: any;
    };
};
type AddressRange = {
    /**
     * the partition
     */
    partition: number;
    /**
     * End index
     */
    p_low: number;
    /**
     * The user's age.
     */
    p_high: number;
    partitionEnd: number;
    /**
     * Start address in numeric form (4 bytes)
     */
    startAddr: number;
    /**
     * End address in numeric form (4 bytes)
     */
    endAddr: number;
    /**
     * End address in 64 char string
     */
    low: string;
    /**
     * End address in 64 char string
     */
    high: string;
};
type BasicAddressRange = {
    /**
     * Start address in numeric form (4 bytes)
     */
    startAddr: number;
    /**
     * End address in numeric form (4 bytes)
     */
    endAddr: number;
    /**
     * End address in 64 char string
     */
    low: string;
    /**
     * End address in 64 char string
     */
    high: string;
};
/**
 * a partition reciept that contains one copy of of the data and all of the signatures for that data
 */
type CombinedPartitionReceipt = {
    /**
     * with signatures moved to a list
     */
    result: PartitionResult;
    signatures: any[];
};
/**
 * an object to hold a temp tx record for processing later
 */
type SolutionDelta = {
    /**
     * index into our request list: requestsByHost.requests
     */
    i: number;
    tx: any;
    pf: boolean;
    /**
     * a string snipped from our solution hash set
     */
    state: string;
};
type HashSetEntryPartitions = GenericHashSetEntry & IHashSetEntryPartitions;
/**
 * some generic data that represents a vote for hash set comparison
 */
type HashSetEntryCorrection = {
    /**
     * index
     */
    i: number;
    /**
     * top vote index
     */
    tv: Vote;
    /**
     * top vote value
     */
    v: string;
    /**
     * type 'insert', 'extra'
     */
    t: string;
    /**
     * last value
     */
    bv: string;
    /**
     * lat output count?
     */
    if: number;
    /**
     * another index.
     */
    hi?: number;
    /**
     * reference to the correction that this one is replacing/overriding
     */
    c?: HashSetEntryCorrection;
};
/**
 * some generic data that represents a vote for hash set comparison
 */
type HashSetEntryError = {
    /**
     * index
     */
    i: number;
    /**
     * top vote index
     */
    tv: Vote;
    /**
     * top vote value
     */
    v: string;
};
/**
 * vote for a value
 */
type Vote = {
    /**
     * vote value
     */
    v: string;
    /**
     * number of votes
     */
    count: number;
    /**
     * reference to another vote object
     */
    vote?: CountEntry;
    /**
     * count based on vote power
     */
    ec?: number;
    /**
     * hashlist index of the voters for this vote
     */
    voters?: number[];
};
/**
 * vote count tracking
 */
type CountEntry = {
    /**
     * number of votes
     */
    count: number;
    /**
     * count based on vote power
     */
    ec: number;
    /**
     * hashlist index of the voters for this vote
     */
    voters: number[];
};
