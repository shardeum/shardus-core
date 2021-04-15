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
import { nestedCountersInstance } from '../utils/nestedCounters'

class AccountCache {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler
  
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

  statemanager_fatal: (key: string, log: string) => void
  stateManager: StateManager

  constructor(stateManager: StateManager, profiler: Profiler, app: Shardus.App, logger: Logger, crypto: Crypto, config: Shardus.ShardusConfiguration) {
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


  //TODO need a way to give currentCalculationCycle an initial good value!

  // setShardGlobalMap( shardValuesByCycle: Map<number, CycleShardData>) {
  //   this.shardValuesByCycle = shardValuesByCycle
  //   // if(this.accountsHashCache3.currentCalculationCycle === -1){
  //   //   this.accountsHashCache3.currentCalculationCycle = 
  //   // }
  // }

  ////////////////////////////////
  /**
     * updateAccountHash
     * This takes an accountID, hash, timestamp and cycle and updates the cache.
     *   if this is for a future cycle then the data goes into queue to get processed later in buildPartitionHashesForNode
        METHOD 3
        More simple than method 2, but higher perf and some critical feature advantages over method 1 like the history working list and queue
     */
  ///////////////

  updateAccountHash(accountId: string, hash: string, timestamp: number, cycle: number) {
    if (hash == null) {
      let stack = new Error().stack
      this.statemanager_fatal('updateAccountHash hash=null', 'updateAccountHash hash=null' + stack)

    }
    if(cycle < 0 || cycle == null){
      let stack = new Error().stack
      this.statemanager_fatal(`updateAccountHash cycle == ${cycle}`, `updateAccountHash cycle == ${cycle} ${stack}`)
    }

    //do not leave this on!  spammy!
    let stack = new Error().stack
    this.mainLogger.debug(`updateAccountHash: ${utils.stringifyReduce({accountId, hash, timestamp, cycle})}  ${stack}`)

    nestedCountersInstance.countEvent('cache', 'updateAccountHash: start') 

    let accountHashCacheHistory: AccountHashCacheHistory
    if (this.accountsHashCache3.accountHashMap.has(accountId) === false) {
      accountHashCacheHistory = { lastSeenCycle: -1, lastSeenSortIndex: -1, queueIndex: { id: -1, idx: -1 }, accountHashList: [] }
      this.accountsHashCache3.accountHashMap.set(accountId, accountHashCacheHistory)
    } else {
      accountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountId)
    }

    //update cycle number if needed
    if(this.accountsHashCache3.currentCalculationCycle === -1){
      if(this.stateManager?.currentCycleShardData != null){
        this.accountsHashCache3.currentCalculationCycle = this.stateManager.currentCycleShardData.cycleNumber -1
        if(this.accountsHashCache3.currentCalculationCycle < 0){
          this.accountsHashCache3.currentCalculationCycle = 0
        }
      } else{
        this.statemanager_fatal(`updateAccountHash: error getting cycle number ${this.stateManager.currentCycleShardData.cycleNumber}`, 
        `updateAccountHash: error getting cycle number :${this.stateManager.currentCycleShardData.cycleNumber} `)
      }
    }

    // todo what to do about cycle == -1 !!!!
    
    let updateIsNewerHash = false
    let onFutureCycle = cycle > this.accountsHashCache3.currentCalculationCycle
    accountHashCacheHistory.lastSeenCycle = cycle

    let accountHashList: AccountHashCache[] = accountHashCacheHistory.accountHashList

    //accountHashList is a small history list for just this account.
    // this next section determines if we just insert to an empty list or adding to the head
    // this also keeps the list from growing by popping the tail when it is too long
    let accountHashData: AccountHashCache = { t: timestamp, h: hash, c: cycle }

    if (accountHashList.length === 0) {
      accountHashList.push(accountHashData)
      nestedCountersInstance.countEvent('cache', 'updateAccountHash: push as first entry') 
    } else {
      if (accountHashList.length > 0) {
        //0 is the most current entry, older entries for older cycles are after that
        let current = accountHashList[0]

        // the latest update is for the same cycle
        if (current.c === cycle) {
          if(timestamp > current.t){
            //update current
            current.h = hash
            current.t = timestamp

            updateIsNewerHash = true  
            nestedCountersInstance.countEvent('cache', 'updateAccountHash: same cycle update')          
          } else {
            nestedCountersInstance.countEvent('cache', 'updateAccountHash: same cycle older timestamp')
          }
        } else if (cycle > current.c) {
          //push new entry to head
          accountHashList.unshift(accountHashData)
          //clean up list if is too long
          while (accountHashList.length > 3 
            && accountHashList[accountHashList.length-1].c < this.accountsHashCache3.currentCalculationCycle) {
            //remove from end.  but only if the data older than the current working cycle
            accountHashList.pop()
          }
          nestedCountersInstance.countEvent('cache', 'updateAccountHash: new cycle update')  
          updateIsNewerHash = true
        } else {
          // if the cycle is older?
          // need to find the right spot to insert it!
          let idx = 0
          let doInsert = true
          for(let i=0; i < accountHashList.length; i++){
            let hashCacheEntry = accountHashList[i]
            //if we found and entry for this cycle then update it
            if(hashCacheEntry.c === cycle){
              hashCacheEntry.h = hash
              hashCacheEntry.t = timestamp
              doInsert = false
              break
            }
            //assume we splice after this hashCacheEntry because have an older cycle
            idx++
            // if we see a cycle that we are older than, stop iteration and insert before it
            if(cycle > hashCacheEntry.c){
              //insert before it
              idx = i
              break
            }
          }
          if(doInsert){
            accountHashList.splice(idx, 0, accountHashData)
            nestedCountersInstance.countEvent('cache', 'updateAccountHash: old cycle update')  
          } else {
            nestedCountersInstance.countEvent('cache', 'updateAccountHash: old cycle no update')  
          }
        }
      }
    }

    //update data in the accountHashesSorted list and record our lastSeenSortIndex index
    if (updateIsNewerHash === true && onFutureCycle === false) {
      let lastIndex = accountHashCacheHistory.lastSeenSortIndex
      // lastIndex is used to clean our spot in history by setting data to null
      //   this method of cleaning is used to avoid resizing the list constantly
      //   the empty spaces get cleared out when buildPartitionHashesForNode is run
      let index = this.insertIntoHistoryList(accountId, accountHashData, this.accountsHashCache3.workingHistoryList, lastIndex)
      accountHashCacheHistory.lastSeenSortIndex = index

      nestedCountersInstance.countEvent('cache', 'updateAccountHash: update-working')
    } else if (updateIsNewerHash === true && onFutureCycle === true) {
      let lastIndex = -1
      //if our queue index is for the future cycle then we can use this index as a lastIndex for the insert to use on cleaning
      if (accountHashCacheHistory.queueIndex.id > this.accountsHashCache3.currentCalculationCycle) {
        lastIndex = accountHashCacheHistory.queueIndex.idx
      }
      let index = this.insertIntoHistoryList(accountId, accountHashData, this.accountsHashCache3.futureHistoryList, lastIndex)
      accountHashCacheHistory.queueIndex.idx = index
      accountHashCacheHistory.queueIndex.id = cycle

      nestedCountersInstance.countEvent('cache', 'updateAccountHash: update-future')
    }
  }

  //question: when how does the future list avoid immediate data update?  the map seems to get updated right away?
         //answer: because a list is used, the hash for the correct cycle can be found
  //question2: queueIndex does not get cleared is that ok? what about when future becomes current should we set lastSeenSortIndex
        // fixes applied.  it ok that it is not clear because we check the cycle the index was set on before using it
  //question3: what is up with currentCalculationCycle, and is it updated in the right spot?
        // yes this is correct

  insertIntoHistoryList(accountId: string, accountHashData: AccountHashCache, historyList: AccountHashCacheList, lastIndex: number): number {
    let accountHashesSorted: AccountHashCache[] = historyList.accountHashesSorted
    let accountIDs: string[] = historyList.accountIDs
    let index = accountHashesSorted.length

    let cleanedUp = true
    let gotToEnd = false
    // clear old spot if lastIndex was passed in
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
      nestedCountersInstance.countEvent('cache', 'insertIntoHistoryList: at end')
    } else {
      accountHashesSorted.splice(index + 1, 0, accountHashData)
      accountIDs.splice(index + 1, 0, accountId)
      nestedCountersInstance.countEvent('cache', 'insertIntoHistoryList: splice')
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
    if (logFlags.verbose) this.mainLogger.debug(`accountsHashCache3 ${cycleShardData.cycleNumber}: ${utils.stringifyReduce(this.accountsHashCache3)}`)
    
    let cycleToProcess = cycleShardData.cycleNumber
    let nextCycleToProcess = cycleToProcess + 1
    //this.accountsHashCache3.currentCalculationCycle = cycleToProcess

    let mainHashResults: MainHashResults = {
      cycle: cycleToProcess,
      partitionHashResults: new Map(),
    }

    // let nextWorkingList: AccountHashCacheList = {
    //   accountHashesSorted: [],
    //   accountIDs: [],
    // }
    let nextFutureList: AccountHashCacheList = {
      accountHashesSorted: [],
      accountIDs: [],
    }

    let tempList1: {id:string, t:number, entry: AccountHashCache}[] = []

    // I think we could speed this up by just walking the future list and adding what is needed to the working list!
    // look at each account key and build a temp list with the AccountCacheHash for this cycle 
    for (let key of this.accountsHashCache3.accountHashMap.keys()) {
      let accountCacheHistory = this.accountsHashCache3.accountHashMap.get(key)
      let index = 0
      //if index 0 entry is not for this cycle then look through the list for older cycles. 
      while (index < accountCacheHistory.accountHashList.length - 1 && accountCacheHistory.accountHashList[index].c > cycleToProcess) {
        index++
      }
      //If the index got too high log a fatal
      if (index >= accountCacheHistory.accountHashList.length) {
        this.statemanager_fatal('buildPartitionHashesForNode: indexToohigh', 
        `buildPartitionHashesForNode: indexToohigh :${index} `)
        continue
      }

      let entry = accountCacheHistory.accountHashList[index]
      if (entry == null) {
        this.statemanager_fatal('buildPartitionHashesForNode: entry==null',
          `buildPartitionHashesForNode: entry==null :${index} cycle: ${cycleToProcess} key:${utils.stringifyReduce(key)}:  ${utils.stringifyReduce(accountCacheHistory)}`
        )
        continue
      }

      // only include this data if is younger our equal to our current working cycle.
      // including newer data would cause out of sync because proccessing still in motion
      if(entry.c <= cycleToProcess){
          tempList1.push({ id: key, t: entry.t, entry })
      }
    }
    tempList1.sort(this.sortByTimestampIdAsc)

    //rebuild the working list with out selected data from the map
    this.accountsHashCache3.workingHistoryList.accountHashesSorted = []
    this.accountsHashCache3.workingHistoryList.accountIDs = []
    let newIndex = 0
    for (let entry of tempList1) {
      this.accountsHashCache3.workingHistoryList.accountHashesSorted.push(entry.entry)
      this.accountsHashCache3.workingHistoryList.accountIDs.push(entry.id)

      let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(entry.id)
      accountHashCacheHistory.lastSeenSortIndex = newIndex
      //accountHashCacheHistory.queueIndex = { id: -1, idx: -1 } 
      newIndex++
    }

    newIndex = 0
    // process the working list.  split data into partitions and build a new list with nulled spots cleared out
    for (let index = 0; index < this.accountsHashCache3.workingHistoryList.accountHashesSorted.length; index++) {
      let accountHashData: AccountHashCache = this.accountsHashCache3.workingHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        //if this is null then it is blank entry (by design how we remove from the array at run time and retain perf)
        continue
      }
      let accountID = this.accountsHashCache3.workingHistoryList.accountIDs[index]
      if (accountID == null) {
        //should never be null if accountHashData was not null
        this.statemanager_fatal('buildPartitionHashesForNode: accountID==null unexpected', 
        `buildPartitionHashesForNode: accountID==null unexpected:${utils.stringifyReduce(accountHashData)} `)
        continue
      }
      //Start building the mainHashResults structure

      //split data into partitions.  Get the partition for this account
      let partitionHashResults: PartitionHashResults = null
      let { homePartition: partition } = ShardFunctions.addressToPartition(cycleShardData.shardGlobals, accountID)
      if (mainHashResults.partitionHashResults.has(partition) === false) {
        //if we dont have an entry for this partition yet initilize one
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
      //Push out account info into correct partition hash results structure
      partitionHashResults.ids.push(accountID)
      partitionHashResults.hashes.push(accountHashData.h)
      partitionHashResults.timestamps.push(accountHashData.t)

      // //???? is the working list suppose to have everything... I think so
      // if(accountHashData.c <= nextCycleToProcess){
      //   //
      //   //build up our next list
      //   nextWorkingList.accountHashesSorted.push(accountHashData)
      //   nextWorkingList.accountIDs.push(accountID)

      //   // TODO is the correct spot to set the index?
      //   // need to update the lastSeenSortIndex.  This way updates to the list can quickly clear out this spot in the list
      //   // remember this is the newly formed this.accountsHashCache3.workingHistoryList
      //   let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
      //   accountHashCacheHistory.lastSeenSortIndex = newIndex
      //   newIndex++
      // } else{
      //   nestedCountersInstance.countEvent('cache', 'un-expected future list')
      // }
    }

    // build a hash over all the data hashes per partition
    for (let partition of mainHashResults.partitionHashResults.keys()) {
      let partitionHashResults: PartitionHashResults = mainHashResults.partitionHashResults.get(partition)

      partitionHashResults.hashOfHashes = this.crypto.hash(partitionHashResults.hashes)
    }

    newIndex = 0
    //rebuild our future working list.
    for (let index = 0; index < this.accountsHashCache3.futureHistoryList.accountHashesSorted.length; index++) {
      let accountHashData: AccountHashCache = this.accountsHashCache3.futureHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        continue
      }
      let accountID = this.accountsHashCache3.futureHistoryList.accountIDs[index]

      if (this.accountsHashCache3.accountHashMap.has(accountID) == false) {
        if (logFlags.error) this.mainLogger.error(`buildPartitionHashesForNode: missing accountID:${accountID} index:${index} len:${this.accountsHashCache3.futureHistoryList.accountHashesSorted.length}`)
        continue
      }

      if(accountHashData.c <= cycleToProcess){
        //did not need this from future list.
        nestedCountersInstance.countEvent('cache', 'un-needed future list')
        continue
      }
      nextFutureList.accountHashesSorted.push(accountHashData)
      nextFutureList.accountIDs.push(accountID)
      let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
      accountHashCacheHistory.queueIndex = { id: accountHashData.c, idx: newIndex} 
      newIndex++
      // need to update the list index
      // build up our next list
      // nextWorkingList.accountHashesSorted.push(accountHashData)
      // nextWorkingList.accountIDs.push(accountID)
      // let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
      // accountHashCacheHistory.lastSeenSortIndex = newIndex
      // newIndex++
    }

    // update the cycle we are tracking now
    this.accountsHashCache3.currentCalculationCycle = nextCycleToProcess

    this.accountsHashCache3.futureHistoryList = nextFutureList
    // set our new working list and future list.
    // this.accountsHashCache3.workingHistoryList = nextWorkingList
    // this.accountsHashCache3.futureHistoryList = {
    //   accountHashesSorted: [],
    //   accountIDs: [],
    // }
    this.currentMainHashResults = mainHashResults
    return mainHashResults
  }


  // not quite ready what happens when we update a hash value 
  // currently a sync function, dont have correct buffers for async
  buildPartitionHashesForNode_fast(cycleShardData: CycleShardData): MainHashResults {
    if (logFlags.verbose) this.mainLogger.debug(`accountsHashCache3 ${cycleShardData.cycleNumber}: ${utils.stringifyReduce(this.accountsHashCache3)}`)
    
    let cycleToProcess = cycleShardData.cycleNumber
    let nextCycleToProcess = cycleToProcess + 1
 
    let mainHashResults: MainHashResults = {
      cycle: cycleToProcess,
      partitionHashResults: new Map(),
    }

    let nextFutureList: AccountHashCacheList = {
      accountHashesSorted: [],
      accountIDs: [],
    }

    let holes = 0
    let nextFutureIndex = 0
    let nextWorkingIndex = this.accountsHashCache3.workingHistoryList.accountHashesSorted.length
    //rebuild our future working list.
    for (let index = 0; index < this.accountsHashCache3.futureHistoryList.accountHashesSorted.length; index++) {
      let accountHashData: AccountHashCache = this.accountsHashCache3.futureHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        holes++
        continue
      }
      let accountID = this.accountsHashCache3.futureHistoryList.accountIDs[index]

      if (this.accountsHashCache3.accountHashMap.has(accountID) == false) {
        if (logFlags.error) this.mainLogger.error(`buildPartitionHashesForNode: missing accountID:${accountID} index:${index} len:${this.accountsHashCache3.futureHistoryList.accountHashesSorted.length}`)
        continue
      }

      let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
      if(accountHashData.c <= cycleToProcess){
        this.accountsHashCache3.workingHistoryList.accountHashesSorted.push(accountHashData)
        this.accountsHashCache3.workingHistoryList.accountIDs.push(accountID)

        accountHashCacheHistory.lastSeenSortIndex = nextWorkingIndex
        accountHashCacheHistory.queueIndex.id = -1
        accountHashCacheHistory.queueIndex.idx = -1
        nextWorkingIndex++
      } else {
        nextFutureList.accountHashesSorted.push(accountHashData)
        nextFutureList.accountIDs.push(accountID)

        accountHashCacheHistory.queueIndex.id = accountHashData.c
        accountHashCacheHistory.queueIndex.idx = nextFutureIndex
        nextFutureIndex++

        // tricky part here.. we need to clear this entry out of the earlier spot in the working list
        // this was not something we could do earlier since we were in the future list
        if(accountHashCacheHistory.lastSeenSortIndex > -1){
          this.accountsHashCache3.workingHistoryList.accountHashesSorted[accountHashCacheHistory.lastSeenSortIndex] = null
          this.accountsHashCache3.workingHistoryList.accountIDs[accountHashCacheHistory.lastSeenSortIndex] = null
        }
      }
    }

    // process the working list.  split data into partitions and build a new list with nulled spots cleared out
    for (let index = 0; index < this.accountsHashCache3.workingHistoryList.accountHashesSorted.length; index++) {
      let accountHashData: AccountHashCache = this.accountsHashCache3.workingHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        //if this is null then it is blank entry (by design how we remove from the array at run time and retain perf)
        continue
      }
      let accountID = this.accountsHashCache3.workingHistoryList.accountIDs[index]
      if (accountID == null) {
        //should never be null if accountHashData was not null
        this.statemanager_fatal('buildPartitionHashesForNode: accountID==null unexpected', 
        `buildPartitionHashesForNode: accountID==null unexpected:${utils.stringifyReduce(accountHashData)} `)
        continue
      }
      //Start building the mainHashResults structure

      //split data into partitions.  Get the partition for this account
      let partitionHashResults: PartitionHashResults = null
      let { homePartition: partition } = ShardFunctions.addressToPartition(cycleShardData.shardGlobals, accountID)
      if (mainHashResults.partitionHashResults.has(partition) === false) {
        //if we dont have an entry for this partition yet initilize one
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
      //Push out account info into correct partition hash results structure
      partitionHashResults.ids.push(accountID)
      partitionHashResults.hashes.push(accountHashData.h)
      partitionHashResults.timestamps.push(accountHashData.t)
    }

    // build a hash over all the data hashes per partition
    for (let partition of mainHashResults.partitionHashResults.keys()) {
      let partitionHashResults: PartitionHashResults = mainHashResults.partitionHashResults.get(partition)
      partitionHashResults.hashOfHashes = this.crypto.hash(partitionHashResults.hashes)
    }
    this.currentMainHashResults = mainHashResults

    // update the cycle we are tracking now
    this.accountsHashCache3.currentCalculationCycle = nextCycleToProcess
    this.accountsHashCache3.futureHistoryList = nextFutureList

    //todo some larger than 0 number
    if(holes > 0){
      //compact working list.
      let compactedWorkingList: AccountHashCacheList = {
        accountHashesSorted: [],
        accountIDs: [],
      }
      nextWorkingIndex = 0
      for (let index = 0; index < this.accountsHashCache3.workingHistoryList.accountHashesSorted.length; index++) {
        let accountHashData: AccountHashCache = this.accountsHashCache3.workingHistoryList.accountHashesSorted[index]
        if (accountHashData == null) {
          continue
        }
        let accountID = this.accountsHashCache3.workingHistoryList.accountIDs[index]
        if (accountID == null) {
          continue
        }
        let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
        compactedWorkingList.accountHashesSorted.push(accountHashData)
        compactedWorkingList.accountIDs.push(accountID)
        accountHashCacheHistory.lastSeenSortIndex = nextWorkingIndex
        nextWorkingIndex++
      }
      this.accountsHashCache3.workingHistoryList = compactedWorkingList
    }
    return mainHashResults
  }
}

export default AccountCache
