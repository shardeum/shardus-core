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

class AccountCache {
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

  accountsHashCache: Map<string, AccountHashCache[]>

  accountsHashCacheMain: AccountHashCacheMain

  accountsHashCache3: AccountHashCacheMain3

  shardValuesByCycle: Map<number, CycleShardData>

  currentMainHashResults: MainHashResults

  constructor(verboseLogs: boolean, profiler: Profiler, app: Shardus.App, logger: Logger, crypto: Crypto, config: Shardus.ShardusConfiguration) {
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

    this.accountsHashCache = new Map()

    this.accountsHashCacheMain = { accountHashCacheByPartition: new Map(), accountHashMap: new Map() }

    this.accountsHashCache3 = {
      currentCalculationCycle: -1,
      workingHistoryList: { accountIDs: [], accountHashesSorted: [] },
      accountHashMap: new Map(),
      futureHistoryList: { accountIDs: [], accountHashesSorted: [] },
    }

    this.currentMainHashResults = null
  }

  ////////////////////////////////
  /**
     * 
        METHOD 1 simple but requires a massive sorts
     */
  ///////////////

  // updateAccountHash1(accountId: string, hash:string, timestamp:number, cycle:number){
  //     let accountHashList:AccountHashCache[]
  //     if(this.accountsHashCache.has(accountId) === false) {
  //         accountHashList = []
  //         this.accountsHashCache.set(accountId, accountHashList)
  //     } else {
  //         accountHashList = this.accountsHashCache.get(accountId)
  //     }

  //     //update or replace
  //     let accountHashData:AccountHashCache = {t:timestamp, h:hash, c:cycle}

  //     if(accountHashList.length === 0){
  //         accountHashList.push(accountHashData)
  //     } else {
  //         if(accountHashList.length > 0){
  //             //0 is the newest?
  //             let current = accountHashList[0]

  //             if(current.c === cycle){
  //                 //update current
  //                 current.h = hash
  //                 current.t = timestamp
  //             } else {
  //                 //push new entry to head
  //                 accountHashList.unshift(accountHashData)
  //                 while(accountHashList.length > 3){
  //                     //remove from end.
  //                     accountHashList.pop()
  //                 }
  //             }
  //         }
  //     }
  // }
  // hasAccount1(accountId: string) {
  //     return this.accountsHashCache.has(accountId)
  // }

  // getAccountHash1(accountId: string) : AccountHashCache {
  //     if(this.accountsHashCache.has(accountId) === false) {
  //         return null
  //     }
  //     let accountHashList = this.accountsHashCache.get(accountId)
  //     if(accountHashList.length > 0){
  //         //0 is the newest?
  //         return accountHashList[0]
  //     }

  // }

  ////////////////////////////////
  /**
     * 
        METHOD 2 most effient but more comlicated
     */
  ///////////////

  setShardGlobalMap(shardValuesByCycle: Map<number, CycleShardData>) {
    this.shardValuesByCycle = shardValuesByCycle
  }

  // updateAccountHash2(accountId: string, hash:string, timestamp:number, cycle:number){

  //     //get partition for the current given cycle. could we require this to be passed in?
  //     let cycleShardData = null
  //     if(this.shardValuesByCycle.has(cycle)){
  //         cycleShardData = this.shardValuesByCycle.get(cycle)
  //     }

  //     let partition = -100
  //     if(cycleShardData != null)
  //     {
  //         let {homePartition, addressNum } = ShardFunctions.addressToPartition(cycleShardData.shardGlobals, accountId)
  //         partition = homePartition
  //     }

  //     let accountHashHistory:AccountHashCacheHistoryOld
  //     let accountHashListForHistory: AccountHashCache[]
  //     if(this.accountsHashCacheMain.accountHashMap.has(accountId) == false){
  //         accountHashListForHistory = []
  //         accountHashHistory = {lastSeenCycle:cycle,lastSeenSortIndex:-1, accountHashList:accountHashListForHistory}
  //         this.accountsHashCacheMain.accountHashMap.set(accountId, accountHashHistory)
  //     } else {
  //         accountHashHistory = this.accountsHashCacheMain.accountHashMap.get(accountId)
  //         accountHashListForHistory = accountHashHistory.accountHashList
  //     }

  //     let accountHashCache:AccountHashCache // = {c:cycle, t:timestamp, h:hash}
  //     //update the accountHashHistory accountHashMap.accountHashList
  //     if(accountHashHistory.lastSeenSortIndex == -1 || accountHashHistory.lastSeenCycle != cycle) {
  //         // it is new for the list.

  //         //search from end of list to find timestamp correct location

  //     } else {
  //         // it is already in the list.

  //     }

  //     //update accountHashesByPartition
  //     if(partition != -100)
  //     {
  //         let accountHashesByPartition = this.accountsHashCacheMain.accountHashCacheByPartition
  //         let accountHashesForPartition:AccountHashesForPartition = null
  //         if(accountHashesByPartition.has(partition) == false)
  //         {
  //             accountHashesForPartition = { partition, accountHashesSorted:[], accountIDs:[]  }
  //             accountHashesByPartition.set(partition, accountHashesForPartition)
  //         }

  //         //do we already have an index into the list?  (todo created timestamp?)

  //         //find index in accountHashesForPartition based on timestamp

  //     }

  //     // let accountHashList:AccountHashCache[]
  //     // if(this.accountsHashCache.has(accountId) === false) {
  //     //     accountHashList = []
  //     //     this.accountsHashCache.set(accountId, accountHashList)
  //     // } else {
  //     //     accountHashList = this.accountsHashCache.get(accountId)
  //     // }

  //     // //update or replace
  //     // let accountHashData:AccountHashCache = {t:timestamp, h:hash, c:cycle}

  //     // if(accountHashList.length === 0){
  //     //     accountHashList.push(accountHashData)
  //     // } else {
  //     //     if(accountHashList.length > 0){
  //     //         //0 is the newest?
  //     //         let current = accountHashList[0]

  //     //         if(current.c === cycle){
  //     //             //update current
  //     //             current.h = hash
  //     //             current.t = timestamp
  //     //         } else {
  //     //             //push new entry to head
  //     //             accountHashList.unshift(accountHashData)
  //     //             while(accountHashList.length > 3){
  //     //                 //remove from end.
  //     //                 accountHashList.pop()
  //     //             }
  //     //         }
  //     //     }
  //     // }
  // }

  // hasAccount2(accountId: string) {
  //     return this.accountsHashCache.has(accountId)
  // }

  // getAccountHash2(accountId: string) : AccountHashCache {
  //     if(this.accountsHashCache.has(accountId) === false) {
  //         return null
  //     }
  //     let accountHashList = this.accountsHashCache.get(accountId)
  //     if(accountHashList.length > 0){
  //         //0 is the newest?
  //         return accountHashList[0]
  //     }

  // }

  // function getPartitionRanges(shard: CycleShardData): PartitionRanges {
  //     const partitionRanges = new Map()
  //     for (const partition of shard.ourStoredPartitions) {
  //       partitionRanges.set(
  //         partition,
  //         ShardFunctions.partitionToAddressRange2(shard.shardGlobals, partition)
  //       )
  //     }

  //     return partitionRanges
  //   }

  ////////////////////////////////
  /**
     * 
        METHOD 3
        More simple than method 2, but higher perf and some critical feature advantages over method 1 like the history working list and queue
     */
  ///////////////

  updateAccountHash(accountId: string, hash: string, timestamp: number, cycle: number) {
    if (hash == null) {
      let stack = new Error().stack
      this.fatalLogger.fatal('updateAccountHash hash=null' + stack)
    }

    let accountHashCacheHistory: AccountHashCacheHistory
    if (this.accountsHashCache3.accountHashMap.has(accountId) === false) {
      accountHashCacheHistory = { lastSeenCycle: -1, lastSeenSortIndex: -1, queueIndex: { id: -1, idx: -1 }, accountHashList: [] }
      this.accountsHashCache3.accountHashMap.set(accountId, accountHashCacheHistory)
    } else {
      accountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountId)
    }
    //record last seen cycle
    //Are recording for the working cycle or a future cycle
    let onWorknigCycle = cycle < 0 || cycle === this.accountsHashCache3.currentCalculationCycle
    if (onWorknigCycle) {
      accountHashCacheHistory.lastSeenCycle = cycle
    }

    let accountHashList: AccountHashCache[] = accountHashCacheHistory.accountHashList

    //update or replace
    let accountHashData: AccountHashCache = { t: timestamp, h: hash, c: cycle }

    if (accountHashList.length === 0) {
      accountHashList.push(accountHashData)
    } else {
      if (accountHashList.length > 0) {
        //0 is the newest?
        let current = accountHashList[0]

        if (current.c === cycle) {
          //update current
          current.h = hash
          current.t = timestamp
        } else {
          //push new entry to head
          accountHashList.unshift(accountHashData)
          while (accountHashList.length > 3) {
            //remove from end.
            accountHashList.pop()
          }
        }
      }
    }

    //update data in the accountHashesSorted list and record our lastSeenSortIndex index
    if (onWorknigCycle) {
      let lastIndex = accountHashCacheHistory.lastSeenSortIndex
      let index = this.insertIntoHistoryList(accountId, accountHashData, this.accountsHashCache3.workingHistoryList, lastIndex)
      accountHashCacheHistory.lastSeenSortIndex = index
    } else {
      let lastIndex = -1
      //if our queue index is for the future cycle then we can use this index as a lastIndex for the insert to use on cleaning
      if (cycle == accountHashCacheHistory.queueIndex.id) {
        lastIndex = accountHashCacheHistory.queueIndex.idx
      }
      let index = this.insertIntoHistoryList(accountId, accountHashData, this.accountsHashCache3.futureHistoryList, lastIndex)
      accountHashCacheHistory.queueIndex.idx = index
      accountHashCacheHistory.queueIndex.id = cycle
    }
  }

  insertIntoHistoryList(accountId: string, accountHashData: AccountHashCache, historyList: AccountHashCacheList, lastIndex: number): number {
    let accountHashesSorted: AccountHashCache[] = historyList.accountHashesSorted
    let accountIDs: string[] = historyList.accountIDs
    let index = accountHashesSorted.length

    let cleanedUp = true
    let gotToEnd = false
    // clear old spot
    if (lastIndex >= 0 && lastIndex < accountHashesSorted.length) {
      accountHashesSorted[lastIndex] = null
      accountIDs[lastIndex] = null
    } else {
      cleanedUp = false
    }

    // find new spot
    for (index = accountHashesSorted.length - 1; index >= 0; index--) {
      let accountHashCache: AccountHashCache = accountHashesSorted[index]
      if (accountHashCache == null) {
        continue //empty
      }
      // todo consider this special case where t=0 goes to end of list.. (it will still sort by address)
      if (accountHashData.t != 0 && accountHashData.t < accountHashCache.t) {
        continue
      } else if (accountHashData.t === accountHashCache.t) {
        if (accountId < accountIDs[index]) {
          continue
        }
      }
      //found a spot
      break
    }
    if (index == -1) {
      gotToEnd = true
    }
    //push or insert
    if (index === accountHashesSorted.length - 1) {
      accountHashesSorted.push(accountHashData)
      accountIDs.push(accountId)
    } else {
      accountHashesSorted.splice(index + 1, 0, accountHashData)
      accountIDs.splice(index, 0, accountId)
    }
    return index
  }

  hasAccount(accountId: string) {
    return this.accountsHashCache3.accountHashMap.has(accountId)
  }

  getAccountHash(accountId: string): AccountHashCache {
    if (this.accountsHashCache3.accountHashMap.has(accountId) === false) {
      return null
    }
    let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountId)
    if (accountHashCacheHistory.accountHashList.length > 0) {
      //0 is the newest?
      return accountHashCacheHistory.accountHashList[0]
    }
  }

  // currently a sync function, dont have correct buffers for async
  buildPartitionHashesForNode1(cycleShardData: CycleShardData): MainHashResults {
    if (this.verboseLogs) this.mainLogger.debug(`accountsHashCache3 ${cycleShardData.cycleNumber}: ${utils.stringifyReduce(this.accountsHashCache3)}`)

    this.accountsHashCache3.currentCalculationCycle = cycleShardData.cycleNumber

    let mainHashResults: MainHashResults = {
      cycle: cycleShardData.cycleNumber,
      partitionHashResults: new Map(),
    }

    let nextList: AccountHashCacheList = {
      accountHashesSorted: [],
      accountIDs: [],
    }

    let newIndex = 0
    // process the working list.  split data into partitions and build a new list with nulled spots cleared out
    for (let index = 0; index < this.accountsHashCache3.workingHistoryList.accountHashesSorted.length; index++) {
      let accountHashData: AccountHashCache = this.accountsHashCache3.workingHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        //if this is null then it is blank entry (by design how we remove from the array at run time and retain perf)
        continue
      }
      let accountID = this.accountsHashCache3.workingHistoryList.accountIDs[index]

      //split data into partitions.
      let partitionHashResults: PartitionHashResults = null
      let { homePartition: partition } = ShardFunctions.addressToPartition(cycleShardData.shardGlobals, accountID)
      if (mainHashResults.partitionHashResults.has(partition) === false) {
        partitionHashResults = {
          partition,
          hashOfHashes: '',
          ids: [],
          hashes: [],
          timestamps: [],
        }
        mainHashResults.partitionHashResults.set(partition, partitionHashResults)
      } else {
        partitionHashResults = mainHashResults.partitionHashResults.get(partition)
      }
      partitionHashResults.ids.push(accountID)
      partitionHashResults.hashes.push(accountHashData.h)
      partitionHashResults.timestamps.push(accountHashData.t)

      //build up our next list
      nextList.accountHashesSorted.push(accountHashData)
      nextList.accountIDs.push(accountID)

      // need to update the list index
      // this is slower than I would like, but faster than alternatives that I can think of
      let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
      accountHashCacheHistory.lastSeenSortIndex = newIndex

      newIndex++
    }

    // build a hash over all the data hashes per partition
    for (let partition of mainHashResults.partitionHashResults.keys()) {
      let partitionHashResults: PartitionHashResults = mainHashResults.partitionHashResults.get(partition)

      partitionHashResults.hashOfHashes = this.crypto.hash(partitionHashResults.hashes)
    }

    // merge future list into our new working list.
    for (let index = 0; index < this.accountsHashCache3.futureHistoryList.accountHashesSorted.length; index++) {
      let accountHashData: AccountHashCache = this.accountsHashCache3.futureHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        continue
      }
      let accountID = this.accountsHashCache3.futureHistoryList.accountIDs[index]

      // need to update the list index
      // build up our next list
      nextList.accountHashesSorted.push(accountHashData)
      nextList.accountIDs.push(accountID)
      let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
      accountHashCacheHistory.lastSeenSortIndex = newIndex

      newIndex++
    }

    // update the cycle we are tracking now
    this.accountsHashCache3.currentCalculationCycle = cycleShardData.cycleNumber + 1

    // set our new working list and future list.
    this.accountsHashCache3.workingHistoryList = nextList
    this.accountsHashCache3.futureHistoryList = {
      accountHashesSorted: [],
      accountIDs: [],
    }
    this.currentMainHashResults = mainHashResults
    return mainHashResults
  }

  sortByTimestampIdAsc(first, second): number {
    if (first.t < second.t) {
      return -1
    }
    if (first.t > second.t) {
      return 1
    }
    if (first.id < second.id) {
      return -1
    }
    if (first.id > second.id) {
      return 1
    }
    return 0
  }

  // currently a sync function, dont have correct buffers for async
  buildPartitionHashesForNode(cycleShardData: CycleShardData): MainHashResults {
    if (this.verboseLogs) this.mainLogger.debug(`accountsHashCache3 ${cycleShardData.cycleNumber}: ${utils.stringifyReduce(this.accountsHashCache3)}`)

    this.accountsHashCache3.currentCalculationCycle = cycleShardData.cycleNumber

    let mainHashResults: MainHashResults = {
      cycle: cycleShardData.cycleNumber,
      partitionHashResults: new Map(),
    }

    let nextList: AccountHashCacheList = {
      accountHashesSorted: [],
      accountIDs: [],
    }

    let tempList1 = []

    for (let key of this.accountsHashCache3.accountHashMap.keys()) {
      let accountCacheHistory = this.accountsHashCache3.accountHashMap.get(key)
      let index = 0
      while (index < accountCacheHistory.accountHashList.length - 1 && accountCacheHistory.accountHashList[index].c > cycleShardData.cycleNumber) {
        index++
      }
      if (index >= accountCacheHistory.accountHashList.length) {
        this.mainLogger.error(`buildPartitionHashesForNode: indexToohigh :${index} `)
      }

      let entry = accountCacheHistory.accountHashList[index]
      if (entry == null) {
        this.mainLogger.error(
          `buildPartitionHashesForNode: entry==null :${index} cycle: ${cycleShardData.cycleNumber} key:${utils.stringifyReduce(key)}:  ${utils.stringifyReduce(accountCacheHistory)}`
        )
        continue
      }
      tempList1.push({ id: key, t: entry.t, entry })
    }
    tempList1.sort(this.sortByTimestampIdAsc)

    this.accountsHashCache3.workingHistoryList.accountHashesSorted = []
    this.accountsHashCache3.workingHistoryList.accountIDs = []
    for (let entry of tempList1) {
      this.accountsHashCache3.workingHistoryList.accountHashesSorted.push(entry.entry)
      this.accountsHashCache3.workingHistoryList.accountIDs.push(entry.id)
    }

    let newIndex = 0
    // process the working list.  split data into partitions and build a new list with nulled spots cleared out
    for (let index = 0; index < this.accountsHashCache3.workingHistoryList.accountHashesSorted.length; index++) {
      let accountHashData: AccountHashCache = this.accountsHashCache3.workingHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        //if this is null then it is blank entry (by design how we remove from the array at run time and retain perf)
        continue
      }
      let accountID = this.accountsHashCache3.workingHistoryList.accountIDs[index]

      //split data into partitions.
      let partitionHashResults: PartitionHashResults = null
      let { homePartition: partition } = ShardFunctions.addressToPartition(cycleShardData.shardGlobals, accountID)
      if (mainHashResults.partitionHashResults.has(partition) === false) {
        partitionHashResults = {
          partition,
          hashOfHashes: '',
          ids: [],
          hashes: [],
          timestamps: [],
        }
        mainHashResults.partitionHashResults.set(partition, partitionHashResults)
      } else {
        partitionHashResults = mainHashResults.partitionHashResults.get(partition)
      }
      partitionHashResults.ids.push(accountID)
      partitionHashResults.hashes.push(accountHashData.h)
      partitionHashResults.timestamps.push(accountHashData.t)

      //build up our next list
      nextList.accountHashesSorted.push(accountHashData)
      nextList.accountIDs.push(accountID)

      // need to update the list index
      // this is slower than I would like, but faster than alternatives that I can think of
      let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
      accountHashCacheHistory.lastSeenSortIndex = newIndex

      newIndex++
    }

    // build a hash over all the data hashes per partition
    for (let partition of mainHashResults.partitionHashResults.keys()) {
      let partitionHashResults: PartitionHashResults = mainHashResults.partitionHashResults.get(partition)

      partitionHashResults.hashOfHashes = this.crypto.hash(partitionHashResults.hashes)
    }

    // merge future list into our new working list.
    for (let index = 0; index < this.accountsHashCache3.futureHistoryList.accountHashesSorted.length; index++) {
      let accountHashData: AccountHashCache = this.accountsHashCache3.futureHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        continue
      }
      let accountID = this.accountsHashCache3.futureHistoryList.accountIDs[index]

      if (this.accountsHashCache3.accountHashMap.has(accountID) == false) {
        this.mainLogger.error(`buildPartitionHashesForNode: missing accountID:${accountID} index:${index} len:${this.accountsHashCache3.futureHistoryList.accountHashesSorted.length}`)
        continue
      }

      // need to update the list index
      // build up our next list
      nextList.accountHashesSorted.push(accountHashData)
      nextList.accountIDs.push(accountID)
      let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
      accountHashCacheHistory.lastSeenSortIndex = newIndex

      newIndex++
    }

    // update the cycle we are tracking now
    this.accountsHashCache3.currentCalculationCycle = cycleShardData.cycleNumber + 1

    // set our new working list and future list.
    this.accountsHashCache3.workingHistoryList = nextList
    this.accountsHashCache3.futureHistoryList = {
      accountHashesSorted: [],
      accountIDs: [],
    }
    this.currentMainHashResults = mainHashResults
    return mainHashResults
  }
}

export default AccountCache
