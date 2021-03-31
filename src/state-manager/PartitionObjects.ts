import { ShardusConfiguration } from '../shardus/shardus-types'
import Shardus = require('../shardus/shardus-types')
import { ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, HomeNodeSummary, ParititionShardDataMap, NodeShardDataMap, MergeResults, BasicAddressRange } from './shardFunctionTypes'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, {logFlags} from '../logger'
import ShardFunctions from './shardFunctions.js'
import { time } from 'console'
import StateManager from '.'
import Depricated from './Depricated'

class PartitionObjects {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler
  
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
  partitionReportDirty: boolean

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

  resetAndApplyPerPartition: boolean

  constructor(stateManager: StateManager,  profiler: Profiler, app: Shardus.App, logger: Logger, storage: Storage, p2p: P2P, crypto: Crypto, config: Shardus.ShardusConfiguration) {
    
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

        if (logFlags.debug) this.mainLogger.debug('getPartitionReport: ' + `insync: ${this.stateManager.stateIsGood} ` + utils.stringifyReduce(response))
      }
    }
    return response
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

  /**
   * @param {PartitionObject} partitionObject
   */
  poMicroDebug(partitionObject: PartitionObject) {
    let header = `c${partitionObject.Cycle_number} p${partitionObject.Partition_id}`

    // need to get a list of compacted TXs in order. also addresses. timestamps?  make it so tools can process easily. (align timestamps view.)

    if (logFlags.debug) this.mainLogger.debug('poMicroDebug: ' + header)
  }

  /***
   *    ######## ##    ## ########        ########   #######  #### ##    ## ########  ######
   *    ##       ###   ## ##     ##       ##     ## ##     ##  ##  ###   ##    ##    ##    ##
   *    ##       ####  ## ##     ##       ##     ## ##     ##  ##  ####  ##    ##    ##
   *    ######   ## ## ## ##     ##       ########  ##     ##  ##  ## ## ##    ##     ######
   *    ##       ##  #### ##     ##       ##        ##     ##  ##  ##  ####    ##          ##
   *    ##       ##   ### ##     ##       ##        ##     ##  ##  ##   ###    ##    ##    ##
   *    ######## ##    ## ########        ##         #######  #### ##    ##    ##     ######
   */

  setupHandlers() {
    // /post_partition_results (Partition_results)
    //   Partition_results - array of objects with the fields {Partition_id, Cycle_number, Partition_hash, Node_id, Node_sign}
    //   Returns nothing
    // this.p2p.registerInternal(
    //   'post_partition_results',
    //   /**
    //    * This is how to typedef a callback!
    //    * @param {{ partitionResults: PartitionResult[]; Cycle_number: number; }} payload
    //    * @param {any} respond TSConversion is it ok to just set respond to any?
    //    */
    //   async (payload: PosPartitionResults, respond: any) => {
    //     // let result = {}
    //     // let ourLockID = -1
    //     try {
    //       // ourLockID = await this.fifoLock('accountModification')
    //       // accountData = await this.app.getAccountDataByList(payload.accountIds)
    //       // Nodes collect the partition result from peers.
    //       // Nodes may receive partition results for partitions they are not covering and will ignore those messages.
    //       // Once a node has collected 50% or more peers giving the same partition result it can combine them to create a partition receipt. The node tries to create a partition receipt for all partitions it covers.
    //       // If the partition receipt has a different partition hash than the node, the node needs to ask one of the peers with the majority partition hash for the partition object and determine the transactions it has missed.
    //       // If the node is not able to create a partition receipt for a partition, the node needs to ask all peers which have a different partition hash for the partition object and determine the transactions it has missed. Only one peer for each different partition hash needs to be queried. Uses the /get_partition_txids API.
    //       // If the node has missed some transactions for a partition, the node needs to get these transactions from peers and apply these transactions to affected accounts starting with a known good copy of the account from the end of the last cycle. Uses the /get_transactions_by_list API.
    //       // If the node applied missed transactions to a partition, then it creates a new partition object, partition hash and partition result.
    //       // After generating new partition results as needed, the node broadcasts the set of partition results to N adjacent peers on each side; where N is the number of  partitions covered by the node.
    //       // After receiving new partition results from peers, the node should be able to collect 50% or more peers giving the same partition result and build a partition receipt.
    //       // Any partition for which the node could not generate a partition receipt, should be logged as a fatal error.
    //       // Nodes save the partition receipt as proof that the transactions they have applied are correct and were also applied by peers.
    //       // if (logFlags.verbose) this.mainLogger.debug( ` _repair post_partition_results`)
    //       if (!payload) {
    //         if (logFlags.verbose) this.mainLogger.error(` _repair post_partition_results: abort no payload`)
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
    //       if (!payload.partitionResults) {
    //         if (logFlags.verbose) this.mainLogger.error(` _repair post_partition_results: abort, partitionResults == null`)
    //         return
    //       }
    //       if (payload.partitionResults.length === 0) {
    //         if (logFlags.verbose) this.mainLogger.error(` _repair post_partition_results: abort, partitionResults.length == 0`)
    //         return
    //       }
    //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair post_partition_results payload: ${utils.stringifyReduce(payload)}`)
    //       if (!payload.partitionResults[0].sign) {
    //         // TODO security need to check that this is signed by a valid and correct node
    //         if (logFlags.verbose) this.mainLogger.error(` _repair post_partition_results: abort, no sign object on partition`)
    //         return
    //       }
    //       let owner = payload.partitionResults[0].sign.owner
    //       // merge results from this message into our colleciton of allResponses
    //       for (let partitionResult of partitionResults) {
    //         let partitionKey1 = 'p' + partitionResult.Partition_id
    //         let responses = allResponsesByPartition[partitionKey1]
    //         if (!responses) {
    //           responses = []
    //           allResponsesByPartition[partitionKey1] = responses
    //         }
    //         // clean out an older response from same node if on exists
    //         responses = responses.filter((item) => item.sign == null || item.sign.owner !== owner)
    //         allResponsesByPartition[partitionKey1] = responses // have to re-assign this since it is a new ref to the array
    //         // add the result ot the list of responses
    //         if (partitionResult) {
    //           responses.push(partitionResult)
    //         } else {
    //           if (logFlags.verbose) this.mainLogger.error(` _repair post_partition_results partitionResult missing`)
    //         }
    //         if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair post_partition_results partition: ${partitionResult.Partition_id} responses.length ${responses.length}  cycle:${payload.Cycle_number}`)
    //       }
    //       var partitionKeys = Object.keys(allResponsesByPartition)
    //       if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results partitionKeys: ${partitionKeys.length}`)
    //       // Loop through all the partition keys and check our progress for each partition covered
    //       // todo perf consider only looping through keys of partitions that changed from this update?
    //       for (let partitionKey of partitionKeys) {
    //         let responses = allResponsesByPartition[partitionKey]
    //         // if enough data, and our response is prepped.
    //         let repairTracker
    //         let partitionId = null // todo sharding ? need to deal with more that one partition response here!!
    //         if (responses.length > 0) {
    //           partitionId = responses[0].Partition_id
    //           repairTracker = this.stateManager.depricated._getRepairTrackerForCycle(payload.Cycle_number, partitionId)
    //           if (repairTracker.busy && repairTracker.awaitWinningHash === false) {
    //             if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results tracker busy. ${partitionKey} responses: ${responses.length}.  ${utils.stringifyReduce(repairTracker)}`)
    //             continue
    //           }
    //           if (repairTracker.repairsFullyComplete) {
    //             if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results repairsFullyComplete = true  cycle:${payload.Cycle_number}`)
    //             continue
    //           }
    //         } else {
    //           if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results no responses. ${partitionKey} responses: ${responses.length}. repairTracker: ${utils.stringifyReduce(repairTracker)} responsesById: ${utils.stringifyReduce(allResponsesByPartition)}`)
    //           continue
    //         }
    //         let responsesRequired = 3
    //         if (this.stateManager.useHashSets) {
    //           responsesRequired = Math.min(1 + Math.ceil(repairTracker.numNodes * 0.9), repairTracker.numNodes - 1) // get responses from 90% of the node we have sent to
    //         }
    //         // are there enough responses to try generating a receipt?
    //         if (responses.length >= responsesRequired && (repairTracker.evaluationStarted === false || repairTracker.awaitWinningHash)) {
    //           repairTracker.evaluationStarted = true
    //           let ourResult = null
    //           if (ourPartitionResults != null) {
    //             for (let obj of ourPartitionResults) {
    //               if (obj.Partition_id === partitionId) {
    //                 ourResult = obj
    //                 break
    //               }
    //             }
    //           }
    //           if (ourResult == null) {
    //             if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results our result is not computed yet `)
    //             // Todo repair : may need to sleep or restart this computation later..
    //             return
    //           }
    //           let receiptResults = this.tryGeneratePartitionReciept(responses, ourResult) // TODO: how to mark block if we are already on a thread for this?
    //           let { partitionReceipt, topResult, success } = receiptResults
    //           if (!success) {
    //             if (repairTracker.awaitWinningHash) {
    //               if (topResult == null) {
    //                 // if we are awaitWinningHash then wait for a top result before we start repair process again
    //                 if (logFlags.verbose) this.mainLogger.debug(` _repair awaitWinningHash:true but topResult == null so keep waiting `)
    //                 continue
    //               } else {
    //                 if (logFlags.verbose) this.mainLogger.debug(` _repair awaitWinningHash:true and we have a top result so start reparing! `)
    //               }
    //             }
    //             if (this.resetAndApplyPerPartition === false && repairTracker.txRepairReady === true) {
    //               if (logFlags.verbose) this.mainLogger.debug(` _repair txRepairReady:true bail here for some strange reason.. not sure aout this yet `)
    //               continue
    //             }
    //             if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results: tryGeneratePartitionReciept failed start repair process 1 ${utils.stringifyReduce(receiptResults)}`)
    //             let cycle = this.p2p.state.getCycleByCounter(payload.Cycle_number)
    //             await this.startRepairProcess(cycle, topResult, partitionId, ourResult.Partition_hash)
    //           } else if (partitionReceipt) {
    //             // if (logFlags.verbose) this.mainLogger.debug( ` _repair post_partition_results: success store partition receipt`)
    //             if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results 3 allFinished, final cycle: ${payload.Cycle_number} hash:${utils.stringifyReduce({ topResult })}`)
    //             // do we ever send partition receipt yet?
    //             this.stateManager.storePartitionReceipt(payload.Cycle_number, partitionReceipt)
    //             this.stateManager.depricated.repairTrackerMarkFinished(repairTracker, 'post_partition_results')
    //           }
    //         } else {
    //           if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results not enough responses awaitWinningHash: ${repairTracker.awaitWinningHash} resp: ${responses.length}. required:${responsesRequired} repairTracker: ${utils.stringifyReduce(repairTracker)}`)
    //         }
    //         // End of loop over partitions.  Continue looping if there are other partions that we need to check for completion.
    //       }
    //     } finally {
    //       // this.fifoUnlock('accountModification', ourLockID)
    //     }
    //     // result.accountData = accountData
    //     // await respond(result)
    //   }
    // )
  }

  /**
   * all this does now is set syncPartitionsStarted = true.   should be depricated
   */
  async startSyncPartitions() {
    // await this.createInitialAccountBackups() // nm this is now part of regular data sync
    // register our handlers

    // this._registerListener(this.p2p.state, 'cycle_q1_start', async (lastCycle, time) => {
    //   this.updateShardValues(lastCycle.counter)
    // })

    this.syncPartitionsStarted = true

    // this.stateManager._registerListener(this.p2p.state, 'cycle_q2_start', async (lastCycle: Shardus.Cycle, time: number) => {
    //   // await this.processPreviousCycleSummaries()
    //   // lastCycle = this.p2p.state.getLastCycle()
    //   // if (lastCycle == null) {
    //   //   return
    //   // }
    //   // let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(lastCycle.counter)
    //   // if (lastCycleShardValues == null) {
    //   //   return
    //   // }
    //   // if(this.currentCycleShardData == null){
    //   //   return
    //   // }
    //   // if (this.currentCycleShardData.ourNode.status !== 'active') {
    //   //   // dont participate just yet.
    //   //   return
    //   // }
    //   // if (logFlags.verbose) this.mainLogger.debug( ` _repair startSyncPartitions:cycle_q2_start cycle: ${lastCycle.counter}`)
    //   // // this will take temp TXs and make sure they are stored in the correct place for us to generate partitions
    //   // this.processTempTXs(lastCycle)
    //   // // During the Q2 phase of a cycle, nodes compute the partition hash of the previous cycle for all the partitions covered by the node.
    //   // // Q2 was chosen so that any transactions submitted with a time stamp that falls in the previous quarter will have been processed and finalized. This could be changed to Q3 if we find that more time is needed.
    //   // this.generatePartitionObjects(lastCycle)
    //   // let receiptMapResults = this.generateReceiptMapResults(lastCycle)
    //   // if(logFlags.verbose) this.mainLogger.debug( `receiptMapResults: ${stringify(receiptMapResults)}`)
    //   // let statsClump = this.partitionStats.getCoveredStatsPartitions(lastCycleShardValues)
    //   // //build partition hashes from previous full cycle
    //   // let mainHashResults:MainHashResults = null
    //   // if(this.currentCycleShardData && this.currentCycleShardData.ourNode.status === 'active'){
    //   //   mainHashResults = this.accountCache.buildPartitionHashesForNode(this.currentCycleShardData)
    //   // }
    //   // // Hook for Snapshot module to listen to after partition data is settled
    //   // this.emit('cycleTxsFinalized', lastCycleShardValues, receiptMapResults, statsClump, mainHashResults)
    //   // this.dumpAccountDebugData2(mainHashResults)
    //   // // pre-allocate the next cycle data to be safe!
    //   // let prekey = 'c' + (lastCycle.counter + 1)
    //   // this.partitionObjectsByCycle[prekey] = []
    //   // this.ourPartitionResultsByCycle[prekey] = []
    //   // // Nodes generate the partition result for all partitions they cover.
    //   // // Nodes broadcast the set of partition results to N adjacent peers on each side; where N is
    //   // // the number of partitions covered by the node. Uses the /post_partition_results API.
    //   // await this.broadcastPartitionResults(lastCycle.counter) // Cycle_number
    // })

    /* this._registerListener(this.p2p.state, 'cycle_q4_start', async (lastCycle, time) => {
    // Also we would like the repair process to finish by the end of Q3 and definitely before the start of a new cycle. Otherwise the cycle duration may need to be increased.
  }) */
  }
}

export default PartitionObjects
