//import { AccountData } from "../shardus/shardus-types";

//import { ShardGlobals } from "./shardFunctionTypes";

//import { WrappedData } from "../shardus/shardus-types";
//imports up top break the export, boo.

type App = import("../shardus/shardus-types").App;
type QueueEntry = {
    acceptedTx: import("../shardus/shardus-types").AcceptedTx;
    txKeys: import("../shardus/shardus-types").TransactionKeys
    collectedData: any;
    originalData: any;
    homeNodes: {[accountID:string]:import('./shardFunctionTypes').NodeShardData};
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
    logstate: string; // logging state
    requests: {[key:string]:import("../shardus/shardus-types").Node} // map of account keys to the node that we are requesting the account data from 
    globalModification:boolean
    uniqueKeys?: string[];
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

    timestamp:number // timestamp for cleanup purposes, may not match exactly the rules of which transactions will live in a partition for this cycle.
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
    newTxList?: NewTXList;
};

type NewTXList = { hashes: string[], passed: number[], txs: any[], thashes: string[], tpassed: number[], ttxs: any[], tstates: any[], states: any[], processed: boolean }

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
    pf: number; // TSConversion was a boolean
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

type StringVoteObjectMap = {[vote:string]:Vote}

type ExtendedVote = Vote & {
    winIdx: number|null;
    val:string;
    lowestIndex:number;
    voteTally: { i: number, p: number }[];  // number[] // { i: index, p: hashListEntry.votePower } 
    votesseen: any;
    finalIdx: number;
}

type StringExtendedVoteObjectMap = {[vote:string]:ExtendedVote}

//{ winIdx: null, val: v, count: 0, ec: 0, lowestIndex: index, voters: [], voteTally: Array(hashSetList.length), votesseen }

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

type StringCountEntryObjectMap = {[vote:string]:CountEntry}


//let accountCopy = { accountId: accountEntry.accountId, data: accountEntry.data, timestamp: accountEntry.timestamp, hash: accountEntry.stateId, cycleNumber }
type AccountCopy = {
    accountId: string;
    data: any;
    timestamp: number;
    hash: string;
    cycleNumber: number;
};


//Transaction Related
type TimeRangeandLimit = {tsStart:number, tsEnd:number, limit:number}
type AccountAddressAndTimeRange = {accountStart:string, accountEnd:string, tsStart:number, tsEnd:number}
type AccountRangeAndLimit = {accountStart:string, accountEnd:string, maxRecords:number}

type AccountStateHashReq = AccountAddressAndTimeRange
type AccountStateHashResp = {stateHash: string};

type GossipAcceptedTxRecv = {acceptedTX: AcceptedTx, sender: import("../shardus/shardus-types").Node, tracker: string}


type GetAccountStateReq = AccountAddressAndTimeRange & {stateTableBucketSize: number}

type AcceptedTransactionsReq = TimeRangeandLimit
type GetAccountDataReq = AccountRangeAndLimit

type GetAccountData2Req = AccountAddressAndTimeRange & {maxRecords:number}

type GetAccountData3Req = {accountStart:string, accountEnd:string, tsStart:number, maxRecords:number}
type GetAccountData3Resp = { data: GetAccountDataByRangeSmart }

type PosPartitionResults = { partitionResults: PartitionResult[]; Cycle_number: number; }

type GetTransactionsByListReq = {Tx_ids:string[]}


type TransactionsByPartitionReq = { cycle: number; tx_indicies: any; hash: string; partitionId: number; debugSnippets: any }
type TransactionsByPartitionResp = { success: boolean; acceptedTX?: any; passFail?: any[]; statesList?: any[] }

type GetPartitionTxidsReq = { Partition_id: any; Cycle_number: string }

type RouteToHomeNodeReq = { txid: any; timestamp: any; acceptedTx: import("../shardus/shardus-types").AcceptedTx }

type RequestStateForTxReq = { txid: string; timestamp: number; keys: any }
type RequestStateForTxResp = { stateList: any[]; note: string }

type GetAccountDataWithQueueHintsResp = { accountData: import("../shardus/shardus-types").WrappedDataFromQueue[] | null}

// Sync related
type StateHashResult = {stateHash:string}

type WrappedStates = {[accountID:string]:import("../shardus/shardus-types").WrappedData}
type WrappedStateArray = import("../shardus/shardus-types").WrappedData[]
//type AccountFilter = {[accountID:string]:boolean}
type AccountFilter = {[accountID:string]:number}
type AccountBoolObjectMap = AccountFilter

type WrappedResponses = {[accountID:string]:import("../shardus/shardus-types").WrappedResponse}

type SimpleDistanceObject = {distance:number}
type StringNodeObjectMap = {[accountID:string]:import("../shardus/shardus-types").Node}
type AcceptedTxObjectById = {[txid:string]: import("../shardus/shardus-types").AcceptedTx}
//localCachedData, applyResponse
type TxObjectById = AcceptedTxObjectById

type TxIDToKeyObjectMap = {[accountID:string]:import("../shardus/shardus-types").TransactionKeys}
type TxIDToSourceTargetObjectMap = {[accountID:string]:{ sourceKeys:string[], targetKeys:string[] }}
//fifoLocks

//wrappedData.isPartial

type DebugDumpPartitionAccount = { id: string, hash: string, v: string }
type DebugDumpNodesCovered = { idx: number, ipPort:string, id: string, fracID: number, hP: number, consensus: [], stored: [], extra: [], numP: number }
type DebugDumpRangesCovered = { ipPort:string, id: string, fracID: number, hP: number, cMin: number, cMax: number, stMin: number, stMax: number, numP: number }
type DebugDumpPartition = {parititionID:number, accounts:DebugDumpPartitionAccount[], skip:DebugDumpPartitionSkip} // {[id:string]:string}
type DebugDumpPartitionSkip = { p: number, min: number, max: number, noSpread?: boolean, inverted?:boolean }
type DebugDumpPartitions =  { partitions: DebugDumpPartition[], cycle:number, rangesCovered:DebugDumpRangesCovered,nodesCovered:DebugDumpNodesCovered,allNodeIds:string[]  }


//queue process related:
type SeenAccounts = {[accountId:string]: (QueueEntry | null)}
type LocalCachedData = {[accountId:string]:any }
//type AllNewTXsById = {[accountId:string]: }
type AccountValuesByKey = {[accountId:string]:any }

// repair related
type StatusMap = {[txid:string]:number}
type StateMap = {[txid:string]:string}
type GetAccountDataByRangeSmart =  { wrappedAccounts:WrappedStateArray, lastUpdateNeeded:boolean, wrappedAccounts2:WrappedStateArray, highestTs:number }

//generic relocate?
type SignedObject = {sign: {owner:string}}
type StringBoolObjectMap = {[key:string]:boolean}
type StringNumberObjectMap = {[key:string]:number}
type NumberStringObjectMap = {[index:number]:string}
type StringStringObjectMap = {[key:string]:string}

type FifoWaitingEntry = { id: number }
type FifoLock = { fifoName:string, queueCounter: number, waitingList: FifoWaitingEntry[], lastServed: number, queueLocked: boolean, lockOwner: number }
type FifoLockObjectMap = {[lockID:string]:FifoLock}