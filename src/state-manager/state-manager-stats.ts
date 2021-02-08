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
import ShardFunctions2 from './shardFunctions2.js'
import StateManagerCache from './state-manager-cache'

class StateManagerStats {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler
  verboseLogs: boolean
  logger: Logger

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any

  summaryBlobByPartition: Map<number, SummaryBlob>
  summaryPartitionCount: number
  txSummaryBlobCollections: SummaryBlobCollection[]
  extensiveRangeChecking: boolean // non required range checks that can show additional errors (should not impact flow control)

  // add cycle then , never delete one from previous cycle.
  //     quick lookup
  //
  seenCreatedAccounts: Map<string, AccountMemoryCache> // Extra level of safety at the cost of memory to prevent double init.  starting point to have in memory hash of accounts
  useSeenAccountMap: boolean

  stateManagerCache: StateManagerCache

  constructor(verboseLogs: boolean, profiler: Profiler, app: Shardus.App, logger: Logger, crypto: Crypto, config: Shardus.ShardusConfiguration, stateManagerCache: StateManagerCache) {
    this.verboseLogs = verboseLogs
    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    //Init Summary Blobs
    this.summaryPartitionCount = 32

    this.extensiveRangeChecking = true

    this.summaryBlobByPartition = new Map()
    this.txSummaryBlobCollections = []

    this.useSeenAccountMap = true
    this.seenCreatedAccounts = new Map()

    this.stateManagerCache = stateManagerCache

    this.initSummaryBlobs()
  }

  getNewSummaryBlob(partition: number): SummaryBlob {
    return { counter: 0, latestCycle: 0, errorNull: 0, partition, opaqueBlob: {} }
  }

  initSummaryBlobs() {
    for (let i = 0; i < this.summaryPartitionCount; i++) {
      this.summaryBlobByPartition.set(i, this.getNewSummaryBlob(i))
    }
  }

  initTXSummaryBlobsForCycle(cycleNumber: number): SummaryBlobCollection {
    let summaryBlobCollection = { cycle: cycleNumber, blobsByPartition: new Map() }
    for (let i = 0; i < this.summaryPartitionCount; i++) {
      summaryBlobCollection.blobsByPartition.set(i, this.getNewSummaryBlob(i))
    }
    this.txSummaryBlobCollections.push(summaryBlobCollection)
    return summaryBlobCollection
  }

  getOrCreateTXSummaryBlobCollectionByCycle(cycle: number): SummaryBlobCollection {
    let summaryBlobCollectionToUse = null
    if (cycle < 0) {
      return null
    }
    for (let i = this.txSummaryBlobCollections.length - 1; i >= 0; i--) {
      let summaryBlobCollection = this.txSummaryBlobCollections[i]
      if (summaryBlobCollection.cycle === cycle) {
        summaryBlobCollectionToUse = summaryBlobCollection
      }
    }
    if (summaryBlobCollectionToUse === null) {
      summaryBlobCollectionToUse = this.initTXSummaryBlobsForCycle(cycle)
      this.txSummaryBlobCollections.push(summaryBlobCollectionToUse)
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
        this.mainLogger.error(`getSummaryBlobPartition summaryPartition < 0 ${summaryPartition}`)
      }
      if (summaryPartition > this.summaryPartitionCount) {
        this.mainLogger.error(`getSummaryBlobPartition summaryPartition > this.summaryPartitionCount ${summaryPartition}`)
      }
    }

    if (summaryPartition === this.summaryPartitionCount) {
      summaryPartition = summaryPartition - 1
    }
    return summaryPartition
  }

  getSummaryBlob(address: string): SummaryBlob {
    let partition = this.getSummaryBlobPartition(address)
    let blob: SummaryBlob = this.summaryBlobByPartition.get(partition)
    return blob
  }

  statsDataSummaryInit(cycle: number, accountData: Shardus.WrappedData) {
    let blob: SummaryBlob = this.getSummaryBlob(accountData.accountId)
    blob.counter++

    // if(this.useSeenAccountMap === true && this.seenCreatedAccounts.has(accountData.accountId)){
    //     // this.mainLogger.error(`statsDataSummaryInit seenCreatedAccounts dupe: ${utils.stringifyReduce(accountData.accountId)}`)
    //     return
    // }
    // if(this.useSeenAccountMap === true){
    //     let accountMemData:AccountMemoryCache = {t:accountData.timestamp, h:accountData.stateId}
    //     this.seenCreatedAccounts.set(accountData.accountId, accountMemData)
    // }

    if (this.stateManagerCache.hasAccount(accountData.accountId)) {
      return
    }
    this.stateManagerCache.updateAccountHash(accountData.accountId, accountData.stateId, accountData.timestamp, cycle)

    if (accountData.data == null) {
      blob.errorNull++
      this.mainLogger.error(`statsDataSummaryInit errorNull`)
      return
    }
    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }
    this.app.dataSummaryInit(blob.opaqueBlob, accountData.data)
  }

  hasAccountBeenSeenByStats(accountId) {
    // if(this.useSeenAccountMap === false){
    //     this.mainLogger.error(`hasAccountBeenSeenByStats disabled`)
    //     return false
    // }
    // return this.seenCreatedAccounts.has(accountId)

    return this.stateManagerCache.hasAccount(accountId)
  }

  statsDataSummaryInitRaw(cycle: number, accountId: string, accountDataRaw: any) {
    let blob: SummaryBlob = this.getSummaryBlob(accountId)
    blob.counter++

    // if(this.useSeenAccountMap === true && this.seenCreatedAccounts.has(accountId)){
    //     // this.mainLogger.error(`statsDataSummaryInitRaw seenCreatedAccounts dupe: ${utils.stringifyReduce(accountId)}`)
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

    if (this.stateManagerCache.hasAccount(accountId)) {
      return
    }
    let accountInfo = this.app.getTimestampAndHashFromAccount(accountDataRaw)
    this.stateManagerCache.updateAccountHash(accountId, accountInfo.hash, accountInfo.timestamp, cycle)

    if (accountDataRaw == null) {
      blob.errorNull++
      this.mainLogger.error(`statsDataSummaryInitRaw errorNull`)
      return
    }
    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }

    this.app.dataSummaryInit(blob.opaqueBlob, accountDataRaw)
  }

  //statsDataSummaryUpdate(accountDataBefore:any, accountDataAfter:Shardus.WrappedData){
  statsDataSummaryUpdate(cycle: number, accountData: Shardus.WrappedResponse) {
    let blob: SummaryBlob = this.getSummaryBlob(accountData.accountId)
    blob.counter++
    if (accountData.data == null) {
      blob.errorNull += 10000
      this.mainLogger.error(`statsDataSummaryUpdate errorNull 1`)
      return
    }
    if (accountData.prevDataCopy == null) {
      blob.errorNull += 1000000
      this.mainLogger.error(`statsDataSummaryUpdate errorNull 2`)
      return
    }

    // if(this.useSeenAccountMap === true){
    //     let accountId = accountData.accountId
    //     let timestamp = accountData.timestamp //  this.app.getAccountTimestamp(accountId)
    //     let hash = accountData.stateId //this.app.getStateId(accountId)

    //     if(this.seenCreatedAccounts.has(accountId)){
    //         let accountMemData:AccountMemoryCache = this.seenCreatedAccounts.get(accountId)
    //         if(accountMemData.t > timestamp){
    //             this.mainLogger.error(`statsDataSummaryUpdate: good error?: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
    //             return
    //         }
    //     } else {
    //         this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account`)
    //     }

    //     let accountMemDataUpdate:AccountMemoryCache = {t:timestamp, h:hash}
    //     this.seenCreatedAccounts.set(accountId, accountMemDataUpdate)
    // }

    let accountId = accountData.accountId
    let timestamp = accountData.timestamp //  this.app.getAccountTimestamp(accountId)
    let hash = accountData.stateId

    if (this.stateManagerCache.hasAccount(accountId)) {
      let accountMemData: AccountHashCache = this.stateManagerCache.getAccountHash(accountId)
      if (accountMemData.t > timestamp) {
        this.mainLogger.error(`statsDataSummaryUpdate: good error?: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
        return
      }
    } else {
      this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account`)
    }
    this.stateManagerCache.updateAccountHash(accountId, hash, timestamp, cycle)

    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }
    this.app.dataSummaryUpdate(blob.opaqueBlob, accountData.prevDataCopy, accountData.data)
  }

  statsDataSummaryUpdate2(cycle: number, accountDataBefore: any, accountDataAfter: Shardus.WrappedData) {
    let blob: SummaryBlob = this.getSummaryBlob(accountDataAfter.accountId)
    blob.counter++
    if (accountDataAfter.data == null) {
      blob.errorNull += 100000000
      this.mainLogger.error(`statsDataSummaryUpdate2 errorNull 1`)
      return
    }
    if (accountDataBefore == null) {
      blob.errorNull += 10000000000
      this.mainLogger.error(`statsDataSummaryUpdate2 errorNull 2`)
      return
    }

    // if(this.useSeenAccountMap === true){
    //     let accountId = accountDataAfter.accountId
    //     let timestamp = accountDataAfter.timestamp //  this.app.getAccountTimestamp(accountId)
    //     let hash = accountDataAfter.stateId //this.app.getStateId(accountId)

    //     if(this.seenCreatedAccounts.has(accountId)){
    //         let accountMemData:AccountMemoryCache = this.seenCreatedAccounts.get(accountId)
    //         if(accountMemData.t > timestamp){
    //             this.mainLogger.error(`statsDataSummaryUpdate: good error?: 2: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
    //             return
    //         }
    //     } else {
    //         this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account: 2`)
    //     }

    //     let accountMemDataUpdate:AccountMemoryCache = {t:timestamp, h:hash}
    //     this.seenCreatedAccounts.set(accountId, accountMemDataUpdate)
    // }

    let accountId = accountDataAfter.accountId
    let timestamp = accountDataAfter.timestamp //  this.app.getAccountTimestamp(accountId)
    let hash = accountDataAfter.stateId //this.app.getStateId(accountId)

    if (this.stateManagerCache.hasAccount(accountId)) {
      let accountMemData: AccountHashCache = this.stateManagerCache.getAccountHash(accountId)
      if (accountMemData.t > timestamp) {
        this.mainLogger.error(`statsDataSummaryUpdate: good error?: 2: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
        return
      }
    } else {
      this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account: 2`)
    }
    this.stateManagerCache.updateAccountHash(accountId, hash, timestamp, cycle)

    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }

    this.app.dataSummaryUpdate(blob.opaqueBlob, accountDataBefore, accountDataAfter.data)
  }

  statsTxSummaryUpdate(cycle: number, queueEntry: QueueEntry) {
    let partition = this.getSummaryBlobPartition(queueEntry.acceptedTx.id)
    let summaryBlobCollection = this.getOrCreateTXSummaryBlobCollectionByCycle(queueEntry.cycleToRecordOn)

    if (summaryBlobCollection != null) {
      let blob: SummaryBlob = summaryBlobCollection.blobsByPartition.get(partition)
      if (cycle > blob.latestCycle) {
        blob.latestCycle = cycle
      }
      this.app.txSummaryUpdate(blob.opaqueBlob, queueEntry.acceptedTx.data, null) //todo send data or not?
      blob.counter++
    } else {
      this.mainLogger.error(`statsTxSummaryUpdate no collection for ${cycle}`)
    }
  }

  //the return value is a bit obtuse. should decide if a list or map output is better, or are they both needed.
  getStoredSnapshotPartitions(cycleShardData: CycleShardData): { list: number[]; map: Map<number, boolean> } {
    //figure out which summary partitions are fully covered by
    let result = { list: [], map: new Map() }
    for (let i = 0; i < this.summaryPartitionCount; i++) {
      // 2^32  4294967296 or 0xFFFFFFFF + 1
      let addressLowNum = (i / this.summaryPartitionCount) * (0xffffffff + 1)
      let addressHighNum = ((i + 1) / this.summaryPartitionCount) * (0xffffffff + 1) - 1
      let inRangeLow = ShardFunctions2.testAddressNumberInRange(addressLowNum, cycleShardData.nodeShardData.storedPartitions)
      let inRangeHigh = false
      if (inRangeLow) {
        inRangeHigh = ShardFunctions2.testAddressNumberInRange(addressHighNum, cycleShardData.nodeShardData.storedPartitions)
      }
      if (inRangeLow && inRangeHigh) {
        result.list.push(i)
        result.map.set(i, true)
      }
    }
    return result
  }

  dumpLogsForCycle(cycle: number, writeTofile: boolean = true, cycleShardData: CycleShardData = null) {
    let statsDump = { cycle, dataStats: [], txStats: [], covered: [] }

    let covered = null
    if (cycleShardData != null) {
      covered = this.getStoredSnapshotPartitions(cycleShardData)
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
      this.statsLogger.debug(`logs for cycle ${cycle}: ` + utils.stringifyReduce(statsDump))
    }

    return statsDump
  }

  getCoveredStatsPartitions(cycleShardData: CycleShardData, excludeEmpty: boolean = true): StatsClump {
    let cycle = cycleShardData.cycleNumber
    let statsDump: StatsClump = { error: false, cycle, dataStats: [], txStats: [], covered: [], coveredParititionCount: 0, skippedParitionCount: 0 }

    let coveredParitionCount = 0
    let skippedParitionCount = 0
    if (cycleShardData == null) {
      this.mainLogger.error(`getCoveredStatsPartitions missing cycleShardData`)
      statsDump.error = true
      return statsDump
    }

    let covered: { list: number[]; map: Map<number, boolean> } = null

    covered = this.getStoredSnapshotPartitions(cycleShardData)
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
}

export default StateManagerStats
