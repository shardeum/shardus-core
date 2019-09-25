const EventEmitter = require('events')
const utils = require('../utils')
const ShardFunctions = require('./shardFunctions.js')
const stringify = require('fast-stable-stringify')

const allZeroes64 = '0'.repeat(64)

const cHashSetStepSize = 4
const cHashSetTXStepSize = 2
const cHashSetDataStepSize = 2

// some addtional types up here /////////////////////////
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

// ///////////////////////// Lots of type definitions for partitions

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
   * @typedef {Object} RepairTracker a partition object
   * @property {string[]} triedHashes
   * @property {number} numNodes
   * @property {number} counter
   * @property {number} partitionId
   * @property {string} key
   * @property {string} key2
   * @property {string[]} removedTXIds
   * @property {string[]} repairedTXs
   * @property {AcceptedTx[]} newPendingTXs
   * @property {string[]} newFailedTXs
   * @property {string[]} extraTXIds
   * @property {string[]} missingTXIds
   * @property {boolean} repairing
   * @property {boolean} repairsNeeded
   * @property {boolean} busy
   * @property {boolean} txRepairComplete
   * @property {boolean} evaluationStarted
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
 * @typedef {Object} TxTallyList an object that tracks our TXs that we are storing for later.
 * @property {string[]} hashes
 * @property {number[]} passed AcceptedTx?
 * @property {any[]} txs
 * @property {boolean} processed
 * @property {any[]} states below 0 for not redacted. a value above zero indicates the cycle this was redacted
 * @property {any} [newTxList] this gets added on when we are reparing something newTxList seems to have a different format than existing types.
 */

// txList = { hashes: [], passed: [], txs: [], processed: false, states: [] }
// we have this structure for solving hashes generically
// let hashSet = { hash: hash, votePower: 0, hashSet: partitionResult.hashSet, lastValue: '', errorStack: [], corrections: [], indexOffset: 0, owners: [owner], ourRow: false, waitForIndex: -1 }

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
   * @property {number[]} [indexMap] this gets added when you call expandIndexMapping
   * @property {number[]} [extraMap] this gets added when you call expandIndexMapping
   * @property {number} [futureIndex]
   * @property {string} [futureValue]
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
   */

/**
 * StateManager
 */
class StateManager extends EventEmitter {
  /**
   * @param {boolean} verboseLogs
   * @param {import("../shardus").App} app
   * @param {import("../consensus")} consensus
   * @param {import("../p2p")} p2p
   * @param {import("../crypto")} crypto
   * @param {any} config
   */
  constructor (verboseLogs, profiler, app, consensus, logger, storage, p2p, crypto, config) {
    super()
    this.verboseLogs = verboseLogs
    this.profiler = profiler
    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.p2p = p2p
    this.crypto = crypto
    this.storage = storage
    /**
     * @type {App}
     */
    this.app = app
    this.consensus = consensus
    this.logger = logger
    this.shardLogger = logger.getLogger('shardDump')

    this.config = config

    this._listeners = {}

    this.completedPartitions = []
    this.mainStartingTs = Date.now()

    this.queueSitTime = 6000 // todo make this a setting. and tie in with the value in consensus
    // this.syncSettleTime = 8000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later
    this.syncSettleTime = this.queueSitTime + 2000 // 3 * 10 // an estimate of max transaction settle time. todo make it a config or function of consensus later

    this.newAcceptedTxQueue = []
    this.newAcceptedTxQueueTempInjest = []
    this.archivedQueueEntries = []
    this.newAcceptedTxQueueRunning = false
    this.dataSyncMainPhaseComplete = false
    this.queueEntryCounter = 0
    this.queueRestartCounter = 0
    this.lastSeenAccountsMap = null

    this.clearPartitionData()
    this.syncTrackers = []
    this.runtimeSyncTrackerSyncing = false

    this.acceptedTXQueue = []
    this.acceptedTXByHash = {}
    this.registerEndpoints()

    this.isSyncingAcceptedTxs = true // default is true so we will start adding to our tx queue asap

    this.verboseLogs = false
    if (this.mainLogger && ['TRACE'].includes(this.mainLogger.level.levelStr)) {
      this.verboseLogs = true
    }

    this.dataPhaseTag = 'DATASYNC: '

    this.applySoftLock = false

    this.initStateSyncData()

    this.useHashSets = true
    this.lastActiveNodeCount = 0

    this.queueStopped = false

    this.extendedRepairLogging = false

    this.shardInfo = {}

    /** @type {Map<number, CycleShardData>} */
    this.shardValuesByCycle = new Map()
    /** @type {CycleShardData} */
    this.currentCycleShardData = null

    this.syncTrackerIndex = 1 // increments up for each new sync tracker we create gets maped to calls.

    this.preTXQueue = []
    this.readyforTXs = false

    this.startShardCalculations()
    this.sleepInterrupt = undefined

    this.lastCycleReported = -1
    this.partitionReportDirty = false
    this.nextCycleReportToSend = null
  }

  // this clears state data related to the current partion we are syncing.
  clearPartitionData () {
    // These are all for the given partition
    this.addressRange = null
    this.dataSourceNode = null
    this.removedNodes = []

    // this.state = EnumSyncState.NotStarted
    this.allFailedHashes = []
    this.inMemoryStateTableData = []

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
  updateShardValues (cycleNumber) {
    if (this.currentCycleShardData == null) {
      this.logger.playbackLogNote('shrd_sync_firstCycle', `${cycleNumber}`, ` first init `)
    }

    /** @type {CycleShardData} */
    let cycleShardData = {}

    // todo get current cycle..  store this by cycle?
    cycleShardData.nodeShardDataMap = new Map()
    cycleShardData.parititionShardDataMap = new Map()
    cycleShardData.activeNodes = this.p2p.state.getActiveNodes(null)
    cycleShardData.activeNodes.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })
    cycleShardData.cycleNumber = cycleNumber

    try {
      cycleShardData.ourNode = this.p2p.state.getNode(this.p2p.id) // ugh, I bet there is a nicer way to get our node
    } catch (ex) {
      this.logger.playbackLogNote('shrd_sync_notactive', `${cycleNumber}`, `  `)
      return
    }

    if (cycleShardData.activeNodes.length === 0) {
      return // no active nodes so stop calculating values
    }

    // save this per cycle?
    cycleShardData.shardGlobals = ShardFunctions.calculateShardGlobals(cycleShardData.activeNodes.length, this.config.sharding.nodesPerConsensusGroup)

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

    // calculate if there are any nearby nodes that are syncing right now.
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

    if (cycleShardData.ourNode.status === 'active') {
      // if (this.preTXQueue.length > 0) {
      //   for (let tx of this.preTXQueue) {
      //     this.logger.playbackLogNote('shrd_sync_preTX', ` `, ` ${utils.stringifyReduce(tx)} `)
      //     this.queueAcceptedTransaction(tx, false, null)
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

      this.calculateChangeInCoverage()
    }

    // calculate our consensus partitions for use by data repair:
    // cycleShardData.ourConsensusPartitions = []
    let partitions = ShardFunctions.getConsenusPartitions(cycleShardData.shardGlobals, cycleShardData.nodeShardData)
    cycleShardData.ourConsensusPartitions = partitions

    // this will be a huge log.
    this.logger.playbackLogNote('shrd_sync_cycleData', `${cycleNumber}`, ` cycleShardData: cycle:${cycleNumber} data: ${utils.stringifyReduce(cycleShardData)}`)
  }

  calculateChangeInCoverage () {
    // maybe this should be a shard function so we can run unit tests on it for expanding or shrinking networks!
    let newSharddata = this.currentCycleShardData

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
      let range = {}
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

  async syncRuntimeTrackers () {
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

  getCurrentCycleShardData () {
    if (this.currentCycleShardData === null) {
      let cycle = this.p2p.state.getLastCycle()
      if (cycle == null) {
        return null
      }
      this.updateShardValues(cycle.counter)
    }

    return this.currentCycleShardData
  }

  // todo refactor: this into a util, grabbed it from p2p
  // From: https://stackoverflow.com/a/12646864
  shuffleArray (array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]]
    }
  }

  getRandomInt (max) {
    return Math.floor(Math.random() * Math.floor(max))
  }

  getRandomIndex (list) {
    let max = list.length - 1
    return Math.floor(Math.random() * Math.floor(max))
  }

  // todo need a faster more scalable version of this if we get past afew hundred nodes.
  getActiveNodesInRange (lowAddress, highAddress, exclude = []) {
    let allNodes = this.p2p.state.getActiveNodes(this.p2p.id)
    this.lastActiveNodeCount = allNodes.length
    let results = []
    let count = allNodes.length
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

  // todo refactor: move to p2p?
  getRandomNodesInRange (count, lowAddress, highAddress, exclude) {
    let allNodes = this.p2p.state.getActiveNodes(this.p2p.id)
    this.lastActiveNodeCount = allNodes.length
    this.shuffleArray(allNodes)
    let results = []
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

  createSyncTrackerByRange (range, cycle) {
    // let partition = -1
    let index = this.syncTrackerIndex++
    let syncTracker = { range, queueEntries: [], cycle, index } // partition,
    syncTracker.syncStarted = false
    syncTracker.syncFinished = false

    this.syncTrackers.push(syncTracker) // we should maintain this order.

    return syncTracker
  }

  getSyncTracker (address) {
    // return the sync tracker.
    for (let i = 0; i < this.syncTrackers.length; i++) {
      let syncTracker = this.syncTrackers[i]

      // need to see if address is in range. if so return the tracker.
      // if (ShardFunctions.testAddressInRange(address, syncTracker.range)) {
      if (syncTracker.range.low < address && address < syncTracker.range.high) {
        return syncTracker
      }
    }
    return null
  }

  // syncs transactions and application state data
  // This is the main outer loop that will loop over the different partitions
  // The last step catch up on the acceptedTx queue
  async syncStateData (requiredNodeCount) {
    // Dont sync if first node
    if (this.p2p.isFirstSeed) {
      this.dataSyncMainPhaseComplete = true

      this.readyforTXs = true
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

    let rangesToSync = []

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
    if (nodeShardData.storedPartitions.partitionStart1 < homePartition && nodeShardData.storedPartitions.partitionEnd1 > homePartition) {
      // two ranges
      let range1 = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, nodeShardData.storedPartitions.partitionStart1, homePartition)
      let range2 = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, homePartition, nodeShardData.storedPartitions.partitionEnd1)

      // stich the addresses together
      let [centerAddr, centerAddrPlusOne] = ShardFunctions.findCenterAddressPair(range1.high, range2.low)
      range1.high = centerAddr
      range2.low = centerAddrPlusOne
      rangesToSync.push(range1)
      rangesToSync.push(range2)
      console.log(`range1:2  s:${nodeShardData.storedPartitions.partitionStart1} e:${nodeShardData.storedPartitions.partitionEnd1} h: ${homePartition} `)
    } else {
      // one range
      rangesToSync.push(nodeShardData.storedPartitions.partitionRange)
      console.log(`range1:1  s:${nodeShardData.storedPartitions.partitionStart1} e:${nodeShardData.storedPartitions.partitionEnd1} h: ${homePartition} `)
    }
    if (nodeShardData.storedPartitions.rangeIsSplit) {
      if (nodeShardData.storedPartitions.partitionStart2 < homePartition && nodeShardData.storedPartitions.partitionEnd2 > homePartition) {
      // two ranges
        let range1 = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, nodeShardData.storedPartitions.partitionStart2, homePartition)
        let range2 = ShardFunctions.partitionToAddressRange2(this.currentCycleShardData.shardGlobals, homePartition, nodeShardData.storedPartitions.partitionEnd2)
        // stich the addresses together
        let [centerAddr, centerAddrPlusOne] = ShardFunctions.findCenterAddressPair(range1.high, range2.low)
        range1.high = centerAddr
        range2.low = centerAddrPlusOne
        rangesToSync.push(range1)
        rangesToSync.push(range2)
        console.log(`range2:2  s:${nodeShardData.storedPartitions.partitionStart2} e:${nodeShardData.storedPartitions.partitionEnd2} h: ${homePartition} `)
      } else {
        // one range
        rangesToSync.push(nodeShardData.storedPartitions.partitionRange2)
        console.log(`range2:1  s:${nodeShardData.storedPartitions.partitionStart2} e:${nodeShardData.storedPartitions.partitionEnd2} h: ${homePartition} `)
      }
    }

    console.log(`syncStateData ranges: ${utils.stringifyReduce(rangesToSync)}}`)

    for (let range of rangesToSync) {
      // let nodes = ShardFunctions.getNodesThatCoverRange(this.currentCycleShardData.shardGlobals, range.low, range.high, this.currentCycleShardData.ourNode, this.currentCycleShardData.activeNodes)
      this.createSyncTrackerByRange(range, cycle)
    }

    // could potentially push this back a bit.
    this.readyforTXs = true

    await utils.sleep(8000) // sleep to make sure we are listening to some txs before we sync them

    for (let syncTracker of this.syncTrackers) {
      // let partition = syncTracker.partition
      console.log(`syncTracker start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
      this.logger.playbackLogNote('shrd_sync_trackerRangeStart', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)

      syncTracker.syncStarted = true
      await this.syncStateDataForRange(syncTracker.range)
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
    await this._firstTimeQueueAwait()

    console.log('syncStateData end' + '   time:' + Date.now())

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
  async syncStateDataForRange (range) {
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

  async syncStateTableData (lowAddress, highAddress, startTime, endTime) {
    let searchingForGoodData = true

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

      let equalFn = (a, b) => {
        return a.stateHash === b.stateHash
      }
      let queryFn = async (node) => {
        let result = await this.p2p.ask(node, 'get_account_state_hash', message)
        return result
      }

      let centerNode = ShardFunctions.getCenterHomeNode(this.currentCycleShardData.shardGlobals, this.currentCycleShardData.parititionShardDataMap, lowAddress, highAddress)
      let nodes = ShardFunctions.getNodesByProximity(this.currentCycleShardData.shardGlobals, this.currentCycleShardData.activeNodes, centerNode.ourNodeIndex, this.p2p.id, 40)

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
        this.mainLogger.debug(`DATASYNC: got hash ${result.stateHash} from ${utils.stringifyReduce(winners.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
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

  async syncAccountData (lowAddress, highAddress) {
    // Sync the Account data
    //   Use the /get_account_data API to get the data from the Account Table using any of the nodes that had a matching hash
    console.log(`syncAccountData3` + '   time:' + Date.now())

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
      let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data3', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory
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
        this.mainLogger.debug(`DATASYNC: syncAccountData3 got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lowTimeQuery} highestTS1: ${result.data.highestTs}`)
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
    let missingButOkAccountIDs = {}

    let missingAccountIDs = {}

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
        account.syncData = {}
      }

      if (account.stateId === stateData.stateAfter) {
        // mark it good.
        account.syncData.uptodate = true
        account.syncData.anyMatch = true
      } else {
        //
        account.syncData.uptodate = false
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
    this.goodAccounts = []
    let noSyncData = 0
    let noMatches = 0
    for (let account of this.combinedAccountData) {
      if (!account.syncData) {
        // this account was not found in state data
        this.accountsWithStateConflict.push(account)
        noSyncData++
      } else if (!account.syncData.anyMatch) {
        // this account was in state data but none of the state table stateAfter matched our state
        this.accountsWithStateConflict.push(account)
        noMatches++
      } else {
        delete account.syncData
        this.goodAccounts.push(account)
      }
    }

    this.mainLogger.debug(`DATASYNC: processAccountData saving ${this.goodAccounts.length} of ${this.combinedAccountData.length} records to db.  noSyncData: ${noSyncData} noMatches: ${noMatches} missingTXs: ${missingTXs} handledButOk: ${handledButOk} otherMissingCase: ${otherMissingCase}`)
    // failedHashes is a list of accounts that failed to match the hash reported by the server
    let failedHashes = await this.checkAndSetAccountData(this.goodAccounts) // repeatable form may need to call this in batches

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

    await this.writeCombinedAccountDataToBackups(failedHashes)

    this.combinedAccountData = [] // we can clear this now.
  }

  async writeCombinedAccountDataToBackups (failedHashes) {
    if (failedHashes.length === 0) {
      return // nothing to do yet
    }

    let failedAccountsById = {}
    for (let hash of failedHashes) {
      failedAccountsById[hash] = true
    }

    const lastCycle = this.p2p.state.getLastCycle()
    let cycleNumber = lastCycle.counter
    let accountCopies = []
    for (let accountEntry of this.goodAccounts) {
      // check failed hashes
      if (failedAccountsById[accountEntry.stateId]) {
        continue
      }
      // wrappedAccounts.push({ accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp })
      let accountCopy = { accountId: accountEntry.accountId, data: accountEntry.data, timestamp: accountEntry.timestamp, hash: accountEntry.stateId, cycleNumber }
      accountCopies.push(accountCopy)
    }
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'writeCombinedAccountDataToBackups ' + accountCopies.length + ' ' + JSON.stringify(accountCopies[0]))
    await this.storage.createAccountCopies(accountCopies)
  }

  // Sync the failed accounts
  //   Log that some account failed
  //   Use the /get_account_data_by_list API to get the data for the accounts that need to be looked up later from any of the nodes that had a matching hash but different from previously used nodes
  //   Repeat the “Sync the Account State Table Second Pass” step
  //   Repeat the “Process the Account data” step
  async syncFailedAcccounts (lowAddress, highAddress) {
    if (this.accountsWithStateConflict.length === 0 && this.missingAccountData.length === 0) {
      this.mainLogger.debug(`DATASYNC: syncFailedAcccounts no failed hashes to sync`)
      return
    }
    if (this.verboseLogs) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts start`)
    let addressList = []
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

    this.combinedAccountData = this.combinedAccountData.concat(result.accountData)

    this.mainLogger.debug(`DATASYNC: syncFailedAcccounts combinedAccountData: ${this.combinedAccountData.length} accountData: ${result.accountData.length}`)

    await this.syncStateTableData(lowAddress, highAddress, this.lastStateSyncEndtime, Date.now())

    // process the new accounts.
    await this.processAccountData()
  }

  // This will make calls to app.getAccountDataByRange but if we are close enough to real time it will query any newer data and return lastUpdateNeeded = true
  async getAccountDataByRangeSmart (accountStart, accountEnd, tsStart, maxRecords) {
    let tsEnd = Date.now()
    let wrappedAccounts = await this.app.getAccountDataByRange(accountStart, accountEnd, tsStart, tsEnd, maxRecords)
    let lastUpdateNeeded = false
    let wrappedAccounts2 = []
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
      console.log('delta ' + delta)
      if (delta < this.queueSitTime) {
        let tsStart2 = highestTs
        wrappedAccounts2 = await this.app.getAccountDataByRange(accountStart, accountEnd, tsStart2, Date.now(), 10000000)
        lastUpdateNeeded = true
      }
    }
    return { wrappedAccounts, lastUpdateNeeded, wrappedAccounts2, highestTs }
  }

  async checkAndSetAccountData (accountRecords) {
    let accountsToAdd = []
    let failedHashes = []
    for (let { accountId, stateId, data: recordData } of accountRecords) {
      let hash = this.app.calculateAccountHash(recordData)
      if (stateId === hash) {
        // if (recordData.owners) recordData.owners = JSON.parse(recordData.owners)
        // if (recordData.data) recordData.data = JSON.parse(recordData.data)
        // if (recordData.txs) recordData.txs = JSON.parse(recordData.txs) // dont parse this, since it is already the string form we need to write it.
        accountsToAdd.push(recordData)
        console.log('setAccountData: ' + hash + ' txs: ' + recordData.txs)
      } else {
        console.log('setAccountData hash test failed: setAccountData for ' + accountId)
        console.log('setAccountData hash test failed: details: ' + utils.stringifyReduce({ accountId, hash, stateId, recordData }))
        failedHashes.push(accountId)
      }
    }
    console.log('setAccountData: ' + accountsToAdd.length)
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
    this.p2p.registerGossipHandler('acceptedTx', async (acceptedTX, sender, tracker) => {
      // docs mention putting this in a table but it seems so far that an in memory queue should be ok
      // should we filter, or instead rely on gossip in to only give us TXs that matter to us?

      this.p2p.sendGossipIn('acceptedTx', acceptedTX, tracker, sender)

      await this.queueAcceptedTransaction(acceptedTX, false, sender)
    })

    // /get_account_state_hash (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns a single hash of the data from the Account State Table determined by the input parameters; sort by Tx_ts  then Tx_id before taking the hash
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state_hash', async (payload, respond) => {
      let result = {}

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
    this.p2p.registerInternal('get_account_state', async (payload, respond) => {
      let result = {}
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
    this.p2p.registerInternal('get_accepted_transactions', async (payload, respond) => {
      let result = {}

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
    this.p2p.registerInternal('get_account_data', async (payload, respond) => {
      let result = {}
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountData(payload.accountStart, payload.accountEnd, payload.maxRecords)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      result.accountData = accountData
      await respond(result)
    })

    this.p2p.registerInternal('get_account_data2', async (payload, respond) => {
      let result = {}
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountDataByRange(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd, payload.maxRecords)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      result.accountData = accountData
      await respond(result)
    })

    this.p2p.registerInternal('get_account_data3', async (payload, respond) => {
      let result = {}
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.getAccountDataByRangeSmart(payload.accountStart, payload.accountEnd, payload.tsStart, payload.maxRecords)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
      result.data = accountData
      await respond(result)
    })

    // /get_account_data_by_list (Acc_ids)
    // Acc_ids - array of accounts to get
    // Returns data from the application Account Table for just the given account ids;
    // For applications with multiple “Account” tables the returned data is grouped by table name.
    // For example: [ {Acc_id, State_after, Acc_data}, { … }, ….. ]
    // Updated names:  accountIds, max records
    this.p2p.registerInternal('get_account_data_by_list', async (payload, respond) => {
      let result = {}
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.fifoLock('accountModification')
        accountData = await this.app.getAccountDataByList(payload.accountIds)
      } finally {
        this.fifoUnlock('accountModification', ourLockID)
      }
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
     * @param {any} respond
     */
      async (payload, respond) => {
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

          if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results ${utils.stringifyReduce(payload)}`)

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
            responses = responses.filter(item => (item.sign == null) || item.sign.owner !== owner)
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
              responsesRequired = 1 + Math.ceil(repairTracker.numNodes * 0.9) // get responses from 90% of the node we have sent to
            }
            // are there enough responses to try generating a receipt?
            if (responses.length >= responsesRequired && (repairTracker.evaluationStarted === false || repairTracker.awaitWinningHash)) {
              repairTracker.evaluationStarted = true

              let ourResult = null
              for (let obj of ourPartitionResults) {
                if (obj.Partition_id === partitionId) {
                  ourResult = obj
                  break
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

                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results: tryGeneratePartitionReciept failed start repair process ${receiptResults}`)
                let cycle = this.p2p.state.getCycleByCounter(payload.Cycle_number)
                await this.startRepairProcess(cycle, topResult, partitionId, ourResult.Partition_hash)
              } else if (partitionReceipt) {
              // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results: success store partition receipt`)
                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair post_partition_results 3 allFinished, final cycle: ${payload.Cycle_number} hash:${utils.stringifyReduce({ topResult })}`)
                // do we ever send partition receipt yet?
                this.storePartitionReceipt(payload.Cycle_number, partitionReceipt)
                this.repairTrackerMarkFinished(repairTracker)
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

    // /get_transactions_by_list (Tx_ids)
    //   Tx_ids - array of transaction ids
    //   Returns data from the Transactions Table for just the given transaction ids
    this.p2p.registerInternal('get_transactions_by_list', async (payload, respond) => {
      let result = {}
      try {
        result = await this.storage.queryAcceptedTransactionsByIds(payload.Tx_ids)
      } finally {
      }
      await respond(result)
    })

    this.p2p.registerInternal('get_transactions_by_partition_index', async (payload, respond) => {
      let result = {}

      let passFailList = []
      try {
        // let partitionId = payload.partitionId
        let cycle = payload.cycle
        let indicies = payload.tx_indicies
        let hash = payload.hash

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

        result = await this.storage.queryAcceptedTransactionsByIds(txIDList)
      } finally {
      }
      // TODO fix pass fail sorting.. it is probably all wrong and out of sync, but currently nothing fails.
      await respond({ success: true, acceptedTX: result, passFail: passFailList })
    })

    // /get_partition_txids (Partition_id, Cycle_number)
    //   Partition_id
    //   Cycle_number
    //   Returns the partition object which contains the txids along with the status
    this.p2p.registerInternal('get_partition_txids', async (payload, respond) => {
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

    // p2p TELL
    this.p2p.registerInternal('route_to_home_node', async (payload, respond) => {
      // gossip 'spread_tx_to_group' to transaction group
      // Place tx in queue (if younger than m)

      // make sure we don't already have it
      let queueEntry = this.getQueueEntrySafe(payload.txid, payload.timestamp)
      if (queueEntry) {
        return
        // already have this in our queue
      }

      this.queueAcceptedTransaction(payload.acceptedTx, true, null) // todo pass in sender?

      // no response needed?
    })

    // p2p ASK
    this.p2p.registerInternal('request_state_for_tx', async (payload, respond) => {
      let response = { stateList: [] }
      // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
      let queueEntry = this.getQueueEntrySafe(payload.txid, payload.timestamp)
      if (queueEntry == null) {
        queueEntry = this.getQueueEntryArchived(payload.txid, payload.timestamp)
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
      await respond(response)
    })

    // p2p TELL
    this.p2p.registerInternal('broadcast_state', async (payload, respond) => {
      // Save the wrappedAccountState with the rest our queue data
      // let message = { stateList: datas, txid: queueEntry.acceptedTX.id }
      // this.p2p.tell([correspondingEdgeNode], 'broadcast_state', message)

      // make sure we have it
      let queueEntry = this.getQueueEntrySafe(payload.txid, payload.timestamp)
      if (queueEntry == null) {
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

      let queueEntry = this.getQueueEntrySafe(payload.id, payload.timestamp)
      if (queueEntry) {
        return
        // already have this in our queue
      }

      let added = this.queueAcceptedTransaction(payload, false, sender)
      if (added === 'lost') {
        return // we are faking that the message got lost so bail here
      }
      if (added === 'out of range') {
        return // we are faking that the message got lost so bail here
      }
      if (added === 'notReady') {
        return // we are faking that the message got lost so bail here
      }
      queueEntry = this.getQueueEntrySafe(payload.id, payload.timestamp) // now that we added it to the queue, it should be possible to get the queueEntry now

      // how did this work before??
      // get transaction group. 3 accounds, merge lists.
      let transactionGroup = this.queueEntryGetTransactionGroup(queueEntry)
      if (queueEntry.ourNodeInvolved === false) {
        // do not gossip this, we are not involved
        return
      }
      if (transactionGroup.length > 1) {
        this.p2p.sendGossipIn('spread_tx_to_group', payload, tracker, sender, transactionGroup)
      }

      // await this.queueAcceptedTransaction(acceptedTX, false, sender)
    })

    this.p2p.registerInternal('get_account_data_with_queue_hints', async (payload, respond) => {
      let result = {}
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
          wrappedAccount.seenInQueue = false

          if (this.lastSeenAccountsMap != null) {
            let queueEntry = this.lastSeenAccountsMap[wrappedAccount.accountId]
            if (queueEntry != null) {
              wrappedAccount.seenInQueue = true
            }
          }
        }
      }

      result.accountData = accountData
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
    this.p2p.unregisterInternal('route_to_home_node')
    this.p2p.unregisterInternal('request_state_for_tx')
    this.p2p.unregisterInternal('broadcast_state')
    this.p2p.unregisterGossipHandler('spread_tx_to_group')
    this.p2p.unregisterInternal('get_account_data_with_queue_hints')
  }

  // ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // //////////////////////////   Old simple sync check, could be handy for debugging/test?   //////////////////////////
  // ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  enableSyncCheck () {
    // return // hack no sync check , dont check in!!!!!
    this._registerListener(this.p2p.state, 'newCycle', (cycles) => process.nextTick(async () => {
      if (cycles.length < 2) {
        return
      }
      let thisCycle = cycles[cycles.length - 1]
      let lastCycle = cycles[cycles.length - 2]
      let endTime = thisCycle.start * 1000
      let startTime = lastCycle.start * 1000

      let accountStart = '0'.repeat(64)
      let accountEnd = 'f'.repeat(64)
      let message = { accountStart, accountEnd, tsStart: startTime, tsEnd: endTime }

      await utils.sleep(this.syncSettleTime) // wait a few seconds for things to settle

      let equalFn = (a, b) => {
        return a.stateHash === b.stateHash
      }
      let queryFn = async (node) => {
        let result = await this.p2p.ask(node, 'get_account_state_hash', message)
        return result
      }
      // let nodes = this.p2p.state.getAllNodes(this.p2p.id)
      let nodes = this.getRandomNodesInRange(100, accountStart, accountEnd, [])
      if (nodes.length === 0) {
        return // nothing to do
      }
      let [result, winners] = await this.p2p.robustQuery(nodes, queryFn, equalFn, 3)
      if (result && result.stateHash) {
        let stateHash = await this.getAccountsStateHash(accountStart, accountEnd, startTime, endTime)
        if (stateHash === result.stateHash) {
          this.logger.playbackLogNote('appStateCheck', '', `Hashes Match = ${utils.makeShortHash(stateHash)} num cycles:${cycles.length} start: ${startTime}  end:${endTime}`)
        } else {
          this.logger.playbackLogNote('appStateCheck', '', `Hashes Dont Match ourState: ${utils.makeShortHash(stateHash)} otherState: ${utils.makeShortHash(result.stateHash)} window: ${startTime} to ${endTime}`)
          // winners[0]
          await this.restoreAccountDataByTx(winners, accountStart, accountEnd, startTime, endTime)
        }
      }
    }))
  }

  async restoreAccountDataByTx (nodes, accountStart, accountEnd, timeStart, timeEnd) {
    this.logger.playbackLogNote('restoreByTx', '', `start`)

    let helper = nodes[0]

    let message = { tsStart: timeStart, tsEnd: timeEnd, limit: 10000 }
    let result = await this.p2p.ask(helper, 'get_accepted_transactions', message) // todo perf, could await these in parallel
    let acceptedTXs = result.transactions

    let toParse = {}
    try {
      for (let i = 0; i < acceptedTXs.length; i++) {
        toParse = acceptedTXs[i]
        if (utils.isObject(toParse) === false) {
          // this is crazy, could have been nicer to just ignore the error:
          let funtime = /** @type {string} */ (/** @type {unknown} */ (toParse))
          acceptedTXs[i] = JSON.parse(funtime)
          // this.logger.playbackLogNote('restoreByTx', '', `parsed: ${acceptedTXs[i]}`)
        } else {
          // this.logger.playbackLogNote('restoreByTx', '', acceptedTXs[i])

          toParse.data = JSON.parse(toParse.data)
          toParse.receipt = JSON.parse(toParse.receipt)
        }
      }
    } catch (ex) {
      this.fatalLogger.fatal('restoreByTx error: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack + ' while parsing: ' + toParse)
    }
    this.acceptedTXQueue = this.acceptedTXQueue.concat(acceptedTXs)

    this.logger.playbackLogNote('restoreByTx', '', `tx count: ${this.acceptedTXQueue.length} queue: `) // ${utils.stringifyReduce(this.acceptedTXQueue)}

    // await this.applyAcceptedTx()
    for (let acceptedTx of acceptedTXs) {
      this.queueAcceptedTransaction(acceptedTx, false)
    }

    // todo insert these in a sorted way to the new queue

    this.logger.playbackLogNote('restoreByTx', '', `end`)
  }

  // Code Not in use, but could be used as a reference for future code
  sortedArrayDifference (a, b, compareFn) {
    let results = []
    // let aIdx = 0
    let bIdx = 0

    for (let i = 0; i < a.length; ++i) {
      let aEntry = a[i]
      let bEntry = b[bIdx]
      let cmp = compareFn(aEntry, bEntry)
      if (cmp === 0) {
        bIdx++
      } else if (cmp < 1) {
        results.push(aEntry)
      } else {
        // nothing
      }
    }
    return results
  }

  // Code Not in use/finished, but could be used as a reference for future code
  async restoreAccountData (nodes, accountStart, accountEnd, timeStart, timeEnd) {
    let helper = nodes[0]

    let message = { accountStart: accountStart, accountEnd: accountEnd, tsStart: timeStart, tsEnd: timeEnd }
    let remoteAccountStates = await this.p2p.ask(helper, 'get_account_state', message) // todo perf, could await these in parallel
    let accountStates = await this.storage.queryAccountStateTable(accountStart, accountEnd, timeStart, timeEnd, 100000000)

    let compareFn = (a, b) => {
      if (a.txTimestamp !== b.txTimestamp) {
        return (a.txTimestamp > b.txTimestamp) ? 1 : -1
      } else if (a.accountId !== b.accountId) {
        return (a.accountId > b.accountId) ? 1 : -1
      } else {
        return 0
      }
    }
    let diff = this.sortedArrayDifference(remoteAccountStates, accountStates, compareFn)
    if (diff.length <= 0) {
      return // give up
    }
    let accountsToPatch = []
    // patch account states
    await this.storage.addAccountStates(diff)
    for (let state of diff) {
      if (state.accountId) {
        accountsToPatch.push(state.accountId)
      }
    }

    let message2 = { accountIds: accountsToPatch }
    let accountData = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message2)

    if (accountData) {
      // for(let account in accountData) {
      //   //if exists update.
      //   //else create
      // }
      // todo  this.todo.patchUpdateAccounts(accountData)
    }
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

  async testAccountTimesAndStateTable (tx, accountData) {
    let hasStateTableData = false

    function tryGetAccountData (accountID) {
      for (let accountEntry of accountData) {
        if (accountEntry.accountId === accountID) {
          return accountEntry
        }
      }
      return null
    }

    try {
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { sourceKeys, targetKeys, timestamp } = keysResponse
      let sourceAddress, targetAddress, sourceState, targetState

      // check account age to make sure it is older than the tx
      let failedAgeCheck = false
      for (let accountEntry of accountData) {
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
            if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1')
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1 stateId: ' + utils.makeShortHash(sourceState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(sourceAddress))
            return { success: false, hasStateTableData }
          }
        }
      }
      if (Array.isArray(targetKeys) && targetKeys.length > 0) {
        targetAddress = targetKeys[0]
        let accountStates = await this.storage.searchAccountStateTable(targetAddress, timestamp)

        if (accountStates.length !== 0) {
          hasStateTableData = true
          if (accountStates.length !== 0 && accountStates[0].stateBefore !== allZeroes64) {
            let accountEntry = tryGetAccountData(targetAddress)

            if (accountEntry == null) {
              if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress))
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ' + utils.stringifyReduce(accountData))
              this.fatalLogger.fatal(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ' + utils.stringifyReduce(accountData)) // todo: consider if this is just an error
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
    } catch (ex) {
      this.fatalLogger.fatal('testAccountTimesAndStateTable failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    }
    return { success: true, hasStateTableData }
  }

  async testAccountTimesAndStateTable2 (tx, wrappedStates) {
    let hasStateTableData = false

    function tryGetAccountData (accountID) {
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
            if (this.verboseLogs) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1')
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1 stateId: ' + utils.makeShortHash(sourceState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(sourceAddress))
            return { success: false, hasStateTableData }
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

  async testAccountTime (tx, wrappedStates) {
    function tryGetAccountData (accountID) {
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
  async tryApplyTransaction (acceptedTX, hasStateTableData, repairing, filter, wrappedStates, localCachedData) {
    let ourLockID = -1
    let accountDataList
    let txTs = 0
    let accountKeys = []
    let ourAccountLocks
    let applyResponse
    try {
      let tx = acceptedTX.data
      // let receipt = acceptedTX.receipt
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { timestamp, debugInfo } = keysResponse
      txTs = timestamp
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `tryApplyTransaction  ts:${timestamp} repairing:${repairing}  Applying! ` + debugInfo)

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
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair tryApplyTransaction FIFO lock inner: ${utils.stringifyReduce(accountKeys)} `)
      }

      ourLockID = await this.fifoLock('accountModification')

      if (this.verboseLogs) console.log(`tryApplyTransaction  ts:${timestamp} repairing:${repairing}  Applying!`)
      // if (this.verboseLogs) this.mainLogger.debug('APPSTATE: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))
      this.applySoftLock = true

      // let replyObject = { stateTableResults: [], txId, txTimestamp, accountData: [] }
      // let wrappedStatesList = Object.values(wrappedStates)
      applyResponse = await this.app.apply(tx, wrappedStates)
      let { stateTableResults, accountData: _accountdata } = applyResponse
      accountDataList = _accountdata

      // wrappedStates are side effected for now
      await this.setAccount(wrappedStates, localCachedData, applyResponse, filter)

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

      if (!repairing) this.tempRecordTXByCycle(txTs, acceptedTX, false, applyResponse)

      return false
    } finally {
      this.fifoUnlock('accountModification', ourLockID)
      if (repairing !== true) {
        this.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair tryApplyTransaction FIFO unlock inner: ${utils.stringifyReduce(accountKeys)} `)
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

    await this.updateAccountsCopyTable(dataResultsFullList, repairing, txTs)

    if (!repairing) {
      // await this.updateAccountsCopyTable(accountDataList)

      this.tempRecordTXByCycle(txTs, acceptedTX, true, applyResponse)

      this.emit('txApplied', acceptedTX)
    }

    return true
  }

  // leaving this for ref for a bit longer because it is interesting
  // tryStartAcceptedQueue () {
  //   if (!this.dataSyncMainPhaseComplete) {
  //     return
  //   }
  //   if (!this.newAcceptedTxQueueRunning) {
  //     this.processAcceptedTxQueue()
  //   } else if (this.newAcceptedTxQueue.length > 0) {
  //     this.interruptSleepIfNeeded(this.newAcceptedTxQueue[0].timestamp)
  //   }
  // }
  // async _firstTimeQueueAwait () {
  //   if (this.newAcceptedTxQueueRunning) {
  //     this.fatalLogger.fatal('DATASYNC: newAcceptedTxQueueRunning')
  //     return
  //   }
  //   await this.processAcceptedTxQueue(Date.now())
  // }

  async applyAcceptedTransaction (acceptedTX, wrappedStates, localCachedData, filter) {
    if (this.queueStopped) return
    let tx = acceptedTX.data
    let keysResponse = this.app.getKeyFromTransaction(tx)
    let { sourceKeys, targetKeys, timestamp, debugInfo } = keysResponse

    if (this.verboseLogs) console.log('applyAcceptedTransaction ' + timestamp + ' ' + debugInfo)
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction ' + timestamp + ' ' + debugInfo)

    let allkeys = []
    allkeys = allkeys.concat(sourceKeys)
    allkeys = allkeys.concat(targetKeys)

    for (let key of allkeys) {
      if (wrappedStates[key] == null) {
        if (this.verboseLogs) console.log(`applyAcceptedTransaction missing some account data. timestamp:${timestamp}  key: ${utils.makeShortHash(key)}  debuginfo:${debugInfo}`)
        return { success: false, reason: 'missing some account data' }
      }
    }

    // let accountData = await this.app.getAccountDataByList(allkeys) Now that we are sharded we must use the wrapped states instead of asking for account data! (faster anyhow!)

    let { success, hasStateTableData } = await this.testAccountTimesAndStateTable2(tx, wrappedStates)

    if (!success) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction pretest failed: ' + timestamp)
      this.logger.playbackLogNote('tx_apply_rejected 1', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
      return { success: false, reason: 'applyAcceptedTransaction pretest failed' }
    }

    // Validate transaction through the application. Shardus can see inside the transaction
    this.profiler.profileSectionStart('validateTx')
    // todo add data fetch to the result and pass it into app apply(), include previous hashes

    // todo2 refactor the state table data checks out of try apply and calculate them with less effort using results from validate
    let applyResult = await this.tryApplyTransaction(acceptedTX, hasStateTableData, false, filter, wrappedStates, localCachedData)
    if (applyResult) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'applyAcceptedTransaction SUCCEDED ' + timestamp)
      this.logger.playbackLogNote('tx_applied', `${acceptedTX.id}`, `AcceptedTransaction: ${utils.stringifyReduce(acceptedTX)}`)
    } else {
      this.logger.playbackLogNote('tx_apply_rejected 3', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
    }
    return { success: applyResult, reason: 'apply result' }
  }

  interruptibleSleep (ms, targetTime) {
    let resolveFn = null
    let promise = new Promise(resolve => {
      resolveFn = resolve
      setTimeout(resolve, ms)
    })
    return { promise, resolveFn, targetTime }
  }

  interruptSleepIfNeeded (targetTime) {
    if (this.sleepInterrupt) {
      if (targetTime < this.sleepInterrupt.targetTime) {
        this.sleepInterrupt.resolveFn()
      }
    }
  }

  // /////////////////////////////////////////////////////////////////////////////////////////////////////////
  // ////   Transaction Queue Handling        ////////////////////////////////////////////////////////////////
  // /////////////////////////////////////////////////////////////////////////////////////////////////////////

  updateHomeInformation (txQueueEntry) {
    if (this.currentCycleShardData != null && txQueueEntry.hasShardInfo === false) {
      let txId = txQueueEntry.acceptedTx.receipt.txHash
      // Init home nodes!
      for (let key of txQueueEntry.txKeys.allKeys) {
        let homeNode = ShardFunctions.findHomeNode(this.currentCycleShardData.shardGlobals, key, this.currentCycleShardData.parititionShardDataMap)
        txQueueEntry.homeNodes[key] = homeNode
        if (homeNode == null) {
          if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` queueAcceptedTransaction: ${key} `)
        }

        let summaryObject = ShardFunctions.getHomeNodeSummaryObject(homeNode)
        let relationString = ShardFunctions.getNodeRelation(homeNode, this.currentCycleShardData.ourNode.id)
        // route_to_home_node
        this.logger.playbackLogNote('shrd_homeNodeSummary', `${txId}`, `account:${utils.makeShortHash(key)} rel:${relationString} summary:${utils.stringifyReduce(summaryObject)}`)
      }

      txQueueEntry.hasShardInfo = true
    }
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

  queueAcceptedTransaction (acceptedTx, sendGossip = true, sender) {
    // dropping these too early.. hmm  we finished syncing before we had the first shard data.
    // if (this.currentCycleShardData == null) {
    //   // this.preTXQueue.push(acceptedTX)
    //   return 'notReady' // it is too early to care about the tx
    // }
    if (this.readyforTXs === false) {
      return 'notReady' // it is too early to care about the tx
    }

    let keysResponse = this.app.getKeyFromTransaction(acceptedTx.data)
    let timestamp = keysResponse.timestamp
    let txId = acceptedTx.receipt.txHash

    this.queueEntryCounter++
    let txQueueEntry = { acceptedTx: acceptedTx, txKeys: keysResponse, collectedData: {}, originalData: {}, homeNodes: {}, hasShardInfo: false, state: 'aging', dataCollected: 0, hasAll: false, entryID: this.queueEntryCounter, localKeys: {}, localCachedData: {}, syncCounter: 0, didSync: false, syncKeys: [] } // age comes from timestamp
    // partition data would store stuff like our list of nodes that store this ts
    // collected data is remote data we have recieved back
    // //tx keys ... need a sorted list (deterministic) of partition.. closest to a number?

    if (this.config.debug.loseTxChance > 0) {
      let rand = Math.random()
      if (this.config.debug.loseTxChance > rand) {
        this.logger.playbackLogNote('tx_dropForTest', txId, 'dropping tx ' + timestamp)
        return 'lost'
      }
    }

    // todo faster hash lookup for this maybe?
    let entry = this.getQueueEntrySafe(acceptedTx.id, acceptedTx.timestamp)
    if (entry) {
      return false // already in our queue, or temp queue
    }

    try {
      let age = Date.now() - timestamp
      if (age > this.queueSitTime * 0.9) {
        this.fatalLogger.fatal('queueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age)
        // TODO consider throwing this out.  right now it is just a warning
        this.logger.playbackLogNote('shrd_oldQueueInsertion', '', 'queueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age)
      }
      let keyHash = {}
      for (let key of txQueueEntry.txKeys.allKeys) {
        keyHash[key] = true
      }
      txQueueEntry.uniqueKeys = Object.keys(keyHash)

      this.updateHomeInformation(txQueueEntry)

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

      if (txQueueEntry.hasShardInfo) {
        if (sendGossip) {
          try {
            let transactionGroup = this.queueEntryGetTransactionGroup(txQueueEntry)
            if (transactionGroup.length > 1) {
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
          if (txQueueEntry.ourNodeInvolved === false) {
            this.logger.playbackLogNote('shrd_notInTxGroup', `${txId}`, ``)

            return 'out of range'// we are done, not involved!!!
          } else {
            // let tempList =  // can be returned by the function below
            this.p2p.state.getOrderedSyncingNeighbors(this.currentCycleShardData.ourNode)

            if (this.currentCycleShardData.hasSyncingNeighbors === true) {
              this.logger.playbackLogNote('shrd_sync_tx', `${txId}`, `txts: ${timestamp} nodes:${utils.stringifyReduce(this.currentCycleShardData.syncingNeighborsTxGroup.map(x => x.id))}`)
              this.p2p.sendGossipAll('spread_tx_to_group', acceptedTx, '', sender, this.currentCycleShardData.syncingNeighborsTxGroup)
            }
          }
        }
      }
      this.newAcceptedTxQueueTempInjest.push(txQueueEntry)

      // start the queue if needed
      this.tryStartAcceptedQueue()
    } catch (error) {
      this.logger.playbackLogNote('shrd_addtoqueue_rejected', `${txId}`, `AcceptedTransaction: ${utils.makeShortHash(acceptedTx.id)} ts: ${txQueueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(txQueueEntry.txKeys.allKeys)}`)
      this.fatalLogger.fatal('queueAcceptedTransaction failed: ' + error.name + ': ' + error.message + ' at ' + error.stack)
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
    await this.processAcceptedTxQueue()
  }

  getQueueEntry (txid, timestamp) {
  // todo perf need an interpolated or binary search on a sorted list
    for (let queueEntry of this.newAcceptedTxQueue) {
      if (queueEntry.acceptedTx.id === txid) {
        return queueEntry
      }
    }
    return null
  }

  getQueueEntryPending (txid, timestamp) {
    // todo perf need an interpolated or binary search on a sorted list
    for (let queueEntry of this.newAcceptedTxQueueTempInjest) {
      if (queueEntry.acceptedTx.id === txid) {
        return queueEntry
      }
    }
    return null
  }

  getQueueEntrySafe (txid, timestamp) {
    let queueEntry = this.getQueueEntry(txid, timestamp)
    if (queueEntry == null) {
      return this.getQueueEntryPending(txid, timestamp)
    }

    return queueEntry
  }

  getQueueEntryArchived (txid, timestamp) {
    for (let queueEntry of this.archivedQueueEntries) {
      if (queueEntry.acceptedTx.id === txid) {
        return queueEntry
      }
    }
  }

  queueEntryAddData (queueEntry, data) {
    if (queueEntry.collectedData[data.accountId] != null) {
      return // already have the data
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

    this.logger.playbackLogNote('shrd_addData', `${utils.makeShortHash(queueEntry.acceptedTx.id)}`, `key ${utils.makeShortHash(data.accountId)} hasAll:${queueEntry.hasAll} collected:${queueEntry.dataCollected}`)
  }

  queueEntryHasAllData (queueEntry) {
    if (queueEntry.hasAll === true) {
      return true
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

  async queueEntryRequestMissingData (queueEntry) {
    if (!queueEntry.requests) {
      queueEntry.requests = {}
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
        let homeNodeShardData = queueEntry.homeNodes[key] // mark outstanding request somehow so we dont rerequest

        let randomIndex = this.getRandomInt(homeNodeShardData.consensusNodeForOurNodeFull.length - 1)
        let node = homeNodeShardData.consensusNodeForOurNodeFull[randomIndex]

        // make sure we didn't get or own node
        while (node.id === this.currentCycleShardData.nodeShardData.node.id) {
          randomIndex = this.getRandomInt(homeNodeShardData.consensusNodeForOurNodeFull.length - 1)
          node = homeNodeShardData.consensusNodeForOurNodeFull[randomIndex]
        }

        // Todo: expand this to grab a consensus node from any of the involved consensus nodes.

        for (let key2 of allKeys) {
          queueEntry.requests[key2] = node
        }

        let relationString = ShardFunctions.getNodeRelation(homeNodeShardData, this.currentCycleShardData.ourNode.id)
        this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_ask', `${utils.makeShortHash(queueEntry.acceptedTx.id)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}`)

        let message = { keys: allKeys, txid: queueEntry.acceptedTx.id, timestamp: queueEntry.acceptedTx.timestamp }
        let result = await this.p2p.ask(node, 'request_state_for_tx', message) // not sure if we should await this.
        let dataCountReturned = 0
        let accountIdsReturned = []
        for (let data of result.stateList) {
          this.queueEntryAddData(queueEntry, data)
          dataCountReturned++
          accountIdsReturned.push(utils.makeShortHash(data.id))
        }

        if (queueEntry.hasAll === true) {
          queueEntry.logstate = 'got all missing data'
        } else {
          queueEntry.logstate = 'failed to get data:' + queueEntry.hasAll
        }

        this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_result', `${utils.makeShortHash(queueEntry.acceptedTx.id)}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

        // queueEntry.homeNodes[key] = null
        for (let key2 of allKeys) {
          queueEntry.requests[key2] = null
        }

        if (queueEntry.hasAll === true) {
          break
        }
      }
    }
  }

  queueEntryGetTransactionGroup (queueEntry) {
    if (queueEntry.transactionGroup != null) {
      return queueEntry.transactionGroup
    }
    let txGroup = []
    let uniqueNodes = {}
    for (let key of queueEntry.uniqueKeys) {
      let homeNode = queueEntry.homeNodes[key]
      // txGroup = Array.concat(txGroup, homeNode.nodeThatStoreOurParitionFull)
      if (homeNode == null) {
        console.log('queueEntryGetTransactionGroup homenode:null')
      }
      if (homeNode.extendedData === false) {
        ShardFunctions.computeExtendedNodePartitionData(this.currentCycleShardData.shardGlobals, this.currentCycleShardData.nodeShardDataMap, this.currentCycleShardData.parititionShardDataMap, homeNode, this.currentCycleShardData.activeNodes)
      }
      for (let node of homeNode.nodeThatStoreOurParitionFull) { // not iterable!
        uniqueNodes[node.id] = node
      }
      // make sure the home node is in there in case we hit and edge case
      uniqueNodes[homeNode.node.id] = homeNode.node
    }
    queueEntry.ourNodeInvolved = true
    if (uniqueNodes[this.currentCycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInvolved = false
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

  // should work even if there are zero nodes to tell and should load data locally into queue entry
  async tellCorrespondingNodes (queueEntry) {
    // Report data to corresponding nodes
    let ourNodeData = this.currentCycleShardData.nodeShardData
    // let correspondingEdgeNodes = []
    let correspondingAccNodes = []
    let dataKeysWeHave = []
    let dataValuesWeHave = []
    let datas = {}
    let remoteShardsByKey = {} // shard homenodes that we do not have the data for.
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

      if (hasKey) { // todo Detect if our node covers this paritition..  need our partition data
        let data = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
        datas[key] = data
        dataKeysWeHave.push(key)
        dataValuesWeHave.push(data)
        queueEntry.localKeys[key] = true
        // add this data to our own queue entry!!
        this.queueEntryAddData(queueEntry, data)
      } else {
        remoteShardsByKey[key] = queueEntry.homeNodes[key]
      }
    }

    let message
    let edgeNodeIds = []
    let consensusNodeIds = []

    let nodesToSendTo = {}
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

            // for each remote node lets save it's id
            for (let index of indicies) {
              let node = remoteHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                consensusNodeIds.push(node.id)
              }
            }
            for (let index of edgeIndicies) {
              let node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                edgeNodeIds.push(node.id)
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

  removeFromQueue (queueEntry, currentIndex) {
    this.newAcceptedTxQueue.splice(currentIndex, 1)
    this.archivedQueueEntries.push(queueEntry)
    if (this.archivedQueueEntries.length > 10000) {
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
    let seenAccounts
    try {
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

      this.newAcceptedTxQueueRunning = true

      let acceptedTXCount = 0
      let edgeFailDetected = false

      let currentIndex = this.newAcceptedTxQueue.length - 1

      let timeM = this.queueSitTime
      let timeM2 = timeM * 2
      // let timeM3 = timeM * 3
      let currentTime = Date.now() // when to update this?

      seenAccounts = {}// todo PERF we should be able to support using a variable that we save from one update to the next.  set that up after initial testing

      // todo move these functions out where they are not constantly regenerate
      let accountSeen = function (queueEntry) {
        for (let key of queueEntry.uniqueKeys) {
          if (seenAccounts[key] != null) {
            return true
          }
        }
        return false
      }
      let markAccountsSeen = function (queueEntry) {
        for (let key of queueEntry.uniqueKeys) {
          if (seenAccounts[key] == null) {
            seenAccounts[key] = queueEntry
          }
        }
      }
      // if we are the oldest ref to this you can clear it.. only ok because younger refs will still reflag it in time
      let clearAccountsSeen = function (queueEntry) {
        for (let key of queueEntry.uniqueKeys) {
          if (seenAccounts[key] === queueEntry) {
            seenAccounts[key] = null
          }
        }
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

          this.newAcceptedTxQueue.splice(index + 1, 0, txQueueEntry)
          this.logger.playbackLogNote('shrd_addToQueue', `${txId}`, `AcceptedTransaction: ${utils.makeShortHash(acceptedTx.id)} ts: ${txQueueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(txQueueEntry.txKeys.allKeys)}`)
          this.emit('txQueued', acceptedTx.receipt.txHash)
        }
        this.newAcceptedTxQueueTempInjest = []
      }

      while (this.newAcceptedTxQueue.length > 0) {
        if (currentIndex < 0) {
          break
        }
        let queueEntry = this.newAcceptedTxQueue[currentIndex]
        let txTime = queueEntry.txKeys.timestamp
        let txAge = currentTime - txTime
        if (txAge < timeM) {
          break
        }

        // // fail the message if older than m3
        // if (queueEntry.hasAll === false && txAge > timeM3) {
        //   queueEntry.state = 'failed'
        //   removeFromQueue(queueEntry, currentIndex)
        //   continue
        // }

        if (queueEntry.state === 'syncing') {
          markAccountsSeen(queueEntry)
        } else if (queueEntry.state === 'aging') {
          queueEntry.state = 'processing'
        } else if (queueEntry.state === 'processing') {
          if (accountSeen(queueEntry) === false) {
            try {
              await this.tellCorrespondingNodes(queueEntry)
            } catch (ex) {
              this.mainLogger.debug('processAcceptedTxQueue2 tellCorrespondingNodes:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
              this.fatalLogger.fatal('processAcceptedTxQueue2 tellCorrespondingNodes:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
            } finally {
              queueEntry.state = 'awaiting data'
            }
          }
          markAccountsSeen(queueEntry)
        } else if (queueEntry.state === 'awaiting data') {
          markAccountsSeen(queueEntry)

          // check if we have all accounts
          if (queueEntry.hasAll === false && txAge > timeM2) {
            if (this.queueEntryHasAllData(queueEntry) === true) {
              this.logger.playbackLogNote('shrd_hadDataAfterall', `${queueEntry.acceptedTx.id}`, `This is kind of an error, and should not happen`)
              continue
            }

            // if (queueEntry.hasAll === false && txAge > timeM3) {
            //   queueEntry.state = 'failed'
            //   removeFromQueue(queueEntry, currentIndex)
            //   continue
            // }

            // 7.  Manually request missing state
            try {
              this.queueEntryRequestMissingData(queueEntry)
            } catch (ex) {
              this.mainLogger.debug('processAcceptedTxQueue2 queueEntryRequestMissingData:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
              this.fatalLogger.fatal('processAcceptedTxQueue2 queueEntryRequestMissingData:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
            }
          } else if (queueEntry.hasAll) {
            queueEntry.state = 'applying'
          }

          // TODO Need condition to check if age is greater than M3? to fail the tx from the queue
        } else if (queueEntry.state === 'applying') {
          markAccountsSeen(queueEntry)

          this.logger.playbackLogNote('shrd_workingOnTx', `${queueEntry.acceptedTx.id}`, `qId: ${queueEntry.entryID} qRst:${this.queueRestartCounter} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
          this.emit('txPopped', queueEntry.acceptedTx.receipt.txHash)

          // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` processAcceptedTxQueue2. ${queueEntry.entryID} timestamp: ${queueEntry.txKeys.timestamp}`)

          if (queueEntry.didSync) {
            this.logger.playbackLogNote('shrd_sync_applying', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}`)

            // if we did sync it is time to JIT query local data.  alternatively could have other nodes send us this data, but that could be very high bandwidth.
            for (let key of queueEntry.syncKeys) {
              let wrappedState = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
              this.logger.playbackLogNote('shrd_sync_getLocalData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}  key:${utils.makeShortHash(key)} hash:${wrappedState.stateId}`)
              queueEntry.localCachedData[key] = wrappedState.localCache
            }
          }

          let wrappedStates = queueEntry.collectedData // Object.values(queueEntry.collectedData)
          let localCachedData = queueEntry.localCachedData
          try {
            // this.mainLogger.debug(` processAcceptedTxQueue2. applyAcceptedTransaction ${queueEntry.entryID} timestamp: ${queueEntry.txKeys.timestamp} queuerestarts: ${this.queueRestartCounter} queueLen: ${this.newAcceptedTxQueue.length}`)
            let filter = queueEntry.localKeys
            let txResult = await this.applyAcceptedTransaction(queueEntry.acceptedTx, wrappedStates, localCachedData, filter)
            if (txResult.success) {
              acceptedTXCount++
            // clearAccountsSeen(queueEntry)
            } else {
            // clearAccountsSeen(queueEntry)
              if (!edgeFailDetected && acceptedTXCount > 0) {
                edgeFailDetected = true
                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `processAcceptedTxQueue edgeFail ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
                this.fatalLogger.fatal(this.dataPhaseTag + `processAcceptedTxQueue edgeFail ${utils.stringifyReduce(queueEntry.acceptedTx)}`) // todo: consider if this is just an error
              }
            }
          } catch (ex) {
            this.mainLogger.debug('processAcceptedTxQueue2 applyAcceptedTransaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
            this.fatalLogger.fatal('processAcceptedTxQueue2 applyAcceptedTransaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
          } finally {
            // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` processAcceptedTxQueue2. clear and remove. ${queueEntry.entryID} timestamp: ${queueEntry.txKeys.timestamp}`)
            clearAccountsSeen(queueEntry)
            // remove from queue
            // this.newAcceptedTxQueue.splice(currentIndex, 1)
            // this.archivedQueueEntries.push(queueEntry)
            // if (this.archivedQueueEntries.length > 10000) { // todo make this a constant and decide what len should really be!
            //   this.archivedQueueEntries.shift()
            // }
            this.removeFromQueue(queueEntry, currentIndex)
            queueEntry.state = 'applied'
          }

          // do we have any syncing neighbors?
          if (this.currentCycleShardData.hasSyncingNeighbors === true) {
            // let dataToSend = Object.values(queueEntry.collectedData)
            let dataToSend = []

            let keys = Object.keys(queueEntry.originalData)
            for (let key of keys) {
              dataToSend.push(JSON.parse(queueEntry.originalData[key]))
            }

            // maybe have to send localcache over, or require the syncing node to grab this data itself JIT!
            // let localCacheTransport = Object.values(queueEntry.localCachedData)

            // send data to syncing neighbors.
            if (this.currentCycleShardData.syncingNeighbors.length > 0) {
              let message = { stateList: dataToSend, txid: queueEntry.acceptedTx.id }
              this.logger.playbackLogNote('shrd_sync_dataTell', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID} AccountBeingShared: ${utils.stringifyReduce(queueEntry.txKeys.allKeys)} txid: ${utils.makeShortHash(message.txid)} nodes:${utils.stringifyReduce(this.currentCycleShardData.syncingNeighbors.map(x => x.id))}`)
              this.p2p.tell(this.currentCycleShardData.syncingNeighbors, 'broadcast_state', message)
            }
          }
        } else if (queueEntry.state === 'failed to get data') {
          // TODO log
          // remove from queue
          // this.newAcceptedTxQueue.splice(currentIndex, 1)
          // this.archivedQueueEntries.push(queueEntry)
          // if (this.archivedQueueEntries.length > 10000) {
          //   this.archivedQueueEntries.shift()
          // }
          this.removeFromQueue(queueEntry, currentIndex)
        }
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

  async dumpAccountDebugData () {
    if (this.currentCycleShardData == null) {
      return
    }

    // hmm how to deal with data that is changing... it cant!!
    let partitionMap = this.currentCycleShardData.parititionShardDataMap

    let ourNodeShardData = this.currentCycleShardData.nodeShardData
    // partittions:
    let partitionDump = { partitions: [] }
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
      partitionDump.nodesCovered.consensus.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
    }
    for (let node of ourNodeShardData.nodeThatStoreOurParitionFull) {
      let nodeData = this.currentCycleShardData.nodeShardDataMap.get(node.id)
      partitionDump.nodesCovered.stored.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
    }

    for (var [key, value] of partitionMap) {
      let partition = { parititionID: key, accounts: [] }
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
      for (let wrappedAccount of wrappedAccounts) {
        let v = wrappedAccount.data.balance // hack, todo maybe ask app for a debug value
        partition.accounts.push({ id: wrappedAccount.accountId, hash: wrappedAccount.stateId, v: v })
      }
    }

    partitionDump.allNodeIds = []
    for (let node of this.currentCycleShardData.activeNodes) {
      partitionDump.allNodeIds.push(utils.makeShortHash(node.id))
    }
    // dump information about consensus group and edge nodes for each partition
    // for (var [key, value] of this.currentCycleShardData.parititionShardDataMap){

    // }

    this.shardLogger.debug(utils.stringifyReduce(partitionDump))
  }

  // todo support metadata so we can serve up only a portion of the account
  // todo 2? communicate directly back to client... could have security issue.
  // todo 3? require a relatively stout client proof of work
  async getLocalOrRemoteAccount (address) {
    let wrappedAccount

    // check if we have this account locally. (does it have to be consenus or just stored?)
    let accountIsRemote = true

    let ourNodeShardData = this.currentCycleShardData.nodeShardData
    let minP = ourNodeShardData.consensusStartPartition
    let maxP = ourNodeShardData.consensusEndPartition
    let [homePartition] = ShardFunctions.addressToPartition(this.currentCycleShardData.shardGlobals, address)
    accountIsRemote = (ShardFunctions.partitionInConsensusRange(homePartition, minP, maxP) === false)

    if (accountIsRemote) {
      let homeNode = ShardFunctions.findHomeNode(this.currentCycleShardData.shardGlobals, address, this.currentCycleShardData.parititionShardDataMap)

      let message = { accountIds: [address] }
      let result = await this.p2p.ask(homeNode.node, 'get_account_data_with_queue_hints', message)
      if (result != null && result.accountData != null && result.accountData.length > 0) {
        wrappedAccount = result.accountData[0]
        return wrappedAccount
      }
    } else {
      // we are local!
      let accountData = await this.app.getAccountDataByList([address])
      if (accountData != null) {
        for (let wrappedAccount of accountData) {
          wrappedAccount.seenInQueue = false

          if (this.lastSeenAccountsMap != null) {
            let queueEntry = this.lastSeenAccountsMap[wrappedAccount.accountId]
            if (queueEntry != null) {
              wrappedAccount.seenInQueue = true
            }
          }
        }
      }
      wrappedAccount = accountData[0]
      return wrappedAccount
    }
    return null
  }

  async setAccount (wrappedStates, localCachedData, applyResponse, accountFilter = null) {
    // let sourceAddress = inTx.srcAct
    // let targetAddress = inTx.tgtAct
    // let amount = inTx.txnAmt
    // let type = inTx.txnType
    // let time = inTx.txnTimestamp
    let canWriteToAccount = function (accountId) {
      return (!accountFilter) || (accountFilter[accountId] !== undefined)
    }

    let keys = Object.keys(wrappedStates)
    for (let key of keys) {
      let wrappedData = wrappedStates[key]
      if (canWriteToAccount(wrappedData.accountId) === false) {
        continue
      }

      if (wrappedData.isPartial) {
        await this.app.updateAccountPartial(wrappedData, localCachedData[key], applyResponse)
      } else {
        await this.app.updateAccountFull(wrappedData, localCachedData[key], applyResponse)
      }
    }
  }

  /// /////////////////////////////////////////////////////////
  async fifoLock (fifoName) {
    let thisFifo = this.fifoLocks[fifoName]
    if (thisFifo == null) {
      thisFifo = { fifoName, queueCounter: 0, waitingList: [], lastServed: 0, queueLocked: false, lockOwner: null }
      this.fifoLocks[fifoName] = thisFifo
    }
    thisFifo.queueCounter++
    let ourID = thisFifo.queueCounter
    let entry = { id: ourID }

    if (thisFifo.waitingList.length > 0 || thisFifo.queueLocked) {
      thisFifo.waitingList.push(entry)
      // wait till we are at the front of the queue, and the queue is not locked
      while (thisFifo.waitingList[0].id !== ourID || thisFifo.queueLocked) {
      // perf optimization to reduce the amount of times we have to sleep (attempt to come out of sleep at close to the right time)
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

  fifoUnlock (fifoName, id) {
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

  _registerListener (emitter, event, callback) {
    if (this._listeners[event]) {
      this.mainLogger.fatal('State Manager can only register one listener per event!')
      return
    }
    emitter.on(event, callback)
    this._listeners[event] = [emitter, callback]
  }

  _unregisterListener (event) {
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
   * @returns {Promise<any>}
   */
  async getPartitionReport (consensusOnly, smallHashes) {
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
      }
    }
    return response
  }

  /**
   * generatePartitionObjects
   * @param {Cycle} lastCycle
   */
  generatePartitionObjects (lastCycle) {
    let lastCycleShardValues = this.shardValuesByCycle.get(lastCycle.counter)

    // let partitions = ShardFunctions.getConsenusPartitions(lastCycleShardValues.shardGlobals, lastCycleShardValues.nodeShardData)
    // lastCycleShardValues.ourConsensusPartitions = partitions

    let partitions = lastCycleShardValues.ourConsensusPartitions

    this.nextCycleReportToSend = { res: [], cycleNumber: lastCycle.counter }

    for (let partitionNumber of partitions) {
      // TODO sharding - done.  when we add state sharding need to loop over partitions.
      let partitionObject = this.generatePartitionObject(lastCycle, partitionNumber)

      // Nodes sign the partition hash along with the Partition_id, Cycle_number and timestamp to produce a partition result.
      let partitionResult = this.generatePartitionResult(partitionObject)

      this.nextCycleReportToSend.res.push({ i: partitionResult.Partition_id, h: partitionResult.Partition_hash })

      // byId?
      let cycleKey = 'c' + lastCycle.counter

      let partitionObjects = [partitionObject]
      let partitionResults = [partitionResult]

      this.partitionObjectsByCycle[cycleKey] = partitionObjects
      this.ourPartitionResultsByCycle[cycleKey] = partitionResults // todo in the future there could be many results (one per covered partition)

      let partitionResultsByHash = this.recentPartitionObjectsByCycleByHash[cycleKey]
      if (partitionResultsByHash == null) {
        partitionResultsByHash = {}
        this.recentPartitionObjectsByCycleByHash[cycleKey] = partitionResultsByHash
      }
      // todo sharding done?  seems ok :   need to loop and put all results in this list
      // todo perf, need to clean out data from older cycles..
      partitionResultsByHash[partitionResult.Partition_hash] = partitionObject

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
        responses = responses.filter(item => item.sign && item.sign.owner !== ourID) // if the item is not signed clear it!
        responsesByPartition[partitionKey] = responses // have to re-assign this since it is a new ref to the array
        responses.push(pResult)
      }
    }
    // return [partitionObject, partitionResult]
  }

  /**
   * generatePartitionResult
   * @param {PartitionObject} partitionObject
   * @returns {PartitionResult}
   */
  generatePartitionResult (partitionObject) {
    let partitionHash = /** @type {string} */(this.crypto.hash(partitionObject))
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
  generatePartitionObject (lastCycle, partitionId) {
    let txList = this.getTXList(lastCycle.counter, partitionId)

    let txSourceData = txList
    if (txList.newTxList) {
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
   */
  partitionObjectToTxMaps (partitionObject) {
    let statusMap = {}
    for (let i = 0; i < partitionObject.Txids.length; i++) {
      let tx = partitionObject.Txids[i]
      let status = partitionObject.Status[i]
      statusMap[tx] = status
    }
    return statusMap
  }

  /**
   * tryGeneratePartitionReciept
   * @param {PartitionResult[]} allResults
   * @param {PartitionResult} ourResult
   * @param {boolean} [repairPassHack]
   * @returns {{ partitionReceipt: PartitionReceipt; topResult: PartitionResult; success: boolean }}
   */
  tryGeneratePartitionReciept (allResults, ourResult, repairPassHack = false) {
    let partitionId = ourResult.Partition_id
    let cycleCounter = ourResult.Cycle_number

    let repairTracker = this._getRepairTrackerForCycle(cycleCounter, partitionId)
    repairTracker.busy = true // mark busy so we won't try to start this task again while in the middle of it

    // Tried hashes is not working correctly at the moment, it is an unused parameter. I am not even sure we want to ignore hashes
    let { topHash, topCount, topResult } = this.findMostCommonResponse(cycleCounter, partitionId, repairTracker.triedHashes)

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair tryGeneratePartitoinReciept repairTracker: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)

    let requiredHalf = Math.max(1, allResults.length / 2)
    if (this.useHashSets && repairPassHack) {
      // hack force our node to win:
      topCount = requiredHalf
      topHash = ourResult.Partition_hash
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair tryGeneratePartitoinReciept hack force win: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)
    }

    let resultsList = []
    if (topCount >= requiredHalf) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' _repair tryGeneratePartitoinReciept: top hash wins: ' + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
      for (let partitionResult of allResults) {
        if (partitionResult.Partition_hash === topHash) {
          resultsList.push(partitionResult)
        }
      }
    } else {
      if (this.useHashSets) {
        // bail in a way that will cause us to use the hashset strings
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' _repair tryGeneratePartitoinReciept: did not win, useHashSets: ' + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
        return { partitionReceipt: null, topResult: null, success: false }
      }
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' _repair tryGeneratePartitoinReciept: top hash failed: ' + utils.makeShortHash(topHash) + ` ${topCount} / ${requiredHalf}`)
      return { partitionReceipt: null, topResult, success: false }
    }

    if (ourResult.Partition_hash !== topHash) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' _repair tryGeneratePartitoinReciept: our hash does not match: ' + utils.makeShortHash(topHash) + ` our hash: ${ourResult.Partition_hash}`)
      return { partitionReceipt: null, topResult, success: false }
    }

    let partitionReceipt = {
      resultsList
    }

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair tryGeneratePartitoinReciept OK! ${utils.stringifyReduce({ partitionReceipt, topResult })}`)

    return { partitionReceipt, topResult, success: true }
  }

  /**
   * startRepairProcess
   * @param {Cycle} cycle
   * @param {PartitionResult} topResult
   * @param {number} partitionId
   * @param {string} ourLastResultHash
   */
  async startRepairProcess (cycle, topResult, partitionId, ourLastResultHash) {
    let repairTracker = this._getRepairTrackerForCycle(cycle.counter, partitionId)

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess begin.  repairTracker: ${utils.stringifyReduce(repairTracker)}`)

    repairTracker.repairing = true

    this.repairTrackerClearForNextRepair(repairTracker)
    // let partitionID
    let cycleNumber
    let key
    let key2

    let usedSyncTXsFromHashSetStrings = false
    try {
      // partitionId = partitionId // topResult.Partition_id
      cycleNumber = cycle.counter // topResult.Cycle_number
      key = 'c' + cycleNumber
      key2 = 'p' + partitionId

      if (topResult) {
        repairTracker.triedHashes.push(topResult.Partition_hash)
        await this.syncTXsFromWinningHash(topResult)
      } else {
        if (this.useHashSets) {
          let retCode = await this.syncTXsFromHashSetStrings(cycleNumber, partitionId, repairTracker, ourLastResultHash)

          if (retCode === 100) {
            // syncTXsFromHashSetStrings has failed
            repairTracker.awaitWinningHash = true
            if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` syncTXsFromHashSetStrings failed so we will set awaitWinningHash=true and hope a hash code wins  `)
            return
          }

          // return // bail since code is not complete
          usedSyncTXsFromHashSetStrings = true
        } else {
          // this probably fails with out hashsets.. or keeps tring forever
        }
      }

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess syncTXs finished.  `)

      this.generatePartitionObjects(cycle) // this will stomp our old results TODO PERF: (a bit inefficient since it works on all partitions)

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

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess our result: ${utils.stringifyReduce(ourResult)} obj: ${utils.stringifyReduce(this.partitionObjectsByCycle[key])} `)

      // check if our hash now matches the majority one, maybe even re check the majority hash..?
      let receiptResults = this.tryGeneratePartitionReciept(responses, ourResult, true)
      let { partitionReceipt, topResult: topResult2, success } = receiptResults

      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess tryGeneratePartitionReciept: ${utils.stringifyReduce({ partitionReceipt, topResult2, success })}  `)

      if (!success) {
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess success==false starting repair again in 3 seconds!`)

        let cycle = this.p2p.state.getCycleByCounter(cycleNumber)

        await utils.sleep(3000) // wait a second.. also when to give up
        await this.startRepairProcess(cycle, topResult2, partitionId, ourResult.Partition_hash)
        return
      } else if (partitionReceipt) {
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess success==ok`)

        if (usedSyncTXsFromHashSetStrings === false) {
          // do we ever send partition receipt yet?
          this.storePartitionReceipt(cycleNumber, partitionReceipt)
          repairTracker.txRepairComplete = true
        } else {
          repairTracker.awaitWinningHash = true
        }

        // are all repairs complete. if so apply them to accounts.
        // look at the repair tracker for every partition.

        let cycleKey = 'c' + cycle.counter

        let allFinished = true
        let repairsByPartition = this.repairTrackingByCycleById[key]

        if (!repairsByPartition) {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess repairsByPartition==null ${key} ck: ${cycleKey} `)
        }

        // check that all the repair keys are good
        let repairKeys = Object.keys(repairsByPartition)
        for (let partitionKey of repairKeys) {
          let repairTracker1 = repairsByPartition[partitionKey]
          if ((repairTracker1.txRepairComplete === false && repairTracker1.evaluationStarted) || repairTracker1.evaluationStarted === false) {
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess repairTracker1 ${utils.stringifyReduce(repairTracker1)} `)
            allFinished = false // TODO sharding done. turned all finished = false line back on   need to fix this logic so that we make sure all partitions are good before we proceed to merge and apply things
            // TODO sharding looks ok but needs testing.
            // perhaps check that awaitWinningHash == true for all of them now? idk..
          }
        }
        if (allFinished) {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess allFinished, start merge and apply cycle: ${cycleNumber}`)
          await this.mergeAndApplyTXRepairs(cycleNumber)

          // only declare victory after we matched hashes
          if (usedSyncTXsFromHashSetStrings === false) {
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess 1 allFinished, final cycle: ${cycleNumber} hash:${utils.stringifyReduce({ topResult2 })}`)
            return
          } else {
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess set evaluationStarted=false so we can tally up hashes again ${cycleNumber}`)
            repairTracker.evaluationStarted = false
            repairTracker.awaitWinningHash = true

            // TODO SHARDING... need to refactor this so it happens per partition before we are all done
            // now that we are done see if we can form a receipt with what we have on the off change that all other nodes have sent us their corrected receipts already
            let receiptResults = this.tryGeneratePartitionReciept(responses, ourResult) // TODO: how to mark block if we are already on a thread for this?
            let { partitionReceipt: partitionReceipt3, topResult: topResult3, success: success3 } = receiptResults
            if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess immediate receipt check. cycle: ${cycleNumber} success:${success3} topResult:${utils.stringifyReduce(topResult3)}  partitionReceipt: ${utils.stringifyReduce({ partitionReceipt3 })}`)

            // see if we already have a winning hash to correct to
            if (!success3) {
              if (repairTracker.awaitWinningHash) {
                if (topResult3 == null) {
                  // if we are awaitWinningHash then wait for a top result before we start repair process again
                  if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess awaitWinningHash:true but topResult == null so keep waiting `)
                } else {
                  if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess awaitWinningHash:true and we have a top result so start reparing! `)
                  if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess: tryGeneratePartitionReciept failed start repair process ${receiptResults}`)
                  let cycle = this.p2p.state.getCycleByCounter(cycleNumber)
                  await utils.sleep(1000)
                  await this.startRepairProcess(cycle, topResult3, partitionId, ourResult.Partition_hash)
                  return // we are correcting to another hash.  don't bother sending our hash out
                }
              }
            } else {
              this.storePartitionReceipt(cycleNumber, partitionReceipt3)
              this.repairTrackerMarkFinished(repairTracker)
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess 2 allFinished, final cycle: ${cycleNumber} hash:${utils.stringifyReduce({ topResult3 })}`)
            }
          }
        }
      }

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair startRepairProcess we repaired stuff so re-broadcast our results`)
      // broadcast our upgraded result again
      // how about for just this partition?
      // TODO repair.  how to make this converge towards order and heal the network problems. is this the right time/place to broadcaast it?  I think it does converge now since merge does a strait copy of the winner
      await this.broadcastPartitionResults(cycleNumber)

      // if not look for other missing txids from hashes we have not investigated yet and repeat process.
    } catch (ex) {
      this.mainLogger.debug('_repair: startRepairProcess ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.fatalLogger.fatal('_repair: startRepairProcess ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      // throw new Error('FailAndRestartPartition0')

      if (repairTracker.awaitWinningHash !== true) {
        this.fatalLogger.fatal('_repair: startRepairProcess will attempt awaitWinningHash=true mode')
        // if we fail try skipping to the last phase:
        repairTracker.evaluationStarted = false
        repairTracker.awaitWinningHash = true
        await this.checkForGoodPartitionReciept(cycleNumber, partitionId)
      }
    } finally {
      repairTracker.repairing = false // ? really
    }
  }

  // todo refactor some of the duped code in here
  // possibly have to split this into three functions to make that clean (find our result and the parition checking as sub funcitons... idk)
  /**
   * checkForGoodPartitionReciept
   * @param {number} cycleNumber
   * @param {number} partitionId
   */
  async checkForGoodPartitionReciept (cycleNumber, partitionId) {
    let repairTracker = this._getRepairTrackerForCycle(cycleNumber, partitionId)

    let key = 'c' + cycleNumber
    let key2 = 'p' + partitionId

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

    let receiptResults = this.tryGeneratePartitionReciept(responses, ourResult) // TODO: how to mark block if we are already on a thread for this?
    let { partitionReceipt: partitionReceipt3, topResult: topResult3, success: success3 } = receiptResults
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept immediate receipt check. cycle: ${cycleNumber} success:${success3} topResult:${utils.stringifyReduce(topResult3)}  partitionReceipt: ${utils.stringifyReduce({ partitionReceipt3 })}`)

    // see if we already have a winning hash to correct to
    if (!success3) {
      if (repairTracker.awaitWinningHash) {
        if (topResult3 == null) {
          // if we are awaitWinningHash then wait for a top result before we start repair process again
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept awaitWinningHash:true but topResult == null so keep waiting `)
        } else {
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept awaitWinningHash:true and we have a top result so start reparing! `)
          if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept: tryGeneratePartitionReciept failed start repair process ${receiptResults}`)
          let cycle = this.p2p.state.getCycleByCounter(cycleNumber)
          await utils.sleep(1000)
          await this.startRepairProcess(cycle, topResult3, partitionId, ourResult.Partition_hash)
          // we are correcting to another hash.  don't bother sending our hash out
        }
      }
    } else {
      this.storePartitionReceipt(cycleNumber, partitionReceipt3)
      this.repairTrackerMarkFinished(repairTracker)
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept 2 allFinished, final cycle: ${cycleNumber} hash:${utils.stringifyReduce({ topResult3 })}`)
    }
  }

  /**
   * syncTXsFromWinningHash
   * @param {PartitionResult} topResult
   */
  async syncTXsFromWinningHash (topResult) {
    // get node ID from signing.
    // obj.sign = { owner: pk, sig }
    let signingNode = topResult.sign.owner
    let allNodes = this.p2p.state.getActiveNodes(this.p2p.id) // todo convert to a versio of this: this.getActiveNodesInRange(lowAddress, highAddress) //
    let nodeToContact

    if (!allNodes) {
      if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ' _repair syncTXsFromWinningHash: allNodes: undefined ')
      throw new Error('allNodes undefined')
    }

    for (const node of allNodes) {
      if (node.address === signingNode) {
        nodeToContact = node
        break
      }
    }
    if (nodeToContact) {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' _repair syncTXsFromWinningHash: node to ask for TXs: ' + utils.stringifyReduce(topResult))
    } else {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' _repair syncTXsFromWinningHash: cant find node: ' + utils.stringifyReduce(topResult))
      throw new Error(`nodeToContact undefined ${utils.stringifyReduce(allNodes)}  ${utils.makeShortHash(signingNode)}`)
    }

    // get the list of tx ids for a partition?..
    let payload = { Cycle_number: topResult.Cycle_number, Partition_id: topResult.Partition_id }
    let partitionObject = await this.p2p.ask(nodeToContact, 'get_partition_txids', payload)

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' _repair syncTXsFromWinningHash: partitionObject: ' + utils.stringifyReduce(partitionObject))

    let statusMap = this.partitionObjectToTxMaps(partitionObject)
    let ourPartitionObj = this.getPartitionObject(topResult.Cycle_number, topResult.Partition_id)

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' _repair syncTXsFromWinningHash: ourPartitionObj: ' + utils.stringifyReduce(ourPartitionObj))

    let ourStatusMap = this.partitionObjectToTxMaps(ourPartitionObj)
    // need to match up on all data, but only sync what we need and remove what we dont.

    // filter to only get accepted txs

    // for (let i = 0; i < partitionObject.Txids.length; i++) {
    //   if (partitionObject.Status[i] === 1) {
    //     // partitionObject.Txids
    //     acceptedTXIDs.push(partitionObject.Txids[i])
    //   }
    // }

    let repairTracker = this._getRepairTrackerForCycle(topResult.Cycle_number, topResult.Partition_id)
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' _repair syncTXsFromWinningHash: _getRepairTrackerForCycle: ' + utils.stringifyReduce(repairTracker))

    let missingAcceptedTxIDs = []
    let missingFailedTXs = []
    let allMissingTXs = []
    for (let i = 0; i < partitionObject.Txids.length; i++) {
      let status = partitionObject.Status[i]
      let tx = partitionObject.Txids[i]
      if (ourStatusMap.hasOwnProperty(tx) === false) {
        if (status === 1) {
          missingAcceptedTxIDs.push(tx)
        } else {
          missingFailedTXs.push(tx)
        }
        repairTracker.missingTXIds.push(tx)
        allMissingTXs.push(tx)
      }
    }
    let invalidAcceptedTxIDs = []
    for (let i = 0; i < ourPartitionObj.Txids.length; i++) {
      // let status = ourPartitionObj.Status[i]
      let tx = ourPartitionObj.Txids[i]
      if (statusMap.hasOwnProperty(tx) === false) {
        invalidAcceptedTxIDs.push(tx)
        repairTracker.extraTXIds.push(tx)
      }
    }

    // ask for missing txs of other node
    let payload2 = { Tx_ids: missingAcceptedTxIDs }
    let txs = await this.p2p.ask(nodeToContact, 'get_transactions_by_list', payload2)
    repairTracker.newPendingTXs = txs // ?

    // get failed txs that we are missing
    payload2 = { Tx_ids: missingFailedTXs }
    txs = await this.p2p.ask(nodeToContact, 'get_transactions_by_list', payload2)
    repairTracker.newFailedTXs = txs
    // this.storage.addAcceptedTransactions(txs) // commit the failed TXs to our db. not sure if this is strictly necessary

    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ' _repair syncTXsFromWinningHash: repairTracker updates: ' + utils.stringifyReduce(repairTracker))

    this._mergeRepairDataIntoLocalState(repairTracker, ourPartitionObj, statusMap, partitionObject)
  }

  /**
   * _mergeRepairDataIntoLocalState
   * @param {RepairTracker} repairTracker todo repair tracker type
   * @param {PartitionObject} ourPartitionObj
   * @param {*} otherStatusMap todo status map, but this is unused
   * @param {PartitionObject} otherPartitionObject
   */
  _mergeRepairDataIntoLocalState (repairTracker, ourPartitionObj, otherStatusMap, otherPartitionObject) {
    // just simple assignment.  if we changed things to merge the best N results this would need to change.
    ourPartitionObj.Txids = [...otherPartitionObject.Txids]
    ourPartitionObj.Status = [...otherPartitionObject.Status]
    ourPartitionObj.States = [...otherPartitionObject.States]

    // add/remove them somewhere else?  to the structure used to generate the lists
    // let look at where a partition object is generated.
    let key = repairTracker.key
    let txList = this.getTXListByKey(key, repairTracker.partitionId)

    txList.hashes = ourPartitionObj.Txids
    txList.passed = ourPartitionObj.Status
    txList.states = ourPartitionObj.States // TXSTATE_TODO
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair _mergeRepairDataIntoLocalState:  key: ${key} txlist: ${utils.stringifyReduce({ hashes: txList.hashes, passed: txList.passed })} `)
  }

  //  this works with syncTXsFromHashSetStrings to correct our partition object data. unlike the other version of this function this just creates entries on a
  //  temp member newTxList that will be used for the next partition object calculation

  /**
   * @param {RepairTracker} repairTracker
   * @param {PartitionObject} ourPartitionObj
   * @param {any} ourLastResultHash
   * @param {GenericHashSetEntry & IHashSetEntryPartitions} ourHashSet
   */
  _mergeRepairDataIntoLocalState2 (repairTracker, ourPartitionObj, ourLastResultHash, ourHashSet) {
    let key = repairTracker.key
    let txList = this.getTXListByKey(key, repairTracker.partitionId)

    let txSourceList = txList
    if (txList.newTxList) {
      txSourceList = txList.newTxList
    }
    // let newTxList = { hashes: [...txList.hashes], passed: [...txList.passed], txs: [...txList.txs] }
    let newTxList = { hashes: [], passed: [], txs: [], thashes: [], tpassed: [], ttxs: [], tstates: [], states: [] }
    txList.newTxList = newTxList // append it to tx list for now.
    repairTracker.solutionDeltas.sort(function (a, b) { return a.i - b.i }) // why did b - a help us once??

    let debugSol = []
    for (let solution of repairTracker.solutionDeltas) {
      debugSol.push({ i: solution.i, tx: solution.tx.id.slice(0, 4), st: solution.state }) // TXSTATE_TODO
    }

    ourHashSet.extraMap.sort(function (a, b) { return a - b })
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 z ourHashSet.extraMap: ${utils.stringifyReduce(ourHashSet.extraMap)} debugSol: ${utils.stringifyReduce(debugSol)}`)

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
      newTxList.thashes.push(txSourceList.hashes[i])
      newTxList.tpassed.push(txSourceList.passed[i])
      newTxList.ttxs.push(txSourceList.txs[i])
      newTxList.tstates.push(txSourceList.states[i]) // TXSTATE_TODO
    }

    // let stepSize = cHashSetStepSize
    // let hashSet = ''
    // for (let hash of newTxList.thashes) {
    //   hashSet += hash.slice(0, stepSize)
    // }

    let hashSet = StateManager.createHashSetString(newTxList.thashes, newTxList.states) // TXSTATE_TODO

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 a  len: ${ourHashSet.indexMap.length}  extraIndex: ${extraIndex} ourPreHashSet: ${hashSet}`)

    // Txids: txSourceData.hashes, // txid1, txid2, …],  - ordered from oldest to recent
    // Status: txSourceData.passed, // [1,0, …],      - ordered corresponding to Txids; 1 for applied; 0 for failed
    // build our data while skipping extras.

    // insert corrections in order for each -1 in our local list (or write from our temp lists above)
    let ourCounter = 0
    let solutionIndex = 0
    try {
      for (let i = 0; i < ourHashSet.indexMap.length; i++) {
        let currentIndex = ourHashSet.indexMap[i]
        if (currentIndex >= 0) {
        // pull from our list? but we have already removed stuff?
          newTxList.hashes[i] = newTxList.thashes[ourCounter]
          newTxList.passed[i] = newTxList.tpassed[ourCounter]
          newTxList.txs[i] = newTxList.ttxs[ourCounter]
          newTxList.states[i] = newTxList.tstates[ourCounter]
          ourCounter++
          if (newTxList.hashes[i] == null) {
            if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 a error null at i: ${i}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
            throw new Error('aborting data repair. fatal problem')
          }
        } else {
        // repairTracker.solutionDeltas.push({ i: requestsByHost[i].requests[j], tx: acceptedTX, pf: result.passFail[j] })
          let solutionDelta = repairTracker.solutionDeltas[solutionIndex]

          if (!solutionDelta) {
            if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 a error solutionDelta=null  solutionIndex: ${solutionIndex} i:${i} of ${ourHashSet.indexMap.length} deltas: ${utils.stringifyReduce(repairTracker.solutionDeltas)}`)
          }
          // insert the next one
          newTxList.hashes[i] = solutionDelta.tx.id
          newTxList.passed[i] = solutionDelta.pf
          newTxList.txs[i] = solutionDelta.tx
          newTxList.states[i] = solutionDelta.state // TXSTATE_TODO
          solutionIndex++
          if (newTxList.hashes[i] == null) {
            if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 b error null at i: ${i}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
          }
        }
      }
    } catch (ex) {
      this.mainLogger.error(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 c  Exception when applying solution. going apoptosis. solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter} ourHashSet: ${hashSet}`)
      this.p2p.initApoptosis()
      throw new Error('aborting data repair. starting apoptosis')
    }

    hashSet = ''
    // for (let hash of newTxList.hashes) {
    //   if (!hash) {
    //     hashSet += 'xx'
    //     continue
    //   }
    //   hashSet += hash.slice(0, stepSize)
    // }
    hashSet = StateManager.createHashSetString(newTxList.hashes, newTxList.states) // TXSTATE_TODO

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 c  len: ${ourHashSet.indexMap.length}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter} ourHashSet: ${hashSet}`)

    if (repairTracker.outputHashSet !== hashSet) {
      this.mainLogger.error(`Failed to match our hashset to the solution hashSet: ${hashSet}  solution: ${repairTracker.outputHashSet}  `)

      /** @type {GenericHashSetEntry[]} */
      let hashSetList = []
      hashSetList.push(/** @type {GenericHashSetEntry} */{ hash: 'a1', votePower: 1, hashSet: hashSet, lastValue: '', errorStack: [], corrections: [], indexOffset: 0, indexMap: [], extraMap: [], waitForIndex: -1 })
      hashSetList.push(/** @type {GenericHashSetEntry} */{ hash: 'b1', votePower: 10, hashSet: repairTracker.outputHashSet, lastValue: '', errorStack: [], corrections: [], indexOffset: 0, indexMap: [], extraMap: [], waitForIndex: -1 })
      let output = StateManager.solveHashSets(hashSetList)
      for (let hashSetEntry of hashSetList) {
        this.mainLogger.error(JSON.stringify(hashSetEntry))
      }
      this.mainLogger.error(JSON.stringify(output))
      StateManager.expandIndexMapping(hashSetList[0], output)
      this.mainLogger.error(JSON.stringify(hashSetList[0].indexMap))
      this.mainLogger.error(JSON.stringify(hashSetList[0].extraMap))

      return false
    }

    return true
  }

  /**
   * @param {number} cycleNumber
   * @param {number} partitionId
   * @param {RepairTracker} repairTracker
   * @param {string} ourLastResultHash
   */
  async syncTXsFromHashSetStrings (cycleNumber, partitionId, repairTracker, ourLastResultHash) {
    let cycleCounter = cycleNumber
    if (!this.useHashSets) {
      return
    }

    let hashSetList = /** @type {HashSetEntryPartitions[]} */(this.solveHashSetsPrep(cycleCounter, partitionId, this.crypto.getPublicKey()))
    // hashSetList.sort(function (a, b) { return a.hash > b.hash }) // sort so that solution will be deterministic
    hashSetList.sort(utils.sortHashAsc)
    let output = StateManager.solveHashSets(hashSetList)

    let outputHashSet = ''
    for (let hash of output) {
      outputHashSet += hash
    }
    repairTracker.outputHashSet = outputHashSet

    // REFLOW HACK.  when we randomize host selection should make sure not to pick this forced solution as an answer
    // TODO perf:  if we fixed the algorith we could probably do this in one pass instead
    let hashSetList2 = /** @type {HashSetEntryPartitions[]} */(this.solveHashSetsPrep(cycleCounter, partitionId, this.crypto.getPublicKey()))
    // hashSetList2.sort(function (a, b) { return a.hash > b.hash }) // sort so that solution will be deterministic
    hashSetList2.sort(utils.sortHashAsc) // sort so that solution will be deterministic
    /** @type {HashSetEntryPartitions} */
    let hashSet = { hash: 'FORCED', votePower: 1000, hashSet: outputHashSet, lastValue: '', errorStack: [], corrections: [], indexOffset: 0, owners: [], ourRow: false, indexMap: [], extraMap: [], waitForIndex: -1 }
    hashSetList2.push(hashSet)
    output = StateManager.solveHashSets(hashSetList2, 40, 0.625, output)
    hashSetList = hashSetList2

    for (let hashSetEntry of hashSetList) {
      StateManager.expandIndexMapping(hashSetEntry, output) // expand them all for debug.  TODO perf: remove this line
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + JSON.stringify(hashSetEntry))
    }
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + JSON.stringify(output))
    // find our solution
    let ourSolution = hashSetList.find((a) => a.ourRow === true) // owner
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'ourSolution: ' + JSON.stringify({ ourSolution, len: ourSolution.hash.length }))
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'solved outputHashSet: ' + outputHashSet)
    // lets generate the indexMap and extraMap index tables for out hashlist solution
    StateManager.expandIndexMapping(ourSolution, output)

    let insertCount = 0
    // flag extras
    /** @type {{ requests: number[]; hostIndex: number[]; stateSnippets: string[]; hash?: string }[]} */
    let requestsByHost = new Array(hashSetList.length).fill(null)
    for (let correction of ourSolution.corrections) {
      let index = correction.i
      if (correction.t === 'insert') {
        let greedyAsk = -1 // todo perf: could try non greedy
        let voters = correction.tv.vote.voters
        for (let i = 0; i < voters.length; i++) {
          if (requestsByHost[voters[i]]) {
            greedyAsk = voters[i]
          }
        }
        // no entries found so init one
        if (greedyAsk < 0) {
          greedyAsk = voters[0]
          requestsByHost[greedyAsk] = { requests: [], hostIndex: [], stateSnippets: [] }
        }
        // generate the index map for the server we will ask as needed
        if (hashSetList[greedyAsk].indexMap == null) {
          StateManager.expandIndexMapping(hashSetList[greedyAsk], output)
        }
        // use the remote hosts index map to determine for the exact index.
        let hostIndex = hashSetList[greedyAsk].indexMap[index]
        requestsByHost[greedyAsk].hostIndex.push(hostIndex) // todo calc this on host side, requires some cache mgmt!

        // just ask for the correction and let the remote host do the translation!
        requestsByHost[greedyAsk].requests.push(index)

        // send the hash we are asking for so we will have a ref for the index
        requestsByHost[greedyAsk].hash = hashSetList[greedyAsk].hash

        // grab chars from the solution that will rep the data hash we want
        requestsByHost[greedyAsk].stateSnippets.push(correction.v.slice(cHashSetTXStepSize, cHashSetTXStepSize + cHashSetDataStepSize))
        insertCount++
      }
    }

    // stomp or create a repair deltas array parallel to the other changes
    repairTracker.solutionDeltas = []

    for (let i = 0; i < requestsByHost.length; i++) {
      if (requestsByHost[i] != null) {
        // I think we don't need this anymore:
        // requestsByHost[i].requests.sort(function (a, b) { return a - b }) // sort these since the reponse for the host will also sort by timestamp

        let payload = { partitionId: partitionId, cycle: cycleNumber, tx_indicies: requestsByHost[i].hostIndex, hash: requestsByHost[i].hash }
        if (this.extendedRepairLogging) console.log(`get_transactions_by_partition_index ok!  payload: ${utils.stringifyReduce(payload)}`)
        if (this.extendedRepairLogging) console.log(`requestsByHost[i].stateSnippets ${utils.stringifyReduce(requestsByHost[i].stateSnippets)} `)
        if (hashSetList[i].owners.length > 0) {
          let nodeToContact = this.p2p.state.getNodeByPubKey(hashSetList[i].owners[0])

          let result = await this.p2p.ask(nodeToContact, 'get_transactions_by_partition_index', payload)
          // { success: true, acceptedTX: result, passFail: passFailList }
          if (result.success === true) {
            if (this.extendedRepairLogging) console.log(`get_transactions_by_partition_index ok! count:${result.acceptedTX.length} payload: ${utils.stringifyReduce(payload)}`)
            for (let j = 0; j < result.acceptedTX.length; j++) {
              let acceptedTX = result.acceptedTX[j]
              if (result.passFail[j] === 1) {
                repairTracker.newPendingTXs.push(acceptedTX)
                repairTracker.missingTXIds.push(acceptedTX.id)
              } else {
                repairTracker.newFailedTXs.push(acceptedTX) // todo perf:  could make the response more complex so that it does not return the full tx for falied ones!.   this could take a fair amount of work.
              }

              if (acceptedTX == null) {
                if (this.verboseLogs) this.mainLogger.error(`syncTXsFromHashSetStrings acceptedTX == null  j:${j} i:${i} pf:${result.passFail[j]}`)
              }
              // update our solution deltas.. hopefully that is enough info to patch up our state.
              //   // TXSTATE_TODO   need a way to set state on this entry!
              //      probably best to just copy it from what we queried?
              repairTracker.solutionDeltas.push({ i: requestsByHost[i].requests[j], tx: acceptedTX, pf: result.passFail[j], state: requestsByHost[i].stateSnippets[j] })
            }
          } else {
            // todo datasync:  assert/fail/or retry
            if (this.verboseLogs) this.mainLogger.error(`get_transactions_by_partition_index faied!  payload: ${utils.stringifyReduce(payload)}`)
          }

          // add these TXs to newPendingTXs or newFailedTXs  and the IDs to missingTXIds
          // host needs to give us pass/fail info
        }
      }
    }

    if (insertCount !== repairTracker.solutionDeltas.length) {
      if (this.verboseLogs) this.mainLogger.error(`insertCount !== repairTracker.solutionDeltas.length: ${insertCount} , ${repairTracker.solutionDeltas.length} `)
    }

    // calculate extraTXIds
    // first find the partition object that matches the hash we used in this solution
    let key = 'c' + cycleNumber
    let partitionObjectsByHash = this.recentPartitionObjectsByCycleByHash[key]
    if (!partitionObjectsByHash) {
      return
    }
    let partitionObject = partitionObjectsByHash[ourSolution.hash]
    if (!partitionObject) {
      return
    }
    // next use our extraMap indicies to grab the actual transactions we need for the list
    for (let i = 0; i < ourSolution.extraMap.length; i++) {
      // these indexes will be relative to the object map we had the first time.
      let index = ourSolution.extraMap[i]
      repairTracker.extraTXIds.push(partitionObject.Txids[index])
      // repairTracker.extraTXs.push(partitionObject.txs[index])
    }

    let mergeOk = this._mergeRepairDataIntoLocalState2(repairTracker, partitionObject, ourLastResultHash, ourSolution)

    if (mergeOk === false) {
      return 100 // ugh super hack ret value
    }
    // todo print hash set here.
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
  _getRepairTrackerForCycle (counter, partition) {
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
        evaluationStarted: false,
        awaitWinningHash: false,
        repairsFullyComplete: false }
      repairsByPartition[key2] = repairTracker
    }
    return repairTracker
  }

  /**
   * repairTrackerMarkFinished
   * @param {RepairTracker} repairTracker
   */
  repairTrackerMarkFinished (repairTracker) {
    repairTracker.repairsFullyComplete = true
  }

  /**
   * repairTrackerClearForNextRepair
   * @param {RepairTracker} repairTracker
   */
  repairTrackerClearForNextRepair (repairTracker) {
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
   */
  async mergeAndApplyTXRepairs (cycleNumber) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs cycleNumber ${cycleNumber}`)
    // this will call into some of the funtions at the bottom of this file

    // let allTXsToApply = {}
    // let allExtraTXids = {}
    // let allAccountsToResetById = {}
    // let txIDToAcc = {}
    // let allNewTXsById = {}
    // // get all txs and sort them
    // let repairsByPartition = this.repairTrackingByCycleById['c' + cycleNumber]
    // let partitionKeys = Object.keys(repairsByPartition)
    // for (let key of partitionKeys) {
    //   let repairEntry = repairsByPartition[key]
    //   for (let tx of repairEntry.newPendingTXs) {
    //     if (utils.isString(tx.data)) {
    //       tx.data = JSON.parse(tx.data) // JIT parse.. is that ok?
    //     }
    //     let keysResponse = this.app.getKeyFromTransaction(tx.data)

    //     if (!keysResponse) {
    //       if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
    //     }

    //     let { sourceKeys, targetKeys } = keysResponse

    //     for (let accountID of sourceKeys) {
    //       allAccountsToResetById[accountID] = 1
    //     }
    //     for (let accountID of targetKeys) {
    //       allAccountsToResetById[accountID] = 1
    //     }
    //     allNewTXsById[tx.id] = tx
    //     txIDToAcc[tx.id] = { sourceKeys, targetKeys }
    //   }
    //   for (let tx of repairEntry.missingTXIds) {
    //     allTXsToApply[tx] = 1
    //   }
    //   for (let tx of repairEntry.extraTXIds) {
    //     allExtraTXids[tx] = 1
    //     // TODO Repair. ugh have to query our data and figure out which accounts need to be reset.
    //   }
    //   // todo repair: hmmm also reset accounts have a tx we need to remove.
    // }

    // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs: extra: ${utils.stringifyReduce(allExtraTXids)}  txIDToAcc: ${utils.stringifyReduce(txIDToAcc)}`)

    // walk through all txs for this cycle.
    // get or create entries for accounts.
    // track when they have missing txs or wrong txs

    let lastCycleShardValues = this.shardValuesByCycle.get(cycleNumber)

    for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
      let allTXsToApply = {}
      let allExtraTXids = {}
      let allAccountsToResetById = {}
      let txIDToAcc = {}
      let allNewTXsById = {}
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
      newTXList.sort(function (a, b) { return a.timestamp - b.timestamp })

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs newTXList.length: ${newTXList.length} txKeys.length: ${txKeys.length} txIDToAccCount: ${txIDToAccCount}`)

      let applyCount = 0
      let applyFailCount = 0
      let hasEffect = false

      let accountValuesByKey = {}
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
            let acountsFilter = {} // this is a filter of accounts that we want to write to
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
            if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs apply tx ${utils.makeShortHash(tx.id)} data: ${utils.stringifyReduce(tx)} with filter: ${utils.stringifyReduce(acountsFilter)}`)
            let hasStateTableData = false // may or may not have it but not tracking yet

            // HACK!!  receipts sent across the net to us may need to get re parsed
            if (utils.isString(tx.data.receipt)) {
              tx.data.receipt = JSON.parse(tx.data.receipt)
            }

            // todo needs wrapped states! and/or localCachedData

            // Need to build up this data.
            let keysResponse = this.app.getKeyFromTransaction(tx.data)
            let wrappedStates = {}
            let localCachedData = {}
            for (let key of keysResponse.allKeys) {
            // build wrapped states
            // let wrappedState = await this.app.getRelevantData(key, tx.data)

              let wrappedState = accountValuesByKey[key] // need to init ths data. allAccountsToResetById[key]
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
              if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ' testAccountTime failed. calling apoptosis.' + utils.stringifyReduce(tx))
              this.logger.playbackLogNote('testAccountTime_failed', `${tx.id}`, ` testAccountTime failed. calling apoptosis.`)
              this.p2p.initApoptosis()
              // return { success: false, reason: 'testAccountTime failed' }
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
   * bulkFifoLockAccounts
   * @param {string[]} accountIDs
   */
  async bulkFifoLockAccounts (accountIDs) {
    // lock all the accounts we will modify
    let wrapperLockId = await this.fifoLock('atomicWrapper')
    let ourLocks = []
    let seen = {}
    for (let accountKey of accountIDs) {
      if (seen[accountKey] === true) {
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
  bulkFifoUnlockAccounts (accountIDs, ourLocks) {
    // unlock the accounts we locked
    for (let i = 0; i < ourLocks.length; i++) {
      let accountID = accountIDs[i]
      let ourLockID = ourLocks[i]
      this.fifoUnlock(accountID, ourLockID)
    }
  }

  /**
   * _revertAccounts
   * @param {string[]} accountIDs
   * @param {number} cycleNumber
   */
  async _revertAccounts (accountIDs, cycleNumber) {
    let cycle = this.p2p.state.getCycleByCounter(cycleNumber)
    let cycleEnd = (cycle.start + cycle.duration) * 1000
    let cycleStart = cycle.start * 1000
    cycleEnd -= this.syncSettleTime // adjust by sync settle time
    cycleStart -= this.syncSettleTime // adjust by sync settle time
    let replacmentAccounts
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts start  numAccounts: ${accountIDs.length} repairing cycle:${cycleNumber}`)

    try {
      // query our account copies that are less than or equal to this cycle!
      let prevCycle = cycleNumber - 1
      replacmentAccounts = await this.storage.getAccountReplacmentCopies(accountIDs, prevCycle)

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
        }
        // tell the app to replace the account data
        await this.app.resetAccountData(replacmentAccounts)
        // update local state.
      } else {
        if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts No replacment accounts found!!! cycle <= :${prevCycle}`)
      }

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts: ${accountIDs.length} replacmentAccounts ${replacmentAccounts.length} repairing cycle:${cycleNumber}`)

      // TODO prodution. consider if we need a better set of checks before we delete an account!
      // If we don't have a replacement copy for an account we should try to delete it

      // Find any accountIDs not in resetAccountData
      let accountsReverted = {}
      let accountsToDelete = []
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
      let accMap = {}
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

  async periodicCycleDataCleanup () {
    // On a periodic bases older copies of the account data where we have more than 2 copies for the same account can be deleted.
  }

  /**
   * broadcastPartitionResults
   * @param {number} cycleNumber
   */
  async broadcastPartitionResults (cycleNumber) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair broadcastPartitionResults for cycle: ${cycleNumber}`)

    // let accountStart = '0'.repeat(64) // TODO sharding.  Solved use partition ranges and only send to in range nodes
    // let accountEnd = 'f'.repeat(64)

    // let broadcastTargets = 6
    // if (this.useHashSets) {
    //   broadcastTargets = 100
    // }

    // per partition need to figure out which node cover it.
    // then get a list of all the results we need to send to a given node and send them at once.
    // need a way to do this in semi parallel?
    let lastCycleShardValues = this.shardValuesByCycle.get(cycleNumber)
    // for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
    //   let partitionShardData = lastCycleShardValues.parititionShardDataMap.get(partitionID)
    // }

    // let nodes = this.getRandomNodesInRange(broadcastTargets, accountStart, accountEnd, [])
    // if (nodes.length === 0) {
    //   if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair broadcastPartitionResults: abort no nodes to send partition to`)
    //   return // nothing to do
    // }

    // console.log(`numnodes: ${nodes.length}`)

    let partitionResults = this.ourPartitionResultsByCycle['c' + cycleNumber]

    // nodeThatStoreOurParitionFull
    let partitionResultsByNodeID = new Map() // use a map?
    let nodesToTell = []

    // sign results as needed
    for (let i = 0; i < partitionResults.length; i++) {
      /** @type {PartitionResult} */
      let partitionResult = partitionResults[i]
      if (!partitionResult.sign) {
        partitionResult = this.crypto.sign(partitionResult)
      }

      /** @type {ShardInfo} */
      let partitionShardData = lastCycleShardValues.parititionShardDataMap.get(partitionResult.Partition_id)
      // calculate nodes that care about this partition here
      let coverCount = 0
      for (let nodeId in partitionShardData.coveredBy) {
        if (partitionShardData.coveredBy.hasOwnProperty(nodeId)) {
          coverCount++
          let asdf
          if (partitionResultsByNodeID.has(nodeId) === false) {
            nodesToTell.push(nodeId)
            asdf = { results: [], node: partitionShardData.coveredBy[nodeId] }
            partitionResultsByNodeID.set(nodeId, asdf)
          }
          asdf = partitionResultsByNodeID.get(nodeId)
          asdf.results.push(partitionResult)
        }
      }

      let repairTracker = this._getRepairTrackerForCycle(cycleNumber, partitionResult.Partition_id) // was Cycle_number
      repairTracker.numNodes = coverCount - 1 // todo sharding re-evaluate this and thing of a better perf solution
    }

    // let payload = { Cycle_number: cycleNumber, partitionResults: partitionResults }
    // if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair broadcastPartitionResults ${utils.stringifyReduce(payload)}`)
    // send the array of partition results for this current cycle.
    // await this.p2p.tell(nodes, 'post_partition_results', payload)

    // do we really want to send to all?  this will max out eventually.. but a bit worried it wont scale or be robust enough.
    // need some way to thin this out.
    let promises = []
    for (let nodeId of nodesToTell) {
      if (nodeId === lastCycleShardValues.ourNode.id) {
        continue
      }
      let asdf = partitionResultsByNodeID.get(nodeId)
      let payload = { Cycle_number: cycleNumber, partitionResults: asdf.results }
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair broadcastPartitionResults to ${nodeId} res: ${utils.stringifyReduce(payload)}`)
      let promise = this.p2p.tell([asdf.node], 'post_partition_results', payload)
      promises.push(promise)
    }

    // do we really want to wait?
    await Promise.all(promises)
  }

  initStateSyncData () {
    if (!this.partitionObjectsByCycle) {
      /** @type { Object.<string,PartitionObject[]>} our partition objects by cycle.  index by cycle counter key to get an array */
      this.partitionObjectsByCycle = {}
    }
    if (!this.ourPartitionResultsByCycle) {
      /** @type { Object.<string,PartitionResult[]>} our partition results by cycle.  index by cycle counter key to get an array */
      this.ourPartitionResultsByCycle = {}
    }

    if (!this.repairTrackingByCycleById) {
      /** @type {Object.<string, Object.<string,RepairTracker>>} tracks state for repairing partitions. index by cycle counter key to get the repair object, index by parition */
      this.repairTrackingByCycleById = {}
    }

    if (!this.recentPartitionObjectsByCycleByHash) {
      /** @type {Object.<string, Object.<string,PartitionObject>>} our partition objects by cycle.  index by cycle counter key to get an array */
      this.recentPartitionObjectsByCycleByHash = {}
    }

    if (!this.tempTXRecords) {
      /** @type {TempTxRecord[]} temporary store for TXs that we put in a partition object after a cycle is complete. an array that holds any TXs (i.e. from different cycles), code will filter out what it needs */
      this.tempTXRecords = []
    }

    if (!this.txByCycleByPartition) {
      // txList = { hashes: [], passed: [], txs: [], processed: false, states: [] }
      // TxTallyList
      /** @type {Object.<string, Object.<string,TxTallyList>>} */
      this.txByCycleByPartition = {}
    }

    // if (!this.txByCycleByPartition) {
    //   this.txByCycleByPartition = {}
    // }

    if (!this.allPartitionResponsesByCycleByPartition) {
      /** @type {Object.<string, Object.<string,PartitionResult[]>>} Stores the partition responses that other nodes push to us.  Index by cycle key, then index by partition id */
      this.allPartitionResponsesByCycleByPartition = {}
    }
  }

  startShardCalculations () {
    this.p2p.state.on('cycle_q1_start', async (lastCycle, time) => {
      if (lastCycle) {
        this.dumpAccountDebugData()
        this.updateShardValues(lastCycle.counter)
      }
    })
  }

  async startSyncPartitions () {
    // await this.createInitialAccountBackups() // nm this is now part of regular data sync
    // register our handlers

    // this._registerListener(this.p2p.state, 'cycle_q1_start', async (lastCycle, time) => {
    //   this.updateShardValues(lastCycle.counter)
    // })

    this._registerListener(this.p2p.state, 'cycle_q2_start', async (lastCycle, time) => {
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair startSyncPartitions:cycle_q2_start cycle: ${lastCycle.counter}`)

      // this will take temp TXs and make sure they are stored in the correct place for us to generate partitions
      this.processTempTXs(lastCycle)

      // During the Q2 phase of a cycle, nodes compute the partition hash of the previous cycle for all the partitions covered by the node.
      // Q2 was chosen so that any transactions submitted with a time stamp that falls in the previous quarter will have been processed and finalized. This could be changed to Q3 if we find that more time is needed.
      this.generatePartitionObjects(lastCycle)

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
   * @param {any} accountDataList todo need to use wrapped account data here
   * @param {boolean} repairing
   * @param {number} txTimestamp
   */
  async updateAccountsCopyTable (accountDataList, repairing, txTimestamp) {
    let cycleNumber = -1

    let cycle = this.p2p.state.getCycleByTimestamp(txTimestamp + this.syncSettleTime)
    let cycleOffset = 0
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
    if (accountDataList[0].timestamp !== txTimestamp) {
      if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + `updateAccountsCopyTable timestamps dot match txts:${txTimestamp} acc.ts:${accountDataList[0].timestamp} `)
    }

    // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `updateAccountsCopyTable acc.timestamp: ${accountDataList[0].timestamp} offsetTime: ${this.syncSettleTime} cycle computed:${cycleNumber} `)

    for (let accountEntry of accountDataList) {
      let { accountId, data, timestamp, hash } = accountEntry

      let backupObj = { accountId, data, timestamp, hash, cycleNumber }

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + `updateAccountsCopyTable acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)

      // todo perf. batching?
      // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'updateAccountsCopyTableA ' + JSON.stringify(accountEntry))
      // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + 'updateAccountsCopyTableB ' + JSON.stringify(backupObj))

      // wrappedAccounts.push({ accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp })
      await this.storage.createOrReplaceAccountCopy(backupObj)
    }
  }

  /**
 * tempRecordTXByCycle
 * we dont have a cycle yet to save these records against so store them in a temp place
 * @param {number} txTS
 * @param {AcceptedTx} acceptedTx
 * @param {boolean} passed
 * @param {ApplyResponse} applyResponse
 */
  tempRecordTXByCycle (txTS, acceptedTx, passed, applyResponse) {
    this.tempTXRecords.push({ txTS, acceptedTx, passed, redacted: -1, applyResponse: applyResponse })
  }

  /**
   * processTempTXs
   * call this before we start computing partitions so that we can make sure to get the TXs we need out of the temp list
   * @param {Cycle} cycle
   */
  processTempTXs (cycle) {
    if (!this.tempTXRecords) {
      return
    }
    let txsRecorded = 0
    let txsTemp = 0

    let newTempTX = []
    let cycleEnd = (cycle.start + cycle.duration) * 1000
    cycleEnd -= this.syncSettleTime // adjust by sync settle time
    for (let txRecord of this.tempTXRecords) {
      if (txRecord.redacted > 0) {
        if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair recordTXByCycle: ${utils.makeShortHash(txRecord.acceptedTx.id)} cycle: ${cycle.counter} redacted!!! ${txRecord.redacted}`)
        continue
      }
      if (txRecord.txTS < cycleEnd) {
        this.recordTXByCycle(txRecord.txTS, txRecord.acceptedTx, txRecord.passed, txRecord.applyResponse)
        txsRecorded++
      } else {
        newTempTX.push(txRecord)
        txsTemp++
      }
    }

    this.tempTXRecords = newTempTX

    let lastCycleShardValues = this.shardValuesByCycle.get(cycle.counter)

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
  getTXList (cycleNumber, partitionId) {
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
   * @param {string} key
   * @param {number} partitionId
   * @returns {TxTallyList}
   */
  getTXListByKey (key, partitionId) {
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
  recordTXByCycle (txTS, acceptedTx, passed, applyResponse) {
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

    for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
      let txList = this.getTXList(cycleNumber, partitionID) // todo sharding - done: pass partition ID

      if (txList.processed) {
        this.mainLogger.error(`_repair trying to record transaction after we have already finalized our parition object for cycle ${cycle.counter} `)
      }

      txList.hashes.push(acceptedTx.id)
      txList.passed.push((passed) ? 1 : 0)
      txList.txs.push(acceptedTx)

      if (applyResponse != null && applyResponse.accountData != null) {
        let states = []
        for (let accountData of applyResponse.accountData) {
          states.push(utils.makeShortHash(accountData.hash)) // TXSTATE_TODO need to get only certain state data!.. hash of local states?
        }
        txList.states.push(states[0]) // TXSTATE_TODO does this check out?
      } else {
        txList.states.push('xxxx')
      }
      // txList.txById[acceptedTx.id] = acceptedTx
      // TODO sharding perf.  need to add some periodic cleanup when we have more cycles than needed stored in this map!!!
      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair recordTXByCycle: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber} entries: ${txList.hashes.length}`)
    }
  }

  /**
   * getPartitionObject
   * @param {number} cycleNumber
   * @param {number} partitionId
   * @returns {PartitionObject}
   */
  getPartitionObject (cycleNumber, partitionId) {
    let key = 'c' + cycleNumber
    let partitionObjects = this.partitionObjectsByCycle[key]
    for (let obj of partitionObjects) {
      if (obj.Partition_id === partitionId) {
        return obj
      }
    }
  }

  /**
   * storePartitionReceipt
   * TODO sharding perf.  may need to do periodic cleanup of this and other maps so we can remove data from very old cycles
   * TODO production need to do something with this data
   * @param {number} cycleNumber
   * @param {PartitionReceipt} partitionReceipt
   */
  storePartitionReceipt (cycleNumber, partitionReceipt) {
    let key = 'c' + cycleNumber

    if (!this.cycleReceiptsByCycleCounter) {
      /** @type {Object.<string, PartitionReceipt[]>} a map of cycle keys to lists of partition receipts.  */
      this.cycleReceiptsByCycleCounter = {}
    }
    if (!this.cycleReceiptsByCycleCounter[key]) {
      this.cycleReceiptsByCycleCounter[key] = []
    }
    this.cycleReceiptsByCycleCounter[key].push(partitionReceipt)
  }

  /**
   * findMostCommonResponse
   * @param {number} cycleNumber
   * @param {number} partitionId
   * @param {string[]} ignoreList currently unused and broken todo resolve this.
   * @return {{topHash: string, topCount: number, topResult: PartitionResult}}
   */
  findMostCommonResponse (cycleNumber, partitionId, ignoreList) {
    let key = 'c' + cycleNumber
    let responsesById = this.allPartitionResponsesByCycleByPartition[key]
    let key2 = 'p' + partitionId
    let responses = responsesById[key2]

    let hashCounting = {}
    let topHash
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
    if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair findMostCommonResponse: ${utils.stringifyReduce(responsesById)} }`)
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
  static solveHashSets (hashSetList, lookAhead = 10, voteRate = 0.625, prevOutput = null) {
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
      let votes = {}
      let topVote = { v: '', count: 0 }
      let winnerFound = false
      let totalVotes = 0
      // for (let hashListEntry of hashSetList) {
      for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
        let hashListEntry = hashSetList[hashListIndex]
        if ((index + hashListEntry.indexOffset + 1) * stepSize > hashListEntry.hashSet.length) {
          continue
        }
        let sliceStart = (index + hashListEntry.indexOffset) * stepSize
        let v = hashListEntry.hashSet.slice(sliceStart, sliceStart + stepSize)
        if (v === '') {
          continue
        }

        let countEntry = votes[v] || { count: 0, ec: 0, voters: [] }
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

          let alreadyVoted = {} // has the given node already EC voted for this key?
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
            let countEntry = votes[v] || { count: 0, ec: 0 }

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
                  let tempCorrection = { i: extraIdx, t: 'extra', c: correction, hi: index2 - (j + 1), tv: null, v: null, bv: null, if: -1 } // added tv: null, v: null, bv: null, if: -1
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
        hashListEntry.corrections.push({ i: extraIdx, t: 'extra', c: null, hi: hi, tv: null, v: null, bv: null, if: -1 }) // added , tv: null, v: null, bv: null, if: -1
        extraIdx++
      }
    }

    return output // { output, outputVotes }
  }

  // efficient transformation to create a lookup to go from answer space index to the local index space of a hashList entry
  // also creates a list of local indicies of elements to remove
  /**
   * expandIndexMapping
   * @param {GenericHashSetEntry} hashListEntry
   * @param {*} output TODO get correct type here
   */
  static expandIndexMapping (hashListEntry, output) {
    hashListEntry.indexMap = []
    hashListEntry.extraMap = []
    let readPtr = 0
    let writePtr = 0
    let correctionIndex = 0
    let currentCorrection = null
    let extraBits = 0
    while (writePtr < output.length) {
      if (correctionIndex < hashListEntry.corrections.length && hashListEntry.corrections[correctionIndex].i <= writePtr) {
        currentCorrection = hashListEntry.corrections[correctionIndex]
        correctionIndex++
      } else {
        currentCorrection = null
      }
      if (extraBits > 0) {
        readPtr += extraBits
        extraBits = 0
      }

      if (!currentCorrection) {
        hashListEntry.indexMap.push(readPtr)
        writePtr++
        readPtr++
      } else if (currentCorrection.t === 'insert') {
        hashListEntry.indexMap.push(-1)
        writePtr++
      } else if (currentCorrection.t === 'extra') {
        // hashListEntry.extraMap.push({ i: currentCorrection.i, hi: currentCorrection.hi })
        hashListEntry.extraMap.push(currentCorrection.hi)
        extraBits++
        continue
      }
    }

    // final corrections:
    while (correctionIndex < hashListEntry.corrections.length) {
      currentCorrection = hashListEntry.corrections[correctionIndex]
      correctionIndex++

      if (currentCorrection.t === 'extra') {
        // hashListEntry.extraMap.push({ i: currentCorrection.i, hi: currentCorrection.hi })
        hashListEntry.extraMap.push(currentCorrection.hi)
        extraBits++
        continue
      }
    }
  }

  /**
   * solveHashSetsPrep
   * todo cleanup.. just sign the partition object asap so we dont have to check if there is a valid sign object throughout the code (but would need to consider perf impact of this)
   * @param {number} cycleNumber
   * @param {number} partitionId
   * @param {string} ourNodeKey
   * @return {GenericHashSetEntry[]}
   */
  solveHashSetsPrep (cycleNumber, partitionId, ourNodeKey) {
    let key = 'c' + cycleNumber
    let responsesById = this.allPartitionResponsesByCycleByPartition[key]
    let key2 = 'p' + partitionId
    let responses = responsesById[key2]

    let hashSets = {}
    let hashSetList = []
    // group identical sets together
    let hashCounting = {}
    for (let partitionResult of responses) {
      let hash = partitionResult.Partition_hash
      let count = hashCounting[hash] || 0
      if (count === 0) {
        let owner = null
        if (partitionResult.sign) {
          owner = partitionResult.sign.owner
        } else {
          owner = ourNodeKey
        }
        /** @type {HashSetEntryPartitions} */
        let hashSet = { hash: hash, votePower: 0, hashSet: partitionResult.hashSet, lastValue: '', errorStack: [], corrections: [], indexOffset: 0, owners: [owner], ourRow: false, waitForIndex: -1 }
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
  static testHashsetSolution (ourHashSet, solutionHashSet) {
    // let payload = { partitionId: partitionId, cycle: cycleNumber, tx_indicies: requestsByHost[i].hostIndex, hash: requestsByHost[i].hash }
    // repairTracker.solutionDeltas.push({ i: requestsByHost[i].requests[j], tx: acceptedTX, pf: result.passFail[j] })

    // let txSourceList = txList
    // if (txList.newTxList) {
    //   txSourceList = txList.newTxList
    // }

    // solutionDeltas.sort(function (a, b) { return a.i - b.i }) // why did b - a help us once??

    // let debugSol = []
    // for (let solution of repairTracker.solutionDeltas) {
    //   debugSol.push({ i: solution.i, tx: solution.tx.id.slice(0, 4) })  // TXSTATE_TODO
    // }

    let stepSize = cHashSetStepSize
    let makeTXArray = function (hashSet) {
      let txArray = []
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
    let newTxList = { thashes: [], hashes: [], states: [] }

    let solutionList = []
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

    ourHashSet.extraMap.sort(function (a, b) { return a - b })
    solutionList.sort(function (a, b) { return a.i - b.i })

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
        console.log(`testHashsetSolution error extra == null at i: ${i}  extraIndex: ${extraIndex}`)
        break
      }
      if (txSourceList.hashes[i] == null) {
        console.log(`testHashsetSolution error null at i: ${i}  extraIndex: ${extraIndex}`)
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

    console.log(`extras removed: len: ${ourHashSet.indexMap.length}  extraIndex: ${extraIndex} ourPreHashSet: ${hashSet}`)

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
        newTxList.hashes[i] = newTxList.thashes[ourCounter]
        // newTxList.passed[i] = newTxList.tpassed[ourCounter]
        // newTxList.txs[i] = newTxList.ttxs[ourCounter]

        if (newTxList.hashes[i] == null) {
          console.log(`testHashsetSolution error null at i: ${i} solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
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
          console.log(`testHashsetSolution error null at i: ${i}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
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
    hashSet = StateManager.createHashSetString(newTxList.hashes, newTxList.states) // TXSTATE_TODO

    console.log(`solved set len: ${hashSet.length / stepSize}  : ${hashSet}`)
    // if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + `_mergeRepairDataIntoLocalState2 c  len: ${ourHashSet.indexMap.length}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter} ourHashSet: ${hashSet}`)

    return true
  }

  /**
   * createHashSetString
   * @param {*} txHashes // todo find correct values
   * @param {*} dataHashes
   * @returns {*} //todo correct type
   */
  static createHashSetString (txHashes, dataHashes) {
    let hashSet = ''
    for (let i = 0; i < txHashes.length; i++) {
      let txHash = txHashes[i]
      let dataHash = dataHashes[i]
      if (!txHash) {
        txHash = 'xx'
      }
      if (!dataHash) {
        dataHash = 'xx'
      }
      hashSet += txHash.slice(0, cHashSetTXStepSize)
      hashSet += dataHash.slice(0, cHashSetDataStepSize)
    }
    return hashSet
  }
}

module.exports = StateManager
