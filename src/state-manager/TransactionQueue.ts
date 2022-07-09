import { StateManager as StateManagerTypes } from '@shardus/types'
import StateManager from '.'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import { P2PModuleContext as P2P } from '../p2p/Context'
import * as CycleChain from '../p2p/CycleChain'
import { potentiallyRemoved } from '../p2p/NodeList'
import * as Shardus from '../shardus/shardus-types'
import Storage from '../storage'
import * as utils from '../utils'
import { errorToStringFull, getLinearGossipBurstList, inRangeOfCurrentTime } from '../utils'
import { nestedCountersInstance } from '../utils/nestedCounters'
import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'
import ShardFunctions from './shardFunctions.js'
import {
  AcceptedTx,
  AccountFilter,
  CommitConsensedTransactionResult,
  PreApplyAcceptedTransactionResult,
  QueueEntry,
  TxDebug,
  RequestReceiptForTxResp,
  RequestStateForTxReq,
  RequestStateForTxResp,
  SeenAccounts,
  StringBoolObjectMap,
  StringNodeObjectMap,
  WrappedResponses, Cycle, AppliedReceipt, RequestReceiptForTxResp_old
} from './state-manager-types'


const stringify = require('fast-stable-stringify')

const http = require('../http')
const allZeroes64 = '0'.repeat(64)
const txStatBucketSize = {
  default: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 10000],
}

class TransactionQueue {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.StrictServerConfiguration
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

  newAcceptedTxQueue: QueueEntry[]
  newAcceptedTxQueueTempInjest: QueueEntry[]
  archivedQueueEntries: QueueEntry[]
  txDebugStatList: TxDebug[]

  newAcceptedTxQueueByID: Map<string, QueueEntry>
  newAcceptedTxQueueTempInjestByID: Map<string, QueueEntry>
  archivedQueueEntriesByID: Map<string, QueueEntry>
  receiptsToForward: any[]
  forwardedReceipts: Map<string, boolean>
  oldNotForwardedReceipts: Map<string, boolean>
  lastReceiptForwardResetTimestamp: number

  queueStopped: boolean
  queueEntryCounter: number
  queueRestartCounter: number

  archivedQueueEntryMaxCount: number
  newAcceptedTxQueueRunning: boolean //archivedQueueEntryMaxCount is a maximum amount of queue entries to store, usually we should never have this many stored since tx age will be used to clean up the list

  processingLastRunTime: number
  processingMinRunBreak: number
  processingLeftBusy: boolean

  executeInOneShard: boolean

  txCoverageMap: any

  queueTimingFixes: boolean

  constructor(stateManager: StateManager, profiler: Profiler, app: Shardus.App, logger: Logger, storage: Storage, p2p: P2P, crypto: Crypto, config: Shardus.StrictServerConfiguration) {
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

    this.queueStopped = false
    this.queueEntryCounter = 0
    this.queueRestartCounter = 0

    this.newAcceptedTxQueue = []
    this.newAcceptedTxQueueTempInjest = []
    this.archivedQueueEntries = []
    this.txDebugStatList = []
    this.receiptsToForward = []
    this.forwardedReceipts = new Map()
    this.oldNotForwardedReceipts = new Map()
    this.lastReceiptForwardResetTimestamp = Date.now()

    this.newAcceptedTxQueueByID = new Map()
    this.newAcceptedTxQueueTempInjestByID = new Map()
    this.archivedQueueEntriesByID = new Map()

    this.archivedQueueEntryMaxCount = 5000 // was 50000 but this too high
    // 10k will fit into memory and should persist long enough at desired loads
    this.newAcceptedTxQueueRunning = false

    this.processingLastRunTime = 0
    this.processingMinRunBreak = 10 //20 //200ms breaks between processing loops
    this.processingLeftBusy = false

    this.executeInOneShard = false

    if(this.config.sharding.executeInOneShard === true){
      this.executeInOneShard = true
    }

    this.txCoverageMap = new Map()

    this.queueTimingFixes = true
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
    this.p2p.registerInternal('broadcast_state', async (payload: { txid: string; stateList: Shardus.WrappedResponse[] }, respond: any) => {
      profilerInstance.scopedProfileSectionStart('broadcast_state')
      try {
        // Save the wrappedAccountState with the rest our queue data
        // let message = { stateList: datas, txid: queueEntry.acceptedTX.id }
        // this.p2p.tell([correspondingEdgeNode], 'broadcast_state', message)

        // make sure we have it
        let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
        if (queueEntry == null) {
          //In the past we would enqueue the TX, expecially if syncing but that has been removed.
          //The normal mechanism of sharing TXs is good enough.
          return
        }
        // add the data in
        for (let data of payload.stateList) {
          this.queueEntryAddData(queueEntry, data)
          if (queueEntry.state === 'syncing') {
            if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastData', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
          }
        }
      } finally {
        profilerInstance.scopedProfileSectionEnd('broadcast_state')
      }
    })

    this.p2p.registerInternal('broadcast_finalstate', async (payload: { txid: string; stateList: Shardus.WrappedResponse[] }, respond: any) => {
      profilerInstance.scopedProfileSectionStart('broadcast_finalstate')
      try {
        // make sure we have it
        let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
        if (queueEntry == null) {
          //In the past we would enqueue the TX, expecially if syncing but that has been removed.
          //The normal mechanism of sharing TXs is good enough.
          return
        }
        // add the data in
        for (let data of payload.stateList) {
          //let wrappedResponse = data as Shardus.WrappedResponse
          //this.queueEntryAddData(queueEntry, data)
          if(data == null){
            if (logFlags.error && logFlags.verbose) this.mainLogger.error(`broadcast_finalstate data == null`)
            continue
          }
          if(queueEntry.collectedFinalData[data.accountId] == null){
            queueEntry.collectedFinalData[data.accountId] = data
            if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('broadcast_finalstate', `${queueEntry.logID}`, `broadcast_finalstate addFinalData qId: ${queueEntry.entryID} data:${utils.makeShortHash(data.accountId)} collected keys: ${utils.stringifyReduce(Object.keys(queueEntry.collectedFinalData))}`)
          }

          // if (queueEntry.state === 'syncing') {
          //   if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastfinalstate', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
          // }
        }
      } finally {
        profilerInstance.scopedProfileSectionEnd('broadcast_finalstate')
      }
    })

    this.p2p.registerInternal('spread_tx_to_group_syncing', async (payload: Shardus.AcceptedTx, respondWrapped, sender, tracker) => {
      profilerInstance.scopedProfileSectionStart('spread_tx_to_group_syncing')
      try {
        //handleSharedTX will also validate fields
        this.handleSharedTX(payload.data, sender)
      } finally {
        profilerInstance.scopedProfileSectionEnd('spread_tx_to_group_syncing')
      }
    })

    this.p2p.registerGossipHandler('spread_tx_to_group', async (payload, sender, tracker, msgSize: number) => {
      profilerInstance.scopedProfileSectionStart('spread_tx_to_group', false, msgSize)
      let respondSize = cUninitializedSize
      try {
        // Place tx in queue (if younger than m)
        //  gossip 'spread_tx_to_group' to transaction group

        //handleSharedTX will also validate fields.  payload is an AcceptedTX so must pass in the .data as the rawTX
        let queueEntry = this.handleSharedTX(payload.data, sender)
        if (queueEntry == null) {
          return
        }

        // get transaction group
        let transactionGroup = this.queueEntryGetTransactionGroup(queueEntry)
        if (queueEntry.ourNodeInTransactionGroup === false) {
          return
        }
        if (transactionGroup.length > 1) {
          this.stateManager.debugNodeGroup(queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp, `gossip to neighbors`, transactionGroup)
          respondSize = await this.p2p.sendGossipIn('spread_tx_to_group', payload, tracker, sender, transactionGroup, false)
        }
      } finally {
        profilerInstance.scopedProfileSectionEnd('spread_tx_to_group', respondSize)
      }
    })

    /**
     * request_state_for_tx
     * used by the transaction queue when a queue entry needs to ask for missing state
     */
    this.p2p.registerInternal('request_state_for_tx', async (payload: RequestStateForTxReq, respond: (arg0: RequestStateForTxResp) => any) => {
      profilerInstance.scopedProfileSectionStart('request_state_for_tx')
      try {
        let response: RequestStateForTxResp = { stateList: [], beforeHashes: {}, note: '', success: false }
        // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
        let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
        if (queueEntry == null) {
          queueEntry = this.getQueueEntryArchived(payload.txid, 'request_state_for_tx') // , payload.timestamp)
        }

        if (queueEntry == null) {
          response.note = `failed to find queue entry: ${utils.stringifyReduce(payload.txid)}  ${payload.timestamp} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txid)]}`
          await respond(response)
          // if a node cant get data it will have to get repaired by the patcher since we can only keep stuff en the archive queue for so long
          // due to memory concerns
          return
        }

        for (let key of payload.keys) {
          let data = queueEntry.originalData[key] // collectedData
          if (data) {
            //response.stateList.push(JSON.parse(data))
            response.stateList.push(data)
          }
        }
        response.success = true
        await respond(response)
      } finally {
        profilerInstance.scopedProfileSectionEnd('request_state_for_tx')
      }
    })
  }

  handleSharedTX(tx: Shardus.OpaqueTransaction, sender: Shardus.Node): QueueEntry {
    // Perform fast validation of the transaction fields
    const validateResult = this.app.validate(tx)
    if (validateResult.success === false) {
      this.statemanager_fatal(`spread_tx_to_group_validateTX`, `spread_tx_to_group validateTxnFields failed: ${utils.stringifyReduce(validateResult)}`)
      return null
    }

    // Ask App to crack open tx and return timestamp, id (hash), and keys
    const { timestamp, id, keys } = this.app.crack(tx)

    // Check if we already have this tx in our queue
    let queueEntry = this.getQueueEntrySafe(id) // , payload.timestamp)
    if (queueEntry) {
      return null
    }

    // some timer checks.. should these be merged into route and accept?
    const mostOfQueueSitTimeMs = this.stateManager.queueSitTime * 0.9
    const txExpireTimeMs = this.config.transactionExpireTime * 1000
    const age = Date.now() - timestamp
    if (inRangeOfCurrentTime(timestamp, mostOfQueueSitTimeMs, txExpireTimeMs) === false) {
      this.statemanager_fatal(`spread_tx_to_group_OldTx_or_tooFuture`, 'spread_tx_to_group cannot accept tx with age: ' + age)
      if (logFlags.playback) this.logger.playbackLogNote('shrd_spread_tx_to_groupToOldOrTooFuture', '', 'spread_tx_to_group working on tx with age: ' + age)
      return null
    }

    // Pack into AcceptedTx for routeAndQueueAcceptedTransaction
    const acceptedTx: AcceptedTx = {
      timestamp,
      txId: id,
      keys,
      data: tx
    }

    const noConsensus = false // this can only be true for a set command which will never come from an endpoint
    const added = this.routeAndQueueAcceptedTransaction(acceptedTx, /*sendGossip*/ false, sender, /*globalModification*/ false, noConsensus)
    if (added === 'lost') {
      return null // we are faking that the message got lost so bail here
    }
    if (added === 'out of range') {
      return null
    }
    if (added === 'notReady') {
      return null
    }
    queueEntry = this.getQueueEntrySafe(id) //, payload.timestamp) // now that we added it to the queue, it should be possible to get the queueEntry now

    if (queueEntry == null) {
      // do not gossip this, we are not involved
      // downgrading, this does not seem to be fatal, but may need further logs/testing
      //this.statemanager_fatal(`spread_tx_to_group_noQE`, `spread_tx_to_group failed: cant find queueEntry for:  ${utils.makeShortHash(payload.id)}`)
      if (logFlags.playback) this.logger.playbackLogNote('spread_tx_to_group_noQE', '', `spread_tx_to_group failed: cant find queueEntry for:  ${utils.makeShortHash(id)}`)
      return null
    }

    return queueEntry
  }

  /***
   *       ###    ########  ########   ######  ########    ###    ######## ########
   *      ## ##   ##     ## ##     ## ##    ##    ##      ## ##      ##    ##
   *     ##   ##  ##     ## ##     ## ##          ##     ##   ##     ##    ##
   *    ##     ## ########  ########   ######     ##    ##     ##    ##    ######
   *    ######### ##        ##              ##    ##    #########    ##    ##
   *    ##     ## ##        ##        ##    ##    ##    ##     ##    ##    ##
   *    ##     ## ##        ##         ######     ##    ##     ##    ##    ########
   */

  /* -------- APPSTATE Functions ---------- */

  /**
   * getAccountsStateHash
   * DEPRICATED in current sync algorithm.  This is very slow when we have many accounts or TXs
   * @param accountStart
   * @param accountEnd
   * @param tsStart
   * @param tsEnd
   */
  async getAccountsStateHash(accountStart = '0'.repeat(64), accountEnd = 'f'.repeat(64), tsStart = 0, tsEnd = Date.now()) {
    const accountStates = await this.storage.queryAccountStateTable(accountStart, accountEnd, tsStart, tsEnd, 100000000)

    let seenAccounts = new Set()

    //only hash one account state per account. the most recent one!
    let filteredAccountStates = []
    for (let i = accountStates.length - 1; i >= 0; i--) {
      let accountState: Shardus.StateTableObject = accountStates[i]

      if (seenAccounts.has(accountState.accountId) === true) {
        continue
      }
      seenAccounts.add(accountState.accountId)
      filteredAccountStates.unshift(accountState)
    }

    const stateHash = this.crypto.hash(filteredAccountStates)
    return stateHash
  }

  /**
   * preApplyTransaction
   * call into the app code to apply a transaction on our in memory copies of data.
   * the results will be used for voting/consensus (if non-global)
   * when a receipt is formed commitConsensedTransaction will actually commit a the data
   * @param queueEntry
   */
  async preApplyTransaction(queueEntry: QueueEntry): Promise<PreApplyAcceptedTransactionResult> {
    if (this.queueStopped) return

    let acceptedTX = queueEntry.acceptedTx
    let wrappedStates = queueEntry.collectedData
    let localCachedData = queueEntry.localCachedData
    let tx = acceptedTX.data
    let keysResponse = queueEntry.txKeys
    let { sourceKeys, targetKeys, timestamp, debugInfo } = keysResponse
    let uniqueKeys = queueEntry.uniqueKeys
    let accountTimestampsAreOK = true
    let ourLockID = -1
    let ourAccountLocks = null
    let applyResponse: Shardus.ApplyResponse | null = null
    let isGlobalModifyingTX = queueEntry.globalModification === true
    let passedApply: boolean = false
    let applyResult: string

    if (logFlags.verbose) if (logFlags.console) console.log('preApplyTransaction ' + timestamp + ' debugInfo:' + debugInfo)
    if (logFlags.verbose) this.mainLogger.debug('preApplyTransaction ' + timestamp + ' debugInfo:' + debugInfo)

    //TODO need to adjust logic to add in more stuff.
    // may only need this in the case where we have hopped over to another shard or additional
    // accounts were passed in.  And that me handled earlier.

    for (let key of uniqueKeys) {
      if (wrappedStates[key] == null) {
        if (logFlags.verbose) if (logFlags.console) console.log(`preApplyTransaction missing some account data. timestamp:${timestamp}  key: ${utils.makeShortHash(key)}  debuginfo:${debugInfo}`)
        return { applied: false, passed: false, applyResult: '', reason: 'missing some account data' }
      } else {
        let wrappedState = wrappedStates[key]
        wrappedState.prevStateId = wrappedState.stateId
        wrappedState.prevDataCopy = utils.deepCopy(wrappedState.data)

        // important to update the wrappedState timestamp here to prevent bad timestamps from propagating the system
        let {
          timestamp: updatedTimestamp,
          hash: updatedHash
        } = this.app.getTimestampAndHashFromAccount(wrappedState.data)
        wrappedState.timestamp = updatedTimestamp

        // check if current account timestamp is too new for this TX
        if (wrappedState.timestamp >= timestamp) {
          accountTimestampsAreOK = false
          break
        }
      }
    }

    if (!accountTimestampsAreOK) {
      if (logFlags.verbose) this.mainLogger.debug('preApplyTransaction pretest failed: ' + timestamp)
      if (logFlags.playback) this.logger.playbackLogNote('tx_preapply_rejected 1', `${acceptedTX.txId}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
      return {
        applied: false,
        passed: false,
        applyResult: '',
        reason: 'preApplyTransaction pretest failed, TX rejected'
      }
    }

    try {
      if (logFlags.verbose) {
        this.mainLogger.debug(`preApplyTransaction  txid:${utils.stringifyReduce(acceptedTX.txId)} ts:${timestamp} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`)
        this.mainLogger.debug(`preApplyTransaction  filter: ${utils.stringifyReduce(queueEntry.localKeys)}`)
        this.mainLogger.debug(`preApplyTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
        this.mainLogger.debug(`preApplyTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
        this.mainLogger.debug(`preApplyTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`)
      }

      // TODO ARCH REVIEW:  review use of fifo lock of accountModification and account keys.
      // I think we need to consider adding reader-writer lock support so that a non written to global account is a "reader" lock: check but dont aquire
      // consider if it is safe to axe the use of fifolock accountModification.

      if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` preApplyTransaction FIFO lock outer: ${utils.stringifyReduce(uniqueKeys)} `)
      ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(uniqueKeys)
      if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` preApplyTransaction FIFO lock inner: ${utils.stringifyReduce(uniqueKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)

      ourLockID = await this.stateManager.fifoLock('accountModification')

      this.profiler.profileSectionStart('process-dapp.apply')
      this.profiler.scopedProfileSectionStart('apply_duration')
      const startTime = process.hrtime()
      //I think Shardus.IncomingTransaction may be the wrong type here
      applyResponse = await this.app.apply(tx as Shardus.IncomingTransaction, wrappedStates)
      const endTime = process.hrtime(startTime)
      queueEntry.txDebug.duration['apply_duration'] = endTime[1] / 1000000
      this.profiler.scopedProfileSectionEnd('apply_duration')
      this.profiler.profileSectionEnd('process-dapp.apply')
      if (applyResponse == null) {
        throw Error('null response from app.apply')
      }

      if(applyResponse.failed === true){
        passedApply = false
        applyResult = applyResponse.failMessage
      } else {
        passedApply = true
        applyResult = 'applied'
      }
      if (logFlags.verbose) this.mainLogger.debug(`preApplyTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
    } catch (ex) {
      if (logFlags.error) this.mainLogger.error(`preApplyTransaction failed id:${utils.makeShortHash(acceptedTX.txId)}: ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      if (logFlags.error) this.mainLogger.error(`preApplyTransaction failed id:${utils.makeShortHash(acceptedTX.txId)}  ${utils.stringifyReduce(acceptedTX)}`)

      this.profiler.scopedProfileSectionEnd('apply_duration')
      passedApply = false
      applyResult = ex.message
    } finally {
      this.stateManager.fifoUnlock('accountModification', ourLockID)

      if (ourAccountLocks != null) {
        this.stateManager.bulkFifoUnlockAccounts(uniqueKeys, ourAccountLocks)
      }
      if (logFlags.verbose) this.mainLogger.debug(` preApplyTransaction FIFO unlock inner: ${utils.stringifyReduce(uniqueKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
    }

    if (logFlags.playback) this.logger.playbackLogNote('tx_preapplied', `${acceptedTX.txId}`, `preApplyTransaction ${timestamp} `)
    if (logFlags.verbose) this.mainLogger.debug(`preApplyTransaction ${timestamp}`)

    return {
      applied: true,
      passed: passedApply,
      applyResult: applyResult,
      reason: 'apply result',
      applyResponse: applyResponse
    }
  }

  resetTxCoverageMap() {
    this.txCoverageMap = {}
  }

  /**
   * commitConsensedTransaction
   * This works with our in memory copies of data that have had a TX applied.
   * This calls into the app to save data and also updates:
   *    acceptedTransactions, stateTableData and accountsCopies DB tables
   *    accountCache and accountStats
   * @param queueEntry
   */
  async commitConsensedTransaction(queueEntry: QueueEntry): Promise<CommitConsensedTransactionResult> {
    let ourLockID = -1
    let accountDataList
    let uniqueKeys = []
    let ourAccountLocks = null
    let acceptedTX = queueEntry.acceptedTx
    let wrappedStates = queueEntry.collectedData
    let localCachedData = queueEntry.localCachedData
    let keysResponse = queueEntry.txKeys
    let { timestamp, sourceKeys, targetKeys, debugInfo } = keysResponse
    let applyResponse = queueEntry?.preApplyTXResult?.applyResponse
    let isGlobalModifyingTX = queueEntry.globalModification === true
    let savedSomething = false
    try {
      this.profiler.profileSectionStart('commit-1-setAccount')
      if (logFlags.verbose) {
        this.mainLogger.debug(`commitConsensedTransaction  ts:${timestamp} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`)
        this.mainLogger.debug(`commitConsensedTransaction  filter: ${utils.stringifyReduce(queueEntry.localKeys)}`)
        this.mainLogger.debug(`commitConsensedTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
        this.mainLogger.debug(`commitConsensedTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
        this.mainLogger.debug(`commitConsensedTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`)
      }
      // TODO ARCH REVIEW:  review use of fifo lock of accountModification and account keys. (more notes in tryPreApplyTransaction() above )

      uniqueKeys = queueEntry.uniqueKeys

      if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`commitConsensedTransaction FIFO lock outer: ${utils.stringifyReduce(uniqueKeys)} `)
      // TODO Perf (for sharded networks).  consider if we can remove this lock
      ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(uniqueKeys)
      if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`commitConsensedTransaction FIFO lock inner: ${utils.stringifyReduce(uniqueKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)

      ourLockID = await this.stateManager.fifoLock('accountModification')

      if (logFlags.verbose) if (logFlags.console) console.log(`commitConsensedTransaction tx:${queueEntry.logID} ts:${timestamp} Applying!`)
      // if (logFlags.verbose) this.mainLogger.debug('APPSTATE: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))

      //let { stateTableResults, accountData: _accountdata } = applyResponse
      let stateTableResults = null
      let _accountdata = []

      if(applyResponse != null){
        stateTableResults = applyResponse.stateTableResults
        _accountdata = applyResponse.accountData
      }


      accountDataList = _accountdata

      /**
       * Change to existing functionality.   Similar to how createAndShareVote should now check for the presence of
       * applyResponse.accountWrites, commitConsensedTransaction should also check for this data and use it.
       * It may take some more investigation but it is important that the order that accounts are added to accountWrites
       * will be maintained when committing the accounts.  We may have to investigate the code to make sure that there
       * is not any sorting by address that could get in the way.
       */

       if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction tx:${queueEntry.logID} ts:${timestamp} accounts: ${utils.stringifyReduce(Object.keys(wrappedStates))}  `)
        //create a temp map for state table logging below.
        //importantly, we override the wrappedStates with writtenAccountsMap if there is any accountWrites used
        //this should mean dapps don't have to use this feature.  (keeps simple dapps simpler)
      let writtenAccountsMap: WrappedResponses = {}
      if (applyResponse != null && applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
        for (let writtenAccount of applyResponse.accountWrites) {
          writtenAccountsMap[writtenAccount.accountId] = writtenAccount.data
          writtenAccountsMap[writtenAccount.accountId].prevStateId = wrappedStates[writtenAccount.accountId] ? wrappedStates[writtenAccount.accountId].stateId : ''
          writtenAccountsMap[writtenAccount.accountId].prevDataCopy = wrappedStates[writtenAccount.accountId] ? utils.deepCopy(writtenAccount.data) : {}
        }
        //override wrapped states with writtenAccountsMap which should be more complete if it included
        wrappedStates = writtenAccountsMap
        if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction applyResponse.accountWrites tx:${queueEntry.logID} ts:${timestamp} accounts: ${utils.stringifyReduce(Object.keys(wrappedStates))}  `)
      }

      //If we are not in the execution home then use data that was sent to us for the commit
      if(queueEntry.globalModification === false && this.executeInOneShard && queueEntry.isInExecutionHome === false){
        //looks like this next line could be wiping out state from just above that used accountWrites
        //we have a task to refactor his code that needs to happen for executeInOneShard to work
        wrappedStates = {}
        for(let key of Object.keys(queueEntry.collectedFinalData)){
          let finalAccount = queueEntry.collectedFinalData[key]
          let accountId = finalAccount.accountId

          //finalAccount.prevStateId = wrappedStates[accountId] ? wrappedStates[accountId].stateId : ''
          //finalAccount.prevDataCopy = wrappedStates[accountId] ? utils.deepCopy(wrappedStates[accountId].data) : {}
          let prevStateCalc = wrappedStates[accountId] ? wrappedStates[accountId].stateId : ''
          if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction collectedFinalData tx:${queueEntry.logID} ts:${timestamp} ${utils.makeShortHash(finalAccount)} preveStateID: ${finalAccount.prevStateId } vs expected: ${prevStateCalc}`)

          wrappedStates[key] = finalAccount
        }
        if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction collectedFinalData tx:${queueEntry.logID} ts:${timestamp} accounts: ${utils.stringifyReduce(Object.keys(wrappedStates))}  `)
      }

      // set a filter based so we only save data for local accounts.  The filter is a slightly different structure than localKeys
      // decided not to try and merge them just yet, but did accomplish some cleanup of the filter logic
      let filter: AccountFilter = {}

      let nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData = this.stateManager.currentCycleShardData.nodeShardData
      //update the filter to contain any local accounts in accountWrites
      if (applyResponse != null && applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
        for (let writtenAccount of applyResponse.accountWrites) {
          let isLocal = ShardFunctions.testAddressInRange(writtenAccount.accountId, nodeShardData.storedPartitions)
          if (isLocal) {
            filter[writtenAccount.accountId] = 1
          }
        }
      }

      if (this.executeInOneShard && applyResponse == null && queueEntry.collectedFinalData != null){
        for (let writtenAccount of Object.values(wrappedStates)) {
          let isLocal = ShardFunctions.testAddressInRange(writtenAccount.accountId, nodeShardData.storedPartitions)
          if (isLocal) {
            filter[writtenAccount.accountId] = 1
          }
        }
      }

      if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)

      let note = `setAccountData: tx:${queueEntry.logID} in commitConsensedTransaction. `

      for (let key of Object.keys(queueEntry.localKeys)) {
        filter[key] = 1
      }

      const startTime = process.hrtime()
      this.profiler.scopedProfileSectionStart('commit_setAccount')
      const endTime = process.hrtime(startTime)
      queueEntry.txDebug.duration['commit_setAccount'] = endTime[1] / 1000000
      // wrappedStates are side effected for now
      savedSomething = await this.stateManager.setAccount(wrappedStates, localCachedData, applyResponse, isGlobalModifyingTX, filter, note)
      this.profiler.scopedProfileSectionEnd('commit_setAccount')
      if (savedSomething) {
        if(this.config.debug.optimizedTXConsenus){
          //todo implement if we need it?

        }
        else {
          if (queueEntry.appliedReceipt && queueEntry.appliedReceipt.appliedVotes) {
            if (!this.config.debug.disableTxCoverageReport) {
              this.txCoverageMap[queueEntry.logID] = queueEntry.appliedReceipt.appliedVotes.length
            }
          } else {
            this.mainLogger.error(`commitConsensedTransaction  savedSomething: ${savedSomething}; it does not have appliedVotes field in the ${utils.stringifyReduce(queueEntry.originalData)}`)
          }
        }

      }

      if (logFlags.verbose) {
        this.mainLogger.debug(`commitConsensedTransaction  savedSomething: ${savedSomething}`)
        this.mainLogger.debug(`commitConsensedTransaction  accountData[${accountDataList.length}]: ${utils.stringifyReduce(accountDataList)}`)
        this.mainLogger.debug(`commitConsensedTransaction  stateTableResults[${stateTableResults.length}]: ${utils.stringifyReduce(stateTableResults)}`)
      }

      this.profiler.profileSectionEnd('commit-1-setAccount')
      this.profiler.profileSectionStart('commit-2-addAccountStatesAndTX')

      if(stateTableResults != null){
        for (let stateT of stateTableResults) {
          let wrappedRespose = wrappedStates[stateT.accountId]

          //backup if we dont have the account in wrapped states (state table results is just for debugging now, and no longer used by sync)
          if (wrappedRespose == null) {
            wrappedRespose = writtenAccountsMap[stateT.accountId]
          }

          // we have to correct stateBefore because it now gets stomped in the vote, TODO cleaner fix?
          stateT.stateBefore = wrappedRespose.prevStateId

          if (logFlags.verbose) {
            if (logFlags.console) console.log('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter) + ' txid: ' + utils.makeShortHash(acceptedTX.txId) + ' ts: ' + acceptedTX.timestamp)
            this.mainLogger.debug('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter) + ' txid: ' + utils.makeShortHash(acceptedTX.txId) + ' ts: ' + acceptedTX.timestamp)
          }
        }
        await this.storage.addAccountStates(stateTableResults)
      }

      // write the accepted TX to storage
      this.storage.addAcceptedTransactions([acceptedTX])
      this.profiler.profileSectionEnd('commit-2-addAccountStatesAndTX')
      this.profiler.profileSectionStart('commit-3-transactionReceiptPass')
      // endpoint to allow dapp to execute something that depends on a transaction being approved.
      this.app.transactionReceiptPass(acceptedTX.data, wrappedStates, applyResponse)

      this.profiler.profileSectionEnd('commit-3-transactionReceiptPass')
    } catch (ex) {
      this.statemanager_fatal(`commitConsensedTransaction_ex`, 'commitConsensedTransaction failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      if (logFlags.debug) this.mainLogger.debug(`commitConsensedTransaction failed id:${utils.makeShortHash(acceptedTX.txId)}  ${utils.stringifyReduce(acceptedTX)}`)
      return { success: false }
    } finally {
      this.stateManager.fifoUnlock('accountModification', ourLockID)

      if (ourAccountLocks != null) {
        this.stateManager.bulkFifoUnlockAccounts(uniqueKeys, ourAccountLocks)
      }
      if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction FIFO unlock inner: ${utils.stringifyReduce(uniqueKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
    }

    this.profiler.profileSectionStart('commit-4-updateAccountsCopyTable')
    // have to wrestle with the data a bit so we can backup the full account and not just the partial account!
    // let dataResultsByKey = {}
    let dataResultsFullList = []
    for (let wrappedData of applyResponse.accountData) {
      // TODO Before I clean this out, need to test a TX that uses localcache and partital data!!
      // if (wrappedData.isPartial === false) {
      //   dataResultsFullList.push(wrappedData.data)
      // } else {
      //   dataResultsFullList.push(wrappedData.localCache)
      // }
      if (wrappedData.localCache != null) {
        dataResultsFullList.push(wrappedData)
      }
      // dataResultsByKey[wrappedData.accountId] = wrappedData.data
    }

    // TSConversion verified that app.setAccount calls shardus.applyResponseAddState  that adds hash and txid to the data and turns it into AccountData
    let upgradedAccountDataList: Shardus.AccountData[] = dataResultsFullList as unknown as Shardus.AccountData[]

    let repairing = false
    // TODO ARCH REVIEW:  do we still need this table (answer: yes for sync. for now.).  do we need to await writing to it?
    await this.stateManager.updateAccountsCopyTable(upgradedAccountDataList, repairing, timestamp)

    //the first node in the TX group will emit txProcessed.  I think this it to prevent over reporting (one node per tx group will report)
    if (queueEntry != null && queueEntry.transactionGroup != null && this.p2p.getNodeId() === queueEntry.transactionGroup[0].id) {
      if(queueEntry.globalModification === false){ //temp way to make global modifying TXs not over count
        this.stateManager.eventEmitter.emit('txProcessed')
      }
    }
    this.stateManager.eventEmitter.emit('txApplied', acceptedTX)

    this.profiler.profileSectionEnd('commit-4-updateAccountsCopyTable')

    this.profiler.profileSectionStart('commit-5-stats')
    // STATS update
    this.stateManager.partitionStats.statsTxSummaryUpdate(queueEntry.cycleToRecordOn, queueEntry)
    for (let wrappedData of applyResponse.accountData) {
      //let queueData = queueEntry.collectedData[wrappedData.accountId]
      let queueData = wrappedStates[wrappedData.accountId]
      if (queueData != null) {
        if (queueData.accountCreated) {
          //account was created to do a summary init
          this.stateManager.partitionStats.statsDataSummaryInit(queueEntry.cycleToRecordOn, queueData.accountId, queueData.prevDataCopy, 'commit')
        }
        this.stateManager.partitionStats.statsDataSummaryUpdate(queueEntry.cycleToRecordOn, queueData.prevDataCopy, wrappedData, 'commit')
      } else {
        if (logFlags.error) this.mainLogger.error(`commitConsensedTransaction failed to get account data for stats ${wrappedData.accountId}`)
      }
    }

    this.profiler.profileSectionEnd('commit-5-stats')

    return { success: true }
  }

  updateHomeInformation(txQueueEntry: QueueEntry) {
    if (this.stateManager.currentCycleShardData != null && txQueueEntry.hasShardInfo === false) {
      let txId = txQueueEntry.acceptedTx.txId
      // Init home nodes!
      for (let key of txQueueEntry.txKeys.allKeys) {
        if (key == null) {
          throw new Error(`updateHomeInformation key == null ${key}`)
        }
        let homeNode = ShardFunctions.findHomeNode(this.stateManager.currentCycleShardData.shardGlobals, key, this.stateManager.currentCycleShardData.parititionShardDataMap)
        if (homeNode == null) {
          nestedCountersInstance.countRareEvent('fatal', 'updateHomeInformation homeNode == null')
          throw new Error(`updateHomeInformation homeNode == null ${key}`)
        }
        txQueueEntry.homeNodes[key] = homeNode
        if (homeNode == null) {
          if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(` routeAndQueueAcceptedTransaction: ${key} `)
          throw new Error(`updateHomeInformation homeNode == null ${txQueueEntry}`)
        }

        // calculate the partitions this TX is involved in for the receipt map
        let isGlobalAccount = this.stateManager.accountGlobals.isGlobalAccount(key)
        if (isGlobalAccount === true) {
          txQueueEntry.involvedPartitions.push(homeNode.homePartition)
          txQueueEntry.involvedGlobalPartitions.push(homeNode.homePartition)
        } else {
          txQueueEntry.involvedPartitions.push(homeNode.homePartition)
        }

        if (logFlags.playback) {
          // HOMENODEMATHS Based on home node.. should this be chaned to homepartition?
          let summaryObject = ShardFunctions.getHomeNodeSummaryObject(homeNode)
          let relationString = ShardFunctions.getNodeRelation(homeNode, this.stateManager.currentCycleShardData.ourNode.id)
          // route_to_home_node
          this.logger.playbackLogNote('shrd_homeNodeSummary', `${txId}`, `account:${utils.makeShortHash(key)} rel:${relationString} summary:${utils.stringifyReduce(summaryObject)}`)
        }
      }

      txQueueEntry.hasShardInfo = true
    }
  }

  tryInvloveAccount(txId: string, address: string, isRead: boolean): boolean {
    const queueEntry = this.getQueueEntry(txId)

    // check if address is already invloved in this tx
    if (queueEntry.collectedData[address]) {
      return true
    }
    if (queueEntry.involvedReads[address] || queueEntry.involvedWrites[address]) {
      return true
    }

    // test if the queue can take this account?
    // technically we can delay this check and since we have to run the just in time version of the check before apply
    // only difference of doing the work here also would be if we can more quickly reject a TX.

    // add the account to involved read or write
    if (isRead) {
      queueEntry.involvedReads[address] = true
    } else {
      queueEntry.involvedWrites[address] = true
    }
    return true
  }

  /***
   *    ######## ##    ##  #######  ##     ## ######## ##     ## ########
   *    ##       ###   ## ##     ## ##     ## ##       ##     ## ##
   *    ##       ####  ## ##     ## ##     ## ##       ##     ## ##
   *    ######   ## ## ## ##     ## ##     ## ######   ##     ## ######
   *    ##       ##  #### ##  ## ## ##     ## ##       ##     ## ##
   *    ##       ##   ### ##    ##  ##     ## ##       ##     ## ##
   *    ######## ##    ##  ##### ##  #######  ########  #######  ########
   */

  routeAndQueueAcceptedTransaction(acceptedTx: AcceptedTx, sendGossip: boolean = true, sender: Shardus.Node | null, globalModification: boolean, noConsensus: boolean): string | boolean {
    // dropping these too early.. hmm  we finished syncing before we had the first shard data.
    // if (this.stateManager.currentCycleShardData == null) {
    //   // this.preTXQueue.push(acceptedTX)
    //   return 'notReady' // it is too early to care about the tx
    // }
    if (logFlags.playback) this.logger.playbackLogNote('routeAndQueueAcceptedTransaction-debug', '', `sendGossip:${sendGossip} globalModification:${globalModification} noConsensus:${noConsensus} this.readyforTXs:${this.stateManager.accountSync.readyforTXs} hasshardData:${this.stateManager.currentCycleShardData != null} acceptedTx:${utils.stringifyReduce(acceptedTx)} `)
    if (this.stateManager.accountSync.readyforTXs === false) {
      if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction too early for TX: this.readyforTXs === false`)
      return 'notReady' // it is too early to care about the tx
    }
    if (this.stateManager.currentCycleShardData == null) {
      if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction too early for TX: this.stateManager.currentCycleShardData == null`)
      return 'notReady'
    }

    try {
      this.profiler.profileSectionStart('enqueue')

      if (this.stateManager.accountGlobals.hasknownGlobals == false) {
        if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction too early for TX: hasknownGlobals == false`)
        return 'notReady'
      }

      let keysResponse = acceptedTx.keys
      let timestamp = acceptedTx.timestamp
      let txId = acceptedTx.txId

      // This flag turns of consensus for all TXs for debuggging
      if (this.stateManager.debugNoTxVoting === true) {
        noConsensus = true
      }

      let cycleNumber = this.stateManager.currentCycleShardData.cycleNumber

      this.queueEntryCounter++
      let txQueueEntry: QueueEntry = {
        acceptedTx: acceptedTx,
        txKeys: keysResponse,
        executionShardKey: null,
        isInExecutionHome: true,
        noConsensus,
        collectedData: {},
        collectedFinalData: {},
        originalData: {},
        beforeHashes: {},
        homeNodes: {},
        patchedOnNodes: new Map(),
        hasShardInfo: false,
        state: 'aging',
        dataCollected: 0,
        hasAll: false,
        entryID: this.queueEntryCounter,
        localKeys: {},
        localCachedData: {},
        syncCounter: 0,
        didSync: false,
        queuedBeforeMainSyncComplete: false,
        didWakeup: false,
        syncKeys: [],
        logstate: '',
        requests: {},
        globalModification: globalModification,
        collectedVotes: [],
        collectedVoteHashes: [],
        waitForReceiptOnly: false,
        m2TimeoutReached: false,
        debugFail_voteFlip: false,
        debugFail_failNoRepair: false,
        requestingReceipt: false,
        cycleToRecordOn: -5,
        involvedPartitions: [],
        involvedGlobalPartitions: [],
        shortReceiptHash: '',
        requestingReceiptFailed: false,
        approximateCycleAge: cycleNumber,
        ourNodeInTransactionGroup: false,
        ourNodeInConsensusGroup: false,
        logID: '',
        txGroupDebug: '',
        uniqueWritableKeys: [],
        txGroupCycle: 0,
        updatedTxGroupCycle: 0,
        updatedTransactionGroup: null,
        receiptEverRequested: false,
        repairFailed: false,
        hasValidFinalData: false,
        pendingDataRequest: false,
        newVotes: false,
        fromClient: sendGossip,
        gossipedReceipt: false,
        archived: false,
        ourTXGroupIndex: -1,
        involvedReads: {},
        involvedWrites: {},
        txDebug: {
          enqueueHrTime: process.hrtime(),
          duration: {},
        },
        executionIdSet: new Set()
      } // age comes from timestamp

      // todo faster hash lookup for this maybe?
      let entry = this.getQueueEntrySafe(acceptedTx.txId) // , acceptedTx.timestamp)
      if (entry) {
        return false // already in our queue, or temp queue
      }

      txQueueEntry.logID = utils.makeShortHash(acceptedTx.txId)

      this.stateManager.debugTXHistory[txQueueEntry.logID] = 'enteredQueue'

      if (this.app.canDebugDropTx(acceptedTx.data)) {
        if (this.stateManager.testFailChance(this.stateManager.loseTxChance, 'loseTxChance', txQueueEntry.logID, '', logFlags.verbose) === true) {
          return 'lost'
        }
        if (this.stateManager.testFailChance(this.stateManager.voteFlipChance, 'voteFlipChance', txQueueEntry.logID, '', logFlags.verbose) === true) {
          txQueueEntry.debugFail_voteFlip = true
        }

        if (globalModification === false && this.stateManager.testFailChance(this.stateManager.failNoRepairTxChance, 'failNoRepairTxChance', txQueueEntry.logID, '', logFlags.verbose) === true) {
          txQueueEntry.debugFail_failNoRepair = true
        }
      }

      try {
        let age = Date.now() - timestamp

        let keyHash: StringBoolObjectMap = {}  //TODO replace with Set<string>
        for (let key of txQueueEntry.txKeys.allKeys) {
          if (key == null) {
            // throw new Error(`routeAndQueueAcceptedTransaction key == null ${key}`)
            if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction key == null ${timestamp} not putting tx in queue.`)
            return false
          }

          keyHash[key] = true
        }
        txQueueEntry.uniqueKeys = Object.keys(keyHash)

        if(txQueueEntry.txKeys.allKeys == null || txQueueEntry.txKeys.allKeys.length === 0){
          if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction allKeys == null || allKeys.length === 0 ${timestamp} not putting tx in queue.`)
          return false
        }

        this.updateHomeInformation(txQueueEntry)

        //set the executionShardKey for the transaction
        if(txQueueEntry.globalModification === false && this.executeInOneShard){
          txQueueEntry.executionShardKey = txQueueEntry.txKeys.allKeys[0]
          if (logFlags.verbose) this.mainLogger.debug(`routeAndQueueAcceptedTransaction set executionShardKey tx:${txQueueEntry.logID} ts:${timestamp} accounts: ${utils.stringifyReduce(Object.keys(txQueueEntry.executionShardKey))}  `)

          // we were doing this in queueEntryGetTransactionGroup.  moved it earlier.
          let { homePartition } = ShardFunctions.addressToPartition(this.stateManager.currentCycleShardData.shardGlobals, txQueueEntry.executionShardKey)
          let ourNodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData = this.stateManager.currentCycleShardData.nodeShardData
          // let nodeStoresThisPartition = ShardFunctions.testInRange(homePartition, ourNodeShardData.storedPartitions)
          // if(nodeStoresThisPartition === false){
          //   //before being in the set that stores the partition was enough, but we want to make it just the consensus nodes
          //   //txQueueEntry.isInExecutionHome = false
          // }

          let homeShardData = this.stateManager.currentCycleShardData.parititionShardDataMap.get(homePartition)

          //set the nodes that are in the executionGroup.
          //This is needed so that consensus will expect less nodes to be voting
          txQueueEntry.executionGroup = homeShardData.homeNodes[0].consensusNodeForOurNodeFull.slice()
          for(let node of txQueueEntry.executionGroup){
            txQueueEntry.executionIdSet.add(node.id)

          }
          //if we are not in the execution group then set isInExecutionHome to false
          if(txQueueEntry.executionIdSet.has(this.stateManager.currentCycleShardData.ourNode.id) === false){
            txQueueEntry.isInExecutionHome = false
          }

          if (logFlags.verbose) this.mainLogger.debug(`routeAndQueueAcceptedTransaction info ${txQueueEntry.logID} isInExecutionHome:${txQueueEntry.isInExecutionHome} hasShardInfo:${txQueueEntry.hasShardInfo}`)
          if (logFlags.playback) this.logger.playbackLogNote('routeAndQueueAcceptedTransaction', `routeAndQueueAcceptedTransaction info ${txQueueEntry.logID} isInExecutionHome:${txQueueEntry.isInExecutionHome} hasShardInfo:${txQueueEntry.hasShardInfo} executionShardKey:${utils.makeShortHash(txQueueEntry.executionShardKey)}`)

        }


        // calculate information needed for receiptmap
        //txQueueEntry.cycleToRecordOn = this.stateManager.getCycleNumberFromTimestamp(timestamp)
        txQueueEntry.cycleToRecordOn = CycleChain.getCycleNumberFromTimestamp(timestamp)
        if (logFlags.verbose) console.log('Cycle number from timestamp', timestamp, txQueueEntry.cycleToRecordOn)
        if (txQueueEntry.cycleToRecordOn < 0) {
          nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'caused Enqueue fail')
          if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction failed to calculate cycle ${timestamp} error code:${txQueueEntry.cycleToRecordOn}`)
          return false
        }
        if (txQueueEntry.cycleToRecordOn == null) {
          this.statemanager_fatal(`routeAndQueueAcceptedTransaction cycleToRecordOn==null`, `routeAndQueueAcceptedTransaction cycleToRecordOn==null  ${txQueueEntry.logID} ${timestamp}`)
        }

        if (logFlags.playback) this.logger.playbackLogNote('shrd_queueInsertion_start', txQueueEntry.logID, `${txQueueEntry.logID} uniqueKeys:${utils.stringifyReduce(txQueueEntry.uniqueKeys)}  txKeys: ${utils.stringifyReduce(txQueueEntry.txKeys)} cycleToRecordOn:${txQueueEntry.cycleToRecordOn}`)

        // Look at our keys and log which are known global accounts.  Set global accounts for keys if this is a globalModification TX
        for (let key of txQueueEntry.uniqueKeys) {
          if (globalModification === true) {
            if (this.stateManager.accountGlobals.isGlobalAccount(key)) {
              if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', `routeAndQueueAcceptedTransaction - has account:${utils.stringifyReduce(key)}`)
            } else {
              //this makes the code aware that this key is for a global account.
              //is setting this here too soon?
              //it should be that p2p has already checked the receipt before calling shardus.push with global=true
              this.stateManager.accountGlobals.setGlobalAccount(key)
              if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', `routeAndQueueAcceptedTransaction - set account:${utils.stringifyReduce(key)}`)
            }
          }
        }

        // slightly different flag that didsync.  This is less about if our address range was done syncing (which can happen any time)
        // and just a simple check to see if this was queued before the main sync phase.
        // for now, just used for more detailed logging so we can sort out if problem TXs were from shortly before we were fully done
        // but after a sync range was finished, (used shortly below in the age check)
        txQueueEntry.queuedBeforeMainSyncComplete = this.stateManager.accountSync.dataSyncMainPhaseComplete

        // Check to see if any keys are inside of a syncing range.
        // If it is a global key in a non-globalModification TX then we dont care about it

        // COMPLETE HACK!!!!!!!!!
        // for (let key of txQueueEntry.uniqueKeys) {
        //   let syncTracker = this.stateManager.accountSync.getSyncTracker(key)
        //   // only look at syncing for accounts that are changed.
        //   // if the sync range is for globals and the tx is not a global modifier then skip it!

        //   // todo take another look at this condition and syncTracker.globalAddressMap
        //   if (syncTracker != null && (syncTracker.isGlobalSyncTracker === false || txQueueEntry.globalModification === true)) {
        //     if (this.stateManager.accountSync.softSync_noSyncDelay === true) {
        //       //no delay means that don't pause the TX in state = 'syncing'
        //     } else {
        //       txQueueEntry.state = 'syncing'
        //       txQueueEntry.syncCounter++
        //       syncTracker.queueEntries.push(txQueueEntry) // same tx may get pushed in multiple times. that's ok.
        //       syncTracker.keys[key] = true //mark this key for fast testing later
        //     }

        //     txQueueEntry.didSync = true // mark that this tx had to sync, this flag should never be cleared, we will use it later to not through stuff away.
        //     txQueueEntry.syncKeys.push(key) // used later to instruct what local data we should JIT load
        //     txQueueEntry.localKeys[key] = true // used for the filter.  TODO review why this is set true here!!! seems like this may flag some keys not owned by this node!
        //     if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_queued_and_set_syncing', `${txQueueEntry.logID}`, `${txQueueEntry.logID} qId: ${txQueueEntry.entryID} account:${utils.stringifyReduce(key)}`)
        //   }
        // }

        if (age > this.stateManager.queueSitTime * 0.9) {
          if (txQueueEntry.didSync === true) {
            nestedCountersInstance.countEvent('stateManager', `enqueue old TX didSync === true queuedBeforeMainSyncComplete:${txQueueEntry.queuedBeforeMainSyncComplete}`)
          } else {
            nestedCountersInstance.countEvent('stateManager', `enqueue old TX didSync === false queuedBeforeMainSyncComplete:${txQueueEntry.queuedBeforeMainSyncComplete}`)
            if (txQueueEntry.queuedBeforeMainSyncComplete) {
              //only a fatal if it was after the main sync phase was complete.
              this.statemanager_fatal(`routeAndQueueAcceptedTransaction_olderTX`, 'routeAndQueueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age)
              // TODO consider throwing this out.  right now it is just a warning
              if (logFlags.playback) this.logger.playbackLogNote('shrd_oldQueueInsertion', '', 'routeAndQueueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age)
            }
          }
        }

        // Refine our list of which keys will be updated in this transaction : uniqueWritableKeys
        for (let key of txQueueEntry.uniqueKeys) {
          let isGlobalAcc = this.stateManager.accountGlobals.isGlobalAccount(key)

          // if it is a global modification and global account we can write
          if (globalModification === true && isGlobalAcc === true) {
            txQueueEntry.uniqueWritableKeys.push(key)
          }
          // if it is a normal transaction and non global account we can write
          if (globalModification === false && isGlobalAcc === false) {
            txQueueEntry.uniqueWritableKeys.push(key)
          }
          txQueueEntry.uniqueWritableKeys.sort() //need this list to be deterministic!
        }

        if (txQueueEntry.hasShardInfo) {
          let transactionGroup = this.queueEntryGetTransactionGroup(txQueueEntry)
          if (txQueueEntry.ourNodeInTransactionGroup || txQueueEntry.didSync === true) {
            // go ahead and calculate this now if we are in the tx group or we are syncing this range!
            this.queueEntryGetConsensusGroup(txQueueEntry)
          }
          if (sendGossip && txQueueEntry.globalModification === false) {
            try {
              if (transactionGroup.length > 1) {
                // should consider only forwarding in some cases?
                this.stateManager.debugNodeGroup(txId, timestamp, `share to neighbors`, transactionGroup)
                this.p2p.sendGossipIn('spread_tx_to_group', acceptedTx, '', sender, transactionGroup, true)
              }
              // if (logFlags.playback ) this.logger.playbackLogNote('tx_homeGossip', `${txId}`, `AcceptedTransaction: ${acceptedTX}`)
            } catch (ex) {
              this.statemanager_fatal(`txQueueEntry_ex`, 'txQueueEntry: ' + utils.stringifyReduce(txQueueEntry))
            }
          }

          if (txQueueEntry.didSync === false) {
            // see if our node shard data covers any of the accounts?
            if (txQueueEntry.ourNodeInTransactionGroup === false && txQueueEntry.globalModification === false) {
              if (logFlags.playback) this.logger.playbackLogNote('shrd_notInTxGroup', `${txQueueEntry.logID}`, ``)
              return 'out of range' // we are done, not involved!!!
            } else {
              // If we have syncing neighbors forward this TX to them
              if (this.config.debug.forwardTXToSyncingNeighbors && this.stateManager.currentCycleShardData.hasSyncingNeighbors === true) {
                let send_spread_tx_to_group_syncing = true
                //todo turn this back on if other testing goes ok
                if (txQueueEntry.ourNodeInTransactionGroup === false) {
                  nestedCountersInstance.countEvent('transactionQueue', 'spread_tx_to_group_syncing-skipped2')
                  send_spread_tx_to_group_syncing = false
                } else if (txQueueEntry.ourTXGroupIndex > 0) {
                  let everyN = Math.max(1, Math.floor(txQueueEntry.transactionGroup.length * 0.4))
                  let nonce = parseInt('0x' + txQueueEntry.acceptedTx.txId.substr(0, 2))
                  let idxPlusNonce = txQueueEntry.ourTXGroupIndex + nonce
                  let idxModEveryN = idxPlusNonce % everyN
                  if (idxModEveryN > 0) {
                    nestedCountersInstance.countEvent('transactionQueue', 'spread_tx_to_group_syncing-skipped')
                    send_spread_tx_to_group_syncing = false
                  }
                }
                if (send_spread_tx_to_group_syncing) {
                  nestedCountersInstance.countEvent('transactionQueue', 'spread_tx_to_group_syncing-notSkipped')

                  // only send non global modification TXs
                  if (txQueueEntry.globalModification === false) {
                    if (logFlags.verbose) this.mainLogger.debug(`routeAndQueueAcceptedTransaction: spread_tx_to_group ${txQueueEntry.logID}`)
                    if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_tx', `${txQueueEntry.logID}`, `txts: ${timestamp} nodes:${utils.stringifyReduce(this.stateManager.currentCycleShardData.syncingNeighborsTxGroup.map((x) => x.id))}`)

                    this.stateManager.debugNodeGroup(txId, timestamp, `share to syncing neighbors`, this.stateManager.currentCycleShardData.syncingNeighborsTxGroup)
                    //this.p2p.sendGossipAll('spread_tx_to_group', acceptedTx, '', sender, this.stateManager.currentCycleShardData.syncingNeighborsTxGroup)
                    this.p2p.tell(this.stateManager.currentCycleShardData.syncingNeighborsTxGroup, 'spread_tx_to_group_syncing', acceptedTx)
                  } else {
                    if (logFlags.verbose) this.mainLogger.debug(`routeAndQueueAcceptedTransaction: bugfix detected. avoid forwarding txs where globalModification == true ${txQueueEntry.logID}`)
                  }
                }
              }
            }
          }
        } else {
          throw new Error('missing shard info')
        }

        this.newAcceptedTxQueueTempInjest.push(txQueueEntry)
        this.newAcceptedTxQueueTempInjestByID.set(txQueueEntry.acceptedTx.txId, txQueueEntry)

        if (logFlags.playback) this.logger.playbackLogNote('shrd_txPreQueued', `${txQueueEntry.logID}`, `${txQueueEntry.logID} gm:${txQueueEntry.globalModification}`)
        // start the queue if needed
        this.stateManager.tryStartAcceptedQueue()
      } catch (error) {
        if (logFlags.playback) this.logger.playbackLogNote('shrd_addtoqueue_rejected', `${txId}`, `AcceptedTransaction: ${txQueueEntry.logID} ts: ${txQueueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(txQueueEntry.txKeys.allKeys)}`)
        this.statemanager_fatal(`routeAndQueueAcceptedTransaction_ex`, 'routeAndQueueAcceptedTransaction failed: ' + errorToStringFull(error))
        throw new Error(error)
      }
      return true
    } finally {
      this.profiler.profileSectionEnd('enqueue')
    }
  }

  /***
   *     #######           ###     ######   ######  ########  ######   ######
   *    ##     ##         ## ##   ##    ## ##    ## ##       ##    ## ##    ##
   *    ##     ##        ##   ##  ##       ##       ##       ##       ##
   *    ##     ##       ##     ## ##       ##       ######    ######   ######
   *    ##  ## ##       ######### ##       ##       ##             ##       ##
   *    ##    ##        ##     ## ##    ## ##    ## ##       ##    ## ##    ##
   *     ##### ##       ##     ##  ######   ######  ########  ######   ######
   */

  /**
   * getQueueEntry
   * get a queue entry from the current queue
   * @param txid
   */
  getQueueEntry(txid: string): QueueEntry | null {
    let queueEntry = this.newAcceptedTxQueueByID.get(txid)
    if (queueEntry === undefined) {
      return null
    }
    return queueEntry
  }

  /**
   * getQueueEntryPending
   * get a queue entry from the pending queue (has not been added to the main queue yet)
   * this is mainly for internal use, it makes more sense to call getQueueEntrySafe
   * @param txid
   */
  getQueueEntryPending(txid: string): QueueEntry | null {
    let queueEntry = this.newAcceptedTxQueueTempInjestByID.get(txid)
    if (queueEntry === undefined) {
      return null
    }
    return queueEntry
  }

  /**
   * getQueueEntrySafe
   * get a queue entry from the queue or the pending queue (but not archive queue)
   * @param txid
   */
  getQueueEntrySafe(txid: string): QueueEntry | null {
    let queueEntry = this.newAcceptedTxQueueByID.get(txid)
    if (queueEntry === undefined) {
      queueEntry = this.newAcceptedTxQueueTempInjestByID.get(txid)
      if (queueEntry === undefined) {
        return null
      }
    }
    return queueEntry
  }

  /**
   * getQueueEntryArchived
   * get a queue entry from the archive queue only
   * @param txid
   * @param msg
   */
  getQueueEntryArchived(txid: string, msg: string): QueueEntry | null {
    let queueEntry = this.archivedQueueEntriesByID.get(txid)
    if (queueEntry != null) {
      return queueEntry
    }
    nestedCountersInstance.countRareEvent('error', `getQueueEntryArchived no entry: ${msg}`)
    if (logFlags.error) this.mainLogger.error(`getQueueEntryArchived failed to find: ${utils.stringifyReduce(txid)} ${msg} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(txid)]}`)
    return null
  }

  /**
   * queueEntryAddData
   * add data to a queue entry
   *   // TODO CODEREVIEW.  need to look at the use of local cache.  also is the early out ok?
   * @param queueEntry
   * @param data
   */
  queueEntryAddData(queueEntry: QueueEntry, data: Shardus.WrappedResponse) {
    if (queueEntry.collectedData[data.accountId] != null) {
      return // already have the data
    }
    if (queueEntry.uniqueKeys == null) {
      // cant have all data yet if we dont even have unique keys.
      throw new Error(`Attempting to add data and uniqueKeys are not available yet: ${utils.stringifyReduceLimit(queueEntry, 200)}`)
    }
    queueEntry.collectedData[data.accountId] = data
    queueEntry.dataCollected++

    //make a deep copy of the data
    queueEntry.originalData[data.accountId] = JSON.parse(stringify(data))
    queueEntry.beforeHashes[data.accountId] = data.stateId

    if (queueEntry.dataCollected === queueEntry.uniqueKeys.length) {
      //  queueEntry.tx Keys.allKeys.length
      queueEntry.hasAll = true
    }

    if (data.localCache) {
      queueEntry.localCachedData[data.accountId] = data.localCache
      delete data.localCache
    }

    if (logFlags.playback) this.logger.playbackLogNote('shrd_addData', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `key ${utils.makeShortHash(data.accountId)} hash: ${utils.makeShortHash(data.stateId)} hasAll:${queueEntry.hasAll} collected:${queueEntry.dataCollected}  ${queueEntry.acceptedTx.timestamp}`)
  }

  /**
   * queueEntryHasAllData
   * Test if the queueEntry has all the data it needs.
   * TODO could be slightly more if it only recalculated when dirty.. but that would add more state and complexity,
   * so wait for this to show up in the profiler before fixing
   * @param queueEntry
   */
  queueEntryHasAllData(queueEntry: QueueEntry): boolean {
    if (queueEntry.hasAll === true) {
      return true
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error(`queueEntryHasAllData (queueEntry.uniqueKeys == null)`)
    }
    let dataCollected = 0
    for (let key of queueEntry.uniqueKeys) {
      if (queueEntry.collectedData[key] != null) {
        dataCollected++
      }
    }
    if (dataCollected === queueEntry.uniqueKeys.length) {
      //  queueEntry.tx Keys.allKeys.length uniqueKeys.length
      queueEntry.hasAll = true
      return true
    }
    return false
  }

  /**
   * queueEntryRequestMissingData
   * ask other nodes for data that is missing for this TX.
   * normally other nodes in the network should foward data to us at the correct time.
   * This is only for the case that a TX has waited too long and not received the data it needs.
   * @param queueEntry
   */
  async queueEntryRequestMissingData(queueEntry: QueueEntry) {
    if (this.stateManager.currentCycleShardData == null) {
      return
    }

    if (queueEntry.pendingDataRequest === true) {
      return
    }
    queueEntry.pendingDataRequest = true

    nestedCountersInstance.countEvent('processing', 'queueEntryRequestMissingData-start')

    if (!queueEntry.requests) {
      queueEntry.requests = {}
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('queueEntryRequestMissingData queueEntry.uniqueKeys == null')
    }

    let allKeys = []
    for (let key of queueEntry.uniqueKeys) {
      if (queueEntry.collectedData[key] == null) {
        allKeys.push(key)
      }
    }

    if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_start', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}`)

    // consensus group should have all the data.. may need to correct this later
    //let consensusGroup = this.queueEntryGetConsensusGroup(queueEntry)
    //let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)

    for (let key of queueEntry.uniqueKeys) {
      if (queueEntry.collectedData[key] == null && queueEntry.requests[key] == null) {
        let keepTrying = true
        let triesLeft = 5
        // let triesLeft = Math.min(5, consensusGroup.length )
        // let nodeIndex = 0
        while (keepTrying) {
          if (triesLeft <= 0) {
            keepTrying = false
            break
          }
          triesLeft--
          let homeNodeShardData = queueEntry.homeNodes[key] // mark outstanding request somehow so we dont rerequest

          // let node = consensusGroup[nodeIndex]
          // nodeIndex++

          // find a random node to ask that is not us
          let node = null
          let randomIndex
          let foundValidNode = false
          let maxTries = 1000

          // todo make this non random!!!.  It would be better to build a list and work through each node in order and then be finished
          // we have other code that does this fine.
          while (foundValidNode == false) {
            maxTries--
            randomIndex = this.stateManager.getRandomInt(homeNodeShardData.consensusNodeForOurNodeFull.length - 1)
            node = homeNodeShardData.consensusNodeForOurNodeFull[randomIndex]
            if (maxTries < 0) {
              //FAILED
              this.statemanager_fatal(`queueEntryRequestMissingData`, `queueEntryRequestMissingData: unable to find node to ask after 1000 tries tx:${utils.makeShortHash(queueEntry.acceptedTx.txId)} key: ${utils.makeShortHash(key)} ${utils.stringifyReduce(homeNodeShardData.consensusNodeForOurNodeFull.map((x) => (x != null ? x.id : 'null')))}`)
              break
            }
            if (node == null) {
              continue
            }
            if (node.id === this.stateManager.currentCycleShardData.nodeShardData.node.id) {
              continue
            }
            foundValidNode = true
          }

          if (node == null) {
            continue
          }
          if (node.status != 'active' || potentiallyRemoved.has(node.id)) {
            continue
          }
          if (node === this.stateManager.currentCycleShardData.ourNode) {
            continue
          }

          // Todo: expand this to grab a consensus node from any of the involved consensus nodes.

          for (let key2 of allKeys) {
            queueEntry.requests[key2] = node
          }

          let relationString = ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
          if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_ask', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}`)

          // Node Precheck!
          if (this.stateManager.isNodeValidForInternalMessage(node.id, 'queueEntryRequestMissingData', true, true) === false) {
            // if(this.tryNextDataSourceNode('queueEntryRequestMissingData') == false){
            //   break
            // }
            continue
          }

          let message = { keys: allKeys, txid: queueEntry.acceptedTx.txId, timestamp: queueEntry.acceptedTx.timestamp }
          let result: RequestStateForTxResp = await this.p2p.ask(node, 'request_state_for_tx', message)

          if (result == null) {
            if (logFlags.verbose) {
              if (logFlags.error) this.mainLogger.error('ASK FAIL request_state_for_tx')
            }
            if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_askfailretry', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
            continue
          }
          if (result.success !== true) {
            if (logFlags.error) this.mainLogger.error('ASK FAIL queueEntryRequestMissingData 9')
            if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_askfailretry2', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
            continue
          }
          let dataCountReturned = 0
          let accountIdsReturned = []
          for (let data of result.stateList) {
            this.queueEntryAddData(queueEntry, data)
            dataCountReturned++
            accountIdsReturned.push(utils.makeShortHash(data.accountId))
          }

          if (queueEntry.hasAll === true) {
            queueEntry.logstate = 'got all missing data'
          } else {
            queueEntry.logstate = 'failed to get data:' + queueEntry.hasAll
            //This will time out and go to reciept repair mode if it does not get more data sent to it.
          }

          if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_result', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

          // queueEntry.homeNodes[key] = null
          for (let key2 of allKeys) {
            //consider deleteing these instead?
            //TSConversion changed to a delete opertaion should double check this
            //queueEntry.requests[key2] = null
            delete queueEntry.requests[key2]
          }

          if (queueEntry.hasAll === true) {
            break
          }

          keepTrying = false
        }
      }
    }

    if (queueEntry.hasAll === true) {
      nestedCountersInstance.countEvent('processing', 'queueEntryRequestMissingData-success')
    } else {
      nestedCountersInstance.countEvent('processing', 'queueEntryRequestMissingData-failed')

      //give up and wait for receipt
      queueEntry.waitForReceiptOnly = true
      queueEntry.state = 'consensing'
    }
  }

  /**
   * queueEntryRequestMissingReceipt
   * Ask other nodes for a receipt to go with this TX
   * @param queueEntry
   */
  async queueEntryRequestMissingReceipt(queueEntry: QueueEntry) {
    if (this.stateManager.currentCycleShardData == null) {
      return
    }

    if (queueEntry.uniqueKeys == null) {
      throw new Error('queueEntryRequestMissingReceipt queueEntry.uniqueKeys == null')
    }

    if (queueEntry.requestingReceipt === true) {
      return
    }

    queueEntry.requestingReceipt = true
    queueEntry.receiptEverRequested = true

    if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_start', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID}`)

    let consensusGroup = this.queueEntryGetConsensusGroup(queueEntry)

    this.stateManager.debugNodeGroup(queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp, `queueEntryRequestMissingReceipt`, consensusGroup)
    //let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)
    //the outer loop here could just use the transaction group of nodes instead. but already had this working in a similar function
    //TODO change it to loop the transaction group untill we get a good receipt

    //Note: we only need to get one good receipt, the loop on keys is in case we have to try different groups of nodes
    let gotReceipt = false
    for (let key of queueEntry.uniqueKeys) {
      if (gotReceipt === true) {
        break
      }

      let keepTrying = true
      let triesLeft = Math.min(5, consensusGroup.length)
      let nodeIndex = 0
      while (keepTrying) {
        if (triesLeft <= 0) {
          keepTrying = false
          break
        }
        triesLeft--
        let homeNodeShardData = queueEntry.homeNodes[key] // mark outstanding request somehow so we dont rerequest

        let node = consensusGroup[nodeIndex]
        nodeIndex++

        if (node == null) {
          continue
        }
        if (node.status != 'active' || potentiallyRemoved.has(node.id)) {
          continue
        }
        if (node === this.stateManager.currentCycleShardData.ourNode) {
          continue
        }

        let relationString = ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
        if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_ask', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)

        // Node Precheck!
        if (this.stateManager.isNodeValidForInternalMessage(node.id, 'queueEntryRequestMissingReceipt', true, true) === false) {
          // if(this.tryNextDataSourceNode('queueEntryRequestMissingReceipt') == false){
          //   break
          // }
          continue
        }

        let message = { txid: queueEntry.acceptedTx.txId, timestamp: queueEntry.acceptedTx.timestamp }
        let result: RequestReceiptForTxResp = await this.p2p.ask(node, 'request_receipt_for_tx', message) // not sure if we should await this.

        if (result == null) {
          if (logFlags.verbose) {
            if (logFlags.error) this.mainLogger.error(`ASK FAIL request_receipt_for_tx ${triesLeft} ${utils.makeShortHash(node.id)}`)
          }
          if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_askfailretry', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
          continue
        }
        if (result.success !== true) {
          if (logFlags.error) this.mainLogger.error(`ASK FAIL queueEntryRequestMissingReceipt 9 ${triesLeft} ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)} note:${result.note} txid:${queueEntry.logID}`)
          continue
        }

        if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_result', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   result:${queueEntry.logstate} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} result: ${utils.stringifyReduce(result)}`)

        if (result.success === true && result.receipt != null) {
          //TODO implement this!!!
          queueEntry.recievedAppliedReceipt2 = result.receipt
          keepTrying = false
          gotReceipt = true

          this.mainLogger.debug(`queueEntryRequestMissingReceipt got good receipt for: ${utils.makeShortHash(queueEntry.acceptedTx.txId)} from: ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)}`)
        }
      }

      // break the outer loop after we are done trying.  todo refactor this.
      if (keepTrying == false) {
        break
      }
    }
    queueEntry.requestingReceipt = false

    if (gotReceipt === false) {
      queueEntry.requestingReceiptFailed = true
    }
  }

  async queueEntryRequestMissingReceipt_old(queueEntry: QueueEntry) {
    if (this.stateManager.currentCycleShardData == null) {
      return
    }

    if (queueEntry.uniqueKeys == null) {
      throw new Error('queueEntryRequestMissingReceipt queueEntry.uniqueKeys == null')
    }

    if (queueEntry.requestingReceipt === true) {
      return
    }

    queueEntry.requestingReceipt = true
    queueEntry.receiptEverRequested = true

    if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_start', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID}`)

    let consensusGroup = this.queueEntryGetConsensusGroup(queueEntry)

    this.stateManager.debugNodeGroup(queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp, `queueEntryRequestMissingReceipt`, consensusGroup)
    //let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)
    //the outer loop here could just use the transaction group of nodes instead. but already had this working in a similar function
    //TODO change it to loop the transaction group untill we get a good receipt

    //Note: we only need to get one good receipt, the loop on keys is in case we have to try different groups of nodes
    let gotReceipt = false
    for (let key of queueEntry.uniqueKeys) {
      if (gotReceipt === true) {
        break
      }

      let keepTrying = true
      let triesLeft = Math.min(5, consensusGroup.length)
      let nodeIndex = 0
      while (keepTrying) {
        if (triesLeft <= 0) {
          keepTrying = false
          break
        }
        triesLeft--
        let homeNodeShardData = queueEntry.homeNodes[key] // mark outstanding request somehow so we dont rerequest

        let node = consensusGroup[nodeIndex]
        nodeIndex++

        if (node == null) {
          continue
        }
        if (node.status != 'active' || potentiallyRemoved.has(node.id)) {
          continue
        }
        if (node === this.stateManager.currentCycleShardData.ourNode) {
          continue
        }

        let relationString = ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
        if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_ask', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)

        // Node Precheck!
        if (this.stateManager.isNodeValidForInternalMessage(node.id, 'queueEntryRequestMissingReceipt', true, true) === false) {
          // if(this.tryNextDataSourceNode('queueEntryRequestMissingReceipt') == false){
          //   break
          // }
          continue
        }

        let message = { txid: queueEntry.acceptedTx.txId, timestamp: queueEntry.acceptedTx.timestamp }
        let result: RequestReceiptForTxResp_old = await this.p2p.ask(node, 'request_receipt_for_tx_old', message) // not sure if we should await this.

        if (result == null) {
          if (logFlags.verbose) {
            if (logFlags.error) this.mainLogger.error(`ASK FAIL request_receipt_for_tx_old ${triesLeft} ${utils.makeShortHash(node.id)}`)
          }
          if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_askfailretry', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
          continue
        }
        if (result.success !== true) {
          if (logFlags.error) this.mainLogger.error(`ASK FAIL queueEntryRequestMissingReceipt 9 ${triesLeft} ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)} note:${result.note} txid:${queueEntry.logID}`)
          continue
        }

        if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_result', `${utils.makeShortHash(queueEntry.acceptedTx.txId)}`, `r:${relationString}   result:${queueEntry.logstate} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} result: ${utils.stringifyReduce(result)}`)

        if (result.success === true && result.receipt != null) {
          //TODO implement this!!!
          queueEntry.recievedAppliedReceipt = result.receipt
          keepTrying = false
          gotReceipt = true

          this.mainLogger.debug(`queueEntryRequestMissingReceipt got good receipt for: ${utils.makeShortHash(queueEntry.acceptedTx.txId)} from: ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)}`)
        }
      }

      // break the outer loop after we are done trying.  todo refactor this.
      if (keepTrying == false) {
        break
      }
    }
    queueEntry.requestingReceipt = false

    if (gotReceipt === false) {
      queueEntry.requestingReceiptFailed = true
    }
  }


  /**
   * queueEntryGetTransactionGroup
   * @param {QueueEntry} queueEntry
   * @returns {Node[]}
   */
  queueEntryGetTransactionGroup(queueEntry: QueueEntry, tryUpdate: boolean = false): Shardus.Node[] {
    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('queueEntryGetTransactionGroup: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('queueEntryGetTransactionGroup: queueEntry.uniqueKeys == null')
    }
    if (queueEntry.transactionGroup != null && tryUpdate != true) {
      return queueEntry.transactionGroup
    }

    if (tryUpdate) {
      if (queueEntry.cycleToRecordOn === this.stateManager.currentCycleShardData.cycleNumber) {
      }
    }

    let txGroup: Shardus.Node[] = []
    let uniqueNodes: StringNodeObjectMap = {}

    let hasNonGlobalKeys = false
    for (let key of queueEntry.uniqueKeys) {
      let homeNode = queueEntry.homeNodes[key]
      // txGroup = Array.concat(txGroup, homeNode.nodeThatStoreOurParitionFull)
      if (homeNode == null) {
        if (logFlags.verbose) this.mainLogger.debug('queueEntryGetTransactionGroup homenode:null')
      }
      if (homeNode.extendedData === false) {
        ShardFunctions.computeExtendedNodePartitionData(this.stateManager.currentCycleShardData.shardGlobals, this.stateManager.currentCycleShardData.nodeShardDataMap, this.stateManager.currentCycleShardData.parititionShardDataMap, homeNode, this.stateManager.currentCycleShardData.activeNodes)
      }

      //may need to go back and sync this logic with how we decide what partition to save a record in.

      // If this is not a global TX then skip tracking of nodes for global accounts used as a reference.
      if (queueEntry.globalModification === false) {
        if (this.stateManager.accountGlobals.isGlobalAccount(key) === true) {
          if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup skipping: ${utils.makeShortHash(key)} tx: ${utils.makeShortHash(queueEntry.acceptedTx.txId)}`)
          continue
        } else {
          hasNonGlobalKeys = true
        }
      }

      for (let node of homeNode.nodeThatStoreOurParitionFull) {
        // not iterable!
        uniqueNodes[node.id] = node
      }

      let scratch1 = {}
      for (let node of homeNode.nodeThatStoreOurParitionFull) {
        // not iterable!
        scratch1[node.id] = true
      }
      // make sure the home node is in there in case we hit and edge case
      uniqueNodes[homeNode.node.id] = homeNode.node




      // TODO STATESHARDING4 is this next block even needed:
      // HOMENODEMATHS need to patch in nodes that would cover this partition!
      // TODO PERF make an optimized version of this in ShardFunctions that is smarter about which node range to check and saves off the calculation
      // TODO PERF Update.  this will scale badly with 100s or 1000s of nodes. need a faster solution that can use the list of accounts to
      //                    build a list of nodes.
      // maybe this could go on the partitions.
      let { homePartition } = ShardFunctions.addressToPartition(this.stateManager.currentCycleShardData.shardGlobals, key)
      if (homePartition != homeNode.homePartition) {
        //loop all nodes for now
        for (let nodeID of this.stateManager.currentCycleShardData.nodeShardDataMap.keys()) {
          let nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(nodeID)
          let nodeStoresThisPartition = ShardFunctions.testInRange(homePartition, nodeShardData.storedPartitions)
          if (nodeStoresThisPartition === true && uniqueNodes[nodeID] == null) {
            //setting this will cause it to end up in the transactionGroup
            uniqueNodes[nodeID] = nodeShardData.node
            queueEntry.patchedOnNodes.set(nodeID, nodeShardData)
          }
          // build index for patched nodes based on the home node:
          if (nodeStoresThisPartition === true) {
            if (scratch1[nodeID] == null) {
              homeNode.patchedOnNodes.push(nodeShardData.node)
              scratch1[nodeID] = true
            }
          }
        }
      }

      if(queueEntry.globalModification === false && this.executeInOneShard && key === queueEntry.executionShardKey){
        //queueEntry.executionGroup = homeNode.consensusNodeForOurNodeFull.slice()
        let executionKeys = []
        if (logFlags.verbose) {
          for(let node of queueEntry.executionGroup){
            executionKeys.push(utils.makeShortHash(node.id) + `:${node.externalPort}`)
          }
        }
        if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup executeInOneShard ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} executionKeys:${JSON.stringify(executionKeys)}`)
        if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('queueEntryGetTransactionGroup', `queueEntryGetTransactionGroup executeInOneShard ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} executionKeys:${JSON.stringify(executionKeys)}`)
      }


      // if(queueEntry.globalModification === false && this.executeInOneShard && key === queueEntry.executionShardKey){
      //   let ourNodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData = this.stateManager.currentCycleShardData.nodeShardData
      //   let nodeStoresThisPartition = ShardFunctions.testInRange(homePartition, ourNodeShardData.storedPartitions)
      //   if(nodeStoresThisPartition === false){
      //     queueEntry.isInExecutionHome = false
      //     queueEntry.waitForReceiptOnly = true
      //   }
      //   if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} waitForReceiptOnly:${queueEntry.waitForReceiptOnly}`)
      //   if (logFlags.playback) this.logger.playbackLogNote('queueEntryGetTransactionGroup', `queueEntryGetTransactionGroup ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} waitForReceiptOnly:${queueEntry.waitForReceiptOnly}`)
      // }
    }
    queueEntry.ourNodeInTransactionGroup = true
    if (uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInTransactionGroup = false
      if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${utils.makeShortHash(queueEntry.acceptedTx.txId)}`)
    }

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    // This may seem confusing, but to gossip to other nodes, we have to have our node in the list we will gossip to
    // Other logic will use queueEntry.ourNodeInTransactionGroup to know what else to do with the queue entry
    uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] = this.stateManager.currentCycleShardData.ourNode

    let values = Object.values(uniqueNodes)
    for (let v of values) {
      txGroup.push(v)
    }

    txGroup.sort(this.stateManager._sortByIdAsc)
    if (queueEntry.ourNodeInTransactionGroup) {
      let ourID = this.stateManager.currentCycleShardData.ourNode.id
      for (let idx = 0; idx < txGroup.length; idx++) {
        let node = txGroup[idx]
        if (node.id === ourID) {
          queueEntry.ourTXGroupIndex = idx
          break
        }
      }
    }
    if (tryUpdate != true) {
      queueEntry.txGroupCycle = this.stateManager.currentCycleShardData.cycleNumber
      queueEntry.transactionGroup = txGroup
    } else {
      queueEntry.updatedTxGroupCycle = this.stateManager.currentCycleShardData.cycleNumber
      queueEntry.transactionGroup = txGroup
    }

    // let uniqueNodes = {}
    // for (let n of gossipGroup) {
    //   uniqueNodes[n.id] = n
    // }
    // for (let n of updatedGroup) {
    //   uniqueNodes[n.id] = n
    // }
    // let values = Object.values(uniqueNodes)
    // let finalGossipGroup =
    // for (let n of updatedGroup) {
    //   uniqueNodes[n.id] = n
    // }

    return txGroup
  }

  /**
   * queueEntryGetConsensusGroup
   * Gets a merged results of all the consensus nodes for all of the accounts involved in the transaction
   * Ignores global accounts if globalModification == false and the account is global
   * @param {QueueEntry} queueEntry
   * @returns {Node[]}
   */
  queueEntryGetConsensusGroup(queueEntry: QueueEntry): Shardus.Node[] {
    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('queueEntryGetConsensusGroup: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('queueEntryGetConsensusGroup: queueEntry.uniqueKeys == null')
    }
    if (queueEntry.conensusGroup != null) {
      return queueEntry.conensusGroup
    }
    let txGroup = []
    let uniqueNodes: StringNodeObjectMap = {}

    let hasNonGlobalKeys = false
    for (let key of queueEntry.uniqueKeys) {
      let homeNode = queueEntry.homeNodes[key]
      if (homeNode == null) {
        if (logFlags.verbose) this.mainLogger.debug('queueEntryGetConsensusGroup homenode:null')
      }
      if (homeNode.extendedData === false) {
        ShardFunctions.computeExtendedNodePartitionData(this.stateManager.currentCycleShardData.shardGlobals, this.stateManager.currentCycleShardData.nodeShardDataMap, this.stateManager.currentCycleShardData.parititionShardDataMap, homeNode, this.stateManager.currentCycleShardData.activeNodes)
      }

      // TODO STATESHARDING4 GLOBALACCOUNTS is this next block of logic needed?
      // If this is not a global TX then skip tracking of nodes for global accounts used as a reference.
      if (queueEntry.globalModification === false) {
        if (this.stateManager.accountGlobals.isGlobalAccount(key) === true) {
          if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetConsensusGroup skipping: ${utils.makeShortHash(key)} tx: ${utils.makeShortHash(queueEntry.acceptedTx.txId)}`)
          continue
        } else {
          hasNonGlobalKeys = true
        }
      }

      for (let node of homeNode.consensusNodeForOurNodeFull) {
        uniqueNodes[node.id] = node
      }

      // make sure the home node is in there in case we hit and edge case
      uniqueNodes[homeNode.node.id] = homeNode.node
    }
    queueEntry.ourNodeInConsensusGroup = true
    if (uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInConsensusGroup = false
      if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetConsensusGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${utils.makeShortHash(queueEntry.acceptedTx.txId)}`)
    }

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] = this.stateManager.currentCycleShardData.ourNode

    let values = Object.values(uniqueNodes)
    for (let v of values) {
      txGroup.push(v)
    }
    queueEntry.conensusGroup = txGroup
    return txGroup
  }

  /**
   * tellCorrespondingNodes
   * @param queueEntry
   * -sends account data to the correct involved nodees
   * -loads locally available data into the queue entry
   */
  async tellCorrespondingNodes(queueEntry: QueueEntry) {
    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('tellCorrespondingNodes: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('tellCorrespondingNodes: queueEntry.uniqueKeys == null')
    }
    // Report data to corresponding nodes
    let ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
    // let correspondingEdgeNodes = []
    let correspondingAccNodes: Shardus.Node[] = []
    let dataKeysWeHave = []
    let dataValuesWeHave = []
    let datas: { [accountID: string]: Shardus.WrappedResponse } = {}
    let remoteShardsByKey: { [accountID: string]: StateManagerTypes.shardFunctionTypes.NodeShardData } = {} // shard homenodes that we do not have the data for.
    let loggedPartition = false
    for (let key of queueEntry.uniqueKeys) {
      ///   test here
      // let hasKey = ShardFunctions.testAddressInRange(key, ourNodeData.storedPartitions)
      // todo : if this works maybe a nicer or faster version could be used
      let hasKey = false
      let homeNode = queueEntry.homeNodes[key]
      if (homeNode.node.id === ourNodeData.node.id) {
        hasKey = true
      } else {

        //perf todo: this seems like a slow calculation, coult improve this
        for (let node of homeNode.nodeThatStoreOurParitionFull) {
          if (node.id === ourNodeData.node.id) {
            hasKey = true
            break
          }
        }
      }

      // HOMENODEMATHS tellCorrespondingNodes patch the value of hasKey
      // did we get patched in
      if (queueEntry.patchedOnNodes.has(ourNodeData.node.id)) {
        hasKey = true
      }

      // for(let patchedNodeID of queueEntry.patchedOnNodes.values()){
      // }

      let isGlobalKey = false
      //intercept that we have this data rather than requesting it.
      if (this.stateManager.accountGlobals.isGlobalAccount(key)) {
        hasKey = true
        isGlobalKey = true
        if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', queueEntry.logID, `tellCorrespondingNodes - has`)
      }

      if (hasKey === false) {
        if (loggedPartition === false) {
          loggedPartition = true
          if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull.map((v) => v.id))}`)
          if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: full: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull)}`)
        }
        if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false  key: ${utils.stringifyReduce(key)}`)
      }

      if (hasKey) {
        // TODO PERF is it possible that this query could be used to update our in memory cache? (this would save us from some slow look ups) later on
        //    when checking timestamps.. alternatively maybe there is a away we can note the timestamp with what is returned here in the queueEntry data
        //    and not have to deal with the cache.
        // todo old: Detect if our node covers this paritition..  need our partition data

        this.profiler.profileSectionStart('process_dapp.getRelevantData')
        this.profiler.scopedProfileSectionStart('process_dapp.getRelevantData')
        let data = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
        this.profiler.scopedProfileSectionEnd('process_dapp.getRelevantData')
        this.profiler.profileSectionEnd('process_dapp.getRelevantData')

        //only queue this up to share if it is not a global account. global accounts dont need to be shared.

        // not sure if it is correct to update timestamp like this.
        // if(data.timestamp === 0){
        //   data.timestamp = queueEntry.acceptedTx.timestamp
        // }

        //if this is not freshly created data then we need to make a backup copy of it!!
        //This prevents us from changing data before the commiting phase
        if (data.accountCreated == false) {
          data = utils.deepCopy(data)
        }

        if (isGlobalKey === false) {
          datas[key] = data
          dataKeysWeHave.push(key)
          dataValuesWeHave.push(data)
        }

        queueEntry.localKeys[key] = true
        // add this data to our own queue entry!!
        this.queueEntryAddData(queueEntry, data)
      } else {
        remoteShardsByKey[key] = queueEntry.homeNodes[key]
      }
    }
    if (queueEntry.globalModification === true) {
      if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes - globalModification = true, not telling other nodes`)
      return
    }

    // if we are in the execution shard no need to forward data
    // This is because other nodes will not expect pre-apply data anymore (but they will send us their pre apply data)
    if(queueEntry.globalModification === false && this.executeInOneShard && queueEntry.isInExecutionHome === true){
      //will this break things..
      if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes - isInExecutionHome = true, not telling other nodes`)
      return
    }

    let message
    let edgeNodeIds = []
    let consensusNodeIds = []

    let nodesToSendTo: StringNodeObjectMap = {}
    let doOnceNodeAccPair = new Set<string>() //can skip  node+acc if it happens more than once.

    for (let key of queueEntry.uniqueKeys) {
      if (datas[key] != null) {
        for (let key2 of queueEntry.uniqueKeys) {
          if (key !== key2) {
            let localHomeNode = queueEntry.homeNodes[key]
            let remoteHomeNode = queueEntry.homeNodes[key2]

            // //can ignore nodes not in the execution group since they will not be running apply
            // if(this.executeInOneShard && (queueEntry.executionIdSet.has(remoteHomeNode.node.id) === false)){
            //   continue
            // }

            let ourLocalConsensusIndex = localHomeNode.consensusNodeForOurNodeFull.findIndex((a) => a.id === ourNodeData.node.id)
            if (ourLocalConsensusIndex === -1) {
              continue
            }

            edgeNodeIds = []
            consensusNodeIds = []
            correspondingAccNodes = []

            // must add one to each lookup index!
            let indicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.consensusNodeForOurNodeFull.length, ourLocalConsensusIndex + 1)
            let edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.edgeNodes.length, ourLocalConsensusIndex + 1)

            let patchIndicies = []
            if (remoteHomeNode.patchedOnNodes.length > 0) {
              patchIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.patchedOnNodes.length, ourLocalConsensusIndex + 1)
            }

            // HOMENODEMATHS need to work out sending data to our patched range.
            // let edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.edgeNodes.length, ourLocalConsensusIndex + 1)

            // for each remote node lets save it's id
            for (let index of indicies) {
              let node = remoteHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node != null && node.id !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                consensusNodeIds.push(node.id)
              }
            }
            for (let index of edgeIndicies) {
              let node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node != null && node.id !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                edgeNodeIds.push(node.id)
              }
            }

            for (let index of patchIndicies) {
              let node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node != null && node.id !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                //edgeNodeIds.push(node.id)
              }
            }

            let dataToSend = []
            dataToSend.push(datas[key]) // only sending just this one key at a time
            message = { stateList: dataToSend, txid: queueEntry.acceptedTx.txId }

            //correspondingAccNodes = Object.values(nodesToSendTo)

            //build correspondingAccNodes, but filter out nodeid, account key pairs we have seen before
            for(let [accountID, node] of Object.entries(nodesToSendTo)){
              let keyPair = accountID + key
              if(node != null && doOnceNodeAccPair.has(keyPair) === false){
                doOnceNodeAccPair.add(keyPair)

                // consider this optimization later (should make it so we only send to execution set nodes)
                // if(queueEntry.executionIdSet.has(remoteHomeNode.node.id) === true){
                //   correspondingAccNodes.push(node)
                // }
                correspondingAccNodes.push(node)
              }
            }

            if (correspondingAccNodes.length > 0) {
              let remoteRelation = ShardFunctions.getNodeRelation(remoteHomeNode, this.stateManager.currentCycleShardData.ourNode.id)
              let localRelation = ShardFunctions.getNodeRelation(localHomeNode, this.stateManager.currentCycleShardData.ourNode.id)
              if (logFlags.playback) this.logger.playbackLogNote('shrd_tellCorrespondingNodes', `${queueEntry.acceptedTx.txId}`, `remoteRel: ${remoteRelation} localrel: ${localRelation} qId: ${queueEntry.entryID} AccountBeingShared: ${utils.makeShortHash(key)} EdgeNodes:${utils.stringifyReduce(edgeNodeIds)} ConsesusNodes${utils.stringifyReduce(consensusNodeIds)}`)

              // Filter nodes before we send tell()
              let filteredNodes = this.stateManager.filterValidNodesForInternalMessage(correspondingAccNodes, 'tellCorrespondingNodes', true, true)
              if (filteredNodes.length === 0) {
                if (logFlags.error) this.mainLogger.error('tellCorrespondingNodes: filterValidNodesForInternalMessage no valid nodes left to try')
                return null
              }
              let filterdCorrespondingAccNodes = filteredNodes

              // TODO Perf: need a tellMany enhancement.  that will minimize signing and stringify required!
              this.p2p.tell(filterdCorrespondingAccNodes, 'broadcast_state', message)
            }
          }
        }
      }
    }
  }

  /**
   * After a reciept is formed, use this to send updated account data to shards that did not execute a change
   * @param queueEntry
   * @returns
   */
  async tellCorrespondingNodesFinalData(queueEntry: QueueEntry) {

    if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodesFinalData', queueEntry.logID, `tellCorrespondingNodesFinalData - start: ${queueEntry.logID}`)

    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('tellCorrespondingNodesFinalData: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('tellCorrespondingNodesFinalData: queueEntry.uniqueKeys == null')
    }
    if(queueEntry.globalModification === true){
      throw new Error('tellCorrespondingNodesFinalData globalModification === true')
    }

    if(this.executeInOneShard && queueEntry.isInExecutionHome === false){
      throw new Error('tellCorrespondingNodesFinalData isInExecutionHome === false')
    }
    if(queueEntry.executionShardKey == null || queueEntry.executionShardKey == ''){
      throw new Error('tellCorrespondingNodesFinalData executionShardKey == null or empty')
    }
    if(queueEntry.preApplyTXResult == null){
      throw new Error('tellCorrespondingNodesFinalData preApplyTXResult == null')
    }

    // Report data to corresponding nodes
    let ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
    let correspondingAccNodes: Shardus.Node[] = []
    let datas: { [accountID: string]: Shardus.WrappedResponse } = {}

    let applyResponse = queueEntry.preApplyTXResult.applyResponse
    let wrappedStates = queueEntry.collectedData
    let writtenAccountsMap:WrappedResponses = {}
    if(applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0){
      for (let writtenAccount of applyResponse.accountWrites) {
        writtenAccountsMap[writtenAccount.accountId] = writtenAccount.data
        writtenAccountsMap[writtenAccount.accountId].prevStateId = wrappedStates[writtenAccount.accountId] ? wrappedStates[writtenAccount.accountId].stateId : ''
        writtenAccountsMap[writtenAccount.accountId].prevDataCopy = wrappedStates[writtenAccount.accountId] ? utils.deepCopy(writtenAccount.data) : {}

        datas[writtenAccount.accountId] = writtenAccount.data
      }
      //override wrapped states with writtenAccountsMap which should be more complete if it included
      wrappedStates = writtenAccountsMap
    }
    let keysToShare = Object.keys(wrappedStates)

    let message
    let edgeNodeIds = []
    let consensusNodeIds = []

    let localHomeNode = queueEntry.homeNodes[queueEntry.executionShardKey]

    let nodesToSendTo: StringNodeObjectMap = {}
    let doOnceNodeAccPair = new Set<string>() //can skip  node+acc if it happens more than once.

    //let uniqueAccountsShared = 0
    let totalShares = 0
    for (let key of keysToShare) {
      if (wrappedStates[key] != null) {

        for (let key2 of queueEntry.uniqueKeys) {
          if (key !== key2) {
            //let localHomeNode = queueEntry.homeNodes[key]
            let remoteHomeNode = queueEntry.homeNodes[key2]

            //if (key !== queueEntry.executionShardKey) {
              //let remoteHomeNode = ShardFunctions.findHomeNode(this.stateManager.currentCycleShardData.shardGlobals, key, this.stateManager.currentCycleShardData.parititionShardDataMap)
              //let remoteHomeNode = ShardFunctions.findHomeNode(this.stateManager.currentCycleShardData.shardGlobals, key2, this.stateManager.currentCycleShardData.parititionShardDataMap)

              edgeNodeIds = []
              consensusNodeIds = []
              correspondingAccNodes = []

              let ourLocalConsensusIndex = localHomeNode.consensusNodeForOurNodeFull.findIndex((a) => a.id === ourNodeData.node.id)
              if (ourLocalConsensusIndex === -1) {
                continue
              }

              // must add one to each lookup index!
              let indicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.consensusNodeForOurNodeFull.length, ourLocalConsensusIndex + 1)
              let edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.edgeNodes.length, ourLocalConsensusIndex + 1)

              let patchIndicies = []
              if (remoteHomeNode.patchedOnNodes.length > 0) {
                patchIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.patchedOnNodes.length, ourLocalConsensusIndex + 1)
              }

              // for each remote node lets save it's id
              for (let index of indicies) {
                let node = remoteHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
                if (node != null && node.id !== ourNodeData.node.id) {
                  nodesToSendTo[node.id] = node
                  consensusNodeIds.push(node.id)
                }
              }
              for (let index of edgeIndicies) {
                let node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
                if (node != null && node.id !== ourNodeData.node.id) {
                  nodesToSendTo[node.id] = node
                  edgeNodeIds.push(node.id)
                }
              }

              for (let index of patchIndicies) {
                let node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
                if (node != null && node.id !== ourNodeData.node.id) {
                  nodesToSendTo[node.id] = node
                  //edgeNodeIds.push(node.id)
                }
              }

              //correspondingAccNodes = Object.values(nodesToSendTo)

              for(let [accountID, node] of Object.entries(nodesToSendTo)){
                let keyPair = accountID + key
                if(node != null && doOnceNodeAccPair.has(keyPair) === false){
                  doOnceNodeAccPair.add(keyPair)
                  correspondingAccNodes.push(node)
                }
              }

              //how can we be making so many calls??
              if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodesFinalData', queueEntry.logID, `tellCorrespondingNodesFinalData nodesToSendTo:${Object.keys(nodesToSendTo).length} doOnceNodeAccPair:${doOnceNodeAccPair.size} indicies:${JSON.stringify(indicies)} edgeIndicies:${JSON.stringify(edgeIndicies)} patchIndicies:${JSON.stringify(patchIndicies)}  doOnceNodeAccPair: ${JSON.stringify([...doOnceNodeAccPair.keys()])} `)

              let dataToSend:Shardus.WrappedResponse[] = []
              dataToSend.push(datas[key]) // only sending just this one key at a time
              message = { stateList: dataToSend, txid: queueEntry.acceptedTx.txId }
              if (correspondingAccNodes.length > 0) {
                let remoteRelation = ShardFunctions.getNodeRelation(remoteHomeNode, this.stateManager.currentCycleShardData.ourNode.id)
                let localRelation = ShardFunctions.getNodeRelation(localHomeNode, this.stateManager.currentCycleShardData.ourNode.id)
                if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodesFinalData', queueEntry.logID, `remoteRel: ${remoteRelation} localrel: ${localRelation} qId: ${queueEntry.entryID} AccountBeingShared: ${utils.makeShortHash(key)} EdgeNodes:${utils.stringifyReduce(edgeNodeIds)} ConsesusNodes${utils.stringifyReduce(consensusNodeIds)}`)

                // Filter nodes before we send tell()
                let filteredNodes = this.stateManager.filterValidNodesForInternalMessage(correspondingAccNodes, 'tellCorrespondingNodesFinalData', true, true)
                if (filteredNodes.length === 0) {
                  if (logFlags.error) this.mainLogger.error('tellCorrespondingNodesFinalData: filterValidNodesForInternalMessage no valid nodes left to try')
                  //return null
                  continue
                }
                let filterdCorrespondingAccNodes = filteredNodes
                this.p2p.tell(filterdCorrespondingAccNodes, 'broadcast_finalstate', message)
                totalShares++
              }
            //}
          }
        }
      }
    }


    if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodesFinalData - end: ${queueEntry.logID} totalShares:${totalShares}`)

  }

  dumpTxDebugToStatList(queueEntry: QueueEntry): void {
    this.txDebugStatList.push({ ...queueEntry.txDebug })
  }

  clearTxDebugStatList(): void {
    this.txDebugStatList = []
  }

  printTxDebug() {
    const collector = {}
    const totalTxCount = this.txDebugStatList.length

    for (const txStat of this.txDebugStatList) {
      for (const key in txStat.duration) {
        if (!collector[key]) {
          collector[key] = {}
          for (const bucket of txStatBucketSize.default) {
            collector[key][bucket] = []
          }
        }
        const duration = txStat.duration[key]
        for (const bucket of txStatBucketSize.default) {
          if (duration < bucket) {
            collector[key][bucket].push(duration)
            break
          }
        }
      }
    }
    const lines = []
    lines.push(`=> Total Transactions: ${totalTxCount}`)
    for (const key in collector) {
      lines.push(`\n => Tx ${key}: \n`)
      const collectorForThisKey = collector[key]
      for (let i = 0; i < Object.keys(collectorForThisKey).length; i++) {
        const time = Object.keys(collectorForThisKey)[i]
        const arr = collectorForThisKey[time]
        if (!arr) continue
        const percentage = (arr.length / totalTxCount) * 100
        const blockCount = Math.round(percentage / 2)
        const blockStr = '|'.repeat(blockCount)
        const lowerLimit = i === 0 ? 0 : Object.keys(collectorForThisKey)[i - 1]
        const upperLimit = time
        const bucketDescription = `${lowerLimit} ms - ${upperLimit} ms:`.padEnd(19, ' ')
        lines.push(`${bucketDescription}  ${arr.length} ${percentage.toFixed(1).padEnd(5, ' ')}%  ${blockStr} `)
      }
    }

    const strToPrint = lines.join('\n')
    return strToPrint
  }

  /**
   * removeFromQueue remove an item from the queue and place it in the archivedQueueEntries list for awhile in case we have to access it again
   * @param {QueueEntry} queueEntry
   * @param {number} currentIndex
   */
  removeFromQueue(queueEntry: QueueEntry, currentIndex: number) {
    queueEntry.txDebug.dequeueHrTime = process.hrtime(queueEntry.txDebug.enqueueHrTime)
    queueEntry.txDebug.duration['queue_sit_time'] = queueEntry.txDebug.dequeueHrTime[1] / 1000000
    this.stateManager.eventEmitter.emit('txPopped', queueEntry.acceptedTx.txId)
    if (queueEntry.txDebug) this.dumpTxDebugToStatList(queueEntry)
    this.newAcceptedTxQueue.splice(currentIndex, 1)
    this.newAcceptedTxQueueByID.delete(queueEntry.acceptedTx.txId)

    queueEntry.archived = true
    //compact the queue entry before we push it!
    queueEntry.ourVote = null
    queueEntry.collectedVotes = null

    // coalesce the receipts into applied receipt. maybe not as descriptive, but save memory.
    queueEntry.appliedReceipt = queueEntry.appliedReceipt ?? queueEntry.recievedAppliedReceipt ?? queueEntry.appliedReceiptForRepair ?? queueEntry.appliedReceiptFinal
    queueEntry.recievedAppliedReceipt = null
    queueEntry.appliedReceiptForRepair = null
    queueEntry.appliedReceiptFinal = queueEntry.appliedReceipt

    delete queueEntry.recievedAppliedReceipt
    delete queueEntry.appliedReceiptForRepair

    // coalesce the receipt2s into applied receipt. maybe not as descriptive, but save memory.
    this.stateManager.getReceipt2(queueEntry)
    queueEntry.recievedAppliedReceipt2 = null
    queueEntry.appliedReceiptForRepair2 = null

    delete queueEntry.recievedAppliedReceipt2
    delete queueEntry.appliedReceiptForRepair2

    //delete queueEntry.appliedReceiptFinal

    //delete queueEntry.preApplyTXResult //turn this off for now, until we can do some refactor of queueEntry.preApplyTXResult.applyResponse

    this.archivedQueueEntries.push(queueEntry)

    this.archivedQueueEntriesByID.set(queueEntry.acceptedTx.txId, queueEntry)
    // period cleanup will usually get rid of these sooner if the list fills up
    if (this.archivedQueueEntries.length > this.archivedQueueEntryMaxCount) {
      this.archivedQueueEntriesByID.delete(this.archivedQueueEntries[0].acceptedTx.txId)
      this.archivedQueueEntries.shift()
    }
  }

  setState(queueEntry: QueueEntry, newState: string) {
  }

  setHigherState(queueEntry: QueueEntry, newState: string) {
  }

  /***
   *    ########  ########   #######   ######  ########  ######   ######
   *    ##     ## ##     ## ##     ## ##    ## ##       ##    ## ##    ##
   *    ##     ## ##     ## ##     ## ##       ##       ##       ##
   *    ########  ########  ##     ## ##       ######    ######   ######
   *    ##        ##   ##   ##     ## ##       ##             ##       ##
   *    ##        ##    ##  ##     ## ##    ## ##       ##    ## ##    ##
   *    ##        ##     ##  #######   ######  ########  ######   ######
   */
  async processAcceptedTxQueue(firstTime: boolean = false) {
    let seenAccounts: SeenAccounts
    seenAccounts = {}
    let pushedProfilerTag = null
    let startTime = Date.now()
    try {
      if (this.newAcceptedTxQueueRunning === true) {
        return
      }
      this.newAcceptedTxQueueRunning = true

      // ensure there is some rest between processing loops
      let timeSinceLastRun = startTime - this.processingLastRunTime
      if (timeSinceLastRun < this.processingMinRunBreak) {
        let sleepTime = Math.max(5, this.processingMinRunBreak - timeSinceLastRun)
        await utils.sleep(sleepTime)
        nestedCountersInstance.countEvent('processing', 'resting')
      }

      if (this.processingLeftBusy && timeSinceLastRun > 500) {
        this.statemanager_fatal(`processAcceptedTxQueue left busy and waited too long to restart`, `processAcceptedTxQueue left busy and waited too long to restart ${timeSinceLastRun / 1000} `)
      }

      this.profiler.profileSectionStart('processQ')

      if (this.stateManager.currentCycleShardData == null) {
        return
      }

      if (this.newAcceptedTxQueue.length === 0 && this.newAcceptedTxQueueTempInjest.length === 0) {
        return
      }

      if (this.queueRestartCounter == null) {
        this.queueRestartCounter = 0
      }
      this.queueRestartCounter++

      let localRestartCounter = this.queueRestartCounter

      let timeM = this.stateManager.queueSitTime
      let timeM2 = timeM * 2
      let timeM2_5 = timeM * 2.5
      let timeM3 = timeM * 3
      let currentTime = Date.now()

      let app = this.app

      // process any new queue entries that were added to the temporary list
      if (this.newAcceptedTxQueueTempInjest.length > 0) {
        for (let txQueueEntry of this.newAcceptedTxQueueTempInjest) {
          if (this.txWillChangeLocalData(txQueueEntry) === true) {
            nestedCountersInstance.countEvent('stateManager', 'processAcceptedTxQueue injest: kept TX')
          } else {
            nestedCountersInstance.countEvent('stateManager', 'processAcceptedTxQueue injest: discard TX')
            continue
          }

          let timestamp = txQueueEntry.txKeys.timestamp
          let acceptedTx = txQueueEntry.acceptedTx
          let txId = acceptedTx.txId
          // Find the time sorted spot in our queue to insert this TX into
          // reverse loop because the news (largest timestamp) values are at the end of the array
          // todo faster version (binary search? to find where we need to insert)
          let index = this.newAcceptedTxQueue.length - 1
          let lastTx = this.newAcceptedTxQueue[index]
          while (index >= 0 && (timestamp > lastTx.txKeys.timestamp || (timestamp === lastTx.txKeys.timestamp && txId < lastTx.acceptedTx.txId))) {
            index--
            lastTx = this.newAcceptedTxQueue[index]
          }

          let age = Date.now() - timestamp
          if (age > timeM * 0.9) {
            // IT turns out the correct thing to check is didSync flag only report errors if we did not wait on this TX while syncing
            if (txQueueEntry.didSync == false) {
              this.statemanager_fatal(`processAcceptedTxQueue_oldTX.9 fromClient:${txQueueEntry.fromClient}`, `processAcceptedTxQueue cannot accept tx older than 0.9M ${timestamp} age: ${age} fromClient:${txQueueEntry.fromClient}`)
              if (logFlags.playback) this.logger.playbackLogNote('shrd_processAcceptedTxQueueTooOld1', `${utils.makeShortHash(txQueueEntry.acceptedTx.txId)}`, 'processAcceptedTxQueue working on older tx ' + timestamp + ' age: ' + age)
              //txQueueEntry.waitForReceiptOnly = true
            }
          }
          if (age > timeM) {
            if (logFlags.playback) this.logger.playbackLogNote('shrd_processAcceptedTxQueueTooOld2', `${utils.makeShortHash(txQueueEntry.acceptedTx.txId)}`, 'processAcceptedTxQueue working on older tx ' + timestamp + ' age: ' + age)
            txQueueEntry.waitForReceiptOnly = true
            txQueueEntry.state = 'consensing'
          }

          txQueueEntry.approximateCycleAge = this.stateManager.currentCycleShardData.cycleNumber
          //insert this tx into the main queue
          this.newAcceptedTxQueue.splice(index + 1, 0, txQueueEntry)
          this.newAcceptedTxQueueByID.set(txQueueEntry.acceptedTx.txId, txQueueEntry)

          if (logFlags.playback) this.logger.playbackLogNote('shrd_addToQueue', `${txId}`, `AcceptedTransaction: ${txQueueEntry.logID} ts: ${txQueueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(txQueueEntry.txKeys.allKeys)} indexInserted: ${index + 1}`)
          this.stateManager.eventEmitter.emit('txQueued', acceptedTx.txId)
        }
        this.newAcceptedTxQueueTempInjest = []
        this.newAcceptedTxQueueTempInjestByID.clear()
      }

      let currentIndex = this.newAcceptedTxQueue.length - 1

      let lastLog = 0
      currentIndex++ //increment once so we can handle the decrement at the top of the loop and be safe about continue statements

      let lastRest = Date.now()
      while (this.newAcceptedTxQueue.length > 0) {
        // update current time with each pass through the loop
        currentTime = Date.now()

        if (currentTime - lastRest > 1000) {
          //add a brief sleep if we have been in this loop for a long time
          nestedCountersInstance.countEvent('processing', 'forcedSleep')
          await utils.sleep(5) //5ms sleep
          lastRest = currentTime

          if (currentTime - this.stateManager.currentCycleShardData.calculationTime > this.config.p2p.cycleDuration * 1000 + 5000) {
            nestedCountersInstance.countEvent('processing', 'old cycle data >5s past due')
          }
          if (currentTime - this.stateManager.currentCycleShardData.calculationTime > this.config.p2p.cycleDuration * 1000 + 11000) {
            nestedCountersInstance.countEvent('processing', 'very old cycle data >11s past due')
            return //loop will restart.
          }
        }

        //Handle an odd case where the finally did not catch exiting scope.
        if (pushedProfilerTag != null) {
          this.profiler.profileSectionEnd(`process-${pushedProfilerTag}`)
          this.profiler.profileSectionEnd(`process-patched1-${pushedProfilerTag}`)
          pushedProfilerTag = null
        }

        currentIndex--
        if (currentIndex < 0) {
          break
        }
        let queueEntry: QueueEntry = this.newAcceptedTxQueue[currentIndex]
        let txTime = queueEntry.txKeys.timestamp
        let txAge = currentTime - txTime
        // current queue entry is younger than timeM, so nothing to do yet.
        if (txAge < timeM) {
          break
        }

        if (localRestartCounter < this.queueRestartCounter && lastLog !== this.queueRestartCounter) {
          lastLog = this.queueRestartCounter
          if (logFlags.playback) this.logger.playbackLogNote('queueRestart_error', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter}  qrstGlobal:${this.queueRestartCounter}}`)
        }

        this.stateManager.debugTXHistory[queueEntry.logID] = queueEntry.state
        let hasApplyReceipt = queueEntry.appliedReceipt != null
        let hasReceivedApplyReceipt = queueEntry.recievedAppliedReceipt != null
        let hasReceivedApplyReceiptForRepair = queueEntry.appliedReceiptForRepair != null
        let shortID = queueEntry.logID //`${utils.makeShortHash(queueEntry.acceptedTx.id)}`

        if(this.config.debug.optimizedTXConsenus){
          hasApplyReceipt = queueEntry.appliedReceipt2 != null
          hasReceivedApplyReceipt = queueEntry.recievedAppliedReceipt2 != null
          hasReceivedApplyReceiptForRepair = queueEntry.appliedReceiptForRepair2 != null
        }

        // on the off chance we are here with a pass of fail state remove this from the queue.
        // log fatal because we do not want to get to this situation.
        if (queueEntry.state === 'pass' || queueEntry.state === 'fail') {
          this.statemanager_fatal(`pass or fail entry should not be in queue`, `txid: ${shortID} state: ${queueEntry.state} receiptEverRequested:${queueEntry.receiptEverRequested} age:${txAge}`)
          this.removeFromQueue(queueEntry, currentIndex)
          continue
        }

        // TIME OUT / EXPIRATION CHECKS
        // Check if transactions have expired and failed, or if they have timed out and ne need to request receipts.
        if (this.stateManager.accountSync.dataSyncMainPhaseComplete === true) {
          // Everything in here is after we finish our initial sync

          // didSync: refers to the syncing process.  True is for TXs that we were notified of
          //          but had to delay action on because the initial or a runtime thread was busy syncing on.

          // For normal didSync===false TXs we are expiring them after M3*2
          //     This gives a bit of room to attempt a repair.
          //     if a repair or reciept process fails there are cases below to expire the the
          //     tx as early as time > M3
          if (txAge > timeM3 * 2 && queueEntry.didSync == false) {
            //this.statistics.incrementCounter('txExpired')
            //let seenInQueue = this.processQueue_accountSeen(seenAccounts, queueEntry)

            this.statemanager_fatal(`txExpired1 > M3 * 2. NormalTX Timed out.`, `txExpired txAge > timeM3*2 && queueEntry.didSync == false. ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} hasReceivedApplyReceiptForRepair:${hasReceivedApplyReceiptForRepair} receiptEverRequested:${queueEntry.receiptEverRequested} age:${txAge} ${utils.stringifyReduce(queueEntry.uniqueWritableKeys)}`)
            if (queueEntry.receiptEverRequested && queueEntry.globalModification === false) {
              this.statemanager_fatal(`txExpired1 > M3 * 2 -!receiptEverRequested`, `txExpired txAge > timeM3*2 && queueEntry.didSync == false. !receiptEverRequested ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} hasReceivedApplyReceiptForRepair:${hasReceivedApplyReceiptForRepair} receiptEverRequested:${queueEntry.receiptEverRequested} age:${txAge}`)
            }
            if (queueEntry.globalModification) {
              this.statemanager_fatal(`txExpired1 > M3 * 2 -GlobalModification!!`, `txExpired txAge > timeM3*2 && queueEntry.didSync == false. !receiptEverRequested ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} hasReceivedApplyReceiptForRepair:${hasReceivedApplyReceiptForRepair} receiptEverRequested:${queueEntry.receiptEverRequested} age:${txAge}`)
            }
            if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
            if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

            nestedCountersInstance.countEvent('txExpired', `> M3 * 2. NormalTX Timed out. didSync == false. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)
            queueEntry.state = 'expired'
            this.removeFromQueue(queueEntry, currentIndex)
            continue
          }

          //This case should not happen now. but we may add it back in later.
          //TXs that synced get much longer to have a chance to repair
          // if (txAge > timeM3 * 50 && queueEntry.didSync == true) {
          //   //this.statistics.incrementCounter('txExpired')

          //   this.statemanager_fatal(`txExpired2 > M3 * 50. SyncedTX Timed out.`, `txExpired txAge > timeM3 * 50 && queueEntry.didSync == true. ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} hasReceivedApplyReceiptForRepair:${hasReceivedApplyReceiptForRepair} receiptEverRequested:${queueEntry.receiptEverRequested} age:${txAge} syncCounter${queueEntry.syncCounter} ${utils.stringifyReduce(queueEntry.uniqueWritableKeys)}`)
          //   if (queueEntry.globalModification) {
          //     this.statemanager_fatal(`txExpired2 > M3 * 50. SyncedTX -GlobalModification!!`, `txExpired txAge > timeM3*2 && queueEntry.didSync == false. !receiptEverRequested ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} hasReceivedApplyReceiptForRepair:${hasReceivedApplyReceiptForRepair} receiptEverRequested:${queueEntry.receiptEverRequested} age:${txAge}`)
          //   }
          //   if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 2  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
          //   if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 2: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

          //   nestedCountersInstance.countEvent('txExpired', `> M3 * 50. SyncedTX Timed out. didSync == true. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)
          //   queueEntry.state = 'expired'
          //   this.removeFromQueue(queueEntry, currentIndex)
          //   continue
          // }

          // lots of logic about when we can repair or not repair/when to wait etc.
          if(this.queueTimingFixes === false){
            // This is the expiry case where requestingReceiptFailed
            if (txAge > timeM3 && queueEntry.requestingReceiptFailed) {
              //this.statistics.incrementCounter('txExpired')

              this.statemanager_fatal(`txExpired3 > M3. receiptRequestFail after Timed Out`, `txExpired txAge > timeM3 && queueEntry.requestingReceiptFailed ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
              if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 3 requestingReceiptFailed  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
              if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 3 requestingReceiptFailed: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

              nestedCountersInstance.countEvent('txExpired', `> M3. receiptRequestFail after Timed Out. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)
              queueEntry.state = 'expired'
              this.removeFromQueue(queueEntry, currentIndex)
              continue
            }

            // This is the expiry case where repairFailed
            //     TODO.  I think as soon as a repair as marked as failed we can expire and remove it from the queue
            //            But I am leaving this optimizaiton out for now since we really don't want to plan on repairs failing
            if (txAge > timeM3 && queueEntry.repairFailed) {
              //this.statistics.incrementCounter('txExpired')

              this.statemanager_fatal(`txExpired3 > M3. repairFailed after Timed Out`, `txExpired txAge > timeM3 && queueEntry.repairFailed ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
              if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 3 repairFailed  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
              if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 3 repairFailed: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

              nestedCountersInstance.countEvent('txExpired', `> M3. repairFailed after Timed Out. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)
              queueEntry.state = 'expired'
              this.removeFromQueue(queueEntry, currentIndex)
              continue
            }
          
            // a few cases to wait for a receipt or request a receipt
            if (queueEntry.state != 'await repair' && queueEntry.state != 'commiting') {
              //Not yet expired case: getting close to expire so just move to consensing and wait.
              //Just wait for receipt only if we are awaiting data and it is getting late
              if (txAge > timeM2_5 && queueEntry.m2TimeoutReached === false && queueEntry.globalModification === false && queueEntry.requestingReceipt === false) {
                if (queueEntry.state == 'awaiting data') {
                  // no receipt yet, and state not committing
                  if (queueEntry.recievedAppliedReceipt == null && queueEntry.appliedReceipt == null) {
                    if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`Wait for reciept only: txAge > timeM2_5 txid:${shortID} `)
                    if (logFlags.playback) this.logger.playbackLogNote('txMissingReceipt3', `${shortID}`, `processAcceptedTxQueue ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)

                    nestedCountersInstance.countEvent('txMissingReceipt', `Wait for reciept only: txAge > timeM2.5. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)
                    queueEntry.waitForReceiptOnly = true
                    queueEntry.m2TimeoutReached = true
                    queueEntry.state = 'consensing'
                    continue
                  }
                }
              }

              if (queueEntry.requestingReceipt === true) {
                this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
                continue
              }

              // The TX technically expired past M3, but we will now request reciept in hope that we can repair the tx
              if (txAge > timeM3 && queueEntry.requestingReceiptFailed === false && queueEntry.globalModification === false) {
                if ((this.stateManager.hasReceipt(queueEntry) === false) && queueEntry.requestingReceipt === false) {
                  if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`txAge > timeM3 => ask for receipt now ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
                  if (logFlags.playback) this.logger.playbackLogNote('txMissingReceipt1', `txAge > timeM3 ${shortID}`, `syncNeedsReceipt ${shortID}`)

                  let seen = this.processQueue_accountSeen(seenAccounts, queueEntry)

                  this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
                  if(this.config.debug.optimizedTXConsenus){
                    this.queueEntryRequestMissingReceipt(queueEntry)                  
                  } else {
                    this.queueEntryRequestMissingReceipt_old(queueEntry)   
                  }

                  nestedCountersInstance.countEvent('txMissingReceipt', `txAge > timeM3 => ask for receipt now. state:${queueEntry.state} globalMod:${queueEntry.globalModification} seen:${seen}`)
                  queueEntry.waitForReceiptOnly = true
                  queueEntry.m2TimeoutReached = true
                  queueEntry.state = 'consensing'
                  continue
                }
              }
            }

          }


        } else {
          //check for TX older than 30x M3 and expire them
          if (txAge > timeM3 * 50) {
            //this.statistics.incrementCounter('txExpired')

            this.statemanager_fatal(`txExpired4`, `Still on inital syncing.  txExpired txAge > timeM3 * 50. ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
            if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 4  ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
            if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 4: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

            nestedCountersInstance.countEvent('txExpired', `txExpired txAge > timeM3 * 50. still syncing. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)
            queueEntry.state = 'expired'
            this.removeFromQueue(queueEntry, currentIndex)
            continue
          }
        }

        if(this.queueTimingFixes === true){
          //if we are still waiting on an upstream TX at this stage in the pipeline,
          //then kill the TX because there is not much hope for it
          //This will help make way for other TXs with a better chance
          if(queueEntry.state === 'processing' || queueEntry.state === 'awaiting data'){
            if (this.processQueue_accountSeen(seenAccounts, queueEntry) === true) {
              if (txAge > timeM2) {
                nestedCountersInstance.countEvent('txExpired', `> M2 canceled due to upstream TXs. state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification}`)
                queueEntry.state = 'expired'
                this.removeFromQueue(queueEntry, currentIndex)
                continue
              }
            }            
          }

          //If we are past time M2 there are few cases where we should give up on a TX right away
          //Handle that here
          if (txAge > timeM2) {
            let expireTx = false
            let reason = ''
            //not sure this path can even happen.  but we addding it for completeness in case it comes back (abilty to requets receipt)
            if(queueEntry.requestingReceiptFailed){
              expireTx = true
              reason = 'requestingReceiptFailed'
            }
            if(queueEntry.repairFailed){
              expireTx = true
              reason = 'repairFailed' 
            }
            if(expireTx){
              this.statemanager_fatal(`txExpired3 > M2. fail ${reason}`, `txExpired txAge > timeM2 fail ${reason} ` + `txid: ${shortID} state: ${queueEntry.state} hasAll:${queueEntry.hasAll} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
              if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired >m2 fail ${reason}  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
              //if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 3 requestingReceiptFailed: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

              nestedCountersInstance.countEvent('txExpired', `> timeM2 fail ${reason} state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification} `)
              queueEntry.state = 'expired'
              this.removeFromQueue(queueEntry, currentIndex)              
            }
          }

          //Have a hard cap where we expire and remove TXs after time > M3
          if (txAge > timeM3) {
            this.statemanager_fatal(`txExpired3 > M3. general case`, `txExpired txAge > timeM3 general case ` + `txid: ${shortID} state: ${queueEntry.state} hasAll:${queueEntry.hasAll} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
            if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 3 requestingReceiptFailed  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
            //if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 3 requestingReceiptFailed: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

            nestedCountersInstance.countEvent('txExpired', `> M3. general case state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification} `)
            queueEntry.state = 'expired'
            this.removeFromQueue(queueEntry, currentIndex)
            continue
          }

          //TODO? could we remove a TX from the queu as soon as a receit was requested?
          //TODO?2 should we allow a TX to use a repair op shortly after being expired? (it would have to be carefull, and maybe use some locking)
        } 

        // HANDLE TX logic based on state.
        try {
          this.profiler.profileSectionStart(`process-${queueEntry.state}`)
          pushedProfilerTag = queueEntry.state

          if (queueEntry.state === 'syncing') {
            ///////////////////////////////////////////////--syncing--////////////////////////////////////////////////////////////
            // a queueEntry will be put in syncing state if it is queue up while we are doing initial syncing or if
            // we are syncing a range of new edge partition data.
            // we hold it in limbo until the syncing operation is complete.  When complete all of these TXs are popped
            // and put back into the queue.  If it has been too long they will go into a repair to receipt mode.
            // IMPORTANT thing is that we mark the accounts as seen, because we cant use this account data
            //   in TXs that happen after until this is resolved.

            //the syncing process is not fully reliable when popping synced TX.  this is a backup check to see if we can get out of syncing state
            if (queueEntry.syncCounter <= 0) {
              nestedCountersInstance.countEvent('sync', 'syncing state needs bump')

              queueEntry.waitForReceiptOnly = true
              queueEntry.state = 'consensing'
            }

            this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
          } else if (queueEntry.state === 'aging') {
            queueEntry.executionDebug = { a: 'go' }
            ///////////////////////////////////////////--aging--////////////////////////////////////////////////////////////////
            // We wait in the aging phase, and mark accounts as seen to prevent a TX that is after this from using or changing data
            // on the accounts in this TX
            // note that code much earlier in the loop rejects any queueEntries younger than time M
            queueEntry.state = 'processing'
            this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
          }
          if (queueEntry.state === 'processing') {
            ////////////////////////////////////////--processing--///////////////////////////////////////////////////////////////////
            if (this.processQueue_accountSeen(seenAccounts, queueEntry) === false) {
              // Processing is when we start doing real work.  the task is to read and share the correct account data to the correct
              // corresponding nodes and then move into awaiting data phase

              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
              let time = Date.now()
              try {
                // TODO re-evaluate if it is correct for us to share info for a global modifing TX.
                //if(queueEntry.globalModification === false) {
                await this.tellCorrespondingNodes(queueEntry)
                if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_processing', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter}  values: ${this.processQueue_debugAccountData(queueEntry, app)}`)
                //}
              } catch (ex) {
                if (logFlags.debug) this.mainLogger.debug('processAcceptedTxQueue2 tellCorrespondingNodes:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                this.statemanager_fatal(`processAcceptedTxQueue2_ex`, 'processAcceptedTxQueue2 tellCorrespondingNodes:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)

                queueEntry.executionDebug.process1 = 'tell fail'
              } finally {
                queueEntry.state = 'awaiting data'

                //if we are not going to execute the TX go strait to consensing
                if(queueEntry.globalModification === false && this.executeInOneShard && queueEntry.isInExecutionHome === false){
                  //is there a way to preemptively forward data without there being tons of repair..
                  if (logFlags.verbose) this.mainLogger.debug(`processAcceptedTxQueue2 isInExecutionHome === false. set state = 'await final data' tx:${queueEntry.logID} ts:${queueEntry.acceptedTx.timestamp}`)
                  queueEntry.state = 'await final data'
                }
              }
              queueEntry.executionDebug.processElaped = Date.now() - time
            }
            this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
          }
          if (queueEntry.state === 'awaiting data') {
            queueEntry.executionDebug.log = 'entered awaiting data'

            ///////////////////////////////////////--awaiting data--////////////////////////////////////////////////////////////////////

            // Wait for all data to be aquired.
            // Once we have all the data we need we can move to consensing phase.
            // IF this is a global account it will go strait to commiting phase since the data was shared by other means.

            if(this.queueTimingFixes === true){
              if (txAge > timeM2_5) {
                //need to review this in context of sharding
                nestedCountersInstance.countEvent('txExpired', `> M2.5 canceled due to lack of progress. state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification}`)
                queueEntry.state = 'expired'
                this.removeFromQueue(queueEntry, currentIndex)
                continue
              }    

            } else {
              // catch all in case we get waiting for data
              if (txAge > timeM2_5) {
                this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
                nestedCountersInstance.countEvent('processing', `awaiting data txAge > m2.5 set to consensing hasAll:${queueEntry.hasAll} hasReceivedApplyReceipt:${hasReceivedApplyReceipt}`)

                queueEntry.waitForReceiptOnly = true
                queueEntry.state = 'consensing'
                continue
              }              
            }


            // TODO review this block below in more detail.
            // check if we have all accounts
            if (queueEntry.hasAll === false && txAge > timeM2) {
              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)  

              if (queueEntry.pendingDataRequest === true) {
                //early out after marking seen, because we are already asking for data
                //need to review this in context of sharding
                continue
              }

              if (this.queueEntryHasAllData(queueEntry) === true) {
                // I think this can't happen
                nestedCountersInstance.countEvent('processing', 'data missing at t>M2. but not really. investigate further')
                if (logFlags.playback) this.logger.playbackLogNote('shrd_hadDataAfterall', `${shortID}`, `This is kind of an error, and should not happen`)
                continue
              }

              if (this.queueTimingFixes === true && this.processQueue_accountSeen(seenAccounts, queueEntry) === true){
                //we are stuck in line so no cause to ask for data yet.

                //TODO may need a flag that know if a TX was stuck until time m.. then let it not 
                //ask for other accoun data right away...
                continue
              }

              // 7.  Manually request missing state
              try {
                nestedCountersInstance.countEvent('processing', 'data missing at t>M2. request data')
                // Await note: current thinking is that is is best to not await this call.
                this.queueEntryRequestMissingData(queueEntry)
              } catch (ex) {
                if (logFlags.debug) this.mainLogger.debug('processAcceptedTxQueue2 queueEntryRequestMissingData:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                this.statemanager_fatal(`processAcceptedTxQueue2_missingData`, 'processAcceptedTxQueue2 queueEntryRequestMissingData:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
              }
            } else if (queueEntry.hasAll) {
              queueEntry.executionDebug.log1 = 'has all'

              // we have all the data, but we need to make sure there are no upstream TXs using accounts we need first.
              if (this.processQueue_accountSeen(seenAccounts, queueEntry) === false) {
                this.processQueue_markAccountsSeen(seenAccounts, queueEntry)

                // As soon as we have all the data we preApply it and then send out a vote
                if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_preApplyTx', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${this.processQueue_debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)

                // TODO sync related need to reconsider how to set this up again
                // if (queueEntry.didSync) {
                //   if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_consensing', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}`)
                //   // if we did sync it is time to JIT query local data.  alternatively could have other nodes send us this data, but that could be very high bandwidth.
                //   for (let key of queueEntry.syncKeys) {
                //     let wrappedState = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
                //     if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_getLocalData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}  key:${utils.makeShortHash(key)} hash:${wrappedState.stateId}`)
                //     queueEntry.localCachedData[key] = wrappedState.localCache
                //   }
                // }

                try {
                  //This is a just in time check to make sure our involved accounts
                  //have not changed after our TX timestamp
                  let accountsValid = this.checkAccountTimestamps(queueEntry)
                  if (accountsValid === false) {
                    queueEntry.state = 'consensing'
                    queueEntry.preApplyTXResult = {
                      applied: false,
                      passed: false,
                      applyResult: 'failed account TS checks',
                      reason: 'apply result',
                      applyResponse: null
                    }
                    continue
                  }
                  queueEntry.executionDebug.log2 = 'call pre apply'

                  let txResult = await this.preApplyTransaction(queueEntry)

                  queueEntry.executionDebug.log3 = 'called pre apply'
                  queueEntry.executionDebug.txResult = txResult

                  if (txResult != null && txResult.applied === true) {
                    queueEntry.state = 'consensing'

                    queueEntry.preApplyTXResult = txResult

                    // make sure our data wrappers are upt to date with the correct hash and timstamp
                    for (let key of Object.keys(queueEntry.collectedData)) {
                      let wrappedAccount = queueEntry.collectedData[key]
                      let { timestamp, hash } = this.app.getTimestampAndHashFromAccount(wrappedAccount.data)
                      if (wrappedAccount.timestamp != timestamp) {
                        wrappedAccount.timestamp = timestamp
                        nestedCountersInstance.countEvent('transactionQueue', 'correctedTimestamp')
                      }
                      if (wrappedAccount.stateId != hash) {
                        wrappedAccount.stateId = hash
                        nestedCountersInstance.countEvent('transactionQueue', 'correctedHash')
                      }
                    }

                    //Broadcast our vote
                    if (queueEntry.noConsensus === true) {
                      // not sure about how to share or generate an applied receipt though for a no consensus step
                      if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_preApplyTx_noConsensus', `${shortID}`, ``)

                      if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 noConsensus : ${queueEntry.logID} `)

                      queueEntry.state = 'commiting'

                      queueEntry.hasValidFinalData = true
                      // TODO Global receipts?  do we want them?
                      // if(queueEntry.globalModification === false){
                      //   //Send a special receipt because this is a set command.
                      // }
                    } else {
                      if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_preApplyTx_createAndShareVote', `${shortID}`, ``)
                      if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 createAndShareVote : ${queueEntry.logID} `)
                      await this.stateManager.transactionConsensus.createAndShareVote(queueEntry)
                    }
                  } else {
                    //There was some sort of error when we tried to apply the TX
                    //Go directly into 'consensing' state, because we need to wait for a receipt that is good.
                    nestedCountersInstance.countEvent('processing', `txResult apply error. applied: ${txResult?.applied}`)
                    if (logFlags.error) this.mainLogger.error(`processAcceptedTxQueue2 txResult problem txid:${queueEntry.logID} res: ${utils.stringifyReduce(txResult)} `)
                    queueEntry.waitForReceiptOnly = true
                    queueEntry.state = 'consensing'
                  }
                } catch (ex) {
                  if (logFlags.debug) this.mainLogger.debug('processAcceptedTxQueue2 preApplyAcceptedTransaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                  this.statemanager_fatal(`processAcceptedTxQueue2b_ex`, 'processAcceptedTxQueue2 preApplyAcceptedTransaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                } finally {
                  if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_preapplyFinish', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${this.processQueue_debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
                }
              } else {
                queueEntry.executionDebug.logBusy = 'has all, but busy'
              }
              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
            } else {
              // mark accounts as seen while we are waiting for data
              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
            }
          } else if (queueEntry.state === 'consensing') {
            /////////////////////////////////////////--consensing--//////////////////////////////////////////////////////////////////
            if (this.processQueue_accountSeen(seenAccounts, queueEntry) === false) {
              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)

              let didNotMatchReceipt = false

              let finishedConsensing = false

              // try to produce a receipt
              if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 consensing : ${queueEntry.logID} receiptRcv:${hasReceivedApplyReceipt}`)
              let result = this.stateManager.transactionConsensus.tryProduceReceipt(queueEntry)
              if (result != null) {

                //TODO share receipt with corresponding index

                if (this.stateManager.transactionConsensus.hasAppliedReceiptMatchingPreApply(queueEntry, result)) {
                  if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_madeReceipt', `${shortID}`, `qId: ${queueEntry.entryID}  `)

                  let shouldSendReceipt = true
                  // shouldSendReceipt = queueEntry.recievedAppliedReceipt == null

                  if (shouldSendReceipt) {
                    if(this.config.debug.optimizedTXConsenus ){
                      if(queueEntry.appliedReceipt2){
                        // Broadcast the receipt, only if we made one (try produce can early out if we received one)
                        await this.stateManager.transactionConsensus.shareAppliedReceipt(queueEntry)                          
                      }

                    } else {
                      // Broadcast the receipt
                      await this.stateManager.transactionConsensus.shareAppliedReceipt(queueEntry)                      
                    }

                  } else {
                    // no need to share a receipt
                  }

                  //todo check cant_apply flag to make sure a vote can form with it!
                  //also check if failed votes will work...?
                  if (this.stateManager.getReceiptVote(queueEntry).cant_apply === false && this.stateManager.getReceiptResult(queueEntry) === true) {
                    queueEntry.state = 'commiting'
                    queueEntry.hasValidFinalData = true
                    finishedConsensing = true
                  } else {
                    if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_finishedFailReceipt1', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                    // we are finished since there is nothing to apply
                    // this.statemanager_fatal(`consensing: repairToMatchReceipt failed`, `consensing: repairToMatchReceipt failed ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
                    this.removeFromQueue(queueEntry, currentIndex)
                    queueEntry.state = 'fail'
                    continue
                  }

                  if(queueEntry.globalModification === false && finishedConsensing === true && this.executeInOneShard && queueEntry.isInExecutionHome ){
                    //forward all finished data to corresponding nodes
                    //tellFinalDataToCorrespondingNodes()
                    await this.tellCorrespondingNodesFinalData(queueEntry)
                  }
                  //continue
                } else {
                  if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_gotReceiptNoMatch1', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                  didNotMatchReceipt = true
                  queueEntry.appliedReceiptForRepair = result

                  queueEntry.appliedReceiptForRepair2 = this.stateManager.getReceipt2(queueEntry)
                }
              }
              if (finishedConsensing === false) {
                // if we got a reciept while waiting see if we should use it (if our own vote matches)
                if (hasReceivedApplyReceipt && queueEntry.recievedAppliedReceipt != null) {
                  if (this.stateManager.transactionConsensus.hasAppliedReceiptMatchingPreApply(queueEntry, queueEntry.recievedAppliedReceipt)) {
                    if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_gotReceipt', `${shortID}`, `qId: ${queueEntry.entryID} `)

                    //todo check cant_apply flag to make sure a vote can form with it!
                    if (this.stateManager.getReceiptVote(queueEntry).cant_apply === false && this.stateManager.getReceiptResult(queueEntry) === true) {
                      queueEntry.state = 'commiting'
                      queueEntry.hasValidFinalData = true
                      finishedConsensing = true
                    } else {
                      if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_finishedFailReceipt2', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                      // we are finished since there is nothing to apply
                      //this.statemanager_fatal(`consensing: repairToMatchReceipt failed`, `consensing: repairToMatchReceipt failed ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
                      this.removeFromQueue(queueEntry, currentIndex)
                      queueEntry.state = 'fail'
                      continue
                    }

                    //continue
                  } else {
                    if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_gotReceiptNoMatch2', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                    didNotMatchReceipt = true
                    queueEntry.appliedReceiptForRepair = queueEntry.recievedAppliedReceipt

                    queueEntry.appliedReceiptForRepair2 = this.stateManager.getReceipt2(queueEntry)
                  }
                } else {
                  //just keep waiting for a reciept
                }

                // we got a receipt but did not match it.
                if (didNotMatchReceipt === true) {
                  if (queueEntry.debugFail_failNoRepair) {
                    queueEntry.state = 'fail'
                    this.removeFromQueue(queueEntry, currentIndex)
                    nestedCountersInstance.countEvent('stateManager', 'debugFail_failNoRepair')
                    this.statemanager_fatal(`processAcceptedTxQueue_debugFail_failNoRepair2`, `processAcceptedTxQueue_debugFail_failNoRepair2 tx: ${shortID} cycle:${queueEntry.cycleToRecordOn}  accountkeys: ${utils.stringifyReduce(queueEntry.uniqueWritableKeys)}`)
                    this.processQueue_clearAccountsSeen(seenAccounts, queueEntry)
                    continue
                  }

                  if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_didNotMatchReceipt', `${shortID}`, `qId: ${queueEntry.entryID} result:${queueEntry.appliedReceiptForRepair.result} `)
                  queueEntry.repairFinished = false
                  if (queueEntry.appliedReceiptForRepair.result === true) {
                    // need to start repair process and wait
                    //await note: it is best to not await this.  it should be an async operation.
                    this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
                    queueEntry.state = 'await repair'
                    continue
                  } else {
                    // We got a reciept, but the consensus is that this TX was not applied.
                    if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_finishedFailReceipt3', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                    // we are finished since there is nothing to apply
                    this.statemanager_fatal(`consensing: repairToMatchReceipt failed`, `consensing: repairToMatchReceipt failed ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
                    this.removeFromQueue(queueEntry, currentIndex)
                    queueEntry.state = 'fail'
                    continue
                  }
                }
              }
            }
            this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
          }
          if (queueEntry.state === 'await repair') {
            ///////////////////////////////////////////--await repair--////////////////////////////////////////////////////////////////
            this.processQueue_markAccountsSeen(seenAccounts, queueEntry)

            // Special state that we are put in if we are waiting for a repair to receipt operation to conclude
            if (queueEntry.repairFinished === true) {
              if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitRepair_repairFinished', `${shortID}`, `qId: ${queueEntry.entryID} result:${queueEntry.appliedReceiptForRepair.result} `)
              if (queueEntry.appliedReceiptForRepair.result === true) {
                queueEntry.state = 'pass'
              } else {
                // technically should never get here, because we dont need to repair to a receipt when the network did not apply the TX
                queueEntry.state = 'fail'
              }
              // most remove from queue at the end because it compacts the queue entry
              this.removeFromQueue(queueEntry, currentIndex)
              continue
            }
          }
          if(queueEntry.state === 'await final data') {
            //wait patiently for data to match receipt
            //if we run out of time repair to receipt?

            if (this.processQueue_accountSeen(seenAccounts, queueEntry) === false) {
              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)

              //temp hack ... hopefully this hack can go away
              if(queueEntry.recievedAppliedReceipt == null){
                let result = this.stateManager.transactionConsensus.tryProduceReceipt(queueEntry)
                if(result != null){
                  queueEntry.recievedAppliedReceipt = result
                  if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitFinalData_hackReceipt', `${shortID}`, `qId: ${queueEntry.entryID} result:${utils.stringifyReduce(result)}`)
                }
              }

              //collectedFinalData
              let vote = this.stateManager.getReceiptVote(queueEntry)
              if(vote){
                let failed = false
                let incomplete = false
                for(let i=0; i<vote.account_id.length; i++ ){
                  let accountID = vote.account_id[i]
                  let accountHash = vote.account_state_hash_after[i]

                  let wrappedAccount = queueEntry.collectedFinalData[accountID]
                  if(wrappedAccount == null){
                    incomplete = true
                    break
                  }
                  if(wrappedAccount.stateId != accountHash){
                    failed = true
                    break
                  }
                }
                if(failed === true){
                  this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
                  queueEntry.state = 'await repair'
                  if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitFinalData_failed', `${shortID}`, `qId: ${queueEntry.entryID} `)
                  if (logFlags.debug) this.mainLogger.error(`shrd_awaitFinalData_failed : ${queueEntry.logID} `)
                  continue
                }
                if(failed === false && incomplete === false){
                  if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitFinalData_passed', `${shortID}`, `qId: ${queueEntry.entryID} `)
                  if (logFlags.debug) this.mainLogger.error(`shrd_awaitFinalData_passed : ${queueEntry.logID} `)

                  //we let commiting handle this before but we need to just set account!
                  //queueEntry.state = 'commiting'

                  //TODO vote order should be in apply response order!
                  let rawAccounts = []
                  let accountRecords:Shardus.WrappedData[] = []
                  for(let i=0; i<vote.account_id.length; i++ ){
                    let accountID = vote.account_id[i]
                    let wrappedAccount = queueEntry.collectedFinalData[accountID]

                    rawAccounts.push(wrappedAccount.data)
                    accountRecords.push(wrappedAccount)
                  }
                  //await this.app.setAccountData(rawAccounts)

                  await this.stateManager.checkAndSetAccountData(accountRecords, 'awaitFinalData_passed', false)

                  //log tx processed if needed
                  if (queueEntry != null && queueEntry.transactionGroup != null && this.p2p.getNodeId() === queueEntry.transactionGroup[0].id) {
                    if(queueEntry.globalModification === false){ //temp way to make global modifying TXs not over count
                      this.stateManager.eventEmitter.emit('txProcessed')
                    }
                  }

                  if (queueEntry.recievedAppliedReceipt.result === true) {
                    queueEntry.state = 'pass'
                  } else {
                    queueEntry.state = 'fail'
                  }
                  this.removeFromQueue(queueEntry, currentIndex)
                }
              }
            }

          }
          if (queueEntry.state === 'commiting') {
            ///////////////////////////////////////////--commiting--////////////////////////////////////////////////////////////////
            if (this.processQueue_accountSeen(seenAccounts, queueEntry) === false) {
              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)

              // TODO STATESHARDING4 Check if we have already commited the data from a receipt we saw earlier
              if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting : ${queueEntry.logID} `)
              if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_commitingTx', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${this.processQueue_debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)

              // if (logFlags.verbose) this.mainLogger.debug( ` processAcceptedTxQueue2. ${queueEntry.entryID} timestamp: ${queueEntry.txKeys.timestamp}`)

              // TODO STATESHARDING4 SYNC related need to reconsider how to set this up again
              // if (queueEntry.didSync) {
              //   if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_commiting', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}`)
              //   // if we did sync it is time to JIT query local data.  alternatively could have other nodes send us this data, but that could be very high bandwidth.
              //   for (let key of queueEntry.syncKeys) {
              //     let wrappedState = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
              //     if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_getLocalData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}  key:${utils.makeShortHash(key)} hash:${wrappedState.stateId}`)
              //     queueEntry.localCachedData[key] = wrappedState.localCache
              //   }
              // }

              if (queueEntry.debugFail_failNoRepair) {
                queueEntry.state = 'fail'
                this.removeFromQueue(queueEntry, currentIndex)
                nestedCountersInstance.countEvent('stateManager', 'debugFail_failNoRepair')
                this.statemanager_fatal(`processAcceptedTxQueue_debugFail_failNoRepair`, `processAcceptedTxQueue_debugFail_failNoRepair tx: ${shortID} cycle:${queueEntry.cycleToRecordOn}  accountkeys: ${utils.stringifyReduce(queueEntry.uniqueWritableKeys)}`)
                this.processQueue_clearAccountsSeen(seenAccounts, queueEntry)
                continue
              }

              let wrappedStates = queueEntry.collectedData // Object.values(queueEntry.collectedData)
              let localCachedData = queueEntry.localCachedData

              //TODO apply the data we got!!! (override wrapped states)
              // if(this.executeInOneShard){
              //   for(let key of Object.keys(queueEntry.collectedFinalData)){
              //     wrappedStates[key] = queueEntry.collectedFinalData[key]
              //   }
              // }
              // make sure the branches below will use this data correctly

              // commit  queueEntry.preApplyTXResult.applyResponse.... hmm
              // aslo is queueEntry.preApplyTXResult.applyResponse use above in tex data tell?


              try {
                let canCommitTX = true
                let hasReceiptFail = false
                if(this.config.debug.optimizedTXConsenus){
                  if (queueEntry.noConsensus === true) {
                    // dont have a receipt for a non consensus TX. not even sure if we want to keep that!
                    if (queueEntry.preApplyTXResult.passed === false) {
                      canCommitTX = false
                    }
                  } else if (queueEntry.appliedReceipt2 != null) {
                    // the final state of the queue entry will be pass or fail based on the receipt
                    if (queueEntry.appliedReceipt2.result === false) {
                      canCommitTX = false
                      hasReceiptFail = true
                    }
                  } else if (queueEntry.recievedAppliedReceipt2 != null) {
                    // the final state of the queue entry will be pass or fail based on the receipt
                    if (queueEntry.recievedAppliedReceipt2.result === false) {
                      canCommitTX = false
                      hasReceiptFail = false
                    }
                  } else {
                    canCommitTX = false
                  }
                } else {
                  if (queueEntry.noConsensus === true) {
                    // dont have a receipt for a non consensus TX. not even sure if we want to keep that!
                    if (queueEntry.preApplyTXResult.passed === false) {
                      canCommitTX = false
                    }
                  } else if (queueEntry.appliedReceipt != null) {
                    // the final state of the queue entry will be pass or fail based on the receipt
                    if (queueEntry.appliedReceipt.result === false) {
                      canCommitTX = false
                      hasReceiptFail = true
                    }
                  } else if (queueEntry.recievedAppliedReceipt != null) {
                    // the final state of the queue entry will be pass or fail based on the receipt
                    if (queueEntry.recievedAppliedReceipt.result === false) {
                      canCommitTX = false
                      hasReceiptFail = false
                    }
                  } else {
                    canCommitTX = false
                  }                  
                }


                if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_commitingTx', `${shortID}`, `canCommitTX: ${canCommitTX} `)
                if (canCommitTX) {
                  // this.mainLogger.debug(` processAcceptedTxQueue2. applyAcceptedTransaction ${queueEntry.entryID} timestamp: ${queueEntry.txKeys.timestamp} queuerestarts: ${localRestartCounter} queueLen: ${this.newAcceptedTxQueue.length}`)

                  // Need to go back and thing on how this was supposed to work:
                  //queueEntry.acceptedTx.transactionGroup = queueEntry.transactionGroup // Used to not double count txProcessed

                  //try {
                  this.profiler.profileSectionStart('commit')

                  let commitResult = await this.commitConsensedTransaction(queueEntry)

                  if (queueEntry.repairFinished) {
                    // saw a TODO comment above and befor I axe it want to confirm what is happening after we repair a receipt.
                    // shouldn't get here putting this in to catch if we do
                    this.statemanager_fatal(`processAcceptedTxQueue_commitingRepairedReceipt`, `${shortID} `)
                    nestedCountersInstance.countEvent('processing', 'commiting a repaired TX...')
                  }

                  nestedCountersInstance.countEvent('stateManager', 'committed tx')
                  if (queueEntry.hasValidFinalData === false) {
                    nestedCountersInstance.countEvent('stateManager', 'commit state fix FinalDataFlag')
                    queueEntry.hasValidFinalData = true
                  }

                  //} finally {
                  this.profiler.profileSectionEnd('commit')
                  //}

                  if (commitResult != null && commitResult.success) {

                  }
                } else {
                }

                if(this.config.p2p.experimentalSnapshot) this.addReceiptToForward(queueEntry)
                // console.log('commit commit', queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp)

                if (hasReceiptFail) {
                  // endpoint to allow dapp to execute something that depends on a transaction failing

                  let applyReponse = queueEntry.preApplyTXResult.applyResponse // TODO STATESHARDING4 ... if we get here from a non standard path may need to get this data from somewhere else

                  this.app.transactionReceiptFail(queueEntry.acceptedTx.data, wrappedStates, applyReponse)
                }
              } catch (ex) {
                if (logFlags.debug) this.mainLogger.debug('processAcceptedTxQueue2 commiting Transaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                this.statemanager_fatal(`processAcceptedTxQueue2b_ex`, 'processAcceptedTxQueue2 commiting Transaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
              } finally {
                this.processQueue_clearAccountsSeen(seenAccounts, queueEntry)

                if(this.config.debug.optimizedTXConsenus){
                  if (queueEntry.noConsensus === true) {
                    // dont have a receipt for a non consensus TX. not even sure if we want to keep that!
                    if (queueEntry.preApplyTXResult.passed === true) {
                      queueEntry.state = 'pass'
                    } else {
                      queueEntry.state = 'fail'
                    }
                    if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : noConsensus:${queueEntry.state} ${queueEntry.logID} `)
                  } else if (queueEntry.appliedReceipt2 != null) {
                    // the final state of the queue entry will be pass or fail based on the receipt
                    if (queueEntry.appliedReceipt2.result === true) {
                      queueEntry.state = 'pass'
                    } else {
                      queueEntry.state = 'fail'
                    }
                    if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : Recpt:${queueEntry.state} ${queueEntry.logID} `)
                  } else if (queueEntry.recievedAppliedReceipt2 != null) {
                    // the final state of the queue entry will be pass or fail based on the receipt
                    if (queueEntry.recievedAppliedReceipt2.result === true) {
                      queueEntry.state = 'pass'
                    } else {
                      queueEntry.state = 'fail'
                    }
                    if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : recvRecpt:${queueEntry.state} ${queueEntry.logID} `)
                  } else {
                    queueEntry.state = 'fail'
                    if (logFlags.error) this.mainLogger.error(`processAcceptedTxQueue2 commiting finished : no receipt ${queueEntry.logID} `)
                  }
                } else{
                  if (queueEntry.noConsensus === true) {
                    // dont have a receipt for a non consensus TX. not even sure if we want to keep that!
                    if (queueEntry.preApplyTXResult.passed === true) {
                      queueEntry.state = 'pass'
                    } else {
                      queueEntry.state = 'fail'
                    }
                    if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : noConsensus:${queueEntry.state} ${queueEntry.logID} `)
                  } else if (queueEntry.appliedReceipt != null) {
                    // the final state of the queue entry will be pass or fail based on the receipt
                    if (queueEntry.appliedReceipt.result === true) {
                      queueEntry.state = 'pass'
                    } else {
                      queueEntry.state = 'fail'
                    }
                    if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : Recpt:${queueEntry.state} ${queueEntry.logID} `)
                  } else if (queueEntry.recievedAppliedReceipt != null) {
                    // the final state of the queue entry will be pass or fail based on the receipt
                    if (queueEntry.recievedAppliedReceipt.result === true) {
                      queueEntry.state = 'pass'
                    } else {
                      queueEntry.state = 'fail'
                    }
                    if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : recvRecpt:${queueEntry.state} ${queueEntry.logID} `)
                  } else {
                    queueEntry.state = 'fail'
                    if (logFlags.error) this.mainLogger.error(`processAcceptedTxQueue2 commiting finished : no receipt ${queueEntry.logID} `)
                  }                  
                }


                if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_commitingTxFinished', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${this.processQueue_debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)

                //moved to end of finally because this does some compacting on the queue entry
                this.removeFromQueue(queueEntry, currentIndex)
              }

              // TODO STATESHARDING4 SYNC related.. need to consider how we will re activate this
              // // do we have any syncing neighbors?
              // if (this.stateManager.currentCycleShardData.hasSyncingNeighbors === true && queueEntry.globalModification === false) {
              // // let dataToSend = Object.values(queueEntry.collectedData)
              //   let dataToSend = []

              //   let keys = Object.keys(queueEntry.originalData)
              //   for (let key of keys) {
              //     dataToSend.push(JSON.parse(queueEntry.originalData[key]))
              //   }

              //   // maybe have to send localcache over, or require the syncing node to grab this data itself JIT!
              //   // let localCacheTransport = Object.values(queueEntry.localCachedData)

              //   // send data to syncing neighbors.
              //   if (this.stateManager.currentCycleShardData.syncingNeighbors.length > 0) {
              //     let message = { stateList: dataToSend, txid: queueEntry.acceptedTx.id }
              //     if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_dataTell', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID} AccountBeingShared: ${utils.stringifyReduce(queueEntry.txKeys.allKeys)} txid: ${utils.makeShortHash(message.txid)} nodes:${utils.stringifyReduce(this.stateManager.currentCycleShardData.syncingNeighbors.map(x => x.id))}`)
              //     this.p2p.tell(this.stateManager.currentCycleShardData.syncingNeighbors, 'broadcast_state', message)
              //   }
              // }
            }
          }
          if (queueEntry.state === 'canceled') {
            ///////////////////////////////////////////////--canceled--////////////////////////////////////////////////////////////
            this.processQueue_clearAccountsSeen(seenAccounts, queueEntry)
            this.removeFromQueue(queueEntry, currentIndex)
            if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 canceled : ${queueEntry.logID} `)
          }
        } finally {
          this.profiler.profileSectionEnd(`process-${pushedProfilerTag}`)
          pushedProfilerTag = null // clear the tag
        }
      }
    } finally {
      //Handle an odd case where the finally did not catch exiting scope.
      if (pushedProfilerTag != null) {
        this.profiler.profileSectionEnd(`process-${pushedProfilerTag}`)
        this.profiler.profileSectionEnd(`process-patched1-${pushedProfilerTag}`)
        pushedProfilerTag = null
      }

      let processTime = Date.now() - startTime
      if (processTime > 10000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 10s')
        this.statemanager_fatal(`processAcceptedTxQueue excceded time ${processTime / 1000} firstTime:${firstTime}`, `processAcceptedTxQueue excceded time ${processTime / 1000} firstTime:${firstTime}`)
      } else if (processTime > 5000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 5s')
      } else if (processTime > 2000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 2s')
      } else if (processTime > 1000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 1s')
      }

      // restart loop if there are still elements in it
      if (this.newAcceptedTxQueue.length > 0 || this.newAcceptedTxQueueTempInjest.length > 0) {
        this.processingLeftBusy = true
        setTimeout(() => {
          this.stateManager.tryStartAcceptedQueue()
        }, 15)
      } else {
        this.processingLeftBusy = false
      }

      this.newAcceptedTxQueueRunning = false
      this.processingLastRunTime = Date.now()
      this.stateManager.lastSeenAccountsMap = seenAccounts

      this.profiler.profileSectionEnd('processQ')
    }
  }

  addReceiptToForward(queueEntry: QueueEntry) {
    const netId: string = '123abc'
    // const receipt = this.stateManager.getReceipt(queueEntry)
    // const status = receipt.result === true ? 'applied' : 'rejected'
    const status = this.stateManager.getReceiptResult(queueEntry) === true ? 'applied' : 'rejected'
    
    let txHash = queueEntry.acceptedTx.txId
    let txResultFullHash = this.crypto.hash({ tx: queueEntry.acceptedTx.data, status, netId })
    let txIdShort = utils.short(txHash)
    let txResult = utils.short(txResultFullHash)

    const txReceiptToPass = {
      tx: { ...queueEntry.acceptedTx },
      cycle: queueEntry.cycleToRecordOn,
      result: { txIdShort, txResult },
      accounts: queueEntry.preApplyTXResult.applyResponse.accountData.map(acc => {
        let accountCopy = {...acc}
        delete accountCopy.localCache
        return accountCopy
      })
    }
    const signedTxReceiptToPass = this.crypto.sign(txReceiptToPass)
    this.receiptsToForward.push(signedTxReceiptToPass)
  }

  getReceiptsToForward() {
    const freshReceipts = []
    for (const receipt of this.receiptsToForward) {
      if (!this.forwardedReceipts.has(receipt.tx.txId)) {
        freshReceipts.push(receipt)
      }
    }
    return freshReceipts
  }

  resetReceiptsToForward() {
    if (Date.now() - this.lastReceiptForwardResetTimestamp >= 30000) {
      const lastReceiptsToForward = [...this.receiptsToForward]
      this.receiptsToForward = []
      for (const receipt of lastReceiptsToForward) {   // Start sending from the last receipts it saved (30s of data) when a new node is selected
        if (!this.forwardedReceipts.has(receipt.tx.txId) && !this.oldNotForwardedReceipts.has(receipt.tx.txId)) {
          this.receiptsToForward.push(receipt)
        }
      }
      this.forwardedReceipts = new Map()
      this.oldNotForwardedReceipts = new Map()
      for (const receipt of this.receiptsToForward) {
        this.oldNotForwardedReceipts.set(receipt.tx.txId, true)
      }
      this.lastReceiptForwardResetTimestamp = Date.now()
    }
  }

  // getReceipt(queueEntry: QueueEntry): AppliedReceipt {
  //   if (queueEntry.appliedReceiptFinal != null) {
  //     return queueEntry.appliedReceiptFinal
  //   }
  //   // start with a receipt we made
  //   let receipt: AppliedReceipt = queueEntry.appliedReceipt
  //   if (receipt == null) {
  //     // or see if we got one
  //     receipt = queueEntry.recievedAppliedReceipt
  //   }
  //   // if we had to repair use that instead. this stomps the other ones
  //   if (queueEntry.appliedReceiptForRepair != null) {
  //     receipt = queueEntry.appliedReceiptForRepair
  //   }
  //   queueEntry.appliedReceiptFinal = receipt
  //   return receipt
  // }

  /**
   * processQueue_accountSeen
   * Helper for processQueue to detect if this queueEntry has any accounts that are already blocked because they were seen upstream
   * a seen account is a an account that is involved in a TX that is upstream(older) in the queue
   * @param seenAccounts
   * @param queueEntry
   */
  processQueue_accountSeen(seenAccounts: SeenAccounts, queueEntry: QueueEntry): boolean {
    if (queueEntry.uniqueKeys == null) {
      //TSConversion double check if this needs extra logging
      return false
    }
    for (let key of queueEntry.uniqueKeys) {
      if (seenAccounts[key] != null) {
        return true
      }
    }
    return false
  }

  /**
   * processQueue_markAccountsSeen
   * Helper for processQueue to mark accounts as seen.
   *    note only operates on writeable accounts.  a read only account should not block downstream operations
   * a seen account is a an account that is involved in a TX that is upstream(older) in the queue
   * @param seenAccounts
   * @param queueEntry
   */
  processQueue_markAccountsSeen(seenAccounts: SeenAccounts, queueEntry: QueueEntry) {
    if (queueEntry.uniqueWritableKeys == null) {
      //TSConversion double check if this needs extra logging
      return
    }
    // only mark writeable keys as seen but we will check/clear against all keys
    for (let key of queueEntry.uniqueWritableKeys) {
      if (seenAccounts[key] == null) {
        seenAccounts[key] = queueEntry
      }
    }
  }

  /**
   * processQueue_clearAccountsSeen
   * Helper for processQueue to clear accounts that were marked as seen.
   * a seen account is a an account that is involved in a TX that is upstream(older) in the queue
   * @param seenAccounts
   * @param queueEntry
   */
  processQueue_clearAccountsSeen(seenAccounts: SeenAccounts, queueEntry: QueueEntry) {
    if (queueEntry.uniqueKeys == null) {
      //TSConversion double check if this needs extra logging
      return
    }
    for (let key of queueEntry.uniqueKeys) {
      if (seenAccounts[key] === queueEntry) {
        seenAccounts[key] = null
      }
    }
  }

  /**
   * Helper for processQueue to dump debug info
   * @param queueEntry
   * @param app
   */
  processQueue_debugAccountData(queueEntry: QueueEntry, app: Shardus.App): string {
    let debugStr = ''
    //if (logFlags.verbose) { //this function is always verbose
    if (queueEntry.uniqueKeys == null) {
      //TSConversion double check if this needs extra logging
      return utils.makeShortHash(queueEntry.acceptedTx.txId) + ' uniqueKeys empty error'
    }
    for (let key of queueEntry.uniqueKeys) {
      if (queueEntry.collectedData[key] != null) {
        debugStr += utils.makeShortHash(key) + ' : ' + app.getAccountDebugValue(queueEntry.collectedData[key]) + ', '
      }
    }
    //}
    return debugStr
  }

  /**
   * txWillChangeLocalData
   * This is a just in time check to see if a TX will modify any local accounts managed by this node.
   *
   * @param queueEntry
   */
  txWillChangeLocalData(queueEntry: QueueEntry): boolean {
    //if this TX modifies a global then return true since all nodes own all global accounts.
    if (queueEntry.globalModification) {
      return true
    }
    let timestamp = queueEntry.acceptedTx.timestamp
    let ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
    for (let key of queueEntry.uniqueWritableKeys) {
      if (this.stateManager.accountGlobals.isGlobalAccount(key)) {
        //ignore globals in non global mod tx.
        continue
      }

      let hasKey = false
      let { homePartition } = ShardFunctions.addressToPartition(this.stateManager.currentCycleShardData.shardGlobals, key)
      let nodeStoresThisPartition = ShardFunctions.testInRange(homePartition, ourNodeData.storedPartitions)
      // if (queueEntry.patchedOnNodes.has(ourNodeData.node.id)) {
      //   hasKey = true
      // }
      hasKey = nodeStoresThisPartition

      //if(queueEntry.localKeys[key] === true){
      if (hasKey) {
        let accountHash = this.stateManager.accountCache.getAccountHash(key)
        if (accountHash != null) {
          // if the timestamp of the TX is newer than any local writeable keys then this tx will change local data
          if (timestamp > accountHash.t) {
            return true
          }
        } else {
          //no cache entry means it will do something
          return true
        }
      }
    }
    return false
  }

  /**
   * This is a new function.  It must be called before calling dapp.apply().
   * The purpose is to do a last minute test to make sure that no involved accounts have a
   * timestamp newer than our transaction timestamp.
   * If they do have a newer timestamp we must fail the TX and vote for a TX fail receipt.
   */
  checkAccountTimestamps(queueEntry: QueueEntry): boolean {
    for (let accountID of Object.keys(queueEntry.involvedReads)) {
      let cacheEntry = this.stateManager.accountCache.getAccountHash(accountID)
      if (cacheEntry != null && cacheEntry.t >= queueEntry.acceptedTx.timestamp) {
        return false
      }
    }
    for (let accountID of Object.keys(queueEntry.involvedWrites)) {
      let cacheEntry = this.stateManager.accountCache.getAccountHash(accountID)
      if (cacheEntry != null && cacheEntry.t >= queueEntry.acceptedTx.timestamp) {
        return false
      }
    }
    return true
  }
}

export default TransactionQueue
