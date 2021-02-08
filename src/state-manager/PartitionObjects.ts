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
import Depricated from './Depricated'

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

  nextCycleReportToSend: PartitionCycleReport
  syncPartitionsStarted: boolean
  
  lastCycleReported: number
  partitionReportDirty:boolean


  /** partition objects by cycle.  index by cycle counter key to get an array */
  partitionObjectsByCycle: { [cycleKey: string]: PartitionObject[] }
  /** our partition Results by cycle.  index by cycle counter key to get an array */
  ourPartitionResultsByCycle: { [cycleKey: string]: PartitionResult[] }
  /** partition objects by cycle by hash.   */
  recentPartitionObjectsByCycleByHash: { [cycleKey: string]: { [hash: string]: PartitionObject } }
  /** temporary store for TXs that we put in a partition object after a cycle is complete. an array that holds any TXs (i.e. from different cycles), code will filter out what it needs @see TempTxRecord */
  tempTXRecords: TempTxRecord[]
  /** TxTallyList data indexed by cycle key and partition key. @see TxTallyList */
  txByCycleByPartition: { [cycleKey: string]: { [partitionKey: string]: TxTallyList } }
  /** Stores the partition responses that other nodes push to us.  Index by cycle key, then index by partition id */
  allPartitionResponsesByCycleByPartition: { [cycleKey: string]: { [partitionKey: string]: PartitionResult[] } }

  resetAndApplyPerPartition:boolean

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

    this.nextCycleReportToSend = null
    this.syncPartitionsStarted = false

    this.lastCycleReported = -1
    
    this.partitionReportDirty = false


    this.partitionObjectsByCycle = {}
    this.ourPartitionResultsByCycle = {}
    this.recentPartitionObjectsByCycleByHash = {}
    this.tempTXRecords = []
    this.txByCycleByPartition = {}
    this.allPartitionResponsesByCycleByPartition = {}



    // the original way this was setup was to reset and apply repair results one partition at a time.
    // this could create issue if we have a TX spanning multiple paritions that are locally owned.
    this.resetAndApplyPerPartition = false
  }



  //  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //  //////////////////////////////////////////////////          Data Repair                    ///////////////////////////////////////////////////////////
  //  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


  setupHandlers(){
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
  
            // if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results`)
  
            if (!payload) {
              if (this.verboseLogs) this.mainLogger.error( ` _repair post_partition_results: abort no payload`)
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
              if (this.verboseLogs) this.mainLogger.error( ` _repair post_partition_results: abort, partitionResults == null`)
              return
            }
  
            if (payload.partitionResults.length === 0) {
              if (this.verboseLogs) this.mainLogger.error( ` _repair post_partition_results: abort, partitionResults.length == 0`)
              return
            }
  
            if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair post_partition_results payload: ${utils.stringifyReduce(payload)}`)
  
            if (!payload.partitionResults[0].sign) {
              // TODO security need to check that this is signed by a valid and correct node
              if (this.verboseLogs) this.mainLogger.error( ` _repair post_partition_results: abort, no sign object on partition`)
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
                if (this.verboseLogs) this.mainLogger.error( ` _repair post_partition_results partitionResult missing`)
              }
              if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair post_partition_results partition: ${partitionResult.Partition_id} responses.length ${responses.length}  cycle:${payload.Cycle_number}`)
            }
  
            var partitionKeys = Object.keys(allResponsesByPartition)
            if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results partitionKeys: ${partitionKeys.length}`)
  
            // Loop through all the partition keys and check our progress for each partition covered
            // todo perf consider only looping through keys of partitions that changed from this update?
            for (let partitionKey of partitionKeys) {
              let responses = allResponsesByPartition[partitionKey]
              // if enough data, and our response is prepped.
              let repairTracker
              let partitionId = null // todo sharding ? need to deal with more that one partition response here!!
              if (responses.length > 0) {
                partitionId = responses[0].Partition_id
                repairTracker = this.stateManager.depricated._getRepairTrackerForCycle(payload.Cycle_number, partitionId)
                if (repairTracker.busy && repairTracker.awaitWinningHash === false) {
                  if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results tracker busy. ${partitionKey} responses: ${responses.length}.  ${utils.stringifyReduce(repairTracker)}`)
                  continue
                }
                if (repairTracker.repairsFullyComplete) {
                  if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results repairsFullyComplete = true  cycle:${payload.Cycle_number}`)
                  continue
                }
              } else {
                if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results no responses. ${partitionKey} responses: ${responses.length}. repairTracker: ${utils.stringifyReduce(repairTracker)} responsesById: ${utils.stringifyReduce(allResponsesByPartition)}`)
                continue
              }
  
              let responsesRequired = 3
              if (this.stateManager.useHashSets) {
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
                  if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results our result is not computed yet `)
                  // Todo repair : may need to sleep or restart this computation later..
                  return
                }
  
                let receiptResults = this.tryGeneratePartitionReciept(responses, ourResult) // TODO: how to mark block if we are already on a thread for this?
                let { partitionReceipt, topResult, success } = receiptResults
                if (!success) {
                  if (repairTracker.awaitWinningHash) {
                    if (topResult == null) {
                      // if we are awaitWinningHash then wait for a top result before we start repair process again
                      if (this.verboseLogs) this.mainLogger.debug( ` _repair awaitWinningHash:true but topResult == null so keep waiting `)
                      continue
                    } else {
                      if (this.verboseLogs) this.mainLogger.debug( ` _repair awaitWinningHash:true and we have a top result so start reparing! `)
                    }
                  }
  
                  if (this.resetAndApplyPerPartition === false && repairTracker.txRepairReady === true) {
                    if (this.verboseLogs) this.mainLogger.debug( ` _repair txRepairReady:true bail here for some strange reason.. not sure aout this yet `)
                    continue
                  }
  
                  if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results: tryGeneratePartitionReciept failed start repair process 1 ${utils.stringifyReduce(receiptResults)}`)
                  let cycle = this.p2p.state.getCycleByCounter(payload.Cycle_number)
                  await this.startRepairProcess(cycle, topResult, partitionId, ourResult.Partition_hash)
                } else if (partitionReceipt) {
                  // if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results: success store partition receipt`)
                  if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results 3 allFinished, final cycle: ${payload.Cycle_number} hash:${utils.stringifyReduce({ topResult })}`)
                  // do we ever send partition receipt yet?
                  this.stateManager.storePartitionReceipt(payload.Cycle_number, partitionReceipt)
                  this.stateManager.depricated.repairTrackerMarkFinished(repairTracker, 'post_partition_results')
                }
              } else {
                if (this.verboseLogs) this.mainLogger.debug( ` _repair post_partition_results not enough responses awaitWinningHash: ${repairTracker.awaitWinningHash} resp: ${responses.length}. required:${responsesRequired} repairTracker: ${utils.stringifyReduce(repairTracker)}`)
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


  }




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

        this.mainLogger.debug('getPartitionReport: ' + `insync: ${this.stateManager.stateIsGood} ` + utils.stringifyReduce(response))
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
    let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(lastCycle.counter)

    // let partitions = ShardFunctions.getConsenusPartitions(lastCycleShardValues.shardGlobals, lastCycleShardValues.nodeShardData)
    // lastCycleShardValues.ourConsensusPartitions = partitions

    if (lastCycleShardValues == null) {
      throw new Error('generatePartitionObjects lastCycleShardValues == null' + lastCycle.counter)
    }

    let partitions = lastCycleShardValues.ourConsensusPartitions
    if (this.stateManager.useStoredPartitionsForReport === true) {
      partitions = lastCycleShardValues.ourStoredPartitions
    }
    if (partitions == null) {
      throw new Error('generatePartitionObjects partitions == null')
    }

    if (this.stateManager.feature_useNewParitionReport === false) {
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

      if (this.stateManager.feature_useNewParitionReport === false) {
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
    if (this.stateManager.useHashSets) {
      let hashSet = Depricated.createHashSetString(partitionObject.Txids, partitionObject.States) // TXSTATE_TODO
      partitionResult.hashSet = hashSet
    }

    if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair partitionObject: ${utils.stringifyReduce(partitionObject)}`)
    if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair generatePartitionResult: ${utils.stringifyReduce(partitionResult)}`)

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

    let repairTracker = this.stateManager.depricated._getRepairTrackerForCycle(cycleCounter, partitionId)
    repairTracker.busy = true // mark busy so we won't try to start this task again while in the middle of it

    // Tried hashes is not working correctly at the moment, it is an unused parameter. I am not even sure we want to ignore hashes
    let { topHash, topCount, topResult } = this.stateManager.depricated.findMostCommonResponse(cycleCounter, partitionId, repairTracker.triedHashes)

    if (this.verboseLogs) this.mainLogger.debug( ` _repair  ${debugKey} tryGeneratePartitoinReciept repairTracker: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)

    let requiredHalf = Math.max(1, allResults.length / 2)
    if (this.stateManager.useHashSets && repairPassHack) {
      // hack force our node to win:
      topCount = requiredHalf
      topHash = ourResult.Partition_hash
      if (this.verboseLogs) this.mainLogger.debug( ` _repair  ${debugKey} tryGeneratePartitoinReciept hack force win: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)
    }

    let resultsList = []
    if (topCount >= requiredHalf) {
      if (this.verboseLogs) this.mainLogger.debug( ` _repair  ${debugKey} tryGeneratePartitoinReciept: top hash wins: ` + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
      for (let partitionResult of allResults) {
        if (partitionResult.Partition_hash === topHash) {
          resultsList.push(partitionResult)
        }
      }
    } else {
      if (this.stateManager.useHashSets) {
        // bail in a way that will cause us to use the hashset strings
        if (this.verboseLogs) this.mainLogger.debug( ` _repair  ${debugKey} tryGeneratePartitoinReciept: did not win, useHashSets: ` + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
        return { partitionReceipt: null, topResult: null, success: false }
      }
      if (this.verboseLogs) this.mainLogger.debug( ` _repair  ${debugKey} tryGeneratePartitoinReciept: top hash failed: ` + utils.makeShortHash(topHash) + ` ${topCount} / ${requiredHalf}`)
      return { partitionReceipt: null, topResult, success: false }
    }

    if (ourResult.Partition_hash !== topHash) {
      if (this.verboseLogs) this.mainLogger.debug( ` _repair  ${debugKey} tryGeneratePartitoinReciept: our hash does not match: ` + utils.makeShortHash(topHash) + ` our hash: ${ourResult.Partition_hash}`)
      return { partitionReceipt: null, topResult, success: false }
    }

    let partitionReceipt = {
      resultsList,
    }

    if (this.verboseLogs) this.mainLogger.debug( ` _repair  ${debugKey} tryGeneratePartitoinReciept OK! ${utils.stringifyReduce({ partitionReceipt, topResult })}`)

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
    this.stateManager.stateIsGood_txHashsetOld = false
    if (this.stateManager.canDataRepair === false) {
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
    let repairTracker = this.stateManager.depricated._getRepairTrackerForCycle(cycleNumber, partitionId)

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
    if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair checkForGoodPartitionReciept immediate receipt check. ${debugKey} success:${success3} topResult:${utils.stringifyReduce(topResult3)}  partitionReceipt: ${utils.stringifyReduce({ partitionReceipt3 })}`)

    // see if we already have a winning hash to correct to
    if (!success3) {
      if (repairTracker.awaitWinningHash) {
        if (topResult3 == null) {
          // if we are awaitWinningHash then wait for a top result before we start repair process again
          if (this.verboseLogs) this.mainLogger.debug( ` _repair checkForGoodPartitionReciept awaitWinningHash:true but topResult == null so keep waiting ${debugKey}`)
        } else {
          if (this.verboseLogs) this.mainLogger.debug( ` _repair checkForGoodPartitionReciept awaitWinningHash:true and we have a top result so start reparing! ${debugKey}`)
          if (this.verboseLogs) this.mainLogger.debug( ` _repair checkForGoodPartitionReciept: tryGeneratePartitionReciept failed start repair process 3 ${debugKey} ${utils.stringifyReduce(receiptResults)}`)
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
      this.stateManager.storePartitionReceipt(cycleNumber, partitionReceipt3)
      this.stateManager.depricated.repairTrackerMarkFinished(repairTracker, 'checkForGoodPartitionReciept')
      if (this.verboseLogs) this.mainLogger.debug( ` _repair checkForGoodPartitionReciept 2 allFinished, final ${debugKey} hash:${utils.stringifyReduce({ topResult3 })}`)
    }
  }

  initApoptosisAndQuitSyncing() {
    console.log('initApoptosisAndQuitSyncing ' + utils.getTime('s'))
    this.mainLogger.error( `initApoptosisAndQuitSyncing `)
    this.stateManager.stateManagerSync.failAndDontRestartSync()
    this.p2p.initApoptosis()
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
    cycleEnd -= this.stateManager.syncSettleTime // adjust by sync settle time

    // sort our records before recording them!
    this.tempTXRecords.sort(this.sortTXRecords)

    //savedSomething

    for (let txRecord of this.tempTXRecords) {
      if (txRecord.redacted > 0) {
        if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair recordTXByCycle: ${utils.makeShortHash(txRecord.acceptedTx.id)} cycle: ${cycle.counter} redacted!!! ${txRecord.redacted}`)
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

    let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(cycle.counter)

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

    if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair processTempTXs txsRecorded: ${txsRecorded} txsTemp: ${txsTemp} `)
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
    const cycle = this.p2p.state.getCycleByTimestamp(txTS + this.stateManager.syncSettleTime)

    if (cycle == null) {
      this.mainLogger.error(`recordTXByCycle Failed to find cycle that would contain this timestamp txid:${utils.stringifyReduce(acceptedTx.id)} txts1: ${acceptedTx.timestamp} txts: ${txTS}`)
      return
    }

    let cycleNumber = cycle.counter

    // for each covered partition..

    let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(cycle.counter)

    let keysResponse = this.app.getKeyFromTransaction(acceptedTx.data)
    let { allKeys } = keysResponse

    let seenParitions: StringBoolObjectMap = {}
    let partitionHasNonGlobal: StringBoolObjectMap = {}
    // for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
    if (lastCycleShardValues == null) {
      throw new Error(`recordTXByCycle lastCycleShardValues == null`)
    }

    if (isGlobalModifyingTX) {
      if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `recordTXByCycle:  ignore loggging globalTX ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)
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

        if (this.stateManager.accountGlobals.isGlobalAccount(accountKey)) {
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
      if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `recordTXByCycle: nothing to save globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)
      return
    }
    if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `recordTXByCycle: globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal}  tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)

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

      if (this.stateManager.accountGlobals.isGlobalAccount(accountKey)) {
        if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `recordTXByCycle:  skip partition. dont save due to global: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)
        continue
      }

      let weStoreThisParition = ShardFunctions.testInRange(partitionID, lastCycleShardValues.nodeShardData.storedPartitions)
      if (weStoreThisParition === false) {
        if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `recordTXByCycle:  skip partition we dont save: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)

        continue
      }

      if (partitionHasNonGlobal[key] === false) {
        if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `recordTXByCycle:  skip partition. we store it but only a global ref involved this time: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber}`)

        continue
      }
      //check if we are only storing this because it is a global account...

      let txList = this.getTXList(cycleNumber, partitionID) // todo sharding - done: pass partition ID

      if (txList.processed) {
        continue
        //this.mainLogger.error(`_repair trying to record transaction after we have already finalized our parition object for cycle ${cycle.counter} `)
      }

      if (seenParitions[key] != null) {
        if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `recordTXByCycle: seenParitions[key] != null P: ${partitionID}  homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber} entries: ${txList.hashes.length} --TX already recorded for cycle`)
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
          //   if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair recordTXByCycle:  how is this possible: ${utils.makeShortHash(accountData.accountId)} acc hash: ${utils.makeShortHash(accountData.hash)} acc stateID: ${utils.makeShortHash(accountData.stateId)}`)

          // }
          // if(accountData.stateId == null){
          //   // @ts-ignore
          //   throw new Error(`missing state id for ${utils.makeShortHash(accountData.accountId)} acc hash: ${utils.makeShortHash(accountData.hash)} acc stateID: ${utils.makeShortHash(accountData.stateId)} `)
          // }

          // account data got upgraded earlier to have hash on it

          //if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `recordTXByCycle: Pushed! P: ${partitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber} entries: ${txList.hashes.length} --TX already recorded for cycle`)

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
      if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair recordTXByCycle: pushedData P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${utils.makeShortHash(acceptedTx.id)} cycle: ${cycleNumber} entries: ${txList.hashes.length} recordedState: ${recordedState}`)
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
    if (this.stateManager.feature_useNewParitionReport === false) {
      return
    }

    let partitions = cycleShardData.ourConsensusPartitions
    if (this.stateManager.useStoredPartitionsForReport === true) {
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

    this.stateManager._registerListener(this.p2p.state, 'cycle_q2_start', async (lastCycle: Shardus.Cycle, time: number) => {
      // await this.processPreviousCycleSummaries()
      // lastCycle = this.p2p.state.getLastCycle()
      // if (lastCycle == null) {
      //   return
      // }
      // let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(lastCycle.counter)
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
      // if (this.verboseLogs) this.mainLogger.debug( ` _repair startSyncPartitions:cycle_q2_start cycle: ${lastCycle.counter}`)
      // // this will take temp TXs and make sure they are stored in the correct place for us to generate partitions
      // this.processTempTXs(lastCycle)
      // // During the Q2 phase of a cycle, nodes compute the partition hash of the previous cycle for all the partitions covered by the node.
      // // Q2 was chosen so that any transactions submitted with a time stamp that falls in the previous quarter will have been processed and finalized. This could be changed to Q3 if we find that more time is needed.
      // this.generatePartitionObjects(lastCycle)
      // let receiptMapResults = this.generateReceiptMapResults(lastCycle)
      // if(this.verboseLogs) this.mainLogger.debug( `receiptMapResults: ${stringify(receiptMapResults)}`)
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
    if (this.verboseLogs) this.mainLogger.debug( ` _repair broadcastPartitionResults for cycle: ${cycleNumber}`)
    // per partition need to figure out which node cover it.
    // then get a list of all the results we need to send to a given node and send them at once.
    // need a way to do this in semi parallel?
    let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(cycleNumber)
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

      let repairTracker = this.stateManager.depricated._getRepairTrackerForCycle(cycleNumber, partitionResult.Partition_id)
      repairTracker.numNodes = coverCount - 1 // todo sharding re-evaluate this and thing of a better perf solution
    }

    let promises = []
    for (let nodeId of nodesToTell) {
      if (nodeId === lastCycleShardValues.ourNode.id) {
        continue
      }
      let partitionResultsToSend = partitionResultsByNodeID.get(nodeId)
      let payload = { Cycle_number: cycleNumber, partitionResults: partitionResultsToSend.results }
      if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair broadcastPartitionResults to ${nodeId} debugStr: ${partitionResultsToSend.debugStr} res: ${utils.stringifyReduce(payload)}`)
      if (this.verboseLogs && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair broadcastPartitionResults to ${nodeId} debugStr: ${partitionResultsToSend.debugStr} res: ${utils.stringifyReduce(payload)}`)

      let shorthash = utils.makeShortHash(partitionResultsToSend.node.id)
      let toNodeStr = shorthash + ':' + partitionResultsToSend.node.externalPort
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('broadcastPartitionResults', `${cycleNumber}`, `to ${toNodeStr} ${partitionResultsToSend.debugStr} `)

      // Filter nodes before we send tell()
      let filteredNodes = this.stateManager.filterValidNodesForInternalMessage([partitionResultsToSend.node], 'tellCorrespondingNodes', true, true)
      if (filteredNodes.length === 0) {
        this.mainLogger.error('broadcastPartitionResults: filterValidNodesForInternalMessage skipping node')
        continue //only doing one node at a time in this loop so just skip to next node.
      }

      let promise = this.p2p.tell([partitionResultsToSend.node], 'post_partition_results', payload)
      promises.push(promise)
    }

    await Promise.all(promises)
  }


}

export default PartitionObjects
