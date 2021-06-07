import * as Shardus from '../shardus/shardus-types'

import { ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, HomeNodeSummary, ParititionShardDataMap, NodeShardDataMap, MergeResults, BasicAddressRange } from './shardFunctionTypes'

import { isNodeDown, isNodeLost, isNodeUpRecent } from '../p2p/Lost'

import ShardFunctions from './shardFunctions.js'

const EventEmitter = require('events')
import * as utils from '../utils'

const stringify = require('fast-stable-stringify')

const allZeroes64 = '0'.repeat(64)

// not sure about this.
import Consensus from '../consensus'
import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, {logFlags} from '../logger'
import { throws } from 'assert'
import * as Context from '../p2p/Context'
import { potentiallyRemoved, activeByIdOrder, activeOthersByIdOrder } from '../p2p/NodeList'
import * as Self from '../p2p/Self'
import * as NodeList from '../p2p/NodeList'
import * as CycleChain from '../p2p/CycleChain'
import * as Comms from '../p2p/Comms'
import { response } from 'express'
import { nestedCountersInstance } from '../utils/nestedCounters'
import PartitionStats from './PartitionStats'
import AccountCache from './AccountCache'
import AccountSync from './AccountSync'
import AccountGlobals from './AccountGlobals'
import TransactionQueue from './TransactionQueue'
import TransactionRepair from './TransactionRepair'
import TransactionConsenus from './TransactionConsensus'
import PartitionObjects from './PartitionObjects'
import Depricated from './Depricated'
import AccountPatcher from './AccountPatcher'
import { CycleShardData, PartitionReceipt, FifoLockObjectMap, QueueEntry, AcceptedTx, AccountCopy, GetAccountDataByRangeSmart, WrappedStateArray, AccountHashCache, RequestReceiptForTxReq, RequestReceiptForTxResp, RequestStateForTxReqPost, RequestStateForTxResp, RequestTxResp, AppliedVote, GetAccountDataWithQueueHintsResp, DebugDumpPartitions, DebugDumpRangesCovered, DebugDumpNodesCovered, DebugDumpPartition, DebugDumpPartitionSkip, MainHashResults, SimpleDistanceObject, WrappedResponses, LocalCachedData, AccountFilter, StringBoolObjectMap, AppliedReceipt, ReceiptMapResult } from './state-manager-types'

/**
 * WrappedEventEmitter just a default extended WrappedEventEmitter
 * using EventEmitter was causing issues?
 */
class WrappedEventEmitter extends EventEmitter {
  constructor() {
    super()
  }
}

/**
 * StateManager
 */
class StateManager {
  //  class StateManager {

  app: Shardus.App
  storage: Storage
  p2p: P2P
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler
  consensus: Consensus

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any

  eventEmitter: WrappedEventEmitter

  //Sub modules
  partitionStats: PartitionStats
  accountCache: AccountCache
  accountSync: AccountSync
  accountGlobals: AccountGlobals
  transactionQueue: TransactionQueue
  transactionRepair: TransactionRepair
  transactionConsensus: TransactionConsenus
  partitionObjects: PartitionObjects
  accountPatcher: AccountPatcher
  depricated: Depricated

  // syncTrackers:SyncTracker[];
  shardValuesByCycle: Map<number, CycleShardData>
  currentCycleShardData: CycleShardData | null
  globalAccountsSynced: boolean

  dataRepairsCompleted: number
  dataRepairsStarted: number
  useStoredPartitionsForReport: boolean

  partitionReceiptsByCycleCounter: { [cycleKey: string]: PartitionReceipt[] } //Object.<string, PartitionReceipt[]> // a map of cycle keys to lists of partition receipts.
  ourPartitionReceiptsByCycleCounter: { [cycleKey: string]: PartitionReceipt } //Object.<string, PartitionReceipt> //a map of cycle keys to lists of partition receipts.

  fifoLocks: FifoLockObjectMap

  lastSeenAccountsMap: { [accountId: string]: QueueEntry }

  appFinishedSyncing: boolean

  debugNoTxVoting: boolean

  ignoreRecieptChance: number
  ignoreVoteChance: number
  loseTxChance: number
  failReceiptChance: number
  voteFlipChance: number
  failNoRepairTxChance: number

  syncSettleTime: number
  debugTXHistory: { [id: string]: string } // need to disable or clean this as it will leak memory

  stateIsGood_txHashsetOld: boolean
  stateIsGood_accountPartitions: boolean
  stateIsGood_activeRepairs: boolean
  stateIsGood: boolean

  // oldFeature_TXHashsetTest: boolean
  // oldFeature_GeneratePartitionReport: boolean
  // oldFeature_BroadCastPartitionReport: boolean
  // useHashSets: boolean //Old feature but must stay on (uses hash set string vs. older method)

  feature_receiptMapResults: boolean
  feature_partitionHashes: boolean
  feature_generateStats: boolean
  feature_useNewParitionReport: boolean // old way uses generatePartitionObjects to build a report

  debugFeature_dumpAccountData: boolean
  debugFeature_dumpAccountDataFromSQL: boolean

  debugFeatureOld_partitionReciepts: boolean // depends on old partition report features.

  

  logger: Logger

  extendedRepairLogging: boolean

  //canDataRepair: boolean // the old repair.. todo depricate further.
  lastActiveNodeCount: number

  doDataCleanup: boolean

  _listeners: any //Event listners

  queueSitTime: number
  dataPhaseTag: string

  preTXQueue: AcceptedTx[] // mostly referenced in commented out code for queing up TXs before systems are ready.

  sleepInterrupt: any // see interruptibleSleep.  todo type this, or clean out

  lastShardCalculationTS: number

  firstTimeToRuntimeSync: boolean

  /***
   *     ######   #######  ##    ##  ######  ######## ########  ##     ##  ######  ########  #######  ########
   *    ##    ## ##     ## ###   ## ##    ##    ##    ##     ## ##     ## ##    ##    ##    ##     ## ##     ##
   *    ##       ##     ## ####  ## ##          ##    ##     ## ##     ## ##          ##    ##     ## ##     ##
   *    ##       ##     ## ## ## ##  ######     ##    ########  ##     ## ##          ##    ##     ## ########
   *    ##       ##     ## ##  ####       ##    ##    ##   ##   ##     ## ##          ##    ##     ## ##   ##
   *    ##    ## ##     ## ##   ### ##    ##    ##    ##    ##  ##     ## ##    ##    ##    ##     ## ##    ##
   *     ######   #######  ##    ##  ######     ##    ##     ##  #######   ######     ##     #######  ##     ##
   */
  constructor( profiler: Profiler, app: Shardus.App, consensus: Consensus, logger: Logger, storage: Storage, p2p: P2P, crypto: Crypto, config: Shardus.ShardusConfiguration) {
    //super()
    

    this.p2p = p2p
    this.crypto = crypto
    this.storage = storage
    this.app = app
    this.consensus = consensus
    this.logger = logger
    this.config = config
    this.profiler = profiler

    this.eventEmitter = new WrappedEventEmitter()

    //BLOCK1
    this._listeners = {}

    this.queueSitTime = 6000 // todo make this a setting. and tie in with the value in consensus
    this.syncSettleTime = this.queueSitTime + 2000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later

    this.lastSeenAccountsMap = null

    this.appFinishedSyncing = false

    //BLOCK2

    //BLOCK3
    this.dataPhaseTag = 'DATASYNC: '

    //BLOCK4
    //this.useHashSets = true
    this.lastActiveNodeCount = 0

    this.extendedRepairLogging = true

    this.shardValuesByCycle = new Map()
    this.currentCycleShardData = null as CycleShardData | null
    // this.syncTrackerIndex = 1 // increments up for each new sync tracker we create gets maped to calls.
    this.preTXQueue = []
    //this.readyforTXs = false

    this.sleepInterrupt = undefined

    this.configsInit()

    //INIT our various modules

    this.accountCache = new AccountCache(this, profiler, app, logger, crypto, config)

    this.partitionStats = new PartitionStats(this, profiler, app, logger, crypto, config, this.accountCache)
    this.partitionStats.summaryPartitionCount = 32
    this.partitionStats.initSummaryBlobs()

    this.accountSync = new AccountSync(this,  profiler, app, logger, storage, p2p, crypto, config)

    this.accountGlobals = new AccountGlobals(this,  profiler, app, logger, storage, p2p, crypto, config)
    this.transactionQueue = new TransactionQueue(this,  profiler, app, logger, storage, p2p, crypto, config)
    this.transactionRepair = new TransactionRepair(this,  profiler, app, logger, storage, p2p, crypto, config)
    this.transactionConsensus = new TransactionConsenus(this,  profiler, app, logger, storage, p2p, crypto, config)
    this.partitionObjects = new PartitionObjects(this,  profiler, app, logger, storage, p2p, crypto, config)
    this.depricated = new Depricated(this,  profiler, app, logger, storage, p2p, crypto, config)
    this.accountPatcher = new AccountPatcher(this, profiler, app, logger, p2p, crypto, config)

    // feature controls.
    // this.oldFeature_TXHashsetTest = true
    // this.oldFeature_GeneratePartitionReport = false
    // this.oldFeature_BroadCastPartitionReport = true // leaving this true since it depends on the above value

    this.feature_receiptMapResults = true
    this.feature_partitionHashes = true
    this.feature_generateStats = true

    this.feature_useNewParitionReport = true

    this.debugFeature_dumpAccountData = true
    this.debugFeature_dumpAccountDataFromSQL = false
    this.debugFeatureOld_partitionReciepts = false

    this.stateIsGood_txHashsetOld = true
    this.stateIsGood_activeRepairs = true
    this.stateIsGood = true

    // other debug features
    if (this.config && this.config.debug) {
      this.feature_useNewParitionReport = this.tryGetBoolProperty(this.config.debug, 'useNewParitionReport', this.feature_useNewParitionReport)

      // this.oldFeature_GeneratePartitionReport = this.tryGetBoolProperty(this.config.debug, 'oldPartitionSystem', this.oldFeature_GeneratePartitionReport)

      this.debugFeature_dumpAccountDataFromSQL = this.tryGetBoolProperty(this.config.debug, 'dumpAccountReportFromSQL', this.debugFeature_dumpAccountDataFromSQL)
    }

    /** @type {number} */
    this.dataRepairsCompleted = 0
    /** @type {number} */
    this.dataRepairsStarted = 0
    this.useStoredPartitionsForReport = true

    /** @type {Object.<string, PartitionReceipt[]>} a map of cycle keys to lists of partition receipts.  */
    this.partitionReceiptsByCycleCounter = {}
    /** @type {Object.<string, PartitionReceipt>} a map of cycle keys to lists of partition receipts.  */
    this.ourPartitionReceiptsByCycleCounter = {}
    this.doDataCleanup = true

    //Fifo locks.
    this.fifoLocks = {}

    this.debugTXHistory = {}

    // debug hack
    if (p2p == null) {
      return
    }

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')

    ShardFunctions.logger = logger
    ShardFunctions.fatalLogger = this.fatalLogger
    ShardFunctions.mainLogger = this.mainLogger

    this.clearPartitionData()

    this.registerEndpoints()

    this.accountSync.isSyncingAcceptedTxs = true // default is true so we will start adding to our tx queue asap

    this.lastShardCalculationTS = -1

    this.startShardCalculations()

    this.firstTimeToRuntimeSync = true

    //if (logFlags.playback) this.logger.playbackLogNote('canDataRepair', `0`, `canDataRepair: ${this.canDataRepair}  `)
  }

  configsInit() {
    //this.canDataRepair = false
    // this controls the OLD repair portion of data repair.
    // if (this.config && this.config.debug) {
    //   this.canDataRepair = this.config.debug.canDataRepair
    //   if (this.canDataRepair == null) {
    //     this.canDataRepair = false
    //   }
    // }
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

    this.failNoRepairTxChance = 0
    if (this.config && this.config.debug) {
      this.failNoRepairTxChance = this.config.debug.failNoRepairTxChance
      if (this.failNoRepairTxChance == null) {
        this.failNoRepairTxChance = 0
      }
    }

    
  }

  // TEMP hack emit events through p2p
  // had issues with composition
  // emit(event: string | symbol, ...args: any[]){
  //   this.p2p.emit(event, args)

  // }

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
      if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_firstCycle', `${cycleNumber}`, ` first init `)
    }

    let cycleShardData = {} as CycleShardData

    // lets make sure shard calculation are happening at a consistent interval
    let calculationTime = Date.now()
    if(this.lastShardCalculationTS > 0){
      let delay = (calculationTime - this.lastShardCalculationTS) - (this.config.p2p.cycleDuration * 1000)

      if(delay > 5000){
        this.statemanager_fatal(`updateShardValues-delay > 5s ${delay/1000}`, `updateShardValues-delay ${delay/1000}`)
      }
      else if(delay > 4000){
        nestedCountersInstance.countEvent('stateManager', 'updateShardValues delay > 4s')
      }      
      else if(delay > 3000){
        nestedCountersInstance.countEvent('stateManager', 'updateShardValues delay > 3s')
      }
      else if(delay > 2000){
        nestedCountersInstance.countEvent('stateManager', 'updateShardValues delay > 2s')
      }

      cycleShardData.calculationTime = calculationTime
    }
    this.lastShardCalculationTS = calculationTime

    // todo get current cycle..  store this by cycle?
    cycleShardData.nodeShardDataMap = new Map()
    cycleShardData.parititionShardDataMap = new Map()

    cycleShardData.activeNodes = activeByIdOrder
    cycleShardData.cycleNumber = cycleNumber
    cycleShardData.partitionsToSkip = new Map()
    cycleShardData.hasCompleteData = false

    try {
      cycleShardData.ourNode = NodeList.nodes.get(Self.id)
    } catch (ex) {
      if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_notactive', `${cycleNumber}`, `  `)
      return
    }

    if (cycleShardData.activeNodes.length === 0) {
      if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_noNodeListAvailable', `${cycleNumber}`, `  `)
      return // no active nodes so stop calculating values
    }

    if (this.config === null || this.config.sharding === null) {
      throw new Error('this.config.sharding === null')
    }

    const cycle = CycleChain.getNewest()
    if (cycle !== null && cycle !== undefined) {
      cycleShardData.timestamp = cycle.start * 1000
      cycleShardData.timestampEndCycle = (cycle.start + cycle.duration) * 1000
    }

    const edgeNodes = this.config.sharding.nodesPerConsensusGroup as number

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
      if (logFlags.verbose) this.mainLogger.debug(`updateShardValues: getOrderedSyncingNeighbors`)
      cycleShardData.syncingNeighbors = this.p2p.state.getOrderedSyncingNeighbors(cycleShardData.ourNode)

      if (cycleShardData.syncingNeighbors.length > 0) {
        //old: add all syncing nodes
        cycleShardData.syncingNeighborsTxGroup = [...cycleShardData.syncingNeighbors]
        //TODO filter syncingNeighborsTxGroup to nodes that would care..(cover our data)
        // for(let node in cycleShardData.syncingNeighbors){

        //   ShardFunctions.
        // }
        cycleShardData.syncingNeighborsTxGroup.push(cycleShardData.ourNode)
        cycleShardData.hasSyncingNeighbors = true

        if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_neighbors', `${cycleShardData.cycleNumber}`, ` neighbors: ${utils.stringifyReduce(cycleShardData.syncingNeighbors.map((node) => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
      } else {
        cycleShardData.hasSyncingNeighbors = false
      }

      if (logFlags.console) console.log(`updateShardValues  cycle:${cycleShardData.cycleNumber} `)

      // if (this.preTXQueue.length > 0) {
      //   for (let tx of this.preTXQueue) {
      //     if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_preTX', ` `, ` ${utils.stringifyReduce(tx)} `)
      //     this.transactionQueue.routeAndQueueAcceptedTransaction(tx, false, null)
      //   }
      //   this.preTXQueue = []
      // }

      this.accountSync.updateRuntimeSyncTrackers()

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
    // if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_cycleData', `${cycleNumber}`, ` cycleShardData: cycle:${cycleNumber} data: ${utils.stringifyReduce(cycleShardData)}`)
    if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_cycleData', `${cycleNumber}`, ` cycleShardData: cycle:${this.currentCycleShardData.cycleNumber} `)
    
    this.lastActiveNodeCount = cycleShardData.activeNodes.length

    cycleShardData.hasCompleteData = true
  }

  calculateChangeInCoverage(): void {
    // maybe this should be a shard function so we can run unit tests on it for expanding or shrinking networks!
    let newSharddata = this.currentCycleShardData

    if (newSharddata == null || this.currentCycleShardData == null) {
      return
    }

    let cycleToCompareTo = newSharddata.cycleNumber - 1
    
    //if this is our first time to sync we should attempt to compare to an older cycle
    if(this.firstTimeToRuntimeSync === true){
      this.firstTimeToRuntimeSync = false

      //make sure the cycle started is an older one
      if(this.accountSync.syncStatement.cycleStarted < cycleToCompareTo){
        cycleToCompareTo = this.accountSync.syncStatement.cycleStarted
      } else {

        //in theory we could just return but I dont want to change that side of the branch yet.
      }
    }

    let oldShardData = this.shardValuesByCycle.get(cycleToCompareTo)

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
      if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_change', `${oldShardData.cycleNumber}->${newSharddata.cycleNumber}`, ` ${ShardFunctions.leadZeros8(change.start.toString(16))}->${ShardFunctions.leadZeros8(change.end.toString(16))} `)

      // create a range object from our coverage change.

      let range = { startAddr: 0, endAddr: 0, low: '', high: '' } as BasicAddressRange // this init is a somewhat wastefull way to allow the type to be happy.
      range.startAddr = change.start
      range.endAddr = change.end
      range.low = ShardFunctions.leadZeros8(range.startAddr.toString(16)) + '0'.repeat(56)
      range.high = ShardFunctions.leadZeros8(range.endAddr.toString(16)) + 'f'.repeat(56)
      // create sync trackers
      this.accountSync.createSyncTrackerByRange(range, cycle)
    }

    if (coverageChanges.length > 0) {
      this.accountSync.syncRuntimeTrackers()
    }
    // launch sync trackers
    // coverage changes... should have a list of changes
    // should note if the changes are an increase or reduction in covered area.
    // log the changes.
    // next would be to create some syncTrackers based to cover increases
  }

  getCurrentCycleShardData(): CycleShardData | null {
    if (this.currentCycleShardData === null) {
      const cycle = CycleChain.getNewest()
      if (cycle === null || cycle === undefined) {
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
      if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_waitForShardData_firstNode', ``, ` ${utils.stringifyReduce(this.currentCycleShardData)} `)
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

  debugNodeGroup(key, key2, msg, nodes) {
    if (logFlags.playback)
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
        if (verboseRequired === false || logFlags.verbose) {
          this.logger.playbackLogNote(`dbg_fail_${debugName}`, key, message)
        }
      }
      return true
    }
    return false
  }


  // getRandomIndex (list: any[]) {
  //   let max = list.length - 1
  //   return Math.floor(Math.random() * Math.floor(max))
  // }

  // todo need a faster more scalable version of this if we get past afew hundred nodes.
  // getActiveNodesInRange (lowAddress: string, highAddress: string, exclude = []): Shardus.Node[] {
  //   let allNodes = activeByIdOrder
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

  async startCatchUpQueue() {
    await this._firstTimeQueueAwait()

    if (logFlags.console) console.log('syncStateData startCatchUpQueue ' + '   time:' + Date.now())

    // all complete!
    this.mainLogger.info(`DATASYNC: complete`)
    this.logger.playbackLogState('datasyncComplete', '', '')

    // update the debug tag and restart the queue
    this.dataPhaseTag = 'ACTIVE: '
    this.accountSync.dataSyncMainPhaseComplete = true
    //update sync statement
    this.accountSync.syncStatement.syncComplete = true
    this.accountSync.syncStatement.cycleEnded = this.currentCycleShardData.cycleNumber
    this.accountSync.syncStatement.numCycles = this.accountSync.syncStatement.cycleEnded - this.accountSync.syncStatement.cycleStarted


    this.accountSync.syncStatement.syncEndTime = Date.now()
    this.accountSync.syncStatement.syncSeconds = (this.accountSync.syncStatement.syncEndTime - this.accountSync.syncStatement.syncStartTime) / 1000

    nestedCountersInstance.countEvent('sync', `sync comlete numCycles: ${this.accountSync.syncStatement.numCycles} start:${this.accountSync.syncStatement.cycleStarted} end:${this.accountSync.syncStatement.cycleEnded}`)
    if(this.accountSync.syncStatement.internalFlag === true){
      if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_syncStatement', ` `, `${utils.stringifyReduce(this.accountSync.syncStatement)}`)
      this.statemanager_fatal('shrd_sync_syncStatement-tempdebug', `${utils.stringifyReduce(this.accountSync.syncStatement)}`)
      this.accountSync.syncStatmentIsComplete()
    } else{
      this.accountSync.syncStatement.internalFlag = true
    }

    this.tryStartAcceptedQueue()

    if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_mainphaseComplete', ` `, `  `)
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
  async writeCombinedAccountDataToBackups(goodAccounts: Shardus.WrappedData[], failedHashes: string[]) : Promise<number> {
    // ?:{[id:string]: boolean}
    if (failedHashes.length === 0 && goodAccounts.length === 0) {
      return 0 // nothing to do yet
    }

    let failedAccountsById: { [id: string]: boolean } = {}
    for (let hash of failedHashes) {
      failedAccountsById[hash] = true
    }

    const lastCycle = CycleChain.getNewest()
    let cycleNumber = lastCycle.counter
    let accountCopies: AccountCopy[] = []
    for (let accountEntry of goodAccounts) {
      // check failed hashes
      if (failedAccountsById[accountEntry.stateId]) {
        continue
      }
      // wrappedAccounts.push({ accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp })
      const isGlobal = this.accountGlobals.isGlobalAccount(accountEntry.accountId)
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
    if (logFlags.verbose) this.mainLogger.debug('writeCombinedAccountDataToBackups ' + accountCopies.length + ' ' + utils.stringifyReduce(accountCopies))

    if (logFlags.verbose) console.log('DBG accountCopies.  (in main log)')

    // await this.storage.createAccountCopies(accountCopies)
    await this.storage.createOrReplaceAccountCopy(accountCopies)

    return accountCopies.length
  }

  // This will make calls to app.getAccountDataByRange but if we are close enough to real time it will query any newer data and return lastUpdateNeeded = true
  async getAccountDataByRangeSmart(accountStart: string, accountEnd: string, tsStart: number, maxRecords: number): Promise<GetAccountDataByRangeSmart> {
    let tsEnd = Date.now()

    // todo convert this to use account backup data, then compare perf vs app as num accounts grows past 10k

    // alternate todo: query it all from the app then create a smart streaming wrapper that persists between calls and even
    // handles updates to day by putting updated data at the end of the list with updated data wrappers.

    let wrappedAccounts = await this.app.getAccountDataByRange(accountStart, accountEnd, tsStart, tsEnd, maxRecords)
    let lastUpdateNeeded = false
    let wrappedAccounts2: WrappedStateArray = []
    let highestTs = 0
    let delta = 0
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
      delta = tsEnd - highestTs
      // if the data we go was close enough to current time then we are done
      // may have to be carefull about how we tune this value relative to the rate that we make this query
      // we should try to make this query more often then the delta.
      if (logFlags.verbose) console.log('delta ' + delta)
      // increased allowed delta to allow for a better chance to catch up  
      if (delta < this.queueSitTime * 2) {
        let tsStart2 = highestTs
        wrappedAccounts2 = await this.app.getAccountDataByRange(accountStart, accountEnd, tsStart2, Date.now(), 10000000)
        lastUpdateNeeded = true
      }
    }
    return { wrappedAccounts, lastUpdateNeeded, wrappedAccounts2, highestTs, delta }
  }

  testAccountDataWrapped(accountDataList: Shardus.WrappedData[]) {
    if (accountDataList == null) {
      return
    }
    for (let wrappedData of accountDataList) {
      let { accountId, stateId, data: recordData } = wrappedData
      //stateId = wrappedData.stateId
      if (stateId != wrappedData.stateId) {
        if (logFlags.error) this.mainLogger.error(`testAccountDataWrapped what is going on!!:  ${utils.makeShortHash(wrappedData.stateId)}  stateId: ${utils.makeShortHash(stateId)} `)
      }
      let hash = this.app.calculateAccountHash(recordData)
      if (stateId !== hash) {
        if (logFlags.error) this.mainLogger.error(`testAccountDataWrapped hash test failed: setAccountData for account ${utils.makeShortHash(accountId)} expected account hash: ${utils.makeShortHash(stateId)} got ${utils.makeShortHash(hash)} `)
        if (logFlags.error) this.mainLogger.error('testAccountDataWrapped hash test failed: details: ' + stringify(recordData))
        if (logFlags.error) this.mainLogger.error('testAccountDataWrapped hash test failed: wrappedData.stateId: ' + utils.makeShortHash(wrappedData.stateId))
        var stack = new Error().stack
        if (logFlags.error) this.mainLogger.error(`stack: ${stack}`)
      }
    }
  }

  // TSConversion TODO need to fix some any types
  async checkAndSetAccountData(accountRecords: Shardus.WrappedData[], note: string, initStats: boolean): Promise<string[]> {
    let accountsToAdd: any[] = []
    let failedHashes: string[] = []
    for (let wrapedAccount of accountRecords) {
      let { accountId, stateId, data: recordData, timestamp } = wrapedAccount
      let hash = this.app.calculateAccountHash(recordData)
      let cycleToRecordOn = CycleChain.getCycleNumberFromTimestamp(wrapedAccount.timestamp)
      if(cycleToRecordOn == null){
        this.statemanager_fatal(`checkAndSetAccountData cycleToRecordOn==null`, `checkAndSetAccountData cycleToRecordOn==null ${wrapedAccount.timestamp}` )
      }
      //TODO per remove this when we are satisfied with the situation
      //Additional testing to cache if we try to overrite with older data
      if (this.accountCache.hasAccount(accountId)) {
        let accountMemData: AccountHashCache = this.accountCache.getAccountHash(accountId)
        if (timestamp < accountMemData.t) {
          //should update cache anyway (older value may be needed)
          
          this.accountCache.updateAccountHash(wrapedAccount.accountId, wrapedAccount.stateId, wrapedAccount.timestamp, cycleToRecordOn)

          if (logFlags.error) this.mainLogger.error(`setAccountData: abort. checkAndSetAccountData older timestamp note:${note} acc: ${utils.makeShortHash(accountId)} timestamp:${timestamp} accountMemData.t:${accountMemData.t} hash: ${utils.makeShortHash(hash)} cache:${utils.stringifyReduce(accountMemData)}`)
          continue //this is a major error need to skip the writing.
        }
      } else {
        // not an error to not have this data yet
        // if (logFlags.error) this.mainLogger.error(`checkAndSetAccountData: did not find seen account. note:${note} acc: ${utils.makeShortHash(accountId)} hash: ${utils.makeShortHash(hash)}`)
      }

      if (stateId === hash) {
        // if (recordData.owners) recordData.owners = JSON.parse(recordData.owners)
        // if (recordData.data) recordData.data = JSON.parse(recordData.data)
        // if (recordData.txs) recordData.txs = JSON.parse(recordData.txs) // dont parse this, since it is already the string form we need to write it.
        accountsToAdd.push(recordData)
        let debugString = `setAccountData: note:${note} acc: ${utils.makeShortHash(accountId)} hash: ${utils.makeShortHash(hash)} ts:${wrapedAccount.timestamp}`
        if (logFlags.debug) this.mainLogger.debug(debugString)
        if (logFlags.verbose) console.log(debugString)


        if(wrapedAccount.timestamp === 0){
          let stack = new Error().stack

          this.statemanager_fatal(`checkAndSetAccountData ts=0`, `checkAndSetAccountData ts=0 ${debugString}    ${stack}` )
        }

        if (this.accountCache.hasAccount(accountId)) {
          //TODO STATS BUG..  this is what can cause one form of stats bug.
          //we may have covered this account in the past, then not covered it, and now we cover it again.  Stats doesn't know how to repair
          // this situation.
          //TODO, need a way to re-init.. dang idk how to do that!
          //this.partitionStats.statsDataSummaryUpdate2(cycleToRecordOn, null, wrapedAccount)

          this.accountCache.updateAccountHash(wrapedAccount.accountId, wrapedAccount.stateId, wrapedAccount.timestamp, cycleToRecordOn)
        } else {
          this.partitionStats.statsDataSummaryInit(cycleToRecordOn, wrapedAccount)
        }
      } else {
        if (logFlags.error) this.mainLogger.error(`setAccountData hash test failed: setAccountData for account ${utils.makeShortHash(accountId)} expected account hash: ${utils.makeShortHash(stateId)} got ${utils.makeShortHash(hash)} `)
        if (logFlags.error) this.mainLogger.error('setAccountData hash test failed: details: ' + utils.stringifyReduce(recordData))
        if (logFlags.verbose) console.log(`setAccountData hash test failed: setAccountData for account ${utils.makeShortHash(accountId)} expected account hash: ${utils.makeShortHash(stateId)} got ${utils.makeShortHash(hash)} `)
        if (logFlags.verbose) console.log('setAccountData hash test failed: details: ' + utils.stringifyReduce(recordData))
        failedHashes.push(accountId)
      }
    }
    if (logFlags.debug) this.mainLogger.debug(`setAccountData toAdd:${accountsToAdd.length}  failed:${failedHashes.length}`)
    if (logFlags.verbose) console.log(`setAccountData toAdd:${accountsToAdd.length}  failed:${failedHashes.length}`)
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

    this.accountGlobals.setupHandlers()

    this.depricated.setupHandlers()

    this.partitionObjects.setupHandlers()

    this.transactionQueue.setupHandlers()

    this.accountSync.setupHandlers()

    this.transactionConsensus.setupHandlers()

    this.accountPatcher.setupHandlers()

    // p2p ASK
    Comms.registerInternal('request_receipt_for_tx', async (payload: RequestReceiptForTxReq, respond: (arg0: RequestReceiptForTxResp) => any) => {
      let response: RequestReceiptForTxResp = { receipt: null, note: '', success: false }
      let queueEntry = this.transactionQueue.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.transactionQueue.getQueueEntryArchived(payload.txid, 'request_receipt_for_tx') // , payload.timestamp)
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

    Comms.registerInternal('request_state_for_tx_post', async (payload: RequestStateForTxReqPost, respond: (arg0: RequestStateForTxResp) => any) => {
      let response: RequestStateForTxResp = { stateList: [], beforeHashes: {}, note: '', success: false }
      // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
      let queueEntry = this.transactionQueue.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.transactionQueue.getQueueEntryArchived(payload.txid, 'request_state_for_tx_post') // , payload.timestamp)
      }

      if (queueEntry == null) {
        response.note = `failed to find queue entry: ${utils.stringifyReduce(payload.txid)}  ${payload.timestamp} dbg:${this.debugTXHistory[utils.stringifyReduce(payload.txid)]}`
        nestedCountersInstance.countEvent('stateManager', 'request_state_for_tx_post cant find queue entry')
        await respond(response)
        return
      }

      if(queueEntry.hasValidFinalData === false){
        response.note = `has queue entry but not final data: ${utils.stringifyReduce(payload.txid)}  ${payload.timestamp} dbg:${this.debugTXHistory[utils.stringifyReduce(payload.txid)]}`
        nestedCountersInstance.countEvent('stateManager', 'request_state_for_tx_post hasValidFinalData==false')
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
            nestedCountersInstance.countEvent('stateManager', 'request_state_for_tx_post failed accountData.stateId != payload.hash txid')
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

      nestedCountersInstance.countEvent('stateManager', 'request_state_for_tx_post success')
      response.success = true
      await respond(response)
    })


    Comms.registerInternal('request_tx_and_state', async (payload: {txid:string}, respond: (arg0: RequestTxResp) => any) => {
      let response: RequestTxResp = { stateList: [], beforeHashes: {}, note: '', success: false, originalData:{} }

      let txid = payload.txid


      let queueEntry = this.transactionQueue.getQueueEntrySafe(txid)
      if (queueEntry == null) {
        queueEntry = this.transactionQueue.getQueueEntryArchived(txid, 'request_tx_and_state')
      }

      //temp error for debug
      // if (logFlags.error) this.mainLogger.error(`request_tx_and_state NOTE ${utils.stringifyReduce(payload)} got queue entry: ${queueEntry != null}`)


      if (queueEntry == null) {
        response.note = `failed to find queue entry: ${utils.stringifyReduce(txid)} dbg:${this.debugTXHistory[utils.stringifyReduce(txid)]}`

        if (logFlags.error) this.mainLogger.error(`request_tx_and_state ${response.note}`)

        await respond(response)
        return
      }

      response.acceptedTX = queueEntry.acceptedTx

      let wrappedStates = queueEntry.collectedData
      if (wrappedStates != null) {
        for (let key of Object.keys(wrappedStates)) {
          let wrappedState = wrappedStates[key]
          let accountData = wrappedState
          if (accountData) {
            //include the before hash
            response.beforeHashes[key] = queueEntry.beforeHashes[key]
            //include the data
            response.stateList.push(accountData)
          }
        }
      }

      response.originalData = stringify(queueEntry.originalData)
      response.success = true
      await respond(response)
    })

    // TODO STATESHARDING4 ENDPOINTS ok, I changed this to tell, but we still need to check sender!
    //this.p2p.registerGossipHandler('spread_appliedVote', async (payload, sender, tracker) => {
    Comms.registerInternal('spread_appliedVote', async (payload: AppliedVote, respond: any) => {
      let queueEntry = this.transactionQueue.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        return
      }
      let newVote = payload as AppliedVote
      // TODO STATESHARDING4 ENDPOINTS check payload format
      // TODO STATESHARDING4 ENDPOINTS that this message is from a valid sender (may need to check docs)

      if (this.transactionConsensus.tryAppendVote(queueEntry, newVote)) {
        // Note this was sending out gossip, but since this needs to be converted to a tell function i deleted the gossip send
      }
    })

    Comms.registerInternal('get_account_data_with_queue_hints', async (payload: { accountIds: string[] }, respond: (arg0: GetAccountDataWithQueueHintsResp) => any) => {
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

    //<pre id="json"></pre>
    Context.network.registerExternalGet('debug_stats', (req, res) => {
      let cycle = this.currentCycleShardData.cycleNumber - 1

      let cycleShardValues = null
      if (this.shardValuesByCycle.has(cycle)) {
        cycleShardValues = this.shardValuesByCycle.get(cycle)
      }

      let blob = this.partitionStats.dumpLogsForCycle(cycle, false, cycleShardValues)
      res.json({ cycle, blob })
    })

    Context.network.registerExternalGet('debug_stats2', (req, res) => {
      let cycle = this.currentCycleShardData.cycleNumber - 1

      let blob = {}
      let cycleShardValues = null
      if (this.shardValuesByCycle.has(cycle)) {
        cycleShardValues = this.shardValuesByCycle.get(cycle)
        blob = this.partitionStats.getCoveredStatsPartitions(cycleShardValues)
      }
      res.json({ cycle, blob })
    })
  }

  _unregisterEndpoints() {
    //Comms.unregisterGossipHandler('acceptedTx')
    Comms.unregisterInternal('get_account_state_hash')
    Comms.unregisterInternal('get_account_state')
    //Comms.unregisterInternal('get_accepted_transactions')
    //Comms.unregisterInternal('get_account_data')
    //Comms.unregisterInternal('get_account_data2')
    Comms.unregisterInternal('get_account_data3')
    Comms.unregisterInternal('get_account_data_by_list')
    //Comms.unregisterInternal('post_partition_results')
    //Comms.unregisterInternal('get_transactions_by_list')
    //Comms.unregisterInternal('get_transactions_by_partition_index')
    //Comms.unregisterInternal('get_partition_txids')
    // new shard endpoints:
    // Comms.unregisterInternal('route_to_home_node')
    Comms.unregisterInternal('request_state_for_tx')
    Comms.unregisterInternal('request_state_for_tx_post')
    Comms.unregisterInternal('request_tx_and_state')
  
    Comms.unregisterInternal('request_receipt_for_tx')
    Comms.unregisterInternal('broadcast_state')
    Comms.unregisterGossipHandler('spread_tx_to_group')
    Comms.unregisterInternal('get_account_data_with_queue_hints')
    Comms.unregisterInternal('get_globalaccountreport')
    Comms.unregisterInternal('spread_appliedVote')
    Comms.unregisterGossipHandler('spread_appliedReceipt')

    Comms.unregisterInternal('get_trie_hashes')
    Comms.unregisterInternal('sync_trie_hashes')
    Comms.unregisterInternal('get_trie_accountHashes')
    Comms.unregisterInternal('get_account_data_by_hashes')
    
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
    if (!this.accountSync.dataSyncMainPhaseComplete) {
      return
    }
    if (!this.transactionQueue.newAcceptedTxQueueRunning) {
      this.transactionQueue.processAcceptedTxQueue()
    }
    // with the way the new lists are setup we lost our ablity to interrupt the timer but i am not sure that matters as much
    // else if (this.transactionQueue.newAcceptedTxQueue.length > 0 || this.transactionQueue.newAcceptedTxQueueTempInjest.length > 0) {
    //   this.interruptSleepIfNeeded(this.transactionQueue.newAcceptedTxQueue[0].timestamp)
    // }
  }

  async _firstTimeQueueAwait() {
    if (this.transactionQueue.newAcceptedTxQueueRunning) {
      this.statemanager_fatal(`queueAlreadyRunning`, 'DATASYNC: newAcceptedTxQueueRunning')
      return
    }

    if (logFlags.playback) this.logger.playbackLogNote('_firstTimeQueueAwait', `this.transactionQueue.newAcceptedTxQueue.length:${this.transactionQueue.newAcceptedTxQueue.length} this.transactionQueue.newAcceptedTxQueue.length:${this.transactionQueue.newAcceptedTxQueue.length}`)

    // process and keep only TXs that will change local data.
    let newList = []
    if (this.transactionQueue.newAcceptedTxQueueTempInjest.length > 0) {
      for (let txQueueEntry of this.transactionQueue.newAcceptedTxQueueTempInjest) {
        if(this.transactionQueue.txWillChangeLocalData(txQueueEntry) === true){
          newList.push(txQueueEntry)
          nestedCountersInstance.countEvent('stateManager', '_firstTimeQueueAwait kept TX' )
          this.accountSync.syncStatement.nonDiscardedTXs++
        } else {
          nestedCountersInstance.countEvent('stateManager', '_firstTimeQueueAwait discard TX' )
          this.accountSync.syncStatement.discardedTXs++
        }
      }
    }  
    this.transactionQueue.newAcceptedTxQueueTempInjest = newList

    await this.transactionQueue.processAcceptedTxQueue(true)

    if(this.accountSync.syncStatement.internalFlag === true){
      if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_syncStatement', ` `, `${utils.stringifyReduce(this.accountSync.syncStatement)}`)
      this.statemanager_fatal('shrd_sync_syncStatement-tempdebug', `${utils.stringifyReduce(this.accountSync.syncStatement)}`)
      this.accountSync.syncStatmentIsComplete()
    } else{
      this.accountSync.syncStatement.internalFlag = true
    }
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
    let partitionDump: DebugDumpPartitions = { partitions: [], cycle: 0, rangesCovered: {} as DebugDumpRangesCovered, 
    nodesCovered: {} as DebugDumpNodesCovered, allNodeIds: [], globalAccountIDs: [], globalAccountSummary: [], 
    globalStateHash: '', calculationTime: this.currentCycleShardData.calculationTime }
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

      partitionDump.globalAccountIDs = Array.from(this.accountGlobals.globalAccountMap.keys())
      partitionDump.globalAccountIDs.sort()
      // dump information about consensus group and edge nodes for each partition
      // for (var [key, value] of this.currentCycleShardData.parititionShardDataMap){

      // }

      //hash over global accounts values

      let globalAccountSummary = []
      for (let globalID in partitionDump.globalAccountIDs) {
        let backupList: Shardus.AccountsCopy[] = this.accountGlobals.getGlobalAccountBackupList(globalID)
        //let globalAccount = this.accountGlobals.globalAccountMap.get(globalID)
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

  // for debug. need to check it sorts in correcdt direction.
  _sortByIdAsc(first, second): number {
    if (first.id < second.id) {
      return -1
    }
    if (first.id > second.id) {
      return 1
    }
    return 0
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
    let partitionDump: DebugDumpPartitions = { partitions: [], cycle: 0, rangesCovered: {} as DebugDumpRangesCovered, 
    nodesCovered: {} as DebugDumpNodesCovered, allNodeIds: [], globalAccountIDs: [], globalAccountSummary: [], 
    globalStateHash: '', calculationTime: this.currentCycleShardData.calculationTime }
    partitionDump.cycle = this.currentCycleShardData.cycleNumber

    // todo port this to a static stard function!
    // check if we are in the consenus group for this partition
    // let minP = ourNodeShardData.consensusStartPartition // storedPartitions.partitionStart
    // let maxP = ourNodeShardData.consensusEndPartition // storedPartitions.partitionEnd

    let minP = ourNodeShardData.storedPartitions.partitionStart
    let maxP = ourNodeShardData.storedPartitions.partitionEnd

    let cMin = ourNodeShardData.consensusStartPartition
    let cMax = ourNodeShardData.consensusEndPartition

    partitionDump.rangesCovered = { ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: ourNodeShardData.nodeAddressNum / 0xffffffff, hP: ourNodeShardData.homePartition, cMin: cMin, cMax: cMax, stMin: ourNodeShardData.storedPartitions.partitionStart, stMax: ourNodeShardData.storedPartitions.partitionEnd, numP: this.currentCycleShardData.shardGlobals.numPartitions }

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

      partitionDump.globalAccountIDs = Array.from(this.accountGlobals.globalAccountMap.keys())
      partitionDump.globalAccountIDs.sort()
      // dump information about consensus group and edge nodes for each partition
      // for (var [key, value] of this.currentCycleShardData.parititionShardDataMap){

      // }

      //hash over global accounts values

      let globalAccountSummary = []
      for (let globalID in partitionDump.globalAccountIDs) {
        let backupList: Shardus.AccountsCopy[] = this.accountGlobals.getGlobalAccountBackupList(globalID)
        //let globalAccount = this.accountGlobals.globalAccountMap.get(globalID)
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
      if (logFlags.playback) this.logger.playbackLogNote('_waitForShardData', ` `, ` ${utils.stringifyReduce(this.currentCycleShardData)} `)
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
    if (this.accountGlobals.globalAccountMap.has(address)) {
      globalAccount = this.accountGlobals.globalAccountMap.get(address)
      if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', `getLocalOrRemoteAccount - has`)
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
        if (logFlags.verbose) this.getAccountFailDump(address, 'getLocalOrRemoteAccount: isNodeValidForInternalMessage failed, no retry')
        return null
      }

      let message = { accountIds: [address] }
      let r: GetAccountDataWithQueueHintsResp | boolean = await Comms.ask(homeNode.node, 'get_account_data_with_queue_hints', message)
      if (r === false) {
        if (logFlags.error) this.mainLogger.error('ASK FAIL getLocalOrRemoteAccount r === false')
      }

      let result = r as GetAccountDataWithQueueHintsResp
      if (result != null && result.accountData != null && result.accountData.length > 0) {
        wrappedAccount = result.accountData[0]
        if (wrappedAccount == null) {
          if (logFlags.verbose) this.getAccountFailDump(address, 'remote result.accountData[0] == null')
        }
        return wrappedAccount
      } else {
        if (result == null) {
          if (logFlags.verbose) this.getAccountFailDump(address, 'remote request missing data: result == null')
        } else if (result.accountData == null) {
          if (logFlags.verbose) this.getAccountFailDump(address, 'remote request missing data: result.accountData == null ' + utils.stringifyReduce(result))
        } else if (result.accountData.length <= 0) {
          if (logFlags.verbose) this.getAccountFailDump(address, 'remote request missing data: result.accountData.length <= 0 ' + utils.stringifyReduce(result))
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
        if (logFlags.verbose) this.getAccountFailDump(address, 'getAccountDataByList() returned null')
        return null
      }
      // there must have been an issue in the past, but for some reason we are checking the first element in the array now.
      if (accountData[0] == null) {
        if (logFlags.verbose) this.getAccountFailDump(address, 'accountData[0] == null')
      }
      if (accountData.length > 1 || accountData.length == 0) {
        if (logFlags.verbose) this.getAccountFailDump(address, `getAccountDataByList() returned wrong element count: ${accountData}`)
      }
      return wrappedAccount
    }
    return null
  }

  getAccountFailDump(address: string, message: string) {
    // this.currentCycleShardData
    if (logFlags.playback) this.logger.playbackLogNote('getAccountFailDump', ` `, `${utils.makeShortHash(address)} ${message} `)
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
      if (logFlags.error) this.mainLogger.error('getRemoteAccount: isNodeValidForInternalMessage failed, no retry yet')
      return null
    }

    let message = { accountIds: [address] }
    let result = await Comms.ask(homeNode.node, 'get_account_data_with_queue_hints', message)
    if (result === false) {
      if (logFlags.error) this.mainLogger.error('ASK FAIL getRemoteAccount result === false')
    }
    if (result === null) {
      if (logFlags.error) this.mainLogger.error('ASK FAIL getRemoteAccount result === null')
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
    let nodes = activeByIdOrder
    let nodeDistMap: { id: string; distance: number }[] = nodes.map((node) => ({ id: node.id, distance: Math.abs(hashNumber - parseInt(node.id.slice(0, 7), 16)) }))
    nodeDistMap.sort(this._distanceSortAsc) ////(a, b) => a.distance < b.distance)
    //if (logFlags.console) console.log('SORTED NODES BY DISTANCE', nodes)
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
    this.transactionQueue.queueStopped = true
  }

  _clearQueue() {
    this.transactionQueue.newAcceptedTxQueue = []
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
  async setAccount(wrappedStates: WrappedResponses, localCachedData: LocalCachedData, applyResponse: Shardus.ApplyResponse, isGlobalModifyingTX: boolean, accountFilter?: AccountFilter,  note?:string) {
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
        if (logFlags.verbose) this.mainLogger.debug(`setAccount wrappedData == null :${utils.makeShortHash(wrappedData.accountId)}`)
        continue
      }

      if (canWriteToAccount(wrappedData.accountId) === false) {
        if (logFlags.verbose) this.mainLogger.debug(`setAccount canWriteToAccount == false :${utils.makeShortHash(wrappedData.accountId)}`)
        continue
      }

      let isGlobalKey = false
      //intercept that we have this data rather than requesting it.
      // only if this tx is not a global modifying tx.   if it is a global set then it is ok to save out the global here.
      if (this.accountGlobals.globalAccountMap.has(key)) {
        if (isGlobalModifyingTX === false) {
          if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', `setAccount - has`)
          if (logFlags.verbose) this.mainLogger.debug('setAccount: Not writing global account: ' + utils.makeShortHash(key))
          continue
        }
        if (logFlags.verbose) this.mainLogger.debug('setAccount: writing global account: ' + utils.makeShortHash(key))
      }

      if (logFlags.verbose) this.mainLogger.debug(`${note} setAccount partial:${wrappedData.isPartial} key:${utils.makeShortHash(key)} hash:${utils.makeShortHash(wrappedData.stateId)} ts:${wrappedData.timestamp}`)
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

    let cycle = CycleChain.getCycleByTimestamp(txTimestamp + this.syncSettleTime)
        console.log("CycleChain.getCycleByTimestamp",cycle)
        console.log("OLD CycleChain.getCycleByTimestamp", this.p2p.state.getCycleByTimestamp(txTimestamp + this.syncSettleTime))
    let cycleOffset = 0
    // todo review this assumption. seems ok at the moment.  are there times cycle could be null and getting the last cycle is not a valid answer?
    if (cycle == null) {
      cycle = CycleChain.getNewest()
      // if (logFlags.verbose) if (logFlags.error) this.mainLogger.error( `updateAccountsCopyTable error getting cycle by timestamp: ${accountDataList[0].timestamp} offsetTime: ${this.syncSettleTime} cycle returned:${cycle.counter} `)
      cycleOffset = 1
    }
    cycleNumber = cycle.counter + cycleOffset

    // extra safety testing
    // TODO !!!  if cycle durations become variable we need to update this logic
    let cycleStart = (cycle.start + cycle.duration * cycleOffset) * 1000
    let cycleEnd = (cycle.start + cycle.duration * (cycleOffset + 1)) * 1000
    if (txTimestamp + this.syncSettleTime < cycleStart) {
      if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`updateAccountsCopyTable time error< ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
    }
    if (txTimestamp + this.syncSettleTime >= cycleEnd) {
      // if (logFlags.verbose) if (logFlags.error) this.mainLogger.error( `updateAccountsCopyTable time error>= ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
      cycleOffset++
      cycleNumber = cycle.counter + cycleOffset
      cycleStart = (cycle.start + cycle.duration * cycleOffset) * 1000
      cycleEnd = (cycle.start + cycle.duration * (cycleOffset + 1)) * 1000
      if (txTimestamp + this.syncSettleTime >= cycleEnd) {
        if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`updateAccountsCopyTable time error>= ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
      }
    }
    // TSConversion need to sort out account types!!!
    // @ts-ignore This has seemed fine in past so not going to sort out a type discrepencie here.  !== would detect and log it anyhow.
    if (accountDataList.length > 0 && accountDataList[0].timestamp !== txTimestamp) {
      if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`updateAccountsCopyTable timestamps do match txts:${txTimestamp} acc.ts:${accountDataList[0].timestamp} `)
    }
    if (accountDataList.length === 0) {
      // need to decide if this matters!
      if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`updateAccountsCopyTable empty txts:${txTimestamp}  `)
    }
    // if (logFlags.verbose) this.mainLogger.debug( `updateAccountsCopyTable acc.timestamp: ${accountDataList[0].timestamp} offsetTime: ${this.syncSettleTime} cycle computed:${cycleNumber} `)

    for (let accountEntry of accountDataList) {
      let { accountId, data, timestamp, hash } = accountEntry
      let isGlobal = this.accountGlobals.isGlobalAccount(accountId)

      let backupObj: Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }

      if (logFlags.verbose && this.extendedRepairLogging) this.mainLogger.debug(`updateAccountsCopyTable acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)

      // todo perf. batching?
      // if (logFlags.verbose) this.mainLogger.debug( 'updateAccountsCopyTableA ' + JSON.stringify(accountEntry))
      // if (logFlags.verbose) this.mainLogger.debug( 'updateAccountsCopyTableB ' + JSON.stringify(backupObj))

      // how does this not stop previous results, is it because only the first request gets through.

      // TODO: globalaccounts
      // intercept the account change here for global accounts and save it to our memory structure.
      // this structure should have a list. and be sorted by timestamp. eventually we will remove older timestamp copies of the account data.

      // wrappedAccounts.push({ accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp })

      //TODO Perf: / mem   should we only save if there is a hash change?
      if (this.accountGlobals.isGlobalAccount(accountId) && repairing === false) {
        //make sure it is a global tx.
        let globalBackupList: Shardus.AccountsCopy[] = this.accountGlobals.getGlobalAccountBackupList(accountId)
        if (globalBackupList != null) {
          globalBackupList.push(backupObj) // sort and cleanup later.

          if (logFlags.verbose && this.extendedRepairLogging) this.mainLogger.debug(`updateAccountsCopyTable added account to global backups count: ${globalBackupList.length} ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)
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
          if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(` _commitAccountCopies null account data found: ${accountData.accountId} data: ${utils.stringifyReduce(accountData)}`)
          continue
        } else {
          if (logFlags.verbose && this.extendedRepairLogging) this.mainLogger.debug(` _commitAccountCopies: ${utils.makeShortHash(accountData.accountId)} ts: ${utils.makeShortHash(accountData.timestamp)} data: ${utils.stringifyReduce(accountData)}`)
        }
      }
      // tell the app to replace the account data
      await this.app.resetAccountData(accountCopies)

      let globalAccountKeyMap: { [key: string]: boolean } = {}

      //we just have to trust that if we are restoring from data then the globals will be known
      this.accountGlobals.hasknownGlobals = true

      // update the account copies and global backups
      // it is possible some of this gets to go away eventually
      for (let accountEntry of accountCopies) {
        let { accountId, data, timestamp, hash, cycleNumber, isGlobal } = accountEntry

        // check if the is global bit was set and keep local track of it.  Before this was going to be passed in as separate data
        if (isGlobal == true) {
          globalAccountKeyMap[accountId] = true
        }

        // Maybe don't try to calculate the cycle number....
        // const cycle = CycleChain.getCycleByTimestamp(timestamp + this.syncSettleTime)
        // // find the correct cycle based on timetamp
        // if (!cycle) {
        //   if (logFlags.error) this.mainLogger.error(`_commitAccountCopies failed to get cycle for timestamp ${timestamp} accountId:${utils.makeShortHash(accountId)}`)
        //   continue
        // }
        // let cycleNumber = cycle.counter

        let backupObj: Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }

        if (logFlags.verbose && this.extendedRepairLogging) this.mainLogger.debug(`_commitAccountCopies acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)

        // If the account is global ad it to the global backup list
        if (globalAccountKeyMap[accountId] === true) {
          //this.accountGlobals.isGlobalAccount(accountId)){

          // If we do not realized this account is global yet, then set it and log to playback log
          if (this.accountGlobals.isGlobalAccount(accountId) === false) {
            this.accountGlobals.globalAccountMap.set(accountId, null) // we use null. ended up not using the data, only checking for the key is used
            if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', `set global in _commitAccountCopies accountId:${utils.makeShortHash(accountId)}`)
          }

          let globalBackupList: Shardus.AccountsCopy[] = this.accountGlobals.getGlobalAccountBackupList(accountId)
          if (globalBackupList != null) {
            globalBackupList.push(backupObj) // sort and cleanup later
            if (logFlags.verbose && this.extendedRepairLogging) this.mainLogger.debug(`_commitAccountCopies added account to global backups count: ${globalBackupList.length} ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)
          } else {
            if (logFlags.error) this.mainLogger.error(`_commitAccountCopies no global backup list found for accountId:${utils.makeShortHash(accountId)}`)
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
    if (logFlags.debug) this.mainLogger.debug(`fifoLock: ${fifoName} ${stack}`)

    let thisFifo = this.fifoLocks[fifoName]
    if (thisFifo == null) {
      thisFifo = { fifoName, queueCounter: 0, waitingList: [], lastServed: 0, queueLocked: false, lockOwner: 1 }
      this.fifoLocks[fifoName] = thisFifo
    }
    thisFifo.queueCounter++
    let ourID = thisFifo.queueCounter
    let entry = { id: ourID }

    if(fifoName === 'accountModification'){
      nestedCountersInstance.countEvent('fifo-backup',`accountModification ${thisFifo.waitingList.length}`) 
    }

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
    if (logFlags.debug) this.mainLogger.debug(`fifoUnlock: ${fifoName} ${stack}`)

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
  // TODO refactor period cleanup into sub modules!!!
  periodicCycleDataCleanup(oldestCycle: number) {
    // On a periodic bases older copies of the account data where we have more than 2 copies for the same account can be deleted.

    if (oldestCycle < 0) {
      return
    }

    // if (this.depricated.repairTrackingByCycleById == null) {
    //   return
    // }
    if (this.partitionObjects.allPartitionResponsesByCycleByPartition == null) {
      return
    }
    if (this.partitionObjects.ourPartitionResultsByCycle == null) {
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

    if (logFlags.debug) this.mainLogger.debug('Clearing out old data Start')

    let removedrepairTrackingByCycleById = 0
    let removedallPartitionResponsesByCycleByPartition = 0
    let removedourPartitionResultsByCycle = 0
    let removedshardValuesByCycle = 0
    // let oldestCycleKey = 'c' + oldestCycle
    // cleanup old repair trackers
    // for (let cycleKey of Object.keys(this.depricated.repairTrackingByCycleById)) {
    //   let cycle = cycleKey.slice(1)
    //   let cycleNum = parseInt(cycle, 10)
    //   if (cycleNum < oldestCycle) {
    //     // delete old cycle
    //     delete this.depricated.repairTrackingByCycleById[cycleKey]
    //     removedrepairTrackingByCycleById++
    //   }
    // }

    // cleanup old partition objects / receipts.
    // let responsesById = this.partitionObjects.allPartitionResponsesByCycleByPartition[key]
    // let ourPartitionValues = this.partitionObjects.ourPartitionResultsByCycle[key]
    for (let cycleKey of Object.keys(this.partitionObjects.allPartitionResponsesByCycleByPartition)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.partitionObjects.allPartitionResponsesByCycleByPartition[cycleKey]
        removedallPartitionResponsesByCycleByPartition++
      }
    }

    for (let cycleKey of Object.keys(this.partitionObjects.ourPartitionResultsByCycle)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.partitionObjects.ourPartitionResultsByCycle[cycleKey]
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

    // cleanup this.partitionObjects.txByCycleByPartition
    for (let cycleKey of Object.keys(this.partitionObjects.txByCycleByPartition)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.partitionObjects.txByCycleByPartition[cycleKey]
        removedtxByCycleByPartition++
      }
    }
    // cleanup this.partitionObjects.recentPartitionObjectsByCycleByHash
    for (let cycleKey of Object.keys(this.partitionObjects.recentPartitionObjectsByCycleByHash)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.partitionObjects.recentPartitionObjectsByCycleByHash[cycleKey]
        removedrecentPartitionObjectsByCycleByHash++
      }
    }
    // // cleanup this.depricated.repairUpdateDataByCycle
    // for (let cycleKey of Object.keys(this.depricated.repairUpdateDataByCycle)) {
    //   let cycle = cycleKey.slice(1)
    //   let cycleNum = parseInt(cycle, 10)
    //   if (cycleNum < oldestCycle) {
    //     // delete old cycle
    //     delete this.depricated.repairUpdateDataByCycle[cycleKey]
    //     removedrepairUpdateDataByCycle++
    //   }
    // }
    // cleanup this.partitionObjects.partitionObjectsByCycle
    for (let cycleKey of Object.keys(this.partitionObjects.partitionObjectsByCycle)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.partitionObjects.partitionObjectsByCycle[cycleKey]
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
    while (oldQueueEntries && this.transactionQueue.archivedQueueEntries.length > 0) {
      let queueEntry = this.transactionQueue.archivedQueueEntries[0]
      // the time is approximate so make sure it is older than five cycles.
      // added a few more to oldest cycle to keep entries in the queue longer in case syncing nodes need the data
      if (queueEntry.approximateCycleAge < oldestCycle - 3) {
        this.transactionQueue.archivedQueueEntries.shift()
        this.transactionQueue.archivedQueueEntriesByID.delete(queueEntry.acceptedTx.id)
        archivedEntriesRemoved++

        //if (logFlags.verbose) this.mainLogger.log(`queue entry removed from archive ${queueEntry.logID} tx cycle: ${queueEntry.approximateCycleAge} cycle: ${this.currentCycleShardData.cycleNumber}`)
      } else {
        oldQueueEntries = false
        break
      }
    }

    // sort and clean up our global account backups:
    if (oldestCycleTimestamp > 0) {
      this.accountGlobals.sortAndMaintainBackups(oldestCycleTimestamp)
    }

    if (logFlags.debug) this.mainLogger.debug(`Clearing out old data Cleared: ${removedrepairTrackingByCycleById} ${removedallPartitionResponsesByCycleByPartition} ${removedourPartitionResultsByCycle} ${removedshardValuesByCycle} ${removedtxByCycleByPartition} ${removedrecentPartitionObjectsByCycleByHash} ${removedrepairUpdateDataByCycle} ${removedpartitionObjectsByCycle} ${removepartitionReceiptsByCycleCounter} ${removeourPartitionReceiptsByCycleCounter} archQ:${archivedEntriesRemoved}`)

    // TODO 1 calculate timestamp for oldest accepted TX to delete.

    // TODO effient process to query all accounts and get rid of themm but keep at least one table entry (prefably the newest)
    // could do this in two steps
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

        this.eventEmitter.emit('set_queue_partition_gossip')
        lastCycle = CycleChain.getNewest()
        if (lastCycle) {
          const ourNode = NodeList.nodes.get(Self.id)

          if (ourNode === null || ourNode === undefined) {
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

          if (this.partitionObjects.syncPartitionsStarted) {
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
        lastCycle = CycleChain.getNewest()
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

        this.partitionStats.dumpLogsForCycle(lastCycle.counter, true, cycleShardValues)

        // do this every 5 cycles.
        if (lastCycle.counter % 5 !== 0) {
          return
        }

        if (this.doDataCleanup === true) {
          if (logFlags.verbose) this.mainLogger.debug(`cycle_q3_start-clean cycle: ${lastCycle.counter}`)
          // clean up cycle data that is more than 10 cycles old.
          this.periodicCycleDataCleanup(lastCycle.counter - 10)
        }
      } finally {
        this.profiler.profileSectionEnd('stateManager_cycle_q3_start')
      }
    })
  }

  async processPreviousCycleSummaries() {
    let lastCycle = CycleChain.getNewest()
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

    let cycle = CycleChain.getCycleChain(cycleShardValues.cycleNumber, cycleShardValues.cycleNumber)[0]
    if (cycle === null || cycle === undefined) {
      return
    }

    // if (this.oldFeature_GeneratePartitionReport === true) {
    //   if (logFlags.verbose) this.mainLogger.debug(` processPreviousCycleSummaries cycle: ${cycle.counter}`)
    //   // this will take temp TXs and make sure they are stored in the correct place for us to generate partitions
    //   this.partitionObjects.processTempTXs(cycle)

    //   // During the Q2 phase of a cycle, nodes compute the partition hash of the previous cycle for all the partitions covered by the node.
    //   // Q2 was chosen so that any transactions submitted with a time stamp that falls in the previous quarter will have been processed and finalized. This could be changed to Q3 if we find that more time is needed.
    //   this.partitionObjects.generatePartitionObjects(cycle)
    // }

    let receiptMapResults = []

    // Get the receipt map to send as a report
    if (this.feature_receiptMapResults === true) {
      receiptMapResults = this.generateReceiptMapResults(cycle)
      if (logFlags.verbose) this.mainLogger.debug(`receiptMapResults: ${stringify(receiptMapResults)}`)
    }

    // Get the stats data to send as a reort
    let statsClump = {}
    if (this.feature_generateStats === true) {
      statsClump = this.partitionStats.getCoveredStatsPartitions(cycleShardValues)
    }

    // build partition hashes from previous full cycle
    let mainHashResults: MainHashResults = null
    if (this.feature_partitionHashes === true) {
      if (cycleShardValues && cycleShardValues.ourNode.status === 'active') {
        mainHashResults = this.accountCache.buildPartitionHashesForNode(cycleShardValues)

        this.partitionObjects.updatePartitionReport(cycleShardValues, mainHashResults)


        this.accountPatcher.updateTrieAndBroadCast(lastCycle.counter)
      }
    }

    // Hook for Snapshot module to listen to after partition data is settled
    this.eventEmitter.emit('cycleTxsFinalized', cycleShardValues, receiptMapResults, statsClump, mainHashResults)

    if (this.debugFeature_dumpAccountData === true) {
      this.dumpAccountDebugData2(mainHashResults)
    }

    // pre-allocate the next two cycles if needed
    for (let i = 1; i <= 2; i++) {
      let prekey = 'c' + (cycle.counter + i)
      if (this.partitionObjects.partitionObjectsByCycle[prekey] == null) {
        this.partitionObjects.partitionObjectsByCycle[prekey] = []
      }
      if (this.partitionObjects.ourPartitionResultsByCycle[prekey] == null) {
        this.partitionObjects.ourPartitionResultsByCycle[prekey] = []
      }
    }

    // if (this.oldFeature_GeneratePartitionReport === true && this.oldFeature_BroadCastPartitionReport === true) {
    //   // Nodes generate the partition result for all partitions they cover.
    //   // Nodes broadcast the set of partition results to N adjacent peers on each side; where N is
    //   // the number of partitions covered by the node. Uses the /post_partition_results API.
    //   await this.partitionObjects.broadcastPartitionResults(cycle.counter) // Cycle_number
    // }

    //this funciton is not awaited so we should be able to sleep and then 

    await utils.sleep(10000) //wait 10 seconds

    await this.accountPatcher.testAndPatchAccounts(lastCycle.counter)
  }

  /**
   * initApoptosisAndQuitSyncing
   * stop syncing and init apoptosis
   */
  initApoptosisAndQuitSyncing(logMsg: string) {
    let log = `initApoptosisAndQuitSyncing ${utils.getTime('s')}  ${logMsg}`
    if (logFlags.console) console.log(log)
    if (logFlags.error) this.mainLogger.error(log)

    let stack = new Error().stack
    this.statemanager_fatal('initApoptosisAndQuitSyncing', `initApoptosisAndQuitSyncing ${logMsg} ${stack}` )

    this.accountSync.failAndDontRestartSync()
    this.p2p.initApoptosis()
  }

  /***
   *    ########  ########  ######  ######## #### ########  ########  ######
   *    ##     ## ##       ##    ## ##        ##  ##     ##    ##    ##    ##
   *    ##     ## ##       ##       ##        ##  ##     ##    ##    ##
   *    ########  ######   ##       ######    ##  ########     ##     ######
   *    ##   ##   ##       ##       ##        ##  ##           ##          ##
   *    ##    ##  ##       ##    ## ##        ##  ##           ##    ##    ##
   *    ##     ## ########  ######  ######## #### ##           ##     ######
   */


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
    for (let queueEntry of this.transactionQueue.newAcceptedTxQueue) {
      if (queueEntry.cycleToRecordOn === cycleToSave) {
        // make sure we have a receipt
        let receipt = this.getReceipt(queueEntry)
        if (receipt == null) {
          if(logFlags.error) if (logFlags.error) this.mainLogger.error(`generateReceiptMapResults found entry in with no receipt in newAcceptedTxQueue. ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
        } else {
          queueEntriesToSave.push(queueEntry)
        }
      }
    }

    for (let queueEntry of this.transactionQueue.archivedQueueEntries) {
      if (queueEntry.cycleToRecordOn === cycleToSave) {
        // make sure we have a receipt
        let receipt = this.getReceipt(queueEntry)
        if (receipt == null) {
          if(logFlags.error) if (logFlags.error) this.mainLogger.error(`generateReceiptMapResults found entry in with no receipt in archivedQueueEntries. ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
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



  isNodeValidForInternalMessage(nodeId: string, debugMsg: string, checkForNodeDown: boolean = true, checkForNodeLost: boolean = true, checkIsUpRecent: boolean = true): boolean {
    let node: Shardus.Node = this.p2p.state.getNode(nodeId)
    let logErrors = logFlags.debug
    if (node == null) {
      if (logErrors) if (logFlags.error) this.mainLogger.error(`isNodeValidForInternalMessage node == null ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
      return false
    }
    let nodeStatus = node.status
    if (nodeStatus != 'active' || potentiallyRemoved.has(node.id)) {
      if (logErrors) if (logFlags.error) this.mainLogger.error(`isNodeValidForInternalMessage node not active. ${nodeStatus} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
      return false
    }

    if(checkIsUpRecent){
      let { upRecent, state, age } = isNodeUpRecent(nodeId, 5000)
      if(upRecent === true){
        if (checkForNodeDown) {
          let { down, state } = isNodeDown(nodeId)
          if (down === true) {
            if (logErrors) this.mainLogger.debug(`isNodeUpRecentOverride: ${age} isNodeValidForInternalMessage isNodeDown == true state:${state} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
          }
        }
        if (checkForNodeLost) {
          if (isNodeLost(nodeId) === true) {
            if (logErrors) this.mainLogger.debug(`isNodeUpRecentOverride: ${age} isNodeValidForInternalMessage isNodeLost == true ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
          }
        }
        return true
      } else {
        if (logErrors) this.mainLogger.debug(`isNodeUpRecentOverride: ${age} upRecent = false. no recent TX, but this is not a fail conditions`)
      }
    }


    if (checkForNodeDown) {
      let { down, state } = isNodeDown(nodeId)
      if (down === true) {
        if (logErrors) if (logFlags.error) this.mainLogger.error(`isNodeValidForInternalMessage isNodeDown == true state:${state} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
        return false
      }
    }
    if (checkForNodeLost) {
      if (isNodeLost(nodeId) === true) {
        if (logErrors) if (logFlags.error) this.mainLogger.error(`isNodeValidForInternalMessage isNodeLost == true ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
        return false
      }
    }
    return true
  }

  filterValidNodesForInternalMessage(nodeList: Shardus.Node[], debugMsg: string, checkForNodeDown: boolean = true, checkForNodeLost: boolean = true, checkIsUpRecent: boolean = true): Shardus.Node[] {
    let filteredNodes = []

    let logErrors = logFlags.debug
    for (let node of nodeList) {
      let nodeId = node.id

      if (node == null) {
        if (logErrors) if (logFlags.error) this.mainLogger.error(`isNodeValidForInternalMessage node == null ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
        continue
      }
      let nodeStatus = node.status
      if (nodeStatus != 'active' || potentiallyRemoved.has(node.id)) {
        if (logErrors) if (logFlags.error) this.mainLogger.error(`isNodeValidForInternalMessage node not active. ${nodeStatus} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
        continue
      }
      if(checkIsUpRecent){
        let { upRecent, state, age } = isNodeUpRecent(nodeId, 5000)
        if(upRecent === true){
          filteredNodes.push(node)

          if (checkForNodeDown) {
            let { down, state } = isNodeDown(nodeId)
            if (down === true) {
              if (logErrors) this.mainLogger.debug(`isNodeUpRecentOverride: ${age} isNodeValidForInternalMessage isNodeDown == true state:${state} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
            }
          }
          if (checkForNodeLost) {
            if (isNodeLost(nodeId) === true) {
              if (logErrors) this.mainLogger.debug(`isNodeUpRecentOverride: ${age} isNodeValidForInternalMessage isNodeLost == true ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
            }
          }
          continue
        } else {
          if (logErrors) this.mainLogger.debug(`isNodeUpRecentOverride: ${age} no recent TX, but this is not a fail conditions`)
        }
      }

      if (checkForNodeDown) {
        let { down, state } = isNodeDown(nodeId)
        if (down === true) {
          if (logErrors) if (logFlags.error) this.mainLogger.error(`isNodeValidForInternalMessage isNodeDown == true state:${state} ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
          continue
        }
      }
      if (checkForNodeLost) {
        if (isNodeLost(nodeId) === true) {
          if (logErrors) if (logFlags.error) this.mainLogger.error(`isNodeValidForInternalMessage isNodeLost == true ${utils.stringifyReduce(nodeId)} ${debugMsg}`)
          continue
        }
      }
      filteredNodes.push(node)
    }
    return filteredNodes
  }

  statemanager_fatal(key, log) {
    nestedCountersInstance.countEvent('fatal-log', key)
    this.fatalLogger.fatal(key + ' ' + log)
  }
}

export default StateManager
