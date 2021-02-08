import { ShardusConfiguration } from '../shardus/shardus-types'
import Shardus = require('../shardus/shardus-types')

//import {ShardGlobals,ShardInfo,StoredPartition,NodeShardData,AddressRange, HomeNodeSummary,ParititionShardDataMap,NodeShardDataMap,MergeResults,BasicAddressRange} from  './shardFunction2Types'
import { ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, HomeNodeSummary, ParititionShardDataMap, NodeShardDataMap, MergeResults, BasicAddressRange } from './shardFunctionTypes'

import { isNodeDown, isNodeLost } from '../p2p/Lost'

import ShardFunctions from './shardFunctions2.js'
import ShardFunctions2 from './shardFunctions2.js' // oof, need to refactor this!

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
import Logger from '../logger'
//import { NodeShardData } from './shardFunctionTypes'

import { throws } from 'assert'
import * as Context from '../p2p/Context'
// import { platform } from 'os' //why did this automatically get added?
//import NodeList from "../p2p/NodeList"

//let shardFunctions = import("./shardFunctions").
//type foo = ShardFunctionTypes.BasicAddressRange

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


/**
 * WrappedEventEmitter just a default extended WrappedEventEmitter
 * using EventEmitter was causing issues?
 */
class WrappedEventEmitter extends EventEmitter {
  constructor(){
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
  stateManagerStats: PartitionStats
  stateManagerCache: AccountCache
  stateManagerSync: AccountSync
  accountGlobals: AccountGlobals  
  transactionQueue: TransactionQueue
  transactionRepair: TransactionRepair
  transactionConsensus: TransactionConsenus
  partitionObjects: PartitionObjects
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

  syncSettleTime: number
  debugTXHistory: { [id: string]: string } // need to disable or clean this as it will leak memory

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

  verboseLogs: boolean

  logger: Logger

  extendedRepairLogging:boolean

  canDataRepair:boolean // the old repair.. todo depricate further.
  lastActiveNodeCount: number

  doDataCleanup: boolean

  _listeners: any //Event listners

  queueSitTime: number
  dataPhaseTag: string

  preTXQueue: AcceptedTx[] // mostly referenced in commented out code for queing up TXs before systems are ready.

  sleepInterrupt: any // see interruptibleSleep.  todo type this, or clean out

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
    //super()
    this.verboseLogs = verboseLogs

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
    this.useHashSets = true
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

    this.stateManagerCache = new AccountCache(verboseLogs, profiler, app, logger, crypto, config)

    this.stateManagerStats = new PartitionStats(verboseLogs, profiler, app, logger, crypto, config, this.stateManagerCache)
    this.stateManagerStats.summaryPartitionCount = 32
    this.stateManagerStats.initSummaryBlobs()

    this.stateManagerSync = new AccountSync(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)

    this.accountGlobals = new AccountGlobals(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)
    this.transactionQueue = new TransactionQueue(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)
    this.transactionRepair = new TransactionRepair(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)
    this.transactionConsensus = new TransactionConsenus(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)
    this.partitionObjects = new PartitionObjects(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)
    this.depricated = new Depricated(this, verboseLogs, profiler, app, logger, storage, p2p, crypto, config)


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
    this.debugFeatureOld_partitionReciepts = false

    this.stateIsGood_txHashsetOld = true
    this.stateIsGood_activeRepairs = true
    this.stateIsGood = true

    // other debug features
    if (this.config && this.config.debug) {
      this.feature_useNewParitionReport = this.tryGetBoolProperty(this.config.debug, 'useNewParitionReport', this.feature_useNewParitionReport)

      this.oldFeature_GeneratePartitionReport = this.tryGetBoolProperty(this.config.debug, 'oldPartitionSystem', this.oldFeature_GeneratePartitionReport)

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
      //     this.transactionQueue.routeAndQueueAcceptedTransaction(tx, false, null)
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


    this.lastActiveNodeCount = cycleShardData.activeNodes.length

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
    this.dataPhaseTag = 'ACTIVE: '
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
    if (this.verboseLogs) this.mainLogger.debug( 'writeCombinedAccountDataToBackups ' + accountCopies.length + ' ' + utils.stringifyReduce(accountCopies))

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

    this.accountGlobals.setupHandlers()

    this.depricated.setupHandlers()

    this.partitionObjects.setupHandlers()

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
      let stateHash = await this.transactionQueue.getAccountsStateHash(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd)
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
        let partitionObjectsByHash = this.partitionObjects.recentPartitionObjectsByCycleByHash[key]
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
          let txTally = this.partitionObjects.getTXList(cycle, partitionId)
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
        let partitionObjects = this.partitionObjects.partitionObjectsByCycle[key]
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
    //   let queueEntry = this.transactionQueue.getQueueEntrySafe(payload.txid)//, payload.timestamp)
    //   if (queueEntry) {
    //     return
    //     // already have this in our queue
    //   }

    //   this.transactionQueue.routeAndQueueAcceptedTransaction(payload.acceptedTx, true, null, false) // todo pass in sender?

    //   // no response needed?
    // })

    // p2p ASK
    this.p2p.registerInternal('request_state_for_tx', async (payload: RequestStateForTxReq, respond: (arg0: RequestStateForTxResp) => any) => {
      let response: RequestStateForTxResp = { stateList: [], beforeHashes: {}, note: '', success: false }
      // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
      let queueEntry = this.transactionQueue.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.transactionQueue.getQueueEntryArchived(payload.txid, 'request_state_for_tx') // , payload.timestamp)
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

    this.p2p.registerInternal('request_state_for_tx_post', async (payload: RequestStateForTxReqPost, respond: (arg0: RequestStateForTxResp) => any) => {
      let response: RequestStateForTxResp = { stateList: [], beforeHashes: {}, note: '', success: false }
      // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
      let queueEntry = this.transactionQueue.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.transactionQueue.getQueueEntryArchived(payload.txid, 'request_state_for_tx_post') // , payload.timestamp)
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
      let queueEntry = this.transactionQueue.getQueueEntrySafe(payload.txid) // , payload.timestamp)
      if (queueEntry == null) {
        //if we are syncing we need to queue this transaction!

        //this.transactionQueue.routeAndQueueAcceptedTransaction (acceptedTx:AcceptedTx, sendGossip:boolean = true, sender: Shardus.Node  |  null, globalModification:boolean)

        return
      }
      // add the data in
      for (let data of payload.stateList) {
        this.transactionQueue.queueEntryAddData(queueEntry, data)
        if (queueEntry.state === 'syncing') {
          if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_sync_gotBroadcastData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
        }
      }
    })

    this.p2p.registerGossipHandler('spread_tx_to_group', async (payload, sender, tracker) => {
      //  gossip 'spread_tx_to_group' to transaction group
      // Place tx in queue (if younger than m)

      let queueEntry = this.transactionQueue.getQueueEntrySafe(payload.id) // , payload.timestamp)
      if (queueEntry) {
        return
        // already have this in our queue
      }

      //TODO need to check transaction fields.

      let noConsensus = false // this can only be true for a set command which will never come from an endpoint
      let added = this.transactionQueue.routeAndQueueAcceptedTransaction(payload, /*sendGossip*/ false, sender, /*globalModification*/ false, noConsensus)
      if (added === 'lost') {
        return // we are faking that the message got lost so bail here
      }
      if (added === 'out of range') {
        return
      }
      if (added === 'notReady') {
        return
      }
      queueEntry = this.transactionQueue.getQueueEntrySafe(payload.id) //, payload.timestamp) // now that we added it to the queue, it should be possible to get the queueEntry now

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
      let transactionGroup = this.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
      if (queueEntry.ourNodeInTransactionGroup === false) {
        return
      }
      if (transactionGroup.length > 1) {
        this.debugNodeGroup(queueEntry.acceptedTx.id, queueEntry.acceptedTx.timestamp, `gossip to neighbors`, transactionGroup)
        this.p2p.sendGossipIn('spread_tx_to_group', payload, tracker, sender, transactionGroup)
      }

      // await this.transactionQueue.routeAndQueueAcceptedTransaction(acceptedTX, false, sender)
    })

    // TODO STATESHARDING4 ENDPOINTS ok, I changed this to tell, but we still need to check sender!
    //this.p2p.registerGossipHandler('spread_appliedVote', async (payload, sender, tracker) => {
    this.p2p.registerInternal('spread_appliedVote', async (payload: AppliedVote, respond: any) => {
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

    this.p2p.registerGossipHandler('spread_appliedReceipt', async (payload, sender, tracker) => {
      let appliedReceipt = payload as AppliedReceipt
      let queueEntry = this.transactionQueue.getQueueEntrySafe(appliedReceipt.txid) // , payload.timestamp)
      if (queueEntry == null) {
        if (queueEntry == null) {
          // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
          queueEntry = this.transactionQueue.getQueueEntryArchived(payload.txid, 'spread_appliedReceipt') // , payload.timestamp)
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
        let consensusGroup = this.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
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

    if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('_firstTimeQueueAwait', `this.transactionQueue.newAcceptedTxQueue.length:${this.transactionQueue.newAcceptedTxQueue.length} this.transactionQueue.newAcceptedTxQueue.length:${this.transactionQueue.newAcceptedTxQueue.length}`)

    await this.transactionQueue.processAcceptedTxQueue()
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
    if (this.accountGlobals.globalAccountMap.has(address)) {
      globalAccount = this.accountGlobals.globalAccountMap.get(address)
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
        if (this.verboseLogs) this.mainLogger.debug( `setAccount wrappedData == null :${utils.makeShortHash(wrappedData.accountId)}`)
        continue
      }

      if (canWriteToAccount(wrappedData.accountId) === false) {
        if (this.verboseLogs) this.mainLogger.debug( `setAccount canWriteToAccount == false :${utils.makeShortHash(wrappedData.accountId)}`)
        continue
      }

      let isGlobalKey = false
      //intercept that we have this data rather than requesting it.
      // only if this tx is not a global modifying tx.   if it is a global set then it is ok to save out the global here.
      if (this.accountGlobals.globalAccountMap.has(key)) {
        if (isGlobalModifyingTX === false) {
          if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('globalAccountMap', `setAccount - has`)
          if (this.verboseLogs) this.mainLogger.debug('setAccount: Not writing global account: ' + utils.makeShortHash(key))
          continue
        }
        if (this.verboseLogs) this.mainLogger.debug('setAccount: writing global account: ' + utils.makeShortHash(key))
      }

      if (this.verboseLogs) this.mainLogger.debug( `setAccount partial:${wrappedData.isPartial} key:${utils.makeShortHash(key)}`)
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
      // if (this.verboseLogs) this.mainLogger.error( `updateAccountsCopyTable error getting cycle by timestamp: ${accountDataList[0].timestamp} offsetTime: ${this.syncSettleTime} cycle returned:${cycle.counter} `)
      cycleOffset = 1
    }
    cycleNumber = cycle.counter + cycleOffset

    // extra safety testing
    // TODO !!!  if cycle durations become variable we need to update this logic
    let cycleStart = (cycle.start + cycle.duration * cycleOffset) * 1000
    let cycleEnd = (cycle.start + cycle.duration * (cycleOffset + 1)) * 1000
    if (txTimestamp + this.syncSettleTime < cycleStart) {
      if (this.verboseLogs) this.mainLogger.error( `updateAccountsCopyTable time error< ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
    }
    if (txTimestamp + this.syncSettleTime >= cycleEnd) {
      // if (this.verboseLogs) this.mainLogger.error( `updateAccountsCopyTable time error>= ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
      cycleOffset++
      cycleNumber = cycle.counter + cycleOffset
      cycleStart = (cycle.start + cycle.duration * cycleOffset) * 1000
      cycleEnd = (cycle.start + cycle.duration * (cycleOffset + 1)) * 1000
      if (txTimestamp + this.syncSettleTime >= cycleEnd) {
        if (this.verboseLogs) this.mainLogger.error( `updateAccountsCopyTable time error>= ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
      }
    }
    // TSConversion need to sort out account types!!!
    // @ts-ignore This has seemed fine in past so not going to sort out a type discrepencie here.  !== would detect and log it anyhow.
    if (accountDataList.length > 0 && accountDataList[0].timestamp !== txTimestamp) {
      if (this.verboseLogs) this.mainLogger.error( `updateAccountsCopyTable timestamps do match txts:${txTimestamp} acc.ts:${accountDataList[0].timestamp} `)
    }
    if (accountDataList.length === 0) {
      // need to decide if this matters!
      if (this.verboseLogs) this.mainLogger.error( `updateAccountsCopyTable empty txts:${txTimestamp}  `)
    }
    // if (this.verboseLogs) this.mainLogger.debug( `updateAccountsCopyTable acc.timestamp: ${accountDataList[0].timestamp} offsetTime: ${this.syncSettleTime} cycle computed:${cycleNumber} `)

    for (let accountEntry of accountDataList) {
      let { accountId, data, timestamp, hash } = accountEntry
      let isGlobal = this.accountGlobals.isGlobalAccount(accountId)

      let backupObj: Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug( `updateAccountsCopyTable acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)

      // todo perf. batching?
      // if (this.verboseLogs) this.mainLogger.debug( 'updateAccountsCopyTableA ' + JSON.stringify(accountEntry))
      // if (this.verboseLogs) this.mainLogger.debug( 'updateAccountsCopyTableB ' + JSON.stringify(backupObj))

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

          if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug( `updateAccountsCopyTable added account to global backups count: ${globalBackupList.length} ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)
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
          if (this.verboseLogs) this.mainLogger.error( ` _commitAccountCopies null account data found: ${accountData.accountId} data: ${utils.stringifyReduce(accountData)}`)
          continue
        } else {
          if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug( ` _commitAccountCopies: ${utils.makeShortHash(accountData.accountId)} ts: ${utils.makeShortHash(accountData.timestamp)} data: ${utils.stringifyReduce(accountData)}`)
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
        // const cycle = this.p2p.state.getCycleByTimestamp(timestamp + this.syncSettleTime)
        // // find the correct cycle based on timetamp
        // if (!cycle) {
        //   this.mainLogger.error(`_commitAccountCopies failed to get cycle for timestamp ${timestamp} accountId:${utils.makeShortHash(accountId)}`)
        //   continue
        // }
        // let cycleNumber = cycle.counter

        let backupObj: Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }

        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug( `_commitAccountCopies acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)

        // If the account is global ad it to the global backup list
        if (globalAccountKeyMap[accountId] === true) {
          //this.accountGlobals.isGlobalAccount(accountId)){

          // If we do not realized this account is global yet, then set it and log to playback log
          if (this.accountGlobals.isGlobalAccount(accountId) === false) {
            this.accountGlobals.globalAccountMap.set(accountId, null) // we use null. ended up not using the data, only checking for the key is used
            if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('globalAccountMap', `set global in _commitAccountCopies accountId:${utils.makeShortHash(accountId)}`)
          }

          let globalBackupList: Shardus.AccountsCopy[] = this.accountGlobals.getGlobalAccountBackupList(accountId)
          if (globalBackupList != null) {
            globalBackupList.push(backupObj) // sort and cleanup later
            if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug( `_commitAccountCopies added account to global backups count: ${globalBackupList.length} ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)
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
  // TODO refactor period cleanup into sub modules!!!
  periodicCycleDataCleanup(oldestCycle: number) {
    // On a periodic bases older copies of the account data where we have more than 2 copies for the same account can be deleted.

    if (oldestCycle < 0) {
      return
    }

    if (this.depricated.repairTrackingByCycleById == null) {
      return
    }
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

    this.mainLogger.debug('Clearing out old data Start')

    let removedrepairTrackingByCycleById = 0
    let removedallPartitionResponsesByCycleByPartition = 0
    let removedourPartitionResultsByCycle = 0
    let removedshardValuesByCycle = 0
    // let oldestCycleKey = 'c' + oldestCycle
    // cleanup old repair trackers
    for (let cycleKey of Object.keys(this.depricated.repairTrackingByCycleById)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.depricated.repairTrackingByCycleById[cycleKey]
        removedrepairTrackingByCycleById++
      }
    }

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
    // cleanup this.depricated.repairUpdateDataByCycle
    for (let cycleKey of Object.keys(this.depricated.repairUpdateDataByCycle)) {
      let cycle = cycleKey.slice(1)
      let cycleNum = parseInt(cycle, 10)
      if (cycleNum < oldestCycle) {
        // delete old cycle
        delete this.depricated.repairUpdateDataByCycle[cycleKey]
        removedrepairUpdateDataByCycle++
      }
    }
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
        archivedEntriesRemoved++

        if (this.verboseLogs) this.mainLogger.log(`queue entry removed from archive ${queueEntry.logID} tx cycle: ${queueEntry.approximateCycleAge} cycle: ${this.currentCycleShardData.cycleNumber}`)
      } else {
        oldQueueEntries = false
        break
      }
    }

    // sort and clean up our global account backups:
    if (oldestCycleTimestamp > 0) {
      this.accountGlobals.sortAndMaintainBackups(oldestCycleTimestamp)
    }

    this.mainLogger.debug(`Clearing out old data Cleared: ${removedrepairTrackingByCycleById} ${removedallPartitionResponsesByCycleByPartition} ${removedourPartitionResultsByCycle} ${removedshardValuesByCycle} ${removedtxByCycleByPartition} ${removedrecentPartitionObjectsByCycleByHash} ${removedrepairUpdateDataByCycle} ${removedpartitionObjectsByCycle} ${removepartitionReceiptsByCycleCounter} ${removeourPartitionReceiptsByCycleCounter} archQ:${archivedEntriesRemoved}`)

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
          if (this.verboseLogs) this.mainLogger.debug( ` _repair startSyncPartitions:cycle_q3_start-clean cycle: ${lastCycle.counter}`)
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
      if (this.verboseLogs) this.mainLogger.debug( ` processPreviousCycleSummaries cycle: ${cycle.counter}`)
      // this will take temp TXs and make sure they are stored in the correct place for us to generate partitions
      this.partitionObjects.processTempTXs(cycle)

      // During the Q2 phase of a cycle, nodes compute the partition hash of the previous cycle for all the partitions covered by the node.
      // Q2 was chosen so that any transactions submitted with a time stamp that falls in the previous quarter will have been processed and finalized. This could be changed to Q3 if we find that more time is needed.
      this.partitionObjects.generatePartitionObjects(cycle)
    }

    let receiptMapResults = []

    // Get the receipt map to send as a report
    if (this.feature_receiptMapResults === true) {
      receiptMapResults = this.generateReceiptMapResults(cycle)
      if (this.verboseLogs) this.mainLogger.debug( `receiptMapResults: ${stringify(receiptMapResults)}`)
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

        this.partitionObjects.updatePartitionReport(cycleShardValues, mainHashResults)
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

    if (this.oldFeature_GeneratePartitionReport === true && this.oldFeature_BroadCastPartitionReport === true) {
      // Nodes generate the partition result for all partitions they cover.
      // Nodes broadcast the set of partition results to N adjacent peers on each side; where N is
      // the number of partitions covered by the node. Uses the /post_partition_results API.
      await this.partitionObjects.broadcastPartitionResults(cycle.counter) // Cycle_number
    }
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
      this.depricated.trySendAndPurgeReceiptsToArchives(partitionReceipt)
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
    for (let queueEntry of this.transactionQueue.newAcceptedTxQueue) {
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

    for (let queueEntry of this.transactionQueue.archivedQueueEntries) {
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
