import { ShardusConfiguration } from '../shardus/shardus-types'
import Shardus = require('../shardus/shardus-types')
import { ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, HomeNodeSummary, ParititionShardDataMap, NodeShardDataMap, MergeResults, BasicAddressRange } from './shardFunctionTypes'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger from '../logger'
import ShardFunctions from './shardFunctions2.js'
import { time } from 'console'
import StateManager from '.'


class PartitionObjects {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler
  verboseLogs: boolean
  logger: Logger
  p2p: P2P
  storage: Storage
  stateManager: StateManager

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any
  statemanager_fatal: (key: string, log: string) => void

  constructor(stateManager: StateManager, verboseLogs: boolean, profiler: Profiler, app: Shardus.App, logger: Logger,storage: Storage, p2p: P2P,  crypto: Crypto, config: Shardus.ShardusConfiguration) {
    this.verboseLogs = verboseLogs
    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler
    this.p2p = p2p
    this.storage = storage
    this.stateManager = stateManager


    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal


  }



  //  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //  //////////////////////////////////////////////////          Data Repair                    ///////////////////////////////////////////////////////////
  //  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


/***
 *    ########     ###    ########  ######## #### ######## ####  #######  ##    ## ########  ######## ########   #######  ########  ########  ######  
 *    ##     ##   ## ##   ##     ##    ##     ##     ##     ##  ##     ## ###   ## ##     ## ##       ##     ## ##     ## ##     ##    ##    ##    ## 
 *    ##     ##  ##   ##  ##     ##    ##     ##     ##     ##  ##     ## ####  ## ##     ## ##       ##     ## ##     ## ##     ##    ##    ##       
 *    ########  ##     ## ########     ##     ##     ##     ##  ##     ## ## ## ## ########  ######   ########  ##     ## ########     ##     ######  
 *    ##        ######### ##   ##      ##     ##     ##     ##  ##     ## ##  #### ##   ##   ##       ##        ##     ## ##   ##      ##          ## 
 *    ##        ##     ## ##    ##     ##     ##     ##     ##  ##     ## ##   ### ##    ##  ##       ##        ##     ## ##    ##     ##    ##    ## 
 *    ##        ##     ## ##     ##    ##    ####    ##    ####  #######  ##    ## ##     ## ######## ##         #######  ##     ##    ##     ######  
 */

  /**
   * getPartitionReport used by reporting (monitor server) to query if there is a partition report ready
   * @param {boolean} consensusOnly
   * @param {boolean} smallHashes
   * @returns {any}
   */
  // TSConversion todo define partition report. for now use any
  getPartitionReport(consensusOnly: boolean, smallHashes: boolean): PartitionCycleReport {
    let response = {} // {res:[], cycleNumber:-1}
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
  poMicroDebug(partitionObject: PartitionObject) {
    let header = `c${partitionObject.Cycle_number} p${partitionObject.Partition_id}`

    // need to get a list of compacted TXs in order. also addresses. timestamps?  make it so tools can process easily. (align timestamps view.)

    this.mainLogger.debug('poMicroDebug: ' + header)
  }

  /**
   * generatePartitionObjects
   * @param {Cycle} lastCycle
   */
  generatePartitionObjects(lastCycle: Shardus.Cycle) {
    let lastCycleShardValues = this.shardValuesByCycle.get(lastCycle.counter)

    // let partitions = ShardFunctions.getConsenusPartitions(lastCycleShardValues.shardGlobals, lastCycleShardValues.nodeShardData)
    // lastCycleShardValues.ourConsensusPartitions = partitions

    if (lastCycleShardValues == null) {
      throw new Error('generatePartitionObjects lastCycleShardValues == null' + lastCycle.counter)
    }

    let partitions = lastCycleShardValues.ourConsensusPartitions
    if (this.repairAllStoredPartitions === true) {
      partitions = lastCycleShardValues.ourStoredPartitions
    }
    if (partitions == null) {
      throw new Error('generatePartitionObjects partitions == null')
    }

    if (this.feature_useNewParitionReport === false) {
      this.nextCycleReportToSend = { res: [], cycleNumber: lastCycle.counter }
    }

    let partitionObjects = []
    let partitionResults = []
    let cycleKey = 'c' + lastCycle.counter
    for (let partitionNumber of partitions) {
      // TODO sharding - done.  when we add state sharding need to loop over partitions.
      let partitionObject = this.generatePartitionObject(lastCycle, partitionNumber)

      // Nodes sign the partition hash along with the Partition_id, Cycle_number and timestamp to produce a partition result.
      let partitionResult = this.generatePartitionResult(partitionObject)

      if (this.feature_useNewParitionReport === false) {
        this.nextCycleReportToSend.res.push({ i: partitionResult.Partition_id, h: partitionResult.Partition_hash })
      }
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
  generatePartitionResult(partitionObject: PartitionObject): PartitionResult {
    let tempStates = partitionObject.States
    partitionObject.States = []
    let partitionHash = /** @type {string} */ this.crypto.hash(partitionObject)
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
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('partitionObject', 'c' + partitionObject.Cycle_number, partitionObject)
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
  generatePartitionObject(lastCycle: Cycle, partitionId: number) {
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
      Chain: [], // [partition_hash_341, partition_hash_342, partition_hash_343, …]
      // TODO prodution need to implment chain logic.  Chain logic is important for making a block chain out of are partition objects
    }
    return partitionObject
  }

  /**
   * partitionObjectToTxMaps
   * @param {PartitionObject} partitionObject
   * @returns {Object.<string,number>}
   */
  partitionObjectToTxMaps(partitionObject: PartitionObject): StatusMap {
    let statusMap: StatusMap = {}
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
  partitionObjectToStateMaps(partitionObject: PartitionObject): StateMap {
    let statusMap: StateMap = {}
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
  tryGeneratePartitionReciept(allResults: PartitionResult[], ourResult: PartitionResult, repairPassHack = false) {
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
      resultsList,
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
  async startRepairProcess(cycle: Cycle, topResult: PartitionResult | null, partitionId: number, ourLastResultHash: string) {
    // todo update stateIsGood to follow a new metric based on the new data repair.
    this.stateIsGood_txHashsetOld = false
    if (this.canDataRepair === false) {
      // todo fix false negative results.  This may require inserting
      if (this.verboseLogs) this.mainLogger.error(`data oos detected. (old system) False negative results given if syncing. cycle: ${cycle.counter} partition: ${partitionId} `)
      return
    }

    return
  }

  // todo refactor some of the duped code in here
  // possibly have to split this into three functions to make that clean (find our result and the parition checking as sub funcitons... idk)
  /**
   * checkForGoodPartitionReciept
   *
   *  this is part of the old partition tracking and is only used for debugging now.
   *
   * @param {number} cycleNumber
   * @param {number} partitionId
   */
  async checkForGoodPartitionReciept(cycleNumber: number, partitionId: number) {
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
    if (ourResult == null) {
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
      if (partitionReceipt3 == null) {
        throw new Error(`checkForGoodPartitionReciept partitionReceipt3 == null ${debugKey}`)
      }
      this.storePartitionReceipt(cycleNumber, partitionReceipt3)
      this.repairTrackerMarkFinished(repairTracker, 'checkForGoodPartitionReciept')
      if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair checkForGoodPartitionReciept 2 allFinished, final ${debugKey} hash:${utils.stringifyReduce({ topResult3 })}`)
    }
  }

  initApoptosisAndQuitSyncing() {
    console.log('initApoptosisAndQuitSyncing ' + utils.getTime('s'))
    this.mainLogger.error(this.dataPhaseTag + `initApoptosisAndQuitSyncing `)
    this.stateManagerSync.failAndDontRestartSync()
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
  _getRepairTrackerForCycle(counter: number, partition: number) {
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
      repairTracker = {
        triedHashes: [],
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
        repairsFullyComplete: false,
      }
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
  repairTrackerMarkFinished(repairTracker: RepairTracker, debugTag: string) {
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
      this.stateIsGood_activeRepairs = true
      this.stateIsGood_txHashsetOld = true
    }
  }

  /**
   * repairTrackerClearForNextRepair
   * @param {RepairTracker} repairTracker
   */
  repairTrackerClearForNextRepair(repairTracker: RepairTracker) {
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
  async mergeAndApplyTXRepairs(cycleNumber: number, specificParition: number) {
    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair mergeAndApplyTXRepairs cycleNumber ${cycleNumber} partition: ${specificParition}`)
    // walk through all txs for this cycle.
    // get or create entries for accounts.
    // track when they have missing txs or wrong txs

    let lastCycleShardValues = this.shardValuesByCycle.get(cycleNumber)
    if (lastCycleShardValues == null) {
      throw new Error('mergeAndApplyTXRepairs lastCycleShardValues == null')
    }
    if (lastCycleShardValues.ourConsensusPartitions == null) {
      throw new Error('mergeAndApplyTXRepairs lastCycleShardValues.ourConsensusPartitions')
    }

    for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
      // this is an attempt to just repair one parition.
      if (partitionID !== specificParition) {
        continue
      }

      let allTXsToApply: StringNumberObjectMap = {}
      let allExtraTXids: StringNumberObjectMap = {}
      let allAccountsToResetById: StringNumberObjectMap = {}
      let txIDToAcc: TxIDToSourceTargetObjectMap = {}
      let allNewTXsById: TxObjectById = {}
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

      let accountValuesByKey: AccountValuesByKey = {}
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
            let acountsFilter: AccountFilter = {} // this is a filter of accounts that we want to write to
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
            let wrappedStates: WrappedResponses = {}
            let localCachedData: LocalCachedData = {}
            for (let key of keysResponse.allKeys) {
              // build wrapped states
              // let wrappedState = await this.app.getRelevantData(key, tx.data)

              let wrappedState: Shardus.WrappedResponse = accountValuesByKey[key] // need to init ths data. allAccountsToResetById[key]
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
              if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('testAccountTime_failed', `${tx.id}`, ` testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs`)

              this.statemanager_fatal(`testAccountTime_failed`, this.dataPhaseTag + ' testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs' + utils.stringifyReduce(tx))

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
          this.statemanager_fatal(`mergeAndApplyTXRepairs_ex`, '_repair: startRepairProcess mergeAndApplyTXRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
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
  async updateTrackingAndPrepareRepairs(cycleNumber: number, specificParition: number) {
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
      let allTXsToApply: StringNumberObjectMap = {}
      let allExtraTXids: StringNumberObjectMap = {}
      /** @type {Object.<string, number>} */
      let allAccountsToResetById: StringNumberObjectMap = {}
      /** @type {Object.<string, { sourceKeys:string[], targetKeys:string[] } >} */
      let txIDToAcc: TxIDToSourceTargetObjectMap = {}
      let allNewTXsById: TxObjectById = {}
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
      let updateData: UpdateRepairData = { newTXList, allAccountsToResetById, partitionId: specificParition, txIDToAcc }
      let ckey = 'c' + cycleNumber
      if (this.repairUpdateDataByCycle[ckey] == null) {
        this.repairUpdateDataByCycle[ckey] = []
      }
      this.repairUpdateDataByCycle[ckey].push(updateData)

      // how will the partition object get updated though??
      // }

      if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair updateTrackingAndPrepareRepairs finished`)
      if (paritionsServiced === 0) {
        this.statemanager_fatal(`_updateTrackingAndPrepareRepairs_fail`, `_updateTrackingAndPrepareRepairs failed. not partitions serviced: ${debugKey} our consensus:${utils.stringifyReduce(lastCycleShardValues?.ourConsensusPartitions)} `)
      }
    } catch (ex) {
      this.mainLogger.debug('__updateTrackingAndPrepareRepairs: exception ' + ` ${debugKey} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.statemanager_fatal(`_updateTrackingAndPrepareRepairs_ex`, '__updateTrackingAndPrepareRepairs: exception ' + ` ${debugKey} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    }
  }

  /**
   * updateTrackingAndPrepareChanges
   * @param {number} cycleNumber
   */
  async applyAllPreparedRepairs(cycleNumber: number) {
    if (this.applyAllPreparedRepairsRunning === true) {
      return
    }
    this.applyAllPreparedRepairsRunning = true

    if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs cycleNumber ${cycleNumber}`)

    this.mainLogger.debug(`applyAllPreparedRepairs c:${cycleNumber}`)

    let ckey = 'c' + cycleNumber
    let repairDataList = this.repairUpdateDataByCycle[ckey]

    let txIDToAcc: TxIDToKeyObjectMap = {}
    let allAccountsToResetById: AccountBoolObjectMap = {}
    let newTXList: AcceptedTx[] = []
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
    let accountValuesByKey: WrappedResponses = {}

    let seenTXs: StringBoolObjectMap = {}
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
          let acountsFilter: AccountFilter = {} // this is a filter of accounts that we want to write to
          // find which accounts need txs applied.
          hasEffect = false
          hasNonGlobalEffect = false
          for (let accountID of keysFilter.sourceKeys) {
            if (allAccountsToResetById[accountID]) {
              acountsFilter[accountID] = 1
              hasEffect = true
              if (this.isGlobalAccount(accountID) === false) {
                hasNonGlobalEffect = true
              }
            }
          }
          for (let accountID of keysFilter.targetKeys) {
            if (allAccountsToResetById[accountID]) {
              acountsFilter[accountID] = 1
              hasEffect = true
              if (this.isGlobalAccount(accountID) === false) {
                hasNonGlobalEffect = true
              }
            }
          }
          if (!hasEffect) {
            // no need to apply this tx because it would do nothing
            continue
          }
          if (!hasNonGlobalEffect) {
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
          let wrappedStates: WrappedResponses = {}
          let localCachedData: LocalCachedData = {}
          for (let key of keysResponse.allKeys) {
            // build wrapped states
            // let wrappedState = await this.app.getRelevantData(key, tx.data)

            let wrappedState: Shardus.WrappedResponse = accountValuesByKey[key] // need to init ths data. allAccountsToResetById[key]
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
            if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('testAccountTime_failed', `${tx.id}`, ` applyAllPreparedRepairs testAccountTime failed. calling apoptosis. applyAllPreparedRepairs`)
            this.statemanager_fatal(`applyAllPreparedRepairs_fail`, this.dataPhaseTag + ' testAccountTime failed. calling apoptosis. applyAllPreparedRepairs' + utils.stringifyReduce(tx))

            // return
            this.p2p.initApoptosis() // todo turn this back on
            // // return { success: false, reason: 'testAccountTime failed' }
            break
          }

          // TODO: globalaccounts  this is where we go through the account state and just in time grab global accounts from the cache we made in the revert section from backup copies.
          //  TODO Perf probably could prepare of this inforamation above more efficiently but for now this is most simple and self contained.

          //TODO verify that we will even have wrapped states at this point in the repair without doing some extra steps.
          let wrappedStateKeys = Object.keys(wrappedStates)
          for (let wrappedStateKey of wrappedStateKeys) {
            let wrappedState = wrappedStates[wrappedStateKey]

            // if(wrappedState == null) {
            //   if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair applyAllPreparedRepairs wrappedState == null ${utils.stringifyReduce(wrappedStateKey)} ${tx.timestamp}`)
            //   //could continue but want to see if there is more we can log.
            // }
            //is it global.
            if (this.isGlobalAccount(wrappedStateKey)) {
              // wrappedState.accountId)){
              if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('globalAccountMap', `applyAllPreparedRepairs - has`, ` ${wrappedState.accountId} ${wrappedStateKey}`)
              if (wrappedState != null) {
                let globalValueSnapshot = this.getGlobalAccountValueAtTime(wrappedState.accountId, tx.timestamp)

                if (globalValueSnapshot == null) {
                  //todo some error?
                  let globalAccountBackupList = this.getGlobalAccountBackupList(wrappedStateKey)
                  if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair applyAllPreparedRepairs has global key but no snapshot at time ${tx.timestamp} entries:${globalAccountBackupList.length} ${utils.stringifyReduce(globalAccountBackupList.map((a) => `${a.timestamp}  ${utils.makeShortHash(a.accountId)} `))}  `)
                  continue
                }
                // build a new wrapped response to insert
                let newWrappedResponse: Shardus.WrappedResponse = { accountCreated: wrappedState.accountCreated, isPartial: false, accountId: wrappedState.accountId, timestamp: wrappedState.timestamp, stateId: globalValueSnapshot.hash, data: globalValueSnapshot.data }
                //set this new value into our wrapped states.
                wrappedStates[wrappedStateKey] = newWrappedResponse // update!!
                // insert thes data into the wrapped states.
                // yikes probably cant do local cached data at this point.
                if (this.verboseLogs) {
                  let globalAccountBackupList = this.getGlobalAccountBackupList(wrappedStateKey)
                  if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair applyAllPreparedRepairs has global key details ${tx.timestamp} entries:${globalAccountBackupList.length} ${utils.stringifyReduce(globalAccountBackupList.map((a) => `${a.timestamp}  ${utils.makeShortHash(a.accountId)} `))}  `)
                }

                if (this.verboseLogs) this.mainLogger.debug(this.dataPhaseTag + ` _repair applyAllPreparedRepairs got global account to repair from: ${utils.stringifyReduce(newWrappedResponse)}`)
              }
            } else {
              if (wrappedState == null) {
                if (this.verboseLogs) this.mainLogger.error(this.dataPhaseTag + ` _repair applyAllPreparedRepairs is not a global account but wrapped state == null ${utils.stringifyReduce(wrappedStateKey)} ${tx.timestamp}`)
              }
            }
          }

          let applied = await this.tryApplyTransaction(tx, hasStateTableData, /** repairing */ true, acountsFilter, wrappedStates, localCachedData) // TODO app interface changes.. how to get and pass the state wrapped account state in, (maybe simple function right above this
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
        this.statemanager_fatal(`applyAllPreparedRepairs_fail`, '_repair: startRepairProcess applyAllPreparedRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
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
   * _revertAccounts
   * @param {string[]} accountIDs
   * @param {number} cycleNumber
   */
  async _revertAccounts(accountIDs: string[], cycleNumber: number) {
    let cycle = this.p2p.state.getCycleByCounter(cycleNumber)
    let cycleEnd = (cycle.start + cycle.duration) * 1000
    let cycleStart = cycle.start * 1000
    cycleEnd -= this.syncSettleTime // adjust by sync settle time
    cycleStart -= this.syncSettleTime // adjust by sync settle time
    let replacmentAccounts: Shardus.AccountsCopy[]
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
          if (this.isGlobalAccount(accountData.accountId) === false) {
            replacmentAccountsMinusGlobals.push(accountData)
            if (this.verboseLogs && this.extendedRepairLogging) this.mainLogger.debug(this.dataPhaseTag + ` _repair _revertAccounts not a global account, add to list ${utils.makeShortHash(accountData.accountId)}`)
          } else {
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
      let accountsReverted: StringNumberObjectMap = {}
      let accountsToDelete: string[] = []
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
      let accMap: StringNumberObjectMap = {}
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
      this.statemanager_fatal(`_revertAccounts_ex`, '_repair: _revertAccounts mergeAndApplyTXRepairs ' + ` ${utils.stringifyReduce({ cycleNumber, cycleEnd, cycleStart, accountIDs })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    }

    return replacmentAccounts // this is for debugging reference
  }



}

export default PartitionObjects
