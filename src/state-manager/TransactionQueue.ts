import * as Context from '../p2p/Context'
import { P2P as P2PTypes, StateManager as StateManagerTypes } from '@shardus/types'
import StateManager from '.'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import * as Apoptosis from '../p2p/Apoptosis'
import * as Archivers from '../p2p/Archivers'
import { P2PModuleContext as P2P, network as networkContext, config as configContext } from '../p2p/Context'
import * as CycleChain from '../p2p/CycleChain'
import { nodes, byPubKey, potentiallyRemoved, activeByIdOrder } from '../p2p/NodeList'
import * as Shardus from '../shardus/shardus-types'
import Storage from '../storage'
import * as utils from '../utils'
import { getCorrespondingNodes, verifyCorrespondingSender } from '../utils/fastAggregatedCorrespondingTell'
import {Signature, SignedObject} from '@shardus/crypto-utils'
import {
  errorToStringFull,
  inRangeOfCurrentTime,
  withTimeout,
  XOR,
} from '../utils'
import { Utils } from '@shardus/types'
import * as Self from '../p2p/Self'
import * as Comms from '../p2p/Comms'
import { nestedCountersInstance } from '../utils/nestedCounters'
import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'
import ShardFunctions from './shardFunctions'
import * as NodeList from '../p2p/NodeList'
import {
  AcceptedTx,
  AccountFilter,
  AppliedReceipt,
  AppliedReceipt2,
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
  ArchiverReceipt,
  NonceQueueItem,
  AppliedVote
} from './state-manager-types'
import { isInternalTxAllowed, networkMode } from '../p2p/Modes'
import { Node } from '@shardus/types/build/src/p2p/NodeListTypes'
import { Logger as L4jsLogger } from 'log4js'
import { ipInfo, shardusGetTime } from '../network'
import { InternalBinaryHandler } from '../types/Handler'
import {
  BroadcastStateReq,
  deserializeBroadcastStateReq,
  serializeBroadcastStateReq,
} from '../types/BroadcastStateReq'
import {
  getStreamWithTypeCheck,
  requestErrorHandler,
  verificationDataCombiner,
  verificationDataSplitter,
} from '../types/Helpers'
import { RequestErrorEnum } from '../types/enum/RequestErrorEnum'
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum'
import { TypeIdentifierEnum } from '../types/enum/TypeIdentifierEnum'
import {
  BroadcastFinalStateReq,
  deserializeBroadcastFinalStateReq,
  serializeBroadcastFinalStateReq,
} from '../types/BroadcastFinalStateReq'
import { verifyPayload } from '../types/ajv/Helpers'
import {
  SpreadTxToGroupSyncingReq,
  deserializeSpreadTxToGroupSyncingReq,
  serializeSpreadTxToGroupSyncingReq,
} from '../types/SpreadTxToGroupSyncingReq'
import { RequestTxAndStateReq, serializeRequestTxAndStateReq } from '../types/RequestTxAndStateReq'
import { RequestTxAndStateResp, deserializeRequestTxAndStateResp } from '../types/RequestTxAndStateResp'
import { deserializeRequestStateForTxReq, serializeRequestStateForTxReq } from '../types/RequestStateForTxReq'
import {
  deserializeRequestStateForTxResp,
  RequestStateForTxRespSerialized,
  serializeRequestStateForTxResp,
} from '../types/RequestStateForTxResp'
import {
  deserializeRequestReceiptForTxResp,
  RequestReceiptForTxRespSerialized,
} from '../types/RequestReceiptForTxResp'
import {
  RequestReceiptForTxReqSerialized,
  serializeRequestReceiptForTxReq,
} from '../types/RequestReceiptForTxReq'
import { isNodeInRotationBounds } from '../p2p/Utils'
import { BadRequest, ResponseError, serializeResponseError } from '../types/ResponseError'
import { error } from 'console'
import { PoqoDataAndReceiptReq, serializePoqoDataAndReceiptReq } from '../types/PoqoDataAndReceiptReq'
import { AJVSchemaEnum } from '../types/enum/AJVSchemaEnum'

interface Receipt {
  tx: AcceptedTx
}

const txStatBucketSize = {
  default: [
    1, 2, 4, 8, 16, 30, 60, 125, 250, 500, 1000, 2000, 4000, 8000, 10000, 20000, 30000, 60000, 100000,
  ],
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
  seqLogger: L4jsLogger
  fatalLogger: L4jsLogger
  shardLogger: L4jsLogger
  statsLogger: L4jsLogger
  statemanager_fatal: (key: string, log: string) => void

  _transactionQueue: QueueEntry[] //old name: newAcceptedTxQueue
  pendingTransactionQueue: QueueEntry[] //old name: newAcceptedTxQueueTempInjest
  archivedQueueEntries: QueueEntry[]
  txDebugStatList: utils.FIFOCache<string, TxDebug>

  _transactionQueueByID: Map<string, QueueEntry> //old name: newAcceptedTxQueueByID
  pendingTransactionQueueByID: Map<string, QueueEntry> //old name: newAcceptedTxQueueTempInjestByID
  archivedQueueEntriesByID: Map<string, QueueEntry>
  receiptsToForward: ArchiverReceipt[]
  forwardedReceiptsByTimestamp: Map<number, ArchiverReceipt>
  receiptsBundleByInterval: Map<number, ArchiverReceipt[]>
  receiptsForwardedTimestamp: number

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
  usePOQo: boolean

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
  nonceQueue: Map<string, NonceQueueItem[]>

  constructor(
    stateManager: StateManager,
    profiler: Profiler,
    app: Shardus.App,
    logger: Logger,
    storage: Storage,
    p2p: P2P,
    crypto: Crypto,
    config: Shardus.StrictServerConfiguration,
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
    this.usePOQo = this.config.stateManager.usePOQo

    this.mainLogger = logger.getLogger('main')
    this.seqLogger = logger.getLogger('seq')
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
    this.nonceQueue = new Map()
    this.txDebugStatList = new utils.FIFOCache<string, TxDebug>(this.config.debug.debugStatListMaxSize)
    this.receiptsToForward = []
    this.forwardedReceiptsByTimestamp = new Map()
    this.receiptsBundleByInterval = new Map()
    this.receiptsForwardedTimestamp = shardusGetTime()

    this._transactionQueueByID = new Map()
    this.pendingTransactionQueueByID = new Map()
    this.archivedQueueEntriesByID = new Map()

    this.archivedQueueEntryMaxCount = 5000 // was 50000 but this too high
    // 10k will fit into memory and should persist long enough at desired loads
    this.transactionProcessingQueueRunning = false

    this.processingLastRunTime = 0
    this.processingMinRunBreak = 200 //20 //200ms breaks between processing loops
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
    // this.p2p.registerInternal(
    //   'broadcast_state',
    //   async (payload: { txid: string; stateList: Shardus.WrappedResponse[] }) => {
    //     profilerInstance.scopedProfileSectionStart('broadcast_state')
    //     try {
    //       // Save the wrappedAccountState with the rest our queue data
    //       // let message = { stateList: datas, txid: queueEntry.acceptedTX.id }
    //       // this.p2p.tell([correspondingEdgeNode], 'broadcast_state', message)

    //       // make sure we have it
    //       const queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
    //       //It is okay to ignore this transaction if the txId is not found in the queue.
    //       if (queueEntry == null) {
    //         //In the past we would enqueue the TX, expecially if syncing but that has been removed.
    //         //The normal mechanism of sharing TXs is good enough.
    //         nestedCountersInstance.countEvent('processing', 'broadcast_state_noQueueEntry')
    //         return
    //       }
    //       // add the data in
    //       for (const data of payload.stateList) {
    //         if (
    //           configContext.stateManager.collectedDataFix &&
    //           configContext.stateManager.rejectSharedDataIfCovered
    //         ) {
    //           const consensusNodes = this.stateManager.transactionQueue.getConsenusGroupForAccount(
    //             data.accountId
    //           )
    //           const coveredByUs = consensusNodes.map((node) => node.id).includes(Self.id)
    //           if (coveredByUs) {
    //             nestedCountersInstance.countEvent('processing', 'broadcast_state_coveredByUs')
    //             /* prettier-ignore */ if (logFlags.verbose) console.log(`broadcast_state: coveredByUs: ${data.accountId} no need to accept this data`)
    //             continue
    //           } else {
    //             this.queueEntryAddData(queueEntry, data)
    //           }
    //         } else {
    //           this.queueEntryAddData(queueEntry, data)
    //         }

    //         if (queueEntry.state === 'syncing') {
    //           /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastData', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
    //         }
    //       }
    //     } finally {
    //       profilerInstance.scopedProfileSectionEnd('broadcast_state')
    //     }
    //   }
    // )

    this.p2p.registerInternal(
      'broadcast_state_complete_data',
      async (payload: { txid: string; stateList: Shardus.WrappedResponse[] }) => {
        profilerInstance.scopedProfileSectionStart('broadcast_state_complete_data')
        try {
          const queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
          if (queueEntry == null) {
            nestedCountersInstance.countEvent('processing', 'broadcast_state_complete_data_noQueueEntry')
            return
          }
          if (queueEntry.gossipedCompleteData === true) {
            return
          }
          for (const data of payload.stateList) {
            if (configContext.stateManager.collectedDataFix && configContext.stateManager.rejectSharedDataIfCovered) {
              const consensusNodes = this.stateManager.transactionQueue.getConsenusGroupForAccount(data.accountId)
              const coveredByUs = consensusNodes.map((node) => node.id).includes(Self.id)
              if (coveredByUs) {
                nestedCountersInstance.countEvent('processing', 'broadcast_state_coveredByUs')
                /* prettier-ignore */ if (logFlags.verbose) console.log(`broadcast_state: coveredByUs: ${data.accountId} no need to accept this data`)
                continue
              } else {
                this.queueEntryAddData(queueEntry, data)
              }
            } else {
              this.queueEntryAddData(queueEntry, data)
            }
          }
          Comms.sendGossip(
            'broadcast_state_complete_data',
            payload,
            undefined,
            undefined,
            queueEntry.executionGroup,
            false,
            6,
            queueEntry.acceptedTx.txId
          )
          queueEntry.gossipedCompleteData = true
        } finally {
          profilerInstance.scopedProfileSectionEnd('broadcast_state_complete_data')
        }
      }
    )

    const broadcastStateRoute: P2PTypes.P2PTypes.Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_broadcast_state,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: (payload, respond, header, sign) => {
        const route = InternalRouteEnum.binary_broadcast_state
        nestedCountersInstance.countEvent('internal', route)
        profilerInstance.scopedProfileSectionStart(route, false, payload.length)
        const errorHandler = (
          errorType: RequestErrorEnum,
          opts?: { customErrorLog?: string; customCounterSuffix?: string }
        ): void => requestErrorHandler(route, errorType, header, opts)

        try {
          const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cBroadcastStateReq)
          if (!requestStream) {
            return errorHandler(RequestErrorEnum.InvalidRequest)
          }
          // verification data checks
          if (header.verification_data == null) {
            return errorHandler(RequestErrorEnum.MissingVerificationData)
          }
          const verificationDataParts = verificationDataSplitter(header.verification_data)
          if (verificationDataParts.length !== 3) {
            return errorHandler(RequestErrorEnum.InvalidVerificationData)
          }
          const [vTxId, vStateSize, vStateAddress] = verificationDataParts
          const queueEntry = this.getQueueEntrySafe(vTxId)
          //It is okay to ignore this transaction if the txId is not found in the queue.
          if (queueEntry == null) {
            /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`${route} cant find queueEntry for: ${utils.makeShortHash(vTxId)}`)
            return errorHandler(RequestErrorEnum.InvalidVerificationData, {
              customCounterSuffix: 'queueEntryNotFound',
            })
          }

          const req = deserializeBroadcastStateReq(requestStream)
          if (req.txid !== vTxId) {
            return errorHandler(RequestErrorEnum.InvalidVerificationData)
          }

          if (req.stateList.length !== parseInt(vStateSize)) {
            return errorHandler(RequestErrorEnum.InvalidVerificationData)
          }
          /* prettier-ignore */ if (logFlags.verbose && logFlags.console) console.log(`${route}: txId: ${req.txid} stateSize: ${req.stateList.length} stateAddress: ${vStateAddress}`)

          const senderNodeId = header.sender_id
          let isSenderOurExeNeighbour = false
          const senderIsInExecutionGroup = queueEntry.executionGroupMap.has(senderNodeId)
          const neighbourNodes = utils.selectNeighbors(queueEntry.executionGroup, queueEntry.ourExGroupIndex, 2) as Shardus.Node[]
          const neighbourNodeIds = neighbourNodes.map((node) => node.id)
          isSenderOurExeNeighbour = senderIsInExecutionGroup && neighbourNodeIds.includes(senderNodeId)

          for (let i = 0; i < req.stateList.length; i++) {
            // eslint-disable-next-line security/detect-object-injection
            const state = req.stateList[i];
            let isSenderValid = false
            if (configContext.p2p.useFactCorrespondingTell) {
              // check if it is a neighbour exe node sharing data
              if (configContext.stateManager.shareCompleteData) {
                if (isSenderOurExeNeighbour) {
                  nestedCountersInstance.countEvent('stateManager', 'factValidateCorrespondingTellSender: sender is an execution node and a neighbour node')
                  isSenderValid = true
                } else {
                  // check if it is a corresponding tell sender
                  isSenderValid = this.factValidateCorrespondingTellSender(
                    queueEntry,
                    state.accountId,
                    senderNodeId
                  )
                }
              } else {
                // check if it is a corresponding tell sender
                isSenderValid = this.factValidateCorrespondingTellSender(
                  queueEntry,
                  state.accountId,
                  senderNodeId
                )
              }
            } else {
              isSenderValid = this.validateCorrespondingTellSender(queueEntry, state.accountId, senderNodeId)
            }

            if (this.stateManager.testFailChance(configContext.debug.ignoreDataTellChance, 
            'ignoreDataTellChance', queueEntry.logID, '', logFlags.verbose ) === true ) {
              isSenderValid = false
            }

            if (isSenderValid === false) {
              this.mainLogger.error(`${route} validateCorrespondingTellSender failed for ${state.accountId}`);
              nestedCountersInstance.countEvent('processing', 'validateCorrespondingTellSender failed')
              return errorHandler(RequestErrorEnum.InvalidSender);
            }
            if (configContext.stateManager.collectedDataFix && configContext.stateManager.rejectSharedDataIfCovered) {
              const consensusNodes = this.stateManager.transactionQueue.getConsenusGroupForAccount(state.accountId)
              const coveredByUs = consensusNodes.map((node) => node.id).includes(Self.id)
              if (coveredByUs) {
                nestedCountersInstance.countEvent('processing', 'broadcast_state_coveredByUs')
                /* prettier-ignore */ if (logFlags.verbose) console.log(`broadcast_state: coveredByUs: ${state.accountId} no need to accept this data`)
                continue
              } else {
                this.queueEntryAddData(queueEntry, state)
              }
            } else {
              this.queueEntryAddData(queueEntry, state)
            }
            if (queueEntry.state === 'syncing') {
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastData', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${state.accountId}`)
            }
          }
        } catch (e) {
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          this.mainLogger.error(`${route}: Exception executing request: ${errorToStringFull(e)}`)
        } finally {
          profilerInstance.scopedProfileSectionEnd(route, payload.length)
        }
      },
    }

    this.p2p.registerInternalBinary(broadcastStateRoute.name, broadcastStateRoute.handler)

    // Comms.registerInternal(
    //   'broadcast_finalstate',
    //   async (payload: { txid: string; stateList: Shardus.WrappedResponse[] }, respond: () => void,
    //   _sender: P2PTypes.NodeListTypes.Node,
    //   _tracker: string,
    //   msgSize: number) => {
    //     profilerInstance.scopedProfileSectionStart('broadcast_finalstate')
    //     try {
    //       // make sure we have it
    //       const queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
    //       //It is okay to ignore this transaction if the txId is not found in the queue.
    //       if (queueEntry == null) {
    //         //In the past we would enqueue the TX, expecially if syncing but that has been removed.
    //         //The normal mechanism of sharing TXs is good enough.
    //         nestedCountersInstance.countEvent('processing', 'broadcast_finalstate_noQueueEntry')
    //         return
    //       }
    //       if (logFlags.debug)
    //         this.mainLogger.debug(`broadcast_finalstate ${queueEntry.logID}, ${Utils.safeStringify(payload.stateList)}`)
    //       // add the data in
    //       const savedAccountIds: Set<string> = new Set()
    //       for (const data of payload.stateList) {
    //         //let wrappedResponse = data as Shardus.WrappedResponse
    //         //this.queueEntryAddData(queueEntry, data)
    //         if (data == null) {
    //           /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`broadcast_finalstate data == null`)
    //           continue
    //         }
    //         // validate corresponding tell sender
    //         if (_sender == null ||  _sender.id == null) {
    //           /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`broadcast_finalstate invalid sender for data: ${data.accountId}, sender: ${JSON.stringify(_sender)}`)
    //           continue
    //         }
    //         const isValidFinalDataSender = this.factValidateCorrespondingTellFinalDataSender(queueEntry, _sender.id)
    //         if (isValidFinalDataSender === false) {
    //           /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`broadcast_finalstate invalid sender ${_sender.id} for data: ${data.accountId}`)
    //           continue
    //         }
    //         if (queueEntry.collectedFinalData[data.accountId] == null) {
    //           queueEntry.collectedFinalData[data.accountId] = data
    //           savedAccountIds.add(data.accountId)
    //           /* prettier-ignore */ if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('broadcast_finalstate', `${queueEntry.logID}`, `broadcast_finalstate addFinalData qId: ${queueEntry.entryID} data:${utils.makeShortHash(data.accountId)} collected keys: ${utils.stringifyReduce(Object.keys(queueEntry.collectedFinalData))}`)
    //         }

    //         // if (queueEntry.state === 'syncing') {
    //         //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastfinalstate', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
    //         // }
    //       }
    //       const nodesToSendTo: Set<Node> = new Set()
    //       for (const data of payload.stateList) {
    //         if (data == null) {
    //           continue
    //         }
    //         if (savedAccountIds.has(data.accountId) === false) {
    //           continue
    //         }
    //         const storageNodes = this.stateManager.transactionQueue.getStorageGroupForAccount(data.accountId)
    //         for (const node of storageNodes) {
    //           nodesToSendTo.add(node)
    //         }
    //       }
    //       if (nodesToSendTo.size > 0) {
    //         Comms.sendGossip(
    //           'gossip-final-state',
    //           payload,
    //           null,
    //           null,
    //           Array.from(nodesToSendTo),
    //           false,
    //           4,
    //           queueEntry.acceptedTx.txId
    //         )
    //         nestedCountersInstance.countEvent(`processing`, `forwarded final data to storage nodes`)
    //       }
    //     } finally {
    //       profilerInstance.scopedProfileSectionEnd('broadcast_finalstate')
    //     }
    //   }
    // )

    const broadcastFinalStateRoute: P2PTypes.P2PTypes.Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_broadcast_finalstate,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: (payload, response, header, sign) => {
        const route = InternalRouteEnum.binary_broadcast_finalstate
        nestedCountersInstance.countEvent('internal', route)
        profilerInstance.scopedProfileSectionStart(route, false, payload.length)
        const errorHandler = (
          errorType: RequestErrorEnum,
          opts?: { customErrorLog?: string; customCounterSuffix?: string }
        ): void => requestErrorHandler(route, errorType, header, opts)

        try {
          const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cBroadcastFinalStateReq)
          if (!requestStream) {
            return errorHandler(RequestErrorEnum.InvalidRequest)
          }

          // verification data checks
          if (header.verification_data == null) {
            return errorHandler(RequestErrorEnum.MissingVerificationData)
          }
          const verificationDataParts = verificationDataSplitter(header.verification_data)
          if (verificationDataParts.length !== 2) {
            return errorHandler(RequestErrorEnum.InvalidVerificationData)
          }
          const [vTxId, vStateSize] = verificationDataParts
          const queueEntry = this.getQueueEntrySafe(vTxId)
          //It is okay to ignore this transaction if the txId is not found in the queue.
          if (queueEntry == null) {
            /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`${route} cant find queueEntry for: ${utils.makeShortHash(vTxId)}`)
            return errorHandler(RequestErrorEnum.InvalidVerificationData, {
              customCounterSuffix: 'queueEntryNotFound',
            })
          }

          // deserialization
          const req = deserializeBroadcastFinalStateReq(requestStream)
          if (req.txid !== vTxId) {
            return errorHandler(RequestErrorEnum.InvalidVerificationData)
          }

          if (req.stateList.length !== parseInt(vStateSize)) {
            return errorHandler(RequestErrorEnum.InvalidVerificationData)
          }

          /* prettier-ignore */ if (logFlags.verbose && logFlags.console) console.log(`${route}: txId: ${req.txid} stateSize: ${req.stateList.length}`)
          let saveSomething = false
          for (const data of req.stateList) {
            //let wrappedResponse = data as Shardus.WrappedResponse
            //this.queueEntryAddData(queueEntry, data)
            if (data == null) {
              /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`broadcast_finalstate data == null`)
              continue
            }
            const isValidFinalDataSender = this.factValidateCorrespondingTellFinalDataSender(queueEntry, header.sender_id)
            if (isValidFinalDataSender === false) {
              /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`broadcast_finalstate invalid sender ${header.sender_id} for data: ${data.accountId}`)
              continue
            }
            if (queueEntry.collectedFinalData[data.accountId] == null) {
              queueEntry.collectedFinalData[data.accountId] = data
              saveSomething = true
              /* prettier-ignore */ if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('broadcast_finalstate', `${queueEntry.logID}`, `broadcast_finalstate addFinalData qId: ${queueEntry.entryID} data:${utils.makeShortHash(data.accountId)} collected keys: ${utils.stringifyReduce(Object.keys(queueEntry.collectedFinalData))}`)
            }
          }
        } catch (e) {
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          this.mainLogger.error(`${route}: Exception executing request: ${errorToStringFull(e)}`)
        } finally {
          profilerInstance.scopedProfileSectionEnd(route, payload.length)
        }
      },
    }

    this.p2p.registerInternalBinary(broadcastFinalStateRoute.name, broadcastFinalStateRoute.handler)

    // this.p2p.registerInternal(
    //   'spread_tx_to_group_syncing',
    //   async (payload: Shardus.AcceptedTx, _respondWrapped: unknown, sender: Node) => {
    //     profilerInstance.scopedProfileSectionStart('spread_tx_to_group_syncing')
    //     try {
    //       //handleSharedTX will also validate fields
    //       this.handleSharedTX(payload.data, payload.appData, sender)
    //     } finally {
    //       profilerInstance.scopedProfileSectionEnd('spread_tx_to_group_syncing')
    //     }
    //   }
    // )

    const spreadTxToGroupSyncingBinaryHandler: P2PTypes.P2PTypes.Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_spread_tx_to_group_syncing,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (payload, respond, header, sign) => {
        const route = InternalRouteEnum.binary_spread_tx_to_group_syncing
        nestedCountersInstance.countEvent('internal', route)
        this.profiler.scopedProfileSectionStart(route, false, payload.length)
        const errorHandler = (
          errorType: RequestErrorEnum,
          opts?: { customErrorLog?: string; customCounterSuffix?: string }
        ): void => requestErrorHandler(route, errorType, header, opts)

        try {
          const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cSpreadTxToGroupSyncingReq)
          if (!requestStream) {
            return errorHandler(RequestErrorEnum.InvalidRequest)
          }

          const req: SpreadTxToGroupSyncingReq = deserializeSpreadTxToGroupSyncingReq(requestStream)

          const ajvErrors = verifyPayload(AJVSchemaEnum.SpreadTxToGroupSyncingReq, req)
          if (ajvErrors && ajvErrors.length > 0) {
            this.mainLogger.error(`${route}: request validation errors: ${ajvErrors}`)
            return errorHandler(RequestErrorEnum.InvalidPayload)
          }

          const node = this.p2p.state.getNode(header.sender_id)
          this.handleSharedTX(req.data, req.appData, node)
        } catch (e) {
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          this.mainLogger.error(`${route}: Exception executing request: ${errorToStringFull(e)}`)
        } finally {
          this.profiler.scopedProfileSectionEnd(route)
        }
      },
    }

    this.p2p.registerInternalBinary(
      spreadTxToGroupSyncingBinaryHandler.name,
      spreadTxToGroupSyncingBinaryHandler.handler
    )

    this.p2p.registerGossipHandler(
      'spread_tx_to_group',
      async (
        payload: { data: Shardus.TimestampedTx; appData: unknown },
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
              false,
              -1,
              queueEntry.acceptedTx.txId
            )
            /* prettier-ignore */ if (logFlags.verbose) console.log( 'queueEntry.isInExecutionHome', queueEntry.acceptedTx.txId, queueEntry.isInExecutionHome )
            // If our node is in the execution group, forward this raw tx to the subscribed archivers
            if (queueEntry.isInExecutionHome === true) {
              this.addOriginalTxDataToForward(queueEntry)
            }
          }
        } finally {
          profilerInstance.scopedProfileSectionEnd('spread_tx_to_group', respondSize)
        }
      }
    )

    this.p2p.registerGossipHandler(
      'gossip-final-state',
      async (
        payload: { txid: string; stateList: Shardus.WrappedResponse[], txGroupCycle?: number },
        sender: Node,
        tracker: string,
        msgSize: number
      ) => {
        profilerInstance.scopedProfileSectionStart('gossip-final-state', false, msgSize)
        const respondSize = cUninitializedSize
        try {
          // make sure we have it
          const queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
          //It is okay to ignore this transaction if the txId is not found in the queue.
          if (queueEntry == null) {
            //In the past we would enqueue the TX, expecially if syncing but that has been removed.
            //The normal mechanism of sharing TXs is good enough.
            nestedCountersInstance.countEvent('processing', 'gossip-final-state_noQueueEntry')
            return
          }
          if (payload.txGroupCycle) {
            if (queueEntry.txGroupCycle !== payload.txGroupCycle) {
              /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`gossip-final-state mismatch txGroupCycle for txid: ${payload.txid}, sender's txGroupCycle: ${payload.txGroupCycle}, our txGroupCycle: ${queueEntry.txGroupCycle}`)
              nestedCountersInstance.countEvent(
                'processing',
                'gossip-final-state: mismatch txGroupCycle for txid ' + payload.txid
              )
            }
            delete payload.txGroupCycle
          }
          if (logFlags.debug)
            this.mainLogger.debug(`gossip-final-state ${queueEntry.logID}, ${Utils.safeStringify(payload.stateList)}`)
          // add the data in
          let saveSomething = false
          for (const data of payload.stateList) {
            //let wrappedResponse = data as Shardus.WrappedResponse
            //this.queueEntryAddData(queueEntry, data)
            if (data == null) {
              /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`broadcast_finalstate data == null`)
              continue
            }
            if (queueEntry.collectedFinalData[data.accountId] == null) {
              queueEntry.collectedFinalData[data.accountId] = data
              saveSomething = true
              /* prettier-ignore */ if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('broadcast_finalstate', `${queueEntry.logID}`, `broadcast_finalstate addFinalData qId: ${queueEntry.entryID} data:${utils.makeShortHash(data.accountId)} collected keys: ${utils.stringifyReduce(Object.keys(queueEntry.collectedFinalData))}`)
            }

            // if (queueEntry.state === 'syncing') {
            //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastfinalstate', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
            // }
          }
          if (saveSomething) {
            const nodesToSendTo: Set<Node> = new Set()
            for (const data of payload.stateList) {
              if (data == null) {
                continue
              }
              const storageNodes = this.stateManager.transactionQueue.getStorageGroupForAccount(data.accountId)
              for (const node of storageNodes) {
                nodesToSendTo.add(node)
              }
            }
            if (nodesToSendTo.size > 0) {
              payload.txGroupCycle = queueEntry.txGroupCycle
              Comms.sendGossip(
                'gossip-final-state',
                payload,
                undefined,
                undefined,
                Array.from(nodesToSendTo),
                false,
                4,
                queueEntry.acceptedTx.txId
              )
              nestedCountersInstance.countEvent(`processing`, `forwarded final data to storage nodes`)
            }
          }
        } finally {
          profilerInstance.scopedProfileSectionEnd('gossip-final-state', respondSize)
        }
      }
    )

    /**
     * request_state_for_tx
     * used by the transaction queue when a queue entry needs to ask for missing state
     */
    // this.p2p.registerInternal(
    //   'request_state_for_tx',
    //   async (payload: RequestStateForTxReq, respond: (arg0: RequestStateForTxResp) => unknown) => {
    //     profilerInstance.scopedProfileSectionStart('request_state_for_tx')
    //     try {
    //       const response: RequestStateForTxResp = {
    //         stateList: [],
    //         beforeHashes: {},
    //         note: '',
    //         success: false,
    //       }
    //       // app.getRelevantData(accountId, tx) -> wrappedAccountState  for local accounts
    //       let queueEntry = this.getQueueEntrySafe(payload.txid) // , payload.timestamp)
    //       if (queueEntry == null) {
    //         queueEntry = this.getQueueEntryArchived(payload.txid, 'request_state_for_tx') // , payload.timestamp)
    //       }

    //       if (queueEntry == null) {
    //         response.note = `failed to find queue entry: ${utils.stringifyReduce(payload.txid)}  ${
    //           payload.timestamp
    //         } dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txid)]}`
    //         await respond(response)
    //         // if a node cant get data it will have to get repaired by the patcher since we can only keep stuff en the archive queue for so long
    //         // due to memory concerns
    //         return
    //       }

    //       for (const key of payload.keys) {
    //         // eslint-disable-next-line security/detect-object-injection
    //         const data = queueEntry.originalData[key] // collectedData
    //         if (data) {
    //           //response.stateList.push(JSON.parse(data))
    //           response.stateList.push(data)
    //         }
    //       }
    //       response.success = true
    //       await respond(response)
    //     } finally {
    //       profilerInstance.scopedProfileSectionEnd('request_state_for_tx')
    //     }
    //   }
    // )

    const requestStateForTxRoute: P2PTypes.P2PTypes.Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_request_state_for_tx,
      handler: (payload, respond) => {
        const route = InternalRouteEnum.binary_request_state_for_tx
        profilerInstance.scopedProfileSectionStart(route)
        nestedCountersInstance.countEvent('internal', route)

        const response: RequestStateForTxRespSerialized = {
          stateList: [],
          beforeHashes: {},
          note: '',
          success: false,
        }
        try {
          const responseStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cRequestStateForTxReq)
          if (!responseStream) {
            this.mainLogger.error(`${route}: Invalid request`)
            respond(response, serializeRequestStateForTxResp)
            return
          }
          const req = deserializeRequestStateForTxReq(responseStream)
          if (req.txid == null) {
            throw new Error('Txid is null')
          }
          let queueEntry = this.getQueueEntrySafe(req.txid)
          if (queueEntry == null) {
            queueEntry = this.getQueueEntryArchived(req.txid, InternalRouteEnum.binary_request_state_for_tx)
          }

          if (queueEntry == null) {
            response.note = `failed to find queue entry: ${utils.stringifyReduce(req.txid)}  ${
              req.timestamp
            } dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(req.txid)]}`
            respond(response, serializeRequestStateForTxResp)
            // if a node cant get data it will have to get repaired by the patcher since we can only keep stuff en the archive queue for so long
            // due to memory concerns
            return
          }

          for (const key of req.keys) {
            // eslint-disable-next-line security/detect-object-injection
            const data = queueEntry.originalData[key] // collectedData
            if (data) {
              response.stateList.push(data)
            }
          }
          response.success = true
          respond(response, serializeRequestStateForTxResp)
        } catch (e) {
          this.mainLogger.error(
            `${
              InternalRouteEnum.binary_request_state_for_tx
            }: Exception executing request: ${errorToStringFull(e)}`
          )
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          respond(response, serializeRequestStateForTxResp)
        } finally {
          profilerInstance.scopedProfileSectionEnd(InternalRouteEnum.binary_request_state_for_tx)
        }
      },
    }

    this.p2p.registerInternalBinary(requestStateForTxRoute.name, requestStateForTxRoute.handler)

    networkContext.registerExternalPost('get-tx-receipt', async (req, res) => {
      let result: { success: boolean; receipt?: ArchiverReceipt | AppliedReceipt2; reason?: string }
      try {
        let error = utils.validateTypes(req.body, {
          txId: 's',
          timestamp: 'n',
          full_receipt: 'b',
          sign: 'o',
        })
        if (error) return res.send((result = { success: false, reason: error }))
        error = utils.validateTypes(req.body.sign, {
          owner: 's',
          sig: 's',
        })
        if (error) return res.send((result = { success: false, reason: error }))

        const { txId, timestamp, full_receipt, sign } = req.body
        const isReqFromArchiver = Archivers.archivers.has(sign.owner)
        if (!isReqFromArchiver) {
          result = { success: false, reason: 'Request not from Archiver.' }
        } else {
          const isValidSignature = this.crypto.verify(req.body, sign.owner)
          if (isValidSignature) {
            let queueEntry: QueueEntry
            if (
              this.archivedQueueEntriesByID.has(txId) &&
              this.archivedQueueEntriesByID.get(txId)?.acceptedTx?.timestamp === timestamp
            ) {
              if (logFlags.verbose) console.log('get-tx-receipt: ', txId, timestamp, 'archived')
              queueEntry = this.archivedQueueEntriesByID.get(txId)
            } else if (
              this._transactionQueueByID.has(txId) &&
              this._transactionQueueByID.get(txId)?.state === 'commiting' &&
              this._transactionQueueByID.get(txId)?.acceptedTx?.timestamp === timestamp
            ) {
              if (logFlags.verbose) console.log('get-tx-receipt: ', txId, timestamp, 'commiting')
              queueEntry = this._transactionQueueByID.get(txId)
            }
            if (!queueEntry) return res.status(400).json({ success: false, reason: 'Receipt Not Found.' })
            if (full_receipt) {
              const fullReceipt: ArchiverReceipt = this.getArchiverReceiptFromQueueEntry(queueEntry)
              if (fullReceipt === null) return res.status(400).json({ success: false, reason: 'Receipt Not Found.' })
              result = Utils.safeJsonParse(Utils.safeStringify({ success: true, receipt: fullReceipt }))
            } else {
              result = { success: true, receipt: this.stateManager.getReceipt2(queueEntry) }
            }
          } else {
            result = { success: false, reason: 'Invalid Signature.' }
          }
        }
        res.send(result)
      } catch (e) {
        console.log('Error caught in /get-tx-receipt: ', e)
        res.send((result = { success: false, reason: e }))
      }
    })
  }

  isTxInPendingNonceQueue(accountId: string, txId: string): boolean {
    this.mainLogger.debug(`isTxInPendingNonceQueue ${accountId} ${txId}`, this.nonceQueue)
    const queue = this.nonceQueue.get(accountId)
    if (queue == null) {
      return false
    }
    for (const item of queue) {
      if (item.txId === txId) {
        return true
      }
    }
    return false
  }

  getPendingCountInNonceQueue(): { totalQueued: number; totalAccounts: number; avgQueueLength: number} {
    let totalQueued = 0
    let totalAccounts = 0
    for (const queue of this.nonceQueue.values()) {
      totalQueued += queue.length
      totalAccounts++
    }
    const avgQueueLength = totalQueued / totalAccounts
    return { totalQueued, totalAccounts, avgQueueLength }
  }

  addTransactionToNonceQueue(nonceQueueEntry: NonceQueueItem): {success: boolean; reason?: string, alreadyAdded?: boolean} {
    try {
      let queue = this.nonceQueue.get(nonceQueueEntry.accountId)
      if (queue == null || (Array.isArray(queue) && queue.length === 0)) {
        queue = [nonceQueueEntry]
        this.nonceQueue.set(nonceQueueEntry.accountId, queue)
        if (logFlags.debug) this.mainLogger.debug(`adding new nonce tx: ${nonceQueueEntry.txId} ${nonceQueueEntry.accountId} with nonce ${nonceQueueEntry.nonce}`)
      } else if (queue && queue.length > 0) {
        const index = utils.binarySearch(queue, nonceQueueEntry, (a, b) => Number(a.nonce) - Number(b.nonce))
        if (index != -1) {
          // there is existing item with the same nonce. replace it with the new one
          queue[index] = nonceQueueEntry
          this.nonceQueue.set(nonceQueueEntry.accountId, queue)
          nestedCountersInstance.countEvent('processing', 'replaceExistingNonceTx')
          if (logFlags.debug) this.mainLogger.debug(`replace existing nonce tx ${nonceQueueEntry.accountId} with nonce ${nonceQueueEntry.nonce}, txId: ${nonceQueueEntry.txId}`)
          return { success: true, reason: 'Replace existing pending nonce tx', alreadyAdded: true }
        }
        // add new item to the queue
        utils.insertSorted(queue, nonceQueueEntry, (a, b) => Number(a.nonce) - Number(b.nonce));
        this.nonceQueue.set(nonceQueueEntry.accountId, queue)
      }
      /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455106 ${shardusGetTime()} tx:${nonceQueueEntry.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: pause_nonceQ`)
      nestedCountersInstance.countEvent('processing', 'addTransactionToNonceQueue')
      if (logFlags.debug) this.mainLogger.debug(`Added tx to nonce queue for ${nonceQueueEntry.accountId} with nonce ${nonceQueueEntry.nonce} nonceQueue: ${queue.length}`)
      return { success: true, reason: `Nonce queue size for account: ${queue.length}`, alreadyAdded: false }
    } catch (e) {
      nestedCountersInstance.countEvent('processing', 'addTransactionToNonceQueueError')
      this.mainLogger.error(`Error adding tx to nonce queue: ${e.message}, tx: ${utils.stringifyReduce(nonceQueueEntry)}`)
      return { success: false, reason: e.message, alreadyAdded: false }
    }
  }
  async processNonceQueue(accounts: Shardus.WrappedData[]): Promise<void> {
    for (const account of accounts) {
      const queue = this.nonceQueue.get(account.accountId)
      if (queue == null) {
        continue
      }
      for (const item of queue) {
        const accountNonce = await this.app.getAccountNonce(account.accountId, account)
        if (item.nonce === accountNonce) {
          nestedCountersInstance.countEvent('processing', 'processNonceQueue foundMatchingNonce')
          if (logFlags.debug) this.mainLogger.debug(`Found matching nonce in queue or ${account.accountId} with nonce ${item.nonce}`, item)
          item.appData.requestNewTimestamp = true
          await this.stateManager.shardus._timestampAndQueueTransaction(item.tx, item.appData, item.global, item.noConsensus)
          // remove the item from the queue
          const index = queue.indexOf(item)
          queue.splice(index, 1)

          //we should break here. we keep looking up account values after we go to the step needed.
          //this assumes we will not put two TXs with the same nonce value in the queue.
          break
        }
      }
    }
  }
  handleSharedTX(tx: Shardus.TimestampedTx, appData: unknown, sender: Shardus.Node): QueueEntry {
    profilerInstance.profileSectionStart('handleSharedTX')
    const internalTx = this.app.isInternalTx(tx)
    if ((internalTx && !isInternalTxAllowed()) || (!internalTx && networkMode !== 'processing')) {
      profilerInstance.profileSectionEnd('handleSharedTX')
      // Block invalid txs in case a node maliciously relays them to other nodes
      return null
    }
    // Perform fast validation of the transaction fields
    profilerInstance.scopedProfileSectionStart('handleSharedTX_validateTX')
    const validateResult = this.app.validate(tx, appData)
    profilerInstance.scopedProfileSectionEnd('handleSharedTX_validateTX')
    if (validateResult.success === false) {
      this.statemanager_fatal(
        `spread_tx_to_group_validateTX`,
        `spread_tx_to_group validateTxnFields failed: ${utils.stringifyReduce(validateResult)}`
      )
      profilerInstance.profileSectionEnd('handleSharedTX')
      return null
    }

    // Ask App to crack open tx and return timestamp, id (hash), and keys
    const { timestamp, id, keys, shardusMemoryPatterns } = this.app.crack(tx, appData)

    // Check if we already have this tx in our queue
    let queueEntry = this.getQueueEntrySafe(id) // , payload.timestamp)
    if (queueEntry) {
      profilerInstance.profileSectionEnd('handleSharedTX')
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
      profilerInstance.profileSectionEnd('handleSharedTX')
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
      profilerInstance.profileSectionEnd('handleSharedTX')
      return null // we are faking that the message got lost so bail here
    }
    if (added === 'out of range') {
      profilerInstance.profileSectionEnd('handleSharedTX')
      return null
    }
    if (added === 'notReady') {
      profilerInstance.profileSectionEnd('handleSharedTX')
      return null
    }
    queueEntry = this.getQueueEntrySafe(id) //, payload.timestamp) // now that we added it to the queue, it should be possible to get the queueEntry now

    if (queueEntry == null) {
      // do not gossip this, we are not involved
      // downgrading, this does not seem to be fatal, but may need further logs/testing
      //this.statemanager_fatal(`spread_tx_to_group_noQE`, `spread_tx_to_group failed: cant find queueEntry for:  ${utils.makeShortHash(payload.id)}`)
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('spread_tx_to_group_noQE', '', `spread_tx_to_group failed: cant find queueEntry for:  ${utils.makeShortHash(id)}`)
      profilerInstance.profileSectionEnd('handleSharedTX')
      return null
    }

    profilerInstance.profileSectionEnd('handleSharedTX')
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
    this.txDebugMarkStartTime(queueEntry, 'preApplyTransaction')

    //TODO need to adjust logic to add in more stuff.
    // may only need this in the case where we have hopped over to another shard or additional
    // accounts were passed in.  And that me handled earlier.

    /* eslint-disable security/detect-object-injection */
    for (const key of uniqueKeys) {
      if (wrappedStates[key] == null) {
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.console) console.log(`preApplyTransaction missing some account data. timestamp:${timestamp}  key: ${utils.makeShortHash(key)}  debuginfo:${debugInfo}`)
        this.txDebugMarkEndTime(queueEntry, 'preApplyTransaction')
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
      this.txDebugMarkEndTime(queueEntry, 'preApplyTransaction')
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

      if (configContext.stateManager.useCopiedWrappedStateForApply === true) {
        // deep copy the wrappedStates so that the app can't mess with them when we later share coplete data to neighbors
        const deepCopyWrappedStates = utils.deepCopy(wrappedStates)
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('stateManager.transactionQueue.app.apply(tx)')
        applyResponse = await this.app.apply(tx as Shardus.OpaqueTransaction, deepCopyWrappedStates, appData)
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('stateManager.transactionQueue.app.apply(tx)', DebugComplete.Completed)
      } else {
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('stateManager.transactionQueue.app.apply(tx)')
        applyResponse = await this.app.apply(tx as Shardus.OpaqueTransaction, wrappedStates, appData)
        /* prettier-ignore */ this.setDebugLastAwaitedCallInner('stateManager.transactionQueue.app.apply(tx)', DebugComplete.Completed)
      }

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

    this.txDebugMarkEndTime(queueEntry, 'preApplyTransaction')
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
        /* prettier-ignore */ this.mainLogger.debug( `commitConsensedTransaction txId: ${queueEntry.logID}  ts:${timestamp} isGlobalModifyingTX:${isGlobalModifyingTX}  Applying! debugInfo: ${debugInfo}` )
        /* prettier-ignore */ this.mainLogger.debug( `commitConsensedTransaction  filter: ${utils.stringifyReduce(queueEntry.localKeys)}` )
        /* prettier-ignore */ this.mainLogger.debug(`commitConsensedTransaction  acceptedTX: ${utils.stringifyReduce(acceptedTX)}`)
        /* prettier-ignore */ this.mainLogger.debug( `commitConsensedTransaction  wrappedStates: ${utils.stringifyReduce(wrappedStates)}` )
        /* prettier-ignore */ this.mainLogger.debug( `commitConsensedTransaction  localCachedData: ${utils.stringifyReduce(localCachedData)}` )
        /* prettier-ignore */ this.mainLogger.debug(`commitConsensedTransaction  preApplyResponse: ${utils.stringifyReduce(queueEntry.preApplyTXResult.applyResponse)}`)
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

      this.profiler.scopedProfileSectionStart('commit_setAccount')
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
        this.mainLogger.debug(`commitConsensedTransaction ${queueEntry.logID}  savedSomething: ${savedSomething}`)
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
      this.app.transactionReceiptPass(acceptedTX.data, wrappedStates, applyResponse, true)
      /* prettier-ignore */ if (logFlags.verbose) console.log('transactionReceiptPass 2', acceptedTX.txId, queueEntry)

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
    let cycleShardData = this.stateManager.currentCycleShardData
    if (Context.config.stateManager.deterministicTXCycleEnabled) {
      cycleShardData = this.stateManager.shardValuesByCycle.get(txQueueEntry.txGroupCycle)
    }

    if (cycleShardData != null && txQueueEntry.hasShardInfo === false) {
      const txId = txQueueEntry.acceptedTx.txId
      // Init home nodes!
      for (const key of txQueueEntry.txKeys.allKeys) {
        if (key == null) {
          throw new Error(`updateHomeInformation key == null ${key}`)
        }
        const homeNode = ShardFunctions.findHomeNode(
          cycleShardData.shardGlobals,
          key,
          cycleShardData.parititionShardDataMap
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
          const relationString = ShardFunctions.getNodeRelation(homeNode, cycleShardData.ourNode.id)
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

      if (configContext.stateManager.waitUpstreamTx) {
        const keysToCheck = []
        if (acceptedTx.shardusMemoryPatterns && acceptedTx.shardusMemoryPatterns.rw) {
          keysToCheck.push(...acceptedTx.shardusMemoryPatterns.rw)
        }
        if (acceptedTx.shardusMemoryPatterns && acceptedTx.shardusMemoryPatterns.wo) {
          keysToCheck.push(...acceptedTx.shardusMemoryPatterns.wo)
        }
        if (keysToCheck.length === 0) {
          const sourceKey = acceptedTx.keys.sourceKeys[0]
          keysToCheck.push(sourceKey)
        }
        for (const key of keysToCheck) {
          const isAccountInQueue = this.isAccountInQueue(key)
          if (isAccountInQueue) {
            nestedCountersInstance.countEvent('stateManager', `cancel enqueue, isAccountInQueue ${key} ${isAccountInQueue}`)
            return false
          }
        }
      }

      let cycleNumber = this.stateManager.currentCycleShardData.cycleNumber
      if (Context.config.stateManager.deterministicTXCycleEnabled) {
        cycleNumber = CycleChain.getCycleNumberFromTimestamp(
          acceptedTx.timestamp - Context.config.stateManager.reduceTimeFromTxTimestamp,
          true,
          false
        )
        if (cycleNumber > this.stateManager.currentCycleShardData.cycleNumber) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction derived txGroupCycle > currentCycleShardData.cycleNumber. txId:${txId} txGroupCycle:${cycleNumber} currentCycleShardData.cycleNumber:${this.stateManager.currentCycleShardData.cycleNumber}`)
          nestedCountersInstance.countEvent('stateManager', 'derived txGroupCycle is larger than current cycle')
          if (Context.config.stateManager.fallbackToCurrentCycleFortxGroup) {
            cycleNumber = this.stateManager.currentCycleShardData.cycleNumber
          }
        } else if (cycleNumber < this.stateManager.currentCycleShardData.cycleNumber) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction derived txGroupCycle < currentCycleShardData.cycleNumber. txId:${txId} txGroupCycle:${cycleNumber} currentCycleShardData.cycleNumber:${this.stateManager.currentCycleShardData.cycleNumber}`)
          nestedCountersInstance.countEvent('stateManager', 'derived txGroupCycle is less than current cycle')
        } else if (cycleNumber === this.stateManager.currentCycleShardData.cycleNumber) {
          nestedCountersInstance.countEvent('stateManager', 'derived txGroupCycle is same as current cycle')
        }
      }


      this.queueEntryCounter++
      const txQueueEntry: QueueEntry = {
        gossipedCompleteData: false,
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
        pendingConfirmOrChallenge: new Map(),
        pendingVotes: new Map(),
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
        queryingFinalData: false,
        lastFinalDataRequestTimestamp: 0,
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
          startTime: {},
          endTime: {},
          duration: {},
          startTimestamp: {},
          endTimestamp: {},
        },
        executionGroupMap: new Map(),
        executionNodeIdSorted: [],
        txSieveTime: 0,
        debug: {},
        voteCastAge: 0,
        dataSharedTimestamp: 0,
        firstVoteReceivedTimestamp: 0,
        firstConfirmOrChallengeTimestamp: 0,
        lastVoteReceivedTimestamp: 0,
        lastConfirmOrChallengeTimestamp: 0,
        robustQueryVoteCompleted: false,
        robustQueryConfirmOrChallengeCompleted: false,
        acceptVoteMessage: true,
        acceptConfirmOrChallenge: true,
        accountDataSet: false,
        topConfirmations: new Set(),
        topVoters: new Set(),
        hasRobustConfirmation: false,
        sharedCompleteData: false,
        correspondingGlobalOffset: 0,
        isSenderWrappedTxGroup: {}
      } // age comes from timestamp
      this.txDebugMarkStartTime(txQueueEntry, 'total_queue_time')
      this.txDebugMarkStartTime(txQueueEntry, 'aging')

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
        let cycleShardData = this.stateManager.currentCycleShardData
        if (Context.config.stateManager.deterministicTXCycleEnabled) {
          txQueueEntry.txGroupCycle = cycleNumber
          cycleShardData = this.stateManager.shardValuesByCycle.get(cycleNumber)
        }
        txQueueEntry.txDebug.cycleSinceActivated = cycleNumber - activeByIdOrder.find(node => node.id === Self.id).activeCycle

        if (cycleShardData == null) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`routeAndQueueAcceptedTransaction logID:${txQueueEntry.logID} cycleShardData == null cycle:${cycleNumber} not putting tx in queue.`)
          nestedCountersInstance.countEvent('stateManager', 'routeAndQueueAcceptedTransaction cycleShardData == null')
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
            cycleShardData.shardGlobals,
            txQueueEntry.executionShardKey
          )

          const homeShardData = cycleShardData.parititionShardDataMap.get(homePartition)

          //set the nodes that are in the executionGroup.
          //This is needed so that consensus will expect less nodes to be voting
          const unRankedExecutionGroup = homeShardData.homeNodes[0].consensusNodeForOurNodeFull.slice()
          if (this.usePOQo) {
            txQueueEntry.executionGroup = this.orderNodesByRank(unRankedExecutionGroup, txQueueEntry)
          } else if (this.useNewPOQ) {
            txQueueEntry.executionGroup = this.orderNodesByRank(unRankedExecutionGroup, txQueueEntry)
          } else {
            txQueueEntry.executionGroup = unRankedExecutionGroup
          }
          // for the new FACT algorithm
          txQueueEntry.executionNodeIdSorted = txQueueEntry.executionGroup.map((node) => node.id).sort()

          if (txQueueEntry.isInExecutionHome) {
            txQueueEntry.ourNodeRank = this.computeNodeRank(
              cycleShardData.ourNode.id,
              txQueueEntry.acceptedTx.txId,
              txQueueEntry.acceptedTx.timestamp
            )
          }

          const minNodesToVote = 3
          const voterPercentage = configContext.stateManager.voterPercentage
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

          // calculate globalOffset for FACT
          // take last 2 bytes of the txId and convert it to an integer
          txQueueEntry.correspondingGlobalOffset = parseInt(txId.slice(-4), 16)

          const ourID = cycleShardData.ourNode.id
          for (let idx = 0; idx < txQueueEntry.executionGroup.length; idx++) {
            // eslint-disable-next-line security/detect-object-injection
            const node = txQueueEntry.executionGroup[idx]
            txQueueEntry.executionGroupMap.set(node.id, node)
            if (node.id === ourID) {
              txQueueEntry.ourExGroupIndex = idx
              /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: executor index ${txQueueEntry.ourExGroupIndex}:${(node as Shardus.NodeWithRank).rank}`)
            }
          }
          if (txQueueEntry.eligibleNodeIdsToConfirm.has(Self.id)) {
            /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: confirmator`)
          }
          if (txQueueEntry.eligibleNodeIdsToVote.has(Self.id)) {
            /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: voter`)
          }
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: groupsize voters ${txQueueEntry.eligibleNodeIdsToConfirm.size}`)
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: groupsize confirmators ${txQueueEntry.eligibleNodeIdsToConfirm.size}`)
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: groupsize execution ${txQueueEntry.executionGroup.length}`)

          //if we are not in the execution group then set isInExecutionHome to false
          if (txQueueEntry.executionGroupMap.has(cycleShardData.ourNode.id) === false) {
            txQueueEntry.isInExecutionHome = false
          }

          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`routeAndQueueAcceptedTransaction info ${txQueueEntry.logID} isInExecutionHome:${txQueueEntry.isInExecutionHome} hasShardInfo:${txQueueEntry.hasShardInfo}`)
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('routeAndQueueAcceptedTransaction', `routeAndQueueAcceptedTransaction info ${txQueueEntry.logID} isInExecutionHome:${txQueueEntry.isInExecutionHome} hasShardInfo:${txQueueEntry.hasShardInfo} executionShardKey:${utils.makeShortHash(txQueueEntry.executionShardKey)}`)
          /* prettier-ignore */ if (this.stateManager.consensusLog) this.mainLogger.debug(`routeAndQueueAcceptedTransaction info ${txQueueEntry.logID} isInExecutionHome:${txQueueEntry.isInExecutionHome}`)
        }

        // calculate information needed for receiptmap
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
        }
        txQueueEntry.uniqueWritableKeys.sort() //need this list to be deterministic!

        if (txQueueEntry.hasShardInfo) {
          const transactionGroup = this.queueEntryGetTransactionGroup(txQueueEntry)
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: groupsize transaction ${txQueueEntry.transactionGroup.length}`)
          if (txQueueEntry.ourNodeInTransactionGroup || txQueueEntry.didSync === true) {
            // go ahead and calculate this now if we are in the tx group or we are syncing this range!
            this.queueEntryGetConsensusGroup(txQueueEntry)

            // populate isSenderWrappedTxGroup
              for (const accountId of txQueueEntry.uniqueKeys) {
                const homeNodeShardData = txQueueEntry.homeNodes[accountId]
                const consensusGroupForAccount = homeNodeShardData.consensusNodeForOurNodeFull.map(n => n.id)
                const startAndEndIndices = this.getStartAndEndIndexOfTargetGroup(consensusGroupForAccount, txQueueEntry.transactionGroup)
                const isWrapped = startAndEndIndices.endIndex < startAndEndIndices.startIndex
                if (isWrapped === false) continue
                const unwrappedEndIndex = startAndEndIndices.endIndex + txQueueEntry.transactionGroup.length
                for (let i = startAndEndIndices.startIndex; i < unwrappedEndIndex; i++) {
                  if (i >= txQueueEntry.transactionGroup.length) {
                    const wrappedIndex = i - txQueueEntry.transactionGroup.length
                    txQueueEntry.isSenderWrappedTxGroup[txQueueEntry.transactionGroup[wrappedIndex].id] = i
                  }
                }
              }
              this.mainLogger.debug(`routeAndQueueAcceptedTransaction isSenderWrappedTxGroup ${txQueueEntry.logID} ${utils.stringifyReduce(txQueueEntry.isSenderWrappedTxGroup)}`)
          }
          if (sendGossip && txQueueEntry.globalModification === false) {
            try {
              if (transactionGroup.length > 1) {
                // should consider only forwarding in some cases?
                this.stateManager.debugNodeGroup(txId, timestamp, `share to neighbors`, transactionGroup)
                this.p2p.sendGossipIn('spread_tx_to_group', acceptedTx, '', sender, transactionGroup, true, -1, acceptedTx.txId)
                /* prettier-ignore */ if (logFlags.verbose) console.log( 'spread_tx_to_group', txId, txQueueEntry.executionGroup.length, txQueueEntry.conensusGroup.length, txQueueEntry.transactionGroup.length )
                this.addOriginalTxDataToForward(txQueueEntry)
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
                cycleShardData.hasSyncingNeighbors === true
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
                    /* prettier-ignore */
                    if (logFlags.playback) this.logger.playbackLogNote("shrd_sync_tx", `${txQueueEntry.logID}`, `txts: ${timestamp} nodes:${utils.stringifyReduce(cycleShardData.syncingNeighborsTxGroup.map((x) => x.id))}`)

                    this.stateManager.debugNodeGroup(
                      txId,
                      timestamp,
                      `share to syncing neighbors`,
                      cycleShardData.syncingNeighborsTxGroup
                    )
                    //this.p2p.sendGossipAll('spread_tx_to_group', acceptedTx, '', sender, cycleShardData.syncingNeighborsTxGroup)
                    // if (
                    //   this.stateManager.config.p2p.useBinarySerializedEndpoints &&
                    //   this.stateManager.config.p2p.spreadTxToGroupSyncingBinary
                    // ) {
                      if (logFlags.seqdiagram) {
                        for (const node of cycleShardData.syncingNeighborsTxGroup) {
                          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455102 ${shardusGetTime()} tx:${acceptedTx.txId} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'spread_tx_to_group_syncing'}`)
                        }
                      }
                      const request = acceptedTx as SpreadTxToGroupSyncingReq
                      this.p2p.tellBinary<SpreadTxToGroupSyncingReq>(
                        cycleShardData.syncingNeighborsTxGroup,
                        InternalRouteEnum.binary_spread_tx_to_group_syncing,
                        request,
                        serializeSpreadTxToGroupSyncingReq,
                        {}
                      )
                    // } else {
                    //   this.p2p.tell(
                    //     cycleShardData.syncingNeighborsTxGroup,
                    //     'spread_tx_to_group_syncing',
                    //     acceptedTx
                    //   )
                    // }
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

        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${txQueueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: pendingQ`)

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
    this.profiler.profileSectionStart('queueEntryPrePush', true)
    this.profiler.scopedProfileSectionStart('queueEntryPrePush', true)
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
          }, false)
          /* prettier-ignore */ nestedCountersInstance.countEvent('transactionQueue', 'queueEntryPrePush_ri_added')
        }
      }
    }
    this.profiler.scopedProfileSectionEnd('queueEntryPrePush')
    this.profiler.profileSectionStart('queueEntryPrePush', true)
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
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`getQueueEntrySafe failed to find: ${utils.stringifyReduce(txid)}`)
        nestedCountersInstance.countEvent('getQueueEntrySafe', 'failed to find returning null')
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

  getArchivedQueueEntryByAccountIdAndHash(accountId: string, hash: string, msg: string): QueueEntry | null {
    try {
      let foundQueueEntry = false
      let foundVote = false
      let foundVoteMatchingHash = false
      for (const queueEntry of this.archivedQueueEntriesByID.values()) {
        if (queueEntry.uniqueKeys.includes(accountId)) {
          foundQueueEntry = true
          const receipt2: AppliedReceipt2 = this.stateManager.getReceipt2(queueEntry)
          let bestReceivedVote
          if (receipt2 !=  null) {
            bestReceivedVote = receipt2.appliedVote
            if (receipt2.appliedVote) nestedCountersInstance.countEvent('getArchivedQueueEntryByAccountIdAndHash', 'get vote from' +
              ' receipt2')
          }
          if (bestReceivedVote == null) {
            bestReceivedVote = queueEntry.receivedBestVote
            if (queueEntry.receivedBestVote) nestedCountersInstance.countEvent('getArchivedQueueEntryByAccountIdAndHash', 'get vote' +
              ' from' +
              ' receipt2')
          }
          if (bestReceivedVote == null) {
            continue
          }
          foundVote = true
          // this node might not have a vote for this tx
          for (let i = 0; i < bestReceivedVote.account_id.length; i++) {
            if (bestReceivedVote.account_id[i] === accountId) {
              if (bestReceivedVote.account_state_hash_after[i] === hash) {
                foundVoteMatchingHash = true
                return queueEntry
              }
            }
          }
        }
      }
      nestedCountersInstance.countRareEvent('error', `getQueueEntryArchived no entry: ${msg}`)
      nestedCountersInstance.countEvent('error', `getQueueEntryArchived no entry: ${msg}, found queue entry: ${foundQueueEntry}, found vote: ${foundVote}, found vote matching hash: ${foundVoteMatchingHash}`)
      return null
    } catch(e) {
      this.statemanager_fatal(`getArchivedQueueEntryByAccountIdAndHash`, `error: ${e.message}`)
      return null
    }
  }
  /**
   * getQueueEntryArchived
   * get a queue entry from the archive queue only
   * @param txid
   * @param msg
   */
  getQueueEntryArchivedByTimestamp(timestamp: number, msg: string): QueueEntry | null {
    for (const queueEntry of this.archivedQueueEntriesByID.values()) {
      if (queueEntry.acceptedTx.timestamp === timestamp) {
        return queueEntry
      }
    }
    nestedCountersInstance.countRareEvent('error', `getQueueEntryArchived no entry: ${msg}`)
    nestedCountersInstance.countEvent('error', `getQueueEntryArchived no entry: ${msg}`)
    return null
  }

  /**
   * queueEntryAddData
   * add data to a queue entry
   *   // TODO CODEREVIEW.  need to look at the use of local cache.  also is the early out ok?
   * @param queueEntry
   * @param data
   */
  queueEntryAddData(queueEntry: QueueEntry, data: Shardus.WrappedResponse, signatureCheck = false): void {
    if (queueEntry.uniqueKeys == null) {
      nestedCountersInstance.countEvent('queueEntryAddData', 'uniqueKeys == null')
      // cant have all data yet if we dont even have unique keys.
      throw new Error(
        `Attempting to add data and uniqueKeys are not available yet: ${utils.stringifyReduceLimit(
          queueEntry,
          200
        )}`
      )
    }
    if (queueEntry.collectedData[data.accountId] != null) {
      if (configContext.stateManager.collectedDataFix) {
        // compare the timestamps and keep the newest
        const existingData = queueEntry.collectedData[data.accountId]
        if (data.timestamp > existingData.timestamp) {
          queueEntry.collectedData[data.accountId] = data
          nestedCountersInstance.countEvent('queueEntryAddData', 'collectedDataFix replace with newer data')
        } else {
          nestedCountersInstance.countEvent('queueEntryAddData', 'already collected 1')
          return
        }
      } else {
        // we have already collected this data
        nestedCountersInstance.countEvent('queueEntryAddData', 'already collected 2')
        return
      }
    }
    profilerInstance.profileSectionStart('queueEntryAddData', true)
    // check the signature of each account data
    if (signatureCheck && (data.sign == null || data.sign.owner == null || data.sign.sig == null)) {
      this.mainLogger.fatal(`queueEntryAddData: data.sign == null ${utils.stringifyReduce(data)}`)
      nestedCountersInstance.countEvent('queueEntryAddData', 'data.sign == null')
      return
    }


    if (signatureCheck) {
      const dataSenderPublicKey = data.sign.owner
      const dataSenderNode: Shardus.Node = byPubKey[dataSenderPublicKey]
      if (dataSenderNode == null) {
        nestedCountersInstance.countEvent('queueEntryAddData', 'dataSenderNode == null')
        return
      }
      const consensusNodesForAccount = queueEntry.homeNodes[data.accountId]?.consensusNodeForOurNodeFull
      if (consensusNodesForAccount == null || consensusNodesForAccount.map(n => n.id).includes(dataSenderNode.id) === false) {
        nestedCountersInstance.countEvent('queueEntryAddData', 'data sender node is not in the consensus group of the' +
          ' account')
        return
      }

      const singedData = data as SignedObject

      if (this.crypto.verify(singedData) === false) {
        nestedCountersInstance.countEvent('queueEntryAddData', 'data signature verification failed')
        return
      }
    }

    queueEntry.collectedData[data.accountId] = data
    queueEntry.dataCollected = Object.keys(queueEntry.collectedData).length

    //make a deep copy of the data
    queueEntry.originalData[data.accountId] = Utils.safeJsonParse(Utils.safeStringify(data))
    queueEntry.beforeHashes[data.accountId] = data.stateId

    if (queueEntry.dataCollected === queueEntry.uniqueKeys.length) {
      //  queueEntry.tx Keys.allKeys.length
      queueEntry.hasAll = true
      // this.gossipCompleteData(queueEntry)
      if (queueEntry.executionGroup && queueEntry.executionGroup.length > 1) this.shareCompleteDataToNeighbours(queueEntry)
      if (logFlags.debug || this.stateManager.consensusLog) {
        this.mainLogger.debug(
          `queueEntryAddData hasAll: true for txId ${queueEntry.logID} ${queueEntry.acceptedTx.txId} at timestamp: ${shardusGetTime()} nodeId: ${Self.id} collected ${Object.keys(queueEntry.collectedData).length} uniqueKeys ${queueEntry.uniqueKeys.length}`
        )
      }
    }

    if (data.localCache) {
      queueEntry.localCachedData[data.accountId] = data.localCache
      delete data.localCache
    }

    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_addData', `${queueEntry.logID}`, `key ${utils.makeShortHash(data.accountId)} hash: ${utils.makeShortHash(data.stateId)} hasAll:${queueEntry.hasAll} collected:${queueEntry.dataCollected}  ${queueEntry.acceptedTx.timestamp}`)
    profilerInstance.profileSectionStart('queueEntryAddData', true)
  }

  async shareCompleteDataToNeighbours(queueEntry: QueueEntry): Promise<void> {
    if (configContext.stateManager.shareCompleteData === false) {
      return
    }
    if (queueEntry.hasAll === false || queueEntry.sharedCompleteData) {
      return
    }
    if (queueEntry.isInExecutionHome === false) {
      return
    }
    const dataToShare: WrappedResponses = {}
    const stateList: Shardus.WrappedResponse[] = []
    for (const accountId in queueEntry.collectedData) {
      const data = queueEntry.collectedData[accountId]
      const riCacheResult = await this.app.getCachedRIAccountData([accountId])
      if (riCacheResult != null && riCacheResult.length > 0) {
        nestedCountersInstance.countEvent('shareCompleteDataToNeighbours', 'riCacheResult, skipping')
        continue
      } else {
        dataToShare[accountId] = data
        stateList.push(data)
      }
    }
    const payload = {txid: queueEntry.acceptedTx.txId, stateList}
    const neighboursNodes = utils.selectNeighbors(queueEntry.executionGroup, queueEntry.ourExGroupIndex, 2)
    if (stateList.length > 0) {
      this.broadcastState(neighboursNodes, payload, "shareCompleteDataToNeighbours")

      queueEntry.sharedCompleteData = true
      nestedCountersInstance.countEvent(`queueEntryAddData`, `sharedCompleteData stateList: ${stateList.length} neighbours: ${neighboursNodes.length}`)
      if (logFlags.debug || this.stateManager.consensusLog) {
        this.mainLogger.debug(
          `shareCompleteDataToNeighbours: shared complete data for txId ${queueEntry.logID} at timestamp: ${shardusGetTime()} nodeId: ${Self.id} to neighbours: ${Utils.safeStringify(neighboursNodes.map((node) => node.id))}`
        )
      }
    }
  }

  async gossipCompleteData(queueEntry: QueueEntry): Promise<void> {
    if (queueEntry.hasAll === false || queueEntry.gossipedCompleteData) {
      return
    }
    if (configContext.stateManager.gossipCompleteData === false) {
      return
    }
    const dataToGossip: WrappedResponses = {}
    const stateList: Shardus.WrappedResponse[] = []
    for (const accountId in queueEntry.collectedData) {
      const data = queueEntry.collectedData[accountId]
      const riCacheResult = await this.app.getCachedRIAccountData([accountId])
      if (riCacheResult != null && riCacheResult.length > 0) {
        nestedCountersInstance.countEvent('gossipCompleteData', 'riCacheResult, skipping')
        continue
      } else {
        dataToGossip[accountId] = data
        stateList.push(data)
      }
    }
    const payload = {txid: queueEntry.acceptedTx.txId, stateList}
    if (stateList.length > 0) {
      Comms.sendGossip(
        'broadcast_state_complete_data',
        payload,
        '',
        Self.id,
        queueEntry.executionGroup,
        true,
        6,
        queueEntry.acceptedTx.txId
      )
      queueEntry.gossipedCompleteData = true
      nestedCountersInstance.countEvent('gossipCompleteData', `stateList: ${stateList.length}`)
      if (logFlags.debug || this.stateManager.consensusLog) {
        this.mainLogger.debug(
          `gossipQueueEntryData: gossiped data for txId ${queueEntry.logID} at timestamp: ${shardusGetTime()} nodeId: ${Self.id}`
        )
      }
    }
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
          let result = null
          try {
            // if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.requestStateForTxBinary) {
              // GOLD-66 Error handling try/catch happens one layer outside of this function in process transactions
              /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455101 ${shardusGetTime()} tx:${message.txid} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'request_state_for_tx'}`)
              result = (await this.p2p.askBinary<RequestStateForTxReq, RequestStateForTxRespSerialized>(
                node,
                InternalRouteEnum.binary_request_state_for_tx,
                message,
                serializeRequestStateForTxReq,
                deserializeRequestStateForTxResp,
                {}
              )) as RequestStateForTxRespSerialized
            // } else {
            //   result = (await this.p2p.ask(node, 'request_state_for_tx', message)) as RequestStateForTxResp
            // }
          } catch (error) {
            /* prettier-ignore */ if (logFlags.error) {
              if (error instanceof ResponseError) {
                this.mainLogger.error(
                  `ASK FAIL request_state_for_tx : exception encountered where the error is ${error}`
                )
              }
            }
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error('askBinary request_state_for_tx exception:', error)

            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`askBinary error: ${InternalRouteEnum.binary_request_state_for_tx} asked to ${node.externalIp}:${node.externalPort}:${node.id}`)
          }

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

      if(this.config.stateManager.txStateMachineChanges){
        this.updateTxState(queueEntry, 'await final data', 'missing data')
      } else {
        this.updateTxState(queueEntry, 'consensing')
      }

      if (logFlags.debug)
        this.mainLogger.debug(`queueEntryRequestMissingData failed to get all data for: ${queueEntry.logID}`)
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
        let result = null
        // GOLD-67 to be safe this function needs a try/catch block to prevent a timeout from causing an unhandled exception
        // if (
        //   this.stateManager.config.p2p.useBinarySerializedEndpoints &&
        //   this.stateManager.config.p2p.requestReceiptForTxBinary
        // ) {
          try {
            /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455101 ${shardusGetTime()} tx:${message.txid} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'request_receipt_for_tx'}`)
            result = await this.p2p.askBinary<
              RequestReceiptForTxReqSerialized,
              RequestReceiptForTxRespSerialized
            >(
              node,
              InternalRouteEnum.binary_request_receipt_for_tx,
              message,
              serializeRequestReceiptForTxReq,
              deserializeRequestReceiptForTxResp,
              {}
            )
          } catch (e) {
            this.statemanager_fatal(`queueEntryRequestMissingReceipt`, `error: ${e.message}`)
            /* prettier-ignore */ this.mainLogger.error(`askBinary error: ${InternalRouteEnum.binary_request_receipt_for_tx} asked to ${node.externalIp}:${node.externalPort}:${node.id}`)
          }
        // } else {
        //   result = await this.p2p.ask(node, 'request_receipt_for_tx', message) // not sure if we should await this.
        // }

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

  // async queueEntryRequestMissingReceipt_old(queueEntry: QueueEntry): Promise<void> {
  //   if (this.stateManager.currentCycleShardData == null) {
  //     return
  //   }

  //   if (queueEntry.uniqueKeys == null) {
  //     throw new Error('queueEntryRequestMissingReceipt queueEntry.uniqueKeys == null')
  //   }

  //   if (queueEntry.requestingReceipt === true) {
  //     return
  //   }

  //   queueEntry.requestingReceipt = true
  //   queueEntry.receiptEverRequested = true

  //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_start', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID}`)

  //   const consensusGroup = this.queueEntryGetConsensusGroup(queueEntry)

  //   this.stateManager.debugNodeGroup(
  //     queueEntry.acceptedTx.txId,
  //     queueEntry.acceptedTx.timestamp,
  //     `queueEntryRequestMissingReceipt`,
  //     consensusGroup
  //   )
  //   //let consensusGroup = this.queueEntryGetTransactionGroup(queueEntry)
  //   //the outer loop here could just use the transaction group of nodes instead. but already had this working in a similar function
  //   //TODO change it to loop the transaction group untill we get a good receipt

  //   //Note: we only need to get one good receipt, the loop on keys is in case we have to try different groups of nodes
  //   let gotReceipt = false
  //   for (const key of queueEntry.uniqueKeys) {
  //     if (gotReceipt === true) {
  //       break
  //     }

  //     let keepTrying = true
  //     let triesLeft = Math.min(5, consensusGroup.length)
  //     let nodeIndex = 0
  //     while (keepTrying) {
  //       if (triesLeft <= 0) {
  //         keepTrying = false
  //         break
  //       }
  //       triesLeft--
  //       // eslint-disable-next-line security/detect-object-injection
  //       const homeNodeShardData = queueEntry.homeNodes[key] // mark outstanding request somehow so we dont rerequest

  //       // eslint-disable-next-line security/detect-object-injection
  //       const node = consensusGroup[nodeIndex]
  //       nodeIndex++

  //       if (node == null) {
  //         continue
  //       }
  //       if (node.status != 'active' || potentiallyRemoved.has(node.id)) {
  //         continue
  //       }
  //       if (node === this.stateManager.currentCycleShardData.ourNode) {
  //         continue
  //       }

  //       const relationString = ShardFunctions.getNodeRelation(
  //         homeNodeShardData,
  //         this.stateManager.currentCycleShardData.ourNode.id
  //       )
  //       /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_ask', `${queueEntry.logID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)

  //       // Node Precheck!
  //       if (
  //         this.stateManager.isNodeValidForInternalMessage(
  //           node.id,
  //           'queueEntryRequestMissingReceipt',
  //           true,
  //           true
  //         ) === false
  //       ) {
  //         // if(this.tryNextDataSourceNode('queueEntryRequestMissingReceipt') == false){
  //         //   break
  //         // }
  //         continue
  //       }

  //       const message = { txid: queueEntry.acceptedTx.txId, timestamp: queueEntry.acceptedTx.timestamp }
  //       const result: RequestReceiptForTxResp_old = await this.p2p.ask(
  //         node,
  //         'request_receipt_for_tx_old',
  //         message
  //       ) // not sure if we should await this.

  //       if (result == null) {
  //         if (logFlags.verbose) {
  //           /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL request_receipt_for_tx_old ${triesLeft} ${utils.makeShortHash(node.id)}`)
  //         }
  //         /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_askfailretry', `${queueEntry.logID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} `)
  //         continue
  //       }
  //       if (result.success !== true) {
  //         /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL queueEntryRequestMissingReceipt 9 ${triesLeft} ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)} note:${result.note} txid:${queueEntry.logID}`)
  //         continue
  //       }

  //       /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_queueEntryRequestMissingReceipt_result', `${queueEntry.logID}`, `r:${relationString}   result:${queueEntry.logstate} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} result: ${utils.stringifyReduce(result)}`)

  //       if (result.success === true && result.receipt != null) {
  //         //TODO implement this!!!
  //         queueEntry.recievedAppliedReceipt = result.receipt
  //         keepTrying = false
  //         gotReceipt = true

  //         this.mainLogger.debug(
  //           `queueEntryRequestMissingReceipt got good receipt for: ${
  //             queueEntry.logID
  //           } from: ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)}`
  //         )
  //       }
  //     }

  //     // break the outer loop after we are done trying.  todo refactor this.
  //     if (keepTrying == false) {
  //       break
  //     }
  //   }
  //   queueEntry.requestingReceipt = false

  //   if (gotReceipt === false) {
  //     queueEntry.requestingReceiptFailed = true
  //   }
  // }

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
    let cycleShardData = this.stateManager.currentCycleShardData
    if (Context.config.stateManager.deterministicTXCycleEnabled) {
      cycleShardData = this.stateManager.shardValuesByCycle.get(queueEntry.txGroupCycle)
    }
    if (cycleShardData == null) {
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
          cycleShardData.shardGlobals,
          cycleShardData.nodeShardDataMap,
          cycleShardData.parititionShardDataMap,
          homeNode,
          cycleShardData.nodes
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
        if (node.id === Self.id)
          if (logFlags.verbose)
            /* prettier-ignore */ this.mainLogger.debug(`queueEntryGetTransactionGroup tx ${queueEntry.logID} our node coverage key ${key}`)
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
        cycleShardData.shardGlobals,
        key
      )
      if (homePartition != homeNode.homePartition) {
        //loop all nodes for now
        for (const nodeID of cycleShardData.nodeShardDataMap.keys()) {
          const nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData =
            cycleShardData.nodeShardDataMap.get(nodeID)
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
        /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup executeInOneShard ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} executionGroup:${Utils.safeStringify(executionKeys)}`)
        /* prettier-ignore */ if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('queueEntryGetTransactionGroup', `queueEntryGetTransactionGroup executeInOneShard ${queueEntry.logID} isInExecutionHome:${queueEntry.isInExecutionHome} executionGroup:${Utils.safeStringify(executionKeys)}`)
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
    if (uniqueNodes[cycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInTransactionGroup = false
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetTransactionGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${queueEntry.logID}`)
    }
    if (queueEntry.ourNodeInTransactionGroup)
      /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: targetgroup`)

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    // This may seem confusing, but to gossip to other nodes, we have to have our node in the list we will gossip to
    // Other logic will use queueEntry.ourNodeInTransactionGroup to know what else to do with the queue entry
    uniqueNodes[cycleShardData.ourNode.id] =
      cycleShardData.ourNode

    const values = Object.values(uniqueNodes)
    for (const v of values) {
      txGroup.push(v)
    }

    txGroup.sort(this.stateManager._sortByIdAsc)
    if (queueEntry.ourNodeInTransactionGroup) {
      const ourID = cycleShardData.ourNode.id
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
      if (Context.config.stateManager.deterministicTXCycleEnabled === false) {
        queueEntry.txGroupCycle = this.stateManager.currentCycleShardData.cycleNumber
      }
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
    let cycleShardData = this.stateManager.currentCycleShardData
    if (Context.config.stateManager.deterministicTXCycleEnabled) {
      cycleShardData = this.stateManager.shardValuesByCycle.get(queueEntry.txGroupCycle)
    }
    if (cycleShardData == null) {
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
          cycleShardData.shardGlobals,
          cycleShardData.nodeShardDataMap,
          cycleShardData.parititionShardDataMap,
          homeNode,
          cycleShardData.nodes
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
    if (uniqueNodes[cycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInConsensusGroup = false
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetConsensusGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${queueEntry.logID}`)
    }

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    uniqueNodes[cycleShardData.ourNode.id] =
      cycleShardData.ourNode

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
    let cycleShardData = this.stateManager.currentCycleShardData
    if (Context.config.stateManager.deterministicTXCycleEnabled) {
      cycleShardData = this.stateManager.shardValuesByCycle.get(queueEntry.txGroupCycle)
    }
    if (cycleShardData == null) {
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
        cycleShardData.shardGlobals,
        cycleShardData.nodeShardDataMap,
        cycleShardData.parititionShardDataMap,
        homeNode,
        cycleShardData.nodes
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
    if (uniqueNodes[cycleShardData.ourNode.id] == null) {
      queueEntry.ourNodeInConsensusGroup = false
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`queueEntryGetConsensusGroup not involved: hasNonG:${hasNonGlobalKeys} tx ${queueEntry.logID}`)
    }

    // make sure our node is included: needed for gossip! - although we may not care about the data!
    uniqueNodes[cycleShardData.ourNode.id] = cycleShardData.ourNode

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
  // async tellCorrespondingNodesOld(queueEntry: QueueEntry): Promise<unknown> {
  //   if (this.stateManager.currentCycleShardData == null) {
  //     throw new Error('tellCorrespondingNodes: currentCycleShardData == null')
  //   }
  //   if (queueEntry.uniqueKeys == null) {
  //     throw new Error('tellCorrespondingNodes: queueEntry.uniqueKeys == null')
  //   }
  //   // Report data to corresponding nodes
  //   const ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
  //   // let correspondingEdgeNodes = []
  //   let correspondingAccNodes: Shardus.Node[] = []
  //   const dataKeysWeHave = []
  //   const dataValuesWeHave = []
  //   const datas: { [accountID: string]: Shardus.WrappedResponse } = {}
  //   const remoteShardsByKey: { [accountID: string]: StateManagerTypes.shardFunctionTypes.NodeShardData } = {} // shard homenodes that we do not have the data for.
  //   let loggedPartition = false
  //   for (const key of queueEntry.uniqueKeys) {
  //     ///   test here
  //     // let hasKey = ShardFunctions.testAddressInRange(key, ourNodeData.storedPartitions)
  //     // todo : if this works maybe a nicer or faster version could be used
  //     let hasKey = false
  //     // eslint-disable-next-line security/detect-object-injection
  //     const homeNode = queueEntry.homeNodes[key]
  //     if (homeNode.node.id === ourNodeData.node.id) {
  //       hasKey = true
  //     } else {
  //       //perf todo: this seems like a slow calculation, coult improve this
  //       for (const node of homeNode.nodeThatStoreOurParitionFull) {
  //         if (node.id === ourNodeData.node.id) {
  //           hasKey = true
  //           break
  //         }
  //       }
  //     }
  //
  //     // HOMENODEMATHS tellCorrespondingNodes patch the value of hasKey
  //     // did we get patched in
  //     if (queueEntry.patchedOnNodes.has(ourNodeData.node.id)) {
  //       hasKey = true
  //     }
  //
  //     // for(let patchedNodeID of queueEntry.patchedOnNodes.values()){
  //     // }
  //
  //     let isGlobalKey = false
  //     //intercept that we have this data rather than requesting it.
  //     if (this.stateManager.accountGlobals.isGlobalAccount(key)) {
  //       hasKey = true
  //       isGlobalKey = true
  //       /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', queueEntry.logID, `tellCorrespondingNodes - has`)
  //     }
  //
  //     if (hasKey === false) {
  //       if (loggedPartition === false) {
  //         loggedPartition = true
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull.map((v) => v.id))}`)
  //         /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false: full: ${utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull)}`)
  //       }
  //       /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodes hasKey=false  key: ${utils.stringifyReduce(key)}`)
  //     }
  //
  //     if (hasKey) {
  //       // TODO PERF is it possible that this query could be used to update our in memory cache? (this would save us from some slow look ups) later on
  //       //    when checking timestamps.. alternatively maybe there is a away we can note the timestamp with what is returned here in the queueEntry data
  //       //    and not have to deal with the cache.
  //       // todo old: Detect if our node covers this paritition..  need our partition data
  //
  //       this.profiler.profileSectionStart('process_dapp.getRelevantData')
  //       this.profiler.scopedProfileSectionStart('process_dapp.getRelevantData')
  //       /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.stateManager.transactionQueue.app.getRelevantData old')
  //       let data = await this.app.getRelevantData(
  //         key,
  //         queueEntry.acceptedTx.data,
  //         queueEntry.acceptedTx.appData
  //       )
  //       /* prettier-ignore */ this.setDebugLastAwaitedCallInner('this.stateManager.transactionQueue.app.getRelevantData old', DebugComplete.Completed)
  //       this.profiler.scopedProfileSectionEnd('process_dapp.getRelevantData')
  //       this.profiler.profileSectionEnd('process_dapp.getRelevantData')
  //
  //       //only queue this up to share if it is not a global account. global accounts dont need to be shared.
  //
  //       // not sure if it is correct to update timestamp like this.
  //       // if(data.timestamp === 0){
  //       //   data.timestamp = queueEntry.acceptedTx.timestamp
  //       // }
  //
  //       //if this is not freshly created data then we need to make a backup copy of it!!
  //       //This prevents us from changing data before the commiting phase
  //       if (data.accountCreated == false) {
  //         data = utils.deepCopy(data)
  //       }
  //
  //       if (isGlobalKey === false) {
  //         // eslint-disable-next-line security/detect-object-injection
  //         datas[key] = data
  //         dataKeysWeHave.push(key)
  //         dataValuesWeHave.push(data)
  //       }
  //
  //       // eslint-disable-next-line security/detect-object-injection
  //       queueEntry.localKeys[key] = true
  //       // add this data to our own queue entry!!
  //       this.queueEntryAddData(queueEntry, data)
  //     } else {
  //       // eslint-disable-next-line security/detect-object-injection
  //       remoteShardsByKey[key] = queueEntry.homeNodes[key]
  //     }
  //   }
  //   if (queueEntry.globalModification === true) {
  //     /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes - globalModification = true, not telling other nodes`)
  //     return
  //   }
  //
  //   // if we are in the execution shard no need to forward data
  //   // This is because other nodes will not expect pre-apply data anymore (but they will send us their pre apply data)
  //   if (
  //     queueEntry.globalModification === false &&
  //     this.executeInOneShard &&
  //     queueEntry.isInExecutionHome === true
  //   ) {
  //     //will this break things..
  //     /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes - isInExecutionHome = true, not telling other nodes`)
  //     return
  //   }
  //
  //   let message: { stateList: Shardus.WrappedResponse[]; txid: string }
  //   let edgeNodeIds = []
  //   let consensusNodeIds = []
  //
  //   const nodesToSendTo: StringNodeObjectMap = {}
  //   const doOnceNodeAccPair = new Set<string>() //can skip  node+acc if it happens more than once.
  //
  //   for (const key of queueEntry.uniqueKeys) {
  //     // eslint-disable-next-line security/detect-object-injection
  //     if (datas[key] != null) {
  //       for (const key2 of queueEntry.uniqueKeys) {
  //         if (key !== key2) {
  //           // eslint-disable-next-line security/detect-object-injection
  //           const localHomeNode = queueEntry.homeNodes[key]
  //           // eslint-disable-next-line security/detect-object-injection
  //           const remoteHomeNode = queueEntry.homeNodes[key2]
  //
  //           // //can ignore nodes not in the execution group since they will not be running apply
  //           // if(this.executeInOneShard && (queueEntry.executionIdSet.has(remoteHomeNode.node.id) === false)){
  //           //   continue
  //           // }
  //
  //           const ourLocalConsensusIndex = localHomeNode.consensusNodeForOurNodeFull.findIndex(
  //             (a) => a.id === ourNodeData.node.id
  //           )
  //           if (ourLocalConsensusIndex === -1) {
  //             continue
  //           }
  //
  //           edgeNodeIds = []
  //           consensusNodeIds = []
  //           correspondingAccNodes = []
  //
  //           // must add one to each lookup index!
  //           const indicies = ShardFunctions.debugFastStableCorrespondingIndicies(
  //             localHomeNode.consensusNodeForOurNodeFull.length,
  //             remoteHomeNode.consensusNodeForOurNodeFull.length,
  //             ourLocalConsensusIndex + 1
  //           )
  //           const edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
  //             localHomeNode.consensusNodeForOurNodeFull.length,
  //             remoteHomeNode.edgeNodes.length,
  //             ourLocalConsensusIndex + 1
  //           )
  //
  //           let patchIndicies = []
  //           if (remoteHomeNode.patchedOnNodes.length > 0) {
  //             patchIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
  //               localHomeNode.consensusNodeForOurNodeFull.length,
  //               remoteHomeNode.patchedOnNodes.length,
  //               ourLocalConsensusIndex + 1
  //             )
  //           }
  //
  //           // HOMENODEMATHS need to work out sending data to our patched range.
  //           // let edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(localHomeNode.consensusNodeForOurNodeFull.length, remoteHomeNode.edgeNodes.length, ourLocalConsensusIndex + 1)
  //
  //           // for each remote node lets save it's id
  //           for (const index of indicies) {
  //             const node = remoteHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
  //             if (node != null && node.id !== ourNodeData.node.id) {
  //               nodesToSendTo[node.id] = node
  //               consensusNodeIds.push(node.id)
  //             }
  //           }
  //           for (const index of edgeIndicies) {
  //             const node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
  //             if (node != null && node.id !== ourNodeData.node.id) {
  //               nodesToSendTo[node.id] = node
  //               edgeNodeIds.push(node.id)
  //             }
  //           }
  //
  //           for (const index of patchIndicies) {
  //             const node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
  //             if (node != null && node.id !== ourNodeData.node.id) {
  //               nodesToSendTo[node.id] = node
  //               //edgeNodeIds.push(node.id)
  //             }
  //           }
  //
  //           const dataToSend: Shardus.WrappedResponse[] = []
  //           // eslint-disable-next-line security/detect-object-injection
  //           dataToSend.push(datas[key]) // only sending just this one key at a time
  //
  //           // sign each account data
  //           for (let data of dataToSend) {
  //             data = this.crypto.sign(data)
  //           }
  //
  //           message = { stateList: dataToSend, txid: queueEntry.acceptedTx.txId }
  //
  //           //correspondingAccNodes = Object.values(nodesToSendTo)
  //
  //           //build correspondingAccNodes, but filter out nodeid, account key pairs we have seen before
  //           for (const [accountID, node] of Object.entries(nodesToSendTo)) {
  //             const keyPair = accountID + key
  //             if (node != null && doOnceNodeAccPair.has(keyPair) === false) {
  //               doOnceNodeAccPair.add(keyPair)
  //
  //               // consider this optimization later (should make it so we only send to execution set nodes)
  //               // if(queueEntry.executionIdSet.has(remoteHomeNode.node.id) === true){
  //               //   correspondingAccNodes.push(node)
  //               // }
  //               correspondingAccNodes.push(node)
  //             }
  //           }
  //
  //           if (correspondingAccNodes.length > 0) {
  //             const remoteRelation = ShardFunctions.getNodeRelation(
  //               remoteHomeNode,
  //               this.stateManager.currentCycleShardData.ourNode.id
  //             )
  //             const localRelation = ShardFunctions.getNodeRelation(
  //               localHomeNode,
  //               this.stateManager.currentCycleShardData.ourNode.id
  //             )
  //             /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_tellCorrespondingNodes', `${queueEntry.acceptedTx.txId}`, `remoteRel: ${remoteRelation} localrel: ${localRelation} qId: ${queueEntry.entryID} AccountBeingShared: ${utils.makeShortHash(key)} EdgeNodes:${utils.stringifyReduce(edgeNodeIds)} ConsesusNodes${utils.stringifyReduce(consensusNodeIds)}`)
  //
  //             // Filter nodes before we send tell()
  //             const filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
  //               correspondingAccNodes,
  //               'tellCorrespondingNodes',
  //               true,
  //               true
  //             )
  //             if (filteredNodes.length === 0) {
  //               /* prettier-ignore */ if (logFlags.error) this.mainLogger.error('tellCorrespondingNodes: filterValidNodesForInternalMessage no valid nodes left to try')
  //               return null
  //             }
  //             const filterdCorrespondingAccNodes = filteredNodes
  //
  //             this.broadcastState(filterdCorrespondingAccNodes, message)
  //           }
  //         }
  //       }
  //     }
  //   }
  // }

  async broadcastState(
    nodes: Shardus.Node[],
    message: { stateList: Shardus.WrappedResponse[]; txid: string },
    context: string
  ): Promise<void> {
    // if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.broadcastStateBinary) {
      // convert legacy message to binary supported type
      const request = message as BroadcastStateReq
      if (logFlags.seqdiagram) {
        for (const node of nodes) {
          if (context == "tellCorrespondingNodes") {
            /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455102 ${shardusGetTime()} tx:${message.txid} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'broadcast_state_nodes'}`)
          } else {
            /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455102 ${shardusGetTime()} tx:${message.txid} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'broadcast_state_neighbour'}`)
          }
        }
      }
      this.p2p.tellBinary<BroadcastStateReq>(
        nodes,
        InternalRouteEnum.binary_broadcast_state,
        request,
        serializeBroadcastStateReq,
        {
          verification_data: verificationDataCombiner(
            message.txid,
            message.stateList.length.toString(),
            request.stateList[0].accountId
          ),
        }
      )
      // return
    // }
    // this.p2p.tell(nodes, 'broadcast_state', message)
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
        this.queueEntryAddData(queueEntry, data, false)
      } else {
        // eslint-disable-next-line security/detect-object-injection
        remoteShardsByKey[key] = queueEntry.homeNodes[key]
      }
    }
    if (queueEntry.globalModification === true) {
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes - globalModification = true, not telling other nodes`)
      return
    }

    let message: { stateList: Shardus.WrappedResponse[]; txid: string }
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
              const targetNode = remoteHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              //only send data to the execution group
              if (queueEntry.executionGroupMap.has(targetNode.id) === false) {
                continue
              }

              if (targetNode != null && targetNode.id !== ourNodeData.node.id) {
                nodesToSendTo[targetNode.id] = targetNode
                consensusNodeIds.push(targetNode.id)
              }
            }
            for (const index of edgeIndicies) {
              const targetNode = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              if (targetNode != null && targetNode.id !== ourNodeData.node.id) {
                //only send data to the execution group
                if (queueEntry.executionGroupMap.has(targetNode.id) === false) {
                  continue
                }
                nodesToSendTo[targetNode.id] = targetNode
                edgeNodeIds.push(targetNode.id)
              }
            }

            for (const index of patchIndicies) {
              const targetNode = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
              //only send data to the execution group
              if (queueEntry.executionGroupMap.has(targetNode.id) === false) {
                continue
              }
              if (targetNode != null && targetNode.id !== ourNodeData.node.id) {
                nodesToSendTo[targetNode.id] = targetNode
                //edgeNodeIds.push(targetNode.id)
              }
            }

            const dataToSend = []
            // eslint-disable-next-line security/detect-object-injection
            dataToSend.push(datas[key]) // only sending just this one key at a time

            // sign each account data
            for (let data of dataToSend) {
              data = this.crypto.sign(data)
            }

            message = { stateList: dataToSend, txid: queueEntry.acceptedTx.txId }

            //build correspondingAccNodes, but filter out nodeid, account key pairs we have seen before
            for (const [accountID, node] of Object.entries(nodesToSendTo)) {
              const keyPair = accountID + key
              if (node != null && doOnceNodeAccPair.has(keyPair) === false) {
                doOnceNodeAccPair.add(keyPair)
                correspondingAccNodes.push(node)
              }
            }

            /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodes', queueEntry.logID, `tellCorrespondingNodes nodesToSendTo:${Object.keys(nodesToSendTo).length} doOnceNodeAccPair:${doOnceNodeAccPair.size} indicies:${Utils.safeStringify(indicies)} edgeIndicies:${Utils.safeStringify(edgeIndicies)} patchIndicies:${Utils.safeStringify(patchIndicies)}  doOnceNodeAccPair: ${Utils.safeStringify([...doOnceNodeAccPair.keys()])} ourLocalConsensusIndex:${ourLocalConsensusIndex} ourSendingGroupSize:${ourSendingGroupSize} targetEdgeGroupSize:${targetEdgeGroupSize} targetEdgeGroupSize:${targetEdgeGroupSize} pachedListSize:${pachedListSize}`)

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

              this.broadcastState(filterdCorrespondingAccNodes, message, "tellCorrespondingNodes")
            }
          }
        }
      }
    }
  }

  async factTellCorrespondingNodes(queueEntry: QueueEntry): Promise<unknown> {
    try {
      let cycleShardData = this.stateManager.currentCycleShardData
      if (Context.config.stateManager.deterministicTXCycleEnabled) {
        cycleShardData = this.stateManager.shardValuesByCycle.get(queueEntry.txGroupCycle)
      }
      if (cycleShardData == null) {
        throw new Error('factTellCorrespondingNodes: cycleShardData == null')
      }
      if (queueEntry.uniqueKeys == null) {
        throw new Error('factTellCorrespondingNodes: queueEntry.uniqueKeys == null')
      }
      const ourNodeData = cycleShardData.nodeShardData
      const dataKeysWeHave = []
      const dataValuesWeHave = []
      const datas: { [accountID: string]: Shardus.WrappedResponse } = {}
      const remoteShardsByKey: { [accountID: string]: StateManagerTypes.shardFunctionTypes.NodeShardData } = {} // shard homenodes that we do not have the data for.
      let loggedPartition = false
      for (const key of queueEntry.uniqueKeys) {
        let hasKey = ShardFunctions.testAddressInRange(key, ourNodeData.storedPartitions)

        // HOMENODEMATHS factTellCorrespondingNodes patch the value of hasKey
        // did we get patched in
        if (queueEntry.patchedOnNodes.has(ourNodeData.node.id)) {
          hasKey = true
        }

        let isGlobalKey = false
        //intercept that we have this data rather than requesting it.
        if (this.stateManager.accountGlobals.isGlobalAccount(key)) {
          hasKey = true
          isGlobalKey = true
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('globalAccountMap', queueEntry.logID, `factTellCorrespondingNodes - has`)
        }

        if (hasKey === false) {
          if (loggedPartition === false) {
            loggedPartition = true
            /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`factTellCorrespondingNodes hasKey=false`)
          }
          /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`factTellCorrespondingNodes hasKey=false  key: ${utils.stringifyReduce(key)}`)
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

          //if this is not freshly created data then we need to make a backup copy of it!!
          //This prevents us from changing data before the commiting phase
          if (data.accountCreated == false) {
            data = utils.deepCopy(data)
          }

          //only queue this up to share if it is not a global account. global accounts dont need to be shared.
          if (isGlobalKey === false) {
            // eslint-disable-next-line security/detect-object-injection
            datas[key] = data
            dataKeysWeHave.push(key)
            dataValuesWeHave.push(data)
          }

          // eslint-disable-next-line security/detect-object-injection
          queueEntry.localKeys[key] = true
          // add this data to our own queue entry!!
          this.queueEntryAddData(queueEntry, data, false)
        } else {
          // eslint-disable-next-line security/detect-object-injection
          remoteShardsByKey[key] = queueEntry.homeNodes[key]
        }
      }
      if (queueEntry.globalModification === true) {
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('factTellCorrespondingNodes', queueEntry.logID, `factTellCorrespondingNodes - globalModification = true, not telling other nodes`)
        return
      }

      const payload: { stateList: Shardus.WrappedResponse[]; txid: string } = {
        stateList: [],
        txid: queueEntry.acceptedTx.txId,
      }
      for (const key of queueEntry.uniqueKeys) {
        // eslint-disable-next-line security/detect-object-injection
        if (datas[key] != null) {
          // eslint-disable-next-line security/detect-object-injection
          payload.stateList.push(datas[key]) // only sending just this one key at a time
        }
      }
      // sign each account data
      const signedPayload = this.crypto.sign(payload)

      // prepare inputs to get corresponding indices
      const ourIndexInTxGroup = queueEntry.ourTXGroupIndex
      const targetGroup = queueEntry.executionNodeIdSorted
      const targetGroupSize = targetGroup.length
      const senderGroupSize = targetGroupSize

      // calculate target start and end indices in txGroup
      const targetIndices = this.getStartAndEndIndexOfTargetGroup(targetGroup, queueEntry.transactionGroup)
      const unwrappedIndex = queueEntry.isSenderWrappedTxGroup[Self.id]

      // temp logs
      if (logFlags.verbose) {
        this.mainLogger.debug(`factTellCorrespondingNodes: target group size`, targetGroup.length, targetGroup);
        this.mainLogger.debug(`factTellCorrespondingNodes: tx group size`, queueEntry.transactionGroup.length, queueEntry.transactionGroup.map(n => n.id));
        this.mainLogger.debug(`factTellCorrespondingNodes: getting corresponding indices for tx: ${queueEntry.logID}`, ourIndexInTxGroup, targetIndices.startIndex, targetIndices.endIndex, queueEntry.correspondingGlobalOffset, targetGroupSize, senderGroupSize, queueEntry.transactionGroup.length);
        this.mainLogger.debug(`factTellCorrespondingNodes: target group indices`, targetIndices)
      }

      let correspondingIndices = getCorrespondingNodes(
        ourIndexInTxGroup,
        targetIndices.startIndex,
        targetIndices.endIndex,
        queueEntry.correspondingGlobalOffset,
        targetGroupSize,
        senderGroupSize,
        queueEntry.transactionGroup.length
      )
      let oldCorrespondingIndices:number[] = undefined
      if(this.config.stateManager.correspondingTellUseUnwrapped){
        // can just find if any home nodes for the accounts we cover would say that our node is wrapped
        // precalc shouldUnwrapSender   check if any account we own shows that we are on the left side of a wrapped range
        // can use partitions to check this
        if (unwrappedIndex != null) {
          const extraCorrespondingIndices = getCorrespondingNodes(
            unwrappedIndex,
            targetIndices.startIndex,
            targetIndices.endIndex,
            queueEntry.correspondingGlobalOffset,
            targetGroupSize,
            senderGroupSize,
            queueEntry.transactionGroup.length,
            queueEntry.logID
          )
          if (Context.config.stateManager.concatCorrespondingTellUseUnwrapped) {
          //add them
          correspondingIndices = correspondingIndices.concat(extraCorrespondingIndices)
          } else {
            // replace them
            oldCorrespondingIndices = correspondingIndices
            correspondingIndices = extraCorrespondingIndices
          }
          //replace them
          // possible optimization where we pick one or the other path based on our account index
          //correspondingIndices = extraCorrespondingIndices
        }
      }

      const validCorrespondingIndices = []
      for (const targetIndex of correspondingIndices) {
        validCorrespondingIndices.push(targetIndex)

        // if (logFlags.debug) {
        //   //  debug verification code
        //   const isValid = verifyCorrespondingSender(targetIndex, ourIndexInTxGroup, queueEntry.correspondingGlobalOffset, targetGroupSize, senderGroupSize, targetIndices.startIndex, targetIndices.endIndex, queueEntry.transactionGroup.length)
        //   if (logFlags.debug) this.mainLogger.debug(`factTellCorrespondingNodes: debug verifyCorrespondingSender`, ourIndexInTxGroup, '->', targetIndex, isValid);
        // }
      }

      const correspondingNodes = []
      for (const index of validCorrespondingIndices) {
        if (index === ourIndexInTxGroup) {
          continue
        }
        const targetNode = queueEntry.transactionGroup[index]
        let targetHasOurData = false

        if (this.config.stateManager.filterReceivingNodesForTXData) {
          targetHasOurData = true
          for (const wrappedResponse of signedPayload.stateList) {
            const accountId = wrappedResponse.accountId
            const targetNodeShardData = cycleShardData.nodeShardDataMap.get(targetNode.id)
            if (targetNodeShardData == null) {
              targetHasOurData = false
              break
            }
            const targetHasKey = ShardFunctions.testAddressInRange(accountId, targetNodeShardData.storedPartitions)
            if (targetHasKey === false) {
              targetHasOurData = false
              break
            }
          }
        }

        // send only if target needs our data
        if (targetHasOurData === false) {
          correspondingNodes.push(targetNode)
        }
      }

      const callParams = {
        oi: unwrappedIndex ?? ourIndexInTxGroup,
        st: targetIndices.startIndex,
        et: targetIndices.endIndex,
        gl: queueEntry.correspondingGlobalOffset,
        tg: targetGroupSize,
        sg: senderGroupSize,
        tn: queueEntry.transactionGroup.length
      }

      this.mainLogger.debug(`factTellCorrespondingNodes: correspondingIndices and nodes ${queueEntry.logID}`, ourIndexInTxGroup, correspondingIndices, correspondingNodes.map(n => n.id), callParams)
      queueEntry.txDebug.correspondingDebugInfo = {
        ourIndex: ourIndexInTxGroup,
        ourUnwrappedIndex: unwrappedIndex,
        callParams,
        localKeys: queueEntry.localKeys,
        oldCorrespondingIndices,
        correspondingIndices:  correspondingIndices,
        correspondingNodeIds: correspondingNodes.map(n => n.id)
      }
      if (correspondingNodes.length === 0) {
        nestedCountersInstance.countEvent('stateManager', 'factTellCorrespondingNodes: no corresponding nodes needed to send')
        return
      }
      // Filter nodes before we send tell()
      const filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
        correspondingNodes,
        'factTellCorrespondingNodes',
        true,
        true
      )
      if (filteredNodes.length === 0) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error("factTellCorrespondingNodes: filterValidNodesForInternalMessage no valid nodes left to try");
        nestedCountersInstance.countEvent('stateManager', 'factTellCorrespondingNodes: no corresponding nodes needed to send')
        return null
      }
      if(payload.stateList.length === 0){
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error("factTellCorrespondingNodes: filterValidNodesForInternalMessage payload.stateList.length === 0");
        nestedCountersInstance.countEvent('stateManager', 'factTellCorrespondingNodes: payload.stateList.length === 0')
        return null
      }
      // send payload to each node in correspondingNodes
      this.broadcastState(filteredNodes, payload, 'factTellCorrespondingNodes')
    } catch (error) {
      /* prettier-ignore */ this.statemanager_fatal( `factTellCorrespondingNodes_ex`, 'factTellCorrespondingNodes' + utils.formatErrorMessage(error) )
    }
  }

  validateCorrespondingTellSender(queueEntry: QueueEntry, dataKey: string, senderNodeId: string): boolean {
    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`validateCorrespondingTellSender: data key: ${dataKey} sender node id: ${senderNodeId}`)
    const receiverNode = this.stateManager.currentCycleShardData.nodeShardData
    if (receiverNode == null) return false

    const receiverIsInExecutionGroup = queueEntry.executionGroupMap.has(receiverNode.node.id)

    const senderNode = this.stateManager.currentCycleShardData.nodeShardDataMap.get(senderNodeId)
    if (senderNode === null) return false

    const senderHasAddress = ShardFunctions.testAddressInRange(dataKey, senderNode.storedPartitions)

    if (configContext.stateManager.shareCompleteData){
      const senderIsInExecutionGroup = queueEntry.executionGroupMap.has(senderNodeId)

      // check if sender is an execution neighouring node
      const neighbourNodes = utils.selectNeighbors(queueEntry.executionGroup, queueEntry.ourExGroupIndex, 2) as Shardus.Node[]
      const neighbourNodeIds = neighbourNodes.map((node) => node.id)
      if (senderIsInExecutionGroup && neighbourNodeIds.includes(senderNodeId) === false) {
        this.mainLogger.error(`validateCorrespondingTellSender: sender is an execution node but not a neighbour node`)
        return false
      }
      if (senderIsInExecutionGroup) nestedCountersInstance.countEvent('stateManager', 'validateCorrespondingTellSender: sender is an execution node')
      else nestedCountersInstance.countEvent('stateManager', 'validateCorrespondingTellSender: sender is not an execution node')

      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`validateCorrespondingTellSender: data key: ${dataKey} sender node id: ${senderNodeId} senderHasAddress: ${senderHasAddress} receiverIsInExecutionGroup: ${receiverIsInExecutionGroup} senderIsInExecutionGroup: ${senderIsInExecutionGroup}`)
      if (receiverIsInExecutionGroup === true || senderHasAddress === true || senderIsInExecutionGroup === true) {
        return true
      }
    } else {
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`validateCorrespondingTellSender: data key: ${dataKey} sender node id: ${senderNodeId} senderHasAddress: ${senderHasAddress} receiverIsInExecutionGroup: ${receiverIsInExecutionGroup}`)
      if (receiverIsInExecutionGroup === true || senderHasAddress === true) {
        return true
      }
    }

    return false
  }

  factValidateCorrespondingTellSender(queueEntry: QueueEntry, dataKey: string, senderNodeId: string): boolean {
    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`factValidateCorrespondingTellSender: txId: ${queueEntry.acceptedTx.txId} sender node id: ${senderNodeId}, receiver id: ${Self.id}`)
    let cycleShardData = this.stateManager.currentCycleShardData
    if (Context.config.stateManager.deterministicTXCycleEnabled) {
      cycleShardData = this.stateManager.shardValuesByCycle.get(queueEntry.txGroupCycle)
    }
    const receiverNodeShardData = cycleShardData.nodeShardData
    if (receiverNodeShardData == null) {
      this.mainLogger.error(`factValidateCorrespondingTellSender: logID: ${queueEntry.logID} receiverNodeShardData == null, txGroupCycle: ${queueEntry.txGroupCycle}}`)
      nestedCountersInstance.countEvent('stateManager', 'factValidateCorrespondingTellSender: receiverNodeShardData == null')
      return false
    }

    const senderNodeShardData = cycleShardData.nodeShardDataMap.get(senderNodeId)
    if (senderNodeShardData === null) {
      this.mainLogger.error(`factValidateCorrespondingTellSender: logID: ${queueEntry.logID} senderNodeShardData == null, txGroupCycle: ${queueEntry.txGroupCycle}}`)
      nestedCountersInstance.countEvent('stateManager', 'factValidateCorrespondingTellSender: senderNodeShardData == null')
      return false
    }
    const senderHasAddress = ShardFunctions.testAddressInRange(dataKey, senderNodeShardData.storedPartitions)

    // check if it is a FACT sender
    const receivingNodeIndex = queueEntry.ourTXGroupIndex // we are the receiver
    const senderNodeIndex = queueEntry.transactionGroup.findIndex((node) => node.id === senderNodeId)
    let wrappedSenderNodeIndex = null
    if (queueEntry.isSenderWrappedTxGroup[senderNodeId] != null) {
      wrappedSenderNodeIndex = queueEntry.isSenderWrappedTxGroup[senderNodeId]
    }
    const receiverGroupSize = queueEntry.executionNodeIdSorted.length
    const senderGroupSize = receiverGroupSize

    const targetGroup = queueEntry.executionNodeIdSorted
    const targetIndices = this.getStartAndEndIndexOfTargetGroup(targetGroup, queueEntry.transactionGroup)

    this.mainLogger.debug(`factValidateCorrespondingTellSender: txId: ${queueEntry.acceptedTx.txId} sender node id: ${senderNodeId}, receiver id: ${Self.id} senderHasAddress: ${senderHasAddress} receivingNodeIndex: ${receivingNodeIndex} senderNodeIndex: ${senderNodeIndex} receiverGroupSize: ${receiverGroupSize} senderGroupSize: ${senderGroupSize} targetIndices: ${utils.stringifyReduce(targetIndices)}`)

    let isValidFactSender = verifyCorrespondingSender(
      receivingNodeIndex,
      senderNodeIndex,
      queueEntry.correspondingGlobalOffset,
      receiverGroupSize,
      senderGroupSize,
      targetIndices.startIndex,
      targetIndices.endIndex,
      queueEntry.transactionGroup.length,
      false,
      queueEntry.logID
    )
    if (isValidFactSender === false && wrappedSenderNodeIndex != null && wrappedSenderNodeIndex >= 0) {
      // try again with wrapped sender index
      isValidFactSender = verifyCorrespondingSender(
        receivingNodeIndex,
        wrappedSenderNodeIndex,
        queueEntry.correspondingGlobalOffset,
        receiverGroupSize,
        senderGroupSize,
        targetIndices.startIndex,
        targetIndices.endIndex,
        queueEntry.transactionGroup.length,
        false,
        queueEntry.logID
      )
    }
    // it maybe a FACT sender but sender does not cover the account
    if (senderHasAddress === false) {
      this.mainLogger.error(
        `factValidateCorrespondingTellSender: logId: ${queueEntry.logID} sender does not have the address and is not a exe neighbour`
      )
      nestedCountersInstance.countEvent(
        'stateManager',
        'factValidateCorrespondingTellSender: sender does not have the address and is not a exe; neighbour'
      )
      return false
    }

    // it is neither a FACT corresponding node nor an exe neighbour node
    if (isValidFactSender === false) {
      this.mainLogger.error(
        `factValidateCorrespondingTellSender: logId: ${queueEntry.logID} sender is neither a valid sender nor a neighbour node isValidSender:  ${isValidFactSender}`
      )
      nestedCountersInstance.countEvent(
        'stateManager',
        'factValidateCorrespondingTellSender: sender is not a valid sender or a neighbour node'
      )
      return false
    }
    return true
  }

  getStartAndEndIndexOfTargetGroup(targetGroup: string[], transactionGroup: (Shardus.NodeWithRank | P2PTypes.NodeListTypes.Node)[]): { startIndex: number; endIndex: number } {
    const targetIndexes: number[] = []
    for (let i = 0; i < transactionGroup.length; i++) {
      const nodeId = transactionGroup[i].id
      if (targetGroup.indexOf(nodeId) >= 0) {
        targetIndexes.push(i)
      }
    }
    if (logFlags.verbose) this.mainLogger.debug(`getStartAndEndIndexOfTargetGroup: all target indexes`, targetIndexes);
    const n = targetIndexes.length
    let startIndex = targetIndexes[0]
    // Find the pivot where the circular array starts
    for (let i = 1; i < n; i++) {
      if (targetIndexes[i] > targetIndexes[i - 1] + 1) {
        startIndex = targetIndexes[i]
        break
      }
    }
    let endIndex = startIndex + n
    if (endIndex > transactionGroup.length) {
      endIndex = endIndex - transactionGroup.length
    }
    return { startIndex, endIndex }
  }

  /**
   * After a reciept is formed, use this to send updated account data to shards that did not execute a change
   * I am keeping the async tag because this function does kick off async tasks it just does not await them
   * I think this tag makes it more clear that this function is not a simple synchronous function
   * @param queueEntry
   * @returns
   */
  async tellCorrespondingNodesFinalData(queueEntry: QueueEntry): Promise<void> {
    profilerInstance.profileSectionStart('tellCorrespondingNodesFinalData', true)
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
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('tellCorrespondingNodesFinalData', queueEntry.logID, `tellCorrespondingNodesFinalData nodesToSendTo:${Object.keys(nodesToSendTo).length} doOnceNodeAccPair:${doOnceNodeAccPair.size} indicies:${Utils.safeStringify(indicies)} edgeIndicies:${Utils.safeStringify(edgeIndicies)} patchIndicies:${Utils.safeStringify(patchIndicies)}  doOnceNodeAccPair: ${Utils.safeStringify([...doOnceNodeAccPair.keys()])} ourLocalExecutionSetIndex:${ourLocalExecutionSetIndex} ourSendingGroupSize:${ourSendingGroupSize} consensusListSize:${consensusListSize} edgeListSize:${edgeListSize} pachedListSize:${pachedListSize}`)

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
          const filterNodesIpPort = filterdCorrespondingAccNodes.map(
            (node) => node.externalIp + ':' + node.externalPort
          )
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.debug('tellcorrernodingnodesfinaldata', queueEntry.logID, ` : filterValidNodesForInternalMessage ${filterNodesIpPort} for accounts: ${utils.stringifyReduce(message.stateList)}`)
          // if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.broadcastFinalStateBinary) {
            // convert legacy message to binary supported type
            const request = message as BroadcastFinalStateReq
            if (logFlags.seqdiagram) {
              for (const node of filterdCorrespondingAccNodes) {
                /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455102 ${shardusGetTime()} tx:${message.txid} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'broadcast_finalstate'}`)
              }
            }

            this.p2p.tellBinary<BroadcastFinalStateReq>(
              filterdCorrespondingAccNodes,
              InternalRouteEnum.binary_broadcast_finalstate,
              request,
              serializeBroadcastFinalStateReq,
              {
                verification_data: verificationDataCombiner(
                  message.txid,
                  message.stateList.length.toString()
                ),
              }
            )
          // } else {
            // this.p2p.tell(filterdCorrespondingAccNodes, 'broadcast_finalstate', message)
          // }
          totalShares++
        }
      }
    }

    nestedCountersInstance.countEvent('tellCorrespondingNodesFinalData', 'totalShares', totalShares)
    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tellCorrespondingNodesFinalData - end: ${queueEntry.logID} totalShares:${totalShares}`)
    profilerInstance.profileSectionEnd('tellCorrespondingNodesFinalData', true)
  }

  factTellCorrespondingNodesFinalData(queueEntry: QueueEntry): void {
    profilerInstance.profileSectionStart('factTellCorrespondingNodesFinalData', true)
    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('factTellCorrespondingNodesFinalData', queueEntry.logID, `factTellCorrespondingNodesFinalData - start: ${queueEntry.logID}`)

    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('factTellCorrespondingNodesFinalData: currentCycleShardData == null')
    }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('factTellCorrespondingNodesFinalData: queueEntry.uniqueKeys == null')
    }
    if (queueEntry.globalModification === true) {
      throw new Error('factTellCorrespondingNodesFinalData globalModification === true')
    }

    if (this.executeInOneShard && queueEntry.isInExecutionHome === false) {
      throw new Error('factTellCorrespondingNodesFinalData isInExecutionHome === false')
    }
    if (queueEntry.executionShardKey == null || queueEntry.executionShardKey == '') {
      throw new Error('factTellCorrespondingNodesFinalData executionShardKey == null or empty')
    }
    if (queueEntry.preApplyTXResult == null) {
      throw new Error('factTellCorrespondingNodesFinalData preApplyTXResult == null')
    }

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

    let totalShares = 0
    const targetStartIndex = 0
    const targetEndIndex = queueEntry.transactionGroup.length
    const targetGroupSize = queueEntry.transactionGroup.length

    const senderIndexInTxGroup = queueEntry.ourTXGroupIndex
    const senderGroupSize = queueEntry.executionGroup.length
    const unwrappedIndex = queueEntry.isSenderWrappedTxGroup[Self.id]

    let correspondingIndices = getCorrespondingNodes(
      senderIndexInTxGroup,
      targetStartIndex,
      targetEndIndex,
      queueEntry.correspondingGlobalOffset,
      targetGroupSize,
      senderGroupSize,
      queueEntry.transactionGroup.length,
      queueEntry.logID
    )

    if (this.config.stateManager.correspondingTellUseUnwrapped) {
      if (unwrappedIndex != null) {
        const extraCorrespondingIndices = getCorrespondingNodes(
          unwrappedIndex,
          targetStartIndex,
          targetEndIndex,
          queueEntry.correspondingGlobalOffset,
          targetGroupSize,
          senderGroupSize,
          queueEntry.transactionGroup.length,
          queueEntry.logID
        )
        if (Context.config.stateManager.concatCorrespondingTellUseUnwrapped) {
          correspondingIndices.concat(extraCorrespondingIndices)
        } else {
          correspondingIndices = extraCorrespondingIndices
        }
      }
    }

    for (const key of keysToShare) {
      // eslint-disable-next-line security/detect-object-injection
      if (wrappedStates[key] != null) {
        if (queueEntry.ourExGroupIndex === -1) {
          throw new Error(
            'factTellCorrespondingNodesFinalData: should never get here.  our sending node must be in the execution group'
          )
        }
        const storageNodesForAccount = this.getStorageGroupForAccount(key)
        const storageNodesAccountIds = new Set(storageNodesForAccount.map((node) => node.id))

        const correspondingNodes: P2PTypes.NodeListTypes.Node[] = []
        for (const index of correspondingIndices) {
          const node = queueEntry.transactionGroup[index]
          if (storageNodesAccountIds.has(node.id)) {
            correspondingNodes.push(node)
          }
        }

        //how can we be making so many calls??
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) {
          this.logger.playbackLogNote('factTellCorrespondingNodesFinalData', queueEntry.logID, `factTellCorrespondingNodesFinalData ourIndex: ${senderIndexInTxGroup} correspondingIndices:${JSON.stringify(correspondingIndices)} correspondingNodes:${JSON.stringify(correspondingNodes.map(node => node.id))} for accounts: ${key}`)
        }

        const dataToSend: Shardus.WrappedResponse[] = []
        // eslint-disable-next-line security/detect-object-injection
        dataToSend.push(datas[key]) // only sending just this one key at a time
        message = { stateList: dataToSend, txid: queueEntry.acceptedTx.txId }
        if (correspondingNodes.length > 0) {
          // Filter nodes before we send tell()
          const filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
            correspondingNodes,
            'factTellCorrespondingNodesFinalData',
            true,
            true
          )
          if (filteredNodes.length === 0) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error('factTellCorrespondingNodesFinalData: filterValidNodesForInternalMessage no valid nodes left to try')
            //return null
            continue
          }
          const filterdCorrespondingAccNodes = filteredNodes
          const filterNodesIpPort = filterdCorrespondingAccNodes.map(
            (node) => node.externalIp + ':' + node.externalPort
          )
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.debug('tellcorrernodingnodesfinaldata', queueEntry.logID, ` : filterValidNodesForInternalMessage ${filterNodesIpPort} for accounts: ${utils.stringifyReduce(message.stateList)}`)
            // convert legacy message to binary supported type
            const request = message as BroadcastFinalStateReq

          if (this.usePOQo) {
            if (logFlags.seqdiagram) {
              for (const node of filterdCorrespondingAccNodes) {
                /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455102 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'poqo_data_and_receipt'}`)
              }
            }
            this.p2p.tellBinary<PoqoDataAndReceiptReq>(  
              filterdCorrespondingAccNodes,
              InternalRouteEnum.binary_poqo_data_and_receipt, 
              {
                finalState: message,
                receipt: queueEntry.appliedReceipt2,
                txGroupCycle: queueEntry.txGroupCycle
              },
              serializePoqoDataAndReceiptReq,
              {}
            )
          } else 
            if (logFlags.seqdiagram) {
              for (const node of filterdCorrespondingAccNodes) {
                /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455102 ${shardusGetTime()} tx:${message.txid} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'broadcast_finalstate'}`)
              }
            }

            this.p2p.tellBinary<BroadcastFinalStateReq>(
              filterdCorrespondingAccNodes,
              InternalRouteEnum.binary_broadcast_finalstate,
              request,
              serializeBroadcastFinalStateReq,
              {
                verification_data: verificationDataCombiner(
                  message.txid,
                  message.stateList.length.toString()
                ),
              }
            )
          // } else {
            // this.p2p.tell(filterdCorrespondingAccNodes, 'broadcast_finalstate', message)
          // }
          totalShares++
        }
      }
    }

    nestedCountersInstance.countEvent('factTellCorrespondingNodesFinalData', 'totalShares', totalShares)
    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`factTellCorrespondingNodesFinalData - end: ${queueEntry.logID} totalShares:${totalShares}`)
    profilerInstance.profileSectionEnd('factTellCorrespondingNodesFinalData', true)
  }

  factValidateCorrespondingTellFinalDataSender(queueEntry: QueueEntry, senderNodeId: string): boolean {
    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`factValidateCorrespondingTellFinalDataSender: txId: ${queueEntry.acceptedTx.txId} sender node id: ${senderNodeId}, receiver id: ${Self.id}`)
    const senderNode = NodeList.nodes.get(senderNodeId)
    if (senderNode === null) {
      /* prettier-ignore */ if(logFlags.error) this.mainLogger.error(`factValidateCorrespondingTellFinalDataSender: logId: ${queueEntry.logID} sender node is null`)
      nestedCountersInstance.countEvent('stateManager', 'factValidateCorrespondingTellFinalDataSender: sender node is null')
      return false
    }
    const senderIsInExecutionGroup = queueEntry.executionGroupMap.has(senderNodeId)

    if (senderIsInExecutionGroup === false) {
      /* prettier-ignore */ if(logFlags.error) this.mainLogger.error(`factValidateCorrespondingTellFinalDataSender: logId: ${queueEntry.logID} sender is not in the execution group sender:${senderNodeId}`)
      nestedCountersInstance.countEvent('stateManager', 'factValidateCorrespondingTellFinalDataSender: sender is not in the execution group')
      return false
    }

    let senderNodeIndex = queueEntry.transactionGroup.findIndex((node) => node.id === senderNodeId)
    if (queueEntry.isSenderWrappedTxGroup[senderNodeId] != null) {
      senderNodeIndex = queueEntry.isSenderWrappedTxGroup[senderNodeId]
    }
    const senderGroupSize = queueEntry.executionGroup.length

    const targetNodeIndex = queueEntry.ourTXGroupIndex // we are the receiver
    const targetGroupSize = queueEntry.transactionGroup.length
    const targetStartIndex = 0 // start of tx group
    const targetEndIndex = queueEntry.transactionGroup.length // end of tx group


    // check if it is a FACT sender
    const isValidFactSender = verifyCorrespondingSender(targetNodeIndex, senderNodeIndex, queueEntry.correspondingGlobalOffset, targetGroupSize, senderGroupSize, targetStartIndex
      , targetEndIndex, queueEntry.transactionGroup.length)

    // it is not a FACT corresponding node
    if (isValidFactSender === false) {
      /* prettier-ignore */ if(logFlags.error) this.mainLogger.error(`factValidateCorrespondingTellFinalDataSender: logId: ${queueEntry.logID} sender is not a valid sender isValidSender:  ${isValidFactSender}`);
      nestedCountersInstance.countEvent('stateManager', 'factValidateCorrespondingTellFinalDataSender: sender is not a valid sender or a neighbour node')
      return false
    }
    return true
  }

  dumpTxDebugToStatList(queueEntry: QueueEntry): void {
    this.txDebugStatList.set(queueEntry.acceptedTx.txId, { ...queueEntry.txDebug })
  }

  clearTxDebugStatList(): void {
    this.txDebugStatList.clear()
  }

  printTxDebugByTxId(txId: string): string {
    // get the txStat from the txDebugStatList
    const txStat = this.txDebugStatList.get(txId)
    if (txStat == null) {
      return 'No txStat found'
    }
    let resultStr = ''
    for (const key in txStat.duration) {
      resultStr += `${key}: start:${txStat.startTimestamp[key]} end:${txStat.endTimestamp[key]} ${txStat.duration[key]} ms\n`
    }
    return resultStr
  }

  printTxDebug(): string {
    const collector = {}
    const totalTxCount = this.txDebugStatList.size()

    const indexes = [
      'aging',
      'processing',
      'awaiting data',
      'preApplyTransaction',
      'consensing',
      'commiting',
      'await final data',
      'expired',
      'total_queue_time',
      'pass',
      'fail',
    ]

    /* eslint-disable security/detect-object-injection */
    for (const [txId, txStat] of this.txDebugStatList.entries()) {
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
    const sortedCollector = {}
    for (const key of indexes) {
      sortedCollector[key] = { ...collector[key] }
    }
    /* eslint-enable security/detect-object-injection */
    const lines = []
    lines.push(`=> Total Transactions: ${totalTxCount}`)
    for (const [key, collectorForThisKey] of Object.entries(sortedCollector)) {
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
  removeFromQueue(queueEntry: QueueEntry, currentIndex: number, archive = true): void {
    // end all the pending txDebug timers
    /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455104 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: removed`)
    for (const key in queueEntry.txDebug.startTime) {
      if (queueEntry.txDebug.startTime[key] != null) {
        this.txDebugMarkEndTime(queueEntry, key)
      }
    }
    // this.txDebugMarkEndTime(queueEntry, 'total_queue_time')
    this.stateManager.eventEmitter.emit('txPopped', queueEntry.acceptedTx.txId)
    if (queueEntry.txDebug) this.dumpTxDebugToStatList(queueEntry)
    this._transactionQueue.splice(currentIndex, 1)
    this._transactionQueueByID.delete(queueEntry.acceptedTx.txId)

    if (archive === false) {
      if (logFlags.debug) this.mainLogger.debug(`removeFromQueue: ${queueEntry.logID} done. No archive`);
      return
    }

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
    if (logFlags.debug) this.mainLogger.debug(`removeFromQueue: ${queueEntry.logID} and added to archive done`);
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

      if (logFlags.seqdiagram) this.mainLogger.info(`0x10052024 ${ipInfo.externalIp} ${shardusGetTime()} 0x0000 processTransactions _transactionQueue.length ${this._transactionQueue.length}`)

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
      // const timeM2 = timeM * 2 // 12s
      // const timeM2_5 = timeM * 2.25 // 13.5s
      // const timeM3 = timeM * 2.5 // 15s
      const timeM2 = timeM * 2
      const timeM2_5 = timeM * 2.5
      const timeM3 = timeM * 3
      let currentTime = shardusGetTime()

      const app = this.app

      // process any new queue entries that were added to the temporary list
      if (this.pendingTransactionQueue.length > 0) {
        for (const txQueueEntry of this.pendingTransactionQueue) {
          nestedCountersInstance.countEvent('stateManager', 'processAcceptedTxQueue injest: kept TX')

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
            nestedCountersInstance.countEvent('processing', 'txExpired1 > M. waitForReceiptOnly')
            txQueueEntry.waitForReceiptOnly = true
            if(this.config.stateManager.txStateMachineChanges){
              this.updateTxState(txQueueEntry, 'await final data', 'processTx1')
            } else {
              this.updateTxState(txQueueEntry, 'consensing')
            }
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

          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455105 ${shardusGetTime()} tx:${txQueueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: aging`)

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
        if (logFlags.seqdiagram)  this.mainLogger.info(`0x10052024 ${ipInfo.externalIp} ${shardusGetTime()} 0x0001 currentIndex:${currentIndex} txId:${queueEntry.acceptedTx.txId} state:${queueEntry.state}`)
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

              if (configContext.stateManager.disableTxExpiration === false) {
                this.setTXExpired(queueEntry, currentIndex, 'old, timeM3 * 2')
                continue
              }
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
            //   this.updateTxState(queueEntry, 'expired')
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

                if (configContext.stateManager.disableTxExpiration === false) {
                  this.setTXExpired(queueEntry, currentIndex, 'old, timeM3, requestingReceiptFailed')
                  continue
                }
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

                if (configContext.stateManager.disableTxExpiration === false) {
                  this.setTXExpired(queueEntry, currentIndex, 'old, timeM3, repairFailed')
                  continue
                }
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

                      if(this.config.stateManager.txStateMachineChanges){
                        this.updateTxState(queueEntry, 'await final data', 'processTx2')
                      } else {
                        this.updateTxState(queueEntry, 'consensing')
                      }
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

                    if(this.config.stateManager.txStateMachineChanges){
                      this.updateTxState(queueEntry, 'await final data', 'processTx3')
                    } else {
                      this.updateTxState(queueEntry, 'consensing')
                    }
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
                if (configContext.stateManager.disableTxExpiration === false) {
                  /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M2 canceled due to upstream TXs. state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification}`)
                  //todo only keep on for temporarliy
                  /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M2 canceled due to upstream TXs. sieveT:${queueEntry.txSieveTime}`)
                  this.setTXExpired(queueEntry, currentIndex, 'm2, processing or awaiting')
                  if (configContext.stateManager.stuckTxQueueFix) continue // we need to skip this TX and move to the next one
                }
                if (configContext.stateManager.stuckTxQueueFix === false) continue
              }
            }
          }
          // check  if we seen a vote or has a vote
          const hasSeenVote = queueEntry.receivedBestVote != null || queueEntry.ourVote != null
          const hasSeenConfirmation = queueEntry.receivedBestConfirmation != null

          // remove TXs that are stuck in the processing queue for 2 min
          if (configContext.stateManager.removeStuckTxsFromQueue === true && txAge > configContext.stateManager.stuckTxRemoveTime) {
            nestedCountersInstance.countEvent('txSafelyRemoved', `txAge > 2m`)
            this.statemanager_fatal(`txSafelyRemoved`, `txAge > 2m txid: ${shortID} state: ${queueEntry.state} age:${txAge}`)
            this.removeFromQueue(queueEntry, currentIndex)
            continue
          }

          if (configContext.stateManager.removeStuckTxsFromQueue2 === true) {
            const timeSinceLastVoteMessage = queueEntry.lastVoteReceivedTimestamp > 0 ? currentTime - queueEntry.lastVoteReceivedTimestamp : 0
            // see if we have been consensing for more than a long time.
            // follow up code needs to handle this in a better way
            // if there is a broken TX at the end of a chain. this will peel it off.
            // any freshly exposed TXs will have a fair amount of time to be in consensus so
            // this should minimize the risk of OOS.
            if(timeSinceLastVoteMessage > configContext.stateManager.stuckTxRemoveTime2){
              nestedCountersInstance.countEvent('txSafelyRemoved', `tx waiting for votes more than ${configContext.stateManager.stuckTxRemoveTime2 / 1000} seconds. state: ${queueEntry.state}`)
              this.statemanager_fatal(`txSafelyRemoved`, `stuck in consensus. 2. waiting for votes. txid: ${shortID} state: ${queueEntry.state} age:${txAge} tx first vote seen ${timeSinceLastVoteMessage / 1000} seconds ago`)
              this.removeFromQueue(queueEntry, currentIndex)
              continue
            }
          }

          if (configContext.stateManager.removeStuckTxsFromQueue3 === true) {
            if (queueEntry.state === 'consensing' && txAge > configContext.stateManager.stuckTxRemoveTime3){
              const anyVotes = (queueEntry.lastVoteReceivedTimestamp > 0)
              nestedCountersInstance.countEvent('txSafelyRemoved', `tx in consensus more than ${configContext.stateManager.stuckTxRemoveTime3 / 1000} seconds. state: ${queueEntry.state} has seen vote: ${anyVotes}`)
              this.statemanager_fatal(`txSafelyRemoved`, `stuck in consensus. 3. txid: ${shortID} state: ${queueEntry.state} age:${txAge}`)
              this.removeFromQueue(queueEntry, currentIndex)
              continue
            }
          }

          if (txAge > timeM3 + configContext.stateManager.confirmationSeenExpirationTime + 10000) {
            // nestedCountersInstance.countEvent('txExpired', `txAge > timeM3 + confirmSeenExpirationTime + 10s`)
            // maybe we missed the spread_appliedReceipt2 gossip, go to await final data if we have a confirmation
            // we will request the final data (and probably receipt2)
            if (configContext.stateManager.disableTxExpiration && hasSeenVote && queueEntry.firstVoteReceivedTimestamp > 0) {
              // nestedCountersInstance.countEvent('txExpired', `> timeM3 + confirmSeenExpirationTime state: ${queueEntry.state} hasSeenVote: ${hasSeenVote} hasSeenConfirmation: ${hasSeenConfirmation} waitForReceiptOnly: ${queueEntry.waitForReceiptOnly}`)
              if(this.config.stateManager.txStateMachineChanges){
                if (configContext.stateManager.stuckTxQueueFix) {
                  if (configContext.stateManager.singleAccountStuckFix) {
                    const timeSinceVoteSeen = shardusGetTime() - queueEntry.firstVoteReceivedTimestamp
                    // if we has seenVote but still stuck in consensing state, we should go to await final data and ask receipt+data

                    //note: this block below may not be what we want in POQo, but is behind a long time setting for now (in dapp)
                    //need to consider some clean up here
                    if (queueEntry.state === 'consensing' && timeSinceVoteSeen > configContext.stateManager.stuckTxMoveTime) {
                      if (logFlags.debug) this.mainLogger.debug(`txId ${queueEntry.logID} move stuck consensing tx to await final data. timeSinceVoteSeen: ${timeSinceVoteSeen} ms`)
                      nestedCountersInstance.countEvent('consensus', `move stuck consensing tx to await final data.`)
                      this.updateTxState(queueEntry, 'await final data')
                    }
                  } else {
                    // make sure we are not resetting the state and causing state start timestamp to be updated repeatedly
                    if (queueEntry.state !== 'await final data' && queueEntry.state !== 'await repair') this.updateTxState(queueEntry, 'await final data')
                  }
                } else {
                  this.updateTxState(queueEntry, 'await final data', 'processTx4')
                }

              } else {
                this.updateTxState(queueEntry, 'consensing')
              }
              if (configContext.stateManager.stuckTxQueueFix === false) continue // we should not skip this TX
            }
            if (configContext.stateManager.disableTxExpiration === false) {
              this.setTXExpired(queueEntry, currentIndex, 'txAge > timeM3 + confirmSeenExpirationTime + 10s')
              continue
            }
          } else if (txAge > timeM3 + configContext.stateManager.confirmationSeenExpirationTime) {
            let shouldExpire = true
            if (queueEntry.hasRobustConfirmation && queueEntry.isInExecutionHome) {
              nestedCountersInstance.countEvent('txExpired', `> timeM3 + confirmSeenExpirationTime but hasRobustConfirmation = true, not expiring`)
              shouldExpire = false
            }
            if (shouldExpire && configContext.stateManager.disableTxExpiration === false) {
              nestedCountersInstance.countEvent('txExpired', `> timeM3 + confirmSeenExpirationTime hasRobustConfirmation: ${queueEntry.hasRobustConfirmation}`)
              this.setTXExpired(queueEntry, currentIndex, 'txAge > timeM3 + confirmSeenExpirationTime general case has' +
                ' vote and robust confirmation but fail' +
                ' to' +
                ' commit the tx')
              continue
            }
          } else if (txAge > timeM3 + configContext.stateManager.voteSeenExpirationTime && hasSeenVote && !hasSeenConfirmation) {
            if (configContext.stateManager.disableTxExpiration === false) {
              nestedCountersInstance.countEvent('txExpired', `> timeM3 + voteSeenExpirationTime`)
              this.mainLogger.error(`${queueEntry.logID} txAge > timeM3 + voteSeenExpirationTime general case has vote but fail to generate receipt`)
              this.setTXExpired(queueEntry, currentIndex, 'txAge > timeM3 + voteSeenExpirationTime general case has vote but fail' +
                ' to' +
                ' commit the tx')
              continue
            }
          } else if (txAge > timeM3 + configContext.stateManager.noVoteSeenExpirationTime && !hasSeenVote) {
            // seen no vote but past timeM3 + noVoteSeenExpirationTime
            // nestedCountersInstance.countEvent('txExpired', `> timeM3 + noVoteSeenExpirationTime`)
            // this.mainLogger.error(`${queueEntry.logID} txAge > timeM3 + noVoteSeenExpirationTime general case. no vote seen`)
            if (configContext.stateManager.disableTxExpiration === false) {
              this.setTXExpired(queueEntry, currentIndex, 'txAge > timeM3 + noVoteSeenExpirationTime general case. no vote seen')
              continue
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

              if (configContext.stateManager.disableTxExpiration === false) {
                this.setTXExpired(queueEntry, currentIndex, 'm2 ' + reason)
              }
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

          // Have a hard cap where we ALMOST expire but NOT remove TXs from queue after time > M3
          if (txAge > timeM3 + extraTime && queueEntry.isInExecutionHome && queueEntry.almostExpired == null && configContext.stateManager.disableTxExpiration === false) {
            const hasVoted = queueEntry.ourVote != null
            const receivedVote = queueEntry.receivedBestVote != null
            if (!receivedVote && !hasVoted && queueEntry.almostExpired == null) {
              this.statemanager_fatal(
                `setTxAlmostExpired > M3. general case`,
                `setTxAlmostExpired txAge > timeM3 general case ` +
                `txid: ${shortID} state: ${queueEntry.state} hasAll:${queueEntry.hasAll} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}  hasReceipt:${hasReceipt} matchingReceipt:${matchingReceipt} isInExecutionHome:${isInExecutionHome} hasVote: ${queueEntry.receivedBestVote != null}`
              )
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `setTxAlmostExpired ${queueEntry.txGroupDebug} txExpired 3 requestingReceiptFailed  ${utils.stringifyReduce(queueEntry.acceptedTx)} ${queueEntry.didWakeup}`)
              //if (logFlags.playback) this.logger.playbackLogNote('txExpired', `${shortID}`, `${queueEntry.txGroupDebug} queueEntry.recievedAppliedReceipt 3 requestingReceiptFailed: ${utils.stringifyReduce(queueEntry.recievedAppliedReceipt)}`)

              /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `setTxAlmostExpired > M3. general case state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification} hasReceipt:${hasReceipt} matchingReceipt:${matchingReceipt} isInExecutionHome:${isInExecutionHome} hasVote: ${queueEntry.receivedBestVote != null}`)
              /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `setTxAlmostExpired > M3. general case sieveT:${queueEntry.txSieveTime} extraTime:${extraTime}`)

              nestedCountersInstance.countEvent('txExpired', 'set to almostExpired because we have not voted' +
                ' or received' +
                ' a' +
                ' vote')
              this.setTxAlmostExpired(queueEntry, currentIndex, 'm3 general: almostExpired not voted or received vote')
            }
            // continue
          }

          //TODO? could we remove a TX from the queu as soon as a receit was requested?
          //TODO?2 should we allow a TX to use a repair op shortly after being expired? (it would have to be carefull, and maybe use some locking)
        }

        const txStartTime = shardusGetTime()

        // HANDLE TX logic based on state.
        try {
          this.profiler.profileSectionStart(`process-${queueEntry.state}`)
          if (logFlags.profiling_verbose)
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

              // old logic changed state here (seen commented out in the new mode)
              if(this.config.stateManager.txStateMachineChanges){
                // this.updateTxState(queueEntry, 'await final data')
              } else {
                this.updateTxState(queueEntry, 'await final data', 'processTx5')
              }
            }

            this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
          } else if (queueEntry.state === 'aging') {
            queueEntry.executionDebug = { a: 'go' }
            ///////////////////////////////////////////--aging--////////////////////////////////////////////////////////////////
            // We wait in the aging phase, and mark accounts as seen to prevent a TX that is after this from using or changing data
            // on the accounts in this TX
            // note that code much earlier in the loop rejects any queueEntries younger than time M
            this.updateTxState(queueEntry, 'processing')
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
                  profilerInstance.scopedProfileSectionStart(`scoped-tellCorrespondingNodes`)
                  if (configContext.p2p.useFactCorrespondingTell) {
                    await this.factTellCorrespondingNodes(queueEntry)
                  } else  {
                    await this.tellCorrespondingNodes(queueEntry)
                  }
                  profilerInstance.scopedProfileSectionEnd(`scoped-tellCorrespondingNodes`)
                  /* prettier-ignore */ this.setDebugLastAwaitedCall('this.stateManager.transactionQueue.tellCorrespondingNodes(queueEntry)', DebugComplete.Completed)
                } else {
                  /* prettier-ignore */ this.setDebugLastAwaitedCall('this.stateManager.transactionQueue.tellCorrespondingNodesOld(queueEntry)')
                  //specific fixes were needed for tellCorrespondingNodes.  tellCorrespondingNodesOld is the old version before fixes
                  if (configContext.p2p.useFactCorrespondingTell) {
                    await this.factTellCorrespondingNodes(queueEntry)
                  } else  {
                    await this.tellCorrespondingNodes(queueEntry)
                  }
                  /* prettier-ignore */ this.setDebugLastAwaitedCall('this.stateManager.transactionQueue.tellCorrespondingNodesOld(queueEntry)', DebugComplete.Completed)
                }
                queueEntry.dataSharedTimestamp = shardusGetTime()
                if (logFlags.debug) /* prettier-ignore */ this.mainLogger.debug(`tellCorrespondingNodes: ${queueEntry.logID} dataSharedTimestamp: ${queueEntry.dataSharedTimestamp}`)

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
                queueEntry.dataSharedTimestamp = shardusGetTime()
                nestedCountersInstance.countEvent(`processing`, `tellCorrespondingNodes fail`)

                queueEntry.executionDebug.process1 = 'tell fail'
              } finally {
                this.updateTxState(queueEntry, 'awaiting data', 'mainLoop')

                //if we are not going to execute the TX go strait to consensing
                if (
                  queueEntry.globalModification === false &&
                  this.executeInOneShard &&
                  queueEntry.isInExecutionHome === false
                ) {
                  //is there a way to preemptively forward data without there being tons of repair..
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 isInExecutionHome === false. set state = 'consensing' tx:${queueEntry.logID} ts:${queueEntry.acceptedTx.timestamp}`)
                  this.updateTxState(queueEntry, 'consensing','fromProcessing')
                }
              }
              queueEntry.executionDebug.processElapsed = shardusGetTime() - time
            } else {
              const upstreamTx = this.processQueue_getUpstreamTx(seenAccounts, queueEntry)
              if (upstreamTx == null) {
                /* prettier-ignore */ if (logFlags.seqdiagram && queueEntry?.upStreamBlocker !== 'null') {
                  queueEntry.upStreamBlocker = 'null' // 'dirty'
                  this.seqLogger.info(`0x53455104 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: upstream:null`)
                }
                nestedCountersInstance.countEvent('processing', 'busy waiting the upstream tx.' +
                  ' but it is null')
              } else {
                if (upstreamTx.logID === queueEntry.logID) {
                  /* prettier-ignore */ if (logFlags.seqdiagram && queueEntry?.upStreamBlocker !== upstreamTx.logID) {
                    queueEntry.upStreamBlocker = upstreamTx.logID
                    this.seqLogger.info(`0x53455104 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: upstream:same`)
                  }
                  //not 100% confident that upstreamTX check works.
                  if(upstreamTx === queueEntry){
                    //this queue entry could be marked as seen due to aging above
                    nestedCountersInstance.countEvent('processing', 'busy waiting but the upstream tx reference matches our queue entry')
                  } else {
                    nestedCountersInstance.countEvent('processing', 'busy waiting the upstream tx but it is same txId')
                  }

                } else {
                  /* prettier-ignore */ if (logFlags.seqdiagram && queueEntry?.upStreamBlocker !== upstreamTx.logID) {
                    queueEntry.upStreamBlocker = upstreamTx.logID
                    this.seqLogger.info(`0x53455104 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: upstream:${upstreamTx.logID}`)
                  }
                  nestedCountersInstance.countEvent('processing', `busy waiting the upstream tx to complete. state ${queueEntry.state}`)
                }
              }
            }
            this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
          }
          if (queueEntry.state === 'awaiting data') {
            queueEntry.executionDebug.log = 'entered awaiting data'

            ///////////////////////////////////////--awaiting data--////////////////////////////////////////////////////////////////////

            // Wait for all data to be aquired.
            // Once we have all the data we need we can move to consensing phase.
            // IF this is a global account it will go strait to commiting phase since the data was shared by other means.

            // 20240709  this if/else looks like it can go away
            // if (this.queueTimingFixes === true) {
            //   if (txAge > timeM2_5) {
            //     // const isBlocked = this.processQueue_accountSeen(seenAccounts, queueEntry)
            //     // //need to review this in context of sharding
            //     // /* prettier-ignore */ nestedCountersInstance.countEvent('txExpired', `> M2.5 canceled due to lack of progress. state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification} isBlocked:${isBlocked}`)
            //     // const missingAccounts = this.queueEntryListMissingData(queueEntry)
            //     // nestedCountersInstance.countEvent('txExpired', `missing accounts: ${missingAccounts.length}`)
            //     // if (logFlags.playback) {
            //     //   this.logger.playbackLogNote(
            //     //     'txExpired>M2.5',
            //     //     `${shortID}`,
            //     //     `> M2.5 canceled due to lack of progress. state:${queueEntry.state} hasAll:${
            //     //       queueEntry.hasAll
            //     //     } globalMod:${
            //     //       queueEntry.globalModification
            //     //     } isBlocked:${isBlocked} missing:${utils.stringifyReduce(missingAccounts)}`
            //     //   )
            //     // }
            //     // //Log as error also.. can comment this out later
            //     // /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`txExpired > M2.5 canceled due to lack of progress. state:${queueEntry.state} hasAll:${queueEntry.hasAll} globalMod:${queueEntry.globalModification} isBlocked:${isBlocked} missing:${utils.stringifyReduce(missingAccounts)}`)
            //     // this.setTXExpired(queueEntry, currentIndex, 'm2.5 awaiting data')
            //     // continue
            //   }
            // } else {
            //   // catch all in case we get waiting for data
            //   if (txAge > timeM2_5) {
            //     this.processQueue_markAccountsSeen(seenAccounts, queueEntry)
            //     /* prettier-ignore */ nestedCountersInstance.countEvent('processing', `awaiting data txAge > m2.5 set to consensing hasAll:${queueEntry.hasAll} hasReceivedApplyReceipt:${hasReceivedApplyReceipt}`)

            //     queueEntry.waitForReceiptOnly = true

            //     if(this.config.stateManager.txStateMachineChanges){
            //       this.updateTxState(queueEntry, 'await final data', 'processTx6')
            //     } else {
            //       this.updateTxState(queueEntry, 'consensing')
            //     }
            //     continue
            //   }
            // }

            // TODO review this block below in more detail.
            // check if we have all accounts
            if (queueEntry.hasAll === false && txAge > timeM2) {
              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)

              if (queueEntry.pendingDataRequest === true) {
                //early out after marking seen, because we are already asking for data
                //need to review this in context of sharding
                nestedCountersInstance.countEvent('processing', 'awaiting data. pendingDataRequest')
                continue
              }

              if (this.queueEntryHasAllData(queueEntry) === true) {
                // I think this can't happen
                /* prettier-ignore */ nestedCountersInstance.countEvent('processing', 'data missing at t>M2. but not really. investigate further')
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_hadDataAfterall', `${shortID}`, `This is kind of an error, and should not happen`)
                continue
              }

              // This code is wrong, so disabling it for now
              // if (
              //   this.queueTimingFixes === true &&
              //   this.processQueue_accountSeen(seenAccounts, queueEntry) === true
              // ) {
              //   //we are stuck in line so no cause to ask for data yet.

              //   //TODO may need a flag that know if a TX was stuck until time m.. then let it not
              //   //ask for other accoun data right away...

              //   //This counter seems wrong.  the processQueue_accountSeen is just detecting where we
              //   // called processQueue_markAccountsSeen before
              //   nestedCountersInstance.countEvent(`processing`, `awaiting data. stuck in line - but not really`)
              //   continue
              // }

              //TODO check for receipt and move to repair state / await final data

              if(this.config.stateManager.awaitingDataCanBailOnReceipt){
                const receipt = this.stateManager.getReceipt2(queueEntry)
                if(receipt != null){
                  //we saw a receipt so we can move to await final data
                  nestedCountersInstance.countEvent('processing', 'awaitingDataCanBailOnReceipt: activated.  tx state changed from awaiting data to await final data')
                  this.updateTxState(queueEntry, 'await final data', 'receipt while waiting for initial data')
                  continue
                }
              }


              if(this.config.stateManager.requestAwaitedDataAllowed){
                // Before we turn this back on we must set the correct conditions.
                // our node may be unaware of how other nodes have upstream blocking TXs that
                // prevent them from sharing data.  The only safe way to know if we can ask for data
                // is to know another node has voted but this has some issues as well

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
                    this.updateTxState(queueEntry, 'consensing')
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

                  if (configContext.stateManager.forceVoteForFailedPreApply || (txResult && txResult.applied === true)) {
                    this.updateTxState(queueEntry, 'consensing')

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

                      this.updateTxState(queueEntry, 'commiting')

                      queueEntry.hasValidFinalData = true
                      // TODO Global receipts?  do we want them?
                      // if(queueEntry.globalModification === false){
                      //   //Send a special receipt because this is a set command.
                      // }
                    } else {
                      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_preApplyTx_createAndShareVote', `${shortID}`, ``)
                      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 calling createAndShareVote : ${queueEntry.logID} `)
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

                    // if apply failed, we need to go to consensing to get a receipt
                    this.updateTxState(queueEntry, 'consensing')
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
                nestedCountersInstance.countEvent('processing', 'has all, but busy')
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

              if (this.usePOQo) {
                // Try to produce receipt
                // If receipt made, tellx128 it to execution group
                // that endpoint should then factTellCorrespondingNodesFinalData
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
                    confirmOrChallenge: [receipt2.confirmOrChallenge],
                    txid: receipt2.txid,
                    app_data_hash: receipt2.app_data_hash,
                  }
                } else {
                  result = await this.stateManager.transactionConsensus.tryProduceReceipt(queueEntry)
                }
              }
              else if (this.useNewPOQ) {
                this.stateManager.transactionConsensus.confirmOrChallenge(queueEntry)

                if (queueEntry.pendingConfirmOrChallenge.size > 0 && queueEntry.robustQueryVoteCompleted === true && queueEntry.acceptVoteMessage === false) {
                  this.mainLogger.debug(`processAcceptedTxQueue2 consensing : ${queueEntry.logID} pendingConfirmOrChallenge.size = ${queueEntry.pendingConfirmOrChallenge.size}`)
                  for (const [nodeId, confirmOrChallenge] of queueEntry.pendingConfirmOrChallenge) {
                    const appendSuccessful = this.stateManager.transactionConsensus.tryAppendMessage(queueEntry, confirmOrChallenge)
                    if (appendSuccessful) {
                      // we need forward the message to other nodes if append is successful
                      const payload  = confirmOrChallenge
                      const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
                      Comms.sendGossip('spread_confirmOrChallenge', payload, '', null, gossipGroup, false, 10, queueEntry.acceptedTx.txId)
                      queueEntry.gossipedConfirmOrChallenge = true
                    }
                  }
                  queueEntry.pendingConfirmOrChallenge = new Map()
                  this.mainLogger.debug(`processAcceptedTxQueue2 consensing : ${queueEntry.logID} reset pendingConfirmOrChallenge.size = ${queueEntry.pendingConfirmOrChallenge.size}`)
                }

                // try to produce a receipt
                /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 consensing : ${queueEntry.logID} receiptRcv:${hasReceivedApplyReceipt}`)

                const receipt2 = queueEntry.recievedAppliedReceipt2 ?? queueEntry.appliedReceipt2
                if (receipt2 != null) {
                  nestedCountersInstance.countEvent(`consensus`, 'tryProduceReceipt receipt2 != null')
                  //we have a receipt2, so we can make a receipt
                  result = {
                    result: receipt2.result,
                    appliedVotes: [receipt2.appliedVote], // everything is the same but the applied vote is an array
                    confirmOrChallenge: [receipt2.confirmOrChallenge],
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
                    confirmOrChallenge: [receipt2.confirmOrChallenge],
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
              if (this.stateManager.getReceipt2(queueEntry) != null) {
                const receipt2 = this.stateManager.getReceipt2(queueEntry)
                //TODO share receipt with corresponding index

                if (logFlags.debug || this.stateManager.consensusLog) {
                  this.mainLogger.debug(
                    `processAcceptedTxQueue2 tryProduceReceipt final result : ${
                      queueEntry.logID
                    } ${utils.stringifyReduce(result)}`
                  )
                }

                const isReceiptMatchPreApply =
                  this.stateManager.transactionConsensus.hasAppliedReceiptMatchingPreApply(queueEntry, result)
                if (logFlags.debug || this.stateManager.consensusLog) {
                  this.mainLogger.debug(
                    `processAcceptedTxQueue2 tryProduceReceipt isReceiptMatchPreApply : ${queueEntry.logID} ${isReceiptMatchPreApply}`
                  )
                }

                // we should send the receipt if we are in the top 5 nodes
                const isConfirmedReceipt = receipt2.confirmOrChallenge?.message === 'confirm'
                const isChallengedReceipt = receipt2.confirmOrChallenge?.message === 'challenge'
                let shouldSendReceipt = false
                if (queueEntry.isInExecutionHome) {
                  if (this.usePOQo) {
                    // Already handled above
                    shouldSendReceipt = false
                  }
                  else if (this.useNewPOQ) {
                    let numberOfSharingNodes = configContext.stateManager.nodesToGossipAppliedReceipt
                    if (numberOfSharingNodes > queueEntry.executionGroup.length) numberOfSharingNodes = queueEntry.executionGroup.length
                    const highestRankedNodeIds = queueEntry.executionGroup.slice(0, numberOfSharingNodes).map(n => n.id)
                    if (highestRankedNodeIds.includes(Self.id)) {
                      if (isChallengedReceipt) shouldSendReceipt = true
                      else if (isConfirmedReceipt && isReceiptMatchPreApply) shouldSendReceipt = true
                    }
                  } else {
                    shouldSendReceipt = true
                  }

                  if (shouldSendReceipt) {
                    // Broadcast the receipt, only if we made one (try produce can early out if we received one)
                    const awaitStart = shardusGetTime()
                    /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.shareAppliedReceipt()' )
                    this.stateManager.transactionConsensus.shareAppliedReceipt(queueEntry)
                    /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.shareAppliedReceipt()', DebugComplete.Completed )

                    this.updateSimpleStatsObject(
                      processStats.awaitStats,
                      'shareAppliedReceipt',
                      shardusGetTime() - awaitStart
                    )
                  }
                }

                // remove from the queue if receipt2 is a challenged receipt
                if (isChallengedReceipt && this.useNewPOQ) {
                  const txId = queueEntry.acceptedTx.txId
                  const logID = queueEntry.logID
                  this.updateTxState(queueEntry, 'fail')
                  this.removeFromQueue(queueEntry, currentIndex, true) // we don't want to archive this
                  nestedCountersInstance.countEvent('consensus', 'isChallengedReceipt: true removing from queue')
                  this.mainLogger.debug(`processAcceptedTxQueue2 tryProduceReceipt isChallengedReceipt : ${logID}. remove from queue`)
                  continue
                }

                // not a challenge receipt but check the tx result
                if (isReceiptMatchPreApply && queueEntry.isInExecutionHome) {
                  nestedCountersInstance.countEvent('consensus', 'hasAppliedReceiptMatchingPreApply: true')
                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_madeReceipt', `${shortID}`, `qId: ${queueEntry.entryID}  `)

                  //todo check cant_apply flag to make sure a vote can form with it!
                  //also check if failed votes will work...?
                  if (
                    this.stateManager.getReceiptVote(queueEntry).cant_apply === false &&
                    this.stateManager.getReceiptResult(queueEntry) === true &&
                    this.stateManager.getReceiptConfirmation(queueEntry) === true
                  ) {
                    this.updateTxState(queueEntry, 'commiting')
                    queueEntry.hasValidFinalData = true
                    finishedConsensing = true
                  } else {
                    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_finishedFailReceipt1', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                    // we are finished since there is nothing to apply
                    if (logFlags.debug || this.stateManager.consensusLog) {
                      /* prettier-ignore */ this.mainLogger.debug(`processAcceptedTxQueue2 tryProduceReceipt failed result: false : ${queueEntry.logID} ${utils.stringifyReduce(result)}`)
                      /* prettier-ignore */ this.statemanager_fatal(`processAcceptedTxQueue2`, `tryProduceReceipt failed result: false : ${queueEntry.logID} ${utils.stringifyReduce(result)}`)
                    }
                    nestedCountersInstance.countEvent('consensus', 'tryProduceReceipt failed result = false or' +
                      ' challenged')
                    this.updateTxState(queueEntry, 'fail')
                    this.removeFromQueue(queueEntry, currentIndex)
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
                    if (configContext.stateManager.attachDataToReceipt === false) {
                      if (configContext.p2p.useFactCorrespondingTell) {
                        this.factTellCorrespondingNodesFinalData(queueEntry)
                      } else {
                        this.tellCorrespondingNodesFinalData(queueEntry)
                      }
                    }
                    this.updateSimpleStatsObject(
                      processStats.awaitStats,
                      'tellCorrespondingNodesFinalData',
                      shardusGetTime() - awaitStart
                    )
                  }
                  //continue
                } else {
                  nestedCountersInstance.countEvent(
                    'consensus',
                    `hasAppliedReceiptMatchingPreApply: false, isInExecutionHome: ${queueEntry.isInExecutionHome}`
                  )
                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_gotReceiptNoMatch1', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                  if (this.stateManager.getReceiptResult(queueEntry) === false) {
                    // We got a reciept, but the consensus is that this TX was not applied.
                    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_finishedFailReceipt2', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                    // we are finished since there is nothing to apply
                    this.statemanager_fatal(
                      `consensing: on a failed receipt`,
                      `consensing: got a failed receipt for ` +
                        `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`
                    )
                    if (logFlags.debug || this.stateManager.consensusLog) {
                      /* prettier-ignore */ this.mainLogger.debug(`processAcceptedTxQueue2 tryProduceReceipt failed result: false : ${queueEntry.logID} ${utils.stringifyReduce(result)}`)
                      /* prettier-ignore */ this.statemanager_fatal(`processAcceptedTxQueue2`, `tryProduceReceipt failed result: false : ${queueEntry.logID} ${utils.stringifyReduce(result)}`)
                    }
                    nestedCountersInstance.countEvent('consensus', 'consensed on failed result')
                    this.updateTxState(queueEntry, 'fail')
                    this.removeFromQueue(queueEntry, currentIndex)
                    continue
                  }
                  didNotMatchReceipt = true
                  queueEntry.appliedReceiptForRepair = result

                  queueEntry.appliedReceiptForRepair2 = this.stateManager.getReceipt2(queueEntry)
                  if (queueEntry.isInExecutionHome === false && queueEntry.appliedReceipt2 != null) {
                    if (this.stateManager.consensusLog)
                      this.mainLogger.debug(
                        `processTransactions ${queueEntry.logID} we are not execution home, but we have a receipt2, go to await final data`
                      )
                    this.updateTxState(queueEntry, 'await final data', 'processTx7')
                  }
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
                      this.updateTxState(queueEntry, 'commiting')
                      queueEntry.hasValidFinalData = true
                      finishedConsensing = true
                    } else {
                      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_consensingComplete_finishedFailReceipt2', `${shortID}`, `qId: ${queueEntry.entryID}  `)
                      // we are finished since there is nothing to apply
                      //this.statemanager_fatal(`consensing: repairToMatchReceipt failed`, `consensing: repairToMatchReceipt failed ` + `txid: ${shortID} state: ${queueEntry.state} applyReceipt:${hasApplyReceipt} recievedAppliedReceipt:${hasReceivedApplyReceipt} age:${txAge}`)
                      this.removeFromQueue(queueEntry, currentIndex)
                      this.updateTxState(queueEntry, 'fail')
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
                if (didNotMatchReceipt === true && queueEntry.isInExecutionHome) {
                  nestedCountersInstance.countEvent('stateManager', 'didNotMatchReceipt')
                  if (queueEntry.debugFail_failNoRepair) {
                    this.updateTxState(queueEntry, 'fail')
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
                    if (configContext.stateManager.noRepairIfDataAttached && configContext.stateManager.attachDataToReceipt) {
                      // we have received the final data, so we can just go to "await final data" and commit the accounts
                      this.updateTxState(queueEntry, 'await final data')
                    } else {
                      this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
                      this.updateTxState(queueEntry, 'await repair')
                    }
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
                    this.updateTxState(queueEntry, 'fail')
                    continue
                  }
                }
              }
            } else {
              nestedCountersInstance.countEvent('consensus', 'busy waiting')
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
                this.updateTxState(queueEntry, 'pass')
              } else {
                // technically should never get here, because we dont need to repair to a receipt when the network did not apply the TX
                this.updateTxState(queueEntry, 'fail')
              }
              // most remove from queue at the end because it compacts the queue entry
              this.removeFromQueue(queueEntry, currentIndex)

              // console.log('Await Repair Finished', queueEntry.acceptedTx.txId, queueEntry)

              nestedCountersInstance.countEvent('stateManager', 'repairFinished')
              continue
            } else if (queueEntry.repairFailed === true) {
              // if the repair failed, we need to fail the TX. Let the patcher take care of it.
              this.updateTxState(queueEntry, 'fail')
              this.removeFromQueue(queueEntry, currentIndex)
              nestedCountersInstance.countEvent('stateManager', 'repairFailed')
              continue
            }
          }
          if (queueEntry.state === 'await final data') {
            //wait patiently for data to match receipt
            //if we run out of time repair to receipt?

            if (this.processQueue_accountSeen(seenAccounts, queueEntry) === false) {
              this.processQueue_markAccountsSeen(seenAccounts, queueEntry)

              // //temp hack ... hopefully this hack can go away
              // if (queueEntry.recievedAppliedReceipt == null || queueEntry.recievedAppliedReceipt2 == null) {
              //   const result = await this.stateManager.transactionConsensus.tryProduceReceipt(queueEntry)
              //   if (result != null) {
              //     queueEntry.recievedAppliedReceipt = result
              //     /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitFinalData_hackReceipt', `${shortID}`, `qId: ${queueEntry.entryID} result:${utils.stringifyReduce(result)}`)
              //   }
              // }

              // remove from queue if we have commited data for this tx
              if (configContext.stateManager.attachDataToReceipt && queueEntry.accountDataSet === true) {
                if (logFlags.debug) this.mainLogger.debug(`shrd_awaitFinalData_removeFromQueue : ${queueEntry.logID} because accountDataSet is true`)
                this.removeFromQueue(queueEntry, currentIndex)
                //this will possibly skip critical stats or exit steps that invoke a transaction applied event to the dapp
                continue
              }

              //collectedFinalData
              //PURPL-74 todo: get the vote from queueEntry.receivedBestVote or receivedBestConfirmation instead of receipt2
              const receipt2 = this.stateManager.getReceipt2(queueEntry)
              const timeSinceAwaitFinalStart = queueEntry.txDebug.startTimestamp['await final data'] > 0 ? shardusGetTime() - queueEntry.txDebug.startTimestamp['await final data'] : 0
              let vote: AppliedVote

              // if(configContext.stateManager.removeStuckChallengedTXs && this.useNewPOQ) {
              //   // first check if this is a challenge receipt
              //   if (receipt2 && receipt2.confirmOrChallenge.message === 'challenge') {
              //     if (logFlags.debug) this.mainLogger.debug(`shrd_awaitFinalData_challenge : ${queueEntry.logID} challenge from receipt2`)
              //     this.updateTxState(queueEntry, 'fail')
              //     this.removeFromQueue(queueEntry, currentIndex)
              //     continue
              //   } if (receipt2 == null && queueEntry.receivedBestChallenge) {
              //     const enoughUniqueChallenges = queueEntry.uniqueChallengesCount >= configContext.stateManager.minRequiredChallenges
              //     if (enoughUniqueChallenges) {
              //       if (logFlags.debug) this.mainLogger.debug(`shrd_awaitFinalData_challenge : ${queueEntry.logID} has unique challenges`)
              //       this.updateTxState(queueEntry, 'fail')
              //       this.removeFromQueue(queueEntry, currentIndex)
              //     } else if (timeSinceAwaitFinalStart > 1000 * 30) {
              //       // if we have a challenge and we have waited for a minute, we can fail the tx
              //       if (logFlags.debug) this.mainLogger.debug(`shrd_awaitFinalData_challenge : ${queueEntry.logID} not enough but waited long enough`)
              //       this.updateTxState(queueEntry, 'fail')
              //       this.removeFromQueue(queueEntry, currentIndex)
              //     } else {
              //       if (logFlags.debug) this.mainLogger.debug(`shrd_awaitFinalData_challenge : ${queueEntry.logID} not enough challenges but waited ${timeSinceAwaitFinalStart}ms`)
              //     }
              //     continue
              //   }
              // }

              // see if we can find a good vote to use
              if (receipt2) {
                vote = receipt2.appliedVote
              } else if (queueEntry.receivedBestConfirmation?.appliedVote) {
                // I think this is POQ-LS and will go away
                vote = queueEntry.receivedBestConfirmation.appliedVote
              } else if (queueEntry.receivedBestVote) {
                // I think this is POQ-LS and will go away
                vote = queueEntry.receivedBestVote
              } else if (queueEntry.ourVote && configContext.stateManager.stuckTxQueueFix) {
                // allow node to request missing data if it has an own vote
                // 20240709 this does not seem right.  We should not use our own vote to request missing data
                // going to add counters to confirm
                nestedCountersInstance.countEvent('stateManager', 'shrd_awaitFinalData used ourVote')
                vote = queueEntry.ourVote
              }
              const accountsNotStored = new Set()
              //if we got a vote above then build a list of accounts that we store but are missing in our
              //collectedFinalData
              if (vote) {
                let failed = false
                let incomplete = false
                let skipped = 0
                const missingAccounts = []
                const nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData =
                  this.stateManager.currentCycleShardData.nodeShardData

                /* eslint-disable security/detect-object-injection */
                for (let i = 0; i < vote.account_id.length; i++) {
                  const accountID = vote.account_id[i]
                  const accountHash = vote.account_state_hash_after[i]

                  //only check for stored keys.
                  if ( ShardFunctions.testAddressInRange(accountID, nodeShardData.storedPartitions) === false ) {
                    skipped++
                    accountsNotStored.add(accountID)
                    continue
                  }

                  const wrappedAccount = queueEntry.collectedFinalData[accountID]
                  if (wrappedAccount == null) {
                    incomplete = true
                    queueEntry.debug.waitingOn = accountID
                    missingAccounts.push(accountID)
                    // break
                  }
                  if (wrappedAccount && wrappedAccount.stateId != accountHash) {
                    if (logFlags.debug) this.mainLogger.debug( `shrd_awaitFinalData_failed : ${queueEntry.logID} wrappedAccount.stateId != accountHash from the vote` )
                    failed = true
                    //we should be verifying the tate IDS that are pushed into collectedFinal data so this should not happen.  if it does that could cause a stuck TX / local oos
                    nestedCountersInstance.countEvent('stateManager', `shrd_awaitFinalData failed state check wrappedAccount.stateId != accountHash`)
                    break
                  }
                }

                // if we have missing accounts, we need to request the data
                if (incomplete && missingAccounts.length > 0) {
                  nestedCountersInstance.countEvent('stateManager', `shrd_awaitFinalData missing accounts ${missingAccounts.length}`)

                  // start request process for missing data if we waited long enough
                  let shouldStartFinalDataRequest = false
                  if (timeSinceAwaitFinalStart > 5000) {
                    shouldStartFinalDataRequest = true
                    if (logFlags.verbose) /* prettier-ignore */ this.mainLogger.debug(`shrd_awaitFinalData_incomplete : ${queueEntry.logID} starting finalDataRequest timeSinceDataShare: ${timeSinceAwaitFinalStart}`)
                  } else if (txAge > timeM3) {
                    // by this time we should have all the data we need
                    shouldStartFinalDataRequest = true
                    if (logFlags.verbose) /* prettier-ignore */ this.mainLogger.debug(`shrd_awaitFinalData_incomplete : ${queueEntry.logID} starting finalDataRequest txAge > timeM3 + confirmationSeenExpirationTime`)
                  }

                  // start request process for missing data
                  const timeSinceLastFinalDataRequest = shardusGetTime() - queueEntry.lastFinalDataRequestTimestamp
                  if (this.config.stateManager.canRequestFinalData && shouldStartFinalDataRequest && timeSinceLastFinalDataRequest > 5000) {
                    nestedCountersInstance.countEvent('stateManager', 'requestFinalData')
                    this.requestFinalData(queueEntry, missingAccounts)
                    queueEntry.lastFinalDataRequestTimestamp = shardusGetTime()
                    continue
                  }
                } else {
                  nestedCountersInstance.countEvent('stateManager', 'shrd_awaitFinalData not missing accounts')
                }

                /* eslint-enable security/detect-object-injection */

                if (failed === true) {
                  nestedCountersInstance.countEvent('stateManager', 'shrd_awaitFinalData failed')
                  this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
                  this.updateTxState(queueEntry, 'await repair')
                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitFinalData_failed', `${shortID}`, `qId: ${queueEntry.entryID} skipped:${skipped}`)
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`shrd_awaitFinalData_failed : ${queueEntry.logID} `)
                  continue
                }

                // This is the case where awaiting final data has succeeded. Store the final data and remove TX from the queue
                if (failed === false && incomplete === false) {
                  //setting this for completeness, but the TX will be removed from the queue at the end of this section
                  queueEntry.hasValidFinalData = true

                  /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_awaitFinalData_passed', `${shortID}`, `qId: ${queueEntry.entryID} skipped:${skipped}`)
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`shrd_awaitFinalData_passed : ${queueEntry.logID} skipped:${skipped}`)

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

                  nestedCountersInstance.countEvent('stateManager', `shrd_awaitFinalData got data, time to save it ${accountRecords.length}`)
                  /* eslint-enable security/detect-object-injection */
                  //await this.app.setAccountData(rawAccounts)
                  const awaitStart = shardusGetTime()
                  /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.checkAndSetAccountData()' )
                  await this.stateManager.checkAndSetAccountData(
                    accountRecords,
                    `txId: ${queueEntry.logID} awaitFinalData_passed`,
                    false
                  )

                  /* prettier-ignore */ this.setDebugLastAwaitedCall( 'this.stateManager.transactionConsensus.checkAndSetAccountData()', DebugComplete.Completed )
                  queueEntry.accountDataSet = true
                  // endpoint to allow dapp to execute something that depends on a transaction being approved.
                  this.app.transactionReceiptPass(queueEntry.acceptedTx.data, queueEntry.collectedFinalData, queueEntry?.preApplyTXResult?.applyResponse, false)
                  /* prettier-ignore */ if (logFlags.verbose) console.log('transactionReceiptPass 1', queueEntry.acceptedTx.txId, queueEntry)
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
                    queueEntry.recievedAppliedReceipt2?.result === true ||
                    queueEntry.appliedReceipt2?.result === true
                  ) {
                    this.updateTxState(queueEntry, 'pass')
                  } else {
                    /* prettier-ignore */
                    if (logFlags.debug) this.mainLogger.error(`shrd_awaitFinalData_fail : ${queueEntry.logID} no receivedAppliedRecipt or recievedAppliedReceipt2. appliedReceipt2: ${utils.stringifyReduce(queueEntry.appliedReceipt2)}`);
                    this.updateTxState(queueEntry, 'fail')
                  }
                  this.removeFromQueue(queueEntry, currentIndex)
                }
              } else {
                nestedCountersInstance.countEvent('stateManager', 'shrd_awaitFinalData noVote')
                // todo: what to do if we have no vote? discuss with Omar
              }
            } else {
              const upstreamTx = this.processQueue_getUpstreamTx(seenAccounts, queueEntry)
              if (queueEntry.executionDebug == null) queueEntry.executionDebug = {}
              queueEntry.executionDebug.logFinalData = `has all final data, but busy. upstreamTx: ${upstreamTx?.logID}`
              if (upstreamTx == null) {
                queueEntry.executionDebug.logFinalData = `has all final data, but busy. upstreamTx: null`
                nestedCountersInstance.countEvent('stateManager', 'shrd_awaitFinalData busy. upstreamTx: null')
              } else {
                if (upstreamTx.acceptedTx.txId === queueEntry.acceptedTx.txId) {
                  nestedCountersInstance.countEvent('stateManager', 'shrd_awaitFinalData busy. upstreamTx same tx')
                } else {
                  nestedCountersInstance.countEvent('stateManager', `shrd_awaitFinalData busy. upstream tx state: ${upstreamTx?.state}`)
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
                this.updateTxState(queueEntry, 'fail')
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
                    if(configContext.stateManager.receiptRemoveFix){
                      hasReceiptFail = true
                    } else {
                      hasReceiptFail = false
                    }
                  }
                } else {
                  canCommitTX = false
                }

                nestedCountersInstance.countEvent(
                  'stateManager',
                  `canCommitTX: ${canCommitTX}, hasReceiptFail: ${hasReceiptFail}`
                )

                /* prettier-ignore */ if (logFlags.verbose) if (logFlags.debug) this.mainLogger.debug('shrd_commitingTx', `${shortID}`, `canCommitTX: ${canCommitTX}, hasReceiptFail: ${hasReceiptFail}`)
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
                if (logFlags.verbose)
                  console.log('commit commit', queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp)
                if (this.config.p2p.experimentalSnapshot) this.addReceiptToForward(queueEntry, 'commit')

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
                    this.updateTxState(queueEntry, 'pass')
                  } else {
                    this.updateTxState(queueEntry, 'fail')
                  }
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : noConsensus:${queueEntry.state} ${queueEntry.logID} `)
                } else if (queueEntry.appliedReceipt2 != null) {
                  // the final state of the queue entry will be pass or fail based on the receipt
                  if (queueEntry.appliedReceipt2.result === true) {
                    this.updateTxState(queueEntry, 'pass')
                  } else {
                    this.updateTxState(queueEntry, 'fail')
                  }
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : Recpt:${queueEntry.state} ${queueEntry.logID} `)
                } else if (queueEntry.recievedAppliedReceipt2 != null) {
                  // the final state of the queue entry will be pass or fail based on the receipt
                  if (queueEntry.recievedAppliedReceipt2.result === true) {
                    this.updateTxState(queueEntry, 'pass')
                  } else {
                    this.updateTxState(queueEntry, 'fail')
                  }
                  /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`processAcceptedTxQueue2 commiting finished : recvRecpt:${queueEntry.state} ${queueEntry.logID} `)
                } else {
                  this.updateTxState(queueEntry, 'fail')
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
          if (logFlags.profiling_verbose)
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
          } firstTime:${firstTime} stats:${Utils.safeStringify(processStats)}`
        )
        this.lastProcessStats['10+'] = processStats
      } else if (processTime > 5000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 5s')
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`processTime > 5s ${processTime / 1000} stats:${Utils.safeStringify(processStats)}`)
        this.lastProcessStats['5+'] = processStats
      } else if (processTime > 2000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 2s')
        /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`processTime > 2s ${processTime / 1000} stats:${Utils.safeStringify(processStats)}`)
        this.lastProcessStats['2+'] = processStats
      } else if (processTime > 1000) {
        nestedCountersInstance.countEvent('stateManager', 'processTime > 1s')
        /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`processTime > 1s ${processTime / 1000} stats:${Utils.safeStringify(processStats)}`)
        this.lastProcessStats['1+'] = processStats
      }

      // restart loop if there are still elements in it
      if (this._transactionQueue.length > 0 || this.pendingTransactionQueue.length > 0) {
        this.transactionQueueHasRemainingWork = true
        setTimeout(() => {
          this.stateManager.tryStartTransactionProcessingQueue()
        }, 15)
      } else {
        if (logFlags.seqdiagram) this.mainLogger.info(`0x10052024 ${ipInfo.externalIp} ${shardusGetTime()} 0x0000 processTransactions _transactionQueue.length 0`)
        this.transactionQueueHasRemainingWork = false
      }

      this.transactionProcessingQueueRunning = false
      this.processingLastRunTime = shardusGetTime()
      this.stateManager.lastSeenAccountsMap = seenAccounts

      this.profiler.profileSectionEnd('processQ')
    }
  }

  private setTXExpired(queueEntry: QueueEntry, currentIndex: number, message: string): void {
    /* prettier-ignore */ if (logFlags.verbose || this.stateManager.consensusLog) this.mainLogger.debug(`setTXExpired tx:${queueEntry.logID} ${message}  ts:${queueEntry.acceptedTx.timestamp} debug:${utils.stringifyReduce(queueEntry.debug)} state: ${queueEntry.state}, isInExecution: ${queueEntry.isInExecutionHome}`)
    this.updateTxState(queueEntry, 'expired')
    this.removeFromQueue(queueEntry, currentIndex)
    this.app.transactionReceiptFail(
      queueEntry.acceptedTx.data,
      queueEntry.collectedData,
      queueEntry.preApplyTXResult?.applyResponse
    )
    this.stateManager.eventEmitter.emit('txExpired', queueEntry.acceptedTx.txId)

    /* prettier-ignore */ nestedCountersInstance.countEvent( 'txExpired', `tx: ${this.app.getSimpleTxDebugValue(queueEntry.acceptedTx?.data)}` )

    //This is really important.  If we are going to expire a TX, then look to see if we already have a receipt for it.
    //If so, then just go into async receipt repair mode for the TX AFTER it has been expired and removed from the queue
    if (queueEntry.appliedReceiptFinal2 != null) {
      const startRepair = queueEntry.repairStarted === false
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`setTXExpired. ${queueEntry.logID} start repair:${startRepair}. update `)
      if (startRepair) {
        nestedCountersInstance.countEvent('repair1', 'setTXExpired: start repair')
        queueEntry.appliedReceiptForRepair2 = queueEntry.appliedReceiptFinal2
        //todo any limits to how many repairs at once to allow?
        this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
      }
    } else {
      nestedCountersInstance.countEvent('repair1', 'setTXExpired: no receipt to repair')
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`setTXExpired. no receipt to repair ${queueEntry.logID}`)
    }
  }
  private setTxAlmostExpired(queueEntry: QueueEntry, currentIndex: number, message: string): void {
    /* prettier-ignore */ if (logFlags.verbose || this.stateManager.consensusLog) this.mainLogger.debug(`setTxAlmostExpired tx:${queueEntry.logID} ${message}  ts:${queueEntry.acceptedTx.timestamp} debug:${utils.stringifyReduce(queueEntry.debug)}`)
    // this.updateTxState(queueEntry, 'almostExpired')
    queueEntry.almostExpired = true

    /* prettier-ignore */ nestedCountersInstance.countEvent( 'txAlmostExpired', `tx: ${this.app.getSimpleTxDebugValue(queueEntry.acceptedTx?.data)}` )
  }

  getArchiverReceiptFromQueueEntry(queueEntry: QueueEntry): ArchiverReceipt | null {
    if (!queueEntry.preApplyTXResult || !queueEntry.preApplyTXResult.applyResponse)
      return null as ArchiverReceipt

    const accountsToAdd: { [accountId: string]: Shardus.AccountsCopy } = {}
    const beforeAccountsToAdd: { [accountId: string]: Shardus.AccountsCopy } = {}

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
            hash: account.stateId,
            timestamp: account.timestamp,
            isGlobal,
          } as Shardus.AccountsCopy
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
        const accountCopy = {
          accountId: account.accountId,
          data: account.data.data,
          timestamp: account.timestamp,
          hash: account.data.stateId,
          isGlobal,
        } as Shardus.AccountsCopy
        accountsToAdd[account.accountId] = accountCopy
      }
    }

    const receipt2 = this.stateManager.getReceipt2(queueEntry)
    const appliedReceipt = receipt2 ? Utils.safeJsonParse(Utils.safeStringify(receipt2)) : ({} as AppliedReceipt2)
    if (this.useNewPOQ === false) {
      if (appliedReceipt.appliedVote) {
        delete appliedReceipt.appliedVote.node_id
        delete appliedReceipt.appliedVote.sign
        delete appliedReceipt.confirmOrChallenge
        // Update the app_data_hash with the app_data_hash from the appliedVote
        appliedReceipt.app_data_hash = appliedReceipt.appliedVote.app_data_hash
      }
    }

    const archiverReceipt: ArchiverReceipt = {
      tx: {
        originalTxData: queueEntry.acceptedTx.data,
        txId: queueEntry.acceptedTx.txId,
        timestamp: queueEntry.acceptedTx.timestamp,
      },
      cycle: queueEntry.txGroupCycle, // Updated to use txGroupCycle instead of cycleToRecordOn because when the receipt is arrived at the archiver, the cycleToRecordOn cycle might not exist yet.
      beforeStateAccounts: [...Object.values(beforeAccountsToAdd)],
      accounts: [...Object.values(accountsToAdd)],
      appReceiptData: queueEntry.preApplyTXResult.applyResponse.appReceiptData || null,
      appliedReceipt,
      executionShardKey: queueEntry.executionShardKey || '',
      globalModification: queueEntry.globalModification,
    }
    return archiverReceipt
  }

  addOriginalTxDataToForward(queueEntry: QueueEntry): void {
    if (logFlags.verbose)
      console.log('originalTxData', queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp)
    const { acceptedTx } = queueEntry
    const originalTxData = {
      txId: acceptedTx.txId,
      originalTxData: acceptedTx.data,
      cycle: queueEntry.cycleToRecordOn,
      timestamp: acceptedTx.timestamp,
    }
    // const signedOriginalTxData: any = this.crypto.sign(originalTxData) // maybe we don't need to send by signing it
    Archivers.instantForwardOriginalTxData(originalTxData)
  }

  addReceiptToForward(queueEntry: QueueEntry, debugString = ''): void {
    if (logFlags.verbose)
      console.log(
        'addReceiptToForward',
        queueEntry.acceptedTx.txId,
        queueEntry.acceptedTx.timestamp,
        debugString
      )
    const archiverReceipt = this.getArchiverReceiptFromQueueEntry(queueEntry)
    Archivers.instantForwardReceipts([archiverReceipt])
    this.receiptsForwardedTimestamp = shardusGetTime()
    this.forwardedReceiptsByTimestamp.set(this.receiptsForwardedTimestamp, archiverReceipt)
    // this.receiptsToForward.push(archiverReceipt)
  }

  getReceiptsToForward(): ArchiverReceipt[] {
    return [...this.forwardedReceiptsByTimestamp.values()]
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async requestFinalData(queueEntry: QueueEntry, accountIds: string[], nodesToAskKeys: string[] | null = null) {
    profilerInstance.profileSectionStart('requestFinalData')
    this.mainLogger.debug(`requestFinalData: txid: ${queueEntry.logID} accountIds: ${utils.stringifyReduce(accountIds)}`);
    const message = { txid: queueEntry.acceptedTx.txId, accountIds }
    let success = false
    let successCount = 0

    // first check if we have received final data
    for (const accountId of accountIds) {
      // eslint-disable-next-line security/detect-object-injection
      if (queueEntry.collectedFinalData[accountId] != null) {
        successCount++
      }
    }
    if (successCount === accountIds.length) {
      nestedCountersInstance.countEvent('stateManager', 'requestFinalDataAlreadyReceived')
      this.mainLogger.debug(`requestFinalData: txid: ${queueEntry.logID} already received all data`)
      // no need to request data
      return
    }

    try {
      let nodeToAsk: Shardus.Node
      if (nodesToAskKeys && nodesToAskKeys.length > 0) {
        const randomIndex = Math.floor(Math.random() * nodesToAskKeys.length)
        // eslint-disable-next-line security/detect-object-injection
        const randomNodeToAskKey = nodesToAskKeys[randomIndex]
        nodeToAsk = byPubKey.get(randomNodeToAskKey)
      } else {
        const randomIndex = Math.floor(Math.random() * queueEntry.executionGroup.length)
        // eslint-disable-next-line security/detect-object-injection
        const randomExeNode = queueEntry.executionGroup[randomIndex]
        nodeToAsk = nodes.get(randomExeNode.id)
      }

      if (!nodeToAsk) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error('requestFinalData: could not find node from execution group')
        throw new Error('requestFinalData: could not find node from execution group')
      }

      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug( `requestFinalData: txid: ${queueEntry.acceptedTx.txId} accountIds: ${utils.stringifyReduce( accountIds )}, asking node: ${nodeToAsk.id} ${nodeToAsk.externalPort} at timestamp ${shardusGetTime()}` )

      let response
      // if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.requestTxAndStateBinary) {
        const requestMessage = message as RequestTxAndStateReq
        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455101 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(nodeToAsk.id)}: ${'request_tx_and_state'}`)
        response = await Comms.askBinary<RequestTxAndStateReq, RequestTxAndStateResp>(
          nodeToAsk,
          InternalRouteEnum.binary_request_tx_and_state,
          requestMessage,
          serializeRequestTxAndStateReq,
          deserializeRequestTxAndStateResp,
          {}
        )
      // } else response = await Comms.ask(nodeToAsk, 'request_tx_and_state', message)

      if (response && response.stateList && response.stateList.length > 0) {
        this.mainLogger.debug(`requestFinalData: txid: ${queueEntry.logID} received data for ${response.stateList.length} accounts`)
      } else {
        this.mainLogger.error(`requestFinalData: txid: ${queueEntry.logID} response is null`)
        nestedCountersInstance.countEvent('stateManager', 'requestFinalData: failed: response or response.stateList null or statelist length 0')
        return
      }

      for (const data of response.stateList) {
        if (data == null) {
          /* prettier-ignore */
          if (logFlags.error && logFlags.debug) this.mainLogger.error(`requestFinalData data == null for tx ${queueEntry.logID}`);
          success = false
          break
        }
        if (queueEntry.collectedFinalData[data.accountId] == null) {
          // todo: check the state hashes and verify
          queueEntry.collectedFinalData[data.accountId] = data
          successCount++
          /* prettier-ignore */
          if (logFlags.debug) this.mainLogger.debug(`requestFinalData: txid: ${queueEntry.logID} success accountId: ${data.accountId} stateId: ${data.stateId}`);
        }
      }
      if (successCount === accountIds.length) {
        nestedCountersInstance.countEvent('stateManager', 'requestFinalData: got all needed data')
        success = true
        
        //setting this for completeness. if our node is awaiting final data it will utilize what was looked up here
        queueEntry.hasValidFinalData = true
      } else {
        nestedCountersInstance.countEvent('stateManager', `requestFinalData: failed: did not get enough data: ${successCount} <  ${accountIds.length}`)
      }
    } catch (e) {
      nestedCountersInstance.countEvent('stateManager', 'requestFinalData: failed: Error')
      this.mainLogger.error(`requestFinalData: txid: ${queueEntry.logID} error: ${e.message}`)
    } finally {
      if (success === false) {
        nestedCountersInstance.countEvent('stateManager', 'requestFinalData: failed: success === false')
        /* prettier-ignore */ this.mainLogger.error(`requestFinalData: txid: ${queueEntry.logID} failed. successCount: ${successCount} accountIds: ${accountIds.length}`);
      }
    }
    profilerInstance.profileSectionEnd('requestFinalData')
  }

  resetReceiptsToForward(): void {
    const MAX_RECEIPT_AGE_MS = 25000 // 25s
    const now = shardusGetTime()
    // Clear receipts that are older than MAX_RECEIPT_AGE_MS
    for (const [key] of this.forwardedReceiptsByTimestamp) {
      if (now - key > MAX_RECEIPT_AGE_MS) {
        this.forwardedReceiptsByTimestamp.delete(key)
      }
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

  processQueue_getUpstreamTx(seenAccounts: SeenAccounts, queueEntry: QueueEntry): QueueEntry | null {
    if (this.config.debug.useShardusMemoryPatterns && queueEntry.shardusMemoryPatternSets != null) {
      return null
    }
    if (queueEntry.uniqueKeys == null) {
      //TSConversion double check if this needs extra logging
      return null
    }
    for (const key of queueEntry.uniqueKeys) {
      // eslint-disable-next-line security/detect-object-injection
      if (seenAccounts[key] != null) {
        return seenAccounts[key]
      }
    }
    return null
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
          // nestedCountersInstance.countEvent('stateManager', 'shrd_accountSeen rw queue_write')
          // nestedCountersInstance.countEvent('stateManager', `shrd_accountSeen rw queue_write ${id}`)
          return true
        }
        if (this.queueReadWritesOld.has(id)) {
          // nestedCountersInstance.countEvent('stateManager', 'shrd_accountSeen rw old queue_write')
          // nestedCountersInstance.countEvent('stateManager', `shrd_accountSeen rw old queue_write ${id}`)
          return true
        }
        //also blocked by upstream reads
        if (this.queueReads.has(id)) {
          // nestedCountersInstance.countEvent('stateManager', 'shrd_accountSeen rw queue_read')
          // nestedCountersInstance.countEvent('stateManager', `shrd_accountSeen rw queue_read ${id}`)
          return true
        }
      }
      // in theory write only is not blocked by upstream writes
      // but has to wait its turn if there is an uptream read
      for (const id of queueEntry.shardusMemoryPatternSets.wo) {
        //also blocked by upstream reads
        if (this.queueReads.has(id)) {
          // nestedCountersInstance.countEvent('stateManager', 'shrd_accountSeen wo queue_read')
          // nestedCountersInstance.countEvent('stateManager', `shrd_accountSeen wo queue_read ${id}`)
          return true
        }
        if (this.queueReadWritesOld.has(id)) {
          // nestedCountersInstance.countEvent('stateManager', 'shrd_accountSeen wo queue_read_write_old')
          // nestedCountersInstance.countEvent('stateManager', `shrd_accountSeen wo queue_read_write_old ${id}`)
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
          nestedCountersInstance.countEvent('stateManager', 'shrd_accountSeen ro queue_write')
          return true
        }
        if (this.queueReadWritesOld.has(id)) {
          nestedCountersInstance.countEvent('stateManager', 'shrd_accountSeen ro queue_read_write_old')
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
      if (seenAccounts[key] != null && seenAccounts[key].logID === queueEntry.logID) {
        if (logFlags.verbose) this.mainLogger.debug(`${new Date()}}clearing key ${key} for tx ${queueEntry.logID}`);
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
   * Not longer used. candidate for deprecation, but this may be useful in some logging/analysis later
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

    let maxRetry = 5
    let potentialNode: Shardus.Node
    let invalidNode: boolean
    do {
      potentialNode = filteredConsensusGroup[Math.floor(Math.random() * filteredConsensusGroup.length)]
      invalidNode = isNodeInRotationBounds(potentialNode.id)
      maxRetry--
    } while (invalidNode && maxRetry > 0)

    return potentialNode
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
        /* prettier-ignore */ if (logFlags.verbose) console.log( 'getAccountQueueCount: found upstream tx in the injested queue:', `appData: ${Utils.safeStringify(tx.appData)}` )
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
        /* prettier-ignore */ if (logFlags.verbose) console.log( 'getAccountQueueCount: found upstream tx in the newAccepted queue:', `appData: ${Utils.safeStringify(tx.appData)}` )
        count++
      }
    }
    /* prettier-ignore */ if (logFlags.verbose) console.log(`getAccountQueueCount: remote:${remote} ${count} acc:${utils.stringifyReduce(accountID)}`)
    return { count, committingAppData }
  }

  isAccountInQueue(accountID: string, remote = false): boolean {
    for (const queueEntry of this.pendingTransactionQueue) {
      if (queueEntry.uniqueKeys.includes(accountID)) {
        const memoryPatterns = queueEntry.acceptedTx.shardusMemoryPatterns
        if (queueEntry.txKeys.sourceKeys.length > 0 && accountID === queueEntry.txKeys.sourceKeys[0]) {
          /* prettier-ignore */ if (logFlags.verbose) console.log( 'isAccountInQueue: found upstream tx in the' +
            ' injested' +
            ' queue:' )
          nestedCountersInstance.countEvent('stateManager', `isAccountInQueue of injested`)
          return true
        }
        const rw = memoryPatterns?.rw
        const wo = memoryPatterns?.wo
        if (rw && rw.includes(accountID) || wo && wo.includes(accountID)) {
          /* prettier-ignore */ if (logFlags.verbose) console.log( 'isAccountInQueue: found upstream tx in the' +
            ' injested' +
            ' queue:' )
          nestedCountersInstance.countEvent('stateManager', `isAccountInQueue rw or wo of injested`)
          return true
        }
      }
    }
    for (const queueEntry of this._transactionQueue) {
      if (queueEntry.uniqueKeys.includes(accountID)) {
        const memoryPatterns = queueEntry.acceptedTx.shardusMemoryPatterns
        if (queueEntry.txKeys.sourceKeys.length > 0 && accountID === queueEntry.txKeys.sourceKeys[0]) {
          /* prettier-ignore */ if (logFlags.verbose) console.log( 'isAccountInQueue: found upstream tx in the' +
            ' newAccepted' +
            ' queue:' )
          nestedCountersInstance.countEvent('stateManager', `isAccountInQueue of newAccepted`)
          return true
        }
        const rw = memoryPatterns?.rw
        const wo = memoryPatterns?.wo
        if (rw && rw.includes(accountID) || wo && wo.includes(accountID)) {
          /* prettier-ignore */ if (logFlags.verbose) console.log( 'isAccountInQueue: found upstream tx in the' +
            ' newAccepted' +
            ' queue:' )
          nestedCountersInstance.countEvent('stateManager', `isAccountInQueue rw or wo of newAccepted`)
          return true
        }
      }
    }
    /* prettier-ignore */ if (logFlags.verbose) console.log(`isAccountInQueue: false`)
    return false
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
        `onProcesssingQueueStuck: ${Utils.safeStringify(this.getDebugProccessingStatus())}`
      )
    }

    //clear this map as it would be stale now
    this.stateManager.lastSeenAccountsMap = null

    //in the future we could tell the node to go apop?
    if (this.config.stateManager.apopFromStuckProcessing === true) {
      Apoptosis.apoptosizeSelf('Apoptosized due to stuck processing')
    }
  }

getDebugStuckTxs(opts): unknown {
  const txStates = [
    'syncing',
    'aging',
    'processing',
    'awaiting data',
    'consensing',
    'await repair',
    'await final data',
    'committing',
    'canceled',
  ]

  const stateIndex = txStates.indexOf(opts.state);
  if (stateIndex === -1) {
    return `${opts.state} is not a valid tx state.`;
  }

  const queueItems = this.getQueueItems();
  const stuckTxs = queueItems.filter((queueEntry) => {
    const queueStateIndex = txStates.indexOf(queueEntry.state);
    return (
      queueEntry.txAge > opts.minAge &&
      queueEntry.state &&
      (opts.nextStates ? queueStateIndex >= stateIndex : queueStateIndex === stateIndex)
    );
  });

  return stuckTxs;
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
  clearQueueItems(minAge: number): number {
    let count = 0
    try {
      const currentTime = shardusGetTime()
      for(let i = this._transactionQueue.length-1; i>=0; i--){
        const queueEntry = this._transactionQueue[i]
        const txAge = currentTime - queueEntry.acceptedTx.timestamp
        if (txAge > minAge) {
          this.removeFromQueue(queueEntry, i)
          count++
        }
      }
    } catch (e) {
      console.error('clearQueueItems error:', e)
    }
    return count
  }
  getQueueItems(): any[] {
    return this._transactionQueue.map((queueEntry) => {
      return this.getDebugQueueInfo(queueEntry)
    })
  }
  getQueueItemById(txId: string): any {
    if (this._transactionQueueByID.has(txId)) return this.getDebugQueueInfo(this._transactionQueueByID.get(txId))
    if (this.archivedQueueEntriesByID.has(txId)) return this.getDebugQueueInfo(this.archivedQueueEntriesByID.get(txId))
    return null
  }
  getDebugQueueInfo(queueEntry: QueueEntry): any {
    return {
      txId: queueEntry.acceptedTx.txId,
      tx: queueEntry.acceptedTx,
      logID: queueEntry.logID,
      nodeId: Self.id,
      state: queueEntry.state,
      hasAll: queueEntry.hasAll,
      hasShardInfo: queueEntry.hasShardInfo,
      isExecutionNode: queueEntry.isInExecutionHome,
      globalModification: queueEntry.globalModification,
      entryID: queueEntry.entryID,
      txGroupCyle: queueEntry.txGroupCycle,
      uniqueKeys: queueEntry.uniqueKeys,
      collectedData: queueEntry.collectedData,
      finalData: queueEntry.collectedFinalData,
      preApplyResult: queueEntry.preApplyTXResult,
      txAge: shardusGetTime() - queueEntry.acceptedTx.timestamp,
      lastFinalDataRequestTimestamp: queueEntry.lastFinalDataRequestTimestamp,
      dataSharedTimestamp: queueEntry.dataSharedTimestamp,
      firstVoteTimestamp: queueEntry.firstVoteReceivedTimestamp,
      lastVoteTimestamp: queueEntry.lastVoteReceivedTimestamp,
      // firstConfirmationsTimestamp: queueEntry.firstConfirmOrChallengeTimestamp,
      // robustBestConfirmation: queueEntry.receivedBestConfirmation,
      // robustBestVote: queueEntry.receivedBestVote,
      // robustBestChallenge: queueEntry.receivedBestChallenge,
      // completedRobustVote: queueEntry.robustQueryVoteCompleted,
      // completedRobustChallenge: queueEntry.robustQueryConfirmOrChallengeCompleted,
      txDebug: queueEntry.txDebug,
      executionDebug: queueEntry.executionDebug,
      waitForReceiptOnly: queueEntry.waitForReceiptOnly,
      ourVote: queueEntry.ourVote || null,
      receipt2: this.stateManager.getReceipt2(queueEntry) || null,
      // uniqueChallenges: queueEntry.uniqueChallengesCount,
      collectedVoteCount: queueEntry.collectedVoteHashes.length,
      simpleDebugStr: this.app.getSimpleTxDebugValue ? this.app.getSimpleTxDebugValue(queueEntry.acceptedTx?.data) : "",
    }
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  removeTxFromArchivedQueue(txId: string) {
    // remove from the archived queue array and map by txId
    const index = this.archivedQueueEntries.findIndex((queueEntry) => queueEntry.acceptedTx.txId === txId)
    if (index !== -1) {
      this.mainLogger.debug(`Removing tx ${txId} from archived queue`)
      this.archivedQueueEntries.splice(index, 1)
    }
    if (this.archivedQueueEntriesByID.has(txId)) delete this.archivedQueueEntriesByID[txId]
  }
  updateTxState(queueEntry: QueueEntry, nextState: string, context = ''): void {
    if (logFlags.seqdiagram)
      if (context == '')
        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455104 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: ${queueEntry.state}-${nextState}`)
      else 
        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455104 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: ${queueEntry.state}-${nextState}:${context}`)
    const currentState = queueEntry.state
    this.txDebugMarkEndTime(queueEntry, currentState)
    queueEntry.state = nextState
    this.txDebugMarkStartTime(queueEntry, nextState)
  }
  txDebugMarkStartTime(queueEntry: QueueEntry, state: string): void {
    if (queueEntry.txDebug.startTime[state] == null) {
      queueEntry.txDebug.startTime[state] = process.hrtime()
      queueEntry.txDebug.startTimestamp[state] = shardusGetTime()
    }
  }
  txDebugMarkEndTime(queueEntry: QueueEntry, state: string): void {
    if (queueEntry.txDebug.startTime[state]) {
      const endTime = process.hrtime(queueEntry.txDebug.startTime[state])
      queueEntry.txDebug.endTime[state] = endTime
      queueEntry.txDebug.endTimestamp[state] = shardusGetTime()

      const durationInNanoseconds = endTime[0] * 1e9 + endTime[1]
      const durationInMilliseconds = durationInNanoseconds / 1e6

      queueEntry.txDebug.duration[state] = durationInMilliseconds

      delete queueEntry.txDebug.startTime[state]
      delete queueEntry.txDebug.endTime[state]
    }
  }
  clearDebugAwaitStrings(): void {
    this.debugLastAwaitedCall = ''
    this.debugLastAwaitedCallInner = ''
    this.debugLastAwaitedAppCall = ''
    this.debugLastAwaitedCallInnerStack = {}
    this.debugLastAwaitedAppCallStack = {}
  }

  getQueueLengthBuckets(): any {
    try {
      const buckets = { c15: 0, c60: 0, c120: 0, c600: 0 };

      if (!this._transactionQueue || this._transactionQueue.length === 0) {
        return buckets;
      }

      const currentTime = shardusGetTime();

      this._transactionQueue.forEach((queueEntry) => {
        if (queueEntry && queueEntry.acceptedTx && queueEntry.acceptedTx.timestamp) {
          const txAgeInSeconds = (currentTime - queueEntry.acceptedTx.timestamp) / 1000

          if (txAgeInSeconds >= 15 && txAgeInSeconds < 60) {
            buckets.c15++
          } else if (txAgeInSeconds >= 60 && txAgeInSeconds < 120) {
            buckets.c60++
          } else if (txAgeInSeconds >= 120 && txAgeInSeconds < 600) {
            buckets.c120++
          } else if (txAgeInSeconds >= 600) {
            buckets.c600++
          }
        }
      })
      return buckets;
    } catch (e) {
      return {}
    }
  }
}

export default TransactionQueue
