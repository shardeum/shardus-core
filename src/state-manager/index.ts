import { ShardusConfiguration } from '../shardus/shardus-types'
import Shardus = require('../shardus/shardus-types')


import {ShardGlobals2,ShardInfo2,StoredPartition2,NodeShardData2,AddressRange2, HomeNodeSummary2,ParititionShardDataMap2,NodeShardDataMap2,MergeResults2,BasicAddressRange2} from  './shardFunction2Types'

import ShardFunctions from './shardFunctions2.js'

const EventEmitter = require('events')
import * as utils from '../utils'

const stringify = require('fast-stable-stringify')

const allZeroes64 = '0'.repeat(64)

const cHashSetStepSize = 4
const cHashSetTXStepSize = 2
const cHashSetDataStepSize = 2

// not sure about this.
import Consensus from "../consensus"
import Profiler from "../utils/profiler"
import { P2PModuleContext as P2P } from "../p2p/Context"
import Storage from "../storage"
import Crypto from "../crypto"
import Logger from "../logger"
import { NodeShardData } from './shardFunctionTypes'
import ShardFunctions2 from './shardFunctions2.js'
// import { platform } from 'os' //why did this automatically get added?
//import NodeList from "../p2p/NodeList"

//let shardFunctions = import("./shardFunctions").
//type foo = ShardFunctionTypes.BasicAddressRange2


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

    app:Shardus.App;
    storage:Storage;
    p2p:P2P;
    crypto:Crypto;
    config:Shardus.ShardusConfiguration;
    profiler:Profiler

    newAcceptedTxQueue:QueueEntry[];
    newAcceptedTxQueueTempInjest:QueueEntry[];
    archivedQueueEntries:QueueEntry[];
    syncTrackers:SyncTracker[];
    shardValuesByCycle:Map<number, CycleShardData>;
    currentCycleShardData: (CycleShardData | null);

    dataRepairStack :RepairTracker[]
    dataRepairsCompleted:number 
    dataRepairsStarted:number
    repairAllStoredPartitions:boolean
    repairStartedMap : Map<string,boolean>
    repairCompletedMap: Map<string,boolean>

    partitionReceiptsByCycleCounter :  {[cycleKey:string]:PartitionReceipt[] } //Object.<string, PartitionReceipt[]> // a map of cycle keys to lists of partition receipts. 
    ourPartitionReceiptsByCycleCounter: {[cycleKey:string]:PartitionReceipt } //Object.<string, PartitionReceipt> //a map of cycle keys to lists of partition receipts.

    fifoLocks:FifoLockObjectMap

    //data sync and data repair structure defined
    /** partition objects by cycle.  index by cycle counter key to get an array */
    partitionObjectsByCycle:{[cycleKey:string]: PartitionObject[]} 
    /** our partition Results by cycle.  index by cycle counter key to get an array */
    ourPartitionResultsByCycle:{[cycleKey:string]: PartitionResult[]}
    /** tracks state for repairing partitions. index by cycle counter key to get the repair object, index by parition  */
    repairTrackingByCycleById:{[cycleKey:string]:{[id:string]: RepairTracker} }
    /** UpdateRepairData by cycle key */
    repairUpdateDataByCycle:{[cycleKey:string]: UpdateRepairData[]}
    /** partition objects by cycle by hash.   */
    recentPartitionObjectsByCycleByHash:{[cycleKey:string]: {[hash:string]: PartitionObject}}
    /** temporary store for TXs that we put in a partition object after a cycle is complete. an array that holds any TXs (i.e. from different cycles), code will filter out what it needs @see TempTxRecord */
    tempTXRecords:TempTxRecord[]
    /** TxTallyList data indexed by cycle key and partition key. @see TxTallyList */
    txByCycleByPartition:{[cycleKey:string]: {[partitionKey:string]: TxTallyList}}
    /** Stores the partition responses that other nodes push to us.  Index by cycle key, then index by partition id */
    allPartitionResponsesByCycleByPartition:{[cycleKey:string]: {[partitionKey:string]: PartitionResult[]}}

    globalAccountMap: Map<string, Shardus.WrappedDataFromQueue | null>

    /** Need the ablity to get account copies and use them later when applying a transaction. how to use the right copy or even know when to use this at all? */
    /** Could go by cycle number. if your cycle matches the one in is list use it? */
    /** What if the global account is transformed several times durring that cycle. oof. */
    /** ok best thing to do is to store the account every time it changes for a given period of time. */
    /** how to handle reparing a global account... yikes that is hard. */
    globalAccountRepairBank: Map<string, Shardus.AccountsCopy[]>

    appFinishedSyncing: boolean;

    combinedAccountData: Shardus.WrappedData[];

    dataSourceNode: Shardus.Node;
    dataSourceNodeList: Shardus.Node[];
    dataSourceNodeIndex: number;

    debugNoTxVoting: boolean;

  constructor (verboseLogs: boolean, profiler: Profiler, app: Shardus.App, consensus: Consensus, logger: Logger, storage : Storage, p2p: P2P, crypto: Crypto, config: Shardus.ShardusConfiguration) {
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
    this.dataSyncMainPhaseComplete = false
    this.queueEntryCounter = 0
    this.queueRestartCounter = 0
    this.lastSeenAccountsMap = null

    this.appFinishedSyncing = false

    //BLOCK2
    /** @type {SyncTracker[]} */
    this.syncTrackers = []
    this.runtimeSyncTrackerSyncing = false

    this.acceptedTXQueue = []
    this.acceptedTXByHash = {}

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
    this.syncTrackerIndex = 1 // increments up for each new sync tracker we create gets maped to calls.
    this.preTXQueue = []
    this.readyforTXs = false

    this.sleepInterrupt = undefined
    this.lastCycleReported = -1
    this.partitionReportDirty = false
    this.nextCycleReportToSend = null

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

    this.stateIsGood = true
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

    this.globalAccountRepairBank = new Map()
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

    this.dataSourceNode = null
    this.dataSourceNodeList = []
    this.dataSourceNodeIndex = 0

    // debug hack
    if (p2p == null) {
      return
    }

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')

    // this._listeners = {}
    // this.completedPartitions = []
    // this.mainStartingTs = Date.now()
    // this.queueSitTime = 6000 // todo make this a setting. and tie in with the value in consensus
    // // this.syncSettleTime = 8000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later
    // this.syncSettleTime = this.queueSitTime + 2000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later
    // this.newAcceptedTxQueue = []
    // this.newAcceptedTxQueueTempInjest = []
    // /** @type {QueueEntry[]} */
    // this.archivedQueueEntries = []
    // /** @type {number} archivedQueueEntryMaxCount is a maximum amount of queue entries to store, usually we should never have this many stored since tx age will be used to clean up the list  */
    // this.archivedQueueEntryMaxCount = 50000
    // this.newAcceptedTxQueueRunning = false
    // this.dataSyncMainPhaseComplete = false
    // this.queueEntryCounter = 0
    // this.queueRestartCounter = 0
    // this.lastSeenAccountsMap = null

    this.clearPartitionData()
    // /** @type {SyncTracker[]} */
    // this.syncTrackers = []
    // this.runtimeSyncTrackerSyncing = false

    // this.acceptedTXQueue = []
    // this.acceptedTXByHash = {}
    this.registerEndpoints()

    this.isSyncingAcceptedTxs = true // default is true so we will start adding to our tx queue asap
    this.verboseLogs = false
    if (this.mainLogger && ['TRACE'].includes(this.mainLogger.level.levelStr)) {
      this.verboseLogs = true
    }
    // this.dataPhaseTag = 'DATASYNC: '
    // this.applySoftLock = false

    

    // this.useHashSets = true
    // this.lastActiveNodeCount = 0
    // this.queueStopped = false
    // this.extendedRepairLogging = true
    // this.shardInfo = {}
    // /** @type {Map<number, CycleShardData>} */
    // this.shardValuesByCycle = new Map()
    // this.currentCycleShardData = null as CycleShardData | null
    // this.syncTrackerIndex = 1 // increments up for each new sync tracker we create gets maped to calls.
    // this.preTXQueue = []
    // this.readyforTXs = false

    this.startShardCalculations()
    // this.sleepInterrupt = undefined
    // this.lastCycleReported = -1
    // this.partitionReportDirty = false
    // this.nextCycleReportToSend = null

    // this.canDataRepair = false
    // // this controls the repair portion of data repair.
    // if (this.config && this.config.debug) {
    //   this.canDataRepair = this.config.debug.canDataRepair
    //   if (this.canDataRepair == null) {
    //     this.canDataRepair = false
    //   }
    // }

    // this.stateIsGood = true
    // // the original way this was setup was to reset and apply repair results one partition at a time.
    // // this could create issue if we have a TX spanning multiple paritions that are locally owned.
    // this.resetAndApplyPerPartition = false
    // /** @type {RepairTracker[]} */
    // this.dataRepairStack = []
    // /** @type {number} */
    // this.dataRepairsCompleted = 0
    // /** @type {number} */
    // this.dataRepairsStarted = 0
    // this.repairAllStoredPartitions = true
    // this.repairStartedMap = new Map()
    // this.repairCompletedMap = new Map()
    // /** @type {Object.<string, PartitionReceipt[]>} a map of cycle keys to lists of partition receipts.  */
    // this.partitionReceiptsByCycleCounter = {}
    // /** @type {Object.<string, PartitionReceipt>} a map of cycle keys to lists of partition receipts.  */
    // this.ourPartitionReceiptsByCycleCounter = {}
    // this.doDataCleanup = true
    // this.sendArchiveData = false
    // this.purgeArchiveData = false
    // this.sentReceipts = new Map()

    this.logger.playbackLogNote('canDataRepair', `0`, `canDataRepair: ${this.canDataRepair}  `)

  }

  // this clears state data related to the current partion we are syncing.
  clearPartitionData () {
    // These are all for the given partition
    this.addressRange = null
    this.dataSourceNode = null
    this.dataSourceNodeList = []
    this.dataSourceNodeIndex = 0
    this.removedNodes = []

    // this.state = EnumSyncState.NotStarted
    this.allFailedHashes = []
    this.inMemoryStateTableData = [] as Shardus.StateTableObject[]

    this.combinedAccountData = []
    this.lastStateSyncEndtime = 0

    this.visitedNodes = {} // map of node we have visited

    this.accountsWithStateConflict = []
    this.failedAccounts = [] // todo m11: determine how/when we will pull something out of this list!
    this.mapAccountData = {}

    this.fifoLocks = {}
  }

  // ////////////////////////////////////////////////////////////////////
  //   SHARD CALCULATIONS
  // ////////////////////////////////////////////////////////////////////

  // This is called once per cycle to update to calculate the necessary shard values.
  updateShardValues (cycleNumber: number) {
    if (this.currentCycleShardData == null) {
      this.logger.playbackLogNote('shrd_sync_firstCycle', `${cycleNumber}`, ` first init `)
    }

    let cycleShardData = {} as CycleShardData

    // todo get current cycle..  store this by cycle?
    cycleShardData.nodeShardDataMap = new Map()
    cycleShardData.parititionShardDataMap = new Map()

    cycleShardData.activeNodes = this.p2p.state.getActiveNodes(null)
    // cycleShardData.activeNodes.sort(utils.sort_id_Asc) // function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })

    cycleShardData.cycleNumber = cycleNumber
    
    cycleShardData.partitionsToSkip = new Map()

    try {
      cycleShardData.ourNode = this.p2p.state.getNode(this.p2p.id) // ugh, I bet there is a nicer way to get our node
    } catch (ex) {
      this.logger.playbackLogNote('shrd_sync_notactive', `${cycleNumber}`, `  `)
      return
    }

    if (cycleShardData.activeNodes.length === 0) {
      return // no active nodes so stop calculating values
    }

    if(this.config == null || this.config.sharding == null){
      throw new Error("this.config.sharding == null")
    }

    let cycle = this.p2p.state.getLastCycle()
    if(cycle != null){
      cycleShardData.timestamp = cycle.start * 1000
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

        this.logger.playbackLogNote('shrd_sync_neighbors', `${cycleShardData.cycleNumber}`, ` neighbors: ${utils.stringifyReduce(cycleShardData.syncingNeighbors.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
      } else {
        cycleShardData.hasSyncingNeighbors = false
      }

      console.log(`updateShardValues  cycle:${cycleShardData.cycleNumber} `)


      // if (this.preTXQueue.length > 0) {
      //   for (let tx of this.preTXQueue) {
      //     this.logger.playbackLogNote('shrd_sync_preTX', ` `, ` ${utils.stringifyReduce(tx)} `)
      //     this.routeAndQueueAcceptedTransaction(tx, false, null)
      //   }
      //   this.preTXQueue = []
      // }

      if (this.syncTrackers != null) {
        for (let i = this.syncTrackers.length - 1; i >= 0; i--) {
          let syncTracker = this.syncTrackers[i]
          if (syncTracker.syncFinished === true) {
            this.logger.playbackLogNote('shrd_sync_trackerRangeClear', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)

            // allow syncing queue entries to resume!
            for (let queueEntry of syncTracker.queueEntries) {
              queueEntry.syncCounter--
              if (queueEntry.syncCounter <= 0) {
                queueEntry.state = 'aging'
                this.updateHomeInformation(queueEntry)
                this.logger.playbackLogNote('shrd_sync_wakeupTX', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID} ts: ${queueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(queueEntry.txKeys.allKeys)}`)
              }
            }
            syncTracker.queueEntries = []
            this.syncTrackers.splice(i, 1)
          }
        }
      }

      // this.calculateChangeInCoverage()
    }

    // calculate our consensus partitions for use by data repair:
    // cycleShardData.ourConsensusPartitions = []
    let partitions = ShardFunctions.getConsenusPartitionList(cycleShardData.shardGlobals, cycleShardData.nodeShardData)
    cycleShardData.ourConsensusPartitions = partitions

    let partitions2 = ShardFunctions.getStoredPartitionList(cycleShardData.shardGlobals, cycleShardData.nodeShardData)
    cycleShardData.ourStoredPartitions = partitions2

    // this will be a huge log.
    this.logger.playbackLogNote('shrd_sync_cycleData', `${cycleNumber}`, ` cycleShardData: cycle:${cycleNumber} data: ${utils.stringifyReduce(cycleShardData)}`)
  }

  /**
   * getShardDataForCycle
   * @param {number} cycleNumber
   * @returns {CycleShardData}
   */
  getShardDataForCycle (cycleNumber: number) : CycleShardData | null {
    if (this.shardValuesByCycle == null) {
      return null
    }
    let shardData = this.shardValuesByCycle.get(cycleNumber)
    //kind of silly but dealing with undefined response from get TSConversion: todo investigate merit of |null vs. |undefined conventions
    if(shardData != null){
      return shardData
    }
    return null
  }

  calculateChangeInCoverage (): void {
    // maybe this should be a shard function so we can run unit tests on it for expanding or shrinking networks!
    let newSharddata = this.currentCycleShardData

    if(newSharddata == null || this.currentCycleShardData == null){
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
      this.logger.playbackLogNote('shrd_sync_change', `${oldShardData.cycleNumber}->${newSharddata.cycleNumber}`, ` ${ShardFunctions.leadZeros8((change.start).toString(16))}->${ShardFunctions.leadZeros8((change.end).toString(16))} `)

      // create a range object from our coverage change.
 
      let range = { startAddr: 0, endAddr: 0, low: '', high: '' } as BasicAddressRange2 // this init is a somewhat wastefull way to allow the type to be happy.
      range.startAddr = change.start
      range.endAddr = change.end
      range.low = ShardFunctions.leadZeros8((range.startAddr).toString(16)) + '0'.repeat(56)
      range.high = ShardFunctions.leadZeros8((range.endAddr).toString(16)) + 'f'.repeat(56)
      // create sync trackers
      this.createSyncTrackerByRange(range, cycle)
    }

    if (coverageChanges.length > 0) {
      this.syncRuntimeTrackers()
    }
    // launch sync trackers
    // coverage changes... should have a list of changes
    // should note if the changes are an increase or reduction in covered area.
    // log the changes.
    // next would be to create some syncTrackers based to cover increases
  }

  async syncRuntimeTrackers (): Promise<void> {
    // await utils.sleep(8000) // sleep to make sure we are listening to some txs before we sync them // I think we can skip this.

    if (this.runtimeSyncTrackerSyncing === true) {
      return
    }

    try {
      this.runtimeSyncTrackerSyncing = true

      let startedCount = 0
      do {
        // async collection safety:
        //   we work on a copy of the list
        //   we start the loop over again if any work was done.  this allows us to pick up changes that got added in later
        startedCount = 0
        let arrayCopy = this.syncTrackers.slice(0)
        for (let syncTracker of arrayCopy) {
          if (syncTracker.syncStarted === false) {
            // let partition = syncTracker.partition
            console.log(`rtsyncTracker start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
            this.logger.playbackLogNote('rt_shrd_sync_trackerRangeStart', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)

            syncTracker.syncStarted = true
            startedCount++
            await this.syncStateDataForRange(syncTracker.range)
            syncTracker.syncFinished = true

            this.logger.playbackLogNote('rt_shrd_sync_trackerRangeEnd', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)
            this.clearPartitionData()
          }
        }
      } while (startedCount > 0)
    } catch (ex) {
      this.mainLogger.debug('syncRuntimeTrackers: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.fatalLogger.fatal('syncRuntimeTrackers: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    } finally {
      this.runtimeSyncTrackerSyncing = false
    }
  }

  getCurrentCycleShardData (): CycleShardData | null {
    if (this.currentCycleShardData === null) {
      let cycle = this.p2p.state.getLastCycle()
      if (cycle == null) {
        return null
      }
      this.updateShardValues(cycle.counter)
    }

    return this.currentCycleShardData
  }

  hasCycleShardData () {
    return this.currentCycleShardData != null
  }

  // todo refactor: this into a util, grabbed it from p2p
  // From: https://stackoverflow.com/a/12646864
  shuffleArray (array: any[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]]
    }
  }

  getRandomInt (max: number): number {
    return Math.floor(Math.random() * Math.floor(max))
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
  getRandomNodesInRange (count: number, lowAddress: string, highAddress: string, exclude: string[]): Shardus.Node[] {
    let allNodes = this.p2p.state.getActiveNodes(this.p2p.id)
    this.lastActiveNodeCount = allNodes.length
    this.shuffleArray(allNodes)
    let results = [] as Shardus.Node[]
    if (allNodes.length <= count) {
      count = allNodes.length
    }
    for (const node of allNodes) {
      if (node.id >= lowAddress && node.id <= highAddress) {
        if ((exclude.includes(node.id)) === false) {
          results.push(node)
          if (results.length >= count) {
            return results
          }
        }
      }
    }
    return results
  }

  // ////////////////////////////////////////////////////////////////////
  //   DATASYNC
  // ////////////////////////////////////////////////////////////////////

  // createSyncTracker (partition, cycle) {
  //   let range = {}
  //   let index = this.syncTrackerIndex++
  //   let syncTracker = { partition, range, queueEntries: [], cycle, index }
  //   syncTracker.syncStarted = false
  //   syncTracker.syncFinished = false

  //   this.syncTrackers.push(syncTracker) // we should maintain this order.

  //   return syncTracker
  // }

  /**
   * createSyncTrackerByRange
   * @param {BasicAddressRange2} range
   * @param {number} cycle
   * @return {SyncTracker}
   */
  createSyncTrackerByRange (range: BasicAddressRange2, cycle: number): SyncTracker {
    // let partition = -1
    let index = this.syncTrackerIndex++
    let syncTracker = { range, queueEntries: [], cycle, index, syncStarted: false, syncFinished: false, isGlobalSyncTracker:false, globalAddressMap:{} } as SyncTracker// partition,
    syncTracker.syncStarted = false
    syncTracker.syncFinished = false

    this.syncTrackers.push(syncTracker) // we should maintain this order.

    return syncTracker
  }

  createSyncTrackerByForGlobals ( cycle: number): SyncTracker {
    // let partition = -1
    let index = this.syncTrackerIndex++
    let syncTracker = { range:{}, queueEntries: [], cycle, index, syncStarted: false, syncFinished: false, isGlobalSyncTracker:true, globalAddressMap:{} } as SyncTracker// partition,
    syncTracker.syncStarted = false
    syncTracker.syncFinished = false

    this.syncTrackers.push(syncTracker) // we should maintain this order.

    return syncTracker
  }


  getSyncTracker (address: string): SyncTracker | null {
    // return the sync tracker.
    for (let i = 0; i < this.syncTrackers.length; i++) {
      let syncTracker = this.syncTrackers[i]

      // need to see if address is in range. if so return the tracker.
      // if (ShardFunctions.testAddressInRange(address, syncTracker.range)) {
      //if(syncTracker.isGlobalSyncTracker){
        if (syncTracker.range.low <= address && address <= syncTracker.range.high) {
          return syncTracker
        }
      //}else{
        if (syncTracker.isGlobalSyncTracker === true && syncTracker.globalAddressMap[address] === true) {
          return syncTracker
        }
      //}
    }
    return null
  }

  // Check the entire range for a partition to see if any of it is covered by a sync tracker. 
  getSyncTrackerForParition (partitionID: number, cycleShardData:CycleShardData ): SyncTracker | null {
    if(cycleShardData == null){
      return null
    }
    let partitionShardData:ShardInfo2 = cycleShardData.parititionShardDataMap.get(partitionID)

    let addressLow = partitionShardData.homeRange.low
    let addressHigh = partitionShardData.homeRange.high
    // return the sync tracker.
    for (let i = 0; i < this.syncTrackers.length; i++) {
      let syncTracker = this.syncTrackers[i]
      // if (syncTracker.isGlobalSyncTracker === true && syncTracker.globalAddressMap[address] === true) {
      //   return syncTracker
      // }
      // need to see if address is in range. if so return the tracker.
      if (syncTracker.range.low <= addressLow && addressHigh <= syncTracker.range.high) {
        return syncTracker
      }

    }
    return null
  }

  async waitForShardCalcs()
  {
    while (this.currentCycleShardData == null) {
      this.getCurrentCycleShardData()
      await utils.sleep(1000)
      this.logger.playbackLogNote('shrd_sync_waitForShardData_firstNode', ``, ` ${utils.stringifyReduce(this.currentCycleShardData)} `)
    }
  }

  /**
   * Skips app data sync and sets flags to enable external tx processing.
   * Called by snapshot module after data recovery is complete.
   */
  skipSync() {
    this.dataSyncMainPhaseComplete = true

    this.readyforTXs = true
    this.mainLogger.debug(`DATASYNC: isFirstSeed = true. skipping sync`)
    return
  }

  // syncs transactions and application state data
  // This is the main outer loop that will loop over the different partitions
  // The last step catch up on the acceptedTx queue
  async syncStateData (requiredNodeCount: number) {
    // Dont sync if first node
    if (this.p2p.isFirstSeed) {
      this.dataSyncMainPhaseComplete = true

      this.readyforTXs = true
      this.mainLogger.debug(`DATASYNC: isFirstSeed = true. skipping sync`)
      return
    }

    this.isSyncingAcceptedTxs = true

    await utils.sleep(5000) // Temporary delay to make it easier to attach a debugger
    console.log('syncStateData start')
    // delete and re-create some tables before we sync:
    await this.storage.clearAppRelatedState()
    await this.app.deleteLocalAccountData()

    this.mainLogger.debug(`DATASYNC: starting syncStateData`)

    this.requiredNodeCount = requiredNodeCount

    while (this.currentCycleShardData == null) {
      this.getCurrentCycleShardData()
      await utils.sleep(1000)
      this.logger.playbackLogNote('shrd_sync_waitForShardData', ` `, ` ${utils.stringifyReduce(this.currentCycleShardData)} `)
    }
    let nodeShardData = this.currentCycleShardData.nodeShardData
    console.log('GOT current cycle ' + '   time:' + utils.stringifyReduce(nodeShardData))

    let rangesToSync = [] as AddressRange2[]

    // get list of partitions to sync.  Strong typing helped figure out this block was dead code (had a serious bug)
    // let partitionsToSync = []
    // let num = nodeShardData.storedPartitions.partitionEnd1 - nodeShardData.storedPartitions.partitionStart1
    // for (let i = nodeShardData.storedPartitions.partitionStart1; i < num; i++) {
    //   partitionsToSync.push(i)
    // }
    // if (nodeShardData.storedPartitions.rangeIsSplit) {
    //   num = nodeShardData.storedPartitions.partitionEnd2 - nodeShardData.storedPartitions.partitionStart2
    //   for (let i = nodeShardData.storedPartitions.partitionStart2; i < num; i++) {
    //     partitionsToSync.push(i)
    //   }
    // }
    let cycle = this.currentCycleShardData.cycleNumber

    let homePartition = nodeShardData.homePartition

    console.log(`homePartition: ${homePartition} storedPartitions: ${utils.stringifyReduce(nodeShardData.storedPartitions)}`)
    // old tracker calculations.
    // if (nodeShardData.storedPartitions.partitionStart1 < homePartition && nodeShardData.storedPartitions.partitionEnd1 > homePartition) {
    //   // two ranges
    //   let range1 = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, nodeShardData.storedPartitions.partitionStart1, homePartition)
    //   let range2 = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, homePartition, nodeShardData.storedPartitions.partitionEnd1)

    //   // stich the addresses together
    //   let [centerAddr, centerAddrPlusOne] = ShardFunctions.findCenterAddressPair(range1.high, range2.low)
    //   range1.high = centerAddr
    //   range2.low = centerAddrPlusOne
    //   rangesToSync.push(range1)
    //   rangesToSync.push(range2)
    //   console.log(`range1:2  s:${nodeShardData.storedPartitions.partitionStart1} e:${nodeShardData.storedPartitions.partitionEnd1} h: ${homePartition} `)
    // } else {
    //   // one range
    //   rangesToSync.push(nodeShardData.storedPartitions.partitionRange)
    //   console.log(`range1:1  s:${nodeShardData.storedPartitions.partitionStart1} e:${nodeShardData.storedPartitions.partitionEnd1} h: ${homePartition} `)
    // }
    // if (nodeShardData.storedPartitions.rangeIsSplit) {
    //   if (nodeShardData.storedPartitions.partitionStart2 < homePartition && nodeShardData.storedPartitions.partitionEnd2 > homePartition) {
    //   // two ranges
    //     let range1 = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, nodeShardData.storedPartitions.partitionStart2, homePartition)
    //     let range2 = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, homePartition, nodeShardData.storedPartitions.partitionEnd2)
    //     // stich the addresses together
    //     let [centerAddr, centerAddrPlusOne] = ShardFunctions.findCenterAddressPair(range1.high, range2.low)
    //     range1.high = centerAddr
    //     range2.low = centerAddrPlusOne
    //     rangesToSync.push(range1)
    //     rangesToSync.push(range2)
    //     console.log(`range2:2  s:${nodeShardData.storedPartitions.partitionStart2} e:${nodeShardData.storedPartitions.partitionEnd2} h: ${homePartition} `)
    //   } else {
    //     // one range
    //     rangesToSync.push(nodeShardData.storedPartitions.partitionRange2)
    //     console.log(`range2:1  s:${nodeShardData.storedPartitions.partitionStart2} e:${nodeShardData.storedPartitions.partitionEnd2} h: ${homePartition} `)
    //   }
    // }

    let chunksGuide = 4
    let syncRangeGoal = Math.max(1, Math.min(chunksGuide, Math.floor(this.currentCycleShardData.shardGlobals.numPartitions / chunksGuide)))
    let partitionsCovered = 0
    let partitionsPerRange = 1

    if (nodeShardData.storedPartitions.rangeIsSplit === true) {
      partitionsCovered = nodeShardData.storedPartitions.partitionEnd1 - nodeShardData.storedPartitions.partitionStart1
      partitionsCovered += nodeShardData.storedPartitions.partitionEnd2 - nodeShardData.storedPartitions.partitionStart2
      partitionsPerRange = Math.max(Math.floor(partitionsCovered / syncRangeGoal), 1)
      console.log(`syncRangeGoal ${syncRangeGoal}  chunksGuide:${chunksGuide} numPartitions:${this.currentCycleShardData.shardGlobals.numPartitions} partitionsPerRange:${partitionsPerRange}`)

      let start = nodeShardData.storedPartitions.partitionStart1
      let end = nodeShardData.storedPartitions.partitionEnd1
      let currentStart = start
      let currentEnd = 0
      let nextLowAddress:string | null = null
      let i = 0
      while (currentEnd < end) {
        currentEnd = Math.min(currentStart + partitionsPerRange, end)
        let range = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, currentStart, currentEnd)

        let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
        range.high = address1

        if (nextLowAddress != null) {
          range.low = nextLowAddress
        }
        console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
        nextLowAddress = address2
        currentStart = currentEnd
        i++
        rangesToSync.push(range)
      }

      start = nodeShardData.storedPartitions.partitionStart2
      end = nodeShardData.storedPartitions.partitionEnd2
      currentStart = start
      currentEnd = 0
      nextLowAddress = null

      while (currentEnd < end) {
        currentEnd = Math.min(currentStart + partitionsPerRange, end)
        let range = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, currentStart, currentEnd)

        let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
        range.high = address1

        if (nextLowAddress != null) {
          range.low = nextLowAddress
        }
        console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition} a1: ${range.low} a2: ${range.high}`)

        nextLowAddress = address2
        currentStart = currentEnd
        i++
        rangesToSync.push(range)
      }
    } else {
      partitionsCovered = nodeShardData.storedPartitions.partitionEnd - nodeShardData.storedPartitions.partitionStart
      partitionsPerRange = Math.max(Math.floor(partitionsCovered / syncRangeGoal), 1)
      console.log(`syncRangeGoal ${syncRangeGoal}  chunksGuide:${chunksGuide} numPartitions:${this.currentCycleShardData.shardGlobals.numPartitions} partitionsPerRange:${partitionsPerRange}`)

      let start = nodeShardData.storedPartitions.partitionStart
      let end = nodeShardData.storedPartitions.partitionEnd

      let currentStart = start
      let currentEnd = 0
      let nextLowAddress: string|null = null
      let i = 0
      while (currentEnd < end) {
        currentEnd = Math.min(currentStart + partitionsPerRange, end)
        let range = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, currentStart, currentEnd)

        let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
        range.high = address1

        if (nextLowAddress != null) {
          range.low = nextLowAddress
        }
        console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
        nextLowAddress = address2
        currentStart = currentEnd
        i++
        rangesToSync.push(range)
      }
    }

    // if we don't have a range to sync yet manually sync the whole range.
    if (rangesToSync.length === 0) {
      console.log(`syncStateData ranges: pushing full range, no ranges found`)
      let range = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, 0, this.currentCycleShardData.shardGlobals.numPartitions - 1)
      rangesToSync.push(range)
    }
    console.log(`syncStateData ranges: ${utils.stringifyReduce(rangesToSync)}}`)

    for (let range of rangesToSync) {
      // let nodes = ShardFunctions.getNodesThatCoverRange(this.currentCycleShardData.shardGlobals, range.low, range.high, this.currentCycleShardData.ourNode, this.currentCycleShardData.activeNodes)
      this.createSyncTrackerByRange(range, cycle)
    }

    this.createSyncTrackerByForGlobals(cycle)

    // could potentially push this back a bit.
    this.readyforTXs = true

    await utils.sleep(8000) // sleep to make sure we are listening to some txs before we sync them

    //TODO how do we build a non range based sync tracker that instead has a list of accounts.
    //If we could do that then we can sync the globals.
    //That said we can't calculate what globals are needed so it may be better to just have new code that requests the list then syncs the accounts
    //It may not be possible to have state table data wrapping our global sync
    //if not need to figure out if that is safe.


    for (let syncTracker of this.syncTrackers) {
      // let partition = syncTracker.partition
      console.log(`syncTracker start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
      this.logger.playbackLogNote('shrd_sync_trackerRangeStart', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)

      syncTracker.syncStarted = true

      if(syncTracker.isGlobalSyncTracker === false){
        await this.syncStateDataForRange(syncTracker.range)
      } else {
        console.log(`syncTracker syncStateDataGlobals start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
        await this.syncStateDataGlobals(syncTracker)
      }
      syncTracker.syncFinished = true

      // allow syncing queue entries to resume!
      // for (let queueEntry of syncTracker.queueEntries) {
      //   queueEntry.syncCounter--
      //   if (queueEntry.syncCounter <= 0) {
      //     queueEntry.state = 'aging'
      //     this.logger.playbackLogNote('shrd_sync_wakeupTX', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}`)
      //   }
      // }
      // syncTracker.queueEntries = []

      this.logger.playbackLogNote('shrd_sync_trackerRangeEnd', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)
      this.clearPartitionData()
    }

    // this.syncTrackers = []  //dont clear this untill we get a new cycle!

    // this.logger.playbackLogNote('shrd_sync_queued_and_set_syncing', `${txQueueEntry.acceptedTx.id}`, ` qId: ${txQueueEntry.entryID}`)

    // one we have all of the initial data the last thing to do is get caught up on transactions
    // This will await the queue processing up to Date.now()

    console.log('syncStateData end' + '   time:' + Date.now())
  }

  async startCatchUpQueue () {
    await this._firstTimeQueueAwait()

    console.log('syncStateData startCatchUpQueue ' + '   time:' + Date.now())

    // all complete!
    this.mainLogger.debug(`DATASYNC: complete`)
    this.logger.playbackLogState('datasyncComplete', '', '')

    // update the debug tag and restart the queue
    this.dataPhaseTag = 'STATESYNC: '
    this.dataSyncMainPhaseComplete = true
    this.tryStartAcceptedQueue()

    this.logger.playbackLogNote('shrd_sync_mainphaseComplete', ` `, `  `)
  }

  /**
   * @param {SimpleRange} range
   */
  async syncStateDataForRange (range: SimpleRange) {
    try {
      let partition = 'notUsed'
      this.currentRange = range
      this.addressRange = range // this.partitionToAddressRange(partition)

      this.partitionStartTimeStamp = Date.now()

      let lowAddress = this.addressRange.low
      let highAddress = this.addressRange.high

      this.mainLogger.debug(`DATASYNC: syncStateDataForPartition partition: ${partition} low: ${lowAddress} high: ${highAddress} `)

      await this.syncStateTableData(lowAddress, highAddress, 0, Date.now() - this.syncSettleTime)
      this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncStateTableData 1st pass done.`)

      this.readyforTXs = true // open the floodgates of queuing stuffs.

      await this.syncAccountData(lowAddress, highAddress)
      this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncAccountData done.`)

      // potentially do the next 2 blocks periodically in the account data retreval so we can flush data to disk!  generalize the account state table update so it can be called 'n' times

      // Sync the Account State Table Second Pass
      //   Wait at least 10T since the Ts_end time of the First Pass
      //   Same as the procedure for First Pass except:
      //   Ts_start should be the Ts_end value from last time and Ts_end value should be current time minus 10T
      await this.syncStateTableData(lowAddress, highAddress, this.lastStateSyncEndtime, Date.now())
      this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncStateTableData 2nd pass done.`)

      // Process the Account data
      //   For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
      //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
      //   Use the App.set_account_data function with the Account data to save the data to the application Accounts Table; if any failed accounts are returned save the account id to be looked up later
      await this.processAccountData()
      this.mainLogger.debug(`DATASYNC: partition: ${partition}, processAccountData done.`)

      // Sync the failed accounts
      //   Log that some account failed
      //   Use the /get_account_data_by_list API to get the data for the accounts that need to be looked up later from any of the nodes that had a matching hash but different from previously used nodes
      //   Repeat the “Sync the Account State Table Second Pass” step
      //   Repeat the “Process the Account data” step
      await this.syncFailedAcccounts(lowAddress, highAddress)
    } catch (error) {
      if (error.message.includes('FailAndRestartPartition')) {
        this.mainLogger.debug(`DATASYNC: Error Failed at: ${error.stack}`)
        this.fatalLogger.fatal('DATASYNC: FailAndRestartPartition: ' + error.name + ': ' + error.message + ' at ' + error.stack)
        await this.failandRestart()
      } else {
        this.fatalLogger.fatal('syncStateDataForPartition failed: ' + error.name + ': ' + error.message + ' at ' + error.stack)
        this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + error.name + ': ' + error.message + ' at ' + error.stack)
        await this.failandRestart()
      }
    }
  }

  async syncStateDataGlobals (syncTracker: SyncTracker) {
    try {
      let partition = 'globals!'
      // this.currentRange = range
      // this.addressRange = range // this.partitionToAddressRange(partition)

      let globalAccounts = []
      let remainingAccountsToSync = []
      this.partitionStartTimeStamp = Date.now()

      // let lowAddress = this.addressRange.low
      // let highAddress = this.addressRange.high

      this.mainLogger.debug(`DATASYNC: syncStateDataGlobals partition: ${partition} `)


      this.readyforTXs = true // open the floodgates of queuing stuffs.

      //Get globals list and hash.

      let globalReport:GlobalAccountReportResp = await this.getRobustGlobalReport()
      
      let hasAllGlobalData = false

      if(globalReport.accounts.length === 0){
        this.mainLogger.debug(`DATASYNC:  syncStateDataGlobals no global accounts `)
        return  // no global accounts
      }
      this.mainLogger.debug(`DATASYNC:  syncStateDataGlobals globalReport: ${utils.stringifyReduce(globalReport)} `)

      let accountReportsByID:{[id:string]:{id:string, hash:string, timestamp:number }} = {}
      for(let report of globalReport.accounts){
        remainingAccountsToSync.push(report.id)

        accountReportsByID[report.id] = report
      }
      let accountData:Shardus.WrappedData[] = []
      let accountDataById:{[id:string]:Shardus.WrappedData} = {}
      let globalReport2:GlobalAccountReportResp = {combinedHash:"", accounts:[] }
      while(hasAllGlobalData === false){
        this.mainLogger.debug(`DATASYNC: syncStateDataGlobals hasAllGlobalData === false `)
        //Get accounts.
        //this.combinedAccountData = []
        
        let message = { accountIds: remainingAccountsToSync }
        let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message)
        if (result === false) { this.mainLogger.error('ASK FAIL syncStateDataGlobals 4') }
    
        if(result == null){
          if(this.tryNextDataSourceNode('syncStateDataGlobals') == false){
            break
          }
          continue
        }

        //{ accountData: Shardus.WrappedData[] | null }
        //this.combinedAccountData = this.combinedAccountData.concat(result.accountData)
        accountData = accountData.concat(result.accountData)

        //Get globals list and hash (if changes then update said accounts and repeath)
        //diff the list and update remainingAccountsToSync
        // add any new accounts to globalAccounts
        this.mainLogger.debug(`DATASYNC: syncStateDataGlobals get_account_data_by_list ${utils.stringifyReduce(result)} `)

        globalReport2 = await this.getRobustGlobalReport()
        let accountReportsByID2:{[id:string]:{id:string, hash:string, timestamp:number }} = {}
        for(let report of globalReport2.accounts){
          accountReportsByID2[report.id] = report
        }
        
        hasAllGlobalData = true
        remainingAccountsToSync = []
        for(let account of accountData){
          accountDataById[account.accountId] = account
          //newer copies will overwrite older ones in this map
        }
        //check the full report for any missing data
        for(let report of globalReport2.accounts){
          let data = accountDataById[report.id]
          if(data == null){
            //we dont have the data
            hasAllGlobalData = false
            remainingAccountsToSync.push(report.id)
            this.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data===null ${utils.makeShortHash(report.id)} `)
          } else if (data.stateId !== report.hash){
            //we have the data but he hash is wrong
            hasAllGlobalData = false
            remainingAccountsToSync.push(report.id)
            this.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data.stateId !== report.hash ${utils.makeShortHash(report.id)} `)
          }
        }
        //set this report to the last report and continue.
        accountReportsByID = accountReportsByID2
      }

      let dataToSet = []
      let cycleNumber = this.currentCycleShardData.cycleNumber // Math.max(1, this.currentCycleShardData.cycleNumber-1 ) //kinda hacky?

      let goodAccounts:Shardus.WrappedData[] = []

      //Write the data! and set global memory data!.  set accounts copy data too.
      for(let report of globalReport2.accounts){
        let accountData = accountDataById[report.id]
        if(accountData != null){

          dataToSet.push(accountData)
          goodAccounts.push(accountData)
          if(this.globalAccountMap.has(report.id)){
            this.mainLogger.debug(`DATASYNC: syncStateDataGlobals has ${utils.makeShortHash(report.id)} hash: ${utils.makeShortHash(report.hash)} ts: ${report.timestamp}`)
          } else {
            this.mainLogger.debug(`DATASYNC: syncStateDataGlobals setting ${utils.makeShortHash(report.id)} hash: ${utils.makeShortHash(report.hash)} ts: ${report.timestamp}`)
            // set the account in our table
            this.globalAccountMap.set(report.id, null)
            // push the time based backup count
            let accountId = report.id
            let data = accountData.data
            let timestamp = accountData.timestamp
            let hash = accountData.stateId
            let isGlobal = this.isGlobalAccount(accountId)
            let backupObj:Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }
            //if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `updateAccountsCopyTable acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)
            let globalBackupList:Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(accountId)
            if(globalBackupList != null){
              globalBackupList.push(backupObj) // sort and cleanup later.
              this.mainLogger.debug(`DATASYNC: syncStateDataGlobals push backup entry ${utils.makeShortHash(report.id)} hash: ${utils.makeShortHash(report.hash)} ts: ${report.timestamp}`)
            }
          } 
        }
      }
   
      let failedHashes = await this.checkAndSetAccountData(dataToSet)

      console.log('DBG goodAccounts', goodAccounts)
     
      await this.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

      if(failedHashes && failedHashes.length > 0){
        throw new Error("setting data falied no error handling for this yet")
      }
      this.mainLogger.debug(`DATASYNC: syncStateDataGlobals complete synced ${dataToSet.length} accounts `)
    } catch (error) {
      if (error.message.includes('FailAndRestartPartition')) {
        this.mainLogger.debug(`DATASYNC: syncStateDataGlobals Error Failed at: ${error.stack}`)
        this.fatalLogger.fatal('DATASYNC: syncStateDataGlobals FailAndRestartPartition: ' + error.name + ': ' + error.message + ' at ' + error.stack)
        await this.failandRestart()
      } else {
        this.fatalLogger.fatal('syncStateDataGlobals failed: ' + error.name + ': ' + error.message + ' at ' + error.stack)
        this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + error.name + ': ' + error.message + ' at ' + error.stack)
        await this.failandRestart()
      }
    }
  }

  async getRobustGlobalReport(): Promise<GlobalAccountReportResp> {

      // this.p2p.registerInternal('get_globalaccountreport', async (payload:any, respond: (arg0: GlobalAccountReportResp) => any) => {
      //   let result = {combinedHash:"", accounts:[]} as GlobalAccountReportResp

    let equalFn = (a:GlobalAccountReportResp, b:GlobalAccountReportResp) => {
      return a.combinedHash === b.combinedHash
    }
    let queryFn = async (node: Shardus.Node) => {
      let result = await this.p2p.ask(node, 'get_globalaccountreport', {})
      if (result === false) { this.mainLogger.error('ASK FAIL getRobustGlobalReport 1') }
      if (result === null) { this.mainLogger.error('ASK FAIL getRobustGlobalReport 1b') }
      return result
    }
    //can ask any active nodes for global data.
    let nodes:Shardus.Node[] = this.currentCycleShardData.activeNodes
    // let nodes = this.getActiveNodesInRange(lowAddress, highAddress) // this.p2p.state.getActiveNodes(this.p2p.id)
    if (nodes.length === 0) {
      this.mainLogger.debug(`no nodes available`)
      return // nothing to do
    }
    this.mainLogger.debug(`DATASYNC: robustQuery getRobustGlobalReport ${utils.stringifyReduce(nodes.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
    let result
    let winners
    try {
      [result, winners] = await this.p2p.robustQuery(nodes, queryFn, equalFn, 3, false)

      if(result.ready === false){
        this.mainLogger.debug(`DATASYNC: getRobustGlobalReport results not ready wait 10 seconds and try again `)
        console.log(`DATASYNC: getRobustGlobalReport results not ready wait 10 seconds and try again `)
        await utils.sleep(10*1000) //wait 10 seconds and try again.
        return await this.getRobustGlobalReport()
      }
    } catch (ex) {
      this.mainLogger.debug('getRobustGlobalReport: robustQuery ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.fatalLogger.fatal('getRobustGlobalReport: robustQuery ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      throw new Error('FailAndRestartPartition0')
    }
    if (!winners || winners.length === 0) {
      this.mainLogger.debug(`DATASYNC: getRobustGlobalReport no winners, going to throw fail and restart`)
      this.fatalLogger.fatal(`DATASYNC: getRobustGlobalReport no winners, going to throw fail and restart`) // todo: consider if this is just an error
      throw new Error('FailAndRestartPartition1')
    }
    this.mainLogger.debug(`DATASYNC: getRobustGlobalReport found a winner.  results: ${utils.stringifyReduce(result)}`)
    this.dataSourceNodeIndex = 0
    this.dataSourceNode = winners[this.dataSourceNodeIndex] // Todo random index
    this.dataSourceNodeList = winners
    return result as GlobalAccountReportResp
  }


  async syncStateTableData (lowAddress: string, highAddress: string, startTime: number, endTime: number) {
    let searchingForGoodData = true

    if(this.currentCycleShardData == null){
      return
    }

    console.log(`syncStateTableData startTime: ${startTime} endTime: ${endTime}` + '   time:' + Date.now())
    this.mainLogger.debug(`DATASYNC: syncStateTableData startTime: ${startTime} endTime: ${endTime} low: ${lowAddress} high: ${highAddress} `)
    // todo m11: this loop will try three more random nodes, this is slightly different than described how to handle failure in the doc. this should be corrected but will take more code
    // should prossible break this into a state machine in  its own class.
    while (searchingForGoodData) { // todo m11: this needs to be replaced
      // Sync the Account State Table First Pass
      //   Use the /get_account_state_hash API to get the hash from 3 or more nodes until there is a match between 3 nodes. Ts_start should be 0, or beginning of time.  The Ts_end value should be current time minus 10T (as configured)
      //   Use the /get_account_state API to get the data from one of the 3 nodes
      //   Take the hash of the data to ensure that it matches the expected hash value
      //   If not try getting the data from another node
      //   If the hash matches then update our Account State Table with the data
      //   Repeat this for each address range or partition
      let currentTs = Date.now()

      let safeTime = currentTs - this.syncSettleTime
      if (endTime >= safeTime) {
        // need to idle for bit
        await utils.sleep(endTime - safeTime)
      }
      this.lastStateSyncEndtime = endTime + 1 // Adding +1 so that the next query will not overlap the time bounds. this saves us from a bunch of data tracking and filtering to remove duplicates when this function is called later

      let firstHash
      let queryLow
      let queryHigh

      queryLow = lowAddress
      queryHigh = highAddress
      let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, tsEnd: endTime }

      let equalFn = (a:AccountStateHashResp, b:AccountStateHashResp) => {
        return a.stateHash === b.stateHash
      }
      let queryFn = async (node: Shardus.Node) => {
        let result = await this.p2p.ask(node, 'get_account_state_hash', message)
        if (result === false) { this.mainLogger.error('ASK FAIL syncStateTableData 1') }
        return result
      }

      let centerNode = ShardFunctions.getCenterHomeNode(this.currentCycleShardData.shardGlobals, this.currentCycleShardData.parititionShardDataMap, lowAddress, highAddress)
      if(centerNode == null){
        this.mainLogger.debug(`centerNode not found`)
        return
      }
      
      let nodes:Shardus.Node[] = ShardFunctions.getNodesByProximity(this.currentCycleShardData.shardGlobals, this.currentCycleShardData.activeNodes, centerNode.ourNodeIndex, this.p2p.id, 40)

      // let nodes = this.getActiveNodesInRange(lowAddress, highAddress) // this.p2p.state.getActiveNodes(this.p2p.id)
      if (nodes.length === 0) {
        this.mainLogger.debug(`no nodes available`)
        return // nothing to do
      }
      this.mainLogger.debug(`DATASYNC: robustQuery get_account_state_hash from ${utils.stringifyReduce(nodes.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
      let result
      let winners
      try {
        [result, winners] = await this.p2p.robustQuery(nodes, queryFn, equalFn, 3, false)
      } catch (ex) {
        this.mainLogger.debug('syncStateTableData: robustQuery ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
        this.fatalLogger.fatal('syncStateTableData: robustQuery ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
        throw new Error('FailAndRestartPartition0')
      }

      if (result && result.stateHash) {
        this.mainLogger.debug(`DATASYNC: robustQuery returned result: ${result.stateHash}`)
        if (!winners || winners.length === 0) {
          this.mainLogger.debug(`DATASYNC: no winners, going to throw fail and restart`)
          this.fatalLogger.fatal(`DATASYNC: no winners, going to throw fail and restart`) // todo: consider if this is just an error
          throw new Error('FailAndRestartPartition1')
        }
        this.dataSourceNode = winners[0] // Todo random index
        this.mainLogger.debug(`DATASYNC: got hash ${result.stateHash} from ${utils.stringifyReduce(winners.map( (node:Shardus.Node ) => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
        firstHash = result.stateHash
      } else {
        this.mainLogger.debug(`DATASYNC: robustQuery get_account_state_hash failed`)
        throw new Error('FailAndRestartPartition2')
      }

      let moreDataRemaining = true
      this.combinedAccountStateData = []
      let loopCount = 0

      let lowTimeQuery = startTime
      this.mainLogger.debug(`DATASYNC: hash: getting state table data from: ${utils.makeShortHash(this.dataSourceNode.id) + ':' + this.dataSourceNode.externalPort}`)

      // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
      while (moreDataRemaining) {
        let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: lowTimeQuery, tsEnd: endTime }
        let result = await this.p2p.ask(this.dataSourceNode, 'get_account_state', message)
        if (result === false) { this.mainLogger.error('ASK FAIL syncStateTableData 2') }

        if(result == null){
          if(this.tryNextDataSourceNode('syncStateDataGlobals') == false){
            break
          }
          continue
        }

        let accountStateData = result.accountStates
        // get the timestamp of the last account state received so we can use it as the low timestamp for our next query
        if (accountStateData.length > 0) {
          let lastAccount = accountStateData[accountStateData.length - 1]
          if (lastAccount.txTimestamp > lowTimeQuery) {
            lowTimeQuery = lastAccount.txTimestamp
          }
        }

        // If this is a repeated query, clear out any dupes from the new list we just got.
        // There could be many rows that use the stame timestamp so we will search and remove them
        let dataDuplicated = true
        if (loopCount > 0) {
          while (accountStateData.length > 0 && dataDuplicated) {
            let stateData = accountStateData[0]
            dataDuplicated = false
            for (let i = this.combinedAccountStateData.length - 1; i >= 0; i--) {
              let existingStateData = this.combinedAccountStateData[i]
              if ((existingStateData.txTimestamp === stateData.txTimestamp) && (existingStateData.accountId === stateData.accountId)) {
                dataDuplicated = true
                break
              }
              // once we get to an older timestamp we can stop looking, the outer loop will be done also
              if (existingStateData.txTimestamp < stateData.txTimestamp) {
                break
              }
            }
            if (dataDuplicated) {
              accountStateData.shift()
            }
          }
        }

        if (accountStateData.length === 0) {
          moreDataRemaining = false
        } else {
          this.mainLogger.debug(`DATASYNC: syncStateTableData got ${accountStateData.length} more records from ${utils.makeShortHash(this.dataSourceNode.id) + ':' + this.dataSourceNode.externalPort}`)
          this.combinedAccountStateData = this.combinedAccountStateData.concat(accountStateData)
          loopCount++
        }
      }

      let recievedStateDataHash = this.crypto.hash(this.combinedAccountStateData)

      if (recievedStateDataHash === firstHash) {
        searchingForGoodData = false
      } else {
        this.mainLogger.debug(`DATASYNC: syncStateTableData finished downloading the requested data but the hash does not match`)
        // Failed again back through loop! TODO ? record/eval/report blame?
        this.recordPotentialBadnode()
        throw new Error('FailAndRestartPartition')
      }

      this.mainLogger.debug(`DATASYNC: syncStateTableData saving ${this.combinedAccountStateData.length} records to db`)
      // If the hash matches then update our Account State Table with the data
      await this.storage.addAccountStates(this.combinedAccountStateData) // keep in memory copy for faster processing...
      this.inMemoryStateTableData = this.inMemoryStateTableData.concat(this.combinedAccountStateData)
    }
  }

  tryNextDataSourceNode(debugString) : boolean {
    this.dataSourceNodeIndex++
    this.mainLogger.error(`tryNextDataSourceNode ${debugString} try next node: ${this.dataSourceNodeIndex}`)
    if(this.dataSourceNodeIndex >= this.dataSourceNodeList.length){
      this.mainLogger.error(`tryNextDataSourceNode ${debugString} ran out of nodes ask for data`)
      this.dataSourceNodeIndex = 0
      return false
    }
    // pick new data source node
    this.dataSourceNode = this.dataSourceNodeList[this.dataSourceNodeIndex]
    return true
  }

  async syncAccountData (lowAddress:string, highAddress:string) {
    // Sync the Account data
    //   Use the /get_account_data API to get the data from the Account Table using any of the nodes that had a matching hash
    console.log(`syncAccountData3` + '   time:' + Date.now())

    if(this.config.stateManager == null){
      throw new Error("this.config.stateManager == null")
    }


    let queryLow = lowAddress
    let queryHigh = highAddress

    let moreDataRemaining = true

    this.combinedAccountData = []
    let loopCount = 0

    let startTime = 0
    let lowTimeQuery = startTime
    // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
    while (moreDataRemaining) {
      // max records artificially low to make testing coverage better.  todo refactor: make it a config or calculate based on data size
      let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, maxRecords: this.config.stateManager.accountBucketSize }
      let r:GetAccountData3Resp | boolean = await this.p2p.ask(this.dataSourceNode, 'get_account_data3', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory
      if (r === false) { this.mainLogger.error('ASK FAIL syncAccountData 3') }
      // TSConversion need to consider better error handling here!
      let result:GetAccountData3Resp = r as GetAccountData3Resp

      if(result == null){
        if(this.tryNextDataSourceNode('syncAccountData') == false){
          break
        }
        continue
      }
      // accountData is in the form [{accountId, stateId, data}] for n accounts.
      let accountData = result.data.wrappedAccounts

      let lastUpdateNeeded = result.data.lastUpdateNeeded

      // get the timestamp of the last account data received so we can use it as the low timestamp for our next query
      if (accountData.length > 0) {
        let lastAccount = accountData[accountData.length - 1]
        if (lastAccount.timestamp > lowTimeQuery) {
          lowTimeQuery = lastAccount.timestamp
          startTime = lowTimeQuery
        }
      }

      // If this is a repeated query, clear out any dupes from the new list we just got.
      // There could be many rows that use the stame timestamp so we will search and remove them
      let dataDuplicated = true
      if (loopCount > 0) {
        while (accountData.length > 0 && dataDuplicated) {
          let stateData = accountData[0]
          dataDuplicated = false
          for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
            let existingStateData = this.combinedAccountData[i]
            if ((existingStateData.timestamp === stateData.timestamp) && (existingStateData.accountId === stateData.accountId)) {
              dataDuplicated = true
              break
            }
            // once we get to an older timestamp we can stop looking, the outer loop will be done also
            if (existingStateData.timestamp < stateData.timestamp) {
              break
            }
          }
          if (dataDuplicated) {
            accountData.shift()
          }
        }
      }

      // if we have any accounts in wrappedAccounts2
      let accountData2 = result.data.wrappedAccounts2
      if (accountData2.length > 0) {
        while (accountData.length > 0 && dataDuplicated) {
          let stateData = accountData2[0]
          dataDuplicated = false
          for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
            let existingStateData = this.combinedAccountData[i]
            if ((existingStateData.timestamp === stateData.timestamp) && (existingStateData.accountId === stateData.accountId)) {
              dataDuplicated = true
              break
            }
            // once we get to an older timestamp we can stop looking, the outer loop will be done also
            if (existingStateData.timestamp < stateData.timestamp) {
              break
            }
          }
          if (dataDuplicated) {
            accountData2.shift()
          }
        }
      }

      if (lastUpdateNeeded || (accountData2.length === 0 && accountData.length === 0)) {
        moreDataRemaining = false
        this.mainLogger.debug(`DATASYNC: syncAccountData3 got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lowTimeQuery} highestTS1: ${result.data.highestTs}`)
        if (accountData.length > 0) {
          this.combinedAccountData = this.combinedAccountData.concat(accountData)
        }
        if (accountData2.length > 0) {
          this.combinedAccountData = this.combinedAccountData.concat(accountData2)
        }
      } else {
        this.mainLogger.debug(`DATASYNC: syncAccountData3b got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lowTimeQuery} highestTS1: ${result.data.highestTs}`)
        this.combinedAccountData = this.combinedAccountData.concat(accountData)
        loopCount++
        // await utils.sleep(500)
      }
      await utils.sleep(200)
    }
  }

  // this.p2p.registerInternal('get_account_data2', async (payload, respond) => {

  async failandRestart () {
    this.mainLogger.debug(`DATASYNC: failandRestart`)
    this.logger.playbackLogState('datasyncFail', '', '')
    this.clearPartitionData()

    // using set timeout before we resume to prevent infinite stack depth.
    // setTimeout(async () => {
    //   await this.syncStateDataForPartition(this.currentPartition)
    // }, 1000)
    await utils.sleep(1000)
    await this.syncStateDataForRange(this.currentRange)
  }

  failAndDontRestartSync () {
    this.mainLogger.debug(`DATASYNC: failAndDontRestartSync`)
    // need to clear more?
    this.clearPartitionData()
    this.syncTrackers = []
  }

  // just a placeholder for later
  recordPotentialBadnode () {
    // The may need to live on the p2p class, or call into it
    // record the evidence.
    // potentially report it
  }

  // Process the Account data
  //   For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
  //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
  //   Use the App.set_account_data function with the Account data to save the data to the application Accounts Table; if any failed accounts are returned save the account id to be looked up later

  // State data = {accountId, txId, txTimestamp, stateBefore, stateAfter}
  // accountData is in the form [{accountId, stateId, data}] for n accounts.
  async processAccountData () {
    this.missingAccountData = []
    this.mapAccountData = {}
    // create a fast lookup map for the accounts we have.  Perf.  will need to review if this fits into memory.  May need a novel structure.
    let account
    for (let i = 0; i < this.combinedAccountData.length; i++) {
      account = this.combinedAccountData[i]
      this.mapAccountData[account.accountId] = account
    }

    let accountKeys = Object.keys(this.mapAccountData)
    let uniqueAccounts = accountKeys.length
    let initialCombinedAccountLength = this.combinedAccountData.length
    if (uniqueAccounts < initialCombinedAccountLength) {
      // keep only the newest copies of each account:
      // we need this if using a time based datasync
      this.combinedAccountData = []
      for (let accountID of accountKeys) {
        this.combinedAccountData.push(this.mapAccountData[accountID])
      }
    }

    let missingButOkAccounts = 0
    let missingTXs = 0
    let handledButOk = 0
    let otherMissingCase = 0
    let missingButOkAccountIDs:{[id:string]: boolean} = {}

    let missingAccountIDs:{[id:string]: boolean} = {}

    this.mainLogger.debug(`DATASYNC: processAccountData stateTableCount: ${this.inMemoryStateTableData.length} unique accounts: ${uniqueAccounts}  initial combined len: ${initialCombinedAccountLength}`)
    // For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
    
    for (let stateData of this.inMemoryStateTableData) {
      account = this.mapAccountData[stateData.accountId]
      // does the state data table have a node and we don't have data for it?
      if (account == null) {
        // make sure we have a transaction that matches this in our queue
        // the state table data we are working with is sufficiently old, so that we should have seen a transaction in our queue by the time we could get here
        let txRef = this.acceptedTXByHash[stateData.txId]
        if (txRef == null) {
          missingTXs++
          if (stateData.accountId != null) {
            this.missingAccountData.push(stateData.accountId)
            missingAccountIDs[stateData.accountId] = true
          }
        } else if (stateData.stateBefore === allZeroes64) {
          // this means we are at the start of a valid state table chain that starts with creating an account
          missingButOkAccountIDs[stateData.accountId] = true
          missingButOkAccounts++
        } else if (missingButOkAccountIDs[stateData.accountId] === true) {
          // no action. we dont have account, but we know a different transaction will create it.
          handledButOk++
        } else {
          // unhandled case. not expected.  this would happen if the state table chain does not start with this account being created
          // this could be caused by a node trying to withold account data when syncing
          if (stateData.accountId != null) {
            this.missingAccountData.push(stateData.accountId)
            missingAccountIDs[stateData.accountId] = true
          }
          otherMissingCase++
        }
        // should we check timestamp for the state table data?
        continue
      }

      if (!account.syncData) {
        account.syncData = { timestamp: 0 }
      }

      if (account.stateId === stateData.stateAfter) {
        // mark it good.
        account.syncData.uptodate = true
        account.syncData.anyMatch = true
        if (stateData.txTimestamp > account.syncData.timestamp) {
          account.syncData.missingTX = false // finding a good match can clear the old error. this relys on things being in order!
          account.syncData.timestamp = stateData.txTimestamp
        }
      } else {
        // this state table data does not match up with what we have for the account
        if (stateData.txTimestamp > account.syncData.timestamp) {
          account.syncData.uptodate = false
          // account.syncData.stateData = stateData
          // chceck if we are missing a tx to handle this.
          let txRef = this.acceptedTXByHash[stateData.txId]
          if (txRef == null) {
            // account.syncData.missingTX = true
            // if (stateData.txTimestamp > account.syncData.timestamp) {
            account.syncData.missingTX = true
            // account.syncData.timestamp = stateData.txTimestamp
            // }
            // should we try to un foul the missingTX flag here??
          }

          account.syncData.timestamp = stateData.txTimestamp
        }
      }
    }

    if (missingButOkAccounts > 0) {
      // it is valid / normal flow to get to this point:
      this.mainLogger.debug(`DATASYNC: processAccountData accouts missing from accountData, but are ok, because we have transactions for them: missingButOKList: ${missingButOkAccounts}, handledbutOK: ${handledButOk}`)
    }
    if (this.missingAccountData.length > 0) {
      // getting this indicates a non-typical problem that needs correcting
      this.mainLogger.debug(`DATASYNC: processAccountData accounts missing from accountData, but in the state table.  This is an unexpected error and we will need to handle them as failed accounts: missingList: ${this.missingAccountData.length}, missingTX count: ${missingTXs} missingUnique: ${Object.keys(missingAccountIDs).length}`)
    }

    //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
    this.accountsWithStateConflict = []
    let goodAccounts:Shardus.WrappedData[] = []
    let noSyncData = 0
    let noMatches = 0
    let outOfDateNoTxs = 0
    for (let account of this.combinedAccountData) {
      if (!account.syncData) {
        // this account was not found in state data
        this.accountsWithStateConflict.push(account)
        noSyncData++
      } else if (!account.syncData.anyMatch) {
        // this account was in state data but none of the state table stateAfter matched our state
        this.accountsWithStateConflict.push(account)
        noMatches++
      } else if (account.syncData.missingTX) {
        //
        this.accountsWithStateConflict.push(account)
        outOfDateNoTxs++
      } else {
        // could be good but need to check if we got stamped with some older datas.
        // if (account.syncData.uptodate === false) {
        //   // check for a missing transaction.
        //   // need to check above so that a right cant clear a wrong.
        //   let txRef = this.acceptedTXByHash[account.syncData.stateData.txId]
        //   if (txRef == null) {
        //     this.mainLogger.debug(`DATASYNC: processAccountData account not up to date ${utils.stringifyReduce(account)}`)
        //     this.accountsWithStateConflict.push(account)
        //     outOfDateNoTxs++
        //     continue
        //   }
        // }
        delete account.syncData
        goodAccounts.push(account)
      }
    }

    this.mainLogger.debug(`DATASYNC: processAccountData saving ${goodAccounts.length} of ${this.combinedAccountData.length} records to db.  noSyncData: ${noSyncData} noMatches: ${noMatches} missingTXs: ${missingTXs} handledButOk: ${handledButOk} otherMissingCase: ${otherMissingCase} outOfDateNoTxs: ${outOfDateNoTxs}`)
    // failedHashes is a list of accounts that failed to match the hash reported by the server
    let failedHashes = await this.checkAndSetAccountData(goodAccounts) // repeatable form may need to call this in batches

    if (failedHashes.length > 1000) {
      this.mainLogger.debug(`DATASYNC: processAccountData failed hashes over 1000:  ${failedHashes.length} restarting sync process`)
      // state -> try another node. TODO record/eval/report blame?
      this.recordPotentialBadnode()
      throw new Error('FailAndRestartPartition')
    }
    if (failedHashes.length > 0) {
      this.mainLogger.debug(`DATASYNC: processAccountData failed hashes:  ${failedHashes.length} will have to download them again`)
      // TODO ? record/eval/report blame?
      this.recordPotentialBadnode()
      this.failedAccounts = this.failedAccounts.concat(failedHashes)
      for (let accountId of failedHashes) {
        account = this.mapAccountData[accountId]

        if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: processAccountData ${accountId}  data: ${utils.stringifyReduce(account)}`)

        if (account != null) {
          if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: processAccountData adding account to list`)
          this.accountsWithStateConflict.push(account)
        } else {
          if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: processAccountData cant find data: ${accountId}`)
          if (accountId) {
            this.accountsWithStateConflict.push({ address: accountId })
          }
        }
      }
    }

    await this.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

    this.combinedAccountData = [] // we can clear this now.
  }

  /**
   * writeCombinedAccountDataToBackups
   * @param failedHashes This is a list of hashes that failed and should be ignored in the write operation.
   */
  async writeCombinedAccountDataToBackups (goodAccounts:Shardus.WrappedData[] , failedHashes: string[]) {  // ?:{[id:string]: boolean}
    if (failedHashes.length === 0 && goodAccounts.length === 0) {
      return // nothing to do yet
    }

    let failedAccountsById:{[id:string]: boolean} = {}
    for (let hash of failedHashes) {
      failedAccountsById[hash] = true
    }

    const lastCycle = this.p2p.state.getLastCycle()
    let cycleNumber = lastCycle.counter
    let accountCopies:AccountCopy[] = []
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
      isGlobal: isGlobal || false
    }
    accountCopies.push(accountCopy)
    }
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'writeCombinedAccountDataToBackups ' + accountCopies.length + ' ' + utils.stringifyReduce(accountCopies))

    if (this.verboseLogs) console.log('DBG accountCopies.  (in main log)')

    // await this.storage.createAccountCopies(accountCopies)
    await this.storage.createOrReplaceAccountCopy(accountCopies)
  }

  // Sync the failed accounts
  //   Log that some account failed
  //   Use the /get_account_data_by_list API to get the data for the accounts that need to be looked up later from any of the nodes that had a matching hash but different from previously used nodes
  //   Repeat the “Sync the Account State Table Second Pass” step
  //   Repeat the “Process the Account data” step
  async syncFailedAcccounts (lowAddress:string, highAddress:string) {
    if (this.accountsWithStateConflict.length === 0 && this.missingAccountData.length === 0) {
      this.mainLogger.debug(`DATASYNC: syncFailedAcccounts no failed hashes to sync`)
      return
    }
    if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts start`)
    let addressList:string[] = []
    for (let accountEntry of this.accountsWithStateConflict) {
      if (accountEntry.data && accountEntry.data.address) {
        addressList.push(accountEntry.data.address)
      } else {
        if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts failed to add account ${accountEntry}`)
      }
    }
    // add the addresses of accounts that we got state table data for but not data for
    addressList = addressList.concat(this.missingAccountData)
    this.missingAccountData = []

    // TODO m11:  should we pick different nodes to ask? (at the very least need to change the data source node!!!!!!)
    this.mainLogger.debug(`DATASYNC: syncFailedAcccounts requesting data for failed hashes ${utils.stringifyReduce(addressList)}`)

    let message = { accountIds: addressList }
    let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message)
    if (result === false) { this.mainLogger.error('ASK FAIL syncFailedAcccounts 4') }

    if(result == null){
      if(this.tryNextDataSourceNode('syncStateDataGlobals') == false){
        return
      }
      //we picked a new node to ask so relaunch
      await this.syncFailedAcccounts (lowAddress, highAddress)
    }

    this.combinedAccountData = this.combinedAccountData.concat(result.accountData)

    this.mainLogger.debug(`DATASYNC: syncFailedAcccounts combinedAccountData: ${this.combinedAccountData.length} accountData: ${result.accountData.length}`)

    await this.syncStateTableData(lowAddress, highAddress, this.lastStateSyncEndtime, Date.now())

    // process the new accounts.
    await this.processAccountData()
  }

  // This will make calls to app.getAccountDataByRange but if we are close enough to real time it will query any newer data and return lastUpdateNeeded = true
  async getAccountDataByRangeSmart (accountStart:string, accountEnd:string, tsStart:number, maxRecords:number): Promise<GetAccountDataByRangeSmart> {
    let tsEnd = Date.now()
    let wrappedAccounts = await this.app.getAccountDataByRange(accountStart, accountEnd, tsStart, tsEnd, maxRecords)
    let lastUpdateNeeded = false
    let wrappedAccounts2:WrappedStateArray = []
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

  testAccountDataWrapped(accountDataList:Shardus.WrappedData[]){
    if(accountDataList == null){
      return;      
    }
    for (let wrappedData of accountDataList) {
      let { accountId, stateId, data: recordData } = wrappedData
      //stateId = wrappedData.stateId
      if(stateId != wrappedData.stateId){
        this.mainLogger.error(`testAccountDataWrapped what is going on!!:  ${utils.makeShortHash(wrappedData.stateId)}  stateId: ${utils.makeShortHash(stateId)} ` )
      }
      let hash = this.app.calculateAccountHash(recordData)
      if (stateId !== hash) {
        this.mainLogger.error(`testAccountDataWrapped hash test failed: setAccountData for account ${utils.makeShortHash(accountId)} expected account hash: ${utils.makeShortHash(stateId)} got ${utils.makeShortHash(hash)} `)
        this.mainLogger.error('testAccountDataWrapped hash test failed: details: ' + stringify(recordData))
        this.mainLogger.error('testAccountDataWrapped hash test failed: wrappedData.stateId: ' + utils.makeShortHash(wrappedData.stateId) )
        var stack = new Error().stack
        this.mainLogger.error(`stack: ${stack}`)
      } 
    }
  }


  // TSConversion TODO need to fix some any types
  async checkAndSetAccountData (accountRecords: Shardus.WrappedData[]): Promise<string[]> {
    let accountsToAdd:any[] = []
    let failedHashes:string[] = []
    for (let { accountId, stateId, data: recordData } of accountRecords) {
      let hash = this.app.calculateAccountHash(recordData)
      if (stateId === hash) {
        // if (recordData.owners) recordData.owners = JSON.parse(recordData.owners)
        // if (recordData.data) recordData.data = JSON.parse(recordData.data)
        // if (recordData.txs) recordData.txs = JSON.parse(recordData.txs) // dont parse this, since it is already the string form we need to write it.
        accountsToAdd.push(recordData)
        this.mainLogger.debug('setAccountData: ' + hash + ' txs: ' + recordData.txs)
        if (this.verboseLogs) console.log('setAccountData: ' + utils.makeShortHash(hash) + ' txs: ' + utils.makeShortHash(accountId))
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

  // ////////////////////////////////////////////////////////////////////
  //   ENDPOINTS
  // ////////////////////////////////////////////////////////////////////

  registerEndpoints () {
    // alternatively we would need to query for accepted tx.

    // This endpoint will likely be a one off thing so that we can test before milesone 15.  after milesone 15 the accepted TX may flow from the consensus coordinator

    // After joining the network
    //   Record Joined timestamp
    //   Even a syncing node will receive accepted transactions
    //   Starts receiving accepted transaction and saving them to Accepted Tx Table
    this.p2p.registerGossipHandler('acceptedTx', async (acceptedTX:AcceptedTx, sender:Shardus.Node, tracker:string) => {
      // docs mention putting this in a table but it seems so far that an in memory queue should be ok
      // should we filter, or instead rely on gossip in to only give us TXs that matter to us?

      this.p2p.sendGossipIn('acceptedTx', acceptedTX, tracker, sender)

      let noConsensus = false // this can only be true for a set command which will never come from an endpoint
      this.routeAndQueueAcceptedTransaction(acceptedTX,/*sendGossip*/ false, sender, /*globalModification*/ false, noConsensus)
      //Note await not needed so beware if you add code below this.
    })

    // /get_account_state_hash (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns a single hash of the data from the Account State Table determined by the input parameters; sort by Tx_ts  then Tx_id before taking the hash
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state_hash', async (payload:AccountStateHashReq, respond: (arg0: AccountStateHashResp) => any) => {
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
    this.p2p.registerInternal('get_account_state', async (payload:GetAccountStateReq, respond: (arg0: { accountStates: Shardus.StateTableObject[] }) => any) => {
      let result = {} as {accountStates: Shardus.StateTableObject[] }

      if(this.config.stateManager == null){
        throw new Error("this.config.stateManager == null") //TODO TSConversion  would be nice to eliminate some of these config checks.
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
    this.p2p.registerInternal('get_accepted_transactions', async (payload:AcceptedTransactionsReq, respond: (arg0: { transactions: Shardus.AcceptedTx[] }) => any) => {
      let result = {} as {transactions: Shardus.AcceptedTx[] }

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
    this.p2p.registerInternal('get_account_data', async (payload:GetAccountDataReq, respond: (arg0: { accountData: Shardus.WrappedData[] | null }) => any) => {
      
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

    this.p2p.registerInternal('get_account_data2', async (payload:GetAccountData2Req, respond: (arg0: { accountData: Shardus.WrappedData[] | null }) => any) => {
      let result = {} as {accountData: Shardus.WrappedData[] | null}//TSConversion  This is complicated !!
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

    this.p2p.registerInternal('get_account_data3', async (payload:GetAccountData3Req, respond: (arg0: { data: GetAccountDataByRangeSmart }) => any) => {
      let result = {} as {data: GetAccountDataByRangeSmart } //TSConversion  This is complicated !!(due to app wrapping)  as {data: Shardus.AccountData[] | null}
      let accountData:GetAccountDataByRangeSmart | null = null
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
      let result = {} as {accountData: Shardus.WrappedData[] | null}
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

    this.p2p.registerInternal('post_partition_results',
      /**
      * This is how to typedef a callback!
     * @param {{ partitionResults: PartitionResult[]; Cycle_number: number; }} payload
     * @param {any} respond TSConversion is it ok to just set respond to any?
     */
      async (payload: PosPartitionResults, respond:any) => {
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
            responses = responses.filter((item) => (item.sign == null) || item.sign.owner !== owner)
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
              responsesRequired = Math.min(  1 + Math.ceil(repairTracker.numNodes * 0.9), repairTracker.numNodes - 1) // get responses from 90% of the node we have sent to  
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
      })

    // /post_partition_results (Partition_results)
    //   Partition_results - array of objects with the fields {Partition_id, Cycle_number, Partition_hash, Node_id, Node_sign}
    //   Returns nothing

    // this.p2p.registerInternal('post_partition_receipt',
    //   /**
    //   * This is how to typedef a callback!
    //  * @param {PartitionReceipt} payload
    //  * @param {any} respond
    //  */
    //   async (payload, respond) => {
    //     try {
    //       if (!payload) {
    //         if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair post_partition_results: abort no payload`)
    //         return
    //       }

    //       let partitionResults = payload.partitionResults
    //       let cycleKey = 'c' + payload.Cycle_number

    //       let allResponsesByPartition = this.allPartitionResponsesByCycleByPartition[cycleKey]
    //       if (!allResponsesByPartition) {
    //         allResponsesByPartition = {}
    //         this.allPartitionResponsesByCycleByPartition[cycleKey] = allResponsesByPartition
    //       }
    //       let ourPartitionResults = this.ourPartitionResultsByCycle[cycleKey]

    //     } finally {

    //     }

    //   })

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
          if (this.verboseLogs) this.mainLogger.error(`get_transactions_by_partition_index results2:${utils.stringifyReduce(acceptedTXs.map((x:Shardus.AcceptedTx) => x.id))} snippets:${utils.stringifyReduce(payload.debugSnippets)} txid:${utils.stringifyReduce(txIDList)} `)

          let acceptedTXsBefore = 0
          if (acceptedTXs != null) {
            acceptedTXsBefore = acceptedTXs.length
          }

          // find an log missing results:
          // for(let txid of txIDList)
          let received:StringBoolObjectMap = {}
          for (let acceptedTX of acceptedTXs) {
            received[acceptedTX.id] = true
          }
          let missingTXs:string[] = []
          let missingTXHash:StringBoolObjectMap = {}
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
        this.fatalLogger.fatal('get_transactions_by_partition_index failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
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
      let response:RequestStateForTxResp = { stateList: [] , note: "", success: false}
      // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
      let queueEntry = this.getQueueEntrySafe(payload.txid)// , payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.getQueueEntryArchived(payload.txid)// , payload.timestamp)
      }

      if (queueEntry == null) {
        response.note = `failed to find queue entry: ${payload.txid}  ${payload.timestamp}`
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

    
    this.p2p.registerInternal('request_state_for_tx_post', async (payload: RequestStateForTxReqPost, respond: (arg0: RequestStateForTxResp) => any) => {
      let response:RequestStateForTxResp = { stateList: [] , note: "", success: false}
      // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
      let queueEntry = this.getQueueEntrySafe(payload.txid)// , payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.getQueueEntryArchived(payload.txid)// , payload.timestamp)
      }

      if (queueEntry == null) {
        response.note = `failed to find queue entry: ${payload.txid}  ${payload.timestamp}`
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
      if(wrappedStates != null){
        for(let key of Object.keys(wrappedStates) ){
          let wrappedState = wrappedStates[key]
          let accountData = wrappedState

          if(payload.key !== accountData.accountId ){
            continue; //not this account.
          }

          if(accountData.stateId != payload.hash){
            response.note = `failed accountData.stateId != payload.hash txid: ${utils.makeShortHash(payload.txid)}  ts:${payload.timestamp} hash:${utils.makeShortHash(accountData.stateId)}`
            await respond(response)
            return
          }
          if (accountData) {
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
      let queueEntry = this.getQueueEntrySafe(payload.txid)// , payload.timestamp)
      if (queueEntry == null) {
        //if we are syncing we need to queue this transaction!

        //this.routeAndQueueAcceptedTransaction (acceptedTx:AcceptedTx, sendGossip:boolean = true, sender: Shardus.Node  |  null, globalModification:boolean) 


        return
      }
      // add the data in
      for (let data of payload.stateList) {
        this.queueEntryAddData(queueEntry, data)
        if (queueEntry.state === 'syncing') {
          this.logger.playbackLogNote('shrd_sync_gotBroadcastData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
        }
      }
    })

    this.p2p.registerGossipHandler('spread_tx_to_group', async (payload, sender, tracker) => {
      //  gossip 'spread_tx_to_group' to transaction group
      // Place tx in queue (if younger than m)

      let queueEntry = this.getQueueEntrySafe(payload.id)// , payload.timestamp)
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

      if(queueEntry == null){
        // do not gossip this, we are not involved
        this.fatalLogger.fatal(`spread_tx_to_group failed: cant find queueEntry for:  ${utils.makeShortHash(payload.id)}` )
        return
      }

      //Validation.
      const initValidationResp = this.app.validateTxnFields(queueEntry.acceptedTx.data)
      if(initValidationResp.success !== true){
        this.fatalLogger.fatal(`spread_tx_to_group validateTxnFields failed: ${utils.stringifyReduce(
          initValidationResp
        )}`)
        return
      }

      //TODO check time before inserting queueEntry.  1sec future 5 second past max
      let timeM = this.queueSitTime
      let timestamp = queueEntry.txKeys.timestamp
      let age = Date.now() - timestamp
      if (age > timeM * 0.9) {
        this.fatalLogger.fatal('spread_tx_to_group cannot accept tx older than 0.9M ' + timestamp + ' age: ' + age)
        this.logger.playbackLogNote('shrd_spread_tx_to_groupToOld', '', 'spread_tx_to_group working on older tx ' + timestamp + ' age: ' + age)
        return
      }
      if (age < -1000) {
        this.fatalLogger.fatal('spread_tx_to_group cannot accept tx more than 1 second in future ' + timestamp + ' age: ' + age)
        this.logger.playbackLogNote('shrd_spread_tx_to_groupToFutrue', '', 'spread_tx_to_group tx too far in future' + timestamp + ' age: ' + age)
        return
      }

      // how did this work before??
      // get transaction group. 3 accounds, merge lists.
      let transactionGroup = this.queueEntryGetTransactionGroup(queueEntry)
      if (queueEntry.ourNodeInvolved === false) {

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
      let queueEntry = this.getQueueEntrySafe(payload.txid)// , payload.timestamp)
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
      let queueEntry = this.getQueueEntrySafe(appliedReceipt.txid)// , payload.timestamp)
      if (queueEntry == null) {
        this.mainLogger.error(`spread_appliedReceipt no queue entry for ${appliedReceipt.txid} `)
        return
      }

      // TODO STATESHARDING4 ENDPOINTS check payload format
      // TODO STATESHARDING4 ENDPOINTS that this message is from a valid sender (may need to check docs)
    
      let receiptNotNull = appliedReceipt != null

      if (queueEntry.recievedAppliedReceipt == null) {
        this.mainLogger.debug(`spread_appliedReceipt update ${utils.stringifyReduce(queueEntry.acceptedTx.id)} receiptNotNull:${receiptNotNull}`)

        queueEntry.recievedAppliedReceipt = appliedReceipt
        
        // I think we handle the negative cases later by checking queueEntry.recievedAppliedReceipt vs queueEntry.appliedReceipt

        // share the appliedReceipt.
        let sender = null
        let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)
        if (consensusGroup.length > 1) {
          // should consider only forwarding in some cases?
          this.debugNodeGroup(queueEntry.acceptedTx.id, queueEntry.acceptedTx.timestamp, `share appliedReceipt to neighbors`, consensusGroup) 
          this.p2p.sendGossipIn('spread_appliedReceipt',appliedReceipt , tracker, sender, consensusGroup)
        }
      } else {
        this.mainLogger.debug(`spread_appliedReceipt skipped ${utils.stringifyReduce(queueEntry.acceptedTx.id)} receiptNotNull:${receiptNotNull}`)

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
  
    this.p2p.registerInternal('get_globalaccountreport', async (payload:any, respond: (arg0: GlobalAccountReportResp) => any) => {
      let result = {combinedHash:"", accounts:[], ready: this.appFinishedSyncing} as GlobalAccountReportResp

      //type GlobalAccountReportResp = {combinedHash:string, accounts:{id:string, hash:string, timestamp:number }[]  }
      //sort by account ids.

      let globalAccountKeys = this.globalAccountMap.keys()
      
      let toQuery:string[] = []

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
      for(let key of globalAccountKeys){
        toQuery.push(key)
      }

      let accountData:Shardus.WrappedData[]
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
          let report= {id:wrappedAccount.accountId , hash:wrappedAccount.stateId, timestamp:wrappedAccount.timestamp }
          result.accounts.push(report)
        }
      }   
      //PERF Disiable this in production or performance testing.
      this.testAccountDataWrapped(accountData)
      result.accounts.sort(utils.sort_id_Asc )
      result.combinedHash = this.crypto.hash(result)
      //this.globalAccountRepairBank

      await respond(result)
    })
  }

  _unregisterEndpoints () {
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

  /* -------- APPSTATE Functions ---------- */

  async getAccountsStateHash (accountStart = '0'.repeat(64), accountEnd = 'f'.repeat(64), tsStart = 0, tsEnd = Date.now()) {
    const accountStates = await this.storage.queryAccountStateTable(accountStart, accountEnd, tsStart, tsEnd, 100000000)
    const stateHash = this.crypto.hash(accountStates)
    return stateHash
  }

  // async testAccountTimesAndStateTable (tx, accountData) {
  //   let hasStateTableData = false

  //   function tryGetAccountData (accountID) {
  //     for (let accountEntry of accountData) {
  //       if (accountEntry.accountId === accountID) {
  //         return accountEntry
  //       }
  //     }
  //     return null
  //   }

  //   try {
  //     let keysResponse = this.app.getKeyFromTransaction(tx)
  //     let { sourceKeys, targetKeys, timestamp } = keysResponse
  //     let sourceAddress, targetAddress, sourceState, targetState

  //     // check account age to make sure it is older than the tx
  //     let failedAgeCheck = false
  //     for (let accountEntry of accountData) {
  //       if (accountEntry.timestamp >= timestamp) {
  //         failedAgeCheck = true
  //         if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable account has future state.  id: ' + utils.makeShortHash(accountEntry.accountId) + ' time: ' + accountEntry.timestamp + ' txTime: ' + timestamp + ' delta: ' + (timestamp - accountEntry.timestamp))
  //       }
  //     }
  //     if (failedAgeCheck) {
  //       // if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountTimesAndStateTable accounts have future state ' + timestamp)
  //       return { success: false, hasStateTableData }
  //     }

  //     // check state table
  //     if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
  //       sourceAddress = sourceKeys[0]
  //       let accountStates = await this.storage.searchAccountStateTable(sourceAddress, timestamp)
  //       if (accountStates.length !== 0) {
  //         let accountEntry = tryGetAccountData(sourceAddress)
  //         if (accountEntry == null) {
  //           return { success: false, hasStateTableData }
  //         }
  //         sourceState = accountEntry.stateId
  //         hasStateTableData = true
  //         if (accountStates.length === 0 || accountStates[0].stateBefore !== sourceState) {
  //           if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1')
  //           if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1 stateId: ' + utils.makeShortHash(sourceState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(sourceAddress))
  //           return { success: false, hasStateTableData }
  //         }
  //       }
  //     }
  //     if (Array.isArray(targetKeys) && targetKeys.length > 0) {
  //       targetAddress = targetKeys[0]
  //       let accountStates = await this.storage.searchAccountStateTable(targetAddress, timestamp)

  //       if (accountStates.length !== 0) {
  //         hasStateTableData = true
  //         if (accountStates.length !== 0 && accountStates[0].stateBefore !== allZeroes64) {
  //           let accountEntry = tryGetAccountData(targetAddress)

  //           if (accountEntry == null) {
  //             if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress))
  //             if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ' + utils.stringifyReduce(accountData))
  //             this.fatalLogger.fatal(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ' + utils.stringifyReduce(accountData)) // todo: consider if this is just an error
  //             // fail this because we already check if the before state was all zeroes
  //             return { success: false, hasStateTableData }
  //           } else {
  //             targetState = accountEntry.stateId
  //             if (accountStates[0].stateBefore !== targetState) {
  //               if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 2')
  //               if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' cant apply state 2 stateId: ' + utils.makeShortHash(targetState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(targetAddress))
  //               return { success: false, hasStateTableData }
  //             }
  //           }
  //         }
  //       }
  //     }
  //   } catch (ex) {
  //     this.fatalLogger.fatal('testAccountTimesAndStateTable failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //   }
  //   return { success: true, hasStateTableData }
  // }

  async testAccountTimesAndStateTable2 (tx:Shardus.OpaqueTransaction, wrappedStates:WrappedStates) {
    let hasStateTableData = false

    function tryGetAccountData (accountID:string) {
      return wrappedStates[accountID]
    }

    try {
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { sourceKeys, targetKeys, timestamp } = keysResponse
      let sourceAddress, sourceState, targetState

      // check account age to make sure it is older than the tx
      let failedAgeCheck = false

      let accountKeys = Object.keys(wrappedStates)
      for (let key of accountKeys) {
        let accountEntry = tryGetAccountData(key)
        if (accountEntry.timestamp >= timestamp) {
          failedAgeCheck = true
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable account has future state.  id: ' + utils.makeShortHash(accountEntry.accountId) + ' time: ' + accountEntry.timestamp + ' txTime: ' + timestamp + ' delta: ' + (timestamp - accountEntry.timestamp))
        }
      }
      if (failedAgeCheck) {
        // if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountTimesAndStateTable accounts have future state ' + timestamp)
        return { success: false, hasStateTableData }
      }

      // check state table
      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        sourceAddress = sourceKeys[0]
        let accountStates = await this.storage.searchAccountStateTable(sourceAddress, timestamp)
        if (accountStates.length !== 0) {
          let accountEntry = tryGetAccountData(sourceAddress)
          if (accountEntry == null) {
            return { success: false, hasStateTableData }
          }
          sourceState = accountEntry.stateId
          hasStateTableData = true
          if (accountStates.length === 0 || accountStates[0].stateBefore !== sourceState) {
            if(accountStates[0].stateBefore === '0'.repeat(64)){
              //sorta broken security hole.
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + 'bypass state comparision if before state was 00000: ' + utils.makeShortHash(sourceState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(sourceAddress))

            } else{
              if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1')
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1 stateId: ' + utils.makeShortHash(sourceState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(sourceAddress))
              return { success: false, hasStateTableData }              
            }

          }
        }
      }
      if (Array.isArray(targetKeys) && targetKeys.length > 0) {
        // targetAddress = targetKeys[0]
        for (let targetAddress of targetKeys) {
          let accountStates = await this.storage.searchAccountStateTable(targetAddress, timestamp)

          if (accountStates.length !== 0) {
            hasStateTableData = true
            if (accountStates.length !== 0 && accountStates[0].stateBefore !== allZeroes64) {
              let accountEntry = tryGetAccountData(targetAddress)

              if (accountEntry == null) {
                if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress))
                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ')
                this.fatalLogger.fatal(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ') // todo: consider if this is just an error
                // fail this because we already check if the before state was all zeroes
                return { success: false, hasStateTableData }
              } else {
                targetState = accountEntry.stateId
                if (accountStates[0].stateBefore !== targetState) {
                  if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 2')
                  if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' cant apply state 2 stateId: ' + utils.makeShortHash(targetState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(targetAddress))
                  return { success: false, hasStateTableData }
                }
              }
            }
          }
        }
      }
    } catch (ex) {
      this.fatalLogger.fatal('testAccountTimesAndStateTable failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    }
    return { success: true, hasStateTableData }
  }

  async testAccountTime (tx:Shardus.OpaqueTransaction, wrappedStates:WrappedStates) {
    function tryGetAccountData (accountID:string) {
      return wrappedStates[accountID]
    }

    try {
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { timestamp } = keysResponse // sourceKeys, targetKeys,
      // check account age to make sure it is older than the tx
      let failedAgeCheck = false

      let accountKeys = Object.keys(wrappedStates)
      for (let key of accountKeys) {
        let accountEntry = tryGetAccountData(key)
        if (accountEntry.timestamp >= timestamp) {
          failedAgeCheck = true
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTime account has future state.  id: ' + utils.makeShortHash(accountEntry.accountId) + ' time: ' + accountEntry.timestamp + ' txTime: ' + timestamp + ' delta: ' + (timestamp - accountEntry.timestamp))
        }
      }
      if (failedAgeCheck) {
        // if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountTimesAndStateTable accounts have future state ' + timestamp)
        return false
      }
    } catch (ex) {
      this.fatalLogger.fatal('testAccountTime failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      return false
    }
    return true // { success: true, hasStateTableData }
  }
  // state ids should be checked before applying this transaction because it may have already been applied while we were still syncing data.
  async tryApplyTransaction (acceptedTX:AcceptedTx, hasStateTableData:boolean, repairing:boolean, filter:AccountFilter, wrappedStates:WrappedResponses, localCachedData:LocalCachedData ) {
    let ourLockID = -1
    let accountDataList
    let txTs = 0
    let accountKeys = []
    let ourAccountLocks = null
    let applyResponse: Shardus.ApplyResponse | null = null
    //have to figure out if this is a global modifying tx, since that impacts if we will write to global account.
    let isGlobalModifyingTX = false
    let savedSomething = false
    try {
      let tx = acceptedTX.data
      // let receipt = acceptedTX.receipt
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { timestamp, debugInfo } = keysResponse
      txTs = timestamp


      let queueEntry = this.getQueueEntry(acceptedTX.id)
      if(queueEntry != null){
        if(queueEntry.globalModification === true){
          isGlobalModifyingTX = true
        }
      }

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryApplyTransaction  ts:${timestamp} repairing:${repairing} hasStateTableData:${hasStateTableData} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryApplyTransaction  filter: ${utils.stringifyReduce(filter)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryApplyTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryApplyTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryApplyTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`)

      if (repairing !== true) {
        // get a list of modified account keys that we will lock
        let { sourceKeys, targetKeys } = keysResponse
        for (let accountID of sourceKeys) {
          accountKeys.push(accountID)
        }
        for (let accountID of targetKeys) {
          accountKeys.push(accountID)
        }
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair tryApplyTransaction FIFO lock outer: ${utils.stringifyReduce(accountKeys)} `)
        ourAccountLocks = await this.bulkFifoLockAccounts(accountKeys)
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair tryApplyTransaction FIFO lock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
      }

      ourLockID = await this.fifoLock('accountModification')

      if (this.verboseLogs) console.log(`tryApplyTransaction  ts:${timestamp} repairing:${repairing}  Applying!`)
      // if (this.verboseLogs) this.mainLogger.debug('APPSTATE: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))
      this.applySoftLock = true

      // let replyObject = { stateTableResults: [], txId, txTimestamp, accountData: [] }
      // let wrappedStatesList = Object.values(wrappedStates)

      // TSConversion need to check how save this cast is for the apply fuction, should probably do more in depth look at the tx param.
      applyResponse = this.app.apply(tx as Shardus.IncomingTransaction, wrappedStates)
      let { stateTableResults, accountData: _accountdata } = applyResponse
      accountDataList = _accountdata


      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryApplyTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
      // wrappedStates are side effected for now
      savedSomething = await this.setAccount(wrappedStates, localCachedData, applyResponse, isGlobalModifyingTX, filter)

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryApplyTransaction  accountData[${accountDataList.length}]: ${utils.stringifyReduce(accountDataList)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryApplyTransaction  stateTableResults[${stateTableResults.length}]: ${utils.stringifyReduce(stateTableResults)}`)

      this.applySoftLock = false
      // only write our state table data if we dont already have it in the db
      if (hasStateTableData === false) {
        for (let stateT of stateTableResults) {
          if (this.verboseLogs) console.log('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' accounts total' + accountDataList.length)
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter) + ' txid: ' + utils.makeShortHash(acceptedTX.id) + ' ts: ' + acceptedTX.timestamp)
        }
        await this.storage.addAccountStates(stateTableResults)
      }

      // post validate that state ended up correctly?

      // write the accepted TX to storage
      this.storage.addAcceptedTransactions([acceptedTX])
    } catch (ex) {
      this.fatalLogger.fatal('tryApplyTransaction failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.mainLogger.debug(`tryApplyTransaction failed id:${utils.makeShortHash(acceptedTX.id)}  ${utils.stringifyReduce(acceptedTX)}`)
      if(applyResponse){ // && savedSomething){
        // TSConversion do we really want to record this?
        // if (!repairing) this.tempRecordTXByCycle(txTs, acceptedTX, false, applyResponse, isGlobalModifyingTX, savedSomething)
        // record no-op state table fail:

      } else {
        // this.fatalLogger.fatal('tryApplyTransaction failed: applyResponse == null')
      }
      

      return false
    } finally {
      this.fifoUnlock('accountModification', ourLockID)
      if (repairing !== true) {
        if(ourAccountLocks != null){
          this.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
        }
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair tryApplyTransaction FIFO unlock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
      }
    }

    // have to wrestle with the data a bit so we can backup the full account and not jsut the partial account!
    // let dataResultsByKey = {}
    let dataResultsFullList = []
    for (let wrappedData of applyResponse.accountData) {
      // if (wrappedData.isPartial === false) {
      //   dataResultsFullList.push(wrappedData.data)
      // } else {
      //   dataResultsFullList.push(wrappedData.localCache)
      // }
      if (wrappedData.localCache != null) {
        dataResultsFullList.push(wrappedData)
      }
      // dataResultsByKey[wrappedData.accountId] = wrappedData.data
    }

    // this is just for debug!!!
    if (dataResultsFullList[0] == null) {
      for (let wrappedData of applyResponse.accountData) {
        if (wrappedData.localCache != null) {
          dataResultsFullList.push(wrappedData)
        }
        // dataResultsByKey[wrappedData.accountId] = wrappedData.data
      }
    }
    // if(dataResultsFullList == null){
    //   throw new Error(`tryApplyTransaction (dataResultsFullList == null  ${txTs} ${utils.stringifyReduce(acceptedTX)} `);
    // }

    // TSConversion verified that app.setAccount calls shardus.applyResponseAddState  that adds hash and txid to the data and turns it into AccountData
    let upgradedAccountDataList:Shardus.AccountData[] = (dataResultsFullList as unknown) as Shardus.AccountData[]

    await this.updateAccountsCopyTable(upgradedAccountDataList, repairing, txTs)

    if (!repairing) {
      // await this.updateAccountsCopyTable(accountDataList)
      //if(savedSomething){
        this.tempRecordTXByCycle(txTs, acceptedTX, true, applyResponse, isGlobalModifyingTX, savedSomething)
      //}
      

      //WOW this was not good!  had acceptedTX.transactionGroup[0].id
      //if (this.p2p.getNodeId() === acceptedTX.transactionGroup[0].id) {
      
      let queueEntry:QueueEntry | null = this.getQueueEntry(acceptedTX.id )
      if (queueEntry != null && queueEntry.transactionGroup != null && this.p2p.getNodeId() === queueEntry.transactionGroup[0].id) {  
        this.emit('txProcessed')
      }

      this.emit('txApplied', acceptedTX)
    }

    return true
  }

  /**
   * tryPreApplyTransaction this will try to apply a transaction but will not commit the data
   * @param acceptedTX 
   * @param hasStateTableData 
   * @param repairing 
   * @param filter 
   * @param wrappedStates 
   * @param localCachedData 
   */
  async tryPreApplyTransaction (acceptedTX:AcceptedTx, hasStateTableData:boolean, repairing:boolean, filter:AccountFilter, wrappedStates:WrappedResponses, localCachedData:LocalCachedData) : Promise<{passed : boolean, applyResult:string, applyResponse? : Shardus.ApplyResponse}> {
    let ourLockID = -1
    let accountDataList
    let txTs = 0
    let accountKeys = []
    let ourAccountLocks = null
    let applyResponse: Shardus.ApplyResponse | null = null
    //have to figure out if this is a global modifying tx, since that impacts if we will write to global account.
    let isGlobalModifyingTX = false

    try {
      let tx = acceptedTX.data
      // let receipt = acceptedTX.receipt
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { timestamp, debugInfo } = keysResponse
      txTs = timestamp


      let queueEntry = this.getQueueEntry(acceptedTX.id)
      if(queueEntry != null){
        if(queueEntry.globalModification === true){
          isGlobalModifyingTX = true
        }
      }

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryPreApplyTransaction  ts:${timestamp} repairing:${repairing} hasStateTableData:${hasStateTableData} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryPreApplyTransaction  filter: ${utils.stringifyReduce(filter)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryPreApplyTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryPreApplyTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryPreApplyTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`)

      if (repairing !== true) {
        // get a list of modified account keys that we will lock
        let { sourceKeys, targetKeys } = keysResponse
        for (let accountID of sourceKeys) {
          accountKeys.push(accountID)
        }
        for (let accountID of targetKeys) {
          accountKeys.push(accountID)
        }
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` tryPreApplyTransaction FIFO lock outer: ${utils.stringifyReduce(accountKeys)} `)
        ourAccountLocks = await this.bulkFifoLockAccounts(accountKeys)
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` tryPreApplyTransaction FIFO lock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
      }

      ourLockID = await this.fifoLock('accountModification')

      if (this.verboseLogs) console.log(`tryPreApplyTransaction  ts:${timestamp} repairing:${repairing}  Applying!`)
      this.applySoftLock = true

      applyResponse = this.app.apply(tx as Shardus.IncomingTransaction, wrappedStates)
      let { stateTableResults, accountData: _accountdata } = applyResponse
      accountDataList = _accountdata

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryPreApplyTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)

      this.applySoftLock = false

    } catch (ex) {
      this.fatalLogger.fatal('tryPreApplyTransaction failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.mainLogger.debug(`tryPreApplyTransaction failed id:${utils.makeShortHash(acceptedTX.id)}  ${utils.stringifyReduce(acceptedTX)}`)

      return { passed:false, applyResponse, applyResult: ex.message }

    } finally {
      this.fifoUnlock('accountModification', ourLockID)
      if (repairing !== true) {
        if(ourAccountLocks != null){
          this.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
        }
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` tryPreApplyTransaction FIFO unlock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
      }
    }

    return { passed:true, applyResponse, applyResult:'applied' }
  }

  async commitConsensedTransaction (applyResponse:Shardus.ApplyResponse, acceptedTX:AcceptedTx, hasStateTableData:boolean, repairing:boolean, filter:AccountFilter, wrappedStates:WrappedResponses, localCachedData:LocalCachedData ) : Promise<CommitConsensedTransactionResult> {
    let ourLockID = -1
    let accountDataList
    let txTs = 0
    let accountKeys = []
    let ourAccountLocks = null
   
    //have to figure out if this is a global modifying tx, since that impacts if we will write to global account.
    let isGlobalModifyingTX = false
    let savedSomething = false
    try {
      let tx = acceptedTX.data
      // let receipt = acceptedTX.receipt
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { timestamp, debugInfo } = keysResponse
      txTs = timestamp


      let queueEntry = this.getQueueEntry(acceptedTX.id)
      if(queueEntry != null){
        if(queueEntry.globalModification === true){
          isGlobalModifyingTX = true
        }
      }

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction  ts:${timestamp} repairing:${repairing} hasStateTableData:${hasStateTableData} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction  filter: ${utils.stringifyReduce(filter)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`)

      if (repairing !== true) {
        // get a list of modified account keys that we will lock
        let { sourceKeys, targetKeys } = keysResponse
        for (let accountID of sourceKeys) {
          accountKeys.push(accountID)
        }
        for (let accountID of targetKeys) {
          accountKeys.push(accountID)
        }
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction FIFO lock outer: ${utils.stringifyReduce(accountKeys)} `)
        ourAccountLocks = await this.bulkFifoLockAccounts(accountKeys)
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction FIFO lock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
      }

      ourLockID = await this.fifoLock('accountModification')

      if (this.verboseLogs) console.log(`commitConsensedTransaction  ts:${timestamp} repairing:${repairing}  Applying!`)
      // if (this.verboseLogs) this.mainLogger.debug('APPSTATE: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))
      this.applySoftLock = true

      let { stateTableResults, accountData: _accountdata } = applyResponse
      accountDataList = _accountdata


      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
      // wrappedStates are side effected for now
      savedSomething = await this.setAccount(wrappedStates, localCachedData, applyResponse, isGlobalModifyingTX, filter)

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction  savedSomething: ${savedSomething}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction  accountData[${accountDataList.length}]: ${utils.stringifyReduce(accountDataList)}`)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction  stateTableResults[${stateTableResults.length}]: ${utils.stringifyReduce(stateTableResults)}`)

      this.applySoftLock = false
      // only write our state table data if we dont already have it in the db
      if (hasStateTableData === false) {
        for (let stateT of stateTableResults) {
          if (this.verboseLogs) console.log('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' accounts total' + accountDataList.length)
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter) + ' txid: ' + utils.makeShortHash(acceptedTX.id) + ' ts: ' + acceptedTX.timestamp)
        }
        await this.storage.addAccountStates(stateTableResults)
      }

      // post validate that state ended up correctly?

      // write the accepted TX to storage
      this.storage.addAcceptedTransactions([acceptedTX])
    } catch (ex) {
      this.fatalLogger.fatal('commitConsensedTransaction failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.mainLogger.debug(`commitConsensedTransaction failed id:${utils.makeShortHash(acceptedTX.id)}  ${utils.stringifyReduce(acceptedTX)}`)
      if(applyResponse){ // && savedSomething){
        // TSConversion do we really want to record this?
        // if (!repairing) this.tempRecordTXByCycle(txTs, acceptedTX, false, applyResponse, isGlobalModifyingTX, savedSomething)
        // record no-op state table fail:

      } else {
        // this.fatalLogger.fatal('tryApplyTransaction failed: applyResponse == null')
      }
      

      return {success:false}
    } finally {
      this.fifoUnlock('accountModification', ourLockID)
      if (repairing !== true) {
        if(ourAccountLocks != null){
          this.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
        }
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `commitConsensedTransaction FIFO unlock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
      }
    }

    // have to wrestle with the data a bit so we can backup the full account and not jsut the partial account!
    // let dataResultsByKey = {}
    let dataResultsFullList = []
    for (let wrappedData of applyResponse.accountData) {
      // if (wrappedData.isPartial === false) {
      //   dataResultsFullList.push(wrappedData.data)
      // } else {
      //   dataResultsFullList.push(wrappedData.localCache)
      // }
      if (wrappedData.localCache != null) {
        dataResultsFullList.push(wrappedData)
      }
      // dataResultsByKey[wrappedData.accountId] = wrappedData.data
    }

    // this is just for debug!!!
    if (dataResultsFullList[0] == null) {
      for (let wrappedData of applyResponse.accountData) {
        if (wrappedData.localCache != null) {
          dataResultsFullList.push(wrappedData)
        }
        // dataResultsByKey[wrappedData.accountId] = wrappedData.data
      }
    }
    // if(dataResultsFullList == null){
    //   throw new Error(`tryApplyTransaction (dataResultsFullList == null  ${txTs} ${utils.stringifyReduce(acceptedTX)} `);
    // }

    // TSConversion verified that app.setAccount calls shardus.applyResponseAddState  that adds hash and txid to the data and turns it into AccountData
    let upgradedAccountDataList:Shardus.AccountData[] = (dataResultsFullList as unknown) as Shardus.AccountData[]

    await this.updateAccountsCopyTable(upgradedAccountDataList, repairing, txTs)

    if (!repairing) {
      // await this.updateAccountsCopyTable(accountDataList)
      //if(savedSomething){
        this.tempRecordTXByCycle(txTs, acceptedTX, true, applyResponse, isGlobalModifyingTX, savedSomething)
      //}
      

      //WOW this was not good!  had acceptedTX.transactionGroup[0].id
      //if (this.p2p.getNodeId() === acceptedTX.transactionGroup[0].id) {
      
      let queueEntry:QueueEntry | null = this.getQueueEntry(acceptedTX.id )
      if (queueEntry != null && queueEntry.transactionGroup != null && this.p2p.getNodeId() === queueEntry.transactionGroup[0].id) {  
        this.emit('txProcessed')
      }

      this.emit('txApplied', acceptedTX)
    }

    return {success:true}
  }


  // async applyAcceptedTransaction (acceptedTX:AcceptedTx, wrappedStates:WrappedResponses, localCachedData:LocalCachedData, filter:AccountFilter) {
  //   if (this.queueStopped) return
  //   let tx = acceptedTX.data
  //   let keysResponse = this.app.getKeyFromTransaction(tx)
  //   let { sourceKeys, targetKeys, timestamp, debugInfo } = keysResponse

  //   if (this.verboseLogs) console.log('applyAcceptedTransaction ' + timestamp + ' debugInfo:' + debugInfo)
  //   if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction ' + timestamp + ' debugInfo:' + debugInfo)

  //   let allkeys:string[] = []
  //   allkeys = allkeys.concat(sourceKeys)
  //   allkeys = allkeys.concat(targetKeys)

  //   for (let key of allkeys) {
  //     if (wrappedStates[key] == null) {
  //       if (this.verboseLogs) console.log(`applyAcceptedTransaction missing some account data. timestamp:${timestamp}  key: ${utils.makeShortHash(key)}  debuginfo:${debugInfo}`)
  //       return { success: false, reason: 'missing some account data' }
  //     }
  //   }

  //   // let accountData = await this.app.getAccountDataByList(allkeys) Now that we are sharded we must use the wrapped states instead of asking for account data! (faster anyhow!)

  //   let { success, hasStateTableData } = await this.testAccountTimesAndStateTable2(tx, wrappedStates)

  //   if (!success) {
  //     if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction pretest failed: ' + timestamp)
  //     this.logger.playbackLogNote('tx_apply_rejected 1', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
  //     return { success: false, reason: 'applyAcceptedTransaction pretest failed' }
  //   }

  //   // Validate transaction through the application. Shardus can see inside the transaction
  //   this.profiler.profileSectionStart('validateTx')
  //   // todo add data fetch to the result and pass it into app apply(), include previous hashes

  //   // todo2 refactor the state table data checks out of try apply and calculate them with less effort using results from validate
  //   let applyResult = await this.tryApplyTransaction(acceptedTX, hasStateTableData, false, filter, wrappedStates, localCachedData)
  //   if (applyResult) {
  //     if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction SUCCEDED ' + timestamp)
  //     this.logger.playbackLogNote('tx_applied', `${acceptedTX.id}`, `AcceptedTransaction: ${utils.stringifyReduce(acceptedTX)}`)
  //   } else {
  //     this.logger.playbackLogNote('tx_apply_rejected 3', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
  //   }
  //   return { success: applyResult, reason: 'apply result' }
  // }


  /**
   * preApplyAcceptedTransaction will apply a transaction to the in memory data but will not save the results to the database yet
   * @param acceptedTX 
   * @param wrappedStates 
   * @param localCachedData 
   * @param filter 
   */
  async preApplyAcceptedTransaction (acceptedTX:AcceptedTx, wrappedStates:WrappedResponses, localCachedData:LocalCachedData, filter:AccountFilter) : Promise<PreApplyAcceptedTransactionResult> {
    if (this.queueStopped) return
    let tx = acceptedTX.data
    let keysResponse = this.app.getKeyFromTransaction(tx)
    let { sourceKeys, targetKeys, timestamp, debugInfo } = keysResponse

    if (this.verboseLogs) console.log('preApplyAcceptedTransaction ' + timestamp + ' debugInfo:' + debugInfo)
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction ' + timestamp + ' debugInfo:' + debugInfo)

    let allkeys:string[] = []
    allkeys = allkeys.concat(sourceKeys)
    allkeys = allkeys.concat(targetKeys)

    for (let key of allkeys) {
      if (wrappedStates[key] == null) {
        if (this.verboseLogs) console.log(`preApplyAcceptedTransaction missing some account data. timestamp:${timestamp}  key: ${utils.makeShortHash(key)}  debuginfo:${debugInfo}`)
        return { applied: false, passed: false, applyResult:'', reason: 'missing some account data' }
      }
    }

    // todo review what we are checking here.
    let { success, hasStateTableData } = await this.testAccountTimesAndStateTable2(tx, wrappedStates)

    if (!success) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'preApplyAcceptedTransaction pretest failed: ' + timestamp)
      this.logger.playbackLogNote('tx_preapply_rejected 1', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
      return { applied: false, passed:false, applyResult:'', reason: 'preApplyAcceptedTransaction pretest failed, TX rejected' }
    }
  
    // TODO STATESHARDING4 I am not sure if this really needs to be split into a function anymore.
    // That mattered with data repair in older versions of the code, but that may be the wrong thing to do now
    let preApplyResult = await this.tryPreApplyTransaction(acceptedTX, hasStateTableData, false, filter, wrappedStates, localCachedData)

    if (preApplyResult) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'preApplyAcceptedTransaction SUCCEDED ' + timestamp)
      this.logger.playbackLogNote('tx_preapplied', `${acceptedTX.id}`, `AcceptedTransaction: ${utils.stringifyReduce(acceptedTX)}`)
    } else {
      this.logger.playbackLogNote('tx_preapply_rejected 3', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
    }

    return { applied: true , passed: preApplyResult.passed, applyResult:preApplyResult.applyResult,  reason: 'apply result', applyResponse: preApplyResult.applyResponse }
  }
  

  interruptibleSleep (ms: number, targetTime: number) {
    let resolveFn:any = null //TSConversion just setting this to any for now.
    let promise = new Promise(resolve => {
      resolveFn = resolve
      setTimeout(resolve, ms)
    })
    return { promise, resolveFn, targetTime }
  }

  interruptSleepIfNeeded (targetTime: number) {
    if (this.sleepInterrupt) {
      if (targetTime < this.sleepInterrupt.targetTime) {
        this.sleepInterrupt.resolveFn()
      }
    }
  }

  // /////////////////////////////////////////////////////////////////////////////////////////////////////////
  // ////   Transaction Queue Handling        ////////////////////////////////////////////////////////////////
  // /////////////////////////////////////////////////////////////////////////////////////////////////////////

  updateHomeInformation (txQueueEntry:QueueEntry) {
    if (this.currentCycleShardData != null && txQueueEntry.hasShardInfo === false) {
      let txId = txQueueEntry.acceptedTx.receipt.txHash
      // Init home nodes!
      for (let key of txQueueEntry.txKeys.allKeys) {
        if(key == null){
          throw new Error(`updateHomeInformation key == null ${key}`)
        }
        let homeNode = ShardFunctions.findHomeNode(this.currentCycleShardData.shardGlobals, key, this.currentCycleShardData.parititionShardDataMap)
        if(homeNode == null){
          throw new Error(`updateHomeInformation homeNode == null ${key}`)
        }
        txQueueEntry.homeNodes[key] = homeNode
        if (homeNode == null) {
          if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` routeAndQueueAcceptedTransaction: ${key} `)
          throw new Error(`updateHomeInformation homeNode == null ${txQueueEntry}`)
        }

        // HOMENODEMATHS Based on home node.. should this be chaned to homepartition?
        let summaryObject = ShardFunctions.getHomeNodeSummaryObject(homeNode)
        let relationString = ShardFunctions.getNodeRelation(homeNode, this.currentCycleShardData.ourNode.id)
        // route_to_home_node
        this.logger.playbackLogNote('shrd_homeNodeSummary', `${txId}`, `account:${utils.makeShortHash(key)} rel:${relationString} summary:${utils.stringifyReduce(summaryObject)}`)
      }

      txQueueEntry.hasShardInfo = true
    }
  }

  debugNodeGroup(key,key2, msg, nodes) {
    this.logger.playbackLogNote('debugNodeGroup', `${utils.stringifyReduce(key)}_${key2}` , `${msg} ${utils.stringifyReduce(nodes.map((node) => { return { id: node.id, port: node.externalPort } } ))}` )

  }

  //
  //
  //
  //    QQQQQQQ
  //   Q       Q
  //   Q       Q
  //   Q       Q
  //   Q       Q
  //    QQQQQ Q
  //         Q
  //          QQ

  routeAndQueueAcceptedTransaction (acceptedTx:AcceptedTx, sendGossip:boolean = true, sender: Shardus.Node  |  null, globalModification:boolean, noConsensus: boolean) : string | boolean {
    // dropping these too early.. hmm  we finished syncing before we had the first shard data.
    // if (this.currentCycleShardData == null) {
    //   // this.preTXQueue.push(acceptedTX)
    //   return 'notReady' // it is too early to care about the tx
    // }
    this.logger.playbackLogNote('routeAndQueueAcceptedTransaction-debug', '', `sendGossip:${sendGossip} globalModification:${globalModification} noConsensus:${noConsensus} this.readyforTXs:${this.readyforTXs} hasshardData:${(this.currentCycleShardData != null)} acceptedTx:${utils.stringifyReduce(acceptedTx)} `)
    if (this.readyforTXs === false) {
      return 'notReady' // it is too early to care about the tx
    }
    if(this.currentCycleShardData == null)
    {
      return 'notReady'
    }
    let keysResponse = this.app.getKeyFromTransaction(acceptedTx.data)
    let timestamp = keysResponse.timestamp
    let txId = acceptedTx.receipt.txHash

    // This flag turns of consensus for all TXs for debuggging
    if(this.debugNoTxVoting === true){
      noConsensus = true
    }

    this.queueEntryCounter++
    let txQueueEntry:QueueEntry = { acceptedTx: acceptedTx, txKeys: keysResponse, noConsensus, collectedData: {}, originalData: {}, homeNodes: {}, patchedOnNodes: new Map(), hasShardInfo: false, state: 'aging', dataCollected: 0, hasAll: false, entryID: this.queueEntryCounter, localKeys: {}, localCachedData: {}, syncCounter: 0, didSync: false, syncKeys: [], logstate:'', requests:{}, globalModification:globalModification, collectedVotes:[], waitForReceiptOnly:false, m2TimeoutReached:false, debugFail1:false } // age comes from timestamp
    // partition data would store stuff like our list of nodes that store this ts
    // collected data is remote data we have recieved back
    // //tx keys ... need a sorted list (deterministic) of partition.. closest to a number?


    // todo faster hash lookup for this maybe?
    let entry = this.getQueueEntrySafe(acceptedTx.id) // , acceptedTx.timestamp)
    if (entry) {
      return false // already in our queue, or temp queue
    }


    // if (this.config.debug != null && this.config.debug.loseTxChance && this.config.debug.loseTxChance > 0) {
    //   let rand = Math.random()
    //   if (this.config.debug.loseTxChance > rand) {
    //     if (this.app.canDebugDropTx(acceptedTx.data)) {
    //       this.logger.playbackLogNote('tx_dropForTest', txId, 'dropping tx ' + timestamp)
    //       return 'lost'
    //     }
    //   }
    // }

    if (this.config.debug != null && this.config.debug.loseTxChance && this.config.debug.loseTxChance > 0) {
      let rand = Math.random()
      if (this.config.debug.loseTxChance > rand) {
        if (this.app.canDebugDropTx(acceptedTx.data)) {
          this.mainLogger.error('tx_failReceiptTest fail vote tx  ' + txId + ' ' + timestamp)
          this.logger.playbackLogNote('tx_failReceiptTest', txId, 'fail vote tx ' + timestamp)
          //return 'lost'
          txQueueEntry.debugFail1 = true
        }
      }
    } else {
      this.mainLogger.error('tx_failReceiptTest set  ' + this.config.debug.loseTxChance)
      this.config.debug.loseTxChance = 0.02

    }

    try {
      let age = Date.now() - timestamp
      if (age > this.queueSitTime * 0.9) {
        this.fatalLogger.fatal('routeAndQueueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age)
        // TODO consider throwing this out.  right now it is just a warning
        this.logger.playbackLogNote('shrd_oldQueueInsertion', '', 'routeAndQueueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age)
      }
      let keyHash:StringBoolObjectMap = {}
      for (let key of txQueueEntry.txKeys.allKeys) {
        if(key == null){
         // throw new Error(`routeAndQueueAcceptedTransaction key == null ${key}`)
         if (this.verboseLogs) this.mainLogger.error(`routeAndQueueAcceptedTransaction key == null ${timestamp} not putting tx in queue.`)
         return false
        }

        keyHash[key] = true
      }
      txQueueEntry.uniqueKeys = Object.keys(keyHash)

      this.updateHomeInformation(txQueueEntry)

      // Global account keys.
      for (let key of txQueueEntry.uniqueKeys) {
        if(globalModification === true){
          // TODO: globalaccounts 
          if(this.globalAccountMap.has(key)){
            this.logger.playbackLogNote('globalAccountMap', `routeAndQueueAcceptedTransaction - has`)
            // indicate that we will have global data in this transaction!
            // I think we do not need to test that here afterall.
          } else {
            //this makes the code aware that this key is for a global account.
            //is setting this here too soon?
            //it should be that p2p has already checked the receipt before calling shardus.push with global=true

            this.globalAccountMap.set(key, null)
            this.logger.playbackLogNote('globalAccountMap', `routeAndQueueAcceptedTransaction - set`)

          }            
        }
      }

      // if we are syncing this area mark it as good.
      for (let key of txQueueEntry.uniqueKeys) {
        let syncTracker = this.getSyncTracker(key)
        if (syncTracker != null) {
          txQueueEntry.state = 'syncing'
          txQueueEntry.syncCounter++
          txQueueEntry.didSync = true // mark that this tx had to sync, this flag should never be cleared, we will use it later to not through stuff away.
          syncTracker.queueEntries.push(txQueueEntry) // same tx may get pushed in multiple times. that's ok.
          txQueueEntry.syncKeys.push(key) // used later to instruct what local data we should JIT load
          txQueueEntry.localKeys[key] = true // used for the filter

          this.logger.playbackLogNote('shrd_sync_queued_and_set_syncing', `${txQueueEntry.acceptedTx.id}`, ` qId: ${txQueueEntry.entryID}`)
        }
      }

      //if we had any sync at all flag all non global partitions..
      if(txQueueEntry.didSync){
        for (let key of txQueueEntry.uniqueKeys) {
          //if(this.globalAccountMap.has(key)){
          let {homePartition, addressNum} = ShardFunctions.addressToPartition(this.currentCycleShardData.shardGlobals, key)
          this.currentCycleShardData.partitionsToSkip.set(homePartition, true)
          //}
        }
      }


      if (txQueueEntry.hasShardInfo) {
        if (sendGossip && txQueueEntry.globalModification === false) {
          try {
            let transactionGroup = this.queueEntryGetTransactionGroup(txQueueEntry)
            if (transactionGroup.length > 1) {
              // should consider only forwarding in some cases?
              this.debugNodeGroup(txId, timestamp, `share to neighbors`, transactionGroup) 
              this.p2p.sendGossipIn('spread_tx_to_group', acceptedTx, '', sender, transactionGroup)
            }
          // this.logger.playbackLogNote('tx_homeGossip', `${txId}`, `AcceptedTransaction: ${acceptedTX}`)
          } catch (ex) {
            this.fatalLogger.fatal('txQueueEntry: ' + utils.stringifyReduce(txQueueEntry))
          }
        }

        if (txQueueEntry.didSync === false) {
        // see if our node shard data covers any of the accounts?
          this.queueEntryGetTransactionGroup(txQueueEntry) // this will compute our involvment
          if (txQueueEntry.ourNodeInvolved === false && txQueueEntry.globalModification === false) {
            // if globalModification === true then every node is in the group
            this.logger.playbackLogNote('shrd_notInTxGroup', `${txId}`, ``)
            return 'out of range'// we are done, not involved!!!
          } else {
            // let tempList =  // can be returned by the function below
            if (this.verboseLogs) this.mainLogger.debug(`routeAndQueueAcceptedTransaction: getOrderedSyncingNeighbors`)
            this.p2p.state.getOrderedSyncingNeighbors(this.currentCycleShardData.ourNode)
            // TODO: globalaccounts 
            // globalModification  TODO pass on to syncing nodes.   (make it pass on the flag too)
            // possibly need to send proof to the syncing node or there could be a huge security loophole.  should share the receipt as an extra parameter
            // or data repair will detect and reject this if we get tricked.  could be an easy attack vector
            if (this.currentCycleShardData.hasSyncingNeighbors === true ) {
              if( txQueueEntry.globalModification === false){
                this.logger.playbackLogNote('shrd_sync_tx', `${txId}`, `txts: ${timestamp} nodes:${utils.stringifyReduce(this.currentCycleShardData.syncingNeighborsTxGroup.map(x => x.id))}`)
                this.debugNodeGroup(txId, timestamp, `share to syncing neighbors`, this.currentCycleShardData.syncingNeighborsTxGroup) 
                this.p2p.sendGossipAll('spread_tx_to_group', acceptedTx, '', sender, this.currentCycleShardData.syncingNeighborsTxGroup)
                //This was using sendGossipAll, but changed it for a work around.  maybe this just needs to be a tell.                
              } else {
                if (this.verboseLogs) this.mainLogger.debug(`routeAndQueueAcceptedTransaction: bugfix detected. avoid forwarding txs where globalModification == true`)
              }
            }
          }
        }
      }
      this.newAcceptedTxQueueTempInjest.push(txQueueEntry)

      // start the queue if needed
      this.tryStartAcceptedQueue()
    } catch (error) {
      this.logger.playbackLogNote('shrd_addtoqueue_rejected', `${txId}`, `AcceptedTransaction: ${utils.makeShortHash(acceptedTx.id)} ts: ${txQueueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(txQueueEntry.txKeys.allKeys)}`)
      this.fatalLogger.fatal('routeAndQueueAcceptedTransaction failed: ' + error.name + ': ' + error.message + ' at ' + error.stack)
      throw new Error(error)
    }
    return true
  }

  tryStartAcceptedQueue () {
    if (!this.dataSyncMainPhaseComplete) {
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
  async _firstTimeQueueAwait () {
    if (this.newAcceptedTxQueueRunning) {
      this.fatalLogger.fatal('DATASYNC: newAcceptedTxQueueRunning')
      return
    }

    this.logger.playbackLogNote('_firstTimeQueueAwait', `this.newAcceptedTxQueue.length:${this.newAcceptedTxQueue.length} this.newAcceptedTxQueue.length:${this.newAcceptedTxQueue.length}`)

    await this.processAcceptedTxQueue()
  }

  getQueueEntry (txid: string) : QueueEntry | null {
  // todo perf need an interpolated or binary search on a sorted list
    for (let queueEntry of this.newAcceptedTxQueue) {
      if (queueEntry.acceptedTx.id === txid) {
        return queueEntry
      }
    }
    return null
  }

  getQueueEntryPending (txid: string): QueueEntry | null {
    // todo perf need an interpolated or binary search on a sorted list
    for (let queueEntry of this.newAcceptedTxQueueTempInjest) {
      if (queueEntry.acceptedTx.id === txid) {
        return queueEntry
      }
    }
    return null
  }

  getQueueEntrySafe (txid: string): QueueEntry | null {
    let queueEntry = this.getQueueEntry(txid)
    if (queueEntry == null) {
      return this.getQueueEntryPending(txid)
    }

    return queueEntry
  }

  getQueueEntryArchived (txid: string): QueueEntry | null {
    for (let queueEntry of this.archivedQueueEntries) {
      if (queueEntry.acceptedTx.id === txid) {
        return queueEntry
      }
    }
    // todo make this and error.
    this.mainLogger.error(`getQueueEntryArchived failed to find: ${txid}`)
    return null
  }

  queueEntryAddData (queueEntry:QueueEntry, data:any) {
    if (queueEntry.collectedData[data.accountId] != null) {
      return // already have the data
    }
    if(queueEntry.uniqueKeys == null){
      // cant have all data yet if we dont even have unique keys.
      throw new Error(`Attempting to add data and uniqueKeys are not available yet: ${utils.stringifyReduceLimit(queueEntry, 200)}`)
    }
    queueEntry.collectedData[data.accountId] = data
    queueEntry.dataCollected++

    queueEntry.originalData[data.accountId] = stringify(data)

    if (queueEntry.dataCollected === queueEntry.uniqueKeys.length) { //  queueEntry.tx Keys.allKeys.length
      queueEntry.hasAll = true
    }

    if (data.localCache) {
      queueEntry.localCachedData[data.accountId] = data.localCache
      delete data.localCache
    }

    this.logger.playbackLogNote('shrd_addData', `${utils.makeShortHash(queueEntry.acceptedTx.id)}`, `key ${utils.makeShortHash(data.accountId)} hasAll:${queueEntry.hasAll} collected:${queueEntry.dataCollected}  ${queueEntry.acceptedTx.timestamp}`)
  }

  queueEntryHasAllData (queueEntry: QueueEntry) {
    if (queueEntry.hasAll === true) {
      return true
    }
    if(queueEntry.uniqueKeys == null){
      throw new Error(`queueEntryHasAllData (queueEntry.uniqueKeys == null)`)
    }
    let dataCollected = 0
    for (let key of queueEntry.uniqueKeys) {
      if (queueEntry.collectedData[key] != null) {
        dataCollected++
      }
    }
    if (dataCollected === queueEntry.uniqueKeys.length) { //  queueEntry.tx Keys.allKeys.length uniqueKeys.length
      queueEntry.hasAll = true
      return true
    }
    return false
  }

  // THIS QUEUE ENTRY seems to be way off spec from the normal one, what is up?
  async queueEntryRequestMissingData (queueEntry:QueueEntry) {
    if(this.currentCycleShardData == null)
    {
      return
    }
    if (!queueEntry.requests) {
      queueEntry.requests = {}
    }
    if (queueEntry.uniqueKeys == null){
      throw new Error('queueEntryRequestMissingData queueEntry.uniqueKeys == null')
    }

    let allKeys = []
    for (let key of queueEntry.uniqueKeys) {
      if (queueEntry.collectedData[key] == null) {
        allKeys.push(key)
      }
    }

    this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_start', `${queueEntry.acceptedTx.id}`, `qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}`)

    for (let key of queueEntry.uniqueKeys) {
      if (queueEntry.collectedData[key] == null && queueEntry.requests[key] == null) {
        let keepTrying = true
        let triesLeft = 5
        while(keepTrying){

          if(triesLeft <= 0){
            keepTrying = false
            break
          }
          let homeNodeShardData = queueEntry.homeNodes[key] // mark outstanding request somehow so we dont rerequest

          // find a random node to ask that is not us
          let node = null
          let randomIndex
          let foundValidNode = false
          let maxTries = 1000
          while (foundValidNode == false) {
            maxTries--
            randomIndex = this.getRandomInt(homeNodeShardData.consensusNodeForOurNodeFull.length - 1)
            node = homeNodeShardData.consensusNodeForOurNodeFull[randomIndex]
            if(maxTries < 0){
              //FAILED
              this.fatalLogger.fatal(`queueEntryRequestMissingData: unable to find node to ask after 1000 tries tx:${utils.makeShortHash(queueEntry.acceptedTx.id)} key: ${utils.makeShortHash(key)} ${utils.stringifyReduce(homeNodeShardData.consensusNodeForOurNodeFull.map((x)=> (x!=null)? x.id : 'null'))}`)
              break
            }
            if(node == null){
              continue
            }
            if(node.id === this.currentCycleShardData.nodeShardData.node.id){
              continue
            }
            foundValidNode = true
          }

          if(node == null)
          {
            continue
          }

          // Todo: expand this to grab a consensus node from any of the involved consensus nodes.

          for (let key2 of allKeys) {
            queueEntry.requests[key2] = node
          }

          let relationString = ShardFunctions.getNodeRelation(homeNodeShardData, this.currentCycleShardData.ourNode.id)
          this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_ask', `${utils.makeShortHash(queueEntry.acceptedTx.id)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}`)

          let message = { keys: allKeys, txid: queueEntry.acceptedTx.id, timestamp: queueEntry.acceptedTx.timestamp }
          let result:RequestStateForTxResp = await this.p2p.ask(node, 'request_state_for_tx', message) // not sure if we should await this.

          if(result == null){
            this.mainLogger.error('ASK FAIL request_state_for_tx')
            this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_askfailretry', `${utils.makeShortHash(queueEntry.acceptedTx.id)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
            triesLeft--
            continue
          }
          if (result.success === false) { this.mainLogger.error('ASK FAIL queueEntryRequestMissingData 9') }
          let dataCountReturned = 0
          let accountIdsReturned = []
          for (let data of result.stateList) {
            this.queueEntryAddData(queueEntry, data)
            dataCountReturned++
            accountIdsReturned.push(utils.makeShortHash(data.accountId))
          }

          if (queueEntry.hasAll === true) {
            queueEntry.logstate = 'got all missing data'
          } else {
            queueEntry.logstate = 'failed to get data:' + queueEntry.hasAll
            // queueEntry.state = 'failed to get data'
          }

          this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_result', `${utils.makeShortHash(queueEntry.acceptedTx.id)}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

          // queueEntry.homeNodes[key] = null
          for (let key2 of allKeys) {
            //consider deleteing these instead?  
            //TSConversion changed to a delete opertaion should double check this
            //queueEntry.requests[key2] = null
            delete queueEntry.requests[key2]
          }

          if (queueEntry.hasAll === true) {
            break
          }

          keepTrying = false
        }
      }

    }
  }

  async repairToMatchReceipt (queueEntry:QueueEntry) {
    if(this.currentCycleShardData == null)
    {
      return
    }
    // if (!queueEntry.requests) {
    //   queueEntry.requests = {}
    // }
    if (queueEntry.uniqueKeys == null){
      throw new Error('repairToMatchReceipt queueEntry.uniqueKeys == null')
    }

    let shortHash = utils.makeShortHash(queueEntry.acceptedTx.id)
    // Need to build a list of what accounts we need, what state they should be in and who to get them from
    let requestObjects: {[id:string]:{appliedVote:AppliedVote, voteIndex:number, accountHash:string, accountId:string, nodeShardInfo:NodeShardData}} = {}
    let appliedVotes = queueEntry.appliedReceiptForRepair.appliedVotes
    //TODO could random shuffle the vote list
    let allKeys = []

    this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `appliedVotes ${utils.stringifyReduce(appliedVotes)}  `)
    this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

    for (let key of queueEntry.uniqueKeys) {

      let coveredKey = false
      for(let i = 0; i<appliedVotes.length; i++ ){
        let appliedVote = appliedVotes[i]
        for(let j = 0; j< appliedVote.account_id.length; j++){
          let id = appliedVote.account_id[j]
          let hash = appliedVote.account_state_hash_after[j]
          if(id === key && hash != null){
            if(requestObjects[key] != null){
              continue //we already have this request ready to go
            }

            coveredKey = true
            if(appliedVote.node_id === this.currentCycleShardData.ourNode.id ){
              //dont reference our own node, should not happen anyway
              this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `appliedVote.node_id != this.currentCycleShardData.ourNode.id ${utils.stringifyReduce(appliedVote.node_id)} our: ${utils.stringifyReduce(this.currentCycleShardData.ourNode.id)} `)
              continue
            }
            if(this.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false){
              this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `this.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false ${utils.stringifyReduce(appliedVote.node_id)} `)
              continue
            }
            let nodeShardInfo:NodeShardData2 = this.currentCycleShardData.nodeShardDataMap.get(appliedVote.node_id)

            if(nodeShardInfo == null){

            }
            if(ShardFunctions2.testAddressInRange(id, nodeShardInfo.storedPartitions ) == false){
              this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `address not in range ${utils.stringifyReduce(nodeShardInfo.storedPartitions)}`)
              continue
            }
            let objectToSet = {appliedVote, voteIndex:j, accountHash:hash, accountId:id, nodeShardInfo}
            this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `setting key ${utils.stringifyReduce(key)} ${utils.stringifyReduce(objectToSet)} `)
            requestObjects[key] = objectToSet
            allKeys.push(key)
          } else {

          }
        }
      }

      if(coveredKey === false){
        this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `coveredKey === false`)
        //todo log error on us not finding this key
      }
    }

    //let receipt = queueEntry.appliedReceiptForRepair

    this.logger.playbackLogNote('shrd_repairToMatchReceipt_start', `${shortHash}`, `qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  requestObject:${utils.stringifyReduce(requestObjects)}`)

    for (let key of queueEntry.uniqueKeys) {
      if ( requestObjects[key] != null) {
        let requestObject = requestObjects[key]

        if(requestObject == null){
          this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `requestObject == null`)

          continue
        }

        let node = requestObject.nodeShardInfo.node

        if(node == null){
          this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `node == null`)
          continue
        }

        let relationString = "" //ShardFunctions.getNodeRelation(homeNodeShardData, this.currentCycleShardData.ourNode.id)
        this.logger.playbackLogNote('shrd_repairToMatchReceipt_ask', `${shortHash}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}`)

        let message = { key: requestObject.accountId, hash:requestObject.accountHash, txid: queueEntry.acceptedTx.id, timestamp: queueEntry.acceptedTx.timestamp }
        let result:RequestStateForTxResp = await this.p2p.ask(node, 'request_state_for_tx_post', message) // not sure if we should await this.
        if (result.success === false) { this.mainLogger.error('ASK FAIL repairToMatchReceipt') }
        let dataCountReturned = 0
        let accountIdsReturned = []
        for (let data of result.stateList) {
          this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `write data: ${utils.stringifyReduce(data)}`)
          //Commit the data
          let dataToSet = [data]
          let failedHashes = await this.checkAndSetAccountData(dataToSet)
          await this.writeCombinedAccountDataToBackups(dataToSet, failedHashes)

          //update global cache?  that will be obsolete soona anyhow!


        }

        // if (queueEntry.hasAll === true) {
        //   queueEntry.logstate = 'got all missing data'
        // } else {
        //   queueEntry.logstate = 'failed to get data:' + queueEntry.hasAll
        //   // queueEntry.state = 'failed to get data'
        // }

        this.logger.playbackLogNote('shrd_repairToMatchReceipt_result', `${shortHash}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

        // // queueEntry.homeNodes[key] = null
        // for (let key2 of allKeys) {
        //   //consider deleteing these instead?  
        //   //TSConversion changed to a delete opertaion should double check this
        //   //queueEntry.requests[key2] = null
        //   delete queueEntry.requests[key2]
        // }

        // if (queueEntry.hasAll === true) {
        //   break
        // }
      }
    }

    // Set this when data has been repaired. 
    queueEntry.repairFinished = true
  }

  /**
   * queueEntryGetTransactionGroup
   * @param {QueueEntry} queueEntry
   * @returns {Node[]}
   */
  queueEntryGetTransactionGroup (queueEntry:QueueEntry): Shardus.Node[] {
    if(this.currentCycleShardData == null){
      throw new Error('queueEntryGetTransactionGroup: currentCycleShardData == null')
    }
    if(queueEntry.uniqueKeys == null){
      throw new Error('queueEntryGetTransactionGroup: queueEntry.uniqueKeys == null')
    }
    if (queueEntry.transactionGroup != null) {
      return queueEntry.transactionGroup
    }
    let txGroup = []
    let uniqueNodes:StringNodeObjectMap = {}

    let hasNonGlobalKeys = false
    for (let key of queueEntry.uniqueKeys) {
      let homeNode = queueEntry.homeNodes[key]
      // txGroup = Array.concat(txGroup, homeNode.nodeThatStoreOurParitionFull)
      if (homeNode == null) {
        if (this.verboseLogs) this.mainLogger.debug('queueEntryGetTransactionGroup homenode:null')
      }
      if (homeNode.extendedData === false) {
        ShardFunctions.computeExtendedNodePartitionData(this.currentCycleShardData.shardGlobals, this.currentCycleShardData.nodeShardDataMap, this.currentCycleShardData.parititionShardDataMap, homeNode, this.currentCycleShardData.activeNodes)
      }

      //may need to go back and sync this logic with how we decide what partition to save a record in.

      // If this is not a global TX then skip tracking of nodes for global accounts used as a reference.
      if(queueEntry.globalModification === false) {
        if(this.isGlobalAccount(key) === true){
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `queueEntryGetTransactionGroup skipping: ${utils.makeShortHash(key)} tx: ${utils.makeShortHash(queueEntry.acceptedTx.id)}`)
          continue
        } else {
          hasNonGlobalKeys = true;
        }
      }

      for (let node of homeNode.nodeThatStoreOurParitionFull) { // not iterable!
        uniqueNodes[node.id] = node
      }

      let scratch1 = {}
      for (let node of homeNode.nodeThatStoreOurParitionFull) { // not iterable!
        scratch1[node.id] = true
      }
      // make sure the home node is in there in case we hit and edge case
      uniqueNodes[homeNode.node.id] = homeNode.node

      // TODO STATESHARDING4 is this next block even needed:
      // HOMENODEMATHS need to patch in nodes that would cover this partition!
      // TODO PERF make an optimized version of this in ShardFunctions that is smarter about which node range to check and saves off the calculation
      // maybe this could go on the partitions.
      let {homePartition} = ShardFunctions.addressToPartition(this.currentCycleShardData.shardGlobals, key)
      if(homePartition != homeNode.homePartition){
        //loop all nodes for now
        for(let nodeID of this.currentCycleShardData.nodeShardDataMap.keys()){
          let nodeShardData:NodeShardData2 = this.currentCycleShardData.nodeShardDataMap.get(nodeID)
          let nodeStoresThisPartition = ShardFunctions.testInRange(homePartition, nodeShardData.storedPartitions)
          if(nodeStoresThisPartition === true && uniqueNodes[nodeID] == null){
            //setting this will cause it to end up in the transactionGroup
            uniqueNodes[nodeID] = nodeShardData.node
            queueEntry.patchedOnNodes.set(nodeID, nodeShardData)
          }
          // build index for patched nodes based on the home node:
          if(nodeStoresThisPartition === true){
            if(scratch1[nodeID] == null ){
              homeNode.patchedOnNodes.push(nodeShardData.node)
              scratch1[nodeID] = true
            }
          }
        }
      }
    }
    queueEntry.ourNodeInvolved = true
    if (uniqueNodes[this.currentCycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInvolved = false
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `queueEntryGetTransactionGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${utils.makeShortHash(queueEntry.acceptedTx.id)}`)
    }

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    uniqueNodes[this.currentCycleShardData.ourNode.id] = this.currentCycleShardData.ourNode

    let values = Object.values(uniqueNodes)
    for (let v of values) {
      txGroup.push(v)
    }
    queueEntry.transactionGroup = txGroup
    return txGroup
  }

  /**
   * queueEntryGetConsensusGroup
   * Gets a merged results of all the consensus nodes for all of the accounts involved in the transaction
   * Ignores global accounts if globalModification == false and the account is global
   * @param {QueueEntry} queueEntry
   * @returns {Node[]}
   */
  queueEntryGetConsensusGroup (queueEntry:QueueEntry): Shardus.Node[] {
    if(this.currentCycleShardData == null){
      throw new Error('queueEntryGetConsensusGroup: currentCycleShardData == null')
    }
    if(queueEntry.uniqueKeys == null){
      throw new Error('queueEntryGetConsensusGroup: queueEntry.uniqueKeys == null')
    }
    if (queueEntry.conensusGroup != null) {
      return queueEntry.conensusGroup
    }
    let txGroup = []
    let uniqueNodes:StringNodeObjectMap = {}

    let hasNonGlobalKeys = false
    for (let key of queueEntry.uniqueKeys) {
      let homeNode = queueEntry.homeNodes[key]
      if (homeNode == null) {
        if (this.verboseLogs) this.mainLogger.debug('queueEntryGetConsensusGroup homenode:null')
      }
      if (homeNode.extendedData === false) {
        ShardFunctions.computeExtendedNodePartitionData(this.currentCycleShardData.shardGlobals, this.currentCycleShardData.nodeShardDataMap, this.currentCycleShardData.parititionShardDataMap, homeNode, this.currentCycleShardData.activeNodes)
      }

      // TODO STATESHARDING4 GLOBALACCOUNTS is this next block of logic needed?
      // If this is not a global TX then skip tracking of nodes for global accounts used as a reference.
      if(queueEntry.globalModification === false) {
        if(this.isGlobalAccount(key) === true){
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `queueEntryGetConsensusGroup skipping: ${utils.makeShortHash(key)} tx: ${utils.makeShortHash(queueEntry.acceptedTx.id)}`)
          continue
        } else {
          hasNonGlobalKeys = true;
        }
      }

      for (let node of homeNode.consensusNodeForOurNodeFull) {
        uniqueNodes[node.id] = node
      }

      // make sure the home node is in there in case we hit and edge case
      uniqueNodes[homeNode.node.id] = homeNode.node
    }
    queueEntry.ourNodeInvolved = true
    if (uniqueNodes[this.currentCycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInvolved = false
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `queueEntryGetConsensusGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${utils.makeShortHash(queueEntry.acceptedTx.id)}`)
    }

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    uniqueNodes[this.currentCycleShardData.ourNode.id] = this.currentCycleShardData.ourNode

    let values = Object.values(uniqueNodes)
    for (let v of values) {
      txGroup.push(v)
    }
    queueEntry.conensusGroup = txGroup
    return txGroup
  }



  // should work even if there are zero nodes to tell and should load data locally into queue entry
  async tellCorrespondingNodes (queueEntry:QueueEntry) {
    if(this.currentCycleShardData == null){
      throw new Error('tellCorrespondingNodes: currentCycleShardData == null')
    }
    if(queueEntry.uniqueKeys == null){
      throw new Error('tellCorrespondingNodes: queueEntry.uniqueKeys == null')
    }
    // Report data to corresponding nodes
    let ourNodeData = this.currentCycleShardData.nodeShardData
    // let correspondingEdgeNodes = []
    let correspondingAccNodes = []
    let dataKeysWeHave = []
    let dataValuesWeHave = []
    let datas:{[accountID:string]:any} = {}
    let remoteShardsByKey:{[accountID:string]:NodeShardData2} = {} // shard homenodes that we do not have the data for.
    let loggedPartition = false
    for (let key of queueEntry.uniqueKeys) {
      ///   test here
      // let hasKey = ShardFunctions.testAddressInRange(key, ourNodeData.storedPartitions)
      // todo : if this works maybe a nicer or faster version could be used
      let hasKey = false
      let homeNode = queueEntry.homeNodes[key]
      if (homeNode.node.id === ourNodeData.node.id) {
        hasKey = true
      } else {
        for (let node of homeNode.nodeThatStoreOurParitionFull) {
          if (node.id === ourNodeData.node.id) {
            hasKey = true
            break
          }
          
        }
      }

      // HOMENODEMATHS tellCorrespondingNodes patch the value of hasKey
      // did we get patched in
      if(queueEntry.patchedOnNodes.has(ourNodeData.node.id)){
        hasKey = true
      }

      // for(let patchedNodeID of queueEntry.patchedOnNodes.values()){
      // }

      let isGlobalKey = false
      //intercept that we have this data rather than requesting it.
      if(this.globalAccountMap.has(key)){
        hasKey = true
        isGlobalKey = true
        this.logger.playbackLogNote('globalAccountMap', `tellCorrespondingNodes - has`)
      }

      if(hasKey === false) {
        if(loggedPartition === false){
          loggedPartition = true
          if (this.verboseLogs) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull.map( (v) => v.id))}`)
          if (this.verboseLogs) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: full: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull)}`)
        }
        if (this.verboseLogs) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false  key: ${utils.stringifyReduce(key)}`)
      }

      if (hasKey) { // todo Detect if our node covers this paritition..  need our partition data
        let data = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
        //only queue this up to share if it is not a global account. global accounts dont need to be shared.

        //if this is not freshly created data then we need to make a backup copy of it!!
        //This prevents us from changing data before the commiting phase
        if(data.accountCreated == false){
          data = utils.deepCopy(data)
        }

        if(isGlobalKey === false)
        {
          datas[key] = data
          dataKeysWeHave.push(key)
          dataValuesWeHave.push(data)          
        }

        queueEntry.localKeys[key] = true
        // add this data to our own queue entry!!
        this.queueEntryAddData(queueEntry, data)
      } else {
        remoteShardsByKey[key] = queueEntry.homeNodes[key]
      }
    }
    if(queueEntry.globalModification === true){
      this.logger.playbackLogNote('tellCorrespondingNodes', `tellCorrespondingNodes - globalModification = true, not telling other nodes`)
      return
    }

    let message
    let edgeNodeIds = []
    let consensusNodeIds = []

    let nodesToSendTo:StringNodeObjectMap = {}
    for (let key of queueEntry.uniqueKeys) {
      if (datas[key] != null) {
        for (let key2 of queueEntry.uniqueKeys) {
          if (key !== key2) {
            let localHomeNode = queueEntry.homeNodes[key]
            let remoteHomeNode = queueEntry.homeNodes[key2]

            let ourLocalConsensusIndex = localHomeNode.consensusNodeForOurNodeFull.findIndex((a) => a.id === ourNodeData.node.id)
            if (ourLocalConsensusIndex === -1) {
              continue
            }

            // must add one to each lookup index!
            let indicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.consensusNodeForOurNodeFull.length, ourLocalConsensusIndex + 1)
            let edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.edgeNodes.length, ourLocalConsensusIndex + 1)

            let patchIndicies = []
            if(remoteHomeNode.patchedOnNodes.length > 0){
              patchIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.patchedOnNodes.length, ourLocalConsensusIndex + 1)

            }

            
            // HOMENODEMATHS need to work out sending data to our patched range.
            // let edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.edgeNodes.length, ourLocalConsensusIndex + 1)

            // for each remote node lets save it's id
            for (let index of indicies) {
              let node = remoteHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node != null && node !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                consensusNodeIds.push(node.id)
              }
            }
            for (let index of edgeIndicies) {
              let node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node != null && node !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                edgeNodeIds.push(node.id)
              }
            }

            for (let index of patchIndicies) {
              let node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node != null && node !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                //edgeNodeIds.push(node.id)
              }
            }


            correspondingAccNodes = Object.values(nodesToSendTo)
            let dataToSend = []
            dataToSend.push(datas[key]) // only sending just this one key at a time
            message = { stateList: dataToSend, txid: queueEntry.acceptedTx.id }
            if (correspondingAccNodes.length > 0) {
              let remoteRelation = ShardFunctions.getNodeRelation(remoteHomeNode, this.currentCycleShardData.ourNode.id)
              let localRelation = ShardFunctions.getNodeRelation(localHomeNode, this.currentCycleShardData.ourNode.id)
              this.logger.playbackLogNote('shrd_tellCorrespondingNodes', `${queueEntry.acceptedTx.id}`, `remoteRel: ${remoteRelation} localrel: ${localRelation} qId: ${queueEntry.entryID} AccountBeingShared: ${utils.makeShortHash(key)} EdgeNodes:${utils.stringifyReduce(edgeNodeIds)} ConsesusNodes${utils.stringifyReduce(consensusNodeIds)}`)
              this.p2p.tell(correspondingAccNodes, 'broadcast_state', message)
            }
          }
        }
      }
    }
  }

  /**
   * removeFromQueue remove an item from the queue and place it in the archivedQueueEntries list for awhile in case we have to access it again
   * @param {QueueEntry} queueEntry
   * @param {number} currentIndex
   */
  removeFromQueue (queueEntry: QueueEntry, currentIndex: number) {
    this.newAcceptedTxQueue.splice(currentIndex, 1)
    this.archivedQueueEntries.push(queueEntry)
    // period cleanup will usually get rid of these sooner if the list fills up
    if (this.archivedQueueEntries.length > this.archivedQueueEntryMaxCount) {
      this.archivedQueueEntries.shift()
    }
  }

  //
  //    PPPPPPPP
  //    P       P
  //    P       P
  //    P       P
  //    PPPPPPPP
  //    P
  //    P
  //    p
  //    P
  //
  //
  //
  async processAcceptedTxQueue () {
    let seenAccounts: SeenAccounts
    seenAccounts = {}// todo PERF we should be able to support using a variable that we save from one update to the next.  set that up after initial testing
    try {
      if(this.currentCycleShardData == null)
      {
        return
      }

      if (this.newAcceptedTxQueue.length === 0 && this.newAcceptedTxQueueTempInjest.length === 0) {
        return
      }
      if (this.newAcceptedTxQueueRunning === true) {
        return
      }
      if (this.queueRestartCounter == null) {
        this.queueRestartCounter = 0
      }
      this.queueRestartCounter++

      let localRestartCounter = this.queueRestartCounter

      this.newAcceptedTxQueueRunning = true

      let acceptedTXCount = 0
      let edgeFailDetected = false

      let timeM = this.queueSitTime
      let timeM2 = timeM * 2
      let timeM3 = timeM * 3
      let currentTime = Date.now() // when to update this?


      // let seenAccounts2 = new Map()
      // todo move these functions out where they are not constantly regenerate
      let accountSeen = function (queueEntry: QueueEntry) {
        if(queueEntry.uniqueKeys == null){
          //TSConversion double check if this needs extra logging
          return false
        }
        for (let key of queueEntry.uniqueKeys) {
          if (seenAccounts[key] != null) {
            return true
          }
          // if (seenAccounts2.has(key)) {
          //   this.fatalLogger.fatal('map fail in seenAccounts')
          //   return true
          // }
        }
        return false
      }
      let markAccountsSeen = function (queueEntry: QueueEntry) {
        if(queueEntry.uniqueKeys == null){
          //TSConversion double check if this needs extra logging
          return
        }
        for (let key of queueEntry.uniqueKeys) {
          if (seenAccounts[key] == null) {
            seenAccounts[key] = queueEntry
          }
          // seenAccounts2.set(key, true)
        }
      }
      // if we are the oldest ref to this you can clear it.. only ok because younger refs will still reflag it in time
      let clearAccountsSeen = function (queueEntry: QueueEntry) {
        if(queueEntry.uniqueKeys == null){
          //TSConversion double check if this needs extra logging
          return
        }
        for (let key of queueEntry.uniqueKeys) {
          if (seenAccounts[key] === queueEntry) {
            seenAccounts[key] = null
          }
          // seenAccounts2.delete(key)
        }
      }

      let app = this.app
      let verboseLogs = this.verboseLogs
      let debugAccountData = function (queueEntry: QueueEntry, app: Shardus.App) {
        let debugStr = ''
        if (verboseLogs) {
          if(queueEntry.uniqueKeys == null){
            //TSConversion double check if this needs extra logging
            return utils.makeShortHash(queueEntry.acceptedTx.id) + ' uniqueKeys empty error'
          }
          for (let key of queueEntry.uniqueKeys) {
            if (queueEntry.collectedData[key] != null) {
              debugStr += utils.makeShortHash(key) + ' : ' + app.getAccountDebugValue(queueEntry.collectedData[key]) + ', '
            }
          }
        }
        return debugStr
      }

      // process any new queue entries that were added to the temporary list
      if (this.newAcceptedTxQueueTempInjest.length > 0) {
        for (let txQueueEntry of this.newAcceptedTxQueueTempInjest) {
          let timestamp = txQueueEntry.txKeys.timestamp
          let acceptedTx = txQueueEntry.acceptedTx
          let txId = acceptedTx.receipt.txHash
          // sorted insert = sort by timestamp
          // todo faster version (binary search? to find where we need to insert)
          let index = this.newAcceptedTxQueue.length - 1
          let lastTx = this.newAcceptedTxQueue[index]

          while (index >= 0 && ((timestamp > lastTx.txKeys.timestamp) || (timestamp === lastTx.txKeys.timestamp && txId < lastTx.acceptedTx.id))) {
            index--
            lastTx = this.newAcceptedTxQueue[index]
          }

          //TODO check time before inserting queueEntry. make sure it is not older than 90% of M
          let age = Date.now() - timestamp
          if (age > timeM * 0.9) {
            //if(this.dataSyncMainPhaseComplete === true){
              this.fatalLogger.fatal('processAcceptedTxQueue cannot accept tx older than 0.9M ' + timestamp + ' age: ' + age)
              this.logger.playbackLogNote('shrd_processAcceptedTxQueueTooOld1', `${utils.makeShortHash(txQueueEntry.acceptedTx.id)}`, 'processAcceptedTxQueue working on older tx ' + timestamp + ' age: ' + age)
            //} else {

            //}

            //txQueueEntry.waitForReceiptOnly = true
          }
          if (age > timeM) {
            this.logger.playbackLogNote('shrd_processAcceptedTxQueueTooOld2', `${utils.makeShortHash(txQueueEntry.acceptedTx.id)}`, 'processAcceptedTxQueue working on older tx ' + timestamp + ' age: ' + age)
            txQueueEntry.waitForReceiptOnly = true
            txQueueEntry.state = 'consensing'
          }

          txQueueEntry.approximateCycleAge = this.currentCycleShardData.cycleNumber
          this.newAcceptedTxQueue.splice(index + 1, 0, txQueueEntry)
          this.logger.playbackLogNote('shrd_addToQueue', `${txId}`, `AcceptedTransaction: ${utils.makeShortHash(acceptedTx.id)} ts: ${txQueueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(txQueueEntry.txKeys.allKeys)} indexInserted: ${index + 1}`)
          this.emit('txQueued', acceptedTx.receipt.txHash)
        }
        this.newAcceptedTxQueueTempInjest = []
      }

      let currentIndex = this.newAcceptedTxQueue.length - 1

      let lastLog = 0
      while (this.newAcceptedTxQueue.length > 0) {
        if (currentIndex < 0) {
          break
        }
        let queueEntry: QueueEntry = this.newAcceptedTxQueue[currentIndex]
        let txTime = queueEntry.txKeys.timestamp
        let txAge = currentTime - txTime
        if (txAge < timeM) {
          break
        }

        if (localRestartCounter < this.queueRestartCounter && lastLog !== this.queueRestartCounter) {
          lastLog = this.queueRestartCounter
          this.logger.playbackLogNote('queueRestart_error', `${queueEntry.acceptedTx.id}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter}  qrstGlobal:${this.queueRestartCounter}}`)
        }
        // // fail the message if older than m3
        // if (queueEntry.hasAll === false && txAge > timeM3) {
        //   queueEntry.state = 'failed'
        //   removeFromQueue(queueEntry, currentIndex)
        //   continue
        // }
        let hasReceivedApplyReceipt = queueEntry.recievedAppliedReceipt != null
        let shortID = `${utils.makeShortHash(queueEntry.acceptedTx.id)}`

        if(this.dataSyncMainPhaseComplete === true){
          //check for TX older than M3 and expire them
          if(txAge > timeM3) {
            //this.statistics.incrementCounter('txExpired')
            queueEntry.state = 'expired'
            this.removeFromQueue(queueEntry, currentIndex)
            this.logger.playbackLogNote('txExpired', `${shortID}`, `txExpired ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
            this.logger.playbackLogNote('txExpired', `${shortID}`, `queueEntry.recievedAppliedReceipt: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

            currentIndex--
            continue
          }          
        }

        if(txAge > timeM2 && queueEntry.m2TimeoutReached === false && queueEntry.globalModification === false){
          this.logger.playbackLogNote('shrd_processAcceptedTxQueueTooOld3', `${shortID}`, 'processAcceptedTxQueue working on older tx ' + queueEntry.acceptedTx.timestamp + ' age: ' + txAge)
          queueEntry.waitForReceiptOnly = true
          queueEntry.m2TimeoutReached = true
          queueEntry.state = 'consensing'
          continue
        }
        
        // TODO STATESHARDING4 Does this queueEntry have a receipt?
        //     
        //  A: if preapply results match the receipt results
        //  if we have the data we need to apply it:
        //       queueEntry.state = 'commiting'  
        //
        //  B: if they dont match then
        //     -sync account from another node (based on hash values in receipt)
        //     Write the data that synced
        //
        //  C: if we get a receipt but have not pre applied yet?
        //     ? would still be waiting on data.
        //     this is not normal.  a node would be really behind.  Just do the data repair like step "B"
        
        if (queueEntry.state === 'syncing') { ///////////////////////////////////////////////--syncing--////////////////////////////////////////////////////////////
          markAccountsSeen(queueEntry)

        } else if (queueEntry.state === 'aging') { ///////////////////////////////////////////--aging--////////////////////////////////////////////////////////////////
          // we know that tx age is greater than M
          queueEntry.state = 'processing'
          markAccountsSeen(queueEntry)
        } else if (queueEntry.state === 'processing') { ////////////////////////////////////////--processing--///////////////////////////////////////////////////////////////////
          if (accountSeen(queueEntry) === false) {
            markAccountsSeen(queueEntry)
            try {
              //if(queueEntry.globalModification === false) {
                await this.tellCorrespondingNodes(queueEntry)
                if (this.verboseLogs) this.logger.playbackLogNote('shrd_processing', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter}  values: ${debugAccountData(queueEntry, app)}`)
              //}
             } catch (ex) {
              this.mainLogger.debug('processAcceptedTxQueue2 tellCorrespondingNodes:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
              this.fatalLogger.fatal('processAcceptedTxQueue2 tellCorrespondingNodes:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
            } finally {
              queueEntry.state = 'awaiting data'
            }
          }
          markAccountsSeen(queueEntry)
        } else if (queueEntry.state === 'awaiting data') { ///////////////////////////////////////--awaiting data--////////////////////////////////////////////////////////////////////
          

          // TODO STATESHARDING4 GLOBALACCOUNTS need to find way to turn this back on..
          // if(queueEntry.globalModification === true){
          //   markAccountsSeen(queueEntry)
          //   // no data to await.
          //   queueEntry.state = 'applying'
          //   currentIndex--
          //   continue
          // }
          // check if we have all accounts
          if (queueEntry.hasAll === false && txAge > timeM2) {

            //TODO STATESHARDING4 in theory this shouldn't be able to happen

            markAccountsSeen(queueEntry)
            if (this.queueEntryHasAllData(queueEntry) === true) {
              // I think this can't happen
              this.logger.playbackLogNote('shrd_hadDataAfterall', `${shortID}`, `This is kind of an error, and should not happen`)
              currentIndex--
              continue
            }

            // if (queueEntry.hasAll === false && txAge > timeM3) {
            //   queueEntry.state = 'failed'
            //   removeFromQueue(queueEntry, currentIndex)
            //   continue
            // }

            // 7.  Manually request missing state
            try {
              // TODO consider if this function should set 'failed to get data'
              // note this is call is not awaited.  is that ok?
              // 
              // TODO STATESHARDING4 should we await this.  I think no since this waits on outside nodes to respond
              this.queueEntryRequestMissingData(queueEntry)

            } catch (ex) {
              this.mainLogger.debug('processAcceptedTxQueue2 queueEntryRequestMissingData:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
              this.fatalLogger.fatal('processAcceptedTxQueue2 queueEntryRequestMissingData:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
            }
          } else if (queueEntry.hasAll) {
            if (accountSeen(queueEntry) === false) {
              markAccountsSeen(queueEntry)

              // As soon as we have all the data we preApply it and then send out a vote
              if (this.verboseLogs) this.logger.playbackLogNote('shrd_preApplyTx', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)

              // TODO sync related need to reconsider how to set this up again
              // if (queueEntry.didSync) {
              //   this.logger.playbackLogNote('shrd_sync_consensing', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}`)
              //   // if we did sync it is time to JIT query local data.  alternatively could have other nodes send us this data, but that could be very high bandwidth.
              //   for (let key of queueEntry.syncKeys) {
              //     let wrappedState = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
              //     this.logger.playbackLogNote('shrd_sync_getLocalData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}  key:${utils.makeShortHash(key)} hash:${wrappedState.stateId}`)
              //     queueEntry.localCachedData[key] = wrappedState.localCache
              //   }
              // }

              let wrappedStates = queueEntry.collectedData
              let localCachedData = queueEntry.localCachedData
              try {
                let filter:AccountFilter = {}
                // need to convert to map of numbers, could refactor this away later
                for(let key of Object.keys(queueEntry.localKeys)){
                  filter[key] = (queueEntry[key] == true)? 1 : 0
                }

                // Need to go back and thing on how this was supposed to work:
                // queueEntry.acceptedTx.transactionGroup = queueEntry.transactionGroup // Used to not double count txProcessed
                let txResult = await this.preApplyAcceptedTransaction(queueEntry.acceptedTx, wrappedStates, localCachedData, filter)

                // TODO STATESHARDING4 evaluate how much of this we still need, does the edge fail stuff still matter
                if (txResult != null ) {
                  if( txResult.passed === true){
                    acceptedTXCount++
                  }
                  // clearAccountsSeen(queueEntry)
                } else {
                  // clearAccountsSeen(queueEntry)
                  // if (!edgeFailDetected && acceptedTXCount > 0) {
                  //   edgeFailDetected = true
                  //   if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `processAcceptedTxQueue edgeFail ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
                  //   this.fatalLogger.fatal(this.dataPhaseTag + `processAcceptedTxQueue edgeFail ${utils.stringifyReduce(queueEntry.acceptedTx)}`) // todo: consider if this is just an error
                  // }
                }

                if(txResult != null && txResult.applied === true){
                  queueEntry.state = 'consensing'

                  queueEntry.preApplyTXResult = txResult
                  //Broadcast our vote
                  if(queueEntry.noConsensus === true){
                    // not sure about how to share or generate an applied receipt though for a no consensus step
                    if (this.verboseLogs) this.logger.playbackLogNote('shrd_preApplyTx_noConsensus', `${shortID}`, ``)

                    this.mainLogger.debug(`processAcceptedTxQueue2 noConsensus : ${utils.stringifyReduce(queueEntry.acceptedTx.id)} `)
                    
                    //await this.createAndShareVote(queueEntry)
                    
                    queueEntry.state = 'commiting'

                    // if(queueEntry.globalModification === false){
                    //   //Send a special receipt because this is a set command.
                      
                    // }
                  } else {
                    if (this.verboseLogs) this.logger.playbackLogNote('shrd_preApplyTx_createAndShareVote', `${shortID}`, ``)
                    this.mainLogger.debug(`processAcceptedTxQueue2 createAndShareVote : ${utils.stringifyReduce(queueEntry.acceptedTx.id)} `)
                    await this.createAndShareVote(queueEntry)
                  }
                } else {
                  this.mainLogger.error(`processAcceptedTxQueue2 txResult problem txid:${utils.stringifyReduce(queueEntry.acceptedTx.id)} res: ${utils.stringifyReduce(txResult)} `)
                }
              } catch (ex) {
                this.mainLogger.debug('processAcceptedTxQueue2 preApplyAcceptedTransaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                this.fatalLogger.fatal('processAcceptedTxQueue2 preApplyAcceptedTransaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
              } finally {
    
                if (this.verboseLogs) this.logger.playbackLogNote('shrd_preapplyFinish', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
              }
            }
            markAccountsSeen(queueEntry)
          }
        } else if (queueEntry.state === 'consensing') { /////////////////////////////////////////--consensing--//////////////////////////////////////////////////////////////////
            if (accountSeen(queueEntry) === false) {
              markAccountsSeen(queueEntry)

              let didNotMatchReceipt = false

              this.mainLogger.debug(`processAcceptedTxQueue2 consensing : ${utils.stringifyReduce(queueEntry.acceptedTx.id)} receiptRcv:${hasReceivedApplyReceipt}`)
              let result = this.tryProduceReceipt(queueEntry)
              if(result != null){
                if(this.hasAppliedReceiptMatchingPreApply(queueEntry, result)){
                  if (this.verboseLogs) this.logger.playbackLogNote('shrd_consensingComplete_madeReceipt', `${shortID}`, `qId: ${queueEntry.entryID}  `)

                  // Broadcast the receipt
                  await this.shareAppliedReceipt(queueEntry)
                  queueEntry.state = 'commiting'
                  continue

                } else{
                  if (this.verboseLogs) this.logger.playbackLogNote('shrd_consensingComplete_gotReceiptNoMatch1', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                  didNotMatchReceipt = true
                  queueEntry.appliedReceiptForRepair = result
                }

              }     
              
              // if we got a reciept while waiting see if we should use it
              if(hasReceivedApplyReceipt){
                if(this.hasAppliedReceiptMatchingPreApply(queueEntry, queueEntry.recievedAppliedReceipt)){
                  if (this.verboseLogs) this.logger.playbackLogNote('shrd_consensingComplete_gotReceipt', `${shortID}`, `qId: ${queueEntry.entryID} `)
                  queueEntry.state = 'commiting'
                  continue
                } else{
                  if (this.verboseLogs) this.logger.playbackLogNote('shrd_consensingComplete_gotReceiptNoMatch2', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                  didNotMatchReceipt = true
                  queueEntry.appliedReceiptForRepair = queueEntry.recievedAppliedReceipt
                }
              } else {
                //just keep waiting.
              }

              // we got a receipt but did not match it.
              if(didNotMatchReceipt === true){
                if (this.verboseLogs) this.logger.playbackLogNote('shrd_consensingComplete_didNotMatchReceipt', `${shortID}`, `qId: ${queueEntry.entryID} result:${queueEntry.appliedReceiptForRepair.result} `)
                queueEntry.repairFinished = false
                if(queueEntry.appliedReceiptForRepair.result === true){
                  // need to start repair process and wait
                  this.repairToMatchReceipt(queueEntry)
                  queueEntry.state = 'await repair'
                } else {
                  // we are finished since there is nothing to apply
                  this.removeFromQueue(queueEntry, currentIndex)
                  queueEntry.state = 'fail'
                }
              }
            }
            markAccountsSeen(queueEntry)
        } else if (queueEntry.state === 'await repair') {  ///////////////////////////////////////////--await repair--////////////////////////////////////////////////////////////////
          markAccountsSeen(queueEntry)

          // at this point we are just waiting to see if we applied the data and repaired correctlyl
          if(queueEntry.repairFinished === true){
            if (this.verboseLogs) this.logger.playbackLogNote('shrd_awaitRepair_repairFinished', `${shortID}`, `qId: ${queueEntry.entryID} result:${queueEntry.appliedReceiptForRepair.result} `)
            this.removeFromQueue(queueEntry, currentIndex)
            if(queueEntry.appliedReceiptForRepair.result === true){
              queueEntry.state = 'pass'
            } else {
              // technically should never get here
              queueEntry.state = 'fail'
            }      
          }
        } else if (queueEntry.state === 'commiting') {  ///////////////////////////////////////////--commiting--////////////////////////////////////////////////////////////////
          if (accountSeen(queueEntry) === false) {
            markAccountsSeen(queueEntry)

            // TODO STATESHARDING4 Check if we have already commited the data from a receipt we saw earlier
            this.mainLogger.debug(`processAcceptedTxQueue2 commiting : ${utils.stringifyReduce(queueEntry.acceptedTx.id)} `)
            if (this.verboseLogs) this.logger.playbackLogNote('shrd_commitingTx', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
            this.emit('txPopped', queueEntry.acceptedTx.receipt.txHash)

            // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` processAcceptedTxQueue2. ${queueEntry.entryID} timestamp: ${queueEntry.txKeys.timestamp}`)

            // TODO STATESHARDING4 SYNC related need to reconsider how to set this up again
            // if (queueEntry.didSync) {
            //   this.logger.playbackLogNote('shrd_sync_commiting', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}`)
            //   // if we did sync it is time to JIT query local data.  alternatively could have other nodes send us this data, but that could be very high bandwidth.
            //   for (let key of queueEntry.syncKeys) {
            //     let wrappedState = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
            //     this.logger.playbackLogNote('shrd_sync_getLocalData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}  key:${utils.makeShortHash(key)} hash:${wrappedState.stateId}`)
            //     queueEntry.localCachedData[key] = wrappedState.localCache
            //   }
            // }



            let wrappedStates = queueEntry.collectedData // Object.values(queueEntry.collectedData)
            let localCachedData = queueEntry.localCachedData
            try {

              let canCommitTX = true
              if(queueEntry.noConsensus === true){
                // dont have a receipt for a non consensus TX. not even sure if we want to keep that!
                if(queueEntry.preApplyTXResult.passed === false){
                  canCommitTX = false
                }
               } else if(queueEntry.appliedReceipt != null) {
                // the final state of the queue entry will be pass or fail based on the receipt
                if(queueEntry.appliedReceipt.result === false){
                  canCommitTX = false
                }
              } else if(queueEntry.recievedAppliedReceipt != null) {
                // the final state of the queue entry will be pass or fail based on the receipt
                if(queueEntry.recievedAppliedReceipt.result === false){
                  canCommitTX = false
                }
              } else {
                canCommitTX = false
              }

              if (this.verboseLogs) this.logger.playbackLogNote('shrd_commitingTx', `${shortID}`, `canCommitTX: ${canCommitTX} `)
              if(canCommitTX){
                // this.mainLogger.debug(` processAcceptedTxQueue2. applyAcceptedTransaction ${queueEntry.entryID} timestamp: ${queueEntry.txKeys.timestamp} queuerestarts: ${localRestartCounter} queueLen: ${this.newAcceptedTxQueue.length}`)
                let filter:AccountFilter = {}
                // need to convert to map of numbers, could refactor this away later
                for(let key of Object.keys(queueEntry.localKeys)){
                  filter[key] = (queueEntry[key] == true)? 1 : 0
                }
                // Need to go back and thing on how this was supposed to work:
                //queueEntry.acceptedTx.transactionGroup = queueEntry.transactionGroup // Used to not double count txProcessed
                let hasStateTableData = false
                let repairing = false
                let commitResult = await this.commitConsensedTransaction( 
                  queueEntry.preApplyTXResult.applyResponse,   // TODO STATESHARDING4 ... if we get here from a non standard path may need to get this data from somewhere else
                  queueEntry.acceptedTx, 
                  hasStateTableData, 
                  repairing,
                  filter,
                  wrappedStates,
                  localCachedData
                  )

                if (commitResult != null && commitResult.success) {
                  
                }
              }
            } catch (ex) {
              this.mainLogger.debug('processAcceptedTxQueue2 commiting Transaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
              this.fatalLogger.fatal('processAcceptedTxQueue2 commiting Transaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
            } finally {
              clearAccountsSeen(queueEntry)
              this.removeFromQueue(queueEntry, currentIndex)

              if(queueEntry.noConsensus === true){
                // dont have a receipt for a non consensus TX. not even sure if we want to keep that!
                if(queueEntry.preApplyTXResult.passed === true){
                  queueEntry.state = 'pass'
                } else {
                  queueEntry.state = 'fail'
                }
                this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : noConsensus:${queueEntry.state} ${utils.stringifyReduce(queueEntry.acceptedTx.id)} `)
              } else if(queueEntry.appliedReceipt != null) {
                // the final state of the queue entry will be pass or fail based on the receipt
                if(queueEntry.appliedReceipt.result === true){
                  queueEntry.state = 'pass'
                } else {
                  queueEntry.state = 'fail'
                }
                this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : Recpt:${queueEntry.state} ${utils.stringifyReduce(queueEntry.acceptedTx.id)} `)
              } else if(queueEntry.recievedAppliedReceipt != null) {
                // the final state of the queue entry will be pass or fail based on the receipt
                if(queueEntry.recievedAppliedReceipt.result === true){
                  queueEntry.state = 'pass'
                } else {
                  queueEntry.state = 'fail'
                }
                this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : recvRecpt:${queueEntry.state} ${utils.stringifyReduce(queueEntry.acceptedTx.id)} `)
              } else {
                queueEntry.state = 'fail'

                this.mainLogger.error(`processAcceptedTxQueue2 commiting finished : no receipt ${utils.stringifyReduce(queueEntry.acceptedTx.id)} `)
              }

              
              if (this.verboseLogs) this.logger.playbackLogNote('shrd_commitingTxFinished', `${queueEntry.acceptedTx.id}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
            }

            // TODO STATESHARDING4 SYNC related.. need to consider how we will re activate this 
            // // do we have any syncing neighbors?
            // if (this.currentCycleShardData.hasSyncingNeighbors === true && queueEntry.globalModification === false) {
            // // let dataToSend = Object.values(queueEntry.collectedData)
            //   let dataToSend = []

            //   let keys = Object.keys(queueEntry.originalData)
            //   for (let key of keys) {
            //     dataToSend.push(JSON.parse(queueEntry.originalData[key]))
            //   }

            //   // maybe have to send localcache over, or require the syncing node to grab this data itself JIT!
            //   // let localCacheTransport = Object.values(queueEntry.localCachedData)

            //   // send data to syncing neighbors.
            //   if (this.currentCycleShardData.syncingNeighbors.length > 0) {
            //     let message = { stateList: dataToSend, txid: queueEntry.acceptedTx.id }
            //     this.logger.playbackLogNote('shrd_sync_dataTell', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID} AccountBeingShared: ${utils.stringifyReduce(queueEntry.txKeys.allKeys)} txid: ${utils.makeShortHash(message.txid)} nodes:${utils.stringifyReduce(this.currentCycleShardData.syncingNeighbors.map(x => x.id))}`)
            //     this.p2p.tell(this.currentCycleShardData.syncingNeighbors, 'broadcast_state', message)
            //   }
            // }
          }          
        } 
        // Disabled this because it cant happen..  TXs will time out instead now.
        // we could consider this as a state when attempting to get missing data fails
        // else if (queueEntry.state === 'failed to get data') {
        //   this.removeFromQueue(queueEntry, currentIndex)
        // }
        currentIndex--
      }
    } finally {
      // restart loop if there are still elements in it
      if (this.newAcceptedTxQueue.length > 0 || this.newAcceptedTxQueueTempInjest.length > 0) {
        setTimeout(() => { this.tryStartAcceptedQueue() }, 15)
      }

      this.newAcceptedTxQueueRunning = false
      this.lastSeenAccountsMap = seenAccounts
    }
  }


  /**
   * shareAppliedReceipt 
   * gossip the appliedReceipt to the transaction group
   * @param queueEntry 
   */
  async shareAppliedReceipt (queueEntry: QueueEntry) {
    if (this.verboseLogs) this.logger.playbackLogNote('shrd_shareAppliedReceipt', `${queueEntry.acceptedTx.id}`, `qId: ${queueEntry.entryID} `)

    let appliedReceipt = queueEntry.appliedReceipt

    // share the appliedReceipt.
    let sender = null
    let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)
    if (consensusGroup.length > 1) {
      // should consider only forwarding in some cases?
      this.debugNodeGroup(queueEntry.acceptedTx.id, queueEntry.acceptedTx.timestamp, `share appliedReceipt to neighbors`, consensusGroup) 
      this.p2p.sendGossipIn('spread_appliedReceipt',appliedReceipt , '', sender, consensusGroup)
    }

  }


  /**
   * hasAppliedReceiptMatchingPreApply
   * check if recievedAppliedReceipt matches what we voted for.
   * this implies that our pre apply had the same result.
   * 
   * @param queueEntry 
   */
  hasAppliedReceiptMatchingPreApply (queueEntry: QueueEntry, appliedReceipt:AppliedReceipt) : boolean {

    if(appliedReceipt == null){
      return false
    }
    
    if(queueEntry.ourVote == null){
      this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.acceptedTx.id} ourVote == null`)
      return false
    }

    if(appliedReceipt != null){

      if(appliedReceipt.result !== queueEntry.ourVote.transaction_result){
        this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.acceptedTx.id} ${appliedReceipt.result}, ${queueEntry.ourVote.transaction_result} appliedReceipt.result !== queueEntry.ourVote.transaction_result`)
        return false
      }
      if(appliedReceipt.txid !== queueEntry.ourVote.txid){
        this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.acceptedTx.id} appliedReceipt.txid !== queueEntry.ourVote.txid`)
        return false
      }
      if(appliedReceipt.appliedVotes.length === 0){
        this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.acceptedTx.id} appliedReceipt.appliedVotes.length`)
        return false
      }

      if(appliedReceipt.appliedVotes[0].cant_apply === true){
        // TODO STATESHARDING4 NEGATIVECASE    need to figure out what to do here
        this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.acceptedTx.id} appliedReceipt.appliedVotes[0].cant_apply === true`)
        return false
      }

      // TODO STATESHARDING4 check that al the account states were reported the same afterwards in our vote vs receipt
      this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.acceptedTx.id} `)
      this.logger.playbackLogNote('hasAppliedReceiptMatchingPreApply', `${queueEntry.acceptedTx.id}`, `  `)

    }


    return true
  }

  /**
   * tryProduceReceipt
   * try to produce an AppliedReceipt
   * if we can't do that yet return null
   * 
   * @param queueEntry 
   */
  tryProduceReceipt (queueEntry: QueueEntry) : (AppliedReceipt | null) {

    if(queueEntry.waitForReceiptOnly === true){
      return null
    }

    let passed = false
    let canProduceReceipt = false

    let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry) // todo use real consensus group!!!
    let requiredVotes = Math.round(consensusGroup.length * (2/3.0))

    let numVotes = queueEntry.collectedVotes.length

    if(numVotes < requiredVotes){
      // we need more votes
      return null
    }

    let passCount = 0
    let failCount = 0
    // tally our votes

    // TODO STATESHARDING4 CHECK VOTES PER CONSENSUS GROUP
    for(let i=0; i<numVotes; i++){
      let currentVote = queueEntry.collectedVotes[i]

      if(currentVote.transaction_result === true){
        passCount++
      } else {
        failCount++
      }
      
      if(passCount >= requiredVotes){
        canProduceReceipt = true
        passed = true
      }
      if(failCount >= requiredVotes){
        canProduceReceipt = true
        passed = false
      }
    }
    // TODO STATESHARDING4 There isn't really an analysis of account_state_hash_after.  seems like we should make sure the hashes match up


    this.logger.playbackLogNote('tryProduceReceipt', `${queueEntry.acceptedTx.id}`, `canProduceReceipt: ${canProduceReceipt} passed: ${passed} passCount: ${passCount} failCount: ${failCount} `)
    this.mainLogger.debug(`tryProduceReceipt canProduceReceipt: ${canProduceReceipt} passed: ${passed} passCount: ${passCount} failCount: ${failCount} `)

    // if we can create a receipt do that now
    if(canProduceReceipt === true){
      let appliedReceipt:AppliedReceipt = {
        txid:queueEntry.acceptedTx.id,
        result: passed,
        appliedVotes:[]
      }
      // grab just the votes that match the winning pass or fail status
      for(let i=0; i<numVotes; i++){
        let currentVote = queueEntry.collectedVotes[i]
        if(passed === currentVote.transaction_result){  
          appliedReceipt.appliedVotes.push(currentVote)
        }
      }
      // recored our generated receipt to the queue entry
      queueEntry.appliedReceipt = appliedReceipt
      return appliedReceipt
    }

    return null
  }

  sortByAccountId(first, second) {
    return utils.sortAscProp(first, second, 'accountId')
  }

  /**
   * createAndShareVote
   * create an AppliedVote
   * gossip the AppliedVote
   * @param queueEntry 
   */
  async createAndShareVote(queueEntry: QueueEntry) {
    if (this.verboseLogs) this.logger.playbackLogNote('shrd_createAndShareVote', `${queueEntry.acceptedTx.id}`, `qId: ${queueEntry.entryID} `)

    // TODO STATESHARDING4 CHECK VOTES PER CONSENSUS GROUP

    // create our applied vote
    let ourVote: AppliedVote = {
      txid:queueEntry.acceptedTx.id,
      transaction_result: queueEntry.preApplyTXResult.passed,
      account_id:[],
      account_state_hash_after:[],
      node_id: this.currentCycleShardData.ourNode.id,
      cant_apply: (queueEntry.preApplyTXResult.applied === false),
    }

    if(queueEntry.debugFail1 === true){
      if (this.verboseLogs) this.logger.playbackLogNote('shrd_createAndShareVote_debugFail1', `${queueEntry.acceptedTx.id}`, `qId: ${queueEntry.entryID} `)

      ourVote.transaction_result = !ourVote.transaction_result
    }

    // fill out the lists of account ids and after states
    // let applyResponse = queueEntry.preApplyTXResult.applyResponse //as ApplyResponse
    // if(applyResponse != null){
    //   //we need to sort this list and doing it in place seems ok
    //   applyResponse.stateTableResults.sort(this.sortByAccountId )
    //   for(let stateTableObject of applyResponse.stateTableResults ){

    //     ourVote.account_id.push(stateTableObject.accountId)
    //     ourVote.account_state_hash_after.push(stateTableObject.stateAfter)
    //   }
    // }

    let wrappedStates = queueEntry.collectedData
    
    if(wrappedStates != null){
      //we need to sort this list and doing it in place seems ok
      //applyResponse.stateTableResults.sort(this.sortByAccountId )
      for(let key of Object.keys(wrappedStates) ){
        let wrappedState = wrappedStates[key]

        //We have to update the hash now! Not sure if this is the greatest place but it needs to be done
        let updatedHash = this.app.calculateAccountHash(wrappedState.data)
        wrappedState.stateId = updatedHash

        ourVote.account_id.push(wrappedState.accountId )
        ourVote.account_state_hash_after.push(wrappedState.stateId)
      }
    }

    ourVote = this.crypto.sign(ourVote)

    // save our vote to our queueEntry
    queueEntry.ourVote = ourVote
    // also append it to the total list of votes
    this.tryAppendVote(queueEntry, ourVote)
    // share the vote via gossip
    let sender = null
    let consensusGroup = this.queueEntryGetConsensusGroup(queueEntry)
    if (consensusGroup.length >= 1 ) {
      // should consider only forwarding in some cases?
      this.debugNodeGroup(queueEntry.acceptedTx.id, queueEntry.acceptedTx.timestamp, `share tx vote to neighbors`, consensusGroup) 
      // TODO STATESHARDING4 ENDPOINTS this needs to change from gossip to a tell
      //this.p2p.sendGossipIn('spread_appliedVote', ourVote, '', sender, consensusGroup)

      this.mainLogger.debug(`createAndShareVote numNodes: ${consensusGroup.length} ourVote: ${utils.stringifyReduce(ourVote)} `)
      this.logger.playbackLogNote('createAndShareVote', `${queueEntry.acceptedTx.id}`, `numNodes: ${consensusGroup.length} ourVote: ${utils.stringifyReduce(ourVote)} `)

      this.p2p.tell(consensusGroup, 'spread_appliedVote', ourVote )
    }
  }

  /**
   * tryAppendVote
   * if we have not seen this vote yet search our list of votes and append it in 
   * the correct spot sorted by signer's id
   * @param queueEntry 
   * @param vote 
   */
  tryAppendVote (queueEntry: QueueEntry, vote:AppliedVote ) : boolean {
    let numVotes = queueEntry.collectedVotes.length

    this.logger.playbackLogNote('tryAppendVote', `${utils.stringifyReduce(queueEntry.acceptedTx.id)}`, `collectedVotes: ${queueEntry.collectedVotes.length}`)
    this.mainLogger.debug(`tryAppendVote collectedVotes: ${utils.stringifyReduce(queueEntry.acceptedTx.id)}   ${queueEntry.collectedVotes.length} `)


    // just add the vote if we dont have any yet
    if(numVotes === 0){
      queueEntry.collectedVotes.push(vote)
      return true
    }

    //compare to existing votes.  keep going until we find that this vote is already in the list or our id is at the right spot to insert sorted
    for(let i=0; i<numVotes; i++){
      let currentVote = queueEntry.collectedVotes[i]

      if(currentVote.sign.owner === vote.sign.owner){
        // already in our list so do nothing and return
        return false
      }
    }

    queueEntry.collectedVotes.push(vote)

    return true
  }


  async dumpAccountDebugData () {
    if (this.currentCycleShardData == null) {
      return
    }

    // hmm how to deal with data that is changing... it cant!!
    let partitionMap = this.currentCycleShardData.parititionShardDataMap

    let ourNodeShardData:NodeShardData = this.currentCycleShardData.nodeShardData
    // partittions:
    let partitionDump:DebugDumpPartitions = { partitions: [], cycle:0, rangesCovered:{} as DebugDumpRangesCovered,nodesCovered:{} as DebugDumpNodesCovered,allNodeIds:[], globalAccountIDs:[], globalAccountSummary:[], globalStateHash:""  }
    partitionDump.cycle = this.currentCycleShardData.cycleNumber

    // todo port this to a static stard function!
    // check if we are in the consenus group for this partition
    let minP = ourNodeShardData.consensusStartPartition // storedPartitions.partitionStart
    let maxP = ourNodeShardData.consensusEndPartition // storedPartitions.partitionEnd
    partitionDump.rangesCovered = { ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: (ourNodeShardData.nodeAddressNum / 0xffffffff), hP: ourNodeShardData.homePartition, cMin: minP, cMax: maxP, stMin: ourNodeShardData.storedPartitions.partitionStart, stMax: ourNodeShardData.storedPartitions.partitionEnd, numP: this.currentCycleShardData.shardGlobals.numPartitions }

    // todo print out coverage map by node index
    
    partitionDump.nodesCovered = { idx: ourNodeShardData.ourNodeIndex, ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: (ourNodeShardData.nodeAddressNum / 0xffffffff), hP: ourNodeShardData.homePartition, consensus: [], stored: [], extra: [], numP: this.currentCycleShardData.shardGlobals.numPartitions }
 
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

    if(this.currentCycleShardData.ourNode.status === 'active' ) {
      for (var [key, value] of partitionMap) {
        let partition:DebugDumpPartition = { parititionID: key, accounts: [], skip:{} as DebugDumpPartitionSkip }
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
          if(duplicateCheck[wrappedAccount.accountId] != null){
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
      for(let globalID in partitionDump.globalAccountIDs){

        let backupList:Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(globalID)
        //let globalAccount = this.globalAccountMap.get(globalID)
        if(backupList != null && backupList.length > 0){
          let globalAccount = backupList[backupList.length-1]
          let summaryObj = {id:globalID,  state : globalAccount.hash, ts:globalAccount.timestamp }
          globalAccountSummary.push(summaryObj)
        }

      }
      partitionDump.globalAccountSummary = globalAccountSummary
      let globalStateHash = this.crypto.hash(globalAccountSummary)
      partitionDump.globalStateHash = globalStateHash

    }

    this.shardLogger.debug(utils.stringifyReduce(partitionDump))
  }

  async waitForShardData () {
    // wait for shard data
    while (this.currentCycleShardData == null) {
      this.getCurrentCycleShardData()
      await utils.sleep(1000)
      this.logger.playbackLogNote('_waitForShardData', ` `, ` ${utils.stringifyReduce(this.currentCycleShardData)} `)
    }
  }

  // todo support metadata so we can serve up only a portion of the account
  // todo 2? communicate directly back to client... could have security issue.
  // todo 3? require a relatively stout client proof of work
  async getLocalOrRemoteAccount (address:string) : Promise<Shardus.WrappedDataFromQueue | null> {
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
    if(this.globalAccountMap.has(address)){
      globalAccount = this.globalAccountMap.get(address)
      this.logger.playbackLogNote('globalAccountMap', `getLocalOrRemoteAccount - has`)
      if(globalAccount != null){
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
    accountIsRemote = (ShardFunctions.partitionInConsensusRange(homePartition, minP, maxP) === false)

    // hack to say we have all the data
    if (this.currentCycleShardData.activeNodes.length <= this.currentCycleShardData.shardGlobals.consensusRadius) {
      accountIsRemote = false
    }
    if(forceLocalGlobalLookup){
      accountIsRemote = false
    }

    if (accountIsRemote) {
      let homeNode = ShardFunctions.findHomeNode(this.currentCycleShardData.shardGlobals, address, this.currentCycleShardData.parititionShardDataMap)
      if(homeNode== null){
        throw new Error(`getLocalOrRemoteAccount: no home node found`)
      }
      let message = { accountIds: [address] }
      let r:GetAccountDataWithQueueHintsResp | boolean = await this.p2p.ask(homeNode.node, 'get_account_data_with_queue_hints', message)
      if (r === false) { this.mainLogger.error('ASK FAIL getLocalOrRemoteAccount 10') }
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
      if(accountData.length > 1 || accountData.length == 0) {
        if (this.verboseLogs) this.getAccountFailDump(address, `getAccountDataByList() returned wrong element count: ${accountData}`)
      }
      return wrappedAccount
    }
    return null
  }
  getAccountFailDump (address: string, message: string) {
    // this.currentCycleShardData
    this.logger.playbackLogNote('getAccountFailDump', ` `, `${utils.makeShortHash(address)} ${message} `)
  }


  // HOMENODEMATHS is this used by any apps? it is not used by shardus
  async getRemoteAccount (address:string) {
    let wrappedAccount

    await this.waitForShardData()
    // TSConversion since this should never happen due to the above function should we assert that the value is non null?.  Still need to figure out the best practice.
    if (this.currentCycleShardData == null) {
      throw new Error('getRemoteAccount: network not ready')
    }

    let homeNode = ShardFunctions.findHomeNode(this.currentCycleShardData.shardGlobals, address, this.currentCycleShardData.parititionShardDataMap)
    if(homeNode== null){
      throw new Error(`getRemoteAccount: no home node found`)
    }
    let message = { accountIds: [address] }
    let result = await this.p2p.ask(homeNode.node, 'get_account_data_with_queue_hints', message)
    if (result === false) { this.mainLogger.error('ASK FAIL getRemoteAccount 11') }
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
  getClosestNodes (hash:string, count:number = 1) : Shardus.Node[] {
    if (this.currentCycleShardData == null) {
      throw new Error('getClosestNodes: network not ready')
    }
    let cycleShardData = this.currentCycleShardData
    let homeNode = ShardFunctions.findHomeNode(cycleShardData.shardGlobals, hash, cycleShardData.parititionShardDataMap)
    if(homeNode == null){
      throw new Error(`getClosestNodes: no home node found`)
    }

    // HOMENODEMATHS consider using partition of the raw hash instead of home node of hash
    let homeNodeIndex = homeNode.ourNodeIndex
    let idToExclude = ''
    let results = ShardFunctions.getNodesByProximity(cycleShardData.shardGlobals, cycleShardData.activeNodes, homeNodeIndex, idToExclude, count, true)

    return results
  }

  _distanceSortAsc(a:SimpleDistanceObject, b:SimpleDistanceObject){
    if(a.distance === b.distance){
      return 0
    }
    if(a.distance < b.distance){
      return -1
    } else{
      return 1
    }
  }
  getClosestNodesGlobal (hash:string, count:number) {
    let hashNumber = parseInt(hash.slice(0, 7), 16)
    let nodes = this.p2p.state.getActiveNodes()
    let nodeDistMap:{id:string, distance:number}[] = nodes.map(node => ({ id: node.id, distance: Math.abs(hashNumber - parseInt(node.id.slice(0, 7), 16)) }))
    nodeDistMap.sort(this._distanceSortAsc)////(a, b) => a.distance < b.distance)
    //console.log('SORTED NODES BY DISTANCE', nodes)
    return nodeDistMap.slice(0, count).map(node => node.id)
  }

  // TSConversion todo see if we need to log any of the new early exits.
  isNodeInDistance (shardGlobals: ShardGlobals2, parititionShardDataMap: ParititionShardDataMap2, hash:string, nodeId:string, distance:number) {
    let cycleShardData = this.currentCycleShardData
    if(cycleShardData == null){
      return false
    }
    // HOMENODEMATHS need to eval useage here
    let someNode = ShardFunctions.findHomeNode(cycleShardData.shardGlobals, nodeId, cycleShardData.parititionShardDataMap)
    if(someNode == null){
      return false
    }
    let someNodeIndex = someNode.ourNodeIndex

    let homeNode = ShardFunctions.findHomeNode(cycleShardData.shardGlobals, hash, cycleShardData.parititionShardDataMap)
    if(homeNode == null){
      return false
    }
    let homeNodeIndex = homeNode.ourNodeIndex

    let partitionDistance = Math.abs(someNodeIndex - homeNodeIndex)
    if (partitionDistance <= distance) {
      return true
    }
    return false
  }

  // TODO WrappedStates
  async setAccount (wrappedStates:WrappedResponses, localCachedData:LocalCachedData, applyResponse: Shardus.ApplyResponse, isGlobalModifyingTX:boolean, accountFilter?:AccountFilter ) {
    // let sourceAddress = inTx.srcAct
    // let targetAddress = inTx.tgtAct
    // let amount = inTx.txnAmt
    // let type = inTx.txnType
    // let time = inTx.txnTimestamp
    let canWriteToAccount = function (accountId:string) {
      return (!accountFilter) || (accountFilter[accountId] !== undefined)
    }

    let savedSomething = false

    let keys = Object.keys(wrappedStates)
    keys.sort() // have to sort this because object.keys is non sorted and we always use the [0] index for hashset strings
    for (let key of keys) {
      let wrappedData = wrappedStates[key]
      if(wrappedData == null){
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
      if(this.globalAccountMap.has(key)){
        
        if(isGlobalModifyingTX === false){
          this.logger.playbackLogNote('globalAccountMap', `setAccount - has`)
          if (this.verboseLogs) this.mainLogger.debug('setAccount: Not writing global account: ' + utils.makeShortHash(key) )
          continue          
        }
        if (this.verboseLogs) this.mainLogger.debug('setAccount: writing global account: ' + utils.makeShortHash(key) )
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

  /// /////////////////////////////////////////////////////////
  async fifoLock (fifoName:string): Promise<number> {


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

  fifoUnlock (fifoName:string, id: number) {
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
      this.fatalLogger.fatal(`Failed to unlock the fifo ${thisFifo.fifoName}: ${id}`)
    }
  }

  async _clearState () {
    await this.storage.clearAppRelatedState()
  }

  _stopQueue () {
    this.queueStopped = true
  }

  _clearQueue () {
    this.newAcceptedTxQueue = []
  }

  _registerListener (emitter:any, event:string, callback:any) {
    if (this._listeners[event]) {
      this.mainLogger.fatal('State Manager can only register one listener per event!')
      return
    }
    emitter.on(event, callback)
    this._listeners[event] = [emitter, callback]
  }

  _unregisterListener (event:string) {
    if (!this._listeners[event]) {
      this.mainLogger.warn(`This event listener doesn't exist! Event: \`${event}\` in StateManager`)
      return
    }
    const entry = this._listeners[event]
    const [emitter, callback] = entry
    emitter.removeListener(event, callback)
    delete this._listeners[event]
  }

  _cleanupListeners () {
    for (const event of Object.keys(this._listeners)) {
      this._unregisterListener(event)
    }
  }

  async cleanup () {
    this._stopQueue()
    this._unregisterEndpoints()
    this._clearQueue()
    this._cleanupListeners()
    await this._clearState()
  }

  //  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //  //////////////////////////////////////////////////          Data Repair                    ///////////////////////////////////////////////////////////
  //  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //
  //
  //   RRRRRRRRRRR
  //   R          R
  //   R          R
  //   R          R
  //   R RRRRRRRR
  //   R       R
  //   R        R
  //   R         R
  //   R          R
  //   R           R

  /**
   * getPartitionReport used by reporting (monitor server) to query if there is a partition report ready
   * @param {boolean} consensusOnly
   * @param {boolean} smallHashes
   * @returns {any}
   */
  // TSConversion todo define partition report. for now use any
  getPartitionReport (consensusOnly:boolean, smallHashes:boolean): any {
    let response = {}
    if (this.nextCycleReportToSend != null) {
      if (this.lastCycleReported < this.nextCycleReportToSend.cycleNumber || this.partitionReportDirty === true) {
        // consensusOnly hashes
        if (smallHashes === true) {
          for (let r of this.nextCycleReportToSend.res) {
            r.h = utils.makeShortHash(r.h)
          }
        }
        // Partition_hash: partitionHash, Partition_id:
        response = this.nextCycleReportToSend
        this.lastCycleReported = this.nextCycleReportToSend.cycleNumber // update reported cycle
        this.nextCycleReportToSend = null // clear it because we sent it
        this.partitionReportDirty = false // not dirty anymore

        this.mainLogger.debug('getPartitionReport: ' + `insync: ${this.stateIsGood} ` + utils.stringifyReduce(response))
      }
    }
    return response
  }

  /**
   * @param {PartitionObject} partitionObject
   */
  poMicroDebug (partitionObject: PartitionObject) {
    let header = `c${partitionObject.Cycle_number} p${partitionObject.Partition_id}`

    // need to get a list of compacted TXs in order. also addresses. timestamps?  make it so tools can process easily. (align timestamps view.)

    this.mainLogger.debug('poMicroDebug: ' + header)
  }

  /**
   * generatePartitionObjects
   * @param {Cycle} lastCycle
   */
  generatePartitionObjects (lastCycle:Shardus.Cycle) {
    let lastCycleShardValues = this.shardValuesByCycle.get(lastCycle.counter)

    // let partitions = ShardFunctions.getConsenusPartitions(lastCycleShardValues.shardGlobals, lastCycleShardValues.nodeShardData)
    // lastCycleShardValues.ourConsensusPartitions = partitions

    if(lastCycleShardValues == null){
      throw new Error('generatePartitionObjects lastCycleShardValues == null' + lastCycle.counter)
    }

    let partitions = lastCycleShardValues.ourConsensusPartitions
    if (this.repairAllStoredPartitions === true) {
      partitions = lastCycleShardValues.ourStoredPartitions
    }
    if(partitions == null){
      throw new Error('generatePartitionObjects partitions == null')
    }

    this.nextCycleReportToSend = { res: [], cycleNumber: lastCycle.counter }

    let partitionObjects = []
    let partitionResults = []
    let cycleKey = 'c' + lastCycle.counter
    for (let partitionNumber of partitions) {
      // TODO sharding - done.  when we add state sharding need to loop over partitions.
      let partitionObject = this.generatePartitionObject(lastCycle, partitionNumber)

      // Nodes sign the partition hash along with the Partition_id, Cycle_number and timestamp to produce a partition result.
      let partitionResult = this.generatePartitionResult(partitionObject)

      this.nextCycleReportToSend.res.push({ i: partitionResult.Partition_id, h: partitionResult.Partition_hash })

      // let partitionObjects = [partitionObject]
      // let partitionResults = [partitionResult]

      // this.partitionObjectsByCycle[cycleKey] = partitionObjects
      // this.ourPartitionResultsByCycle[cycleKey] = partitionResults // todo in the future there could be many results (one per covered partition)

      partitionObjects.push(partitionObject)
      partitionResults.push(partitionResult)

      this.partitionObjectsByCycle[cycleKey] = partitionObjects
      this.ourPartitionResultsByCycle[cycleKey] = partitionResults

      this.poMicroDebug(partitionObject)

      let partitionResultsByHash = this.recentPartitionObjectsByCycleByHash[cycleKey]
      if (partitionResultsByHash == null) {
        partitionResultsByHash = {}
        this.recentPartitionObjectsByCycleByHash[cycleKey] = partitionResultsByHash
      }
      // todo sharding done?  seems ok :   need to loop and put all results in this list
      // todo perf, need to clean out data from older cycles..
      partitionResultsByHash[partitionResult.Partition_hash] = partitionObject
    }

    // outside of the main loop
    // add our result to the list of all other results
    let responsesByPartition = this.allPartitionResponsesByCycleByPartition[cycleKey]
    if (!responsesByPartition) {
      responsesByPartition = {}
      this.allPartitionResponsesByCycleByPartition[cycleKey] = responsesByPartition
    }

    // this part should be good to go for sharding.
    for (let pResult of partitionResults) {
      let partitionKey = 'p' + pResult.Partition_id
      let responses = responsesByPartition[partitionKey]
      if (!responses) {
        responses = []
        responsesByPartition[partitionKey] = responses
      }
      let ourID = this.crypto.getPublicKey()
      // clean out an older response from same node if on exists
      responses = responses.filter((item) => item.sign && item.sign.owner !== ourID) // if the item is not signed clear it!
      responsesByPartition[partitionKey] = responses // have to re-assign this since it is a new ref to the array
      responses.push(pResult)
    }

    // return [partitionObject, partitionResult]
  }

  /**
   * generatePartitionResult
   * @param {PartitionObject} partitionObject
   * @returns {PartitionResult}
   */
  generatePartitionResult (partitionObject:PartitionObject): PartitionResult {

    let tempStates  = partitionObject.States
    partitionObject.States = []
    let partitionHash = /** @type {string} */(this.crypto.hash(partitionObject))
    partitionObject.States = tempStates //Temp fix. do not record states as part of hash (for now)

    /** @type {PartitionResult} */
    let partitionResult = { Partition_hash: partitionHash, Partition_id: partitionObject.Partition_id, Cycle_number: partitionObject.Cycle_number, hashSet: '' }

    // let stepSize = cHashSetStepSize
    if (this.useHashSets) {
      let hashSet = StateManager.createHashSetString(partitionObject.Txids, partitionObject.States) // TXSTATE_TODO
      partitionResult.hashSet = hashSet
    }

    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair partitionObject: ${utils.stringifyReduce(partitionObject)}`)
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair generatePartitionResult: ${utils.stringifyReduce(partitionResult)}`)

    if (partitionObject.Txids && partitionObject.Txids.length > 0) {
      this.logger.playbackLogNote('partitionObject', 'c' + partitionObject.Cycle_number, partitionObject)
    }
    // nodeid in form of the signer!
    return partitionResult
  }

  /**
   * generatePartitionObject
   * @param {Cycle} lastCycle todo define cycle!!
   * @param {number} partitionId
   * @returns {PartitionObject}
   */
  generatePartitionObject (lastCycle: Cycle, partitionId: number) {
    let txList = this.getTXList(lastCycle.counter, partitionId)

    let txSourceData = txList
    if (txList.newTxList) {
      // TSConversion this forced us to add processed to newTxList.  probably a good fis for an oversight
      txSourceData = txList.newTxList
    }

    /** @type {PartitionObject} */
    let partitionObject = {
      Partition_id: partitionId,
      Partitions: 1,
      Cycle_number: lastCycle.counter,
      Cycle_marker: lastCycle.marker,
      Txids: txSourceData.hashes, // txid1, txid2, …],  - ordered from oldest to recent
      Status: txSourceData.passed, // [1,0, …],      - ordered corresponding to Txids; 1 for applied; 0 for failed
      States: txSourceData.states, // array of array of states
      Chain: [] // [partition_hash_341, partition_hash_342, partition_hash_343, …]
      // TODO prodution need to implment chain logic.  Chain logic is important for making a block chain out of are partition objects
    }
    return partitionObject
  }

  /**
   * partitionObjectToTxMaps
   * @param {PartitionObject} partitionObject
   * @returns {Object.<string,number>}
   */
  partitionObjectToTxMaps (partitionObject: PartitionObject) : StatusMap {
    let statusMap:StatusMap = {}
    for (let i = 0; i < partitionObject.Txids.length; i++) {
      let tx = partitionObject.Txids[i]
      let status = partitionObject.Status[i]
      statusMap[tx] = status
    }
    return statusMap
  }

  /**
   * partitionObjectToStateMaps
   * @param {PartitionObject} partitionObject
   * @returns {Object.<string,string>}
   */
  partitionObjectToStateMaps (partitionObject:PartitionObject) : StateMap {
    let statusMap:StateMap = {}
    for (let i = 0; i < partitionObject.Txids.length; i++) {
      let tx = partitionObject.Txids[i]
      let state = partitionObject.States[i]
      statusMap[tx] = state
    }
    return statusMap
  }

  /**
   * tryGeneratePartitionReciept
   * Generate a receipt if we have consensus
   * @param {PartitionResult[]} allResults
   * @param {PartitionResult} ourResult
   * @param {boolean} [repairPassHack]
   * @returns {{ partitionReceipt: PartitionReceipt; topResult: PartitionResult; success: boolean }}
   */
  tryGeneratePartitionReciept (allResults:PartitionResult[], ourResult:PartitionResult, repairPassHack = false) {
    let partitionId = ourResult.Partition_id
    let cycleCounter = ourResult.Cycle_number

    let key = 'c' + cycleCounter
    let key2 = 'p' + partitionId
    let debugKey = `rkeys: ${key} ${key2}`

    let repairTracker = this._getRepairTrackerForCycle(cycleCounter, partitionId)
    repairTracker.busy = true // mark busy so we won't try to start this task again while in the middle of it

    // Tried hashes is not working correctly at the moment, it is an unused parameter. I am not even sure we want to ignore hashes
    let { topHash, topCount, topResult } = this.findMostCommonResponse(cycleCounter, partitionId, repairTracker.triedHashes)

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair  ${debugKey} tryGeneratePartitoinReciept repairTracker: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)

    let requiredHalf = Math.max(1, allResults.length / 2)
    if (this.useHashSets && repairPassHack) {
      // hack force our node to win:
      topCount = requiredHalf
      topHash = ourResult.Partition_hash
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair  ${debugKey} tryGeneratePartitoinReciept hack force win: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)
    }

    let resultsList = []
    if (topCount >= requiredHalf) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair  ${debugKey} tryGeneratePartitoinReciept: top hash wins: ` + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
      for (let partitionResult of allResults) {
        if (partitionResult.Partition_hash === topHash) {
          resultsList.push(partitionResult)
        }
      }
    } else {
      if (this.useHashSets) {
        // bail in a way that will cause us to use the hashset strings
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair  ${debugKey} tryGeneratePartitoinReciept: did not win, useHashSets: ` + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
        return { partitionReceipt: null, topResult: null, success: false }
      }
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair  ${debugKey} tryGeneratePartitoinReciept: top hash failed: ` + utils.makeShortHash(topHash) + ` ${topCount} / ${requiredHalf}`)
      return { partitionReceipt: null, topResult, success: false }
    }

    if (ourResult.Partition_hash !== topHash) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair  ${debugKey} tryGeneratePartitoinReciept: our hash does not match: ` + utils.makeShortHash(topHash) + ` our hash: ${ourResult.Partition_hash}`)
      return { partitionReceipt: null, topResult, success: false }
    }

    let partitionReceipt = {
      resultsList
    }

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair  ${debugKey} tryGeneratePartitoinReciept OK! ${utils.stringifyReduce({ partitionReceipt, topResult })}`)

    return { partitionReceipt, topResult, success: true }
  }

  /**
   * startRepairProcess
   * @param {Cycle} cycle
   * @param {PartitionResult} topResult
   * @param {number} partitionId
   * @param {string} ourLastResultHash
   */
  async startRepairProcess (cycle:Cycle, topResult:PartitionResult | null, partitionId:number, ourLastResultHash:string) {
    this.stateIsGood = false
    if (this.canDataRepair === false) {
      if (this.verboseLogs) this.mainLogger.error( `cycle: ${cycle} this.canDataRepair === false data oos detected but will not start repairs`)
      return
    }

    return
  }

  // todo refactor some of the duped code in here
  // possibly have to split this into three functions to make that clean (find our result and the parition checking as sub funcitons... idk)
  /**
   * checkForGoodPartitionReciept
   * @param {number} cycleNumber
   * @param {number} partitionId
   */
  async checkForGoodPartitionReciept (cycleNumber:number, partitionId:number) {
    let repairTracker = this._getRepairTrackerForCycle(cycleNumber, partitionId)

    let key = 'c' + cycleNumber
    let key2 = 'p' + partitionId
    let debugKey = `rkeys: ${key} ${key2}`

    // get responses
    let responsesById = this.allPartitionResponsesByCycleByPartition[key]
    let responses = responsesById[key2]

    // find our result
    let ourPartitionValues = this.ourPartitionResultsByCycle[key]
    let ourResult = null
    for (let obj of ourPartitionValues) {
      if (obj.Partition_id === partitionId) {
        ourResult = obj
        break
      }
    }
    if(ourResult == null){
      throw new Error(`checkForGoodPartitionReciept ourResult == null ${debugKey}`)
    }
    let receiptResults = this.tryGeneratePartitionReciept(responses, ourResult) // TODO: how to mark block if we are already on a thread for this?
    let { partitionReceipt: partitionReceipt3, topResult: topResult3, success: success3 } = receiptResults
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept immediate receipt check. ${debugKey} success:${success3} topResult:${utils.stringifyReduce(topResult3)}  partitionReceipt: ${utils.stringifyReduce({ partitionReceipt3 })}`)

    // see if we already have a winning hash to correct to
    if (!success3) {
      if (repairTracker.awaitWinningHash) {
        if (topResult3 == null) {
          // if we are awaitWinningHash then wait for a top result before we start repair process again
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept awaitWinningHash:true but topResult == null so keep waiting ${debugKey}`)
        } else {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept awaitWinningHash:true and we have a top result so start reparing! ${debugKey}`)
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept: tryGeneratePartitionReciept failed start repair process 3 ${debugKey} ${utils.stringifyReduce(receiptResults)}`)
          let cycle = this.p2p.state.getCycleByCounter(cycleNumber)
          await utils.sleep(1000)
          await this.startRepairProcess(cycle, topResult3, partitionId, ourResult.Partition_hash)
          // we are correcting to another hash.  don't bother sending our hash out
        }
      }
    } else {
      if(partitionReceipt3 == null){
        throw new Error(`checkForGoodPartitionReciept partitionReceipt3 == null ${debugKey}`)
      }
      this.storePartitionReceipt(cycleNumber, partitionReceipt3)
      this.repairTrackerMarkFinished(repairTracker, 'checkForGoodPartitionReciept')
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept 2 allFinished, final ${debugKey} hash:${utils.stringifyReduce({ topResult3 })}`)
    }
  }

  initApoptosisAndQuitSyncing () {
    console.log('initApoptosisAndQuitSyncing ' + utils.getTime('s'))
    this.mainLogger.error(this.dataPhaseTag + `initApoptosisAndQuitSyncing `)
    this.failAndDontRestartSync()
    this.p2p.initApoptosis()
  }

  // async applyHashSetSolution (solution) {
  //   // solution.corrections
  //   // end goal is to fill up the repair entry for the partition with newPendingTXs, newFailedTXs, missingTXIds, and extraTXIds
  //   //
  // }

  /**
   * _getRepairTrackerForCycle
   * @param {number} counter
   * @param {number} partition
   * @returns {RepairTracker}
   */
  _getRepairTrackerForCycle (counter:number, partition:number) {
    let key = 'c' + counter
    let key2 = 'p' + partition
    let repairsByPartition = this.repairTrackingByCycleById[key]
    if (!repairsByPartition) {
      repairsByPartition = {}
      this.repairTrackingByCycleById[key] = repairsByPartition
    }
    let repairTracker = repairsByPartition[key2]
    if (!repairTracker) {
      // triedHashes: Hashes for partition objects that we have tried to reconcile with already
      // removedTXIds: a list of TXIds that we have removed
      // repairedTXs: a list of TXIds that we have added in
      // newPendingTXs: a list of TXs we fetched that are ready to process
      // newFailedTXs: a list of TXs that we fetched, they had failed so we save them but do not apply them
      // extraTXIds: a list of TXIds that our partition has that the leading partition does not.  This is what we need to remove
      // missingTXIds: a list of TXIds that our partition has that the leading partition has that we don't.  We will need to add these in using the list newPendingTXs
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `_getRepairTrackerForCycle: creating for cycle:${counter} partition:${partition}`)
      repairTracker = { triedHashes: [],
        numNodes: this.lastActiveNodeCount, // num nodes that we send partition results to
        counter: counter,
        partitionId: partition,
        key: key,
        key2: key2,
        removedTXIds: [],
        repairedTXs: [],
        newPendingTXs: [],
        newFailedTXs: [],
        extraTXIds: [],
        // extraTXs: [],
        missingTXIds: [],
        repairing: false,
        repairsNeeded: false,
        busy: false,
        txRepairComplete: false,
        txRepairReady: false,
        evaluationStarted: false,
        evaluationComplete: false,
        awaitWinningHash: false,
        repairsFullyComplete: false }
      repairsByPartition[key2] = repairTracker

      // this.dataRepairStack.push(repairTracker)
      // this.dataRepairsStarted++

      // let combinedKey = key + key2
      // if (this.repairStartedMap.has(combinedKey)) {
      //   if (this.verboseLogs) this.mainLogger.error(`Already started repair on ${combinedKey}`)
      // } else {
      //   this.repairStartedMap.set(combinedKey, true)
      // }
    }
    return repairTracker
  }

  /**
   * repairTrackerMarkFinished
   * @param {RepairTracker} repairTracker
   * @param {string} debugTag
   */
  repairTrackerMarkFinished (repairTracker: RepairTracker, debugTag:string) {
    repairTracker.repairsFullyComplete = true

    let combinedKey = repairTracker.key + repairTracker.key2
    if (this.repairStartedMap.has(combinedKey)) {
      if (this.repairCompletedMap.has(combinedKey)) {
        if (this.verboseLogs) this.mainLogger.debug(`repairStats: finished repair ${combinedKey} -alreadyFlagged  tag:${debugTag}`)
      } else {
        this.dataRepairsCompleted++
        this.repairCompletedMap.set(combinedKey, true)
        if (this.verboseLogs) this.mainLogger.debug(`repairStats: finished repair ${combinedKey} tag:${debugTag}`)
      }
    } else {
      // should be a trace?
      if (this.verboseLogs) this.mainLogger.debug(`repairStats: Calling complete on a key we dont have ${combinedKey} tag:${debugTag}`)
    }

    for (let i = this.dataRepairStack.length - 1; i >= 0; i--) {
      let repairTracker1 = this.dataRepairStack[i]
      if (repairTracker1 === repairTracker) {
        this.dataRepairStack.splice(i, 1)
      }
    }

    if (this.dataRepairStack.length === 0) {
      if (this.stateIsGood === false) {
        if (this.verboseLogs) this.mainLogger.error(`No active data repair going on tag:${debugTag}`)
      }
      this.stateIsGood = true
    }
  }

  /**
   * repairTrackerClearForNextRepair
   * @param {RepairTracker} repairTracker
   */
  repairTrackerClearForNextRepair (repairTracker: RepairTracker) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` repairTrackerClearForNextRepair cycleNumber: ${repairTracker.counter} parition: ${repairTracker.partitionId} `)
    repairTracker.removedTXIds = []
    repairTracker.repairedTXs = []
    repairTracker.newPendingTXs = []
    repairTracker.newFailedTXs = []
    repairTracker.extraTXIds = []
    repairTracker.missingTXIds = []
  }

  /**
   * mergeAndApplyTXRepairs
   * @param {number} cycleNumber
   * @param {number} specificParition the old version of this would repair all partitions but we had to wait.  this works on just one partition
   */
  async mergeAndApplyTXRepairs (cycleNumber:number, specificParition: number) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs cycleNumber ${cycleNumber} partition: ${specificParition}`)
    // walk through all txs for this cycle.
    // get or create entries for accounts.
    // track when they have missing txs or wrong txs

    let lastCycleShardValues = this.shardValuesByCycle.get(cycleNumber)
    if(lastCycleShardValues == null){
      throw new Error('mergeAndApplyTXRepairs lastCycleShardValues == null')
    }
    if(lastCycleShardValues.ourConsensusPartitions == null){
      throw new Error('mergeAndApplyTXRepairs lastCycleShardValues.ourConsensusPartitions')
    }

    for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
      // this is an attempt to just repair one parition.
      if (partitionID !== specificParition) {
        continue
      }

      let allTXsToApply:StringNumberObjectMap = {}
      let allExtraTXids:StringNumberObjectMap = {}
      let allAccountsToResetById:StringNumberObjectMap = {}
      let txIDToAcc:TxIDToSourceTargetObjectMap = {}
      let allNewTXsById:TxObjectById = {}
      // get all txs and sort them
      let repairsByPartition = this.repairTrackingByCycleById['c' + cycleNumber]
      // let partitionKeys = Object.keys(repairsByPartition)
      // for (let key of partitionKeys) {
      let key = 'p' + partitionID
      let repairEntry = repairsByPartition[key]
      for (let tx of repairEntry.newPendingTXs) {
        if (utils.isString(tx.data)) {
          // @ts-ignore sometimes we have a data field that gets stuck as a string.  would be smarter to fix this upstream.
          tx.data = JSON.parse(tx.data)
        }
        let keysResponse = this.app.getKeyFromTransaction(tx.data)

        if (!keysResponse) {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
        }

        let { sourceKeys, targetKeys } = keysResponse

        for (let accountID of sourceKeys) {
          allAccountsToResetById[accountID] = 1
        }
        for (let accountID of targetKeys) {
          allAccountsToResetById[accountID] = 1
        }
        allNewTXsById[tx.id] = tx
        txIDToAcc[tx.id] = { sourceKeys, targetKeys }
      }
      for (let tx of repairEntry.missingTXIds) {
        allTXsToApply[tx] = 1
      }
      for (let tx of repairEntry.extraTXIds) {
        allExtraTXids[tx] = 1
        // TODO Repair. ugh have to query our data and figure out which accounts need to be reset.
      }
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs: extra: ${utils.stringifyReduce(allExtraTXids)}  txIDToAcc: ${utils.stringifyReduce(txIDToAcc)}`)

      // todo repair: hmmm also reset accounts have a tx we need to remove.
      // }

      let txList = this.getTXList(cycleNumber, partitionID) // done todo sharding: pass partition ID

      let txIDToAccCount = 0
      let txIDResetExtraCount = 0
      // build a list with our existing txs, but dont include the bad ones
      if (txList) {
        for (let i = 0; i < txList.txs.length; i++) {
          let tx = txList.txs[i]
          if (allExtraTXids[tx.id]) {
            // this was a bad tx dont include it.   we have to look up the account associated with this tx and make sure they get reset
            let keysResponse = this.app.getKeyFromTransaction(tx.data)
            if (!keysResponse) {
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs problem with keysResp2  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
            }
            let { sourceKeys, targetKeys } = keysResponse
            for (let accountID of sourceKeys) {
              allAccountsToResetById[accountID] = 1
              txIDResetExtraCount++
            }
            for (let accountID of targetKeys) {
              allAccountsToResetById[accountID] = 1
              txIDResetExtraCount++
            }
          } else {
          // a good tx that we had earlier
            let keysResponse = this.app.getKeyFromTransaction(tx.data)
            let { sourceKeys, targetKeys } = keysResponse
            allNewTXsById[tx.id] = tx
            txIDToAcc[tx.id] = { sourceKeys, targetKeys }
            txIDToAccCount++
          // we will only play back the txs on accounts that point to allAccountsToResetById
          }
        }
      } else {
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs txList not found for: cycle: ${cycleNumber} in ${utils.stringifyReduce(this.txByCycleByPartition)}`)
      }

      // build and sort a list of TXs that we need to apply

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs txIDResetExtraCount: ${txIDResetExtraCount} allAccountsToResetById ${utils.stringifyReduce(allAccountsToResetById)}`)
      // reset accounts
      let accountKeys = Object.keys(allAccountsToResetById)
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs revert accountKeys ${utils.stringifyReduce(accountKeys)}`)

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs FIFO lock outer: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
      let ourAccountLocks = await this.bulkFifoLockAccounts(accountKeys)
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs FIFO lock inner: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)

      // let replacmentAccounts =  //returned by the below function for debug
      await this._revertAccounts(accountKeys, cycleNumber)

      // todo sharding - done extracted tx list calcs to run just for this partition inside of here. how does this relate to having a shard for every??
      // convert allNewTXsById map to newTXList list
      let newTXList = []
      let txKeys = Object.keys(allNewTXsById)
      for (let txKey of txKeys) {
        let tx = allNewTXsById[txKey]
        newTXList.push(tx)
      }

      // sort the list by ascending timestamp
      newTXList.sort(utils.sortTimestampAsc) // (function (a, b) { return a.timestamp - b.timestamp })

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs newTXList.length: ${newTXList.length} txKeys.length: ${txKeys.length} txIDToAccCount: ${txIDToAccCount}`)

      let applyCount = 0
      let applyFailCount = 0
      let hasEffect = false

      let accountValuesByKey:AccountValuesByKey = {}
      // let wrappedAccountResults = this.app.getAccountDataByList(accountKeys)
      // for (let wrappedData of wrappedAccountResults) {
      //   wrappedData.isPartial = false
      //   accountValuesByKey[wrappedData.accountId] = wrappedData
      // }
      // let wrappedAccountResults=[]
      // for(let key of accountKeys){
      //   this.app.get
      // }

      // todo sharding - done  (solved by brining newTX clacs inside of this loop)  does newTXList need to be filtered? we are looping over every partition. could this cause us to duplicate effort? YES allNewTXsById is handled above/outside of this loop
      for (let tx of newTXList) {
        let keysFilter = txIDToAcc[tx.id]
        // need a transform to map all txs that would matter.
        try {
          if (keysFilter) {
            let acountsFilter:AccountFilter = {} // this is a filter of accounts that we want to write to
            // find which accounts need txs applied.
            hasEffect = false
            for (let accountID of keysFilter.sourceKeys) {
              if (allAccountsToResetById[accountID]) {
                acountsFilter[accountID] = 1
                hasEffect = true
              }
            }
            for (let accountID of keysFilter.targetKeys) {
              if (allAccountsToResetById[accountID]) {
                acountsFilter[accountID] = 1
                hasEffect = true
              }
            }
            if (!hasEffect) {
            // no need to apply this tx because it would do nothing
              continue
            }

            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs apply tx ${utils.makeShortHash(tx.id)} ${tx.timestamp} data: ${utils.stringifyReduce(tx)} with filter: ${utils.stringifyReduce(acountsFilter)}`)
            let hasStateTableData = false // may or may not have it but not tracking yet

            // TSConversion old way used to do this but seem incorrect to have receipt under data!
            // HACK!!  receipts sent across the net to us may need to get re parsed
            // if (utils.isString(tx.data.receipt)) {
            //   tx.data.receipt = JSON.parse(tx.data.receipt)
            // }

            if (utils.isString(tx.receipt)) {
              //@ts-ignore
              tx.receipt = JSON.parse(tx.receipt)
            }

            // todo needs wrapped states! and/or localCachedData

            // Need to build up this data.
            let keysResponse = this.app.getKeyFromTransaction(tx.data)
            let wrappedStates:WrappedResponses = {}
            let localCachedData:LocalCachedData = {}
            for (let key of keysResponse.allKeys) {
            // build wrapped states
            // let wrappedState = await this.app.getRelevantData(key, tx.data)

              let wrappedState:Shardus.WrappedResponse = accountValuesByKey[key] // need to init ths data. allAccountsToResetById[key]
              if (wrappedState == null) {
              // Theoretically could get this data from when we revert the data above..
                wrappedState = await this.app.getRelevantData(key, tx.data)
                accountValuesByKey[key] = wrappedState
              } else {
                wrappedState.accountCreated = false // kinda crazy assumption
              }
              wrappedStates[key] = wrappedState
              localCachedData[key] = wrappedState.localCache
            // delete wrappedState.localCache
            }

            let success = await this.testAccountTime(tx.data, wrappedStates)

            if (!success) {
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs' + utils.stringifyReduce(tx))
              this.logger.playbackLogNote('testAccountTime_failed', `${tx.id}`, ` testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs`)

              this.fatalLogger.fatal(this.dataPhaseTag + ' testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs' + utils.stringifyReduce(tx))

              // return
              this.p2p.initApoptosis() // todo turn this back on
              // // return { success: false, reason: 'testAccountTime failed' }
              break
            }

            let applied = await this.tryApplyTransaction(tx, hasStateTableData, true, acountsFilter, wrappedStates, localCachedData) // TODO app interface changes.. how to get and pass the state wrapped account state in, (maybe simple function right above this
            // accountValuesByKey = {} // clear this.  it forces more db work but avoids issue with some stale flags
            if (!applied) {
              applyFailCount++
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs apply failed`)
            } else {
              applyCount++
            }
          } else {
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs no for ${tx.id} in ${utils.stringifyReduce(txIDToAcc)}`)
          }
        } catch (ex) {
          this.mainLogger.debug('_repair: startRepairProcess mergeAndApplyTXRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
          this.fatalLogger.fatal('_repair: startRepairProcess mergeAndApplyTXRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
        }

        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs applyCount ${applyCount} applyFailCount: ${applyFailCount}`)
      }

      // unlock the accounts we locked...  todo maybe put this in a finally statement?
      this.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs FIFO unlock: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
    }
  }

  /**
   * updateTrackingAndPrepareChanges
   * @param {number} cycleNumber
   * @param {number} specificParition the old version of this would repair all partitions but we had to wait.  this works on just one partition
   */
  async updateTrackingAndPrepareRepairs (cycleNumber: number, specificParition: number) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs cycleNumber ${cycleNumber} partition: ${specificParition}`)
    // walk through all txs for this cycle.
    // get or create entries for accounts.
    // track when they have missing txs or wrong txs
    let debugKey = `c${cycleNumber}p${specificParition}`
    let lastCycleShardValues = this.shardValuesByCycle.get(cycleNumber)
    let paritionsServiced = 0
    try {
      // this was locking us to consensus only partitions. really just preap anything that is called on this fuciton since other logic may be doing work
      // on stored partitions.

      // for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
      // // this is an attempt to just repair one parition.
      //   if (partitionID !== specificParition) {
      //     continue
      //   }
      let partitionID = specificParition
      paritionsServiced++
      let allTXsToApply:StringNumberObjectMap = {}
      let allExtraTXids:StringNumberObjectMap = {}
      /** @type {Object.<string, number>} */
      let allAccountsToResetById:StringNumberObjectMap = {}
      /** @type {Object.<string, { sourceKeys:string[], targetKeys:string[] } >} */
      let txIDToAcc:TxIDToSourceTargetObjectMap = {}
      let allNewTXsById:TxObjectById = {}
      // get all txs and sort them
      let repairsByPartition = this.repairTrackingByCycleById['c' + cycleNumber]
      // let partitionKeys = Object.keys(repairsByPartition)
      // for (let key of partitionKeys) {
      let key = 'p' + partitionID
      let repairEntry = repairsByPartition[key]
      for (let tx of repairEntry.newPendingTXs) {
        if (utils.isString(tx.data)) {
          // @ts-ignore sometimes we have a data field that gets stuck as a string.  would be smarter to fix this upstream.
          tx.data = JSON.parse(tx.data)
        }
        let keysResponse = this.app.getKeyFromTransaction(tx.data)

        if (!keysResponse) {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
        }

        let { sourceKeys, targetKeys } = keysResponse

        for (let accountID of sourceKeys) {
          allAccountsToResetById[accountID] = 1
        }
        for (let accountID of targetKeys) {
          allAccountsToResetById[accountID] = 1
        }
        allNewTXsById[tx.id] = tx
        txIDToAcc[tx.id] = { sourceKeys, targetKeys }
      }
      for (let tx of repairEntry.missingTXIds) {
        allTXsToApply[tx] = 1
      }
      for (let tx of repairEntry.extraTXIds) {
        allExtraTXids[tx] = 1
        // TODO Repair. ugh have to query our data and figure out which accounts need to be reset.
      }
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs: extra: ${utils.stringifyReduce(allExtraTXids)}  txIDToAcc: ${utils.stringifyReduce(txIDToAcc)}`)

      // todo repair: hmmm also reset accounts have a tx we need to remove.
      // }

      let txList = this.getTXList(cycleNumber, partitionID) // done todo sharding: pass partition ID

      let txIDToAccCount = 0
      let txIDResetExtraCount = 0
      // build a list with our existing txs, but dont include the bad ones
      if (txList) {
        for (let i = 0; i < txList.txs.length; i++) {
          let tx = txList.txs[i]
          if (allExtraTXids[tx.id]) {
            // this was a bad tx dont include it.   we have to look up the account associated with this tx and make sure they get reset
            let keysResponse = this.app.getKeyFromTransaction(tx.data)
            if (!keysResponse) {
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs problem with keysResp2  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
            }
            let { sourceKeys, targetKeys } = keysResponse
            for (let accountID of sourceKeys) {
              allAccountsToResetById[accountID] = 1
              txIDResetExtraCount++
            }
            for (let accountID of targetKeys) {
              allAccountsToResetById[accountID] = 1
              txIDResetExtraCount++
            }
          } else {
            // a good tx that we had earlier
            let keysResponse = this.app.getKeyFromTransaction(tx.data)
            let { sourceKeys, targetKeys } = keysResponse
            allNewTXsById[tx.id] = tx
            txIDToAcc[tx.id] = { sourceKeys, targetKeys }
            txIDToAccCount++
            // we will only play back the txs on accounts that point to allAccountsToResetById
          }
        }
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs txIDResetExtraCount:${txIDResetExtraCount} txIDToAccCount: ${txIDToAccCount}`)
      } else {
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs txList not found for: cycle: ${cycleNumber} in ${utils.stringifyReduce(this.txByCycleByPartition)}`)
      }

      // build and sort a list of TXs that we need to apply

      // OLD reset account code was here.

      // todo sharding - done extracted tx list calcs to run just for this partition inside of here. how does this relate to having a shard for every??
      // convert allNewTXsById map to newTXList list
      let newTXList = []
      let txKeys = Object.keys(allNewTXsById)
      for (let txKey of txKeys) {
        let tx = allNewTXsById[txKey]
        newTXList.push(tx)
      }

      // sort the list by ascending timestamp
      newTXList.sort(utils.sortTimestampAsc) // function (a, b) { return a.timestamp - b.timestamp })

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs newTXList.length: ${newTXList.length} txKeys.length: ${txKeys.length} txIDToAccCount: ${txIDToAccCount}`)

      // Save the results of this computation for later
      /** @type {UpdateRepairData}  */
      let updateData:UpdateRepairData = { newTXList, allAccountsToResetById, partitionId: specificParition, txIDToAcc }
      let ckey = 'c' + cycleNumber
      if (this.repairUpdateDataByCycle[ckey] == null) {
        this.repairUpdateDataByCycle[ckey] = []
      }
      this.repairUpdateDataByCycle[ckey].push(updateData)

      // how will the partition object get updated though??
      // }

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs finished`)
      if (paritionsServiced === 0) {
        this.fatalLogger.fatal(`_updateTrackingAndPrepareRepairs failed. not partitions serviced: ${debugKey} our consensus:${utils.stringifyReduce(lastCycleShardValues?.ourConsensusPartitions)} `)
      }
    } catch (ex) {
      this.mainLogger.debug('__updateTrackingAndPrepareRepairs: exception ' + ` ${debugKey} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.fatalLogger.fatal('__updateTrackingAndPrepareRepairs: exception ' + ` ${debugKey} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    }
  }

  /**
   * updateTrackingAndPrepareChanges
   * @param {number} cycleNumber
   */
  async applyAllPreparedRepairs (cycleNumber:number) {
    if (this.applyAllPreparedRepairsRunning === true) {
      return
    }
    this.applyAllPreparedRepairsRunning = true

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs cycleNumber ${cycleNumber}`)

    this.mainLogger.debug(`applyAllPreparedRepairs c:${cycleNumber}`)

    let ckey = 'c' + cycleNumber
    let repairDataList = this.repairUpdateDataByCycle[ckey]

    let txIDToAcc:TxIDToKeyObjectMap = {}
    let allAccountsToResetById:AccountBoolObjectMap = {}
    let newTXList:AcceptedTx[] = []
    for (let repairData of repairDataList) {
      newTXList = newTXList.concat(repairData.newTXList)
      allAccountsToResetById = Object.assign(allAccountsToResetById, repairData.allAccountsToResetById)
      txIDToAcc = Object.assign(txIDToAcc, repairData.txIDToAcc)
      this.mainLogger.debug(`applyAllPreparedRepairs c${cycleNumber}p${repairData.partitionId} reset:${Object.keys(repairData.allAccountsToResetById).length} txIDToAcc:${Object.keys(repairData.txIDToAcc).length} keys: ${utils.stringifyReduce(Object.keys(repairData.allAccountsToResetById))} `)
    }
    this.mainLogger.debug(`applyAllPreparedRepairs total reset:${Object.keys(allAccountsToResetById).length} txIDToAcc:${Object.keys(txIDToAcc).length}`)

    newTXList.sort(utils.sortTimestampAsc) // function (a, b) { return a.timestamp - b.timestamp })



    // build and sort a list of TXs that we need to apply

    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs allAccountsToResetById ${utils.stringifyReduce(allAccountsToResetById)}`)
    // reset accounts
    let accountKeys = Object.keys(allAccountsToResetById)
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs revert accountKeys ${utils.stringifyReduce(accountKeys)}`)

    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs FIFO lock outer: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
    let ourAccountLocks = await this.bulkFifoLockAccounts(accountKeys)
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs FIFO lock inner: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)

    // let replacmentAccounts =  //returned by the below function for debug
    await this._revertAccounts(accountKeys, cycleNumber)

    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs newTXList.length: ${newTXList.length}`)

    let applyCount = 0
    let applyFailCount = 0
    let hasEffect = false
    let hasNonGlobalEffect = false

    // TSConversion WrappedStates issue
    let accountValuesByKey:WrappedResponses = {}

    let seenTXs:StringBoolObjectMap = {}
    for (let tx of newTXList) {
      if (seenTXs[tx.id] === true) {
        this.mainLogger.debug(`applyAllPreparedRepairs skipped double: ${utils.makeShortHash(tx.id)} ${tx.timestamp} `)
        continue
      }
      seenTXs[tx.id] = true

      let keysFilter = txIDToAcc[tx.id]
      // need a transform to map all txs that would matter.
      try {
        if (keysFilter) {
          let acountsFilter:AccountFilter = {} // this is a filter of accounts that we want to write to
          // find which accounts need txs applied.
          hasEffect = false
          hasNonGlobalEffect = false
          for (let accountID of keysFilter.sourceKeys) {
            if (allAccountsToResetById[accountID]) {
              acountsFilter[accountID] = 1
              hasEffect = true
              if(this.isGlobalAccount(accountID) === false){
                hasNonGlobalEffect = true
              }
            }
          }
          for (let accountID of keysFilter.targetKeys) {
            if (allAccountsToResetById[accountID]) {
              acountsFilter[accountID] = 1
              hasEffect = true
              if(this.isGlobalAccount(accountID) === false){
                hasNonGlobalEffect = true
              }
            }
          }
          if (!hasEffect) {
            // no need to apply this tx because it would do nothing
            continue
          }
          if(!hasNonGlobalEffect){
            //if only a global account involved then dont reset!
            continue
          }

          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs apply tx ${utils.makeShortHash(tx.id)} ${tx.timestamp} data: ${utils.stringifyReduce(tx)} with filter: ${utils.stringifyReduce(acountsFilter)}`)
          let hasStateTableData = false // may or may not have it but not tracking yet

          // TSConversion old way used to do this but seem incorrect to have receipt under data!
          // // HACK!!  receipts sent across the net to us may need to get re parsed
          // if (utils.isString(tx.data.receipt)) {
          //   tx.data.receipt = JSON.parse(tx.data.receipt)
          // }
          if (utils.isString(tx.receipt)) {
            //@ts-ignore
            tx.receipt = JSON.parse(tx.receipt)
          }

          // todo needs wrapped states! and/or localCachedData

          // Need to build up this data.
          let keysResponse = this.app.getKeyFromTransaction(tx.data)
          let wrappedStates:WrappedResponses = {}
          let localCachedData:LocalCachedData = {}
          for (let key of keysResponse.allKeys) {
            // build wrapped states
            // let wrappedState = await this.app.getRelevantData(key, tx.data)

            let wrappedState:Shardus.WrappedResponse = accountValuesByKey[key] // need to init ths data. allAccountsToResetById[key]
            if (wrappedState == null) {
              // Theoretically could get this data from when we revert the data above..
              wrappedState = await this.app.getRelevantData(key, tx.data)
              // what to do in failure case.
              accountValuesByKey[key] = wrappedState
            } else {
              wrappedState.accountCreated = false // kinda crazy assumption
            }
            wrappedStates[key] = wrappedState
            localCachedData[key] = wrappedState.localCache
            // delete wrappedState.localCache
          }

          let success = await this.testAccountTime(tx.data, wrappedStates)

          if (!success) {
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' applyAllPreparedRepairs testAccountTime failed. calling apoptosis. applyAllPreparedRepairs' + utils.stringifyReduce(tx))
            this.logger.playbackLogNote('testAccountTime_failed', `${tx.id}`, ` applyAllPreparedRepairs testAccountTime failed. calling apoptosis. applyAllPreparedRepairs`)
            this.fatalLogger.fatal(this.dataPhaseTag + ' testAccountTime failed. calling apoptosis. applyAllPreparedRepairs' + utils.stringifyReduce(tx))

            // return
            this.p2p.initApoptosis() // todo turn this back on
            // // return { success: false, reason: 'testAccountTime failed' }
            break
          }

          // TODO: globalaccounts  this is where we go through the account state and just in time grab global accounts from the cache we made in the revert section from backup copies.
          //  TODO Perf probably could prepare of this inforamation above more efficiently but for now this is most simple and self contained.

          //TODO verify that we will even have wrapped states at this point in the repair without doing some extra steps.
          let wrappedStateKeys = Object.keys( wrappedStates )
          for(let wrappedStateKey of wrappedStateKeys){
            let wrappedState = wrappedStates[wrappedStateKey]
      
            // if(wrappedState == null) {
            //   if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair applyAllPreparedRepairs wrappedState == null ${utils.stringifyReduce(wrappedStateKey)} ${tx.timestamp}`)
            //   //could continue but want to see if there is more we can log.
            // }
            //is it global. 
            if(this.isGlobalAccount(wrappedStateKey)){ // wrappedState.accountId)){
              this.logger.playbackLogNote('globalAccountMap', `applyAllPreparedRepairs - has`, ` ${wrappedState.accountId} ${wrappedStateKey}`)
              if(wrappedState != null){
                let globalValueSnapshot = this.getGlobalAccountValueAtTime(wrappedState.accountId, tx.timestamp)           
                
                if(globalValueSnapshot == null){
                  //todo some error?
                  let globalAccountBackupList = this.getGlobalAccountBackupList(wrappedStateKey)
                  if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair applyAllPreparedRepairs has global key but no snapshot at time ${tx.timestamp} entries:${globalAccountBackupList.length} ${utils.stringifyReduce(globalAccountBackupList.map(a => `${a.timestamp}  ${ utils.makeShortHash( a.accountId )} `    ))}  `)
                  continue
                }
                // build a new wrapped response to insert
                let newWrappedResponse:Shardus.WrappedResponse = {accountCreated:wrappedState.accountCreated, isPartial:false, accountId:wrappedState.accountId, timestamp:wrappedState.timestamp,
                                                                  stateId: globalValueSnapshot.hash, data: globalValueSnapshot.data }
                //set this new value into our wrapped states.
                wrappedStates[wrappedStateKey] = newWrappedResponse // update!!
                // insert thes data into the wrapped states.
                // yikes probably cant do local cached data at this point.
                if (this.verboseLogs) {
                  let globalAccountBackupList = this.getGlobalAccountBackupList(wrappedStateKey)
                  if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair applyAllPreparedRepairs has global key details ${tx.timestamp} entries:${globalAccountBackupList.length} ${utils.stringifyReduce(globalAccountBackupList.map(a => `${a.timestamp}  ${ utils.makeShortHash( a.accountId )} `    ))}  `)
                }

                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs got global account to repair from: ${utils.stringifyReduce(newWrappedResponse)}`)
              } 
            } else {

              if(wrappedState == null){
                if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair applyAllPreparedRepairs is not a global account but wrapped state == null ${utils.stringifyReduce(wrappedStateKey)} ${tx.timestamp}`)
              }

            }
          }
          
          let applied = await this.tryApplyTransaction(tx, hasStateTableData,/** repairing */ true, acountsFilter, wrappedStates, localCachedData) // TODO app interface changes.. how to get and pass the state wrapped account state in, (maybe simple function right above this
          // accountValuesByKey = {} // clear this.  it forces more db work but avoids issue with some stale flags
          if (!applied) {
            applyFailCount++
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs apply failed`)
          } else {
            applyCount++
          }
        } else {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs no for ${tx.id} in ${utils.stringifyReduce(txIDToAcc)}`)
        }
      } catch (ex) {
        this.mainLogger.debug('_repair: startRepairProcess applyAllPreparedRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
        this.fatalLogger.fatal('_repair: startRepairProcess applyAllPreparedRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      }

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs applyCount ${applyCount} applyFailCount: ${applyFailCount}`)
    }

    // unlock the accounts we locked...  todo maybe put this in a finally statement?
    this.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs FIFO unlock: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
    // }
    this.applyAllPreparedRepairsRunning = false
  }

  /**
   * bulkFifoLockAccounts
   * @param {string[]} accountIDs
   */
  async bulkFifoLockAccounts (accountIDs:string[]) {
    // lock all the accounts we will modify
    let wrapperLockId = await this.fifoLock('atomicWrapper')
    let ourLocks = []
    let seen:StringBoolObjectMap = {}
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
  bulkFifoUnlockAccounts (accountIDs:string[], ourLocks:number[]) {
    let seen:StringBoolObjectMap = {}
    // unlock the accounts we locked
    for (let i = 0; i < ourLocks.length; i++) {
      let accountID = accountIDs[i]
      if (seen[accountID] === true) {
        continue
      }
      seen[accountID] = true
      let ourLockID = ourLocks[i]
      if(ourLockID == -1){
        this.fatalLogger.fatal(`bulkFifoUnlockAccounts hit placeholder i:${i} ${utils.stringifyReduce({accountIDs, ourLocks})} ` )
      }

      this.fifoUnlock(accountID, ourLockID)
    }
  }


  // this.globalAccountRepairBank = {


  // }

  /**
   * _revertAccounts
   * @param {string[]} accountIDs
   * @param {number} cycleNumber
   */
  async _revertAccounts (accountIDs:string[], cycleNumber:number) {
    let cycle = this.p2p.state.getCycleByCounter(cycleNumber)
    let cycleEnd = (cycle.start + cycle.duration) * 1000
    let cycleStart = cycle.start * 1000
    cycleEnd -= this.syncSettleTime // adjust by sync settle time
    cycleStart -= this.syncSettleTime // adjust by sync settle time
    let replacmentAccounts:Shardus.AccountsCopy[]
    let replacmentAccountsMinusGlobals = [] as Shardus.AccountsCopy[]
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts start  numAccounts: ${accountIDs.length} repairing cycle:${cycleNumber}`)

    try {
      // query our account copies that are less than or equal to this cycle!
      let prevCycle = cycleNumber - 1
      
      replacmentAccounts = (await this.storage.getAccountReplacmentCopies(accountIDs, prevCycle)) as Shardus.AccountsCopy[]
      
      if (replacmentAccounts.length > 0) {
        for (let accountData of replacmentAccounts) {
          if (utils.isString(accountData.data)) {
            accountData.data = JSON.parse(accountData.data)
            // hack, mode the owner so we can see the rewrite taking place
            // accountData.data.data.data = { rewrite: cycleNumber }
          }

          if (accountData == null || accountData.data == null || accountData.accountId == null) {
            if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair _revertAccounts null account data found: ${accountData.accountId} cycle: ${cycleNumber} data: ${utils.stringifyReduce(accountData)}`)
          } else {
            // todo overkill
            if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts reset: ${utils.makeShortHash(accountData.accountId)} ts: ${utils.makeShortHash(accountData.timestamp)} cycle: ${cycleNumber} data: ${utils.stringifyReduce(accountData)}`)
          }
          // TODO: globalaccounts 
          //this is where we need to no reset a global account, but instead grab the replacment data and cache it
          /// ////////////////////////
          //let isGlobalAccount = this.globalAccountMap.has(accountData.accountId )
          
          //Try not reverting global accounts..
          if(this.isGlobalAccount(accountData.accountId) === false){
            replacmentAccountsMinusGlobals.push(accountData)
            if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts not a global account, add to list ${utils.makeShortHash(accountData.accountId)}`)

          } else{
            if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts was a global account, do not add to list ${utils.makeShortHash(accountData.accountId)}`)

          }

        }
        // tell the app to replace the account data
        //await this.app.resetAccountData(replacmentAccounts)
        await this.app.resetAccountData(replacmentAccountsMinusGlobals)
        // update local state.
      } else {
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts No replacment accounts found!!! cycle <= :${prevCycle}`)
      }

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts: ${accountIDs.length} replacmentAccounts ${replacmentAccounts.length} repairing cycle:${cycleNumber} replacmentAccountsMinusGlobals: ${replacmentAccountsMinusGlobals.length}`)

      // TODO prodution. consider if we need a better set of checks before we delete an account!
      // If we don't have a replacement copy for an account we should try to delete it

      // Find any accountIDs not in resetAccountData
      let accountsReverted:StringNumberObjectMap = {}
      let accountsToDelete:string[] = []
      let debug = []
      for (let accountData of replacmentAccounts) {
        accountsReverted[accountData.accountId] = 1
        if (accountData.cycleNumber > prevCycle) {
          if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair _revertAccounts cycle too new for backup restore: ${accountData.cycleNumber}  cycleNumber:${cycleNumber} timestamp:${accountData.timestamp}`)
        }

        debug.push({ id: accountData.accountId, cycleNumber: accountData.cycleNumber, timestamp: accountData.timestamp, hash: accountData.hash, accHash: accountData.data.hash, accTs: accountData.data.timestamp })
      }

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts: ${utils.stringifyReduce(debug)}`)

      for (let accountID of accountIDs) {
        if (accountsReverted[accountID] == null) {
          accountsToDelete.push(accountID)
        }
      }
      if (accountsToDelete.length > 0) {
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts delete some accounts ${utils.stringifyReduce(accountsToDelete)}`)
        await this.app.deleteAccountData(accountsToDelete)
      }

      // mark for kill future txlist stuff for any accounts we nuked

      // make a map to find impacted accounts
      let accMap:StringNumberObjectMap = {}
      for (let accid of accountIDs) {
        accMap[accid] = 1
      }
      // check for this.tempTXRecords that involve accounts we are going to clear
      for (let txRecord of this.tempTXRecords) {
        // if (txRecord.txTS < cycleEnd) {
        let keysResponse = this.app.getKeyFromTransaction(txRecord.acceptedTx.data)
        if (!keysResponse) {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(txRecord.acceptedTx)}`)
        }
        let { sourceKeys, targetKeys } = keysResponse
        for (let accountID of sourceKeys) {
          if (accMap[accountID]) {
            txRecord.redacted = cycleNumber
          }
        }
        for (let accountID of targetKeys) {
          if (accMap[accountID]) {
            txRecord.redacted = cycleNumber
          }
        }
        // }
      }

      // clear out bad state table data!!
      // add number to clear future state table data too
      await this.storage.clearAccountStateTableByList(accountIDs, cycleStart, cycleEnd + 1000000)

      // clear replacement copies for this cycle for these accounts!

      // todo clear based on GTE!!!
      await this.storage.clearAccountReplacmentCopies(accountIDs, cycleNumber)
    } catch (ex) {
      this.mainLogger.debug('_repair: _revertAccounts mergeAndApplyTXRepairs ' + ` ${utils.stringifyReduce({ cycleNumber, cycleEnd, cycleStart, accountIDs })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.fatalLogger.fatal('_repair: _revertAccounts mergeAndApplyTXRepairs ' + ` ${utils.stringifyReduce({ cycleNumber, cycleEnd, cycleStart, accountIDs })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    }

    return replacmentAccounts // this is for debugging reference
  }

  // could do this every 5 cycles instead to save perf.
  periodicCycleDataCleanup (oldestCycle:number) {
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
        let shardValues:CycleShardData = this.shardValuesByCycle[cycleNum]
        if(shardValues != null){
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
      if (queueEntry.approximateCycleAge && queueEntry.approximateCycleAge < oldestCycle - 1) {
        this.archivedQueueEntries.shift()
        archivedEntriesRemoved++
      } else {
        oldQueueEntries = false
        break
      }
    }

    // sort and clean up our global account backups:
    if(oldestCycleTimestamp > 0){
      this.sortAndMaintainBackups(oldestCycleTimestamp)
    }



    this.mainLogger.debug(`Clearing out old data Cleared: ${removedrepairTrackingByCycleById} ${removedallPartitionResponsesByCycleByPartition} ${removedourPartitionResultsByCycle} ${removedshardValuesByCycle} ${removedtxByCycleByPartition} ${removedrecentPartitionObjectsByCycleByHash} ${removedrepairUpdateDataByCycle} ${removedpartitionObjectsByCycle} ${removepartitionReceiptsByCycleCounter} ${removeourPartitionReceiptsByCycleCounter} archQ:${archivedEntriesRemoved}`)

    // TODO 1 calculate timestamp for oldest accepted TX to delete.

    // TODO effient process to query all accounts and get rid of themm but keep at least one table entry (prefably the newest)
    // could do this in two steps
  }

  //
  //    PPPPPPPP
  //    P       P
  //    P       P
  //    P       P
  //    PPPPPPPP
  //    P       P
  //    P       P
  //    P       P
  //    PPPPPPPP
  //
  //
  //
  /**
   * broadcastPartitionResults
   * @param {number} cycleNumber
   */
  async broadcastPartitionResults (cycleNumber:number) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair broadcastPartitionResults for cycle: ${cycleNumber}`)
    // per partition need to figure out which node cover it.
    // then get a list of all the results we need to send to a given node and send them at once.
    // need a way to do this in semi parallel?
    let lastCycleShardValues = this.shardValuesByCycle.get(cycleNumber)
    let partitionResults = this.ourPartitionResultsByCycle['c' + cycleNumber]
    let partitionResultsByNodeID = new Map() // use a map?
    let nodesToTell = []

    if(lastCycleShardValues == null){
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

      /** @type {ShardInfo2} */
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
      this.logger.playbackLogNote('broadcastPartitionResults', `${cycleNumber}`, `to ${toNodeStr} ${partitionResultsToSend.debugStr} `)
      let promise = this.p2p.tell([partitionResultsToSend.node], 'post_partition_results', payload)
      promises.push(promise)
    }

    await Promise.all(promises)
  }

  // initStateSyncData () {
  //   if (!this.partitionObjectsByCycle) {
  //     /** @type { Object.<string,PartitionObject[]>} our partition objects by cycle.  index by cycle counter key to get an array */
  //     this.partitionObjectsByCycle = {}
  //   }
  //   if (!this.ourPartitionResultsByCycle) {
  //     /** @type { Object.<string,PartitionResult[]>} our partition results by cycle.  index by cycle counter key to get an array */
  //     this.ourPartitionResultsByCycle = {}
  //   }

  //   if (!this.repairTrackingByCycleById) {
  //     /** @type {Object.<string, Object.<string,RepairTracker>>} tracks state for repairing partitions. index by cycle counter key to get the repair object, index by parition */
  //     this.repairTrackingByCycleById = {}
  //   }

  //   if (!this.repairUpdateDataByCycle) {
  //     /** @type {Object.<string, UpdateRepairData[]>}  */
  //     this.repairUpdateDataByCycle = {}
  //   }

  //   this.applyAllPreparedRepairsRunning = false

  //   if (!this.recentPartitionObjectsByCycleByHash) {
  //     /** @type {Object.<string, Object.<string,PartitionObject>>} our partition objects by cycle.  index by cycle counter key to get an array */
  //     this.recentPartitionObjectsByCycleByHash = {}
  //   }

  //   if (!this.tempTXRecords) {
  //     /** @type {TempTxRecord[]} temporary store for TXs that we put in a partition object after a cycle is complete. an array that holds any TXs (i.e. from different cycles), code will filter out what it needs @see TempTxRecord */
  //     this.tempTXRecords = []
  //   }

  //   if (!this.txByCycleByPartition) {
  //     // txList = { hashes: [], passed: [], txs: [], processed: false, states: [] }
  //     // TxTallyList
  //     /** @type {Object.<string, Object.<string,TxTallyList>>} TxTallyList data indexed by cycle key and partition key. @see TxTallyList */
  //     this.txByCycleByPartition = {}
  //   }

  //   // if (!this.txByCycleByPartition) {
  //   //   this.txByCycleByPartition = {}
  //   // }

  //   if (!this.allPartitionResponsesByCycleByPartition) {
  //     /** @type {Object.<string, Object.<string,PartitionResult[]>>} Stores the partition responses that other nodes push to us.  Index by cycle key, then index by partition id */
  //     this.allPartitionResponsesByCycleByPartition = {}
  //   }
  // }

  startShardCalculations () {
    //this.p2p.state.on('cycle_q1_start', async (lastCycle, time) => {
    this._registerListener(this.p2p.state, 'cycle_q1_start', async (lastCycle: Shardus.Cycle, time:number) => {
      this.emit('set_queue_partition_gossip')  
      lastCycle = this.p2p.state.getLastCycle()
      if (lastCycle) {
        let ourNode = this.p2p.state.getNode(this.p2p.id)

        if(ourNode == null){
          //dont attempt more calculations we may be shutting down
          return
        }

        // this.dumpAccountDebugData()
        this.updateShardValues(lastCycle.counter)
        this.dumpAccountDebugData() // better to print values after an update!
      }
    })

    this._registerListener(this.p2p.state, 'cycle_q3_start', async (lastCycle: Shardus.Cycle, time:number) => {
      if (this.currentCycleShardData && this.currentCycleShardData.ourNode.status === 'active') {
        this.calculateChangeInCoverage()
      }
      lastCycle = this.p2p.state.getLastCycle()
      if (lastCycle == null) {
        return
      }
      let lastCycleShardValues = this.shardValuesByCycle.get(lastCycle.counter)
      if (lastCycleShardValues == null) {
        return
      }

      // do this every 5 cycles.
      if (lastCycle.counter % 5 !== 0) {
        return
      }

      if (this.doDataCleanup === true) {
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startSyncPartitions:cycle_q3_start-clean cycle: ${lastCycle.counter}`)
        // clean up cycle data that is more than 10 cycles old.
        this.periodicCycleDataCleanup(lastCycle.counter - 10)
      }
    })
  }

  async startSyncPartitions () {
    // await this.createInitialAccountBackups() // nm this is now part of regular data sync
    // register our handlers

    // this._registerListener(this.p2p.state, 'cycle_q1_start', async (lastCycle, time) => {
    //   this.updateShardValues(lastCycle.counter)
    // })

    this._registerListener(this.p2p.state, 'cycle_q2_start', async (lastCycle: Shardus.Cycle, time: number) => {
      lastCycle = this.p2p.state.getLastCycle()
      if (lastCycle == null) {
        return
      }
      let lastCycleShardValues = this.shardValuesByCycle.get(lastCycle.counter)
      if (lastCycleShardValues == null) {
        return
      }
      if(this.currentCycleShardData == null){
        return
      }

      if (this.currentCycleShardData.ourNode.status !== 'active') {
        // dont participate just yet.
        return
      }

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startSyncPartitions:cycle_q2_start cycle: ${lastCycle.counter}`)
      // this will take temp TXs and make sure they are stored in the correct place for us to generate partitions
      this.processTempTXs(lastCycle)

      // During the Q2 phase of a cycle, nodes compute the partition hash of the previous cycle for all the partitions covered by the node.
      // Q2 was chosen so that any transactions submitted with a time stamp that falls in the previous quarter will have been processed and finalized. This could be changed to Q3 if we find that more time is needed.
      this.generatePartitionObjects(lastCycle)

      // Hook for Snapshot module to listen to after partition data is settled
      this.emit('cycleTxsFinalized', lastCycleShardValues)

      // pre-allocate the next cycle data to be safe!
      let prekey = 'c' + (lastCycle.counter + 1)
      this.partitionObjectsByCycle[prekey] = []
      this.ourPartitionResultsByCycle[prekey] = []

      // Nodes generate the partition result for all partitions they cover.
      // Nodes broadcast the set of partition results to N adjacent peers on each side; where N is
      // the number of partitions covered by the node. Uses the /post_partition_results API.

      await this.broadcastPartitionResults(lastCycle.counter) // Cycle_number
    })

    /* this._registerListener(this.p2p.state, 'cycle_q4_start', async (lastCycle, time) => {
      // Also we would like the repair process to finish by the end of Q3 and definitely before the start of a new cycle. Otherwise the cycle duration may need to be increased.
    }) */
  }

  /**
   * updateAccountsCopyTable
   * originally this only recorder results if we were not repairing but it turns out we need to update our copies any time we apply state.
   * with the update we will calculate the cycle based on timestamp rather than using the last current cycle counter
   * @param {any} accountDataList todo need to use wrapped account data here  TSConversion todo non any type 
   * @param {boolean} repairing
   * @param {number} txTimestamp
   */
  async updateAccountsCopyTable (accountDataList: Shardus.AccountData[], repairing: boolean, txTimestamp: number) {
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
    let cycleStart = (cycle.start + (cycle.duration * cycleOffset)) * 1000
    let cycleEnd = (cycle.start + (cycle.duration * (cycleOffset + 1))) * 1000
    if (txTimestamp + this.syncSettleTime < cycleStart) {
      if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable time error< ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
    }
    if (txTimestamp + this.syncSettleTime >= cycleEnd) {
      // if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable time error>= ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
      cycleOffset++
      cycleNumber = cycle.counter + cycleOffset
      cycleStart = (cycle.start + (cycle.duration * cycleOffset)) * 1000
      cycleEnd = (cycle.start + (cycle.duration * (cycleOffset + 1))) * 1000
      if (txTimestamp + this.syncSettleTime >= cycleEnd) {
        if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable time error>= ts:${txTimestamp} cs:${cycleStart} ce:${cycleEnd} `)
      }
    }
    // TSConversion need to sort out account types!!!
    // @ts-ignore This has seemed fine in past so not going to sort out a type discrepencie here.  !== would detect and log it anyhow.
    if (accountDataList.length > 0 && accountDataList[0].timestamp !== txTimestamp) {
      if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable timestamps do match txts:${txTimestamp} acc.ts:${accountDataList[0].timestamp} `)
    }
    if(accountDataList.length === 0){
      // need to decide if this matters!
      if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable empty txts:${txTimestamp}  `)

    }
    // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `updateAccountsCopyTable acc.timestamp: ${accountDataList[0].timestamp} offsetTime: ${this.syncSettleTime} cycle computed:${cycleNumber} `)

    for (let accountEntry of accountDataList) {
      let { accountId, data, timestamp, hash } = accountEntry
      let isGlobal = this.isGlobalAccount(accountId)

      let backupObj:Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }

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
      if(this.isGlobalAccount(accountId) && repairing === false){
        //make sure it is a global tx.
        let globalBackupList:Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(accountId)
        if(globalBackupList != null){
          globalBackupList.push(backupObj) // sort and cleanup later.

          if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `updateAccountsCopyTable added account to global backups count: ${globalBackupList.length} ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)

        }        
      }


      //Aha! Saves the last copy per given cycle! this way when you query cycle-1 you get the right data.
      await this.storage.createOrReplaceAccountCopy(backupObj)
    }
  }

  getGlobalAccountValueAtTime(accountId:string, oldestTimestamp:number): Shardus.AccountsCopy | null {
    let result:Shardus.AccountsCopy | null = null
    let globalBackupList:Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(accountId)
    if(globalBackupList == null || globalBackupList.length === 0){
      this.logger.playbackLogNote('globalBackupList', `applyAllPreparedRepairs - missing value for ${accountId}`)
      return null
    }

    //else fine the closest time lower than our input time
    //non binary search, just start at then end and go backwards.
    //TODO PERF make this a binary search. realistically the lists should be pretty short most of the time
    if(globalBackupList.length >= 1){
      for(let i=globalBackupList.length-1; i>=0; i--) {
        let accountCopy = globalBackupList[i]
        if(accountCopy.timestamp <= oldestTimestamp){
          return accountCopy;
        } 
      }  
    }
    return null
  }

  sortByTimestamp(a:any, b:any): number{
    return utils.sortAscProp(a,b,"timestamp")
  }

  sortAndMaintainBackupList(globalBackupList:Shardus.AccountsCopy[], oldestTimestamp: number): void{
    globalBackupList.sort(utils.sortTimestampAsc) // this.sortByTimestamp)
    //remove old entries. then bail.
    // note this loop only runs if there is more than one entry
    // also it should always keep the last item in the list now matter what (since that is the most current backup)
    // this means we only start if there are 2 items in the array and we start at index  len-2 (next to last element)
    if(globalBackupList.length > 1){
      for(let i=globalBackupList.length-2; i>=0; i--) {
        let accountCopy = globalBackupList[i]
        if(accountCopy.timestamp < oldestTimestamp){
          globalBackupList.splice(i, 1)
        } 
      }  
    }
  }

  // go through all account backups sort/ filter them
  sortAndMaintainBackups(oldestTimestamp: number): void{
    let keys = this.globalAccountRepairBank.keys()
    for(let key of keys){
      let globalBackupList = this.globalAccountRepairBank.get(key)
      if(globalBackupList != null){
        this.sortAndMaintainBackupList(globalBackupList, oldestTimestamp)
      }
    }
  }

  //maintian all lists
  getGlobalAccountBackupList(accountID:string): Shardus.AccountsCopy[] {

    let results:Shardus.AccountsCopy[] = []
    if(this.globalAccountRepairBank.has(accountID) === false){

      this.globalAccountRepairBank.set(accountID, results) //init list
    } else {
      results = this.globalAccountRepairBank.get(accountID)
    }
    return results
  }

  isGlobalAccount(accountID:string):boolean{
    return this.globalAccountMap.has(accountID)
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
  tempRecordTXByCycle (txTS: number, acceptedTx: AcceptedTx, passed: boolean, applyResponse: ApplyResponse, isGlobalModifyingTX: boolean, savedSomething: boolean) {
    this.tempTXRecords.push({ txTS, acceptedTx, passed, redacted: -1, applyResponse, isGlobalModifyingTX, savedSomething })
  }

  /**
   * sortTXRecords
   * @param {TempTxRecord} a
   * @param {TempTxRecord} b
   * @returns {number}
   */
  sortTXRecords (a: TempTxRecord, b: TempTxRecord): number {
    if (a.acceptedTx.timestamp === b.acceptedTx.timestamp) {
      return utils.sortAsc(a.acceptedTx.id, b.acceptedTx.id)
    }
    //return a.acceptedTx.timestamp - b.acceptedTx.timestamp
    return (a.acceptedTx.timestamp > b.acceptedTx.timestamp) ? -1 : 1
  }

  /**
   * processTempTXs
   * call this before we start computing partitions so that we can make sure to get the TXs we need out of the temp list
   * @param {Cycle} cycle
   */
  processTempTXs (cycle: Cycle) {
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

    if(lastCycleShardValues == null){
      throw new Error('processTempTXs lastCycleShardValues == null')
    }
    if(lastCycleShardValues.ourConsensusPartitions == null){
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
  getTXList (cycleNumber: number, partitionId: number): TxTallyList {
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
  getTXListByKey (key: string, partitionId: number): TxTallyList {
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
   * @param {number} txTS
   * @param {AcceptedTx} acceptedTx
   * @param {boolean} passed
   * @param {ApplyResponse} applyResponse
   */
  recordTXByCycle (txTS: number, acceptedTx: AcceptedTx, passed: boolean, applyResponse: ApplyResponse, isGlobalModifyingTX: boolean) {
    // TODO sharding.  done because it uses getTXList . filter TSs by the partition they belong to. Double check that this is still needed

    // get the cycle that this tx timestamp would belong to.
    // add in syncSettleTime when selecting which bucket to put a transaction in
    const cycle = this.p2p.state.getCycleByTimestamp(txTS + this.syncSettleTime)

    if (!cycle) {
      this.mainLogger.error('_repair Failed to find cycle that would contain this timestamp')
    }

    let cycleNumber = cycle.counter

    // for each covered partition..

    let lastCycleShardValues = this.shardValuesByCycle.get(cycle.counter)

    let keysResponse = this.app.getKeyFromTransaction(acceptedTx.data)
    let { allKeys } = keysResponse

    let seenParitions:StringBoolObjectMap = {}
    let partitionHasNonGlobal:StringBoolObjectMap = {}
    // for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
    if(lastCycleShardValues == null){
      throw new Error(`recordTXByCycle lastCycleShardValues == null`)
    }

    if(isGlobalModifyingTX){
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle:  ignore loggging globalTX ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)
      return
    }

    let globalACC = 0
    let nonGlobal = 0
    let storedNonGlobal = 0
    let storedGlobal = 0
    //filter out stuff.
    if(isGlobalModifyingTX === false){
      for (let accountKey of allKeys) {
        // HOMENODEMATHS recordTXByCycle: using partition to decide recording partition
        let {homePartition} = ShardFunctions.addressToPartition(lastCycleShardValues.shardGlobals, accountKey)
        let partitionID = homePartition
        let weStoreThisParition = ShardFunctions.testInRange(partitionID, lastCycleShardValues.nodeShardData.storedPartitions)
        let key = 'p' + partitionID

        if(this.isGlobalAccount(accountKey)){
          globalACC++

          if(weStoreThisParition === true){
            storedGlobal++
          }
        } else{
          nonGlobal++

          if(weStoreThisParition === true){
            storedNonGlobal++
            partitionHasNonGlobal[key] = true
          }
        }
      }
    }

    if(storedNonGlobal === 0 && storedGlobal === 0)
    {
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle: nothing to save globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)
      return
    }
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle: globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal}  tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)

    for (let accountKey of allKeys) {
      /** @type {NodeShardData2} */
      let homeNode = ShardFunctions.findHomeNode(lastCycleShardValues.shardGlobals, accountKey, lastCycleShardValues.parititionShardDataMap)
      if(homeNode == null){
        throw new Error(`recordTXByCycle homeNode == null`)
      }
      // HOMENODEMATHS recordTXByCycle: this code has moved to use homepartition instead of home node's partition
      let homeNodepartitionID = homeNode.homePartition
      let {homePartition} = ShardFunctions.addressToPartition(lastCycleShardValues.shardGlobals, accountKey)
      let partitionID = homePartition
      let key = 'p' + partitionID

      if(this.isGlobalAccount(accountKey)){
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle:  skip partition. dont save due to global: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)
        continue
      }

      let weStoreThisParition = ShardFunctions.testInRange(partitionID, lastCycleShardValues.nodeShardData.storedPartitions)
      if(weStoreThisParition === false){
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle:  skip partition we dont save: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)

        continue
      }

      if(partitionHasNonGlobal[key] === false){
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle:  skip partition. we store it but only a global ref involved this time: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)

        continue
      }
      //check if we are only storing this because it is a global account...

      let txList = this.getTXList(cycleNumber, partitionID) // todo sharding - done: pass partition ID

      if (txList.processed) {
        this.mainLogger.error(`_repair trying to record transaction after we have already finalized our parition object for cycle ${cycle.counter} `)
      }

      
      if (seenParitions[key] != null) {
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `recordTXByCycle: seenParitions[key] != null P: ${partitionID}  homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber} entries: ${txList.hashes.length} --TX already recorded for cycle`)
        // skip because this partition already has this TX!
        continue
      }
      seenParitions[key] = true

      txList.hashes.push(acceptedTx.id)
      txList.passed.push((passed) ? 1 : 0)
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
          recordedState=true
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
  getPartitionObject (cycleNumber: number, partitionId: number): PartitionObject | null {
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
  storePartitionReceipt (cycleNumber: number, partitionReceipt: PartitionReceipt) {
    let key = 'c' + cycleNumber

    if (!this.partitionReceiptsByCycleCounter) {
      this.partitionReceiptsByCycleCounter = {}
    }
    if (!this.partitionReceiptsByCycleCounter[key]) {
      this.partitionReceiptsByCycleCounter[key] = []
    }
    this.partitionReceiptsByCycleCounter[key].push(partitionReceipt)

    this.trySendAndPurgeReceiptsToArchives(partitionReceipt)
  }

  storeOurPartitionReceipt (cycleNumber:number, partitionReceipt:PartitionReceipt) {
    let key = 'c' + cycleNumber

    if (!this.ourPartitionReceiptsByCycleCounter) {
      this.ourPartitionReceiptsByCycleCounter = {}
    }
    this.ourPartitionReceiptsByCycleCounter[key] = partitionReceipt
  }

  getPartitionReceipt (cycleNumber:number) {
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
  findMostCommonResponse (cycleNumber: number, partitionId: number, ignoreList: string[]): { topHash: string | null; topCount: number; topResult: PartitionResult | null } {
    let key = 'c' + cycleNumber
    let responsesById = this.allPartitionResponsesByCycleByPartition[key]
    let key2 = 'p' + partitionId
    let responses = responsesById[key2]

    let hashCounting:StringNumberObjectMap = {}
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
  static solveHashSets (hashSetList: GenericHashSetEntry[], lookAhead: number = 10, voteRate: number = 0.625, prevOutput: string[] | null = null): string[] {
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
      let votes:StringCountEntryObjectMap = {}
      let topVote:Vote = { v: '', count: 0, vote:undefined, ec: undefined }
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
        let countEntry:CountEntry = votes[v] || { count: 0, ec: 0, voters: [] }
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

          let alreadyVoted:StringBoolObjectMap = {} // has the given node already EC voted for this key?
          // +1 look ahead to see if we can get back on track
          // lookAhead of 0 seems to be more stable
          // let lookAhead = 10 // hashListEntry.errorStack.length
          for (let i = 0; i < hashListEntry.errorStack.length + lookAhead; i++) {
            // using +2 since we just subtracted one from the index offset. anothe r +1 since we want to look ahead of where we just looked
            let thisIndex = (index + hashListEntry.indexOffset + i + 2)
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
            let countEntry:CountEntry = votes[v] || { count: 0, ec: 0, voters: [] } // TSConversion added a missing voters[] object here. looks good to my code inspection but need to validate it with tests!

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
                  let tempCorrection:HashSetEntryCorrection = { i: extraIdx, t: 'extra', c: correction, hi: index2 - (j + 1), tv: null, v: null, bv: null, if: -1 } // added tv: null, v: null, bv: null, if: -1
                  tempCorrections.push(tempCorrection)
                }

                hashListEntry.corrections = hashListEntry.corrections.concat(tempCorrections)
                // +2 so we can go from being put one behind and go to 1 + i ahead.
                hashListEntry.indexOffset += (i + 2)

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
  static compareVoteObjects (voteA: ExtendedVote, voteB: ExtendedVote, strict: boolean) {
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

    return utils.sortAsc( agtb , bgta)

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
  static solveHashSets2 (hashSetList: GenericHashSetEntry[], lookAhead:number = 10, voteRate:number = 0.625): string[] {
    let output:string[] = []
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
    let votes = {} as {[x:string]:ExtendedVote[]}
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
        let sliceStart = (index) * stepSize
        let v = hashListEntry.hashSet.slice(sliceStart, sliceStart + stepSize)
        if (v === '') {
          continue
        }
        solving = true // keep it going
        let votesArray:ExtendedVote[] = votes[v]
        if (votesArray == null) {
          votesseen++
          //TSConversion this was potetially a major bug, v was missing from this structure before!
          // @ts-ignore TSConversion solveHashSets2 is unused. but need to hold off o fixing up these potential nulls
          let votObject:ExtendedVote = { winIdx: null, val: v,v, count: 0, ec: 0, lowestIndex: index, voters: [], voteTally: Array(hashSetList.length), votesseen } as ExtendedVote
          votesArray = [votObject]
          votes[v] = votesArray

          // hashListEntry.ownVotes.push(votObject)
        }

        // get lowest value in list that we have not voted on and is not pinned by our best vote.
        let currentVoteObject:ExtendedVote | null = null
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
          currentVoteObject = { winIdx: null, val: v,v, count: 0, ec: 0, lowestIndex: index, voters: [], voteTally: Array(hashSetList.length), votesseen } as ExtendedVote
          votesArray.push(currentVoteObject)
          // hashListEntry.ownVotes.push(currentVoteObject)
        }
        if(currentVoteObject.voters == null){
          throw new Error('solveHashSets2 currentVoteObject.voters == null')
        }
        if(hashListEntry == null || hashListEntry.ownVotes == null){
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
        } if (currentVoteObject.count >= votesRequired) {
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
    let allVotes:ExtendedVote[] = []
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

    let allWinningVotes:ExtendedVote[] = []
    for (let voteObj of allVotes) {
      // IF was a a winning vote?
      if (voteObj.winIdx !== null) {
        allWinningVotes.push(voteObj)
      }
    }
    allWinningVotes.sort(function (a, b) { return StateManager.compareVoteObjects(a, b, false) })
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
      if(hashListEntry == null || hashListEntry.ownVotes == null){
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
      hashListEntry.corrections.sort( utils.sort_i_Asc ) // (a, b) => a.i - b.i)
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
  static expandIndexMapping (hashListEntry: GenericHashSetEntry, output: string[]) {
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
  solveHashSetsPrep (cycleNumber:number, partitionId:number, ourNodeKey:string):HashSetEntryPartitions[] {
    let key = 'c' + cycleNumber
    let responsesById = this.allPartitionResponsesByCycleByPartition[key]
    let key2 = 'p' + partitionId
    let responses = responsesById[key2]

    let hashSets = {} as {[hash:string]: HashSetEntryPartitions}
    let hashSetList:HashSetEntryPartitions[] = []
    // group identical sets together
    let hashCounting:StringNumberObjectMap = {}
    for (let partitionResult of responses) {
      let hash = partitionResult.Partition_hash
      let count = hashCounting[hash] || 0
      if (count === 0) {
        let owner:string|null = null
        if (partitionResult.sign) {
          owner = partitionResult.sign.owner
        } else {
          owner = ourNodeKey
        }
        //TSConversion had to assert that owner is not null with owner!  seems ok
        let hashSet:HashSetEntryPartitions = { hash: hash, votePower: 0, hashSet: partitionResult.hashSet, lastValue: '', errorStack: [], corrections: [], indexOffset: 0, owners: [owner!], ourRow: false, waitForIndex: -1, ownVotes: [] }
        hashSets[hash] = hashSet
        hashSetList.push(hashSets[hash])
        // partitionResult.hashSetList = hashSet //Seems like this was only ever used for debugging, going to ax it to be safe!
      } else {
        if (partitionResult.sign) {
          hashSets[hash].owners.push(partitionResult.sign.owner)
        }
      }
      if ((partitionResult.sign == null) || partitionResult.sign.owner === ourNodeKey) {
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
  static testHashsetSolution (ourHashSet: GenericHashSetEntry, solutionHashSet: GenericHashSetEntry, log:boolean = false): boolean {
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
    let makeTXArray = function (hashSet: GenericHashSetEntry): string[]  {
      let txArray:string[] = []
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
    let newTxList = { thashes: [], hashes: [], states: [] } as {thashes:string[], hashes:string[], states:string[]}

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

    if(ourHashSet.extraMap == null){
      if (log) console.log(`testHashsetSolution: ourHashSet.extraMap missing`)
      return false
    }
    if(ourHashSet.indexMap == null){
      if (log) console.log(`testHashsetSolution: ourHashSet.indexMap missing`)
      return false
    }
    ourHashSet.extraMap.sort( utils.sortAsc )  // function (a, b) { return a - b })
    solutionList.sort( utils.sort_i_Asc )   // function (a, b) { return a.i - b.i })

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
  static createHashSetString (txHashes:string[], dataHashes:string[] | null) {
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
  sendPartitionData (partitionReceipt:PartitionReceipt, paritionObject:PartitionObject) {
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

  sendTransactionData (partitionNumber: number, cycleNumber: number, transactions:AcceptedTx[]) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' sendTransactionData ' + utils.stringifyReduceLimit({ partitionNumber, cycleNumber, transactions }))

    // send it
    // this.p2p.archivers.sendTransactionData(partitionNumber, cycleNumber, transactions)
  }

  purgeTransactionData () {
    let tsStart = 0
    let tsEnd = 0
    this.storage.clearAcceptedTX(tsStart, tsEnd)
  }

  purgeStateTableData () {
    // do this by timestamp maybe..
    // this happnes on a slower scale.
    let tsEnd = 0 // todo get newest time to keep
    this.storage.clearAccountStateTableOlderThan(tsEnd)
  }

  /**
   * trySendAndPurgeReciepts
   * @param {PartitionReceipt} partitionReceipt
   */
  trySendAndPurgeReceiptsToArchives (partitionReceipt:PartitionReceipt) {
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
        if(paritionObject == null){
          this.fatalLogger.fatal(` trySendAndPurgeReceiptsToArchives paritionObject == null ${cycleNumber} ${partitionId}`)
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
   * _commitAccountCopies
   * This takes an array of account data and pushes it directly into the system with app.resetAccountData
   * Account backup copies and in memory global account backups are also updated
   * you only need to set the true values for the globalAccountKeyMap
   * @param accountCopies 
   */
  async _commitAccountCopies (accountCopies: Shardus.AccountsCopy[], globalAccountKeyMap:{[key:string]: boolean}) {
    
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

      // update the account copies and global backups
      // it is possible some of this gets to go away eventually
      for (let accountEntry of accountCopies) {
        let { accountId, data, timestamp, hash, cycleNumber } = accountEntry
        let isGlobal = this.isGlobalAccount(accountId)
  
        // Maybe don't try to calculate the cycle number....
        // const cycle = this.p2p.state.getCycleByTimestamp(timestamp + this.syncSettleTime)
        // // find the correct cycle based on timetamp
        // if (!cycle) {
        //   this.mainLogger.error(`_commitAccountCopies failed to get cycle for timestamp ${timestamp} accountId:${utils.makeShortHash(accountId)}`)
        //   continue
        // }
        // let cycleNumber = cycle.counter

        let backupObj:Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }
  
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `_commitAccountCopies acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)
  
        // If the account is global ad it to the global backup list
        if(globalAccountKeyMap[accountId] === true){ //this.isGlobalAccount(accountId)){
        
          // If we do not realized this account is global yet, then set it and log to playback log
          if(this.isGlobalAccount(accountId) === false){
            this.globalAccountMap.set(accountId, null) // we use null. ended up not using the data, only checking for the key is used
            this.logger.playbackLogNote('globalAccountMap', `set global in _commitAccountCopies accountId:${utils.makeShortHash(accountId)}`)
          }

          let globalBackupList:Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(accountId)
          if(globalBackupList != null){
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
}

export default StateManager
