
/**
   * @typedef {Object} SimpleRange A simple address range
   * @property {string} low Starting index
   * @property {string} high End index
   */
/**
   * @typedef {import('../shardus/index.js').App} App
   */
/**
   * @typedef {import('../shardus/index.js').Cycle} Cycle
   */
/**
   * @typedef {import('../shardus/index.js').Sign} Sign
   */
/**
 * @typedef {import('../shardus/index.js').Node} Node
 */
/**
   * @typedef {import('../shardus/index.js').AcceptedTx} AcceptedTx
   */
/**
   * @typedef {import('../shardus/index.js').ApplyResponse} ApplyResponse
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
 * @property {number} [approximateCycleAge]
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


type App = import("../shardus/shardus-types").App;
type QueueEntry = {
    acceptedTx: import("../shardus/shardus-types").AcceptedTx;
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
    transactionGroup?: import("../shardus/shardus-types").Node[];
    approximateCycleAge?: number;
};
type SyncTracker = {
    syncStarted: boolean;
    syncFinished: boolean;
    range: any;
    cycle: number;
    index: number;
    queueEntries: QueueEntry[];
};
type CycleShardData = {
    shardGlobals: any;
    cycleNumber: number;
    ourNode: import("../shardus/shardus-types").Node;
    /**
     * our node's node shard data
     */
    nodeShardData: any;
    nodeShardDataMap: Map<string, any>;
    parititionShardDataMap: Map<number, any>;
    activeNodes: import("../shardus/shardus-types").Node[];
    syncingNeighbors: import("../shardus/shardus-types").Node[];
    syncingNeighborsTxGroup: import("../shardus/shardus-types").Node[];
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
    newPendingTXs: import("../shardus/shardus-types").AcceptedTx[];
    newFailedTXs: import("../shardus/shardus-types").AcceptedTx[];
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
    sign?: import("../shardus/shardus-types").Sign;
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
    sign?: import("../shardus/shardus-types").Sign;
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
    {boolean} ourRow
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
    newTXList: import("../shardus/shardus-types").AcceptedTx[];
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
    acceptedTx: import("../shardus/shardus-types").AcceptedTx;
    passed: boolean;
    applyResponse: import("../shardus/shardus-types").ApplyResponse;
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
type Cycle = import("../shardus/shardus-types").Cycle;
type Sign = import("../shardus/shardus-types").Sign;
//type Node = import("../shardus").Node;
type AcceptedTx = import("../shardus/shardus-types").AcceptedTx;
type ApplyResponse = import("../shardus/shardus-types").ApplyResponse;
// type ShardGlobals = any;
// type NodeShardData = any;
// type ShardInfo = any;
// type AddressRange = any;
// type BasicAddressRange = any;
/**
 * a partition reciept that contains one copy of of the data and all of the signatures for that data
 */
type CombinedPartitionReceipt = {
    /**
     * with signatures moved to a list
     */
    result: PartitionResult;
    signatures: import("../shardus/shardus-types").Sign[];
};
/**
 * an object to hold a temp tx record for processing later
 */
type SolutionDelta = {
    /**
     * index into our request list: requestsByHost.requests
     */
    i: number;
    tx: import("../shardus/shardus-types").AcceptedTx;
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
