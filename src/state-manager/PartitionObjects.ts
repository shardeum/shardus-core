import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from 'shardus-types'
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
import { PartitionCycleReport, PartitionObject, PartitionResult, TempTxRecord, TxTallyList, CycleShardData, MainHashResults } from './state-manager-types'

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
  getPartitionReport(consensusOnly: boolean, smallHashes: boolean): PartitionCycleReport {
    let response: PartitionCycleReport = {} // {res:[], cycleNumber:-1}
    if (this.nextCycleReportToSend != null) {

      let shardValues = this.stateManager.shardValuesByCycle.get(this.nextCycleReportToSend.cycleNumber)
      let shardGlobals = shardValues.shardGlobals as StateManagerTypes.shardFunctionTypes.ShardGlobals
      let consensusStartPartition = shardValues.nodeShardData.consensusStartPartition
      let consensusEndPartition = shardValues.nodeShardData.consensusEndPartition
      

      response = {res:[], cycleNumber:this.nextCycleReportToSend.cycleNumber}
      if (this.lastCycleReported < this.nextCycleReportToSend.cycleNumber || this.partitionReportDirty === true) {
        // consensusOnly hashes
        if (smallHashes === true) {
          for (let r of this.nextCycleReportToSend.res) {
            r.h = utils.makeShortHash(r.h)
          }
        }
        for (let r of this.nextCycleReportToSend.res) {
          if(consensusOnly){
            //check if partition is in our range!
            if(ShardFunctions.partitionInWrappingRange(r.i, consensusStartPartition, consensusEndPartition)){
              response.res.push(r)
            }
          } else{
            response.res.push(r)
          }
        }
        // Partition_hash: partitionHash, Partition_id:
        //response = this.nextCycleReportToSend
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

  }


}

export default PartitionObjects
