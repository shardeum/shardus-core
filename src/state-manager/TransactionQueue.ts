import { StateManager as StateManagerTypes } from '@shardus/types'
import StateManager from '.'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import * as Apoptosis from '../p2p/Apoptosis'
import * as Archivers from '../p2p/Archivers'
import { P2PModuleContext as P2P } from '../p2p/Context'
import * as CycleChain from '../p2p/CycleChain'
import { potentiallyRemoved } from '../p2p/NodeList'
import * as Shardus from '../shardus/shardus-types'
import Storage from '../storage'
import * as utils from '../utils'
import { errorToStringFull, inRangeOfCurrentTime, stringify, withTimeout, XOR } from '../utils'
import { nestedCountersInstance } from '../utils/nestedCounters'
import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'
import ShardFunctions from './shardFunctions'
import {
  AcceptedTx,
  AccountFilter,
  AppliedReceipt,
  CommitConsensedTransactionResult,
  PreApplyAcceptedTransactionResult,
  ProcessQueueStats,
  QueueCountsResult,
  QueueEntry,
  RequestReceiptForTxResp,
  RequestReceiptForTxResp_old,
  RequestStateForTxReq,
  RequestStateForTxResp,
  SeenAccounts,
  SimpleNumberStats,
  StringBoolObjectMap,
  StringNodeObjectMap,
  TxDebug,
  WrappedResponses,
} from './state-manager-types'
import { isInternalTxAllowed, networkMode } from '../p2p/Modes'
import { Node } from '@shardus/types/build/src/p2p/NodeListTypes'
import { Logger as L4jsLogger } from 'log4js'
import { shardusGetTime } from '../network'

interface Receipt {
  tx: AcceptedTx
}

const txStatBucketSize = {
  default: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 10000],
}

export enum DebugComplete {
  Incomplete = 0,
  Completed = 1,
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

  mainLogger: L4jsLogger
  fatalLogger: L4jsLogger
  shardLogger: L4jsLogger
  statsLogger: L4jsLogger
  statemanager_fatal: (key: string, log: string) => void

  _transactionQueue: QueueEntry[] //old name: newAcceptedTxQueue
  pendingTransactionQueue: QueueEntry[] //old name: newAcceptedTxQueueTempInjest
  archivedQueueEntries: QueueEntry[]
  txDebugStatList: TxDebug[]

  _transactionQueueByID: Map<string, QueueEntry> //old name: newAcceptedTxQueueByID
  pendingTransactionQueueByID: Map<string, QueueEntry> //old name: newAcceptedTxQueueTempInjestByID
  archivedQueueEntriesByID: Map<string, QueueEntry>
  receiptsToForward: Receipt[]
  forwardedReceipts: Map<string, boolean>
  oldNotForwardedReceipts: Map<string, boolean>
  receiptsBundleByInterval: Map<number, Receipt[]>
  receiptsForwardedTimestamp: number
  lastReceiptForwardResetTimestamp: number

  queueStopped: boolean
  queueEntryCounter: number
  queueRestartCounter: number

  archivedQueueEntryMaxCount: number
  transactionProcessingQueueRunning: boolean //archivedQueueEntryMaxCount is a maximum amount of queue entries to store, usually we should never have this many stored since tx age will be used to clean up the list

  processingLastRunTime: number
  processingMinRunBreak: number
  transactionQueueHasRemainingWork: boolean

  executeInOneShard: boolean
  useNewPOQ: boolean

  txCoverageMap: { [key: symbol]: unknown }

  /** This is a set of updates to rework how TXs can time out in the queue.  After a enough testing this should become the default and we can remove the old code */
  queueTimingFixes: boolean

  /** process loop stats.  This map contains the latest and the last of each time overage category */
  lastProcessStats: { [limitName: string]: ProcessQueueStats }

  largePendingQueueReported: boolean

  queueReads: Set<string>
  queueWrites: Set<string>
  queueReadWritesOld: Set<string>

  /** is the processing queue currently considered stuck */
  isStuckProcessing: boolean
  /** this s how many times the processing queue has transitioned from unstuck to stuck */
  stuckProcessingCount: number
  /** this is how many cycles processing is stuck becuase it has not run recently  */
  stuckProcessingCyclesCount: number
  /** this is how many cycles processing is stuck and we can confirm the queue did not finish  */
  stuckProcessingQueueLockedCyclesCount: number

  /** these three strings help us have a trail if the processing queue becomes stuck */
  debugLastAwaitedCall: string
  debugLastAwaitedCallInner: string
  debugLastAwaitedAppCall: string

  debugLastAwaitedCallInnerStack: { [key: string]: number }
  debugLastAwaitedAppCallStack: { [key: string]: number }

  debugLastProcessingQueueStartTime: number

  debugRecentQueueEntry: QueueEntry

  constructor(
    stateManager: StateManager,
    profiler: Profiler,
    app: Shardus.App,
    logger: Logger,
    storage: Storage,
    p2p: P2P,
    crypto: Crypto,
    config: Shardus.StrictServerConfiguration
  ) {
    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler
    this.p2p = p2p
    this.storage = storage
    this.stateManager = stateManager
    this.useNewPOQ = this.config.stateManager.useNewPOQ

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal

    this.queueStopped = false
    this.queueEntryCounter = 0
    this.queueRestartCounter = 0

    this._transactionQueue = []
    this.pendingTransactionQueue = []
    this.archivedQueueEntries = []
    this.txDebugStatList = []
    this.receiptsToForward = []
    this.forwardedReceipts = new Map()
    this.oldNotForwardedReceipts = new Map()
    this.lastReceiptForwardResetTimestamp = shardusGetTime()
    this.receiptsBundleByInterval = new Map()
    this.receiptsForwardedTimestamp = shardusGetTime()

    this._transactionQueueByID = new Map()
    this.pendingTransactionQueueByID = new Map()
    this.archivedQueueEntriesByID = new Map()

    this.archivedQueueEntryMaxCount = 5000 // was 50000 but this too high
    // 10k will fit into memory and should persist long enough at desired loads
    this.transactionProcessingQueueRunning = false

    this.processingLastRunTime = 0
    this.processingMinRunBreak = 10 //20 //200ms breaks between processing loops
    this.transactionQueueHasRemainingWork = false

    this.executeInOneShard = false

    if (this.config.sharding.executeInOneShard === true) {
      this.executeInOneShard = true
    }

    this.txCoverageMap = {}

    this.queueTimingFixes = true

    this.lastProcessStats = {}

    this.largePendingQueueReported = false

    this.isStuckProcessing = false
    this.stuckProcessingCount = 0
    this.stuckProcessingCyclesCount = 0
    this.stuckProcessingQueueLockedCyclesCount = 0

    this.debugLastAwaitedCall = ''
    this.debugLastAwaitedCallInner = ''
    this.debugLastAwaitedAppCall = ''
    this.debugLastProcessingQueueStartTime = 0

    this.debugLastAwaitedCallInnerStack = {}
    this.debugLastAwaitedAppCallStack = {}

    this.debugRecentQueueEntry = null
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

  setupHandlers(): void {
    this.p2p.registerInternal(
      'broadcast_state',
      async (payload: { txid: string; stateList: Shardus.WrappedResponse[] }) => {
        profilerInstance.scopedProfileSectionStart('broadcast_state')
        try {
          // Save the wrappedAccountState with the rest our queue data
          // let message = { stateList: datas, txid: queueEntry.acceptedTX.id }
          // this.p2p.tell([correspondingEdgeNode], 'broadcast_state', message)

          // make sure we have it
          const queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
          if (queueEntry == null) {
            //In the past we would enqueue the TX, expecially if syncing but that has been removed.
            //The normal mechanism of sharing TXs is good enough.
            return
          }
          // add the data in
          for (const data of payload.stateList) {
            this.queueEntryAddData(queueEntry, data)
            if (queueEntry.state === 'syncing') {
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastData', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
            }
          }
        } finally {
          profilerInstance.scopedProfileSectionEnd('broadcast_state')
        }
      }
    )

    this.p2p.registerInternal(
      'broadcast_finalstate',
      async (payload: { txid: string; stateList: Shardus.WrappedResponse[] }) => {
        profilerInstance.scopedProfileSectionStart('broadcast_finalstate')
        try {
          if (logFlags.debug)
            this.mainLogger.debug(`broadcast_finalstate ${payload.txid}, ${stringify(payload.stateList)}`)
          // make sure we have it
          const queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
          if (queueEntry == null) {
            //In the past we would enqueue the TX, expecially if syncing but that has been removed.
            //The normal mechanism of sharing TXs is good enough.
            return
          }
          // add the data in
          for (const data of payload.stateList) {
            //let wrappedResponse = data as Shardus.WrappedResponse
            //this.queueEntryAddData(queueEntry, data)
            if (data == null) {
              /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`broadcast_finalstate data == null`)
              continue
            }
            if (queueEntry.collectedFinalData[data.accountId] == null) {
              queueEntry.collectedFinalData[data.accountId] = data
              /* prettier-ignore */ if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('broadcast_finalstate', `${queueEntry.logID}`, `broadcast_finalstate addFinalData qId: ${queueEntry.entryID} data:${utils.makeShortHash(data.accountId)} collected keys: ${utils.stringifyReduce(Object.keys(queueEntry.collectedFinalData))}`)
            }

            // if (queueEntry.state === 'syncing') {
            //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastfinalstate', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
            // }
          }
        } finally {
          profilerInstance.scopedProfileSectionEnd('broadcast_finalstate')
        }
      }
    )

    this.p2p.registerInternal(
      'spread_tx_to_group_syncing',
      async (payload: Shardus.AcceptedTx, _respondWrapped: unknown, sender: Node) => {
        profilerInstance.scopedProfileSectionStart('spread_tx_to_group_syncing')
        try {
          //handleSharedTX will also validate fields
          this.handleSharedTX(payload.data, payload.appData, sender)
        } finally {
          profilerInstance.scopedProfileSectionEnd('spread_tx_to_group_syncing')
        }
      }
    )

    this.p2p.registerGossipHandler(
      'spread_tx_to_group',
      async (
        payload: { data: Shardus.OpaqueTransaction; appData: unknown },
        sender: Node,
        tracker: string,
        msgSize: number
      ) => {
        profilerInstance.scopedProfileSectionStart('spread_tx_to_group', false, msgSize)
        let respondSize = cUninitializedSize
        try {
          // Place tx in queue (if younger than m)
          //  gossip 'spread_tx_to_group' to transaction group

          //handleSharedTX will also validate fields.  payload is an AcceptedTX so must pass in the .data as the rawTX
          const queueEntry = this.handleSharedTX(payload.data, payload.appData, sender)
          if (queueEntry == null) {
            return
          }

          // get transaction group
          const transactionGroup = this.queueEntryGetTransactionGroup(queueEntry)
          if (queueEntry.ourNodeInTransactionGroup === false) {
            return
          }
          if (transactionGroup.length > 1) {
            this.stateManager.debugNodeGroup(
              queueEntry.acceptedTx.txId,
              queueEntry.acceptedTx.timestamp,
              `spread_tx_to_group transactionGroup:`,
              transactionGroup
            )
            respondSize = await this.p2p.sendGossipIn(
              'spread_tx_to_group',
              payload,
              tracker,
              sender,
              transactionGroup,
              false
            )
            /* prettier-ignore */ if (logFlags.verbose) console.log( 'queueEntry.isInExecutionHome', queueEntry.acceptedTx.txId, queueEntry.isInExecutionHome )
            // If our node is in the execution group, forward this raw tx to the subscribed archivers
            if (queueEntry.isInExecutionHome === true) {
              /* prettier-ignore */ if (logFlags.verbose) console.log('originalTxData', queueEntry.acceptedTx.txId)
              const { acceptedTx } = queueEntry
              const originalTxData = {
                txId: acceptedTx.txId,
                originalTxData: acceptedTx.data,
                cycle: queueEntry.cycleToRecordOn,
                timestamp: acceptedTx.timestamp,
              }
              const signedOriginalTxData: any = this.crypto.sign(originalTxData)
              Archivers.instantForwardOriginalTxData(signedOriginalTxData)
            }
          }
        } finally {
          profilerInstance.scopedProfileSectionEnd('spread_tx_to_group', respondSize)
        }
      }
    )

    /**
     * request_state_for_tx
     * used by the transaction queue when a queue entry needs to ask for missing state
     */
    this.p2p.registerInternal(
      'request_state_for_tx',
      async (payload: RequestStateForTxReq, respond: (arg0: RequestStateForTxResp) => unknown) => {
        profilerInstance.scopedProfileSectionStart('request_state_for_tx')
        try {
          const response: RequestStateForTxResp = {
            stateList: [],
            beforeHashes: {},
            note: '',
            success: false,
          }
          // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
          let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
          if (queueEntry == null) {
            queueEntry = this.getQueueEntryArchived(payload.txid, 'request_state_for_tx') // , payload.timestamp)
          }

          if (queueEntry == null) {
            response.note = `failed to find queue entry: ${utils.stringifyReduce(payload.txid)}  ${
              payload.timestamp
            } dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txid)]}`
            await respond(response)
            // if a node cant get data it will have to get repaired by the patcher since we can only keep stuff en the archive queue for so long
            // due to memory concerns
            return
          }

          for (const key of payload.keys) {
            // eslint-disable-next-line security/detect-object-injection
            const data = queueEntry.originalData[key] // collectedData
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
      }
    )
  }

  handleSharedTX(tx: Shardus.OpaqueTransaction, appData: unknown, sender: Shardus.Node): QueueEntry {
    const internalTx = this.app.isInternalTx(tx)
    if ((internalTx && !isInternalTxAllowed()) || (!internalTx && networkMode !== 'processing')) {
      // Block invalid txs in case a node maliciously relays them to other nodes
      return null
    }
    // Perform fast validation of the transaction fields
    const validateResult = this.app.validate(tx, appData)
    if (validateResult.success === false) {
      this.statemanager_fatal(
        `spread_tx_to_group_validateTX`,
        `spread_tx_to_group validateTxnFields failed: ${utils.stringifyReduce(validateResult)}`
      )
      return null
    }

    // Ask App to crack open tx and return timestamp, id (hash), and keys
    const { timestamp, id, keys, shardusMemoryPatterns } = this.app.crack(tx, appData)

    // Check if we already have this tx in our queue
    let queueEntry = this.getQueueEntrySafe(id) // , payload.timestamp)
    if (queueEntry) {
      return null
    }

    // Need to review these timeouts before main net.  what bad things can happen by setting a timestamp too far in the future or past.
    // only a subset of transactions can have timestamp set by the sender while others use independent consensus (askTxnTimestampFromNode)
    // but that is up to the dapp
    const mostOfQueueSitTimeMs = this.stateManager.queueSitTime * 0.9
    const txExpireTimeMs = this.config.transactionExpireTime * 1000
    const age = shardusGetTime() - timestamp
    if (inRangeOfCurrentTime(timestamp, mostOfQueueSitTimeMs, txExpireTimeMs) === false) {
      /* prettier-ignore */ this.statemanager_fatal( `spread_tx_to_group_OldTx_or_tooFuture`, 'spread_tx_to_group cannot accept tx with age: ' + age )
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_spread_tx_to_groupToOldOrTooFuture', '', 'spread_tx_to_group working on tx with age: ' + age)
      return null
    }

    // Pack into AcceptedTx for routeAndQueueAcceptedTransaction
    const acceptedTx: AcceptedTx = {
      timestamp,
      txId: id,
      keys,
      data: tx,
      appData,
      shardusMemoryPatterns,
    }

    const noConsensus = false // this can only be true for a set command which will never come from an endpoint
    const added = this.routeAndQueueAcceptedTransaction(
      acceptedTx,
      /*sendGossip*/ false,
      sender,
      /*globalModification*/ false,
      noConsensus
    )
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
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('spread_tx_to_group_noQE', '', `spread_tx_to_group failed: cant find queueEntry for:  ${utils.makeShortHash(id)}`)
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
  async getAccountsStateHash(
    accountStart = '0'.repeat(64),
    accountEnd = 'f'.repeat(64),
    tsStart = 0,
    tsEnd = shardusGetTime()
  ): Promise<string> {
    const accountStates = await this.storage.queryAccountStateTable(
      accountStart,
      accountEnd,
      tsStart,
      tsEnd,
      100000000
    )

    const seenAccounts = new Set()

    //only hash one account state per account. the most recent one!
    const filteredAccountStates = []
    for (let i = accountStates.length - 1; i >= 0; i--) {
      // eslint-disable-next-line security/detect-object-injection
      const accountState: Shardus.StateTableObject = accountStates[i]

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

    const acceptedTX = queueEntry.acceptedTx
    const wrappedStates = queueEntry.collectedData
    const localCachedData = queueEntry.localCachedData
    const tx = acceptedTX.data
    const keysResponse = queueEntry.txKeys
    const { timestamp, debugInfo } = keysResponse
    const uniqueKeys = queueEntry.uniqueKeys
    let accountTimestampsAreOK = true
    let ourLockID = -1
    let ourAccountLocks = null
    let applyResponse: Shardus.ApplyResponse | null = null
    const isGlobalModifyingTX = queueEntry.globalModification === true
    let passedApply = false
    let applyResult: string
    const appData = acceptedTX.appData

    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log('preApplyTransaction ' + timestamp + ' debugInfo:' + debugInfo)
    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('preApplyTransaction ' + timestamp + ' debugInfo:' + debugInfo)

    //TODO need to adjust logic to add in more stuff.
    // may only need this in the case where we have hopped over to another shard or additional
    // accounts were passed in.  And that me handled earlier.

    /* eslint-disable security/detect-object-injection */
    for (const key of uniqueKeys) {
      if (wrappedStates[key] == null) {
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log(`preApplyTransaction missing some account data. timestamp:${timestamp}  key: ${utils.makeShortHash(key)}  debuginfo:${debugInfo}`)
        return { applied: false, passed: false, applyResult: '', reason: 'missing some account data' }
      } else {
        const wrappedState = wrappedStates[key]
        wrappedState.prevStateId = wrappedState.stateId
        wrappedState.prevDataCopy = utils.deepCopy(wrappedState.data)

        // important to update the wrappedState timestamp here to prevent bad timestamps from propagating the system
        const { timestamp: updatedTimestamp } = this.app.getTimestampAndHashFromAccount(wrappedState.data)
        wrappedState.timestamp = updatedTimestamp

        // check if current account timestamp is too new for this TX
        if (wrappedState.timestamp >= timestamp) {
          accountTimestampsAreOK = false
          break
        }
      }
    }
    /* eslint-enable security/detect-object-injection */

    if (!accountTimestampsAreOK) {
      if (logFlags.verbose) this.mainLogger.debug('preApplyTransaction pretest failed: ' + timestamp)
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tx_preapply_rejected 1', `${acceptedTX.txId}`, `Transaction: ${utils.stringifyReduce(acceptedTX)}`)
      return {
        applied: false,
        passed: false,
        applyResult: '',
        reason: 'preApplyTransaction pretest failed, TX rejected',
      }
    }

    try {
      if (logFlags.verbose) {
        this.mainLogger.debug(
          `preApplyTransaction  txid:${utils.stringifyReduce(
            acceptedTX.txId
          )} ts:${timestamp} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}`
        )
        this.mainLogger.debug(`preApplyTransaction  filter: ${utils.stringifyReduce(queueEntry.localKeys)}`)
        this.mainLogger.debug(`preApplyTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
        this.mainLogger.debug(`preApplyTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)
        this.mainLogger.debug(
          `preApplyTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}`
        )
      }

      // TODO ARCH REVIEW:  review use of fifo lock of accountModification and account keys.
      // I think we need to consider adding reader-writer lock support so that a non written to global account is a "reader" lock: check but dont aquire
      // consider if it is safe to axe the use of fifolock accountModification.

      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('preApplyTransaction-bulkFifoLockAccounts')
      /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` preApplyTransaction FIFO lock outer: ${utils.stringifyReduce(uniqueKeys)} `)
      ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(uniqueKeys)
      /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(` preApplyTransaction FIFO lock inner: ${utils.stringifyReduce(uniqueKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('preApplyTransaction-bulkFifoLockAccounts', DebugComplete.Completed)

      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('preApplyTransaction-fifoLock(accountModification)')
      ourLockID = await this.stateManager.fifoLock('accountModification')
      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('preApplyTransaction-fifoLock(accountModification)', DebugComplete.Completed)

      this.profiler.profileSectionStart('process-dapp.apply')
      this.profiler.scopedProfileSectionStart('apply_duration')
      const startTime = process.hrtime()

      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('stateManager.transactionQueue.app.apply(tx)')
      applyResponse = await this.app.apply(tx as Shardus.OpaqueTransaction, wrappedStates, appData)
      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('stateManager.transactionQueue.app.apply(tx)', DebugComplete.Completed)
      const endTime = process.hrtime(startTime)
      queueEntry.txDebug.duration['apply_duration'] = endTime[1] / 1000000
      this.profiler.scopedProfileSectionEnd('apply_duration')
      this.profiler.profileSectionEnd('process-dapp.apply')
      if (applyResponse == null) {
        throw Error('null response from app.apply')
      }

      // check accountWrites of applyResponse
      if (this.config.debug.checkTxGroupChanges && applyResponse.accountWrites.length > 0) {
        const transactionGroupIDs = new Set(queueEntry.transactionGroup.map((node) => node.id))
        for (const account of applyResponse.accountWrites) {
          let txGroupCycle = queueEntry.txGroupCycle
          if (txGroupCycle > CycleChain.newest.counter) {
            txGroupCycle = CycleChain.newest.counter
          }
          const cycleShardDataForTx = this.stateManager.shardValuesByCycle.get(txGroupCycle)
          const fixHomeNodeCheckForTXGroupChanges =
            this.config.features.fixHomeNodeCheckForTXGroupChanges ?? false

          const homeNode = fixHomeNodeCheckForTXGroupChanges
            ? ShardFunctions.findHomeNode(
                cycleShardDataForTx.shardGlobals,
                account.accountId,
                cycleShardDataForTx.parititionShardDataMap
              )
            : ShardFunctions.findHomeNode(
                this.stateManager.currentCycleShardData.shardGlobals,
                account.accountId,
                this.stateManager.currentCycleShardData.parititionShardDataMap
              )

          let isUnexpectedAccountWrite = false
          for (const storageNode of homeNode.nodeThatStoreOurParitionFull) {
            const isStorageNodeInTxGroup = transactionGroupIDs.has(storageNode.id)
            if (!isStorageNodeInTxGroup) {
              isUnexpectedAccountWrite = true
              /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug( `preApplyTransaction Storage node ${storageNode.id} of accountId ${account.accountId} is not in transaction group` )
              break
            }
          }
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug( `preApplyTransaction isUnexpectedAccountWrite for account ${account.accountId}`, isUnexpectedAccountWrite )
          if (isUnexpectedAccountWrite) {
            applyResponse.failed = true
            applyResponse.failMessage = `preApplyTransaction unexpected account ${account.accountId} is not covered by transaction group`
          }
        }
      }

      if (applyResponse.failed === true) {
        passedApply = false
        applyResult = applyResponse.failMessage
      } else {
        passedApply = true
        applyResult = 'applied'
      }
      /* prettier-ignore */
      if (logFlags.verbose) this.mainLogger.debug(`preApplyTransaction ${queueEntry.logID} post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`);
      /* prettier-ignore */ if (this.stateManager.consensusLog) this.mainLogger.debug(`preApplyTransaction ${queueEntry.logID} completed.`)

      //applyResponse = queueEntry?.preApplyTXResult?.applyResponse
      //super verbose option:
      /* prettier-ignore */
      if (logFlags.verbose && applyResponse != null) this.mainLogger.debug(`preApplyTransaction ${queueEntry.logID}  post applyResponse: ${utils.stringifyReduce(applyResponse)}`);
    } catch (ex) {
      /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`preApplyTransaction failed id:${utils.makeShortHash(acceptedTX.txId)}: ` + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`preApplyTransaction failed id:${utils.makeShortHash(acceptedTX.txId)}  ${utils.stringifyReduce(acceptedTX)}`)

      this.profiler.scopedProfileSectionEnd('apply_duration')
      passedApply = false
      applyResult = ex.message
    } finally {
      this.stateManager.fifoUnlock('accountModification', ourLockID)

      if (ourAccountLocks != null) {
        this.stateManager.bulkFifoUnlockAccounts(uniqueKeys, ourAccountLocks)
      }
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(` preApplyTransaction FIFO unlock inner: ${utils.stringifyReduce(uniqueKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
    }

    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tx_preapplied', `${acceptedTX.txId}`, `preApplyTransaction ${timestamp} `)
    if (logFlags.verbose) this.mainLogger.debug(`preApplyTransaction ${timestamp}`)

    return {
      applied: true,
      passed: passedApply,
      applyResult: applyResult,
      reason: 'apply result',
      applyResponse: applyResponse,
    }
  }

  configUpdated(): void {
    this.useNewPOQ = this.config.stateManager.useNewPOQ
    console.log('Config updated for stateManager.useNewPOQ', this.useNewPOQ)
    nestedCountersInstance.countEvent('stateManager', `useNewPOQ config updated to ${this.useNewPOQ}`)
  }

  resetTxCoverageMap(): void {
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
    let accountDataList: string | unknown[]
    let uniqueKeys = []
    let ourAccountLocks = null
    const acceptedTX = queueEntry.acceptedTx
    let wrappedStates = this.stateManager.useAccountWritesOnly ? {} : queueEntry.collectedData
    const localCachedData = queueEntry.localCachedData
    const keysResponse = queueEntry.txKeys
    const { timestamp, debugInfo } = keysResponse
    const applyResponse = queueEntry?.preApplyTXResult?.applyResponse
    const isGlobalModifyingTX = queueEntry.globalModification === true
    let savedSomething = false
    try {
      this.profiler.profileSectionStart('commit-1-setAccount')
      if (logFlags.verbose) {
        /* prettier-ignore */ this.mainLogger.debug( `commitConsensedTransaction  ts:${timestamp} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}` )
        /* prettier-ignore */ this.mainLogger.debug( `commitConsensedTransaction  filter: ${utils.stringifyReduce(queueEntry.localKeys)}` )
        /* prettier-ignore */ this.mainLogger.debug(`commitConsensedTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
        /* prettier-ignore */ this.mainLogger.debug( `commitConsensedTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}` )
        /* prettier-ignore */ this.mainLogger.debug( `commitConsensedTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}` )
        /* prettier-ignore */ this.mainLogger.debug(`commitConsensedTransaction  queueEntry: ${utils.stringifyReduce(queueEntry)}`)
      }
      // TODO ARCH REVIEW:  review use of fifo lock of accountModification and account keys. (more notes in tryPreApplyTransaction() above )

      uniqueKeys = queueEntry.uniqueKeys

      /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`commitConsensedTransaction FIFO lock outer: ${utils.stringifyReduce(uniqueKeys)} `)
      // TODO Perf (for sharded networks).  consider if we can remove this lock
      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('commit this.stateManager.bulkFifoLockAccounts')
      ourAccountLocks = await this.stateManager.bulkFifoLockAccounts(uniqueKeys)
      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('commit this.stateManager.bulkFifoLockAccounts', DebugComplete.Completed)
      /* prettier-ignore */ if (logFlags.verbose && this.stateManager.extendedRepairLogging) this.mainLogger.debug(`commitConsensedTransaction FIFO lock inner: ${utils.stringifyReduce(uniqueKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)

      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('commit this.stateManager.fifoLock')
      ourLockID = await this.stateManager.fifoLock('accountModification')
      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('commit this.stateManager.fifoLock', DebugComplete.Completed)

      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log(`commitConsensedTransaction tx:${queueEntry.logID} ts:${timestamp} Applying!`)
      // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('APPSTATE: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))

      //let { stateTableResults, accountData: _accountdata } = applyResponse
      let stateTableResults = null
      let _accountdata = []

      if (applyResponse != null) {
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

      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction tx:${queueEntry.logID} ts:${timestamp} accounts: ${utils.stringifyReduce(Object.keys(wrappedStates))}  `)
      //create a temp map for state table logging below.
      //importantly, we override the wrappedStates with writtenAccountsMap if there is any accountWrites used
      //this should mean dapps don't have to use this feature.  (keeps simple dapps simpler)
      const writtenAccountsMap: WrappedResponses = {}
      if (
        applyResponse != null &&
        applyResponse.accountWrites != null &&
        applyResponse.accountWrites.length > 0
      ) {
        const collectedData = queueEntry.collectedData
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log(`commitConsensedTransaction collectedData: ${utils.stringifyReduce(collectedData)}`)
        for (const writtenAccount of applyResponse.accountWrites) {
          writtenAccountsMap[writtenAccount.accountId] = writtenAccount.data
          writtenAccountsMap[writtenAccount.accountId].prevStateId = collectedData[writtenAccount.accountId]
            ? collectedData[writtenAccount.accountId].stateId
            : ''
          writtenAccountsMap[writtenAccount.accountId].prevDataCopy = collectedData[writtenAccount.accountId]
            ? utils.deepCopy(collectedData[writtenAccount.accountId].data)
            : {}
          // writtenAccountsMap[writtenAccount.accountId].prevDataCopy = collectedData[writtenAccount.accountId] ? utils.deepCopy(writtenAccount.data) : {}
        }
        //override wrapped states with writtenAccountsMap which should be more complete if it included
        wrappedStates = writtenAccountsMap
        /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction applyResponse.accountWrites tx:${queueEntry.logID} ts:${timestamp} accounts: ${utils.stringifyReduce(Object.keys(wrappedStates))}  `)
      }

      //If we are not in the execution home then use data that was sent to us for the commit
      if (
        queueEntry.globalModification === false &&
        this.executeInOneShard &&
        queueEntry.isInExecutionHome === false
      ) {
        //looks like this next line could be wiping out state from just above that used accountWrites
        //we have a task to refactor his code that needs to happen for executeInOneShard to work
        wrappedStates = {}
        /* eslint-disable security/detect-object-injection */
        for (const key of Object.keys(queueEntry.collectedFinalData)) {
          const finalAccount = queueEntry.collectedFinalData[key]
          const accountId = finalAccount.accountId

          //finalAccount.prevStateId = wrappedStates[accountId] ? wrappedStates[accountId].stateId : ''
          //finalAccount.prevDataCopy = wrappedStates[accountId] ? utils.deepCopy(wrappedStates[accountId].data) : {}
          const prevStateCalc = wrappedStates[accountId] ? wrappedStates[accountId].stateId : ''
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction collectedFinalData tx:${queueEntry.logID} ts:${timestamp} ${utils.makeShortHash(finalAccount)} preveStateID: ${finalAccount.prevStateId } vs expected: ${prevStateCalc}`)

          wrappedStates[key] = finalAccount
        }
        /* eslint-enable security/detect-object-injection */
        /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction collectedFinalData tx:${queueEntry.logID} ts:${timestamp} accounts: ${utils.stringifyReduce(Object.keys(wrappedStates))}  `)
      }

      // set a filter based so we only save data for local accounts.  The filter is a slightly different structure than localKeys
      // decided not to try and merge them just yet, but did accomplish some cleanup of the filter logic
      const filter: AccountFilter = {}

      const nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData =
        this.stateManager.currentCycleShardData.nodeShardData
      //update the filter to contain any local accounts in accountWrites
      if (
        applyResponse != null &&
        applyResponse.accountWrites != null &&
        applyResponse.accountWrites.length > 0
      ) {
        for (const writtenAccount of applyResponse.accountWrites) {
          const isLocal = ShardFunctions.testAddressInRange(
            writtenAccount.accountId,
            nodeShardData.storedPartitions
          )
          if (isLocal) {
            filter[writtenAccount.accountId] = 1
          }
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  tx:${queueEntry.logID} ts:${timestamp} setWritefilter: ${isLocal}  acc:${writtenAccount.accountId} `)
        }
      }

      if (this.executeInOneShard && applyResponse == null && queueEntry.collectedFinalData != null) {
        for (const writtenAccount of Object.values(wrappedStates)) {
          const isLocal = ShardFunctions.testAddressInRange(
            writtenAccount.accountId,
            nodeShardData.storedPartitions
          )
          if (isLocal) {
            filter[writtenAccount.accountId] = 1
          }
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction queueEntry.collectedFinalData != null tx:${queueEntry.logID} ts:${timestamp} setWritefilter: ${isLocal}  acc:${writtenAccount.accountId} `)
        }
      }

      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction  post apply wrappedStates: ${utils.stringifyReduce(wrappedStates)}`)

      const note = `setAccountData: tx:${queueEntry.logID} in commitConsensedTransaction. `

      for (const key of Object.keys(queueEntry.localKeys)) {
        // eslint-disable-next-line security/detect-object-injection
        filter[key] = 1
      }

      const startTime = process.hrtime()
      this.profiler.scopedProfileSectionStart('commit_setAccount')
      const endTime = process.hrtime(startTime)
      queueEntry.txDebug.duration['commit_setAccount'] = endTime[1] / 1000000
      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.stateManager.setAccount')
      // wrappedStates are side effected for now
      savedSomething = await this.stateManager.setAccount(
        wrappedStates,
        localCachedData,
        applyResponse,
        isGlobalModifyingTX,
        filter,
        note
      )
      /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.stateManager.setAccount', DebugComplete.Completed)
      queueEntry.accountDataSet = true
      this.profiler.scopedProfileSectionEnd('commit_setAccount')
      if (savedSomething) {
        //todo implement if we need it?
      }

      if (logFlags.verbose) {
        this.mainLogger.debug(`commitConsensedTransaction  savedSomething: ${savedSomething}`)
        this.mainLogger.debug(
          `commitConsensedTransaction  accountData[${accountDataList.length}]: ${utils.stringifyReduce(
            accountDataList
          )}`
        )
        this.mainLogger.debug(
          `commitConsensedTransaction  stateTableResults[${
            stateTableResults.length
          }]: ${utils.stringifyReduce(stateTableResults)}`
        )
      }

      this.profiler.profileSectionEnd('commit-1-setAccount')
      this.profiler.profileSectionStart('commit-2-addAccountStatesAndTX')

      if (stateTableResults != null) {
        for (const stateT of stateTableResults) {
          let wrappedRespose = wrappedStates[stateT.accountId]

          //backup if we dont have the account in wrapped states (state table results is just for debugging now, and no longer used by sync)
          if (wrappedRespose == null) {
            wrappedRespose = writtenAccountsMap[stateT.accountId]
          }

          // we have to correct stateBefore because it now gets stomped in the vote, TODO cleaner fix?
          stateT.stateBefore = wrappedRespose.prevStateId

          if (logFlags.verbose) {
            /* prettier-ignore */ if (logFlags.console) console.log('writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter) + ' txid: ' + utils.makeShortHash(acceptedTX.txId) + ' ts: ' + acceptedTX.timestamp)
            this.mainLogger.debug(
              'writeStateTable ' +
                utils.makeShortHash(stateT.accountId) +
                ' before: ' +
                utils.makeShortHash(stateT.stateBefore) +
                ' after: ' +
                utils.makeShortHash(stateT.stateAfter) +
                ' txid: ' +
                utils.makeShortHash(acceptedTX.txId) +
                ' ts: ' +
                acceptedTX.timestamp
            )
          }
        }
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.storage.addAccountStates')
        await this.storage.addAccountStates(stateTableResults)
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.storage.addAccountStates', DebugComplete.Completed)
      }

      // write the accepted TX to storage
      this.storage.addAcceptedTransactions([acceptedTX])
      this.profiler.profileSectionEnd('commit-2-addAccountStatesAndTX')
      this.profiler.profileSectionStart('commit-3-transactionReceiptPass')
      // endpoint to allow dapp to execute something that depends on a transaction being approved.
      this.app.transactionReceiptPass(acceptedTX.data, wrappedStates, applyResponse)
      /* prettier-ignore */ if (logFlags.verbose) console.log('transactionReceiptPass', acceptedTX.txId, queueEntry)

      this.profiler.profileSectionEnd('commit-3-transactionReceiptPass')
    } catch (ex) {
      this.statemanager_fatal(
        `commitConsensedTransaction_ex`,
        'commitConsensedTransaction failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack
      )
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`commitConsensedTransaction failed id:${utils.makeShortHash(acceptedTX.txId)}  ${utils.stringifyReduce(acceptedTX)}`)
      return { success: false }
    } finally {
      this.stateManager.fifoUnlock('accountModification', ourLockID)

      if (ourAccountLocks != null) {
        this.stateManager.bulkFifoUnlockAccounts(uniqueKeys, ourAccountLocks)
      }
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`commitConsensedTransaction FIFO unlock inner: ${utils.stringifyReduce(uniqueKeys)} ourLocks: ${utils.stringifyReduce(ourAccountLocks)}`)
    }

    this.profiler.profileSectionStart('commit-4-updateAccountsCopyTable')
    // have to wrestle with the data a bit so we can backup the full account and not just the partial account!
    // let dataResultsByKey = {}
    const dataResultsFullList = []
    for (const wrappedData of applyResponse.accountData) {
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
    const upgradedAccountDataList: Shardus.AccountData[] =
      dataResultsFullList as unknown as Shardus.AccountData[]

    const repairing = false
    // TODO ARCH REVIEW:  do we still need this table (answer: yes for sync. for now.).  do we need to await writing to it?
    /* prettier-ignore */ this.setDebugLastAwaitedCallInner('stateManager.updateAccountsCopyTable')
    await this.stateManager.updateAccountsCopyTable(upgradedAccountDataList, repairing, timestamp)
    /* prettier-ignore */ this.setDebugLastAwaitedCallInner('stateManager.updateAccountsCopyTable', DebugComplete.Completed)

    //the first node in the TX group will emit txProcessed.  I think this it to prevent over reporting (one node per tx group will report)
    if (
      queueEntry != null &&
      queueEntry.transactionGroup != null &&
      this.p2p.getNodeId() === queueEntry.transactionGroup[0].id
    ) {
      if (queueEntry.globalModification === false) {
        //temp way to make global modifying TXs not over count
        this.stateManager.eventEmitter.emit('txProcessed')
      }
    }
    this.stateManager.eventEmitter.emit('txApplied', acceptedTX)

    this.profiler.profileSectionEnd('commit-4-updateAccountsCopyTable')

    this.profiler.profileSectionStart('commit-5-stats')
    // STATS update
    this.stateManager.partitionStats.statsTxSummaryUpdate(queueEntry.cycleToRecordOn, queueEntry)
    for (const wrappedData of applyResponse.accountData) {
      //let queueData = queueEntry.collectedData[wrappedData.accountId]
      const queueData = wrappedStates[wrappedData.accountId]
      if (queueData != null) {
        if (queueData.accountCreated) {
          //account was created to do a summary init
          this.stateManager.partitionStats.statsDataSummaryInit(
            queueEntry.cycleToRecordOn,
            queueData.accountId,
            queueData.prevDataCopy,
            'commit'
          )
        }
        this.stateManager.partitionStats.statsDataSummaryUpdate(
          queueEntry.cycleToRecordOn,
          queueData.prevDataCopy,
          wrappedData,
          'commit'
        )
      } else {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`commitConsensedTransaction failed to get account data for stats ${wrappedData.accountId}`)
      }
    }

    this.profiler.profileSectionEnd('commit-5-stats')

    return { success: true }
  }

  updateHomeInformation(txQueueEntry: QueueEntry): void {
    if (this.stateManager.currentCycleShardData != null && txQueueEntry.hasShardInfo === false) {
      const txId = txQueueEntry.acceptedTx.txId
      // Init home nodes!
      for (const key of txQueueEntry.txKeys.allKeys) {
        if (key == null) {
          throw new Error(`updateHomeInformation key == null ${key}`)
        }
        const homeNode = ShardFunctions.findHomeNode(
          this.stateManager.currentCycleShardData.shardGlobals,
          key,
          this.stateManager.currentCycleShardData.parititionShardDataMap
        )
        if (homeNode == null) {
          nestedCountersInstance.countRareEvent('fatal', 'updateHomeInformation homeNode == null')
          throw new Error(`updateHomeInformation homeNode == null ${key}`)
        }
        // eslint-disable-next-line security/detect-object-injection
        txQueueEntry.homeNodes[key] = homeNode
        if (homeNode == null) {
          /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(` routeAndQueueAcceptedTransaction: ${key} `)
          throw new Error(`updateHomeInformation homeNode == null ${txQueueEntry}`)
        }

        // calculate the partitions this TX is involved in for the receipt map
        const isGlobalAccount = this.stateManager.accountGlobals.isGlobalAccount(key)
        if (isGlobalAccount === true) {
          txQueueEntry.involvedPartitions.push(homeNode.homePartition)
          txQueueEntry.involvedGlobalPartitions.push(homeNode.homePartition)
        } else {
          txQueueEntry.involvedPartitions.push(homeNode.homePartition)
        }

        if (logFlags.playback) {
          // HOMENODEMATHS Based on home node.. should this be chaned to homepartition?
          const summaryObject = ShardFunctions.getHomeNodeSummaryObject(homeNode)
          const relationString = ShardFunctions.getNodeRelation(
            homeNode,
            this.stateManager.currentCycleShardData.ourNode.id
          )
          // route_to_home_node
          this.logger.playbackLogNote(
            'shrd_homeNodeSummary',
            `${txId}`,
            `account:${utils.makeShortHash(key)} rel:${relationString} summary:${utils.stringifyReduce(
              summaryObject
            )}`
          )
        }
      }

      txQueueEntry.hasShardInfo = true
    }
  }

  /* eslint-disable security/detect-object-injection */
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
  /* eslint-enable security/detect-object-injection */

  /***
   *    ######## ##    ##  #######  ##     ## ######## ##     ## ########
   *    ##       ###   ## ##     ## ##     ## ##       ##     ## ##
   *    ##       ####  ## ##     ## ##     ## ##       ##     ## ##
   *    ######   ## ## ## ##     ## ##     ## ######   ##     ## ######
   *    ##       ##  #### ##  ## ## ##     ## ##       ##     ## ##
   *    ##       ##   ### ##    ##  ##     ## ##       ##     ## ##
   *    ######## ##    ##  ##### ##  #######  ########  #######  ########
   */

  routeAndQueueAcceptedTransaction(
    acceptedTx: AcceptedTx,
    sendGossip = true,
    sender: Shardus.Node | null,
    globalModification: boolean,
    noConsensus: boolean
  ): string | boolean {
    // dropping these too early.. hmm  we finished syncing before we had the first shard data.
    // if (this.stateManager.currentCycleShardData == null) {
    //   // this.preTXQueue.push(acceptedTX)
    //   return 'notReady' // it is too early to care about the tx
    // }
    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('routeAndQueueAcceptedTransaction-debug', '', `sendGossip:${sendGossip} globalModification:${globalModification} noConsensus:${noConsensus} this.readyforTXs:${this.stateManager.accountSync.readyforTXs} hasshardData:${this.stateManager.currentCycleShardData != null} acceptedTx:${utils.stringifyReduce(acceptedTx)} `)
    if (this.stateManager.accountSync.readyforTXs === false) {
      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction too early for TX: this.readyforTXs === false`)
      return 'notReady' // it is too early to care about the tx
    }
    if (this.stateManager.currentCycleShardData == null) {
      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction too early for TX: this.stateManager.currentCycleShardData == null`)
      return 'notReady'
    }

    try {
      this.profiler.profileSectionStart('enqueue')

      if (this.stateManager.accountGlobals.hasknownGlobals == false) {
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction too early for TX: hasknownGlobals == false`)
        return 'notReady'
      }

      const keysResponse = acceptedTx.keys
      const timestamp = acceptedTx.timestamp
      const txId = acceptedTx.txId

      // This flag turns of consensus for all TXs for debuggging
      if (this.stateManager.debugNoTxVoting === true) {
        noConsensus = true
      }

      const cycleNumber = this.stateManager.currentCycleShardData.cycleNumber

      this.queueEntryCounter++
      const txQueueEntry: QueueEntry = {
        eligibleNodeIdsToConfirm: new Set(),
        eligibleNodeIdsToVote: new Set(),
        acceptedTx: acceptedTx,
        txKeys: keysResponse,
        executionShardKey: null,
        isInExecutionHome: true,
        shardusMemoryPatternSets: null,
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
        repairStarted: false,
        repairFailed: false,
        hasValidFinalData: false,
        pendingDataRequest: false,
        newVotes: false,
        fromClient: sendGossip,
        gossipedReceipt: false,
        gossipedVote: false,
        gossipedConfirmOrChallenge: false,
        completedConfirmedOrChallenge: false,
        uniqueChallengesCount: 0,
        uniqueChallenges: {},
        archived: false,
        ourTXGroupIndex: -1,
        ourExGroupIndex: -1,
        involvedReads: {},
        involvedWrites: {},
        txDebug: {
          enqueueHrTime: process.hrtime(),
          duration: {},
        },
        executionGroupMap: new Map(),
        txSieveTime: 0,
        debug: {},
        voteCastAge: 0,
        firstVoteReceivedTimestamp: 0,
        firstConfirmOrChallengeTimestamp: 0,
        lastVoteReceivedTimestamp: 0,
        lastConfirmOrChallengeTimestamp: 0,
        acceptVoteMessage: true,
        acceptConfirmOrChallenge: true,
        accountDataSet: false,
      } // age comes from timestamp

      // todo faster hash lookup for this maybe?
      const entry = this.getQueueEntrySafe(acceptedTx.txId) // , acceptedTx.timestamp)
      if (entry) {
        return false // already in our queue, or temp queue
      }

      txQueueEntry.logID = utils.makeShortHash(acceptedTx.txId)

      this.stateManager.debugTXHistory[txQueueEntry.logID] = 'enteredQueue'

      if (this.app.canDebugDropTx(acceptedTx.data)) {
        if (
          this.stateManager.testFailChance(
            this.stateManager.loseTxChance,
            'loseTxChance',
            txQueueEntry.logID,
            '',
            logFlags.verbose
          ) === true
        ) {
          return 'lost'
        }
        if (
          this.stateManager.testFailChance(
            this.stateManager.voteFlipChance,
            'voteFlipChance',
            txQueueEntry.logID,
            '',
            logFlags.verbose
          ) === true
        ) {
          txQueueEntry.debugFail_voteFlip = true
        }

        if (
          globalModification === false &&
          this.stateManager.testFailChance(
            this.stateManager.failNoRepairTxChance,
            'failNoRepairTxChance',
            txQueueEntry.logID,
            '',
            logFlags.verbose
          ) === true
        ) {
          txQueueEntry.debugFail_failNoRepair = true
        }
      }

      try {
        // use shardusGetTime() instead of Date.now as many thing depend on it
        const age = shardusGetTime() - timestamp

        const keyHash: StringBoolObjectMap = {} //TODO replace with Set<string>
        for (const key of txQueueEntry.txKeys.allKeys) {
          if (key == null) {
            // throw new Error(`routeAndQueueAcceptedTransaction key == null ${key}`)
            /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction key == null ${timestamp} not putting tx in queue.`)
            return false
          }

          // eslint-disable-next-line security/detect-object-injection
          keyHash[key] = true
        }
        txQueueEntry.uniqueKeys = Object.keys(keyHash)

        if (txQueueEntry.txKeys.allKeys == null || txQueueEntry.txKeys.allKeys.length === 0) {
          /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction allKeys == null || allKeys.length === 0 ${timestamp} not putting tx in queue.`)
          return false
        }

        this.updateHomeInformation(txQueueEntry)

        //set the executionShardKey for the transaction
        if (txQueueEntry.globalModification === false && this.executeInOneShard) {
          //USE the first key in the list of all keys.  Applications much carefully sort this list
          //so that we start in the optimal shard.  This will matter less when shard hopping is implemented
          txQueueEntry.executionShardKey = txQueueEntry.txKeys.allKeys[0]
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`routeAndQueueAcceptedTransaction set executionShardKey tx:${txQueueEntry.logID} ts:${timestamp} executionShardKey: ${utils.stringifyReduce(txQueueEntry.executionShardKey)}  `)

          // we were doing this in queueEntryGetTransactionGroup.  moved it earlier.
          const { homePartition } = ShardFunctions.addressToPartition(
            this.stateManager.currentCycleShardData.shardGlobals,
            txQueueEntry.executionShardKey
          )

          const homeShardData =
            this.stateManager.currentCycleShardData.parititionShardDataMap.get(homePartition)

          //set the nodes that are in the executionGroup.
          //This is needed so that consensus will expect less nodes to be voting
          const unRankedExecutionGroup = homeShardData.homeNodes[0].consensusNodeForOurNodeFull.slice()
          if (this.useNewPOQ) {
            txQueueEntry.executionGroup = this.orderNodesByRank(unRankedExecutionGroup, txQueueEntry)
          } else {
            txQueueEntry.executionGroup = unRankedExecutionGroup
          }

          if (txQueueEntry.isInExecutionHome) {
            txQueueEntry.ourNodeRank = this.computeNodeRank(
              this.stateManager.currentCycleShardData.ourNode.id,
              txQueueEntry.acceptedTx.txId,
              txQueueEntry.acceptedTx.timestamp
            )
          }

          const minNodesToVote = 3
          const voterPercentage = 0.1
          const numberOfVoters = Math.max(
            minNodesToVote,
            Math.floor(txQueueEntry.executionGroup.length * voterPercentage)
          )
          // voters are highest ranked nodes
          txQueueEntry.eligibleNodeIdsToVote = new Set(
            txQueueEntry.executionGroup.slice(0, numberOfVoters).map((node) => node.id)
          )
          // confirm nodes are lowest ranked nodes
          txQueueEntry.eligibleNodeIdsToConfirm = new Set(
            txQueueEntry.executionGroup
              .slice(txQueueEntry.executionGroup.length - numberOfVoters)
              .map((node) => node.id)
          )

          const ourID = this.stateManager.currentCycleShardData.ourNode.id
          for (let idx = 0; idx < txQueueEntry.executionGroup.length; idx++) {
            // eslint-disable-next-line security/detect-object-injection
            const node = txQueueEntry.executionGroup[idx]
            txQueueEntry.executionGroupMap.set(node.id, node)
            if (node.id === ourID) {
              txQueueEntry.ourExGroupIndex = idx
            }
          }

          //if we are not in the execution group then set isInExecutionHome to false
          if (
            txQueueEntry.executionGroupMap.has(this.stateManager.currentCycleShardData.ourNode.id) === false
          ) {
            txQueueEntry.isInExecutionHome = false
          }

          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`routeAndQueueAcceptedTransaction info ${txQueueEntry.logID} isInExecutionHome:${txQueueEntry.isInExecutionHome} hasShardInfo:${txQueueEntry.hasShardInfo}`)
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('routeAndQueueAcceptedTransaction', `routeAndQueueAcceptedTransaction info ${txQueueEntry.logID} isInExecutionHome:${txQueueEntry.isInExecutionHome} hasShardInfo:${txQueueEntry.hasShardInfo} executionShardKey:${utils.makeShortHash(txQueueEntry.executionShardKey)}`)
          /* prettier-ignore */ if (this.stateManager.consensusLog) this.mainLogger.debug(`routeAndQueueAcceptedTransaction info ${txQueueEntry.logID} isInExecutionHome:${txQueueEntry.isInExecutionHome}`)
        }

        // calculate information needed for receiptmap
        //txQueueEntry.cycleToRecordOn = this.stateManager.getCycleNumberFromTimestamp(timestamp)
        txQueueEntry.cycleToRecordOn = CycleChain.getCycleNumberFromTimestamp(timestamp)
        /* prettier-ignore */ if (logFlags.verbose) console.log('Cycle number from timestamp', timestamp, txQueueEntry.cycleToRecordOn)
        if (txQueueEntry.cycleToRecordOn < 0) {
          nestedCountersInstance.countEvent('getCycleNumberFromTimestamp', 'caused Enqueue fail')
          /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction failed to calculate cycle ${timestamp} error code:${txQueueEntry.cycleToRecordOn}`)
          return false
        }
        if (txQueueEntry.cycleToRecordOn == null) {
          this.statemanager_fatal(
            `routeAndQueueAcceptedTransaction cycleToRecordOn==null`,
            `routeAndQueueAcceptedTransaction cycleToRecordOn==null  ${txQueueEntry.logID} ${timestamp}`
          )
        }

        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueInsertion_start', txQueueEntry.logID, `${txQueueEntry.logID} uniqueKeys:${utils.stringifyReduce(txQueueEntry.uniqueKeys)}  txKeys: ${utils.stringifyReduce(txQueueEntry.txKeys)} cycleToRecordOn:${txQueueEntry.cycleToRecordOn}`)

        // Look at our keys and log which are known global accounts.  Set global accounts for keys if this is a globalModification TX
        for (const key of txQueueEntry.uniqueKeys) {
          if (globalModification === true) {
            if (this.stateManager.accountGlobals.isGlobalAccount(key)) {
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', `routeAndQueueAcceptedTransaction - has account:${utils.stringifyReduce(key)}`)
            } else {
              //this makes the code aware that this key is for a global account.
              //is setting this here too soon?
              //it should be that p2p has already checked the receipt before calling shardus.push with global=true
              this.stateManager.accountGlobals.setGlobalAccount(key)
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', `routeAndQueueAcceptedTransaction - set account:${utils.stringifyReduce(key)}`)
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
        //     /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_queued_and_set_syncing', `${txQueueEntry.logID}`, `${txQueueEntry.logID} qId: ${txQueueEntry.entryID} account:${utils.stringifyReduce(key)}`)
        //   }
        // }

        if (age > this.stateManager.queueSitTime * 0.9) {
          if (txQueueEntry.didSync === true) {
            /* prettier-ignore */ nestedCountersInstance.countEvent('stateManager', `enqueue old TX didSync === true queuedBeforeMainSyncComplete:${txQueueEntry.queuedBeforeMainSyncComplete}`)
          } else {
            /* prettier-ignore */ nestedCountersInstance.countEvent('stateManager', `enqueue old TX didSync === false queuedBeforeMainSyncComplete:${txQueueEntry.queuedBeforeMainSyncComplete}`)
            if (txQueueEntry.queuedBeforeMainSyncComplete) {
              //only a fatal if it was after the main sync phase was complete.
              this.statemanager_fatal(
                `routeAndQueueAcceptedTransaction_olderTX`,
                'routeAndQueueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age
              )
              // TODO consider throwing this out.  right now it is just a warning
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_oldQueueInsertion', '', 'routeAndQueueAcceptedTransaction working on older tx ' + timestamp + ' age: ' + age)
            }
          }
        }

        // Refine our list of which keys will be updated in this transaction : uniqueWritableKeys
        for (const key of txQueueEntry.uniqueKeys) {
          const isGlobalAcc = this.stateManager.accountGlobals.isGlobalAccount(key)

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
          const transactionGroup = this.queueEntryGetTransactionGroup(txQueueEntry)
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
                /* prettier-ignore */ if (logFlags.verbose) console.log( 'spread_tx_to_group', txId, txQueueEntry.executionGroup.length, txQueueEntry.conensusGroup.length, txQueueEntry.transactionGroup.length )
              }
              // /* prettier-ignore */ if (logFlags.playback ) this.logger.playbackLogNote('tx_homeGossip', `${txId}`, `AcceptedTransaction: ${acceptedTX}`)
            } catch (ex) {
              this.statemanager_fatal(
                `txQueueEntry_ex`,
                'txQueueEntry: ' + utils.stringifyReduce(txQueueEntry)
              )
            }
          }

          if (txQueueEntry.didSync === false) {
            // see if our node shard data covers any of the accounts?
            if (
              txQueueEntry.ourNodeInTransactionGroup === false &&
              txQueueEntry.globalModification === false
            ) {
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_notInTxGroup', `${txQueueEntry.logID}`, ``)
              return 'out of range' // we are done, not involved!!!
            } else {
              // If we have syncing neighbors forward this TX to them
              if (
                this.config.debug.forwardTXToSyncingNeighbors &&
                this.stateManager.currentCycleShardData.hasSyncingNeighbors === true
              ) {
                let send_spread_tx_to_group_syncing = true
                //todo turn this back on if other testing goes ok
                if (txQueueEntry.ourNodeInTransactionGroup === false) {
                  /* prettier-ignore */ nestedCountersInstance.countEvent('transactionQueue', 'spread_tx_to_group_syncing-skipped2')
                  send_spread_tx_to_group_syncing = false
                } else if (txQueueEntry.ourTXGroupIndex > 0) {
                  const everyN = Math.max(1, Math.floor(txQueueEntry.transactionGroup.length * 0.4))
                  const nonce = parseInt('0x' + txQueueEntry.acceptedTx.txId.substring(0, 2))
                  const idxPlusNonce = txQueueEntry.ourTXGroupIndex + nonce
                  const idxModEveryN = idxPlusNonce % everyN
                  if (idxModEveryN > 0) {
                    /* prettier-ignore */ nestedCountersInstance.countEvent('transactionQueue', 'spread_tx_to_group_syncing-skipped')
                    send_spread_tx_to_group_syncing = false
                  }
                }
                if (send_spread_tx_to_group_syncing) {
                  /* prettier-ignore */ nestedCountersInstance.countEvent('transactionQueue', 'spread_tx_to_group_syncing-notSkipped')

                  // only send non global modification TXs
                  if (txQueueEntry.globalModification === false) {
                    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`routeAndQueueAcceptedTransaction: spread_tx_to_group ${txQueueEntry.logID}`)
                    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_tx', `${txQueueEntry.logID}`, `txts: ${timestamp} nodes:${utils.stringifyReduce(this.stateManager.currentCycleShardData.syncingNeighborsTxGroup.map((x) => x.id))}`)

                    this.stateManager.debugNodeGroup(
                      txId,
                      timestamp,
                      `share to syncing neighbors`,
                      this.stateManager.currentCycleShardData.syncingNeighborsTxGroup
                    )
                    //this.p2p.sendGossipAll('spread_tx_to_group', acceptedTx, '', sender, this.stateManager.currentCycleShardData.syncingNeighborsTxGroup)
                    this.p2p.tell(
                      this.stateManager.currentCycleShardData.syncingNeighborsTxGroup,
                      'spread_tx_to_group_syncing',
                      acceptedTx
                    )
                  } else {
                    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`routeAndQueueAcceptedTransaction: bugfix detected. avoid forwarding txs where globalModification == true ${txQueueEntry.logID}`)
                  }
                }
              }
            }
          }
        } else {
          throw new Error('missing shard info')
        }

        this.computeTxSieveTime(txQueueEntry)

        if (
          this.config.debug.useShardusMemoryPatterns &&
          acceptedTx.shardusMemoryPatterns != null &&
          acceptedTx.shardusMemoryPatterns.ro != null
        ) {
          txQueueEntry.shardusMemoryPatternSets = {
            ro: new Set(acceptedTx.shardusMemoryPatterns.ro),
            rw: new Set(acceptedTx.shardusMemoryPatterns.rw),
            wo: new Set(acceptedTx.shardusMemoryPatterns.wo),
            on: new Set(acceptedTx.shardusMemoryPatterns.on),
            ri: new Set(acceptedTx.shardusMemoryPatterns.ri),
          }
          nestedCountersInstance.countEvent('transactionQueue', 'shardusMemoryPatternSets included')
        } else {
          nestedCountersInstance.countEvent('transactionQueue', 'shardusMemoryPatternSets not included')
        }

        // This call is not awaited. It is expected to be fast and will be done in the background.
        this.queueEntryPrePush(txQueueEntry)

        this.pendingTransactionQueue.push(txQueueEntry)
        this.pendingTransactionQueueByID.set(txQueueEntry.acceptedTx.txId, txQueueEntry)

        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_txPreQueued', `${txQueueEntry.logID}`, `${txQueueEntry.logID} gm:${txQueueEntry.globalModification}`)
        // start the queue if needed
        this.stateManager.tryStartTransactionProcessingQueue()
      } catch (error) {
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_addtoqueue_rejected', `${txId}`, `AcceptedTransaction: ${txQueueEntry.logID} ts: ${txQueueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(txQueueEntry.txKeys.allKeys)}`)
        this.statemanager_fatal(
          `routeAndQueueAcceptedTransaction_ex`,
          'routeAndQueueAcceptedTransaction failed: ' + errorToStringFull(error)
        )
        throw new Error(error)
      }
      return true
    } finally {
      this.profiler.profileSectionEnd('enqueue')
    }
  }

  async queueEntryPrePush(txQueueEntry: QueueEntry): Promise<void> {
    // Pre fetch immutable read account data for this TX
    if (
      this.config.features.enableRIAccountsCache &&
      txQueueEntry.shardusMemoryPatternSets &&
      txQueueEntry.shardusMemoryPatternSets.ri &&
      txQueueEntry.shardusMemoryPatternSets.ri.size > 0
    ) {
      for (const key of txQueueEntry.shardusMemoryPatternSets.ri) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('transactionQueue', 'queueEntryPrePush_ri')
        /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.info(`queueEntryPrePush: fetching immutable data for tx ${txQueueEntry.acceptedTx.txId} key ${key}`)
        const accountData = await this.stateManager.getLocalOrRemoteAccount(key, {
          useRICache: true,
        })
        if (accountData != null) {
          this.app.setCachedRIAccountData([accountData])
          this.queueEntryAddData(txQueueEntry, {
            accountId: accountData.accountId,
            stateId: accountData.stateId,
            data: accountData.data,
            timestamp: accountData.timestamp,
            syncData: accountData.syncData,
            accountCreated: false,
            isPartial: false,
          })
          /* prettier-ignore */ nestedCountersInstance.countEvent('transactionQueue', 'queueEntryPrePush_ri_added')
        }
      }
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
    const queueEntry = this._transactionQueueByID.get(txid)
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
    let queueEntry = this._transactionQueueByID.get(txid)
    if (queueEntry === undefined) {
      queueEntry = this.pendingTransactionQueueByID.get(txid)
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
    const queueEntry = this.archivedQueueEntriesByID.get(txid)
    if (queueEntry != null) {
      return queueEntry
    }
    nestedCountersInstance.countRareEvent('error', `getQueueEntryArchived no entry: ${msg}`)
    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`getQueueEntryArchived failed to find: ${utils.stringifyReduce(txid)} ${msg} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(txid)]}`)
    return null
  }

  /**
   * queueEntryAddData
   * add data to a queue entry
   *   // TODO CODEREVIEW.  need to look at the use of local cache.  also is the early out ok?
   * @param queueEntry
   * @param data
   */
  queueEntryAddData(queueEntry: QueueEntry, data: Shardus.WrappedResponse): void {
    if (queueEntry.collectedData[data.accountId] != null) {
      return // already have the data
    }
    if (queueEntry.uniqueKeys == null) {
      // cant have all data yet if we dont even have unique keys.
      throw new Error(
        `Attempting to add data and uniqueKeys are not available yet: ${utils.stringifyReduceLimit(
          queueEntry,
          200
        )}`
      )
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

    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_addData', `${queueEntry.logID}`, `key ${utils.makeShortHash(data.accountId)} hash: ${utils.makeShortHash(data.stateId)} hasAll:${queueEntry.hasAll} collected:${queueEntry.dataCollected}  ${queueEntry.acceptedTx.timestamp}`)
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
    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
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

  queueEntryListMissingData(queueEntry: QueueEntry): string[] {
    if (queueEntry.hasAll === true) {
      return []
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error(`queueEntryListMissingData (queueEntry.uniqueKeys == null)`)
    }
    const missingAccounts = []
    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
      if (queueEntry.collectedData[key] == null) {
        missingAccounts.push(key)
      }
    }

    return missingAccounts
  }

  /**
   * queueEntryRequestMissingData
   * ask other nodes for data that is missing for this TX.
   * normally other nodes in the network should foward data to us at the correct time.
   * This is only for the case that a TX has waited too long and not received the data it needs.
   * @param queueEntry
   */
  async queueEntryRequestMissingData(queueEntry: QueueEntry): Promise<void> {
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

    const allKeys = []
    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
      if (queueEntry.collectedData[key] == null) {
        allKeys.push(key)
      }
    }

    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_start', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}`)

    // consensus group should have all the data.. may need to correct this later
    //let consensusGroup = this.queueEntryGetConsensusGroup(queueEntry)
    //let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)

    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
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
          // eslint-disable-next-line security/detect-object-injection
          const homeNodeShardData = queueEntry.homeNodes[key] // mark outstanding request somehow so we dont rerequest

          // let node = consensusGroup[nodeIndex]
          // nodeIndex++

          // find a random node to ask that is not us
          let node = null
          let randomIndex: number
          let foundValidNode = false
          let maxTries = 1000

          // todo make this non random!!!.  It would be better to build a list and work through each node in order and then be finished
          // we have other code that does this fine.
          while (foundValidNode == false) {
            maxTries--
            randomIndex = this.stateManager.getRandomInt(
              homeNodeShardData.consensusNodeForOurNodeFull.length - 1
            )
            // eslint-disable-next-line security/detect-object-injection
            node = homeNodeShardData.consensusNodeForOurNodeFull[randomIndex]
            if (maxTries < 0) {
              //FAILED
              this.statemanager_fatal(
                `queueEntryRequestMissingData`,
                `queueEntryRequestMissingData: unable to find node to ask after 1000 tries tx:${
                  queueEntry.logID
                } key: ${utils.makeShortHash(key)} ${utils.stringifyReduce(
                  homeNodeShardData.consensusNodeForOurNodeFull.map((x) => (x != null ? x.id : 'null'))
                )}`
              )
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

          for (const key2 of allKeys) {
            // eslint-disable-next-line security/detect-object-injection
            queueEntry.requests[key2] = node
          }

          const relationString = ShardFunctions.getNodeRelation(
            homeNodeShardData,
            this.stateManager.currentCycleShardData.ourNode.id
          )
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_ask', `${queueEntry.logID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}`)

          // Node Precheck!
          if (
            this.stateManager.isNodeValidForInternalMessage(
              node.id,
              'queueEntryRequestMissingData',
              true,
              true
            ) === false
          ) {
            // if(this.tryNextDataSourceNode('queueEntryRequestMissingData') == false){
            //   break
            // }
            continue
          }

          const message = {
            keys: allKeys,
            txid: queueEntry.acceptedTx.txId,
            timestamp: queueEntry.acceptedTx.timestamp,
          }
          const result: RequestStateForTxResp = await this.p2p.ask(node, 'request_state_for_tx', message)

          if (result == null) {
            if (logFlags.verbose) {
              if (logFlags.error) this.mainLogger.error('ASK FAIL request_state_for_tx')
            }
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_askfailretry', `${queueEntry.logID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
            continue
          }
          if (result.success !== true) {
            if (logFlags.error) this.mainLogger.error('ASK FAIL queueEntryRequestMissingData 9')
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_askfailretry2', `${queueEntry.logID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
            continue
          }
          let dataCountReturned = 0
          const accountIdsReturned = []
          for (const data of result.stateList) {
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

          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingData_result', `${queueEntry.logID}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

          // queueEntry.homeNodes[key] = null
          for (const key2 of allKeys) {
            //consider deleteing these instead?
            //TSConversion changed to a delete opertaion should double check this
            //queueEntry.requests[key2] = null
            // eslint-disable-next-line security/detect-object-injection
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
  async queueEntryRequestMissingReceipt(queueEntry: QueueEntry): Promise<void> {
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

    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_start', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID}`)

    const consensusGroup = this.queueEntryGetConsensusGroup(queueEntry)

    this.stateManager.debugNodeGroup(
      queueEntry.acceptedTx.txId,
      queueEntry.acceptedTx.timestamp,
      `queueEntryRequestMissingReceipt`,
      consensusGroup
    )
    //let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)
    //the outer loop here could just use the transaction group of nodes instead. but already had this working in a similar function
    //TODO change it to loop the transaction group untill we get a good receipt

    //Note: we only need to get one good receipt, the loop on keys is in case we have to try different groups of nodes
    let gotReceipt = false
    for (const key of queueEntry.uniqueKeys) {
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
        // eslint-disable-next-line security/detect-object-injection
        const homeNodeShardData = queueEntry.homeNodes[key] // mark outstanding request somehow so we dont rerequest

        // eslint-disable-next-line security/detect-object-injection
        const node = consensusGroup[nodeIndex]
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

        const relationString = ShardFunctions.getNodeRelation(
          homeNodeShardData,
          this.stateManager.currentCycleShardData.ourNode.id
        )
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_ask', `${queueEntry.logID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)

        // Node Precheck!
        if (
          this.stateManager.isNodeValidForInternalMessage(
            node.id,
            'queueEntryRequestMissingReceipt',
            true,
            true
          ) === false
        ) {
          // if(this.tryNextDataSourceNode('queueEntryRequestMissingReceipt') == false){
          //   break
          // }
          continue
        }

        const message = { txid: queueEntry.acceptedTx.txId, timestamp: queueEntry.acceptedTx.timestamp }
        const result: RequestReceiptForTxResp = await this.p2p.ask(node, 'request_receipt_for_tx', message) // not sure if we should await this.

        if (result == null) {
          if (logFlags.verbose) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL request_receipt_for_tx ${triesLeft} ${utils.makeShortHash(node.id)}`)
          }
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_askfailretry', `${queueEntry.logID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
          continue
        }
        if (result.success !== true) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL queueEntryRequestMissingReceipt 9 ${triesLeft} ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)} note:${result.note} txid:${queueEntry.logID}`)
          continue
        }

        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_result', `${queueEntry.logID}`, `r:${relationString}   result:${queueEntry.logstate} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} result: ${utils.stringifyReduce(result)}`)

        if (result.success === true && result.receipt != null) {
          //TODO implement this!!!
          queueEntry.recievedAppliedReceipt2 = result.receipt
          keepTrying = false
          gotReceipt = true

          this.mainLogger.debug(
            `queueEntryRequestMissingReceipt got good receipt for: ${
              queueEntry.logID
            } from: ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)}`
          )
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

  async queueEntryRequestMissingReceipt_old(queueEntry: QueueEntry): Promise<void> {
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

    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_start', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID}`)

    const consensusGroup = this.queueEntryGetConsensusGroup(queueEntry)

    this.stateManager.debugNodeGroup(
      queueEntry.acceptedTx.txId,
      queueEntry.acceptedTx.timestamp,
      `queueEntryRequestMissingReceipt`,
      consensusGroup
    )
    //let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)
    //the outer loop here could just use the transaction group of nodes instead. but already had this working in a similar function
    //TODO change it to loop the transaction group untill we get a good receipt

    //Note: we only need to get one good receipt, the loop on keys is in case we have to try different groups of nodes
    let gotReceipt = false
    for (const key of queueEntry.uniqueKeys) {
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
        // eslint-disable-next-line security/detect-object-injection
        const homeNodeShardData = queueEntry.homeNodes[key] // mark outstanding request somehow so we dont rerequest

        // eslint-disable-next-line security/detect-object-injection
        const node = consensusGroup[nodeIndex]
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

        const relationString = ShardFunctions.getNodeRelation(
          homeNodeShardData,
          this.stateManager.currentCycleShardData.ourNode.id
        )
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_ask', `${queueEntry.logID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)

        // Node Precheck!
        if (
          this.stateManager.isNodeValidForInternalMessage(
            node.id,
            'queueEntryRequestMissingReceipt',
            true,
            true
          ) === false
        ) {
          // if(this.tryNextDataSourceNode('queueEntryRequestMissingReceipt') == false){
          //   break
          // }
          continue
        }

        const message = { txid: queueEntry.acceptedTx.txId, timestamp: queueEntry.acceptedTx.timestamp }
        const result: RequestReceiptForTxResp_old = await this.p2p.ask(
          node,
          'request_receipt_for_tx_old',
          message
        ) // not sure if we should await this.

        if (result == null) {
          if (logFlags.verbose) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL request_receipt_for_tx_old ${triesLeft} ${utils.makeShortHash(node.id)}`)
          }
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_askfailretry', `${queueEntry.logID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
          continue
        }
        if (result.success !== true) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL queueEntryRequestMissingReceipt 9 ${triesLeft} ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)} note:${result.note} txid:${queueEntry.logID}`)
          continue
        }

        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_result', `${queueEntry.logID}`, `r:${relationString}   result:${queueEntry.logstate} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} result: ${utils.stringifyReduce(result)}`)

        if (result.success === true && result.receipt != null) {
          //TODO implement this!!!
          queueEntry.recievedAppliedReceipt = result.receipt
          keepTrying = false
          gotReceipt = true

          this.mainLogger.debug(
            `queueEntryRequestMissingReceipt got good receipt for: ${
              queueEntry.logID
            } from: ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)}`
          )
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

  // compute the rand of the node where rank = node_id XOR hash(tx_id + tx_ts)
  computeNodeRank(nodeId: string, txId: string, txTimestamp: number): bigint {
    if (nodeId == null || txId == null || txTimestamp == null) return BigInt(0)
    const hash = this.crypto.hash([txId, txTimestamp])
    return BigInt(XOR(nodeId, hash))
  }

  // sort the nodeList by rank, in descending order
  orderNodesByRank(nodeList: Shardus.Node[], queueEntry: QueueEntry): Shardus.NodeWithRank[] {
    const nodeListWithRankData: Shardus.NodeWithRank[] = []

    for (let i = 0; i < nodeList.length; i++) {
      const node: Shardus.Node = nodeList[i]
      const rank = this.computeNodeRank(node.id, queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp)
      const nodeWithRank: Shardus.NodeWithRank = {
        rank,
        id: node.id,
        status: node.status,
        publicKey: node.publicKey,
        externalIp: node.externalIp,
        externalPort: node.externalPort,
        internalIp: node.internalIp,
        internalPort: node.internalPort,
      }
      nodeListWithRankData.push(nodeWithRank)
    }
    return nodeListWithRankData.sort((a: Shardus.NodeWithRank, b: Shardus.NodeWithRank) => {
      return b.rank > a.rank ? 1 : -1
    })
  }

  /**
   * queueEntryGetTransactionGroup
   * @param {QueueEntry} queueEntry
   * @returns {Node[]}
   */
  queueEntryGetTransactionGroup(queueEntry: QueueEntry, tryUpdate = false): Shardus.Node[] {
    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('queueEntryGetTransactionGroup: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('queueEntryGetTransactionGroup: queueEntry.uniqueKeys == null')
    }
    if (queueEntry.transactionGroup != null && tryUpdate != true) {
      return queueEntry.transactionGroup
    }

    const txGroup: Shardus.Node[] = []
    const uniqueNodes: StringNodeObjectMap = {}

    let hasNonGlobalKeys = false
    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
      const homeNode = queueEntry.homeNodes[key]
      // txGroup = Array.concat(txGroup, homeNode.nodeThatStoreOurParitionFull)
      if (homeNode == null) {
        if (logFlags.verbose) this.mainLogger.debug('queueEntryGetTransactionGroup homenode:null')
      }
      if (homeNode.extendedData === false) {
        ShardFunctions.computeExtendedNodePartitionData(
          this.stateManager.currentCycleShardData.shardGlobals,
          this.stateManager.currentCycleShardData.nodeShardDataMap,
          this.stateManager.currentCycleShardData.parititionShardDataMap,
          homeNode,
          this.stateManager.currentCycleShardData.nodes
        )
      }

      //may need to go back and sync this logic with how we decide what partition to save a record in.

      // If this is not a global TX then skip tracking of nodes for global accounts used as a reference.
      if (queueEntry.globalModification === false) {
        if (this.stateManager.accountGlobals.isGlobalAccount(key) === true) {
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup skipping: ${utils.makeShortHash(key)} tx: ${queueEntry.logID}`)
          continue
        } else {
          hasNonGlobalKeys = true
        }
      }

      for (const node of homeNode.nodeThatStoreOurParitionFull) {
        // not iterable!
        uniqueNodes[node.id] = node
      }

      const scratch1 = {}
      for (const node of homeNode.nodeThatStoreOurParitionFull) {
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
      const { homePartition } = ShardFunctions.addressToPartition(
        this.stateManager.currentCycleShardData.shardGlobals,
        key
      )
      if (homePartition != homeNode.homePartition) {
        //loop all nodes for now
        for (const nodeID of this.stateManager.currentCycleShardData.nodeShardDataMap.keys()) {
          const nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData =
            this.stateManager.currentCycleShardData.nodeShardDataMap.get(nodeID)
          const nodeStoresThisPartition = ShardFunctions.testInRange(
            homePartition,
            nodeShardData.storedPartitions
          )
          /* eslint-disable security/detect-object-injection */
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
          /* eslint-enable security/detect-object-injection */
        }
      }

      //todo refactor this to where we insert the tx
      if (
        queueEntry.globalModification === false &&
        this.executeInOneShard &&
        key === queueEntry.executionShardKey
      ) {
        //queueEntry.executionGroup = homeNode.consensusNodeForOurNodeFull.slice()
        const executionKeys = []
        if (logFlags.verbose) {
          for (const node of queueEntry.executionGroup) {
            executionKeys.push(utils.makeShortHash(node.id) + `:${node.externalPort}`)
          }
        }
        /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup executeInOneShard ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} executionGroup:${JSON.stringify(executionKeys)}`)
        /* prettier-ignore */ if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('queueEntryGetTransactionGroup', `queueEntryGetTransactionGroup executeInOneShard ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} executionGroup:${JSON.stringify(executionKeys)}`)
      }

      // if(queueEntry.globalModification === false && this.executeInOneShard && key === queueEntry.executionShardKey){
      //   let ourNodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData = this.stateManager.currentCycleShardData.nodeShardData
      //   let nodeStoresThisPartition = ShardFunctions.testInRange(homePartition, ourNodeShardData.storedPartitions)
      //   if(nodeStoresThisPartition === false){
      //     queueEntry.isInExecutionHome = false
      //     queueEntry.waitForReceiptOnly = true
      //   }
      //   /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} waitForReceiptOnly:${queueEntry.waitForReceiptOnly}`)
      //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('queueEntryGetTransactionGroup', `queueEntryGetTransactionGroup ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} waitForReceiptOnly:${queueEntry.waitForReceiptOnly}`)
      // }
    }
    queueEntry.ourNodeInTransactionGroup = true
    if (uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInTransactionGroup = false
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${queueEntry.logID}`)
    }

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    // This may seem confusing, but to gossip to other nodes, we have to have our node in the list we will gossip to
    // Other logic will use queueEntry.ourNodeInTransactionGroup to know what else to do with the queue entry
    uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] =
      this.stateManager.currentCycleShardData.ourNode

    const values = Object.values(uniqueNodes)
    for (const v of values) {
      txGroup.push(v)
    }

    txGroup.sort(this.stateManager._sortByIdAsc)
    if (queueEntry.ourNodeInTransactionGroup) {
      const ourID = this.stateManager.currentCycleShardData.ourNode.id
      for (let idx = 0; idx < txGroup.length; idx++) {
        // eslint-disable-next-line security/detect-object-injection
        const node = txGroup[idx]
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
    const txGroup = []
    const uniqueNodes: StringNodeObjectMap = {}

    let hasNonGlobalKeys = false
    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
      const homeNode = queueEntry.homeNodes[key]
      if (homeNode == null) {
        if (logFlags.verbose) this.mainLogger.debug('queueEntryGetConsensusGroup homenode:null')
      }
      if (homeNode.extendedData === false) {
        ShardFunctions.computeExtendedNodePartitionData(
          this.stateManager.currentCycleShardData.shardGlobals,
          this.stateManager.currentCycleShardData.nodeShardDataMap,
          this.stateManager.currentCycleShardData.parititionShardDataMap,
          homeNode,
          this.stateManager.currentCycleShardData.nodes
        )
      }

      // TODO STATESHARDING4 GLOBALACCOUNTS is this next block of logic needed?
      // If this is not a global TX then skip tracking of nodes for global accounts used as a reference.
      if (queueEntry.globalModification === false) {
        if (this.stateManager.accountGlobals.isGlobalAccount(key) === true) {
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetConsensusGroup skipping: ${utils.makeShortHash(key)} tx: ${queueEntry.logID}`)
          continue
        } else {
          hasNonGlobalKeys = true
        }
      }

      for (const node of homeNode.consensusNodeForOurNodeFull) {
        uniqueNodes[node.id] = node
      }

      // make sure the home node is in there in case we hit and edge case
      uniqueNodes[homeNode.node.id] = homeNode.node
    }
    queueEntry.ourNodeInConsensusGroup = true
    if (uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInConsensusGroup = false
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetConsensusGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${queueEntry.logID}`)
    }

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] =
      this.stateManager.currentCycleShardData.ourNode

    const values = Object.values(uniqueNodes)
    for (const v of values) {
      txGroup.push(v)
    }
    queueEntry.conensusGroup = txGroup
    return txGroup
  }

  /**
   * queueEntryGetConsensusGroupForAccount
   * Gets a merged results of all the consensus nodes for a specific account involved in the transaction
   * Ignores global accounts if globalModification == false and the account is global
   * @param {QueueEntry} queueEntry
   * @returns {Node[]}
   */
  queueEntryGetConsensusGroupForAccount(queueEntry: QueueEntry, accountId: string): Shardus.Node[] {
    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('queueEntryGetConsensusGroup: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('queueEntryGetConsensusGroup: queueEntry.uniqueKeys == null')
    }
    if (queueEntry.conensusGroup != null) {
      return queueEntry.conensusGroup
    }
    if (queueEntry.uniqueKeys.includes(accountId) === false) {
      throw new Error(`queueEntryGetConsensusGroup: account ${accountId} is not in the queueEntry.uniqueKeys`)
    }
    const txGroup = []
    const uniqueNodes: StringNodeObjectMap = {}

    let hasNonGlobalKeys = false
    const key = accountId
    // eslint-disable-next-line security/detect-object-injection
    const homeNode = queueEntry.homeNodes[key]
    if (homeNode == null) {
      if (logFlags.verbose) this.mainLogger.debug('queueEntryGetConsensusGroup homenode:null')
    }
    if (homeNode.extendedData === false) {
      ShardFunctions.computeExtendedNodePartitionData(
        this.stateManager.currentCycleShardData.shardGlobals,
        this.stateManager.currentCycleShardData.nodeShardDataMap,
        this.stateManager.currentCycleShardData.parititionShardDataMap,
        homeNode,
        this.stateManager.currentCycleShardData.nodes
      )
    }

    // TODO STATESHARDING4 GLOBALACCOUNTS is this next block of logic needed?
    // If this is not a global TX then skip tracking of nodes for global accounts used as a reference.
    if (queueEntry.globalModification === false) {
      if (this.stateManager.accountGlobals.isGlobalAccount(key) === true) {
        /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetConsensusGroup skipping: ${utils.makeShortHash(key)} tx: ${queueEntry.logID}`)
      } else {
        hasNonGlobalKeys = true
      }
    }

    for (const node of homeNode.consensusNodeForOurNodeFull) {
      uniqueNodes[node.id] = node
    }

    // make sure the home node is in there in case we hit and edge case
    uniqueNodes[homeNode.node.id] = homeNode.node
    queueEntry.ourNodeInConsensusGroup = true
    if (uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInConsensusGroup = false
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetConsensusGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${queueEntry.logID}`)
    }

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    uniqueNodes[this.stateManager.currentCycleShardData.ourNode.id] =
      this.stateManager.currentCycleShardData.ourNode

    const values = Object.values(uniqueNodes)
    for (const v of values) {
      txGroup.push(v)
    }
    return txGroup
  }
  /**
   * tellCorrespondingNodes
   * @param queueEntry
   * -sends account data to the correct involved nodees
   * -loads locally available data into the queue entry
   */
  async tellCorrespondingNodesOld(queueEntry: QueueEntry): Promise<unknown> {
    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('tellCorrespondingNodes: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('tellCorrespondingNodes: queueEntry.uniqueKeys == null')
    }
    // Report data to corresponding nodes
    const ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
    // let correspondingEdgeNodes = []
    let correspondingAccNodes: Shardus.Node[] = []
    const dataKeysWeHave = []
    const dataValuesWeHave = []
    const datas: { [accountID: string]: Shardus.WrappedResponse } = {}
    const remoteShardsByKey: { [accountID: string]: StateManagerTypes.shardFunctionTypes.NodeShardData } = {} // shard homenodes that we do not have the data for.
    let loggedPartition = false
    for (const key of queueEntry.uniqueKeys) {
      ///   test here
      // let hasKey = ShardFunctions.testAddressInRange(key, ourNodeData.storedPartitions)
      // todo : if this works maybe a nicer or faster version could be used
      let hasKey = false
      // eslint-disable-next-line security/detect-object-injection
      const homeNode = queueEntry.homeNodes[key]
      if (homeNode.node.id === ourNodeData.node.id) {
        hasKey = true
      } else {
        //perf todo: this seems like a slow calculation, coult improve this
        for (const node of homeNode.nodeThatStoreOurParitionFull) {
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
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', queueEntry.logID, `tellCorrespondingNodes - has`)
      }

      if (hasKey === false) {
        if (loggedPartition === false) {
          loggedPartition = true
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull.map((v) => v.id))}`)
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: full: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull)}`)
        }
        /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false  key: ${utils.stringifyReduce(key)}`)
      }

      if (hasKey) {
        // TODO PERF is it possible that this query could be used to update our in memory cache? (this would save us from some slow look ups) later on
        //    when checking timestamps.. alternatively maybe there is a away we can note the timestamp with what is returned here in the queueEntry data
        //    and not have to deal with the cache.
        // todo old: Detect if our node covers this paritition..  need our partition data

        this.profiler.profileSectionStart('process_dapp.getRelevantData')
        this.profiler.scopedProfileSectionStart('process_dapp.getRelevantData')
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.stateManager.transactionQueue.app.getRelevantData old')
        let data = await this.app.getRelevantData(
          key,
          queueEntry.acceptedTx.data,
          queueEntry.acceptedTx.appData
        )
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.stateManager.transactionQueue.app.getRelevantData old', DebugComplete.Completed)
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
          // eslint-disable-next-line security/detect-object-injection
          datas[key] = data
          dataKeysWeHave.push(key)
          dataValuesWeHave.push(data)
        }

        // eslint-disable-next-line security/detect-object-injection
        queueEntry.localKeys[key] = true
        // add this data to our own queue entry!!
        this.queueEntryAddData(queueEntry, data)
      } else {
        // eslint-disable-next-line security/detect-object-injection
        remoteShardsByKey[key] = queueEntry.homeNodes[key]
      }
    }
    if (queueEntry.globalModification === true) {
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes - globalModification = true, not telling other nodes`)
      return
    }

    // if we are in the execution shard no need to forward data
    // This is because other nodes will not expect pre-apply data anymore (but they will send us their pre apply data)
    if (
      queueEntry.globalModification === false &&
      this.executeInOneShard &&
      queueEntry.isInExecutionHome === true
    ) {
      //will this break things..
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes - isInExecutionHome = true, not telling other nodes`)
      return
    }

    let message: { stateList: unknown[]; txid: string }
    let edgeNodeIds = []
    let consensusNodeIds = []

    const nodesToSendTo: StringNodeObjectMap = {}
    const doOnceNodeAccPair = new Set<string>() //can skip  node+acc if it happens more than once.

    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
      if (datas[key] != null) {
        for (const key2 of queueEntry.uniqueKeys) {
          if (key !== key2) {
            // eslint-disable-next-line security/detect-object-injection
            const localHomeNode = queueEntry.homeNodes[key]
            // eslint-disable-next-line security/detect-object-injection
            const remoteHomeNode = queueEntry.homeNodes[key2]

            // //can ignore nodes not in the execution group since they will not be running apply
            // if(this.executeInOneShard && (queueEntry.executionIdSet.has(remoteHomeNode.node.id) === false)){
            //   continue
            // }

            const ourLocalConsensusIndex = localHomeNode.consensusNodeForOurNodeFull.findIndex(
              (a) => a.id === ourNodeData.node.id
            )
            if (ourLocalConsensusIndex === -1) {
              continue
            }

            edgeNodeIds = []
            consensusNodeIds = []
            correspondingAccNodes = []

            // must add one to each lookup index!
            const indicies = ShardFunctions.debugFastStableCorrespondingIndicies(
              localHomeNode.consensusNodeForOurNodeFull.length,
              remoteHomeNode.consensusNodeForOurNodeFull.length,
              ourLocalConsensusIndex + 1
            )
            const edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
              localHomeNode.consensusNodeForOurNodeFull.length,
              remoteHomeNode.edgeNodes.length,
              ourLocalConsensusIndex + 1
            )

            let patchIndicies = []
            if (remoteHomeNode.patchedOnNodes.length > 0) {
              patchIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
                localHomeNode.consensusNodeForOurNodeFull.length,
                remoteHomeNode.patchedOnNodes.length,
                ourLocalConsensusIndex + 1
              )
            }

            // HOMENODEMATHS need to work out sending data to our patched range.
            // let edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.edgeNodes.length, ourLocalConsensusIndex + 1)

            // for each remote node lets save it's id
            for (const index of indicies) {
              const node = remoteHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node != null && node.id !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                consensusNodeIds.push(node.id)
              }
            }
            for (const index of edgeIndicies) {
              const node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node != null && node.id !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                edgeNodeIds.push(node.id)
              }
            }

            for (const index of patchIndicies) {
              const node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (node != null && node.id !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                //edgeNodeIds.push(node.id)
              }
            }

            const dataToSend = []
            // eslint-disable-next-line security/detect-object-injection
            dataToSend.push(datas[key]) // only sending just this one key at a time
            message = { stateList: dataToSend, txid: queueEntry.acceptedTx.txId }

            //correspondingAccNodes = Object.values(nodesToSendTo)

            //build correspondingAccNodes, but filter out nodeid, account key pairs we have seen before
            for (const [accountID, node] of Object.entries(nodesToSendTo)) {
              const keyPair = accountID + key
              if (node != null && doOnceNodeAccPair.has(keyPair) === false) {
                doOnceNodeAccPair.add(keyPair)

                // consider this optimization later (should make it so we only send to execution set nodes)
                // if(queueEntry.executionIdSet.has(remoteHomeNode.node.id) === true){
                //   correspondingAccNodes.push(node)
                // }
                correspondingAccNodes.push(node)
              }
            }

            if (correspondingAccNodes.length > 0) {
              const remoteRelation = ShardFunctions.getNodeRelation(
                remoteHomeNode,
                this.stateManager.currentCycleShardData.ourNode.id
              )
              const localRelation = ShardFunctions.getNodeRelation(
                localHomeNode,
                this.stateManager.currentCycleShardData.ourNode.id
              )
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_tellCorrespondingNodes', `${queueEntry.acceptedTx.txId}`, `remoteRel: ${remoteRelation} localrel: ${localRelation} qId: ${queueEntry.entryID} AccountBeingShared: ${utils.makeShortHash(key)} EdgeNodes:${utils.stringifyReduce(edgeNodeIds)} ConsesusNodes${utils.stringifyReduce(consensusNodeIds)}`)

              // Filter nodes before we send tell()
              const filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
                correspondingAccNodes,
                'tellCorrespondingNodes',
                true,
                true
              )
              if (filteredNodes.length === 0) {
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error('tellCorrespondingNodes: filterValidNodesForInternalMessage no valid nodes left to try')
                return null
              }
              const filterdCorrespondingAccNodes = filteredNodes

              // TODO Perf: need a tellMany enhancement.  that will minimize signing and stringify required!
              this.p2p.tell(filterdCorrespondingAccNodes, 'broadcast_state', message)
            }
          }
        }
      }
    }
  }

  /**
   * tellCorrespondingNodes
   * @param queueEntry
   * -sends account data to the correct involved nodees
   * -loads locally available data into the queue entry
   */
  async tellCorrespondingNodes(queueEntry: QueueEntry): Promise<unknown> {
    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('tellCorrespondingNodes: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('tellCorrespondingNodes: queueEntry.uniqueKeys == null')
    }
    // Report data to corresponding nodes
    const ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
    // let correspondingEdgeNodes = []
    let correspondingAccNodes: Shardus.Node[] = []
    const dataKeysWeHave = []
    const dataValuesWeHave = []
    const datas: { [accountID: string]: Shardus.WrappedResponse } = {}
    const remoteShardsByKey: { [accountID: string]: StateManagerTypes.shardFunctionTypes.NodeShardData } = {} // shard homenodes that we do not have the data for.
    let loggedPartition = false
    for (const key of queueEntry.uniqueKeys) {
      ///   test here
      // let hasKey = ShardFunctions.testAddressInRange(key, ourNodeData.storedPartitions)
      // todo : if this works maybe a nicer or faster version could be used
      let hasKey = false
      // eslint-disable-next-line security/detect-object-injection
      const homeNode = queueEntry.homeNodes[key]
      if (homeNode.node.id === ourNodeData.node.id) {
        hasKey = true
      } else {
        //perf todo: this seems like a slow calculation, coult improve this
        for (const node of homeNode.nodeThatStoreOurParitionFull) {
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
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', queueEntry.logID, `tellCorrespondingNodes - has`)
      }

      if (hasKey === false) {
        if (loggedPartition === false) {
          loggedPartition = true
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull.map((v) => v.id))}`)
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: full: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull)}`)
        }
        /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false  key: ${utils.stringifyReduce(key)}`)
      }

      if (hasKey) {
        // TODO PERF is it possible that this query could be used to update our in memory cache? (this would save us from some slow look ups) later on
        //    when checking timestamps.. alternatively maybe there is a away we can note the timestamp with what is returned here in the queueEntry data
        //    and not have to deal with the cache.
        // todo old: Detect if our node covers this paritition..  need our partition data

        this.profiler.profileSectionStart('process_dapp.getRelevantData')
        this.profiler.scopedProfileSectionStart('process_dapp.getRelevantData')
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.stateManager.transactionQueue.app.getRelevantData')
        let data = await this.app.getRelevantData(
          key,
          queueEntry.acceptedTx.data,
          queueEntry.acceptedTx.appData
        )
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.stateManager.transactionQueue.app.getRelevantData', DebugComplete.Completed)
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
          // eslint-disable-next-line security/detect-object-injection
          datas[key] = data
          dataKeysWeHave.push(key)
          dataValuesWeHave.push(data)
        }

        // eslint-disable-next-line security/detect-object-injection
        queueEntry.localKeys[key] = true
        // add this data to our own queue entry!!
        this.queueEntryAddData(queueEntry, data)
      } else {
        // eslint-disable-next-line security/detect-object-injection
        remoteShardsByKey[key] = queueEntry.homeNodes[key]
      }
    }
    if (queueEntry.globalModification === true) {
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes - globalModification = true, not telling other nodes`)
      return
    }

    let message: { stateList: unknown[]; txid: string }
    let edgeNodeIds = []
    let consensusNodeIds = []

    const nodesToSendTo: StringNodeObjectMap = {}
    const doOnceNodeAccPair = new Set<string>() //can skip  node+acc if it happens more than once.

    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
      if (datas[key] != null) {
        for (const key2 of queueEntry.uniqueKeys) {
          if (key !== key2) {
            // eslint-disable-next-line security/detect-object-injection
            const localHomeNode = queueEntry.homeNodes[key]
            // eslint-disable-next-line security/detect-object-injection
            const remoteHomeNode = queueEntry.homeNodes[key2]

            const ourLocalConsensusIndex = localHomeNode.consensusNodeForOurNodeFull.findIndex(
              (a) => a.id === ourNodeData.node.id
            )
            if (ourLocalConsensusIndex === -1) {
              continue
            }

            edgeNodeIds = []
            consensusNodeIds = []
            correspondingAccNodes = []

            const ourSendingGroupSize = localHomeNode.consensusNodeForOurNodeFull.length

            const targetConsensusGroupSize = remoteHomeNode.consensusNodeForOurNodeFull.length
            const targetEdgeGroupSize = remoteHomeNode.edgeNodes.length
            const pachedListSize = remoteHomeNode.patchedOnNodes.length

            // must add one to each lookup index!
            const indicies = ShardFunctions.debugFastStableCorrespondingIndicies(
              ourSendingGroupSize,
              targetConsensusGroupSize,
              ourLocalConsensusIndex + 1
            )
            const edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
              ourSendingGroupSize,
              targetEdgeGroupSize,
              ourLocalConsensusIndex + 1
            )

            let patchIndicies = []
            if (remoteHomeNode.patchedOnNodes.length > 0) {
              patchIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
                ourSendingGroupSize,
                remoteHomeNode.patchedOnNodes.length,
                ourLocalConsensusIndex + 1
              )
            }

            // for each remote node lets save it's id
            for (const index of indicies) {
              const node = remoteHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              //only send data to the execution group
              if (queueEntry.executionGroupMap.has(remoteHomeNode.node.id) === false) {
                continue
              }
              if (node != null && node.id !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                consensusNodeIds.push(node.id)
              }
            }
            for (const index of edgeIndicies) {
              const node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              //only send data to the execution group
              if (queueEntry.executionGroupMap.has(remoteHomeNode.node.id) === false) {
                continue
              }
              if (node != null && node.id !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                edgeNodeIds.push(node.id)
              }
            }

            for (const index of patchIndicies) {
              const node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              //only send data to the execution group
              if (queueEntry.executionGroupMap.has(remoteHomeNode.node.id) === false) {
                continue
              }
              if (node != null && node.id !== ourNodeData.node.id) {
                nodesToSendTo[node.id] = node
                //edgeNodeIds.push(node.id)
              }
            }

            const dataToSend = []
            // eslint-disable-next-line security/detect-object-injection
            dataToSend.push(datas[key]) // only sending just this one key at a time
            message = { stateList: dataToSend, txid: queueEntry.acceptedTx.txId }

            //build correspondingAccNodes, but filter out nodeid, account key pairs we have seen before
            for (const [accountID, node] of Object.entries(nodesToSendTo)) {
              const keyPair = accountID + key
              if (node != null && doOnceNodeAccPair.has(keyPair) === false) {
                doOnceNodeAccPair.add(keyPair)
                correspondingAccNodes.push(node)
              }
            }

            /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes nodesToSendTo:${Object.keys(nodesToSendTo).length} doOnceNodeAccPair:${doOnceNodeAccPair.size} indicies:${JSON.stringify(indicies)} edgeIndicies:${JSON.stringify(edgeIndicies)} patchIndicies:${JSON.stringify(patchIndicies)}  doOnceNodeAccPair: ${JSON.stringify([...doOnceNodeAccPair.keys()])} ourLocalConsensusIndex:${ourLocalConsensusIndex} ourSendingGroupSize:${ourSendingGroupSize} targetEdgeGroupSize:${targetEdgeGroupSize} targetEdgeGroupSize:${targetEdgeGroupSize} pachedListSize:${pachedListSize}`)

            if (correspondingAccNodes.length > 0) {
              const remoteRelation = ShardFunctions.getNodeRelation(
                remoteHomeNode,
                this.stateManager.currentCycleShardData.ourNode.id
              )
              const localRelation = ShardFunctions.getNodeRelation(
                localHomeNode,
                this.stateManager.currentCycleShardData.ourNode.id
              )
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_tellCorrespondingNodes', `${queueEntry.acceptedTx.txId}`, `remoteRel: ${remoteRelation} localrel: ${localRelation} qId: ${queueEntry.entryID} AccountBeingShared: ${utils.makeShortHash(key)} EdgeNodes:${utils.stringifyReduce(edgeNodeIds)} ConsesusNodes${utils.stringifyReduce(consensusNodeIds)}`)

              // Filter nodes before we send tell()
              const filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
                correspondingAccNodes,
                'tellCorrespondingNodes',
                true,
                true
              )
              if (filteredNodes.length === 0) {
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error('tellCorrespondingNodes: filterValidNodesForInternalMessage no valid nodes left to try')
                return null
              }
              const filterdCorrespondingAccNodes = filteredNodes

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
   * I am keeping the async tag because this function does kick off async tasks it just does not await them
   * I think this tag makes it more clear that this function is not a simple synchronous function
   * @param queueEntry
   * @returns
   */
  async tellCorrespondingNodesFinalData(queueEntry: QueueEntry): Promise<void> {
    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodesFinalData', queueEntry.logID, `tellCorrespondingNodesFinalData - start: ${queueEntry.logID}`)

    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('tellCorrespondingNodesFinalData: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('tellCorrespondingNodesFinalData: queueEntry.uniqueKeys == null')
    }
    if (queueEntry.globalModification === true) {
      throw new Error('tellCorrespondingNodesFinalData globalModification === true')
    }

    if (this.executeInOneShard && queueEntry.isInExecutionHome === false) {
      throw new Error('tellCorrespondingNodesFinalData isInExecutionHome === false')
    }
    if (queueEntry.executionShardKey == null || queueEntry.executionShardKey == '') {
      throw new Error('tellCorrespondingNodesFinalData executionShardKey == null or empty')
    }
    if (queueEntry.preApplyTXResult == null) {
      throw new Error('tellCorrespondingNodesFinalData preApplyTXResult == null')
    }

    // Report data to corresponding nodes
    const ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
    let correspondingAccNodes: Shardus.Node[] = []
    const datas: { [accountID: string]: Shardus.WrappedResponse } = {}

    const applyResponse = queueEntry.preApplyTXResult.applyResponse
    let wrappedStates = this.stateManager.useAccountWritesOnly ? {} : queueEntry.collectedData
    const writtenAccountsMap: WrappedResponses = {}
    if (applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
      for (const writtenAccount of applyResponse.accountWrites) {
        writtenAccountsMap[writtenAccount.accountId] = writtenAccount.data
        writtenAccountsMap[writtenAccount.accountId].prevStateId = wrappedStates[writtenAccount.accountId]
          ? wrappedStates[writtenAccount.accountId].stateId
          : ''
        writtenAccountsMap[writtenAccount.accountId].prevDataCopy = wrappedStates[writtenAccount.accountId]
          ? utils.deepCopy(writtenAccount.data)
          : {}

        datas[writtenAccount.accountId] = writtenAccount.data
      }
      //override wrapped states with writtenAccountsMap which should be more complete if it included
      wrappedStates = writtenAccountsMap
    }
    const keysToShare = Object.keys(wrappedStates)

    let message: { stateList: Shardus.WrappedResponse[]; txid: string }
    let edgeNodeIds = []
    let consensusNodeIds = []

    const localHomeNode = queueEntry.homeNodes[queueEntry.executionShardKey]

    let nodesToSendTo: StringNodeObjectMap = {}
    let doOnceNodeAccPair = new Set<string>() //can skip  node+acc if it happens more than once.

    //let uniqueAccountsShared = 0
    let totalShares = 0
    for (const key of keysToShare) {
      nodesToSendTo = {}
      doOnceNodeAccPair = new Set<string>()

      // eslint-disable-next-line security/detect-object-injection
      if (wrappedStates[key] != null) {
        // eslint-disable-next-line security/detect-object-injection
        let accountHomeNode = queueEntry.homeNodes[key]

        if (accountHomeNode == null) {
          accountHomeNode = ShardFunctions.findHomeNode(
            this.stateManager.currentCycleShardData.shardGlobals,
            key,
            this.stateManager.currentCycleShardData.parititionShardDataMap
          )
          nestedCountersInstance.countEvent('stateManager', 'fetch missing home info')
        }
        if (accountHomeNode == null) {
          throw new Error('tellCorrespondingNodesFinalData: should never get here.  accountHomeNode == null')
        }

        edgeNodeIds = []
        consensusNodeIds = []
        correspondingAccNodes = []

        if (queueEntry.ourExGroupIndex === -1) {
          throw new Error(
            'tellCorrespondingNodesFinalData: should never get here.  our sending node must be in the execution group'
          )
        }

        const ourLocalExecutionSetIndex = queueEntry.ourExGroupIndex
        const ourSendingGroupSize = queueEntry.executionGroupMap.size

        const consensusListSize = accountHomeNode.consensusNodeForOurNodeFull.length
        const edgeListSize = accountHomeNode.edgeNodes.length
        const pachedListSize = accountHomeNode.patchedOnNodes.length

        // must add one to each lookup index!
        const indicies = ShardFunctions.debugFastStableCorrespondingIndicies(
          ourSendingGroupSize,
          consensusListSize,
          ourLocalExecutionSetIndex + 1
        )
        const edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
          ourSendingGroupSize,
          edgeListSize,
          ourLocalExecutionSetIndex + 1
        )

        let patchIndicies = []
        if (accountHomeNode.patchedOnNodes.length > 0) {
          patchIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
            ourSendingGroupSize,
            pachedListSize,
            ourLocalExecutionSetIndex + 1
          )
        }

        // for each remote node lets save it's id
        for (const index of indicies) {
          const node = accountHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
          if (node != null && node.id !== ourNodeData.node.id) {
            nodesToSendTo[node.id] = node
            consensusNodeIds.push(node.id)
          }
        }
        for (const index of edgeIndicies) {
          const node = accountHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
          if (node != null && node.id !== ourNodeData.node.id) {
            nodesToSendTo[node.id] = node
            edgeNodeIds.push(node.id)
          }
        }

        for (const index of patchIndicies) {
          const node = accountHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
          if (node != null && node.id !== ourNodeData.node.id) {
            nodesToSendTo[node.id] = node
            //edgeNodeIds.push(node.id)
          }
        }

        for (const [accountID, node] of Object.entries(nodesToSendTo)) {
          const keyPair = accountID + key
          if (node != null && doOnceNodeAccPair.has(keyPair) === false) {
            doOnceNodeAccPair.add(keyPair)
            correspondingAccNodes.push(node)
          }
        }

        //how can we be making so many calls??
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodesFinalData', queueEntry.logID, `tellCorrespondingNodesFinalData nodesToSendTo:${Object.keys(nodesToSendTo).length} doOnceNodeAccPair:${doOnceNodeAccPair.size} indicies:${JSON.stringify(indicies)} edgeIndicies:${JSON.stringify(edgeIndicies)} patchIndicies:${JSON.stringify(patchIndicies)}  doOnceNodeAccPair: ${JSON.stringify([...doOnceNodeAccPair.keys()])} ourLocalExecutionSetIndex:${ourLocalExecutionSetIndex} ourSendingGroupSize:${ourSendingGroupSize} consensusListSize:${consensusListSize} edgeListSize:${edgeListSize} pachedListSize:${pachedListSize}`)

        const dataToSend: Shardus.WrappedResponse[] = []
        // eslint-disable-next-line security/detect-object-injection
        dataToSend.push(datas[key]) // only sending just this one key at a time
        message = { stateList: dataToSend, txid: queueEntry.acceptedTx.txId }
        if (correspondingAccNodes.length > 0) {
          const remoteRelation = ShardFunctions.getNodeRelation(
            accountHomeNode,
            this.stateManager.currentCycleShardData.ourNode.id
          )
          const localRelation = ShardFunctions.getNodeRelation(
            localHomeNode,
            this.stateManager.currentCycleShardData.ourNode.id
          )
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodesFinalData', queueEntry.logID, `remoteRel: ${remoteRelation} localrel: ${localRelation} qId: ${queueEntry.entryID} AccountBeingShared: ${utils.makeShortHash(key)} EdgeNodes:${utils.stringifyReduce(edgeNodeIds)} ConsesusNodes${utils.stringifyReduce(consensusNodeIds)}`)

          // Filter nodes before we send tell()
          const filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
            correspondingAccNodes,
            'tellCorrespondingNodesFinalData',
            true,
            true
          )
          if (filteredNodes.length === 0) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error('tellCorrespondingNodesFinalData: filterValidNodesForInternalMessage no valid nodes left to try')
            //return null
            continue
          }
          const filterdCorrespondingAccNodes = filteredNodes
          this.p2p.tell(filterdCorrespondingAccNodes, 'broadcast_finalstate', message)
          totalShares++
        }
      }
    }

    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodesFinalData - end: ${queueEntry.logID} totalShares:${totalShares}`)
  }

  dumpTxDebugToStatList(queueEntry: QueueEntry): void {
    this.txDebugStatList.push({ ...queueEntry.txDebug })
  }

  clearTxDebugStatList(): void {
    this.txDebugStatList = []
  }

  printTxDebug(): string {
    const collector = {}
    const totalTxCount = this.txDebugStatList.length

    /* eslint-disable security/detect-object-injection */
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
    /* eslint-enable security/detect-object-injection */

    const lines = []
    lines.push(`=> Total Transactions: ${totalTxCount}`)
    for (const [key, collectorForThisKey] of Object.entries(collector)) {
      lines.push(`\n => Tx ${key}: \n`)
      for (let i = 0; i < Object.keys(collectorForThisKey).length; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const time = Object.keys(collectorForThisKey)[i]
        // eslint-disable-next-line security/detect-object-injection
        const arr = collectorForThisKey[time]
        if (!arr) continue
        const percentage = (arr.length / totalTxCount) * 100
        const blockCount = Math.round(percentage / 2)
        const blockStr = '|'.repeat(blockCount)
        const lowerLimit = i === 0 ? 0 : Object.keys(collectorForThisKey)[i - 1]
        const upperLimit = time
        const bucketDescription = `${lowerLimit} ms - ${upperLimit} ms:`.padEnd(19, ' ')
        lines.push(
          `${bucketDescription}  ${arr.length} ${percentage.toFixed(1).padEnd(5, ' ')}%  ${blockStr} `
        )
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
  removeFromQueue(queueEntry: QueueEntry, currentIndex: number): void {
    queueEntry.txDebug.dequeueHrTime = process.hrtime(queueEntry.txDebug.enqueueHrTime)
    queueEntry.txDebug.duration['queue_sit_time'] = queueEntry.txDebug.dequeueHrTime[1] / 1000000
    this.stateManager.eventEmitter.emit('txPopped', queueEntry.acceptedTx.txId)
    if (queueEntry.txDebug) this.dumpTxDebugToStatList(queueEntry)
    this._transactionQueue.splice(currentIndex, 1)
    this._transactionQueueByID.delete(queueEntry.acceptedTx.txId)

    queueEntry.archived = true
    //compact the queue entry before we push it!
    queueEntry.ourVote = null
    queueEntry.collectedVotes = null

    // coalesce the receipts into applied receipt. maybe not as descriptive, but save memory.
    queueEntry.appliedReceipt =
      queueEntry.appliedReceipt ??
      queueEntry.recievedAppliedReceipt ??
      queueEntry.appliedReceiptForRepair ??
      queueEntry.appliedReceiptFinal
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

  /***
   *    ########  ########   #######   ######  ########  ######   ######
   *    ##     ## ##     ## ##     ## ##    ## ##       ##    ## ##    ##
   *    ##     ## ##     ## ##     ## ##       ##       ##       ##
   *    ########  ########  ##     ## ##       ######    ######   ######
   *    ##        ##   ##   ##     ## ##       ##             ##       ##
   *    ##        ##    ##  ##     ## ##    ## ##       ##    ## ##    ##
   *    ##        ##     ##  #######   ######  ########  ######   ######
   */
  /**
   * Run our main processing queue untill there is nothing that we can do
   * old name: processAcceptedTxQueue
   * @param firstTime
   * @returns
   */
  async processTransactions(firstTime = false): Promise<void> {
    const seenAccounts: SeenAccounts = {}
    let pushedProfilerTag = null
    const startTime = shardusGetTime()

    const processStats: ProcessQueueStats = {
      totalTime: 0,
      inserted: 0,
      sameState: 0,
      stateChanged: 0,
      //expired:0,
      sameStateStats: {},
      stateChangedStats: {},
      awaitStats: {},
    }

    //this may help in the case where the queue has halted
    this.lastProcessStats['current'] = processStats

    this.queueReads = new Set()
    this.queueWrites = new Set()
    this.queueReadWritesOld = new Set()

    try {
      nestedCountersInstance.countEvent('processing', 'processing-enter')

      if (this.pendingTransactionQueue.length > 5000) {
        /* prettier-ignore */ nestedCountersInstance.countEvent( 'stateManager', `newAcceptedTxQueueTempInjest>5000 leftRunning:${this.transactionProcessingQueueRunning} noShardCalcs:${ this.stateManager.currentCycleShardData == null } ` )

        //report rare counter once
        if (this.largePendingQueueReported === false) {
          this.largePendingQueueReported = true
          /* prettier-ignore */ nestedCountersInstance.countRareEvent( 'stateManager', `newAcceptedTxQueueTempInjest>5000 leftRunning:${this.transactionProcessingQueueRunning} noShardCalcs:${ this.stateManager.currentCycleShardData == null } ` )
        }
      }

      if (this.transactionProcessingQueueRunning === true) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('stateManager', 'newAcceptedTxQueueRunning === true')
        return
      }
      this.transactionProcessingQueueRunning = true
      this.isStuckProcessing = false
      this.debugLastProcessingQueueStartTime = shardusGetTime()

      // ensure there is some rest between processing loops
      const timeSinceLastRun = startTime - this.processingLastRunTime
      if (timeSinceLastRun < this.processingMinRunBreak) {
        const sleepTime = Math.max(5, this.processingMinRunBreak - timeSinceLastRun)
        await utils.sleep(sleepTime)
        nestedCountersInstance.countEvent('processing', 'resting')
      }

      if (this.transactionQueueHasRemainingWork && timeSinceLastRun > 500) {
        this.statemanager_fatal(
          `processAcceptedTxQueue left busy and waited too long to restart`,
          `processAcceptedTxQueue left busy and waited too long to restart ${timeSinceLastRun / 1000} `
        )
      }

      this.profiler.profileSectionStart('processQ')

      if (this.stateManager.currentCycleShardData == null) {
        nestedCountersInstance.countEvent('stateManager', 'currentCycleShardData == null early exit')
        return
      }

      if (this._transactionQueue.length === 0 && this.pendingTransactionQueue.length === 0) {
        return
      }

      if (this.queueRestartCounter == null) {
        this.queueRestartCounter = 0
      }
      this.queueRestartCounter++

      const localRestartCounter = this.queueRestartCounter

      const timeM = this.stateManager.queueSitTime
      const timeM2 = timeM * 4
      const timeM2_5 = timeM * 5
      const timeM3 = timeM * 6
      let currentTime = shardusGetTime()

      const app = this.app

      // process any new queue entries that were added to the temporary list
      if (this.pendingTransactionQueue.length > 0) {
        for (const txQueueEntry of this.pendingTransactionQueue) {
          if (this.txWillChangeLocalData(txQueueEntry) === true) {
            nestedCountersInstance.countEvent('stateManager', 'processAcceptedTxQueue injest: kept TX')
          } else {
            nestedCountersInstance.countEvent('stateManager', 'processAcceptedTxQueue injest: discard TX')
            continue
          }

          const timestamp = txQueueEntry.txKeys.timestamp
          const acceptedTx = txQueueEntry.acceptedTx
          const txId = acceptedTx.txId
          // Find the time sorted spot in our queue to insert this TX into
          // reverse loop because the news (largest timestamp) values are at the end of the array
          // todo faster version (binary search? to find where we need to insert)
          let index = this._transactionQueue.length - 1
          // eslint-disable-next-line security/detect-object-injection
          let lastTx = this._transactionQueue[index]
          while (
            index >= 0 &&
            (timestamp > lastTx.txKeys.timestamp ||
              (timestamp === lastTx.txKeys.timestamp && txId < lastTx.acceptedTx.txId))
          ) {
            index--
            // eslint-disable-next-line security/detect-object-injection
            lastTx = this._transactionQueue[index]
          }

          const age = shardusGetTime() - timestamp
          if (age > timeM * 0.9) {
            // IT turns out the correct thing to check is didSync flag only report errors if we did not wait on this TX while syncing
            if (txQueueEntry.didSync == false) {
              this.statemanager_fatal(
                `processAcceptedTxQueue_oldTX.9 fromClient:${txQueueEntry.fromClient}`,
                `processAcceptedTxQueue cannot accept tx older than 0.9M ${timestamp} age: ${age} fromClient:${txQueueEntry.fromClient}`
              )
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_processAcceptedTxQueueTooOld1', `${utils.makeShortHash(txQueueEntry.acceptedTx.txId)}`, 'processAcceptedTxQueue working on older tx ' + timestamp + ' age: ' + age)
              //txQueueEntry.waitForReceiptOnly = true
            }
          }
          if (age > timeM) {
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_processAcceptedTxQueueTooOld2', `${utils.makeShortHash(txQueueEntry.acceptedTx.txId)}`, 'processAcceptedTxQueue working on older tx ' + timestamp + ' age: ' + age)
            txQueueEntry.waitForReceiptOnly = true
            txQueueEntry.state = 'consensing'
          }

          // do not injest tranactions that are long expired. there could be 10k+ of them if we are restarting the processing queue
          if (age > timeM3 * 5 && this.stateManager.config.stateManager.discardVeryOldPendingTX === true) {
            nestedCountersInstance.countEvent('txExpired', 'txExpired3 > M3 * 5. pendingTransactionQueue')

            // let hasApplyReceipt = txQueueEntry.appliedReceipt != null
            // let hasReceivedApplyReceipt = txQueueEntry.recievedAppliedReceipt != null

            // const shortID = txQueueEntry.logID //`${utils.makeShortHash(queueEntry.acceptedTx.id)}`
            // //const hasReceipt = receipt2 != null

            // hasApplyReceipt = txQueueEntry.appliedReceipt2 != null
            // hasReceivedApplyReceipt = txQueueEntry.recievedAppliedReceipt2 != null

            //   this.statemanager_fatal(
            //     `txExpired3 > M3. pendingTransactionQueue`,
            //     `txExpired txAge > timeM3 pendingTransactionQueue ` +
            //       `txid: ${shortID} state: ${txQueueEntry.state} hasAll:${txQueueEntry.hasAll} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${age}`
            //   )

            //   //probably some alternative TX queue cleanup that should happen similar to setTXExpired
            //   //this.setTXExpired(queueEntry, currentIndex, 'm3 general')

            continue
          }

          txQueueEntry.approximateCycleAge = this.stateManager.currentCycleShardData.cycleNumber
          //insert this tx into the main queue
          this._transactionQueue.splice(index + 1, 0, txQueueEntry)
          this._transactionQueueByID.set(txQueueEntry.acceptedTx.txId, txQueueEntry)

          processStats.inserted++

          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_addToQueue', `${txId}`, `AcceptedTransaction: ${txQueueEntry.logID} ts: ${txQueueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(txQueueEntry.txKeys.allKeys)} indexInserted: ${index + 1}`)
          this.stateManager.eventEmitter.emit('txQueued', acceptedTx.txId)
        }
        this.pendingTransactionQueue = []
        this.pendingTransactionQueueByID.clear()
      }

      let currentIndex = this._transactionQueue.length - 1

      let lastLog = 0
      currentIndex++ //increment once so we can handle the decrement at the top of the loop and be safe about continue statements

      let lastRest = shardusGetTime()
      while (this._transactionQueue.length > 0) {
        // update current time with each pass through the loop
        currentTime = shardusGetTime()

        if (currentTime - lastRest > 1000) {
          //add a brief sleep if we have been in this loop for a long time
          nestedCountersInstance.countEvent('processing', 'forcedSleep')
          await utils.sleep(5) //5ms sleep
          lastRest = currentTime

          if (
            currentTime - this.stateManager.currentCycleShardData.calculationTime >
            this.config.p2p.cycleDuration * 1000 + 5000
          ) {
            nestedCountersInstance.countEvent('processing', 'old cycle data >5s past due')
          }
          if (
            currentTime - this.stateManager.currentCycleShardData.calculationTime >
            this.config.p2p.cycleDuration * 1000 + 11000
          ) {
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

        this.clearDebugAwaitStrings()

        // eslint-disable-next-line security/detect-object-injection
        const queueEntry: QueueEntry = this._transactionQueue[currentIndex]
        const txTime = queueEntry.txKeys.timestamp
        const txAge = currentTime - txTime

        this.debugRecentQueueEntry = queueEntry

        // current queue entry is younger than timeM, so nothing to do yet.
        if (txAge < timeM) {
          break
        }

        if (localRestartCounter < this.queueRestartCounter && lastLog !== this.queueRestartCounter) {
          lastLog = this.queueRestartCounter
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('queueRestart_error', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter}  qrstGlobal:${this.queueRestartCounter}}`)
        }

        this.stateManager.debugTXHistory[queueEntry.logID] = queueEntry.state
        let hasApplyReceipt = queueEntry.appliedReceipt != null
        let hasReceivedApplyReceipt = queueEntry.recievedAppliedReceipt != null
        let hasReceivedApplyReceiptForRepair = queueEntry.appliedReceiptForRepair != null
        const shortID = queueEntry.logID //`${utils.makeShortHash(queueEntry.acceptedTx.id)}`

        hasApplyReceipt = queueEntry.appliedReceipt2 != null
        hasReceivedApplyReceipt = queueEntry.recievedAppliedReceipt2 != null
        hasReceivedApplyReceiptForRepair = queueEntry.appliedReceiptForRepair2 != null

        // on the off chance we are here with a pass of fail state remove this from the queue.
        // log fatal because we do not want to get to this situation.
        if (queueEntry.state === 'pass' || queueEntry.state === 'fail') {
          this.statemanager_fatal(
            `pass or fail entry should not be in queue`,
            `txid: ${shortID} state: ${queueEntry.state} receiptEverRequested:${queueEntry.receiptEverRequested} age:${txAge}`
          )
          this.removeFromQueue(queueEntry, currentIndex)
          continue
        }

        //turn off all this logic to futher simplify things
        if (this.queueTimingFixes === false) {
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

              this.statemanager_fatal(
                `txExpired1 > M3 * 2. NormalTX Timed out.`,
                `txExpired txAge > timeM3*2 && queueEntry.didSync == false. ` +
                  `txid: ${shortID} state: ${
                    queueEntry.state
                  } applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} hasReceivedApplyReceiptForRepair:${hasReceivedApplyReceiptForRepair} receiptEverRequested:${
                    queueEntry.receiptEverRequested
                  } age:${txAge} ${utils.stringifyReduce(queueEntry.uniqueWritableKeys)}`
              )
              if (queueEntry.receiptEverRequested && queueEntry.globalModification === false) {
                this.statemanager_fatal(
                  `txExpired1 > M3 * 2 -!receiptEverRequested`,
                  `txExpired txAge > timeM3*2 && queueEntry.didSync == false. !receiptEverRequested ` +
                    `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} hasReceivedApplyReceiptForRepair:${hasReceivedApplyReceiptForRepair} receiptEverRequested:${queueEntry.receiptEverRequested} age:${txAge}`
                )
              }
              if (queueEntry.globalModification) {
                this.statemanager_fatal(
                  `txExpired1 > M3 * 2 -GlobalModification!!`,
                  `txExpired txAge > timeM3*2 && queueEntry.didSync == false. !receiptEverRequested ` +
                    `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} hasReceivedApplyReceiptForRepair:${hasReceivedApplyReceiptForRepair} receiptEverRequested:${queueEntry.receiptEverRequested} age:${txAge}`
                )
              }
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

              /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M3 * 2. NormalTX Timed out. didSync == false. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)

              this.setTXExpired(queueEntry, currentIndex, 'old, timeM3 * 2')
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
            //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 2  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
            //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 2: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

            //   /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M3 * 50. SyncedTX Timed out. didSync == true. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)
            //   queueEntry.state = 'expired'
            //   this.removeFromQueue(queueEntry, currentIndex)
            //   continue
            // }

            // lots of logic about when we can repair or not repair/when to wait etc.
            if (this.queueTimingFixes === false) {
              // This is the expiry case where requestingReceiptFailed
              if (txAge > timeM3 && queueEntry.requestingReceiptFailed) {
                //this.statistics.incrementCounter('txExpired')

                this.statemanager_fatal(
                  `txExpired3 > M3. receiptRequestFail after Timed Out`,
                  `txExpired txAge > timeM3 && queueEntry.requestingReceiptFailed ` +
                    `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`
                )
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 3 requestingReceiptFailed  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 3 requestingReceiptFailed: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

                /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M3. receiptRequestFail after Timed Out. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)

                this.setTXExpired(queueEntry, currentIndex, 'old, timeM3, requestingReceiptFailed')
                continue
              }

              // This is the expiry case where repairFailed
              //     TODO.  I think as soon as a repair as marked as failed we can expire and remove it from the queue
              //            But I am leaving this optimizaiton out for now since we really don't want to plan on repairs failing
              if (txAge > timeM3 && queueEntry.repairFailed) {
                //this.statistics.incrementCounter('txExpired')

                this.statemanager_fatal(
                  `txExpired3 > M3. repairFailed after Timed Out`,
                  `txExpired txAge > timeM3 && queueEntry.repairFailed ` +
                    `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`
                )
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 3 repairFailed  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 3 repairFailed: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

                /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M3. repairFailed after Timed Out. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)

                this.setTXExpired(queueEntry, currentIndex, 'old, timeM3, repairFailed')
                continue
              }

              // a few cases to wait for a receipt or request a receipt
              if (queueEntry.state != 'await repair' && queueEntry.state != 'commiting') {
                //Not yet expired case: getting close to expire so just move to consensing and wait.
                //Just wait for receipt only if we are awaiting data and it is getting late
                if (
                  txAge > timeM2_5 &&
                  queueEntry.m2TimeoutReached === false &&
                  queueEntry.globalModification === false &&
                  queueEntry.requestingReceipt === false
                ) {
                  if (queueEntry.state == 'awaiting data') {
                    // no receipt yet, and state not committing
                    if (queueEntry.recievedAppliedReceipt == null && queueEntry.appliedReceipt == null) {
                      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`Wait for reciept only: txAge > timeM2_5 txid:${shortID} `)
                      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txMissingReceipt3', `${shortID}`, `processAcceptedTxQueue ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)

                      /* prettier-ignore */ nestedCountersInstance.countEvent('txMissingReceipt', `Wait for reciept only: txAge > timeM2.5. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)
                      queueEntry.waitForReceiptOnly = true
                      queueEntry.m2TimeoutReached = true
                      queueEntry.state = 'consensing'
                      continue
                    }
                  }
                }

                //receipt requesting is not going to work with current timeouts.
                if (queueEntry.requestingReceipt === true) {
                  this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
                  continue
                }

                // The TX technically expired past M3, but we will now request reciept in hope that we can repair the tx
                if (
                  txAge > timeM3 &&
                  queueEntry.requestingReceiptFailed === false &&
                  queueEntry.globalModification === false
                ) {
                  if (
                    this.stateManager.hasReceipt(queueEntry) === false &&
                    queueEntry.requestingReceipt === false
                  ) {
                    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`txAge > timeM3 => ask for receipt now ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
                    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txMissingReceipt1', `txAge > timeM3 ${shortID}`, `syncNeedsReceipt ${shortID}`)

                    const seen = this.processQueue_accountSeen(seenAccounts, queueEntry)

                    this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
                    this.queueEntryRequestMissingReceipt(queueEntry)

                    /* prettier-ignore */ nestedCountersInstance.countEvent('txMissingReceipt', `txAge > timeM3 => ask for receipt now. state:${queueEntry.state} globalMod:${queueEntry.globalModification} seen:${seen}`)
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

              this.statemanager_fatal(
                `txExpired4`,
                `Still on inital syncing.  txExpired txAge > timeM3 * 50. ` +
                  `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`
              )
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 4  ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 4: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

              /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `txExpired txAge > timeM3 * 50. still syncing. state:${queueEntry.state} globalMod:${queueEntry.globalModification}`)

              this.setTXExpired(queueEntry, currentIndex, 'old, timeM3 * 50!!')

              continue
            }
          }
        }

        if (this.queueTimingFixes === true) {
          //if we are still waiting on an upstream TX at this stage in the pipeline,
          //then kill the TX because there is not much hope for it
          //This will help make way for other TXs with a better chance
          if (queueEntry.state === 'processing' || queueEntry.state === 'awaiting data') {
            if (this.processQueue_accountSeen(seenAccounts, queueEntry) === true) {
              //adding txSieve time!
              if (txAge > timeM2 + queueEntry.txSieveTime) {
                /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M2 canceled due to upstream TXs. state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification}`)
                //todo only keep on for temporarliy
                /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M2 canceled due to upstream TXs. sieveT:${queueEntry.txSieveTime}`)

                this.setTXExpired(queueEntry, currentIndex, 'm2, processing or awaiting')
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
            if (queueEntry.requestingReceiptFailed) {
              expireTx = true
              reason = 'requestingReceiptFailed'
            }
            if (queueEntry.repairFailed) {
              expireTx = true
              reason = 'repairFailed'
            }
            if (expireTx) {
              this.statemanager_fatal(
                `txExpired3 > M2. fail ${reason}`,
                `txExpired txAge > timeM2 fail ${reason} ` +
                  `txid: ${shortID} state: ${queueEntry.state} hasAll:${queueEntry.hasAll} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`
              )
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired >m2 fail ${reason}  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
              //if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 3 requestingReceiptFailed: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

              /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> timeM2 fail ${reason} state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification} `)

              this.setTXExpired(queueEntry, currentIndex, 'm2 ' + reason)
            }
          }

          //if(extendedTimeoutLogic === true){

          //}
          const isConsensing = queueEntry.state === 'consensing'
          //let isCommiting = queueEntry.state === 'commiting'
          const isAwaitingFinalData = queueEntry.state === 'await final data'
          const isInExecutionHome = queueEntry.isInExecutionHome
          //note this wont work with old receipts but we can depricate old receipts soon
          const receipt2 = this.stateManager.getReceipt2(queueEntry)
          const hasReceipt = receipt2 != null
          const hasCastVote = queueEntry.ourVote != null

          let extraTime = 0
          //let cantExpire = false
          let matchingReceipt = false

          if (isInExecutionHome && isConsensing && hasReceipt === false) {
            //give a bit of extra time to wait for votes to come in
            extraTime = timeM * 0.5
          }

          //this should cover isCommiting
          if (isInExecutionHome && hasReceipt) {
            matchingReceipt = this.stateManager.transactionConsensus.hasAppliedReceiptMatchingPreApply(
              queueEntry,
              null
            )
            //give even more time
            extraTime = timeM
          }

          // if we have not added extra time yet then add time for a vote.
          if (extraTime < timeM && hasCastVote === true) {
            //this would be a way to just statically add to the time
            //extraTime = timeM
            const ageDiff = queueEntry.voteCastAge + timeM - timeM3
            if (ageDiff > 0) {
              extraTime = ageDiff
            }
          }

          if (isAwaitingFinalData) {
            if (hasReceipt) {
              extraTime = timeM2 * 1.5
            } else {
              extraTime = timeM
            }
          }

          //round extraTime to up to nearest 500ms (needed for counter aggregation)
          if (extraTime > 0) {
            extraTime = Math.ceil(extraTime / 500) * 500
            if (extraTime > timeM) {
              extraTime = timeM
            }
          }

          //Have a hard cap where we expire and remove TXs after time > M3
          if (txAge > timeM3 + extraTime) {
            this.statemanager_fatal(
              `txExpired3 > M3. general case`,
              `txExpired txAge > timeM3 general case ` +
                `txid: ${shortID} state: ${queueEntry.state} hasAll:${queueEntry.hasAll} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}  hasReceipt:${hasReceipt} matchingReceipt:${matchingReceipt} isInExecutionHome:${isInExecutionHome}`
            )
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} txExpired 3 requestingReceiptFailed  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
            //if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 3 requestingReceiptFailed: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

            /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M3. general case state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification} hasReceipt:${hasReceipt} matchingReceipt:${matchingReceipt} isInExecutionHome:${isInExecutionHome}`)
            /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M3. general case sieveT:${queueEntry.txSieveTime} extraTime:${extraTime}`)

            this.setTXExpired(queueEntry, currentIndex, 'm3 general')
            continue
          }

          //TODO? could we remove a TX from the queu as soon as a receit was requested?
          //TODO?2 should we allow a TX to use a repair op shortly after being expired? (it would have to be carefull, and maybe use some locking)
        }

        const txStartTime = shardusGetTime()

        // HANDLE TX logic based on state.
        try {
          this.profiler.profileSectionStart(`process-${queueEntry.state}`)
          profilerInstance.scopedProfileSectionStart(`scoped-process-${queueEntry.state}`, false)
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
              const time = shardusGetTime()
              try {
                // TODO re-evaluate if it is correct for us to share info for a global modifing TX.
                //if(queueEntry.globalModification === false) {
                const awaitStart = shardusGetTime()

                if (this.executeInOneShard === true) {
                  /* prettier-ignore */ this.setDebugLastAwaitedCall('this.stateManager.transactionQueue.tellCorrespondingNodes(queueEntry)')
                  await this.tellCorrespondingNodes(queueEntry)
                  /* prettier-ignore */ this.setDebugLastAwaitedCall('this.stateManager.transactionQueue.tellCorrespondingNodes(queueEntry)', DebugComplete.Completed)
                } else {
                  /* prettier-ignore */ this.setDebugLastAwaitedCall('this.stateManager.transactionQueue.tellCorrespondingNodesOld(queueEntry)')
                  //specific fixes were needed for tellCorrespondingNodes.  tellCorrespondingNodesOld is the old version before fixes
                  await this.tellCorrespondingNodesOld(queueEntry)
                  /* prettier-ignore */ this.setDebugLastAwaitedCall('this.stateManager.transactionQueue.tellCorrespondingNodesOld(queueEntry)', DebugComplete.Completed)
                }

                this.updateSimpleStatsObject(
                  processStats.awaitStats,
                  'tellCorrespondingNodes',
                  shardusGetTime() - awaitStart
                )

                /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_processing', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter}  values: ${this.processQueue_debugAccountData(queueEntry, app)}`)
                //}
              } catch (ex) {
                /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug('processAcceptedTxQueue2 tellCorrespondingNodes:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                this.statemanager_fatal(
                  `processAcceptedTxQueue2_ex`,
                  'processAcceptedTxQueue2 tellCorrespondingNodes:' +
                    ex.name +
                    ': ' +
                    ex.message +
                    ' at ' +
                    ex.stack
                )

                queueEntry.executionDebug.process1 = 'tell fail'
              } finally {
                queueEntry.state = 'awaiting data'

                //if we are not going to execute the TX go strait to consensing
                if (
                  queueEntry.globalModification === false &&
                  this.executeInOneShard &&
                  queueEntry.isInExecutionHome === false
                ) {
                  //is there a way to preemptively forward data without there being tons of repair..
                  /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`processAcceptedTxQueue2 isInExecutionHome === false. set state = 'await final data' tx:${queueEntry.logID} ts:${queueEntry.acceptedTx.timestamp}`)
                  queueEntry.state = 'await final data'
                }
              }
              queueEntry.executionDebug.processElapsed = shardusGetTime() - time
            }
            this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
          }
          if (queueEntry.state === 'awaiting data') {
            queueEntry.executionDebug.log = 'entered awaiting data'

            ///////////////////////////////////////--awaiting data--////////////////////////////////////////////////////////////////////

            // Wait for all data to be aquired.
            // Once we have all the data we need we can move to consensing phase.
            // IF this is a global account it will go strait to commiting phase since the data was shared by other means.

            if (this.queueTimingFixes === true) {
              if (txAge > timeM2_5) {
                const isBlocked = this.processQueue_accountSeen(seenAccounts, queueEntry)
                //need to review this in context of sharding
                /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M2.5 canceled due to lack of progress. state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification} isBlocked:${isBlocked}`)
                const missingAccounts = this.queueEntryListMissingData(queueEntry)
                if (logFlags.playback) {
                  this.logger.playbackLogNote(
                    'txExpired>M2.5',
                    `${shortID}`,
                    `> M2.5 canceled due to lack of progress. state:${queueEntry.state} hasAll:${
                      queueEntry.hasAll
                    } globalMod:${
                      queueEntry.globalModification
                    } isBlocked:${isBlocked} missing:${utils.stringifyReduce(missingAccounts)}`
                  )
                }
                //Log as error also.. can comment this out later
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`txExpired > M2.5 canceled due to lack of progress. state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification} isBlocked:${isBlocked} missing:${utils.stringifyReduce(missingAccounts)}`)
                this.setTXExpired(queueEntry, currentIndex, 'm2.5 awaiting data')
                continue
              }
            } else {
              // catch all in case we get waiting for data
              if (txAge > timeM2_5) {
                this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
                /* prettier-ignore */ nestedCountersInstance.countEvent('processing', `awaiting data txAge > m2.5 set to consensing hasAll:${queueEntry.hasAll} hasReceivedApplyReceipt:${hasReceivedApplyReceipt}`)

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
                /* prettier-ignore */ nestedCountersInstance.countEvent('processing', 'data missing at t>M2. but not really. investigate further')
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_hadDataAfterall', `${shortID}`, `This is kind of an error, and should not happen`)
                continue
              }

              if (
                this.queueTimingFixes === true &&
                this.processQueue_accountSeen(seenAccounts, queueEntry) === true
              ) {
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
                /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug('processAcceptedTxQueue2 queueEntryRequestMissingData:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                this.statemanager_fatal(
                  `processAcceptedTxQueue2_missingData`,
                  'processAcceptedTxQueue2 queueEntryRequestMissingData:' +
                    ex.name +
                    ': ' +
                    ex.message +
                    ' at ' +
                    ex.stack
                )
              }
            } else if (queueEntry.hasAll) {
              queueEntry.executionDebug.log1 = 'has all'

              // we have all the data, but we need to make sure there are no upstream TXs using accounts we need first.
              if (this.processQueue_accountSeen(seenAccounts, queueEntry) === false) {
                this.processQueue_markAccountsSeen(seenAccounts, queueEntry)

                // As soon as we have all the data we preApply it and then send out a vote
                /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_preApplyTx', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${this.processQueue_debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)

                // TODO sync related need to reconsider how to set this up again
                // if (queueEntry.didSync) {
                //   /* prettier-ignore */ if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_consensing', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}`)
                //   // if we did sync it is time to JIT query local data.  alternatively could have other nodes send us this data, but that could be very high bandwidth.
                //   for (let key of queueEntry.syncKeys) {
                //     let wrappedState = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
                //     /* prettier-ignore */ if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_getLocalData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}  key:${utils.makeShortHash(key)} hash:${wrappedState.stateId}`)
                //     queueEntry.localCachedData[key] = wrappedState.localCache
                //   }
                // }

                try {
                  //This is a just in time check to make sure our involved accounts
                  //have not changed after our TX timestamp
                  const accountsValid = this.checkAccountTimestamps(queueEntry)
                  if (accountsValid === false) {
                    queueEntry.state = 'consensing'
                    queueEntry.preApplyTXResult = {
                      applied: false,
                      passed: false,
                      applyResult: 'failed account TS checks',
                      reason: 'apply result',
                      applyResponse: null,
                    }
                    continue
                  }

                  if (queueEntry.transactionGroup.length > 1) {
                    queueEntry.robustAccountDataPromises = {}
                    // confirm the node has good data
                    for (const key of queueEntry.uniqueKeys) {
                      const collectedAccountData = queueEntry.collectedData[key]
                      if (collectedAccountData.accountCreated) {
                        // we do not need to check this newly created account
                        // todo: still possible that node has lost data for this account
                        continue
                      }
                      const consensuGroupForAccount = this.queueEntryGetConsensusGroupForAccount(
                        queueEntry,
                        key
                      )
                      const promise = this.stateManager.transactionConsensus.robustQueryAccountData(
                        consensuGroupForAccount,
                        key
                      )
                      queueEntry.robustAccountDataPromises[key] = promise
                    }
                  }

                  queueEntry.executionDebug.log2 = 'call pre apply'
                  const awaitStart = shardusGetTime()
                  /* prettier-ignore */ this.setDebugLastAwaitedCall('this.stateManager.transactionQueue.preApplyTransaction(queueEntry)')
                  let txResult = undefined
                  if (this.config.stateManager.transactionApplyTimeout > 0) {
                    //use the withTimeout from util/promises to call preApplyTransaction with a timeout
                    txResult = await withTimeout<PreApplyAcceptedTransactionResult>(
                      () => this.preApplyTransaction(queueEntry),
                      this.config.stateManager.transactionApplyTimeout
                    )
                    if (txResult === 'timeout') {
                      //if we got a timeout, we need to set the txResult to null
                      txResult = null
                      nestedCountersInstance.countEvent('processing', 'timeout-preApply')
                      this.statemanager_fatal(
                        'timeout-preApply',
                        `preApplyTransaction timed out for txid: ${
                          queueEntry.logID
                        } ${this.getDebugProccessingStatus()}`
                      )
                      //need to clear any stuck fifo locks.  Would be better to solve upstream problems.
                      this.stateManager.forceUnlockAllFifoLocks('timeout-preApply')
                    }
                  } else {
                    txResult = await this.preApplyTransaction(queueEntry)
                  }

                  /* prettier-ignore */ this.setDebugLastAwaitedCall('this.stateManager.transactionQueue.preApplyTransaction(queueEntry)', DebugComplete.Completed)
                  this.updateSimpleStatsObject(
                    processStats.awaitStats,
                    'preApplyTransaction',
                    shardusGetTime() - awaitStart
                  )

                  queueEntry.executionDebug.log3 = 'called pre apply'
                  queueEntry.executionDebug.txResult = txResult

                  if (txResult != null && txResult.applied === true) {
                    queueEntry.state = 'consensing'

                    queueEntry.preApplyTXResult = txResult

                    // make sure our data wrappers are upt to date with the correct hash and timstamp
                    for (const key of Object.keys(queueEntry.collectedData)) {
                      // eslint-disable-next-line security/detect-object-injection
                      const wrappedAccount = queueEntry.collectedData[key]
                      const { timestamp, hash } = this.app.getTimestampAndHashFromAccount(wrappedAccount.data)
                      if (wrappedAccount.timestamp != timestamp) {
                        wrappedAccount.timestamp = timestamp
                        nestedCountersInstance.countEvent('transactionQueue', 'correctedTimestamp')
                      }
                      // eslint-disable-next-line security/detect-possible-timing-attacks
                      if (wrappedAccount.stateId != hash) {
                        wrappedAccount.stateId = hash
                        nestedCountersInstance.countEvent('transactionQueue', 'correctedHash')
                      }
                    }

                    //Broadcast our vote
                    if (queueEntry.noConsensus === true) {
                      // not sure about how to share or generate an applied receipt though for a no consensus step
                      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_preApplyTx_noConsensus', `${shortID}`, ``)

                      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 noConsensus : ${queueEntry.logID} `)

                      queueEntry.state = 'commiting'

                      queueEntry.hasValidFinalData = true
                      // TODO Global receipts?  do we want them?
                      // if(queueEntry.globalModification === false){
                      //   //Send a special receipt because this is a set command.
                      // }
                    } else {
                      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_preApplyTx_createAndShareVote', `${shortID}`, ``)
                      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 createAndShareVote : ${queueEntry.logID} `)
                      const awaitStart = shardusGetTime()

                      queueEntry.voteCastAge = txAge
                      /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.createAndShareVote(queueEntry)' )
                      await this.stateManager.transactionConsensus.createAndShareVote(queueEntry)
                      /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.createAndShareVote(queueEntry)', DebugComplete.Completed )
                      this.updateSimpleStatsObject(
                        processStats.awaitStats,
                        'createAndShareVote',
                        shardusGetTime() - awaitStart
                      )
                    }
                  } else {
                    //There was some sort of error when we tried to apply the TX
                    //Go directly into 'consensing' state, because we need to wait for a receipt that is good.
                    /* prettier-ignore */ nestedCountersInstance.countEvent('processing', `txResult apply error. applied: ${txResult?.applied}`)
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`processAcceptedTxQueue2 txResult problem txid:${queueEntry.logID} res: ${utils.stringifyReduce(txResult)} `)
                    queueEntry.waitForReceiptOnly = true
                    queueEntry.state = 'consensing'
                    //TODO: need to flag this case so that it does not artificially increase the network load
                  }
                } catch (ex) {
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug('processAcceptedTxQueue2 preApplyAcceptedTransaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                  this.statemanager_fatal(
                    `processAcceptedTxQueue2b_ex`,
                    'processAcceptedTxQueue2 preApplyAcceptedTransaction:' +
                      ex.name +
                      ': ' +
                      ex.message +
                      ' at ' +
                      ex.stack
                  )
                } finally {
                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_preapplyFinish', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${this.processQueue_debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)
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
              let result: AppliedReceipt

              if (this.useNewPOQ) {
                // if we are in execution group, try to "confirm" or "challenge" the highest ranked vote
                this.stateManager.transactionConsensus.confirmOrChallenge(queueEntry)

                // try to produce a receipt
                /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 consensing : ${queueEntry.logID} receiptRcv:${hasReceivedApplyReceipt}`)

                const receipt2 = queueEntry.recievedAppliedReceipt2 ?? queueEntry.appliedReceipt2
                if (receipt2 != null) {
                  nestedCountersInstance.countEvent(`consensus`, 'tryProduceReceipt receipt2 != null')
                  //we have a receipt2, so we can make a receipt
                  result = {
                    result: receipt2.result,
                    appliedVotes: [receipt2.appliedVote], // everything is the same but the applied vote is an array
                    txid: receipt2.txid,
                    app_data_hash: receipt2.app_data_hash,
                  }
                } else {
                  result = queueEntry.appliedReceipt
                }

                if (result == null) {
                  this.stateManager.transactionConsensus.tryProduceReceipt(queueEntry)
                }
              } else {
                const receipt2 = queueEntry.recievedAppliedReceipt2 ?? queueEntry.appliedReceipt2
                if (receipt2 != null) {
                  if (logFlags.debug)
                    this.mainLogger.debug(
                      `processAcceptedTxQueue2 consensing : ${queueEntry.logID} receiptRcv:${hasReceivedApplyReceipt}`
                    )
                  nestedCountersInstance.countEvent(`consensus`, 'tryProduceReceipt receipt2 != null')
                  //we have a receipt2, so we can make a receipt
                  result = {
                    result: receipt2.result,
                    appliedVotes: [receipt2.appliedVote], // everything is the same but the applied vote is an array
                    txid: receipt2.txid,
                    app_data_hash: receipt2.app_data_hash,
                  }
                } else {
                  result = await this.stateManager.transactionConsensus.tryProduceReceipt(queueEntry)
                }
              }

              /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 tryProduceReceipt result : ${queueEntry.logID} ${utils.stringifyReduce(result)}`)

              //todo this is false.. and prevents some important stuff.
              //need to look at appliedReceipt2
              if (result != null || queueEntry.appliedReceipt2 != null) {
                //TODO share receipt with corresponding index

                if (logFlags.debug || this.stateManager.consensusLog) {
                  this.mainLogger.debug(
                    `processAcceptedTxQueue2 tryProduceReceipt final result : ${
                      queueEntry.logID
                    } ${utils.stringifyReduce(result)}`
                  )
                }

                if (
                  this.stateManager.transactionConsensus.hasAppliedReceiptMatchingPreApply(queueEntry, result)
                ) {
                  nestedCountersInstance.countEvent('consensus', 'hasAppliedReceiptMatchingPreApply: true')
                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_madeReceipt', `${shortID}`, `qId: ${queueEntry.entryID}  `)

                  const shouldSendReceipt = true
                  // shouldSendReceipt = queueEntry.recievedAppliedReceipt == null

                  if (shouldSendReceipt) {
                    if (queueEntry.appliedReceipt2) {
                      // Broadcast the receipt, only if we made one (try produce can early out if we received one)
                      const awaitStart = shardusGetTime()
                      /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.shareAppliedReceipt()' )
                      await this.stateManager.transactionConsensus.shareAppliedReceipt(queueEntry)
                      /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.shareAppliedReceipt()', DebugComplete.Completed )

                      this.updateSimpleStatsObject(
                        processStats.awaitStats,
                        'shareAppliedReceipt',
                        shardusGetTime() - awaitStart
                      )
                    }
                  } else {
                    // no need to share a receipt
                  }

                  //todo check cant_apply flag to make sure a vote can form with it!
                  //also check if failed votes will work...?
                  if (
                    this.stateManager.getReceiptVote(queueEntry).cant_apply === false &&
                    this.stateManager.getReceiptResult(queueEntry) === true
                  ) {
                    queueEntry.state = 'commiting'
                    queueEntry.hasValidFinalData = true
                    finishedConsensing = true
                  } else {
                    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_finishedFailReceipt1', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                    // we are finished since there is nothing to apply
                    // this.statemanager_fatal(`consensing: repairToMatchReceipt failed`, `consensing: repairToMatchReceipt failed ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
                    this.removeFromQueue(queueEntry, currentIndex)
                    queueEntry.state = 'fail'
                    continue
                  }

                  if (
                    queueEntry.globalModification === false &&
                    finishedConsensing === true &&
                    this.executeInOneShard &&
                    queueEntry.isInExecutionHome
                  ) {
                    //forward all finished data to corresponding nodes
                    const awaitStart = shardusGetTime()
                    // This is an async function but we do not await it
                    this.tellCorrespondingNodesFinalData(queueEntry)
                    this.updateSimpleStatsObject(
                      processStats.awaitStats,
                      'tellCorrespondingNodesFinalData',
                      shardusGetTime() - awaitStart
                    )
                  }
                  //continue
                } else {
                  nestedCountersInstance.countEvent('consensus', 'hasAppliedReceiptMatchingPreApply: false')
                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_gotReceiptNoMatch1', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                  didNotMatchReceipt = true
                  queueEntry.appliedReceiptForRepair = result

                  queueEntry.appliedReceiptForRepair2 = this.stateManager.getReceipt2(queueEntry)
                }
              }
              if (finishedConsensing === false) {
                // if we got a reciept while waiting see if we should use it (if our own vote matches)
                if (hasReceivedApplyReceipt && queueEntry.recievedAppliedReceipt != null) {
                  if (
                    this.stateManager.transactionConsensus.hasAppliedReceiptMatchingPreApply(
                      queueEntry,
                      queueEntry.recievedAppliedReceipt
                    )
                  ) {
                    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_gotReceipt', `${shortID}`, `qId: ${queueEntry.entryID} `)

                    //todo check cant_apply flag to make sure a vote can form with it!
                    if (
                      this.stateManager.getReceiptVote(queueEntry).cant_apply === false &&
                      this.stateManager.getReceiptResult(queueEntry) === true
                    ) {
                      queueEntry.state = 'commiting'
                      queueEntry.hasValidFinalData = true
                      finishedConsensing = true
                    } else {
                      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_finishedFailReceipt2', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                      // we are finished since there is nothing to apply
                      //this.statemanager_fatal(`consensing: repairToMatchReceipt failed`, `consensing: repairToMatchReceipt failed ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
                      this.removeFromQueue(queueEntry, currentIndex)
                      queueEntry.state = 'fail'
                      continue
                    }

                    //continue
                  } else {
                    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_gotReceiptNoMatch2', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                    didNotMatchReceipt = true
                    queueEntry.appliedReceiptForRepair = queueEntry.recievedAppliedReceipt

                    queueEntry.appliedReceiptForRepair2 = this.stateManager.getReceipt2(queueEntry)
                  }
                } else {
                  //just keep waiting for a reciept
                }

                // we got a receipt but did not match it.
                if (didNotMatchReceipt === true) {
                  nestedCountersInstance.countEvent('stateManager', 'didNotMatchReceipt')
                  if (queueEntry.debugFail_failNoRepair) {
                    queueEntry.state = 'fail'
                    this.removeFromQueue(queueEntry, currentIndex)
                    nestedCountersInstance.countEvent('stateManager', 'debugFail_failNoRepair')
                    this.statemanager_fatal(
                      `processAcceptedTxQueue_debugFail_failNoRepair2`,
                      `processAcceptedTxQueue_debugFail_failNoRepair2 tx: ${shortID} cycle:${
                        queueEntry.cycleToRecordOn
                      }  accountkeys: ${utils.stringifyReduce(queueEntry.uniqueWritableKeys)}`
                    )
                    this.processQueue_clearAccountsSeen(seenAccounts, queueEntry)
                    continue
                  }

                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_didNotMatchReceipt', `${shortID}`, `qId: ${queueEntry.entryID} result:${queueEntry.appliedReceiptForRepair.result} `)
                  queueEntry.repairFinished = false
                  if (queueEntry.appliedReceiptForRepair.result === true) {
                    // need to start repair process and wait
                    //await note: it is best to not await this.  it should be an async operation.
                    this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
                    queueEntry.state = 'await repair'
                    continue
                  } else {
                    // We got a reciept, but the consensus is that this TX was not applied.
                    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_finishedFailReceipt3', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                    // we are finished since there is nothing to apply
                    this.statemanager_fatal(
                      `consensing: repairToMatchReceipt failed`,
                      `consensing: repairToMatchReceipt failed ` +
                        `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`
                    )
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
              /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitRepair_repairFinished', `${shortID}`, `qId: ${queueEntry.entryID} result:${queueEntry.appliedReceiptForRepair.result} txAge:${txAge} `)
              if (queueEntry.appliedReceiptForRepair.result === true) {
                queueEntry.state = 'pass'
              } else {
                // technically should never get here, because we dont need to repair to a receipt when the network did not apply the TX
                queueEntry.state = 'fail'
              }
              // most remove from queue at the end because it compacts the queue entry
              this.removeFromQueue(queueEntry, currentIndex)

              // console.log('Await Repair Finished', queueEntry.acceptedTx.txId, queueEntry)

              nestedCountersInstance.countEvent('stateManager', 'repairFinished')
              continue
            }
          }
          if (queueEntry.state === 'await final data') {
            //wait patiently for data to match receipt
            //if we run out of time repair to receipt?

            if (this.processQueue_accountSeen(seenAccounts, queueEntry) === false) {
              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)

              //temp hack ... hopefully this hack can go away
              if (queueEntry.recievedAppliedReceipt == null || queueEntry.recievedAppliedReceipt2 == null) {
                const result = await this.stateManager.transactionConsensus.tryProduceReceipt(queueEntry)
                if (result != null) {
                  queueEntry.recievedAppliedReceipt = result
                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitFinalData_hackReceipt', `${shortID}`, `qId: ${queueEntry.entryID} result:${utils.stringifyReduce(result)}`)
                }
              }

              //collectedFinalData
              const vote = this.stateManager.getReceiptVote(queueEntry)
              const accountsNotStored = new Set()
              if (vote) {
                let failed = false
                let incomplete = false
                let skipped = 0
                const nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData =
                  this.stateManager.currentCycleShardData.nodeShardData

                /* eslint-disable security/detect-object-injection */
                for (let i = 0; i < vote.account_id.length; i++) {
                  const accountID = vote.account_id[i]
                  const accountHash = vote.account_state_hash_after[i]

                  //only check for stored keys.
                  if (
                    ShardFunctions.testAddressInRange(accountID, nodeShardData.storedPartitions) === false
                  ) {
                    skipped++
                    accountsNotStored.add(accountID)
                    continue
                  }

                  const wrappedAccount = queueEntry.collectedFinalData[accountID]
                  if (wrappedAccount == null) {
                    incomplete = true
                    queueEntry.debug.waitingOn = accountID
                    break
                  }
                  if (wrappedAccount.stateId != accountHash) {
                    if (logFlags.debug)
                      this.mainLogger.debug(
                        `shrd_awaitFinalData_failed : ${queueEntry.logID} wrappedAccount.stateId != accountHash`
                      )
                    failed = true
                    break
                  }
                }
                /* eslint-enable security/detect-object-injection */

                if (failed === true) {
                  this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
                  queueEntry.state = 'await repair'
                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitFinalData_failed', `${shortID}`, `qId: ${queueEntry.entryID} skipped:${skipped}`)
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.error(`shrd_awaitFinalData_failed : ${queueEntry.logID} `)
                  continue
                }
                if (failed === false && incomplete === false) {
                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitFinalData_passed', `${shortID}`, `qId: ${queueEntry.entryID} skipped:${skipped}`)
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.error(`shrd_awaitFinalData_passed : ${queueEntry.logID} skipped:${skipped}`)

                  //TODO vote order should be in apply response order!
                  //This matters for certain daps only.  No longer important to shardeum
                  const rawAccounts = []
                  const accountRecords: Shardus.WrappedData[] = []
                  /* eslint-disable security/detect-object-injection */
                  for (let i = 0; i < vote.account_id.length; i++) {
                    const accountID = vote.account_id[i]
                    //skip accounts we don't store
                    if (accountsNotStored.has(accountID)) {
                      continue
                    }
                    const wrappedAccount = queueEntry.collectedFinalData[accountID]
                    rawAccounts.push(wrappedAccount.data)
                    accountRecords.push(wrappedAccount)
                  }
                  /* eslint-enable security/detect-object-injection */
                  //await this.app.setAccountData(rawAccounts)
                  const awaitStart = shardusGetTime()
                  /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.checkAndSetAccountData()' )
                  await this.stateManager.checkAndSetAccountData(
                    accountRecords,
                    'awaitFinalData_passed',
                    false
                  )
                  /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.checkAndSetAccountData()', DebugComplete.Completed )
                  queueEntry.accountDataSet = true
                  this.updateSimpleStatsObject(
                    processStats.awaitStats,
                    'checkAndSetAccountData',
                    shardusGetTime() - awaitStart
                  )

                  //log tx processed if needed
                  if (
                    queueEntry != null &&
                    queueEntry.transactionGroup != null &&
                    this.p2p.getNodeId() === queueEntry.transactionGroup[0].id
                  ) {
                    if (queueEntry.globalModification === false) {
                      //temp way to make global modifying TXs not over count
                      this.stateManager.eventEmitter.emit('txProcessed')
                    }
                  }

                  if (
                    queueEntry.recievedAppliedReceipt?.result === true ||
                    queueEntry.recievedAppliedReceipt2?.result === true
                  ) {
                    queueEntry.state = 'pass'
                  } else {
                    /* prettier-ignore */
                    if (logFlags.debug) this.mainLogger.error(`shrd_awaitFinalData_fail : ${queueEntry.logID} no receivedAppliedRecipt or recievedAppliedReceipt2`);
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
              /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting : ${queueEntry.logID} `)
              /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_commitingTx', `${shortID}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${this.processQueue_debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)

              // /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug( ` processAcceptedTxQueue2. ${queueEntry.entryID} timestamp: ${queueEntry.txKeys.timestamp}`)

              // TODO STATESHARDING4 SYNC related need to reconsider how to set this up again
              // if (queueEntry.didSync) {
              //   /* prettier-ignore */ if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_commiting', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}`)
              //   // if we did sync it is time to JIT query local data.  alternatively could have other nodes send us this data, but that could be very high bandwidth.
              //   for (let key of queueEntry.syncKeys) {
              //     let wrappedState = await this.app.getRelevantData(key, queueEntry.acceptedTx.data)
              //     /* prettier-ignore */ if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_getLocalData', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID}  key:${utils.makeShortHash(key)} hash:${wrappedState.stateId}`)
              //     queueEntry.localCachedData[key] = wrappedState.localCache
              //   }
              // }

              if (queueEntry.debugFail_failNoRepair) {
                queueEntry.state = 'fail'
                this.removeFromQueue(queueEntry, currentIndex)
                nestedCountersInstance.countEvent('stateManager', 'debugFail_failNoRepair')
                this.statemanager_fatal(
                  `processAcceptedTxQueue_debugFail_failNoRepair`,
                  `processAcceptedTxQueue_debugFail_failNoRepair tx: ${shortID} cycle:${
                    queueEntry.cycleToRecordOn
                  }  accountkeys: ${utils.stringifyReduce(queueEntry.uniqueWritableKeys)}`
                )
                this.processQueue_clearAccountsSeen(seenAccounts, queueEntry)
                continue
              }

              const wrappedStates = queueEntry.collectedData // Object.values(queueEntry.collectedData)

              //TODO apply the data we got!!! (override wrapped states)
              // if(this.executeInOneShard){
              //   for(let key of Object.keys(queueEntry.collectedFinalData)){
              //     wrappedStates[key] = queueEntry.collectedFinalData[key]
              //   }
              // }
              // make sure the branches below will use this data correctly

              // commit  queueEntry.preApplyTXResult.applyResponse.... hmm
              // aslo is queueEntry.preApplyTXResult.applyResponse use above in tex data tell?

              // console.log('Commiting TX', queueEntry.acceptedTx.txId, queueEntry)

              try {
                let canCommitTX = true
                let hasReceiptFail = false
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

                /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_commitingTx', `${shortID}`, `canCommitTX: ${canCommitTX} `)
                if (canCommitTX) {
                  // this.mainLogger.debug(` processAcceptedTxQueue2. applyAcceptedTransaction ${queueEntry.entryID} timestamp: ${queueEntry.txKeys.timestamp} queuerestarts: ${localRestartCounter} queueLen: ${this.newAcceptedTxQueue.length}`)

                  // Need to go back and thing on how this was supposed to work:
                  //queueEntry.acceptedTx.transactionGroup = queueEntry.transactionGroup // Used to not double count txProcessed

                  //try {
                  this.profiler.profileSectionStart('commit')

                  const awaitStart = shardusGetTime()
                  /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.commitConsensedTransaction()' )
                  await this.commitConsensedTransaction(queueEntry)
                  /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.commitConsensedTransaction()', DebugComplete.Completed )
                  this.updateSimpleStatsObject(
                    processStats.awaitStats,
                    'commitConsensedTransaction',
                    shardusGetTime() - awaitStart
                  )

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
                }

                // console.log('Can Commit TX', queueEntry.acceptedTx.txId, queueEntry)

                if (this.config.p2p.experimentalSnapshot) this.addReceiptToForward(queueEntry)
                // console.log('commit commit', queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp)

                if (hasReceiptFail) {
                  // endpoint to allow dapp to execute something that depends on a transaction failing

                  const applyReponse = queueEntry.preApplyTXResult.applyResponse // TODO STATESHARDING4 ... if we get here from a non standard path may need to get this data from somewhere else

                  this.app.transactionReceiptFail(queueEntry.acceptedTx.data, wrappedStates, applyReponse)
                }
              } catch (ex) {
                /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug('processAcceptedTxQueue2 commiting Transaction:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
                this.statemanager_fatal(
                  `processAcceptedTxQueue2b_ex`,
                  'processAcceptedTxQueue2 commiting Transaction:' +
                    ex.name +
                    ': ' +
                    ex.message +
                    ' at ' +
                    ex.stack
                )
              } finally {
                this.processQueue_clearAccountsSeen(seenAccounts, queueEntry)

                if (queueEntry.noConsensus === true) {
                  // dont have a receipt for a non consensus TX. not even sure if we want to keep that!
                  if (queueEntry.preApplyTXResult.passed === true) {
                    queueEntry.state = 'pass'
                  } else {
                    queueEntry.state = 'fail'
                  }
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : noConsensus:${queueEntry.state} ${queueEntry.logID} `)
                } else if (queueEntry.appliedReceipt2 != null) {
                  // the final state of the queue entry will be pass or fail based on the receipt
                  if (queueEntry.appliedReceipt2.result === true) {
                    queueEntry.state = 'pass'
                  } else {
                    queueEntry.state = 'fail'
                  }
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : Recpt:${queueEntry.state} ${queueEntry.logID} `)
                } else if (queueEntry.recievedAppliedReceipt2 != null) {
                  // the final state of the queue entry will be pass or fail based on the receipt
                  if (queueEntry.recievedAppliedReceipt2.result === true) {
                    queueEntry.state = 'pass'
                  } else {
                    queueEntry.state = 'fail'
                  }
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : recvRecpt:${queueEntry.state} ${queueEntry.logID} `)
                } else {
                  queueEntry.state = 'fail'
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`processAcceptedTxQueue2 commiting finished : no receipt ${queueEntry.logID} `)
                }

                /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_commitingTxFinished', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} qRst:${localRestartCounter} values: ${this.processQueue_debugAccountData(queueEntry, app)} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`)

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
              //     /* prettier-ignore */ if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_dataTell', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID} AccountBeingShared: ${utils.stringifyReduce(queueEntry.txKeys.allKeys)} txid: ${utils.makeShortHash(message.txid)} nodes:${utils.stringifyReduce(this.stateManager.currentCycleShardData.syncingNeighbors.map(x => x.id))}`)
              //     this.p2p.tell(this.stateManager.currentCycleShardData.syncingNeighbors, 'broadcast_state', message)
              //   }
              // }
            }
          }
          if (queueEntry.state === 'canceled') {
            ///////////////////////////////////////////////--canceled--////////////////////////////////////////////////////////////
            //need to review this state look unused
            this.processQueue_clearAccountsSeen(seenAccounts, queueEntry)
            this.removeFromQueue(queueEntry, currentIndex)
            /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 canceled : ${queueEntry.logID} `)
            nestedCountersInstance.countEvent('stateManager', 'canceled')
          }
        } finally {
          this.profiler.profileSectionEnd(`process-${pushedProfilerTag}`)
          profilerInstance.scopedProfileSectionEnd(`scoped-process-${pushedProfilerTag}`)

          //let do some more stats work
          const txElapsed = shardusGetTime() - txStartTime
          if (queueEntry.state != pushedProfilerTag) {
            processStats.stateChanged++
            this.updateSimpleStatsObject(processStats.stateChangedStats, pushedProfilerTag, txElapsed)
          } else {
            processStats.sameState++
            this.updateSimpleStatsObject(processStats.sameStateStats, pushedProfilerTag, txElapsed)
          }

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

      const processTime = shardusGetTime() - startTime

      processStats.totalTime = processTime

      this.finalizeSimpleStatsObject(processStats.awaitStats)
      this.finalizeSimpleStatsObject(processStats.sameStateStats)
      this.finalizeSimpleStatsObject(processStats.stateChangedStats)

      this.lastProcessStats['latest'] = processStats
      if (processTime > 10000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 10s')
        this.statemanager_fatal(
          `processAcceptedTxQueue excceded time ${processTime / 1000} firstTime:${firstTime}`,
          `processAcceptedTxQueue excceded time ${
            processTime / 1000
          } firstTime:${firstTime} stats:${JSON.stringify(processStats)}`
        )
        this.lastProcessStats['10+'] = processStats
      } else if (processTime > 5000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 5s')
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`processTime > 5s ${processTime / 1000} stats:${JSON.stringify(processStats)}`)
        this.lastProcessStats['5+'] = processStats
      } else if (processTime > 2000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 2s')
        /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`processTime > 2s ${processTime / 1000} stats:${JSON.stringify(processStats)}`)
        this.lastProcessStats['2+'] = processStats
      } else if (processTime > 1000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 1s')
        /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`processTime > 1s ${processTime / 1000} stats:${JSON.stringify(processStats)}`)
        this.lastProcessStats['1+'] = processStats
      }

      // restart loop if there are still elements in it
      if (this._transactionQueue.length > 0 || this.pendingTransactionQueue.length > 0) {
        this.transactionQueueHasRemainingWork = true
        setTimeout(() => {
          this.stateManager.tryStartTransactionProcessingQueue()
        }, 15)
      } else {
        this.transactionQueueHasRemainingWork = false
      }

      this.transactionProcessingQueueRunning = false
      this.processingLastRunTime = shardusGetTime()
      this.stateManager.lastSeenAccountsMap = seenAccounts

      this.profiler.profileSectionEnd('processQ')
    }
  }

  private setTXExpired(queueEntry: QueueEntry, currentIndex: number, message: string): void {
    /* prettier-ignore */ if (logFlags.verbose || this.stateManager.consensusLog) this.mainLogger.debug(`setTXExpired tx:${queueEntry.logID} ${message}  ts:${queueEntry.acceptedTx.timestamp} debug:${utils.stringifyReduce(queueEntry.debug)}`)
    queueEntry.state = 'expired'
    this.removeFromQueue(queueEntry, currentIndex)

    /* prettier-ignore */ nestedCountersInstance.countEvent( 'txExpired', `tx: ${this.app.getSimpleTxDebugValue(queueEntry.acceptedTx?.data)}` )

    //This is really important.  If we are going to expire a TX, then look to see if we already have a receipt for it.
    //If so, then just go into async receipt repair mode for the TX AFTER it has been expired and removed from the queue
    if (queueEntry.appliedReceiptFinal2 != null) {
      const startRepair = queueEntry.repairStarted === false
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`setTXExpired. start repair:${startRepair}. update ${queueEntry.logID}`)
      if (startRepair) {
        nestedCountersInstance.countEvent('repair1', 'setTXExpired: start repair')
        queueEntry.appliedReceiptForRepair2 = queueEntry.appliedReceiptFinal2
        //todo any limits to how many repairs at once to allow?
        this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
      }
    }
  }

  addReceiptToForward(queueEntry: QueueEntry): void {
    const netId = '123abc'
    // const receipt = this.stateManager.getReceipt(queueEntry)
    // const status = receipt.result === true ? 'applied' : 'rejected'
    const status = this.stateManager.getReceiptResult(queueEntry) === true ? 'applied' : 'rejected'

    const txHash = queueEntry.acceptedTx.txId
    const obj = { tx: queueEntry.acceptedTx.data, status, netId }
    const txResultFullHash = this.crypto.hash(obj)
    const txIdShort = utils.short(txHash)
    const txResult = utils.short(txResultFullHash)

    const txReceiptToPass = {
      tx: {
        originalTxData: queueEntry.acceptedTx.data['tx'] || queueEntry.acceptedTx.data,
        txId: txHash,
        timestamp: queueEntry.acceptedTx.timestamp,
      } as unknown as AcceptedTx,
      cycle: queueEntry.cycleToRecordOn,
      result: { txIdShort, txResult },
      beforeStateAccounts: [],
      accounts: [],
      receipt: queueEntry.preApplyTXResult.applyResponse.appReceiptData || null,
    }

    const accountsToAdd = {} as Shardus.AccountsCopy
    const beforeAccountsToAdd = {} as Shardus.AccountsCopy

    if (this.config.stateManager.includeBeforeStatesInReceipts) {
      for (const account of Object.values(queueEntry.collectedData)) {
        if (
          typeof this.app.beforeStateAccountFilter !== 'function' ||
          this.app.beforeStateAccountFilter(account)
        ) {
          const isGlobal = this.stateManager.accountGlobals.isGlobalAccount(account.accountId)
          const accountCopy = {
            accountId: account.accountId,
            data: account.data,
            timestamp: account.timestamp,
            stateId: account.stateId,
            isGlobal,
          }
          beforeAccountsToAdd[account.accountId] = accountCopy
        }
      }
    }

    // override with the accouns in accountWrites
    if (
      queueEntry.preApplyTXResult.applyResponse.accountWrites != null &&
      queueEntry.preApplyTXResult.applyResponse.accountWrites.length > 0
    ) {
      for (const account of queueEntry.preApplyTXResult.applyResponse.accountWrites) {
        const isGlobal = this.stateManager.accountGlobals.isGlobalAccount(account.accountId)
        accountsToAdd[account.accountId] = {
          accountId: account.accountId,
          data: account.data.data,
          timestamp: account.timestamp,
          stateId: account.data.stateId,
          isGlobal,
        }
      }
    }

    txReceiptToPass.accounts = [...Object.values(accountsToAdd)]
    txReceiptToPass.beforeStateAccounts = [...Object.values(beforeAccountsToAdd)]
    // console.log('acceptedTx', queueEntry.acceptedTx)
    // console.log('txReceiptToPass', txReceiptToPass.tx.txId, txReceiptToPass)

    // console.log('App Receipt', queueEntry.preApplyTXResult.applyResponse.appReceiptData)
    // console.log('App Receipt Data Hash', queueEntry.preApplyTXResult.applyResponse.appReceiptDataHash)

    const signedTxReceiptToPass: any = this.crypto.sign(txReceiptToPass)

    if (this.config.p2p.instantForwardReceipts) {
      Archivers.instantForwardReceipts([signedTxReceiptToPass])
      this.receiptsForwardedTimestamp = shardusGetTime()
    }
    this.receiptsToForward.push(signedTxReceiptToPass)
  }

  getReceiptsToForward(): Receipt[] {
    const freshReceipts = []
    for (const receipt of this.receiptsToForward) {
      if (!this.forwardedReceipts.has(receipt.tx.txId)) {
        freshReceipts.push(receipt)
      }
    }
    return freshReceipts
  }

  resetReceiptsToForward(): void {
    const RECEIPT_CLEANUP_INTERVAL_MS = 30000 // 30 seconds
    if (
      !this.config.p2p.instantForwardReceipts &&
      shardusGetTime() - this.lastReceiptForwardResetTimestamp >= RECEIPT_CLEANUP_INTERVAL_MS
    ) {
      const lastReceiptsToForward = [...this.receiptsToForward]
      this.receiptsToForward = []
      for (const receipt of lastReceiptsToForward) {
        // Start sending from the last receipts it saved (30s of data) when a new node is selected
        if (
          !this.forwardedReceipts.has(receipt.tx.txId) &&
          !this.oldNotForwardedReceipts.has(receipt.tx.txId)
        ) {
          this.receiptsToForward.push(receipt)
        }
      }
      this.forwardedReceipts = new Map()
      this.oldNotForwardedReceipts = new Map()
      for (const receipt of this.receiptsToForward) {
        this.oldNotForwardedReceipts.set(receipt.tx.txId, true)
      }
      this.lastReceiptForwardResetTimestamp = shardusGetTime()
    } else if (this.config.p2p.instantForwardReceipts) {
      const lastReceiptsToForward = [...this.receiptsToForward]
      this.receiptsToForward = []
      // Save the receipts by the last 10 seconds, 20 seconds, and 30 seconds.
      this.receiptsBundleByInterval.set(
        Archivers.ReceiptsBundleByInterval['30SECS_DATA'],
        this.receiptsBundleByInterval.get(Archivers.ReceiptsBundleByInterval['20SECS_DATA'])
      )
      this.receiptsBundleByInterval.set(
        Archivers.ReceiptsBundleByInterval['20SECS_DATA'],
        this.receiptsBundleByInterval.get(Archivers.ReceiptsBundleByInterval['10SECS_DATA'])
      )
      this.receiptsBundleByInterval.set(
        Archivers.ReceiptsBundleByInterval['10SECS_DATA'],
        lastReceiptsToForward
      )
      if (logFlags.console) console.log('receiptsBundleByInterval', this.receiptsBundleByInterval)
      this.lastReceiptForwardResetTimestamp = shardusGetTime()
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
    if (this.config.debug.useShardusMemoryPatterns && queueEntry.shardusMemoryPatternSets != null) {
      return this.processQueue_accountSeen2(seenAccounts, queueEntry)
    }

    if (queueEntry.uniqueKeys == null) {
      //TSConversion double check if this needs extra logging
      return false
    }
    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
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
  processQueue_markAccountsSeen(seenAccounts: SeenAccounts, queueEntry: QueueEntry): void {
    if (this.config.debug.useShardusMemoryPatterns && queueEntry.shardusMemoryPatternSets != null) {
      this.processQueue_markAccountsSeen2(seenAccounts, queueEntry)
      return
    }

    if (queueEntry.uniqueWritableKeys == null) {
      //TSConversion double check if this needs extra logging
      return
    }
    // only mark writeable keys as seen but we will check/clear against all keys
    /* eslint-disable security/detect-object-injection */
    for (const key of queueEntry.uniqueWritableKeys) {
      if (seenAccounts[key] == null) {
        seenAccounts[key] = queueEntry
      }
    }
    /* eslint-enable security/detect-object-injection */
  }

  // this.queueReads = new Set()
  // this.queueWrites = new Set()
  processQueue_accountSeen2(seenAccounts: SeenAccounts, queueEntry: QueueEntry): boolean {
    if (queueEntry.uniqueKeys == null) {
      //TSConversion double check if this needs extra logging
      return false
    }

    if (queueEntry.shardusMemoryPatternSets != null) {
      //normal blocking for read write
      for (const id of queueEntry.shardusMemoryPatternSets.rw) {
        if (this.queueWrites.has(id)) {
          return true
        }
        if (this.queueReadWritesOld.has(id)) {
          return true
        }
        //also blocked by upstream reads
        if (this.queueReads.has(id)) {
          return true
        }
      }
      // in theory write only is not blocked by upstream writes
      // but has to wait its turn if there is an uptream read
      for (const id of queueEntry.shardusMemoryPatternSets.wo) {
        //also blocked by upstream reads
        if (this.queueReads.has(id)) {
          return true
        }
        if (this.queueReadWritesOld.has(id)) {
          return true
        }
      }

      // write once...  also not blocked in theory, because the first op is a write
      // this is a special case for something like code bytes that are written once
      // and then immutable
      // for (const id of queueEntry.shardusMemoryPatternSets.on) {
      //   if(this.queueWrites.has(id)){
      //     return true
      //   }
      //   if(this.queueWritesOld.has(id)){
      //     return true
      //   }
      // }

      //read only blocks for upstream writes
      for (const id of queueEntry.shardusMemoryPatternSets.ro) {
        if (this.queueWrites.has(id)) {
          return true
        }
        if (this.queueReadWritesOld.has(id)) {
          return true
        }
        //note blocked by upstream reads, because this read only operation
        //will not impact the upstream read
      }

      //we made it, not blocked
      return false
    }

    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
      if (seenAccounts[key] != null) {
        return true
      }
    }

    return false
  }

  processQueue_markAccountsSeen2(seenAccounts: SeenAccounts, queueEntry: QueueEntry): void {
    if (queueEntry.uniqueWritableKeys == null) {
      //TSConversion double check if this needs extra logging
      return
    }

    if (queueEntry.shardusMemoryPatternSets != null) {
      for (const id of queueEntry.shardusMemoryPatternSets.rw) {
        this.queueWrites.add(id)
        this.queueReads.add(id)
      }
      for (const id of queueEntry.shardusMemoryPatternSets.wo) {
        this.queueWrites.add(id)
      }
      for (const id of queueEntry.shardusMemoryPatternSets.on) {
        this.queueWrites.add(id)
      }
      for (const id of queueEntry.shardusMemoryPatternSets.ro) {
        this.queueReads.add(id)
      }
      return
    }

    // only mark writeable keys as seen but we will check/clear against all keys
    /* eslint-disable security/detect-object-injection */
    for (const key of queueEntry.uniqueWritableKeys) {
      if (seenAccounts[key] == null) {
        seenAccounts[key] = queueEntry
      }
      //old style memory access is treated as RW:
      this.queueReadWritesOld.add(key)
    }
    /* eslint-enable security/detect-object-injection */
  }

  /**
   * processQueue_clearAccountsSeen
   * Helper for processQueue to clear accounts that were marked as seen.
   * a seen account is a an account that is involved in a TX that is upstream(older) in the queue
   * @param seenAccounts
   * @param queueEntry
   */
  processQueue_clearAccountsSeen(seenAccounts: SeenAccounts, queueEntry: QueueEntry): void {
    if (queueEntry.uniqueKeys == null) {
      //TSConversion double check if this needs extra logging
      return
    }
    /* eslint-disable security/detect-object-injection */
    for (const key of queueEntry.uniqueKeys) {
      if (seenAccounts[key] === queueEntry) {
        seenAccounts[key] = null
      }
    }
    /* eslint-enable security/detect-object-injection */
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
      return queueEntry.logID + ' uniqueKeys empty error'
    }
    /* eslint-disable security/detect-object-injection */
    for (const key of queueEntry.uniqueKeys) {
      if (queueEntry.collectedData[key] != null) {
        debugStr +=
          utils.makeShortHash(key) + ' : ' + app.getAccountDebugValue(queueEntry.collectedData[key]) + ', '
      }
    }
    /* eslint-enable security/detect-object-injection */
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
    const timestamp = queueEntry.acceptedTx.timestamp
    const ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
    for (const key of queueEntry.uniqueWritableKeys) {
      if (this.stateManager.accountGlobals.isGlobalAccount(key)) {
        //ignore globals in non global mod tx.
        continue
      }

      let hasKey = false
      const { homePartition } = ShardFunctions.addressToPartition(
        this.stateManager.currentCycleShardData.shardGlobals,
        key
      )
      const nodeStoresThisPartition = ShardFunctions.testInRange(homePartition, ourNodeData.storedPartitions)
      // if (queueEntry.patchedOnNodes.has(ourNodeData.node.id)) {
      //   hasKey = true
      // }
      hasKey = nodeStoresThisPartition

      //if(queueEntry.localKeys[key] === true){
      if (hasKey) {
        const accountHash = this.stateManager.accountCache.getAccountHash(key)
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
    for (const accountID of Object.keys(queueEntry.involvedReads)) {
      const cacheEntry = this.stateManager.accountCache.getAccountHash(accountID)
      if (cacheEntry != null && cacheEntry.t >= queueEntry.acceptedTx.timestamp) {
        return false
      }
    }
    for (const accountID of Object.keys(queueEntry.involvedWrites)) {
      const cacheEntry = this.stateManager.accountCache.getAccountHash(accountID)
      if (cacheEntry != null && cacheEntry.t >= queueEntry.acceptedTx.timestamp) {
        return false
      }
    }
    return true
  }

  /**
   * Computes a sieve time for a TX.  This is a deterministic time bonus that is given so that
   * when TXs older than time M2 are getting culled due waiting on an older upstream TX
   * that we thin the list between time M2 and M2.5.  The idea is that this thinning
   * makes next in line TXs that are close to M2.5 more rare.  Node processing loops are not time synced with
   * each other at a real time level so different nodes may resolve TX as slightly different times.
   * This method hopes to improve the probablity nodes choose the same TX to work on after a TX has timed out.
   * TXs may time out if they are prepetually too old. Simply cutting off the younger TXs as an earlier time when blocked
   * such as time = M2 is not good enough because there is too much time jitter between nodes are working on that part of the list
   * this was causing nodes to all pick different TXs to work on.  When nodes pick differnt TXs the are all likely to just
   * age out to time M3 without ever getting enough votes.  The could happen at even 5tps for the same contract.
   * The time sieve helps this situation.
   *
   * At high TPS per single problems there are still issues recovering.  extraRare is feature designed to help
   * give scores in the top 1% an extra second of queue life.  hopefully if the list is thrahsing badly due to too many TXs
   * and nodes having bad luck picking the next one to work on that this extra second will give a better chance that everything syncs
   * back up.  This may not bee enough yet. but probably good for 1.2 refresh 1.  The downside to extra rare is that it makes the
   * tx only about 2 seconds away from the hard M3 timeout.  But this is a rare event also, so if it backfires then the impact should also be
   * low.  There may even be a chance that this would still help nodes sync up a bit.
   * @param queueEntry
   */
  computeTxSieveTime(queueEntry: QueueEntry): void {
    //TODO need to make this non-exploitable.  Need to include factors
    //that could not be set by the transaction creator, but are deterministic in the network.

    let score = 0
    //queueEntry.cycleToRecordOn
    const fourByteString = queueEntry.acceptedTx.txId.slice(0, 8)
    const intScore = Number.parseInt(fourByteString, 16)
    score = intScore / 4294967296.0 //2147483648.0   // 0-1 range

    score = Math.abs(score)

    let extraRare = false
    if (score > 0.99) {
      extraRare = true
    }

    //shape the curve so that smaller values are more common
    score = score * score * score

    score = Math.round(score * 10) / 10

    if (score > 1) {
      nestedCountersInstance.countEvent('stateManager', `computeTxSieveTime score > 1 ${score}`)
      score = 1
    } else {
      if (extraRare) {
        score = score + 0.3 //this may help sync things if there is a very high volume of TX to the same contract
      }

      nestedCountersInstance.countEvent('stateManager', `computeTxSieveTime score ${score}`)
    }

    //The score can give us up to one half of M extra time after M2 timeout.  (but a bit extra if extraRare)
    queueEntry.txSieveTime = 0.5 * this.stateManager.queueSitTime * score
  }

  updateSimpleStatsObject(
    statsObj: { [statName: string]: SimpleNumberStats },
    statName: string,
    duration: number
  ): void {
    // eslint-disable-next-line security/detect-object-injection
    let statsEntry = statsObj[statName]
    if (statsEntry == null) {
      statsEntry = {
        min: Number.MAX_SAFE_INTEGER,
        max: 0,
        total: 0,
        count: 0,
        average: 0,
      }
      // eslint-disable-next-line security/detect-object-injection
      statsObj[statName] = statsEntry
    }
    statsEntry.count++
    statsEntry.max = Math.max(statsEntry.max, duration)
    statsEntry.min = Math.min(statsEntry.min, duration)
    statsEntry.total += duration
  }

  finalizeSimpleStatsObject(statsObj: { [statName: string]: SimpleNumberStats }): void {
    for (const [, value] of Object.entries(statsObj)) {
      if (value.count) {
        value.average = value.total / value.count
      }
      value.average = Math.round(value.average * 100) / 100
      value.max = Math.round(value.max * 100) / 100
      value.min = Math.round(value.min * 100) / 100
      value.total = Math.round(value.total * 100) / 100
    }
  }

  getConsenusGroupForAccount(accountID: string): Shardus.Node[] {
    const { homePartition } = ShardFunctions.addressToPartition(
      this.stateManager.currentCycleShardData.shardGlobals,
      accountID
    )
    const homeShardData = this.stateManager.currentCycleShardData.parititionShardDataMap.get(homePartition)
    const consenusGroup = homeShardData.homeNodes[0].consensusNodeForOurNodeFull.slice()
    return consenusGroup
  }

  getRandomConsensusNodeForAccount(accountID: string, excludeNodeIds: string[] = []): Shardus.Node {
    const { homePartition } = ShardFunctions.addressToPartition(
      this.stateManager.currentCycleShardData.shardGlobals,
      accountID
    )
    const homeShardData = this.stateManager.currentCycleShardData.parititionShardDataMap.get(homePartition)
    //dont need to copy list
    const consenusGroup = homeShardData.homeNodes[0].consensusNodeForOurNodeFull

    // remove excluded consensus nodes
    const filteredConsensusGroup = consenusGroup.filter((node) => excludeNodeIds.indexOf(node.id) === -1)
    return filteredConsensusGroup[Math.floor(Math.random() * filteredConsensusGroup.length)]
  }

  getStorageGroupForAccount(accountID: string): Shardus.Node[] {
    const { homePartition } = ShardFunctions.addressToPartition(
      this.stateManager.currentCycleShardData.shardGlobals,
      accountID
    )
    const homeShardData = this.stateManager.currentCycleShardData.parititionShardDataMap.get(homePartition)
    const storageGroup = homeShardData.homeNodes[0].nodeThatStoreOurParitionFull.slice()
    return storageGroup
  }

  isAccountRemote(accountID: string): boolean {
    const ourNodeShardData = this.stateManager.currentCycleShardData.nodeShardData
    const minP = ourNodeShardData.consensusStartPartition
    const maxP = ourNodeShardData.consensusEndPartition
    const { homePartition } = ShardFunctions.addressToPartition(
      this.stateManager.currentCycleShardData.shardGlobals,
      accountID
    )
    const accountIsRemote = ShardFunctions.partitionInWrappingRange(homePartition, minP, maxP) === false
    return accountIsRemote
  }

  /** count the number of queue entries that will potentially execute on this node */
  getExecuteQueueLength(): number {
    let length = 0
    for (const queueEntry of this._transactionQueue) {
      //TODO shard hopping will have to consider if updating this value is imporant to how our load detection works.
      //probably not since it is a zero sum game if we move it
      if (queueEntry.isInExecutionHome) {
        length++
      }
    }
    return length
  }

  getAccountQueueCount(accountID: string, remote = false): QueueCountsResult {
    nestedCountersInstance.countEvent('stateManager', `getAccountQueueCount`)
    let count = 0
    const committingAppData: Shardus.AcceptedTx['appData'] = []
    for (const queueEntry of this.pendingTransactionQueue) {
      if (queueEntry.txKeys.sourceKeys.length > 0 && accountID === queueEntry.txKeys.sourceKeys[0]) {
        const tx = queueEntry.acceptedTx
        /* prettier-ignore */ if (logFlags.verbose) console.log( 'getAccountQueueCount: found upstream tx in the injested queue:', `appData: ${JSON.stringify(tx.appData)}` )
        count++
      }
    }
    for (const queueEntry of this._transactionQueue) {
      if (queueEntry.txKeys.sourceKeys.length > 0 && accountID === queueEntry.txKeys.sourceKeys[0]) {
        const tx = queueEntry.acceptedTx
        if (queueEntry.state === 'commiting' && queueEntry.accountDataSet === false) {
          committingAppData.push(tx.appData)
          continue
        }
        /* prettier-ignore */ if (logFlags.verbose) console.log( 'getAccountQueueCount: found upstream tx in the newAccepted queue:', `appData: ${JSON.stringify(tx.appData)}` )
        count++
      }
    }
    /* prettier-ignore */ if (logFlags.verbose) console.log(`getAccountQueueCount: remote:${remote} ${count} acc:${utils.stringifyReduce(accountID)}`)
    return { count, committingAppData }
  }

  /**
   * call this to test if the processing queue is stuck.
   * currently this may return false positives if the queue is not stuck but is just slow
   * autoUnstickProcessing will attempt to fix the stuck processing if set to true
   */
  checkForStuckProcessing(): void {
    const timeSinceLastProcessLoop = shardusGetTime() - this.processingLastRunTime
    const limitInMS = this.config.stateManager.stuckProcessingLimit * 1000

    if (timeSinceLastProcessLoop > limitInMS) {
      if (this.isStuckProcessing === false) {
        this.isStuckProcessing = true
        //we are now newly stuck processing
        this.onProcesssingQueueStuck()
        this.stuckProcessingCount++
      }
      nestedCountersInstance.countEvent('processing', 'processingStuckThisCycle')
      this.stuckProcessingCyclesCount++
      if (this.transactionProcessingQueueRunning) {
        this.stuckProcessingQueueLockedCyclesCount++
      }

      if (this.config.stateManager.autoUnstickProcessing === true) {
        this.fixStuckProcessing(true)
        //seems we should do this too:
        this.stateManager.forceUnlockAllFifoLocks('autoUnstickProcessing')
      }
    }
  }

  /**
   * This is called when we detect that the processing queue is stuck
   */
  onProcesssingQueueStuck(): void {
    if (this.stuckProcessingCount === 0) {
      //first time!
      nestedCountersInstance.countRareEvent('processing', `onProcesssingQueueStuck`)

      this.statemanager_fatal(
        `onProcesssingQueueStuck`,
        `onProcesssingQueueStuck: ${JSON.stringify(this.getDebugProccessingStatus())}`
      )
    }

    //clear this map as it would be stale now
    this.stateManager.lastSeenAccountsMap = null

    //in the future we could tell the node to go apop?
    if (this.config.stateManager.apopFromStuckProcessing === true) {
      Apoptosis.apoptosizeSelf('Apoptosized due to stuck processing')
    }
  }

  getDebugProccessingStatus(): unknown {
    let txDebug = ''
    if (this.debugRecentQueueEntry != null) {
      const app = this.app
      const queueEntry = this.debugRecentQueueEntry
      txDebug = `logID:${queueEntry.logID} state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification}`
      txDebug += ` qId: ${queueEntry.entryID} values: ${this.processQueue_debugAccountData(
        queueEntry,
        app
      )} AcceptedTransaction: ${utils.stringifyReduce(queueEntry.acceptedTx)}`
    }
    return {
      isStuckProcessing: this.isStuckProcessing,
      transactionProcessingQueueRunning: this.transactionProcessingQueueRunning,
      stuckProcessingCount: this.stuckProcessingCount,
      stuckProcessingCyclesCount: this.stuckProcessingCyclesCount,
      stuckProcessingQueueLockedCyclesCount: this.stuckProcessingQueueLockedCyclesCount,
      processingLastRunTime: this.processingLastRunTime,
      debugLastProcessingQueueStartTime: this.debugLastProcessingQueueStartTime,
      debugLastAwaitedCall: this.debugLastAwaitedCall,
      debugLastAwaitedCallInner: this.debugLastAwaitedCallInner,
      debugLastAwaitedAppCall: this.debugLastAwaitedAppCall,
      debugLastAwaitedCallInnerStack: this.debugLastAwaitedCallInnerStack,
      debugLastAwaitedAppCallStack: this.debugLastAwaitedAppCallStack,
      txDebug,
      //todo get the transaction we are stuck on. what type is it? id etc.
    }
  }

  clearStuckProcessingDebugVars(): void {
    this.isStuckProcessing = false
    this.debugLastAwaitedCall = ''
    this.debugLastAwaitedCallInner = ''
    this.debugLastAwaitedAppCall = ''
    this.debugLastAwaitedCallInnerStack = {}
    this.debugLastAwaitedAppCallStack = {}

    this.debugRecentQueueEntry = null
    this.debugLastProcessingQueueStartTime = 0

    this.stuckProcessingCount = 0
    this.stuckProcessingCyclesCount = 0
    this.stuckProcessingQueueLockedCyclesCount = 0
  }

  /**
   * Used to unblock and restart the processing queue if it gets stuck
   * @param clearPendingTransactions if true, will clear the pending transaction queue. if false, will leave it alone
   */
  fixStuckProcessing(clearPendingTransactions: boolean): void {
    nestedCountersInstance.countRareEvent('processing', `unstickProcessing`)
    this.clearStuckProcessingDebugVars()

    //clear this map as it would be stale now
    this.stateManager.lastSeenAccountsMap = null
    //unlock the queu so it can start again
    this.transactionProcessingQueueRunning = false

    if (clearPendingTransactions) {
      this.pendingTransactionQueue = []
    }

    this.stateManager.tryStartTransactionProcessingQueue()
  }

  setDebugLastAwaitedCall(label: string, complete = DebugComplete.Incomplete): void {
    this.debugLastAwaitedCall = label + (complete === DebugComplete.Completed ? ' complete' : '')
    this.debugLastAwaitedCallInner = ''
    this.debugLastAwaitedAppCall = ''
  }

  setDebugLastAwaitedCallInner(label: string, complete = DebugComplete.Incomplete): void {
    this.debugLastAwaitedCallInner = label + (complete === DebugComplete.Completed ? ' complete' : '')
    this.debugLastAwaitedAppCall = ''

    if (complete === DebugComplete.Incomplete) {
      // eslint-disable-next-line security/detect-object-injection
      if (this.debugLastAwaitedCallInnerStack[label] == null) {
        // eslint-disable-next-line security/detect-object-injection
        this.debugLastAwaitedCallInnerStack[label] = 1
      } else {
        // eslint-disable-next-line security/detect-object-injection
        this.debugLastAwaitedCallInnerStack[label]++
      }
    } else {
      //decrement the count if it is greater than 1, delete the key if the count is 1
      // eslint-disable-next-line security/detect-object-injection
      if (this.debugLastAwaitedCallInnerStack[label] != null) {
        // eslint-disable-next-line security/detect-object-injection
        if (this.debugLastAwaitedCallInnerStack[label] > 1) {
          // eslint-disable-next-line security/detect-object-injection
          this.debugLastAwaitedCallInnerStack[label]--
        } else {
          // eslint-disable-next-line security/detect-object-injection
          delete this.debugLastAwaitedCallInnerStack[label]
        }
      }
    }
  }
  setDebugSetLastAppAwait(label: string, complete = DebugComplete.Incomplete): void {
    this.debugLastAwaitedAppCall = label + (complete === DebugComplete.Completed ? ' complete' : '')

    if (complete === DebugComplete.Incomplete) {
      // eslint-disable-next-line security/detect-object-injection
      if (this.debugLastAwaitedAppCallStack[label] == null) {
        // eslint-disable-next-line security/detect-object-injection
        this.debugLastAwaitedAppCallStack[label] = 1
      } else {
        // eslint-disable-next-line security/detect-object-injection
        this.debugLastAwaitedAppCallStack[label]++
      }
    } else {
      //decrement the count if it is greater than 1, delete the key if the count is 1
      // eslint-disable-next-line security/detect-object-injection
      if (this.debugLastAwaitedAppCallStack[label] != null) {
        // eslint-disable-next-line security/detect-object-injection
        if (this.debugLastAwaitedAppCallStack[label] > 1) {
          // eslint-disable-next-line security/detect-object-injection
          this.debugLastAwaitedAppCallStack[label]--
        } else {
          // eslint-disable-next-line security/detect-object-injection
          delete this.debugLastAwaitedAppCallStack[label]
        }
      }
    }
  }
  clearDebugAwaitStrings(): void {
    this.debugLastAwaitedCall = ''
    this.debugLastAwaitedCallInner = ''
    this.debugLastAwaitedAppCall = ''
    this.debugLastAwaitedCallInnerStack = {}
    this.debugLastAwaitedAppCallStack = {}
  }
}

export default TransactionQueue
