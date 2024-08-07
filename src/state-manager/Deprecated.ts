import * as Shardus from '../shardus/shardus-types'
import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger from '../logger'
import StateManager from '.'
import { Logger as log4jsLogger } from 'log4js'

// const cHashSetStepSize = 4
// const cHashSetTXStepSize = 2
// const cHashSetDataStepSize = 2

class Deprecated {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ServerConfiguration
  profiler: Profiler

  logger: Logger
  p2p: P2P
  storage: Storage
  stateManager: StateManager

  mainLogger: log4jsLogger
  fatalLogger: log4jsLogger
  shardLogger: log4jsLogger
  statsLogger: log4jsLogger
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

  constructor(
    stateManager: StateManager,
    profiler: Profiler,
    app: Shardus.App,
    logger: Logger,
    storage: Storage,
    p2p: P2P,
    crypto: Crypto,
    config: Shardus.ServerConfiguration
  ) {
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
  purgeTransactionData(): void {
    const tsStart = 0
    const tsEnd = 0
    this.storage.clearAcceptedTX(tsStart, tsEnd)
  }

  purgeStateTableData(): void {
    // do this by timestamp maybe..
    // this happnes on a slower scale.
    const tsEnd = 0 // todo get newest time to keep
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

  setupHandlers(): void {
    // // /get_account_state_hash (Acc_start, Acc_end, Ts_start, Ts_end)
    // // Acc_start - get data for accounts starting with this account id; inclusive
    // // Acc_end - get data for accounts up to this account id; inclusive
    // // Ts_start - get data newer than this timestamp
    // // Ts_end - get data older than this timestamp
    // // Returns a single hash of the data from the Account State Table determined by the input parameters; sort by Tx_ts  then Tx_id before taking the hash
    // // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    // this.p2p.registerInternal(
    //   'get_account_state_hash',
    //   async (
    //     payload: AccountStateHashReq,
    //     respond: (arg0: AccountStateHashResp) => Promise<number>,
    //     _sender: unknown,
    //     _tracker: string,
    //     msgSize: number
    //   ) => {
    //     this.profiler.scopedProfileSectionStart('get_account_state_hash', false, msgSize)
    //     let responseSize = cUninitializedSize
    //     try {
    //       const result = {} as AccountStateHashResp
    //       if (this.softSync_checkInitialFlag && this.initalSyncFinished === false) {
    //         //not ready?
    //         result.ready = false
    //         result.stateHash = this.stateManager.currentCycleShardData.ourNode.id
    //         await respond(result)
    //         return
    //       }
    //       // yikes need to potentially hash only N records at a time and return an array of hashes
    //       const stateHash = await this.stateManager.transactionQueue.getAccountsStateHash(
    //         payload.accountStart,
    //         payload.accountEnd,
    //         payload.tsStart,
    //         payload.tsEnd
    //       )
    //       result.stateHash = stateHash
    //       result.ready = true
    //       responseSize = await respond(result)
    //     } catch (e) {
    //       this.statemanager_fatal('get_account_state_hash', e)
    //     } finally {
    //       this.profiler.scopedProfileSectionEnd('get_account_state_hash', responseSize)
    //     }
    //   }
    // )
    // //    /get_account_state (Acc_start, Acc_end, Ts_start, Ts_end)
    // // Acc_start - get data for accounts starting with this account id; inclusive
    // // Acc_end - get data for accounts up to this account id; inclusive
    // // Ts_start - get data newer than this timestamp
    // // Ts_end - get data older than this timestamp
    // // Returns data from the Account State Table determined by the input parameters; limits result to 1000 records (as configured)
    // // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    // this.p2p.registerInternal(
    //   'get_account_state',
    //   async (
    //     payload: GetAccountStateReq,
    //     respond: (arg0: { accountStates: Shardus.StateTableObject[] }) => Promise<number>,
    //     _sender: unknown,
    //     _tracker: string,
    //     msgSize: number
    //   ) => {
    //     if (this.config.stateManager == null) {
    //       throw new Error('this.config.stateManager == null') //TODO TSConversion  would be nice to eliminate some of these config checks.
    //     }
    //     this.profiler.scopedProfileSectionStart('get_account_state', false, msgSize)
    //     const result = {} as { accountStates: Shardus.StateTableObject[] }
    //     // max records set artificially low for better test coverage
    //     // todo m11: make configs for how many records to query
    //     const accountStates = await this.storage.queryAccountStateTable(
    //       payload.accountStart,
    //       payload.accountEnd,
    //       payload.tsStart,
    //       payload.tsEnd,
    //       this.config.stateManager.stateTableBucketSize
    //     )
    //     result.accountStates = accountStates
    //     const responseSize = await respond(result)
    //     this.profiler.scopedProfileSectionEnd('get_account_state', responseSize)
    //   }
    // )
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
    //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index failed! returnedResults < expectedResults send ${returnedResults} < ${expectedResults}`)
    //       }
    //       acceptedTXs = await this.storage.queryAcceptedTransactionsByIds(txIDList)
    //       // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index failed! returnedResults < expectedResults send2 `)
    //       if (acceptedTXs != null && acceptedTXs.length < expectedResults) {
    //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index results ${utils.stringifyReduce(acceptedTXs)} snippets ${utils.stringifyReduce(payload.debugSnippets)} `)
    //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index results2:${utils.stringifyReduce(acceptedTXs.map((x: Shardus.AcceptedTx) => x.id))} snippets:${utils.stringifyReduce(payload.debugSnippets)} txid:${utils.stringifyReduce(txIDList)} `)
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
    //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(`get_transactions_by_partition_index failed! returnedResults < expectedResults send3 ${acceptedTXsBefore} < ${expectedResults} findsFixed: ${finds}  missing: ${utils.stringifyReduce(missingTXs)} found: ${utils.stringifyReduce(found)} acceptedTXs.length updated: ${acceptedTXs.length}`)
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

  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(' sendPartitionData ' + utils.stringifyReduceLimit({ combinedReciept, paritionObject }))

  //     // send it
  //     // this.p2p.archivers.sendPartitionData(combinedReciept, paritionObject)
  //   }

  //   sendTransactionData(partitionNumber: number, cycleNumber: number, transactions: AcceptedTx[]) {
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(' sendTransactionData ' + utils.stringifyReduceLimit({ partitionNumber, cycleNumber, transactions }))

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
  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair findMostCommonResponse: retVal: ${utils.stringifyReduce({ topHash, topCount, topResult })}  responses: ${utils.stringifyReduce(responses)} `)
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
  //                   //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug( ` solveHashSets overdelete fix: i:${i} j:${j} index:${index} bv:${nextCorrection.bv}}`)
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
  //       // /* prettier-ignore */ if (logFlags.console) console.log(`solution for set ${hashListIndex}  locallen:${hashListEntry.hashSet.length / stepSize} `)
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
  //         if (log) /* prettier-ignore */ if (logFlags.console) console.log(`testHashsetSolution error extra == null at i: ${i}  extraIndex: ${extraIndex}`)
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

  //     if (log) /* prettier-ignore */ if (logFlags.console) console.log(`extras removed: len: ${ourHashSet.indexMap.length}  extraIndex: ${extraIndex} ourPreHashSet: ${hashSet}`)

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
  //           if (log) /* prettier-ignore */ if (logFlags.console) console.log(`testHashsetSolution error null at i: ${i} solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
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
  //         //   /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error( `_mergeRepairDataIntoLocalState2 a error solutionDelta=null  solutionIndex: ${solutionIndex} i:${i} of ${ourHashSet.indexMap.length} deltas: ${utils.stringifyReduce(repairTracker.solutionDeltas)}`)
  //         // }
  //         // insert the next one
  //         newTxList.hashes[i] = solutionTxList.hashes[correction.i] // solutionDelta.tx.id

  //         // newTxList.states[i] = solutionTxList.states[correction.i] // TXSTATE_TODO

  //         if (newTxList.hashes[i] == null) {
  //           if (log) /* prettier-ignore */ if (logFlags.console) console.log(`testHashsetSolution error null at i: ${i}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
  //         }
  //         // newTxList.passed[i] = solutionDelta.pf
  //         // newTxList.txs[i] = solutionDelta.tx
  //         solutionIndex++
  //         // if (newTxList.hashes[i] == null) {
  //         //   /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error( `_mergeRepairDataIntoLocalState2 b error null at i: ${i}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter}`)
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
  //     // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug( `_mergeRepairDataIntoLocalState2 c  len: ${ourHashSet.indexMap.length}  solutionIndex: ${solutionIndex}  ourCounter: ${ourCounter} ourHashSet: ${hashSet}`)

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
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`_getRepairTrackerForCycle: creating for cycle:${counter} partition:${partition}`)
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
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`repairStats: finished repair ${combinedKey} -alreadyFlagged  tag:${debugTag}`)
  //       } else {
  //         this.stateManager.dataRepairsCompleted++
  //         this.repairCompletedMap.set(combinedKey, true)
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`repairStats: finished repair ${combinedKey} tag:${debugTag}`)
  //       }
  //     } else {
  //       // should be a trace?
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`repairStats: Calling complete on a key we dont have ${combinedKey} tag:${debugTag}`)
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
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` repairTrackerClearForNextRepair cycleNumber: ${repairTracker.counter} parition: ${repairTracker.partitionId} `)
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
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs cycleNumber ${cycleNumber} partition: ${specificParition}`)
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
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
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
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs: extra: ${utils.stringifyReduce(allExtraTXids)}  txIDToAcc: ${utils.stringifyReduce(txIDToAcc)}`)

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
  //               /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs problem with keysResp2  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
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
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs txList not found for: cycle: ${cycleNumber} in ${utils.stringifyReduce(this.stateManager.partitionObjects.txByCycleByPartition)}`)
  //       }

  //       // build and sort a list of TXs that we need to apply

  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs txIDResetExtraCount: ${txIDResetExtraCount} allAccountsToResetById ${utils.stringifyReduce(allAccountsToResetById)}`)
  //       // reset accounts
  //       let accountKeys = Object.keys(allAccountsToResetById)
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs revert accountKeys ${utils.stringifyReduce(accountKeys)}`)

  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs FIFO lock outer: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
  //       let ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(accountKeys)
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs FIFO lock inner: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)

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

  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs newTXList.length: ${newTXList.length} txKeys.length: ${txKeys.length} txIDToAccCount: ${txIDToAccCount}`)

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

  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs apply tx ${utils.makeShortHash(tx.id)} ${tx.timestamp} data: ${utils.stringifyReduce(tx)} with filter: ${utils.stringifyReduce(acountsFilter)}`)
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
  //               /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(' testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs' + utils.stringifyReduce(tx))
  //               /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('testAccountTime_failed', `${tx.id}`, ` testAccountTime failed. calling apoptosis. mergeAndApplyTXRepairs`)

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
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs no for ${tx.id} in ${utils.stringifyReduce(txIDToAcc)}`)
  //           }
  //         } catch (ex) {
  //           this.mainLogger.debug('_repair: startRepairProcess mergeAndApplyTXRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //           this.statemanager_fatal(`mergeAndApplyTXRepairs_ex`, '_repair: startRepairProcess mergeAndApplyTXRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //         }

  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs applyCount ${applyCount} applyFailCount: ${applyFailCount}`)
  //       }

  //       // unlock the accounts we locked...  todo maybe put this in a finally statement?
  //       this.stateManager.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair mergeAndApplyTXRepairs FIFO unlock: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
  //     }
  //   }

  //   /**
  //    * updateTrackingAndPrepareChanges
  //    * @param {number} cycleNumber
  //    * @param {number} specificParition the old version of this would repair all partitions but we had to wait.  this works on just one partition
  //    */
  //   async updateTrackingAndPrepareRepairs(cycleNumber: number, specificParition: number) {
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs cycleNumber ${cycleNumber} partition: ${specificParition}`)
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
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
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
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs: extra: ${utils.stringifyReduce(allExtraTXids)}  txIDToAcc: ${utils.stringifyReduce(txIDToAcc)}`)

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
  //               /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs problem with keysResp2  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(tx)}`)
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
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs txIDResetExtraCount:${txIDResetExtraCount} txIDToAccCount: ${txIDToAccCount}`)
  //       } else {
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs txList not found for: cycle: ${cycleNumber} in ${utils.stringifyReduce(this.stateManager.partitionObjects.txByCycleByPartition)}`)
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

  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs newTXList.length: ${newTXList.length} txKeys.length: ${txKeys.length} txIDToAccCount: ${txIDToAccCount}`)

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

  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair updateTrackingAndPrepareRepairs finished`)
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

  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs cycleNumber ${cycleNumber}`)

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

  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs allAccountsToResetById ${utils.stringifyReduce(allAccountsToResetById)}`)
  //     // reset accounts
  //     let accountKeys = Object.keys(allAccountsToResetById)
  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs revert accountKeys ${utils.stringifyReduce(accountKeys)}`)

  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs FIFO lock outer: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
  //     let ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(accountKeys)
  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs FIFO lock inner: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)

  //     // let replacmentAccounts =  //returned by the below function for debug
  //     await this._revertAccounts(accountKeys, cycleNumber)

  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs newTXList ${utils.stringifyReduce(newTXList)}`)
  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs newTXList.length: ${newTXList.length}`)

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

  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs apply tx ${utils.makeShortHash(tx.id)} ${tx.timestamp} data: ${utils.stringifyReduce(tx)} with filter: ${utils.stringifyReduce(acountsFilter)}`)
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
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(' applyAllPreparedRepairs testAccountTime failed. calling apoptosis. applyAllPreparedRepairs' + utils.stringifyReduce(tx))
  //             /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('testAccountTime_failed', `${tx.id}`, ` applyAllPreparedRepairs testAccountTime failed. calling apoptosis. applyAllPreparedRepairs`)
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
  //             //   /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error( ` _repair applyAllPreparedRepairs wrappedState == null ${utils.stringifyReduce(wrappedStateKey)} ${tx.timestamp}`)
  //             //   //could continue but want to see if there is more we can log.
  //             // }
  //             //is it global.
  //             if (this.stateManager.accountGlobals.isGlobalAccount(wrappedStateKey)) {
  //               // wrappedState.accountId)){
  //               /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', `applyAllPreparedRepairs - has`, ` ${wrappedState.accountId} ${wrappedStateKey}`)
  //               if (wrappedState != null) {
  //                 let globalValueSnapshot = this.stateManager.accountGlobals.getGlobalAccountValueAtTime(wrappedState.accountId, tx.timestamp)

  //                 if (globalValueSnapshot == null) {
  //                   //todo some error?
  //                   let globalAccountBackupList = this.stateManager.accountGlobals.getGlobalAccountBackupList(wrappedStateKey)
  //                   /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(` _repair applyAllPreparedRepairs has global key but no snapshot at time ${tx.timestamp} entries:${globalAccountBackupList.length} ${utils.stringifyReduce(globalAccountBackupList.map((a) => `${a.timestamp}  ${utils.makeShortHash(a.accountId)} `))}  `)
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
  //                   /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(` _repair applyAllPreparedRepairs has global key details ${tx.timestamp} entries:${globalAccountBackupList.length} ${utils.stringifyReduce(globalAccountBackupList.map((a) => `${a.timestamp}  ${utils.makeShortHash(a.accountId)} `))}  `)
  //                 }

  //                 /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs got global account to repair from: ${utils.stringifyReduce(newWrappedResponse)}`)
  //               }
  //             } else {
  //               if (wrappedState == null) {
  //                 /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(` _repair applyAllPreparedRepairs is not a global account but wrapped state == null ${utils.stringifyReduce(wrappedStateKey)} ${tx.timestamp}`)
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
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs no for ${tx.id} in ${utils.stringifyReduce(txIDToAcc)}`)
  //         }
  //       } catch (ex) {
  //         this.mainLogger.debug('_repair: startRepairProcess applyAllPreparedRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //         this.statemanager_fatal(`applyAllPreparedRepairs_fail`, '_repair: startRepairProcess applyAllPreparedRepairs apply: ' + ` ${utils.stringifyReduce({ tx, keysFilter })} ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //       }

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair applyAllPreparedRepairs applyCount ${applyCount} applyFailCount: ${applyFailCount}`)
  //     }

  //     // unlock the accounts we locked...  todo maybe put this in a finally statement?
  //     this.stateManager.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair applyAllPreparedRepairs FIFO unlock: ${cycleNumber}   ${utils.stringifyReduce(accountKeys)}`)
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
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts start  numAccounts: ${accountIDs.length} repairing cycle:${cycleNumber}`)

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
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(` _repair _revertAccounts null account data found: ${accountData.accountId} cycle: ${cycleNumber} data: ${utils.stringifyReduce(accountData)}`)
  //           } else {
  //             // todo overkill
  //             /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair _revertAccounts reset: ${utils.makeShortHash(accountData.accountId)} ts: ${utils.makeShortHash(accountData.timestamp)} cycle: ${cycleNumber} data: ${utils.stringifyReduce(accountData)}`)
  //           }
  //           // TODO: globalaccounts
  //           //this is where we need to no reset a global account, but instead grab the replacment data and cache it
  //           /// ////////////////////////
  //           //let isGlobalAccount = this.stateManager.accountGlobals.globalAccountMap.has(accountData.accountId )

  //           //Try not reverting global accounts..
  //           if (this.stateManager.accountGlobals.isGlobalAccount(accountData.accountId) === false) {
  //             replacmentAccountsMinusGlobals.push(accountData)
  //             /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair _revertAccounts not a global account, add to list ${utils.makeShortHash(accountData.accountId)}`)
  //           } else {
  //             /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair _revertAccounts was a global account, do not add to list ${utils.makeShortHash(accountData.accountId)}`)
  //           }
  //         }
  //         // tell the app to replace the account data
  //         //await this.app.resetAccountData(replacmentAccounts)
  //         await this.app.resetAccountData(replacmentAccountsMinusGlobals)
  //         // update local state.
  //       } else {
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts No replacment accounts found!!! cycle <= :${prevCycle}`)
  //       }

  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair _revertAccounts: ${accountIDs.length} replacmentAccounts ${replacmentAccounts.length} repairing cycle:${cycleNumber} replacmentAccountsMinusGlobals: ${replacmentAccountsMinusGlobals.length}`)

  //       // TODO prodution. consider if we need a better set of checks before we delete an account!
  //       // If we don't have a replacement copy for an account we should try to delete it

  //       // Find any accountIDs not in resetAccountData
  //       let accountsReverted: StringNumberObjectMap = {}
  //       let accountsToDelete: string[] = []
  //       let debug = []
  //       for (let accountData of replacmentAccounts) {
  //         accountsReverted[accountData.accountId] = 1
  //         if (accountData.cycleNumber > prevCycle) {
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(` _repair _revertAccounts cycle too new for backup restore: ${accountData.cycleNumber}  cycleNumber:${cycleNumber} timestamp:${accountData.timestamp}`)
  //         }

  //         debug.push({ id: accountData.accountId, cycleNumber: accountData.cycleNumber, timestamp: accountData.timestamp, hash: accountData.hash, accHash: accountData.data.hash, accTs: accountData.data.timestamp })
  //       }

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts: ${utils.stringifyReduce(debug)}`)

  //       for (let accountID of accountIDs) {
  //         if (accountsReverted[accountID] == null) {
  //           accountsToDelete.push(accountID)
  //         }
  //       }
  //       if (accountsToDelete.length > 0) {
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts delete some accounts ${utils.stringifyReduce(accountsToDelete)}`)
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
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair _revertAccounts problem with keysResp  ${utils.stringifyReduce(keysResponse)}  tx:  ${utils.stringifyReduce(txRecord.acceptedTx)}`)
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
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('testAccountTime account has future state.  id: ' + utils.makeShortHash(accountEntry.accountId) + ' time: ' + accountEntry.timestamp + ' txTime: ' + timestamp + ' delta: ' + (timestamp - accountEntry.timestamp))
  //         }
  //       }
  //       if (failedAgeCheck) {
  //         // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('DATASYNC: testAccountTimesAndStateTable accounts have future state ' + timestamp)
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

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  ts:${timestamp} repairing:${repairing} hasStateTableData:${hasStateTableData} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  filter: ${utils.stringifyReduce(filter)}`)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`)

  //       if (repairing !== true) {
  //         // get a list of modified account keys that we will lock
  //         let { sourceKeys, targetKeys } = keysResponse
  //         for (let accountID of sourceKeys) {
  //           accountKeys.push(accountID)
  //         }
  //         for (let accountID of targetKeys) {
  //           accountKeys.push(accountID)
  //         }
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair tryApplyTransaction FIFO lock outer: ${utils.stringifyReduce(accountKeys)} `)
  //         ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(accountKeys)
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair tryApplyTransaction FIFO lock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
  //       }

  //       ourLockID = await this.stateManager.fifoLock('accountModification')

  //       /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log(`tryApplyTransaction  ts:${timestamp} repairing:${repairing}  Applying!`)
  //       // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('APPSTATE: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))
  //       this.stateManager.transactionQueue.applySoftLock = true

  //       // let replyObject = { stateTableResults: [], txId, txTimestamp, accountData: [] }
  //       // let wrappedStatesList = Object.values(wrappedStates)

  //       // TSConversion need to check how save this cast is for the apply fuction, should probably do more in depth look at the tx param.
  //       applyResponse = this.app.apply(tx as Shardus.IncomingTransaction, wrappedStates)
  //       let { stateTableResults, accountData: _accountdata } = applyResponse
  //       accountDataList = _accountdata

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
  //       // wrappedStates are side effected for now
  //       savedSomething = await this.stateManager.setAccount(wrappedStates, localCachedData, applyResponse, isGlobalModifyingTX, filter)

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  accountData[${accountDataList.length}]: ${utils.stringifyReduce(accountDataList)}`)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryApplyTransaction  stateTableResults[${stateTableResults.length}]: ${utils.stringifyReduce(stateTableResults)}`)

  //       this.stateManager.transactionQueue.applySoftLock = false
  //       // only write our state table data if we dont already have it in the db
  //       if (hasStateTableData === false) {
  //         for (let stateT of stateTableResults) {
  //           /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' accounts total' + accountDataList.length)
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter) + ' txid: ' + utils.makeShortHash(acceptedTX.id) + ' ts: ' + acceptedTX.timestamp)
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
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair tryApplyTransaction FIFO unlock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
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

  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair partitionObject: ${utils.stringifyReduce(partitionObject)}`)
  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair generatePartitionResult: ${utils.stringifyReduce(partitionResult)}`)

  //     if (partitionObject.Txids && partitionObject.Txids.length > 0) {
  //       /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('partitionObject', 'c' + partitionObject.Cycle_number, partitionObject)
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

  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept repairTracker: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)

  //     let requiredHalf = Math.max(1, allResults.length / 2)
  //     if (this.stateManager.useHashSets && repairPassHack) {
  //       // hack force our node to win:
  //       topCount = requiredHalf
  //       topHash = ourResult.Partition_hash
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept hack force win: ${utils.stringifyReduce(repairTracker)} other: ${utils.stringifyReduce({ topHash, topCount, topResult })}`)
  //     }

  //     let resultsList = []
  //     if (topCount >= requiredHalf) {
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept: top hash wins: ` + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
  //       for (let partitionResult of allResults) {
  //         if (partitionResult.Partition_hash === topHash) {
  //           resultsList.push(partitionResult)
  //         }
  //       }
  //     } else {
  //       if (this.stateManager.useHashSets) {
  //         // bail in a way that will cause us to use the hashset strings
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept: did not win, useHashSets: ` + utils.makeShortHash(topHash) + ` ourResult: ${utils.makeShortHash(ourResult.Partition_hash)}  count/required ${topCount} / ${requiredHalf}`)
  //         return { partitionReceipt: null, topResult: null, success: false }
  //       }
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept: top hash failed: ` + utils.makeShortHash(topHash) + ` ${topCount} / ${requiredHalf}`)
  //       return { partitionReceipt: null, topResult, success: false }
  //     }

  //     if (ourResult.Partition_hash !== topHash) {
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept: our hash does not match: ` + utils.makeShortHash(topHash) + ` our hash: ${ourResult.Partition_hash}`)
  //       return { partitionReceipt: null, topResult, success: false }
  //     }

  //     let partitionReceipt = {
  //       resultsList,
  //     }

  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair  ${debugKey} tryGeneratePartitoinReciept OK! ${utils.stringifyReduce({ partitionReceipt, topResult })}`)

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
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(`data oos detected. (old system) False negative results given if syncing. cycle: ${cycle.counter} partition: ${partitionId} `)
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
  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair checkForGoodPartitionReciept immediate receipt check. ${debugKey} success:${success3} topResult:${utils.stringifyReduce(topResult3)}  partitionReceipt: ${utils.stringifyReduce({ partitionReceipt3 })}`)

  //     // see if we already have a winning hash to correct to
  //     if (!success3) {
  //     //   if (repairTracker.awaitWinningHash) {
  //     //     if (topResult3 == null) {
  //     //       // if we are awaitWinningHash then wait for a top result before we start repair process again
  //     //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair checkForGoodPartitionReciept awaitWinningHash:true but topResult == null so keep waiting ${debugKey}`)
  //     //     } else {
  //     //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair checkForGoodPartitionReciept awaitWinningHash:true and we have a top result so start reparing! ${debugKey}`)
  //     //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair checkForGoodPartitionReciept: tryGeneratePartitionReciept failed start repair process 3 ${debugKey} ${utils.stringifyReduce(receiptResults)}`)
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
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair checkForGoodPartitionReciept 2 allFinished, final ${debugKey} hash:${utils.stringifyReduce({ topResult3 })}`)
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
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair recordTXByCycle: ${utils.makeShortHash(txRecord.acceptedTx.id)} cycle: ${cycle.counter} redacted!!! ${txRecord.redacted}`)
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

  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair processTempTXs txsRecorded: ${txsRecorded} txsTemp: ${txsTemp} `)
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
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle:  ignore loggging globalTX ${txQueueEntry.logID} cycle: ${cycleNumber}`)
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
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle: nothing to save globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal} tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)
  //       return
  //     }
  //     /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle: globalAccounts: ${globalACC} nonGlobal: ${nonGlobal} storedNonGlobal:${storedNonGlobal} storedGlobal: ${storedGlobal}  tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)

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
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle:  skip partition. dont save due to global: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)
  //         continue
  //       }

  //       let weStoreThisParition = ShardFunctions.testInRange(partitionID, lastCycleShardValues.nodeShardData.storedPartitions)
  //       if (weStoreThisParition === false) {
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle:  skip partition we dont save: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)

  //         continue
  //       }

  //       if (partitionHasNonGlobal[key] === false) {
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle:  skip partition. we store it but only a global ref involved this time: P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber}`)

  //         continue
  //       }
  //       //check if we are only storing this because it is a global account...

  //       let txList = this.getTXList(cycleNumber, partitionID) // todo sharding - done: pass partition ID

  //       if (txList.processed) {
  //         continue
  //         //this.mainLogger.error(`_repair trying to record transaction after we have already finalized our parition object for cycle ${cycle.counter} `)
  //       }

  //       if (seenParitions[key] != null) {
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`recordTXByCycle: seenParitions[key] != null P: ${partitionID}  homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber} entries: ${txList.hashes.length} --TX already recorded for cycle`)
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
  //           //   /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug( ` _repair recordTXByCycle:  how is this possible: ${utils.makeShortHash(accountData.accountId)} acc hash: ${utils.makeShortHash(accountData.hash)} acc stateID: ${utils.makeShortHash(accountData.stateId)}`)

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
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair recordTXByCycle: pushedData P: ${partitionID} homeNodepartitionID: ${homeNodepartitionID} acc: ${utils.makeShortHash(accountKey)} tx: ${txQueueEntry.logID} cycle: ${cycleNumber} entries: ${txList.hashes.length} recordedState: ${recordedState}`)
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
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair broadcastPartitionResults for cycle: ${cycleNumber}`)
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
  //       //   /* prettier-ignore */ if (logFlags.verbose ) this.mainLogger.debug( `broadcastPartitionResults skipped because parition is syncing ${partitionResult.Partition_id}`)
  //       //   continue
  //       // }

  //       // if(lastCycleShardValues.partitionsToSkip.has(partitionResult.Partition_id) === true){
  //       //   /* prettier-ignore */ if (logFlags.verbose ) this.mainLogger.debug( `broadcastPartitionResults skipped because parition is syncing ${partitionResult.Partition_id}`)
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
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair broadcastPartitionResults to ${nodeId} debugStr: ${partitionResultsToSend.debugStr} res: ${utils.stringifyReduce(payload)}`)
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair broadcastPartitionResults to ${nodeId} debugStr: ${partitionResultsToSend.debugStr} res: ${utils.stringifyReduce(payload)}`)

  //       let shorthash = utils.makeShortHash(partitionResultsToSend.node.id)
  //       let toNodeStr = shorthash + ':' + partitionResultsToSend.node.externalPort
  //       /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('broadcastPartitionResults', `${cycleNumber}`, `to ${toNodeStr} ${partitionResultsToSend.debugStr} `)

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
  //       /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_waitForShardData', ` `, ` ${utils.stringifyReduce(this.stateManager.currentCycleShardData)} `)
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
  //   /* prettier-ignore */ if (logFlags.console) console.log('GOT current cycle ' + '   time:' + utils.stringifyReduce(nodeShardData))

  //   let rangesToSync = [] as AddressRange[]

  //   let cycle = this.stateManager.currentCycleShardData.cycleNumber

  //   let homePartition = nodeShardData.homePartition

  //   /* prettier-ignore */ if (logFlags.console) console.log(`homePartition: ${homePartition} storedPartitions: ${utils.stringifyReduce(nodeShardData.storedPartitions)}`)

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
  //       /* prettier-ignore */ if (logFlags.console) console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
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
  //       /* prettier-ignore */ if (logFlags.console) console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition} a1: ${range.low} a2: ${range.high}`)

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
  //       /* prettier-ignore */ if (logFlags.console) console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
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
  //     /* prettier-ignore */ if (logFlags.console) console.log(`syncTracker start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
  //     /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_trackerRangeStart', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)

  //     syncTracker.syncStarted = true

  //     if (syncTracker.isGlobalSyncTracker === false) {
  //       await this.syncStateDataForRangeFast(syncTracker.range)
  //     } else {
  //       /* prettier-ignore */ if (logFlags.console) console.log(`syncTracker syncStateDataGlobals start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
  //       await this.syncStateDataGlobalsFast(syncTracker)
  //     }
  //     syncTracker.syncFinished = true
  //     /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_trackerRangeEnd', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)
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
  //       this.statemanager_fatal(`syncStateDataForRange_ex_failandrestart`, 'DATASYNC: FailAndRestartPartition: ' + errorToStringFull(error))
  //       await this.failandRestart()
  //     } else {
  //       this.statemanager_fatal(`syncStateDataForRange_ex`, 'syncStateDataForPartition failed: ' + errorToStringFull(error))
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + errorToStringFull(error))
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
  //       /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`ASK FAIL syncAccountData result == null node:${this.dataSourceNode.id}`)
  //       if (this.tryNextDataSourceNode('syncAccountData') == false) {
  //         break
  //       }
  //       continue
  //     }
  //     if (result.data == null) {
  //       /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`ASK FAIL syncAccountData result.data == null node:${this.dataSourceNode.id}`)
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
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes over 1000:  ${failedHashes.length} restarting sync process`)
  //     // state -> try another node. TODO record/eval/report blame?
  //     this.stateManager.recordPotentialBadnode()
  //     throw new Error('FailAndRestartPartition_processAccountDataFast_A')
  //   }
  //   if (failedHashes.length > 0) {
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes:  ${failedHashes.length} will have to download them again`)
  //     // TODO ? record/eval/report blame?
  //     this.stateManager.recordPotentialBadnode()
  //     this.failedAccounts = this.failedAccounts.concat(failedHashes)
  //     for (let accountId of failedHashes) {
  //       account = this.mapAccountData[accountId]

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData ${accountId}  data: ${utils.stringifyReduce(account)}`)

  //       if (account != null) {
  //         if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData adding account to list`)
  //         this.accountsWithStateConflict.push(account)
  //       } else {
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData cant find data: ${accountId}`)
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
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC:  syncStateDataGlobals globalReport: ${utils.stringifyReduce(globalReport)} `)

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
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals hasAllGlobalData === false `)

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
  //         /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result == null')
  //         if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //           break
  //         }
  //         continue
  //       }
  //       if (result.accountData == null) {
  //         /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result.accountData == null')
  //         if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //           break
  //         }
  //         continue
  //       }

  //       accountData = accountData.concat(result.accountData)

  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals get_account_data_by_list ${utils.stringifyReduce(result)} `)

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
  //         /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts `)
  //         let data = accountDataById[report.id]
  //         if (data == null) {
  //           //we dont have the data
  //           hasAllGlobalData = false
  //           remainingAccountsToSync.push(report.id)
  //           /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data===null ${utils.makeShortHash(report.id)} `)
  //         } else if (data.stateId !== report.hash) {
  //           //we have the data but he hash is wrong
  //           hasAllGlobalData = false
  //           remainingAccountsToSync.push(report.id)
  //           /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data.stateId !== report.hash ${utils.makeShortHash(report.id)} `)
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
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts 2`)
  //       let accountData = accountDataById[report.id]
  //       if (accountData != null) {
  //         dataToSet.push(accountData)
  //         goodAccounts.push(accountData)
  //         if (this.stateManager.accountGlobals.globalAccountMap.has(report.id)) {
  //           /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals has ${utils.makeShortHash(report.id)} hash: ${utils.makeShortHash(report.hash)} ts: ${report.timestamp}`)
  //         } else {
  //           /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals setting ${utils.makeShortHash(report.id)} hash: ${utils.makeShortHash(report.hash)} ts: ${report.timestamp}`)
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
  //             /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals push backup entry ${utils.makeShortHash(report.id)} hash: ${utils.makeShortHash(report.hash)} ts: ${report.timestamp}`)
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
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals complete synced ${dataToSet.length} accounts `)
  //   } catch (error) {
  //     if (error.message.includes('FailAndRestartPartition')) {
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals Error Failed at: ${error.stack}`)
  //       this.statemanager_fatal(`syncStateDataGlobals_ex_failandrestart`, 'DATASYNC: syncStateDataGlobals FailAndRestartPartition: ' + errorToStringFull(error))
  //       await this.failandRestart()
  //     } else {
  //       this.statemanager_fatal(`syncStateDataGlobals_ex`, 'syncStateDataGlobals failed: ' + errorToStringFull(error))
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + errorToStringFull(error))
  //       await this.failandRestart()
  //     }
  //   }

  //   this.globalAccountsSynced = true
  // }

  // /**
  //  *   check if account is newer than TX.
  //  *   query StateTable to see if we alreayd have a record on this tx.
  //  *   check if TX is older than account cache timestamp
  //  */
  // async testAccountTimesAndStateTable2(tx: Shardus.OpaqueTransaction, wrappedStates: WrappedStates) {
  //   let hasStateTableData = false

  //   function tryGetAccountData(accountID: string) {
  //     return wrappedStates[accountID]
  //   }

  //   try {
  //     let keysResponse = this.app.getKeyFromTransaction(tx)
  //     let { sourceKeys, targetKeys, timestamp } = keysResponse
  //     let sourceAddress, sourceState, targetState

  //     // check account age to make sure it is older than the tx
  //     let failedAgeCheck = false

  //     let accountKeys = Object.keys(wrappedStates)
  //     for (let key of accountKeys) {
  //       let accountEntry = tryGetAccountData(key)
  //       if (accountEntry.timestamp >= timestamp) {
  //         failedAgeCheck = true
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('testAccountTimesAndStateTable account has future state.  id: ' + utils.makeShortHash(accountEntry.accountId) + ' time: ' + accountEntry.timestamp + ' txTime: ' + timestamp + ' delta: ' + (timestamp - accountEntry.timestamp))
  //       }
  //     }
  //     if (failedAgeCheck) {
  //       // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('DATASYNC: testAccountTimesAndStateTable accounts have future state ' + timestamp)
  //       return { success: false, hasStateTableData }
  //     }

  //     // TODO: even if we keep the code below this line, we should consider combining keys in a set first so that we dont
  //     // double up on work if a key is a source and target.

  //     // check state table
  //     if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
  //       sourceAddress = sourceKeys[0]
  //       let accountStates = await this.storage.searchAccountStateTable(sourceAddress, timestamp)
  //       if (accountStates.length !== 0) {
  //         let accountEntry = tryGetAccountData(sourceAddress)
  //         if (accountEntry == null) {
  //           return { success: false, hasStateTableData }
  //         }
  //         sourceState = accountEntry.stateId
  //         hasStateTableData = true
  //         if (accountStates.length === 0 || accountStates[0].stateBefore !== sourceState) {
  //           if (accountStates[0].stateBefore === '0'.repeat(64)) {
  //             //sorta broken security hole.
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('testAccountTimesAndStateTable ' + timestamp + 'bypass state comparision if before state was 00000: ' + utils.makeShortHash(sourceState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(sourceAddress))
  //           } else {
  //             /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1')
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 1 stateId: ' + utils.makeShortHash(sourceState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(sourceAddress))
  //             return { success: false, hasStateTableData }
  //           }
  //         }
  //       }
  //     }
  //     if (Array.isArray(targetKeys) && targetKeys.length > 0) {
  //       // targetAddress = targetKeys[0]
  //       for (let targetAddress of targetKeys) {
  //         let accountStates = await this.storage.searchAccountStateTable(targetAddress, timestamp)

  //         if (accountStates.length !== 0) {
  //           hasStateTableData = true
  //           if (accountStates.length !== 0 && accountStates[0].stateBefore !== allZeroes64) {
  //             let accountEntry = tryGetAccountData(targetAddress)

  //             if (accountEntry == null) {
  //               /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log('testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress))
  //               /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ')
  //               this.statemanager_fatal(`testAccountTimesAndStateTable_noEntry`, 'testAccountTimesAndStateTable ' + timestamp + ' target state does not exist. address: ' + utils.makeShortHash(targetAddress) + ' accountDataList: ') // todo: consider if this is just an error
  //               // fail this because we already check if the before state was all zeroes
  //               return { success: false, hasStateTableData }
  //             } else {
  //               targetState = accountEntry.stateId
  //               if (accountStates[0].stateBefore !== targetState) {
  //                 /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 2')
  //                 /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('testAccountTimesAndStateTable ' + timestamp + ' cant apply state 2 stateId: ' + utils.makeShortHash(targetState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(targetAddress))
  //                 return { success: false, hasStateTableData }
  //               }
  //             }
  //           }
  //         }
  //       }
  //     }
  //   } catch (ex) {
  //     this.statemanager_fatal(`testAccountTimesAndStateTable_ex`, 'testAccountTimesAndStateTable failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //   }
  //   return { success: true, hasStateTableData }
  // }

  // /**
  //  * testAccountTimes
  //  * check to see if any of the account data has timestamps newer or equal to the transaction
  //  * @param tx
  //  * @param wrappedStates
  //  */
  // testAccountTimes(tx: Shardus.OpaqueTransaction, wrappedStates: WrappedStates) {
  //   try {
  //     let keysResponse = this.app.getKeyFromTransaction(tx)
  //     let { sourceKeys, targetKeys, timestamp } = keysResponse

  //     // check account age to make sure it is older than the tx
  //     let failedAgeCheck = false

  //     let accountKeys = Object.keys(wrappedStates)
  //     for (let key of accountKeys) {
  //       let accountEntry = wrappedStates[key]
  //       if (accountEntry.timestamp >= timestamp) {
  //         failedAgeCheck = true
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('testAccountTimes account has future state.  id: ' + utils.makeShortHash(accountEntry.accountId) + ' time: ' + accountEntry.timestamp + ' txTime: ' + timestamp + ' delta: ' + (timestamp - accountEntry.timestamp))
  //       }
  //     }
  //     if (failedAgeCheck) {
  //       // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('DATASYNC: testAccountTimes accounts have future state ' + timestamp)

  //       return { success: false }
  //     }

  //   } catch (ex) {
  //     this.statemanager_fatal(`testAccountTimes_ex`, 'testAccountTimesAndStateTable failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //   }
  //   return { success: true }
  // }

  // /**
  //    * tryPreApplyTransaction this will try to apply a transaction but will not commit the data
  //    * @param acceptedTX
  //    * @param hasStateTableData
  //    * @param repairing
  //    * @param filter
  //    * @param wrappedStates
  //    * @param localCachedData
  //    */
  //   async tryPreApplyTransaction(acceptedTX: AcceptedTx, hasStateTableData: boolean, repairing: boolean, filter: AccountFilter, wrappedStates: WrappedResponses, localCachedData: LocalCachedData): Promise<{ passed: boolean; applyResult: string; applyResponse?: Shardus.ApplyResponse }> {
  //     let ourLockID = -1
  //     let accountDataList
  //     let txTs = 0
  //     let accountKeys = []
  //     let ourAccountLocks = null
  //     let applyResponse: Shardus.ApplyResponse | null = null
  //     //have to figure out if this is a global modifying tx, since that impacts if we will write to global account.
  //     let isGlobalModifyingTX = false

  //     try {
  //       let tx = acceptedTX.data
  //       // let receipt = acceptedTX.receipt
  //       let keysResponse = this.app.getKeyFromTransaction(tx)
  //       let { timestamp, debugInfo } = keysResponse
  //       txTs = timestamp

  //       let queueEntry = this.getQueueEntry(acceptedTX.id)
  //       if (queueEntry != null) {
  //         if (queueEntry.globalModification === true) {
  //           isGlobalModifyingTX = true
  //         }
  //       }

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryPreApplyTransaction  txid:${utils.stringifyReduce(acceptedTX.id)} ts:${timestamp} repairing:${repairing} hasStateTableData:${hasStateTableData} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryPreApplyTransaction  filter: ${utils.stringifyReduce(filter)}`)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryPreApplyTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryPreApplyTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryPreApplyTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`)

  //       // TODO ARCH REVIEW:  review use of fifo lock of accountModification and account keys.
  //       // I think we need to consider adding reader-writer lock support so that a non written to global account is a "reader" lock: check but dont aquire
  //       // consider if it is safe to axe the use of fifolock accountModification.
  //       if (repairing !== true) {
  //         // get a list of modified account keys that we will lock
  //         let { sourceKeys, targetKeys } = keysResponse
  //         for (let accountID of sourceKeys) {
  //           accountKeys.push(accountID)
  //         }
  //         for (let accountID of targetKeys) {
  //           accountKeys.push(accountID)
  //         }
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` tryPreApplyTransaction FIFO lock outer: ${utils.stringifyReduce(accountKeys)} `)
  //         ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(accountKeys)
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` tryPreApplyTransaction FIFO lock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
  //       }

  //       ourLockID = await this.stateManager.fifoLock('accountModification')

  //       /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log(`tryPreApplyTransaction  ts:${timestamp} repairing:${repairing}  Applying!`)
  //       this.applySoftLock = true

  //       applyResponse = this.app.apply(tx as Shardus.IncomingTransaction, wrappedStates)
  //       let { stateTableResults, accountData: _accountdata } = applyResponse
  //       accountDataList = _accountdata

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryPreApplyTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)

  //       this.applySoftLock = false
  //     } catch (ex) {
  //       /* prettier-ignore */ if(logFlags.error) if (logFlags.error) this.mainLogger.error(`tryPreApplyTransaction failed id:${utils.makeShortHash(acceptedTX.id)}: ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //       /* prettier-ignore */ if(logFlags.error) if (logFlags.error) this.mainLogger.error(`tryPreApplyTransaction failed id:${utils.makeShortHash(acceptedTX.id)}  ${utils.stringifyReduce(acceptedTX)}`)

  //       return { passed: false, applyResponse, applyResult: ex.message }
  //     } finally {
  //       this.stateManager.fifoUnlock('accountModification', ourLockID)
  //       if (repairing !== true) {
  //         if (ourAccountLocks != null) {
  //           this.stateManager.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
  //         }
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` tryPreApplyTransaction FIFO unlock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
  //       }
  //     }

  //     return { passed: true, applyResponse, applyResult: 'applied' }
  //   }

  // /**
  //  * preApplyAcceptedTransaction will apply a transaction to the in memory data but will not save the results to the database yet
  //  * @param acceptedTX
  //  * @param wrappedStates
  //  * @param localCachedData
  //  * @param filter
  //  */
  // async preApplyAcceptedTransaction_old(acceptedTX: AcceptedTx, wrappedStates: WrappedResponses, localCachedData: LocalCachedData, filter: AccountFilter): Promise<PreApplyAcceptedTransactionResult> {
  //   if (this.queueStopped) return
  //   let tx = acceptedTX.data
  //   let keysResponse = this.app.getKeyFromTransaction(tx)
  //   let { sourceKeys, targetKeys, timestamp, debugInfo } = keysResponse

  //   /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log('preApplyAcceptedTransaction ' + timestamp + ' debugInfo:' + debugInfo)
  //   /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('applyAcceptedTransaction ' + timestamp + ' debugInfo:' + debugInfo)

  //   let allkeys: string[] = []
  //   allkeys = allkeys.concat(sourceKeys)
  //   allkeys = allkeys.concat(targetKeys)

  //   let accountTimestampsAreOK = true

  //   for (let key of allkeys) {
  //     if (wrappedStates[key] == null) {
  //       /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log(`preApplyAcceptedTransaction missing some account data. timestamp:${timestamp}  key: ${utils.makeShortHash(key)}  debuginfo:${debugInfo}`)
  //       return { applied: false, passed: false, applyResult: '', reason: 'missing some account data' }
  //     } else {
  //       let wrappedState = wrappedStates[key]
  //       wrappedState.prevStateId = wrappedState.stateId
  //       wrappedState.prevDataCopy = utils.deepCopy(wrappedState.data)

  //       // important to update the wrappedState timestamp here to prevent bad timestamps from propagating the system
  //       let { timestamp: updatedTimestamp, hash: updatedHash } = this.app.getTimestampAndHashFromAccount(wrappedState.data)
  //       wrappedState.timestamp = updatedTimestamp

  //       // check if current account timestamp is too new for this TX
  //       if(wrappedState.timestamp >= timestamp){
  //         accountTimestampsAreOK = false
  //         break;
  //       }
  //     }
  //   }

  //   // // TODO ARCH REVIEW: the function does some slow stuff in terms of DB access. can we replace this with accounts cache functionality?
  //   // // old note:  todo review what we are checking here.
  //   // let { success } = this.testAccountTimes(tx, wrappedStates)
  //   let hasStateTableData = false // todo eliminate this.

  //   if (!accountTimestampsAreOK) {
  //     if (logFlags.verbose) this.mainLogger.debug('preApplyAcceptedTransaction pretest failed: ' + timestamp)
  //     /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tx_preapply_rejected 1', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
  //     return { applied: false, passed: false, applyResult: '', reason: 'preApplyAcceptedTransaction pretest failed, TX rejected' }
  //   }

  //   // TODO STATESHARDING4 I am not sure if this really needs to be split into a function anymore.
  //   // That mattered with data repair in older versions of the code, but that may be the wrong thing to do now
  //   let preApplyResult = await this.tryPreApplyTransaction(acceptedTX, hasStateTableData, false, filter, wrappedStates, localCachedData)

  //   if (preApplyResult) {
  //     if (logFlags.verbose) this.mainLogger.debug('preApplyAcceptedTransaction SUCCEDED ' + timestamp)
  //     /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tx_preapplied', `${acceptedTX.id}`, `AcceptedTransaction: ${utils.stringifyReduce(acceptedTX)}`)

  //   } else {
  //     /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tx_preapply_rejected 3', `${acceptedTX.id}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
  //   }

  //   return { applied: true, passed: preApplyResult.passed, applyResult: preApplyResult.applyResult, reason: 'apply result', applyResponse: preApplyResult.applyResponse }
  // }

  // async commitConsensedTransaction_old(applyResponse: Shardus.ApplyResponse, acceptedTX: AcceptedTx, hasStateTableData: boolean, repairing: boolean, filter: AccountFilter, wrappedStates: WrappedResponses, localCachedData: LocalCachedData): Promise<CommitConsensedTransactionResult> {
  //   let ourLockID = -1
  //   let accountDataList
  //   let txTs = 0
  //   let accountKeys = []
  //   let ourAccountLocks = null

  //   //have to figure out if this is a global modifying tx, since that impacts if we will write to global account.
  //   let isGlobalModifyingTX = false
  //   let savedSomething = false
  //   try {
  //     let tx = acceptedTX.data
  //     // let receipt = acceptedTX.receipt
  //     let keysResponse = this.app.getKeyFromTransaction(tx)
  //     let { timestamp, debugInfo } = keysResponse
  //     txTs = timestamp

  //     let queueEntry = this.getQueueEntry(acceptedTX.id)
  //     if (queueEntry != null) {
  //       if (queueEntry.globalModification === true) {
  //         isGlobalModifyingTX = true
  //       }
  //     }

  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  ts:${timestamp} repairing:${repairing} hasStateTableData:${hasStateTableData} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`)
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  filter: ${utils.stringifyReduce(filter)}`)
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`)

  //     // TODO ARCH REVIEW:  review use of fifo lock of accountModification and account keys. (more notes in tryPreApplyTransaction() above )
  //     if (repairing !== true) {
  //       // get a list of modified account keys that we will lock
  //       let { sourceKeys, targetKeys } = keysResponse
  //       for (let accountID of sourceKeys) {
  //         accountKeys.push(accountID)
  //       }
  //       for (let accountID of targetKeys) {
  //         accountKeys.push(accountID)
  //       }
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`commitConsensedTransaction FIFO lock outer: ${utils.stringifyReduce(accountKeys)} `)
  //       ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(accountKeys)
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`commitConsensedTransaction FIFO lock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
  //     }

  //     ourLockID = await this.stateManager.fifoLock('accountModification')

  //     /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log(`commitConsensedTransaction  ts:${timestamp} repairing:${repairing}  Applying!`)
  //     // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('APPSTATE: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))
  //     this.applySoftLock = true

  //     let { stateTableResults, accountData: _accountdata } = applyResponse
  //     accountDataList = _accountdata

  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)

  //     let note = `setAccountData: tx:${queueEntry.logID} in commitConsensedTransaction. `

  //     // wrappedStates are side effected for now
  //     savedSomething = await this.stateManager.setAccount(wrappedStates, localCachedData, applyResponse, isGlobalModifyingTX, filter, note)

  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  savedSomething: ${savedSomething}`)
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  accountData[${accountDataList.length}]: ${utils.stringifyReduce(accountDataList)}`)
  //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  stateTableResults[${stateTableResults.length}]: ${utils.stringifyReduce(stateTableResults)}`)

  //     this.applySoftLock = false
  //     // only write our state table data if we dont already have it in the db
  //     //if (hasStateTableData === false) {
  //       for (let stateT of stateTableResults) {
  //         // we have to correct this because it now gets stomped in the vote
  //         let wrappedRespose = wrappedStates[stateT.accountId]
  //         stateT.stateBefore = wrappedRespose.prevStateId

  //         /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' accounts total' + accountDataList.length)
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter) + ' txid: ' + utils.makeShortHash(acceptedTX.id) + ' ts: ' + acceptedTX.timestamp)
  //       }
  //       await this.storage.addAccountStates(stateTableResults)
  //     //   //want to confirm that we pretty much alway take this branch
  //     //   //pretty sure we would not have this data now
  //     //   nestedCountersInstance.countEvent('stateManager', 'txCommit hasOldStateTable = false')
  //     // } else {
  //     //   nestedCountersInstance.countEvent('stateManager', 'txCommit hasOldStateTable = true')
  //     // }

  //     // post validate that state ended up correctly?

  //     // write the accepted TX to storage
  //     this.storage.addAcceptedTransactions([acceptedTX])

  //     // endpoint to allow dapp to execute something that depends on a transaction being approved.
  //     this.app.transactionReceiptPass(acceptedTX.data, wrappedStates, applyResponse)
  //   } catch (ex) {
  //     this.statemanager_fatal(`commitConsensedTransaction_ex`, 'commitConsensedTransaction failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`commitConsensedTransaction failed id:${utils.makeShortHash(acceptedTX.id)}  ${utils.stringifyReduce(acceptedTX)}`)
  //     if (applyResponse) {
  //       // && savedSomething){
  //       // TSConversion do we really want to record this?
  //       // if (!repairing) this.stateManager.partitionObjects.tempRecordTXByCycle(txTs, acceptedTX, false, applyResponse, isGlobalModifyingTX, savedSomething)
  //       // record no-op state table fail:
  //     } else {
  //       // this.fatalLogger.fatal('tryApplyTransaction failed: applyResponse == null')
  //     }

  //     return { success: false }
  //   } finally {
  //     this.stateManager.fifoUnlock('accountModification', ourLockID)
  //     if (repairing !== true) {
  //       if (ourAccountLocks != null) {
  //         this.stateManager.bulkFifoUnlockAccounts(accountKeys, ourAccountLocks)
  //       }
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction FIFO unlock inner: ${utils.stringifyReduce(accountKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
  //     }
  //   }

  //   // have to wrestle with the data a bit so we can backup the full account and not jsut the partial account!
  //   // let dataResultsByKey = {}
  //   let dataResultsFullList = []
  //   for (let wrappedData of applyResponse.accountData) {
  //     // if (wrappedData.isPartial === false) {
  //     //   dataResultsFullList.push(wrappedData.data)
  //     // } else {
  //     //   dataResultsFullList.push(wrappedData.localCache)
  //     // }
  //     if (wrappedData.localCache != null) {
  //       dataResultsFullList.push(wrappedData)
  //     }
  //     // dataResultsByKey[wrappedData.accountId] = wrappedData.data
  //   }

  //   // this is just for debug!!!
  //   if (dataResultsFullList[0] == null) {
  //     for (let wrappedData of applyResponse.accountData) {
  //       if (wrappedData.localCache != null) {
  //         dataResultsFullList.push(wrappedData)
  //       }
  //       // dataResultsByKey[wrappedData.accountId] = wrappedData.data
  //     }
  //   }
  //   // if(dataResultsFullList == null){
  //   //   throw new Error(`tryApplyTransaction (dataResultsFullList == null  ${txTs} ${utils.stringifyReduce(acceptedTX)} `);
  //   // }

  //   // TSConversion verified that app.setAccount calls shardus.applyResponseAddState  that adds hash and txid to the data and turns it into AccountData
  //   let upgradedAccountDataList: Shardus.AccountData[] = (dataResultsFullList as unknown) as Shardus.AccountData[]

  //   // TODO ARCH REVIEW:  do we still need this table.  if so do we need to await writing to it?
  //   await this.stateManager.updateAccountsCopyTable(upgradedAccountDataList, repairing, txTs)

  //   if (!repairing) {
  //     //if(savedSomething){
  //     //this.stateManager.partitionObjects.tempRecordTXByCycle(txTs, acceptedTX, true, applyResponse, isGlobalModifyingTX, savedSomething)
  //     //}

  //     //WOW this was not good!  had acceptedTX.transactionGroup[0].id
  //     //if (this.p2p.getNodeId() === acceptedTX.transactionGroup[0].id) {

  //     let queueEntry: QueueEntry | null = this.getQueueEntry(acceptedTX.id)
  //     if (queueEntry != null && queueEntry.transactionGroup != null && this.p2p.getNodeId() === queueEntry.transactionGroup[0].id) {
  //       this.stateManager.eventEmitter.emit('txProcessed')
  //     }
  //     this.stateManager.eventEmitter.emit('txApplied', acceptedTX)

  //     this.stateManager.partitionStats.statsTxSummaryUpdate(queueEntry.cycleToRecordOn, queueEntry)
  //     for (let wrappedData of applyResponse.accountData) {
  //       //this.stateManager.partitionStats.statsDataSummaryUpdate(wrappedData.prevDataCopy, wrappedData)

  //       let queueData = queueEntry.collectedData[wrappedData.accountId]

  //       if (queueData != null) {
  //         if (queueData.accountCreated) {
  //           //account was created to do a summary init
  //           //this.stateManager.partitionStats.statsDataSummaryInit(queueEntry.cycleToRecordOn, queueData);
  //           this.stateManager.partitionStats.statsDataSummaryInitRaw(queueEntry.cycleToRecordOn, queueData.accountId, queueData.prevDataCopy)
  //         }
  //         this.stateManager.partitionStats.statsDataSummaryUpdate2(queueEntry.cycleToRecordOn, queueData.prevDataCopy, wrappedData)
  //       } else {
  //         /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`commitConsensedTransaction failed to get account data for stats ${wrappedData.accountId}`)
  //       }
  //     }
  //   }

  //   return { success: true }
  // }

  //     /**
  //      * @param {ShardGlobals} shardGlobals
  //      * @param {number} s1 stored partition left lower bound (always 0)
  //      * @param {number} e1 stored partition left upper bound
  //      * @param {number} s2 stored partition right lower bound
  //      * @param {number} e2 stored partition right upper bound (always highest parition)
  //      * @param {number} start start of consensus range
  //      * @param {number} end end of consensus range
  //      * @returns {{s1:number; e1: number; s2: number; e2: number; split: boolean; changed: boolean }}
  //      */
  //     static mergeDiverseRanges(shardGlobals: ShardGlobals, s1: number, e1: number, s2: number, e2: number, start: number, end: number): MergeResults {
  //         let results = { s1, e1, s2, e2, split: true, changed: false }

  //         //These refer to the consensus range haning off the edge of the stored range.  i.e. consenus going further than stored.
  //         let leftOverlap = false
  //         let rightOverlap = false
  //         let leftOverhang = false
  //         let rightOverhang = false

  //         let nonSplitConsensusRange = start <= end

  //         let storedfullyOverlapsConsensus = false

  //         // check overlap in simple case where consensus does not wrap
  //         if (nonSplitConsensusRange) {
  //             // left overlap.  Really this means that there is some overlap of consenus and the left side range of stored partitions
  //             if (s1 <= start && e1 >= start) {
  //                 // number = partition id.   s = stored partition c = consensus partition  ^ = where the test point or points are
  //                 // 0123456789
  //                 // sss      s
  //                 //  ccc
  //                 //  ^
  //                 leftOverlap = true
  //             }
  //             // right overlap  Really this means that there is some overlap of consenus and the right side range of stored partitions
  //             if (s2 <= end && e2 >= end) {
  //                 // 0123456789
  //                 // s      sss
  //                 //       ccc
  //                 //         ^
  //                 rightOverlap = true
  //             }

  //             // full overlap left
  //             if (s1 <= start && e1 >= end) {
  //                 // 0123456789
  //                 // sssss    s
  //                 //   ccc
  //                 //   ^ ^
  //                 storedfullyOverlapsConsensus = true
  //             }
  //             // full overlap right
  //             if (s2 <= start && e2 >= end) {
  //                 // 0123456789
  //                 // s    sssss
  //                 //       ccc
  //                 //       ^ ^
  //                 storedfullyOverlapsConsensus = true
  //             }
  //         }

  //         // If the consensus range wraps across our ranges then we need to check additional cases
  //         if (nonSplitConsensusRange === false) {
  //             if (s1 <= end && e1 >= end && s2 <= start && e2 >= start) {
  //                 // 0123456789
  //                 // ssss    ss
  //                 // ccc      c
  //                 // ^ ^      ^
  //                 storedfullyOverlapsConsensus = true
  //             }

  //             //cases not caught yet?
  //             // 0123456789
  //             // ss     sss
  //             // c     cccc
  //             //

  //             // 0123456789
  //             // ss     sss
  //             // ccc     cc
  //             //

  //             if (end > e1 && end < s2) {
  //                 // 0123456789
  //                 // ss     sss
  //                 // ccc     cc
  //                 //   ^
  //                 leftOverhang = true
  //             }
  //             // right overlap  Really this means that there is some overlap of consenus and the right side range of stored partitions
  //             if (start < s2 && start > e1) {
  //                 // number = partition id.   s = stored partition c = consensus partition  ^ = where the test point or points are
  //                 // 0123456789
  //                 // ss     sss
  //                 // c     cccc
  //                 //       ^
  //                 rightOverhang = true
  //             }
  //         }

  //         // nothing to do ther is full overlap
  //         if (storedfullyOverlapsConsensus === true) {
  //             return results
  //         }

  //         if (leftOverlap === false && rightOverlap === false && nonSplitConsensusRange === true) {
  //             let partitionDistanceStart = ShardFunctions.circularDistance(start, e1, shardGlobals.numPartitions)
  //             let partitionDistanceEnd = ShardFunctions.circularDistance(end, s2, shardGlobals.numPartitions)

  //             if (partitionDistanceStart < partitionDistanceEnd) {
  //                 // 0123456789
  //                 // ss      ss
  //                 //    cc
  //                 // rrrrr   rr  r= result range
  //                 if (results.e1 < end) {
  //                     results.e1 = end
  //                     results.changed = true
  //                     return results
  //                 }
  //             } else {
  //                 // 0123456789
  //                 // ss      ss
  //                 //      cc
  //                 // rr   rrrrr  r= result range
  //                 if (results.s2 > start) {
  //                     results.s2 = start
  //                     results.changed = true
  //                     return results
  //                 }
  //             }
  //         }

  //         if (leftOverlap === true && rightOverlap === true && nonSplitConsensusRange === true) {
  //             // if left and right overlap then all partitions are stored:
  //             // 0123456789
  //             // ss     sss
  //             //  ccccccc
  //             // rrrrrrrrrr  r= result range
  //             if (results.e1 !== results.e2) {
  //                 results.split = false
  //                 results.e1 = results.e2 // s1 -> e1 covers entire range
  //                 results.changed = true
  //                 return results
  //             }
  //         }

  //         if (leftOverlap) {
  //             // 0123456789
  //             // sss      s
  //             //  ccc
  //             // rrrr     r
  //             if (results.e1 < end) {
  //                 results.e1 = end
  //                 results.changed = true
  //             }
  //         }
  //         if (rightOverlap) {
  //             // 0123456789
  //             // sss      s
  //             //  ccc
  //             // rrrr     r
  //             if (results.s2 > start) {
  //                 results.s2 = start
  //                 results.changed = true
  //             }
  //         }

  //         if (leftOverhang) {
  //             // 0123456789
  //             // ss     sss
  //             // ccc     cc
  //             // rrr    rrr  r= result range
  //             if (results.e1 < end) {
  //                 results.e1 = end
  //                 results.changed = true
  //             }
  //         }
  //         if (rightOverhang) {
  //             // 0123456789
  //             // s      sss
  //             //       ccc
  //             // r     rrrr  r= result range
  //             if (results.s2 > start) {
  //                 results.s2 = start
  //                 results.changed = true
  //             }
  //         }

  //         return results
  //     }

  //     //TODO TSConversion  get a better output type than any.. switch to an object maybe.
  //     static addressToPartition_old(shardGlobals: ShardGlobals, address: string): { homePartition: number; addressNum: number } {
  //         let numPartitions = shardGlobals.numPartitions
  //         let addressNum = parseInt(address.slice(0, 8), 16)
  //         let homePartition = Math.floor(numPartitions * (addressNum / 0xffffffff))
  //         return { homePartition, addressNum }
  //     }

  //     // todo memoize this per cycle!!!
  //     // TODO TSConversion partitionMax was equal to null before as optional param. what to do now?
  //     static partitionToAddressRange2_old(shardGlobals: ShardGlobals, partition: number, paritionMax?: number): AddressRange {
  //         let result = {} as AddressRange
  //         result.partition = partition
  //         let startAddr = 0xffffffff * (partition / shardGlobals.numPartitions)
  //         startAddr = Math.ceil(startAddr)

  //         result.p_low = partition
  //         //result.p_high = paritionMax // was a TS error

  //         let endPartition = partition + 1
  //         if (paritionMax) {
  //             result.p_high = paritionMax
  //             endPartition = paritionMax + 1
  //         } else {
  //             //result.p_high = partition
  //         }
  //         result.partitionEnd = endPartition
  //         let endAddr = 0xffffffff * (endPartition / shardGlobals.numPartitions)
  //         endAddr = Math.ceil(endAddr)

  //         // if(endAddr > 0){
  //         //   endAddr = endAddr - 1
  //         // }

  //         // it seems we dont need/want this code:
  //         // if (paritionMax === null) {
  //         //   endAddr-- // - 1 // subtract 1 so we don't go into the nex partition
  //         // }

  //         result.startAddr = startAddr
  //         result.endAddr = endAddr

  //         result.low = ('00000000' + startAddr.toString(16)).slice(-8) + '0'.repeat(56)
  //         result.high = ('00000000' + endAddr.toString(16)).slice(-8) + 'f'.repeat(56)

  //         return result
  //     }

  //     // TSConversion  fix up any[]
  //     static getNodesThatCoverRange(shardGlobals: ShardGlobals, lowAddress: string, highAddress: string, exclude: string[], activeNodes: Shardus.Node[]) {
  //         // calculate each nodes address position.
  //         // calculate if the nodes reach would cover our full range listed.
  //         // could we use start + delete to avoid wrapping?

  //         let circularDistance = function (a: number, b: number, max: number): number {
  //             let directDist = Math.abs(a - b)

  //             let wrapDist = directDist
  //             // if (a < b) {
  //             //   wrapDist = Math.abs(a + (max - b))
  //             // } else if (b < a) {
  //             //   wrapDist = Math.abs(b + (max - a))
  //             // }

  //             let wrapDist1 = Math.abs(a + (max - b))
  //             let wrapDist2 = Math.abs(b + (max - a))
  //             wrapDist = Math.min(wrapDist1, wrapDist2)

  //             return Math.min(directDist, wrapDist)
  //         }

  //         let numPartitions = shardGlobals.numPartitions
  //         let nodeLookRange = shardGlobals.nodeLookRange

  //         let range = [] as any[]

  //         let lowAddressNum = parseInt(lowAddress.slice(0, 8), 16) // assume trailing 0s
  //         let highAddressNum = parseInt(highAddress.slice(0, 8), 16) + 1 // assume trailng fffs

  //         // todo start and end loop at smarter areas for efficieny reasones!
  //         let distLow = 0
  //         let distHigh = 0

  //         // This isn't a great loop to have for effiency reasons.
  //         for (let i = 0; i < activeNodes.length; i++) {
  //             let node = activeNodes[i]
  //             if (exclude.includes(node.id)) {
  //                 continue
  //             }

  //             // could look up node by address??

  //             // calculate node middle address..
  //             let nodeAddressNum = parseInt(node.id.slice(0, 8), 16)
  //             // Fix this the center of a partition boundry??
  //             let homePartition = Math.floor(numPartitions * (nodeAddressNum / 0xffffffff))
  //             let centeredAddress = Math.floor(((homePartition + 0.5) * 0xffffffff) / numPartitions)

  //             // Math.min(Math.abs(centeredAddress - lowAddressNum), Math.abs(centeredAddress - lowAddressNum))

  //             distLow = circularDistance(centeredAddress, lowAddressNum, 0xffffffff) - nodeLookRange
  //             distHigh = circularDistance(centeredAddress, highAddressNum, 0xffffffff) - nodeLookRange
  //             // if (circularDistance(centeredAddress, lowAddressNum, 0xffffffff) > nodeLookRange) {
  //             //   continue
  //             // }
  //             // if (circularDistance(centeredAddress, highAddressNum, 0xffffffff) > nodeLookRange) {
  //             //   continue
  //             // }

  //             if (distLow > 0 && distHigh > 0) {
  //                 continue
  //             }

  //             // if (Math.abs(centeredAddress - lowAddressNum) > nodeLookRange) {
  //             //   continue
  //             // }
  //             // if (Math.abs(centeredAddress - highAddressNum) > nodeLookRange) {
  //             //   continue
  //             // }
  //             // we are in range!
  //             range.push(node)
  //         }
  //         return range
  //     }

  //     /**
  // * This will find two address that are close to what we want
  // * @param {string} address
  // * @returns {{address1:string; address2:string}}
  // *
  // */
  //     static getNextAdjacentAddresses_wip(address: string) {
  //         let addressNum = parseInt(address.slice(0, 8), 16)

  //         let addressPrefixHex = ShardFunctions.leadZeros8(addressNum.toString(16))

  //         let trail = address.slice(8, 64)

  //         if (trail === 'f'.repeat(56)) {
  //             //If we are not at the end look one ahead
  //             if (addressNum < 4294967295) {
  //                 addressNum = addressNum + 1
  //             }

  //             let addressPrefixHex2 = ShardFunctions.leadZeros8(addressNum.toString(16))

  //             let address1 = addressPrefixHex + 'f'.repeat(56)
  //             let address2 = addressPrefixHex2 + '0'.repeat(56)
  //             return { address1, address2 }
  //         } else {
  //             // if(trail === '0'.repeat(56)){
  //             //If we are not at the end look one ahead
  //             let addressPrefixHex2 = ShardFunctions.leadZeros8(addressNum.toString(16))

  //             let address1 = addressPrefixHex + '0'.repeat(56)
  //             let address2 = addressPrefixHex2 + '0'.repeat(55) + '1'
  //             return { address1, address2 }
  //         }
  //         //else real math.
  //     }

  //     /**
  //    * getShardDataForCycle
  //    * @param {number} cycleNumber
  //    * @returns {CycleShardData}
  //    */
  //     getShardDataForCycle(cycleNumber: number): CycleShardData | null {
  //         if (this.shardValuesByCycle == null) {
  //             return null
  //         }
  //         let shardData = this.shardValuesByCycle.get(cycleNumber)
  //         //kind of silly but dealing with undefined response from get TSConversion: todo investigate merit of |null vs. |undefined conventions
  //         if (shardData != null) {
  //             return shardData
  //         }
  //         return null
  //     }

  //     interruptibleSleep(ms: number, targetTime: number) {
  //         let resolveFn: any = null //TSConversion just setting this to any for now.
  //         let promise = new Promise((resolve) => {
  //             resolveFn = resolve
  //             setTimeout(resolve, ms)
  //         })
  //         return { promise, resolveFn, targetTime }
  //     }

  //     interruptSleepIfNeeded(targetTime: number) {
  //         if (this.sleepInterrupt) {
  //             if (targetTime < this.sleepInterrupt.targetTime) {
  //                 this.sleepInterrupt.resolveFn()
  //             }
  //         }
  //     }

  //     // todo refactor: move to p2p?
  //     getRandomNodesInRange(count: number, lowAddress: string, highAddress: string, exclude: string[]): Shardus.Node[] {
  //         const allNodes = activeOthersByIdOrder
  //         this.lastActiveNodeCount = allNodes.length
  //         utils.shuffleArray(allNodes)
  //         let results = [] as Shardus.Node[]
  //         if (allNodes.length <= count) {
  //             count = allNodes.length
  //         }
  //         for (const node of allNodes) {
  //             if (node.id >= lowAddress && node.id <= highAddress) {
  //                 if (exclude.includes(node.id) === false) {
  //                     results.push(node)
  //                     if (results.length >= count) {
  //                         return results
  //                     }
  //                 }
  //             }
  //         }
  //         return results
  //     }

  //     // This will make calls to app.getAccountDataByRange but if we are close enough to real time it will query any newer data and return lastUpdateNeeded = true
  //     async getAccountDataByRangeSmart_App(accountStart: string, accountEnd: string, tsStart: number, maxRecords: number): Promise<GetAccountDataByRangeSmart> {
  //         let tsEnd = Date.now()
  //         let wrappedAccounts = await this.app.getAccountDataByRange(accountStart, accountEnd, tsStart, tsEnd, maxRecords)
  //         let lastUpdateNeeded = false
  //         let wrappedAccounts2: WrappedStateArray = []
  //         let highestTs = 0
  //         let delta = 0
  //         // do we need more updates
  //         if (wrappedAccounts.length === 0) {
  //             lastUpdateNeeded = true
  //         } else {
  //             // see if our newest record is new enough
  //             highestTs = 0
  //             for (let account of wrappedAccounts) {
  //                 if (account.timestamp > highestTs) {
  //                     highestTs = account.timestamp
  //                 }
  //             }
  //             delta = tsEnd - highestTs
  //             // if the data we go was close enough to current time then we are done
  //             // may have to be carefull about how we tune this value relative to the rate that we make this query
  //             // we should try to make this query more often then the delta.
  //             if (logFlags.verbose) console.log('delta ' + delta)
  //             // increased allowed delta to allow for a better chance to catch up
  //             if (delta < this.queueSitTime * 2) {
  //                 let tsStart2 = highestTs
  //                 wrappedAccounts2 = await this.app.getAccountDataByRange(accountStart, accountEnd, tsStart2, Date.now(), 10000000)
  //                 lastUpdateNeeded = true
  //             }
  //         }
  //         return { wrappedAccounts, lastUpdateNeeded, wrappedAccounts2, highestTs, delta }
  //     }

  //     /**
  // * storePartitionReceipt
  // * TODO sharding perf.  may need to do periodic cleanup of this and other maps so we can remove data from very old cycles
  // * TODO production need to do something with this data
  // * @param {number} cycleNumber
  // * @param {PartitionReceipt} partitionReceipt
  // */
  //     storePartitionReceipt(cycleNumber: number, partitionReceipt: PartitionReceipt) {
  //         let key = 'c' + cycleNumber

  //         if (!this.partitionReceiptsByCycleCounter) {
  //             this.partitionReceiptsByCycleCounter = {}
  //         }
  //         if (!this.partitionReceiptsByCycleCounter[key]) {
  //             this.partitionReceiptsByCycleCounter[key] = []
  //         }
  //         this.partitionReceiptsByCycleCounter[key].push(partitionReceipt)

  //         // if (this.debugFeatureOld_partitionReciepts === true) {
  //         //   // this doesnt really send to the archiver but it it does dump reciepts to logs.
  //         //   this.depricated.trySendAndPurgeReceiptsToArchives(partitionReceipt)
  //         // }
  //     }

  //     /**
  //    * getCycleNumberFromTimestamp
  //    * cycle numbers are calculated from the queue entry timestamp, but an offset is needed so that we can
  //    * finalize cycles in time. when you start a new cycle there could still be unfinished transactions for
  //    * syncSettleTime milliseconds.
  //    *
  //    * returns a negative number code if we can not determine the cycle
  //    */
  //     getCycleNumberFromTimestamp(timestamp: number, allowOlder: boolean = true): number {
  //         let offsetTimestamp = timestamp + this.syncSettleTime

  //         if (timestamp < 1 || timestamp == null) {
  //             let stack = new Error().stack
  //             this.statemanager_fatal(`getCycleNumberFromTimestamp ${timestamp}`, `getCycleNumberFromTimestamp ${timestamp} ,  ${stack}`)
  //         }

  //         // const cycle = CycleChain.getCycleByTimestamp(offsetTimestamp)
  //         // if (cycle != null && cycle.counter != null) {
  //         //   nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'first lookup')
  //         //   return cycle.counter
  //         // }

  //         //currentCycleShardData
  //         if (this.currentCycleShardData.timestamp <= offsetTimestamp && offsetTimestamp < this.currentCycleShardData.timestampEndCycle) {
  //             if (this.currentCycleShardData.cycleNumber == null) {
  //                 this.statemanager_fatal('getCycleNumberFromTimestamp failed. cycleNumber == null', 'this.currentCycleShardData.cycleNumber == null')
  //                 /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber fail')
  //                 const cycle = CycleChain.getCycleByTimestamp(offsetTimestamp)
  //                 console.log("CycleChain.getCycleByTimestamp", cycle)
  //                 if (cycle != null) {
  //                     this.statemanager_fatal('getCycleNumberFromTimestamp failed fatal redeemed', 'this.currentCycleShardData.cycleNumber == null, fatal redeemed')
  //                     /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber redeemed')
  //                     return cycle.counter
  //                 } else {
  //                     //debug only!!!
  //                     let cycle2 = CycleChain.getCycleByTimestamp(offsetTimestamp)
  //                     this.statemanager_fatal('getCycleNumberFromTimestamp failed fatal not redeemed', 'getCycleByTimestamp cycleNumber == null not redeemed')
  //                     /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'currentCycleShardData.cycleNumber failed to redeem')
  //                 }
  //             } else {
  //                 return this.currentCycleShardData.cycleNumber
  //             }
  //         }

  //         if (this.currentCycleShardData.cycleNumber == null) {
  //             /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'this.currentCycleShardData.cycleNumber == null')
  //             this.statemanager_fatal('getCycleNumberFromTimestamp: currentCycleShardData.cycleNumber == null', `getCycleNumberFromTimestamp: currentCycleShardData.cycleNumber == null ${this.currentCycleShardData.cycleNumber} timestamp:${timestamp}`)

  //         }

  //         //is it in the future
  //         if (offsetTimestamp >= this.currentCycleShardData.timestampEndCycle) {
  //             let cycle: Shardus.Cycle = CycleChain.getNewest()

  //             let timePastCurrentCycle = offsetTimestamp - this.currentCycleShardData.timestampEndCycle
  //             let cyclesAhead = Math.ceil(timePastCurrentCycle / (cycle.duration * 1000))
  //             nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `+${cyclesAhead}`)

  //             return this.currentCycleShardData.cycleNumber + cyclesAhead

  //             // let endOfNextCycle = this.currentCycleShardData.timestampEndCycle + cycle.duration * 1000
  //             // if (offsetTimestamp < endOfNextCycle /*+ this.syncSettleTime*/) {
  //             //   nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', '+1')
  //             //   return this.currentCycleShardData.cycleNumber + 1
  //             // } else if (offsetTimestamp < endOfNextCycle + /*this.syncSettleTime +*/ cycle.duration * 1000) {
  //             //   nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', '+2')
  //             //   //if (logFlags.error) this.mainLogger.error(`getCycleNumberFromTimestamp fail2: endOfNextCycle:${endOfNextCycle} offsetTimestamp:${offsetTimestamp} timestamp:${timestamp}`)
  //             //   return this.currentCycleShardData.cycleNumber + 2
  //             // } else {
  //             //   nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'too far')
  //             //   this.statemanager_fatal('getCycleNumberFromTimestamp: too far in future',`getCycleNumberFromTimestamp fail: too far in future. endOfNextCycle:${endOfNextCycle}
  //             //     offsetTimestamp:${offsetTimestamp} timestamp:${timestamp} now:${Date.now()} end of cycle age: ${(Date.now() - endOfNextCycle)/1000}`)
  //             //   //too far in the future
  //             //   return -2
  //             // }
  //         }
  //         if (allowOlder === true) {
  //             //cycle is in the past, by process of elimination
  //             // let offsetSeconds = Math.floor(offsetTimestamp * 0.001)
  //             const cycle = CycleChain.getCycleByTimestamp(offsetTimestamp)
  //             if (cycle != null) {
  //                 nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'p2p lookup')
  //                 if (cycle.counter == null) {
  //                     this.statemanager_fatal('getCycleNumberFromTimestamp  unexpected cycle.cycleNumber == null', 'getCycleNumberFromTimestamp unexpected cycle.cycleNumber == null')
  //                     /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', `getCycleNumberFromTimestamp unexpected cycle.cycleNumber == null  ${timestamp}`)
  //                 }

  //                 return cycle.counter
  //             } else {
  //                 //nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'p2p lookup fail -estimate cycle')
  //                 //debug only!!!
  //                 //let cycle2 = CycleChain.getCycleByTimestamp(offsetTimestamp)
  //                 //this.statemanager_fatal('getCycleNumberFromTimestamp getCycleByTimestamp failed', 'getCycleByTimestamp getCycleByTimestamp failed')
  //                 let cycle: Shardus.Cycle = CycleChain.getNewest()
  //                 let cycleEstimate = this.currentCycleShardData.cycleNumber - Math.ceil((this.currentCycleShardData.timestampEndCycle - offsetTimestamp) / (cycle.duration * 1000))
  //                 if (cycleEstimate < 1) {
  //                     cycleEstimate = 1
  //                 }
  //                 /* prettier-ignore */ nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'p2p lookup fail -estimate cycle: ' + cycleEstimate)
  //                 return cycleEstimate
  //             }
  //         }

  //         //failed to match, return -1
  //         this.statemanager_fatal('getCycleNumberFromTimestamp failed final', `getCycleNumberFromTimestamp failed final ${timestamp}`)
  //         return -1
  //     }

  //OLD parition report endpoint.

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
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(` _repair post_partition_results: abort, partitionResults == null`)
  //         return
  //       }
  //       if (payload.partitionResults.length === 0) {
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(` _repair post_partition_results: abort, partitionResults.length == 0`)
  //         return
  //       }
  //       /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair post_partition_results payload: ${utils.stringifyReduce(payload)}`)
  //       if (!payload.partitionResults[0].sign) {
  //         // TODO security need to check that this is signed by a valid and correct node
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(` _repair post_partition_results: abort, no sign object on partition`)
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
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.error(` _repair post_partition_results partitionResult missing`)
  //         }
  //         /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` _repair post_partition_results partition: ${partitionResult.Partition_id} responses.length ${responses.length}  cycle:${payload.Cycle_number}`)
  //       }
  //       var partitionKeys = Object.keys(allResponsesByPartition)
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results partitionKeys: ${partitionKeys.length}`)
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
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results tracker busy. ${partitionKey} responses: ${responses.length}.  ${utils.stringifyReduce(repairTracker)}`)
  //             continue
  //           }
  //           if (repairTracker.repairsFullyComplete) {
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results repairsFullyComplete = true  cycle:${payload.Cycle_number}`)
  //             continue
  //           }
  //         } else {
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results no responses. ${partitionKey} responses: ${responses.length}. repairTracker: ${utils.stringifyReduce(repairTracker)} responsesById: ${utils.stringifyReduce(allResponsesByPartition)}`)
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
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results our result is not computed yet `)
  //             // Todo repair : may need to sleep or restart this computation later..
  //             return
  //           }
  //           let receiptResults = this.tryGeneratePartitionReciept(responses, ourResult) // TODO: how to mark block if we are already on a thread for this?
  //           let { partitionReceipt, topResult, success } = receiptResults
  //           if (!success) {
  //             if (repairTracker.awaitWinningHash) {
  //               if (topResult == null) {
  //                 // if we are awaitWinningHash then wait for a top result before we start repair process again
  //                 /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair awaitWinningHash:true but topResult == null so keep waiting `)
  //                 continue
  //               } else {
  //                 /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair awaitWinningHash:true and we have a top result so start reparing! `)
  //               }
  //             }
  //             if (this.resetAndApplyPerPartition === false && repairTracker.txRepairReady === true) {
  //               /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair txRepairReady:true bail here for some strange reason.. not sure aout this yet `)
  //               continue
  //             }
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results: tryGeneratePartitionReciept failed start repair process 1 ${utils.stringifyReduce(receiptResults)}`)
  //             let cycle = this.p2p.state.getCycleByCounter(payload.Cycle_number)
  //             await this.startRepairProcess(cycle, topResult, partitionId, ourResult.Partition_hash)
  //           } else if (partitionReceipt) {
  //             // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug( ` _repair post_partition_results: success store partition receipt`)
  //             /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results 3 allFinished, final cycle: ${payload.Cycle_number} hash:${utils.stringifyReduce({ topResult })}`)
  //             // do we ever send partition receipt yet?
  //             this.stateManager.storePartitionReceipt(payload.Cycle_number, partitionReceipt)
  //             this.stateManager.depricated.repairTrackerMarkFinished(repairTracker, 'post_partition_results')
  //           }
  //         } else {
  //           /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` _repair post_partition_results not enough responses awaitWinningHash: ${repairTracker.awaitWinningHash} resp: ${responses.length}. required:${responsesRequired} repairTracker: ${utils.stringifyReduce(repairTracker)}`)
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

  // /**
  //  * all this does now is set syncPartitionsStarted = true.   should be depricated
  //  */
  // async startSyncPartitions() {
  //   // await this.createInitialAccountBackups() // nm this is now part of regular data sync
  //   // register our handlers

  //   // this._registerListener(this.p2p.state, 'cycle_q1_start', async (lastCycle, time) => {
  //   //   this.updateShardValues(lastCycle.counter)
  //   // })

  //   this.syncPartitionsStarted = true

  //   // this.stateManager._registerListener(this.p2p.state, 'cycle_q2_start', async (lastCycle: Shardus.Cycle, time: number) => {
  //   //   // await this.processPreviousCycleSummaries()
  //   //   // lastCycle = this.p2p.state.getLastCycle()
  //   //   // if (lastCycle == null) {
  //   //   //   return
  //   //   // }
  //   //   // let lastCycleShardValues = this.stateManager.shardValuesByCycle.get(lastCycle.counter)
  //   //   // if (lastCycleShardValues == null) {
  //   //   //   return
  //   //   // }
  //   //   // if(this.currentCycleShardData == null){
  //   //   //   return
  //   //   // }
  //   //   // if (this.currentCycleShardData.ourNode.status !== 'active') {
  //   //   //   // dont participate just yet.
  //   //   //   return
  //   //   // }
  //   //   // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug( ` _repair startSyncPartitions:cycle_q2_start cycle: ${lastCycle.counter}`)
  //   //   // // this will take temp TXs and make sure they are stored in the correct place for us to generate partitions
  //   //   // this.processTempTXs(lastCycle)
  //   //   // // During the Q2 phase of a cycle, nodes compute the partition hash of the previous cycle for all the partitions covered by the node.
  //   //   // // Q2 was chosen so that any transactions submitted with a time stamp that falls in the previous quarter will have been processed and finalized. This could be changed to Q3 if we find that more time is needed.
  //   //   // this.generatePartitionObjects(lastCycle)
  //   //   // let receiptMapResults = this.generateReceiptMapResults(lastCycle)
  //   //   // if(logFlags.verbose) this.mainLogger.debug( `receiptMapResults: ${stringify(receiptMapResults)}`)
  //   //   // let statsClump = this.partitionStats.getCoveredStatsPartitions(lastCycleShardValues)
  //   //   // //build partition hashes from previous full cycle
  //   //   // let mainHashResults:MainHashResults = null
  //   //   // if(this.currentCycleShardData && this.currentCycleShardData.ourNode.status === 'active'){
  //   //   //   mainHashResults = this.accountCache.buildPartitionHashesForNode(this.currentCycleShardData)
  //   //   // }
  //   //   // // Hook for Snapshot module to listen to after partition data is settled
  //   //   // this.emit('cycleTxsFinalized', lastCycleShardValues, receiptMapResults, statsClump, mainHashResults)
  //   //   // this.dumpAccountDebugData2(mainHashResults)
  //   //   // // pre-allocate the next cycle data to be safe!
  //   //   // let prekey = 'c' + (lastCycle.counter + 1)
  //   //   // this.partitionObjectsByCycle[prekey] = []
  //   //   // this.ourPartitionResultsByCycle[prekey] = []
  //   //   // // Nodes generate the partition result for all partitions they cover.
  //   //   // // Nodes broadcast the set of partition results to N adjacent peers on each side; where N is
  //   //   // // the number of partitions covered by the node. Uses the /post_partition_results API.
  //   //   // await this.broadcastPartitionResults(lastCycle.counter) // Cycle_number
  //   // })

  //   /* this._registerListener(this.p2p.state, 'cycle_q4_start', async (lastCycle, time) => {
  //   // Also we would like the repair process to finish by the end of Q3 and definitely before the start of a new cycle. Otherwise the cycle duration may need to be increased.
  // }) */
  // }

  // static computeNodePartitionDataMapExt(
  //   shardGlobals: StateManager.shardFunctionTypes.ShardGlobals,
  //   nodeShardDataMap: StateManager.shardFunctionTypes.NodeShardDataMap,
  //   nodesToGenerate: Shardus.Node[],
  //   parititionShardDataMap: StateManager.shardFunctionTypes.ParititionShardDataMap,
  //   activeNodes: Shardus.Node[]
  // ) {
  //   // for (let node of nodesToGenerate) {
  //   //   let nodeShardData = nodeShardDataMap.get(node.id)
  //   //   if (!nodeShardData) {
  //   //     nodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes)
  //   //   }
  //   //   // ShardFunctions.computeExtendedNodePartitionData(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
  //   //   //
  //   //   // this wont be able to extend things though.
  //   //   ShardFunctions.updateFullConsensusGroup(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
  //   // }
  // }

  //   static updateFullConsensusGroup (shardGlobals: ShardGlobals, nodeShardDataMap: NodeShardDataMap, parititionShardDataMap: ParititionShardDataMap, nodeShardData: NodeShardData, activeNodes: Shardus.Node[]) {
  //     let homePartition = nodeShardData.homePartition
  //     let shardPartitionData = parititionShardDataMap.get(homePartition)

  //     if(shardPartitionData == null){
  //       throw new Error('updateFullConsensusGroup: shardPartitionData==null')
  //     }

  //     nodeShardData.consensusNodeForOurNodeFull = Object.values(shardPartitionData.coveredBy)
  //     nodeShardData.needsUpdateToFullConsensusGroup = false
  //     nodeShardData.consensusNodeForOurNodeFull.sort(ShardFunctions.nodeSortAsc)

  //     // merge into our full list for sake of TX calcs.  todo could try to be smart an only do this in some cases.
  //     // let [results] = ShardFunctions.mergeNodeLists(nodeShardData.nodeThatStoreOurParition, nodeShardData.consensusNodeForOurNodeFull)
  //     // switched nodeThatStoreOurParition to nodeThatStoreOurParitionFull to improve the quality of the results.
  //     let [results] = ShardFunctions.mergeNodeLists(nodeShardData.nodeThatStoreOurParitionFull, nodeShardData.consensusNodeForOurNodeFull)

  //     // not sure if we need to do this
  //     // if (extras.length > 0) {
  //     //   ShardFunctions.dilateNeighborCoverage(shardGlobals, nodeShardDataMap, parititionShardDataMap, activeNodes, nodeShardData, extras)
  //     // }

  //     nodeShardData.nodeThatStoreOurParitionFull = results
  //     nodeShardData.nodeThatStoreOurParitionFull.sort(ShardFunctions.nodeSortAsc)
  //   }

  // GLOBAL CLEANUP  Depricated this code.  it was for maintaining global account history that is not needed now.

  // knownGlobals: { [id: string]: boolean } // will just use the above set now as a simplification

  /** Need the ablity to get account copies and use them later when applying a transaction. how to use the right copy or even know when to use this at all? */
  /** Could go by cycle number. if your cycle matches the one in is list use it? */
  /** What if the global account is transformed several times durring that cycle. oof. */
  /** ok best thing to do is to store the account every time it changes for a given period of time. */
  /** how to handle reparing a global account... yikes that is hard. */
  //globalAccountRepairBank: Map<string, Shardus.AccountsCopy[]>

  // getGlobalAccountValueAtTime(accountId: string, oldestTimestamp: number): Shardus.AccountsCopy | null {
  //   let result: Shardus.AccountsCopy | null = null
  //   let globalBackupList: Shardus.AccountsCopy[] = this.getGlobalAccountBackupList(accountId)
  //   if (globalBackupList == null || globalBackupList.length === 0) {
  //     /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('globalBackupList', `applyAllPreparedRepairs - missing value for ${accountId}`)
  //     return null
  //   }

  //   //else fine the closest time lower than our input time
  //   //non binary search, just start at then end and go backwards.
  //   //TODO PERF make this a binary search. realistically the lists should be pretty short most of the time
  //   if (globalBackupList.length >= 1) {
  //     for (let i = globalBackupList.length - 1; i >= 0; i--) {
  //       let accountCopy = globalBackupList[i]
  //       if (accountCopy.timestamp <= oldestTimestamp) {
  //         return accountCopy
  //       }
  //     }
  //   }
  //   return null
  // }

  // sortByTimestamp(a: any, b: any): number {
  //   return utils.sortAscProp(a, b, 'timestamp')
  // }

  // sortAndMaintainBackupList(globalBackupList: Shardus.AccountsCopy[], oldestTimestamp: number): void {
  //   globalBackupList.sort(utils.sortTimestampAsc) // this.sortByTimestamp)
  //   //remove old entries. then bail.
  //   // note this loop only runs if there is more than one entry
  //   // also it should always keep the last item in the list now matter what (since that is the most current backup)
  //   // this means we only start if there are 2 items in the array and we start at index  len-2 (next to last element)
  //   if (globalBackupList.length > 1) {
  //     for (let i = globalBackupList.length - 2; i >= 0; i--) {
  //       let accountCopy = globalBackupList[i]
  //       if (accountCopy.timestamp < oldestTimestamp) {
  //         globalBackupList.splice(i, 1)
  //       }
  //     }
  //   }
  // }

  //
  // sortAndMaintainBackups(oldestTimestamp: number): void {
  //   let keys = this.globalAccountRepairBank.keys()
  //   for (let key of keys) {
  //     let globalBackupList = this.globalAccountRepairBank.get(key)
  //     if (globalBackupList != null) {
  //       this.sortAndMaintainBackupList(globalBackupList, oldestTimestamp)
  //     }
  //   }
  // }

  // getGlobalAccountBackupList(accountID: string): Shardus.AccountsCopy[] {
  //   let results: Shardus.AccountsCopy[] = []
  //   if (this.globalAccountRepairBank.has(accountID) === false) {
  //     this.globalAccountRepairBank.set(accountID, results) //init list
  //   } else {
  //     results = this.globalAccountRepairBank.get(accountID)
  //   }
  //   return results
  // }

  //statsDataSummaryUpdate(accountDataBefore:any, accountDataAfter:Shardus.WrappedData){
  // statsDataSummaryUpdate(cycle: number, accountData: Shardus.WrappedResponse, debugMsg:string) {
  //   if(this.invasiveDebugInfo) this.mainLogger.debug(`statData enter:statsDataSummaryUpdate c:${cycle} ${debugMsg} accForBin:${utils.makeShortHash(accountData.accountId)}   inputs:${JSON.stringify({accountData})}`)

  //   let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(accountData.accountId)
  //   blob.counter++
  //   if (accountData.data == null) {
  //     blob.errorNull += 10000
  //     if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate errorNull 1`)
  //     return
  //   }
  //   if (accountData.prevDataCopy == null) {
  //     blob.errorNull += 1000000
  //     if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate errorNull 2`)
  //     return
  //   }

  //   // if(this.useSeenAccountMap === true){
  //   //     let accountId = accountData.accountId
  //   //     let timestamp = accountData.timestamp //  this.app.getAccountTimestamp(accountId)
  //   //     let hash = accountData.stateId //this.app.getStateId(accountId)

  //   //     if(this.seenCreatedAccounts.has(accountId)){
  //   //         let accountMemData:AccountMemoryCache = this.seenCreatedAccounts.get(accountId)
  //   //         if(accountMemData.t > timestamp){
  //   //             /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: good error?: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
  //   //             return
  //   //         }
  //   //     } else {
  //   //         if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account`)
  //   //     }

  //   //     let accountMemDataUpdate:AccountMemoryCache = {t:timestamp, h:hash}
  //   //     this.seenCreatedAccounts.set(accountId, accountMemDataUpdate)
  //   // }

  //   let accountId = accountData.accountId
  //   let timestamp = accountData.timestamp //  this.app.getAccountTimestamp(accountId)
  //   let hash = accountData.stateId

  //   if (this.accountCache.hasAccount(accountId)) {
  //     let accountMemData: AccountHashCache = this.accountCache.getAccountHash(accountId)
  //     if (accountMemData.t > timestamp) {
  //       /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: good error?: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
  //       return
  //     }
  //   } else {
  //     if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account`)
  //   }
  //   this.accountCache.updateAccountHash(accountId, hash, timestamp, cycle)

  //   if (cycle > blob.latestCycle) {
  //     blob.latestCycle = cycle
  //   }
  //   this.app.dataSummaryUpdate(blob.opaqueBlob, accountData.prevDataCopy, accountData.data)

  //   if(this.invasiveDebugInfo) this.mainLogger.debug(`statData:statsDataSummaryUpdate c:${cycle} ${debugMsg} accForBin:${utils.makeShortHash(accountId)}  ${this.debugAccountData(accountData.data)} - ${this.debugAccountData(accountData.prevDataCopy)}`)
  //   if(this.invasiveDebugInfo) this.addDebugToBlob(blob, accountId)

  // }

  // statsDataSummaryInit(cycle: number, accountData: Shardus.WrappedData, debugMsg:string) {
  //   if(this.invasiveDebugInfo) this.mainLogger.debug(`statData enter:statsDataSummaryInit c:${cycle} ${debugMsg} accForBin:${utils.makeShortHash(accountData.accountId)} inputs:${JSON.stringify({accountData})}`)

  //   let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(accountData.accountId)
  //   blob.counter++

  //   // if(this.useSeenAccountMap === true && this.seenCreatedAccounts.has(accountData.accountId)){
  //   //     // /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`statsDataSummaryInit seenCreatedAccounts dupe: ${utils.stringifyReduce(accountData.accountId)}`)
  //   //     return
  //   // }
  //   // if(this.useSeenAccountMap === true){
  //   //     let accountMemData:AccountMemoryCache = {t:accountData.timestamp, h:accountData.stateId}
  //   //     this.seenCreatedAccounts.set(accountData.accountId, accountMemData)
  //   // }

  //   if (this.accountCache.hasAccount(accountData.accountId)) {
  //     return
  //   }
  //   this.accountCache.updateAccountHash(accountData.accountId, accountData.stateId, accountData.timestamp, cycle)

  //   if (accountData.data == null) {
  //     blob.errorNull++
  //     if (logFlags.error) this.mainLogger.error(`statsDataSummaryInit errorNull`)
  //     return
  //   }
  //   if (cycle > blob.latestCycle) {
  //     blob.latestCycle = cycle
  //   }
  //   this.app.dataSummaryInit(blob.opaqueBlob, accountData.data)

  //   if(this.invasiveDebugInfo) this.mainLogger.debug(`statData:statsDataSummaryInit c:${cycle} accForBin:${utils.makeShortHash(accountData.accountId)}  ${this.debugAccountData(accountData.data)}`)
  //   if(this.invasiveDebugInfo) this.addDebugToBlob(blob, accountData.accountId)
  // }

  // statsDataSummaryUpdate2(cycle: number, accountDataBefore: any, accountDataAfter: Shardus.WrappedData, debugMsg:string) {
  //   if(this.invasiveDebugInfo) this.mainLogger.debug(`statData enter:statsDataSummaryUpdate2 c:${cycle} accForBin:${utils.makeShortHash(accountDataAfter.accountId)}   inputs:${JSON.stringify({accountDataBefore , accountDataAfter })}`)

  //   let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(accountDataAfter.accountId)
  //   blob.counter++
  //   if (accountDataAfter.data == null) {
  //     blob.errorNull += 100000000
  //     if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate2 errorNull 1`)
  //     return
  //   }
  //   if (accountDataBefore == null) {
  //     blob.errorNull += 10000000000
  //     if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate2 errorNull 2`)
  //     return
  //   }

  //   // if(this.useSeenAccountMap === true){
  //   //     let accountId = accountDataAfter.accountId
  //   //     let timestamp = accountDataAfter.timestamp //  this.app.getAccountTimestamp(accountId)
  //   //     let hash = accountDataAfter.stateId //this.app.getStateId(accountId)

  //   //     if(this.seenCreatedAccounts.has(accountId)){
  //   //         let accountMemData:AccountMemoryCache = this.seenCreatedAccounts.get(accountId)
  //   //         if(accountMemData.t > timestamp){
  //   //             /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: good error?: 2: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
  //   //             return
  //   //         }
  //   //     } else {
  //   //         if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account: 2`)
  //   //     }

  //   //     let accountMemDataUpdate:AccountMemoryCache = {t:timestamp, h:hash}
  //   //     this.seenCreatedAccounts.set(accountId, accountMemDataUpdate)
  //   // }

  //   let accountId = accountDataAfter.accountId
  //   let timestamp = accountDataAfter.timestamp //  this.app.getAccountTimestamp(accountId)
  //   let hash = accountDataAfter.stateId //this.app.getStateId(accountId)

  //   if (this.accountCache.hasAccount(accountId)) {
  //     let accountMemData: AccountHashCache = this.accountCache.getAccountHash(accountId)
  //     if (accountMemData.t > timestamp) {
  //       /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: good error?: 2: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}`)
  //       return
  //     }
  //   } else {
  //     if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account: 2`)
  //   }
  //   this.accountCache.updateAccountHash(accountId, hash, timestamp, cycle)

  //   if (cycle > blob.latestCycle) {
  //     blob.latestCycle = cycle
  //   }

  //   this.app.dataSummaryUpdate(blob.opaqueBlob, accountDataBefore, accountDataAfter.data)

  //   if(this.invasiveDebugInfo) this.mainLogger.debug(`statData:statsDataSummaryUpdate2 c:${cycle} accForBin:${utils.makeShortHash(accountDataAfter.accountId)}   ${this.debugAccountData(accountDataAfter.data)} - ${this.debugAccountData(accountDataBefore)}`)
  //   if(this.invasiveDebugInfo) this.addDebugToBlob(blob, accountDataAfter.accountId)

  // }

  // statsDataSummaryInitRaw(cycle: number, accountId: string, accountDataRaw: any, debugMsg:string) {
  //   if(this.invasiveDebugInfo) this.mainLogger.debug(`statData enter:statsDataSummaryInitRaw c:${cycle} ${debugMsg} accForBin:${utils.makeShortHash(accountId)}  inputs:${JSON.stringify({accountDataRaw})}`)

  //   let blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(accountId)
  //   blob.counter++

  //   // if(this.useSeenAccountMap === true && this.seenCreatedAccounts.has(accountId)){
  //   //     // /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`statsDataSummaryInitRaw seenCreatedAccounts dupe: ${utils.stringifyReduce(accountId)}`)
  //   //     return
  //   // }
  //   // if(this.useSeenAccountMap === true){
  //   //     // let timestamp = this.app.getAccountTimestamp(accountId)
  //   //     // let hash = this.app.getStateId(accountId)

  //   //     let accountInfo = this.app.getTimestampAndHashFromAccount(accountDataRaw)

  //   //     //let accountMemData:AccountMemoryCache = {t:0, h:'uninit'}
  //   //     let accountMemData:AccountMemoryCache = {t:accountInfo.timestamp, h:accountInfo.hash}
  //   //     this.seenCreatedAccounts.set(accountId, accountMemData)
  //   // }

  //   if (this.accountCache.hasAccount(accountId)) {
  //     return
  //   }
  //   let accountInfo = this.app.getTimestampAndHashFromAccount(accountDataRaw)
  //   this.accountCache.updateAccountHash(accountId, accountInfo.hash, accountInfo.timestamp, cycle)

  //   if (accountDataRaw == null) {
  //     blob.errorNull++
  //     if (logFlags.error) this.mainLogger.error(`statsDataSummaryInitRaw errorNull`)
  //     return
  //   }

  //   //crap we lack a queue. newer stuff still gets in.
  //   if (cycle > blob.latestCycle) {
  //     blob.latestCycle = cycle
  //   }

  //   this.app.dataSummaryInit(blob.opaqueBlob, accountDataRaw)

  //   if(this.invasiveDebugInfo) this.mainLogger.debug(`statData:statsDataSummaryInitRaw c:${cycle} accForBin:${utils.makeShortHash(accountId)} ${this.debugAccountData(accountDataRaw)}`)
  //   if(this.invasiveDebugInfo) this.addDebugToBlob(blob, accountId)

  // }

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

  /**
   * dumpAccountDebugData this is what creats the shardreports
   */
  // async dumpAccountDebugData() {
  //   if (this.currentCycleShardData == null) {
  //     return
  //   }

  //   // hmm how to deal with data that is changing... it cant!!
  //   let partitionMap = this.currentCycleShardData.parititionShardDataMap

  //   let ourNodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData = this.currentCycleShardData.nodeShardData
  //   // partittions:
  //   let partitionDump: DebugDumpPartitions = { partitions: [], cycle: 0, rangesCovered: {} as DebugDumpRangesCovered,
  //   nodesCovered: {} as DebugDumpNodesCovered, allNodeIds: [], globalAccountIDs: [], globalAccountSummary: [],
  //   globalStateHash: '', calculationTime: this.currentCycleShardData.calculationTime }
  //   partitionDump.cycle = this.currentCycleShardData.cycleNumber

  //   // todo port this to a static stard function!
  //   // check if we are in the consenus group for this partition
  //   let minP = ourNodeShardData.consensusStartPartition // storedPartitions.partitionStart
  //   let maxP = ourNodeShardData.consensusEndPartition // storedPartitions.partitionEnd
  //   partitionDump.rangesCovered = { ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: ourNodeShardData.nodeAddressNum / 0xffffffff, hP: ourNodeShardData.homePartition, cMin: minP, cMax: maxP, stMin: ourNodeShardData.storedPartitions.partitionStart, stMax: ourNodeShardData.storedPartitions.partitionEnd, numP: this.currentCycleShardData.shardGlobals.numPartitions }

  //   // todo print out coverage map by node index

  //   partitionDump.nodesCovered = { idx: ourNodeShardData.ourNodeIndex, ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: ourNodeShardData.nodeAddressNum / 0xffffffff, hP: ourNodeShardData.homePartition, consensus: [], stored: [], extra: [], numP: this.currentCycleShardData.shardGlobals.numPartitions }

  //   for (let node of ourNodeShardData.consensusNodeForOurNode) {
  //     let nodeData = this.currentCycleShardData.nodeShardDataMap.get(node.id)
  //     //@ts-ignore just debug junk
  //     partitionDump.nodesCovered.consensus.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
  //   }
  //   for (let node of ourNodeShardData.nodeThatStoreOurParitionFull) {
  //     let nodeData = this.currentCycleShardData.nodeShardDataMap.get(node.id)
  //     //@ts-ignore just debug junk
  //     partitionDump.nodesCovered.stored.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
  //   }

  //   if (this.currentCycleShardData.ourNode.status === 'active') {
  //     for (var [key, value] of partitionMap) {
  //       let partition: DebugDumpPartition = { parititionID: key, accounts: [], skip: {} as DebugDumpPartitionSkip }
  //       partitionDump.partitions.push(partition)

  //       // normal case
  //       if (maxP > minP) {
  //         // are we outside the min to max range
  //         if (key < minP || key > maxP) {
  //           partition.skip = { p: key, min: minP, max: maxP }
  //           continue
  //         }
  //       } else if (maxP === minP) {
  //         if (key !== maxP) {
  //           partition.skip = { p: key, min: minP, max: maxP, noSpread: true }
  //           continue
  //         }
  //       } else {
  //         // are we inside the min to max range (since the covered rage is inverted)
  //         if (key > maxP && key < minP) {
  //           partition.skip = { p: key, min: minP, max: maxP, inverted: true }
  //           continue
  //         }
  //       }

  //       let partitionShardData = value
  //       let accountStart = partitionShardData.homeRange.low
  //       let accountEnd = partitionShardData.homeRange.high
  //       let wrappedAccounts = await this.app.getAccountData(accountStart, accountEnd, 10000000)
  //       // { accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp }
  //       let duplicateCheck = {}
  //       for (let wrappedAccount of wrappedAccounts) {
  //         if (duplicateCheck[wrappedAccount.accountId] != null) {
  //           continue
  //         }
  //         duplicateCheck[wrappedAccount.accountId] = true
  //         let v = wrappedAccount.data.balance // hack, todo maybe ask app for a debug value
  //         if (this.app.getAccountDebugValue != null) {
  //           v = this.app.getAccountDebugValue(wrappedAccount)
  //         }
  //         partition.accounts.push({ id: wrappedAccount.accountId, hash: wrappedAccount.stateId, v: v })
  //       }

  //       partition.accounts.sort(this._sortByIdAsc)
  //     }

  //     //partitionDump.allNodeIds = []
  //     for (let node of this.currentCycleShardData.activeNodes) {
  //       partitionDump.allNodeIds.push(utils.makeShortHash(node.id))
  //     }

  //     partitionDump.globalAccountIDs = Array.from(this.accountGlobals.globalAccountSet.keys())
  //     partitionDump.globalAccountIDs.sort()
  //     // dump information about consensus group and edge nodes for each partition
  //     // for (var [key, value] of this.currentCycleShardData.parititionShardDataMap){

  //     // }

  //     let {globalAccountSummary, globalStateHash} = this.accountGlobals.getGlobalDebugReport()
  //     partitionDump.globalAccountSummary = globalAccountSummary
  //     partitionDump.globalStateHash = globalStateHash
  //   } else {
  //     if (this.currentCycleShardData != null && this.currentCycleShardData.activeNodes.length > 0) {
  //       for (let node of this.currentCycleShardData.activeNodes) {
  //         partitionDump.allNodeIds.push(utils.makeShortHash(node.id))
  //       }
  //     }
  //   }

  //   this.lastShardReport = utils.stringifyReduce(partitionDump)
  //   this.shardLogger.debug(this.lastShardReport)
  // }

  //   /**
  //  * dumpAccountDebugData2 a temporary version that also uses stats data
  //  */
  //    async dumpAccountDebugData2(mainHashResults: MainHashResults) {
  //     if (this.currentCycleShardData == null) {
  //       return
  //     }

  //     // hmm how to deal with data that is changing... it cant!!
  //     let partitionMap = this.currentCycleShardData.parititionShardDataMap

  //     let ourNodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData = this.currentCycleShardData.nodeShardData
  //     // partittions:
  //     let partitionDump: DebugDumpPartitions = { partitions: [], cycle: 0, rangesCovered: {} as DebugDumpRangesCovered,
  //     nodesCovered: {} as DebugDumpNodesCovered, allNodeIds: [], globalAccountIDs: [], globalAccountSummary: [],
  //     globalStateHash: '', calculationTime: this.currentCycleShardData.calculationTime }
  //     partitionDump.cycle = this.currentCycleShardData.cycleNumber

  //     // todo port this to a static stard function!
  //     // check if we are in the consenus group for this partition
  //     let minP = ourNodeShardData.consensusStartPartition // storedPartitions.partitionStart
  //     let maxP = ourNodeShardData.consensusEndPartition // storedPartitions.partitionEnd

  //     // let minP = ourNodeShardData.storedPartitions.partitionStart
  //     // let maxP = ourNodeShardData.storedPartitions.partitionEnd

  //     let cMin = ourNodeShardData.consensusStartPartition
  //     let cMax = ourNodeShardData.consensusEndPartition

  //     partitionDump.rangesCovered = { ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: ourNodeShardData.nodeAddressNum / 0xffffffff, hP: ourNodeShardData.homePartition, cMin: cMin, cMax: cMax, stMin: ourNodeShardData.storedPartitions.partitionStart, stMax: ourNodeShardData.storedPartitions.partitionEnd, numP: this.currentCycleShardData.shardGlobals.numPartitions }

  //     // todo print out coverage map by node index

  //     partitionDump.nodesCovered = { idx: ourNodeShardData.ourNodeIndex, ipPort: `${ourNodeShardData.node.externalIp}:${ourNodeShardData.node.externalPort}`, id: utils.makeShortHash(ourNodeShardData.node.id), fracID: ourNodeShardData.nodeAddressNum / 0xffffffff, hP: ourNodeShardData.homePartition, consensus: [], stored: [], extra: [], numP: this.currentCycleShardData.shardGlobals.numPartitions }

  //     for (let node of ourNodeShardData.consensusNodeForOurNode) {
  //       let nodeData = this.currentCycleShardData.nodeShardDataMap.get(node.id)
  //       //@ts-ignore just debug junk
  //       partitionDump.nodesCovered.consensus.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
  //     }
  //     for (let node of ourNodeShardData.nodeThatStoreOurParitionFull) {
  //       let nodeData = this.currentCycleShardData.nodeShardDataMap.get(node.id)
  //       //@ts-ignore just debug junk
  //       partitionDump.nodesCovered.stored.push({ idx: nodeData.ourNodeIndex, hp: nodeData.homePartition })
  //     }

  //     if (this.currentCycleShardData.ourNode.status === 'active') {
  //       for (var [key, value] of partitionMap) {
  //         let partition: DebugDumpPartition = { parititionID: key, accounts: [], accounts2: [], skip: {} as DebugDumpPartitionSkip }
  //         partitionDump.partitions.push(partition)

  //         // normal case
  //         if (maxP > minP) {
  //           // are we outside the min to max range
  //           if (key < minP || key > maxP) {
  //             partition.skip = { p: key, min: minP, max: maxP }
  //             continue
  //           }
  //         } else if (maxP === minP) {
  //           if (key !== maxP) {
  //             partition.skip = { p: key, min: minP, max: maxP, noSpread: true }
  //             continue
  //           }
  //         } else {
  //           // are we inside the min to max range (since the covered rage is inverted)
  //           if (key > maxP && key < minP) {
  //             partition.skip = { p: key, min: minP, max: maxP, inverted: true }
  //             continue
  //           }
  //         }

  //         let partitionShardData = value
  //         let accountStart = partitionShardData.homeRange.low
  //         let accountEnd = partitionShardData.homeRange.high

  //         if (this.debugFeature_dumpAccountDataFromSQL === true) {
  //           let wrappedAccounts = await this.app.getAccountData(accountStart, accountEnd, 10000000)
  //           // { accountId: account.address, stateId: account.hash, data: account, timestamp: account.timestamp }
  //           let duplicateCheck = {}
  //           for (let wrappedAccount of wrappedAccounts) {
  //             if (duplicateCheck[wrappedAccount.accountId] != null) {
  //               continue
  //             }
  //             duplicateCheck[wrappedAccount.accountId] = true
  //             let v = wrappedAccount.data.balance // hack, todo maybe ask app for a debug value
  //             if (this.app.getAccountDebugValue != null) {
  //               v = this.app.getAccountDebugValue(wrappedAccount)
  //             }
  //             partition.accounts.push({ id: wrappedAccount.accountId, hash: wrappedAccount.stateId, v: v })
  //           }

  //           partition.accounts.sort(this._sortByIdAsc)
  //         }

  //         // Take the cache data report and fill out accounts2 and partitionHash2
  //         if (mainHashResults.partitionHashResults.has(partition.parititionID)) {
  //           let partitionHashResults = mainHashResults.partitionHashResults.get(partition.parititionID)
  //           for (let index = 0; index < partitionHashResults.hashes.length; index++) {
  //             let id = partitionHashResults.ids[index]
  //             let hash = partitionHashResults.hashes[index]
  //             let v = `{t:${partitionHashResults.timestamps[index]}}`
  //             partition.accounts2.push({ id, hash, v })
  //           }
  //           partition.partitionHash2 = partitionHashResults.hashOfHashes
  //         }
  //       }

  //       //partitionDump.allNodeIds = []
  //       for (let node of this.currentCycleShardData.activeNodes) {
  //         partitionDump.allNodeIds.push(utils.makeShortHash(node.id))
  //       }

  //       partitionDump.globalAccountIDs = Array.from(this.accountGlobals.globalAccountSet.keys())
  //       partitionDump.globalAccountIDs.sort()
  //       // dump information about consensus group and edge nodes for each partition
  //       // for (var [key, value] of this.currentCycleShardData.parititionShardDataMap){

  //       // }

  //       let {globalAccountSummary, globalStateHash} = this.accountGlobals.getGlobalDebugReport()
  //       partitionDump.globalAccountSummary = globalAccountSummary
  //       partitionDump.globalStateHash = globalStateHash

  //     } else {
  //       if (this.currentCycleShardData != null && this.currentCycleShardData.activeNodes.length > 0) {
  //         for (let node of this.currentCycleShardData.activeNodes) {
  //           partitionDump.allNodeIds.push(utils.makeShortHash(node.id))
  //         }
  //       }
  //     }

  //     this.lastShardReport = utils.stringifyReduce(partitionDump)
  //     this.shardLogger.debug(this.lastShardReport)
  //     //this.shardLogger.debug(utils.stringifyReduce(partitionDump))
  //   }

  //   /**
  //  * syncStateDataForRange
  //  * syncs accountData with the help of stateTable data for a given address range
  //  * @param {SimpleRange} range
  //  */
  //    async syncStateDataForRange(range: SimpleRange) {
  //     try {
  //       let partition = 'notUsed'
  //       this.currentRange = range
  //       this.addressRange = range // this.partitionToAddressRange(partition)

  //       this.partitionStartTimeStamp = Date.now()

  //       let lowAddress = this.addressRange.low
  //       let highAddress = this.addressRange.high

  //       partition = `${utils.stringifyReduce(lowAddress)} - ${utils.stringifyReduce(highAddress)}`

  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataForPartition partition: ${partition} `)

  //       if(this.useStateTable === true){
  //         await this.syncStateTableData(lowAddress, highAddress, 0, Date.now() - this.stateManager.syncSettleTime)
  //       }
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncStateTableData 1st pass done.`)

  //       /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `sync partition: ${partition} start: ${this.stateManager.currentCycleShardData.cycleNumber}`)

  //       this.readyforTXs = true // open the floodgates of queuing stuffs.

  //       await this.syncAccountData(lowAddress, highAddress)
  //       if (logFlags.debug) this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncAccountData done.`)

  //       // potentially do the next 2 blocks periodically in the account data retreval so we can flush data to disk!  generalize the account state table update so it can be called 'n' times

  //       // Sync the Account State Table Second Pass
  //       //   Wait at least 10T since the Ts_end time of the First Pass
  //       //   Same as the procedure for First Pass except:
  //       //   Ts_start should be the Ts_end value from last time and Ts_end value should be current time minus 10T
  //       if(this.useStateTable === true){
  //         await this.syncStateTableData(lowAddress, highAddress, this.lastStateSyncEndtime, Date.now())
  //       }
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncStateTableData 2nd pass done.`)

  //       // Process the Account data
  //       //   For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
  //       //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
  //       //   Use the App.set_account_data function with the Account data to save the data to the application Accounts Table; if any failed accounts are returned save the account id to be looked up later
  //       let accountsSaved = await this.processAccountData()
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: partition: ${partition}, processAccountData done.`)

  //       // Sync the failed accounts
  //       //   Log that some account failed
  //       //   Use the /get_account_data_by_list API to get the data for the accounts that need to be looked up later from any of the nodes that had a matching hash but different from previously used nodes
  //       //   Repeat the “Sync the Account State Table Second Pass” step
  //       //   Repeat the “Process the Account data” step
  //       await this.syncFailedAcccounts(lowAddress, highAddress)

  //       if (this.failedAccountsRemain()) {
  //         if (logFlags.debug)
  //           this.mainLogger.debug(
  //             `DATASYNC: failedAccountsRemain,  ${utils.stringifyReduce(lowAddress)} - ${utils.stringifyReduce(highAddress)} accountsWithStateConflict:${
  //               this.accountsWithStateConflict.length
  //             } missingAccountData:${this.missingAccountData.length} stateTableForMissingTXs:${Object.keys(this.stateTableForMissingTXs).length}`
  //           )

  //         //This section allows to retry for failed accounts but it greatly slows down the sync process, so I think that is not the right answer

  //         // this.mainLogger.debug(`DATASYNC: failedAccountsRemain, wait ${this.stateManager.syncSettleTime}ms and retry ${lowAddress} - ${highAddress}`)
  //         // await utils.sleep(this.stateManager.syncSettleTime)

  //         // await this.syncFailedAcccounts(lowAddress, highAddress)

  //         // if(this.failedAccountsRemain()){
  //         //   this.statemanager_fatal(`failedAccountsRemain2`, `failedAccountsRemain2: this.accountsWithStateConflict:${utils.stringifyReduce(this.accountsWithStateConflict)} this.missingAccountData:${utils.stringifyReduce(this.missingAccountData)} `)
  //         // } else {
  //         //   this.mainLogger.debug(`DATASYNC: syncFailedAcccounts FIX WORKED`)
  //         // }
  //       }

  //       let keysToRepair = Object.keys(this.stateTableForMissingTXs).length
  //       if (keysToRepair > 0) {
  //         // alternate repair.
  //         this.repairMissingTXs()
  //       }

  //       /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `sync partition: ${partition} end: ${this.stateManager.currentCycleShardData.cycleNumber} accountsSynced:${accountsSaved} missing tx to repair: ${keysToRepair}`)

  //     } catch (error) {
  //       if(error.message.includes('reset-sync-ranges')){

  //         this.statemanager_fatal(`syncStateDataForRange_reset-sync-ranges`, 'DATASYNC: reset-sync-ranges: ' + errorToStringFull(error))
  //         //buble up:
  //         throw new Error('reset-sync-ranges')
  //       } else if (error.message.includes('FailAndRestartPartition')) {
  //         if (logFlags.debug) this.mainLogger.debug(`DATASYNC: Error Failed at: ${error.stack}`)
  //         this.statemanager_fatal(`syncStateDataForRange_ex_failandrestart`, 'DATASYNC: FailAndRestartPartition: ' + errorToStringFull(error))
  //         await this.failandRestart()
  //       } else {
  //         this.statemanager_fatal(`syncStateDataForRange_ex`, 'syncStateDataForPartition failed: ' + errorToStringFull(error))
  //         /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + errorToStringFull(error))
  //         await this.failandRestart()
  //       }
  //     }
  //   }

  //   /***
  //  *     ######  ##    ## ##    ##  ######   ######  ########    ###    ######## ######## ########    ###    ########  ##       ######## ########     ###    ########    ###
  //  *    ##    ##  ##  ##  ###   ## ##    ## ##    ##    ##      ## ##      ##    ##          ##      ## ##   ##     ## ##       ##       ##     ##   ## ##      ##      ## ##
  //  *    ##         ####   ####  ## ##       ##          ##     ##   ##     ##    ##          ##     ##   ##  ##     ## ##       ##       ##     ##  ##   ##     ##     ##   ##
  //  *     ######     ##    ## ## ## ##        ######     ##    ##     ##    ##    ######      ##    ##     ## ########  ##       ######   ##     ## ##     ##    ##    ##     ##
  //  *          ##    ##    ##  #### ##             ##    ##    #########    ##    ##          ##    ######### ##     ## ##       ##       ##     ## #########    ##    #########
  //  *    ##    ##    ##    ##   ### ##    ## ##    ##    ##    ##     ##    ##    ##          ##    ##     ## ##     ## ##       ##       ##     ## ##     ##    ##    ##     ##
  //  *     ######     ##    ##    ##  ######   ######     ##    ##     ##    ##    ########    ##    ##     ## ########  ######## ######## ########  ##     ##    ##    ##     ##
  //  */
  // /**
  //  * syncStateTableData
  //  * @param lowAddress
  //  * @param highAddress
  //  * @param startTime
  //  * @param endTime
  //  */
  //  async syncStateTableData(lowAddress: string, highAddress: string, startTime: number, endTime: number) {
  //   let searchingForGoodData = true

  //   if (this.stateManager.currentCycleShardData == null) {
  //     return
  //   }

  //   let debugRange = ` ${utils.stringifyReduce(lowAddress)} - ${utils.stringifyReduce(highAddress)}`

  //   /* prettier-ignore */ if (logFlags.console) console.log(`syncStateTableData startTime: ${startTime} endTime: ${endTime}` + '   time:' + Date.now())
  //   /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateTableData startTime: ${startTime} endTime: ${endTime} low: ${lowAddress} high: ${highAddress} `)
  //   // todo m11: this loop will try three more random nodes, this is slightly different than described how to handle failure in the doc. this should be corrected but will take more code
  //   // should prossible break this into a state machine in  its own class.
  //   while (searchingForGoodData) {
  //     // todo m11: this needs to be replaced
  //     // Sync the Account State Table First Pass
  //     //   Use the /get_account_state_hash API to get the hash from 3 or more nodes until there is a match between 3 nodes. Ts_start should be 0, or beginning of time.  The Ts_end value should be current time minus 10T (as configured)
  //     //   Use the /get_account_state API to get the data from one of the 3 nodes
  //     //   Take the hash of the data to ensure that it matches the expected hash value
  //     //   If not try getting the data from another node
  //     //   If the hash matches then update our Account State Table with the data
  //     //   Repeat this for each address range or partition
  //     let currentTs = Date.now()

  //     let safeTime = currentTs - this.stateManager.syncSettleTime
  //     if (endTime >= safeTime) {
  //       // need to idle for bit
  //       await utils.sleep(endTime - safeTime)
  //     }
  //     this.lastStateSyncEndtime = endTime + 1 // Adding +1 so that the next query will not overlap the time bounds. this saves us from a bunch of data tracking and filtering to remove duplicates when this function is called later

  //     let firstHash
  //     let queryLow
  //     let queryHigh

  //     queryLow = lowAddress
  //     queryHigh = highAddress
  //     let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, tsEnd: endTime }

  //     let equalFn = (a: AccountStateHashResp, b: AccountStateHashResp) => {
  //       if (a.stateHash == null) {
  //         return false // fail cases will get skipped so that we try more nodes.
  //       }
  //       return a.stateHash === b.stateHash
  //     }
  //     let queryFn = async (node: Shardus.Node) => {
  //       // Node Precheck!
  //       if (this.stateManager.isNodeValidForInternalMessage(node.id, 'get_account_state_hash', true, true) === false) {
  //         return { ready: false, msg: `get_account_state_hash invalid node to ask: ${utils.stringifyReduce(node.id)}` }
  //       }
  //       let result = await this.p2p.ask(node, 'get_account_state_hash', message)
  //       if (result === false) {
  //         /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL syncStateTableData result === false node:${utils.stringifyReduce(node.id)}`)
  //       }
  //       if (result == null) {
  //         /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL syncStateTableData result == null node:${utils.stringifyReduce(node.id)}`)
  //       }

  //       // TODO I dont know the best way to handle a non null network error here, below is an idea

  //       // if (result.stateHash == null) {
  //       //   if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result.stateHash == null')
  //       //   result = null //if we get something back that is not the right data type clear it to null
  //       // }
  //       if (result != null && result.stateHash == null) {
  //         result = { ready: false, msg: `invalid data format: ${Math.random()}` }
  //         //if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result.stateHash == null')
  //         result = null //if we get something back that is not the right data type clear it to null
  //       }

  //       if (result != null && result.ready === false) {
  //         result = { ready: false, msg: `nodeNotReady` }
  //         result = null
  //       }
  //       return result
  //     }

  //     let centerNode = ShardFunctions.getCenterHomeNode(this.stateManager.currentCycleShardData.shardGlobals, this.stateManager.currentCycleShardData.parititionShardDataMap, lowAddress, highAddress)
  //     if (centerNode == null) {
  //       if (logFlags.debug) this.mainLogger.debug(`centerNode not found`)
  //       return
  //     }

  //     let nodes: Shardus.Node[] = ShardFunctions.getNodesByProximity(
  //       this.stateManager.currentCycleShardData.shardGlobals,
  //       this.stateManager.currentCycleShardData.activeNodes,
  //       centerNode.ourNodeIndex,
  //       this.p2p.id,
  //       40
  //     )

  //     nodes = nodes.filter(this.removePotentiallyRemovedNodes)

  //     let filteredNodes = []
  //     for(let node of nodes){

  //       let nodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(node.id)
  //       if(nodeShardData != null){

  //         if(ShardFunctions.testAddressInRange(queryLow, nodeShardData.consensusPartitions) === false){
  //           continue
  //         }
  //         if(ShardFunctions.testAddressInRange(queryHigh, nodeShardData.consensusPartitions) === false){
  //           continue
  //         }
  //         filteredNodes.push(node)
  //       }
  //     }
  //     nodes = filteredNodes

  //     if (Array.isArray(nodes) === false) {
  //       /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`syncStateTableData: non array returned ${utils.stringifyReduce(nodes)}`)
  //       return // nothing to do
  //     }

  //     // let nodes = this.getActiveNodesInRange(lowAddress, highAddress) // this.p2p.state.getActiveNodes(this.p2p.id)
  //     if (nodes.length === 0) {
  //       if (logFlags.debug) this.mainLogger.debug(`no nodes available`)
  //       return // nothing to do
  //     }
  //     if (logFlags.debug)
  //       this.mainLogger.debug(`DATASYNC: robustQuery get_account_state_hash from ${utils.stringifyReduce(nodes.map((node) => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
  //     let result
  //     let winners
  //     try {
  //       let robustQueryResult = await robustQuery(nodes, queryFn, equalFn, 3, false)
  //       result = robustQueryResult.topResult
  //       winners = robustQueryResult.winningNodes

  //       let tries = 3
  //       while(result && result.ready === false && tries > 0){
  //         nestedCountersInstance.countEvent('sync','majority of nodes not ready, wait and retry')
  //         //too many nodes not ready
  //         await utils.sleep(30000) //wait 30 seconds and try again
  //         robustQueryResult = await robustQuery(nodes, queryFn, equalFn, 3, false)
  //         result = robustQueryResult.topResult
  //         winners = robustQueryResult.winningNodes
  //         tries--
  //       }

  //       if (robustQueryResult.isRobustResult == false) {
  //         if (logFlags.debug) this.mainLogger.debug('syncStateTableData: robustQuery ')
  //         this.statemanager_fatal(`syncStateTableData_nonRobust`, 'syncStateTableData: robustQuery ' + debugRange)
  //         throw new Error('FailAndRestartPartition_stateTable_A' + debugRange)
  //       }

  //     } catch (ex) {
  //       // NOTE: no longer expecting an exception from robust query in cases where we do not have enough votes or respones!
  //       //       but for now if isRobustResult == false then we local code wil throw an exception
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug('syncStateTableData: robustQuery ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //       this.statemanager_fatal(`syncStateTableData_robustQ`, 'syncStateTableData: robustQuery ' + debugRange + ex.name + ': ' + ex.message + ' at ' + ex.stack)
  //       throw new Error('FailAndRestartPartition_stateTable_B' + debugRange)
  //     }

  //     if (result && result.stateHash) {
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: robustQuery returned result: ${result.stateHash}`)
  //       if (!winners || winners.length === 0) {
  //         if (logFlags.debug) this.mainLogger.debug(`DATASYNC: no winners, going to throw fail and restart`)
  //         this.statemanager_fatal(`syncStateTableData_noWin`, `DATASYNC: no winners, going to throw fail and restart` + debugRange) // todo: consider if this is just an error
  //         throw new Error('FailAndRestartPartition_stateTable_C' + debugRange)
  //       }
  //       this.dataSourceNode = winners[0] // Todo random index
  //       if (logFlags.debug)
  //         this.mainLogger.debug(`DATASYNC: got hash ${result.stateHash} from ${utils.stringifyReduce(winners.map((node: Shardus.Node) => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
  //       firstHash = result.stateHash
  //     } else {
  //       let resultStr = utils.stringifyReduce(result)
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: robustQuery get_account_state_hash failed ${result} `  + debugRange)
  //       throw new Error('FailAndRestartPartition_stateTable_D ' + result + debugRange)
  //     }

  //     let moreDataRemaining = true
  //     this.combinedAccountStateData = []
  //     let loopCount = 0

  //     let lowTimeQuery = startTime
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: hash: getting state table data from: ${utils.makeShortHash(this.dataSourceNode.id) + ':' + this.dataSourceNode.externalPort}`)

  //     // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
  //     while (moreDataRemaining) {
  //       // Node Precheck!
  //       if (this.stateManager.isNodeValidForInternalMessage(this.dataSourceNode.id, 'syncStateTableData', true, true) === false) {
  //         if (this.tryNextDataSourceNode('syncStateTableData') == false) {
  //           break
  //         }
  //         continue
  //       }

  //       let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: lowTimeQuery, tsEnd: endTime }
  //       let result = await this.p2p.ask(this.dataSourceNode, 'get_account_state', message)

  //       if (result == null) {
  //         /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result == null')
  //         if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //           break
  //         }
  //         continue
  //       }
  //       if (result.accountStates == null) {
  //         /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result.accountStates == null')
  //         if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //           break
  //         }
  //         continue
  //       }

  //       let accountStateData = result.accountStates
  //       // get the timestamp of the last account state received so we can use it as the low timestamp for our next query
  //       if (accountStateData.length > 0) {
  //         let lastAccount = accountStateData[accountStateData.length - 1]
  //         if (lastAccount.txTimestamp > lowTimeQuery) {
  //           lowTimeQuery = lastAccount.txTimestamp
  //         }
  //       }

  //       // If this is a repeated query, clear out any dupes from the new list we just got.
  //       // There could be many rows that use the stame timestamp so we will search and remove them
  //       let dataDuplicated = true
  //       if (loopCount > 0) {
  //         while (accountStateData.length > 0 && dataDuplicated) {
  //           let stateData = accountStateData[0]
  //           dataDuplicated = false
  //           for (let i = this.combinedAccountStateData.length - 1; i >= 0; i--) {
  //             let existingStateData = this.combinedAccountStateData[i]
  //             if (existingStateData.txTimestamp === stateData.txTimestamp && existingStateData.accountId === stateData.accountId) {
  //               dataDuplicated = true
  //               break
  //             }
  //             // once we get to an older timestamp we can stop looking, the outer loop will be done also
  //             if (existingStateData.txTimestamp < stateData.txTimestamp) {
  //               break
  //             }
  //           }
  //           if (dataDuplicated) {
  //             accountStateData.shift()
  //           }
  //         }
  //       }

  //       if (accountStateData.length === 0) {
  //         moreDataRemaining = false
  //       } else {
  //         if (logFlags.debug)
  //           this.mainLogger.debug(
  //             `DATASYNC: syncStateTableData got ${accountStateData.length} more records from ${utils.makeShortHash(this.dataSourceNode.id) + ':' + this.dataSourceNode.externalPort}`
  //           )
  //         this.combinedAccountStateData = this.combinedAccountStateData.concat(accountStateData)

  //         nestedCountersInstance.countEvent('sync', `statetable written`, accountStateData.length)

  //         loopCount++
  //       }
  //     }

  //     let seenAccounts = new Set()

  //     //only hash one account state per account. the most recent one!
  //     let filteredAccountStates = []
  //     for(let i = this.combinedAccountStateData.length -1; i>=0; i--){
  //       let accountState:Shardus.StateTableObject = this.combinedAccountStateData[i]

  //       if(seenAccounts.has(accountState.accountId) === true){
  //         continue
  //       }
  //       seenAccounts.add(accountState.accountId)
  //       filteredAccountStates.unshift(accountState)
  //     }

  //     let recievedStateDataHash = this.crypto.hash(filteredAccountStates)

  //     if (recievedStateDataHash === firstHash) {
  //       searchingForGoodData = false
  //     } else {
  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateTableData finished downloading the requested data but the hash does not match`)
  //       // Failed again back through loop! TODO ? record/eval/report blame?
  //       this.stateManager.recordPotentialBadnode()
  //       throw new Error('FailAndRestartPartition_stateTable_E' + debugRange)
  //     }

  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateTableData saving ${this.combinedAccountStateData.length} records to db`)
  //     // If the hash matches then update our Account State Table with the data
  //     await this.storage.addAccountStates(this.combinedAccountStateData) // keep in memory copy for faster processing...
  //     this.inMemoryStateTableData = this.inMemoryStateTableData.concat(this.combinedAccountStateData)

  //     this.syncStatement.numSyncedState += this.combinedAccountStateData.length
  //   }
  // }

  // /***
  //  *     ######  ##    ## ##    ##  ######     ###     ######   ######   #######  ##     ## ##    ## ######## ########     ###    ########    ###
  //  *    ##    ##  ##  ##  ###   ## ##    ##   ## ##   ##    ## ##    ## ##     ## ##     ## ###   ##    ##    ##     ##   ## ##      ##      ## ##
  //  *    ##         ####   ####  ## ##        ##   ##  ##       ##       ##     ## ##     ## ####  ##    ##    ##     ##  ##   ##     ##     ##   ##
  //  *     ######     ##    ## ## ## ##       ##     ## ##       ##       ##     ## ##     ## ## ## ##    ##    ##     ## ##     ##    ##    ##     ##
  //  *          ##    ##    ##  #### ##       ######### ##       ##       ##     ## ##     ## ##  ####    ##    ##     ## #########    ##    #########
  //  *    ##    ##    ##    ##   ### ##    ## ##     ## ##    ## ##    ## ##     ## ##     ## ##   ###    ##    ##     ## ##     ##    ##    ##     ##
  //  *     ######     ##    ##    ##  ######  ##     ##  ######   ######   #######   #######  ##    ##    ##    ########  ##     ##    ##    ##     ##
  //  */
  // /**
  //  * syncAccountData
  //  * @param lowAddress
  //  * @param highAddress
  //  */
  //  async syncAccountData(lowAddress: string, highAddress: string) {
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

  //   if(this.useStateTable === false){
  //     this.dataSourceNode = null
  //     this.getDataSourceNode(lowAddress, highAddress)
  //   }

  //   if(this.dataSourceNode == null){
  //     /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`syncAccountData: dataSourceNode == null ${lowAddress} - ${highAddress}`)
  //     //if we see this then getDataSourceNode failed.
  //     // this is most likely because the ranges selected when we started sync are now invalid and too wide to be filled.

  //     //throwing this specific error text will bubble us up to the main sync loop and cause re-init of all the non global sync ranges/trackers
  //     throw new Error('reset-sync-ranges')
  //   }

  //   // This flag is kind of tricky.  It tells us that the loop can go one more time after bumping up the min timestamp to check
  //   // If we still don't get account data then we will quit.
  //   // This is needed to solve a case where there are more than 2x account sync max accounts in the same timestamp
  //   let stopIfNextLoopHasNoResults = false

  //   let offset = 0
  //   // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
  //   while (moreDataRemaining) {
  //     // Node Precheck!
  //     if (this.stateManager.isNodeValidForInternalMessage(this.dataSourceNode.id, 'syncAccountData', true, true) === false) {
  //       if (this.tryNextDataSourceNode('syncAccountData') == false) {
  //         break
  //       }
  //       continue
  //     }

  //     // max records artificially low to make testing coverage better.  todo refactor: make it a config or calculate based on data size
  //     let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, maxRecords: this.config.stateManager.accountBucketSize, offset }
  //     let r: GetAccountData3Resp | boolean = await this.p2p.ask(this.dataSourceNode, 'get_account_data3', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory

  //     // TSConversion need to consider better error handling here!
  //     let result: GetAccountData3Resp = r as GetAccountData3Resp

  //     if (result == null) {
  //       /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`ASK FAIL syncAccountData result == null node:${this.dataSourceNode.id}`)
  //       if (this.tryNextDataSourceNode('syncAccountData') == false) {
  //         break
  //       }
  //       continue
  //     }
  //     if (result.data == null) {
  //       /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`ASK FAIL syncAccountData result.data == null node:${this.dataSourceNode.id}`)
  //       if (this.tryNextDataSourceNode('syncAccountData') == false) {
  //         break
  //       }
  //       continue
  //     }
  //     // accountData is in the form [{accountId, stateId, data}] for n accounts.
  //     let accountData = result.data.wrappedAccounts
  //     let lastUpdateNeeded = result.data.lastUpdateNeeded

  //     let lastLowQuery = lowTimeQuery
  //     // get the timestamp of the last account data received so we can use it as the low timestamp for our next query
  //     if (accountData.length > 0) {
  //       let lastAccount = accountData[accountData.length - 1]
  //       if (lastAccount.timestamp > lowTimeQuery) {
  //         lowTimeQuery = lastAccount.timestamp
  //         startTime = lowTimeQuery
  //       }
  //     }

  //     let sameAsStartTS = 0

  //     // If this is a repeated query, clear out any dupes from the new list we just got.
  //     // There could be many rows that use the stame timestamp so we will search and remove them
  //     let dataDuplicated = true
  //     if (loopCount > 0) {
  //       while (accountData.length > 0 && dataDuplicated) {
  //         let stateData = accountData[0]
  //         dataDuplicated = false

  //         if(stateData.timestamp === lastLowQuery){
  //           sameAsStartTS++
  //         }

  //         //todo get rid of this in next verision
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

  //     if(lastLowQuery === lowTimeQuery){
  //       //update offset, so we can get next page of data
  //       //offset+= (result.data.wrappedAccounts.length + result.data.wrappedAccounts2.length)
  //       offset+=sameAsStartTS //conservative offset!
  //     } else {
  //       //clear offset
  //       offset=0
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
  //       if(lastUpdateNeeded){
  //         //we are done
  //         moreDataRemaining = false
  //       } else {
  //         if(stopIfNextLoopHasNoResults === true){
  //           //we are done
  //           moreDataRemaining = false
  //         } else{
  //           //bump start time and loop once more!
  //           //If we don't get anymore accounts on that loopl then we will quit for sure
  //           //If we do get more accounts then stopIfNextLoopHasNoResults will reset in a branch below
  //           startTime++
  //           loopCount++
  //           stopIfNextLoopHasNoResults = true
  //         }
  //       }

  //       if (logFlags.debug)
  //         this.mainLogger.debug(
  //           `DATASYNC: syncAccountData3 got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lastLowQuery} highestTS1: ${result.data.highestTs} delta:${result.data.delta} offset:${offset}`
  //         )
  //       if (accountData.length > 0) {
  //         this.combinedAccountData = this.combinedAccountData.concat(accountData)
  //       }
  //       if (accountData2.length > 0) {
  //         this.combinedAccountData = this.combinedAccountData.concat(accountData2)
  //       }
  //     } else {
  //       //we got accounts this time so reset this flag to false
  //       stopIfNextLoopHasNoResults = false
  //       if (logFlags.debug)
  //         this.mainLogger.debug(
  //           `DATASYNC: syncAccountData3b got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lastLowQuery} highestTS1: ${result.data.highestTs} delta:${result.data.delta} offset:${offset}`
  //         )
  //       this.combinedAccountData = this.combinedAccountData.concat(accountData)
  //       loopCount++
  //       // await utils.sleep(500)
  //     }
  //     await utils.sleep(200)
  //   }
  // }

  // /**
  //  * processAccountData
  //  *   // Process the Account data
  //  * //   For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data
  //  * //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
  //  * //   Use the App.set_account_data function with the Account data to save the data to the application Accounts Table; if any failed accounts are returned save the account id to be looked up later
  //  * // State data = {accountId, txId, txTimestamp, stateBefore, stateAfter}
  //  * // accountData is in the form [{accountId, stateId, data}] for n accounts.
  //  */
  //  async processAccountData() : Promise<number> {

  //   if(this.useStateTable === false){
  //     return await this.processAccountDataNoStateTable()

  //   }

  //   this.missingAccountData = []
  //   this.mapAccountData = {}
  //   this.stateTableForMissingTXs = {}
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

  //   let missingButOkAccounts = 0
  //   let missingTXs = 0
  //   let handledButOk = 0
  //   let otherMissingCase = 0
  //   let futureStateTableEntry = 0
  //   let missingButOkAccountIDs: { [id: string]: boolean } = {}

  //   let missingAccountIDs: { [id: string]: boolean } = {}

  //   if (logFlags.debug)
  //     this.mainLogger.debug(
  //       `DATASYNC: processAccountData stateTableCount: ${this.inMemoryStateTableData.length} unique accounts: ${uniqueAccounts}  initial combined len: ${initialCombinedAccountLength}`
  //     )
  //   // For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data

  //   for (let stateData of this.inMemoryStateTableData) {
  //     account = this.mapAccountData[stateData.accountId]
  //     // does the state data table have a node and we don't have data for it?
  //     if (account == null) {
  //       // make sure we have a transaction that matches this in our queue
  //       // the state table data we are working with is sufficiently old, so that we should have seen a transaction in our queue by the time we could get here

  //       // if the account is seend in state table data but this was state table data that was from after time lastStateSyncEndtime
  //       // then we wont care about missing this account.  receipt repair should take care of it.
  //       // alternatively this could be fixed with more advance logic on the receipt repair side of things.
  //       let time = Number(stateData.txTimestamp)
  //       if (time > this.lastStateSyncEndtime) {
  //         futureStateTableEntry++
  //         continue
  //       }

  //       //acceptedTXByHash seems to always be empty so this forces missingTXs
  //       // let txRef = this.acceptedTXByHash[stateData.txId]
  //       // if (txRef == null) {
  //       //   missingTXs++
  //       //   if (stateData.accountId != null) {
  //       //     this.missingAccountData.push(stateData.accountId)
  //       //     missingAccountIDs[stateData.accountId] = true
  //       //   }
  //       // } else
  //       if (stateData.stateBefore === allZeroes64) {
  //         // this means we are at the start of a valid state table chain that starts with creating an account
  //         missingButOkAccountIDs[stateData.accountId] = true
  //         missingButOkAccounts++
  //       } else if (missingButOkAccountIDs[stateData.accountId] === true) {
  //         // no action. we dont have account, but we know a different transaction will create it.
  //         handledButOk++
  //       } else {
  //         // unhandled case. not expected.  this would happen if the state table chain does not start with this account being created
  //         // this could be caused by a node trying to withold account data when syncing
  //         if (stateData.accountId != null) {
  //           this.missingAccountData.push(stateData.accountId)
  //           missingAccountIDs[stateData.accountId] = true
  //         }
  //         otherMissingCase++
  //       }
  //       // should we check timestamp for the state table data?
  //       continue
  //     }

  //     if (!account.syncData) {
  //       account.syncData = { timestamp: 0 }
  //     }

  //     if (account.stateId === stateData.stateAfter) {
  //       // mark it good.
  //       account.syncData.uptodate = true
  //       account.syncData.anyMatch = true
  //       if (stateData.txTimestamp > account.syncData.timestamp) {
  //         account.syncData.missingTX = false // finding a good match can clear the old error. this relys on things being in order!
  //         account.syncData.timestamp = stateData.txTimestamp

  //         //clear the missing reference if we have one
  //         delete this.stateTableForMissingTXs[stateData.accountId]
  //       }
  //     } else {
  //       // this state table data does not match up with what we have for the account

  //       // if the state table TS is newer than our sync data that means the account has changed
  //       // and the data we have for it is not up to date.
  //       if (stateData.txTimestamp > account.syncData.timestamp) {
  //         account.syncData.uptodate = false
  //         // account.syncData.stateData = stateData
  //         // chceck if we are missing a tx to handle this.
  //         let txRef = this.acceptedTXByHash[stateData.txId]
  //         if (txRef == null) {
  //           // account.syncData.missingTX = true
  //           // if (stateData.txTimestamp > account.syncData.timestamp) {
  //           account.syncData.missingTX = true
  //           // account.syncData.timestamp = stateData.txTimestamp
  //           // }
  //           // should we try to un foul the missingTX flag here??
  //         }

  //         account.syncData.timestamp = stateData.txTimestamp

  //         // record this because we may want to repair to it.
  //         this.stateTableForMissingTXs[stateData.accountId] = stateData
  //       }
  //     }
  //   }

  //   if (missingButOkAccounts > 0) {
  //     // it is valid / normal flow to get to this point:
  //     if (logFlags.debug)
  //       this.mainLogger.debug(
  //         `DATASYNC: processAccountData accouts missing from accountData, but are ok, because we have transactions for them: missingButOKList: ${missingButOkAccounts}, handledbutOK: ${handledButOk}`
  //       )
  //   }
  //   if (this.missingAccountData.length > 0) {
  //     // getting this indicates a non-typical problem that needs correcting
  //     if (logFlags.debug)
  //       this.mainLogger.debug(
  //         `DATASYNC: processAccountData accounts missing from accountData, but in the state table.  This is an unexpected error and we will need to handle them as failed accounts: missingList: ${
  //           this.missingAccountData.length
  //         }, missingTX count: ${missingTXs} missingUnique: ${Object.keys(missingAccountIDs).length}`
  //       )
  //   }

  //   //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
  //   this.accountsWithStateConflict = []
  //   let goodAccounts: Shardus.WrappedData[] = []
  //   let noSyncData = 0
  //   let noMatches = 0
  //   let outOfDateNoTxs = 0
  //   let unhandledCase = 0
  //   let fix1Worked = 0
  //   for (let account of this.combinedAccountData) {
  //     if (!account.syncData) {
  //       // this account was not found in state data
  //       this.accountsWithStateConflict.push(account)
  //       noSyncData++
  //       //turning this case back off.
  //     } else if (account.syncData.anyMatch === true) {
  //       if (account.syncData.missingTX) {
  //         fix1Worked++
  //         /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData FIX WORKED. ${utils.stringifyReduce(account)}  `)
  //       }
  //       //this is the positive case. We have a match so we can use this account
  //       delete account.syncData
  //       goodAccounts.push(account)
  //     } else if (!account.syncData.anyMatch) {
  //       // this account was in state data but none of the state table stateAfter matched our state
  //       this.accountsWithStateConflict.push(account)
  //       noMatches++
  //     } else if (account.syncData.missingTX) {
  //       //
  //       this.accountsWithStateConflict.push(account)
  //       outOfDateNoTxs++
  //     } else {
  //       // could be good but need to check if we got stamped with some older datas.
  //       // if (account.syncData.uptodate === false) {
  //       //   // check for a missing transaction.
  //       //   // need to check above so that a right cant clear a wrong.
  //       //   let txRef = this.acceptedTXByHash[account.syncData.stateData.txId]
  //       //   if (txRef == null) {
  //       //     this.mainLogger.debug(`DATASYNC: processAccountData account not up to date ${utils.stringifyReduce(account)}`)
  //       //     this.accountsWithStateConflict.push(account)
  //       //     outOfDateNoTxs++
  //       //     continue
  //       //   }
  //       // }
  //       unhandledCase++

  //       // delete account.syncData
  //       // goodAccounts.push(account)
  //     }
  //   }

  //   if (logFlags.debug)
  //     this.mainLogger.debug(
  //       `DATASYNC: processAccountData saving ${goodAccounts.length} of ${this.combinedAccountData.length} records to db.  noSyncData: ${noSyncData} noMatches: ${noMatches} missingTXs: ${missingTXs} handledButOk: ${handledButOk} otherMissingCase: ${otherMissingCase} outOfDateNoTxs: ${outOfDateNoTxs} futureStateTableEntry:${futureStateTableEntry} unhandledCase:${unhandledCase} fix1Worked:${fix1Worked}`
  //     )
  //   // failedHashes is a list of accounts that failed to match the hash reported by the server
  //   let failedHashes = await this.stateManager.checkAndSetAccountData(goodAccounts, 'syncNonGlobals:processAccountData', true) // repeatable form may need to call this in batches

  //   this.syncStatement.numAccounts += goodAccounts.length

  //   if (failedHashes.length > 1000) {
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes over 1000:  ${failedHashes.length} restarting sync process`)
  //     // state -> try another node. TODO record/eval/report blame?
  //     this.stateManager.recordPotentialBadnode()
  //     throw new Error('FailAndRestartPartition_processAccountData_A')
  //   }
  //   if (failedHashes.length > 0) {
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes:  ${failedHashes.length} will have to download them again`)
  //     // TODO ? record/eval/report blame?
  //     this.stateManager.recordPotentialBadnode()
  //     this.failedAccounts = this.failedAccounts.concat(failedHashes)
  //     for (let accountId of failedHashes) {
  //       account = this.mapAccountData[accountId]

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData ${accountId}  data: ${utils.stringifyReduce(account)}`)

  //       if (account != null) {
  //         if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData adding account to list`)
  //         this.accountsWithStateConflict.push(account)
  //       } else {
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData cant find data: ${accountId}`)
  //         if (accountId) {
  //           //this.accountsWithStateConflict.push({ address: accountId,  }) //NOTE: fixed with refactor
  //           this.accountsWithStateConflict.push({ accountId: accountId, data: null, stateId: null, timestamp: 0 })
  //         }
  //       }
  //     }
  //   }

  //   let accountsSaved = await this.stateManager.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

  //   nestedCountersInstance.countEvent('sync', `accounts written`, accountsSaved)

  //   this.combinedAccountData = [] // we can clear this now.

  //   return accountsSaved
  // }

  /***
   *     ######  ##    ## ##    ##  ######  ########    ###    #### ##       ######## ########     ###     ######   ######   ######   #######  ##     ## ##    ## ########  ######
   *    ##    ##  ##  ##  ###   ## ##    ## ##         ## ##    ##  ##       ##       ##     ##   ## ##   ##    ## ##    ## ##    ## ##     ## ##     ## ###   ##    ##    ##    ##
   *    ##         ####   ####  ## ##       ##        ##   ##   ##  ##       ##       ##     ##  ##   ##  ##       ##       ##       ##     ## ##     ## ####  ##    ##    ##
   *     ######     ##    ## ## ## ##       ######   ##     ##  ##  ##       ######   ##     ## ##     ## ##       ##       ##       ##     ## ##     ## ## ## ##    ##     ######
   *          ##    ##    ##  #### ##       ##       #########  ##  ##       ##       ##     ## ######### ##       ##       ##       ##     ## ##     ## ##  ####    ##          ##
   *    ##    ##    ##    ##   ### ##    ## ##       ##     ##  ##  ##       ##       ##     ## ##     ## ##    ## ##    ## ##    ## ##     ## ##     ## ##   ###    ##    ##    ##
   *     ######     ##    ##    ##  ######  ##       ##     ## #### ######## ######## ########  ##     ##  ######   ######   ######   #######   #######  ##    ##    ##     ######
   */
  /**
   * syncFailedAcccounts
   *   // Sync the failed accounts
   * //   Log that some account failed
   * //   Use the /get_account_data_by_list API to get the data for the accounts that need to be looked up later from any of the nodes that had a matching hash but different from previously used nodes
   * //   Repeat the “Sync the Account State Table Second Pass” step
   * //   Repeat the “Process the Account data” step
   *
   * @param lowAddress
   * @param highAddress
   */
  //  async syncFailedAcccounts(lowAddress: string, highAddress: string) {
  //   if (this.accountsWithStateConflict.length === 0 && this.missingAccountData.length === 0) {
  //     if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts no failed hashes to sync`)
  //     return
  //   }

  //   nestedCountersInstance.countEvent('sync', 'syncFailedAcccounts')
  //   this.syncStatement.failedAccountLoops++

  //   if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts start`)
  //   let addressList: string[] = []
  //   for (let accountEntry of this.accountsWithStateConflict) {
  //     // //NOTE: fixed with refactor
  //     // if (accountEntry.data && accountEntry.data.address) {
  //     //     addressList.push(accountEntry.data.address)
  //     if (accountEntry.accountId) {
  //       addressList.push(accountEntry.accountId)
  //     } else {
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts failed to add account ${accountEntry}`)
  //     }
  //   }
  //   // add the addresses of accounts that we got state table data for but not data for
  //   addressList = addressList.concat(this.missingAccountData)
  //   this.missingAccountData = []

  //   // TODO m11:  should we pick different nodes to ask? (at the very least need to change the data source node!!!!!!)
  //   /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts requesting data for failed hashes ${utils.stringifyReduce(addressList)}`)

  //   // Node Precheck!
  //   if (this.stateManager.isNodeValidForInternalMessage(this.dataSourceNode.id, 'syncStateDataGlobals', true, true) === false) {
  //     if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //       return
  //     }
  //     //we picked a new node to ask so relaunch
  //     await this.syncFailedAcccounts(lowAddress, highAddress)
  //     return
  //   }

  //   let message = { accountIds: addressList }
  //   let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message)

  //   nestedCountersInstance.countEvent('sync', 'syncFailedAcccounts accountsFailed', addressList.length)
  //   this.syncStatement.failedAccounts += addressList.length

  //   if (result == null) {
  //     /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncFailedAcccounts result == null')
  //     if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //       return
  //     }
  //     //we picked a new node to ask so relaunch
  //     await this.syncFailedAcccounts(lowAddress, highAddress)
  //     return
  //   }
  //   if (result.accountData == null) {
  //     /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncFailedAcccounts result.accountData == null')
  //     if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
  //       return
  //     }
  //     //we picked a new node to ask so relaunch
  //     await this.syncFailedAcccounts(lowAddress, highAddress)
  //     return
  //   }

  //   this.combinedAccountData = this.combinedAccountData.concat(result.accountData)

  //   /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncFailedAcccounts combinedAccountData: ${this.combinedAccountData.length} accountData: ${result.accountData.length}`)
  //   if(this.useStateTable === true){
  //     //depricated
  //     //await this.syncStateTableData(lowAddress, highAddress, this.lastStateSyncEndtime, Date.now())
  //   }
  //   // process the new accounts.
  //   // await this.processAccountData()  //using state table is depricated

  //   await this.processAccountDataNoStateTable()
  // }

  /***
   *    ########  ######## ########     ###    #### ########  ##     ## ####  ######   ######  #### ##    ##  ######   ######## ##     ##  ######
   *    ##     ## ##       ##     ##   ## ##    ##  ##     ## ###   ###  ##  ##    ## ##    ##  ##  ###   ## ##    ##     ##     ##   ##  ##    ##
   *    ##     ## ##       ##     ##  ##   ##   ##  ##     ## #### ####  ##  ##       ##        ##  ####  ## ##           ##      ## ##   ##
   *    ########  ######   ########  ##     ##  ##  ########  ## ### ##  ##   ######   ######   ##  ## ## ## ##   ####    ##       ###     ######
   *    ##   ##   ##       ##        #########  ##  ##   ##   ##     ##  ##        ##       ##  ##  ##  #### ##    ##     ##      ## ##         ##
   *    ##    ##  ##       ##        ##     ##  ##  ##    ##  ##     ##  ##  ##    ## ##    ##  ##  ##   ### ##    ##     ##     ##   ##  ##    ##
   *    ##     ## ######## ##        ##     ## #### ##     ## ##     ## ####  ######   ######  #### ##    ##  ######      ##    ##     ##  ######
   */
  /**
   * repairMissingTXs
   *
   */
  //  async repairMissingTXs() {
  //   nestedCountersInstance.countEvent('sync', 'repairMissingTXs')

  //   let keys = Object.keys(this.stateTableForMissingTXs)

  //   /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: repairMissingTXs begin: ${keys.length} ${utils.stringifyReduce(keys)}`)
  //   for (let key of keys) {
  //     try {
  //       this.profiler.profileSectionStart('repairMissingTX')
  //       let stateTableData = this.stateTableForMissingTXs[key]

  //       if (stateTableData == null) {
  //         nestedCountersInstance.countEvent('sync', 'repairMissingTXs stateTableData == null')
  //         continue
  //       }
  //       if (stateTableData.txId == null) {
  //         nestedCountersInstance.countEvent('sync', 'repairMissingTXs stateTableData.txId == null')
  //         continue
  //       }

  //       /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: repairMissingTXs start: ${utils.stringifyReduce(stateTableData)}`)
  //       //get receipt for txID
  //       let result = await this.stateManager.getTxRepair().requestMissingReceipt(stateTableData.txId, Number(stateTableData.txTimestamp), stateTableData.accountId)
  //       if (result != null && result.success === true) {
  //         //@ts-ignore todo can axe this when we get rid of old receipts
  //         let repairOk = await this.stateManager.getTxRepair().repairToMatchReceiptWithoutQueueEntry(result.receipt, stateTableData.accountId)
  //         /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: repairMissingTXs finished: ok:${repairOk} ${utils.stringifyReduce(stateTableData)}`)
  //       } else {
  //         /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: repairMissingTXs cant get receipt: ${utils.stringifyReduce(stateTableData)}`)
  //         this.statemanager_fatal(`repairMissingTXs_fail`, `repairMissingTXs_fail ${utils.stringifyReduce(stateTableData)} result:${utils.stringifyReduce(result)}`)
  //       }
  //     } catch (error) {
  //       this.statemanager_fatal(`repairMissingTXs_ex`, 'repairMissingTXs ex: ' + errorToStringFull(error))
  //     } finally {
  //       this.profiler.profileSectionEnd('repairMissingTX')
  //     }
  //   }
  // }

  /***
   *    ########  ########   #######   ######  ########  ######   ######     ###     ######   ######   #######  ##     ## ##    ## ######## ########     ###    ########    ###
   *    ##     ## ##     ## ##     ## ##    ## ##       ##    ## ##    ##   ## ##   ##    ## ##    ## ##     ## ##     ## ###   ##    ##    ##     ##   ## ##      ##      ## ##
   *    ##     ## ##     ## ##     ## ##       ##       ##       ##        ##   ##  ##       ##       ##     ## ##     ## ####  ##    ##    ##     ##  ##   ##     ##     ##   ##
   *    ########  ########  ##     ## ##       ######    ######   ######  ##     ## ##       ##       ##     ## ##     ## ## ## ##    ##    ##     ## ##     ##    ##    ##     ##
   *    ##        ##   ##   ##     ## ##       ##             ##       ## ######### ##       ##       ##     ## ##     ## ##  ####    ##    ##     ## #########    ##    #########
   *    ##        ##    ##  ##     ## ##    ## ##       ##    ## ##    ## ##     ## ##    ## ##    ## ##     ## ##     ## ##   ###    ##    ##     ## ##     ##    ##    ##     ##
   *    ##        ##     ##  #######   ######  ########  ######   ######  ##     ##  ######   ######   #######   #######  ##    ##    ##    ########  ##     ##    ##    ##     ##
   */

  //  async processAccountDataNoStateTable() : Promise<number> {
  //   this.missingAccountData = []
  //   this.mapAccountData = {}
  //   this.stateTableForMissingTXs = {}
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

  //   let missingButOkAccounts = 0
  //   let missingTXs = 0
  //   let handledButOk = 0
  //   let otherMissingCase = 0
  //   let futureStateTableEntry = 0
  //   let missingButOkAccountIDs: { [id: string]: boolean } = {}

  //   let missingAccountIDs: { [id: string]: boolean } = {}

  //   if (logFlags.debug)
  //     this.mainLogger.debug(
  //       `DATASYNC: processAccountData stateTableCount: ${this.inMemoryStateTableData.length} unique accounts: ${uniqueAccounts}  initial combined len: ${initialCombinedAccountLength}`
  //     )
  //   // For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data

  //   //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
  //   this.accountsWithStateConflict = []
  //   let goodAccounts: Shardus.WrappedData[] = []
  //   let noSyncData = 0
  //   let noMatches = 0
  //   let outOfDateNoTxs = 0
  //   let unhandledCase = 0
  //   let fix1Worked = 0
  //   for (let account of this.combinedAccountData) {
  //     goodAccounts.push(account)
  //   }

  //   if (logFlags.debug)
  //     this.mainLogger.debug(
  //       `DATASYNC: processAccountData saving ${goodAccounts.length} of ${this.combinedAccountData.length} records to db.  noSyncData: ${noSyncData} noMatches: ${noMatches} missingTXs: ${missingTXs} handledButOk: ${handledButOk} otherMissingCase: ${otherMissingCase} outOfDateNoTxs: ${outOfDateNoTxs} futureStateTableEntry:${futureStateTableEntry} unhandledCase:${unhandledCase} fix1Worked:${fix1Worked}`
  //     )
  //   // failedHashes is a list of accounts that failed to match the hash reported by the server
  //   let failedHashes = await this.stateManager.checkAndSetAccountData(goodAccounts, 'syncNonGlobals:processAccountDataNoStateTable', true) // repeatable form may need to call this in batches

  //   this.syncStatement.numAccounts += goodAccounts.length

  //   if (failedHashes.length > 1000) {
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes over 1000:  ${failedHashes.length} restarting sync process`)
  //     // state -> try another node. TODO record/eval/report blame?
  //     this.stateManager.recordPotentialBadnode()
  //     throw new Error('FailAndRestartPartition_processAccountData_A')
  //   }
  //   if (failedHashes.length > 0) {
  //     /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes:  ${failedHashes.length} will have to download them again`)
  //     // TODO ? record/eval/report blame?
  //     this.stateManager.recordPotentialBadnode()
  //     this.failedAccounts = this.failedAccounts.concat(failedHashes)
  //     for (let accountId of failedHashes) {
  //       account = this.mapAccountData[accountId]

  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData ${accountId}  data: ${utils.stringifyReduce(account)}`)

  //       if (account != null) {
  //         if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData adding account to list`)
  //         this.accountsWithStateConflict.push(account)
  //       } else {
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData cant find data: ${accountId}`)
  //         if (accountId) {
  //           //this.accountsWithStateConflict.push({ address: accountId,  }) //NOTE: fixed with refactor
  //           this.accountsWithStateConflict.push({ accountId: accountId, data: null, stateId: null, timestamp: 0 })
  //         }
  //       }
  //     }
  //   }

  //   let accountsSaved = await this.stateManager.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

  //   nestedCountersInstance.countEvent('sync', `accounts written`, accountsSaved)

  //   this.combinedAccountData = [] // we can clear this now.

  //   return accountsSaved
  // }

  //from:syncStateDataForRange2

  // // Sync the failed accounts
  // //   Log that some account failed
  // //   Use the /get_account_data_by_list API to get the data for the accounts that need to be looked up later from any of the nodes that had a matching hash but different from previously used nodes
  // //   Repeat the “Sync the Account State Table Second Pass” step
  // //   Repeat the “Process the Account data” step
  // await this.syncFailedAcccounts(lowAddress, highAddress)

  // if (this.failedAccountsRemain()) {
  //   if (logFlags.debug)
  //     this.mainLogger.debug(
  //       `DATASYNC: failedAccountsRemain,  ${utils.stringifyReduce(lowAddress)} - ${utils.stringifyReduce(highAddress)} accountsWithStateConflict:${
  //         this.accountsWithStateConflict.length
  //       } missingAccountData:${this.missingAccountData.length} stateTableForMissingTXs:${Object.keys(this.stateTableForMissingTXs).length}`
  //     )
  // }

  // let keysToRepair = Object.keys(this.stateTableForMissingTXs).length
  // if (keysToRepair > 0) {
  //   // alternate repair.
  //   this.repairMissingTXs()
  // }

  ///from get_account_data_by_hashes handler
  // if(this.stateManager.accountSync.useStateTable === true){
  //   if(accountsToGetStateTableDataFor.length > 0){
  //     result.stateTableData = await this.stateManager.storage.queryAccountStateTableByListNewest(accountsToGetStateTableDataFor)
  //   }
  // }

  // /**
  //  * failedAccountsRemain
  //  */
  //  failedAccountsRemain(): boolean {
  //   // clean out account conflicts based on what TXs we we have in the queue that we can repair.
  //   // also mark tx for scheduled repair..

  //   // failed counts went way down after fixing liberdus end of things so putting this optimization on hold.

  //   if (this.accountsWithStateConflict.length === 0 && this.missingAccountData.length === 0) {
  //     return false
  //   }
  //   return true
  // }

  // this.p2p.registerInternal(
  //   'repair_too_old_account_data',
  //   async (
  //     payload: TooOldAccountUpdateRequest,
  //     respond: (arg0: boolean) => Promise<boolean>,
  //     _sender: unknown,
  //     _tracker: string,
  //     msgSize: number
  //   ) => {
  //     profilerInstance.scopedProfileSectionStart('repair_too_old_account_data', false, msgSize)
  //     let { accountID, txId, appliedReceipt2, updatedAccountData } = payload
  //     const hash = updatedAccountData.stateId
  //     const accountData = updatedAccountData

  //     // check if we cover this accountId
  //     const storageNodes = this.stateManager.transactionQueue.getStorageGroupForAccount(accountID)
  //     const isInStorageGroup = storageNodes.map((node) => node.id).includes(Self.id)
  //     if (!isInStorageGroup) {
  //       nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: not in storage group for account: ${accountID}`)
  //       await respond(false)
  //       return
  //     }
  //     // check if we have already repaired this account
  //     const accountHashCache = this.stateManager.accountCache.getAccountHash(accountID)
  //     if (accountHashCache != null && accountHashCache.h === hash) {
  //       nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: already repaired account: ${accountID}`)
  //       await respond(false)
  //       return
  //     }
  //     if (accountHashCache != null && accountHashCache.t > accountData.timestamp) {
  //       nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: we have newer account: ${accountID}`)
  //       await respond(false)
  //       return
  //     }

  //     const archivedQueueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(txId, 'repair_too_old_account_data')

  //     if (archivedQueueEntry == null) {
  //       nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: no archivedQueueEntry for txId: ${txId}`)
  //       this.mainLogger.debug(`repair_too_old_account_data: no archivedQueueEntry for txId: ${txId}`)
  //       await respond(false)
  //       return
  //     }

  //     // check the vote and confirmation status of the tx
  //     const bestMessage = appliedReceipt2.confirmOrChallenge
  //     const receivedBestVote = appliedReceipt2.appliedVote
  //     if (receivedBestVote != null) {
  //       // Check if vote is from eligible list of voters for this TX
  //       if(!archivedQueueEntry.eligibleNodeIdsToVote.has(receivedBestVote.node_id)) {
  //         nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: vote from ineligible node for txId: ${txId}`)
  //         return
  //       }

  //       // Check signature of the vote
  //       if (!this.crypto.verify(
  //         receivedBestVote as SignedObject,
  //         archivedQueueEntry.executionGroupMap.get(receivedBestVote.node_id).publicKey
  //       )) {
  //         nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: vote signature invalid for txId: ${txId}`)
  //         return
  //       }

  //       // Check transaction result from vote
  //       if (!receivedBestVote.transaction_result) {
  //         nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: vote result not true for txId ${txId}`)
  //         return
  //       }

  //       // Check account hash. Calculate account hash of account given in instruction
  //       // and compare it with the account hash in the vote.
  //       const calculatedAccountHash = this.app.calculateAccountHash(accountData.data)
  //       let accountHashMatch = false
  //       for (let i = 0; i < receivedBestVote.account_id.length; i++) {
  //         if (receivedBestVote.account_id[i] === accountID) {
  //           if (receivedBestVote.account_state_hash_after[i] !== calculatedAccountHash) {
  //             nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: account hash mismatch for txId: ${txId}`)
  //             accountHashMatch = false
  //           } else {
  //             accountHashMatch = true
  //           }
  //           break
  //         }
  //       }
  //       if (accountHashMatch === false) {
  //         nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: vote account hash mismatch for txId: ${txId}`)
  //         return
  //       }
  //     } else {
  //       // Skip this account apply as we were not able to get the best vote for this tx
  //       nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: no vote for txId: ${txId}`)
  //       return
  //     }

  //     if (bestMessage != null) {
  //       // Skip if challenge receipt
  //       if (bestMessage.message === 'challenge') {
  //         nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: challenge for txId: ${txId}`)
  //         return
  //       }

  //       // Check if mesasge is from eligible list of responders for this TX
  //       if(!archivedQueueEntry.eligibleNodeIdsToConfirm.has(bestMessage.nodeId)) {
  //         nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: confirmation from ineligible node for txId: ${txId}`)
  //         return
  //       }

  //       // Check signature of the message
  //       if(!this.crypto.verify(
  //         bestMessage as SignedObject,
  //         archivedQueueEntry.executionGroupMap.get(bestMessage.nodeId).publicKey
  //       )) {
  //         nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: confirmation signature invalid for txId: ${txId}`)
  //         return
  //       }
  //     } else {
  //       // Skip this account apply as we were not able to get the best confirmation for this tx
  //       nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data: no confirmation for txId: ${txId}`)
  //       return
  //     }

  //     // update the account data (and cache?)
  //     const updatedAccounts: string[] = []
  //     //save the account data.  note this will make sure account hashes match the wrappers and return failed
  //     // hashes  that don't match
  //     const failedHashes = await this.stateManager.checkAndSetAccountData(
  //       [accountData],
  //       `repair_too_old_account_data:${txId}`,
  //       true,
  //       updatedAccounts
  //     )
  //     if (logFlags.debug) this.mainLogger.debug(`repair_too_old_account_data: ${updatedAccounts.length} updated, ${failedHashes.length} failed`)
  //     nestedCountersInstance.countEvent('accountPatcher', `repair_too_old_account_data:${updatedAccounts.length} updated, accountId: ${utils.makeShortHash(accountID)}, cycle: ${this.stateManager.currentCycleShardData.cycleNumber}`)
  //     if (failedHashes.length > 0) nestedCountersInstance.countEvent('accountPatcher', `update_too_old_account_data:${failedHashes.length} failed`)
  //     let success = false
  //     if (updatedAccounts.length > 0 && failedHashes.length === 0) {
  //       success = true
  //     }
  //     await respond(success)

  //     profilerInstance.scopedProfileSectionEnd('repair_too_old_account_data')
  //   }
  // )
}

export default Deprecated
