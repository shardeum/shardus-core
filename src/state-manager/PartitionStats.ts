import * as Shardus from '../shardus/shardus-types'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, {logFlags} from '../logger'
import ShardFunctions from './shardFunctions.js'
import AccountCache from './AccountCache'
import StateManager from '.'
import { AccountHashCache, QueueEntry, CycleShardData } from './state-manager-types'
import { StateManager as StateManagerTypes } from 'shardus-types'
import * as Context from '../p2p/Context'
import * as Wrapper from '../p2p/Wrapper'

class PartitionStats {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler
  
  logger: Logger

  stateManager: StateManager

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any

  summaryBlobByPartition: Map<number, StateManagerTypes.StateManagerTypes.SummaryBlob>
  summaryPartitionCount: number
  txSummaryBlobCollections: StateManagerTypes.StateManagerTypes.SummaryBlobCollection[]
  extensiveRangeChecking: boolean // non required range checks that can show additional errors (should not impact flow control)

  // add cycle then , never delete one from previous cycle.
  //     quick lookup
  //
  // seenCreatedAccounts: Map<string, AccountMemoryCache> // Extra level of safety at the cost of memory to prevent double init.  starting point to have in memory hash of accounts
  // useSeenAccountMap: boolean

  accountCache: AccountCache

  invasiveDebugInfo: boolean //inject some data into opaque blobs to improve our debugging (Never use in production)

  statemanager_fatal: (key: string, log: string) => void

  constructor(stateManager: StateManager, profiler: Profiler, app: Shardus.App, logger: Logger, crypto: Crypto, config: Shardus.ShardusConfiguration, accountCache: AccountCache) {
    
    if(stateManager == null)
      return //for debug testing.

    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal
    this.stateManager = stateManager

    //Init Summary Blobs
    this.summaryPartitionCount = 32

    this.extensiveRangeChecking = true

    this.summaryBlobByPartition = new Map()
    this.txSummaryBlobCollections = []

    // this.useSeenAccountMap = true
    // this.seenCreatedAccounts = new Map()

    this.accountCache = accountCache

    this.invasiveDebugInfo = false

    this.initSummaryBlobs()
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

setupHandlers() {
      /**
     * 
     * 
     * Usage: http://<NODE_IP>:<NODE_EXT_PORT>/get-stats-dum?cycle=x
     */
  Context.network.registerExternalGet('get-stats-dump', (req, res) => {

    let cycle = this.stateManager.currentCycleShardData.cycleNumber - 2

    if(req.query.cycle != null){
      cycle = Number(req.query.cycle)
    }
    
    let cycleShardValues = null
    if (this.stateManager.shardValuesByCycle.has(cycle)) {
      cycleShardValues = this.stateManager.shardValuesByCycle.get(cycle)
    }

    let blob = this.dumpLogsForCycle(cycle, false, cycleShardValues)
    
    res.write(stringify(blob) + '\n')
    res.end()
  })

      /**
     * 
     * 
     * Usage: http://<NODE_IP>:<NODE_EXT_PORT>/get-stats-report-all?raw=<true/fale>
     */
  Context.network.registerExternalGet('get-stats-report-all', async (req, res) => {
    try {

      let raw = req.query.raw

      let cycleNumber = this.stateManager.currentCycleShardData.cycleNumber - 2
      //wow, why does Context.p2p not work..
      res.write(`building shard report c:${cycleNumber} \n`)
      let activeNodes = Wrapper.p2p.state.getNodes()
      let lines = []
      if (activeNodes) {
        for (let node of activeNodes.values()) {
          let getResp = await this.logger._internalHackGetWithResp(`${node.externalIp}:${node.externalPort}/get-stats-dump?cycle=${cycleNumber}`)
          if(getResp.body != null && getResp.body != ''){
            lines.push({raw: getResp.body, file:{owner: `${node.externalIp}:${node.externalPort}`}})
          }
        }
        //raw dump or compute?
        if(raw === 'true'){
          res.write(JSON.stringify(lines))
        } else {
          {
            let { allPassed, allPassedMetric2, singleVotePartitions, multiVotePartitions, badPartitions, totalTx } = this.processTxStatsDump(res, this.txStatsTallyFunction, lines)
            res.write(`TX statsReport${cycleNumber}  : ${allPassed} pass2: ${allPassedMetric2}  single:${singleVotePartitions} multi:${multiVotePartitions} badPartitions:${badPartitions}\n`)
          }
          {
            let { allPassed, allPassedMetric2, singleVotePartitions, multiVotePartitions, badPartitions } = this.processDataStatsDump(res, this.dataStatsTallyFunction, lines)
            res.write(`DATA statsReport${cycleNumber}  : ${allPassed} pass2: ${allPassedMetric2}  single:${singleVotePartitions} multi:${multiVotePartitions} badPartitions:${badPartitions}\n`)
          }
        }
      }
      //res.write(`this node in sync:${this.failedLastTrieSync} \n`)
    } catch (e) {
      res.write(`${e}\n`)
    }
    res.end()
  })
}




  getNewSummaryBlob(partition: number): StateManagerTypes.StateManagerTypes.SummaryBlob {
    return { counter: 0, latestCycle: 0, errorNull: 0, partition, opaqueBlob: {} }
  }

  initSummaryBlobs() {
    for (let i = 0; i < this.summaryPartitionCount; i++) {
      this.summaryBlobByPartition.set(i, this.getNewSummaryBlob(i))
    }
  }

  initTXSummaryBlobsForCycle(cycleNumber: number): StateManagerTypes.StateManagerTypes.SummaryBlobCollection {
    let summaryBlobCollection = { cycle: cycleNumber, blobsByPartition: new Map() }
    for (let i = 0; i < this.summaryPartitionCount; i++) {
      summaryBlobCollection.blobsByPartition.set(i, this.getNewSummaryBlob(i))
    }
    this.txSummaryBlobCollections.push(summaryBlobCollection)
    return summaryBlobCollection
  }

  getOrCreateTXSummaryBlobCollectionByCycle(cycle: number): StateManagerTypes.StateManagerTypes.SummaryBlobCollection {
    let summaryBlobCollectionToUse = null
    if (cycle < 0) {
      return null
    }
    for (let i = this.txSummaryBlobCollections.length - 1; i >= 0; i--) {
      let summaryBlobCollection = this.txSummaryBlobCollections[i]
      if (summaryBlobCollection.cycle === cycle) {
        summaryBlobCollectionToUse = summaryBlobCollection
        break;
      }
    }
    if (summaryBlobCollectionToUse === null) {
      summaryBlobCollectionToUse = this.initTXSummaryBlobsForCycle(cycle)
      // this.txSummaryBlobCollections.push(summaryBlobCollectionToUse)
    }
    return summaryBlobCollectionToUse
  }

  getSummaryBlobPartition(address: string): number {
    let addressNum = parseInt(address.slice(0, 8), 16)
    // 2^32  4294967296 or 0xFFFFFFFF + 1
    let size = Math.round((0xffffffff + 1) / this.summaryPartitionCount)
    //let preRound = addressNum / size
    let summaryPartition = Math.floor(addressNum / size)

    if (this.extensiveRangeChecking) {
      if (summaryPartition < 0) {
        if (logFlags.error) this.mainLogger.error(`getSummaryBlobPartition summaryPartition < 0 ${summaryPartition}`)
      }
      if (summaryPartition > this.summaryPartitionCount) {
        if (logFlags.error) this.mainLogger.error(`getSummaryBlobPartition summaryPartition > this.summaryPartitionCount ${summaryPartition}`)
      }
    }

    if (summaryPartition === this.summaryPartitionCount) {
      summaryPartition = summaryPartition - 1
    }
    return summaryPartition
  }

  getSummaryBlob(address: string): StateManagerTypes.StateManagerTypes.SummaryBlob {
    let partition = this.getSummaryBlobPartition(address)
    let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.summaryBlobByPartition.get(partition)
    return blob
  }

  statsDataSummaryInit(cycle: number, accountData: Shardus.WrappedData) {
    if(this.invasiveDebugInfo) this.mainLogger.debug(`statData enter:statsDataSummaryInit c:${cycle} accForBin:${utils.makeShortHash(accountData.accountId)}`)

    let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(accountData.accountId)
    blob.counter++

    // if(this.useSeenAccountMap === true && this.seenCreatedAccounts.has(accountData.accountId)){
    //     // if (logFlags.error) this.mainLogger.error(`statsDataSummaryInit seenCreatedAccounts dupe: ${utils.stringifyReduce(accountData.accountId)}`)
    //     return
    // }
    // if(this.useSeenAccountMap === true){
    //     let accountMemData:AccountMemoryCache = {t:accountData.timestamp, h:accountData.stateId}
    //     this.seenCreatedAccounts.set(accountData.accountId, accountMemData)
    // }
    
    if (this.accountCache.hasAccount(accountData.accountId)) {
      return
    }
    this.accountCache.updateAccountHash(accountData.accountId, accountData.stateId, accountData.timestamp, cycle)

    if (accountData.data == null) {
      blob.errorNull++
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryInit errorNull`)
      return
    }
    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }
    this.app.dataSummaryInit(blob.opaqueBlob, accountData.data)

    if(this.invasiveDebugInfo) this.mainLogger.debug(`statData:statsDataSummaryInit c:${cycle} accForBin:${utils.makeShortHash(accountData.accountId)}`)
    if(this.invasiveDebugInfo) this.addDebugToBlob(blob, accountData.accountId)
  }

  hasAccountBeenSeenByStats(accountId) {
    // if(this.useSeenAccountMap === false){
    //     if (logFlags.error) this.mainLogger.error(`hasAccountBeenSeenByStats disabled`)
    //     return false
    // }
    // return this.seenCreatedAccounts.has(accountId)

    return this.accountCache.hasAccount(accountId)
  }

  statsDataSummaryInitRaw(cycle: number, accountId: string, accountDataRaw: any) {
    if(this.invasiveDebugInfo) this.mainLogger.debug(`statData enter:statsDataSummaryInitRaw c:${cycle} accForBin:${utils.makeShortHash(accountId)}`)


    let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(accountId)
    blob.counter++

    // if(this.useSeenAccountMap === true && this.seenCreatedAccounts.has(accountId)){
    //     // if (logFlags.error) this.mainLogger.error(`statsDataSummaryInitRaw seenCreatedAccounts dupe: ${utils.stringifyReduce(accountId)}`)
    //     return
    // }
    // if(this.useSeenAccountMap === true){
    //     // let timestamp = this.app.getAccountTimestamp(accountId)
    //     // let hash = this.app.getStateId(accountId)

    //     let accountInfo = this.app.getTimestampAndHashFromAccount(accountDataRaw)

    //     //let accountMemData:AccountMemoryCache = {t:0, h:'uninit'}
    //     let accountMemData:AccountMemoryCache = {t:accountInfo.timestamp, h:accountInfo.hash}
    //     this.seenCreatedAccounts.set(accountId, accountMemData)
    // }

    if (this.accountCache.hasAccount(accountId)) {
      return
    }
    let accountInfo = this.app.getTimestampAndHashFromAccount(accountDataRaw)
    this.accountCache.updateAccountHash(accountId, accountInfo.hash, accountInfo.timestamp, cycle)

    if (accountDataRaw == null) {
      blob.errorNull++
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryInitRaw errorNull`)
      return
    }
    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }

    this.app.dataSummaryInit(blob.opaqueBlob, accountDataRaw)

    if(this.invasiveDebugInfo) this.mainLogger.debug(`statData:statsDataSummaryInitRaw c:${cycle} accForBin:${utils.makeShortHash(accountId)}`)
    if(this.invasiveDebugInfo) this.addDebugToBlob(blob, accountId)

  }

  //statsDataSummaryUpdate(accountDataBefore:any, accountDataAfter:Shardus.WrappedData){
  statsDataSummaryUpdate(cycle: number, accountData: Shardus.WrappedResponse) {
    if(this.invasiveDebugInfo) this.mainLogger.debug(`statData enter:statsDataSummaryInitRaw c:${cycle} accForBin:${utils.makeShortHash(accountData.accountId)}`)

    let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(accountData.accountId)
    blob.counter++
    if (accountData.data == null) {
      blob.errorNull += 10000
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate errorNull 1`)
      return
    }
    if (accountData.prevDataCopy == null) {
      blob.errorNull += 1000000
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate errorNull 2`)
      return
    }

    // if(this.useSeenAccountMap === true){
    //     let accountId = accountData.accountId
    //     let timestamp = accountData.timestamp //  this.app.getAccountTimestamp(accountId)
    //     let hash = accountData.stateId //this.app.getStateId(accountId)

    //     if(this.seenCreatedAccounts.has(accountId)){
    //         let accountMemData:AccountMemoryCache = this.seenCreatedAccounts.get(accountId)
    //         if(accountMemData.t > timestamp){
    //             if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: good error?: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
    //             return
    //         }
    //     } else {
    //         if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account`)
    //     }

    //     let accountMemDataUpdate:AccountMemoryCache = {t:timestamp, h:hash}
    //     this.seenCreatedAccounts.set(accountId, accountMemDataUpdate)
    // }

    let accountId = accountData.accountId
    let timestamp = accountData.timestamp //  this.app.getAccountTimestamp(accountId)
    let hash = accountData.stateId

    if (this.accountCache.hasAccount(accountId)) {
      let accountMemData: AccountHashCache = this.accountCache.getAccountHash(accountId)
      if (accountMemData.t > timestamp) {
        if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: good error?: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
        return
      }
    } else {
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account`)
    }
    this.accountCache.updateAccountHash(accountId, hash, timestamp, cycle)

    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }
    this.app.dataSummaryUpdate(blob.opaqueBlob, accountData.prevDataCopy, accountData.data)

    if(this.invasiveDebugInfo) this.mainLogger.debug(`statData:statsDataSummaryUpdate c:${cycle} accForBin:${utils.makeShortHash(accountId)}`)
    if(this.invasiveDebugInfo) this.addDebugToBlob(blob, accountId)

  }

  statsDataSummaryUpdate2(cycle: number, accountDataBefore: any, accountDataAfter: Shardus.WrappedData) {
    if(this.invasiveDebugInfo) this.mainLogger.debug(`statData enter:statsDataSummaryUpdate2 c:${cycle} accForBin:${utils.makeShortHash(accountDataAfter.accountId)}`)

    let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(accountDataAfter.accountId)
    blob.counter++
    if (accountDataAfter.data == null) {
      blob.errorNull += 100000000
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate2 errorNull 1`)
      return
    }
    if (accountDataBefore == null) {
      blob.errorNull += 10000000000
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate2 errorNull 2`)
      return
    }

    // if(this.useSeenAccountMap === true){
    //     let accountId = accountDataAfter.accountId
    //     let timestamp = accountDataAfter.timestamp //  this.app.getAccountTimestamp(accountId)
    //     let hash = accountDataAfter.stateId //this.app.getStateId(accountId)

    //     if(this.seenCreatedAccounts.has(accountId)){
    //         let accountMemData:AccountMemoryCache = this.seenCreatedAccounts.get(accountId)
    //         if(accountMemData.t > timestamp){
    //             if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: good error?: 2: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
    //             return
    //         }
    //     } else {
    //         if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account: 2`)
    //     }

    //     let accountMemDataUpdate:AccountMemoryCache = {t:timestamp, h:hash}
    //     this.seenCreatedAccounts.set(accountId, accountMemDataUpdate)
    // }

    let accountId = accountDataAfter.accountId
    let timestamp = accountDataAfter.timestamp //  this.app.getAccountTimestamp(accountId)
    let hash = accountDataAfter.stateId //this.app.getStateId(accountId)

    if (this.accountCache.hasAccount(accountId)) {
      let accountMemData: AccountHashCache = this.accountCache.getAccountHash(accountId)
      if (accountMemData.t > timestamp) {
        if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: good error?: 2: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
        return
      }
    } else {
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account: 2`)
    }
    this.accountCache.updateAccountHash(accountId, hash, timestamp, cycle)

    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }

    this.app.dataSummaryUpdate(blob.opaqueBlob, accountDataBefore, accountDataAfter.data)


    if(this.invasiveDebugInfo) this.mainLogger.debug(`statData:statsDataSummaryUpdate2 c:${cycle} accForBin:${utils.makeShortHash(accountDataAfter.accountId)}`)
    if(this.invasiveDebugInfo) this.addDebugToBlob(blob, accountDataAfter.accountId)

  }


  addDebugToBlob(blob, accountID){
    //todo be sure to turn off this setting when not debugging.
    if(this.invasiveDebugInfo){
      if(blob.opaqueBlob.dbgData == null){
        blob.opaqueBlob.dbgData = []
      }
      //add unique.. this would be faster with a set, but dont want to have to post process sort the set later!
      let shortID = utils.makeShortHash(accountID)
      if(blob.opaqueBlob.dbgData.indexOf(shortID) === -1) {
        blob.opaqueBlob.dbgData.push(shortID) 
        blob.opaqueBlob.dbgData.sort()
      }
      
    }    
  }


  statsTxSummaryUpdate(cycle: number, queueEntry: QueueEntry) {

    let accountToUseForTXStatBinning = null
    //this list of uniqueWritableKeys is not sorted and deterministic
    for(let key of queueEntry.uniqueWritableKeys){
      accountToUseForTXStatBinning = key
      break // just use the first for now.. could do something fance
    }
    if(accountToUseForTXStatBinning == null){
      if(this.invasiveDebugInfo) this.mainLogger.debug(`statsTxSummaryUpdate skip(no local writable key) c:${cycle} ${utils.makeShortHash(queueEntry.acceptedTx.id)}`)
      return
    }

    let partition = this.getSummaryBlobPartition(accountToUseForTXStatBinning) //very important to not use: queueEntry.acceptedTx.ids
    let summaryBlobCollection = this.getOrCreateTXSummaryBlobCollectionByCycle(queueEntry.cycleToRecordOn)

    if (summaryBlobCollection != null) {
      let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = summaryBlobCollection.blobsByPartition.get(partition)
      if (cycle > blob.latestCycle) {
        blob.latestCycle = cycle //todo condider if we can remove this.  getOrCreateTXSummaryBlobCollectionByCycle should give us the correct blob
      }
      this.app.txSummaryUpdate(blob.opaqueBlob, queueEntry.acceptedTx.data, null) //todo: we need to remove the wrapped state parameter from this (currently passed as null)
      blob.counter++

      //todo be sure to turn off this setting when not debugging.
      if(this.invasiveDebugInfo){
        if(blob.opaqueBlob.dbg == null){
          blob.opaqueBlob.dbg = []
        }
        blob.opaqueBlob.dbg.push(utils.makeShortHash(queueEntry.acceptedTx.id)) //queueEntry.acceptedTx.id.slice(0,6))
        blob.opaqueBlob.dbg.sort()
      }

      if(this.invasiveDebugInfo) this.mainLogger.debug(`statsTxSummaryUpdate updated c:${cycle} tx: ${utils.makeShortHash(queueEntry.acceptedTx.id)} accForBin:${utils.makeShortHash(accountToUseForTXStatBinning)}`)

    } else {
      if (logFlags.error || this.invasiveDebugInfo) this.mainLogger.error(`statsTxSummaryUpdate no collection for c:${cycle}  tx: ${utils.makeShortHash(queueEntry.acceptedTx.id)} accForBin:${utils.makeShortHash(accountToUseForTXStatBinning)}`)
    }
  }

  // //the return value is a bit obtuse. should decide if a list or map output is better, or are they both needed.
  // getStoredSnapshotPartitions(cycleShardData: CycleShardData): { list: number[]; map: Map<number, boolean> } {
  //   //figure out which summary partitions are fully covered by
  //   let result = { list: [], map: new Map() }
  //   for (let i = 0; i < this.summaryPartitionCount; i++) {
  //     // 2^32  4294967296 or 0xFFFFFFFF + 1
  //     let addressLowNum = (i / this.summaryPartitionCount) * (0xffffffff + 1)
  //     let addressHighNum = ((i + 1) / this.summaryPartitionCount) * (0xffffffff + 1) - 1
  //     let inRangeLow = ShardFunctions.testAddressNumberInRange(addressLowNum, cycleShardData.nodeShardData.storedPartitions)
  //     let inRangeHigh = false
  //     if (inRangeLow) {
  //       inRangeHigh = ShardFunctions.testAddressNumberInRange(addressHighNum, cycleShardData.nodeShardData.storedPartitions)
  //     }
  //     if (inRangeLow && inRangeHigh) {
  //       result.list.push(i)
  //       result.map.set(i, true)
  //     }
  //   }
  //   return result
  // }

  //the return value is a bit obtuse. should decide if a list or map output is better, or are they both needed.
  getConsensusSnapshotPartitions(cycleShardData: CycleShardData): { list: number[]; map: Map<number, boolean> } {
    //figure out which summary partitions are fully covered by
    let result = { list: [], map: new Map() }
    for (let i = 0; i < this.summaryPartitionCount; i++) {
      // 2^32  4294967296 or 0xFFFFFFFF + 1
      let addressLowNum = (i / this.summaryPartitionCount) * (0xffffffff + 1)
      let addressHighNum = ((i + 1) / this.summaryPartitionCount) * (0xffffffff + 1) - 1
      let inRangeLow = ShardFunctions.testAddressNumberInRange(addressLowNum, cycleShardData.nodeShardData.consensusPartitions)
      let inRangeHigh = false
      if (inRangeLow) {
        inRangeHigh = ShardFunctions.testAddressNumberInRange(addressHighNum, cycleShardData.nodeShardData.consensusPartitions)
      }
      if (inRangeLow && inRangeHigh) {
        result.list.push(i)
        result.map.set(i, true)
      }
    }
    return result
  }


  dumpLogsForCycle(cycle: number, writeTofile: boolean = true, cycleShardData: CycleShardData = null) {
    let statsDump = { cycle, dataStats: [], txStats: [], covered: [], cycleDebugNotes:{} }

    statsDump.cycleDebugNotes = this.stateManager.cycleDebugNotes

    let covered = null
    if (cycleShardData != null) {
      covered = this.getConsensusSnapshotPartitions(cycleShardData)
      statsDump.covered = covered.list
    }

    //get out a sparse collection data blobs
    for (let key of this.summaryBlobByPartition.keys()) {
      let summaryBlob = this.summaryBlobByPartition.get(key)
      if (summaryBlob.counter > 0) {
        statsDump.dataStats.push(summaryBlob)
      }
    }

    let summaryBlobCollection = this.getOrCreateTXSummaryBlobCollectionByCycle(cycle)
    if (summaryBlobCollection != null) {
      for (let key of summaryBlobCollection.blobsByPartition.keys()) {
        let summaryBlob = summaryBlobCollection.blobsByPartition.get(key)
        if (summaryBlob.counter > 0) {
          statsDump.txStats.push(summaryBlob)
        }
      }
    }


    if (writeTofile) {
      /*if(logFlags.debug)*/ this.statsLogger.debug(`logs for cycle ${cycle}: ` + utils.stringifyReduce(statsDump))
    }

    return statsDump
  }

  getCoveredStatsPartitions(cycleShardData: CycleShardData, excludeEmpty: boolean = true): StateManagerTypes.StateManagerTypes.StatsClump {
    let cycle = cycleShardData.cycleNumber
    let statsDump: StateManagerTypes.StateManagerTypes.StatsClump = { error: false, cycle, dataStats: [], txStats: [], covered: [], coveredParititionCount: 0, skippedParitionCount: 0 }

    let coveredParitionCount = 0
    let skippedParitionCount = 0
    if (cycleShardData == null) {
      if (logFlags.error) this.mainLogger.error(`getCoveredStatsPartitions missing cycleShardData`)
      statsDump.error = true
      return statsDump
    }

    let covered: { list: number[]; map: Map<number, boolean> } = null

    covered = this.getConsensusSnapshotPartitions(cycleShardData)
    statsDump.covered = covered.list

    //get out a sparse collection data blobs
    for (let key of this.summaryBlobByPartition.keys()) {
      let summaryBlob = this.summaryBlobByPartition.get(key)

      if (covered.map.has(key) === false) {
        skippedParitionCount++
        continue
      }
      if (excludeEmpty === false || summaryBlob.counter > 0) {
        statsDump.dataStats.push(summaryBlob)
      }
      coveredParitionCount++
      continue
    }

    let summaryBlobCollection = this.getOrCreateTXSummaryBlobCollectionByCycle(cycle)
    if (summaryBlobCollection != null) {
      for (let key of summaryBlobCollection.blobsByPartition.keys()) {
        let summaryBlob = summaryBlobCollection.blobsByPartition.get(key)

        if (covered.map.has(key) === false) {
          continue
        }
        if (excludeEmpty === false || summaryBlob.counter > 0) {
          statsDump.txStats.push(summaryBlob)
        }
      }
    }
    statsDump.coveredParititionCount = coveredParitionCount
    statsDump.skippedParitionCount = skippedParitionCount
    return statsDump
  }



/***
 *    ########  ########   #######   ######  ########  ######   ######  ########     ###    ########    ###     ######  ########    ###    ########  ######  ########  ##     ## ##     ## ########  
 *    ##     ## ##     ## ##     ## ##    ## ##       ##    ## ##    ## ##     ##   ## ##      ##      ## ##   ##    ##    ##      ## ##      ##    ##    ## ##     ## ##     ## ###   ### ##     ## 
 *    ##     ## ##     ## ##     ## ##       ##       ##       ##       ##     ##  ##   ##     ##     ##   ##  ##          ##     ##   ##     ##    ##       ##     ## ##     ## #### #### ##     ## 
 *    ########  ########  ##     ## ##       ######    ######   ######  ##     ## ##     ##    ##    ##     ##  ######     ##    ##     ##    ##     ######  ##     ## ##     ## ## ### ## ########  
 *    ##        ##   ##   ##     ## ##       ##             ##       ## ##     ## #########    ##    #########       ##    ##    #########    ##          ## ##     ## ##     ## ##     ## ##        
 *    ##        ##    ##  ##     ## ##    ## ##       ##    ## ##    ## ##     ## ##     ##    ##    ##     ## ##    ##    ##    ##     ##    ##    ##    ## ##     ## ##     ## ##     ## ##        
 *    ##        ##     ##  #######   ######  ########  ######   ######  ########  ##     ##    ##    ##     ##  ######     ##    ##     ##    ##     ######  ########   #######  ##     ## ##        
 */
  processDataStatsDump (stream, tallyFunction, lines) {
    // let stream = fs.createWriteStream(path, {
    //   flags: 'w'
    // })
    let dataByParition = new Map()

    let newestCycle = -1
    let statsBlobs = []
    for (let line of lines) {
      let index = line.raw.indexOf('{"covered')
      if (index >= 0) {
        let string = line.raw.slice(index)
        //this.generalLog(string)
        let statsObj = JSON.parse(string)
   
        if(newestCycle > 0 &&  statsObj.cycle != newestCycle){
          stream.write(`wrong cycle for node: ${line.file.owner} reportCycle:${newestCycle} thisNode:${statsObj.cycle} \n`)
          continue
        }
        statsBlobs.push(statsObj)
  
        if (statsObj.cycle > newestCycle) {
          newestCycle = statsObj.cycle
        }
        // this isn't quite working right without scanning the whole playback log
        statsObj.owner = line.file.owner // line.raw.slice(0, index)
      }
    }

    for (let statsObj of statsBlobs) {
      let coveredMap = new Map()
      for (let partition of statsObj.covered) {
        coveredMap.set(partition, true)
      }

      if (statsObj.cycle === newestCycle) {
        for (let dataStatsObj of statsObj.dataStats) {
          let partition = dataStatsObj.partition
          if (coveredMap.has(partition) === false) {
            continue
          }
          let dataTally
          if (dataByParition.has(partition) === false) {
            dataTally = { partition, data: [], dataStrings: {}, differentVotes: 0, voters: 0, bestVote: 0, tallyList: [] }
            dataByParition.set(partition, dataTally)
          }

          let dataString = stringify(dataStatsObj.opaqueBlob)
          dataTally = dataByParition.get(partition)

          dataTally.data.push(dataStatsObj)
          if (dataTally.dataStrings[dataString] == null) {
            dataTally.dataStrings[dataString] = 0
            dataTally.differentVotes++
          }
          dataTally.voters++
          dataTally.dataStrings[dataString]++
          let votes = dataTally.dataStrings[dataString]
          if (votes > dataTally.bestVote) {
            dataTally.bestVote = votes
          } else {
            let debug = 1
          }
          if (tallyFunction != null) {
            dataTally.tallyList.push(tallyFunction(dataStatsObj.opaqueBlob))
            // console.log(' dataTally',  dataTally)
          }
        }
      }
    }
    let allPassed = true
    let allPassedMetric2 = true
    let singleVotePartitions = 0
    let multiVotePartitions = 0
    let badPartitions = []
    for (let dataTally of dataByParition.values()) {
      if (dataTally.differentVotes === 1) {
        singleVotePartitions++
      }
      if (dataTally.differentVotes > 1) {
        multiVotePartitions++
        allPassed = false
        badPartitions.push(dataTally.partition)

        if (dataTally.bestVote >= Math.ceil(dataTally.voters / 3)) {

        } else {
          allPassedMetric2 = false
        }
      }
    }

    // need to only count stuff from the newestCycle.

    return { allPassed, allPassedMetric2, singleVotePartitions, multiVotePartitions, badPartitions, dataByParition }
  }

/***
 *    ########  ########   #######   ######  ########  ######   ######  ######## ##     ##  ######  ########    ###    ########  ######  ########  ##     ## ##     ## ########  
 *    ##     ## ##     ## ##     ## ##    ## ##       ##    ## ##    ##    ##     ##   ##  ##    ##    ##      ## ##      ##    ##    ## ##     ## ##     ## ###   ### ##     ## 
 *    ##     ## ##     ## ##     ## ##       ##       ##       ##          ##      ## ##   ##          ##     ##   ##     ##    ##       ##     ## ##     ## #### #### ##     ## 
 *    ########  ########  ##     ## ##       ######    ######   ######     ##       ###     ######     ##    ##     ##    ##     ######  ##     ## ##     ## ## ### ## ########  
 *    ##        ##   ##   ##     ## ##       ##             ##       ##    ##      ## ##         ##    ##    #########    ##          ## ##     ## ##     ## ##     ## ##        
 *    ##        ##    ##  ##     ## ##    ## ##       ##    ## ##    ##    ##     ##   ##  ##    ##    ##    ##     ##    ##    ##    ## ##     ## ##     ## ##     ## ##        
 *    ##        ##     ##  #######   ######  ########  ######   ######     ##    ##     ##  ######     ##    ##     ##    ##     ######  ########   #######  ##     ## ##        
 */
  processTxStatsDump (stream, tallyFunction, lines) {
    // let stream = fs.createWriteStream(path, {
    //   flags: 'w'
    // })
    let dataByParition = new Map()

    let newestCycle = -1
    let statsBlobs = []
    for (let line of lines) {
      let index = line.raw.indexOf('{"covered')
      if (index >= 0) {
        let string = line.raw.slice(index)
        //this.generalLog(string)
        let statsObj = JSON.parse(string)
        if(newestCycle > 0 &&  statsObj.cycle != newestCycle){
          stream.write(`wrong cycle for node: ${line.file.owner} reportCycle:${newestCycle} thisNode:${statsObj.cycle} \n`)
          continue
        }
        statsBlobs.push(statsObj)
  
        if (statsObj.cycle > newestCycle) {
          newestCycle = statsObj.cycle
        }
        // this isn't quite working right without scanning the whole playback log
        statsObj.owner = line.file.owner // line.raw.slice(0, index)
      }
    }
    let txCountMap = new Map()
    for (let statsObj of statsBlobs) {
      if (!txCountMap.has(statsObj.owner)) {
        txCountMap.set(statsObj.owner, [])
      }
      let coveredMap = new Map()
      for (let partition of statsObj.covered) {
        coveredMap.set(partition, true)
      }
      let dataTallyListForThisOwner = []
      for (let txStatsObj of statsObj.txStats) {
        let partition = txStatsObj.partition
        if (coveredMap.has(partition) === false) {
          continue
        }
        let dataTally
        if (dataByParition.has(partition) === false) {
          dataTally = { partition, data: [], dataStrings: {}, differentVotes: 0, voters: 0, bestVote: 0, bestVoteValue: null, tallyList: [] }
          dataByParition.set(partition, dataTally)
        }

        let dataString = stringify(txStatsObj.opaqueBlob)
        dataTally = dataByParition.get(partition)

        dataTally.data.push(txStatsObj)
        if (dataTally.dataStrings[dataString] == null) {
          dataTally.dataStrings[dataString] = 0
          dataTally.differentVotes++
        }
        dataTally.voters++
        dataTally.dataStrings[dataString]++
        let votes = dataTally.dataStrings[dataString]
        if (votes > dataTally.bestVote) {
          dataTally.bestVote = votes
          dataTally.bestVoteValue = txStatsObj.opaqueBlob
        } else {
          let debug = 1
        }
        if (tallyFunction != null) {
          dataTally.tallyList.push(tallyFunction(txStatsObj.opaqueBlob))
          if (dataTally.differentVotes > 1) {
            // console.log(`Cycle: ${statsObj.cycle} dataTally: partition: ${dataTally.partition}. DifferentVotes: ${dataTally.differentVotes}`)
            // console.log(dataTally.dataStrings)
          }
          dataTallyListForThisOwner.push(dataTally)
          // console.log('dataTally.tallyList', dataTally.tallyList)
          // console.log('dataTally', dataTally)
        }
      }
      let totalTx = 0
      for (let dataTally of dataTallyListForThisOwner) {
        if (dataTally.bestVoteValue) {
          totalTx += dataTally.bestVoteValue.totalTx
        }
      }
      // console.log(`TOTAL TX COUNT for CYCLE ${statsObj.cycle} ${statsObj.owner}`, txCountMap.get(statsObj.owner) + totalTx)
      txCountMap.set(statsObj.owner, txCountMap.get(statsObj.owner) + totalTx)
    }

    let allPassed = true
    let allPassedMetric2 = true
    let singleVotePartitions = 0
    let multiVotePartitions = 0
    let badPartitions = []
    let sum = 0
    for (let dataTally of dataByParition.values()) {
      // console.log('dataByPartition', dataByParition)
      sum += dataTally.bestVoteValue.totalTx || 0
      if (dataTally.differentVotes === 1) {
        singleVotePartitions++
      }
      if (dataTally.differentVotes > 1) {
        multiVotePartitions++
        allPassed = false
        badPartitions.push(dataTally.partition)
        //stream.write(`dataTally string partititon ${dataTally.partition}\n`, dataTally.dataStrings)

        if (dataTally.bestVote >= Math.ceil(dataTally.voters / 3)) {

        } else {
          allPassedMetric2 = false
        }
      }
    }


    //print non zero issues
    for (let statsObj of statsBlobs) {
      if(statsObj.cycleDebugNotes != null){
        
        for (const [key, value] of Object.entries(statsObj.cycleDebugNotes)) {
          if(value >= 1){
            stream.write(`${statsObj.owner} : ${JSON.stringify(statsObj.cycleDebugNotes)}`)
            break
          }
        }
      }
    }

    //stream.write(`Total tx count\n`, sum)
    return { allPassed, allPassedMetric2, singleVotePartitions, multiVotePartitions, badPartitions, totalTx: sum }
  }

  dataStatsTallyFunction (opaqueBlob) {
    if (opaqueBlob.totalBalance == null) {
      return 0
    }
    return opaqueBlob.totalBalance
  }
  txStatsTallyFunction (opaqueBlob) {
    if (opaqueBlob.totalTx == null) {
      return 0
    }
    return opaqueBlob.totalTx
  }

}

export default PartitionStats
