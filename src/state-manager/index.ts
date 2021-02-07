import { ShardusConfiguration } from '../shardus/shardus-types'
import Shardus = require('../shardus/shardus-types')

//import {ShardGlobals,ShardInfo,StoredPartition,NodeShardData,AddressRange, HomeNodeSummary,ParititionShardDataMap,NodeShardDataMap,MergeResults,BasicAddressRange} from  './shardFunction2Types'
import { ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, HomeNodeSummary, ParititionShardDataMap, NodeShardDataMap, MergeResults, BasicAddressRange } from './shardFunctionTypes'

import { isNodeDown, isNodeLost } from '../p2p/Lost'

import ShardFunctions from './shardFunctions2.js'

const EventEmitter = require('events')
import * as utils from '../utils'

const stringify = require('fast-stable-stringify')

const allZeroes64 = '0'.repeat(64)

const cHashSetStepSize = 4
const cHashSetTXStepSize = 2
const cHashSetDataStepSize = 2

// not sure about this.
import Consensus from '../consensus'
import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger from '../logger'
//import { NodeShardData } from './shardFunctionTypes'
import ShardFunctions2 from './shardFunctions2.js'
import { throws } from 'assert'
import * as Context from '../p2p/Context'
// import { platform } from 'os' //why did this automatically get added?
//import NodeList from "../p2p/NodeList"

//let shardFunctions = import("./shardFunctions").
//type foo = ShardFunctionTypes.BasicAddressRange

import { response } from 'express'
import { nestedCountersInstance } from '../utils/nestedCounters'

import StateManagerStats from './state-manager-stats'
import StateManagerCache from './state-manager-cache'
import StateManagerSync from './state-manager-sync'
import AccountGlobals from './AccountGlobals'
import TransactionQueue from './TransactionQueue'
import TransactionRepair from './TransactionRepair'
import TransactionConsenus from './TransactionConsensus'
import PartitionObjects from './PartitionObjects'



/**
 * StateManager
 */
class StateManager extends EventEmitter {
  /**
   * @param {boolean} verboseLogs
   * @param {import("../utils/profiler")} profiler
   * @param {import("../shardus").App} app
   * @param {import("../consensus")} consensus
   * @param {import("../p2p")} p2p
   * @param {import("../crypto")} crypto
   * @param {any} config
   */

  app: Shardus.App
  storage: Storage
  p2p: P2P
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler

  //Sub modules
  stateManagerStats: StateManagerStats
  stateManagerCache: StateManagerCache
  stateManagerSync: StateManagerSync
  accountGlobals: AccountGlobals  
  transactionQueue: TransactionQueue
  transactionRepair: TransactionRepair
  transactionConsenus: TransactionConsenus
  partitionObjects: PartitionObjects



  newAcceptedTxQueue: QueueEntry[]
  newAcceptedTxQueueTempInjest: QueueEntry[]
  archivedQueueEntries: QueueEntry[]
  // syncTrackers:SyncTracker[];
  shardValuesByCycle: Map<number, CycleShardData>
  currentCycleShardData: CycleShardData | null
  globalAccountsSynced: boolean
  knownGlobals: { [id: string]: boolean }
  hasknownGlobals: boolean

  dataRepairStack: RepairTracker[]
  dataRepairsCompleted: number
  dataRepairsStarted: number
  repairAllStoredPartitions: boolean
  repairStartedMap: Map<string, boolean>
  repairCompletedMap: Map<string, boolean>

  partitionReceiptsByCycleCounter: { [cycleKey: string]: PartitionReceipt[] } //Object.<string, PartitionReceipt[]> // a map of cycle keys to lists of partition receipts.
  ourPartitionReceiptsByCycleCounter: { [cycleKey: string]: PartitionReceipt } //Object.<string, PartitionReceipt> //a map of cycle keys to lists of partition receipts.

  fifoLocks: FifoLockObjectMap

  //data sync and data repair structure defined
  /** partition objects by cycle.  index by cycle counter key to get an array */
  partitionObjectsByCycle: { [cycleKey: string]: PartitionObject[] }
  /** our partition Results by cycle.  index by cycle counter key to get an array */
  ourPartitionResultsByCycle: { [cycleKey: string]: PartitionResult[] }
  /** tracks state for repairing partitions. index by cycle counter key to get the repair object, index by parition  */
  repairTrackingByCycleById: { [cycleKey: string]: { [id: string]: RepairTracker } }
  /** UpdateRepairData by cycle key */
  repairUpdateDataByCycle: { [cycleKey: string]: UpdateRepairData[] }
  /** partition objects by cycle by hash.   */
  recentPartitionObjectsByCycleByHash: { [cycleKey: string]: { [hash: string]: PartitionObject } }
  /** temporary store for TXs that we put in a partition object after a cycle is complete. an array that holds any TXs (i.e. from different cycles), code will filter out what it needs @see TempTxRecord */
  tempTXRecords: TempTxRecord[]
  /** TxTallyList data indexed by cycle key and partition key. @see TxTallyList */
  txByCycleByPartition: { [cycleKey: string]: { [partitionKey: string]: TxTallyList } }
  /** Stores the partition responses that other nodes push to us.  Index by cycle key, then index by partition id */
  allPartitionResponsesByCycleByPartition: { [cycleKey: string]: { [partitionKey: string]: PartitionResult[] } }

  globalAccountMap: Map<string, Shardus.WrappedDataFromQueue | null>



  appFinishedSyncing: boolean

  debugNoTxVoting: boolean

  ignoreRecieptChance: number
  ignoreVoteChance: number
  loseTxChance: number
  failReceiptChance: number
  voteFlipChance: number

  syncSettleTime: number
  debugTXHistory: { [id: string]: string } // need to disable or clean this as it will leak memory

  // extensiveRangeChecking: boolean; // non required range checks that can show additional errors (should not impact flow control)

  syncPartitionsStarted: boolean

  stateIsGood_txHashsetOld: boolean
  stateIsGood_accountPartitions: boolean
  stateIsGood_activeRepairs: boolean
  stateIsGood: boolean

  oldFeature_TXHashsetTest: boolean
  oldFeature_GeneratePartitionReport: boolean
  oldFeature_BroadCastPartitionReport: boolean
  useHashSets: boolean //Old feature but must stay on (uses hash set string vs. older method)

  feature_receiptMapResults: boolean
  feature_partitionHashes: boolean
  feature_generateStats: boolean
  feature_useNewParitionReport: boolean // old way uses generatePartitionObjects to build a report

  debugFeature_dumpAccountData: boolean
  debugFeature_dumpAccountDataFromSQL: boolean

  debugFeatureOld_partitionReciepts: boolean // depends on old partition report features.

  nextCycleReportToSend: PartitionCycleReport

  verboseLogs: boolean

  logger: Logger


/***
 *     ######   #######  ##    ##  ######  ######## ########  ##     ##  ######  ########  #######  ########  
 *    ##    ## ##     ## ###   ## ##    ##    ##    ##     ## ##     ## ##    ##    ##    ##     ## ##     ## 
 *    ##       ##     ## ####  ## ##          ##    ##     ## ##     ## ##          ##    ##     ## ##     ## 
 *    ##       ##     ## ## ## ##  ######     ##    ########  ##     ## ##          ##    ##     ## ########  
 *    ##       ##     ## ##  ####       ##    ##    ##   ##   ##     ## ##          ##    ##     ## ##   ##   
 *    ##    ## ##     ## ##   ### ##    ##    ##    ##    ##  ##     ## ##    ##    ##    ##     ## ##    ##  
 *     ######   #######  ##    ##  ######     ##    ##     ##  #######   ######     ##     #######  ##     ## 
 */
  constructor(verboseLogs: boolean, profiler: Profiler, app: Shardus.App, consensus: Consensus, logger: Logger, storage: Storage, p2p: P2P, crypto: Crypto, config: Shardus.ShardusConfiguration) {
    super()
    this.verboseLogs = verboseLogs

    this.p2p = p2p
    this.crypto = crypto
    this.storage = storage
    this.app = app
    this.consensus = consensus
    this.logger = logger
    this.config = config
    this.profiler = profiler

    //BLOCK1
    this._listeners = {}
    this.completedPartitions = []
    this.mainStartingTs = Date.now()
    this.queueSitTime = 6000 // todo make this a setting. and tie in with the value in consensus
    // this.syncSettleTime = 8000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later
    this.syncSettleTime = this.queueSitTime + 2000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later
    this.newAcceptedTxQueue = []
    this.newAcceptedTxQueueTempInjest = []
    /** @type {QueueEntry[]} */
    this.archivedQueueEntries = []
    /** @type {number} archivedQueueEntryMaxCount is a maximum amount of queue entries to store, usually we should never have this many stored since tx age will be used to clean up the list  */
    this.archivedQueueEntryMaxCount = 50000
    this.newAcceptedTxQueueRunning = false
    //this.dataSyncMainPhaseComplete = false
    this.queueEntryCounter = 0
    this.queueRestartCounter = 0
    this.lastSeenAccountsMap = null

    this.appFinishedSyncing = false
    this.syncPartitionsStarted = false

    this.extensiveRangeChecking = true

    //BLOCK2
    // /** @type {SyncTracker[]} */
    // this.syncTrackers = []
    // this.runtimeSyncTrackerSyncing = false

    //this.globalAccountsSynced = false
    this.knownGlobals = {}
    this.hasknownGlobals = false

    //BLOCK3
    this.dataPhaseTag = 'DATASYNC: '
    this.applySoftLock = false

    //BLOCK4
    this.useHashSets = true
    this.lastActiveNodeCount = 0
    this.queueStopped = false
    this.extendedRepairLogging = true
    this.shardInfo = {}
    /** @type {Map<number, CycleShardData>} */
    this.shardValuesByCycle = new Map()
    this.currentCycleShardData = null as CycleShardData | null
    // this.syncTrackerIndex = 1 // increments up for each new sync tracker we create gets maped to calls.
    this.preTXQueue = []
    //this.readyforTXs = false

    this.sleepInterrupt = undefined
    this.lastCycleReported = -1
    this.partitionReportDirty = false
    this.nextCycleReportToSend = null

    this.configsInit()
    
    //INIT our various modules

    this.stateManagerCache = new StateManagerCache(verboseLogs, profiler, app, logger, crypto, config)

    this.stateManagerStats = new StateManagerStats(verboseLogs, profiler, app, logger, crypto, config, this.stateManagerCache)
    this.stateManagerStats.summaryPartitionCount = 32
    this.stateManagerStats.initSummaryBlobs()

    this.stateManagerSync = new StateManagerSync(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)

    this.accountGlobals = new AccountGlobals(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)
    this.transactionQueue = new TransactionQueue(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)
    this.transactionRepair = new TransactionRepair(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)
    this.transactionConsenus = new TransactionConsenus(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)
    this.partitionObjects = new PartitionObjects(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)



    // feature controls.
    this.oldFeature_TXHashsetTest = true
    this.oldFeature_GeneratePartitionReport = false
    this.oldFeature_BroadCastPartitionReport = true // leaving this true since it depends on the above value

    this.feature_receiptMapResults = true
    this.feature_partitionHashes = true
    this.feature_generateStats = true

    this.feature_useNewParitionReport = true

    this.debugFeature_dumpAccountData = true
    this.debugFeature_dumpAccountDataFromSQL = false
    this.debugFeatureOld_partitionReciepts = true

    this.stateIsGood_txHashsetOld = true
    this.stateIsGood_activeRepairs = true
    this.stateIsGood = true

    // other debug features
    if (this.config && this.config.debug) {
      this.feature_useNewParitionReport = this.tryGetBoolProperty(this.config.debug, 'useNewParitionReport', this.feature_useNewParitionReport)

      this.oldFeature_GeneratePartitionReport = this.tryGetBoolProperty(this.config.debug, 'oldPartitionSystem', this.oldFeature_GeneratePartitionReport)

      this.debugFeature_dumpAccountDataFromSQL = this.tryGetBoolProperty(this.config.debug, 'dumpAccountReportFromSQL', this.debugFeature_dumpAccountDataFromSQL)
    }

    // the original way this was setup was to reset and apply repair results one partition at a time.
    // this could create issue if we have a TX spanning multiple paritions that are locally owned.
    this.resetAndApplyPerPartition = false
    /** @type {RepairTracker[]} */
    this.dataRepairStack = []
    /** @type {number} */
    this.dataRepairsCompleted = 0
    /** @type {number} */
    this.dataRepairsStarted = 0
    this.repairAllStoredPartitions = true
    this.repairStartedMap = new Map()
    this.repairCompletedMap = new Map()
    /** @type {Object.<string, PartitionReceipt[]>} a map of cycle keys to lists of partition receipts.  */
    this.partitionReceiptsByCycleCounter = {}
    /** @type {Object.<string, PartitionReceipt>} a map of cycle keys to lists of partition receipts.  */
    this.ourPartitionReceiptsByCycleCounter = {}
    this.doDataCleanup = true
    this.sendArchiveData = false
    this.purgeArchiveData = false
    this.sentReceipts = new Map()


    //Fifo locks.
    this.fifoLocks = {}

    // Init data sync structures!
    this.partitionObjectsByCycle = {}
    this.ourPartitionResultsByCycle = {}
    this.repairTrackingByCycleById = {}
    this.repairUpdateDataByCycle = {}
    this.applyAllPreparedRepairsRunning = false
    this.recentPartitionObjectsByCycleByHash = {}
    this.tempTXRecords = []
    this.txByCycleByPartition = {}
    this.allPartitionResponsesByCycleByPartition = {}

    this.globalAccountMap = new Map()

    this.debugTXHistory = {}

    // debug hack
    if (p2p == null) {
      return
    }

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')

    ShardFunctions2.logger = logger
    ShardFunctions2.fatalLogger = this.fatalLogger
    ShardFunctions2.mainLogger = this.mainLogger

    this.clearPartitionData()

    this.registerEndpoints()

    this.stateManagerSync.isSyncingAcceptedTxs = true // default is true so we will start adding to our tx queue asap
    this.verboseLogs = false
    if (this.mainLogger && ['TRACE'].includes(this.mainLogger.level.levelStr)) {
      this.verboseLogs = true
    }

    this.startShardCalculations()
    
    if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('canDataRepair', `0`, `canDataRepair: ${this.canDataRepair}  `)
  }

  configsInit(){
    this.canDataRepair = false
    // this controls the repair portion of data repair.
    if (this.config && this.config.debug) {
      this.canDataRepair = this.config.debug.canDataRepair
      if (this.canDataRepair == null) {
        this.canDataRepair = false
      }
    }
    this.debugNoTxVoting = false
    // this controls the repair portion of data repair.
    if (this.config && this.config.debug) {
      this.debugNoTxVoting = this.config.debug.debugNoTxVoting
      if (this.debugNoTxVoting == null) {
        this.debugNoTxVoting = false
      }
    }

    this.ignoreRecieptChance = 0
    if (this.config && this.config.debug) {
      this.ignoreRecieptChance = this.config.debug.ignoreRecieptChance
      if (this.ignoreRecieptChance == null) {
        this.ignoreRecieptChance = 0
      }
    }

    this.ignoreVoteChance = 0
    if (this.config && this.config.debug) {
      this.ignoreVoteChance = this.config.debug.ignoreVoteChance
      if (this.ignoreVoteChance == null) {
        this.ignoreVoteChance = 0
      }
    }

    this.loseTxChance = 0
    if (this.config && this.config.debug) {
      this.loseTxChance = this.config.debug.loseTxChance
      if (this.loseTxChance == null) {
        this.loseTxChance = 0
      }
    }

    this.failReceiptChance = 0
    if (this.config && this.config.debug) {
      this.failReceiptChance = this.config.debug.failReceiptChance
      if (this.failReceiptChance == null) {
        this.failReceiptChance = 0
      }
    }

    this.voteFlipChance = 0
    if (this.config && this.config.debug) {
      this.voteFlipChance = this.config.debug.voteFlipChance
      if (this.voteFlipChance == null) {
        this.voteFlipChance = 0
      }
    }


  }



/***
 *     ######  ##     ##    ###    ########  ########         ######     ###    ##        ######   ######  
 *    ##    ## ##     ##   ## ##   ##     ## ##     ##       ##    ##   ## ##   ##       ##    ## ##    ## 
 *    ##       ##     ##  ##   ##  ##     ## ##     ##       ##        ##   ##  ##       ##       ##       
 *     ######  ######### ##     ## ########  ##     ##       ##       ##     ## ##       ##        ######  
 *          ## ##     ## ######### ##   ##   ##     ##       ##       ######### ##       ##             ## 
 *    ##    ## ##     ## ##     ## ##    ##  ##     ##       ##    ## ##     ## ##       ##    ## ##    ## 
 *     ######  ##     ## ##     ## ##     ## ########         ######  ##     ## ########  ######   ######  
 */
  // This is called once per cycle to update to calculate the necessary shard values.
  updateShardValues(cycleNumber: number) {
    if (this.currentCycleShardData == null) {
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_sync_firstCycle', `${cycleNumber}`, ` first init `)
    }

    let cycleShardData = {} as CycleShardData

    // todo get current cycle..  store this by cycle?
    cycleShardData.nodeShardDataMap = new Map()
    cycleShardData.parititionShardDataMap = new Map()

    //this.p2p.state.getActiveNodes(null)
    cycleShardData.activeNodes = this.p2p.state.getActiveNodes(null) //this.p2p.getActiveNodes(null)  //this.p2p.state.getActiveNodes(null)
    // cycleShardData.activeNodes.sort(utils.sort_id_Asc) // function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })

    cycleShardData.cycleNumber = cycleNumber

    cycleShardData.partitionsToSkip = new Map()

    cycleShardData.hasCompleteData = false

    try {
      cycleShardData.ourNode = this.p2p.state.getNode(this.p2p.id) // ugh, I bet there is a nicer way to get our node
    } catch (ex) {
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_sync_notactive', `${cycleNumber}`, `  `)
      return
    }

    if (cycleShardData.activeNodes.length === 0) {
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_sync_noNodeListAvailable', `${cycleNumber}`, `  `)
      return // no active nodes so stop calculating values
    }

    if (this.config == null || this.config.sharding == null) {
      throw new Error('this.config.sharding == null')
    }

    let cycle = this.p2p.state.getLastCycle()
    if (cycle != null) {
      cycleShardData.timestamp = cycle.start * 1000
      cycleShardData.timestampEndCycle = (cycle.start + cycle.duration) * 1000
    }

    let edgeNodes = this.config.sharding.nodesPerConsensusGroup as number

    // save this per cycle?
    cycleShardData.shardGlobals = ShardFunctions.calculateShardGlobals(cycleShardData.activeNodes.length, this.config.sharding.nodesPerConsensusGroup as number, edgeNodes)

    // partition shard data
    ShardFunctions.computePartitionShardDataMap(cycleShardData.shardGlobals, cycleShardData.parititionShardDataMap, 0, cycleShardData.shardGlobals.numPartitions)

    // generate limited data for all nodes data for all nodes.
    ShardFunctions.computeNodePartitionDataMap(cycleShardData.shardGlobals, cycleShardData.nodeShardDataMap, cycleShardData.activeNodes, cycleShardData.parititionShardDataMap, cycleShardData.activeNodes, false)

    // get extended data for our node
    cycleShardData.nodeShardData = ShardFunctions.computeNodePartitionData(cycleShardData.shardGlobals, cycleShardData.ourNode, cycleShardData.nodeShardDataMap, cycleShardData.parititionShardDataMap, cycleShardData.activeNodes, true)

    // generate full data for nodes that store our home partition
    ShardFunctions.computeNodePartitionDataMap(cycleShardData.shardGlobals, cycleShardData.nodeShardDataMap, cycleShardData.nodeShardData.nodeThatStoreOurParitionFull, cycleShardData.parititionShardDataMap, cycleShardData.activeNodes, true)

    // cycleShardData.nodeShardData = cycleShardData.nodeShardDataMap.get(cycleShardData.ourNode.id)

    // generate lightweight data for all active nodes  (note that last parameter is false to specify the lightweight data)
    let fullDataForDebug = true // Set this to false for performance reasons!!! setting it to true saves us from having to recalculate stuff when we dump logs.
    ShardFunctions.computeNodePartitionDataMap(cycleShardData.shardGlobals, cycleShardData.nodeShardDataMap, cycleShardData.activeNodes, cycleShardData.parititionShardDataMap, cycleShardData.activeNodes, fullDataForDebug)

    // TODO if fullDataForDebug gets turned false we will update the guts of this calculation
    ShardFunctions.computeNodePartitionDataMapExt(cycleShardData.shardGlobals, cycleShardData.nodeShardDataMap, cycleShardData.activeNodes, cycleShardData.parititionShardDataMap, cycleShardData.activeNodes)

    this.currentCycleShardData = cycleShardData
    this.shardValuesByCycle.set(cycleNumber, cycleShardData)

    // calculate nodes that would just now start syncing edge data because the network shrank.
    if (cycleShardData.ourNode.status === 'active') {
      // calculate if there are any nearby nodes that are syncing right now.
      if (this.verboseLogs) this.mainLogger.debug(`updateShardValues: getOrderedSyncingNeighbors`)
      cycleShardData.syncingNeighbors = this.p2p.state.getOrderedSyncingNeighbors(cycleShardData.ourNode)

      if (cycleShardData.syncingNeighbors.length > 0) {
        cycleShardData.syncingNeighborsTxGroup = [...cycleShardData.syncingNeighbors]
        cycleShardData.syncingNeighborsTxGroup.push(cycleShardData.ourNode)
        cycleShardData.hasSyncingNeighbors = true

        if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_sync_neighbors', `${cycleShardData.cycleNumber}`, ` neighbors: ${utils.stringifyReduce(cycleShardData.syncingNeighbors.map((node) => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
      } else {
        cycleShardData.hasSyncingNeighbors = false
      }

      console.log(`updateShardValues  cycle:${cycleShardData.cycleNumber} `)

      // if (this.preTXQueue.length > 0) {
      //   for (let tx of this.preTXQueue) {
      //     if (this.logger.playbackLogEnabled ) this.logger.playbackLogNote('shrd_sync_preTX', ` `, ` ${utils.stringifyReduce(tx)} `)
      //     this.routeAndQueueAcceptedTransaction(tx, false, null)
      //   }
      //   this.preTXQueue = []
      // }

      this.stateManagerSync.updateRuntimeSyncTrackers()

      // this.calculateChangeInCoverage()
    }

    // calculate our consensus partitions for use by data repair:
    // cycleShardData.ourConsensusPartitions = []
    let partitions = ShardFunctions.getConsenusPartitionList(cycleShardData.shardGlobals, cycleShardData.nodeShardData)
    cycleShardData.ourConsensusPartitions = partitions

    let partitions2 = ShardFunctions.getStoredPartitionList(cycleShardData.shardGlobals, cycleShardData.nodeShardData)
    cycleShardData.ourStoredPartitions = partitions2

    // this will be a huge log.
    // Temp disable for log size
    // if (this.logger.playbackLogEnabled ) this.logger.playbackLogNote('shrd_sync_cycleData', `${cycleNumber}`, ` cycleShardData: cycle:${cycleNumber} data: ${utils.stringifyReduce(cycleShardData)}`)

    cycleShardData.hasCompleteData = true
  }

  /**
   * getShardDataForCycle
   * @param {number} cycleNumber
   * @returns {CycleShardData}
   */
  getShardDataForCycle(cycleNumber: number): CycleShardData | null {
    if (this.shardValuesByCycle == null) {
      return null
    }
    let shardData = this.shardValuesByCycle.get(cycleNumber)
    //kind of silly but dealing with undefined response from get TSConversion: todo investigate merit of |null vs. |undefined conventions
    if (shardData != null) {
      return shardData
    }
    return null
  }

  calculateChangeInCoverage(): void {
    // maybe this should be a shard function so we can run unit tests on it for expanding or shrinking networks!
    let newSharddata = this.currentCycleShardData

    if (newSharddata == null || this.currentCycleShardData == null) {
      return
    }

    let oldShardData = this.shardValuesByCycle.get(newSharddata.cycleNumber - 1)

    if (oldShardData == null) {
      // log ?
      return
    }
    let cycle = this.currentCycleShardData.cycleNumber
    // oldShardData.shardGlobals, newSharddata.shardGlobals
    let coverageChanges = ShardFunctions.computeCoverageChanges(oldShardData.nodeShardData, newSharddata.nodeShardData)

    for (let change of coverageChanges) {
      // log info about the change.
      // ${utils.stringifyReduce(change)}
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_sync_change', `${oldShardData.cycleNumber}->${newSharddata.cycleNumber}`, ` ${ShardFunctions.leadZeros8(change.start.toString(16))}->${ShardFunctions.leadZeros8(change.end.toString(16))} `)

      // create a range object from our coverage change.

      let range = { startAddr: 0, endAddr: 0, low: '', high: '' } as BasicAddressRange // this init is a somewhat wastefull way to allow the type to be happy.
      range.startAddr = change.start
      range.endAddr = change.end
      range.low = ShardFunctions.leadZeros8(range.startAddr.toString(16)) + '0'.repeat(56)
      range.high = ShardFunctions.leadZeros8(range.endAddr.toString(16)) + 'f'.repeat(56)
      // create sync trackers
      this.stateManagerSync.createSyncTrackerByRange(range, cycle)
    }

    if (coverageChanges.length > 0) {
      this.stateManagerSync.syncRuntimeTrackers()
    }
    // launch sync trackers
    // coverage changes... should have a list of changes
    // should note if the changes are an increase or reduction in covered area.
    // log the changes.
    // next would be to create some syncTrackers based to cover increases
  }

  getCurrentCycleShardData(): CycleShardData | null {
    if (this.currentCycleShardData === null) {
      let cycle = this.p2p.state.getLastCycle()
      if (cycle == null) {
        return null
      }
      this.updateShardValues(cycle.counter)
    }

    return this.currentCycleShardData
  }

  hasCycleShardData() {
    return this.currentCycleShardData != null
  }

  async waitForShardCalcs() {
    while (this.currentCycleShardData == null) {
      this.getCurrentCycleShardData()
      await utils.sleep(1000)
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_sync_waitForShardData_firstNode', ``, ` ${utils.stringifyReduce(this.currentCycleShardData)} `)
    }
  }

  /***
   *    ##     ## ######## #### ##        ######
   *    ##     ##    ##     ##  ##       ##    ##
   *    ##     ##    ##     ##  ##       ##
   *    ##     ##    ##     ##  ##        ######
   *    ##     ##    ##     ##  ##             ##
   *    ##     ##    ##     ##  ##       ##    ##
   *     #######     ##    #### ########  ######
   */
  // todo refactor: this into a util, grabbed it from p2p
  // From: https://stackoverflow.com/a/12646864
  shuffleArray(array: any[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[array[i], array[j]] = [array[j], array[i]]
    }
  }

  debugNodeGroup(key, key2, msg, nodes) {
    if (this.logger.playbackLogEnabled)
      this.logger.playbackLogNote(
        'debugNodeGroup',
        `${utils.stringifyReduce(key)}_${key2}`,
        `${msg} ${utils.stringifyReduce(
          nodes.map((node) => {
            return { id: node.id, port: node.externalPort }
          })
        )}`
      )
  }

  getRandomInt(max: number): number {
    return Math.floor(Math.random() * Math.floor(max))
  }

  tryGetBoolProperty(parent: any, propertyName: string, defaultValue: boolean) {
    if (parent == null) {
      return defaultValue
    }
    let tempValue = parent[propertyName]
    if (tempValue === true || tempValue === false) {
      return tempValue
    }
    return defaultValue
  }


  testFailChance(failChance: number, debugName: string, key: string, message: string, verboseRequired: boolean): boolean {
    if (failChance == null) {
      return false
    }

    let rand = Math.random()
    if (failChance > rand) {
      if (debugName != null) {
        if (verboseRequired === false || this.verboseLogs) {
          this.logger.playbackLogNote(`dbg_fail_${debugName}`, key, message)
        }
      }
      return true
    }
    return false
  }

  interruptibleSleep(ms: number, targetTime: number) {
    let resolveFn: any = null //TSConversion just setting this to any for now.
    let promise = new Promise((resolve) => {
      resolveFn = resolve
      setTimeout(resolve, ms)
    })
    return { promise, resolveFn, targetTime }
  }

  interruptSleepIfNeeded(targetTime: number) {
    if (this.sleepInterrupt) {
      if (targetTime < this.sleepInterrupt.targetTime) {
        this.sleepInterrupt.resolveFn()
      }
    }
  }

  // getRandomIndex (list: any[]) {
  //   let max = list.length - 1
  //   return Math.floor(Math.random() * Math.floor(max))
  // }

  // todo need a faster more scalable version of this if we get past afew hundred nodes.
  // getActiveNodesInRange (lowAddress: string, highAddress: string, exclude = []): Shardus.Node[] {
  //   let allNodes = this.p2p.state.getActiveNodes(this.p2p.id) as Shardus.Node[]
  //   this.lastActiveNodeCount = allNodes.length
  //   let results = [] as Shardus.Node[]
  //   let count = allNodes.length
  //   for (const node of allNodes) {
  //     if (node.id >= lowAddress && node.id <= highAddress) {
  //       if ((exclude.includes(node.id)) === false) {
  //         results.push(node)
  //         if (results.length >= count) {
  //           return results
  //         }
  //       }
  //     }
  //   }
  //   return results
  // }

  // todo refactor: move to p2p?
  getRandomNodesInRange(count: number, lowAddress: string, highAddress: string, exclude: string[]): Shardus.Node[] {
    let allNodes = this.p2p.state.getActiveNodes(this.p2p.id)
    this.lastActiveNodeCount = allNodes.length
    this.shuffleArray(allNodes)
    let results = [] as Shardus.Node[]
    if (allNodes.length <= count) {
      count = allNodes.length
    }
    for (const node of allNodes) {
      if (node.id >= lowAddress && node.id <= highAddress) {
        if (exclude.includes(node.id) === false) {
          results.push(node)
          if (results.length >= count) {
            return results
          }
        }
      }
    }
    return results
  }

  async startCatchUpQueue() {
    await this._firstTimeQueueAwait()

    console.log('syncStateData startCatchUpQueue ' + '   time:' + Date.now())

    // all complete!
    this.mainLogger.debug(`DATASYNC: complete`)
    this.logger.playbackLogState('datasyncComplete', '', '')

    // update the debug tag and restart the queue
    this.dataPhaseTag = 'ACTIVE: ' // 'STATESYNC: '
    this.stateManagerSync.dataSyncMainPhaseComplete = true
    this.tryStartAcceptedQueue()

    if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_sync_mainphaseComplete', ` `, `  `)
  }

  // just a placeholder for later
  recordPotentialBadnode() {
    // The may need to live on the p2p class, or call into it
    // record the evidence.
    // potentially report it
  }

  /**
   * writeCombinedAccountDataToBackups
   * @param failedHashes This is a list of hashes that failed and should be ignored in the write operation.
   */
  async writeCombinedAccountDataToBackups(goodAccounts: Shardus.WrappedData[], failedHashes: string[]) {
    // ?:{[id:string]: boolean}
    if (failedHashes.length === 0 && goodAccounts.length === 0) {
      return // nothing to do yet
    }

    let failedAccountsById: { [id: string]: boolean } = {}
    for (let hash of failedHashes) {
      failedAccountsById[hash] = true
    }

    const lastCycle = this.p2p.state.getLastCycle()
    let cycleNumber = lastCycle.counter
    let accountCopies: AccountCopy[] = []
    for (let accountEntry of goodAccounts) {
      // check failed hashes
      if (failedAccountsById[accountEntry.stateId]) {
        continue
      }
      // wrappedAccounts.push({ accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp })
      const isGlobal = this.isGlobalAccount(accountEntry.accountId)
      let accountCopy: AccountCopy = {
        accountId: accountEntry.accountId,
        data: accountEntry.data,
        timestamp: accountEntry.timestamp,
        hash: accountEntry.stateId,
        cycleNumber,
        isGlobal: isGlobal || false,
      }
      accountCopies.push(accountCopy)
    }
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'writeCombinedAccountDataToBackups ' + accountCopies.length + ' ' + utils.stringifyReduce(accountCopies))

    if (this.verboseLogs) console.log('DBG accountCopies.  (in main log)')

    // await this.storage.createAccountCopies(accountCopies)
    await this.storage.createOrReplaceAccountCopy(accountCopies)
  }

  // This will make calls to app.getAccountDataByRange but if we are close enough to real time it will query any newer data and return lastUpdateNeeded = true
  async getAccountDataByRangeSmart(accountStart: string, accountEnd: string, tsStart: number, maxRecords: number): Promise<GetAccountDataByRangeSmart> {
    let tsEnd = Date.now()
    let wrappedAccounts = await this.app.getAccountDataByRange(accountStart, accountEnd, tsStart, tsEnd, maxRecords)
    let lastUpdateNeeded = false
    let wrappedAccounts2: WrappedStateArray = []
    let highestTs = 0
    // do we need more updates
    if (wrappedAccounts.length === 0) {
      lastUpdateNeeded = true
    } else {
      // see if our newest record is new enough
      highestTs = 0
      for (let account of wrappedAccounts) {
        if (account.timestamp > highestTs) {
          highestTs = account.timestamp
        }
      }
      let delta = tsEnd - highestTs
      // if the data we go was close enough to current time then we are done
      // may have to be carefull about how we tune this value relative to the rate that we make this query
      // we should try to make this query more often then the delta.
      if (this.verboseLogs) console.log('delta ' + delta)
      if (delta < this.queueSitTime) {
        let tsStart2 = highestTs
        wrappedAccounts2 = await this.app.getAccountDataByRange(accountStart, accountEnd, tsStart2, Date.now(), 10000000)
        lastUpdateNeeded = true
      }
    }
    return { wrappedAccounts, lastUpdateNeeded, wrappedAccounts2, highestTs }
  }

  testAccountDataWrapped(accountDataList: Shardus.WrappedData[]) {
    if (accountDataList == null) {
      return
    }
    for (let wrappedData of accountDataList) {
      let { accountId, stateId, data: recordData } = wrappedData
      //stateId = wrappedData.stateId
      if (stateId != wrappedData.stateId) {
        this.mainLogger.error(`testAccountDataWrapped what is going on!!:  ${utils.makeShortHash(wrappedData.stateId)}  stateId: ${utils.makeShortHash(stateId)} `)
      }
      let hash = this.app.calculateAccountHash(recordData)
      if (stateId !== hash) {
        this.mainLogger.error(`testAccountDataWrapped hash test failed: setAccountData for account ${utils.makeShortHash(accountId)} expected account hash: ${utils.makeShortHash(stateId)} got ${utils.makeShortHash(hash)} `)
        this.mainLogger.error('testAccountDataWrapped hash test failed: details: ' + stringify(recordData))
        this.mainLogger.error('testAccountDataWrapped hash test failed: wrappedData.stateId: ' + utils.makeShortHash(wrappedData.stateId))
        var stack = new Error().stack
        this.mainLogger.error(`stack: ${stack}`)
      }
    }
  }

  // TSConversion TODO need to fix some any types
  async checkAndSetAccountData(accountRecords: Shardus.WrappedData[], note: string, initStats: boolean): Promise<string[]> {
    let accountsToAdd: any[] = []
    let failedHashes: string[] = []
    for (let wrapedAccount of accountRecords) {
      let { accountId, stateId, data: recordData } = wrapedAccount
      let hash = this.app.calculateAccountHash(recordData)
      if (stateId === hash) {
        // if (recordData.owners) recordData.owners = JSON.parse(recordData.owners)
        // if (recordData.data) recordData.data = JSON.parse(recordData.data)
        // if (recordData.txs) recordData.txs = JSON.parse(recordData.txs) // dont parse this, since it is already the string form we need to write it.
        accountsToAdd.push(recordData)
        let debugString = `setAccountData: note:${note} acc: ${utils.makeShortHash(accountId)} hash: ${utils.makeShortHash(hash)}`
        this.mainLogger.debug(debugString)
        if (this.verboseLogs) console.log(debugString)

        if (initStats) {
          // todo perf, evaluate getCycleNumberFromTimestamp for really old timestamps.
          // the algorithims may run worst case for old cycles.
          let cycleToRecordOn = this.getCycleNumberFromTimestamp(wrapedAccount.timestamp)
          this.stateManagerStats.statsDataSummaryInit(cycleToRecordOn, wrapedAccount)
        }
      } else {
        this.mainLogger.error(`setAccountData hash test failed: setAccountData for account ${utils.makeShortHash(accountId)} expected account hash: ${utils.makeShortHash(stateId)} got ${utils.makeShortHash(hash)} `)
        this.mainLogger.error('setAccountData hash test failed: details: ' + utils.stringifyReduce(recordData))
        if (this.verboseLogs) console.log(`setAccountData hash test failed: setAccountData for account ${utils.makeShortHash(accountId)} expected account hash: ${utils.makeShortHash(stateId)} got ${utils.makeShortHash(hash)} `)
        if (this.verboseLogs) console.log('setAccountData hash test failed: details: ' + utils.stringifyReduce(recordData))
        failedHashes.push(accountId)
      }
    }
    this.mainLogger.debug(`setAccountData toAdd:${accountsToAdd.length}  failed:${failedHashes.length}`)
    if (this.verboseLogs) console.log(`setAccountData toAdd:${accountsToAdd.length}  failed:${failedHashes.length}`)
    await this.app.setAccountData(accountsToAdd)
    return failedHashes
  }

  /***
   *    ######## ##    ## ########  ########   #######  #### ##    ## ########  ######
   *    ##       ###   ## ##     ## ##     ## ##     ##  ##  ###   ##    ##    ##    ##
   *    ##       ####  ## ##     ## ##     ## ##     ##  ##  ####  ##    ##    ##
   *    ######   ## ## ## ##     ## ########  ##     ##  ##  ## ## ##    ##     ######
   *    ##       ##  #### ##     ## ##        ##     ##  ##  ##  ####    ##          ##
   *    ##       ##   ### ##     ## ##        ##     ##  ##  ##   ###    ##    ##    ##
   *    ######## ##    ## ########  ##         #######  #### ##    ##    ##     ######
   */

  _registerListener(emitter: any, event: string, callback: any) {
    if (this._listeners[event]) {
      this.statemanager_fatal(`_registerListener_dupes`, 'State Manager can only register one listener per event!')
      return
    }
    emitter.on(event, callback)
    this._listeners[event] = [emitter, callback]
  }

  _unregisterListener(event: string) {
    if (!this._listeners[event]) {
      this.mainLogger.warn(`This event listener doesn't exist! Event: \`${event}\` in StateManager`)
      return
    }
    const entry = this._listeners[event]
    const [emitter, callback] = entry
    emitter.removeListener(event, callback)
    delete this._listeners[event]
  }

  _cleanupListeners() {
    for (const event of Object.keys(this._listeners)) {
      this._unregisterListener(event)
    }
  }



  registerEndpoints() {
    // alternatively we would need to query for accepted tx.

    // This endpoint will likely be a one off thing so that we can test before milesone 15.  after milesone 15 the accepted TX may flow from the consensus coordinator

    // After joining the network
    //   Record Joined timestamp
    //   Even a syncing node will receive accepted transactions
    //   Starts receiving accepted transaction and saving them to Accepted Tx Table
    this.p2p.registerGossipHandler('acceptedTx', async (acceptedTX: AcceptedTx, sender: Shardus.Node, tracker: string) => {
      // docs mention putting this in a table but it seems so far that an in memory queue should be ok
      // should we filter, or instead rely on gossip in to only give us TXs that matter to us?

      this.p2p.sendGossipIn('acceptedTx', acceptedTX, tracker, sender)

      let noConsensus = false // this can only be true for a set command which will never come from an endpoint
      this.routeAndQueueAcceptedTransaction(acceptedTX, /*sendGossip*/ false, sender, /*globalModification*/ false, noConsensus)
      //Note await not needed so beware if you add code below this.
    })

    // /get_account_state_hash (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns a single hash of the data from the Account State Table determined by the input parameters; sort by Tx_ts  then Tx_id before taking the hash
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state_hash', async (payload: AccountStateHashReq, respond: (arg0: AccountStateHashResp) => any) => {
      let result = {} as AccountStateHashResp

      // yikes need to potentially hash only N records at a time and return an array of hashes
      let stateHash = await this.getAccountsStateHash(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd)
      result.stateHash = stateHash
      await respond(result)
    })

    //    /get_account_state (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns data from the Account State Table determined by the input parameters; limits result to 1000 records (as configured)
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state', async (payload: GetAccountStateReq, respond: (arg0: { accountStates: Shardus.StateTableObject[] }) => any) => {
      let result = {} as { accountStates: Shardus.StateTableObject[] }

      if (this.config.stateManager == null) {
        throw new Error('this.config.stateManager == null') //TODO TSConversion  would be nice to eliminate some of these config checks.
      }

      // max records set artificially low for better test coverage
      // todo m11: make configs for how many records to query
      let accountStates = await this.storage.queryAccountStateTable(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd, this.config.stateManager.stateTableBucketSize)
      result.accountStates = accountStates
      await respond(result)
    })

    // /get_accepted_transactions (Ts_start, Ts_end)
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns data from the Accepted Tx Table starting with Ts_start; limits result to 500 records (as configured)
    // Updated names: tsStart, tsEnd
    this.p2p.registerInternal('get_accepted_transactions', async (payload: AcceptedTransactionsReq, respond: (arg0: { transactions: Shardus.AcceptedTx[] }) => any) => {
      let result = {} as { transactions: Shardus.AcceptedTx[] }

      if (!payload.limit) {
        payload.limit = 10
      }
      let transactions = await this.storage.queryAcceptedTransactions(payload.tsStart, payload.tsEnd, payload.limit)
      result.transactions = transactions
      await respond(result)
    })

    // /get_account_data (Acc_start, Acc_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Returns data from the application Account Table; limits result to 300 records (as configured);
    // For applications with multiple “Account” tables the returned data is grouped by table name.
    // For example: [ {Acc_id, State_after, Acc_data}, { … }, ….. ]
    // Updated names:  accountStart , accountEnd
    this.p2p.registerInternal('get_account_data', async (payload: GetAccountDataReq, respond: (arg0: { accountData: Shardus.WrappedData[] | null }) => any) => {
      throw new Error('get_account_data endpoint retired')

      // let result = {} as {accountData: Shardus.WrappedData[] | null}//TSConversion  This is complicated !! check app for details.
      // let accountData = null
      // let ourLockID = -1
      // try {
      //   ourLockID = await this.fifoLock('accountModification')
      //   accountData = await this.app.getAccountData(payload.accountStart, payload.accountEnd, payload.maxRecords)
      // } finally {
      //   this.fifoUnlock('accountModification', ourLockID)
      // }
      // //PERF Disiable this in production or performance testing.
      // this.testAccountDataWrapped(accountData)
      // result.accountData = accountData
      // await respond(result)
    })

    this.p2p.registerInternal('get_account_data2', async (payload: GetAccountData2Req, respond: (arg0: { accountData: Shardus.WrappedData[] | null }) => any) => {
      let result = {} as { accountData: Shardus.WrappedData[] | null } //TSConversion  This is complicated !!
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountDataByRange(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd, payload.maxRecords)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      //PERF Disiable this in production or performance testing.
      this.testAccountDataWrapped(accountData)
      result.accountData = accountData
      await respond(result)
    })

    this.p2p.registerInternal('get_account_data3', async (payload: GetAccountData3Req, respond: (arg0: { data: GetAccountDataByRangeSmart }) => any) => {
      let result = {} as { data: GetAccountDataByRangeSmart } //TSConversion  This is complicated !!(due to app wrapping)  as {data: Shardus.AccountData[] | null}
      let accountData: GetAccountDataByRangeSmart | null = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        // returns { wrappedAccounts, lastUpdateNeeded, wrappedAccounts2, highestTs }
        //GetAccountDataByRangeSmart
        accountData = await this.getAccountDataByRangeSmart(payload.accountStart, payload.accountEnd, payload.tsStart, payload.maxRecords)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }

      //PERF Disiable this in production or performance testing.
      this.testAccountDataWrapped(accountData.wrappedAccounts)
      //PERF Disiable this in production or performance testing.
      this.testAccountDataWrapped(accountData.wrappedAccounts2)

      result.data = accountData
      await respond(result)
    })

    // /get_account_data_by_list (Acc_ids)
    // Acc_ids - array of accounts to get
    // Returns data from the application Account Table for just the given account ids;
    // For applications with multiple “Account” tables the returned data is grouped by table name.
    // For example: [ {Acc_id, State_after, Acc_data}, { … }, ….. ]
    // Updated names:  accountIds, max records
    this.p2p.registerInternal('get_account_data_by_list', async (payload: { accountIds: any }, respond: (arg0: { accountData: Shardus.WrappedData[] | null }) => any) => {
      let result = {} as { accountData: Shardus.WrappedData[] | null }
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountDataByList(payload.accountIds)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      //PERF Disiable this in production or performance testing.
      this.testAccountDataWrapped(accountData)
      result.accountData = accountData
      await respond(result)
    })

    // /post_partition_results (Partition_results)
    //   Partition_results - array of objects with the fields {Partition_id, Cycle_number, Partition_hash, Node_id, Node_sign}
    //   Returns nothing

    this.p2p.registerInternal(
      'post_partition_results',
      /**
       * This is how to typedef a callback!
       * @param {{ partitionResults: PartitionResult[]; Cycle_number: number; }} payload
       * @param {any} respond TSConversion is it ok to just set respond to any?
       */
      async (payload: PosPartitionResults, respond: any) => {
        // let result = {}
        // let ourLockID = -1
        try {
          // ourLockID = await this.fifoLock('accountModification')
          // accountData = await this.app.getAccountDataByList(payload.accountIds)

          // Nodes collect the partition result from peers.
          // Nodes may receive partition results for partitions they are not covering and will ignore those messages.
          // Once a node has collected 50% or more peers giving the same partition result it can combine them to create a partition receipt. The node tries to create a partition receipt for all partitions it covers.
          // If the partition receipt has a different partition hash than the node, the node needs to ask one of the peers with the majority partition hash for the partition object and determine the transactions it has missed.
          // If the node is not able to create a partition receipt for a partition, the node needs to ask all peers which have a different partition hash for the partition object and determine the transactions it has missed. Only one peer for each different partition hash needs to be queried. Uses the /get_partition_txids API.
          // If the node has missed some transactions for a partition, the node needs to get these transactions from peers and apply these transactions to affected accounts starting with a known good copy of the account from the end of the last cycle. Uses the /get_transactions_by_list API.
          // If the node applied missed transactions to a partition, then it creates a new partition object, partition hash and partition result.
          // After generating new partition results as needed, the node broadcasts the set of partition results to N adjacent peers on each side; where N is the number of  partitions covered by the node.
          // After receiving new partition results from peers, the node should be able to collect 50% or more peers giving the same partition result and build a partition receipt.
          // Any partition for which the node could not generate a partition receipt, should be logged as a fatal error.
          // Nodes save the partition receipt as proof that the transactions they have applied are correct and were also applied by peers.

          // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results`)

          if (!payload) {
            if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair post_partition_results: abort no payload`)
            return
          }

          let partitionResults = payload.partitionResults
          let cycleKey = 'c' + payload.Cycle_number

          let allResponsesByPartition = this.allPartitionResponsesByCycleByPartition[cycleKey]
          if (!allResponsesByPartition) {
            allResponsesByPartition = {}
            this.allPartitionResponsesByCycleByPartition[cycleKey] = allResponsesByPartition
          }
          let ourPartitionResults = this.ourPartitionResultsByCycle[cycleKey]

          if (!payload.partitionResults) {
            if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair post_partition_results: abort, partitionResults == null`)
            return
          }

          if (payload.partitionResults.length === 0) {
            if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair post_partition_results: abort, partitionResults.length == 0`)
            return
          }

          if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results payload: ${utils.stringifyReduce(payload)}`)

          if (!payload.partitionResults[0].sign) {
            // TODO security need to check that this is signed by a valid and correct node
            if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair post_partition_results: abort, no sign object on partition`)
            return
          }

          let owner = payload.partitionResults[0].sign.owner
          // merge results from this message into our colleciton of allResponses
          for (let partitionResult of partitionResults) {
            let partitionKey1 = 'p' + partitionResult.Partition_id
            let responses = allResponsesByPartition[partitionKey1]
            if (!responses) {
              responses = []
              allResponsesByPartition[partitionKey1] = responses
            }
            // clean out an older response from same node if on exists
            responses = responses.filter((item) => item.sign == null || item.sign.owner !== owner)
            allResponsesByPartition[partitionKey1] = responses // have to re-assign this since it is a new ref to the array

            // add the result ot the list of responses
            if (partitionResult) {
              responses.push(partitionResult)
            } else {
              if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair post_partition_results partitionResult missing`)
            }
            if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results partition: ${partitionResult.Partition_id} responses.length ${responses.length}  cycle:${payload.Cycle_number}`)
          }

          var partitionKeys = Object.keys(allResponsesByPartition)
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results partitionKeys: ${partitionKeys.length}`)

          // Loop through all the partition keys and check our progress for each partition covered
          // todo perf consider only looping through keys of partitions that changed from this update?
          for (let partitionKey of partitionKeys) {
            let responses = allResponsesByPartition[partitionKey]
            // if enough data, and our response is prepped.
            let repairTracker
            let partitionId = null // todo sharding ? need to deal with more that one partition response here!!
            if (responses.length > 0) {
              partitionId = responses[0].Partition_id
              repairTracker = this._getRepairTrackerForCycle(payload.Cycle_number, partitionId)
              if (repairTracker.busy && repairTracker.awaitWinningHash === false) {
                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results tracker busy. ${partitionKey} responses: ${responses.length}.  ${utils.stringifyReduce(repairTracker)}`)
                continue
              }
              if (repairTracker.repairsFullyComplete) {
                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results repairsFullyComplete = true  cycle:${payload.Cycle_number}`)
                continue
              }
            } else {
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results no responses. ${partitionKey} responses: ${responses.length}. repairTracker: ${utils.stringifyReduce(repairTracker)} responsesById: ${utils.stringifyReduce(allResponsesByPartition)}`)
              continue
            }

            let responsesRequired = 3
            if (this.useHashSets) {
              responsesRequired = Math.min(1 + Math.ceil(repairTracker.numNodes * 0.9), repairTracker.numNodes - 1) // get responses from 90% of the node we have sent to
            }
            // are there enough responses to try generating a receipt?
            if (responses.length >= responsesRequired && (repairTracker.evaluationStarted === false || repairTracker.awaitWinningHash)) {
              repairTracker.evaluationStarted = true

              let ourResult = null
              if (ourPartitionResults != null) {
                for (let obj of ourPartitionResults) {
                  if (obj.Partition_id === partitionId) {
                    ourResult = obj
                    break
                  }
                }
              }
              if (ourResult == null) {
                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results our result is not computed yet `)
                // Todo repair : may need to sleep or restart this computation later..
                return
              }

              let receiptResults = this.tryGeneratePartitionReciept(responses, ourResult) // TODO: how to mark block if we are already on a thread for this?
              let { partitionReceipt, topResult, success } = receiptResults
              if (!success) {
                if (repairTracker.awaitWinningHash) {
                  if (topResult == null) {
                    // if we are awaitWinningHash then wait for a top result before we start repair process again
                    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair awaitWinningHash:true but topResult == null so keep waiting `)
                    continue
                  } else {
                    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair awaitWinningHash:true and we have a top result so start reparing! `)
                  }
                }

                if (this.resetAndApplyPerPartition === false && repairTracker.txRepairReady === true) {
                  if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair txRepairReady:true bail here for some strange reason.. not sure aout this yet `)
                  continue
                }

                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results: tryGeneratePartitionReciept failed start repair process 1 ${utils.stringifyReduce(receiptResults)}`)
                let cycle = this.p2p.state.getCycleByCounter(payload.Cycle_number)
                await this.startRepairProcess(cycle, topResult, partitionId, ourResult.Partition_hash)
              } else if (partitionReceipt) {
                // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results: success store partition receipt`)
                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results 3 allFinished, final cycle: ${payload.Cycle_number} hash:${utils.stringifyReduce({ topResult })}`)
                // do we ever send partition receipt yet?
                this.storePartitionReceipt(payload.Cycle_number, partitionReceipt)
                this.repairTrackerMarkFinished(repairTracker, 'post_partition_results')
              }
            } else {
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results not enough responses awaitWinningHash: ${repairTracker.awaitWinningHash} resp: ${responses.length}. required:${responsesRequired} repairTracker: ${utils.stringifyReduce(repairTracker)}`)
            }
            // End of loop over partitions.  Continue looping if there are other partions that we need to check for completion.
          }
        } finally {
          // this.fifoUnlock('accountModification', ourLockID)
        }
        // result.accountData = accountData
        // await respond(result)
      }
    )

    // /get_transactions_by_list (Tx_ids)
    //   Tx_ids - array of transaction ids
    //   Returns data from the Transactions Table for just the given transaction ids
    this.p2p.registerInternal('get_transactions_by_list', async (payload: GetTransactionsByListReq, respond: (arg0: Shardus.AcceptedTx[]) => any) => {
      let result = [] as AcceptedTx[]
      try {
        result = await this.storage.queryAcceptedTransactionsByIds(payload.Tx_ids)
      } finally {
      }
      await respond(result)
    })

    this.p2p.registerInternal('get_transactions_by_partition_index', async (payload: TransactionsByPartitionReq, respond: (arg0: TransactionsByPartitionResp) => any) => {
      // let result = {}

      let passFailList = []
      let statesList = []
      let acceptedTXs = null
      try {
        // let partitionId = payload.partitionId
        let cycle = payload.cycle
        let indicies = payload.tx_indicies
        let hash = payload.hash
        let partitionId = payload.partitionId

        let expectedResults = indicies.length
        let returnedResults = 0
        let key = 'c' + cycle
        let partitionObjectsByHash = this.recentPartitionObjectsByCycleByHash[key]
        if (!partitionObjectsByHash) {
          await respond({ success: false })
        }
        let partitionObject = partitionObjectsByHash[hash]
        if (!partitionObject) {
          await respond({ success: false })
        }
        let txIDList = []
        for (let index of indicies) {
          let txid = partitionObject.Txids[index]
          txIDList.push(txid)
          let passFail = partitionObject.Status[index]
          passFailList.push(passFail)
        }
        for (let index of indicies) {
          let state = partitionObject.States[index]
          statesList.push(state)
          if (state != null) {
            returnedResults++
          }
        }

        if (returnedResults < expectedResults) {
          if (this.verboseLogs) this.mainLogger.error(`get_transactions_by_partition_index failed! returnedResults < expectedResults send ${returnedResults} < ${expectedResults}`)
        }
        acceptedTXs = await this.storage.queryAcceptedTransactionsByIds(txIDList)

        // if (this.verboseLogs) this.mainLogger.error(`get_transactions_by_partition_index failed! returnedResults < expectedResults send2 `)

        if (acceptedTXs != null && acceptedTXs.length < expectedResults) {
          if (this.verboseLogs) this.mainLogger.error(`get_transactions_by_partition_index results ${utils.stringifyReduce(acceptedTXs)} snippets ${utils.stringifyReduce(payload.debugSnippets)} `)
          if (this.verboseLogs) this.mainLogger.error(`get_transactions_by_partition_index results2:${utils.stringifyReduce(acceptedTXs.map((x: Shardus.AcceptedTx) => x.id))} snippets:${utils.stringifyReduce(payload.debugSnippets)} txid:${utils.stringifyReduce(txIDList)} `)

          let acceptedTXsBefore = 0
          if (acceptedTXs != null) {
            acceptedTXsBefore = acceptedTXs.length
          }

          // find an log missing results:
          // for(let txid of txIDList)
          let received: StringBoolObjectMap = {}
          for (let acceptedTX of acceptedTXs) {
            received[acceptedTX.id] = true
          }
          let missingTXs: string[] = []
          let missingTXHash: StringBoolObjectMap = {}
          for (let txid of txIDList) {
            if (received[txid] !== true) {
              missingTXs.push(txid)
              missingTXHash[txid] = true
            }
          }
          let finds = -1
          let txTally = this.getTXList(cycle, partitionId)
          let found = []
          if (txTally) {
            finds = 0
            for (let tx of txTally.txs) {
              if (missingTXHash[tx.id] === true) {
                finds++
                acceptedTXs.push(tx)
                found.push(tx.id)
              }
            }
          }
          if (this.verboseLogs) this.mainLogger.error(`get_transactions_by_partition_index failed! returnedResults < expectedResults send3 ${acceptedTXsBefore} < ${expectedResults} findsFixed: ${finds}  missing: ${utils.stringifyReduce(missingTXs)} found: ${utils.stringifyReduce(found)} acceptedTXs.length updated: ${acceptedTXs.length}`)
        } else {
        }
      } catch (ex) {
        this.statemanager_fatal(`get_transactions_by_partition_index_ex`, 'get_transactions_by_partition_index failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      } finally {
      }
      // TODO fix pass fail sorting.. it is probably all wrong and out of sync, but currently nothing fails.
      await respond({ success: true, acceptedTX: acceptedTXs, passFail: passFailList, statesList: statesList })
    })

    // /get_partition_txids (Partition_id, Cycle_number)
    //   Partition_id
    //   Cycle_number
    //   Returns the partition object which contains the txids along with the status
    this.p2p.registerInternal('get_partition_txids', async (payload: GetPartitionTxidsReq, respond: (arg0: {}) => any) => {
      let result = {}
      try {
        let id = payload.Partition_id
        let key = 'c' + payload.Cycle_number
        let partitionObjects = this.partitionObjectsByCycle[key]
        for (let obj of partitionObjects) {
          if (obj.Partition_id === id) {
            result = obj
          }
        }
      } finally {
      }
      await respond(result)
    })

    // // p2p TELL
    // this.p2p.registerInternal('route_to_home_node', async (payload: RouteToHomeNodeReq, respond: any) => {
    //   // gossip 'spread_tx_to_group' to transaction group
    //   // Place tx in queue (if younger than m)

    //   // make sure we don't already have it
    //   let queueEntry = this.getQueueEntrySafe(payload.txid)//, payload.timestamp)
    //   if (queueEntry) {
    //     return
    //     // already have this in our queue
    //   }

    //   this.routeAndQueueAcceptedTransaction(payload.acceptedTx, true, null, false) // todo pass in sender?

    //   // no response needed?
    // })

    // p2p ASK
    this.p2p.registerInternal('request_state_for_tx', async (payload: RequestStateForTxReq, respond: (arg0: RequestStateForTxResp) => any) => {
      let response: RequestStateForTxResp = { stateList: [], beforeHashes: {}, note: '', success: false }
      // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
      let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.getQueueEntryArchived(payload.txid, 'request_state_for_tx') // , payload.timestamp)
      }

      if (queueEntry == null) {
        response.note = `failed to find queue entry: ${utils.stringifyReduce(payload.txid)}  ${payload.timestamp} dbg:${this.debugTXHistory[utils.stringifyReduce(payload.txid)]}`
        await respond(response)
        // TODO ???? if we dont have a queue entry should we do db queries to get the needed data?
        // my guess is probably not yet
        return
      }

      for (let key of payload.keys) {
        let data = queueEntry.originalData[key] // collectedData
        if (data) {
          response.stateList.push(JSON.parse(data))
        }
      }
      response.success = true
      await respond(response)
    })

    // p2p ASK
    this.p2p.registerInternal('request_receipt_for_tx', async (payload: RequestReceiptForTxReq, respond: (arg0: RequestReceiptForTxResp) => any) => {
      let response: RequestReceiptForTxResp = { receipt: null, note: '', success: false }
      let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.getQueueEntryArchived(payload.txid, 'request_receipt_for_tx') // , payload.timestamp)
      }

      if (queueEntry == null) {
        response.note = `failed to find queue entry: ${utils.stringifyReduce(payload.txid)}  ${payload.timestamp} dbg:${this.debugTXHistory[utils.stringifyReduce(payload.txid)]}`
        await respond(response)
        return
      }

      if (queueEntry.appliedReceipt != null) {
        response.receipt = queueEntry.appliedReceipt
      } else if (queueEntry.recievedAppliedReceipt != null) {
        response.receipt = queueEntry.recievedAppliedReceipt
      }
      if (response.receipt != null) {
        response.success = true
      } else {
        response.note = `found queueEntry but no receipt: ${utils.stringifyReduce(payload.txid)} ${payload.txid}  ${payload.timestamp}`
      }
      await respond(response)
    })

    this.p2p.registerInternal('request_state_for_tx_post', async (payload: RequestStateForTxReqPost, respond: (arg0: RequestStateForTxResp) => any) => {
      let response: RequestStateForTxResp = { stateList: [], beforeHashes: {}, note: '', success: false }
      // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
      let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.getQueueEntryArchived(payload.txid, 'request_state_for_tx_post') // , payload.timestamp)
      }

      if (queueEntry == null) {
        response.note = `failed to find queue entry: ${utils.stringifyReduce(payload.txid)}  ${payload.timestamp} dbg:${this.debugTXHistory[utils.stringifyReduce(payload.txid)]}`
        await respond(response)
        return
      }

      // cant use applyResponse.accountData at this point need to look on collected data..

      // let data = queueEntry.originalData[payload.key] // collectedData
      // let transformedAccounts = queueEntry.preApplyTXResult.applyResponse.accountData
      // for(let i = 0; i< transformedAccounts.length; i++){
      //   let accountData = transformedAccounts[i]

      //   if(accountData.stateId != payload.hash){
      //     response.note = `failed accountData.stateId != payload.hash: ${payload.txid}  ${payload.timestamp} ${utils.makeShortHash(accountData.stateId)}`
      //     await respond(response)
      //     return
      //   }
      //   if (accountData) {
      //     response.stateList.push(accountData)
      //   }
      // }

      let wrappedStates = queueEntry.collectedData
      if (wrappedStates != null) {
        for (let key of Object.keys(wrappedStates)) {
          let wrappedState = wrappedStates[key]
          let accountData = wrappedState

          if (payload.key !== accountData.accountId) {
            continue //not this account.
          }

          if (accountData.stateId != payload.hash) {
            response.note = `failed accountData.stateId != payload.hash txid: ${utils.makeShortHash(payload.txid)}  ts:${payload.timestamp} hash:${utils.makeShortHash(accountData.stateId)}`
            await respond(response)
            return
          }
          if (accountData) {
            //include the before hash
            response.beforeHashes[key] = queueEntry.beforeHashes[key]
            //include the data
            response.stateList.push(accountData)
          }
        }
      }

      response.success = true
      await respond(response)
    })

    // p2p TELL
    this.p2p.registerInternal('broadcast_state', async (payload: { txid: string; stateList: any[] }, respond: any) => {
      // Save the wrappedAccountState with the rest our queue data
      // let message = { stateList: datas, txid: queueEntry.acceptedTX.id }
      // this.p2p.tell([correspondingEdgeNode], 'broadcast_state', message)

      // make sure we have it
      let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        //if we are syncing we need to queue this transaction!

        //this.routeAndQueueAcceptedTransaction (acceptedTx:AcceptedTx, sendGossip:boolean = true, sender: Shardus.Node  |  null, globalModification:boolean)

        return
      }
      // add the data in
      for (let data of payload.stateList) {
        this.queueEntryAddData(queueEntry, data)
        if (queueEntry.state === 'syncing') {
          if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_sync_gotBroadcastData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
        }
      }
    })

    this.p2p.registerGossipHandler('spread_tx_to_group', async (payload, sender, tracker) => {
      //  gossip 'spread_tx_to_group' to transaction group
      // Place tx in queue (if younger than m)

      let queueEntry = this.getQueueEntrySafe(payload.id) // , payload.timestamp)
      if (queueEntry) {
        return
        // already have this in our queue
      }

      //TODO need to check transaction fields.

      let noConsensus = false // this can only be true for a set command which will never come from an endpoint
      let added = this.routeAndQueueAcceptedTransaction(payload, /*sendGossip*/ false, sender, /*globalModification*/ false, noConsensus)
      if (added === 'lost') {
        return // we are faking that the message got lost so bail here
      }
      if (added === 'out of range') {
        return
      }
      if (added === 'notReady') {
        return
      }
      queueEntry = this.getQueueEntrySafe(payload.id) //, payload.timestamp) // now that we added it to the queue, it should be possible to get the queueEntry now

      if (queueEntry == null) {
        // do not gossip this, we are not involved
        this.statemanager_fatal(`spread_tx_to_group_noQE`, `spread_tx_to_group failed: cant find queueEntry for:  ${utils.makeShortHash(payload.id)}`)
        return
      }

      //Validation.
      const initValidationResp = this.app.validateTxnFields(queueEntry.acceptedTx.data)
      if (initValidationResp.success !== true) {
        this.statemanager_fatal(`spread_tx_to_group_validateTX`, `spread_tx_to_group validateTxnFields failed: ${utils.stringifyReduce(initValidationResp)}`)
        return
      }

      //TODO check time before inserting queueEntry.  1sec future 5 second past max
      let timeM = this.queueSitTime
      let timestamp = queueEntry.txKeys.timestamp
      let age = Date.now() - timestamp
      if (age > timeM * 0.9) {
        this.statemanager_fatal(`spread_tx_to_group_OldTx`, 'spread_tx_to_group cannot accept tx older than 0.9M ' + timestamp + ' age: ' + age)
        if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_spread_tx_to_groupToOld', '', 'spread_tx_to_group working on older tx ' + timestamp + ' age: ' + age)
        return
      }
      if (age < -1000) {
        this.statemanager_fatal(`spread_tx_to_group_tooFuture`, 'spread_tx_to_group cannot accept tx more than 1 second in future ' + timestamp + ' age: ' + age)
        if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_spread_tx_to_groupToFutrue', '', 'spread_tx_to_group tx too far in future' + timestamp + ' age: ' + age)
        return
      }

      // how did this work before??
      // get transaction group. 3 accounds, merge lists.
      let transactionGroup = this.queueEntryGetTransactionGroup(queueEntry)
      if (queueEntry.ourNodeInTransactionGroup === false) {
        return
      }
      if (transactionGroup.length > 1) {
        this.debugNodeGroup(queueEntry.acceptedTx.id, queueEntry.acceptedTx.timestamp, `gossip to neighbors`, transactionGroup)
        this.p2p.sendGossipIn('spread_tx_to_group', payload, tracker, sender, transactionGroup)
      }

      // await this.routeAndQueueAcceptedTransaction(acceptedTX, false, sender)
    })

    // TODO STATESHARDING4 ENDPOINTS ok, I changed this to tell, but we still need to check sender!
    //this.p2p.registerGossipHandler('spread_appliedVote', async (payload, sender, tracker) => {
    this.p2p.registerInternal('spread_appliedVote', async (payload: AppliedVote, respond: any) => {
      let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        return
      }
      let newVote = payload as AppliedVote
      // TODO STATESHARDING4 ENDPOINTS check payload format
      // TODO STATESHARDING4 ENDPOINTS that this message is from a valid sender (may need to check docs)

      if (this.tryAppendVote(queueEntry, newVote)) {
        // Note this was sending out gossip, but since this needs to be converted to a tell function i deleted the gossip send
      }
    })

    this.p2p.registerGossipHandler('spread_appliedReceipt', async (payload, sender, tracker) => {
      let appliedReceipt = payload as AppliedReceipt
      let queueEntry = this.getQueueEntrySafe(appliedReceipt.txid) // , payload.timestamp)
      if (queueEntry == null) {
        if (queueEntry == null) {
          // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
          queueEntry = this.getQueueEntryArchived(payload.txid, 'spread_appliedReceipt') // , payload.timestamp)
          if (queueEntry != null) {
            // TODO : PERF on a faster version we may just bail if this lives in the arcive list.
            // would need to make sure we send gossip though.
          }
        }
        if (queueEntry == null) {
          this.mainLogger.error(`spread_appliedReceipt no queue entry for ${appliedReceipt.txid} dbg:${this.debugTXHistory[utils.stringifyReduce(payload.txid)]}`)
          return
        }
      }

      if (this.testFailChance(this.ignoreRecieptChance, 'spread_appliedReceipt', utils.stringifyReduce(appliedReceipt.txid), '', this.verboseLogs) === true) {
        return
      }

      // TODO STATESHARDING4 ENDPOINTS check payload format
      // TODO STATESHARDING4 ENDPOINTS that this message is from a valid sender (may need to check docs)

      let receiptNotNull = appliedReceipt != null

      if (queueEntry.recievedAppliedReceipt == null) {
        this.mainLogger.debug(`spread_appliedReceipt update ${queueEntry.logID} receiptNotNull:${receiptNotNull}`)

        queueEntry.recievedAppliedReceipt = appliedReceipt

        // I think we handle the negative cases later by checking queueEntry.recievedAppliedReceipt vs queueEntry.appliedReceipt

        // share the appliedReceipt.
        let sender = null
        let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)
        if (consensusGroup.length > 1) {
          // should consider only forwarding in some cases?
          this.debugNodeGroup(queueEntry.acceptedTx.id, queueEntry.acceptedTx.timestamp, `share appliedReceipt to neighbors`, consensusGroup)
          this.p2p.sendGossipIn('spread_appliedReceipt', appliedReceipt, tracker, sender, consensusGroup)
        }
      } else {
        this.mainLogger.debug(`spread_appliedReceipt skipped ${queueEntry.logID} receiptNotNull:${receiptNotNull}`)
      }
    })

    this.p2p.registerInternal('get_account_data_with_queue_hints', async (payload: { accountIds: string[] }, respond: (arg0: GetAccountDataWithQueueHintsResp) => any) => {
      let result = {} as GetAccountDataWithQueueHintsResp //TSConversion  This is complicated !! check app for details.
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountDataByList(payload.accountIds)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      if (accountData != null) {
        for (let wrappedAccount of accountData) {
          let wrappedAccountInQueueRef = wrappedAccount as Shardus.WrappedDataFromQueue
          wrappedAccountInQueueRef.seenInQueue = false

          if (this.lastSeenAccountsMap != null) {
            let queueEntry = this.lastSeenAccountsMap[wrappedAccountInQueueRef.accountId]
            if (queueEntry != null) {
              wrappedAccountInQueueRef.seenInQueue = true
            }
          }
        }
      }
      //PERF Disiable this in production or performance testing. / this works due to inheritance
      this.testAccountDataWrapped(accountData)
      // we cast up the array return type because we have attached the seenInQueue memeber to the data.
      result.accountData = accountData as Shardus.WrappedDataFromQueue[]
      await respond(result)
    })

    this.p2p.registerInternal('get_globalaccountreport', async (payload: any, respond: (arg0: GlobalAccountReportResp) => any) => {
      let result = { combinedHash: '', accounts: [], ready: this.appFinishedSyncing } as GlobalAccountReportResp

      //type GlobalAccountReportResp = {combinedHash:string, accounts:{id:string, hash:string, timestamp:number }[]  }
      //sort by account ids.

      let globalAccountKeys = this.globalAccountMap.keys()

      let toQuery: string[] = []

      // not ready
      if (this.stateManagerSync.globalAccountsSynced === false) {
        result.ready = false
        await respond(result)
      }

      //TODO: Perf  could do things faster by pulling from cache, but would need extra testing:
      // let notInCache:string[]
      // for(let key of globalAccountKeys){
      //   let report
      //   if(this.globalAccountRepairBank.has(key)){
      //     let accountCopyList = this.globalAccountRepairBank.get(key)
      //     let newestCopy = accountCopyList[accountCopyList.length-1]
      //     report = {id:key, hash:newestCopy.hash, timestamp:newestCopy.timestamp }
      //   } else{
      //     notInCache.push(key)
      //   }
      //   result.accounts.push(report)
      // }
      for (let key of globalAccountKeys) {
        toQuery.push(key)
      }

      let accountData: Shardus.WrappedData[]
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountDataByList(toQuery)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      if (accountData != null) {
        for (let wrappedAccount of accountData) {
          // let wrappedAccountInQueueRef = wrappedAccount as Shardus.WrappedDataFromQueue
          // wrappedAccountInQueueRef.seenInQueue = false
          // if (this.lastSeenAccountsMap != null) {
          //   let queueEntry = this.lastSeenAccountsMap[wrappedAccountInQueueRef.accountId]
          //   if (queueEntry != null) {
          //     wrappedAccountInQueueRef.seenInQueue = true
          //   }
          // }
          let report = { id: wrappedAccount.accountId, hash: wrappedAccount.stateId, timestamp: wrappedAccount.timestamp }
          result.accounts.push(report)
        }
      }
      //PERF Disiable this in production or performance testing.
      this.testAccountDataWrapped(accountData)
      result.accounts.sort(utils.sort_id_Asc)
      result.combinedHash = this.crypto.hash(result)
      //this.globalAccountRepairBank

      await respond(result)
    })

    //<pre id="json"></pre>
    Context.network.registerExternalGet('debug_stats', (req, res) => {
      let cycle = this.currentCycleShardData.cycleNumber - 1

      let cycleShardValues = null
      if (this.shardValuesByCycle.has(cycle)) {
        cycleShardValues = this.shardValuesByCycle.get(cycle)
      }

      let blob = this.stateManagerStats.dumpLogsForCycle(cycle, false, cycleShardValues)
      res.json({ cycle, blob })
    })

    Context.network.registerExternalGet('debug_stats2', (req, res) => {
      let cycle = this.currentCycleShardData.cycleNumber - 1

      let blob = {}
      let cycleShardValues = null
      if (this.shardValuesByCycle.has(cycle)) {
        cycleShardValues = this.shardValuesByCycle.get(cycle)
        blob = this.stateManagerStats.getCoveredStatsPartitions(cycleShardValues)
      }
      res.json({ cycle, blob })
    })
  }

  _unregisterEndpoints() {
    this.p2p.unregisterGossipHandler('acceptedTx')
    this.p2p.unregisterInternal('get_account_state_hash')
    this.p2p.unregisterInternal('get_account_state')
    this.p2p.unregisterInternal('get_accepted_transactions')
    this.p2p.unregisterInternal('get_account_data')
    this.p2p.unregisterInternal('get_account_data2')
    this.p2p.unregisterInternal('get_account_data3')
    this.p2p.unregisterInternal('get_account_data_by_list')
    this.p2p.unregisterInternal('post_partition_results')
    this.p2p.unregisterInternal('get_transactions_by_list')
    this.p2p.unregisterInternal('get_transactions_by_partition_index')
    this.p2p.unregisterInternal('get_partition_txids')
    // new shard endpoints:
    // this.p2p.unregisterInternal('route_to_home_node')
    this.p2p.unregisterInternal('request_state_for_tx')
    this.p2p.unregisterInternal('request_state_for_tx_post')
    this.p2p.unregisterInternal('request_receipt_for_tx')
    this.p2p.unregisterInternal('broadcast_state')
    this.p2p.unregisterGossipHandler('spread_tx_to_group')
    this.p2p.unregisterInternal('get_account_data_with_queue_hints')
    this.p2p.unregisterInternal('get_globalaccountreport')
    this.p2p.unregisterInternal('spread_appliedVote')
    this.p2p.unregisterGossipHandler('spread_appliedReceipt')
  }

  // //////////////////////////////////////////////////////////////////////////
  // //////////////////////////   END Old sync check     //////////////////////////
  // //////////////////////////////////////////////////////////////////////////



/***
 *     ######   #######  ########  ######## 
 *    ##    ## ##     ## ##     ## ##       
 *    ##       ##     ## ##     ## ##       
 *    ##       ##     ## ########  ######   
 *    ##       ##     ## ##   ##   ##       
 *    ##    ## ##     ## ##    ##  ##       
 *     ######   #######  ##     ## ######## 
 */

  tryStartAcceptedQueue() {
    if (!this.stateManagerSync.dataSyncMainPhaseComplete) {
      return
    }
    if (!this.newAcceptedTxQueueRunning) {
      this.processAcceptedTxQueue()
    }
    // with the way the new lists are setup we lost our ablity to interrupt the timer but i am not sure that matters as much
    // else if (this.newAcceptedTxQueue.length > 0 || this.newAcceptedTxQueueTempInjest.length > 0) {
    //   this.interruptSleepIfNeeded(this.newAcceptedTxQueue[0].timestamp)
    // }
  }

  async _firstTimeQueueAwait() {
    if (this.newAcceptedTxQueueRunning) {
      this.statemanager_fatal(`queueAlreadyRunning`, 'DATASYNC: newAcceptedTxQueueRunning')
      return
    }

    if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('_firstTimeQueueAwait', `this.newAcceptedTxQueue.length:${this.newAcceptedTxQueue.length} this.newAcceptedTxQueue.length:${this.newAcceptedTxQueue.length}`)

    await this.processAcceptedTxQueue()
  }

  /**
   * dumpAccountDebugData this is what creats the shardreports
   */
  async dumpAccountDebugData() {
    if (this.currentCycleShardData == null) {
      return
    }

    // hmm how to deal with data that is changing... it cant!!
    let partitionMap = this.currentCycleShardData.parititionShardDataMap

    let ourNodeShardData: NodeShardData = this.currentCycleShardData.nodeShardData
    // partittions:
    let partitionDump: DebugDumpPartitions = { partitions: [], cycle: 0, rangesCovered: {} as DebugDumpRangesCovered, nodesCovered: {} as DebugDumpNodesCovered, allNodeIds: [], globalAccountIDs: [], globalAccountSummary: [], globalStateHash: '' }
    partitionDump.cycle = this.currentCycleShardData.cycleNumber

    // todo port this to a static stard function!
    // check if we are in the consenus group for this partition
    let minP = ourNodeShardData.consensusStartPartition // storedPartitions.partitionStart
    let maxP = ourNodeShardData.consensusEndPartition // storedPartitions.partitionEnd
    partitionDump.rangesCovered = { ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: ourNodeShardData.nodeAddressNum / 0xffffffff, hP: ourNodeShardData.homePartition, cMin: minP, cMax: maxP, stMin: ourNodeShardData.storedPartitions.partitionStart, stMax: ourNodeShardData.storedPartitions.partitionEnd, numP: this.currentCycleShardData.shardGlobals.numPartitions }

    // todo print out coverage map by node index

    partitionDump.nodesCovered = { idx: ourNodeShardData.ourNodeIndex, ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: ourNodeShardData.nodeAddressNum / 0xffffffff, hP: ourNodeShardData.homePartition, consensus: [], stored: [], extra: [], numP: this.currentCycleShardData.shardGlobals.numPartitions }

    for (let node of ourNodeShardData.consensusNodeForOurNode) {
      let nodeData = this.currentCycleShardData.nodeShardDataMap.get(node.id)
      //@ts-ignore just debug junk
      partitionDump.nodesCovered.consensus.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
    }
    for (let node of ourNodeShardData.nodeThatStoreOurParitionFull) {
      let nodeData = this.currentCycleShardData.nodeShardDataMap.get(node.id)
      //@ts-ignore just debug junk
      partitionDump.nodesCovered.stored.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
    }

    if (this.currentCycleShardData.ourNode.status === 'active') {
      for (var [key, value] of partitionMap) {
        let partition: DebugDumpPartition = { parititionID: key, accounts: [], skip: {} as DebugDumpPartitionSkip }
        partitionDump.partitions.push(partition)

        // normal case
        if (maxP > minP) {
          // are we outside the min to max range
          if (key < minP || key > maxP) {
            partition.skip = { p: key, min: minP, max: maxP }
            continue
          }
        } else if (maxP === minP) {
          if (key !== maxP) {
            partition.skip = { p: key, min: minP, max: maxP, noSpread: true }
            continue
          }
        } else {
          // are we inside the min to max range (since the covered rage is inverted)
          if (key > maxP && key < minP) {
            partition.skip = { p: key, min: minP, max: maxP, inverted: true }
            continue
          }
        }

        let partitionShardData = value
        let accountStart = partitionShardData.homeRange.low
        let accountEnd = partitionShardData.homeRange.high
        let wrappedAccounts = await this.app.getAccountData(accountStart, accountEnd, 10000000)
        // { accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp }
        let duplicateCheck = {}
        for (let wrappedAccount of wrappedAccounts) {
          if (duplicateCheck[wrappedAccount.accountId] != null) {
            continue
          }
          duplicateCheck[wrappedAccount.accountId] = true
          let v = wrappedAccount.data.balance // hack, todo maybe ask app for a debug value
          if (this.app.getAccountDebugValue != null) {
            v = this.app.getAccountDebugValue(wrappedAccount)
          }
          partition.accounts.push({ id: wrappedAccount.accountId, hash: wrappedAccount.stateId, v: v })
        }

        partition.accounts.sort(this._sortByIdAsc)
      }

      //partitionDump.allNodeIds = []
      for (let node of this.currentCycleShardData.activeNodes) {
        partitionDump.allNodeIds.push(utils.makeShortHash(node.id))
      }

      partitionDump.globalAccountIDs = Array.from(this.globalAccountMap.keys())
      partitionDump.globalAccountIDs.sort()
      // dump information about consensus group and edge nodes for each partition
      // for (var [key, value] of this.currentCycleShardData.parititionShardDataMap){

      // }

      //hash over global accounts values

      let globalAccountSummary = []
      for (let globalID in partitionDump.globalAccountIDs) {
        let backupList: Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(globalID)
        //let globalAccount = this.globalAccountMap.get(globalID)
        if (backupList != null && backupList.length > 0) {
          let globalAccount = backupList[backupList.length - 1]
          let summaryObj = { id: globalID, state: globalAccount.hash, ts: globalAccount.timestamp }
          globalAccountSummary.push(summaryObj)
        }
      }
      partitionDump.globalAccountSummary = globalAccountSummary
      let globalStateHash = this.crypto.hash(globalAccountSummary)
      partitionDump.globalStateHash = globalStateHash
    } else {
      if (this.currentCycleShardData != null && this.currentCycleShardData.activeNodes.length > 0) {
        for (let node of this.currentCycleShardData.activeNodes) {
          partitionDump.allNodeIds.push(utils.makeShortHash(node.id))
        }
      }
    }

    this.shardLogger.debug(utils.stringifyReduce(partitionDump))
  }

  /**
   * dumpAccountDebugData2 a temporary version that also uses stats data
   */
  async dumpAccountDebugData2(mainHashResults: MainHashResults) {
    if (this.currentCycleShardData == null) {
      return
    }

    // hmm how to deal with data that is changing... it cant!!
    let partitionMap = this.currentCycleShardData.parititionShardDataMap

    let ourNodeShardData: NodeShardData = this.currentCycleShardData.nodeShardData
    // partittions:
    let partitionDump: DebugDumpPartitions = { partitions: [], cycle: 0, rangesCovered: {} as DebugDumpRangesCovered, nodesCovered: {} as DebugDumpNodesCovered, allNodeIds: [], globalAccountIDs: [], globalAccountSummary: [], globalStateHash: '' }
    partitionDump.cycle = this.currentCycleShardData.cycleNumber

    // todo port this to a static stard function!
    // check if we are in the consenus group for this partition
    let minP = ourNodeShardData.consensusStartPartition // storedPartitions.partitionStart
    let maxP = ourNodeShardData.consensusEndPartition // storedPartitions.partitionEnd
    partitionDump.rangesCovered = { ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: ourNodeShardData.nodeAddressNum / 0xffffffff, hP: ourNodeShardData.homePartition, cMin: minP, cMax: maxP, stMin: ourNodeShardData.storedPartitions.partitionStart, stMax: ourNodeShardData.storedPartitions.partitionEnd, numP: this.currentCycleShardData.shardGlobals.numPartitions }

    // todo print out coverage map by node index

    partitionDump.nodesCovered = { idx: ourNodeShardData.ourNodeIndex, ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: ourNodeShardData.nodeAddressNum / 0xffffffff, hP: ourNodeShardData.homePartition, consensus: [], stored: [], extra: [], numP: this.currentCycleShardData.shardGlobals.numPartitions }

    for (let node of ourNodeShardData.consensusNodeForOurNode) {
      let nodeData = this.currentCycleShardData.nodeShardDataMap.get(node.id)
      //@ts-ignore just debug junk
      partitionDump.nodesCovered.consensus.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
    }
    for (let node of ourNodeShardData.nodeThatStoreOurParitionFull) {
      let nodeData = this.currentCycleShardData.nodeShardDataMap.get(node.id)
      //@ts-ignore just debug junk
      partitionDump.nodesCovered.stored.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
    }

    if (this.currentCycleShardData.ourNode.status === 'active') {
      for (var [key, value] of partitionMap) {
        let partition: DebugDumpPartition = { parititionID: key, accounts: [], accounts2: [], skip: {} as DebugDumpPartitionSkip }
        partitionDump.partitions.push(partition)

        // normal case
        if (maxP > minP) {
          // are we outside the min to max range
          if (key < minP || key > maxP) {
            partition.skip = { p: key, min: minP, max: maxP }
            continue
          }
        } else if (maxP === minP) {
          if (key !== maxP) {
            partition.skip = { p: key, min: minP, max: maxP, noSpread: true }
            continue
          }
        } else {
          // are we inside the min to max range (since the covered rage is inverted)
          if (key > maxP && key < minP) {
            partition.skip = { p: key, min: minP, max: maxP, inverted: true }
            continue
          }
        }

        let partitionShardData = value
        let accountStart = partitionShardData.homeRange.low
        let accountEnd = partitionShardData.homeRange.high

        if (this.debugFeature_dumpAccountDataFromSQL === true) {
          let wrappedAccounts = await this.app.getAccountData(accountStart, accountEnd, 10000000)
          // { accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp }
          let duplicateCheck = {}
          for (let wrappedAccount of wrappedAccounts) {
            if (duplicateCheck[wrappedAccount.accountId] != null) {
              continue
            }
            duplicateCheck[wrappedAccount.accountId] = true
            let v = wrappedAccount.data.balance // hack, todo maybe ask app for a debug value
            if (this.app.getAccountDebugValue != null) {
              v = this.app.getAccountDebugValue(wrappedAccount)
            }
            partition.accounts.push({ id: wrappedAccount.accountId, hash: wrappedAccount.stateId, v: v })
          }

          partition.accounts.sort(this._sortByIdAsc)
        }

        // Take the cache data report and fill out accounts2 and partitionHash2
        if (mainHashResults.partitionHashResults.has(partition.parititionID)) {
          let partitionHashResults = mainHashResults.partitionHashResults.get(partition.parititionID)
          for (let index = 0; index < partitionHashResults.hashes.length; index++) {
            let id = partitionHashResults.ids[index]
            let hash = partitionHashResults.hashes[index]
            let v = `{t:${partitionHashResults.timestamps[index]}}`
            partition.accounts2.push({ id, hash, v })
          }
          partition.partitionHash2 = partitionHashResults.hashOfHashes
        }
      }

      //partitionDump.allNodeIds = []
      for (let node of this.currentCycleShardData.activeNodes) {
        partitionDump.allNodeIds.push(utils.makeShortHash(node.id))
      }

      partitionDump.globalAccountIDs = Array.from(this.globalAccountMap.keys())
      partitionDump.globalAccountIDs.sort()
      // dump information about consensus group and edge nodes for each partition
      // for (var [key, value] of this.currentCycleShardData.parititionShardDataMap){

      // }

      //hash over global accounts values

      let globalAccountSummary = []
      for (let globalID in partitionDump.globalAccountIDs) {
        let backupList: Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(globalID)
        //let globalAccount = this.globalAccountMap.get(globalID)
        if (backupList != null && backupList.length > 0) {
          let globalAccount = backupList[backupList.length - 1]
          let summaryObj = { id: globalID, state: globalAccount.hash, ts: globalAccount.timestamp }
          globalAccountSummary.push(summaryObj)
        }
      }
      partitionDump.globalAccountSummary = globalAccountSummary
      let globalStateHash = this.crypto.hash(globalAccountSummary)
      partitionDump.globalStateHash = globalStateHash
    } else {
      if (this.currentCycleShardData != null && this.currentCycleShardData.activeNodes.length > 0) {
        for (let node of this.currentCycleShardData.activeNodes) {
          partitionDump.allNodeIds.push(utils.makeShortHash(node.id))
        }
      }
    }

    this.shardLogger.debug(utils.stringifyReduce(partitionDump))
  }

  async waitForShardData() {
    // wait for shard data
    while (this.currentCycleShardData == null) {
      this.getCurrentCycleShardData()
      await utils.sleep(1000)
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('_waitForShardData', ` `, ` ${utils.stringifyReduce(this.currentCycleShardData)} `)
    }
  }

  // todo support metadata so we can serve up only a portion of the account
  // todo 2? communicate directly back to client... could have security issue.
  // todo 3? require a relatively stout client proof of work
  async getLocalOrRemoteAccount(address: string): Promise<Shardus.WrappedDataFromQueue | null> {
    let wrappedAccount: Shardus.WrappedDataFromQueue | null = null

    if (this.currentCycleShardData == null) {
      await this.waitForShardData()
    }
    // TSConversion since this should never happen due to the above function should we assert that the value is non null?.  Still need to figure out the best practice.
    if (this.currentCycleShardData == null) {
      throw new Error('getLocalOrRemoteAccount: network not ready')
    }

    let forceLocalGlobalLookup = false
    let globalAccount = null
    if (this.globalAccountMap.has(address)) {
      globalAccount = this.globalAccountMap.get(address)
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('globalAccountMap', `getLocalOrRemoteAccount - has`)
      if (globalAccount != null) {
        return globalAccount
      }
      forceLocalGlobalLookup = true
    }

    // check if we have this account locally. (does it have to be consenus or just stored?)
    let accountIsRemote = true

    let ourNodeShardData = this.currentCycleShardData.nodeShardData
    let minP = ourNodeShardData.consensusStartPartition
    let maxP = ourNodeShardData.consensusEndPartition
    // HOMENODEMATHS this seems good.  making sure our node covers this partition
    let { homePartition } = ShardFunctions.addressToPartition(this.currentCycleShardData.shardGlobals, address)
    accountIsRemote = ShardFunctions.partitionInConsensusRange(homePartition, minP, maxP) === false

    // hack to say we have all the data
    if (this.currentCycleShardData.activeNodes.length <= this.currentCycleShardData.shardGlobals.consensusRadius) {
      accountIsRemote = false
    }
    if (forceLocalGlobalLookup) {
      accountIsRemote = false
    }

    if (accountIsRemote) {
      let homeNode = ShardFunctions.findHomeNode(this.currentCycleShardData.shardGlobals, address, this.currentCycleShardData.parititionShardDataMap)
      if (homeNode == null) {
        throw new Error(`getLocalOrRemoteAccount: no home node found`)
      }

      // Node Precheck!
      if (this.isNodeValidForInternalMessage(homeNode.node.id, 'getLocalOrRemoteAccount', true, true) === false) {
        // if(this.tryNextDataSourceNode('getLocalOrRemoteAccount') == false){
        //   break
        // }

        //throw new Error(`getLocalOrRemoteAccount: no retry implmented yet`)
        if (this.verboseLogs) this.getAccountFailDump(address, 'getLocalOrRemoteAccount: isNodeValidForInternalMessage failed, no retry')
        return null
      }

      let message = { accountIds: [address] }
      let r: GetAccountDataWithQueueHintsResp | boolean = await this.p2p.ask(homeNode.node, 'get_account_data_with_queue_hints', message)
      if (r === false) {
        this.mainLogger.error('ASK FAIL getLocalOrRemoteAccount r === false')
      }

      let result = r as GetAccountDataWithQueueHintsResp
      if (result != null && result.accountData != null && result.accountData.length > 0) {
        wrappedAccount = result.accountData[0]
        if (wrappedAccount == null) {
          if (this.verboseLogs) this.getAccountFailDump(address, 'remote result.accountData[0] == null')
        }
        return wrappedAccount
      } else {
        if (result == null) {
          if (this.verboseLogs) this.getAccountFailDump(address, 'remote request missing data: result == null')
        } else if (result.accountData == null) {
          if (this.verboseLogs) this.getAccountFailDump(address, 'remote request missing data: result.accountData == null ' + utils.stringifyReduce(result))
        } else if (result.accountData.length <= 0) {
          if (this.verboseLogs) this.getAccountFailDump(address, 'remote request missing data: result.accountData.length <= 0 ' + utils.stringifyReduce(result))
        }
      }
    } else {
      // we are local!
      let accountData = await this.app.getAccountDataByList([address])
      //let wrappedAccount: Shardus.WrappedDataFromQueue
      if (accountData != null) {
        for (let wrappedAccountEntry of accountData) {
          // We are going to add in new data here, which upgrades the account wrapper to a new type.
          let expandedRef = wrappedAccountEntry as Shardus.WrappedDataFromQueue
          expandedRef.seenInQueue = false

          if (this.lastSeenAccountsMap != null) {
            let queueEntry = this.lastSeenAccountsMap[expandedRef.accountId]
            if (queueEntry != null) {
              expandedRef.seenInQueue = true
            }
          }
          wrappedAccount = expandedRef
        }
      } else {
        if (this.verboseLogs) this.getAccountFailDump(address, 'getAccountDataByList() returned null')
        return null
      }
      // there must have been an issue in the past, but for some reason we are checking the first element in the array now.
      if (accountData[0] == null) {
        if (this.verboseLogs) this.getAccountFailDump(address, 'accountData[0] == null')
      }
      if (accountData.length > 1 || accountData.length == 0) {
        if (this.verboseLogs) this.getAccountFailDump(address, `getAccountDataByList() returned wrong element count: ${accountData}`)
      }
      return wrappedAccount
    }
    return null
  }

  getAccountFailDump(address: string, message: string) {
    // this.currentCycleShardData
    if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('getAccountFailDump', ` `, `${utils.makeShortHash(address)} ${message} `)
  }

  // HOMENODEMATHS is this used by any apps? it is not used by shardus
  async getRemoteAccount(address: string) {
    let wrappedAccount

    await this.waitForShardData()
    // TSConversion since this should never happen due to the above function should we assert that the value is non null?.  Still need to figure out the best practice.
    if (this.currentCycleShardData == null) {
      throw new Error('getRemoteAccount: network not ready')
    }

    let homeNode = ShardFunctions.findHomeNode(this.currentCycleShardData.shardGlobals, address, this.currentCycleShardData.parititionShardDataMap)
    if (homeNode == null) {
      throw new Error(`getRemoteAccount: no home node found`)
    }

    // Node Precheck!  TODO implement retry
    if (this.isNodeValidForInternalMessage(homeNode.node.id, 'getRemoteAccount', true, true) === false) {
      // if(this.tryNextDataSourceNode('getRemoteAccount') == false){
      //   break
      // }
      // throw new Error(`getRemoteAccount: not retry yet`)
      this.mainLogger.error('getRemoteAccount: isNodeValidForInternalMessage failed, no retry yet')
      return null
    }

    let message = { accountIds: [address] }
    let result = await this.p2p.ask(homeNode.node, 'get_account_data_with_queue_hints', message)
    if (result === false) {
      this.mainLogger.error('ASK FAIL getRemoteAccount result === false')
    }
    if (result === null) {
      this.mainLogger.error('ASK FAIL getRemoteAccount result === null')
    }
    if (result != null && result.accountData != null && result.accountData.length > 0) {
      wrappedAccount = result.accountData[0]
      return wrappedAccount
    }

    return null
  }

  /**
   * getClosestNodes
   * @param {string} hash
   * @param {number} count
   * @returns {Node[]}
   */
  getClosestNodes(hash: string, count: number = 1): Shardus.Node[] {
    if (this.currentCycleShardData == null) {
      throw new Error('getClosestNodes: network not ready')
    }
    let cycleShardData = this.currentCycleShardData
    let homeNode = ShardFunctions.findHomeNode(cycleShardData.shardGlobals, hash, cycleShardData.parititionShardDataMap)
    if (homeNode == null) {
      throw new Error(`getClosestNodes: no home node found`)
    }

    // HOMENODEMATHS consider using partition of the raw hash instead of home node of hash
    let homeNodeIndex = homeNode.ourNodeIndex
    let idToExclude = ''
    let results = ShardFunctions.getNodesByProximity(cycleShardData.shardGlobals, cycleShardData.activeNodes, homeNodeIndex, idToExclude, count, true)

    return results
  }

  _distanceSortAsc(a: SimpleDistanceObject, b: SimpleDistanceObject) {
    if (a.distance === b.distance) {
      return 0
    }
    if (a.distance < b.distance) {
      return -1
    } else {
      return 1
    }
  }

  getClosestNodesGlobal(hash: string, count: number) {
    let hashNumber = parseInt(hash.slice(0, 7), 16)
    let nodes = this.p2p.state.getActiveNodes()
    let nodeDistMap: { id: string; distance: number }[] = nodes.map((node) => ({ id: node.id, distance: Math.abs(hashNumber - parseInt(node.id.slice(0, 7), 16)) }))
    nodeDistMap.sort(this._distanceSortAsc) ////(a, b) => a.distance < b.distance)
    //console.log('SORTED NODES BY DISTANCE', nodes)
    return nodeDistMap.slice(0, count).map((node) => node.id)
  }

  // TSConversion todo see if we need to log any of the new early exits.
  isNodeInDistance(shardGlobals: ShardGlobals, parititionShardDataMap: ParititionShardDataMap, hash: string, nodeId: string, distance: number) {
    let cycleShardData = this.currentCycleShardData
    if (cycleShardData == null) {
      return false
    }
    // HOMENODEMATHS need to eval useage here
    let someNode = ShardFunctions.findHomeNode(cycleShardData.shardGlobals, nodeId, cycleShardData.parititionShardDataMap)
    if (someNode == null) {
      return false
    }
    let someNodeIndex = someNode.ourNodeIndex

    let homeNode = ShardFunctions.findHomeNode(cycleShardData.shardGlobals, hash, cycleShardData.parititionShardDataMap)
    if (homeNode == null) {
      return false
    }
    let homeNodeIndex = homeNode.ourNodeIndex

    let partitionDistance = Math.abs(someNodeIndex - homeNodeIndex)
    if (partitionDistance <= distance) {
      return true
    }
    return false
  }

  async _clearState() {
    await this.storage.clearAppRelatedState()
  }

  _stopQueue() {
    this.queueStopped = true
  }

  _clearQueue() {
    this.newAcceptedTxQueue = []
  }


  async cleanup() {
    this._stopQueue()
    this._unregisterEndpoints()
    this._clearQueue()
    this._cleanupListeners()
    await this._clearState()
  }

  isStateGood() {
    return this.stateIsGood
  }

/***
 *     ######  ######## ########          ###     ######   ######   #######  ##     ## ##    ## ######## 
 *    ##    ## ##          ##            ## ##   ##    ## ##    ## ##     ## ##     ## ###   ##    ##    
 *    ##       ##          ##           ##   ##  ##       ##       ##     ## ##     ## ####  ##    ##    
 *     ######  ######      ##          ##     ## ##       ##       ##     ## ##     ## ## ## ##    ##    
 *          ## ##          ##          ######### ##       ##       ##     ## ##     ## ##  ####    ##    
 *    ##    ## ##          ##          ##     ## ##    ## ##    ## ##     ## ##     ## ##   ###    ##    
 *     ######  ########    ##          ##     ##  ######   ######   #######   #######  ##    ##    ##    
 */

  // TODO WrappedStates
  async setAccount(wrappedStates: WrappedResponses, localCachedData: LocalCachedData, applyResponse: Shardus.ApplyResponse, isGlobalModifyingTX: boolean, accountFilter?: AccountFilter) {
    // let sourceAddress = inTx.srcAct
    // let targetAddress = inTx.tgtAct
    // let amount = inTx.txnAmt
    // let type = inTx.txnType
    // let time = inTx.txnTimestamp
    let canWriteToAccount = function (accountId: string) {
      return !accountFilter || accountFilter[accountId] !== undefined
    }

    let savedSomething = false

    let keys = Object.keys(wrappedStates)
    keys.sort() // have to sort this because object.keys is non sorted and we always use the [0] index for hashset strings
    for (let key of keys) {
      let wrappedData = wrappedStates[key]
      if (wrappedData == null) {
        // TSConversion todo: harden this. throw exception?
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `setAccount wrappedData == null :${utils.makeShortHash(wrappedData.accountId)}`)
        continue
      }

      if (canWriteToAccount(wrappedData.accountId) === false) {
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `setAccount canWriteToAccount == false :${utils.makeShortHash(wrappedData.accountId)}`)
        continue
      }

      let isGlobalKey = false
      //intercept that we have this data rather than requesting it.
      // only if this tx is not a global modifying tx.   if it is a global set then it is ok to save out the global here.
      if (this.globalAccountMap.has(key)) {
        if (isGlobalModifyingTX === false) {
          if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('globalAccountMap', `setAccount - has`)
          if (this.verboseLogs) this.mainLogger.debug('setAccount: Not writing global account: ' + utils.makeShortHash(key))
          continue
        }
        if (this.verboseLogs) this.mainLogger.debug('setAccount: writing global account: ' + utils.makeShortHash(key))
      }

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `setAccount partial:${wrappedData.isPartial} key:${utils.makeShortHash(key)}`)
      if (wrappedData.isPartial) {
        await this.app.updateAccountPartial(wrappedData, localCachedData[key], applyResponse)
      } else {
        await this.app.updateAccountFull(wrappedData, localCachedData[key], applyResponse)
      }
      savedSomething = true
    }

    return savedSomething
  }


  /**
   * updateAccountsCopyTable
   * originally this only recorder results if we were not repairing but it turns out we need to update our copies any time we apply state.
   * with the update we will calculate the cycle based on timestamp rather than using the last current cycle counter
   * @param {any} accountDataList todo need to use wrapped account data here  TSConversion todo non any type
   * @param {boolean} repairing
   * @param {number} txTimestamp
   */
  async updateAccountsCopyTable(accountDataList: Shardus.AccountData[], repairing: boolean, txTimestamp: number) {
    let cycleNumber = -1

    let cycle = this.p2p.state.getCycleByTimestamp(txTimestamp + this.syncSettleTime)
    let cycleOffset = 0
    // todo review this assumption. seems ok at the moment.  are there times cycle could be null and getting the last cycle is not a valid answer?
    if (cycle == null) {
      cycle = this.p2p.state.getLastCycle()
      // if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable error getting cycle by timestamp: ${accountDataList[0].timestamp} offsetTime: ${this.syncSettleTime} cycle returned:${cycle.counter} `)
      cycleOffset = 1
    }
    cycleNumber = cycle.counter + cycleOffset

    // extra safety testing
    // TODO !!!  if cycle durations become variable we need to update this logic
    let cycleStart = (cycle.start + cycle.duration * cycleOffset) * 1000
    let cycleEnd = (cycle.start + cycle.duration * (cycleOffset + 1)) * 1000
    if (txTimestamp + this.syncSettleTime < cycleStart) {
      if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable time error< ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
    }
    if (txTimestamp + this.syncSettleTime >= cycleEnd) {
      // if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable time error>= ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
      cycleOffset++
      cycleNumber = cycle.counter + cycleOffset
      cycleStart = (cycle.start + cycle.duration * cycleOffset) * 1000
      cycleEnd = (cycle.start + cycle.duration * (cycleOffset + 1)) * 1000
      if (txTimestamp + this.syncSettleTime >= cycleEnd) {
        if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable time error>= ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
      }
    }
    // TSConversion need to sort out account types!!!
    // @ts-ignore This has seemed fine in past so not going to sort out a type discrepencie here.  !== would detect and log it anyhow.
    if (accountDataList.length > 0 && accountDataList[0].timestamp !== txTimestamp) {
      if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable timestamps do match txts:${txTimestamp} acc.ts:${accountDataList[0].timestamp} `)
    }
    if (accountDataList.length === 0) {
      // need to decide if this matters!
      if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable empty txts:${txTimestamp}  `)
    }
    // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `updateAccountsCopyTable acc.timestamp: ${accountDataList[0].timestamp} offsetTime: ${this.syncSettleTime} cycle computed:${cycleNumber} `)

    for (let accountEntry of accountDataList) {
      let { accountId, data, timestamp, hash } = accountEntry
      let isGlobal = this.isGlobalAccount(accountId)

      let backupObj: Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `updateAccountsCopyTable acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)

      // todo perf. batching?
      // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'updateAccountsCopyTableA ' + JSON.stringify(accountEntry))
      // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'updateAccountsCopyTableB ' + JSON.stringify(backupObj))

      // how does this not stop previous results, is it because only the first request gets through.

      // TODO: globalaccounts
      // intercept the account change here for global accounts and save it to our memory structure.
      // this structure should have a list. and be sorted by timestamp. eventually we will remove older timestamp copies of the account data.

      // wrappedAccounts.push({ accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp })

      //TODO Perf: / mem   should we only save if there is a hash change?
      if (this.isGlobalAccount(accountId) && repairing === false) {
        //make sure it is a global tx.
        let globalBackupList: Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(accountId)
        if (globalBackupList != null) {
          globalBackupList.push(backupObj) // sort and cleanup later.

          if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `updateAccountsCopyTable added account to global backups count: ${globalBackupList.length} ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)
        }
      }

      //Aha! Saves the last copy per given cycle! this way when you query cycle-1 you get the right data.
      await this.storage.createOrReplaceAccountCopy(backupObj)
    }
  }


  /**
   * _commitAccountCopies
   * This takes an array of account data and pushes it directly into the system with app.resetAccountData
   * Account backup copies and in memory global account backups are also updated
   * you only need to set the true values for the globalAccountKeyMap
   * @param accountCopies
   */
  async _commitAccountCopies(accountCopies: Shardus.AccountsCopy[]) {
    if (accountCopies.length > 0) {
      for (let accountData of accountCopies) {
        // make sure the data is not a json string
        if (utils.isString(accountData.data)) {
          accountData.data = JSON.parse(accountData.data)
        }

        if (accountData == null || accountData.data == null || accountData.accountId == null) {
          if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _commitAccountCopies null account data found: ${accountData.accountId} data: ${utils.stringifyReduce(accountData)}`)
          continue
        } else {
          if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _commitAccountCopies: ${utils.makeShortHash(accountData.accountId)} ts: ${utils.makeShortHash(accountData.timestamp)} data: ${utils.stringifyReduce(accountData)}`)
        }
      }
      // tell the app to replace the account data
      await this.app.resetAccountData(accountCopies)

      let globalAccountKeyMap: { [key: string]: boolean } = {}

      //we just have to trust that if we are restoring from data then the globals will be known
      this.hasknownGlobals = true

      // update the account copies and global backups
      // it is possible some of this gets to go away eventually
      for (let accountEntry of accountCopies) {
        let { accountId, data, timestamp, hash, cycleNumber, isGlobal } = accountEntry

        // check if the is global bit was set and keep local track of it.  Before this was going to be passed in as separate data
        if (isGlobal == true) {
          globalAccountKeyMap[accountId] = true
        }

        // Maybe don't try to calculate the cycle number....
        // const cycle = this.p2p.state.getCycleByTimestamp(timestamp + this.syncSettleTime)
        // // find the correct cycle based on timetamp
        // if (!cycle) {
        //   this.mainLogger.error(`_commitAccountCopies failed to get cycle for timestamp ${timestamp} accountId:${utils.makeShortHash(accountId)}`)
        //   continue
        // }
        // let cycleNumber = cycle.counter

        let backupObj: Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }

        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `_commitAccountCopies acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)

        // If the account is global ad it to the global backup list
        if (globalAccountKeyMap[accountId] === true) {
          //this.isGlobalAccount(accountId)){

          // If we do not realized this account is global yet, then set it and log to playback log
          if (this.isGlobalAccount(accountId) === false) {
            this.globalAccountMap.set(accountId, null) // we use null. ended up not using the data, only checking for the key is used
            if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('globalAccountMap', `set global in _commitAccountCopies accountId:${utils.makeShortHash(accountId)}`)
          }

          let globalBackupList: Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(accountId)
          if (globalBackupList != null) {
            globalBackupList.push(backupObj) // sort and cleanup later
            if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `_commitAccountCopies added account to global backups count: ${globalBackupList.length} ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)
          } else {
            this.mainLogger.error(`_commitAccountCopies no global backup list found for accountId:${utils.makeShortHash(accountId)}`)
          }
        }
        //Saves the last copy per given cycle! this way when you query cycle-1 you get the right data.
        await this.storage.createOrReplaceAccountCopy(backupObj)
      }
    }
  }


  /// /////////////////////////////////////////////////////////
/***
 *    ######## #### ########  #######           ##        #######   ######  ##    ##  ######  
 *    ##        ##  ##       ##     ##          ##       ##     ## ##    ## ##   ##  ##    ## 
 *    ##        ##  ##       ##     ##          ##       ##     ## ##       ##  ##   ##       
 *    ######    ##  ######   ##     ##          ##       ##     ## ##       #####     ######  
 *    ##        ##  ##       ##     ##          ##       ##     ## ##       ##  ##         ## 
 *    ##        ##  ##       ##     ##          ##       ##     ## ##    ## ##   ##  ##    ## 
 *    ##       #### ##        #######           ########  #######   ######  ##    ##  ######  
 */
  clearPartitionData() {
    this.fifoLocks = {}
  }

  async fifoLock(fifoName: string): Promise<number> {
    var stack = '' // new Error().stack
    this.mainLogger.debug(`fifoLock: ${fifoName} ${stack}`)

    let thisFifo = this.fifoLocks[fifoName]
    if (thisFifo == null) {
      thisFifo = { fifoName, queueCounter: 0, waitingList: [], lastServed: 0, queueLocked: false, lockOwner: 1 }
      this.fifoLocks[fifoName] = thisFifo
    }
    thisFifo.queueCounter++
    let ourID = thisFifo.queueCounter
    let entry = { id: ourID }

    if (thisFifo.waitingList.length > 0 || thisFifo.queueLocked) {
      thisFifo.waitingList.push(entry)
      // wait till we are at the front of the queue, and the queue is not locked
      while (thisFifo.waitingList[0].id !== ourID || thisFifo.queueLocked) {
        // todo perf optimization to reduce the amount of times we have to sleep (attempt to come out of sleep at close to the right time)
        let sleepEstimate = ourID - thisFifo.lastServed
        if (sleepEstimate < 1) {
          sleepEstimate = 1
        }
        await utils.sleep(1 * sleepEstimate)
        // await utils.sleep(2)
      }
      // remove our entry from the array
      thisFifo.waitingList.shift()
    }

    // lock things so that only our calling function can do work
    thisFifo.queueLocked = true
    thisFifo.lockOwner = ourID
    thisFifo.lastServed = ourID
    return ourID
  }

  fifoUnlock(fifoName: string, id: number) {
    var stack = '' // new Error().stack
    this.mainLogger.debug(`fifoUnlock: ${fifoName} ${stack}`)

    let thisFifo = this.fifoLocks[fifoName]
    if (id === -1 || !thisFifo) {
      return // nothing to do
    }
    if (thisFifo.lockOwner === id) {
      thisFifo.queueLocked = false
    } else if (id !== -1) {
      // this should never happen as long as we are careful to use try/finally blocks
      this.statemanager_fatal(`fifoUnlock`, `Failed to unlock the fifo ${thisFifo.fifoName}: ${id}`)
    }
  }

  /**
   * bulkFifoLockAccounts
   * @param {string[]} accountIDs
   */
  async bulkFifoLockAccounts(accountIDs: string[]) {
    // lock all the accounts we will modify
    let wrapperLockId = await this.fifoLock('atomicWrapper')
    let ourLocks = []
    let seen: StringBoolObjectMap = {}
    for (let accountKey of accountIDs) {
      if (seen[accountKey] === true) {
        ourLocks.push(-1) //lock skipped, so add a placeholder
        continue
      }
      seen[accountKey] = true
      let ourLockID = await this.fifoLock(accountKey)
      ourLocks.push(ourLockID)
    }
    this.fifoUnlock('atomicWrapper', wrapperLockId)
    return ourLocks
  }

  /**
   * bulkFifoUnlockAccounts
   * @param {string[]} accountIDs
   * @param {number[]} ourLocks
   */
  bulkFifoUnlockAccounts(accountIDs: string[], ourLocks: number[]) {
    let seen: StringBoolObjectMap = {}
    // unlock the accounts we locked
    for (let i = 0; i < ourLocks.length; i++) {
      let accountID = accountIDs[i]
      if (seen[accountID] === true) {
        continue
      }
      seen[accountID] = true
      let ourLockID = ourLocks[i]
      if (ourLockID == -1) {
        this.statemanager_fatal(`bulkFifoUnlockAccounts_fail`, `bulkFifoUnlockAccounts hit placeholder i:${i} ${utils.stringifyReduce({ accountIDs, ourLocks })} `)
      }

      this.fifoUnlock(accountID, ourLockID)
    }
  }



  /***
   *     ######  ##       ########    ###    ##    ## ##     ## ########
   *    ##    ## ##       ##         ## ##   ###   ## ##     ## ##     ##
   *    ##       ##       ##        ##   ##  ####  ## ##     ## ##     ##
   *    ##       ##       ######   ##     ## ## ## ## ##     ## ########
   *    ##       ##       ##       ######### ##  #### ##     ## ##
   *    ##    ## ##       ##       ##     ## ##   ### ##     ## ##
   *     ######  ######## ######## ##     ## ##    ##  #######  ##
   */

  // could do this every 5 cycles instead to save perf.
  periodicCycleDataCleanup(oldestCycle: number) {
    // On a periodic bases older copies of the account data where we have more than 2 copies for the same account can be deleted.

    if (oldestCycle < 0) {
      return
    }

    if (this.repairTrackingByCycleById == null) {
      return
    }
    if (this.allPartitionResponsesByCycleByPartition == null) {
      return
    }
    if (this.ourPartitionResultsByCycle == null) {
      return
    }
    if (this.shardValuesByCycle == null) {
      return
    }

    // todo refactor some of the common code below.  may be put the counters in a map.

    // Partition receipts and cycles:
    // partitionObjectsByCycle
    // cycleReceiptsByCycleCounter

    let oldestCycleTimestamp = 0

    this.mainLogger.debug('Clearing out old data Start')

    let removedrepairTrackingByCycleById = 0
    let removedallPartitionResponsesByCycleByPartition = 0
    let removedourPartitionResultsByCycle = 0
    let removedshardValuesByCycle = 0
    // let oldestCycleKey = 'c' + oldestCycle
    // cleanup old repair trackers
    for (let cycleKey of Object.keys(this.repairTrackingByCycleById)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.repairTrackingByCycleById[cycleKey]
        removedrepairTrackingByCycleById++
      }
    }

    // cleanup old partition objects / receipts.
    // let responsesById = this.allPartitionResponsesByCycleByPartition[key]
    // let ourPartitionValues = this.ourPartitionResultsByCycle[key]
    for (let cycleKey of Object.keys(this.allPartitionResponsesByCycleByPartition)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.allPartitionResponsesByCycleByPartition[cycleKey]
        removedallPartitionResponsesByCycleByPartition++
      }
    }

    for (let cycleKey of Object.keys(this.ourPartitionResultsByCycle)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.ourPartitionResultsByCycle[cycleKey]
        removedourPartitionResultsByCycle++
      }
    }

    // cleanup this.shardValuesByCycle
    for (let cycleKey of this.shardValuesByCycle.keys()) {
      let cycleNum = cycleKey
      if (cycleNum < oldestCycle) {
        //since we are about to axe cycle shard data take a look at its timestamp so we can clean up other lists.
        let shardValues: CycleShardData = this.shardValuesByCycle[cycleNum]
        if (shardValues != null) {
          oldestCycleTimestamp = shardValues.timestamp
        }
        // delete old cycle
        this.shardValuesByCycle.delete(cycleNum)
        removedshardValuesByCycle++
      }
    }

    // // cleanup this.shardValuesByCycle
    // for (let cycleKey of Object.keys(this.shardValuesByCycle)) {
    //   let cycle = cycleKey.slice(1)
    //   let cycleNum = parseInt(cycle, 10)
    //   if (cycleNum < oldestCycle) {
    //     // delete old cycle
    //     delete this.shardValuesByCycle[cycleKey]
    //     removedshardValuesByCycle++
    //   }
    // }

    let removedtxByCycleByPartition = 0
    let removedrecentPartitionObjectsByCycleByHash = 0
    let removedrepairUpdateDataByCycle = 0
    let removedpartitionObjectsByCycle = 0

    // cleanup this.txByCycleByPartition
    for (let cycleKey of Object.keys(this.txByCycleByPartition)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.txByCycleByPartition[cycleKey]
        removedtxByCycleByPartition++
      }
    }
    // cleanup this.recentPartitionObjectsByCycleByHash
    for (let cycleKey of Object.keys(this.recentPartitionObjectsByCycleByHash)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.recentPartitionObjectsByCycleByHash[cycleKey]
        removedrecentPartitionObjectsByCycleByHash++
      }
    }
    // cleanup this.repairUpdateDataByCycle
    for (let cycleKey of Object.keys(this.repairUpdateDataByCycle)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.repairUpdateDataByCycle[cycleKey]
        removedrepairUpdateDataByCycle++
      }
    }
    // cleanup this.partitionObjectsByCycle
    for (let cycleKey of Object.keys(this.partitionObjectsByCycle)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.partitionObjectsByCycle[cycleKey]
        removedpartitionObjectsByCycle++
      }
    }

    let removepartitionReceiptsByCycleCounter = 0
    let removeourPartitionReceiptsByCycleCounter = 0
    // cleanup this.partitionReceiptsByCycleCounter
    for (let cycleKey of Object.keys(this.partitionReceiptsByCycleCounter)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.partitionReceiptsByCycleCounter[cycleKey]
        removepartitionReceiptsByCycleCounter++
      }
    }

    // cleanup this.ourPartitionReceiptsByCycleCounter
    for (let cycleKey of Object.keys(this.ourPartitionReceiptsByCycleCounter)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.ourPartitionReceiptsByCycleCounter[cycleKey]
        removeourPartitionReceiptsByCycleCounter++
      }
    }

    // start at the front of the archivedQueueEntries fifo and remove old entries untill they are current.
    let oldQueueEntries = true
    let archivedEntriesRemoved = 0
    while (oldQueueEntries && this.archivedQueueEntries.length > 0) {
      let queueEntry = this.archivedQueueEntries[0]
      // the time is approximate so make sure it is older than five cycles.
      // added a few more to oldest cycle to keep entries in the queue longer in case syncing nodes need the data
      if (queueEntry.approximateCycleAge < oldestCycle - 3) {
        this.archivedQueueEntries.shift()
        archivedEntriesRemoved++

        if (this.verboseLogs) this.mainLogger.log(`queue entry removed from archive ${queueEntry.logID} tx cycle: ${queueEntry.approximateCycleAge} cycle: ${this.currentCycleShardData.cycleNumber}`)
      } else {
        oldQueueEntries = false
        break
      }
    }

    // sort and clean up our global account backups:
    if (oldestCycleTimestamp > 0) {
      this.sortAndMaintainBackups(oldestCycleTimestamp)
    }

    this.mainLogger.debug(`Clearing out old data Cleared: ${removedrepairTrackingByCycleById} ${removedallPartitionResponsesByCycleByPartition} ${removedourPartitionResultsByCycle} ${removedshardValuesByCycle} ${removedtxByCycleByPartition} ${removedrecentPartitionObjectsByCycleByHash} ${removedrepairUpdateDataByCycle} ${removedpartitionObjectsByCycle} ${removepartitionReceiptsByCycleCounter} ${removeourPartitionReceiptsByCycleCounter} archQ:${archivedEntriesRemoved}`)

    // TODO 1 calculate timestamp for oldest accepted TX to delete.

    // TODO effient process to query all accounts and get rid of themm but keep at least one table entry (prefably the newest)
    // could do this in two steps
  }

  /***
   *    ########  ########   #######     ###    ########   ######     ###     ######  ########
   *    ##     ## ##     ## ##     ##   ## ##   ##     ## ##    ##   ## ##   ##    ##    ##
   *    ##     ## ##     ## ##     ##  ##   ##  ##     ## ##        ##   ##  ##          ##
   *    ########  ########  ##     ## ##     ## ##     ## ##       ##     ##  ######     ##
   *    ##     ## ##   ##   ##     ## ######### ##     ## ##       #########       ##    ##
   *    ##     ## ##    ##  ##     ## ##     ## ##     ## ##    ## ##     ## ##    ##    ##
   *    ########  ##     ##  #######  ##     ## ########   ######  ##     ##  ######     ##
   */
  /**
   * broadcastPartitionResults
   * @param {number} cycleNumber
   */
  async broadcastPartitionResults(cycleNumber: number) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair broadcastPartitionResults for cycle: ${cycleNumber}`)
    // per partition need to figure out which node cover it.
    // then get a list of all the results we need to send to a given node and send them at once.
    // need a way to do this in semi parallel?
    let lastCycleShardValues = this.shardValuesByCycle.get(cycleNumber)
    let partitionResults = this.ourPartitionResultsByCycle['c' + cycleNumber]
    let partitionResultsByNodeID = new Map() // use a map?
    let nodesToTell = []

    if (lastCycleShardValues == null) {
      throw new Error(`broadcastPartitionResults lastCycleShardValues == null  ${cycleNumber}`)
    }
    // sign results as needed
    for (let i = 0; i < partitionResults.length; i++) {
      /** @type {PartitionResult} */
      let partitionResult = partitionResults[i]
      if (!partitionResult.sign) {
        partitionResult = this.crypto.sign(partitionResult)
      }

      //check if we are syncing that cycle if so don't send out info on it!
      // if(this.getSyncTrackerForParition(partitionResult.Partition_id, lastCycleShardValues)) {
      //   if (this.verboseLogs ) this.mainLogger.debug( `broadcastPartitionResults skipped because parition is syncing ${partitionResult.Partition_id}`)
      //   continue
      // }

      // if(lastCycleShardValues.partitionsToSkip.has(partitionResult.Partition_id) === true){
      //   if (this.verboseLogs ) this.mainLogger.debug( `broadcastPartitionResults skipped because parition is syncing ${partitionResult.Partition_id}`)
      //   continue
      // }

      //if there is any tx that gets a slow down need to mark it.

      /** @type {ShardInfo} */
      let partitionShardData = lastCycleShardValues.parititionShardDataMap.get(partitionResult.Partition_id)
      // calculate nodes that care about this partition here
      // since we are using store partitions use storedBy
      // if we transfer back to covered partitions can switch back to coveredBy
      let coverCount = 0
      for (let nodeId in partitionShardData.storedBy) {
        if (partitionShardData.storedBy.hasOwnProperty(nodeId)) {
          // Test if node is active!!
          let possibleNode = partitionShardData.storedBy[nodeId]

          if (possibleNode.status !== 'active') {
            // don't count non active nodes for participating in the system.
            continue
          }

          coverCount++
          let partitionResultsToSend
          // If we haven't recorded this node yet create a new results object for it
          if (partitionResultsByNodeID.has(nodeId) === false) {
            nodesToTell.push(nodeId)
            partitionResultsToSend = { results: [], node: partitionShardData.storedBy[nodeId], debugStr: `c${partitionResult.Cycle_number} ` }
            partitionResultsByNodeID.set(nodeId, partitionResultsToSend)
          }
          partitionResultsToSend = partitionResultsByNodeID.get(nodeId)
          partitionResultsToSend.results.push(partitionResult)
          partitionResultsToSend.debugStr += `p${partitionResult.Partition_id} `
        }
      }

      let repairTracker = this._getRepairTrackerForCycle(cycleNumber, partitionResult.Partition_id)
      repairTracker.numNodes = coverCount - 1 // todo sharding re-evaluate this and thing of a better perf solution
    }

    let promises = []
    for (let nodeId of nodesToTell) {
      if (nodeId === lastCycleShardValues.ourNode.id) {
        continue
      }
      let partitionResultsToSend = partitionResultsByNodeID.get(nodeId)
      let payload = { Cycle_number: cycleNumber, partitionResults: partitionResultsToSend.results }
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair broadcastPartitionResults to ${nodeId} debugStr: ${partitionResultsToSend.debugStr} res: ${utils.stringifyReduce(payload)}`)
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair broadcastPartitionResults to ${nodeId} debugStr: ${partitionResultsToSend.debugStr} res: ${utils.stringifyReduce(payload)}`)

      let shorthash = utils.makeShortHash(partitionResultsToSend.node.id)
      let toNodeStr = shorthash + ':' + partitionResultsToSend.node.externalPort
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('broadcastPartitionResults', `${cycleNumber}`, `to ${toNodeStr} ${partitionResultsToSend.debugStr} `)

      // Filter nodes before we send tell()
      let filteredNodes = this.filterValidNodesForInternalMessage([partitionResultsToSend.node], 'tellCorrespondingNodes', true, true)
      if (filteredNodes.length === 0) {
        this.mainLogger.error('broadcastPartitionResults: filterValidNodesForInternalMessage skipping node')
        continue //only doing one node at a time in this loop so just skip to next node.
      }

      let promise = this.p2p.tell([partitionResultsToSend.node], 'post_partition_results', payload)
      promises.push(promise)
    }

    await Promise.all(promises)
  }

  /***
   *     #######     ##                  #######   #######     ##     ##    ###    ##    ## ########  ##       ######## ########   ######
   *    ##     ##  ####                 ##     ## ##     ##    ##     ##   ## ##   ###   ## ##     ## ##       ##       ##     ## ##    ##
   *    ##     ##    ##                 ##     ##        ##    ##     ##  ##   ##  ####  ## ##     ## ##       ##       ##     ## ##
   *    ##     ##    ##      #######    ##     ##  #######     ######### ##     ## ## ## ## ##     ## ##       ######   ########   ######
   *    ##  ## ##    ##                 ##  ## ##        ##    ##     ## ######### ##  #### ##     ## ##       ##       ##   ##         ##
   *    ##    ##     ##                 ##    ##  ##     ##    ##     ## ##     ## ##   ### ##     ## ##       ##       ##    ##  ##    ##
   *     ##### ##  ######                ##### ##  #######     ##     ## ##     ## ##    ## ########  ######## ######## ##     ##  ######
   */

  startShardCalculations() {
    //this.p2p.state.on('cycle_q1_start', async (lastCycle, time) => {
    this._registerListener(this.p2p.state, 'cycle_q1_start', async (lastCycle: Shardus.Cycle, time: number) => {
      try {
        this.profiler.profileSectionStart('stateManager_cycle_q1_start')

        this.emit('set_queue_partition_gossip')
        lastCycle = this.p2p.state.getLastCycle()
        if (lastCycle) {
          let ourNode = this.p2p.state.getNode(this.p2p.id)

          if (ourNode == null) {
            //dont attempt more calculations we may be shutting down
            return
          }

          // this.dumpAccountDebugData()
          this.updateShardValues(lastCycle.counter)
          // this.dumpAccountDebugData() // better to print values after an update!

          // calculate coverage change asap
          if (this.currentCycleShardData && this.currentCycleShardData.ourNode.status === 'active') {
            this.calculateChangeInCoverage()
          }

          if (this.syncPartitionsStarted) {
            // not certain if we want await
            this.processPreviousCycleSummaries()
          }
        }
      } finally {
        this.profiler.profileSectionEnd('stateManager_cycle_q1_start')
      }
    })

    this._registerListener(this.p2p.state, 'cycle_q3_start', async (lastCycle: Shardus.Cycle, time: number) => {
      try {
        this.profiler.profileSectionStart('stateManager_cycle_q3_start')
        // moved coverage calculation changes earlier to q1
        // if (this.currentCycleShardData && this.currentCycleShardData.ourNode.status === 'active') {
        //   this.calculateChangeInCoverage()
        // }
        lastCycle = this.p2p.state.getLastCycle()
        if (lastCycle == null) {
          return
        }
        let lastCycleShardValues = this.shardValuesByCycle.get(lastCycle.counter)
        if (lastCycleShardValues == null) {
          return
        }

        //todo wrap his up
        let cycleShardValues = null
        if (this.shardValuesByCycle.has(lastCycle.counter)) {
          cycleShardValues = this.shardValuesByCycle.get(lastCycle.counter)
        }

        this.stateManagerStats.dumpLogsForCycle(lastCycle.counter, true, cycleShardValues)

        // do this every 5 cycles.
        if (lastCycle.counter % 5 !== 0) {
          return
        }

        if (this.doDataCleanup === true) {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startSyncPartitions:cycle_q3_start-clean cycle: ${lastCycle.counter}`)
          // clean up cycle data that is more than 10 cycles old.
          this.periodicCycleDataCleanup(lastCycle.counter - 10)
        }
      } finally {
        this.profiler.profileSectionEnd('stateManager_cycle_q3_start')
      }
    })
  }

  async processPreviousCycleSummaries() {
    let lastCycle = this.p2p.state.getLastCycle()
    if (lastCycle == null) {
      return
    }
    let cycleShardValues = this.shardValuesByCycle.get(lastCycle.counter - 1)
    if (cycleShardValues == null) {
      return
    }
    if (this.currentCycleShardData == null) {
      return
    }
    if (this.currentCycleShardData.ourNode.status !== 'active') {
      return
    }
    if (cycleShardValues.ourNode.status !== 'active') {
      return
    }
    let cycle = this.p2p.state.getCycleByCounter(cycleShardValues.cycleNumber)
    if (cycle == null) {
      return
    }

    if (this.oldFeature_GeneratePartitionReport === true) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` processPreviousCycleSummaries cycle: ${cycle.counter}`)
      // this will take temp TXs and make sure they are stored in the correct place for us to generate partitions
      this.processTempTXs(cycle)

      // During the Q2 phase of a cycle, nodes compute the partition hash of the previous cycle for all the partitions covered by the node.
      // Q2 was chosen so that any transactions submitted with a time stamp that falls in the previous quarter will have been processed and finalized. This could be changed to Q3 if we find that more time is needed.
      this.generatePartitionObjects(cycle)
    }

    let receiptMapResults = []

    // Get the receipt map to send as a report
    if (this.feature_receiptMapResults === true) {
      receiptMapResults = this.generateReceiptMapResults(cycle)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `receiptMapResults: ${stringify(receiptMapResults)}`)
    }

    // Get the stats data to send as a reort
    let statsClump = {}
    if (this.feature_generateStats === true) {
      statsClump = this.stateManagerStats.getCoveredStatsPartitions(cycleShardValues)
    }

    // build partition hashes from previous full cycle
    let mainHashResults: MainHashResults = null
    if (this.feature_partitionHashes === true) {
      if (cycleShardValues && cycleShardValues.ourNode.status === 'active') {
        mainHashResults = this.stateManagerCache.buildPartitionHashesForNode(cycleShardValues)

        this.updatePartitionReport(cycleShardValues, mainHashResults)
      }
    }

    // Hook for Snapshot module to listen to after partition data is settled
    this.emit('cycleTxsFinalized', cycleShardValues, receiptMapResults, statsClump, mainHashResults)

    if (this.debugFeature_dumpAccountData === true) {
      this.dumpAccountDebugData2(mainHashResults)
    }

    // pre-allocate the next two cycles if needed
    for (let i = 1; i <= 2; i++) {
      let prekey = 'c' + (cycle.counter + i)
      if (this.partitionObjectsByCycle[prekey] == null) {
        this.partitionObjectsByCycle[prekey] = []
      }
      if (this.ourPartitionResultsByCycle[prekey] == null) {
        this.ourPartitionResultsByCycle[prekey] = []
      }
    }

    if (this.oldFeature_GeneratePartitionReport === true && this.oldFeature_BroadCastPartitionReport === true) {
      // Nodes generate the partition result for all partitions they cover.
      // Nodes broadcast the set of partition results to N adjacent peers on each side; where N is
      // the number of partitions covered by the node. Uses the /post_partition_results API.
      await this.broadcastPartitionResults(cycle.counter) // Cycle_number
    }
  }

  /**
   * updatePartitionReport
   * use our MainHashResults from in memory data to create the nextCycleReportToSend that is used by
   * getPartitionReport() / reporter module
   * @param cycleShardData
   * @param mainHashResults
   */
  updatePartitionReport(cycleShardData: CycleShardData, mainHashResults: MainHashResults) {
    if (this.feature_useNewParitionReport === false) {
      return
    }

    let partitions = cycleShardData.ourConsensusPartitions
    if (this.repairAllStoredPartitions === true) {
      partitions = cycleShardData.ourStoredPartitions
    }
    if (partitions == null) {
      throw new Error('updatePartitionReport partitions == null')
    }

    this.nextCycleReportToSend = { res: [], cycleNumber: cycleShardData.cycleNumber }

    for (let partition of partitions) {
      if (mainHashResults.partitionHashResults.has(partition)) {
        let partitionHashResults = mainHashResults.partitionHashResults.get(partition)
        this.nextCycleReportToSend.res.push({ i: partition, h: partitionHashResults.hashOfHashes })
      }
    }
  }

  async startSyncPartitions() {
    // await this.createInitialAccountBackups() // nm this is now part of regular data sync
    // register our handlers

    // this._registerListener(this.p2p.state, 'cycle_q1_start', async (lastCycle, time) => {
    //   this.updateShardValues(lastCycle.counter)
    // })

    this.syncPartitionsStarted = true

    this._registerListener(this.p2p.state, 'cycle_q2_start', async (lastCycle: Shardus.Cycle, time: number) => {
      // await this.processPreviousCycleSummaries()
      // lastCycle = this.p2p.state.getLastCycle()
      // if (lastCycle == null) {
      //   return
      // }
      // let lastCycleShardValues = this.shardValuesByCycle.get(lastCycle.counter)
      // if (lastCycleShardValues == null) {
      //   return
      // }
      // if(this.currentCycleShardData == null){
      //   return
      // }
      // if (this.currentCycleShardData.ourNode.status !== 'active') {
      //   // dont participate just yet.
      //   return
      // }
      // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startSyncPartitions:cycle_q2_start cycle: ${lastCycle.counter}`)
      // // this will take temp TXs and make sure they are stored in the correct place for us to generate partitions
      // this.processTempTXs(lastCycle)
      // // During the Q2 phase of a cycle, nodes compute the partition hash of the previous cycle for all the partitions covered by the node.
      // // Q2 was chosen so that any transactions submitted with a time stamp that falls in the previous quarter will have been processed and finalized. This could be changed to Q3 if we find that more time is needed.
      // this.generatePartitionObjects(lastCycle)
      // let receiptMapResults = this.generateReceiptMapResults(lastCycle)
      // if(this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `receiptMapResults: ${stringify(receiptMapResults)}`)
      // let statsClump = this.stateManagerStats.getCoveredStatsPartitions(lastCycleShardValues)
      // //build partition hashes from previous full cycle
      // let mainHashResults:MainHashResults = null
      // if(this.currentCycleShardData && this.currentCycleShardData.ourNode.status === 'active'){
      //   mainHashResults = this.stateManagerCache.buildPartitionHashesForNode(this.currentCycleShardData)
      // }
      // // Hook for Snapshot module to listen to after partition data is settled
      // this.emit('cycleTxsFinalized', lastCycleShardValues, receiptMapResults, statsClump, mainHashResults)
      // this.dumpAccountDebugData2(mainHashResults)
      // // pre-allocate the next cycle data to be safe!
      // let prekey = 'c' + (lastCycle.counter + 1)
      // this.partitionObjectsByCycle[prekey] = []
      // this.ourPartitionResultsByCycle[prekey] = []
      // // Nodes generate the partition result for all partitions they cover.
      // // Nodes broadcast the set of partition results to N adjacent peers on each side; where N is
      // // the number of partitions covered by the node. Uses the /post_partition_results API.
      // await this.broadcastPartitionResults(lastCycle.counter) // Cycle_number
    })

    /* this._registerListener(this.p2p.state, 'cycle_q4_start', async (lastCycle, time) => {
      // Also we would like the repair process to finish by the end of Q3 and definitely before the start of a new cycle. Otherwise the cycle duration may need to be increased.
    }) */
  }



  /**
   * tempRecordTXByCycle
   * we dont have a cycle yet to save these records against so store them in a temp place
   * @param {number} txTS
   * @param {AcceptedTx} acceptedTx
   * @param {boolean} passed
   * @param {ApplyResponse} applyResponse
   * @param {boolean} isGlobalModifyingTX
   */
  tempRecordTXByCycle(txTS: number, acceptedTx: AcceptedTx, passed: boolean, applyResponse: ApplyResponse, isGlobalModifyingTX: boolean, savedSomething: boolean) {
    this.tempTXRecords.push({ txTS, acceptedTx, passed, redacted: -1, applyResponse, isGlobalModifyingTX, savedSomething })
  }

  /**
   * sortTXRecords
   * @param {TempTxRecord} a
   * @param {TempTxRecord} b
   * @returns {number}
   */
  sortTXRecords(a: TempTxRecord, b: TempTxRecord): number {
    if (a.acceptedTx.timestamp === b.acceptedTx.timestamp) {
      return utils.sortAsc(a.acceptedTx.id, b.acceptedTx.id)
    }
    //return a.acceptedTx.timestamp - b.acceptedTx.timestamp
    return a.acceptedTx.timestamp > b.acceptedTx.timestamp ? -1 : 1
  }

  /**
   * processTempTXs
   * call this before we start computing partitions so that we can make sure to get the TXs we need out of the temp list
   * @param {Cycle} cycle
   */
  processTempTXs(cycle: Cycle) {
    if (!this.tempTXRecords) {
      return
    }
    let txsRecorded = 0
    let txsTemp = 0

    let newTempTX = []
    let cycleEnd = (cycle.start + cycle.duration) * 1000
    cycleEnd -= this.syncSettleTime // adjust by sync settle time

    // sort our records before recording them!
    this.tempTXRecords.sort(this.sortTXRecords)

    //savedSomething

    for (let txRecord of this.tempTXRecords) {
      if (txRecord.redacted > 0) {
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair recordTXByCycle: ${utils.makeShortHash(txRecord.acceptedTx.id)} cycle: ${cycle.counter} redacted!!! ${txRecord.redacted}`)
        continue
      }
      if (txRecord.txTS < cycleEnd) {
        this.recordTXByCycle(txRecord.txTS, txRecord.acceptedTx, txRecord.passed, txRecord.applyResponse, txRecord.isGlobalModifyingTX)
        txsRecorded++
      } else {
        newTempTX.push(txRecord)
        txsTemp++
      }
    }

    this.tempTXRecords = newTempTX

    let lastCycleShardValues = this.shardValuesByCycle.get(cycle.counter)

    if (lastCycleShardValues == null) {
      throw new Error('processTempTXs lastCycleShardValues == null')
    }
    if (lastCycleShardValues.ourConsensusPartitions == null) {
      throw new Error('processTempTXs ourConsensusPartitions == null')
    }
    // lastCycleShardValues.ourConsensusPartitions is not iterable
    for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
      let txList = this.getTXList(cycle.counter, partitionID) // todo sharding - done.: pass partition ID

      txList.processed = true
    }

    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair processTempTXs txsRecorded: ${txsRecorded} txsTemp: ${txsTemp} `)
  }

  // TODO sharding  done! need to split this out by partition
  /**
   * getTXList
   * @param {number} cycleNumber
   * @param {number} partitionId
   * @returns {TxTallyList}
   */
  getTXList(cycleNumber: number, partitionId: number): TxTallyList {
    let key = 'c' + cycleNumber
    let txListByPartition = this.txByCycleByPartition[key]
    let pkey = 'p' + partitionId
    // now search for the correct partition
    if (!txListByPartition) {
      txListByPartition = {}
      this.txByCycleByPartition[key] = txListByPartition
    }
    let txList = txListByPartition[pkey]
    if (!txList) {
      txList = { hashes: [], passed: [], txs: [], processed: false, states: [] } // , txById: {}
      txListByPartition[pkey] = txList
    }
    return txList
  }

  // TODO sharding  done! need to split this out by partition
  /**
   * getTXListByKey
   * just an alternative to getTXList where the calling code has alredy formed the cycle key
   * @param {string} key the cycle based key c##
   * @param {number} partitionId
   * @returns {TxTallyList}
   */
  getTXListByKey(key: string, partitionId: number): TxTallyList {
    // let txList = this.txByCycle[key]
    // if (!txList) {
    //   txList = { hashes: [], passed: [], txs: [], processed: false, states: [] } //  ,txById: {}  states may be an array of arraywith account after states
    //   this.txByCycle[key] = txList
    // }

    let txListByPartition = this.txByCycleByPartition[key]
    let pkey = 'p' + partitionId
    // now search for the correct partition
    if (!txListByPartition) {
      txListByPartition = {}
      this.txByCycleByPartition[key] = txListByPartition
    }
    let txList = txListByPartition[pkey]
    if (!txList) {
      txList = { hashes: [], passed: [], txs: [], processed: false, states: [] } // , txById: {}
      txListByPartition[pkey] = txList
    }
    return txList
  }

  // take this tx and create if needed and object for the current cylce that holds a list of passed and failed TXs
  /**
   * recordTXByCycle
   *   This function is only for building up txList as used by the features: stateIsGood_txHashsetOld, oldFeature_BroadCastPartitionReport, oldFeature_GeneratePartitionReport
   * @param {number} txTS
   * @param {AcceptedTx} acceptedTx
   * @param {boolean} passed
   * @param {ApplyResponse} applyResponse
   */
  recordTXByCycle(txTS: number, acceptedTx: AcceptedTx, passed: boolean, applyResponse: ApplyResponse, isGlobalModifyingTX: boolean) {
    // TODO sharding.  done because it uses getTXList . filter TSs by the partition they belong to. Double check that this is still needed

    // get the cycle that this tx timestamp would belong to.
    // add in syncSettleTime when selecting which bucket to put a transaction in
    const cycle = this.p2p.state.getCycleByTimestamp(txTS + this.syncSettleTime)

    if (cycle == null) {
      this.mainLogger.error(`recordTXByCycle Failed to find cycle that would contain this timestamp txid:${utils.stringifyReduce(acceptedTx.id)} txts1: ${acceptedTx.timestamp} txts: ${txTS}`)
      return
    }

    let cycleNumber = cycle.counter

    // for each covered partition..

    let lastCycleShardValues = this.shardValuesByCycle.get(cycle.counter)

    let keysResponse = this.app.getKeyFromTransaction(acceptedTx.data)
    let { allKeys } = keysResponse

    let seenParitions: StringBoolObjectMap = {}
    let partitionHasNonGlobal: StringBoolObjectMap = {}
    // for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
    if (lastCycleShardValues == null) {
      throw new Error(`recordTXByCycle lastCycleShardValues == null`)
    }

    if (isGlobalModifyingTX) {
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle:  ignore loggging globalTX ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)
      return
    }

    let globalACC = 0
    let nonGlobal = 0
    let storedNonGlobal = 0
    let storedGlobal = 0
    //filter out stuff.
    if (isGlobalModifyingTX === false) {
      for (let accountKey of allKeys) {
        // HOMENODEMATHS recordTXByCycle: using partition to decide recording partition
        let { homePartition } = ShardFunctions.addressToPartition(lastCycleShardValues.shardGlobals, accountKey)
        let partitionID = homePartition
        let weStoreThisParition = ShardFunctions.testInRange(partitionID, lastCycleShardValues.nodeShardData.storedPartitions)
        let key = 'p' + partitionID

        if (this.isGlobalAccount(accountKey)) {
          globalACC++

          if (weStoreThisParition === true) {
            storedGlobal++
          }
        } else {
          nonGlobal++

          if (weStoreThisParition === true) {
            storedNonGlobal++
            partitionHasNonGlobal[key] = true
          }
        }
      }
    }

    if (storedNonGlobal === 0 && storedGlobal === 0) {
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle: nothing to save globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)
      return
    }
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle: globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal}  tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)

    for (let accountKey of allKeys) {
      /** @type {NodeShardData} */
      let homeNode = ShardFunctions.findHomeNode(lastCycleShardValues.shardGlobals, accountKey, lastCycleShardValues.parititionShardDataMap)
      if (homeNode == null) {
        throw new Error(`recordTXByCycle homeNode == null`)
      }
      // HOMENODEMATHS recordTXByCycle: this code has moved to use homepartition instead of home node's partition
      let homeNodepartitionID = homeNode.homePartition
      let { homePartition } = ShardFunctions.addressToPartition(lastCycleShardValues.shardGlobals, accountKey)
      let partitionID = homePartition
      let key = 'p' + partitionID

      if (this.isGlobalAccount(accountKey)) {
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle:  skip partition. dont save due to global: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)
        continue
      }

      let weStoreThisParition = ShardFunctions.testInRange(partitionID, lastCycleShardValues.nodeShardData.storedPartitions)
      if (weStoreThisParition === false) {
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle:  skip partition we dont save: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)

        continue
      }

      if (partitionHasNonGlobal[key] === false) {
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle:  skip partition. we store it but only a global ref involved this time: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)

        continue
      }
      //check if we are only storing this because it is a global account...

      let txList = this.getTXList(cycleNumber, partitionID) // todo sharding - done: pass partition ID

      if (txList.processed) {
        continue
        //this.mainLogger.error(`_repair trying to record transaction after we have already finalized our parition object for cycle ${cycle.counter} `)
      }

      if (seenParitions[key] != null) {
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle: seenParitions[key] != null P: ${partitionID}  homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber} entries: ${txList.hashes.length} --TX already recorded for cycle`)
        // skip because this partition already has this TX!
        continue
      }
      seenParitions[key] = true

      txList.hashes.push(acceptedTx.id)
      txList.passed.push(passed ? 1 : 0)
      txList.txs.push(acceptedTx)

      let recordedState = false
      if (applyResponse != null && applyResponse.accountData != null) {
        let states = []
        let foundAccountIndex = 0
        let index = 0
        for (let accountData of applyResponse.accountData) {
          if (accountData.accountId === accountKey) {
            foundAccountIndex = index
          }
          //states.push(utils.makeShortHash(accountData.hash)) // TXSTATE_TODO need to get only certain state data!.. hash of local states?
          // take a look at backup data?

          //TSConversion some uncertainty with around hash being on the data or not.  added logggin.
          // // @ts-ignore
          // if(accountData.hash != null){
          //   // @ts-ignore
          //   if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug( ` _repair recordTXByCycle:  how is this possible: ${utils.makeShortHash(accountData.accountId)} acc hash: ${utils.makeShortHash(accountData.hash)} acc stateID: ${utils.makeShortHash(accountData.stateId)}`)

          // }
          // if(accountData.stateId == null){
          //   // @ts-ignore
          //   throw new Error(`missing state id for ${utils.makeShortHash(accountData.accountId)} acc hash: ${utils.makeShortHash(accountData.hash)} acc stateID: ${utils.makeShortHash(accountData.stateId)} `)
          // }

          // account data got upgraded earlier to have hash on it

          //if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle: Pushed! P: ${partitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber} entries: ${txList.hashes.length} --TX already recorded for cycle`)

          states.push(utils.makeShortHash(((accountData as unknown) as Shardus.AccountData).hash))
          index++
          recordedState = true
        }
        txList.states.push(states[foundAccountIndex]) // TXSTATE_TODO does this check out?
      } else {
        txList.states.push('xxxx')
      }
      // txList.txById[acceptedTx.id] = acceptedTx
      // TODO sharding perf.  need to add some periodic cleanup when we have more cycles than needed stored in this map!!!
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair recordTXByCycle: pushedData P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber} entries: ${txList.hashes.length} recordedState: ${recordedState}`)
    }
  }

  /**
   * getPartitionObject
   * @param {number} cycleNumber
   * @param {number} partitionId
   * @returns {PartitionObject}
   */
  getPartitionObject(cycleNumber: number, partitionId: number): PartitionObject | null {
    let key = 'c' + cycleNumber
    let partitionObjects = this.partitionObjectsByCycle[key]
    for (let obj of partitionObjects) {
      if (obj.Partition_id === partitionId) {
        return obj
      }
    }
    return null
  }

  /**
   * storePartitionReceipt
   * TODO sharding perf.  may need to do periodic cleanup of this and other maps so we can remove data from very old cycles
   * TODO production need to do something with this data
   * @param {number} cycleNumber
   * @param {PartitionReceipt} partitionReceipt
   */
  storePartitionReceipt(cycleNumber: number, partitionReceipt: PartitionReceipt) {
    let key = 'c' + cycleNumber

    if (!this.partitionReceiptsByCycleCounter) {
      this.partitionReceiptsByCycleCounter = {}
    }
    if (!this.partitionReceiptsByCycleCounter[key]) {
      this.partitionReceiptsByCycleCounter[key] = []
    }
    this.partitionReceiptsByCycleCounter[key].push(partitionReceipt)

    if (this.debugFeatureOld_partitionReciepts === true) {
      // this doesnt really send to the archiver but it it does dump reciepts to logs.
      this.trySendAndPurgeReceiptsToArchives(partitionReceipt)
    }
  }

  storeOurPartitionReceipt(cycleNumber: number, partitionReceipt: PartitionReceipt) {
    let key = 'c' + cycleNumber

    if (!this.ourPartitionReceiptsByCycleCounter) {
      this.ourPartitionReceiptsByCycleCounter = {}
    }
    this.ourPartitionReceiptsByCycleCounter[key] = partitionReceipt
  }

  getPartitionReceipt(cycleNumber: number) {
    let key = 'c' + cycleNumber

    if (!this.ourPartitionReceiptsByCycleCounter) {
      return null
    }
    return this.ourPartitionReceiptsByCycleCounter[key]
  }

  /**
   * findMostCommonResponse
   * @param {number} cycleNumber
   * @param {number} partitionId
   * @param {string[]} ignoreList currently unused and broken todo resolve this.
   * @return {{topHash: string, topCount: number, topResult: PartitionResult}}
   */
  findMostCommonResponse(cycleNumber: number, partitionId: number, ignoreList: string[]): { topHash: string | null; topCount: number; topResult: PartitionResult | null } {
    let key = 'c' + cycleNumber
    let responsesById = this.allPartitionResponsesByCycleByPartition[key]
    let key2 = 'p' + partitionId
    let responses = responsesById[key2]

    let hashCounting: StringNumberObjectMap = {}
    let topHash = null
    let topCount = 0
    let topResult = null
    if (responses.length > 0) {
      for (let partitionResult of responses) {
        let hash = partitionResult.Partition_hash
        let count = hashCounting[hash] || 0
        count++
        hashCounting[hash] = count
        if (count > topCount) {
          topCount = count
          topHash = hash
          topResult = partitionResult
        }
      }
    }
    // reaponsesById: ${utils.stringifyReduce(responsesById)}
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair findMostCommonResponse: retVal: ${utils.stringifyReduce({ topHash, topCount, topResult })}  responses: ${utils.stringifyReduce(responses)} `)
    return { topHash, topCount, topResult }
  }

  // vote rate set to 0.5 / 0.8 => 0.625
  /**
   * solveHashSets
   * @param {GenericHashSetEntry[]} hashSetList
   * @param {number} lookAhead
   * @param {number} voteRate
   * @param {string[]} prevOutput
   * @returns {string[]}
   */
  static solveHashSets(hashSetList: GenericHashSetEntry[], lookAhead: number = 10, voteRate: number = 0.625, prevOutput: string[] | null = null): string[] {
    let output = []
    let outputVotes = []
    let solving = true
    let index = 0
    let lastOutputCount = 0 // output list length last time we went through the loop
    let stepSize = cHashSetStepSize

    let totalVotePower = 0
    for (let hashListEntry of hashSetList) {
      totalVotePower += hashListEntry.votePower
    }
    let votesRequired = voteRate * Math.ceil(totalVotePower)

    let maxElements = 0
    for (let hashListEntry of hashSetList) {
      maxElements = Math.max(maxElements, hashListEntry.hashSet.length / stepSize)
    }

    while (solving) {
      let votes: StringCountEntryObjectMap = {}
      let topVote: Vote = { v: '', count: 0, vote: undefined, ec: undefined }
      let winnerFound = false
      let totalVotes = 0
      // Loop through each entry list
      for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
        // if we are already past the end of this entry list then skip
        let hashListEntry = hashSetList[hashListIndex]
        if ((index + hashListEntry.indexOffset + 1) * stepSize > hashListEntry.hashSet.length) {
          continue
        }
        // don't remember what this bail condition was.
        let sliceStart = (index + hashListEntry.indexOffset) * stepSize
        let v = hashListEntry.hashSet.slice(sliceStart, sliceStart + stepSize)
        if (v === '') {
          continue
        }
        // place votes for this value
        let countEntry: CountEntry = votes[v] || { count: 0, ec: 0, voters: [] }
        totalVotes += hashListEntry.votePower
        countEntry.count += hashListEntry.votePower
        countEntry.voters.push(hashListIndex)
        votes[v] = countEntry
        if (countEntry.count > topVote.count) {
          topVote.count = countEntry.count
          topVote.v = v
          topVote.vote = countEntry
        }
        hashListEntry.lastValue = v
      }

      // if totalVotes < votesRequired then we are past hope of approving any more messages... I think.  I guess there are some cases where we could look back and approve one more
      if (topVote.count === 0 || index > maxElements || totalVotes < votesRequired) {
        solving = false
        break
      }
      // can we find a winner in a simple way where there was a winner based on the next item to look at in all the arrays.
      if (topVote.count >= votesRequired) {
        winnerFound = true
        output.push(topVote.v)
        outputVotes.push(topVote)
        // corrections for chains that do not match our top vote.
        for (let k = 0; k < hashSetList.length; k++) {
          let hashListEntryOther = hashSetList[k]
          if (hashListEntryOther.lastValue === topVote.v) {
            hashListEntryOther.errorStack = []
          }
        }
      }

      // Leaving this here, because it is a good spot to put a breakpoint when testing a data set where stuf went wrong (hashset.js)
      // if (index === 123) {
      //   let foo = 5
      //   foo++
      // }

      // for (let hashListEntry of hashSetList) {
      for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
        let hashListEntry = hashSetList[hashListIndex]
        // for nodes that did not match the top vote .. or all nodes if no winner yet.
        if (!winnerFound || hashListEntry.lastValue !== topVote.v) {
          // consider removing v..  since if we dont have a winner yet then top vote will get updated in this loop
          hashListEntry.corrections.push({ i: index, tv: topVote, v: topVote.v, t: 'insert', bv: hashListEntry.lastValue, if: lastOutputCount })
          hashListEntry.errorStack.push({ i: index, tv: topVote, v: topVote.v })
          hashListEntry.indexOffset -= 1

          if (hashListEntry.waitForIndex > 0 && index < hashListEntry.waitForIndex) {
            continue
          }

          if (hashListEntry.waitForIndex > 0 && hashListEntry.waitForIndex === index) {
            hashListEntry.waitForIndex = -1
            hashListEntry.waitedForThis = true
          }

          let alreadyVoted: StringBoolObjectMap = {} // has the given node already EC voted for this key?
          // +1 look ahead to see if we can get back on track
          // lookAhead of 0 seems to be more stable
          // let lookAhead = 10 // hashListEntry.errorStack.length
          for (let i = 0; i < hashListEntry.errorStack.length + lookAhead; i++) {
            // using +2 since we just subtracted one from the index offset. anothe r +1 since we want to look ahead of where we just looked
            let thisIndex = index + hashListEntry.indexOffset + i + 2
            let sliceStart = thisIndex * stepSize
            if (sliceStart + 1 > hashListEntry.hashSet.length) {
              continue
            }
            let v = hashListEntry.hashSet.slice(sliceStart, sliceStart + stepSize)
            if (alreadyVoted[v]) {
              continue
            }

            // a hint to stop us from looking ahead too far
            // if (prevOutput && prevOutput[index + i + 2] === v) {
            //   break
            // }

            // scan ahead for other connections
            if (prevOutput && !hashListEntry.waitedForThis) {
              let foundMatch = false
              let searchAhead = 5 // Math.max(10, lookAhead - i)
              for (let k = 1; k < searchAhead; k++) {
                let idx = index + k // + 2 + hashListEntry.indexOffset
                if (prevOutput.length <= idx) {
                  break
                }
                if (prevOutput && prevOutput[idx] === v) {
                  foundMatch = true
                  hashListEntry.waitForIndex = index + k
                  hashListEntry.futureIndex = index + hashListEntry.indexOffset + i + 2
                  hashListEntry.futureValue = v
                }
              }
              if (foundMatch) {
                break
              }
            }

            alreadyVoted[v] = true
            let countEntry: CountEntry = votes[v] || { count: 0, ec: 0, voters: [] } // TSConversion added a missing voters[] object here. looks good to my code inspection but need to validate it with tests!

            // only vote 10 spots ahead
            if (i < 10) {
              countEntry.ec += hashListEntry.votePower
            }

            // check for possible winnner due to re arranging things
            // a nuance here that we require there to be some official votes before in this row before we consider a tx..  will need to analyze this choice
            if (!winnerFound && countEntry.count > 0 && countEntry.ec + countEntry.count >= votesRequired) {
              topVote.ec = countEntry.ec
              topVote.v = v
              topVote.vote = countEntry
              winnerFound = true
              output.push(topVote.v)
              outputVotes.push(topVote)
              // todo roll back corrctions where nodes were already voting for the winner.
              for (let k = 0; k < hashListIndex; k++) {
                let hashListEntryOther = hashSetList[k]
                if (hashListEntryOther.lastValue === topVote.v) {
                  hashListEntryOther.errorStack.pop()
                  hashListEntryOther.corrections.pop()
                  hashListEntryOther.indexOffset++
                }
              }
            }

            if (winnerFound) {
              if (v === topVote.v) {
                if (hashListEntry.waitedForThis) {
                  hashListEntry.waitedForThis = false
                }
                // delete stuff off stack and bail
                // +1 because we at least want to delete 1 entry if index i=0 of this loop gets us here

                /** @type {HashSetEntryCorrection[]} */
                let tempCorrections = []
                // for (let j = 0; j < i + 1; j++) {
                //   let correction = null
                //   //if (i < hashListEntry.errorStack.length)
                //   {
                //     hashListEntry.errorStack.pop()
                //     correction = hashListEntry.corrections.pop()
                //   }
                //   tempCorrections.push({ i: index - j, t: 'extra', c: correction })
                // }
                let index2 = index + hashListEntry.indexOffset + i + 2
                let lastIdx = -1

                for (let j = 0; j < i + 1; j++) {
                  /** @type {HashSetEntryCorrection} */
                  let correction = null
                  if (hashListEntry.errorStack.length > 0) {
                    hashListEntry.errorStack.pop()
                    correction = hashListEntry.corrections.pop()
                  }
                  let extraIdx = j + index2 - (i + 1)
                  if (correction) {
                    extraIdx = correction.i - 1
                    lastIdx = extraIdx
                  } else if (lastIdx > 0) {
                    extraIdx = lastIdx
                  }
                  // correction to fix problem where we were over deleting stuff.
                  // a bit more retroactive than I like.  problem happens in certain cases when there are two winners in a row that are not first pass winners
                  // see 16z for example where this breaks..
                  // if (hashListEntry.corrections.length > 0) {
                  //   let nextCorrection = hashListEntry.corrections[hashListEntry.corrections.length - 1]
                  //   if (nextCorrection && correction && nextCorrection.bv === correction.bv) {
                  //     if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` solveHashSets overdelete fix: i:${i} j:${j} index:${index} bv:${nextCorrection.bv}}`)
                  //     continue
                  //   }
                  // }

                  // hashListEntry.indexOffset++
                  /** @type {HashSetEntryCorrection} */

                  // @ts-ignore  solveHashSets is unused at the moment not going to bother with ts fixup
                  let tempCorrection: HashSetEntryCorrection = { i: extraIdx, t: 'extra', c: correction, hi: index2 - (j + 1), tv: null, v: null, bv: null, if: -1 } // added tv: null, v: null, bv: null, if: -1
                  tempCorrections.push(tempCorrection)
                }

                hashListEntry.corrections = hashListEntry.corrections.concat(tempCorrections)
                // +2 so we can go from being put one behind and go to 1 + i ahead.
                hashListEntry.indexOffset += i + 2

                // hashListEntry.indexOffset += (1)

                hashListEntry.errorStack = [] // clear the error stack
                break
              } else {
                // backfil checking
                // let outputIndex = output.length - 1
                // let tempV = v
                // let stepsBack = 1
                // while (output.length > 0 && outputIndex > 0 && output[outputIndex] === tempV) {
                //   // work backwards through continuous errors and redact them as long as they match up
                //   outputIndex--
                //   stepsBack++
                // }
              }
            }
          }

          if (hashListEntry.waitedForThis) {
            hashListEntry.waitedForThis = false
          }
        }
      }
      index++
      lastOutputCount = output.length
    }

    // trailing extras cleanup.
    for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
      let hashListEntry = hashSetList[hashListIndex]

      let extraIdx = index
      while ((extraIdx + hashListEntry.indexOffset) * stepSize < hashListEntry.hashSet.length) {
        let hi = extraIdx + hashListEntry.indexOffset // index2 - (j + 1)
        // @ts-ignore  solveHashSets is unused at the moment not going to bother with ts fixup
        hashListEntry.corrections.push({ i: extraIdx, t: 'extra', c: null, hi: hi, tv: null, v: null, bv: null, if: -1 }) // added , tv: null, v: null, bv: null, if: -1
        extraIdx++
      }
    }

    return output // { output, outputVotes }
  }

  // figures out i A is Greater than B
  // possibly need an alternate version of this solver
  // needs to account for vote power!
  static compareVoteObjects(voteA: ExtendedVote, voteB: ExtendedVote, strict: boolean) {
    // { winIdx: null, val: v, count: 0, ec: 0, lowestIndex: index, voters: [], voteTally: Array(hashSetList.length) }
    // { i: index }

    let agtb = 0
    let bgta = 0

    for (let i = 0; i < voteA.voteTally.length; i++) {
      let vtA = voteA.voteTally[i]
      let vtB = voteB.voteTally[i]
      if (vtA != null && vtB != null) {
        if (vtA.i > vtB.i) {
          agtb += vtA.p // vote power.  note A and B are the same node so power will be equal.
        }
        if (vtB.i > vtA.i) {
          bgta += vtB.p // vote power.
        }
      }
    }
    // what to do with strict.
    if (strict && agtb > 0) {
      return 1
    }

    //return agtb - bgta

    return utils.sortAsc(agtb, bgta)

    // what to return?
  }

  // static compareVoteObjects2 (voteA, voteB, strict) {
  //   // return voteB.votesseen - voteA.votesseen
  //   return voteA.votesseen - voteB.votesseen
  // }

  // when sorting / computing need to figure out if pinning will short cirquit another vote.
  // at the moment this seems

  // vote rate set to 0.5 / 0.8 => 0.625
  /**
   * solveHashSets
   * @param {GenericHashSetEntry[]} hashSetList
   * @param {number} lookAhead
   * @param {number} voteRate
   *
   * @returns {string[]}
   */
  static solveHashSets2(hashSetList: GenericHashSetEntry[], lookAhead: number = 10, voteRate: number = 0.625): string[] {
    let output: string[] = []
    // let outputVotes = []
    let solving = true
    let index = 0
    let stepSize = cHashSetStepSize

    let totalVotePower = 0
    for (let hashListEntry of hashSetList) {
      totalVotePower += hashListEntry.votePower
      // init the pinIdx
      hashListEntry.pinIdx = -1
      hashListEntry.pinObj = null
    }
    let votesRequired = voteRate * Math.ceil(totalVotePower)

    let maxElements = 0
    for (let hashListEntry of hashSetList) {
      maxElements = Math.max(maxElements, hashListEntry.hashSet.length / stepSize)
    }

    // todo backtrack each vote. list of what vote cast at each step.
    // solve this for only one object... or solve for all and compare solvers?

    // map of array of vote entries
    let votes = {} as { [x: string]: ExtendedVote[] }
    let votesseen = 0
    while (solving) {
      // Loop through each entry list
      solving = false
      for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
        // if we are already past the end of this entry list then skip
        let hashListEntry = hashSetList[hashListIndex]
        if ((index + 1) * stepSize > hashListEntry.hashSet.length) {
          continue
        }
        // don't remember what this bail condition was.
        let sliceStart = index * stepSize
        let v = hashListEntry.hashSet.slice(sliceStart, sliceStart + stepSize)
        if (v === '') {
          continue
        }
        solving = true // keep it going
        let votesArray: ExtendedVote[] = votes[v]
        if (votesArray == null) {
          votesseen++
          //TSConversion this was potetially a major bug, v was missing from this structure before!
          // @ts-ignore TSConversion solveHashSets2 is unused. but need to hold off o fixing up these potential nulls
          let votObject: ExtendedVote = { winIdx: null, val: v, v, count: 0, ec: 0, lowestIndex: index, voters: [], voteTally: Array(hashSetList.length), votesseen } as ExtendedVote
          votesArray = [votObject]
          votes[v] = votesArray

          // hashListEntry.ownVotes.push(votObject)
        }

        // get lowest value in list that we have not voted on and is not pinned by our best vote.
        let currentVoteObject: ExtendedVote | null = null
        for (let voteIndex = votesArray.length - 1; voteIndex >= 0; voteIndex--) {
          let voteObject = votesArray[voteIndex]

          let ourVoteTally = voteObject.voteTally[hashListIndex]
          if (ourVoteTally != null) {
            // we voted
            break
          }

          // how to check pinIdx?  do we have to analys neighbor pinIdx?
          // use pinObj  to see if the last pinObj A is greater than this obj B.
          if (hashListEntry.pinObj != null && hashListEntry.pinObj !== voteObject) {
            // if (hashListEntry.pinObj.val === voteObject.val)
            {
              let compare = StateManager.compareVoteObjects(hashListEntry.pinObj, voteObject, false)
              if (compare > 0) {
                continue // or break;
              }
            }
          }
          currentVoteObject = voteObject
        }

        if (currentVoteObject == null) {
          // create new vote object
          votesseen++
          //TSConversion this was potetially a major bug, v was missing from this structure before!
          // @ts-ignore TSConversion solveHashSets2 is unused. but need to hold off o fixing up these potential nulls
          currentVoteObject = { winIdx: null, val: v, v, count: 0, ec: 0, lowestIndex: index, voters: [], voteTally: Array(hashSetList.length), votesseen } as ExtendedVote
          votesArray.push(currentVoteObject)
          // hashListEntry.ownVotes.push(currentVoteObject)
        }
        if (currentVoteObject.voters == null) {
          throw new Error('solveHashSets2 currentVoteObject.voters == null')
        }
        if (hashListEntry == null || hashListEntry.ownVotes == null) {
          throw new Error(`solveHashSets2 hashListEntry == null ${hashListEntry == null}`)
        }

        currentVoteObject.voters.push(hashListIndex)
        currentVoteObject.voteTally[hashListIndex] = { i: index, p: hashListEntry.votePower } // could this be a simple index
        currentVoteObject.count += hashListEntry.votePower
        hashListEntry.ownVotes.push(currentVoteObject)

        if (currentVoteObject.winIdx !== null) {
          // this already won before but we should still update our own pinIdx

          hashListEntry.pinIdx = index
          hashListEntry.pinObj = currentVoteObject
        }
        if (currentVoteObject.count >= votesRequired) {
          for (let i = 0; i < hashSetList.length; i++) {
            let tallyObject = currentVoteObject.voteTally[i]
            if (tallyObject != null) {
              let tallyHashListEntry = hashSetList[i]
              tallyHashListEntry.pinIdx = tallyObject.i
              tallyHashListEntry.pinObj = currentVoteObject
            }
          }
          currentVoteObject.winIdx = index
        }
      }

      index++
    }

    // need backtracking ref for how each list tracks the votses

    // Collect a list of all vodes
    let allVotes: ExtendedVote[] = []
    for (const votesArray of Object.values(votes)) {
      for (let voteObj of votesArray) {
        allVotes.push(voteObj)
      }
    }
    // apply a partial order sort, n
    // allVotes.sort(function (a, b) { return StateManager.compareVoteObjects(a, b, false) })

    // generate solutions!

    // count only votes that have won!
    // when / how is it safe to detect a win?

    let allWinningVotes: ExtendedVote[] = []
    for (let voteObj of allVotes) {
      // IF was a a winning vote?
      if (voteObj.winIdx !== null) {
        allWinningVotes.push(voteObj)
      }
    }
    allWinningVotes.sort(function (a, b) {
      return StateManager.compareVoteObjects(a, b, false)
    })
    let finalIdx = 0
    for (let voteObj of allWinningVotes) {
      // IF was a a winning vote?
      if (voteObj.winIdx !== null) {
        // allWinningVotes.push(voteObj)
        output.push(voteObj.val)
        voteObj.finalIdx = finalIdx
        finalIdx++
      }
    }
    // to sort the values we could look at the order things were finalized..
    // but you could have a case where an earlier message is legitimately finialized later on.

    // let aTest = votes['55403088d5636488d3ff17d7d90c052e'][0]
    // let bTest = votes['779980ea84b8a5eac2dc3d07013377e5'][0]
    // console.log(StateManager.compareVoteObjects(aTest, bTest, false))
    // console.log(StateManager.compareVoteObjects(bTest, aTest, false))

    // correction solver:
    for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
      // if we are already past the end of this entry list then skip
      // let hashListIndex = 2

      let hashListEntry = hashSetList[hashListIndex]
      hashListEntry.corrections = [] // clear this
      // hashListEntry.instructions = []
      // console.log(`solution for set ${hashListIndex}  locallen:${hashListEntry.hashSet.length / stepSize} `)
      let winningVoteIndex = 0
      for (let voteObj of allWinningVotes) {
        if (voteObj.voteTally[hashListIndex] == null) {
          // console.log(`missing @${voteObj.finalIdx} v:${voteObj.val}`)
          // bv: hashListEntry.lastValue, if: lastOutputCount  are old.
          // @ts-ignore TSConversion solveHashSets2 is unused. but need to hold off o fixing up these potential nulls
          hashListEntry.corrections.push({ i: winningVoteIndex, tv: voteObj, v: voteObj.val, t: 'insert', bv: null, if: -1 })
        }
        // what if we have it but it is in the wrong spot!!
        winningVoteIndex++
      }
      if (hashListEntry == null || hashListEntry.ownVotes == null) {
        throw new Error(`solveHashSets2 hashListEntry == null 2 ${hashListEntry == null}`)
      }
      for (let voteObj of hashListEntry.ownVotes) {
        let localIdx = voteObj.voteTally[hashListIndex].i
        if (voteObj.winIdx == null) {
          // console.log(`extra @${stringify(voteObj.voteTally[hashListIndex])} v:${voteObj.val}`)
          // @ts-ignore TSConversion solveHashSets2 is unused. but need to hold off o fixing up these potential nulls
          hashListEntry.corrections.push({ i: localIdx, t: 'extra', c: null, hi: localIdx, tv: null, v: null, bv: null, if: -1 })
        }
        // localIdx++
      }

      // not so sure about this sort  local vs. global index space.
      hashListEntry.corrections.sort(utils.sort_i_Asc) // (a, b) => a.i - b.i)
      winningVoteIndex = 0

      // hashListEntry.allWinningVotes = allWinningVotes

      // build index map now!
      hashListEntry.indexMap = []
      hashListEntry.extraMap = []

      for (let voteObj of allWinningVotes) {
        if (voteObj.voteTally[hashListIndex] == null) {
          hashListEntry.indexMap.push(-1)
        } else {
          hashListEntry.indexMap.push(voteObj.voteTally[hashListIndex].i)
        }
      }
      for (let voteObj of hashListEntry.ownVotes) {
        let localIdx = voteObj.voteTally[hashListIndex].i
        if (voteObj.winIdx == null) {
          hashListEntry.extraMap.push(localIdx)
        }
      }
    }

    // generate corrections for main entry.
    // hashListEntry.corrections.push({ i: index, tv: topVote, v: topVote.v, t: 'insert', bv: hashListEntry.lastValue, if: lastOutputCount })
    // hashListEntry.errorStack.push({ i: index, tv: topVote, v: topVote.v })
    // hashListEntry.indexOffset -= 1

    // trailing extras:
    // while ((extraIdx + hashListEntry.indexOffset) * stepSize < hashListEntry.hashSet.length) {
    //   let hi = extraIdx + hashListEntry.indexOffset // index2 - (j + 1)
    //   hashListEntry.corrections.push({ i: extraIdx, t: 'extra', c: null, hi: hi, tv: null, v: null, bv: null, if: -1 }) // added , tv: null, v: null, bv: null, if: -1
    //   extraIdx++
    // }

    return output // { output, outputVotes }
  }

  /**
   * expandIndexMapping
   * efficient transformation to create a lookup to go from answer space index to the local index space of a hashList entry
   * also creates a list of local indicies of elements to remove
   * @param {GenericHashSetEntry} hashListEntry
   * @param {string[]} output This is the output that we got from the general solver
   */
  static expandIndexMapping(hashListEntry: GenericHashSetEntry, output: string[]) {
    // hashListEntry.corrections.sort(function (a, b) { return a.i === b.i ? 0 : a.i < b.i ? -1 : 1 })
    // // index map is our index to the solution output
    // hashListEntry.indexMap = []
    // // extra map is the index in our list that is an extra
    // hashListEntry.extraMap = []
    // let readPtr = 0
    // let writePtr = 0
    // let correctionIndex = 0
    // let currentCorrection = null
    // let extraBits = 0
    // // This will walk the input and output indicies st that same time
    // while (writePtr < output.length) {
    //   // Get the current correction.  We walk this with the correctionIndex
    //   if (correctionIndex < hashListEntry.corrections.length && hashListEntry.corrections[correctionIndex] != null && hashListEntry.corrections[correctionIndex].t === 'insert' && hashListEntry.corrections[correctionIndex].i <= writePtr) {
    //     currentCorrection = hashListEntry.corrections[correctionIndex]
    //     correctionIndex++
    //   } else if (correctionIndex < hashListEntry.corrections.length && hashListEntry.corrections[correctionIndex] != null && hashListEntry.corrections[correctionIndex].t === 'extra' && hashListEntry.corrections[correctionIndex].hi <= readPtr) {
    //     currentCorrection = hashListEntry.corrections[correctionIndex]
    //     correctionIndex++
    //   } else {
    //     currentCorrection = null
    //   }
    //   // if (extraBits > 0) {
    //   //   readPtr += extraBits
    //   //   extraBits = 0
    //   // }
    //   // increment pointers based on if there is a correction to write and what type of correction it is
    //   if (!currentCorrection) {
    //     // no correction to consider so we just write to the index map and advance the read and write pointer
    //     hashListEntry.indexMap.push(readPtr)
    //     writePtr++
    //     readPtr++
    //   } else if (currentCorrection.t === 'insert') {
    //     // insert means the fix for this slot is to insert an item, since we dont have it this will be -1
    //     hashListEntry.indexMap.push(-1)
    //     writePtr++
    //   } else if (currentCorrection.t === 'extra') {
    //     // hashListEntry.extraMap.push({ i: currentCorrection.i, hi: currentCorrection.hi })
    //     hashListEntry.extraMap.push(currentCorrection.hi)
    //     extraBits++
    //     readPtr++
    //     // if (currentCorrection.c === null) {
    //     //   writePtr++
    //     // }
    //     continue
    //   }
    // }
    // // final corrections:
    // while (correctionIndex < hashListEntry.corrections.length) {
    //   currentCorrection = hashListEntry.corrections[correctionIndex]
    //   correctionIndex++
    //   if (currentCorrection.t === 'extra') {
    //     // hashListEntry.extraMap.push({ i: currentCorrection.i, hi: currentCorrection.hi })
    //     hashListEntry.extraMap.push(currentCorrection.hi)
    //     // extraBits++
    //     continue
    //   }
    // }
  }

  /**
   * solveHashSetsPrep
   * todo cleanup.. just sign the partition object asap so we dont have to check if there is a valid sign object throughout the code (but would need to consider perf impact of this)
   * @param {number} cycleNumber
   * @param {number} partitionId
   * @param {string} ourNodeKey
   * @return {GenericHashSetEntry[]}
   */
  solveHashSetsPrep(cycleNumber: number, partitionId: number, ourNodeKey: string): HashSetEntryPartitions[] {
    let key = 'c' + cycleNumber
    let responsesById = this.allPartitionResponsesByCycleByPartition[key]
    let key2 = 'p' + partitionId
    let responses = responsesById[key2]

    let hashSets = {} as { [hash: string]: HashSetEntryPartitions }
    let hashSetList: HashSetEntryPartitions[] = []
    // group identical sets together
    let hashCounting: StringNumberObjectMap = {}
    for (let partitionResult of responses) {
      let hash = partitionResult.Partition_hash
      let count = hashCounting[hash] || 0
      if (count === 0) {
        let owner: string | null = null
        if (partitionResult.sign) {
          owner = partitionResult.sign.owner
        } else {
          owner = ourNodeKey
        }
        //TSConversion had to assert that owner is not null with owner!  seems ok
        let hashSet: HashSetEntryPartitions = { hash: hash, votePower: 0, hashSet: partitionResult.hashSet, lastValue: '', errorStack: [], corrections: [], indexOffset: 0, owners: [owner!], ourRow: false, waitForIndex: -1, ownVotes: [] }
        hashSets[hash] = hashSet
        hashSetList.push(hashSets[hash])
        // partitionResult.hashSetList = hashSet //Seems like this was only ever used for debugging, going to ax it to be safe!
      } else {
        if (partitionResult.sign) {
          hashSets[hash].owners.push(partitionResult.sign.owner)
        }
      }
      if (partitionResult.sign == null || partitionResult.sign.owner === ourNodeKey) {
        hashSets[hash].ourRow = true
        // hashSets[hash].owners.push(ourNodeKey)
      }

      count++
      hashCounting[hash] = count
      hashSets[hash].votePower = count
    }
    // NOTE: the fields owners and ourRow are user data for shardus and not known or used by the solving algorithm

    return hashSetList
  }

  /**
   * testHashsetSolution
   * @param {GenericHashSetEntry} ourHashSet
   * @param {GenericHashSetEntry} solutionHashSet
   * @returns {boolean}
   */
  static testHashsetSolution(ourHashSet: GenericHashSetEntry, solutionHashSet: GenericHashSetEntry, log: boolean = false): boolean {
    // let payload = { partitionId: partitionId, cycle: cycleNumber, tx_indicies: requestsByHost[i].hostIndex, hash: requestsByHost[i].hash }
    // repairTracker.solutionDeltas.push({ i: requestsByHost[i].requests[j], tx: acceptedTX, pf: result.passFail[j] })

    // let txSourceList = txList
    // if (txList.newTxList) {
    //   txSourceList = txList.newTxList
    // }

    // solutionDeltas.sort(function (a, b) {BAD SORT return a.i - b.i }) // why did b - a help us once??

    // let debugSol = []
    // for (let solution of repairTracker.solutionDeltas) {
    //   debugSol.push({ i: solution.i, tx: solution.tx.id.slice(0, 4) })  // TXSTATE_TODO
    // }

    let stepSize = cHashSetStepSize
    let makeTXArray = function (hashSet: GenericHashSetEntry): string[] {
      let txArray: string[] = []
      for (let i = 0; i < hashSet.hashSet.length / stepSize; i++) {
        let offset = i * stepSize
        let v = hashSet.hashSet.slice(offset, offset + stepSize)
        txArray.push(v)
        // need to slice out state???
      }
      return txArray
    }

    let txSourceList = { hashes: makeTXArray(ourHashSet) }
    let solutionTxList = { hashes: makeTXArray(solutionHashSet) }
    let newTxList = { thashes: [], hashes: [], states: [] } as { thashes: string[]; hashes: string[]; states: string[] }

    let solutionList: HashSetEntryCorrection[] = []
    for (let correction of ourHashSet.corrections) {
      if (correction.t === 'insert') {
        solutionList.push(correction)
      }
    }

    // hack remove extraneous extras../////////////
    // let extraMap2 = []
    // for (let i = 0; i < ourHashSet.extraMap.length; i++) {
    //   let extraIndex = ourHashSet.extraMap[i]
    //   let extraNeeded = false
    //   for (let correction of ourHashSet.corrections) {
    //     if (correction.i === extraIndex) {
    //       extraNeeded = true
    //       break
    //     }
    //   }
    //   if (extraNeeded) {
    //     continue
    //   }
    //   extraMap2.push(extraIndex)
    // }
    // ourHashSet.extraMap = extraMap2
    // ///////////////////////////////////////

    if (ourHashSet.extraMap == null) {
      if (log) console.log(`testHashsetSolution: ourHashSet.extraMap missing`)
      return false
    }
    if (ourHashSet.indexMap == null) {
      if (log) console.log(`testHashsetSolution: ourHashSet.indexMap missing`)
      return false
    }
    ourHashSet.extraMap.sort(utils.sortAsc) // function (a, b) { return a - b })
    solutionList.sort(utils.sort_i_Asc) // function (a, b) { return a.i - b.i })

    let extraIndex = 0
    for (let i = 0; i < txSourceList.hashes.length; i++) {
      let extra = -1
      if (extraIndex < ourHashSet.extraMap.length) {
        extra = ourHashSet.extraMap[extraIndex]
      }
      if (extra === i) {
        extraIndex++
        continue
      }
      if (extra == null) {
        if (log) console.log(`testHashsetSolution error extra == null at i: ${i}  extraIndex: ${extraIndex}`)
        break
      }
      if (txSourceList.hashes[i] == null) {
        if (log) console.log(`testHashsetSolution error null at i: ${i}  extraIndex: ${extraIndex}`)
        break
      }

      newTxList.thashes.push(txSourceList.hashes[i])
      // newTxList.tpassed.push(txSourceList.passed[i])
      // newTxList.ttxs.push(txSourceList.txs[i])
    }

    let hashSet = ''
    // for (let hash of newTxList.thashes) {
    //   hashSet += hash.slice(0, stepSize)

    //   // todo add in the account state stuff..
    // }
    hashSet = StateManager.createHashSetString(newTxList.thashes, newTxList.states) // TXSTATE_TODO

    if (log) console.log(`extras removed: len: ${ourHashSet.indexMap.length}  extraIndex: ${extraIndex} ourPreHashSet: ${hashSet}`)

    // Txids: txSourceData.hashes, // txid1, txid2, …],  - ordered from oldest to recent
    // Status: txSourceData.passed, // [1,0, …],      - ordered corresponding to Txids; 1 for applied; 0 for failed
    // build our data while skipping extras.

    // insert corrections in order for each -1 in our local list (or write from our temp lists above)
    let ourCounter = 0
    let solutionIndex = 0
    for (let i = 0; i < ourHashSet.indexMap.length; i++) {
      let currentIndex = ourHashSet.indexMap[i]
      if (currentIndex >= 0) {
        // pull from our list? but we have already removed stuff?
        newTxList.hashes[i] = txSourceList.hashes[currentIndex] // newTxList.thashes[ourCounter]
        // newTxList.passed[i] = newTxList.tpassed[ourCounter]
        // newTxList.txs[i] = newTxList.ttxs[ourCounter]

        if (newTxList.hashes[i] == null) {
          if (log) console.log(`testHashsetSolution error null at i: ${i} solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
          return false
        }
        ourCounter++
      } else {
        // repairTracker.solutionDeltas.push({ i: requestsByHost[i].requests[j], tx: acceptedTX, pf: result.passFail[j] })
        // let solutionDelta = repairTracker.solutionDeltas[solutionIndex]

        let correction = solutionList[solutionIndex]

        if (correction == null) {
          continue
        }
        // if (!solutionDelta) {
        //   if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 a error solutionDelta=null  solutionIndex: ${solutionIndex} i:${i} of ${ourHashSet.indexMap.length} deltas: ${utils.stringifyReduce(repairTracker.solutionDeltas)}`)
        // }
        // insert the next one
        newTxList.hashes[i] = solutionTxList.hashes[correction.i] // solutionDelta.tx.id

        // newTxList.states[i] = solutionTxList.states[correction.i] // TXSTATE_TODO

        if (newTxList.hashes[i] == null) {
          if (log) console.log(`testHashsetSolution error null at i: ${i}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
        }
        // newTxList.passed[i] = solutionDelta.pf
        // newTxList.txs[i] = solutionDelta.tx
        solutionIndex++
        // if (newTxList.hashes[i] == null) {
        //   if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 b error null at i: ${i}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
        // }
      }
    }

    hashSet = ''
    // for (let hash of newTxList.hashes) {
    //   if (!hash) {
    //     hashSet += 'xx'
    //     continue
    //   }
    //   hashSet += hash.slice(0, stepSize)
    // }
    hashSet = StateManager.createHashSetString(newTxList.hashes, null) // TXSTATE_TODO  newTxList.states

    if (solutionHashSet.hashSet !== hashSet) {
      return false
    }

    if (log) console.log(`solved set len: ${hashSet.length / stepSize}  : ${hashSet}`)
    // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 c  len: ${ourHashSet.indexMap.length}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter} ourHashSet: ${hashSet}`)

    return true
  }

  /**
   * createHashSetString
   * @param {*} txHashes // todo find correct values
   * @param {*} dataHashes
   * @returns {*} //todo correct type
   */
  static createHashSetString(txHashes: string[], dataHashes: string[] | null) {
    let hashSet = ''

    if (dataHashes == null) {
      for (let i = 0; i < txHashes.length; i++) {
        let txHash = txHashes[i]

        if (!txHash) {
          txHash = 'xx'
        }

        hashSet += txHash.slice(0, cHashSetTXStepSize + cHashSetDataStepSize)
      }
      return hashSet
    } else {
      for (let i = 0; i < txHashes.length; i++) {
        let txHash = txHashes[i]
        let dataHash = dataHashes[i]
        if (!txHash) {
          txHash = 'xx'
        }
        if (!dataHash) {
          dataHash = 'xx'
        }
        dataHash = 'xx' // temp hack stop tracking data hashes for now.
        hashSet += txHash.slice(0, cHashSetTXStepSize)
        hashSet += dataHash.slice(0, cHashSetDataStepSize)
      }
    }

    return hashSet
  }

  /**
   * sendPartitionData
   * @param {PartitionReceipt} partitionReceipt
   * @param {PartitionObject} paritionObject
   */
  sendPartitionData(partitionReceipt: PartitionReceipt, paritionObject: PartitionObject) {
    if (partitionReceipt.resultsList.length === 0) {
      return
    }
    // CombinedPartitionReceipt

    let partitionReceiptCopy = JSON.parse(stringify(partitionReceipt.resultsList[0]))

    /** @type {CombinedPartitionReceipt} */
    let combinedReciept = { result: partitionReceiptCopy, signatures: partitionReceipt.resultsList.map((a) => a.sign) }

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' sendPartitionData ' + utils.stringifyReduceLimit({ combinedReciept, paritionObject }))

    // send it
    // this.p2p.archivers.sendPartitionData(combinedReciept, paritionObject)
  }

  sendTransactionData(partitionNumber: number, cycleNumber: number, transactions: AcceptedTx[]) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' sendTransactionData ' + utils.stringifyReduceLimit({ partitionNumber, cycleNumber, transactions }))

    // send it
    // this.p2p.archivers.sendTransactionData(partitionNumber, cycleNumber, transactions)
  }

  purgeTransactionData() {
    let tsStart = 0
    let tsEnd = 0
    this.storage.clearAcceptedTX(tsStart, tsEnd)
  }

  purgeStateTableData() {
    // do this by timestamp maybe..
    // this happnes on a slower scale.
    let tsEnd = 0 // todo get newest time to keep
    this.storage.clearAccountStateTableOlderThan(tsEnd)
  }

  /**
   * trySendAndPurgeReciepts
   * @param {PartitionReceipt} partitionReceipt
   */
  trySendAndPurgeReceiptsToArchives(partitionReceipt: PartitionReceipt) {
    if (partitionReceipt.resultsList.length === 0) {
      return
    }
    let cycleNumber = partitionReceipt.resultsList[0].Cycle_number
    let partitionId = partitionReceipt.resultsList[0].Partition_id
    let key = `c${cycleNumber}p${partitionId}`
    if (this.sentReceipts.has(key)) {
      return
    }

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' trySendAndPurgeReceipts ' + key)

    this.sentReceipts.set(key, true)
    try {
      if (this.sendArchiveData === true) {
        let paritionObject = this.getPartitionObject(cycleNumber, partitionId) // todo get object
        if (paritionObject == null) {
          this.statemanager_fatal(`trySendAndPurgeReceiptsToArchives`, ` trySendAndPurgeReceiptsToArchives paritionObject == null ${cycleNumber} ${partitionId}`)
          throw new Error(`trySendAndPurgeReceiptsToArchives paritionObject == null`)
        }
        this.sendPartitionData(partitionReceipt, paritionObject)
      }
    } finally {
    }

    if (this.sendTransactionData) {
      let txList = this.getTXList(cycleNumber, partitionId)

      this.sendTransactionData(partitionId, cycleNumber, txList.txs)
    }

    if (this.purgeArchiveData === true) {
      // alreay sort of doing this in another spot.
      // check if all partitions for this cycle have been handled!! then clear data in that time range.
      // need to record time range.
      // or check for open repairs. older than what we want to clear out.
    }
  }


  /**
   * getReceipt
   * Since there are few places where receipts can be stored on a QueueEntry this determines the correct one to return
   * @param queueEntry
   */
  getReceipt(queueEntry: QueueEntry): AppliedReceipt {
    if (queueEntry.appliedReceiptFinal != null) {
      return queueEntry.appliedReceiptFinal
    }
    // start with a receipt we made
    let receipt: AppliedReceipt = queueEntry.appliedReceipt
    if (receipt == null) {
      // or see if we got one
      receipt = queueEntry.recievedAppliedReceipt
    }
    // if we had to repair use that instead. this stomps the other ones
    if (queueEntry.appliedReceiptForRepair != null) {
      receipt = queueEntry.appliedReceiptForRepair
    }
    queueEntry.appliedReceiptFinal = receipt
    return receipt
  }

  generateReceiptMapResults(lastCycle: Shardus.Cycle): ReceiptMapResult[] {
    let results: ReceiptMapResult[] = []

    let cycleToSave = lastCycle.counter

    //init results per partition
    let receiptMapByPartition: Map<number, ReceiptMapResult> = new Map()
    for (let i = 0; i < this.currentCycleShardData.shardGlobals.numPartitions; i++) {
      let mapResult: ReceiptMapResult = {
        cycle: cycleToSave,
        partition: i,
        receiptMap: {},
        txCount: 0,
      }
      receiptMapByPartition.set(i, mapResult)
      // add to the list we will return
      results.push(mapResult)
    }

    let queueEntriesToSave: QueueEntry[] = []
    for (let queueEntry of this.newAcceptedTxQueue) {
      if (queueEntry.cycleToRecordOn === cycleToSave) {
        // make sure we have a receipt
        let receipt = this.getReceipt(queueEntry)
        if (receipt == null) {
          this.mainLogger.error(`generateReceiptMapResults found entry in with no receipt in newAcceptedTxQueue. ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
        } else {
          queueEntriesToSave.push(queueEntry)
        }
      }
    }

    for (let queueEntry of this.archivedQueueEntries) {
      if (queueEntry.cycleToRecordOn === cycleToSave) {
        // make sure we have a receipt
        let receipt = this.getReceipt(queueEntry)
        if (receipt == null) {
          this.mainLogger.error(`generateReceiptMapResults found entry in with no receipt in archivedQueueEntries. ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
        } else {
          queueEntriesToSave.push(queueEntry)
        }
      }
    }

    const netId: string = '123abc'
    //go over the save list..
    for (let queueEntry of queueEntriesToSave) {
      for (let partition of queueEntry.involvedPartitions) {
        let receipt = this.getReceipt(queueEntry)

        let status = receipt.result === true ? 'applied' : 'rejected'
        let txHash = queueEntry.acceptedTx.id
        let txResultFullHash = this.crypto.hash({ tx: queueEntry.acceptedTx.data, status, netId })
        let txIdShort = utils.short(txHash)
        let txResult = utils.short(txResultFullHash)
        if (receiptMapByPartition.has(partition)) {
          let mapResult: ReceiptMapResult = receiptMapByPartition.get(partition)
          //create an array if we have not seen this index yet
          if (mapResult.receiptMap[txIdShort] == null) {
            mapResult.receiptMap[txIdShort] = []
          }
          //push the result.  note the order is not deterministic unless we were to sort at the end.
          mapResult.receiptMap[txIdShort].push(txResult)
          mapResult.txCount++
        }
      }
    }

    return results
  }

/***
 *     ######   #######  ########  ########             
 *    ##    ## ##     ## ##     ## ##                   
 *    ##       ##     ## ##     ## ##                   
 *    ##       ##     ## ########  ######               
 *    ##       ##     ## ##   ##   ##                   
 *    ##    ## ##     ## ##    ##  ##       ### ### ### 
 *     ######   #######  ##     ## ######## ### ### ### 
 */


  /**
   * getCycleNumberFromTimestamp
   * cycle numbers are calculated from the queue entry timestamp, but an offset is needed so that we can
   * finalize cycles in time. when you start a new cycle there could still be unfinished transactions for
   * syncSettleTime milliseconds.
   *
   * returns a negative number code if we can not determine the cycle
   */
  getCycleNumberFromTimestamp(timestamp, allowOlder: boolean = true): number {
    let offsetTimestamp = timestamp + this.syncSettleTime

    //currentCycleShardData
    if (this.currentCycleShardData.timestamp <= offsetTimestamp && offsetTimestamp < this.currentCycleShardData.timestampEndCycle) {
      return this.currentCycleShardData.cycleNumber
    }

    //is it in the future
    if (this.currentCycleShardData.timestampEndCycle <= offsetTimestamp) {
      let cycle: Shardus.Cycle = this.p2p.state.getLastCycle()
      let endOfNextCycle = this.currentCycleShardData.timestampEndCycle + cycle.duration * 1000
      if (offsetTimestamp < endOfNextCycle + this.syncSettleTime) {
        return this.currentCycleShardData.cycleNumber + 1
      } else if (offsetTimestamp < endOfNextCycle + this.syncSettleTime + cycle.duration * 1000) {
        this.mainLogger.error(`getCycleNumberFromTimestamp fail2: endOfNextCycle:${endOfNextCycle} offsetTimestamp:${offsetTimestamp} timestamp:${timestamp}`)

        return this.currentCycleShardData.cycleNumber + 2
      } else {
        this.mainLogger.error(`getCycleNumberFromTimestamp fail: endOfNextCycle:${endOfNextCycle} offsetTimestamp:${offsetTimestamp} timestamp:${timestamp}`)

        //too far in the future
        return -2
      }
    }
    if (allowOlder === true) {
      //cycle is in the past, by process of elimination
      let offsetSeconds = Math.floor(offsetTimestamp * 0.001)
      const cycle = this.p2p.state.getCycleByTimestamp(offsetSeconds)
      if (cycle != null) {
        return cycle.cycleNumber
      }
    }

    //failed to match, return -1
    return -1
  }

  isNodeValidForInternalMessage(nodeId: string, debugMsg: string, checkForNodeDown: boolean = true, checkForNodeLost: boolean = true): boolean {
    let node: Shardus.Node = this.p2p.state.getNode(nodeId)
    let logErrors = true
    if (node == null) {
      if (logErrors) this.mainLogger.error(`isNodeValidForInternalMessage node == null ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
      return false
    }
    let nodeStatus = node.status
    if (nodeStatus != 'active') {
      if (logErrors) this.mainLogger.error(`isNodeValidForInternalMessage node not active. ${nodeStatus} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
      return false
    }
    if (checkForNodeDown) {
      let { down, state } = isNodeDown(nodeId)
      if (down === true) {
        if (logErrors) this.mainLogger.error(`isNodeValidForInternalMessage isNodeDown == true state:${state} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
        return false
      }
    }
    if (checkForNodeLost) {
      if (isNodeLost(nodeId) === true) {
        if (logErrors) this.mainLogger.error(`isNodeValidForInternalMessage isNodeLost == true ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
        return false
      }
    }
    return true
  }

  filterValidNodesForInternalMessage(nodeList: Shardus.Node[], debugMsg: string, checkForNodeDown: boolean = true, checkForNodeLost: boolean = true): Shardus.Node[] {
    let filteredNodes = []

    let logErrors = true
    for (let node of nodeList) {
      let nodeId = node.id

      if (node == null) {
        if (logErrors) this.mainLogger.error(`isNodeValidForInternalMessage node == null ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
        continue
      }
      let nodeStatus = node.status
      if (nodeStatus != 'active') {
        if (logErrors) this.mainLogger.error(`isNodeValidForInternalMessage node not active. ${nodeStatus} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
        continue
      }
      if (checkForNodeDown) {
        let { down, state } = isNodeDown(nodeId)
        if (down === true) {
          if (logErrors) this.mainLogger.error(`isNodeValidForInternalMessage isNodeDown == true state:${state} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
          continue
        }
      }
      if (checkForNodeLost) {
        if (isNodeLost(nodeId) === true) {
          if (logErrors) this.mainLogger.error(`isNodeValidForInternalMessage isNodeLost == true ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
          continue
        }
      }
      filteredNodes.push(node)
    }
    return filteredNodes
  }

  statemanager_fatal(key, log) {
    nestedCountersInstance.countEvent('fatal-log', key)
    this.fatalLogger.fatal(log)
  }
}

export default StateManager
