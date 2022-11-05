import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import ShardFunctions from './shardFunctions'
import { time } from 'console'
import StateManager from '.'
import { nestedCountersInstance } from '../utils/nestedCounters'
import {
  AccountHashCache,
  AccountHashCacheMain3,
  CycleShardData,
  MainHashResults,
  AccountHashCacheHistory,
  AccountHashCacheList,
  PartitionHashResults,
} from './state-manager-types'

class AccountCache {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.StrictServerConfiguration
  profiler: Profiler

  logger: Logger

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any

  accountsHashCache3: AccountHashCacheMain3 //This is the main storage

  currentMainHashResults: MainHashResults //one of the main outputs produced by account cache.  However this was important for accounting
  //for values in a given partition, and that does not scale

  cacheUpdateQueue: AccountHashCacheList

  statemanager_fatal: (key: string, log: string) => void
  stateManager: StateManager

  constructor(
    stateManager: StateManager,
    profiler: Profiler,
    app: Shardus.App,
    logger: Logger,
    crypto: Crypto,
    config: Shardus.StrictServerConfiguration
  ) {
    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler

    if (logger == null) {
      return // for debug
    }

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal
    this.stateManager = stateManager

    this.accountsHashCache3 = {
      currentCalculationCycle: -1,
      workingHistoryList: { accountIDs: [], accountHashesSorted: [] },
      accountHashMap: new Map(),
      futureHistoryList: { accountIDs: [], accountHashesSorted: [] },
    }

    this.cacheUpdateQueue = { accountIDs: [], accountHashesSorted: [] }

    this.currentMainHashResults = null
  }

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
    if (cycle < 0 || cycle == null) {
      let stack = new Error().stack
      this.statemanager_fatal(
        `updateAccountHash cycle == ${cycle}`,
        `updateAccountHash cycle == ${cycle} ${stack}`
      )
    }

    //do not leave this on!  spammy!
    // let stack = new Error().stack
    // this.mainLogger.debug(`updateAccountHash: ${utils.stringifyReduce({accountId, hash, timestamp, cycle})}  ${stack}`)

    nestedCountersInstance.countEvent('cache', 'updateAccountHash: start')

    // See if we have a cache entry yet.  if not create a history entry for this account
    let accountHashCacheHistory: AccountHashCacheHistory
    if (this.accountsHashCache3.accountHashMap.has(accountId) === false) {
      accountHashCacheHistory = {
        lastSeenCycle: -1,
        lastSeenSortIndex: -1,
        queueIndex: { id: -1, idx: -1 },
        accountHashList: [],
        lastStaleCycle: -1,
        lastUpdateCycle: -1,
      }
      this.accountsHashCache3.accountHashMap.set(accountId, accountHashCacheHistory)
    } else {
      accountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountId)
    }

    //update main cycle number if needed..  not sure this is perfect.. may be better as a function that can be smart?
    //
    if (this.accountsHashCache3.currentCalculationCycle === -1) {
      if (this.stateManager?.currentCycleShardData != null) {
        this.accountsHashCache3.currentCalculationCycle =
          this.stateManager.currentCycleShardData.cycleNumber - 1
        if (this.accountsHashCache3.currentCalculationCycle < 0) {
          this.accountsHashCache3.currentCalculationCycle = 0
        }
      } else {
        this.statemanager_fatal(
          `updateAccountHash: error getting cycle number ${this.stateManager.currentCycleShardData.cycleNumber}`,
          `updateAccountHash: error getting cycle number c:${this.stateManager.currentCycleShardData.cycleNumber} `
        )
      }
    }

    let updateIsNewerHash = false
    let onFutureCycle = cycle > this.accountsHashCache3.currentCalculationCycle

    //last state cycle gets set if our node has an account that it no longer covers.  I am not sure we will be able to track this in the future.
    //and that may not matter.
    if (
      accountHashCacheHistory.lastStaleCycle > 0 &&
      accountHashCacheHistory.lastStaleCycle > accountHashCacheHistory.lastSeenCycle
    ) {
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`Reinstate account c:${this.stateManager.currentCycleShardData.cycleNumber} acc:${utils.stringifyReduce(accountId)} lastStale:${accountHashCacheHistory.lastStaleCycle}`)
    }

    //gets compared with lastStaleCycle here and in the patcher.  here it stops the data from being in the report.
    accountHashCacheHistory.lastSeenCycle = this.accountsHashCache3.currentCalculationCycle
    //I think this doesnt do anything:  (maybe for debu only)
    if (cycle > accountHashCacheHistory.lastUpdateCycle) {
      accountHashCacheHistory.lastUpdateCycle = cycle
    }

    let accountHashList: AccountHashCache[] = accountHashCacheHistory.accountHashList

    //accountHashList is a small history list for just this account.
    // this next section determines if we just insert to an empty list or adding to the head
    // this also keeps the list from growing by popping the tail when it is too long
    let accountHashData: AccountHashCache = { t: timestamp, h: hash, c: cycle }

    if (accountHashList.length === 0) {
      accountHashList.push(accountHashData)
      nestedCountersInstance.countEvent('cache', 'updateAccountHash: push as first entry')
      if (this.config.debug.newCacheFlow) {
        updateIsNewerHash = true
      }
    } else {
      if (accountHashList.length > 0) {
        //0 is the most current entry, older entries for older cycles are after that
        let current = accountHashList[0]

        // the latest update is for the same cycle
        if (current.c === cycle) {
          if (timestamp > current.t) {
            //update current
            current.h = hash
            current.t = timestamp

            updateIsNewerHash = true
            nestedCountersInstance.countEvent('cache', 'updateAccountHash: same cycle update')
          } else {
            nestedCountersInstance.countEvent('cache', 'updateAccountHash: same cycle older timestamp')
          }
        } else if (cycle > current.c || timestamp > current.t) {
          //push new entry to head
          accountHashList.unshift(accountHashData)
          //clean up list if is too long
          while (
            accountHashList.length > 3 &&
            accountHashList[accountHashList.length - 1].c < this.accountsHashCache3.currentCalculationCycle
          ) {
            //remove from end.  but only if the data older than the current working cycle
            accountHashList.pop() //hmm could this axe data too soon? i.e. push out cache entries before they get put in a report.
          }
          nestedCountersInstance.countEvent('cache', 'updateAccountHash: new cycle update')

          if (cycle < current.c && timestamp > current.t) {
            /* prettier-ignore */ nestedCountersInstance.countEvent('cache', 'updateAccountHash: older cycle but newer timestamp')
            this.statemanager_fatal(
              'updateAccountHash: cycleCalcOff',
              `updateAccountHash: older cycle but newer timestamp :${cycle} < ${current.c} && ${timestamp} > ${current.t} `
            )
          }

          updateIsNewerHash = true
        } else {
          // if the cycle is older?
          // need to find the right spot to insert it!
          let idx = 0
          let doInsert = true
          for (let i = 0; i < accountHashList.length; i++) {
            let hashCacheEntry = accountHashList[i]
            //if we found and entry for this cycle then update it
            if (hashCacheEntry.c === cycle) {
              hashCacheEntry.h = hash
              hashCacheEntry.t = timestamp
              doInsert = false
              break
            }
            //assume we splice after this hashCacheEntry because have an older cycle
            idx++
            // if we see a cycle that we are older than, stop iteration and insert before it
            if (cycle > hashCacheEntry.c) {
              //insert before it
              idx = i
              break
            }
          }
          if (doInsert) {
            accountHashList.splice(idx, 0, accountHashData)
            nestedCountersInstance.countEvent('cache', 'updateAccountHash: old cycle update')
          } else {
            nestedCountersInstance.countEvent('cache', 'updateAccountHash: old cycle no update')
          }
        }
      }
    }

    if (this.config.debug.newCacheFlow) {
      if (updateIsNewerHash) {
        this.cacheUpdateQueue.accountHashesSorted.push(accountHashData)
        this.cacheUpdateQueue.accountIDs.push(accountId)
      }
    } else {
      //update data in the accountHashesSorted list and record our lastSeenSortIndex index
      if (updateIsNewerHash === true && onFutureCycle === false) {
        let lastIndex = accountHashCacheHistory.lastSeenSortIndex
        // lastIndex is used to clean our spot in history by setting data to null
        //   this method of cleaning is used to avoid resizing the list constantly
        //   the empty spaces get cleared out when buildPartitionHashesForNode is run
        let index = this.insertIntoHistoryList(
          accountId,
          accountHashData,
          this.accountsHashCache3.workingHistoryList,
          lastIndex
        )
        accountHashCacheHistory.lastSeenSortIndex = index

        nestedCountersInstance.countEvent('cache', 'updateAccountHash: update-working')
      } else if (updateIsNewerHash === true && onFutureCycle === true) {
        let lastIndex = -1
        //if our queue index is for the future cycle then we can use this index as a lastIndex for the insert to use on cleaning
        if (accountHashCacheHistory.queueIndex.id > this.accountsHashCache3.currentCalculationCycle) {
          lastIndex = accountHashCacheHistory.queueIndex.idx
        }
        let index = this.insertIntoHistoryList(
          accountId,
          accountHashData,
          this.accountsHashCache3.futureHistoryList,
          lastIndex
        )
        accountHashCacheHistory.queueIndex.idx = index
        accountHashCacheHistory.queueIndex.id = cycle

        nestedCountersInstance.countEvent('cache', 'updateAccountHash: update-future')
      }
    }
  }

  //question: when how does the future list avoid immediate data update?  the map seems to get updated right away?
  //answer: because a list is used, the hash for the correct cycle can be found
  //question2: queueIndex does not get cleared is that ok? what about when future becomes current should we set lastSeenSortIndex
  // fixes applied.  it ok that it is not clear because we check the cycle the index was set on before using it
  //question3: what is up with currentCalculationCycle, and is it updated in the right spot?
  // yes this is correct.  buildPartitionHashesForNode gets called with the last cycle data not the active cycle
  // at the end of buildPartitionHashesForNode gets set to the working/current cycle.
  // if TXs come in that are newer they get put in the future list and are not part of the parition hash report yet

  insertIntoHistoryList(
    accountId: string,
    accountHashData: AccountHashCache,
    historyList: AccountHashCacheList,
    lastIndex: number
  ): number {
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

  //just gets the newest seen hash.  does that cause issues?
  getAccountHash(accountId: string): AccountHashCache {
    if (this.accountsHashCache3.accountHashMap.has(accountId) === false) {
      return null
    }
    let accountHashCacheHistory: AccountHashCacheHistory =
      this.accountsHashCache3.accountHashMap.get(accountId)
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
  buildPartitionHashesForNode(
    cycleShardData: CycleShardData,
    debugAC3: AccountHashCacheMain3 = null,
    debugAccount: string = null
  ): MainHashResults {
    // OFFLINE DEBUGGING
    // if(debugAC3 != null){
    //   this.accountsHashCache3 = debugAC3
    // }

    //the line below is too slow.. needs to be in an ultra verbose categor that we dont have, so for now you have to uncomment it on manually
    //if (logFlags.verbose) this.mainLogger.debug(`accountsHashCache3 ${cycleShardData.cycleNumber}: ${utils.stringifyReduce(this.accountsHashCache3)}`)

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

    let tempList1: { id: string; t: number; entry: AccountHashCache }[] = []

    let staleAccountsSkipped = 0
    // I think we could speed this up by just walking the future list and adding what is needed to the working list!
    // look at each account key and build a temp list with the AccountCacheHash for this cycle
    for (let key of this.accountsHashCache3.accountHashMap.keys()) {
      let accountCacheHistory = this.accountsHashCache3.accountHashMap.get(key)
      let index = 0

      // OFFLINE DEBUGGING
      // if(debugAccount === key){
      //   let ii = 0
      //   ii++
      // }

      if (accountCacheHistory.lastStaleCycle > accountCacheHistory.lastSeenCycle) {
        //dont use this in a report if it was recently stale
        staleAccountsSkipped++
        continue
      }

      //is the line below causing a whole extra cycle of delay in the system?

      //if index 0 entry is not for this cycle then look through the list for older cycles.
      while (
        index < accountCacheHistory.accountHashList.length - 1 &&
        accountCacheHistory.accountHashList[index].c > cycleToProcess
      ) {
        index++
      }
      //If the index got too high log a fatal
      if (index >= accountCacheHistory.accountHashList.length) {
        this.statemanager_fatal(
          'buildPartitionHashesForNode: indexToohigh',
          `buildPartitionHashesForNode: indexToohigh :${index} `
        )
        continue
      }

      let entry = accountCacheHistory.accountHashList[index]
      if (entry == null) {
        this.statemanager_fatal(
          'buildPartitionHashesForNode: entry==null',
          `buildPartitionHashesForNode: entry==null :${index} cycle: ${cycleToProcess} key:${utils.stringifyReduce(
            key
          )}:  ${utils.stringifyReduce(accountCacheHistory)}`
        )
        continue
      }

      // only include this data if is younger our equal to our current working cycle.
      // including newer data would cause out of sync because proccessing still in motion
      if (entry.c <= cycleToProcess) {
        tempList1.push({ id: key, t: entry.t, entry })
      }
    }
    tempList1.sort(this.sortByTimestampIdAsc)

    if (staleAccountsSkipped > 0) {
      nestedCountersInstance.countEvent('cache', 'staleAccountsSkipped', staleAccountsSkipped)
    }

    //rebuild the working list with out selected data from the map
    this.accountsHashCache3.workingHistoryList.accountHashesSorted = []
    this.accountsHashCache3.workingHistoryList.accountIDs = []
    let newIndex = 0
    for (let entry of tempList1) {
      this.accountsHashCache3.workingHistoryList.accountHashesSorted.push(entry.entry)
      this.accountsHashCache3.workingHistoryList.accountIDs.push(entry.id)

      let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(
        entry.id
      )
      accountHashCacheHistory.lastSeenSortIndex = newIndex
      newIndex++
    }

    newIndex = 0
    // process the working list.  split data into partitions and build a new list with nulled spots cleared out
    for (
      let index = 0;
      index < this.accountsHashCache3.workingHistoryList.accountHashesSorted.length;
      index++
    ) {
      let accountHashData: AccountHashCache =
        this.accountsHashCache3.workingHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        //if this is null then it is blank entry (by design how we remove from the array at run time and retain perf)
        continue
      }
      let accountID = this.accountsHashCache3.workingHistoryList.accountIDs[index]
      if (accountID == null) {
        //should never be null if accountHashData was not null
        this.statemanager_fatal(
          'buildPartitionHashesForNode: accountID==null unexpected',
          `buildPartitionHashesForNode: accountID==null unexpected:${utils.stringifyReduce(accountHashData)} `
        )
        continue
      }

      // OFFLINE DEBUGGING
      // if(debugAccount === accountID){
      //   let ii = 0
      //   ii++
      // }
      //Start building the mainHashResults structure

      //split data into partitions.  Get the partition for this account
      let partitionHashResults: PartitionHashResults = null
      let { homePartition: partition } = ShardFunctions.addressToPartition(
        cycleShardData.shardGlobals,
        accountID
      )

      //if we do not store this partition then dont put it in a report.  tell the trie to remove it.
      //TODO perf, will need something more efficient.
      if (ShardFunctions.testInRange(partition, cycleShardData.nodeShardData.storedPartitions) === false) {
        //how important is this step
        this.stateManager.accountPatcher.removeAccountHash(accountID)

        let accountHashCacheHistory: AccountHashCacheHistory =
          this.accountsHashCache3.accountHashMap.get(accountID)
        if (cycleToProcess > accountHashCacheHistory.lastStaleCycle) {
          accountHashCacheHistory.lastStaleCycle = cycleToProcess
        }
        continue
      }

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

      //very important call in the data pipeline.
      this.stateManager.accountPatcher.updateAccountHash(accountID, accountHashData.h)
    }

    // build a hash over all the data hashes per partition
    for (let partition of mainHashResults.partitionHashResults.keys()) {
      let partitionHashResults: PartitionHashResults = mainHashResults.partitionHashResults.get(partition)

      partitionHashResults.hashOfHashes = this.crypto.hash(partitionHashResults.hashes)
    }

    //this.filterOutNonStoredData(mainHashResults)

    newIndex = 0
    //rebuild our future working list.
    for (
      let index = 0;
      index < this.accountsHashCache3.futureHistoryList.accountHashesSorted.length;
      index++
    ) {
      let accountHashData: AccountHashCache =
        this.accountsHashCache3.futureHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        continue
      }
      let accountID = this.accountsHashCache3.futureHistoryList.accountIDs[index]

      // OFFLINE DEBUGGING
      // if(debugAccount === accountID){
      //   let ii = 0
      //   ii++
      // }

      if (this.accountsHashCache3.accountHashMap.has(accountID) == false) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`buildPartitionHashesForNode: missing accountID:${accountID} index:${index} len:${this.accountsHashCache3.futureHistoryList.accountHashesSorted.length}`)
        continue
      }

      if (accountHashData.c <= cycleToProcess) {
        //did not need this from future list.
        // nestedCountersInstance.countEvent('cache', 'un-needed future list')
        continue
      }
      nextFutureList.accountHashesSorted.push(accountHashData)
      nextFutureList.accountIDs.push(accountID)
      let accountHashCacheHistory: AccountHashCacheHistory =
        this.accountsHashCache3.accountHashMap.get(accountID)
      accountHashCacheHistory.queueIndex = { id: accountHashData.c, idx: newIndex }
      newIndex++
    }

    // update the cycle we are tracking now
    this.accountsHashCache3.currentCalculationCycle = nextCycleToProcess

    this.accountsHashCache3.futureHistoryList = nextFutureList
    // set our new working list and future list.
    this.currentMainHashResults = mainHashResults
    return mainHashResults
  }

  // fast version of what is above.  This is what we really need for production
  // it should be pretty close to working now that other issues with timestamps were fixed.
  // should test and re-enable it.
  //    This function is important because it scales much much better than the above as the number
  //    of accounts gets large.
  buildPartitionHashesForNode_fast(cycleShardData: CycleShardData): MainHashResults {
    //the line below is too slow.. needs to be in an ultra verbose categor that we dont have, so for now you have to uncomment it on manually
    //if (logFlags.verbose) this.mainLogger.debug(`accountsHashCache3 ${cycleShardData.cycleNumber}: ${utils.stringifyReduce(this.accountsHashCache3)}`)

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
    for (
      let index = 0;
      index < this.accountsHashCache3.futureHistoryList.accountHashesSorted.length;
      index++
    ) {
      let accountHashData: AccountHashCache =
        this.accountsHashCache3.futureHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        //holes++
        continue
      }
      let accountID = this.accountsHashCache3.futureHistoryList.accountIDs[index]

      if (this.accountsHashCache3.accountHashMap.has(accountID) == false) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`buildPartitionHashesForNode: missing accountID:${accountID} index:${index} len:${this.accountsHashCache3.futureHistoryList.accountHashesSorted.length}`)
        continue
      }

      let accountHashCacheHistory: AccountHashCacheHistory =
        this.accountsHashCache3.accountHashMap.get(accountID)
      if (accountHashData.c <= cycleToProcess) {
        this.accountsHashCache3.workingHistoryList.accountHashesSorted.push(accountHashData)
        this.accountsHashCache3.workingHistoryList.accountIDs.push(accountID)

        // tricky part here.. we need to clear this entry out of the earlier spot in the working list
        // this was not something we could do earlier since we were in the future list
        if (accountHashCacheHistory.lastSeenSortIndex > -1) {
          this.accountsHashCache3.workingHistoryList.accountHashesSorted[
            accountHashCacheHistory.lastSeenSortIndex
          ] = null
          this.accountsHashCache3.workingHistoryList.accountIDs[accountHashCacheHistory.lastSeenSortIndex] =
            null
        }

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

        // // tricky part here.. we need to clear this entry out of the earlier spot in the working list
        // // this was not something we could do earlier since we were in the future list
        // if(accountHashCacheHistory.lastSeenSortIndex > -1){
        //   this.accountsHashCache3.workingHistoryList.accountHashesSorted[accountHashCacheHistory.lastSeenSortIndex] = null
        //   this.accountsHashCache3.workingHistoryList.accountIDs[accountHashCacheHistory.lastSeenSortIndex] = null
        // }
      }
    }

    // process the working list.  split data into partitions and build a new list with nulled spots cleared out
    for (
      let index = 0;
      index < this.accountsHashCache3.workingHistoryList.accountHashesSorted.length;
      index++
    ) {
      let accountHashData: AccountHashCache =
        this.accountsHashCache3.workingHistoryList.accountHashesSorted[index]
      if (accountHashData == null) {
        //if this is null then it is blank entry (by design how we remove from the array at run time and retain perf)
        holes++
        continue
      }
      let accountID = this.accountsHashCache3.workingHistoryList.accountIDs[index]
      if (accountID == null) {
        //should never be null if accountHashData was not null
        this.statemanager_fatal(
          'buildPartitionHashesForNode: accountID==null unexpected',
          `buildPartitionHashesForNode: accountID==null unexpected:${utils.stringifyReduce(accountHashData)} `
        )
        continue
      }
      //Start building the mainHashResults structure

      //split data into partitions.  Get the partition for this account
      let partitionHashResults: PartitionHashResults = null
      let { homePartition: partition } = ShardFunctions.addressToPartition(
        cycleShardData.shardGlobals,
        accountID
      )
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
    if (holes > 0) {
      //compact working list.
      let compactedWorkingList: AccountHashCacheList = {
        accountHashesSorted: [],
        accountIDs: [],
      }
      nextWorkingIndex = 0
      for (
        let index = 0;
        index < this.accountsHashCache3.workingHistoryList.accountHashesSorted.length;
        index++
      ) {
        let accountHashData: AccountHashCache =
          this.accountsHashCache3.workingHistoryList.accountHashesSorted[index]
        if (accountHashData == null) {
          continue
        }
        let accountID = this.accountsHashCache3.workingHistoryList.accountIDs[index]
        if (accountID == null) {
          continue
        }
        let accountHashCacheHistory: AccountHashCacheHistory =
          this.accountsHashCache3.accountHashMap.get(accountID)
        compactedWorkingList.accountHashesSorted.push(accountHashData)
        compactedWorkingList.accountIDs.push(accountID)
        accountHashCacheHistory.lastSeenSortIndex = nextWorkingIndex
        nextWorkingIndex++
      }
      this.accountsHashCache3.workingHistoryList = compactedWorkingList
    }
    return mainHashResults
  }

  // currently a sync function, dont have correct buffers for async
  processCacheUpdates(
    cycleShardData: CycleShardData,
    debugAC3: AccountHashCacheMain3 = null,
    debugAccount: string = null
  ): void {
    // OFFLINE DEBUGGING
    // if(debugAC3 != null){
    //   this.accountsHashCache3 = debugAC3
    // }

    //the line below is too slow.. needs to be in an ultra verbose categor that we dont have, so for now you have to uncomment it on manually
    //if (logFlags.verbose) this.mainLogger.debug(`accountsHashCache3 ${cycleShardData.cycleNumber}: ${utils.stringifyReduce(this.accountsHashCache3)}`)

    let cycleToProcess = cycleShardData.cycleNumber
    let nextCycleToProcess = cycleToProcess + 1

    let nextCacheUpdateQueue: AccountHashCacheList = {
      accountHashesSorted: [],
      accountIDs: [],
    }

    //rebuild the working list with out selected data from the map
    this.accountsHashCache3.workingHistoryList.accountHashesSorted = []
    this.accountsHashCache3.workingHistoryList.accountIDs = []

    // process the working list.  split data into partitions and build a new list with nulled spots cleared out
    for (let index = 0; index < this.cacheUpdateQueue.accountIDs.length; index++) {
      let accountHashData: AccountHashCache = this.cacheUpdateQueue.accountHashesSorted[index]
      if (accountHashData == null) {
        //if this is null then it is blank entry (by design how we remove from the array at run time and retain perf)
        continue
      }
      let accountID = this.cacheUpdateQueue.accountIDs[index]
      if (accountID == null) {
        //should never be null if accountHashData was not null
        this.statemanager_fatal(
          'buildPartitionHashesForNode: accountID==null unexpected',
          `buildPartitionHashesForNode: accountID==null unexpected:${utils.stringifyReduce(accountHashData)} `
        )
        continue
      }

      //if we cycle is too new then put in next list:

      if (accountHashData.c > cycleToProcess) {
        nextCacheUpdateQueue.accountHashesSorted.push(accountHashData)
        nextCacheUpdateQueue.accountIDs.push(accountID)
        continue
      }

      //DONT TEST IN RANGE!!  because it may be in range later
      // let { homePartition: partition } = ShardFunctions.addressToPartition(cycleShardData.shardGlobals, accountID)
      // //if we do not store this partition then dont put it in a report.  tell the trie to remove it.
      // //TODO perf, will need something more efficient.
      // if(ShardFunctions.testInRange(partition, cycleShardData.nodeShardData.storedPartitions) === false){
      //   this.stateManager.accountPatcher.removeAccountHash(accountID)
      //   let accountHashCacheHistory: AccountHashCacheHistory = this.accountsHashCache3.accountHashMap.get(accountID)
      //   if(cycleToProcess > accountHashCacheHistory.lastStaleCycle){
      //     accountHashCacheHistory.lastStaleCycle = cycleToProcess
      //   }
      //   continue
      // }

      //very important call in the data pipeline.
      this.stateManager.accountPatcher.updateAccountHash(accountID, accountHashData.h)
    }

    this.cacheUpdateQueue = nextCacheUpdateQueue

    // update the cycle we are tracking now
    this.accountsHashCache3.currentCalculationCycle = nextCycleToProcess
  }

  getAccountDebugObject(id: string): any {
    let accountHashFull = this.stateManager.accountCache.accountsHashCache3.accountHashMap.get(id)
    return accountHashFull
  }

  //temp to hide some internal fields
  getDebugStats(): any[] {
    let workingAccounts = this.accountsHashCache3.workingHistoryList.accountIDs.length
    //this.addToReport('StateManager','AccountsCache', 'workingAccounts', cacheCount )
    let mainMap = this.accountsHashCache3.accountHashMap.size
    //this.addToReport('StateManager','AccountsCache', 'mainMap', cacheCount2 )

    return [workingAccounts, mainMap]
  }

  getAccountHashHistoryItem(accountID: string): AccountHashCacheHistory {
    let accountHashCacheHistory: AccountHashCacheHistory =
      this.stateManager.accountCache.accountsHashCache3.accountHashMap.get(accountID)
    return accountHashCacheHistory
  }
}

export default AccountCache
