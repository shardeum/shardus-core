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

// const cHashSetStepSize = 4
// const cHashSetTXStepSize = 2
// const cHashSetDataStepSize = 2

class Depricated {
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

  // sentReceipts: Map<string, boolean>
  // sendArchiveData: boolean
  // purgeArchiveData: boolean

  // /** tracks state for repairing partitions. index by cycle counter key to get the repair object, index by parition  */
  // repairTrackingByCycleById: { [cycleKey: string]: { [id: string]: RepairTracker } }
  // /** UpdateRepairData by cycle key */
  // repairUpdateDataByCycle: { [cycleKey: string]: UpdateRepairData[] }

  // applyAllPreparedRepairsRunning: boolean

  // repairStartedMap: Map<string, boolean>
  // repairCompletedMap: Map<string, boolean>
  // dataRepairStack: RepairTracker[]

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

    // this.sentReceipts = new Map()

    // this.sendArchiveData = false
    // this.purgeArchiveData = false

    // this.repairTrackingByCycleById = {}
    // this.repairUpdateDataByCycle = {}
    // this.applyAllPreparedRepairsRunning = false

    // this.repairStartedMap = new Map()
    // this.repairCompletedMap = new Map()
    // this.dataRepairStack = []
  }

  //NOT used but seem possibly usefull...
  purgeTransactionData() {
    let tsStart = 0
    let tsEnd = 0
    this.storage.clearAcceptedTX(tsStart, tsEnd)
  }

  purgeStateTableData() {
    // do this by timestamp maybe..
    // this happnes on a slower scale.
    let tsEnd = 0 // todo get newest time to keep
    this.storage.clearAccountStateTableOlderThan(tsEnd)
  }

  /***
   *    ##     ##    ###    ##    ## ########  ##       ######## ########   ######
   *    ##     ##   ## ##   ###   ## ##     ## ##       ##       ##     ## ##    ##
   *    ##     ##  ##   ##  ####  ## ##     ## ##       ##       ##     ## ##
   *    ######### ##     ## ## ## ## ##     ## ##       ######   ########   ######
   *    ##     ## ######### ##  #### ##     ## ##       ##       ##   ##         ##
   *    ##     ## ##     ## ##   ### ##     ## ##       ##       ##    ##  ##    ##
   *    ##     ## ##     ## ##    ## ########  ######## ######## ##     ##  ######
   */

  setupHandlers() {
    // // /get_account_data (Acc_start, Acc_end)
    // // Acc_start - get data for accounts starting with this account id; inclusive
    // // Acc_end - get data for accounts up to this account id; inclusive
    // // Returns data from the application Account Table; limits result to 300 records (as configured);
    // // For applications with multiple “Account” tables the returned data is grouped by table name.
    // // For example: [ {Acc_id, State_after, Acc_data}, { … }, ….. ]
    // // Updated names:  accountStart , accountEnd
    // this.p2p.registerInternal('get_account_data', async (payload: GetAccountDataReq, respond: (arg0: { accountData: Shardus.WrappedData[] | null }) => any) => {
    //     throw new Error('get_account_data endpoint retired')
    //     // let result = {} as {accountData: Shardus.WrappedData[] | null}//TSConversion  This is complicated !! check app for details.
    //     // let accountData = null
    //     // let ourLockID = -1
    //     // try {
    //     //   ourLockID = await this.fifoLock('accountModification')
    //     //   accountData = await this.app.getAccountData(payload.accountStart, payload.accountEnd, payload.maxRecords)
    //     // } finally {
    //     //   this.fifoUnlock('accountModification', ourLockID)
    //     // }
    //     // //PERF Disiable this in production or performance testing.
    //     // this.testAccountDataWrapped(accountData)
    //     // result.accountData = accountData
    //     // await respond(result)
    //   })
    // // After joining the network
    // //   Record Joined timestamp
    // //   Even a syncing node will receive accepted transactions
    // //   Starts receiving accepted transaction and saving them to Accepted Tx Table
    // this.p2p.registerGossipHandler('acceptedTx', async (acceptedTX: AcceptedTx, sender: Shardus.Node, tracker: string) => {
    //   // docs mention putting this in a table but it seems so far that an in memory queue should be ok
    //   // should we filter, or instead rely on gossip in to only give us TXs that matter to us?
    //   this.p2p.sendGossipIn('acceptedTx', acceptedTX, tracker, sender)
    //   let noConsensus = false // this can only be true for a set command which will never come from an endpoint
    //   this.stateManager.transactionQueue.routeAndQueueAcceptedTransaction(acceptedTX, /*sendGossip*/ false, sender, /*globalModification*/ false, noConsensus)
    //   //Note await not needed so beware if you add code below this.
    // })
    // // /get_accepted_transactions (Ts_start, Ts_end)
    // // Ts_start - get data newer than this timestamp
    // // Ts_end - get data older than this timestamp
    // // Returns data from the Accepted Tx Table starting with Ts_start; limits result to 500 records (as configured)
    // // Updated names: tsStart, tsEnd
    // this.p2p.registerInternal('get_accepted_transactions', async (payload: AcceptedTransactionsReq, respond: (arg0: { transactions: Shardus.AcceptedTx[] }) => any) => {
    //   let result = {} as { transactions: Shardus.AcceptedTx[] }
    //   if (!payload.limit) {
    //     payload.limit = 10
    //   }
    //   let transactions = await this.storage.queryAcceptedTransactions(payload.tsStart, payload.tsEnd, payload.limit)
    //   result.transactions = transactions
    //   await respond(result)
    // })
    // this.p2p.registerInternal('get_account_data2', async (payload: GetAccountData2Req, respond: (arg0: { accountData: Shardus.WrappedData[] | null }) => any) => {
    //     let result = {} as { accountData: Shardus.WrappedData[] | null } //TSConversion  This is complicated !!
    //     let accountData = null
    //     let ourLockID = -1
    //     try {
    //       ourLockID = await this.fifoLock('accountModification')
    //       accountData = await this.app.getAccountDataByRange(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd, payload.maxRecords)
    //     } finally {
    //       this.fifoUnlock('accountModification', ourLockID)
    //     }
    //     //PERF Disiable this in production or performance testing.
    //     this.testAccountDataWrapped(accountData)
    //     result.accountData = accountData
    //     await respond(result)
    //   })
    // // /get_transactions_by_list (Tx_ids)
    // //   Tx_ids - array of transaction ids
    // //   Returns data from the Transactions Table for just the given transaction ids
    // this.p2p.registerInternal('get_transactions_by_list', async (payload: GetTransactionsByListReq, respond: (arg0: Shardus.AcceptedTx[]) => any) => {
    //     let result = [] as AcceptedTx[]
    //     try {
    //       result = await this.storage.queryAcceptedTransactionsByIds(payload.Tx_ids)
    //     } finally {
    //     }
    //     await respond(result)
    //   })
    // this.p2p.registerInternal('get_transactions_by_partition_index', async (payload: TransactionsByPartitionReq, respond: (arg0: TransactionsByPartitionResp) => any) => {
    //     // let result = {}
    //     let passFailList = []
    //     let statesList = []
    //     let acceptedTXs = null
    //     try {
    //       // let partitionId = payload.partitionId
    //       let cycle = payload.cycle
    //       let indicies = payload.tx_indicies
    //       let hash = payload.hash
    //       let partitionId = payload.partitionId
    //       let expectedResults = indicies.length
    //       let returnedResults = 0
    //       let key = 'c' + cycle
    //       let partitionObjectsByHash = this.partitionObjects.recentPartitionObjectsByCycleByHash[key]
    //       if (!partitionObjectsByHash) {
    //         await respond({ success: false })
    //       }
    //       let partitionObject = partitionObjectsByHash[hash]
    //       if (!partitionObject) {
    //         await respond({ success: false })
    //       }
    //       let txIDList = []
    //       for (let index of indicies) {
    //         let txid = partitionObject.Txids[index]
    //         txIDList.push(txid)
    //         let passFail = partitionObject.Status[index]
    //         passFailList.push(passFail)
    //       }
    //       for (let index of indicies) {
    //         let state = partitionObject.States[index]
    //         statesList.push(state)
    //         if (state != null) {
    //           returnedResults++
    //         }
    //       }
    //       if (returnedResults < expectedResults) {
    //         if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index failed! returnedResults < expectedResults send ${returnedResults} < ${expectedResults}`)
    //       }
    //       acceptedTXs = await this.storage.queryAcceptedTransactionsByIds(txIDList)
    //       // if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index failed! returnedResults < expectedResults send2 `)
    //       if (acceptedTXs != null && acceptedTXs.length < expectedResults) {
    //         if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index results ${utils.stringifyReduce(acceptedTXs)} snippets ${utils.stringifyReduce(payload.debugSnippets)} `)
    //         if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index results2:${utils.stringifyReduce(acceptedTXs.map((x: Shardus.AcceptedTx) => x.id))} snippets:${utils.stringifyReduce(payload.debugSnippets)} txid:${utils.stringifyReduce(txIDList)} `)
    //         let acceptedTXsBefore = 0
    //         if (acceptedTXs != null) {
    //           acceptedTXsBefore = acceptedTXs.length
    //         }
    //         // find an log missing results:
    //         // for(let txid of txIDList)
    //         let received: StringBoolObjectMap = {}
    //         for (let acceptedTX of acceptedTXs) {
    //           received[acceptedTX.id] = true
    //         }
    //         let missingTXs: string[] = []
    //         let missingTXHash: StringBoolObjectMap = {}
    //         for (let txid of txIDList) {
    //           if (received[txid] !== true) {
    //             missingTXs.push(txid)
    //             missingTXHash[txid] = true
    //           }
    //         }
    //         let finds = -1
    //         let txTally = this.partitionObjects.getTXList(cycle, partitionId)
    //         let found = []
    //         if (txTally) {
    //           finds = 0
    //           for (let tx of txTally.txs) {
    //             if (missingTXHash[tx.id] === true) {
    //               finds++
    //               acceptedTXs.push(tx)
    //               found.push(tx.id)
    //             }
    //           }
    //         }
    //         if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index failed! returnedResults < expectedResults send3 ${acceptedTXsBefore} < ${expectedResults} findsFixed: ${finds}  missing: ${utils.stringifyReduce(missingTXs)} found: ${utils.stringifyReduce(found)} acceptedTXs.length updated: ${acceptedTXs.length}`)
    //       } else {
    //       }
    //     } catch (ex) {
    //       this.statemanager_fatal(`get_transactions_by_partition_index_ex`, 'get_transactions_by_partition_index failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    //     } finally {
    //     }
    //     // TODO fix pass fail sorting.. it is probably all wrong and out of sync, but currently nothing fails.
    //     await respond({ success: true, acceptedTX: acceptedTXs, passFail: passFailList, statesList: statesList })
    //   })
    //   // /get_partition_txids (Partition_id, Cycle_number)
    //   //   Partition_id
    //   //   Cycle_number
    //   //   Returns the partition object which contains the txids along with the status
    //   this.p2p.registerInternal('get_partition_txids', async (payload: GetPartitionTxidsReq, respond: (arg0: {}) => any) => {
    //     let result = {}
    //     try {
    //       let id = payload.Partition_id
    //       let key = 'c' + payload.Cycle_number
    //       let partitionObjects = this.partitionObjects.partitionObjectsByCycle[key]
    //       for (let obj of partitionObjects) {
    //         if (obj.Partition_id === id) {
    //           result = obj
    //         }
    //       }
    //     } finally {
    //     }
    //     await respond(result)
    //   })
  }

  /***
   *    ##     ## ####  ######   ######
   *    ###   ###  ##  ##    ## ##    ##
   *    #### ####  ##  ##       ##
   *    ## ### ##  ##   ######  ##
   *    ##     ##  ##        ## ##
   *    ##     ##  ##  ##    ## ##    ##
   *    ##     ## ####  ######   ######
   */

  //   /**
  //    * sendPartitionData
  //    * @param {PartitionReceipt} partitionReceipt
  //    * @param {PartitionObject} paritionObject
  //    */
  //   sendPartitionData(partitionReceipt: PartitionReceipt, paritionObject: PartitionObject) {
  //     if (partitionReceipt.resultsList.length === 0) {
  //       return
  //     }
  //     // CombinedPartitionReceipt

  //     let partitionReceiptCopy = JSON.parse(stringify(partitionReceipt.resultsList[0]))

  //     /** @type {CombinedPartitionReceipt} */
  //     let combinedReciept = { result: partitionReceiptCopy, signatures: partitionReceipt.resultsList.map((a) => a.sign) }

  //     if (logFlags.verbose) this.mainLogger.debug(' sendPartitionData ' + utils.stringifyReduceLimit({ combinedReciept, paritionObject }))

  //     // send it
  //     // this.p2p.archivers.sendPartitionData(combinedReciept, paritionObject)
  //   }

  //   sendTransactionData(partitionNumber: number, cycleNumber: number, transactions: AcceptedTx[]) {
  //     if (logFlags.verbose) this.mainLogger.debug(' sendTransactionData ' + utils.stringifyReduceLimit({ partitionNumber, cycleNumber, transactions }))

  //     // send it
  //     // this.p2p.archivers.sendTransactionData(partitionNumber, cycleNumber, transactions)
  //   }

  //   /**
  //    * trySendAndPurgeReciepts
  //    * @param {PartitionReceipt} partitionReceipt
  //    */
  //   trySendAndPurgeReceiptsToArchives(partitionReceipt: PartitionReceipt) {
  //     if (partitionReceipt.resultsList.length === 0) {
  //       return
  //     }
  //     let cycleNumber = partitionReceipt.resultsList[0].Cycle_number
  //     let partitionId = partitionReceipt.resultsList[0].Partition_id
  //     let key = `c${cycleNumber}p${partitionId}`
  //     if (this.sentReceipts.has(key)) {
  //       return
  //     }

  //     if (logFlags.verbose) this.mainLogger.debug(' trySendAndPurgeReceipts ' + key)

  //     this.sentReceipts.set(key, true)
  //     try {
  //       if (this.sendArchiveData === true) {
  //         let paritionObject = this.getPartitionObject(cycleNumber, partitionId) // todo get object
  //         if (paritionObject == null) {
  //           this.statemanager_fatal(`trySendAndPurgeReceiptsToArchives`, ` trySendAndPurgeReceiptsToArchives paritionObject == null ${cycleNumber} ${partitionId}`)
  //           throw new Error(`trySendAndPurgeReceiptsToArchives paritionObject == null`)
  //         }
  //         this.sendPartitionData(partitionReceipt, paritionObject)
  //       }
  //     } finally {
  //     }

  //     if (this.sendTransactionData) {
  //     //   let txList = this.stateManager.partitionObjects.getTXList(cycleNumber, partitionId)

  //     //   this.sendTransactionData(partitionId, cycleNumber, txList.txs)
  //     }

  //     if (this.purgeArchiveData === true) {
  //       // alreay sort of doing this in another spot.
  //       // check if all partitions for this cycle have been handled!! then clear data in that time range.
  //       // need to record time range.
  //       // or check for open repairs. older than what we want to clear out.
  //     }
  //   }

  //   storeOurPartitionReceipt(cycleNumber: number, partitionReceipt: PartitionReceipt) {
  //     let key = 'c' + cycleNumber

  //     if (!this.stateManager.ourPartitionReceiptsByCycleCounter) {
  //       this.stateManager.ourPartitionReceiptsByCycleCounter = {}
  //     }
  //     this.stateManager.ourPartitionReceiptsByCycleCounter[key] = partitionReceipt
  //   }

  //   getPartitionReceipt(cycleNumber: number) {
  //     let key = 'c' + cycleNumber

  //     if (!this.stateManager.ourPartitionReceiptsByCycleCounter) {
  //       return null
  //     }
  //     return this.stateManager.ourPartitionReceiptsByCycleCounter[key]
  //   }

  //   /**
  //    * getPartitionObject
  //    * @param {number} cycleNumber
  //    * @param {number} partitionId
  //    * @returns {PartitionObject}
  //    */
  //   getPartitionObject(cycleNumber: number, partitionId: number): PartitionObject | null {
  //     let key = 'c' + cycleNumber
  //     let partitionObjects = this.stateManager.partitionObjects.partitionObjectsByCycle[key]
  //     for (let obj of partitionObjects) {
  //       if (obj.Partition_id === partitionId) {
  //         return obj
  //       }
  //     }
  //     return null
  //   }

  /***
   *    ##     ##    ###     ######  ##     ##        ######  ######## ########  ######
   *    ##     ##   ## ##   ##    ## ##     ##       ##    ## ##          ##    ##    ##
   *    ##     ##  ##   ##  ##       ##     ##       ##       ##          ##    ##
   *    ######### ##     ##  ######  #########        ######  ######      ##     ######
   *    ##     ## #########       ## ##     ##             ## ##          ##          ##
   *    ##     ## ##     ## ##    ## ##     ##       ##    ## ##          ##    ##    ##
   *    ##     ## ##     ##  ######  ##     ##        ######  ########    ##     ######
   */

  //   /**
  //    * findMostCommonResponse
  //    * @param {number} cycleNumber
  //    * @param {number} partitionId
  //    * @param {string[]} ignoreList currently unused and broken todo resolve this.
  //    * @return {{topHash: string, topCount: number, topResult: PartitionResult}}
  //    */
  //   findMostCommonResponse(cycleNumber: number, partitionId: number, ignoreList: string[]): { topHash: string | null; topCount: number; topResult: PartitionResult | null } {
  //     let key = 'c' + cycleNumber
  //     let responsesById = this.stateManager.partitionObjects.allPartitionResponsesByCycleByPartition[key]
  //     let key2 = 'p' + partitionId
  //     let responses = responsesById[key2]

  //     let hashCounting: StringNumberObjectMap = {}
  //     let topHash = null
  //     let topCount = 0
  //     let topResult = null
  //     if (responses.length > 0) {
  //       for (let partitionResult of responses) {
  //         let hash = partitionResult.Partition_hash
  //         let count = hashCounting[hash] || 0
  //         count++
  //         hashCounting[hash] = count
  //         if (count > topCount) {
  //           topCount = count
  //           topHash = hash
  //           topResult = partitionResult
  //         }
  //       }
  //     }
  //     // reaponsesById: ${utils.stringifyReduce(responsesById)}
  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair findMostCommonResponse: retVal: ${utils.stringifyReduce({ topHash, topCount, topResult })}  responses: ${utils.stringifyReduce(responses)} `)
  //     return { topHash, topCount, topResult }
  //   }

  //   // vote rate set to 0.5 / 0.8 => 0.625
  //   /**
  //    * solveHashSets
  //    * @param {GenericHashSetEntry[]} hashSetList
  //    * @param {number} lookAhead
  //    * @param {number} voteRate
  //    * @param {string[]} prevOutput
  //    * @returns {string[]}
  //    */
  //   static solveHashSets(hashSetList: GenericHashSetEntry[], lookAhead: number = 10, voteRate: number = 0.625, prevOutput: string[] | null = null): string[] {
  //     let output = []
  //     let outputVotes = []
  //     let solving = true
  //     let index = 0
  //     let lastOutputCount = 0 // output list length last time we went through the loop
  //     let stepSize = cHashSetStepSize

  //     let totalVotePower = 0
  //     for (let hashListEntry of hashSetList) {
  //       totalVotePower += hashListEntry.votePower
  //     }
  //     let votesRequired = voteRate * Math.ceil(totalVotePower)

  //     let maxElements = 0
  //     for (let hashListEntry of hashSetList) {
  //       maxElements = Math.max(maxElements, hashListEntry.hashSet.length / stepSize)
  //     }

  //     while (solving) {
  //       let votes: StringCountEntryObjectMap = {}
  //       let topVote: Vote = { v: '', count: 0, vote: undefined, ec: undefined }
  //       let winnerFound = false
  //       let totalVotes = 0
  //       // Loop through each entry list
  //       for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
  //         // if we are already past the end of this entry list then skip
  //         let hashListEntry = hashSetList[hashListIndex]
  //         if ((index + hashListEntry.indexOffset + 1) * stepSize > hashListEntry.hashSet.length) {
  //           continue
  //         }
  //         // don't remember what this bail condition was.
  //         let sliceStart = (index + hashListEntry.indexOffset) * stepSize
  //         let v = hashListEntry.hashSet.slice(sliceStart, sliceStart + stepSize)
  //         if (v === '') {
  //           continue
  //         }
  //         // place votes for this value
  //         let countEntry: CountEntry = votes[v] || { count: 0, ec: 0, voters: [] }
  //         totalVotes += hashListEntry.votePower
  //         countEntry.count += hashListEntry.votePower
  //         countEntry.voters.push(hashListIndex)
  //         votes[v] = countEntry
  //         if (countEntry.count > topVote.count) {
  //           topVote.count = countEntry.count
  //           topVote.v = v
  //           topVote.vote = countEntry
  //         }
  //         hashListEntry.lastValue = v
  //       }

  //       // if totalVotes < votesRequired then we are past hope of approving any more messages... I think.  I guess there are some cases where we could look back and approve one more
  //       if (topVote.count === 0 || index > maxElements || totalVotes < votesRequired) {
  //         solving = false
  //         break
  //       }
  //       // can we find a winner in a simple way where there was a winner based on the next item to look at in all the arrays.
  //       if (topVote.count >= votesRequired) {
  //         winnerFound = true
  //         output.push(topVote.v)
  //         outputVotes.push(topVote)
  //         // corrections for chains that do not match our top vote.
  //         for (let k = 0; k < hashSetList.length; k++) {
  //           let hashListEntryOther = hashSetList[k]
  //           if (hashListEntryOther.lastValue === topVote.v) {
  //             hashListEntryOther.errorStack = []
  //           }
  //         }
  //       }

  //       // Leaving this here, because it is a good spot to put a breakpoint when testing a data set where stuf went wrong (hashset.js)
  //       // if (index === 123) {
  //       //   let foo = 5
  //       //   foo++
  //       // }

  //       // for (let hashListEntry of hashSetList) {
  //       for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
  //         let hashListEntry = hashSetList[hashListIndex]
  //         // for nodes that did not match the top vote .. or all nodes if no winner yet.
  //         if (!winnerFound || hashListEntry.lastValue !== topVote.v) {
  //           // consider removing v..  since if we dont have a winner yet then top vote will get updated in this loop
  //           hashListEntry.corrections.push({ i: index, tv: topVote, v: topVote.v, t: 'insert', bv: hashListEntry.lastValue, if: lastOutputCount })
  //           hashListEntry.errorStack.push({ i: index, tv: topVote, v: topVote.v })
  //           hashListEntry.indexOffset -= 1

  //           if (hashListEntry.waitForIndex > 0 && index < hashListEntry.waitForIndex) {
  //             continue
  //           }

  //           if (hashListEntry.waitForIndex > 0 && hashListEntry.waitForIndex === index) {
  //             hashListEntry.waitForIndex = -1
  //             hashListEntry.waitedForThis = true
  //           }

  //           let alreadyVoted: StringBoolObjectMap = {} // has the given node already EC voted for this key?
  //           // +1 look ahead to see if we can get back on track
  //           // lookAhead of 0 seems to be more stable
  //           // let lookAhead = 10 // hashListEntry.errorStack.length
  //           for (let i = 0; i < hashListEntry.errorStack.length + lookAhead; i++) {
  //             // using +2 since we just subtracted one from the index offset. anothe r +1 since we want to look ahead of where we just looked
  //             let thisIndex = index + hashListEntry.indexOffset + i + 2
  //             let sliceStart = thisIndex * stepSize
  //             if (sliceStart + 1 > hashListEntry.hashSet.length) {
  //               continue
  //             }
  //             let v = hashListEntry.hashSet.slice(sliceStart, sliceStart + stepSize)
  //             if (alreadyVoted[v]) {
  //               continue
  //             }

  //             // a hint to stop us from looking ahead too far
  //             // if (prevOutput && prevOutput[index + i + 2] === v) {
  //             //   break
  //             // }

  //             // scan ahead for other connections
  //             if (prevOutput && !hashListEntry.waitedForThis) {
  //               let foundMatch = false
  //               let searchAhead = 5 // Math.max(10, lookAhead - i)
  //               for (let k = 1; k < searchAhead; k++) {
  //                 let idx = index + k // + 2 + hashListEntry.indexOffset
  //                 if (prevOutput.length <= idx) {
  //                   break
  //                 }
  //                 if (prevOutput && prevOutput[idx] === v) {
  //                   foundMatch = true
  //                   hashListEntry.waitForIndex = index + k
  //                   hashListEntry.futureIndex = index + hashListEntry.indexOffset + i + 2
  //                   hashListEntry.futureValue = v
  //                 }
  //               }
  //               if (foundMatch) {
  //                 break
  //               }
  //             }

  //             alreadyVoted[v] = true
  //             let countEntry: CountEntry = votes[v] || { count: 0, ec: 0, voters: [] } // TSConversion added a missing voters[] object here. looks good to my code inspection but need to validate it with tests!

  //             // only vote 10 spots ahead
  //             if (i < 10) {
  //               countEntry.ec += hashListEntry.votePower
  //             }

  //             // check for possible winnner due to re arranging things
  //             // a nuance here that we require there to be some official votes before in this row before we consider a tx..  will need to analyze this choice
  //             if (!winnerFound && countEntry.count > 0 && countEntry.ec + countEntry.count >= votesRequired) {
  //               topVote.ec = countEntry.ec
  //               topVote.v = v
  //               topVote.vote = countEntry
  //               winnerFound = true
  //               output.push(topVote.v)
  //               outputVotes.push(topVote)
  //               // todo roll back corrctions where nodes were already voting for the winner.
  //               for (let k = 0; k < hashListIndex; k++) {
  //                 let hashListEntryOther = hashSetList[k]
  //                 if (hashListEntryOther.lastValue === topVote.v) {
  //                   hashListEntryOther.errorStack.pop()
  //                   hashListEntryOther.corrections.pop()
  //                   hashListEntryOther.indexOffset++
  //                 }
  //               }
  //             }

  //             if (winnerFound) {
  //               if (v === topVote.v) {
  //                 if (hashListEntry.waitedForThis) {
  //                   hashListEntry.waitedForThis = false
  //                 }
  //                 // delete stuff off stack and bail
  //                 // +1 because we at least want to delete 1 entry if index i=0 of this loop gets us here

  //                 /** @type {HashSetEntryCorrection[]} */
  //                 let tempCorrections = []
  //                 // for (let j = 0; j < i + 1; j++) {
  //                 //   let correction = null
  //                 //   //if (i < hashListEntry.errorStack.length)
  //                 //   {
  //                 //     hashListEntry.errorStack.pop()
  //                 //     correction = hashListEntry.corrections.pop()
  //                 //   }
  //                 //   tempCorrections.push({ i: index - j, t: 'extra', c: correction })
  //                 // }
  //                 let index2 = index + hashListEntry.indexOffset + i + 2
  //                 let lastIdx = -1

  //                 for (let j = 0; j < i + 1; j++) {
  //                   /** @type {HashSetEntryCorrection} */
  //                   let correction = null
  //                   if (hashListEntry.errorStack.length > 0) {
  //                     hashListEntry.errorStack.pop()
  //                     correction = hashListEntry.corrections.pop()
  //                   }
  //                   let extraIdx = j + index2 - (i + 1)
  //                   if (correction) {
  //                     extraIdx = correction.i - 1
  //                     lastIdx = extraIdx
  //                   } else if (lastIdx > 0) {
  //                     extraIdx = lastIdx
  //                   }
  //                   // correction to fix problem where we were over deleting stuff.
  //                   // a bit more retroactive than I like.  problem happens in certain cases when there are two winners in a row that are not first pass winners
  //                   // see 16z for example where this breaks..
  //                   // if (hashListEntry.corrections.length > 0) {
  //                   //   let nextCorrection = hashListEntry.corrections[hashListEntry.corrections.length - 1]
  //                   //   if (nextCorrection && correction && nextCorrection.bv === correction.bv) {
  //                   //     if (logFlags.verbose) this.mainLogger.debug( ` solveHashSets overdelete fix: i:${i} j:${j} index:${index} bv:${nextCorrection.bv}}`)
  //                   //     continue
  //                   //   }
  //                   // }

  //                   // hashListEntry.indexOffset++
  //                   /** @type {HashSetEntryCorrection} */

  //                   // @ts-ignore  solveHashSets is unused at the moment not going to bother with ts fixup
  //                   let tempCorrection: HashSetEntryCorrection = { i: extraIdx, t: 'extra', c: correction, hi: index2 - (j + 1), tv: null, v: null, bv: null, if: -1 } // added tv: null, v: null, bv: null, if: -1
  //                   tempCorrections.push(tempCorrection)
  //                 }

  //                 hashListEntry.corrections = hashListEntry.corrections.concat(tempCorrections)
  //                 // +2 so we can go from being put one behind and go to 1 + i ahead.
  //                 hashListEntry.indexOffset += i + 2

  //                 // hashListEntry.indexOffset += (1)

  //                 hashListEntry.errorStack = [] // clear the error stack
  //                 break
  //               } else {
  //                 // backfil checking
  //                 // let outputIndex = output.length - 1
  //                 // let tempV = v
  //                 // let stepsBack = 1
  //                 // while (output.length > 0 && outputIndex > 0 && output[outputIndex] === tempV) {
  //                 //   // work backwards through continuous errors and redact them as long as they match up
  //                 //   outputIndex--
  //                 //   stepsBack++
  //                 // }
  //               }
  //             }
  //           }

  //           if (hashListEntry.waitedForThis) {
  //             hashListEntry.waitedForThis = false
  //           }
  //         }
  //       }
  //       index++
  //       lastOutputCount = output.length
  //     }

  //     // trailing extras cleanup.
  //     for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
  //       let hashListEntry = hashSetList[hashListIndex]

  //       let extraIdx = index
  //       while ((extraIdx + hashListEntry.indexOffset) * stepSize < hashListEntry.hashSet.length) {
  //         let hi = extraIdx + hashListEntry.indexOffset // index2 - (j + 1)
  //         // @ts-ignore  solveHashSets is unused at the moment not going to bother with ts fixup
  //         hashListEntry.corrections.push({ i: extraIdx, t: 'extra', c: null, hi: hi, tv: null, v: null, bv: null, if: -1 }) // added , tv: null, v: null, bv: null, if: -1
  //         extraIdx++
  //       }
  //     }

  //     return output // { output, outputVotes }
  //   }

  //   // figures out i A is Greater than B
  //   // possibly need an alternate version of this solver
  //   // needs to account for vote power!
  //   static compareVoteObjects(voteA: ExtendedVote, voteB: ExtendedVote, strict: boolean) {
  //     // { winIdx: null, val: v, count: 0, ec: 0, lowestIndex: index, voters: [], voteTally: Array(hashSetList.length) }
  //     // { i: index }

  //     let agtb = 0
  //     let bgta = 0

  //     for (let i = 0; i < voteA.voteTally.length; i++) {
  //       let vtA = voteA.voteTally[i]
  //       let vtB = voteB.voteTally[i]
  //       if (vtA != null && vtB != null) {
  //         if (vtA.i > vtB.i) {
  //           agtb += vtA.p // vote power.  note A and B are the same node so power will be equal.
  //         }
  //         if (vtB.i > vtA.i) {
  //           bgta += vtB.p // vote power.
  //         }
  //       }
  //     }
  //     // what to do with strict.
  //     if (strict && agtb > 0) {
  //       return 1
  //     }

  //     //return agtb - bgta

  //     return utils.sortAsc(agtb, bgta)

  //     // what to return?
  //   }

  //   // static compareVoteObjects2 (voteA, voteB, strict) {
  //   //   // return voteB.votesseen - voteA.votesseen
  //   //   return voteA.votesseen - voteB.votesseen
  //   // }

  //   // when sorting / computing need to figure out if pinning will short cirquit another vote.
  //   // at the moment this seems

  //   // vote rate set to 0.5 / 0.8 => 0.625
  //   /**
  //    * solveHashSets
  //    * @param {GenericHashSetEntry[]} hashSetList
  //    * @param {number} lookAhead
  //    * @param {number} voteRate
  //    *
  //    * @returns {string[]}
  //    */
  //   static solveHashSets2(hashSetList: GenericHashSetEntry[], lookAhead: number = 10, voteRate: number = 0.625): string[] {
  //     let output: string[] = []
  //     // let outputVotes = []
  //     let solving = true
  //     let index = 0
  //     let stepSize = cHashSetStepSize

  //     let totalVotePower = 0
  //     for (let hashListEntry of hashSetList) {
  //       totalVotePower += hashListEntry.votePower
  //       // init the pinIdx
  //       hashListEntry.pinIdx = -1
  //       hashListEntry.pinObj = null
  //     }
  //     let votesRequired = voteRate * Math.ceil(totalVotePower)

  //     let maxElements = 0
  //     for (let hashListEntry of hashSetList) {
  //       maxElements = Math.max(maxElements, hashListEntry.hashSet.length / stepSize)
  //     }

  //     // todo backtrack each vote. list of what vote cast at each step.
  //     // solve this for only one object... or solve for all and compare solvers?

  //     // map of array of vote entries
  //     let votes = {} as { [x: string]: ExtendedVote[] }
  //     let votesseen = 0
  //     while (solving) {
  //       // Loop through each entry list
  //       solving = false
  //       for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
  //         // if we are already past the end of this entry list then skip
  //         let hashListEntry = hashSetList[hashListIndex]
  //         if ((index + 1) * stepSize > hashListEntry.hashSet.length) {
  //           continue
  //         }
  //         // don't remember what this bail condition was.
  //         let sliceStart = index * stepSize
  //         let v = hashListEntry.hashSet.slice(sliceStart, sliceStart + stepSize)
  //         if (v === '') {
  //           continue
  //         }
  //         solving = true // keep it going
  //         let votesArray: ExtendedVote[] = votes[v]
  //         if (votesArray == null) {
  //           votesseen++
  //           //TSConversion this was potetially a major bug, v was missing from this structure before!
  //           // @ts-ignore TSConversion solveHashSets2 is unused. but need to hold off o fixing up these potential nulls
  //           let votObject: ExtendedVote = { winIdx: null, val: v, v, count: 0, ec: 0, lowestIndex: index, voters: [], voteTally: Array(hashSetList.length), votesseen } as ExtendedVote
  //           votesArray = [votObject]
  //           votes[v] = votesArray

  //           // hashListEntry.ownVotes.push(votObject)
  //         }

  //         // get lowest value in list that we have not voted on and is not pinned by our best vote.
  //         let currentVoteObject: ExtendedVote | null = null
  //         for (let voteIndex = votesArray.length - 1; voteIndex >= 0; voteIndex--) {
  //           let voteObject = votesArray[voteIndex]

  //           let ourVoteTally = voteObject.voteTally[hashListIndex]
  //           if (ourVoteTally != null) {
  //             // we voted
  //             break
  //           }

  //           // how to check pinIdx?  do we have to analys neighbor pinIdx?
  //           // use pinObj  to see if the last pinObj A is greater than this obj B.
  //           if (hashListEntry.pinObj != null && hashListEntry.pinObj !== voteObject) {
  //             // if (hashListEntry.pinObj.val === voteObject.val)
  //             {
  //               let compare = Depricated.compareVoteObjects(hashListEntry.pinObj, voteObject, false)
  //               if (compare > 0) {
  //                 continue // or break;
  //               }
  //             }
  //           }
  //           currentVoteObject = voteObject
  //         }

  //         if (currentVoteObject == null) {
  //           // create new vote object
  //           votesseen++
  //           //TSConversion this was potetially a major bug, v was missing from this structure before!
  //           // @ts-ignore TSConversion solveHashSets2 is unused. but need to hold off o fixing up these potential nulls
  //           currentVoteObject = { winIdx: null, val: v, v, count: 0, ec: 0, lowestIndex: index, voters: [], voteTally: Array(hashSetList.length), votesseen } as ExtendedVote
  //           votesArray.push(currentVoteObject)
  //           // hashListEntry.ownVotes.push(currentVoteObject)
  //         }
  //         if (currentVoteObject.voters == null) {
  //           throw new Error('solveHashSets2 currentVoteObject.voters == null')
  //         }
  //         if (hashListEntry == null || hashListEntry.ownVotes == null) {
  //           throw new Error(`solveHashSets2 hashListEntry == null ${hashListEntry == null}`)
  //         }

  //         currentVoteObject.voters.push(hashListIndex)
  //         currentVoteObject.voteTally[hashListIndex] = { i: index, p: hashListEntry.votePower } // could this be a simple index
  //         currentVoteObject.count += hashListEntry.votePower
  //         hashListEntry.ownVotes.push(currentVoteObject)

  //         if (currentVoteObject.winIdx !== null) {
  //           // this already won before but we should still update our own pinIdx

  //           hashListEntry.pinIdx = index
  //           hashListEntry.pinObj = currentVoteObject
  //         }
  //         if (currentVoteObject.count >= votesRequired) {
  //           for (let i = 0; i < hashSetList.length; i++) {
  //             let tallyObject = currentVoteObject.voteTally[i]
  //             if (tallyObject != null) {
  //               let tallyHashListEntry = hashSetList[i]
  //               tallyHashListEntry.pinIdx = tallyObject.i
  //               tallyHashListEntry.pinObj = currentVoteObject
  //             }
  //           }
  //           currentVoteObject.winIdx = index
  //         }
  //       }

  //       index++
  //     }

  //     // need backtracking ref for how each list tracks the votses

  //     // Collect a list of all vodes
  //     let allVotes: ExtendedVote[] = []
  //     for (const votesArray of Object.values(votes)) {
  //       for (let voteObj of votesArray) {
  //         allVotes.push(voteObj)
  //       }
  //     }
  //     // apply a partial order sort, n
  //     // allVotes.sort(function (a, b) { return Depricated.compareVoteObjects(a, b, false) })

  //     // generate solutions!

  //     // count only votes that have won!
  //     // when / how is it safe to detect a win?

  //     let allWinningVotes: ExtendedVote[] = []
  //     for (let voteObj of allVotes) {
  //       // IF was a a winning vote?
  //       if (voteObj.winIdx !== null) {
  //         allWinningVotes.push(voteObj)
  //       }
  //     }
  //     allWinningVotes.sort(function (a, b) {
  //       return Depricated.compareVoteObjects(a, b, false)
  //     })
  //     let finalIdx = 0
  //     for (let voteObj of allWinningVotes) {
  //       // IF was a a winning vote?
  //       if (voteObj.winIdx !== null) {
  //         // allWinningVotes.push(voteObj)
  //         output.push(voteObj.val)
  //         voteObj.finalIdx = finalIdx
  //         finalIdx++
  //       }
  //     }
  //     // to sort the values we could look at the order things were finalized..
  //     // but you could have a case where an earlier message is legitimately finialized later on.

  //     // let aTest = votes['55403088d5636488d3ff17d7d90c052e'][0]
  //     // let bTest = votes['779980ea84b8a5eac2dc3d07013377e5'][0]
  //     // if (logFlags.console) console.log(Depricated.compareVoteObjects(aTest, bTest, false))
  //     // if (logFlags.console) console.log(Depricated.compareVoteObjects(bTest, aTest, false))

  //     // correction solver:
  //     for (let hashListIndex = 0; hashListIndex < hashSetList.length; hashListIndex++) {
  //       // if we are already past the end of this entry list then skip
  //       // let hashListIndex = 2

  //       let hashListEntry = hashSetList[hashListIndex]
  //       hashListEntry.corrections = [] // clear this
  //       // hashListEntry.instructions = []
  //       // if (logFlags.console) console.log(`solution for set ${hashListIndex}  locallen:${hashListEntry.hashSet.length / stepSize} `)
  //       let winningVoteIndex = 0
  //       for (let voteObj of allWinningVotes) {
  //         if (voteObj.voteTally[hashListIndex] == null) {
  //           // if (logFlags.console) console.log(`missing @${voteObj.finalIdx} v:${voteObj.val}`)
  //           // bv: hashListEntry.lastValue, if: lastOutputCount  are old.
  //           // @ts-ignore TSConversion solveHashSets2 is unused. but need to hold off o fixing up these potential nulls
  //           hashListEntry.corrections.push({ i: winningVoteIndex, tv: voteObj, v: voteObj.val, t: 'insert', bv: null, if: -1 })
  //         }
  //         // what if we have it but it is in the wrong spot!!
  //         winningVoteIndex++
  //       }
  //       if (hashListEntry == null || hashListEntry.ownVotes == null) {
  //         throw new Error(`solveHashSets2 hashListEntry == null 2 ${hashListEntry == null}`)
  //       }
  //       for (let voteObj of hashListEntry.ownVotes) {
  //         let localIdx = voteObj.voteTally[hashListIndex].i
  //         if (voteObj.winIdx == null) {
  //           // if (logFlags.console) console.log(`extra @${stringify(voteObj.voteTally[hashListIndex])} v:${voteObj.val}`)
  //           // @ts-ignore TSConversion solveHashSets2 is unused. but need to hold off o fixing up these potential nulls
  //           hashListEntry.corrections.push({ i: localIdx, t: 'extra', c: null, hi: localIdx, tv: null, v: null, bv: null, if: -1 })
  //         }
  //         // localIdx++
  //       }

  //       // not so sure about this sort  local vs. global index space.
  //       hashListEntry.corrections.sort(utils.sort_i_Asc) // (a, b) => a.i - b.i)
  //       winningVoteIndex = 0

  //       // hashListEntry.allWinningVotes = allWinningVotes

  //       // build index map now!
  //       hashListEntry.indexMap = []
  //       hashListEntry.extraMap = []

  //       for (let voteObj of allWinningVotes) {
  //         if (voteObj.voteTally[hashListIndex] == null) {
  //           hashListEntry.indexMap.push(-1)
  //         } else {
  //           hashListEntry.indexMap.push(voteObj.voteTally[hashListIndex].i)
  //         }
  //       }
  //       for (let voteObj of hashListEntry.ownVotes) {
  //         let localIdx = voteObj.voteTally[hashListIndex].i
  //         if (voteObj.winIdx == null) {
  //           hashListEntry.extraMap.push(localIdx)
  //         }
  //       }
  //     }

  //     // generate corrections for main entry.
  //     // hashListEntry.corrections.push({ i: index, tv: topVote, v: topVote.v, t: 'insert', bv: hashListEntry.lastValue, if: lastOutputCount })
  //     // hashListEntry.errorStack.push({ i: index, tv: topVote, v: topVote.v })
  //     // hashListEntry.indexOffset -= 1

  //     // trailing extras:
  //     // while ((extraIdx + hashListEntry.indexOffset) * stepSize < hashListEntry.hashSet.length) {
  //     //   let hi = extraIdx + hashListEntry.indexOffset // index2 - (j + 1)
  //     //   hashListEntry.corrections.push({ i: extraIdx, t: 'extra', c: null, hi: hi, tv: null, v: null, bv: null, if: -1 }) // added , tv: null, v: null, bv: null, if: -1
  //     //   extraIdx++
  //     // }

  //     return output // { output, outputVotes }
  //   }

  //   /**
  //    * expandIndexMapping
  //    * efficient transformation to create a lookup to go from answer space index to the local index space of a hashList entry
  //    * also creates a list of local indicies of elements to remove
  //    * @param {GenericHashSetEntry} hashListEntry
  //    * @param {string[]} output This is the output that we got from the general solver
  //    */
  //   static expandIndexMapping(hashListEntry: GenericHashSetEntry, output: string[]) {
  //     // hashListEntry.corrections.sort(function (a, b) { return a.i === b.i ? 0 : a.i < b.i ? -1 : 1 })
  //     // // index map is our index to the solution output
  //     // hashListEntry.indexMap = []
  //     // // extra map is the index in our list that is an extra
  //     // hashListEntry.extraMap = []
  //     // let readPtr = 0
  //     // let writePtr = 0
  //     // let correctionIndex = 0
  //     // let currentCorrection = null
  //     // let extraBits = 0
  //     // // This will walk the input and output indicies st that same time
  //     // while (writePtr < output.length) {
  //     //   // Get the current correction.  We walk this with the correctionIndex
  //     //   if (correctionIndex < hashListEntry.corrections.length && hashListEntry.corrections[correctionIndex] != null && hashListEntry.corrections[correctionIndex].t === 'insert' && hashListEntry.corrections[correctionIndex].i <= writePtr) {
  //     //     currentCorrection = hashListEntry.corrections[correctionIndex]
  //     //     correctionIndex++
  //     //   } else if (correctionIndex < hashListEntry.corrections.length && hashListEntry.corrections[correctionIndex] != null && hashListEntry.corrections[correctionIndex].t === 'extra' && hashListEntry.corrections[correctionIndex].hi <= readPtr) {
  //     //     currentCorrection = hashListEntry.corrections[correctionIndex]
  //     //     correctionIndex++
  //     //   } else {
  //     //     currentCorrection = null
  //     //   }
  //     //   // if (extraBits > 0) {
  //     //   //   readPtr += extraBits
  //     //   //   extraBits = 0
  //     //   // }
  //     //   // increment pointers based on if there is a correction to write and what type of correction it is
  //     //   if (!currentCorrection) {
  //     //     // no correction to consider so we just write to the index map and advance the read and write pointer
  //     //     hashListEntry.indexMap.push(readPtr)
  //     //     writePtr++
  //     //     readPtr++
  //     //   } else if (currentCorrection.t === 'insert') {
  //     //     // insert means the fix for this slot is to insert an item, since we dont have it this will be -1
  //     //     hashListEntry.indexMap.push(-1)
  //     //     writePtr++
  //     //   } else if (currentCorrection.t === 'extra') {
  //     //     // hashListEntry.extraMap.push({ i: currentCorrection.i, hi: currentCorrection.hi })
  //     //     hashListEntry.extraMap.push(currentCorrection.hi)
  //     //     extraBits++
  //     //     readPtr++
  //     //     // if (currentCorrection.c === null) {
  //     //     //   writePtr++
  //     //     // }
  //     //     continue
  //     //   }
  //     // }
  //     // // final corrections:
  //     // while (correctionIndex < hashListEntry.corrections.length) {
  //     //   currentCorrection = hashListEntry.corrections[correctionIndex]
  //     //   correctionIndex++
  //     //   if (currentCorrection.t === 'extra') {
  //     //     // hashListEntry.extraMap.push({ i: currentCorrection.i, hi: currentCorrection.hi })
  //     //     hashListEntry.extraMap.push(currentCorrection.hi)
  //     //     // extraBits++
  //     //     continue
  //     //   }
  //     // }
  //   }

  //   /**
  //    * solveHashSetsPrep
  //    * todo cleanup.. just sign the partition object asap so we dont have to check if there is a valid sign object throughout the code (but would need to consider perf impact of this)
  //    * @param {number} cycleNumber
  //    * @param {number} partitionId
  //    * @param {string} ourNodeKey
  //    * @return {GenericHashSetEntry[]}
  //    */
  //   solveHashSetsPrep(cycleNumber: number, partitionId: number, ourNodeKey: string): HashSetEntryPartitions[] {
  //     let key = 'c' + cycleNumber
  //     let responsesById = this.stateManager.partitionObjects.allPartitionResponsesByCycleByPartition[key]
  //     let key2 = 'p' + partitionId
  //     let responses = responsesById[key2]

  //     let hashSets = {} as { [hash: string]: HashSetEntryPartitions }
  //     let hashSetList: HashSetEntryPartitions[] = []
  //     // group identical sets together
  //     let hashCounting: StringNumberObjectMap = {}
  //     for (let partitionResult of responses) {
  //       let hash = partitionResult.Partition_hash
  //       let count = hashCounting[hash] || 0
  //       if (count === 0) {
  //         let owner: string | null = null
  //         if (partitionResult.sign) {
  //           owner = partitionResult.sign.owner
  //         } else {
  //           owner = ourNodeKey
  //         }
  //         //TSConversion had to assert that owner is not null with owner!  seems ok
  //         let hashSet: HashSetEntryPartitions = { hash: hash, votePower: 0, hashSet: partitionResult.hashSet, lastValue: '', errorStack: [], corrections: [], indexOffset: 0, owners: [owner!], ourRow: false, waitForIndex: -1, ownVotes: [] }
  //         hashSets[hash] = hashSet
  //         hashSetList.push(hashSets[hash])
  //         // partitionResult.hashSetList = hashSet //Seems like this was only ever used for debugging, going to ax it to be safe!
  //       } else {
  //         if (partitionResult.sign) {
  //           hashSets[hash].owners.push(partitionResult.sign.owner)
  //         }
  //       }
  //       if (partitionResult.sign == null || partitionResult.sign.owner === ourNodeKey) {
  //         hashSets[hash].ourRow = true
  //         // hashSets[hash].owners.push(ourNodeKey)
  //       }

  //       count++
  //       hashCounting[hash] = count
  //       hashSets[hash].votePower = count
  //     }
  //     // NOTE: the fields owners and ourRow are user data for shardus and not known or used by the solving algorithm

  //     return hashSetList
  //   }

  //   /**
  //    * testHashsetSolution
  //    * @param {GenericHashSetEntry} ourHashSet
  //    * @param {GenericHashSetEntry} solutionHashSet
  //    * @returns {boolean}
  //    */
  //   static testHashsetSolution(ourHashSet: GenericHashSetEntry, solutionHashSet: GenericHashSetEntry, log: boolean = false): boolean {
  //     // let payload = { partitionId: partitionId, cycle: cycleNumber, tx_indicies: requestsByHost[i].hostIndex, hash: requestsByHost[i].hash }
  //     // repairTracker.solutionDeltas.push({ i: requestsByHost[i].requests[j], tx: acceptedTX, pf: result.passFail[j] })

  //     // let txSourceList = txList
  //     // if (txList.newTxList) {
  //     //   txSourceList = txList.newTxList
  //     // }

  //     // solutionDeltas.sort(function (a, b) {BAD SORT return a.i - b.i }) // why did b - a help us once??

  //     // let debugSol = []
  //     // for (let solution of repairTracker.solutionDeltas) {
  //     //   debugSol.push({ i: solution.i, tx: solution.tx.id.slice(0, 4) })  // TXSTATE_TODO
  //     // }

  //     let stepSize = cHashSetStepSize
  //     let makeTXArray = function (hashSet: GenericHashSetEntry): string[] {
  //       let txArray: string[] = []
  //       for (let i = 0; i < hashSet.hashSet.length / stepSize; i++) {
  //         let offset = i * stepSize
  //         let v = hashSet.hashSet.slice(offset, offset + stepSize)
  //         txArray.push(v)
  //         // need to slice out state???
  //       }
  //       return txArray
  //     }

  //     let txSourceList = { hashes: makeTXArray(ourHashSet) }
  //     let solutionTxList = { hashes: makeTXArray(solutionHashSet) }
  //     let newTxList = { thashes: [], hashes: [], states: [] } as { thashes: string[]; hashes: string[]; states: string[] }

  //     let solutionList: HashSetEntryCorrection[] = []
  //     for (let correction of ourHashSet.corrections) {
  //       if (correction.t === 'insert') {
  //         solutionList.push(correction)
  //       }
  //     }

  //     // hack remove extraneous extras../////////////
  //     // let extraMap2 = []
  //     // for (let i = 0; i < ourHashSet.extraMap.length; i++) {
  //     //   let extraIndex = ourHashSet.extraMap[i]
  //     //   let extraNeeded = false
  //     //   for (let correction of ourHashSet.corrections) {
  //     //     if (correction.i === extraIndex) {
  //     //       extraNeeded = true
  //     //       break
  //     //     }
  //     //   }
  //     //   if (extraNeeded) {
  //     //     continue
  //     //   }
  //     //   extraMap2.push(extraIndex)
  //     // }
  //     // ourHashSet.extraMap = extraMap2
  //     // ///////////////////////////////////////

  //     if (ourHashSet.extraMap == null) {
  //       if (log) if (logFlags.console) console.log(`testHashsetSolution: ourHashSet.extraMap missing`)
  //       return false
  //     }
  //     if (ourHashSet.indexMap == null) {
  //       if (log) if (logFlags.console) console.log(`testHashsetSolution: ourHashSet.indexMap missing`)
  //       return false
  //     }
  //     ourHashSet.extraMap.sort(utils.sortAsc) // function (a, b) { return a - b })
  //     solutionList.sort(utils.sort_i_Asc) // function (a, b) { return a.i - b.i })

  //     let extraIndex = 0
  //     for (let i = 0; i < txSourceList.hashes.length; i++) {
  //       let extra = -1
  //       if (extraIndex < ourHashSet.extraMap.length) {
  //         extra = ourHashSet.extraMap[extraIndex]
  //       }
  //       if (extra === i) {
  //         extraIndex++
  //         continue
  //       }
  //       if (extra == null) {
  //         if (log) if (logFlags.console) console.log(`testHashsetSolution error extra == null at i: ${i}  extraIndex: ${extraIndex}`)
  //         break
  //       }
  //       if (txSourceList.hashes[i] == null) {
  //         if (log) if (logFlags.console) console.log(`testHashsetSolution error null at i: ${i}  extraIndex: ${extraIndex}`)
  //         break
  //       }

  //       newTxList.thashes.push(txSourceList.hashes[i])
  //       // newTxList.tpassed.push(txSourceList.passed[i])
  //       // newTxList.ttxs.push(txSourceList.txs[i])
  //     }

  //     let hashSet = ''
  //     // for (let hash of newTxList.thashes) {
  //     //   hashSet += hash.slice(0, stepSize)

  //     //   // todo add in the account state stuff..
  //     // }
  //     hashSet = Depricated.createHashSetString(newTxList.thashes, newTxList.states) // TXSTATE_TODO

  //     if (log) if (logFlags.console) console.log(`extras removed: len: ${ourHashSet.indexMap.length}  extraIndex: ${extraIndex} ourPreHashSet: ${hashSet}`)

  //     // Txids: txSourceData.hashes, // txid1, txid2, …],  - ordered from oldest to recent
  //     // Status: txSourceData.passed, // [1,0, …],      - ordered corresponding to Txids; 1 for applied; 0 for failed
  //     // build our data while skipping extras.

  //     // insert corrections in order for each -1 in our local list (or write from our temp lists above)
  //     let ourCounter = 0
  //     let solutionIndex = 0
  //     for (let i = 0; i < ourHashSet.indexMap.length; i++) {
  //       let currentIndex = ourHashSet.indexMap[i]
  //       if (currentIndex >= 0) {
  //         // pull from our list? but we have already removed stuff?
  //         newTxList.hashes[i] = txSourceList.hashes[currentIndex] // newTxList.thashes[ourCounter]
  //         // newTxList.passed[i] = newTxList.tpassed[ourCounter]
  //         // newTxList.txs[i] = newTxList.ttxs[ourCounter]

  //         if (newTxList.hashes[i] == null) {
  //           if (log) if (logFlags.console) console.log(`testHashsetSolution error null at i: ${i} solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
  //           return false
  //         }
  //         ourCounter++
  //       } else {
  //         // repairTracker.solutionDeltas.push({ i: requestsByHost[i].requests[j], tx: acceptedTX, pf: result.passFail[j] })
  //         // let solutionDelta = repairTracker.solutionDeltas[solutionIndex]

  //         let correction = solutionList[solutionIndex]

  //         if (correction == null) {
  //           continue
  //         }
  //         // if (!solutionDelta) {
  //         //   if (logFlags.verbose) this.mainLogger.error( `_mergeRepairDataIntoLocalState2 a error solutionDelta=null  solutionIndex: ${solutionIndex} i:${i} of ${ourHashSet.indexMap.length} deltas: ${utils.stringifyReduce(repairTracker.solutionDeltas)}`)
  //         // }
  //         // insert the next one
  //         newTxList.hashes[i] = solutionTxList.hashes[correction.i] // solutionDelta.tx.id

  //         // newTxList.states[i] = solutionTxList.states[correction.i] // TXSTATE_TODO

  //         if (newTxList.hashes[i] == null) {
  //           if (log) if (logFlags.console) console.log(`testHashsetSolution error null at i: ${i}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
  //         }
  //         // newTxList.passed[i] = solutionDelta.pf
  //         // newTxList.txs[i] = solutionDelta.tx
  //         solutionIndex++
  //         // if (newTxList.hashes[i] == null) {
  //         //   if (logFlags.verbose) this.mainLogger.error( `_mergeRepairDataIntoLocalState2 b error null at i: ${i}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
  //         // }
  //       }
  //     }

  //     hashSet = ''
  //     // for (let hash of newTxList.hashes) {
  //     //   if (!hash) {
  //     //     hashSet += 'xx'
  //     //     continue
  //     //   }
  //     //   hashSet += hash.slice(0, stepSize)
  //     // }
  //     hashSet = Depricated.createHashSetString(newTxList.hashes, null) // TXSTATE_TODO  newTxList.states

  //     if (solutionHashSet.hashSet !== hashSet) {
  //       return false
  //     }

  //     if (log) if (logFlags.console) console.log(`solved set len: ${hashSet.length / stepSize}  : ${hashSet}`)
  //     // if (logFlags.verbose) this.mainLogger.debug( `_mergeRepairDataIntoLocalState2 c  len: ${ourHashSet.indexMap.length}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter} ourHashSet: ${hashSet}`)

  //     return true
  //   }

  //   /**
  //    * createHashSetString
  //    * @param {*} txHashes // todo find correct values
  //    * @param {*} dataHashes
  //    * @returns {*} //todo correct type
  //    */
  //   static createHashSetString(txHashes: string[], dataHashes: string[] | null) {
  //     let hashSet = ''

  //     if (dataHashes == null) {
  //       for (let i = 0; i < txHashes.length; i++) {
  //         let txHash = txHashes[i]

  //         if (!txHash) {
  //           txHash = 'xx'
  //         }

  //         hashSet += txHash.slice(0, cHashSetTXStepSize + cHashSetDataStepSize)
  //       }
  //       return hashSet
  //     } else {
  //       for (let i = 0; i < txHashes.length; i++) {
  //         let txHash = txHashes[i]
  //         let dataHash = dataHashes[i]
  //         if (!txHash) {
  //           txHash = 'xx'
  //         }
  //         if (!dataHash) {
  //           dataHash = 'xx'
  //         }
  //         dataHash = 'xx' // temp hack stop tracking data hashes for now.
  //         hashSet += txHash.slice(0, cHashSetTXStepSize)
  //         hashSet += dataHash.slice(0, cHashSetDataStepSize)
  //       }
  //     }

  //     return hashSet
  //   }

  //   /**
  //    * getTXListByKey
  //    * just an alternative to getTXList where the calling code has alredy formed the cycle key
  //    * @param {string} key the cycle based key c##
  //    * @param {number} partitionId
  //    * @returns {TxTallyList}
  //    */
  //   getTXListByKey(key: string, partitionId: number): TxTallyList {
  //     // let txList = this.txByCycle[key]
  //     // if (!txList) {
  //     //   txList = { hashes: [], passed: [], txs: [], processed: false, states: [] } //  ,txById: {}  states may be an array of arraywith account after states
  //     //   this.txByCycle[key] = txList
  //     // }

  //     let txListByPartition = this.stateManager.partitionObjects.txByCycleByPartition[key]
  //     let pkey = 'p' + partitionId
  //     // now search for the correct partition
  //     if (!txListByPartition) {
  //       txListByPartition = {}
  //       this.stateManager.partitionObjects.txByCycleByPartition[key] = txListByPartition
  //     }
  //     let txList = txListByPartition[pkey]
  //     if (!txList) {
  //       txList = { hashes: [], passed: [], txs: [], processed: false, states: [] } // , txById: {}
  //       txListByPartition[pkey] = txList
  //     }
  //     return txList
  //   }

  /***
   *     #######  ##       ########        ########  ######## ########     ###    #### ########
   *    ##     ## ##       ##     ##       ##     ## ##       ##     ##   ## ##    ##  ##     ##
   *    ##     ## ##       ##     ##       ##     ## ##       ##     ##  ##   ##   ##  ##     ##
   *    ##     ## ##       ##     ##       ########  ######   ########  ##     ##  ##  ########
   *    ##     ## ##       ##     ##       ##   ##   ##       ##        #########  ##  ##   ##
   *    ##     ## ##       ##     ##       ##    ##  ##       ##        ##     ##  ##  ##    ##
   *     #######  ######## ########        ##     ## ######## ##        ##     ## #### ##     ##
   */

  //   /**
  //    * _getRepairTrackerForCycle
  //    * @param {number} counter
  //    * @param {number} partition
  //    * @returns {RepairTracker}
  //    */
  //   _getRepairTrackerForCycle(counter: number, partition: number) {
  //     let key = 'c' + counter
  //     let key2 = 'p' + partition
  //     let repairsByPartition = this.repairTrackingByCycleById[key]
  //     if (!repairsByPartition) {
  //       repairsByPartition = {}
  //       this.repairTrackingByCycleById[key] = repairsByPartition
  //     }
  //     let repairTracker = repairsByPartition[key2]
  //     if (!repairTracker) {
  //       // triedHashes: Hashes for partition objects that we have tried to reconcile with already
  //       // removedTXIds: a list of TXIds that we have removed
  //       // repairedTXs: a list of TXIds that we have added in
  //       // newPendingTXs: a list of TXs we fetched that are ready to process
  //       // newFailedTXs: a list of TXs that we fetched, they had failed so we save them but do not apply them
  //       // extraTXIds: a list of TXIds that our partition has that the leading partition does not.  This is what we need to remove
  //       // missingTXIds: a list of TXIds that our partition has that the leading partition has that we don't.  We will need to add these in using the list newPendingTXs
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`_getRepairTrackerForCycle: creating for cycle:${counter} partition:${partition}`)
  //       repairTracker = {
  //         triedHashes: [],
  //         numNodes: this.stateManager.lastActiveNodeCount, // num nodes that we send partition results to
  //         counter: counter,
  //         partitionId: partition,
  //         key: key,
  //         key2: key2,
  //         removedTXIds: [],
  //         repairedTXs: [],
  //         newPendingTXs: [],
  //         newFailedTXs: [],
  //         extraTXIds: [],
  //         // extraTXs: [],
  //         missingTXIds: [],
  //         repairing: false,
  //         repairsNeeded: false,
  //         busy: false,
  //         txRepairComplete: false,
  //         txRepairReady: false,
  //         evaluationStarted: false,
  //         evaluationComplete: false,
  //         awaitWinningHash: false,
  //         repairsFullyComplete: false,
  //       }
  //       repairsByPartition[key2] = repairTracker

  //       // this.dataRepairStack.push(repairTracker)
  //       // this.dataRepairsStarted++

  //       // let combinedKey = key + key2
  //       // if (this.repairStartedMap.has(combinedKey)) {
  //       //   if (logFlags.verbose) this.mainLogger.error(`Already started repair on ${combinedKey}`)
  //       // } else {
  //       //   this.repairStartedMap.set(combinedKey, true)
  //       // }
  //     }
  //     return repairTracker
  //   }

  //   /**
  //    * repairTrackerMarkFinished
  //    * @param {RepairTracker} repairTracker
  //    * @param {string} debugTag
  //    */
  //   repairTrackerMarkFinished(repairTracker: RepairTracker, debugTag: string) {
  //     repairTracker.repairsFullyComplete = true

  //     let combinedKey = repairTracker.key + repairTracker.key2
  //     if (this.repairStartedMap.has(combinedKey)) {
  //       if (this.repairCompletedMap.has(combinedKey)) {
  //         if (logFlags.verbose) this.mainLogger.debug(`repairStats: finished repair ${combinedKey} -alreadyFlagged  tag:${debugTag}`)
  //       } else {
  //         this.stateManager.dataRepairsCompleted++
  //         this.repairCompletedMap.set(combinedKey, true)
  //         if (logFlags.verbose) this.mainLogger.debug(`repairStats: finished repair ${combinedKey} tag:${debugTag}`)
  //       }
  //     } else {
  //       // should be a trace?
  //       if (logFlags.verbose) this.mainLogger.debug(`repairStats: Calling complete on a key we dont have ${combinedKey} tag:${debugTag}`)
  //     }

  //     for (let i = this.dataRepairStack.length - 1; i >= 0; i--) {
  //       let repairTracker1 = this.dataRepairStack[i]
  //       if (repairTracker1 === repairTracker) {
  //         this.dataRepairStack.splice(i, 1)
  //       }
  //     }

  //     if (this.dataRepairStack.length === 0) {
  //       if (this.stateManager.stateIsGood === false) {
  //         if (logFlags.verbose) this.mainLogger.error(`No active data repair going on tag:${debugTag}`)
  //       }
  //       this.stateManager.stateIsGood = true
  //       this.stateManager.stateIsGood_activeRepairs = true
  //       this.stateManager.stateIsGood_txHashsetOld = true
  //     }
  //   }

  //   /**
  //    * repairTrackerClearForNextRepair
  //    * @param {RepairTracker} repairTracker
  //    */
  //   repairTrackerClearForNextRepair(repairTracker: RepairTracker) {
  //     if (logFlags.verbose) this.mainLogger.debug(` repairTrackerClearForNextRepair cycleNumber: ${repairTracker.counter} parition: ${repairTracker.partitionId} `)
  //     repairTracker.removedTXIds = []
  //     repairTracker.repairedTXs = []
  //     repairTracker.newPendingTXs = []
  //     repairTracker.newFailedTXs = []
  //     repairTracker.extraTXIds = []
  //     repairTracker.missingTXIds = []
  //   }

  //   /**
  //    * mergeAndApplyTXRepairs
  //    * @param {number} cycleNumber
  //    * @param {number} specificParition the old version of this would repair all partitions but we had to wait.  this works on just one partition
  //    */
  //   async mergeAndApplyTXRepairs(cycleNumber: number, specificParition: number) {
  //     if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs cycleNumber ${cycleNumber} partition: ${specificParition}`)
  //     // walk through all txs for this cycle.
  //     // get or create entries for accounts.
  //     // track when they have missing txs or wrong txs

  //     let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(cycleNumber)
  //     if (lastCycleShardValues == null) {
  //       throw new Error('mergeAndApplyTXRepairs lastCycleShardValues == null')
  //     }
  //     if (lastCycleShardValues.ourConsensusPartitions == null) {
  //       throw new Error('mergeAndApplyTXRepairs lastCycleShardValues.ourConsensusPartitions')
  //     }

  //     for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
  //       // this is an attempt to just repair one parition.
  //       if (partitionID !== specificParition) {
  //         continue
  //       }

  //       let allTXsToApply: StringNumberObjectMap = {}
  //       let allExtraTXids: StringNumberObjectMap = {}
  //       let allAccountsToResetById: StringNumberObjectMap = {}
  //       let txIDToAcc: TxIDToSourceTargetObjectMap = {}
  //       let allNewTXsById: TxObjectById = {}
  //       // get all txs and sort them
  //       let repairsByPartition = this.repairTrackingByCycleById['c' + cycleNumber]
  //       // let partitionKeys = Object.keys(repairsByPartition)
  //       // for (let key of partitionKeys) {
  //       let key = 'p' + partitionID
  //       let repairEntry = repairsByPartition[key]
  //       for (let tx of repairEntry.newPendingTXs) {
  //         if (utils.isString(tx.data)) {
  //           // @ts-ignore sometimes we have a data field that gets stuck as a string.  would be smarter to fix this upstream.
  //           tx.data = JSON.parse(tx.data)
  //         }
  //         let keysResponse = this.app.getKeyFromTransaction(tx.data)

  //         if (!keysResponse) {
  //           if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
  //         }

  //         let { sourceKeys, targetKeys } = keysResponse

  //         for (let accountID of sourceKeys) {
  //           allAccountsToResetById[accountID] = 1
  //         }
  //         for (let accountID of targetKeys) {
  //           allAccountsToResetById[accountID] = 1
  //         }
  //         allNewTXsById[tx.id] = tx
  //         txIDToAcc[tx.id] = { sourceKeys, targetKeys }
  //       }
  //       for (let tx of repairEntry.missingTXIds) {
  //         allTXsToApply[tx] = 1
  //       }
  //       for (let tx of repairEntry.extraTXIds) {
  //         allExtraTXids[tx] = 1
  //         // TODO Repair. ugh have to query our data and figure out which accounts need to be reset.
  //       }
  //       if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs: extra: ${utils.stringifyReduce(allExtraTXids)}  txIDToAcc: ${utils.stringifyReduce(txIDToAcc)}`)

  //       // todo repair: hmmm also reset accounts have a tx we need to remove.
  //       // }

  //       let txList = this.stateManager.partitionObjects.getTXList(cycleNumber, partitionID) // done todo sharding: pass partition ID

  //       let txIDToAccCount = 0
  //       let txIDResetExtraCount = 0
  //       // build a list with our existing txs, but dont include the bad ones
  //       if (txList) {
  //         for (let i = 0; i < txList.txs.length; i++) {
  //           let tx = txList.txs[i]
  //           if (allExtraTXids[tx.id]) {
  //             // this was a bad tx dont include it.   we have to look up the account associated with this tx and make sure they get reset
  //             let keysResponse = this.app.getKeyFromTransaction(tx.data)
  //             if (!keysResponse) {
  //               if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs problem with keysResp2  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
  //             }
  //             let { sourceKeys, targetKeys } = keysResponse
  //             for (let accountID of sourceKeys) {
  //               allAccountsToResetById[accountID] = 1
  //               txIDResetExtraCount++
  //             }
  //             for (let accountID of targetKeys) {
  //               allAccountsToResetById[accountID] = 1
  //               txIDResetExtraCount++
  //             }
  //           } else {
  //             // a good tx that we had earlier
  //             let keysResponse = this.app.getKeyFromTransaction(tx.data)
  //             let { sourceKeys, targetKeys } = keysResponse
  //             allNewTXsById[tx.id] = tx
  //             txIDToAcc[tx.id] = { sourceKeys, targetKeys }
  //             txIDToAccCount++
  //             // we will only play back the txs on accounts that point to allAccountsToResetById
  //           }
  //         }
  //       } else {
  //         if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs txList not found for: cycle: ${cycleNumber} in ${utils.stringifyReduce(this.stateManager.partitionObjects.txByCycleByPartition)}`)
  //       }

  //       // build and sort a list of TXs that we need to apply

  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs txIDResetExtraCount: ${txIDResetExtraCount} allAccountsToResetById ${utils.stringifyReduce(allAccountsToResetById)}`)
  //       // reset accounts
  //       let accountKeys = Object.keys(allAccountsToResetById)
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs revert accountKeys ${utils.stringifyReduce(accountKeys)}`)

  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs FIFO lock outer: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
  //       let ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(accountKeys)
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs FIFO lock inner: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)

  //       // let replacmentAccounts =  //returned by the below function for debug
  //       await this._revertAccounts(accountKeys, cycleNumber)

  //       // todo sharding - done extracted tx list calcs to run just for this partition inside of here. how does this relate to having a shard for every??
  //       // convert allNewTXsById map to newTXList list
  //       let newTXList = []
  //       let txKeys = Object.keys(allNewTXsById)
  //       for (let txKey of txKeys) {
  //         let tx = allNewTXsById[txKey]
  //         newTXList.push(tx)
  //       }

  //       // sort the list by ascending timestamp
  //       newTXList.sort(utils.sortTimestampAsc) // (function (a, b) { return a.timestamp - b.timestamp })

  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs newTXList.length: ${newTXList.length} txKeys.length: ${txKeys.length} txIDToAccCount: ${txIDToAccCount}`)

  //       let applyCount = 0
  //       let applyFailCount = 0
  //       let hasEffect = false

  //       let accountValuesByKey: AccountValuesByKey = {}
  //       // let wrappedAccountResults = this.app.getAccountDataByList(accountKeys)
  //       // for (let wrappedData of wrappedAccountResults) {
  //       //   wrappedData.isPartial = false
  //       //   accountValuesByKey[wrappedData.accountId] = wrappedData
  //       // }
  //       // let wrappedAccountResults=[]
  //       // for(let key of accountKeys){
  //       //   this.app.get
  //       // }

  //       // todo sharding - done  (solved by brining newTX clacs inside of this loop)  does newTXList need to be filtered? we are looping over every partition. could this cause us to duplicate effort? YES allNewTXsById is handled above/outside of this loop
  //       for (let tx of newTXList) {
  //         let keysFilter = txIDToAcc[tx.id]
  //         // need a transform to map all txs that would matter.
  //         try {
  //           if (keysFilter) {
  //             let acountsFilter: AccountFilter = {} // this is a filter of accounts that we want to write to
  //             // find which accounts need txs applied.
  //             hasEffect = false
  //             for (let accountID of keysFilter.sourceKeys) {
  //               if (allAccountsToResetById[accountID]) {
  //                 acountsFilter[accountID] = 1
  //                 hasEffect = true
  //               }
  //             }
  //             for (let accountID of keysFilter.targetKeys) {
  //               if (allAccountsToResetById[accountID]) {
  //                 acountsFilter[accountID] = 1
  //                 hasEffect = true
  //               }
  //             }
  //             if (!hasEffect) {
  //               // no need to apply this tx because it would do nothing
  //               continue
  //             }

  //             if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs apply tx ${utils.makeShortHash(tx.id)} ${tx.timestamp} data: ${utils.stringifyReduce(tx)} with filter: ${utils.stringifyReduce(acountsFilter)}`)
  //             let hasStateTableData = false // may or may not have it but not tracking yet

  //             // TSConversion old way used to do this but seem incorrect to have receipt under data!
  //             // HACK!!  receipts sent across the net to us may need to get re parsed
  //             // if (utils.isString(tx.data.receipt)) {
  //             //   tx.data.receipt = JSON.parse(tx.data.receipt)
  //             // }

  //             if (utils.isString(tx.receipt)) {
  //               //@ts-ignore
  //               tx.receipt = JSON.parse(tx.receipt)
  //             }

  //             // todo needs wrapped states! and/or localCachedData

  //             // Need to build up this data.
  //             let keysResponse = this.app.getKeyFromTransaction(tx.data)
  //             let wrappedStates: WrappedResponses = {}
  //             let localCachedData: LocalCachedData = {}
  //             for (let key of keysResponse.allKeys) {
  //               // build wrapped states
  //               // let wrappedState = await this.app.getRelevantData(key, tx.data)

  //               let wrappedState: Shardus.WrappedResponse = accountValuesByKey[key] // need to init ths data. allAccountsToResetById[key]
  //               if (wrappedState == null) {
  //                 // Theoretically could get this data from when we revert the data above..
  //                 wrappedState = await this.app.getRelevantData(key, tx.data)
  //                 accountValuesByKey[key] = wrappedState
  //               } else {
  //                 wrappedState.accountCreated = false // kinda crazy assumption
  //               }
  //               wrappedStates[key] = wrappedState
  //               localCachedData[key] = wrappedState.localCache
  //               // delete wrappedState.localCache
  //             }

  //             let success = await this.testAccountTime(tx.data, wrappedStates)

  //             if (!success) {
  //               if (logFlags.verbose) this.mainLogger.debug(' testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs' + utils.stringifyReduce(tx))
  //               if (logFlags.playback) this.logger.playbackLogNote('testAccountTime_failed', `${tx.id}`, ` testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs`)

  //               this.statemanager_fatal(`testAccountTime_failed`, ' testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs' + utils.stringifyReduce(tx))

  //               // return
  //               this.p2p.initApoptosis() // todo turn this back on
  //               // // return { success: false, reason: 'testAccountTime failed' }
  //               break
  //             }

  //             let applied = await this.tryApplyTransaction(tx, hasStateTableData, true, acountsFilter, wrappedStates, localCachedData) // TODO app interface changes.. how to get and pass the state wrapped account state in, (maybe simple function right above this
  //             // accountValuesByKey = {} // clear this.  it forces more db work but avoids issue with some stale flags
  //             if (!applied) {
  //               applyFailCount++
  //               if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs apply failed`)
  //             } else {
  //               applyCount++
  //             }
  //           } else {
  //             if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs no for ${tx.id} in ${utils.stringifyReduce(txIDToAcc)}`)
  //           }
  //         } catch (ex) {
  //           this.mainLogger.debug('_repair: startRepairProcess mergeAndApplyTXRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //           this.statemanager_fatal(`mergeAndApplyTXRepairs_ex`, '_repair: startRepairProcess mergeAndApplyTXRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //         }

  //         if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs applyCount ${applyCount} applyFailCount: ${applyFailCount}`)
  //       }

  //       // unlock the accounts we locked...  todo maybe put this in a finally statement?
  //       this.stateManager.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs FIFO unlock: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
  //     }
  //   }

  //   /**
  //    * updateTrackingAndPrepareChanges
  //    * @param {number} cycleNumber
  //    * @param {number} specificParition the old version of this would repair all partitions but we had to wait.  this works on just one partition
  //    */
  //   async updateTrackingAndPrepareRepairs(cycleNumber: number, specificParition: number) {
  //     if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs cycleNumber ${cycleNumber} partition: ${specificParition}`)
  //     // walk through all txs for this cycle.
  //     // get or create entries for accounts.
  //     // track when they have missing txs or wrong txs
  //     let debugKey = `c${cycleNumber}p${specificParition}`
  //     let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(cycleNumber)
  //     let paritionsServiced = 0
  //     try {
  //       // this was locking us to consensus only partitions. really just preap anything that is called on this fuciton since other logic may be doing work
  //       // on stored partitions.

  //       // for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
  //       // // this is an attempt to just repair one parition.
  //       //   if (partitionID !== specificParition) {
  //       //     continue
  //       //   }
  //       let partitionID = specificParition
  //       paritionsServiced++
  //       let allTXsToApply: StringNumberObjectMap = {}
  //       let allExtraTXids: StringNumberObjectMap = {}
  //       /** @type {Object.<string, number>} */
  //       let allAccountsToResetById: StringNumberObjectMap = {}
  //       /** @type {Object.<string, { sourceKeys:string[], targetKeys:string[] } >} */
  //       let txIDToAcc: TxIDToSourceTargetObjectMap = {}
  //       let allNewTXsById: TxObjectById = {}
  //       // get all txs and sort them
  //       let repairsByPartition = this.repairTrackingByCycleById['c' + cycleNumber]
  //       // let partitionKeys = Object.keys(repairsByPartition)
  //       // for (let key of partitionKeys) {
  //       let key = 'p' + partitionID
  //       let repairEntry = repairsByPartition[key]
  //       for (let tx of repairEntry.newPendingTXs) {
  //         if (utils.isString(tx.data)) {
  //           // @ts-ignore sometimes we have a data field that gets stuck as a string.  would be smarter to fix this upstream.
  //           tx.data = JSON.parse(tx.data)
  //         }
  //         let keysResponse = this.app.getKeyFromTransaction(tx.data)

  //         if (!keysResponse) {
  //           if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
  //         }

  //         let { sourceKeys, targetKeys } = keysResponse

  //         for (let accountID of sourceKeys) {
  //           allAccountsToResetById[accountID] = 1
  //         }
  //         for (let accountID of targetKeys) {
  //           allAccountsToResetById[accountID] = 1
  //         }
  //         allNewTXsById[tx.id] = tx
  //         txIDToAcc[tx.id] = { sourceKeys, targetKeys }
  //       }
  //       for (let tx of repairEntry.missingTXIds) {
  //         allTXsToApply[tx] = 1
  //       }
  //       for (let tx of repairEntry.extraTXIds) {
  //         allExtraTXids[tx] = 1
  //         // TODO Repair. ugh have to query our data and figure out which accounts need to be reset.
  //       }
  //       if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs: extra: ${utils.stringifyReduce(allExtraTXids)}  txIDToAcc: ${utils.stringifyReduce(txIDToAcc)}`)

  //       // todo repair: hmmm also reset accounts have a tx we need to remove.
  //       // }

  //       let txList = this.stateManager.partitionObjects.getTXList(cycleNumber, partitionID) // done todo sharding: pass partition ID

  //       let txIDToAccCount = 0
  //       let txIDResetExtraCount = 0
  //       // build a list with our existing txs, but dont include the bad ones
  //       if (txList) {
  //         for (let i = 0; i < txList.txs.length; i++) {
  //           let tx = txList.txs[i]
  //           if (allExtraTXids[tx.id]) {
  //             // this was a bad tx dont include it.   we have to look up the account associated with this tx and make sure they get reset
  //             let keysResponse = this.app.getKeyFromTransaction(tx.data)
  //             if (!keysResponse) {
  //               if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs problem with keysResp2  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
  //             }
  //             let { sourceKeys, targetKeys } = keysResponse
  //             for (let accountID of sourceKeys) {
  //               allAccountsToResetById[accountID] = 1
  //               txIDResetExtraCount++
  //             }
  //             for (let accountID of targetKeys) {
  //               allAccountsToResetById[accountID] = 1
  //               txIDResetExtraCount++
  //             }
  //           } else {
  //             // a good tx that we had earlier
  //             let keysResponse = this.app.getKeyFromTransaction(tx.data)
  //             let { sourceKeys, targetKeys } = keysResponse
  //             allNewTXsById[tx.id] = tx
  //             txIDToAcc[tx.id] = { sourceKeys, targetKeys }
  //             txIDToAccCount++
  //             // we will only play back the txs on accounts that point to allAccountsToResetById
  //           }
  //         }
  //         if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs txIDResetExtraCount:${txIDResetExtraCount} txIDToAccCount: ${txIDToAccCount}`)
  //       } else {
  //         if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs txList not found for: cycle: ${cycleNumber} in ${utils.stringifyReduce(this.stateManager.partitionObjects.txByCycleByPartition)}`)
  //       }

  //       // build and sort a list of TXs that we need to apply

  //       // OLD reset account code was here.

  //       // todo sharding - done extracted tx list calcs to run just for this partition inside of here. how does this relate to having a shard for every??
  //       // convert allNewTXsById map to newTXList list
  //       let newTXList = []
  //       let txKeys = Object.keys(allNewTXsById)
  //       for (let txKey of txKeys) {
  //         let tx = allNewTXsById[txKey]
  //         newTXList.push(tx)
  //       }

  //       // sort the list by ascending timestamp
  //       newTXList.sort(utils.sortTimestampAsc) // function (a, b) { return a.timestamp - b.timestamp })

  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs newTXList.length: ${newTXList.length} txKeys.length: ${txKeys.length} txIDToAccCount: ${txIDToAccCount}`)

  //       // Save the results of this computation for later
  //       /** @type {UpdateRepairData}  */
  //       let updateData: UpdateRepairData = { newTXList, allAccountsToResetById, partitionId: specificParition, txIDToAcc }
  //       let ckey = 'c' + cycleNumber
  //       if (this.repairUpdateDataByCycle[ckey] == null) {
  //         this.repairUpdateDataByCycle[ckey] = []
  //       }
  //       this.repairUpdateDataByCycle[ckey].push(updateData)

  //       // how will the partition object get updated though??
  //       // }

  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs finished`)
  //       if (paritionsServiced === 0) {
  //         this.statemanager_fatal(`_updateTrackingAndPrepareRepairs_fail`, `_updateTrackingAndPrepareRepairs failed. not partitions serviced: ${debugKey} our consensus:${utils.stringifyReduce(lastCycleShardValues?.ourConsensusPartitions)} `)
  //       }
  //     } catch (ex) {
  //       this.mainLogger.debug('__updateTrackingAndPrepareRepairs: exception ' + ` ${debugKey} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //       this.statemanager_fatal(`_updateTrackingAndPrepareRepairs_ex`, '__updateTrackingAndPrepareRepairs: exception ' + ` ${debugKey} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //     }
  //   }

  //   /**
  //    * updateTrackingAndPrepareChanges
  //    * @param {number} cycleNumber
  //    */
  //   async applyAllPreparedRepairs(cycleNumber: number) {
  //     if (this.applyAllPreparedRepairsRunning === true) {
  //       return
  //     }
  //     this.applyAllPreparedRepairsRunning = true

  //     if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs cycleNumber ${cycleNumber}`)

  //     this.mainLogger.debug(`applyAllPreparedRepairs c:${cycleNumber}`)

  //     let ckey = 'c' + cycleNumber
  //     let repairDataList = this.repairUpdateDataByCycle[ckey]

  //     let txIDToAcc: TxIDToKeyObjectMap = {}
  //     let allAccountsToResetById: AccountBoolObjectMap = {}
  //     let newTXList: AcceptedTx[] = []
  //     for (let repairData of repairDataList) {
  //       newTXList = newTXList.concat(repairData.newTXList)
  //       allAccountsToResetById = Object.assign(allAccountsToResetById, repairData.allAccountsToResetById)
  //       txIDToAcc = Object.assign(txIDToAcc, repairData.txIDToAcc)
  //       this.mainLogger.debug(`applyAllPreparedRepairs c${cycleNumber}p${repairData.partitionId} reset:${Object.keys(repairData.allAccountsToResetById).length} txIDToAcc:${Object.keys(repairData.txIDToAcc).length} keys: ${utils.stringifyReduce(Object.keys(repairData.allAccountsToResetById))} `)
  //     }
  //     this.mainLogger.debug(`applyAllPreparedRepairs total reset:${Object.keys(allAccountsToResetById).length} txIDToAcc:${Object.keys(txIDToAcc).length}`)

  //     newTXList.sort(utils.sortTimestampAsc) // function (a, b) { return a.timestamp - b.timestamp })

  //     // build and sort a list of TXs that we need to apply

  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs allAccountsToResetById ${utils.stringifyReduce(allAccountsToResetById)}`)
  //     // reset accounts
  //     let accountKeys = Object.keys(allAccountsToResetById)
  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs revert accountKeys ${utils.stringifyReduce(accountKeys)}`)

  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs FIFO lock outer: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
  //     let ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(accountKeys)
  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs FIFO lock inner: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)

  //     // let replacmentAccounts =  //returned by the below function for debug
  //     await this._revertAccounts(accountKeys, cycleNumber)

  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs newTXList.length: ${newTXList.length}`)

  //     let applyCount = 0
  //     let applyFailCount = 0
  //     let hasEffect = false
  //     let hasNonGlobalEffect = false

  //     // TSConversion WrappedStates issue
  //     let accountValuesByKey: WrappedResponses = {}

  //     let seenTXs: StringBoolObjectMap = {}
  //     for (let tx of newTXList) {
  //       if (seenTXs[tx.id] === true) {
  //         this.mainLogger.debug(`applyAllPreparedRepairs skipped double: ${utils.makeShortHash(tx.id)} ${tx.timestamp} `)
  //         continue
  //       }
  //       seenTXs[tx.id] = true

  //       let keysFilter = txIDToAcc[tx.id]
  //       // need a transform to map all txs that would matter.
  //       try {
  //         if (keysFilter) {
  //           let acountsFilter: AccountFilter = {} // this is a filter of accounts that we want to write to
  //           // find which accounts need txs applied.
  //           hasEffect = false
  //           hasNonGlobalEffect = false
  //           for (let accountID of keysFilter.sourceKeys) {
  //             if (allAccountsToResetById[accountID]) {
  //               acountsFilter[accountID] = 1
  //               hasEffect = true
  //               if (this.stateManager.accountGlobals.isGlobalAccount(accountID) === false) {
  //                 hasNonGlobalEffect = true
  //               }
  //             }
  //           }
  //           for (let accountID of keysFilter.targetKeys) {
  //             if (allAccountsToResetById[accountID]) {
  //               acountsFilter[accountID] = 1
  //               hasEffect = true
  //               if (this.stateManager.accountGlobals.isGlobalAccount(accountID) === false) {
  //                 hasNonGlobalEffect = true
  //               }
  //             }
  //           }
  //           if (!hasEffect) {
  //             // no need to apply this tx because it would do nothing
  //             continue
  //           }
  //           if (!hasNonGlobalEffect) {
  //             //if only a global account involved then dont reset!
  //             continue
  //           }

  //           if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs apply tx ${utils.makeShortHash(tx.id)} ${tx.timestamp} data: ${utils.stringifyReduce(tx)} with filter: ${utils.stringifyReduce(acountsFilter)}`)
  //           let hasStateTableData = false // may or may not have it but not tracking yet

  //           // TSConversion old way used to do this but seem incorrect to have receipt under data!
  //           // // HACK!!  receipts sent across the net to us may need to get re parsed
  //           // if (utils.isString(tx.data.receipt)) {
  //           //   tx.data.receipt = JSON.parse(tx.data.receipt)
  //           // }
  //           if (utils.isString(tx.receipt)) {
  //             //@ts-ignore
  //             tx.receipt = JSON.parse(tx.receipt)
  //           }

  //           // todo needs wrapped states! and/or localCachedData

  //           // Need to build up this data.
  //           let keysResponse = this.app.getKeyFromTransaction(tx.data)
  //           let wrappedStates: WrappedResponses = {}
  //           let localCachedData: LocalCachedData = {}
  //           for (let key of keysResponse.allKeys) {
  //             // build wrapped states
  //             // let wrappedState = await this.app.getRelevantData(key, tx.data)

  //             let wrappedState: Shardus.WrappedResponse = accountValuesByKey[key] // need to init ths data. allAccountsToResetById[key]
  //             if (wrappedState == null) {
  //               // Theoretically could get this data from when we revert the data above..
  //               wrappedState = await this.app.getRelevantData(key, tx.data)
  //               // what to do in failure case.
  //               accountValuesByKey[key] = wrappedState
  //             } else {
  //               wrappedState.accountCreated = false // kinda crazy assumption
  //             }
  //             wrappedStates[key] = wrappedState
  //             localCachedData[key] = wrappedState.localCache
  //             // delete wrappedState.localCache
  //           }

  //           let success = await this.testAccountTime(tx.data, wrappedStates)

  //           if (!success) {
  //             if (logFlags.verbose) this.mainLogger.debug(' applyAllPreparedRepairs testAccountTime failed. calling apoptosis. applyAllPreparedRepairs' + utils.stringifyReduce(tx))
  //             if (logFlags.playback) this.logger.playbackLogNote('testAccountTime_failed', `${tx.id}`, ` applyAllPreparedRepairs testAccountTime failed. calling apoptosis. applyAllPreparedRepairs`)
  //             this.statemanager_fatal(`applyAllPreparedRepairs_fail`, ' testAccountTime failed. calling apoptosis. applyAllPreparedRepairs' + utils.stringifyReduce(tx))

  //             // return
  //             this.p2p.initApoptosis() // todo turn this back on
  //             // // return { success: false, reason: 'testAccountTime failed' }
  //             break
  //           }

  //           // TODO: globalaccounts  this is where we go through the account state and just in time grab global accounts from the cache we made in the revert section from backup copies.
  //           //  TODO Perf probably could prepare of this inforamation above more efficiently but for now this is most simple and self contained.

  //           //TODO verify that we will even have wrapped states at this point in the repair without doing some extra steps.
  //           let wrappedStateKeys = Object.keys(wrappedStates)
  //           for (let wrappedStateKey of wrappedStateKeys) {
  //             let wrappedState = wrappedStates[wrappedStateKey]

  //             // if(wrappedState == null) {
  //             //   if (logFlags.verbose) this.mainLogger.error( ` _repair applyAllPreparedRepairs wrappedState == null ${utils.stringifyReduce(wrappedStateKey)} ${tx.timestamp}`)
  //             //   //could continue but want to see if there is more we can log.
  //             // }
  //             //is it global.
  //             if (this.stateManager.accountGlobals.isGlobalAccount(wrappedStateKey)) {
  //               // wrappedState.accountId)){
  //               if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', `applyAllPreparedRepairs - has`, ` ${wrappedState.accountId} ${wrappedStateKey}`)
  //               if (wrappedState != null) {
  //                 let globalValueSnapshot = this.stateManager.accountGlobals.getGlobalAccountValueAtTime(wrappedState.accountId, tx.timestamp)

  //                 if (globalValueSnapshot == null) {
  //                   //todo some error?
  //                   let globalAccountBackupList = this.stateManager.accountGlobals.getGlobalAccountBackupList(wrappedStateKey)
  //                   if (logFlags.verbose) this.mainLogger.error(` _repair applyAllPreparedRepairs has global key but no snapshot at time ${tx.timestamp} entries:${globalAccountBackupList.length} ${utils.stringifyReduce(globalAccountBackupList.map((a) => `${a.timestamp}  ${utils.makeShortHash(a.accountId)} `))}  `)
  //                   continue
  //                 }
  //                 // build a new wrapped response to insert
  //                 let newWrappedResponse: Shardus.WrappedResponse = { accountCreated: wrappedState.accountCreated, isPartial: false, accountId: wrappedState.accountId, timestamp: wrappedState.timestamp, stateId: globalValueSnapshot.hash, data: globalValueSnapshot.data }
  //                 //set this new value into our wrapped states.
  //                 wrappedStates[wrappedStateKey] = newWrappedResponse // update!!
  //                 // insert thes data into the wrapped states.
  //                 // yikes probably cant do local cached data at this point.
  //                 if (logFlags.verbose) {
  //                   let globalAccountBackupList = this.stateManager.accountGlobals.getGlobalAccountBackupList(wrappedStateKey)
  //                   if (logFlags.verbose) this.mainLogger.error(` _repair applyAllPreparedRepairs has global key details ${tx.timestamp} entries:${globalAccountBackupList.length} ${utils.stringifyReduce(globalAccountBackupList.map((a) => `${a.timestamp}  ${utils.makeShortHash(a.accountId)} `))}  `)
  //                 }

  //                 if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs got global account to repair from: ${utils.stringifyReduce(newWrappedResponse)}`)
  //               }
  //             } else {
  //               if (wrappedState == null) {
  //                 if (logFlags.verbose) this.mainLogger.error(` _repair applyAllPreparedRepairs is not a global account but wrapped state == null ${utils.stringifyReduce(wrappedStateKey)} ${tx.timestamp}`)
  //               }
  //             }
  //           }

  //           let applied = await this.tryApplyTransaction(tx, hasStateTableData, /** repairing */ true, acountsFilter, wrappedStates, localCachedData) // TODO app interface changes.. how to get and pass the state wrapped account state in, (maybe simple function right above this
  //           // accountValuesByKey = {} // clear this.  it forces more db work but avoids issue with some stale flags
  //           if (!applied) {
  //             applyFailCount++
  //             if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs apply failed`)
  //           } else {
  //             applyCount++
  //           }
  //         } else {
  //           if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs no for ${tx.id} in ${utils.stringifyReduce(txIDToAcc)}`)
  //         }
  //       } catch (ex) {
  //         this.mainLogger.debug('_repair: startRepairProcess applyAllPreparedRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //         this.statemanager_fatal(`applyAllPreparedRepairs_fail`, '_repair: startRepairProcess applyAllPreparedRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //       }

  //       if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs applyCount ${applyCount} applyFailCount: ${applyFailCount}`)
  //     }

  //     // unlock the accounts we locked...  todo maybe put this in a finally statement?
  //     this.stateManager.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs FIFO unlock: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
  //     // }
  //     this.applyAllPreparedRepairsRunning = false
  //   }

  //   /**
  //    * _revertAccounts
  //    * @param {string[]} accountIDs
  //    * @param {number} cycleNumber
  //    */
  //   async _revertAccounts(accountIDs: string[], cycleNumber: number) {
  //     let cycle = this.p2p.state.getCycleByCounter(cycleNumber)
  //     let cycleEnd = (cycle.start + cycle.duration) * 1000
  //     let cycleStart = cycle.start * 1000
  //     cycleEnd -= this.stateManager.syncSettleTime // adjust by sync settle time
  //     cycleStart -= this.stateManager.syncSettleTime // adjust by sync settle time
  //     let replacmentAccounts: Shardus.AccountsCopy[]
  //     let replacmentAccountsMinusGlobals = [] as Shardus.AccountsCopy[]
  //     if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts start  numAccounts: ${accountIDs.length} repairing cycle:${cycleNumber}`)

  //     try {
  //       // query our account copies that are less than or equal to this cycle!
  //       let prevCycle = cycleNumber - 1

  //       replacmentAccounts = (await this.storage.getAccountReplacmentCopies(accountIDs, prevCycle)) as Shardus.AccountsCopy[]

  //       if (replacmentAccounts.length > 0) {
  //         for (let accountData of replacmentAccounts) {
  //           if (utils.isString(accountData.data)) {
  //             accountData.data = JSON.parse(accountData.data)
  //             // hack, mode the owner so we can see the rewrite taking place
  //             // accountData.data.data.data = { rewrite: cycleNumber }
  //           }

  //           if (accountData == null || accountData.data == null || accountData.accountId == null) {
  //             if (logFlags.verbose) this.mainLogger.error(` _repair _revertAccounts null account data found: ${accountData.accountId} cycle: ${cycleNumber} data: ${utils.stringifyReduce(accountData)}`)
  //           } else {
  //             // todo overkill
  //             if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair _revertAccounts reset: ${utils.makeShortHash(accountData.accountId)} ts: ${utils.makeShortHash(accountData.timestamp)} cycle: ${cycleNumber} data: ${utils.stringifyReduce(accountData)}`)
  //           }
  //           // TODO: globalaccounts
  //           //this is where we need to no reset a global account, but instead grab the replacment data and cache it
  //           /// ////////////////////////
  //           //let isGlobalAccount = this.stateManager.accountGlobals.globalAccountMap.has(accountData.accountId )

  //           //Try not reverting global accounts..
  //           if (this.stateManager.accountGlobals.isGlobalAccount(accountData.accountId) === false) {
  //             replacmentAccountsMinusGlobals.push(accountData)
  //             if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair _revertAccounts not a global account, add to list ${utils.makeShortHash(accountData.accountId)}`)
  //           } else {
  //             if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair _revertAccounts was a global account, do not add to list ${utils.makeShortHash(accountData.accountId)}`)
  //           }
  //         }
  //         // tell the app to replace the account data
  //         //await this.app.resetAccountData(replacmentAccounts)
  //         await this.app.resetAccountData(replacmentAccountsMinusGlobals)
  //         // update local state.
  //       } else {
  //         if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts No replacment accounts found!!! cycle <= :${prevCycle}`)
  //       }

  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair _revertAccounts: ${accountIDs.length} replacmentAccounts ${replacmentAccounts.length} repairing cycle:${cycleNumber} replacmentAccountsMinusGlobals: ${replacmentAccountsMinusGlobals.length}`)

  //       // TODO prodution. consider if we need a better set of checks before we delete an account!
  //       // If we don't have a replacement copy for an account we should try to delete it

  //       // Find any accountIDs not in resetAccountData
  //       let accountsReverted: StringNumberObjectMap = {}
  //       let accountsToDelete: string[] = []
  //       let debug = []
  //       for (let accountData of replacmentAccounts) {
  //         accountsReverted[accountData.accountId] = 1
  //         if (accountData.cycleNumber > prevCycle) {
  //           if (logFlags.verbose) this.mainLogger.error(` _repair _revertAccounts cycle too new for backup restore: ${accountData.cycleNumber}  cycleNumber:${cycleNumber} timestamp:${accountData.timestamp}`)
  //         }

  //         debug.push({ id: accountData.accountId, cycleNumber: accountData.cycleNumber, timestamp: accountData.timestamp, hash: accountData.hash, accHash: accountData.data.hash, accTs: accountData.data.timestamp })
  //       }

  //       if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts: ${utils.stringifyReduce(debug)}`)

  //       for (let accountID of accountIDs) {
  //         if (accountsReverted[accountID] == null) {
  //           accountsToDelete.push(accountID)
  //         }
  //       }
  //       if (accountsToDelete.length > 0) {
  //         if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts delete some accounts ${utils.stringifyReduce(accountsToDelete)}`)
  //         await this.app.deleteAccountData(accountsToDelete)
  //       }

  //       // mark for kill future txlist stuff for any accounts we nuked

  //       // make a map to find impacted accounts
  //       let accMap: StringNumberObjectMap = {}
  //       for (let accid of accountIDs) {
  //         accMap[accid] = 1
  //       }
  //       // check for this.tempTXRecords that involve accounts we are going to clear
  //       for (let txRecord of this.stateManager.partitionObjects.tempTXRecords) {
  //         // if (txRecord.txTS < cycleEnd) {
  //         let keysResponse = this.app.getKeyFromTransaction(txRecord.acceptedTx.data)
  //         if (!keysResponse) {
  //           if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(txRecord.acceptedTx)}`)
  //         }
  //         let { sourceKeys, targetKeys } = keysResponse
  //         for (let accountID of sourceKeys) {
  //           if (accMap[accountID]) {
  //             txRecord.redacted = cycleNumber
  //           }
  //         }
  //         for (let accountID of targetKeys) {
  //           if (accMap[accountID]) {
  //             txRecord.redacted = cycleNumber
  //           }
  //         }
  //         // }
  //       }

  //       // clear out bad state table data!!
  //       // add number to clear future state table data too
  //       await this.storage.clearAccountStateTableByList(accountIDs, cycleStart, cycleEnd + 1000000)

  //       // clear replacement copies for this cycle for these accounts!

  //       // todo clear based on GTE!!!
  //       await this.storage.clearAccountReplacmentCopies(accountIDs, cycleNumber)
  //     } catch (ex) {
  //       this.mainLogger.debug('_repair: _revertAccounts mergeAndApplyTXRepairs ' + ` ${utils.stringifyReduce({ cycleNumber, cycleEnd, cycleStart, accountIDs })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //       this.statemanager_fatal(`_revertAccounts_ex`, '_repair: _revertAccounts mergeAndApplyTXRepairs ' + ` ${utils.stringifyReduce({ cycleNumber, cycleEnd, cycleStart, accountIDs })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //     }

  //     return replacmentAccounts // this is for debugging reference
  //   }

  //   async testAccountTime(tx: Shardus.OpaqueTransaction, wrappedStates: WrappedStates) {
  //     function tryGetAccountData(accountID: string) {
  //       return wrappedStates[accountID]
  //     }

  //     try {
  //       let keysResponse = this.app.getKeyFromTransaction(tx)
  //       let { timestamp } = keysResponse // sourceKeys, targetKeys,
  //       // check account age to make sure it is older than the tx
  //       let failedAgeCheck = false

  //       let accountKeys = Object.keys(wrappedStates)
  //       for (let key of accountKeys) {
  //         let accountEntry = tryGetAccountData(key)
  //         if (accountEntry.timestamp >= timestamp) {
  //           failedAgeCheck = true
  //           if (logFlags.verbose) this.mainLogger.debug('testAccountTime account has future state.  id: ' + utils.makeShortHash(accountEntry.accountId) + ' time: ' + accountEntry.timestamp + ' txTime: ' + timestamp + ' delta: ' + (timestamp - accountEntry.timestamp))
  //         }
  //       }
  //       if (failedAgeCheck) {
  //         // if (logFlags.verbose) this.mainLogger.debug('DATASYNC: testAccountTimesAndStateTable accounts have future state ' + timestamp)
  //         return false
  //       }
  //     } catch (ex) {
  //       this.statemanager_fatal(`testAccountTime-fail_ex`, 'testAccountTime failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //       return false
  //     }
  //     return true // { success: true, hasStateTableData }
  //   }

  // state ids should be checked before applying this transaction because it may have already been applied while we were still syncing data.
  //   async tryApplyTransaction(acceptedTX: AcceptedTx, hasStateTableData: boolean, repairing: boolean, filter: AccountFilter, wrappedStates: WrappedResponses, localCachedData: LocalCachedData) {
  //     let ourLockID = -1
  //     let accountDataList
  //     let txTs = 0
  //     let accountKeys = []
  //     let ourAccountLocks = null
  //     let applyResponse: Shardus.ApplyResponse | null = null
  //     //have to figure out if this is a global modifying tx, since that impacts if we will write to global account.
  //     let isGlobalModifyingTX = false
  //     let savedSomething = false
  //     try {
  //       let tx = acceptedTX.data
  //       // let receipt = acceptedTX.receipt
  //       let keysResponse = this.app.getKeyFromTransaction(tx)
  //       let { timestamp, debugInfo } = keysResponse
  //       txTs = timestamp

  //       let queueEntry = this.stateManager.transactionQueue.getQueueEntry(acceptedTX.id)
  //       if (queueEntry != null) {
  //         if (queueEntry.globalModification === true) {
  //           isGlobalModifyingTX = true
  //         }
  //       }

  //       if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  ts:${timestamp} repairing:${repairing} hasStateTableData:${hasStateTableData} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`)
  //       if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  filter: ${utils.stringifyReduce(filter)}`)
  //       if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
  //       if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
  //       if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`)

  //       if (repairing !== true) {
  //         // get a list of modified account keys that we will lock
  //         let { sourceKeys, targetKeys } = keysResponse
  //         for (let accountID of sourceKeys) {
  //           accountKeys.push(accountID)
  //         }
  //         for (let accountID of targetKeys) {
  //           accountKeys.push(accountID)
  //         }
  //         if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair tryApplyTransaction FIFO lock outer: ${utils.stringifyReduce(accountKeys)} `)
  //         ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(accountKeys)
  //         if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair tryApplyTransaction FIFO lock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
  //       }

  //       ourLockID = await this.stateManager.fifoLock('accountModification')

  //       if (logFlags.verbose) if (logFlags.console) console.log(`tryApplyTransaction  ts:${timestamp} repairing:${repairing}  Applying!`)
  //       // if (logFlags.verbose) this.mainLogger.debug('APPSTATE: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))
  //       this.stateManager.transactionQueue.applySoftLock = true

  //       // let replyObject = { stateTableResults: [], txId, txTimestamp, accountData: [] }
  //       // let wrappedStatesList = Object.values(wrappedStates)

  //       // TSConversion need to check how save this cast is for the apply fuction, should probably do more in depth look at the tx param.
  //       applyResponse = this.app.apply(tx as Shardus.IncomingTransaction, wrappedStates)
  //       let { stateTableResults, accountData: _accountdata } = applyResponse
  //       accountDataList = _accountdata

  //       if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
  //       // wrappedStates are side effected for now
  //       savedSomething = await this.stateManager.setAccount(wrappedStates, localCachedData, applyResponse, isGlobalModifyingTX, filter)

  //       if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  accountData[${accountDataList.length}]: ${utils.stringifyReduce(accountDataList)}`)
  //       if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  stateTableResults[${stateTableResults.length}]: ${utils.stringifyReduce(stateTableResults)}`)

  //       this.stateManager.transactionQueue.applySoftLock = false
  //       // only write our state table data if we dont already have it in the db
  //       if (hasStateTableData === false) {
  //         for (let stateT of stateTableResults) {
  //           if (logFlags.verbose) if (logFlags.console) console.log('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' accounts total' + accountDataList.length)
  //           if (logFlags.verbose) this.mainLogger.debug('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter) + ' txid: ' + utils.makeShortHash(acceptedTX.id) + ' ts: ' + acceptedTX.timestamp)
  //         }
  //         await this.storage.addAccountStates(stateTableResults)
  //       }

  //       // post validate that state ended up correctly?

  //       // write the accepted TX to storage
  //       this.storage.addAcceptedTransactions([acceptedTX])
  //     } catch (ex) {
  //       this.statemanager_fatal(`tryApplyTransaction_ex`, 'tryApplyTransaction failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //       this.mainLogger.debug(`tryApplyTransaction failed id:${utils.makeShortHash(acceptedTX.id)}  ${utils.stringifyReduce(acceptedTX)}`)
  //       if (applyResponse) {
  //         // && savedSomething){
  //         // TSConversion do we really want to record this?
  //         // if (!repairing) this.stateManager.partitionObjects.tempRecordTXByCycle(txTs, acceptedTX, false, applyResponse, isGlobalModifyingTX, savedSomething)
  //         // record no-op state table fail:
  //       } else {
  //         // this.fatalLogger.fatal('tryApplyTransaction failed: applyResponse == null')
  //       }

  //       return false
  //     } finally {
  //       this.stateManager.fifoUnlock('accountModification', ourLockID)
  //       if (repairing !== true) {
  //         if (ourAccountLocks != null) {
  //           this.stateManager.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
  //         }
  //         if (logFlags.verbose) this.mainLogger.debug(` _repair tryApplyTransaction FIFO unlock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
  //       }
  //     }

  //     // have to wrestle with the data a bit so we can backup the full account and not jsut the partial account!
  //     // let dataResultsByKey = {}
  //     let dataResultsFullList = []
  //     for (let wrappedData of applyResponse.accountData) {
  //       // if (wrappedData.isPartial === false) {
  //       //   dataResultsFullList.push(wrappedData.data)
  //       // } else {
  //       //   dataResultsFullList.push(wrappedData.localCache)
  //       // }
  //       if (wrappedData.localCache != null) {
  //         dataResultsFullList.push(wrappedData)
  //       }
  //       // dataResultsByKey[wrappedData.accountId] = wrappedData.data
  //     }

  //     // this is just for debug!!!
  //     if (dataResultsFullList[0] == null) {
  //       for (let wrappedData of applyResponse.accountData) {
  //         if (wrappedData.localCache != null) {
  //           dataResultsFullList.push(wrappedData)
  //         }
  //         // dataResultsByKey[wrappedData.accountId] = wrappedData.data
  //       }
  //     }
  //     // if(dataResultsFullList == null){
  //     //   throw new Error(`tryApplyTransaction (dataResultsFullList == null  ${txTs} ${utils.stringifyReduce(acceptedTX)} `);
  //     // }

  //     // TSConversion verified that app.setAccount calls shardus.applyResponseAddState  that adds hash and txid to the data and turns it into AccountData
  //     let upgradedAccountDataList: Shardus.AccountData[] = (dataResultsFullList as unknown) as Shardus.AccountData[]

  //     await this.stateManager.updateAccountsCopyTable(upgradedAccountDataList, repairing, txTs)

  //     if (!repairing) {
  //       //if(savedSomething){
  //       this.stateManager.partitionObjects.tempRecordTXByCycle(txTs, acceptedTX, true, applyResponse, isGlobalModifyingTX, savedSomething)
  //       //}

  //       //WOW this was not good!  had acceptedTX.transactionGroup[0].id
  //       //if (this.p2p.getNodeId() === acceptedTX.transactionGroup[0].id) {

  //       let queueEntry: QueueEntry | null = this.stateManager.transactionQueue.getQueueEntry(acceptedTX.id)
  //       if (queueEntry != null && queueEntry.transactionGroup != null && this.p2p.getNodeId() === queueEntry.transactionGroup[0].id) {
  //         this.stateManager.eventEmitter.emit('txProcessed')
  //       }

  //       this.stateManager.eventEmitter.emit('txApplied', acceptedTX)
  //     }

  //     return true
  //   }

  /***
   *    ########     ###    ########  ######## #### ######## ####  #######  ##    ##     #######  ########        ## ########  ######  ########  ######      ##
   *    ##     ##   ## ##   ##     ##    ##     ##     ##     ##  ##     ## ###   ##    ##     ## ##     ##       ## ##       ##    ##    ##    ##    ##    ####
   *    ##     ##  ##   ##  ##     ##    ##     ##     ##     ##  ##     ## ####  ##    ##     ## ##     ##       ## ##       ##          ##    ##           ##
   *    ########  ##     ## ########     ##     ##     ##     ##  ##     ## ## ## ##    ##     ## ########        ## ######   ##          ##     ######
   *    ##        ######### ##   ##      ##     ##     ##     ##  ##     ## ##  ####    ##     ## ##     ## ##    ## ##       ##          ##          ##     ##
   *    ##        ##     ## ##    ##     ##     ##     ##     ##  ##     ## ##   ###    ##     ## ##     ## ##    ## ##       ##    ##    ##    ##    ##    ####
   *    ##        ##     ## ##     ##    ##    ####    ##    ####  #######  ##    ##     #######  ########   ######  ########  ######     ##     ######      ##
   */

  /***
   *    ########     ###    ########  ######## #### ######## ####  #######  ##    ##        #######  ########        ## ########  ######  ########  ######
   *    ##     ##   ## ##   ##     ##    ##     ##     ##     ##  ##     ## ###   ##       ##     ## ##     ##       ## ##       ##    ##    ##    ##    ##
   *    ##     ##  ##   ##  ##     ##    ##     ##     ##     ##  ##     ## ####  ##       ##     ## ##     ##       ## ##       ##          ##    ##
   *    ########  ##     ## ########     ##     ##     ##     ##  ##     ## ## ## ##       ##     ## ########        ## ######   ##          ##     ######
   *    ##        ######### ##   ##      ##     ##     ##     ##  ##     ## ##  ####       ##     ## ##     ## ##    ## ##       ##          ##          ##
   *    ##        ##     ## ##    ##     ##     ##     ##     ##  ##     ## ##   ###       ##     ## ##     ## ##    ## ##       ##    ##    ##    ##    ##
   *    ##        ##     ## ##     ##    ##    ####    ##    ####  #######  ##    ##        #######  ########   ######  ########  ######     ##     ######
   */

  //   /**
  //    * generatePartitionObjects
  //    * @param {Cycle} lastCycle
  //    */
  //   generatePartitionObjects(lastCycle: Shardus.Cycle) {
  //     let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(lastCycle.counter)

  //     // let partitions = ShardFunctions.getConsenusPartitions(lastCycleShardValues.shardGlobals, lastCycleShardValues.nodeShardData)
  //     // lastCycleShardValues.ourConsensusPartitions = partitions

  //     if (lastCycleShardValues == null) {
  //       throw new Error('generatePartitionObjects lastCycleShardValues == null' + lastCycle.counter)
  //     }

  //     let partitions = lastCycleShardValues.ourConsensusPartitions
  //     if (this.stateManager.useStoredPartitionsForReport === true) {
  //       partitions = lastCycleShardValues.ourStoredPartitions
  //     }
  //     if (partitions == null) {
  //       throw new Error('generatePartitionObjects partitions == null')
  //     }

  //     if (this.stateManager.feature_useNewParitionReport === false) {
  //       this.nextCycleReportToSend = { res: [], cycleNumber: lastCycle.counter }
  //     }

  //     let partitionObjects = []
  //     let partitionResults = []
  //     let cycleKey = 'c' + lastCycle.counter
  //     for (let partitionNumber of partitions) {
  //       // TODO sharding - done.  when we add state sharding need to loop over partitions.
  //       let partitionObject = this.generatePartitionObject(lastCycle, partitionNumber)

  //       // Nodes sign the partition hash along with the Partition_id, Cycle_number and timestamp to produce a partition result.
  //       let partitionResult = this.generatePartitionResult(partitionObject)

  //       if (this.stateManager.feature_useNewParitionReport === false) {
  //         this.nextCycleReportToSend.res.push({ i: partitionResult.Partition_id, h: partitionResult.Partition_hash })
  //       }
  //       // let partitionObjects = [partitionObject]
  //       // let partitionResults = [partitionResult]

  //       // this.partitionObjectsByCycle[cycleKey] = partitionObjects
  //       // this.ourPartitionResultsByCycle[cycleKey] = partitionResults // todo in the future there could be many results (one per covered partition)

  //       partitionObjects.push(partitionObject)
  //       partitionResults.push(partitionResult)

  //       this.partitionObjectsByCycle[cycleKey] = partitionObjects
  //       this.ourPartitionResultsByCycle[cycleKey] = partitionResults

  //       this.poMicroDebug(partitionObject)

  //       let partitionResultsByHash = this.recentPartitionObjectsByCycleByHash[cycleKey]
  //       if (partitionResultsByHash == null) {
  //         partitionResultsByHash = {}
  //         this.recentPartitionObjectsByCycleByHash[cycleKey] = partitionResultsByHash
  //       }
  //       // todo sharding done?  seems ok :   need to loop and put all results in this list
  //       // todo perf, need to clean out data from older cycles..
  //       partitionResultsByHash[partitionResult.Partition_hash] = partitionObject
  //     }

  //     // outside of the main loop
  //     // add our result to the list of all other results
  //     let responsesByPartition = this.allPartitionResponsesByCycleByPartition[cycleKey]
  //     if (!responsesByPartition) {
  //       responsesByPartition = {}
  //       this.allPartitionResponsesByCycleByPartition[cycleKey] = responsesByPartition
  //     }

  //     // this part should be good to go for sharding.
  //     for (let pResult of partitionResults) {
  //       let partitionKey = 'p' + pResult.Partition_id
  //       let responses = responsesByPartition[partitionKey]
  //       if (!responses) {
  //         responses = []
  //         responsesByPartition[partitionKey] = responses
  //       }
  //       let ourID = this.crypto.getPublicKey()
  //       // clean out an older response from same node if on exists
  //       responses = responses.filter((item) => item.sign && item.sign.owner !== ourID) // if the item is not signed clear it!
  //       responsesByPartition[partitionKey] = responses // have to re-assign this since it is a new ref to the array
  //       responses.push(pResult)
  //     }

  //     // return [partitionObject, partitionResult]
  //   }

  //   /**
  //    * generatePartitionResult
  //    * @param {PartitionObject} partitionObject
  //    * @returns {PartitionResult}
  //    */
  //   generatePartitionResult(partitionObject: PartitionObject): PartitionResult {
  //     let tempStates = partitionObject.States
  //     partitionObject.States = []
  //     let partitionHash = /** @type {string} */ this.crypto.hash(partitionObject)
  //     partitionObject.States = tempStates //Temp fix. do not record states as part of hash (for now)

  //     /** @type {PartitionResult} */
  //     let partitionResult = { Partition_hash: partitionHash, Partition_id: partitionObject.Partition_id, Cycle_number: partitionObject.Cycle_number, hashSet: '' }

  //     // let stepSize = cHashSetStepSize
  //     if (this.stateManager.useHashSets) {
  //       let hashSet = Depricated.createHashSetString(partitionObject.Txids, partitionObject.States) // TXSTATE_TODO
  //       partitionResult.hashSet = hashSet
  //     }

  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair partitionObject: ${utils.stringifyReduce(partitionObject)}`)
  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair generatePartitionResult: ${utils.stringifyReduce(partitionResult)}`)

  //     if (partitionObject.Txids && partitionObject.Txids.length > 0) {
  //       if (logFlags.playback) this.logger.playbackLogNote('partitionObject', 'c' + partitionObject.Cycle_number, partitionObject)
  //     }
  //     // nodeid in form of the signer!
  //     return partitionResult
  //   }

  //   /**
  //    * generatePartitionObject
  //    * @param {Cycle} lastCycle todo define cycle!!
  //    * @param {number} partitionId
  //    * @returns {PartitionObject}
  //    */
  //   generatePartitionObject(lastCycle: Cycle, partitionId: number) {
  //     let txList = this.getTXList(lastCycle.counter, partitionId)

  //     let txSourceData = txList
  //     if (txList.newTxList) {
  //       // TSConversion this forced us to add processed to newTxList.  probably a good fis for an oversight
  //       txSourceData = txList.newTxList
  //     }

  //     /** @type {PartitionObject} */
  //     let partitionObject = {
  //       Partition_id: partitionId,
  //       Partitions: 1,
  //       Cycle_number: lastCycle.counter,
  //       Cycle_marker: lastCycle.marker,
  //       Txids: txSourceData.hashes, // txid1, txid2, …],  - ordered from oldest to recent
  //       Status: txSourceData.passed, // [1,0, …],      - ordered corresponding to Txids; 1 for applied; 0 for failed
  //       States: txSourceData.states, // array of array of states
  //       Chain: [], // [partition_hash_341, partition_hash_342, partition_hash_343, …]
  //       // TODO prodution need to implment chain logic.  Chain logic is important for making a block chain out of are partition objects
  //     }
  //     return partitionObject
  //   }

  //   /**
  //    * partitionObjectToTxMaps
  //    * @param {PartitionObject} partitionObject
  //    * @returns {Object.<string,number>}
  //    */
  //   partitionObjectToTxMaps(partitionObject: PartitionObject): StatusMap {
  //     let statusMap: StatusMap = {}
  //     for (let i = 0; i < partitionObject.Txids.length; i++) {
  //       let tx = partitionObject.Txids[i]
  //       let status = partitionObject.Status[i]
  //       statusMap[tx] = status
  //     }
  //     return statusMap
  //   }

  //   /**
  //    * partitionObjectToStateMaps
  //    * @param {PartitionObject} partitionObject
  //    * @returns {Object.<string,string>}
  //    */
  //   partitionObjectToStateMaps(partitionObject: PartitionObject): StateMap {
  //     let statusMap: StateMap = {}
  //     for (let i = 0; i < partitionObject.Txids.length; i++) {
  //       let tx = partitionObject.Txids[i]
  //       let state = partitionObject.States[i]
  //       statusMap[tx] = state
  //     }
  //     return statusMap
  //   }

  //   /**
  //    * tryGeneratePartitionReciept
  //    * Generate a receipt if we have consensus
  //    * @param {PartitionResult[]} allResults
  //    * @param {PartitionResult} ourResult
  //    * @param {boolean} [repairPassHack]
  //    * @returns {{ partitionReceipt: PartitionReceipt; topResult: PartitionResult; success: boolean }}
  //    */
  //   tryGeneratePartitionReciept(allResults: PartitionResult[], ourResult: PartitionResult, repairPassHack = false) {
  //     let partitionId = ourResult.Partition_id
  //     let cycleCounter = ourResult.Cycle_number

  //     let key = 'c' + cycleCounter
  //     let key2 = 'p' + partitionId
  //     let debugKey = `rkeys: ${key} ${key2}`

  //     let repairTracker = this.stateManager.depricated._getRepairTrackerForCycle(cycleCounter, partitionId)
  //     repairTracker.busy = true // mark busy so we won't try to start this task again while in the middle of it

  //     // Tried hashes is not working correctly at the moment, it is an unused parameter. I am not even sure we want to ignore hashes
  //     let { topHash, topCount, topResult } = this.stateManager.depricated.findMostCommonResponse(cycleCounter, partitionId, repairTracker.triedHashes)

  //     if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept repairTracker: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)

  //     let requiredHalf = Math.max(1, allResults.length / 2)
  //     if (this.stateManager.useHashSets && repairPassHack) {
  //       // hack force our node to win:
  //       topCount = requiredHalf
  //       topHash = ourResult.Partition_hash
  //       if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept hack force win: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)
  //     }

  //     let resultsList = []
  //     if (topCount >= requiredHalf) {
  //       if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept: top hash wins: ` + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
  //       for (let partitionResult of allResults) {
  //         if (partitionResult.Partition_hash === topHash) {
  //           resultsList.push(partitionResult)
  //         }
  //       }
  //     } else {
  //       if (this.stateManager.useHashSets) {
  //         // bail in a way that will cause us to use the hashset strings
  //         if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept: did not win, useHashSets: ` + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
  //         return { partitionReceipt: null, topResult: null, success: false }
  //       }
  //       if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept: top hash failed: ` + utils.makeShortHash(topHash) + ` ${topCount} / ${requiredHalf}`)
  //       return { partitionReceipt: null, topResult, success: false }
  //     }

  //     if (ourResult.Partition_hash !== topHash) {
  //       if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept: our hash does not match: ` + utils.makeShortHash(topHash) + ` our hash: ${ourResult.Partition_hash}`)
  //       return { partitionReceipt: null, topResult, success: false }
  //     }

  //     let partitionReceipt = {
  //       resultsList,
  //     }

  //     if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept OK! ${utils.stringifyReduce({ partitionReceipt, topResult })}`)

  //     return { partitionReceipt, topResult, success: true }
  //   }

  //   /**
  //    * startRepairProcess
  //    * @param {Cycle} cycle
  //    * @param {PartitionResult} topResult
  //    * @param {number} partitionId
  //    * @param {string} ourLastResultHash
  //    */
  //   async startRepairProcess(cycle: Cycle, topResult: PartitionResult | null, partitionId: number, ourLastResultHash: string) {
  //     // todo update stateIsGood to follow a new metric based on the new data repair.
  //     this.stateManager.stateIsGood_txHashsetOld = false
  //     if (this.stateManager.canDataRepair === false) {
  //       // todo fix false negative results.  This may require inserting
  //       if (logFlags.verbose) this.mainLogger.error(`data oos detected. (old system) False negative results given if syncing. cycle: ${cycle.counter} partition: ${partitionId} `)
  //       return
  //     }
  //     return
  //   }

  //   // todo refactor some of the duped code in here
  //   // possibly have to split this into three functions to make that clean (find our result and the parition checking as sub funcitons... idk)
  //   /**
  //    * checkForGoodPartitionReciept
  //    *
  //    *  this is part of the old partition tracking and is only used for debugging now.
  //    *
  //    * @param {number} cycleNumber
  //    * @param {number} partitionId
  //    */
  //   async checkForGoodPartitionReciept(cycleNumber: number, partitionId: number) {
  //     // let repairTracker = this.stateManager.depricated._getRepairTrackerForCycle(cycleNumber, partitionId)

  //     let key = 'c' + cycleNumber
  //     let key2 = 'p' + partitionId
  //     let debugKey = `rkeys: ${key} ${key2}`

  //     // get responses
  //     let responsesById = this.allPartitionResponsesByCycleByPartition[key]
  //     let responses = responsesById[key2]

  //     // find our result
  //     let ourPartitionValues = this.ourPartitionResultsByCycle[key]
  //     let ourResult = null
  //     for (let obj of ourPartitionValues) {
  //       if (obj.Partition_id === partitionId) {
  //         ourResult = obj
  //         break
  //       }
  //     }
  //     if (ourResult == null) {
  //       throw new Error(`checkForGoodPartitionReciept ourResult == null ${debugKey}`)
  //     }
  //     let receiptResults = this.tryGeneratePartitionReciept(responses, ourResult) // TODO: how to mark block if we are already on a thread for this?
  //     let { partitionReceipt: partitionReceipt3, topResult: topResult3, success: success3 } = receiptResults
  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair checkForGoodPartitionReciept immediate receipt check. ${debugKey} success:${success3} topResult:${utils.stringifyReduce(topResult3)}  partitionReceipt: ${utils.stringifyReduce({ partitionReceipt3 })}`)

  //     // see if we already have a winning hash to correct to
  //     if (!success3) {
  //     //   if (repairTracker.awaitWinningHash) {
  //     //     if (topResult3 == null) {
  //     //       // if we are awaitWinningHash then wait for a top result before we start repair process again
  //     //       if (logFlags.verbose) this.mainLogger.debug(` _repair checkForGoodPartitionReciept awaitWinningHash:true but topResult == null so keep waiting ${debugKey}`)
  //     //     } else {
  //     //       if (logFlags.verbose) this.mainLogger.debug(` _repair checkForGoodPartitionReciept awaitWinningHash:true and we have a top result so start reparing! ${debugKey}`)
  //     //       if (logFlags.verbose) this.mainLogger.debug(` _repair checkForGoodPartitionReciept: tryGeneratePartitionReciept failed start repair process 3 ${debugKey} ${utils.stringifyReduce(receiptResults)}`)
  //     //       let cycle = this.p2p.state.getCycleByCounter(cycleNumber)
  //     //       await utils.sleep(1000)
  //     //       await this.startRepairProcess(cycle, topResult3, partitionId, ourResult.Partition_hash)
  //     //       // we are correcting to another hash.  don't bother sending our hash out
  //     //     }
  //     //   }
  //     } else {
  //       if (partitionReceipt3 == null) {
  //         throw new Error(`checkForGoodPartitionReciept partitionReceipt3 == null ${debugKey}`)
  //       }
  //       this.stateManager.storePartitionReceipt(cycleNumber, partitionReceipt3)
  //     //   this.stateManager.depricated.repairTrackerMarkFinished(repairTracker, 'checkForGoodPartitionReciept')
  //       if (logFlags.verbose) this.mainLogger.debug(` _repair checkForGoodPartitionReciept 2 allFinished, final ${debugKey} hash:${utils.stringifyReduce({ topResult3 })}`)
  //     }
  //   }

  //   /**
  //    * tempRecordTXByCycle
  //    * we dont have a cycle yet to save these records against so store them in a temp place
  //    * @param {number} txTS
  //    * @param {AcceptedTx} acceptedTx
  //    * @param {boolean} passed
  //    * @param {ApplyResponse} applyResponse
  //    * @param {boolean} isGlobalModifyingTX
  //    */
  //   tempRecordTXByCycle(txTS: number, acceptedTx: AcceptedTx, passed: boolean, applyResponse: ApplyResponse, isGlobalModifyingTX: boolean, savedSomething: boolean) {
  //     this.tempTXRecords.push({ txTS, acceptedTx, passed, redacted: -1, applyResponse, isGlobalModifyingTX, savedSomething })
  //   }

  //   /**
  //    * sortTXRecords
  //    * @param {TempTxRecord} a
  //    * @param {TempTxRecord} b
  //    * @returns {number}
  //    */
  //   sortTXRecords(a: TempTxRecord, b: TempTxRecord): number {
  //     if (a.acceptedTx.timestamp === b.acceptedTx.timestamp) {
  //       return utils.sortAsc(a.acceptedTx.id, b.acceptedTx.id)
  //     }
  //     //return a.acceptedTx.timestamp - b.acceptedTx.timestamp
  //     return a.acceptedTx.timestamp > b.acceptedTx.timestamp ? -1 : 1
  //   }

  //   /**
  //    * processTempTXs
  //    * call this before we start computing partitions so that we can make sure to get the TXs we need out of the temp list
  //    * @param {Cycle} cycle
  //    */
  //   processTempTXs(cycle: Cycle) {
  //     if (!this.tempTXRecords) {
  //       return
  //     }
  //     let txsRecorded = 0
  //     let txsTemp = 0

  //     let newTempTX = []
  //     let cycleEnd = (cycle.start + cycle.duration) * 1000
  //     cycleEnd -= this.stateManager.syncSettleTime // adjust by sync settle time

  //     // sort our records before recording them!
  //     this.tempTXRecords.sort(this.sortTXRecords)

  //     //savedSomething

  //     for (let txRecord of this.tempTXRecords) {
  //       if (txRecord.redacted > 0) {
  //         if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair recordTXByCycle: ${utils.makeShortHash(txRecord.acceptedTx.id)} cycle: ${cycle.counter} redacted!!! ${txRecord.redacted}`)
  //         continue
  //       }
  //       if (txRecord.txTS < cycleEnd) {
  //         this.recordTXByCycle(txRecord.txTS, txRecord.acceptedTx, txRecord.passed, txRecord.applyResponse, txRecord.isGlobalModifyingTX)
  //         txsRecorded++
  //       } else {
  //         newTempTX.push(txRecord)
  //         txsTemp++
  //       }
  //     }

  //     this.tempTXRecords = newTempTX

  //     let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(cycle.counter)

  //     if (lastCycleShardValues == null) {
  //       throw new Error('processTempTXs lastCycleShardValues == null')
  //     }
  //     if (lastCycleShardValues.ourConsensusPartitions == null) {
  //       throw new Error('processTempTXs ourConsensusPartitions == null')
  //     }
  //     // lastCycleShardValues.ourConsensusPartitions is not iterable
  //     for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
  //       let txList = this.getTXList(cycle.counter, partitionID) // todo sharding - done.: pass partition ID

  //       txList.processed = true
  //     }

  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair processTempTXs txsRecorded: ${txsRecorded} txsTemp: ${txsTemp} `)
  //   }

  //   // TODO sharding  done! need to split this out by partition
  //   /**
  //    * getTXList
  //    * @param {number} cycleNumber
  //    * @param {number} partitionId
  //    * @returns {TxTallyList}
  //    */
  //   getTXList(cycleNumber: number, partitionId: number): TxTallyList {
  //     let key = 'c' + cycleNumber
  //     let txListByPartition = this.txByCycleByPartition[key]
  //     let pkey = 'p' + partitionId
  //     // now search for the correct partition
  //     if (!txListByPartition) {
  //       txListByPartition = {}
  //       this.txByCycleByPartition[key] = txListByPartition
  //     }
  //     let txList = txListByPartition[pkey]
  //     if (!txList) {
  //       txList = { hashes: [], passed: [], txs: [], processed: false, states: [] } // , txById: {}
  //       txListByPartition[pkey] = txList
  //     }
  //     return txList
  //   }

  //   // take this tx and create if needed and object for the current cylce that holds a list of passed and failed TXs
  //   /**
  //    * recordTXByCycle
  //    *   This function is only for building up txList as used by the features: stateIsGood_txHashsetOld, oldFeature_BroadCastPartitionReport, oldFeature_GeneratePartitionReport
  //    * @param {number} txTS
  //    * @param {AcceptedTx} acceptedTx
  //    * @param {boolean} passed
  //    * @param {ApplyResponse} applyResponse
  //    */
  //   recordTXByCycle(txTS: number, acceptedTx: AcceptedTx, passed: boolean, applyResponse: ApplyResponse, isGlobalModifyingTX: boolean) {
  //     // TODO sharding.  done because it uses getTXList . filter TSs by the partition they belong to. Double check that this is still needed

  //     // get the cycle that this tx timestamp would belong to.
  //     // add in syncSettleTime when selecting which bucket to put a transaction in
  //     const cycle = this.p2p.state.getCycleByTimestamp(txTS + this.stateManager.syncSettleTime)

  //     if (cycle == null) {
  //       this.mainLogger.error(`recordTXByCycle Failed to find cycle that would contain this timestamp txid:${utils.stringifyReduce(acceptedTx.id)} txts1: ${acceptedTx.timestamp} txts: ${txTS}`)
  //       return
  //     }

  //     let cycleNumber = cycle.counter

  //     // for each covered partition..

  //     let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(cycle.counter)

  //     let keysResponse = this.app.getKeyFromTransaction(acceptedTx.data)
  //     let { allKeys } = keysResponse

  //     let seenParitions: StringBoolObjectMap = {}
  //     let partitionHasNonGlobal: StringBoolObjectMap = {}
  //     // for (let partitionID of lastCycleShardValues.ourConsensusPartitions) {
  //     if (lastCycleShardValues == null) {
  //       throw new Error(`recordTXByCycle lastCycleShardValues == null`)
  //     }

  //     if (isGlobalModifyingTX) {
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle:  ignore loggging globalTX ${txQueueEntry.logID} cycle: ${cycleNumber}`)
  //       return
  //     }

  //     let globalACC = 0
  //     let nonGlobal = 0
  //     let storedNonGlobal = 0
  //     let storedGlobal = 0
  //     //filter out stuff.
  //     if (isGlobalModifyingTX === false) {
  //       for (let accountKey of allKeys) {
  //         // HOMENODEMATHS recordTXByCycle: using partition to decide recording partition
  //         let { homePartition } = ShardFunctions.addressToPartition(lastCycleShardValues.shardGlobals, accountKey)
  //         let partitionID = homePartition
  //         let weStoreThisParition = ShardFunctions.testInRange(partitionID, lastCycleShardValues.nodeShardData.storedPartitions)
  //         let key = 'p' + partitionID

  //         if (this.stateManager.accountGlobals.isGlobalAccount(accountKey)) {
  //           globalACC++

  //           if (weStoreThisParition === true) {
  //             storedGlobal++
  //           }
  //         } else {
  //           nonGlobal++

  //           if (weStoreThisParition === true) {
  //             storedNonGlobal++
  //             partitionHasNonGlobal[key] = true
  //           }
  //         }
  //       }
  //     }

  //     if (storedNonGlobal === 0 && storedGlobal === 0) {
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle: nothing to save globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal} tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)
  //       return
  //     }
  //     if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle: globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal}  tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)

  //     for (let accountKey of allKeys) {
  //       /** @type {NodeShardData} */
  //       let homeNode = ShardFunctions.findHomeNode(lastCycleShardValues.shardGlobals, accountKey, lastCycleShardValues.parititionShardDataMap)
  //       if (homeNode == null) {
  //         throw new Error(`recordTXByCycle homeNode == null`)
  //       }
  //       // HOMENODEMATHS recordTXByCycle: this code has moved to use homepartition instead of home node's partition
  //       let homeNodepartitionID = homeNode.homePartition
  //       let { homePartition } = ShardFunctions.addressToPartition(lastCycleShardValues.shardGlobals, accountKey)
  //       let partitionID = homePartition
  //       let key = 'p' + partitionID

  //       if (this.stateManager.accountGlobals.isGlobalAccount(accountKey)) {
  //         if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle:  skip partition. dont save due to global: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)
  //         continue
  //       }

  //       let weStoreThisParition = ShardFunctions.testInRange(partitionID, lastCycleShardValues.nodeShardData.storedPartitions)
  //       if (weStoreThisParition === false) {
  //         if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle:  skip partition we dont save: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)

  //         continue
  //       }

  //       if (partitionHasNonGlobal[key] === false) {
  //         if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle:  skip partition. we store it but only a global ref involved this time: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)

  //         continue
  //       }
  //       //check if we are only storing this because it is a global account...

  //       let txList = this.getTXList(cycleNumber, partitionID) // todo sharding - done: pass partition ID

  //       if (txList.processed) {
  //         continue
  //         //this.mainLogger.error(`_repair trying to record transaction after we have already finalized our parition object for cycle ${cycle.counter} `)
  //       }

  //       if (seenParitions[key] != null) {
  //         if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle: seenParitions[key] != null P: ${partitionID}  homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber} entries: ${txList.hashes.length} --TX already recorded for cycle`)
  //         // skip because this partition already has this TX!
  //         continue
  //       }
  //       seenParitions[key] = true

  //       txList.hashes.push(acceptedTx.id)
  //       txList.passed.push(passed ? 1 : 0)
  //       txList.txs.push(acceptedTx)

  //       let recordedState = false
  //       if (applyResponse != null && applyResponse.accountData != null) {
  //         let states = []
  //         let foundAccountIndex = 0
  //         let index = 0
  //         for (let accountData of applyResponse.accountData) {
  //           if (accountData.accountId === accountKey) {
  //             foundAccountIndex = index
  //           }
  //           //states.push(utils.makeShortHash(accountData.hash)) // TXSTATE_TODO need to get only certain state data!.. hash of local states?
  //           // take a look at backup data?

  //           //TSConversion some uncertainty with around hash being on the data or not.  added logggin.
  //           // // @ts-ignore
  //           // if(accountData.hash != null){
  //           //   // @ts-ignore
  //           //   if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair recordTXByCycle:  how is this possible: ${utils.makeShortHash(accountData.accountId)} acc hash: ${utils.makeShortHash(accountData.hash)} acc stateID: ${utils.makeShortHash(accountData.stateId)}`)

  //           // }
  //           // if(accountData.stateId == null){
  //           //   // @ts-ignore
  //           //   throw new Error(`missing state id for ${utils.makeShortHash(accountData.accountId)} acc hash: ${utils.makeShortHash(accountData.hash)} acc stateID: ${utils.makeShortHash(accountData.stateId)} `)
  //           // }

  //           // account data got upgraded earlier to have hash on it

  //           //if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `recordTXByCycle: Pushed! P: ${partitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber} entries: ${txList.hashes.length} --TX already recorded for cycle`)

  //           states.push(utils.makeShortHash(((accountData as unknown) as Shardus.AccountData).hash))
  //           index++
  //           recordedState = true
  //         }
  //         txList.states.push(states[foundAccountIndex]) // TXSTATE_TODO does this check out?
  //       } else {
  //         txList.states.push('xxxx')
  //       }
  //       // txList.txById[acceptedTx.id] = acceptedTx
  //       // TODO sharding perf.  need to add some periodic cleanup when we have more cycles than needed stored in this map!!!
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair recordTXByCycle: pushedData P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber} entries: ${txList.hashes.length} recordedState: ${recordedState}`)
  //     }
  //   }

  /***
   *    ########  ########   #######     ###    ########   ######     ###     ######  ########
   *    ##     ## ##     ## ##     ##   ## ##   ##     ## ##    ##   ## ##   ##    ##    ##
   *    ##     ## ##     ## ##     ##  ##   ##  ##     ## ##        ##   ##  ##          ##
   *    ########  ########  ##     ## ##     ## ##     ## ##       ##     ##  ######     ##
   *    ##     ## ##   ##   ##     ## ######### ##     ## ##       #########       ##    ##
   *    ##     ## ##    ##  ##     ## ##     ## ##     ## ##    ## ##     ## ##    ##    ##
   *    ########  ##     ##  #######  ##     ## ########   ######  ##     ##  ######     ##
   */
  //   /**
  //    * broadcastPartitionResults
  //    * @param {number} cycleNumber
  //    */
  //   async broadcastPartitionResults(cycleNumber: number) {
  //     if (logFlags.verbose) this.mainLogger.debug(` _repair broadcastPartitionResults for cycle: ${cycleNumber}`)
  //     // per partition need to figure out which node cover it.
  //     // then get a list of all the results we need to send to a given node and send them at once.
  //     // need a way to do this in semi parallel?
  //     let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(cycleNumber)
  //     let partitionResults = this.ourPartitionResultsByCycle['c' + cycleNumber]
  //     let partitionResultsByNodeID = new Map() // use a map?
  //     let nodesToTell = []

  //     if (lastCycleShardValues == null) {
  //       throw new Error(`broadcastPartitionResults lastCycleShardValues == null  ${cycleNumber}`)
  //     }
  //     // sign results as needed
  //     for (let i = 0; i < partitionResults.length; i++) {
  //       /** @type {PartitionResult} */
  //       let partitionResult = partitionResults[i]
  //       if (!partitionResult.sign) {
  //         partitionResult = this.crypto.sign(partitionResult)
  //       }

  //       //check if we are syncing that cycle if so don't send out info on it!
  //       // if(this.getSyncTrackerForParition(partitionResult.Partition_id, lastCycleShardValues)) {
  //       //   if (logFlags.verbose ) this.mainLogger.debug( `broadcastPartitionResults skipped because parition is syncing ${partitionResult.Partition_id}`)
  //       //   continue
  //       // }

  //       // if(lastCycleShardValues.partitionsToSkip.has(partitionResult.Partition_id) === true){
  //       //   if (logFlags.verbose ) this.mainLogger.debug( `broadcastPartitionResults skipped because parition is syncing ${partitionResult.Partition_id}`)
  //       //   continue
  //       // }

  //       //if there is any tx that gets a slow down need to mark it.

  //       /** @type {ShardInfo} */
  //       let partitionShardData = lastCycleShardValues.parititionShardDataMap.get(partitionResult.Partition_id)
  //       // calculate nodes that care about this partition here
  //       // since we are using store partitions use storedBy
  //       // if we transfer back to covered partitions can switch back to coveredBy
  //       let coverCount = 0
  //       for (let nodeId in partitionShardData.storedBy) {
  //         if (partitionShardData.storedBy.hasOwnProperty(nodeId)) {
  //           // Test if node is active!!
  //           let possibleNode = partitionShardData.storedBy[nodeId]

  //           if (possibleNode.status !== 'active') {
  //             // don't count non active nodes for participating in the system.
  //             continue
  //           }

  //           coverCount++
  //           let partitionResultsToSend
  //           // If we haven't recorded this node yet create a new results object for it
  //           if (partitionResultsByNodeID.has(nodeId) === false) {
  //             nodesToTell.push(nodeId)
  //             partitionResultsToSend = { results: [], node: partitionShardData.storedBy[nodeId], debugStr: `c${partitionResult.Cycle_number} ` }
  //             partitionResultsByNodeID.set(nodeId, partitionResultsToSend)
  //           }
  //           partitionResultsToSend = partitionResultsByNodeID.get(nodeId)
  //           partitionResultsToSend.results.push(partitionResult)
  //           partitionResultsToSend.debugStr += `p${partitionResult.Partition_id} `
  //         }
  //       }

  //     //   let repairTracker = this.stateManager.depricated._getRepairTrackerForCycle(cycleNumber, partitionResult.Partition_id)
  //     //   repairTracker.numNodes = coverCount - 1 // todo sharding re-evaluate this and thing of a better perf solution
  //     }

  //     let promises = []
  //     for (let nodeId of nodesToTell) {
  //       if (nodeId === lastCycleShardValues.ourNode.id) {
  //         continue
  //       }
  //       let partitionResultsToSend = partitionResultsByNodeID.get(nodeId)
  //       let payload = { Cycle_number: cycleNumber, partitionResults: partitionResultsToSend.results }
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair broadcastPartitionResults to ${nodeId} debugStr: ${partitionResultsToSend.debugStr} res: ${utils.stringifyReduce(payload)}`)
  //       if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair broadcastPartitionResults to ${nodeId} debugStr: ${partitionResultsToSend.debugStr} res: ${utils.stringifyReduce(payload)}`)

  //       let shorthash = utils.makeShortHash(partitionResultsToSend.node.id)
  //       let toNodeStr = shorthash + ':' + partitionResultsToSend.node.externalPort
  //       if (logFlags.playback) this.logger.playbackLogNote('broadcastPartitionResults', `${cycleNumber}`, `to ${toNodeStr} ${partitionResultsToSend.debugStr} `)

  //       // Filter nodes before we send tell()
  //       let filteredNodes = this.stateManager.filterValidNodesForInternalMessage([partitionResultsToSend.node], 'tellCorrespondingNodes', true, true)
  //       if (filteredNodes.length === 0) {
  //         this.mainLogger.error('broadcastPartitionResults: filterValidNodesForInternalMessage skipping node')
  //         continue //only doing one node at a time in this loop so just skip to next node.
  //       }

  //       let promise = this.p2p.tell([partitionResultsToSend.node], 'post_partition_results', payload)
  //       promises.push(promise)
  //     }

  //     await Promise.all(promises)
  //   }


  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /***
   *    ##    ## ######## ##      ##       ########    ###     ######  ########        ######  ##    ## ##    ##  ######
   *    ###   ## ##       ##  ##  ##       ##         ## ##   ##    ##    ##          ##    ##  ##  ##  ###   ## ##    ##
   *    ####  ## ##       ##  ##  ##       ##        ##   ##  ##          ##          ##         ####   ####  ## ##
   *    ## ## ## ######   ##  ##  ##       ######   ##     ##  ######     ##           ######     ##    ## ## ## ##
   *    ##  #### ##       ##  ##  ##       ##       #########       ##    ##                ##    ##    ##  #### ##
   *    ##   ### ##       ##  ##  ##       ##       ##     ## ##    ##    ##          ##    ##    ##    ##   ### ##    ##
   *    ##    ## ########  ###  ###        ##       ##     ##  ######     ##           ######     ##    ##    ##  ######
   */
  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // async syncStateDataFast(requiredNodeCount: number) {
  //   // Dont sync if first node
  //   if (this.p2p.isFirstSeed) {
  //     this.dataSyncMainPhaseComplete = true
  //     this.syncStatement.syncComplete = true
  //     this.globalAccountsSynced = true
  //     this.stateManager.accountGlobals.hasknownGlobals = true
  //     this.readyforTXs = true
  //     if (logFlags.debug) this.mainLogger.debug(`DATASYNC: isFirstSeed = true. skipping sync`)
  //     return
  //   }

  //   this.isSyncingAcceptedTxs = true

  //   //await utils.sleep(5000) // Temporary delay to make it easier to attach a debugger
  //   if (logFlags.console) console.log('syncStateData start')
  //   // delete and re-create some tables before we sync:
  //   await this.storage.clearAppRelatedState()
  //   await this.app.deleteLocalAccountData()

  //   if (logFlags.debug) this.mainLogger.debug(`DATASYNC: starting syncStateDataFast`)

  //   this.requiredNodeCount = requiredNodeCount

  //   let hasValidShardData = this.stateManager.currentCycleShardData != null
  //   if (this.stateManager.currentCycleShardData != null) {
  //     hasValidShardData = this.stateManager.currentCycleShardData.hasCompleteData
  //   }
  //   while (hasValidShardData === false) {
  //     this.stateManager.getCurrentCycleShardData()
  //     await utils.sleep(1000)
  //     if (this.stateManager.currentCycleShardData == null) {
  //       if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_waitForShardData', ` `, ` ${utils.stringifyReduce(this.stateManager.currentCycleShardData)} `)
  //       hasValidShardData = false
  //     }
  //     if (this.stateManager.currentCycleShardData != null) {
  //       if (this.stateManager.currentCycleShardData.hasCompleteData == false) {
  //         let temp = this.p2p.state.getActiveNodes(null)
  //         if (logFlags.playback)
  //           this.logger.playbackLogNote(
  //             'shrd_sync_waitForShardData',
  //             ` `,
  //             `hasCompleteData:${this.stateManager.currentCycleShardData.hasCompleteData} active:${utils.stringifyReduce(temp)} ${utils.stringifyReduce(this.stateManager.currentCycleShardData)} `
  //           )
  //       } else {
  //         hasValidShardData = true
  //       }
  //     }
  //   }
  //   let nodeShardData = this.stateManager.currentCycleShardData.nodeShardData
  //   if (logFlags.console) console.log('GOT current cycle ' + '   time:' + utils.stringifyReduce(nodeShardData))

  //   let rangesToSync = [] as AddressRange[]

  //   let cycle = this.stateManager.currentCycleShardData.cycleNumber

  //   let homePartition = nodeShardData.homePartition

  //   if (logFlags.console) console.log(`homePartition: ${homePartition} storedPartitions: ${utils.stringifyReduce(nodeShardData.storedPartitions)}`)

  //   let chunksGuide = 4
  //   let syncRangeGoal = Math.max(1, Math.min(chunksGuide, Math.floor(this.stateManager.currentCycleShardData.shardGlobals.numPartitions / chunksGuide)))
  //   let partitionsCovered = 0
  //   let partitionsPerRange = 1

  //   if (nodeShardData.storedPartitions.rangeIsSplit === true) {
  //     partitionsCovered = nodeShardData.storedPartitions.partitionEnd1 - nodeShardData.storedPartitions.partitionStart1
  //     partitionsCovered += nodeShardData.storedPartitions.partitionEnd2 - nodeShardData.storedPartitions.partitionStart2
  //     partitionsPerRange = Math.max(Math.floor(partitionsCovered / syncRangeGoal), 1)
  //     if (logFlags.console) console.log(
  //       `syncRangeGoal ${syncRangeGoal}  chunksGuide:${chunksGuide} numPartitions:${this.stateManager.currentCycleShardData.shardGlobals.numPartitions} partitionsPerRange:${partitionsPerRange}`
  //     )

  //     let start = nodeShardData.storedPartitions.partitionStart1
  //     let end = nodeShardData.storedPartitions.partitionEnd1
  //     let currentStart = start
  //     let currentEnd = 0
  //     let nextLowAddress: string | null = null
  //     let i = 0
  //     while (currentEnd < end) {
  //       currentEnd = Math.min(currentStart + partitionsPerRange, end)
  //       let range = ShardFunctions.partitionToAddressRange2(this.stateManager.currentCycleShardData.shardGlobals, currentStart, currentEnd)

  //       let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
  //       range.high = address1

  //       if (nextLowAddress != null) {
  //         range.low = nextLowAddress
  //       }
  //       if (logFlags.console) console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
  //       nextLowAddress = address2
  //       currentStart = currentEnd
  //       i++
  //       rangesToSync.push(range)
  //     }

  //     start = nodeShardData.storedPartitions.partitionStart2
  //     end = nodeShardData.storedPartitions.partitionEnd2
  //     currentStart = start
  //     currentEnd = 0
  //     nextLowAddress = null

  //     while (currentEnd < end) {
  //       currentEnd = Math.min(currentStart + partitionsPerRange, end)
  //       let range = ShardFunctions.partitionToAddressRange2(this.stateManager.currentCycleShardData.shardGlobals, currentStart, currentEnd)

  //       let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
  //       range.high = address1

  //       if (nextLowAddress != null) {
  //         range.low = nextLowAddress
  //       }
  //       if (logFlags.console) console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition} a1: ${range.low} a2: ${range.high}`)

  //       nextLowAddress = address2
  //       currentStart = currentEnd
  //       i++
  //       rangesToSync.push(range)
  //     }
  //   } else {
  //     partitionsCovered = nodeShardData.storedPartitions.partitionEnd - nodeShardData.storedPartitions.partitionStart
  //     partitionsPerRange = Math.max(Math.floor(partitionsCovered / syncRangeGoal), 1)
  //     if (logFlags.console) console.log(
  //       `syncRangeGoal ${syncRangeGoal}  chunksGuide:${chunksGuide} numPartitions:${this.stateManager.currentCycleShardData.shardGlobals.numPartitions} partitionsPerRange:${partitionsPerRange}`
  //     )

  //     let start = nodeShardData.storedPartitions.partitionStart
  //     let end = nodeShardData.storedPartitions.partitionEnd

  //     let currentStart = start
  //     let currentEnd = 0
  //     let nextLowAddress: string | null = null
  //     let i = 0
  //     while (currentEnd < end) {
  //       currentEnd = Math.min(currentStart + partitionsPerRange, end)
  //       let range = ShardFunctions.partitionToAddressRange2(this.stateManager.currentCycleShardData.shardGlobals, currentStart, currentEnd)

  //       let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
  //       range.high = address1

  //       if (nextLowAddress != null) {
  //         range.low = nextLowAddress
  //       }
  //       if (logFlags.console) console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
  //       nextLowAddress = address2
  //       currentStart = currentEnd
  //       i++
  //       rangesToSync.push(range)
  //     }
  //   }

  //   // if we don't have a range to sync yet manually sync the whole range.
  //   if (rangesToSync.length === 0) {
  //     if (logFlags.console) console.log(`syncStateData ranges: pushing full range, no ranges found`)
  //     let range = ShardFunctions.partitionToAddressRange2(this.stateManager.currentCycleShardData.shardGlobals, 0, this.stateManager.currentCycleShardData.shardGlobals.numPartitions - 1)
  //     rangesToSync.push(range)
  //   }
  //   if (logFlags.console) console.log(`syncStateData ranges: ${utils.stringifyReduce(rangesToSync)}}`)

  //   for (let range of rangesToSync) {
  //     // let nodes = ShardFunctions.getNodesThatCoverRange(this.stateManager.currentCycleShardData.shardGlobals, range.low, range.high, this.stateManager.currentCycleShardData.ourNode, this.stateManager.currentCycleShardData.activeNodes)
  //     this.createSyncTrackerByRange(range, cycle)
  //   }

  //   this.createSyncTrackerByForGlobals(cycle)

  //   // must get a list of globals before we can listen to any TXs, otherwise the isGlobal function returns bad values
  //   await this.stateManager.accountGlobals.getGlobalListEarly()
  //   this.readyforTXs = true

  //   for (let syncTracker of this.syncTrackers) {
  //     // let partition = syncTracker.partition
  //     if (logFlags.console) console.log(`syncTracker start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
  //     if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_trackerRangeStart', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)

  //     syncTracker.syncStarted = true

  //     if (syncTracker.isGlobalSyncTracker === false) {
  //       await this.syncStateDataForRangeFast(syncTracker.range)
  //     } else {
  //       if (logFlags.console) console.log(`syncTracker syncStateDataGlobals start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
  //       await this.syncStateDataGlobalsFast(syncTracker)
  //     }
  //     syncTracker.syncFinished = true
  //     if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_trackerRangeEnd', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)
  //     this.clearSyncData()
  //   }
  //   if (logFlags.console) console.log('syncStateData end' + '   time:' + Date.now())
  // }

  // async syncStateDataForRangeFast(range: SimpleRange) {
  //   try {
  //     let partition = 'notUsed'
  //     this.currentRange = range
  //     this.addressRange = range // this.partitionToAddressRange(partition)

  //     this.partitionStartTimeStamp = Date.now()

  //     let lowAddress = this.addressRange.low
  //     let highAddress = this.addressRange.high

  //     partition = `${utils.stringifyReduce(lowAddress)} - ${utils.stringifyReduce(highAddress)}`

  //     this.readyforTXs = true // open the floodgates of queuing stuffs.

  //     await this.syncAccountDataFast(lowAddress, highAddress)
  //     if (logFlags.debug) this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncAccountData done.`)

  //     await this.processAccountDataFast()
  //   } catch (error) {
  //     if (error.message.includes('FailAndRestartPartition')) {
  //       if (logFlags.debug) this.mainLogger.debug(`DATASYNC: Error Failed at: ${error.stack}`)
  //       this.statemanager_fatal(`syncStateDataForRange_ex_failandrestart`, 'DATASYNC: FailAndRestartPartition: ' + error.name + ': ' + error.message + ' at ' + error.stack)
  //       await this.failandRestart()
  //     } else {
  //       this.statemanager_fatal(`syncStateDataForRange_ex`, 'syncStateDataForPartition failed: ' + error.name + ': ' + error.message + ' at ' + error.stack)
  //       if (logFlags.debug) this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + error.name + ': ' + error.message + ' at ' + error.stack)
  //       await this.failandRestart()
  //     }
  //   }
  // }

  // async syncAccountDataFast(lowAddress: string, highAddress: string) {
  //   // Sync the Account data
  //   //   Use the /get_account_data API to get the data from the Account Table using any of the nodes that had a matching hash
  //   if (logFlags.console) console.log(`syncAccountData3` + '   time:' + Date.now())

  //   if (this.config.stateManager == null) {
  //     throw new Error('this.config.stateManager == null')
  //   }

  //   let queryLow = lowAddress
  //   let queryHigh = highAddress

  //   let moreDataRemaining = true

  //   this.combinedAccountData = []
  //   let loopCount = 0

  //   let startTime = 0
  //   let lowTimeQuery = startTime
  //   // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
  //   while (moreDataRemaining) {
  //     // Node Precheck!
  //     if (this.dataSourceNode == null || this.stateManager.isNodeValidForInternalMessage(this.dataSourceNode.id, 'syncAccountData', true, true) === false) {
  //       if (logFlags.verbose && this.dataSourceNode == null) {
  //         if (logFlags.error) this.mainLogger.error(`syncAccountDataFast   this.dataSourceNode == null`)
  //       }
  //       if (this.tryNextDataSourceNode('syncAccountData') == false) {
  //         break
  //       }
  //       continue
  //     }

  //     // max records artificially low to make testing coverage better.  todo refactor: make it a config or calculate based on data size
  //     let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, maxRecords: this.config.stateManager.accountBucketSize }
  //     let r: GetAccountData3Resp | boolean = await this.p2p.ask(this.dataSourceNode, 'get_account_data3', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory

  //     // TSConversion need to consider better error handling here!
  //     let result: GetAccountData3Resp = r as GetAccountData3Resp

  //     if (result == null) {
  //       if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`ASK FAIL syncAccountData result == null node:${this.dataSourceNode.id}`)
  //       if (this.tryNextDataSourceNode('syncAccountData') == false) {
  //         break
  //       }
  //       continue
  //     }
  //     if (result.data == null) {
  //       if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`ASK FAIL syncAccountData result.data == null node:${this.dataSourceNode.id}`)
  //       if (this.tryNextDataSourceNode('syncAccountData') == false) {
  //         break
  //       }
  //       continue
  //     }
  //     // accountData is in the form [{accountId, stateId, data}] for n accounts.
  //     let accountData = result.data.wrappedAccounts

  //     let lastUpdateNeeded = result.data.lastUpdateNeeded

  //     // get the timestamp of the last account data received so we can use it as the low timestamp for our next query
  //     if (accountData.length > 0) {
  //       let lastAccount = accountData[accountData.length - 1]
  //       if (lastAccount.timestamp > lowTimeQuery) {
  //         lowTimeQuery = lastAccount.timestamp
  //         startTime = lowTimeQuery
  //       }
  //     }

  //     // If this is a repeated query, clear out any dupes from the new list we just got.
  //     // There could be many rows that use the stame timestamp so we will search and remove them
  //     let dataDuplicated = true
  //     if (loopCount > 0) {
  //       while (accountData.length > 0 && dataDuplicated) {
  //         let stateData = accountData[0]
  //         dataDuplicated = false
  //         for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
  //           let existingStateData = this.combinedAccountData[i]
  //           if (existingStateData.timestamp === stateData.timestamp && existingStateData.accountId === stateData.accountId) {
  //             dataDuplicated = true
  //             break
  //           }
  //           // once we get to an older timestamp we can stop looking, the outer loop will be done also
  //           if (existingStateData.timestamp < stateData.timestamp) {
  //             break
  //           }
  //         }
  //         if (dataDuplicated) {
  //           accountData.shift()
  //         }
  //       }
  //     }

  //     // if we have any accounts in wrappedAccounts2
  //     let accountData2 = result.data.wrappedAccounts2
  //     if (accountData2.length > 0) {
  //       while (accountData.length > 0 && dataDuplicated) {
  //         let stateData = accountData2[0]
  //         dataDuplicated = false
  //         for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
  //           let existingStateData = this.combinedAccountData[i]
  //           if (existingStateData.timestamp === stateData.timestamp && existingStateData.accountId === stateData.accountId) {
  //             dataDuplicated = true
  //             break
  //           }
  //           // once we get to an older timestamp we can stop looking, the outer loop will be done also
  //           if (existingStateData.timestamp < stateData.timestamp) {
  //             break
  //           }
  //         }
  //         if (dataDuplicated) {
  //           accountData2.shift()
  //         }
  //       }
  //     }

  //     if (lastUpdateNeeded || (accountData2.length === 0 && accountData.length === 0)) {
  //       moreDataRemaining = false
  //       if (logFlags.debug) this.mainLogger.debug(
  //         `DATASYNC: syncAccountData3 got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lowTimeQuery} highestTS1: ${result.data.highestTs}`
  //       )
  //       if (accountData.length > 0) {
  //         this.combinedAccountData = this.combinedAccountData.concat(accountData)
  //       }
  //       if (accountData2.length > 0) {
  //         this.combinedAccountData = this.combinedAccountData.concat(accountData2)
  //       }
  //     } else {
  //       if (logFlags.debug) this.mainLogger.debug(
  //         `DATASYNC: syncAccountData3b got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lowTimeQuery} highestTS1: ${result.data.highestTs}`
  //       )
  //       this.combinedAccountData = this.combinedAccountData.concat(accountData)
  //       loopCount++
  //       // await utils.sleep(500)
  //     }
  //     await utils.sleep(200)
  //   }
  // }

  // async processAccountDataFast() {
  //   this.missingAccountData = []
  //   this.mapAccountData = {}
  //   // create a fast lookup map for the accounts we have.  Perf.  will need to review if this fits into memory.  May need a novel structure.
  //   let account
  //   for (let i = 0; i < this.combinedAccountData.length; i++) {
  //     account = this.combinedAccountData[i]
  //     this.mapAccountData[account.accountId] = account
  //   }

  //   let accountKeys = Object.keys(this.mapAccountData)
  //   let uniqueAccounts = accountKeys.length
  //   let initialCombinedAccountLength = this.combinedAccountData.length
  //   if (uniqueAccounts < initialCombinedAccountLength) {
  //     // keep only the newest copies of each account:
  //     // we need this if using a time based datasync
  //     this.combinedAccountData = []
  //     for (let accountID of accountKeys) {
  //       this.combinedAccountData.push(this.mapAccountData[accountID])
  //     }
  //   }

  //   let missingTXs = 0
  //   let handledButOk = 0
  //   let otherMissingCase = 0

  //   //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
  //   this.accountsWithStateConflict = []
  //   let goodAccounts: Shardus.WrappedData[] = []
  //   let noSyncData = 0
  //   let noMatches = 0
  //   let outOfDateNoTxs = 0
  //   for (let account of this.combinedAccountData) {
  //     delete account.syncData
  //     goodAccounts.push(account)
  //   }
  //   if (logFlags.debug) this.mainLogger.debug(
  //     `DATASYNC: processAccountData saving ${goodAccounts.length} of ${this.combinedAccountData.length} records to db.  noSyncData: ${noSyncData} noMatches: ${noMatches} missingTXs: ${missingTXs} handledButOk: ${handledButOk} otherMissingCase: ${otherMissingCase} outOfDateNoTxs: ${outOfDateNoTxs}`
  //   )
  //   // failedHashes is a list of accounts that failed to match the hash reported by the server
  //   let failedHashes = await this.stateManager.checkAndSetAccountData(goodAccounts, 'syncNonGlobals:processAccountData', true) // repeatable form may need to call this in batches
  //   //this.stateManager.partitionStats.statsDataSummaryInit(goodAccounts)
  //   if (failedHashes.length > 1000) {
  //     if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes over 1000:  ${failedHashes.length} restarting sync process`)
  //     // state -> try another node. TODO record/eval/report blame?
  //     this.stateManager.recordPotentialBadnode()
  //     throw new Error('FailAndRestartPartition_processAccountDataFast_A')
  //   }
  //   if (failedHashes.length > 0) {
  //     if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes:  ${failedHashes.length} will have to download them again`)
  //     // TODO ? record/eval/report blame?
  //     this.stateManager.recordPotentialBadnode()
  //     this.failedAccounts = this.failedAccounts.concat(failedHashes)
  //     for (let accountId of failedHashes) {
  //       account = this.mapAccountData[accountId]

  //       if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData ${accountId}  data: ${utils.stringifyReduce(account)}`)

  //       if (account != null) {
  //         if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData adding account to list`)
  //         this.accountsWithStateConflict.push(account)
  //       } else {
  //         if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData cant find data: ${accountId}`)
  //         if (accountId) {
  //           //this.accountsWithStateConflict.push({ address: accountId,  }) //NOTE: fixed with refactor
  //           this.accountsWithStateConflict.push({ accountId: accountId, data: null, stateId: null, timestamp: 0 })
  //         }
  //       }
  //     }
  //   }

  //   await this.stateManager.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

  //   this.combinedAccountData = [] // we can clear this now.
  // }

  // async syncStateDataGlobalsFast(syncTracker: SyncTracker) {
  //   try {
  //     let partition = 'globals!'

  //     let globalAccounts = []
  //     let remainingAccountsToSync = []
  //     this.partitionStartTimeStamp = Date.now()

  //     if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals partition: ${partition} `)

  //     this.readyforTXs = true

  //     let globalReport: GlobalAccountReportResp = await this.getRobustGlobalReport()

  //     let hasAllGlobalData = false

  //     if (globalReport.accounts.length === 0) {
  //       if (logFlags.debug) this.mainLogger.debug(`DATASYNC:  syncStateDataGlobals no global accounts `)
  //       return // no global accounts
  //     }
  //     if (logFlags.debug) this.mainLogger.debug(`DATASYNC:  syncStateDataGlobals globalReport: ${utils.stringifyReduce(globalReport)} `)

  //     let accountReportsByID: { [id: string]: { id: string; hash: string; timestamp: number } } = {}
  //     for (let report of globalReport.accounts) {
  //       remainingAccountsToSync.push(report.id)

  //       accountReportsByID[report.id] = report
  //     }
  //     let accountData: Shardus.WrappedData[] = []
  //     let accountDataById: { [id: string]: Shardus.WrappedData } = {}
  //     let globalReport2: GlobalAccountReportResp = { ready: false, combinedHash: '', accounts: [] }
  //     let maxTries = 10
  //     while (hasAllGlobalData === false) {
  //       maxTries--
  //       if (maxTries <= 0) {
  //         if (logFlags.error) this.mainLogger.error(`DATASYNC: syncStateDataGlobals max tries excceded `)
  //         return
  //       }
  //       if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals hasAllGlobalData === false `)

  //       // Node Precheck!
  //       if (this.dataSourceNode == null || this.stateManager.isNodeValidForInternalMessage(this.dataSourceNode.id, 'syncStateDataGlobals', true, true) === false) {
  //         if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //           break
  //         }
  //         continue
  //       }

  //       let message = { accountIds: remainingAccountsToSync }
  //       let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message)

  //       if (result == null) {
  //         if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result == null')
  //         if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //           break
  //         }
  //         continue
  //       }
  //       if (result.accountData == null) {
  //         if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result.accountData == null')
  //         if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //           break
  //         }
  //         continue
  //       }

  //       accountData = accountData.concat(result.accountData)

  //       if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals get_account_data_by_list ${utils.stringifyReduce(result)} `)

  //       globalReport2 = await this.getRobustGlobalReport()
  //       let accountReportsByID2: { [id: string]: { id: string; hash: string; timestamp: number } } = {}
  //       for (let report of globalReport2.accounts) {
  //         accountReportsByID2[report.id] = report
  //       }

  //       hasAllGlobalData = true
  //       remainingAccountsToSync = []
  //       for (let account of accountData) {
  //         accountDataById[account.accountId] = account
  //         //newer copies will overwrite older ones in this map
  //       }
  //       //check the full report for any missing data
  //       for (let report of globalReport2.accounts) {
  //         if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts `)
  //         let data = accountDataById[report.id]
  //         if (data == null) {
  //           //we dont have the data
  //           hasAllGlobalData = false
  //           remainingAccountsToSync.push(report.id)
  //           if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data===null ${utils.makeShortHash(report.id)} `)
  //         } else if (data.stateId !== report.hash) {
  //           //we have the data but he hash is wrong
  //           hasAllGlobalData = false
  //           remainingAccountsToSync.push(report.id)
  //           if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data.stateId !== report.hash ${utils.makeShortHash(report.id)} `)
  //         }
  //       }
  //       //set this report to the last report and continue.
  //       accountReportsByID = accountReportsByID2
  //     }

  //     let dataToSet = []
  //     let cycleNumber = this.stateManager.currentCycleShardData.cycleNumber // Math.max(1, this.stateManager.currentCycleShardData.cycleNumber-1 ) //kinda hacky?

  //     let goodAccounts: Shardus.WrappedData[] = []

  //     //Write the data! and set global memory data!.  set accounts copy data too.
  //     for (let report of globalReport2.accounts) {
  //       if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts 2`)
  //       let accountData = accountDataById[report.id]
  //       if (accountData != null) {
  //         dataToSet.push(accountData)
  //         goodAccounts.push(accountData)
  //         if (this.stateManager.accountGlobals.globalAccountMap.has(report.id)) {
  //           if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals has ${utils.makeShortHash(report.id)} hash: ${utils.makeShortHash(report.hash)} ts: ${report.timestamp}`)
  //         } else {
  //           if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals setting ${utils.makeShortHash(report.id)} hash: ${utils.makeShortHash(report.hash)} ts: ${report.timestamp}`)
  //           // set the account in our table
  //           this.stateManager.accountGlobals.globalAccountMap.set(report.id, null)
  //           // push the time based backup count
  //           let accountId = report.id
  //           let data = accountData.data
  //           let timestamp = accountData.timestamp
  //           let hash = accountData.stateId
  //           let isGlobal = this.stateManager.accountGlobals.isGlobalAccount(accountId)
  //           let backupObj: Shardus.AccountsCopy = { accountId, data, timestamp, hash, cycleNumber, isGlobal }
  //           //if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug( `updateAccountsCopyTable acc.timestamp: ${timestamp} cycle computed:${cycleNumber} accountId:${utils.makeShortHash(accountId)}`)
  //           let globalBackupList: Shardus.AccountsCopy[] = this.stateManager.accountGlobals.getGlobalAccountBackupList(accountId)
  //           if (globalBackupList != null) {
  //             globalBackupList.push(backupObj) // sort and cleanup later.
  //             if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals push backup entry ${utils.makeShortHash(report.id)} hash: ${utils.makeShortHash(report.hash)} ts: ${report.timestamp}`)
  //           }
  //         }
  //       }
  //     }

  //     let failedHashes = await this.stateManager.checkAndSetAccountData(dataToSet, 'syncStateDataGlobals', true)

  //     if (logFlags.console) console.log('DBG goodAccounts', goodAccounts)

  //     await this.stateManager.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

  //     if (failedHashes && failedHashes.length > 0) {
  //       throw new Error('setting data falied no error handling for this yet')
  //     }
  //     if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals complete synced ${dataToSet.length} accounts `)
  //   } catch (error) {
  //     if (error.message.includes('FailAndRestartPartition')) {
  //       if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals Error Failed at: ${error.stack}`)
  //       this.statemanager_fatal(`syncStateDataGlobals_ex_failandrestart`, 'DATASYNC: syncStateDataGlobals FailAndRestartPartition: ' + error.name + ': ' + error.message + ' at ' + error.stack)
  //       await this.failandRestart()
  //     } else {
  //       this.statemanager_fatal(`syncStateDataGlobals_ex`, 'syncStateDataGlobals failed: ' + error.name + ': ' + error.message + ' at ' + error.stack)
  //       if (logFlags.debug) this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + error.name + ': ' + error.message + ' at ' + error.stack)
  //       await this.failandRestart()
  //     }
  //   }

  //   this.globalAccountsSynced = true
  // }



}

export default Depricated
