import { CycleRecord } from '@shardus/types/build/src/p2p/CycleCreatorTypes'
import { P2P as P2PTypes, StateManager as StateManagerTypes } from '@shardus/types'
import { Logger as log4jLogger } from 'log4js'
import StateManager from '.'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import * as Comms from '../p2p/Comms'
import * as Context from '../p2p/Context'
import { P2PModuleContext as P2P } from '../p2p/Context'
import * as CycleChain from '../p2p/CycleChain'
import * as Self from '../p2p/Self'
import * as Shardus from '../shardus/shardus-types'
import { TimestampReceipt } from '../shardus/shardus-types'
import Storage from '../storage'
import * as utils from '../utils'
import { Ordering } from '../utils'
import { nestedCountersInstance } from '../utils/nestedCounters'
import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'
import ShardFunctions from './shardFunctions'
import * as NodeList from '../p2p/NodeList'
import {
  AppliedReceipt,
  AppliedReceipt2,
  AppliedVote,
  AppliedVoteHash,
  AppliedVoteQuery,
  AppliedVoteQueryResponse,
  ConfirmOrChallengeMessage,
  ConfirmOrChallengeQuery,
  ConfirmOrChallengeQueryResponse,
  GetAccountData3Req,
  GetAccountData3Resp,
  QueueEntry,
  RequestReceiptForTxReq,
  RequestReceiptForTxResp,
  WrappedResponses,
  TimestampRemoveRequest,
  Proposal,
  Vote,
  SignedReceipt,
} from './state-manager-types'
import { ipInfo, shardusGetTime } from '../network'
import { robustQuery } from '../p2p/Utils'
import { SignedObject } from '@shardus/crypto-utils'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import { GetAccountDataReqSerializable, serializeGetAccountDataReq } from '../types/GetAccountDataReq'
import { GetAccountDataRespSerializable, deserializeGetAccountDataResp } from '../types/GetAccountDataResp'
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum'
import { InternalBinaryHandler } from '../types/Handler'
import { Route } from '@shardus/types/build/src/p2p/P2PTypes'
import { RequestErrorEnum } from '../types/enum/RequestErrorEnum'
import { getStreamWithTypeCheck, requestErrorHandler } from '../types/Helpers'
import { TypeIdentifierEnum } from '../types/enum/TypeIdentifierEnum'
import {
  deserializeGetTxTimestampResp,
  getTxTimestampResp,
  serializeGetTxTimestampResp,
} from '../types/GetTxTimestampResp'
import {
  deserializeGetTxTimestampReq,
  getTxTimestampReq,
  serializeGetTxTimestampReq,
} from '../types/GetTxTimestampReq'
import {
  SpreadAppliedVoteHashReq,
  serializeSpreadAppliedVoteHashReq,
} from '../types/SpreadAppliedVoteHashReq'
import {
  GetConfirmOrChallengeReq,
  deserializeGetConfirmOrChallengeReq,
  serializeGetConfirmOrChallengeReq,
} from '../types/GetConfirmOrChallengeReq'
import {
  GetConfirmOrChallengeResp,
  deserializeGetConfirmOrChallengeResp,
  serializeGetConfirmOrChallengeResp,
} from '../types/GetConfirmOrChallengeResp'
import {
  GetAppliedVoteReq,
  deserializeGetAppliedVoteReq,
  serializeGetAppliedVoteReq,
} from '../types/GetAppliedVoteReq'
import {
  GetAppliedVoteResp,
  deserializeGetAppliedVoteResp,
  serializeGetAppliedVoteResp,
} from '../types/GetAppliedVoteResp'
import { BadRequest, InternalError, NotFound, serializeResponseError } from '../types/ResponseError'
import { randomUUID } from 'crypto'
import { Utils } from '@shardus/types'
import { PoqoSendReceiptReq, deserializePoqoSendReceiptReq, serializePoqoSendReceiptReq } from '../types/PoqoSendReceiptReq'
import { deserializePoqoDataAndReceiptResp } from '../types/PoqoDataAndReceiptReq'
import { deserializePoqoSendVoteReq, serializePoqoSendVoteReq } from '../types/PoqoSendVoteReq'
import { RequestReceiptForTxReqSerialized, serializeRequestReceiptForTxReq } from '../types/RequestReceiptForTxReq'
import { RequestReceiptForTxRespSerialized, deserializeRequestReceiptForTxResp } from '../types/RequestReceiptForTxResp'

class TransactionConsenus {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.StrictServerConfiguration
  profiler: Profiler

  logger: Logger
  p2p: P2P
  storage: Storage
  stateManager: StateManager

  mainLogger: log4jLogger
  seqLogger: log4jLogger
  fatalLogger: log4jLogger
  shardLogger: log4jLogger
  statsLogger: log4jLogger
  statemanager_fatal: (key: string, log: string) => void

  txTimestampCache: Map<number | string, Map<string, TimestampReceipt>>
  txTimestampCacheByTxId: Map<string, TimestampReceipt>
  seenTimestampRequests: Set<string>

  produceBadVote: boolean
  produceBadChallenge: boolean
  debugFailPOQo: number

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

    this.mainLogger = logger.getLogger('main')
    this.seqLogger = logger.getLogger('seq')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal
    this.txTimestampCache = new Map()
    this.txTimestampCacheByTxId = new Map()
    this.seenTimestampRequests = new Set()

    this.produceBadVote = this.config.debug.produceBadVote
    this.produceBadChallenge = this.config.debug.produceBadChallenge
    this.debugFailPOQo = 0
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
    Context.network.registerExternalGet('debug-poqo-fail', isDebugModeMiddleware, (req, res) => {
      try {
        const newChance = req.query.newChance
        if (typeof newChance !== 'string' || !newChance) {
          res.write(`debug-poqo-fail: missing param newChance ${this.debugFailPOQo}\n`)
          res.end()
          return
        }
        const newChanceInt = parseFloat(newChance)
        if (newChanceInt >= 1) {
          res.write(`debug-poqo-fail: newChance not a float: ${this.debugFailPOQo}\n`)
          res.end()
          return
        }
        this.debugFailPOQo = newChanceInt
        res.write(`debug-poqo-fail: set: ${this.debugFailPOQo}\n`)
      } catch (e) {
        res.write(`debug-poqo-fail: error: ${this.debugFailPOQo}\n`)
      }
      res.end()
    })

    // todo need to sort out a cleaner way to allow local override of debug config values. should solve this once
    // Context.network.registerExternalGet('debug-ignore-data-tell', isDebugModeMiddleware, (req, res) => {
    //   try {
    //     const newChance = req.query.newChance
    //     const currentValue = this.config.debug.ignoreDataTellChance
    //     const configName = "ignore-data-tell"
    //     if (typeof newChance !== 'string' || !newChance) {
    //       res.write(`${configName}: missing param newChance ${this.debugFailPOQo}\n`)
    //       res.end()
    //       return
    //     }
    //     const newChanceInt = parseFloat(newChance)
    //     if (newChanceInt >= 1) {
    //       res.write(`${configName}: newChance not a float: ${this.debugFailPOQo}\n`)
    //       res.end()
    //       return
    //     }
    //     //todo need and intermediate value because it is not safe to one off change this
    //     this.config.debug.ignoreDataTellChance = newChanceInt
    //     res.write(`${configName}: set: ${this.debugFailPOQo}\n`)
    //   } catch (e) {
    //     res.write(`${configName}: error: ${this.debugFailPOQo}\n`)
    //   }
    //   res.end()
    // })

    Context.network.registerExternalGet('debug-poq-switch', isDebugModeMiddleware, (_req, res) => {
      try {
        this.stateManager.transactionQueue.useNewPOQ = !this.stateManager.transactionQueue.useNewPOQ
        res.write(`this.useNewPOQ: ${this.stateManager.transactionQueue.useNewPOQ}\n`)
      } catch (e) {
        res.write(`${e}\n`)
      }
      res.end()
    })

    Context.network.registerExternalGet(
      'debug-poq-wait-before-confirm',
      isDebugModeMiddleware,
      (_req, res) => {
        try {
          const waitTimeBeforeConfirm = _req.query.waitTimeBeforeConfirm as string
          if (waitTimeBeforeConfirm && !isNaN(parseInt(waitTimeBeforeConfirm)))
            this.config.stateManager.waitTimeBeforeConfirm = parseInt(waitTimeBeforeConfirm)
          res.write(`stateManager.waitTimeBeforeConfirm: ${this.config.stateManager.waitTimeBeforeConfirm}\n`)
        } catch (e) {
          res.write(`${e}\n`)
        }
        res.end()
      }
    )

    Context.network.registerExternalGet(
      'debug-poq-wait-limit-confirm',
      isDebugModeMiddleware,
      (_req, res) => {
        try {
          const waitLimitAfterFirstVote = _req.query.waitLimitAfterFirstVote as string
          if (waitLimitAfterFirstVote && !isNaN(parseInt(waitLimitAfterFirstVote)))
            this.config.stateManager.waitLimitAfterFirstVote = parseInt(waitLimitAfterFirstVote)
          res.write(
            `stateManager.waitLimitAfterFirstVote: ${this.config.stateManager.waitLimitAfterFirstVote}\n`
          )
        } catch (e) {
          res.write(`${e}\n`)
        }
        res.end()
      }
    )

    Context.network.registerExternalGet(
      'debug-poq-wait-before-receipt',
      isDebugModeMiddleware,
      (_req, res) => {
        try {
          const waitTimeBeforeReceipt = _req.query.waitTimeBeforeReceipt as string
          if (waitTimeBeforeReceipt && !isNaN(parseInt(waitTimeBeforeReceipt)))
            this.config.stateManager.waitTimeBeforeReceipt = parseInt(waitTimeBeforeReceipt)
          res.write(`stateManager.waitTimeBeforeReceipt: ${this.config.stateManager.waitTimeBeforeReceipt}\n`)
        } catch (e) {
          res.write(`${e}\n`)
        }
        res.end()
      }
    )

    Context.network.registerExternalGet(
      'debug-poq-wait-limit-receipt',
      isDebugModeMiddleware,
      (_req, res) => {
        try {
          const waitLimitAfterFirstMessage = _req.query.waitLimitAfterFirstMessage as string
          if (waitLimitAfterFirstMessage && !isNaN(parseInt(waitLimitAfterFirstMessage)))
            this.config.stateManager.waitLimitAfterFirstMessage = parseInt(waitLimitAfterFirstMessage)
          res.write(
            `stateManager.waitLimitAfterFirstVote: ${this.config.stateManager.waitLimitAfterFirstMessage}\n`
          )
        } catch (e) {
          res.write(`${e}\n`)
        }
        res.end()
      }
    )

    Context.network.registerExternalGet('debug-produceBadVote', isDebugModeMiddleware, (req, res) => {
      this.produceBadVote = !this.produceBadVote
      res.send({ status: 'ok', produceBadVote: this.produceBadVote })
    })

    Context.network.registerExternalGet('debug-produceBadChallenge', isDebugModeMiddleware, (req, res) => {
      this.produceBadChallenge = !this.produceBadChallenge
      res.send({ status: 'ok', produceBadChallenge: this.produceBadChallenge })
    })

    // this.p2p.registerInternal(
    //   'get_tx_timestamp',
    //   async (
    //     payload: { txId: string; cycleCounter: number; cycleMarker: string },
    //     respond: (arg0: Shardus.TimestampReceipt) => unknown
    //   ) => {
    //     const { txId, cycleCounter, cycleMarker } = payload
    //
    //    if (this.txTimestampCache.has(cycleCounter) && this.txTimestampCache.get(cycleCounter).has(txId)) {
    //      await respond(this.txTimestampCache.get(cycleCounter).get(txId))
    //    } else {
    //       const tsReceipt: Shardus.TimestampReceipt = this.generateTimestampReceipt(
    //         txId,
    //         cycleMarker,
    //         cycleCounter
    //       )
    //       await respond(tsReceipt)
    //     }
    //
    //   }
    // )

    this.p2p.registerInternal(
      'remove_timestamp_cache',
      async (
        payload: TimestampRemoveRequest,
        respond: (result: boolean) => unknown
      ) => {
        const { txId, receipt2, cycleCounter } = payload
        if (this.txTimestampCache.has(cycleCounter) && this.txTimestampCache.get(cycleCounter).has(txId)) {

          /* prettier-ignore */ this.mainLogger.debug(`Removed timestamp cache for txId: ${txId}, timestamp: ${Utils.safeStringify(this.txTimestampCache.get(cycleCounter).get(txId))}`)
          // remove the timestamp from the cache
          this.txTimestampCache.get(cycleCounter).delete(txId)
          nestedCountersInstance.countEvent('consensus', 'remove_timestamp_cache')
        }
        await respond(true)
      }
    )

    const getTxTimestampBinary: Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_get_tx_timestamp,
      handler: async (payload, respond, header) => {
        const route = InternalRouteEnum.binary_get_tx_timestamp
        this.profiler.scopedProfileSectionStart(route)
        nestedCountersInstance.countEvent('internal', route)
        profilerInstance.scopedProfileSectionStart(route, true, payload.length)

        const errorHandler = (
          errorType: RequestErrorEnum,
          opts?: { customErrorLog?: string; customCounterSuffix?: string }
        ): void => requestErrorHandler(route, errorType, header, opts)

        let tsReceipt: Shardus.TimestampReceipt
        try {
          const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cGetTxTimestampReq)
          if (!requestStream) {
            errorHandler(RequestErrorEnum.InvalidRequest)
            return respond(tsReceipt, serializeGetTxTimestampResp)
          }

          const readableReq = deserializeGetTxTimestampReq(requestStream)
          // handle rare race condition where we have seen the txId but not the timestamp
          if (Context.config.p2p.timestampCacheFix && this.seenTimestampRequests.has(readableReq.txId) && !this.txTimestampCacheByTxId.has(readableReq.txId)) {
              nestedCountersInstance.countEvent('consensus', 'get_tx_timestamp seen txId but found no timestamp')
            return respond(BadRequest('get_tx_timestamp seen txId but found no timestamp'), serializeResponseError)
          }
          this.seenTimestampRequests.add(readableReq.txId) 

          if (
            this.txTimestampCache.has(readableReq.cycleCounter) &&
            this.txTimestampCache.get(readableReq.cycleCounter).has(readableReq.txId)
          ) {
            tsReceipt = this.txTimestampCache.get(readableReq.cycleCounter).get(readableReq.txId)
            /* prettier-ignore */ this.mainLogger.debug(`get_tx_timestamp handler: Found timestamp cache for txId: ${readableReq.txId}, timestamp: ${Utils.safeStringify(tsReceipt)}`)
            return respond(tsReceipt, serializeGetTxTimestampResp)
          } else if(Context.config.p2p.timestampCacheFix && this.txTimestampCacheByTxId.has(readableReq.txId)) {
            tsReceipt = this.txTimestampCacheByTxId.get(readableReq.txId)
            /* prettier-ignore */ this.mainLogger.debug(`get_tx_timestamp handler: Found timestamp cache for txId in cacheById: ${readableReq.txId}, timestamp: ${Utils.safeStringify(tsReceipt)}`)
            nestedCountersInstance.countEvent('consensus', 'get_tx_timestamp found tx timestamp in cacheById')
            return respond(tsReceipt, serializeGetTxTimestampResp)
          } else {
            const tsReceipt: Shardus.TimestampReceipt = this.generateTimestampReceipt(
              readableReq.txId,
              readableReq.cycleMarker,
              readableReq.cycleCounter
            )
            return respond(tsReceipt, serializeGetTxTimestampResp)
          }
        } catch (e) {
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`${route}: Exception executing request: ${utils.errorToStringFull(e)}`)
          respond(tsReceipt, serializeGetTxTimestampResp)
        } finally {
          profilerInstance.scopedProfileSectionEnd(route, payload.length)
        }
      },
    }

    this.p2p.registerInternalBinary(getTxTimestampBinary.name, getTxTimestampBinary.handler)

    // this.p2p.registerInternal(
    //   'get_confirm_or_challenge',
    //   async (payload: AppliedVoteQuery, respond: (arg0: ConfirmOrChallengeQuery) => unknown) => {
    //     nestedCountersInstance.countEvent('consensus', 'get_confirm_or_challenge')
    //     this.profiler.scopedProfileSectionStart('get_confirm_or_challenge handler', true)
    //     const confirmOrChallengeResult: ConfirmOrChallengeQueryResponse = {
    //       txId: '',
    //       appliedVoteHash: '',
    //       result: null,
    //       uniqueCount: 0,
    //     }
    //     try {
    //       const { txId } = payload
    //       let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(txId)
    //       if (queueEntry == null) {
    //         // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
    //         queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(
    //           txId,
    //           'get_confirm_or_challenge'
    //         )
    //       }

    //       if (queueEntry == null) {
    //         /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug('get_confirm_or_challenge: queueEntry not found in getQueueEntrySafe or getQueueEntryArchived for txId: ', txId)
    //         /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`get_confirm_or_challenge no queue entry for ${payload.txId} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txId)]}`)
    //         await respond(confirmOrChallengeResult)
    //       }
    //       if (queueEntry.receivedBestConfirmation == null && queueEntry.receivedBestChallenge == null) {
    //         nestedCountersInstance.countEvent(
    //           'consensus',
    //           'get_confirm_or_challenge no confirmation or challenge'
    //         )
    //         /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`get_confirm_or_challenge no confirmation or challenge for ${queueEntry.logID}, bestVote: ${Utils.safeStringify(queueEntry.receivedBestVote)},  bestConfirmation: ${Utils.safeStringify(queueEntry.receivedBestConfirmation)}`)
    //         await respond(confirmOrChallengeResult)
    //       }

    //       // refine the result and unique count
    //       const { receivedBestChallenge, receivedBestConfirmation, uniqueChallengesCount } = queueEntry;
    //       if (receivedBestChallenge && uniqueChallengesCount >= this.config.stateManager.minRequiredChallenges) {
    //         confirmOrChallengeResult.result = receivedBestChallenge;
    //         confirmOrChallengeResult.uniqueCount = uniqueChallengesCount;
    //       } else {
    //         confirmOrChallengeResult.result = receivedBestConfirmation;
    //         confirmOrChallengeResult.uniqueCount = 1;
    //       }
    //       await respond(confirmOrChallengeResult)
    //     } catch (e) {
    //       if (logFlags.error) this.mainLogger.error(`get_confirm_or_challenge error ${e.message}`)
    //     } finally {
    //       this.profiler.scopedProfileSectionEnd('get_confirm_or_challenge handler')
    //     }
    //   }
    // )

    const getChallengeOrConfirmBinaryHandler: Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_get_confirm_or_challenge,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (payload, respond, header, sign) => {
        const route = InternalRouteEnum.binary_get_confirm_or_challenge
        nestedCountersInstance.countEvent('internal', route)
        this.profiler.scopedProfileSectionStart(route, true, payload.length)
        const confirmOrChallengeResult: GetConfirmOrChallengeResp = {
          txId: '',
          appliedVoteHash: '',
          result: null,
          uniqueCount: 0,
        }
        try {
          const reqStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cGetConfirmOrChallengeReq)
          if (!reqStream) {
            nestedCountersInstance.countEvent('internal', `${route}-invalid_request`)
            respond(confirmOrChallengeResult, serializeGetConfirmOrChallengeResp)
            return
          }
          const request = deserializeGetConfirmOrChallengeReq(reqStream)
          const { txId } = request
          let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(txId)
          if (queueEntry == null) {
            // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
            queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(txId, route)
          }
          if (queueEntry == null) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`get_confirm_or_challenge no queue entry for ${txId} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(txId)]}`)
            respond(confirmOrChallengeResult, serializeGetConfirmOrChallengeResp)
            return
          }
          if (queueEntry.receivedBestConfirmation == null && queueEntry.receivedBestChallenge == null) {
            nestedCountersInstance.countEvent(
              'consensus',
              'get_confirm_or_challenge no confirmation or challenge'
            )
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`get_confirm_or_challenge no confirmation or challenge for ${queueEntry.logID}, bestVote: ${Utils.safeStringify(queueEntry.receivedBestVote)},  bestConfirmation: ${Utils.safeStringify(queueEntry.receivedBestConfirmation)}`)
            respond(confirmOrChallengeResult, serializeGetConfirmOrChallengeResp)
            return
          }

          // refine the result and unique count
          const { receivedBestChallenge, receivedBestConfirmation, uniqueChallengesCount } = queueEntry;
          if (receivedBestChallenge && uniqueChallengesCount >= this.config.stateManager.minRequiredChallenges) {
            confirmOrChallengeResult.result = receivedBestChallenge;
            confirmOrChallengeResult.uniqueCount = uniqueChallengesCount;
          } else {
            confirmOrChallengeResult.result = receivedBestConfirmation;
            confirmOrChallengeResult.uniqueCount = 1;
          }
          respond(confirmOrChallengeResult, serializeGetConfirmOrChallengeResp)
        } catch (e) {
          // Error handling
          if (logFlags.error) this.mainLogger.error(`get_confirm_or_challenge error ${e.message}`)
          respond(confirmOrChallengeResult, serializeGetConfirmOrChallengeResp)
        } finally {
          this.profiler.scopedProfileSectionEnd(route)
        }
      },
    }

    this.p2p.registerInternalBinary(
      getChallengeOrConfirmBinaryHandler.name,
      getChallengeOrConfirmBinaryHandler.handler
    )

    // this.p2p.registerInternal(
    //   'get_applied_vote',
    //   async (payload: AppliedVoteQuery, respond: (arg0: AppliedVoteQueryResponse) => unknown) => {        
    //     nestedCountersInstance.countEvent('consensus', 'get_applied_vote')
    //     const { txId } = payload
    //     let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(txId)
    //     if (queueEntry == null) {
    //       // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
    //       queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(txId, 'get_applied_vote')
    //     }

    //     if (queueEntry == null) {
    //       /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`get_applied_vote no queue entry for ${payload.txId} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txId)]}`)
    //       return
    //     }
    //     if (queueEntry.receivedBestVote == null) {
    //       /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`get_applied_vote no receivedBestVote for ${payload.txId} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txId)]}`)
    //       return
    //     }
    //     const appliedVote: AppliedVoteQueryResponse = {
    //       txId,
    //       appliedVote: queueEntry.receivedBestVote,
    //       appliedVoteHash: queueEntry.receivedBestVoteHash
    //         ? queueEntry.receivedBestVoteHash
    //         : this.calculateVoteHash(queueEntry.receivedBestVote),
    //     }
    //     await respond(appliedVote)
    //   }
    // )

    const GetAppliedVoteBinaryHandler: Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_get_applied_vote,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (payload, respond, header, sign) => {
        const route = InternalRouteEnum.binary_get_applied_vote
        nestedCountersInstance.countEvent('internal', route)
        this.profiler.scopedProfileSectionStart(route, false, payload.length)
        const errorHandler = (
          errorType: RequestErrorEnum,
          opts?: { customErrorLog?: string; customCounterSuffix?: string }
        ): void => requestErrorHandler(route, errorType, header, opts)

        try {
          const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cGetAppliedVoteReq)
          if (!requestStream) {
            errorHandler(RequestErrorEnum.InvalidRequestType)
            return respond(BadRequest('invalid request stream'), serializeResponseError)
          }

          // verification data checks
          if (header.verification_data == null) {
            errorHandler(RequestErrorEnum.MissingVerificationData)
            return respond(BadRequest('missing verification data'), serializeResponseError)
          }

          const txId = header.verification_data
          let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(txId)
          if (queueEntry == null) {
            // check the archived queue entries
            queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(txId, route)
          }

          if (queueEntry == null) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`${route} no queue entry for ${txId} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(txId)]}`)
            errorHandler(RequestErrorEnum.InvalidRequest)
            return respond(NotFound('queue entry not found'), serializeResponseError)
          }

          const req = deserializeGetAppliedVoteReq(requestStream)
          if (req.txId !== txId) {
            errorHandler(RequestErrorEnum.InvalidPayload, { customErrorLog: 'txId mismatch' })
            return respond(BadRequest('txId mismatch'), serializeResponseError)
          }

          if (queueEntry.receivedBestVote == null) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`${route} no receivedBestVote for ${req.txId} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(req.txId)]}`)
            return respond(NotFound('receivedBestVote not found'), serializeResponseError)
          }
          const appliedVote: GetAppliedVoteResp = {
            txId,
            appliedVote: queueEntry.receivedBestVote,
            appliedVoteHash: queueEntry.receivedBestVoteHash
              ? queueEntry.receivedBestVoteHash
              : this.calculateVoteHash(queueEntry.receivedBestVote),
          }
          respond(appliedVote, serializeGetAppliedVoteResp)
        } catch (e) {
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          this.mainLogger.error(`${route}: Exception executing request: ${utils.errorToStringFull(e)}`)
          return respond(InternalError('exception executing request'), serializeResponseError)
        } finally {
          this.profiler.scopedProfileSectionEnd(route)
        }
      },
    }

    Comms.registerInternalBinary(GetAppliedVoteBinaryHandler.name, GetAppliedVoteBinaryHandler.handler)

    Comms.registerGossipHandler(
      'gossip-applied-vote',
      async (payload: AppliedVote, sender: string, tracker: string) => {
        nestedCountersInstance.countEvent('consensus', 'gossip-applied-vote')
        profilerInstance.scopedProfileSectionStart('gossip-applied-vote handler', true)
        try {
          const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(payload.txid) // , payload.timestamp)
          if (queueEntry == null) {
            /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${payload.txid} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:noTX`)
            return
          }
          const newVote = payload as AppliedVote
          const appendSuccessful = this.stateManager.transactionConsensus.tryAppendVote(queueEntry, newVote)

          if (appendSuccessful) {
            /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${payload.txid} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:appended`)
            const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
            if (gossipGroup.length > 1) {
              // should consider only forwarding in some cases?
              this.stateManager.debugNodeGroup(
                queueEntry.acceptedTx.txId,
                queueEntry.acceptedTx.timestamp,
                `share appliedVote to consensus nodes`,
                gossipGroup
              )
              Comms.sendGossip(
                'gossip-applied-vote',
                newVote,
                tracker,
                null,
                queueEntry.transactionGroup,
                false,
                -1,
                queueEntry.acceptedTx.txId,
                `${NodeList.activeIdToPartition.get(newVote.node_id)}`
              )
            }
          }
        } finally {
          profilerInstance.scopedProfileSectionEnd('gossip-applied-vote handler')
        }
      }
    )

    this.p2p.registerGossipHandler(
      'spread_appliedReceipt',
      async (
        payload: {
          txid: string
          result?: boolean
          appliedVotes?: AppliedVote[]
          app_data_hash?: string
        },
        tracker: string,
        msgSize: number
      ) => {
        nestedCountersInstance.countEvent('consensus', 'spread_appliedReceipt')
        profilerInstance.scopedProfileSectionStart('spread_appliedReceipt', false, msgSize)
        let respondSize = cUninitializedSize
        try {
          const appliedReceipt = payload as AppliedReceipt
          let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(appliedReceipt.txid) // , payload.timestamp)
          if (queueEntry == null) {
            if (queueEntry == null) {
              // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
              queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(
                payload.txid as string,
                'spread_appliedReceipt'
              ) // , payload.timestamp)
              if (queueEntry != null) {
                // TODO : PERF on a faster version we may just bail if this lives in the arcive list.
                // would need to make sure we send gossip though.
              }
            }
            if (queueEntry == null) {
              /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`spread_appliedReceipt no queue entry for ${appliedReceipt.txid} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txid)]}`)
              // NEW start repair process that will find the TX then apply repairs
              // this.stateManager.transactionRepair.repairToMatchReceiptWithoutQueueEntry(appliedReceipt)
              return
            }
          }

          if (
            this.stateManager.testFailChance(
              this.stateManager.ignoreRecieptChance,
              'spread_appliedReceipt',
              utils.stringifyReduce(appliedReceipt.txid),
              '',
              logFlags.verbose
            ) === true
          ) {
            return
          }

          // TODO STATESHARDING4 ENDPOINTS check payload format
          // TODO STATESHARDING4 ENDPOINTS that this message is from a valid sender (may need to check docs)

          const receiptNotNull = appliedReceipt != null

          if (queueEntry.gossipedReceipt === false) {
            queueEntry.gossipedReceipt = true
            /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`spread_appliedReceipt update ${queueEntry.logID} receiptNotNull:${receiptNotNull}`)

            if (queueEntry.archived === false) {
              queueEntry.recievedAppliedReceipt = appliedReceipt
            }

            // I think we handle the negative cases later by checking queueEntry.recievedAppliedReceipt vs queueEntry.appliedReceipt

            // share the appliedReceipt.
            const sender = null
            const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
            if (gossipGroup.length > 1) {
              // should consider only forwarding in some cases?
              this.stateManager.debugNodeGroup(
                queueEntry.acceptedTx.txId,
                queueEntry.acceptedTx.timestamp,
                `share appliedReceipt to neighbors`,
                gossipGroup
              )
              //no await so we cant get the message out size in a reasonable way
              respondSize = await this.p2p.sendGossipIn(
                'spread_appliedReceipt',
                appliedReceipt,
                tracker,
                sender,
                gossipGroup,
                false,
                -1,
                queueEntry.acceptedTx.txId
              )
            }
          } else {
            // we get here if the receipt has already been shared
            /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`spread_appliedReceipt skipped ${queueEntry.logID} receiptNotNull:${receiptNotNull} Already Shared`)
          }
        } finally {
          profilerInstance.scopedProfileSectionEnd('spread_appliedReceipt', respondSize)
        }
      }
    )

    this.p2p.registerGossipHandler(
      'spread_appliedReceipt2',
      async (
        payload: any,
        tracker: string,
        msgSize: number
      ) => {
        nestedCountersInstance.countEvent('consensus', 'spread_appliedReceipt2 handler')
        profilerInstance.scopedProfileSectionStart('spread_appliedReceipt2', false, msgSize)
        const respondSize = cUninitializedSize

        // ignore the message for debugging purpose
        if (
          this.stateManager.testFailChance(
            this.stateManager.ignoreRecieptChance,
            'spread_appliedReceipt2',
            utils.stringifyReduce(payload.txid),
            '',
            logFlags.verbose
          ) === true
        ) {
          return
        }

        try {
          // extract txId
          let txId: string
          let receivedAppliedReceipt2: AppliedReceipt2
          if (Context.config.stateManager.attachDataToReceipt) {
            txId = payload.receipt?.txid
            receivedAppliedReceipt2 = payload.receipt as AppliedReceipt2
          } else {
            receivedAppliedReceipt2 = payload as AppliedReceipt2
            txId = receivedAppliedReceipt2.txid
          }
          if (receivedAppliedReceipt2 == null) {
            /* prettier-ignore */ this.mainLogger.error(`spread_appliedReceipt2 ${txId} received null receipt`)
            nestedCountersInstance.countEvent(`consensus`, `spread_appliedReceipt received null receipt`)
            return
          }

          // we need confirmation in new POQ
          if (this.stateManager.transactionQueue.useNewPOQ && receivedAppliedReceipt2.confirmOrChallenge == null) {
            /* prettier-ignore */ this.mainLogger.error(`spread_appliedReceipt2 ${txId} received null receipt`)
            nestedCountersInstance.countEvent(`consensus`, `spread_appliedReceipt received null confirm message`)
            return
          }

          // check if we have the queue entry
          let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(txId) // , payload.timestamp)
          if (queueEntry == null) {
            if (queueEntry == null) {
              // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
              queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(
                txId,
                'spread_appliedReceipt2'
              ) // , payload.timestamp)
              if (queueEntry != null) {
                // TODO : PERF on a faster version we may just bail if this lives in the arcive list.
                // would need to make sure we send gossip though.
              }
            }
            if (queueEntry == null) {
              /* prettier-ignore */
              if (logFlags.error || this.stateManager.consensusLog)
                this.mainLogger.error(
                  `spread_appliedReceipt no queue entry for ${txId} txId:${txId}`
                )
              // NEW start repair process that will find the TX then apply repairs
              // this.stateManager.transactionRepair.repairToMatchReceiptWithoutQueueEntry(receivedAppliedReceipt2)
              return
            }
          }
          if (queueEntry.hasValidFinalData || queueEntry.accountDataSet) {
            /* prettier-ignore */
            if (logFlags.debug || this.stateManager.consensusLog)
              this.mainLogger.debug(`spread_appliedReceipt2 skipped ${queueEntry.logID} Already Shared`)
            nestedCountersInstance.countEvent(`consensus`, `spread_appliedReceipt2 skipped Already Shared`)
            return
          }

          // for debugging and testing purpose
          if (
            this.stateManager.testFailChance(
              this.stateManager.ignoreRecieptChance,
              'spread_appliedReceipt2',
              utils.stringifyReduce(txId),
              '',
              logFlags.verbose
            ) === true
          ) {
            return
          }

          // todo: STATESHARDING4 ENDPOINTS check payload format
          // todo: STATESHARDING4 ENDPOINTS that this message is from a valid sender (may need to check docs)

          const receiptNotNull = receivedAppliedReceipt2 != null

          // repair only if data is not attached to the receipt
          if (Context.config.stateManager.attachDataToReceipt === false && (queueEntry.state === 'expired' || queueEntry.state === 'almostExpired')) {
            //have we tried to repair this yet?
            const startRepair = queueEntry.repairStarted === false
            /* prettier-ignore */
            if (logFlags.debug || this.stateManager.consensusLog) this.mainLogger.debug(`spread_appliedReceipt2. tx expired. start repair:${startRepair}. update ${queueEntry.logID} receiptNotNull:${receiptNotNull}`);
            if (queueEntry.repairStarted === false) {
              nestedCountersInstance.countEvent('repair1', 'got receipt for expiredTX start repair')
              queueEntry.appliedReceiptForRepair2 = receivedAppliedReceipt2
              //todo any limits to how many repairs at once to allow?
              this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
            }
            //x - dont forward gossip, it is probably too late?
            //do forward gossip so we dont miss on sharing a receipt!
            //return
          }

          // decide whether we should store and forward the receipt
          let shouldStore = false
          let shouldForward = false
          if (Context.config.stateManager.stuckTxQueueFix) {
            // queueEntry.gossipedReceipt will decide the actual forwarding
            shouldForward = true
          }
          if (this.config.stateManager.useNewPOQ === false) {
            shouldStore = queueEntry.gossipedReceipt === false
          } else {
            const localAppliedReceipt2 = queueEntry.appliedReceipt2
            if (localAppliedReceipt2) {
              const localReceiptConfirmNode = localAppliedReceipt2.confirmOrChallenge.nodeId
              const receivedReceiptConfirmNode = receivedAppliedReceipt2.confirmOrChallenge.nodeId
              if (localReceiptConfirmNode === receivedReceiptConfirmNode) {
                if (Context.config.stateManager.stuckTxQueueFix) {
                  // we should not care about the rank for receipt2+data gossips
                  shouldForward = true
                } else {
                  shouldForward = false
                }
                if (logFlags.debug)
                  this.mainLogger.debug(
                    `spread_appliedReceipt2 ${queueEntry.logID} we have the same receipt. We do not need to store but we will forward`
                  )
              } else {
                if (logFlags.debug)
                  this.mainLogger.debug(
                    `spread_appliedReceipt2 ${queueEntry.logID} we have different receipt ${
                      queueEntry.logID
                    }. localReceipt: ${utils.stringifyReduce(
                      localAppliedReceipt2
                    )}, receivedReceipt: ${utils.stringifyReduce(receivedAppliedReceipt2)}`
                  )
                const localReceiptRank = this.stateManager.transactionQueue.computeNodeRank(
                  localReceiptConfirmNode,
                  queueEntry.acceptedTx.txId,
                  queueEntry.acceptedTx.timestamp
                )
                const receivedReceiptRank = this.stateManager.transactionQueue.computeNodeRank(
                  receivedReceiptConfirmNode,
                  queueEntry.acceptedTx.txId,
                  queueEntry.acceptedTx.timestamp
                )
                if (receivedReceiptRank < localReceiptRank) {
                  shouldStore = true
                  shouldForward = true
                  this.mainLogger.debug(
                    `spread_appliedReceipt2 ${queueEntry.logID} received receipt is better. we will store and forward`
                  )
                }
              }
            } else {
              shouldStore = true
              shouldForward = true
              if (logFlags.debug)
                this.mainLogger.debug(
                  `spread_appliedReceipt2 ${queueEntry.logID} we do not have a local or received receipt generated. will store and forward`
                )
            }
          }
          // if we are tx group node and haven't got data yet, we should store and forward the receipt
          if (queueEntry.isInExecutionHome === false) {
            if (queueEntry.accountDataSet === false || Object.keys(queueEntry.collectedFinalData).length === 0) {
              shouldStore = true
              shouldForward = true
              if (logFlags.debug)
                this.mainLogger.debug(
                  `spread_appliedReceipt2 ${queueEntry.logID} we are tx group node and do not have receipt2 yet. will store and forward`
                )
            }
          }
          this.mainLogger.debug(`spread_appliedReceipt2 ${queueEntry.logID} shouldStore:${shouldStore}, shouldForward:${shouldForward} isInExecutionHome:${queueEntry.isInExecutionHome}, accountDataSet:${queueEntry.accountDataSet}, collectedFinalData:${Object.keys(queueEntry.collectedFinalData).length}`)

          // process, store and forward the receipt
          if (shouldStore === true && queueEntry.gossipedReceipt === false) {
            /* prettier-ignore */
            if (logFlags.debug || this.stateManager.consensusLog)
              this.mainLogger.debug(
                `spread_appliedReceipt2 update ${queueEntry.logID} receiptNotNull:${receiptNotNull}, appliedReceipt2: ${utils.stringifyReduce(receivedAppliedReceipt2)}`
              )

            if (queueEntry.archived === false) {
              queueEntry.recievedAppliedReceipt2 = receivedAppliedReceipt2
              queueEntry.appliedReceipt2 = receivedAppliedReceipt2 // is this necessary?
            } else {
              this.mainLogger.error(`spread_appliedReceipt2 queueEntry.archived === true`)
            }

            // commit the accounts if the receipt is valid and has data attached
            if (Context.config.stateManager.attachDataToReceipt && receivedAppliedReceipt2.result) {
              const wrappedStates = payload.wrappedStates as { [key: string]: Shardus.WrappedResponse}
              if (wrappedStates == null) {
                nestedCountersInstance.countEvent(`consensus`, `spread_appliedReceipt2 no wrappedStates`)
                this.mainLogger.error(`spread_appliedReceipt2 no wrappedStates for ${txId}`)
              } else {
                const filteredStates = {}
                const nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData =
                  this.stateManager.currentCycleShardData.nodeShardData
                for (const accountId in wrappedStates) {
                  const isLocal = ShardFunctions.testAddressInRange(
                    accountId,
                    nodeShardData.storedPartitions
                  )
                  if (isLocal) {
                    filteredStates[accountId] = 1
                  }
                }
                const accountRecords = []
                for (const accountId in wrappedStates) {
                  if (filteredStates[accountId] == null) continue
                  const wrappedState = wrappedStates[accountId] as Shardus.WrappedResponse
                  const indexOfAccountIdInVote = receivedAppliedReceipt2.appliedVote.account_id.indexOf(accountId)
                  if (indexOfAccountIdInVote === -1) {
                    this.mainLogger.error(`spread_appliedReceipt2 accountId ${accountId} not found in appliedVote`)
                    continue
                  }
                  const afterStateHash = receivedAppliedReceipt2.appliedVote.account_state_hash_after[indexOfAccountIdInVote]
                  if (wrappedState.stateId !== afterStateHash) {
                    this.mainLogger.error(`spread_appliedReceipt2 accountId ${accountId} state hash mismatch with appliedVote`)
                    continue
                  }
                  queueEntry.collectedFinalData[accountId] = wrappedState // processTx() will do actual commit
                  accountRecords.push(wrappedState)
                  nestedCountersInstance.countEvent(`consensus`, `spread_appliedReceipt2 add to final data`, accountRecords.length)
                }
                if (logFlags.debug) this.mainLogger.debug(`Use final data from appliedReceipt2 ${queueEntry.logID}`, queueEntry.collectedFinalData);
              }
            }

            // I think we handle the negative cases later by checking queueEntry.recievedAppliedReceipt vs queueEntry.receivedAppliedReceipt2

            // share the receivedAppliedReceipt2.
            const sender = null
            const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
            if (gossipGroup.length > 1) {
              // should consider only forwarding in some cases?
              this.stateManager.debugNodeGroup(
                queueEntry.acceptedTx.txId,
                queueEntry.acceptedTx.timestamp,
                `share appliedReceipt to neighbors`,
                gossipGroup
              )
              //no await so we cant get the message out size in a reasonable way
              this.p2p.sendGossipIn(
                'spread_appliedReceipt2',
                payload,
                tracker,
                sender,
                gossipGroup,
                false,
                -1,
                queueEntry.acceptedTx.txId
              )
              queueEntry.gossipedReceipt = true
              nestedCountersInstance.countEvent('consensus', 'spread_appliedReceipt2 gossip forwarded')
            }
          } else {
            // we get here if the receipt has already been shared
            /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`spread_appliedReceipt2 skipped ${queueEntry.logID} receiptNotNull:${receiptNotNull} Already Shared or shouldStoreAndForward:${shouldStore}`)
          }
        } catch (ex) {
          this.statemanager_fatal(
            `spread_appliedReceipt2_ex`,
            'spread_appliedReceipt2 endpoint failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack
          )
        } finally {
          profilerInstance.scopedProfileSectionEnd('spread_appliedReceipt2')
        }
      }
    )

    Comms.registerGossipHandler(
      'spread_confirmOrChallenge',
      (payload: ConfirmOrChallengeMessage, msgSize: number) => {
        nestedCountersInstance.countEvent('consensus', 'spread_confirmOrChallenge handler')
        profilerInstance.scopedProfileSectionStart('spread_confirmOrChallenge', false, msgSize)
        try {
          const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(payload.appliedVote?.txid) // , payload.timestamp)
          if (queueEntry == null) {
            if (logFlags.error) {
              this.mainLogger.error(
                `spread_confirmOrChallenge no queue entry for ${payload.appliedVote?.txid} dbg:${
                  this.stateManager.debugTXHistory[utils.stringifyReduce(payload.appliedVote?.txid)]
                }`
              )
            }
            return
          }
          if (queueEntry.acceptConfirmOrChallenge === false) {
            if (logFlags.debug)
              this.mainLogger.debug(`spread_confirmOrChallenge ${queueEntry.logID} not accepting anymore`)
            return
          }

          const appendSuccessful = this.tryAppendMessage(queueEntry, payload)

          if (logFlags.debug)
            this.mainLogger.debug(
              `spread_confirmOrChallenge ${queueEntry.logID} appendSuccessful:${appendSuccessful}`
            )

          if (appendSuccessful) {
            // Gossip further
            const sender = null
            const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
            Comms.sendGossip('spread_confirmOrChallenge', payload, '', sender, gossipGroup, false, 10, queueEntry.acceptedTx.txId, `handler_${NodeList.activeIdToPartition.get(payload.appliedVote?.node_id)}`)
            queueEntry.gossipedConfirmOrChallenge = true
          }
        } catch (e) {
          this.mainLogger.error(`Error in spread_confirmOrChallenge handler: ${e.message}`)
        } finally {
          profilerInstance.scopedProfileSectionEnd('spread_confirmOrChallenge', msgSize)
        }
      }
    )

    Comms.registerGossipHandler(
      'poqo-receipt-gossip',
      (payload: SignedReceipt & { txGroupCycle: number }) => {
        profilerInstance.scopedProfileSectionStart('poqo-receipt-gossip')
        try {
          const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(payload.proposal.txid)
          if (queueEntry == null) {
            nestedCountersInstance.countEvent('poqo', 'error: gossip skipped: no queue entry')
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-receipt-gossip no queue entry for ${payload.proposal.txid}`)
            return
          }
          if (payload.txGroupCycle) {
            if (queueEntry.txGroupCycle !== payload.txGroupCycle) {
              /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-receipt-gossip mismatch txGroupCycle for txid: ${payload.proposal.txid}, sender's txGroupCycle: ${payload.txGroupCycle}, our txGroupCycle: ${queueEntry.txGroupCycle}`)
              nestedCountersInstance.countEvent(
                'poqo',
                'poqo-receipt-gossip: mismatch txGroupCycle for txid ' + payload.proposal.txid
              )
            }
            delete payload.txGroupCycle
          }

          if (queueEntry.hasSentFinalReceipt === true) {
            // We've already send this receipt, no need to send it again
            return
          }

          if (logFlags.verbose) this.mainLogger.debug(`POQo: received receipt from gossip for ${queueEntry.logID} forwarding gossip`)

          const executionGroupNodes = new Set(queueEntry.executionGroup.map((node) => node.publicKey))
          const hasTwoThirdsMajority = this.verifyAppliedReceipt(payload, executionGroupNodes)
          if (!hasTwoThirdsMajority) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Receipt does not have the required majority for txid: ${payload.proposal.txid}`)
              nestedCountersInstance.countEvent('poqo', 'poqo-receipt-gossip: Rejecting receipt because no majority')
            return
          }

          queueEntry.signedReceipt = payload
          payload.txGroupCycle = queueEntry.txGroupCycle
          Comms.sendGossip(
            'poqo-receipt-gossip',
            payload,
            null,
            null,
            queueEntry.transactionGroup,
            false,
            4,
            payload.proposal.txid,
            '',
            true
          )

          queueEntry.hasSentFinalReceipt = true

          // If the queue entry does not have the valid final data then request that
          if (!queueEntry.hasValidFinalData) {
            setTimeout(async () => {
              // Check if we have final data
              if (queueEntry.hasValidFinalData) {
                return
              }
              if (logFlags.verbose)
                this.mainLogger.debug(`poqo-receipt-gossip: requesting final data for ${queueEntry.logID}`)
              nestedCountersInstance.countEvent(
                'request-final-data',
                'final data timeout, making explicit request'
              )

              const nodesToAskKeys = payload.signaturePack?.map((signature) => signature.owner)

              await this.stateManager.transactionQueue.requestFinalData(
                queueEntry,
                payload.proposal.accountIDs,
                nodesToAskKeys
              )

              nestedCountersInstance.countEvent('request-final-data', 'final data received')
            }, this.config.stateManager.nonExWaitForData)
          }
        } finally {
          profilerInstance.scopedProfileSectionEnd('poqo-receipt-gossip')
        }
      })

    const poqoDataAndReceiptBinaryHandler: Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_poqo_data_and_receipt,
      handler: async (payload, respond, header, sign) => {
        const route = InternalRouteEnum.binary_poqo_data_and_receipt
        this.profiler.scopedProfileSectionStart(route, false)
        try {
          const _sender = header.sender_id
          const reqStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cPoqoDataAndReceiptReq)
          if (!reqStream) {
            nestedCountersInstance.countEvent('internal', `${route}-invalid_request`)
            return
          }
          const readableReq = deserializePoqoDataAndReceiptResp(reqStream)
          // make sure we have it
          const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(readableReq.finalState.txid) // , payload.timestamp)
          //It is okay to ignore this transaction if the txId is not found in the queue.
          if (queueEntry == null) {
            //In the past we would enqueue the TX, expecially if syncing but that has been removed.
            //The normal mechanism of sharing TXs is good enough.
            nestedCountersInstance.countEvent('processing', 'broadcast_finalstate_noQueueEntry')
            return
          }

          // validate corresponding tell sender
          if (_sender == null) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-data-and-receipt invalid sender for txid: ${readableReq.finalState.txid}, sender: ${_sender}`)
            return
          }

          if (readableReq.txGroupCycle) {
            if (queueEntry.txGroupCycle !== readableReq.txGroupCycle) {
              /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`binary_poqo_data_and_receipt mismatch txGroupCycle for txid: ${readableReq.finalState.txid}, sender's txGroupCycle: ${readableReq.txGroupCycle}, our txGroupCycle: ${queueEntry.txGroupCycle}`)
              nestedCountersInstance.countEvent(
                'poqo',
                'binary_poqo_data_and_receipt: mismatch txGroupCycle for txid ' + readableReq.finalState.txid
              )
            }
            delete readableReq.txGroupCycle
          }

          const isValidFinalDataSender =
            this.stateManager.transactionQueue.factValidateCorrespondingTellFinalDataSender(
              queueEntry,
              _sender
            )
          if (isValidFinalDataSender === false) {
            nestedCountersInstance.countEvent('poqo', 'poqo-data-and-receipt: Rejecting receipt: isValidFinalDataSender === false')
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-data-and-receipt invalid: sender ${_sender} for data: ${queueEntry.acceptedTx.txId}`)
            return
          }


          if(readableReq.receipt == null) {
            nestedCountersInstance.countEvent('poqo', 'poqo-data-and-receipt: Rejecting receipt: readableReq.receipt == null')
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-data-and-receipt invalid: readableReq.receipt == null sender ${_sender}`)
              return
          }
          if(readableReq.finalState.txid != readableReq.receipt.proposal.txid) {
            nestedCountersInstance.countEvent('poqo', 'poqo-data-and-receipt: Rejecting receipt: readableReq.finalState.txid != readableReq.receipt.txid')
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-data-and-receipt invalid: readableReq.finalState.txid != readableReq.receipt.txid sender ${_sender}  ${readableReq.finalState.txid} != ${readableReq.receipt.proposal.txid}`)
              return
          }

          if (!queueEntry.hasSentFinalReceipt) {
            const executionGroupNodes = new Set(queueEntry.executionGroup.map(node => node.publicKey));
            const hasTwoThirdsMajority = this.verifyAppliedReceipt(readableReq.receipt, executionGroupNodes)
            if(!hasTwoThirdsMajority) {
              /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Receipt does not have the required majority for txid: ${readableReq.receipt.proposal.txid}`)
              nestedCountersInstance.countEvent('poqo', 'poqo-data-and-receipt: Rejecting receipt because no majority')
              return
            }
            if (logFlags.verbose)
              this.mainLogger.debug(
                `POQo: received data & receipt for ${queueEntry.logID} starting receipt gossip`
              )
            queueEntry.signedReceipt = readableReq.receipt
            const receiptToGossip = { ...readableReq.receipt, txGroupCycle: queueEntry.txGroupCycle }
            Comms.sendGossip(
              'poqo-receipt-gossip',
              receiptToGossip,
              null,
              null,
              queueEntry.transactionGroup,
              false,
              4,
              readableReq.finalState.txid,
              '',
              true
            )
            queueEntry.hasSentFinalReceipt = true
          }

          if (logFlags.debug)
            this.mainLogger.debug(
              `poqo-data-and-receipt ${queueEntry.logID}, ${Utils.safeStringify(
                readableReq.finalState.stateList
              )}`
            )
          // add the data in
          const savedAccountIds: Set<string> = new Set()
          for (const data of readableReq.finalState.stateList) {
            //let wrappedResponse = data as Shardus.WrappedResponse
            //this.queueEntryAddData(queueEntry, data)
            if (data == null) {
              /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`poqo-data-and-receipt data == null`)
              continue
            }

            if (queueEntry.collectedFinalData[data.accountId] == null) {
              queueEntry.collectedFinalData[data.accountId] = data
              savedAccountIds.add(data.accountId)
              /* prettier-ignore */ if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('poqo-data-and-receipt', `${queueEntry.logID}`, `poqo-data-and-receipt addFinalData qId: ${queueEntry.entryID} data:${utils.makeShortHash(data.accountId)} collected keys: ${utils.stringifyReduce(Object.keys(queueEntry.collectedFinalData))}`)
            }

            // if (queueEntry.state === 'syncing') {
            //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastfinalstate', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
            // }
          }
          const nodesToSendTo: Set<Shardus.Node> = new Set()

          for (const data of readableReq.finalState.stateList) {
            if (data == null) {
              continue
            }
            if (savedAccountIds.has(data.accountId) === false) {
              continue
            }
            const storageNodes = this.stateManager.transactionQueue.getStorageGroupForAccount(data.accountId)
            for (const node of storageNodes) {
              nodesToSendTo.add(node)
            }
          }
          if (nodesToSendTo.size > 0) {
            const finalDataToGossip = { ...readableReq.finalState, txGroupCycle: queueEntry.txGroupCycle }
            Comms.sendGossip(
              'gossip-final-state',
              finalDataToGossip,
              null,
              null,
              Array.from(nodesToSendTo),
              false,
              4,
              queueEntry.acceptedTx.txId
            )
            nestedCountersInstance.countEvent(`processing`, `forwarded final data to storage nodes`)
          }
        } catch (e) {
          console.error(`Error processing poqoDataAndReceipt Binary handler: ${e}`)
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          this.mainLogger.error(`${route}: Exception executing request: ${utils.errorToStringFull(e)}`)
        } finally {
          profilerInstance.scopedProfileSectionEnd(route)
        }
      },
    }
    Comms.registerInternalBinary(
      poqoDataAndReceiptBinaryHandler.name,
      poqoDataAndReceiptBinaryHandler.handler
    )

    // Comms.registerInternal(
    //   'poqo-data-and-receipt',
    //   async (
    //     payload: {
    //       finalState: { txid: string; stateList: Shardus.WrappedResponse[] }, 
    //       receipt: AppliedReceipt2
    //     }, 
    //     _respond: unknown,
    //     _sender: string,
    //   ) => {
    //     profilerInstance.scopedProfileSectionStart('poqo-data-and-receipt')
    //     try {
    //       // make sure we have it
    //       const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(payload.finalState.txid) // , payload.timestamp)
    //       //It is okay to ignore this transaction if the txId is not found in the queue.
    //       if (queueEntry == null) {
    //         //In the past we would enqueue the TX, expecially if syncing but that has been removed.
    //         //The normal mechanism of sharing TXs is good enough.
    //         nestedCountersInstance.countEvent('processing', 'broadcast_finalstate_noQueueEntry')
    //         return
    //       }

    //       // validate corresponding tell sender
    //       if (_sender == null) {
    //         /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-data-and-receipt invalid sender for txid: ${payload.finalState.txid}, sender: ${_sender}`)
    //         return
    //       }

          // if (payload.txGroupCycle) {
          //   if (queueEntry.txGroupCycle !== payload.txGroupCycle) {
          //     /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-data-and-receipt mismatch txGroupCycle for txid: ${payload.finalState.txid}, sender's txGroupCycle: ${payload.txGroupCycle}, our txGroupCycle: ${queueEntry.txGroupCycle}`)
          //     nestedCountersInstance.countEvent(
          //       'poqo',
          //       'poqo-data-and-receipt: mismatch txGroupCycle for txid ' + payload.finalState.txid
          //     )
          //   }
          //   delete payload.txGroupCycle
          // }

    //       const isValidFinalDataSender = this.stateManager.transactionQueue.factValidateCorrespondingTellFinalDataSender(queueEntry, _sender)
    //       if (isValidFinalDataSender === false) {
    //         /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-data-and-receipt invalid sender ${_sender} for data: ${queueEntry.acceptedTx.txId}`)
    //         return
    //       }

    //       if (!queueEntry.hasSentFinalReceipt) {
    //         const executionGroupNodes = new Set(queueEntry.executionGroup.map(node => node.publicKey));
    //         const hasTwoThirdsMajority = this.verifyAppliedReceipt(payload.receipt, executionGroupNodes)
    //         if(!hasTwoThirdsMajority) {
    //           /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Receipt does not have the required majority for txid: ${payload.receipt.txid}`)
    //           nestedCountersInstance.countEvent('poqo', 'poqo-data-and-receipt: Rejecting receipt because no majority')
    //           return
    //         }
    //         if (logFlags.verbose) this.mainLogger.debug(`POQo: received data & receipt for ${queueEntry.logID} starting receipt gossip`)
    //         queueEntry.poqoReceipt = payload.receipt
    //         queueEntry.appliedReceipt2 = payload.receipt
    //         queueEntry.recievedAppliedReceipt2 = payload.receipt
    //         payload.txGroupCycle = queueEntry.txGroupCycle
    //         Comms.sendGossip(
    //           'poqo-receipt-gossip',
    //           payload.receipt,
    //           null,
    //           null,
    //           queueEntry.transactionGroup,
    //           false,
    //           4,
    //           payload.finalState.txid,
    //           '',
    //           true
    //         )
    //         queueEntry.hasSentFinalReceipt = true
    //       }

    //       if (logFlags.debug)
    //         this.mainLogger.debug(`poqo-data-and-receipt ${queueEntry.logID}, ${Utils.safeStringify(payload.finalState.stateList)}`)
    //       // add the data in
    //       const savedAccountIds: Set<string> = new Set()
    //       for (const data of payload.finalState.stateList) {
    //         //let wrappedResponse = data as Shardus.WrappedResponse
    //         //this.queueEntryAddData(queueEntry, data)
    //         if (data == null) {
    //           /* prettier-ignore */ if (logFlags.error && logFlags.verbose) this.mainLogger.error(`poqo-data-and-receipt data == null`)
    //           continue
    //         }

    //         if (queueEntry.collectedFinalData[data.accountId] == null) {
    //           queueEntry.collectedFinalData[data.accountId] = data
    //           savedAccountIds.add(data.accountId)
    //           /* prettier-ignore */ if (logFlags.playback && logFlags.verbose) this.logger.playbackLogNote('poqo-data-and-receipt', `${queueEntry.logID}`, `poqo-data-and-receipt addFinalData qId: ${queueEntry.entryID} data:${utils.makeShortHash(data.accountId)} collected keys: ${utils.stringifyReduce(Object.keys(queueEntry.collectedFinalData))}`)
    //         }

    //         // if (queueEntry.state === 'syncing') {
    //         //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_gotBroadcastfinalstate', `${queueEntry.acceptedTx.txId}`, ` qId: ${queueEntry.entryID} data:${data.accountId}`)
    //         // }
    //       }
    //       const nodesToSendTo: Set<Shardus.Node> = new Set()
    //       for (const data of payload.finalState.stateList) {
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
    //        const finalDataToGossip = { ...payload.finalState, txGroupCycle: queueEntry.txGroupCycle }
    //         Comms.sendGossip(
    //           'gossip-final-state',
    //           finalDataToGossip,
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
    //       profilerInstance.scopedProfileSectionEnd('poqo-data-and-receipt')
    //     }
    //   }
    // )

    // Comms.registerInternal(
    //   'poqo-send-receipt',
    //   (
    //     payload: AppliedReceipt2 & { txGroupCycle: number },
    //     _respond: unknown,
    //     _sender: unknown,
    //     _tracker: string,
    //     msgSize: number
    //   ) => {
    //     profilerInstance.scopedProfileSectionStart('poqo-send-receipt', false, msgSize)
    //     try{
    //       const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(payload.txid)
    //       if (queueEntry == null) {
    //         /* prettier-ignore */ nestedCountersInstance.countEvent('poqo', 'poqo-send-receipt: no queue entry found')
    //         return
    //       }
    //       if (payload.txGroupCycle) {
    //         if (queueEntry.txGroupCycle !== payload.txGroupCycle) {
    //           /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-send-receipt mismatch txGroupCycle for txid: ${payload.txid}, sender's txGroupCycle: ${payload.txGroupCycle}, our txGroupCycle: ${queueEntry.txGroupCycle}`)
    //           nestedCountersInstance.countEvent(
    //             'poqo',
    //             'poqo-send-receipt: mismatch txGroupCycle for tx ' + payload.txid
    //           )
    //         }
    //         delete payload.txGroupCycle
    //       }

    //       if (queueEntry.poqoReceipt) {
    //         // We've already handled this
    //         return
    //       }

    //       if (Math.random() < this.debugFailPOQo) {
    //         nestedCountersInstance.countEvent('poqo', 'debug fail wont forward receipt')
    //         return
    //       }

    //       if (logFlags.verbose) this.mainLogger.debug(`POQo: Received receipt from aggregator for ${queueEntry.logID} starting CT2 for data & receipt`)
    //         const executionGroupNodes = new Set(queueEntry.executionGroup.map((node) => node.publicKey))
    //         const hasTwoThirdsMajority = this.verifyAppliedReceipt(payload, executionGroupNodes)
    //         if (!hasTwoThirdsMajority) {
    //           /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Receipt does not have the required majority for txid: ${payload.txid}`)
    //           nestedCountersInstance.countEvent('poqo', 'poqo-send-receipt: Rejecting receipt because no majority')
    //           return
    //         }
    //       const receivedReceipt = payload as AppliedReceipt2
    //       queueEntry.poqoReceipt = receivedReceipt
    //       queueEntry.appliedReceipt2 = receivedReceipt
    //       queueEntry.recievedAppliedReceipt2 = receivedReceipt
    //       queueEntry.hasSentFinalReceipt = true
    //       payload.txGroupCycle = queueEntry.txGroupCycle
    //       Comms.sendGossip(
    //         'poqo-receipt-gossip',
    //         payload,
    //         null,
    //         null,
    //         queueEntry.transactionGroup,
    //         false,
    //         4,
    //         payload.txid,
    //         '',
    //         true
    //       )
    //       this.stateManager.transactionQueue.factTellCorrespondingNodesFinalData(queueEntry)
    //     } finally {
    //       profilerInstance.scopedProfileSectionEnd('poqo-send-receipt')
    //     }
    //   }
    // )

    const poqoSendReceiptBinary: Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_poqo_send_receipt,
      handler: async (payload, respond, header) => {
        const route = InternalRouteEnum.binary_poqo_send_receipt
        this.profiler.scopedProfileSectionStart(route)
        nestedCountersInstance.countEvent('internal', route)
        profilerInstance.scopedProfileSectionStart(route, false, payload.length)

        const errorHandler = (
          errorType: RequestErrorEnum,
          opts?: { customErrorLog?: string; customCounterSuffix?: string }
        ): void => requestErrorHandler(route, errorType, header, opts)

        try {
          const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cPoqoSendReceiptReq)
          if (!requestStream) {
            return errorHandler(RequestErrorEnum.InvalidRequest)
          }

          const readableReq = deserializePoqoSendReceiptReq(requestStream)

          const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(readableReq.proposal.txid)
          if (queueEntry == null) {
            /* prettier-ignore */ nestedCountersInstance.countEvent('poqo', 'binary/poqo_send_receipt: no queue entry found')
            return
          }
          if (readableReq.txGroupCycle) {
            if (queueEntry.txGroupCycle !== readableReq.txGroupCycle) {
              /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`binary_poqo_send_receipt mismatch txGroupCycle for txid: ${readableReq.proposal.txid}, sender's txGroupCycle: ${readableReq.txGroupCycle}, our txGroupCycle: ${queueEntry.txGroupCycle}`)
              nestedCountersInstance.countEvent(
                'poqo',
                'binary_poqo_send_receipt: mismatch txGroupCycle for tx ' + readableReq.proposal.txid
              )
            }
            delete readableReq.txGroupCycle
          }

          if (queueEntry.signedReceipt) {
            // We've already handled this
            return
          }

          const executionGroupNodes = new Set(queueEntry.executionGroup.map((node) => node.publicKey))
          const hasTwoThirdsMajority = this.verifyAppliedReceipt(readableReq, executionGroupNodes)
          if (!hasTwoThirdsMajority) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Receipt does not have the required majority for txid: ${readableReq.proposal.txid}`)
              nestedCountersInstance.countEvent('poqo', 'poqo-send-receipt: Rejecting receipt because no majority')
            return
          }

          if (logFlags.verbose)
            this.mainLogger.debug(
              `POQo: Received receipt from aggregator for ${queueEntry.logID} starting CT2 for data & receipt`
            )
          const receivedReceipt = readableReq as SignedReceipt
          queueEntry.signedReceipt = receivedReceipt
          queueEntry.hasSentFinalReceipt = true
          const receiptToGossip = { ...readableReq, txGroupCycle: queueEntry.txGroupCycle }
          Comms.sendGossip(
            'poqo-receipt-gossip',
            receiptToGossip,
            null,
            null,
            queueEntry.transactionGroup,
            false,
            4,
            readableReq.proposal.txid,
            '',
            true
          )
          this.stateManager.transactionQueue.factTellCorrespondingNodesFinalData(queueEntry)
        } catch (e) {
          console.error(`Error processing poqoSendReceiptBinary handler: ${e}`)
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          this.mainLogger.error(`${route}: Exception executing request: ${utils.errorToStringFull(e)}`)
        } finally {
          profilerInstance.scopedProfileSectionEnd(route)
        }
      },
    }

    Comms.registerInternalBinary(poqoSendReceiptBinary.name, poqoSendReceiptBinary.handler)

    // Comms.registerInternal(
    //   'poqo-send-vote',
    //   async (
    //     payload: AppliedVoteHash & { txGroupCycle: number },
    //     _respond: unknown,
    //     _sender: unknown,
    //     _tracker: string,
    //     msgSize: number
    //   ) => {
    //     profilerInstance.scopedProfileSectionStart('poqo-send-vote', false, msgSize)
    //     try {
    //       const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(payload.txid)
    //       if (queueEntry == null) {
    //         /* prettier-ignore */ nestedCountersInstance.countEvent('poqo', 'poqo-send-vote: no queue entry found')
    //         return
    //       }
    //      if (payload.txGroupCycle) {
    //        if (queueEntry.txGroupCycle !== payload.txGroupCycle) {
    //          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`poqo-send-vote mismatch txGroupCycle for txid: ${payload.txid}, sender's txGroupCycle: ${payload.txGroupCycle}, our txGroupCycle: ${queueEntry.txGroupCycle}`)
    //          nestedCountersInstance.countEvent(
    //            'poqo',
    //            'poqo-send-vote: mismatch txGroupCycle for tx ' + payload.txid
    //          )
    //        }
    //        delete payload.txGroupCycle
    //      }

    //       const collectedVoteHash = payload as AppliedVoteHash

    //       // Check if vote hash has a sign
    //       if (!collectedVoteHash.sign) {
    //         /* prettier-ignore */ nestedCountersInstance.countEvent('poqo', 'poqo-send-vote: no sign found')
    //         return
    //       }
    //       // We can reuse the same function for POQo
    //       this.tryAppendVoteHash(queueEntry, collectedVoteHash)
    //     } finally {
    //       profilerInstance.scopedProfileSectionEnd('poqo-send-vote')
    //     }
    //   }
    // )

    const poqoSendVoteBinaryHandler: Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_poqo_send_vote,
      handler: (payload, respond, header, sign) => {
        const route = InternalRouteEnum.binary_poqo_send_vote
        profilerInstance.scopedProfileSectionStart(route, false)
        try {
          const stream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cPoqoSendVoteReq)
          if (!payload) {
            nestedCountersInstance.countEvent('internal', `${route}-invalid_request`)
            return
          }
          const readableReq = deserializePoqoSendVoteReq(stream)
          const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(readableReq.txid)
          if (queueEntry == null) {
            /* prettier-ignore */ nestedCountersInstance.countEvent('poqo', 'poqo-send-vote: no queue entry found')
            return
          }
          if (readableReq.txGroupCycle) {
            if (queueEntry.txGroupCycle !== readableReq.txGroupCycle) {
              /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`binary_poqo_send_vote mismatch txGroupCycle for txid: ${readableReq.txid}, sender's txGroupCycle: ${readableReq.txGroupCycle}, our txGroupCycle: ${queueEntry.txGroupCycle}`)
              nestedCountersInstance.countEvent(
                'poqo',
                'binary_poqo_send_vote: mismatch txGroupCycle for tx ' + readableReq.txid
              )
            }
            delete readableReq.txGroupCycle
          }
          const collectedVoteHash = readableReq as AppliedVoteHash

          // Check if vote hash has a sign
          if (!collectedVoteHash.sign) {
            /* prettier-ignore */ nestedCountersInstance.countEvent('poqo', 'poqo-send-vote: no sign found')
            return
          }
          // We can reuse the same function for POQo
          this.tryAppendVoteHash(queueEntry, collectedVoteHash)
        } catch (e) {
          console.error(`Error processing poqoSendVoteBinary handler: ${e}`)
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          this.mainLogger.error(`${route}: Exception executing request: ${utils.errorToStringFull(e)}`)
        } finally {
          profilerInstance.scopedProfileSectionEnd(route)
        }
      },
    }
    Comms.registerInternalBinary(poqoSendVoteBinaryHandler.name, poqoSendVoteBinaryHandler.handler)
  }

  verifyAppliedReceipt(receipt: SignedReceipt, executionGroupNodes: Set<string>): boolean {
    const ownerToSignMap = new Map<string, Shardus.Sign>();
    for (const sign of receipt.signaturePack) {
      if (executionGroupNodes.has(sign.owner)) {
        ownerToSignMap.set(sign.owner, sign);
      }
    }
    const totalNodes = executionGroupNodes.size;
    const requiredMajority = Math.ceil(totalNodes * this.config.p2p.requiredVotesPercentage)
    if (ownerToSignMap.size < requiredMajority) {
      return false;
    }

    const appliedVoteHash = {
      txid: receipt.proposal.txid,
      voteHash: receipt.proposalHash,
    }

    let validSignatures = 0;    
    for (const owner of ownerToSignMap.keys()) {
      const signedObject = { ...appliedVoteHash, sign: ownerToSignMap.get(owner) };
      if (this.crypto.verify(signedObject, owner)) {
        validSignatures++;
      }
    }
    return validSignatures >= requiredMajority;
  }

  async poqoVoteSendLoop(queueEntry: QueueEntry, appliedVoteHash: AppliedVoteHash): Promise<void> {
    queueEntry.poqoNextSendIndex = 0
    const aggregatorList = queueEntry.executionGroup
    while (!queueEntry.poqoReceipt) {
      if (queueEntry.poqoNextSendIndex >= aggregatorList.length) {
        // Maybe use modulous to wrap around
        break
      }
      nestedCountersInstance.countEvent('poqo', `At index ${queueEntry.poqoNextSendIndex} in poqoVoteSendLoop`)
      const voteReceivers = aggregatorList.slice(
        queueEntry.poqoNextSendIndex, queueEntry.poqoNextSendIndex + this.config.stateManager.poqobatchCount
      )
      queueEntry.poqoNextSendIndex += this.config.stateManager.poqobatchCount
      // Send vote to the selected aggregator in the priority list
      // TODO: Add SIGN here to the payload
      // if(this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.poqoSendVoteBinary){
        Comms.tellBinary<AppliedVoteHash>(
          voteReceivers, 
          InternalRouteEnum.binary_poqo_send_vote, 
          appliedVoteHash, 
          serializePoqoSendVoteReq,
          {}
        )
      // }else{
      //   Comms.tell(voteReceivers, 'poqo-send-vote', appliedVoteHash)
      // }
      await utils.sleep(this.config.stateManager.poqoloopTime)
    }
  }

  generateTimestampReceipt(
    txId: string,
    cycleMarker: string,
    cycleCounter: CycleRecord['counter']
  ): TimestampReceipt {
    const tsReceipt: TimestampReceipt = {
      txId,
      cycleMarker,
      cycleCounter,
      // shardusGetTime() was replaced with shardusGetTime() so we can have a more reliable timestamp consensus
      timestamp: shardusGetTime(),
    }
    const signedTsReceipt = this.crypto.sign(tsReceipt)
    /* prettier-ignore */ this.mainLogger.debug(`Timestamp receipt generated for txId ${txId}: ${utils.stringifyReduce(signedTsReceipt)}`)

    // caching ts receipt for later nodes
    if (!this.txTimestampCache.has(signedTsReceipt.cycleCounter)) {
      this.txTimestampCache.set(signedTsReceipt.cycleCounter, new Map())
    }

    // cache to txId map
    this.txTimestampCache.get(signedTsReceipt.cycleCounter).set(txId, signedTsReceipt)
    if (Context.config.p2p.timestampCacheFix) {
      // eslint-disable-next-line security/detect-object-injection
      this.txTimestampCacheByTxId.set(txId, signedTsReceipt)
      this.seenTimestampRequests.add(txId) 
    }
    /* prettier-ignore */ this.mainLogger.debug(`Timestamp receipt cached for txId ${txId} in cycle ${signedTsReceipt.cycleCounter}: ${utils.stringifyReduce(signedTsReceipt)}`)
    return signedTsReceipt
  }

  pruneTxTimestampCache(): void {
    let cycleToKeepCache = 1
    if (Context.config.p2p.timestampCacheFix) {
      cycleToKeepCache = 2
    }

    for ( const [cycleCounter, txMap] of this.txTimestampCache.entries()) {
      const cycleCounterInt = parseInt(cycleCounter as string)
      const shouldPruneThisCounter = cycleCounterInt + cycleToKeepCache < CycleChain.newest.counter
      if (shouldPruneThisCounter) {
        for (const txId of txMap.keys()) {
          if (Context.config.p2p.timestampCacheFix) {
            this.txTimestampCacheByTxId.delete(txId)
            this.seenTimestampRequests.delete(txId)
          }
        }
        this.txTimestampCache.delete(cycleCounter)
      }
    }

    if (logFlags.debug) this.mainLogger.debug(`Pruned tx timestamp cache.`)
  }

  async askTxnTimestampFromNode(txId: string): Promise<Shardus.TimestampReceipt | null> {
    const homeNode = ShardFunctions.findHomeNode(
      Context.stateManager.currentCycleShardData.shardGlobals,
      txId,
      Context.stateManager.currentCycleShardData.parititionShardDataMap
    )
    const cycleMarker = CycleChain.computeCycleMarker(CycleChain.newest)
    const cycleCounter = CycleChain.newest.counter
    /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('Asking timestamp from node', homeNode.node)

    if (homeNode.node.id === Self.id) {
      // we generate the tx timestamp by ourselves
      return this.generateTimestampReceipt(txId, cycleMarker, cycleCounter)
    } else {
      let timestampReceipt
      try {
        // if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.getTxTimestampBinary) {
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455101 ${shardusGetTime()} tx:${txId} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(homeNode.node.id)}: ${'get_tx_timestamp'}`)
          const serialized_res = await this.p2p.askBinary<getTxTimestampReq, getTxTimestampResp>(
            homeNode.node,
            InternalRouteEnum.binary_get_tx_timestamp,
            {
              cycleMarker,
              cycleCounter,
              txId,
            },
            serializeGetTxTimestampReq,
            deserializeGetTxTimestampResp,
            {}
          )

          timestampReceipt = serialized_res
        // } else {
          // timestampReceipt = await Comms.ask(homeNode.node, 'get_tx_timestamp', {
          //   cycleMarker,
          //   cycleCounter,
          //   txId,
          // })
        // }
      } catch (e) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Error asking timestamp from node ${homeNode.node.publicKey}: ${e.message}`)
        return null
      }

      // this originiates from network/ask level, isResponse might get added at any step to this object
      // This line will remove the isResponse property from timestampReceipt if it exists. If it doesn't exist, nothing happens, and the program continues to run without any issues.
      delete timestampReceipt.isResponse

      const isValid = this.crypto.verify(timestampReceipt, homeNode.node.publicKey)
      if (isValid) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`Timestamp receipt received from home node. TxId: ${txId} isValid: ${isValid}, timestampReceipt: ${Utils.safeStringify(timestampReceipt)}`)
        return timestampReceipt
      } else {
        /* prettier-ignore */ if (logFlags.fatal) this.mainLogger.fatal(`Timestamp receipt received from home node ${homeNode.node.publicKey} is not valid. ${utils.stringifyReduce(timestampReceipt)}`)
        return null
      }
    }
  }

  /**
   * shareAppliedReceipt
   * gossip the appliedReceipt to the transaction group
   * @param queueEntry
   */
  shareAppliedReceipt(queueEntry: QueueEntry): void {
    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_shareAppliedReceipt', `${queueEntry.logID}`, `qId: ${queueEntry.entryID} `)

    if (queueEntry.appliedReceipt2 == null) {
      //take no action
      /* prettier-ignore */ nestedCountersInstance.countEvent('transactionQueue', 'shareAppliedReceipt-skipped appliedReceipt2 == null')
      return
    }

    // share the appliedReceipt.
    const sender = null
    const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)

    // todo only recalc if cycle boundry?
    // let updatedGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry, true)

    if (gossipGroup.length > 1) {
      if (queueEntry.ourNodeInTransactionGroup === false) {
        return
      }

      // This code tried to optimize things by not having every node share a receipt.

      // //look at our index in the consensus.
      // //only have certain nodes sharde gossip the receipt.
      // let ourIndex = queueEntry.ourTXGroupIndex
      // let groupLength = gossipGroup.length
      // if(this.stateManager.transactionQueue.executeInOneShard){
      //   //we have to use different inputs if executeInOneShard is true
      //   ourIndex = queueEntry.ourExGroupIndex
      //   groupLength = queueEntry.executionGroup.length
      // }

      // if(ourIndex > 0){
      //   let everyN = Math.max(1,Math.floor(groupLength * 0.4))
      //   let nonce = parseInt('0x' + queueEntry.acceptedTx.txId.substr(0,2))
      //   let idxPlusNonce = ourIndex + nonce
      //   let idxModEveryN = idxPlusNonce % everyN
      //   if(idxModEveryN > 0){
      //     nestedCountersInstance.countEvent('transactionQueue', 'shareAppliedReceipt-skipped')
      //     /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shareAppliedReceipt-skipped', `${queueEntry.acceptedTx.txId}`, `ourIndex:${ourIndex} groupLength:${ourIndex} `)
      //     return
      //   }
      // }

      nestedCountersInstance.countEvent('transactionQueue', 'shareAppliedReceipt-notSkipped')
      // should consider only forwarding in some cases?
      this.stateManager.debugNodeGroup(
        queueEntry.acceptedTx.txId,
        queueEntry.acceptedTx.timestamp,
        `share appliedReceipt to neighbors`,
        gossipGroup
      )
      let payload: any = queueEntry.appliedReceipt2
      const receipt2 = this.stateManager.getReceipt2(queueEntry)
      if (receipt2 == null) {
        nestedCountersInstance.countEvent('transactionQueue', 'shareAppliedReceipt-receipt2 == null')
        return
      }

      if (Context.config.stateManager.attachDataToReceipt) {
        // Report data to corresponding nodes
        const ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
        const datas: { [accountID: string]: Shardus.WrappedResponse } = {}

        const applyResponse = queueEntry.preApplyTXResult.applyResponse
        let wrappedStates = this.stateManager.useAccountWritesOnly ? {} : queueEntry.collectedData
        const writtenAccountsMap: WrappedResponses = {}
        if (applyResponse != null && applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
          for (const writtenAccount of applyResponse.accountWrites) {
            writtenAccountsMap[writtenAccount.accountId] = writtenAccount.data
            writtenAccountsMap[writtenAccount.accountId].prevStateId = wrappedStates[writtenAccount.accountId]
              ? wrappedStates[writtenAccount.accountId].stateId
              : ''
            writtenAccountsMap[writtenAccount.accountId].prevDataCopy = null

            datas[writtenAccount.accountId] = writtenAccount.data
          }
          //override wrapped states with writtenAccountsMap which should be more complete if it included
          wrappedStates = writtenAccountsMap
        }
        if (receipt2.confirmOrChallenge?.message === 'challenge') {
          wrappedStates = {}
        }
        payload = { receipt: queueEntry.appliedReceipt2, wrappedStates }
      }

      //let payload = queueEntry.recievedAppliedReceipt2 ?? queueEntry.appliedReceipt2
      this.p2p.sendGossipIn('spread_appliedReceipt2', payload, '', sender, gossipGroup, false, -1, queueEntry.acceptedTx.txId)
      if (logFlags.debug) this.mainLogger.debug(`shareAppliedReceipt ${queueEntry.logID} sent gossip`)
    }
  }

  /**
   * hasAppliedReceiptMatchingPreApply
   * check if our data matches our vote
   * If the vote was for an appliable, on failed result then check if our local data
   * that is ready to be committed will match the receipt
   *
   * @param queueEntry
   */
  hasAppliedReceiptMatchingPreApply(queueEntry: QueueEntry, signedReceipt: SignedReceipt): boolean {
    if (queueEntry.preApplyTXResult == null || queueEntry.preApplyTXResult.applyResponse == null) {
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} preApplyTXResult == null or applyResponse == null`)
      return false
    }
    // This is much easier than the old way
    if (queueEntry.ourVote) {
      const receipt = queueEntry.signedReceipt
      if (receipt != null && queueEntry.ourVoteHash != null) {
        const receiptVoteHash = this.calculateVoteHash(receipt.proposal)
        if (receiptVoteHash === queueEntry.ourVoteHash) {
          return true
        } else {
          /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} voteHashes do not match, ${receiptVoteHash} != ${queueEntry.ourVoteHash} `)
          return false
        }
      }
      return false
    }

    if (signedReceipt == null) {
      return false
    }

    if (queueEntry.ourVote == null) {
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} ourVote == null`)
      return false
    }

    if (signedReceipt != null) {
      if (signedReceipt.proposal.applied !== queueEntry.ourProposal.applied) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} ${signedReceipt.proposal.applied}, ${queueEntry.ourProposal.applied} signedReceipt.result !== queueEntry.ourProposal.applied`)
        return false
      }
      if (signedReceipt.proposal.txid !== queueEntry.ourProposal.txid) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} signedReceipt.txid !== queueEntry.ourProposal.txid`)
        return false
      }
      if (signedReceipt.signaturePack.length === 0) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} signedReceipt.signaturePack.length == 0`)
        return false
      }

      if (signedReceipt.proposal.cant_preApply === true) {
        // TODO STATESHARDING4 NEGATIVECASE    need to figure out what to do here
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} signedReceipt.proposal.cant_preApply === true`)
        //If the network votes for cant_apply then we wouldn't need to patch.  We return true here
        //but outside logic will have to know to check cant_apply flag and make sure to not commit data
        return true
      }

      //we return true for a false receipt because there is no need to repair our data to match the receipt
      //it is already checked above if we matched the result
      if (signedReceipt.proposal.applied === false) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} applied===false Good Match`)
        return true
      }

      //test our data against a winning vote in the receipt
      let wrappedStates = this.stateManager.useAccountWritesOnly ? {} : queueEntry.collectedData

      let wrappedStateKeys = Object.keys(queueEntry.collectedData)
      // const vote = appliedReceipt.appliedVotes[0] //all votes are equivalent, so grab the first

      // Iff we have accountWrites, then overwrite the keys and wrapped data
      const appOrderedKeys = []
      const writtenAccountsMap: WrappedResponses = {}
      const applyResponse = queueEntry?.preApplyTXResult?.applyResponse
      if (applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
        for (const wrappedAccount of applyResponse.accountWrites) {
          appOrderedKeys.push(wrappedAccount.accountId)
          writtenAccountsMap[wrappedAccount.accountId] = wrappedAccount.data
        }
        wrappedStateKeys = appOrderedKeys
        //override wrapped states with writtenAccountsMap which should be more complete if it included
        wrappedStates = writtenAccountsMap
      }

      // Not sure if we should keep this.  it may only come up in error cases that would not be using final data in the repair?
      //If we are not in the execution home then use data that was sent to us for the commit
      // if(queueEntry.globalModification === false && this.stateManager.transactionQueue.executeInOneShard && queueEntry.isInExecutionHome === false){
      //   wrappedStates = {}
      //   let timestamp = queueEntry.acceptedTx.timestamp
      //   for(let key of Object.keys(queueEntry.collectedFinalData)){
      //     let finalAccount = queueEntry.collectedFinalData[key]
      //     let accountId = finalAccount.accountId
      //     let prevStateCalc = wrappedStates[accountId] ? wrappedStates[accountId].stateId : ''
      //     /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply collectedFinalData tx:${queueEntry.logID} ts:${timestamp} ${utils.makeShortHash(finalAccount)} preveStateID: ${finalAccount.prevStateId } vs expected: ${prevStateCalc}`)

      //     wrappedStates[key] = finalAccount
      //   }
      //   /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply collectedFinalData tx:${queueEntry.logID} ts:${timestamp} accounts: ${utils.stringifyReduce(Object.keys(wrappedStates))}  `)
      // }

      for (let j = 0; j < signedReceipt.proposal.accountIDs.length; j++) {
        /* eslint-disable security/detect-object-injection */
        const id = signedReceipt.proposal.accountIDs[j]
        const hash = signedReceipt.proposal.afterStateHashes[j]
        let found = false
        for (const key of wrappedStateKeys) {
          const wrappedState = wrappedStates[key]
          if (wrappedState.accountId === id) {
            found = true
            // I don't believe this leaks timing info over the net
            // eslint-disable-next-line security/detect-possible-timing-attacks
            if (wrappedState.stateId !== hash) {
              /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} state does not match id:${utils.stringifyReduce(id)} hash:${utils.stringifyReduce(wrappedState.stateId)} votehash:${utils.stringifyReduce(hash)}`)
              return false
            }
          }
        }
        if (found === false) {
          /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} state does not match missing id:${utils.stringifyReduce(id)} `)
          /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} collectedData:${utils.stringifyReduce(Object.keys(queueEntry.collectedData))} `)

          return false
        }
        /* eslint-enable security/detect-object-injection */
      }

      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} Good Match`)
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('hasAppliedReceiptMatchingPreApply', `${queueEntry.logID}`, `  Good Match`)
    }

    return true
  }

  /**
   * tryProduceReceipt
   * try to produce an AppliedReceipt
   * if we can't do that yet return null
   *
   * @param queueEntry
   */
  async tryProduceReceipt(queueEntry: QueueEntry): Promise<SignedReceipt> {
    this.profiler.profileSectionStart('tryProduceReceipt')
    if (logFlags.profiling_verbose) this.profiler.scopedProfileSectionStart('tryProduceReceipt')
    try {
      if (queueEntry.waitForReceiptOnly === true) {
        if (logFlags.debug)
          this.mainLogger.debug(`tryProduceReceipt ${queueEntry.logID} waitForReceiptOnly === true`)
        nestedCountersInstance.countEvent(`consensus`, 'tryProduceReceipt waitForReceiptOnly === true')
        return null
      }

      // TEMP hack.. allow any node to try and make a receipt
      // if (this.stateManager.transactionQueue.executeInOneShard && queueEntry.isInExecutionHome === false) {
      //   return null
      // }

      if (queueEntry.signedReceipt != null) {
        nestedCountersInstance.countEvent(`consensus`, 'tryProduceReceipt appliedReceipt != null')
        if (logFlags.debug) this.mainLogger.debug(`tryProduceReceipt ${queueEntry.logID} appliedReceipt != null`)
        return queueEntry.signedReceipt
      }

      if (queueEntry.queryingRobustConfirmOrChallenge === true) {
        nestedCountersInstance.countEvent(
          `consensus`,
          'tryProduceReceipt in the middle of robust query confirm or challenge'
        )
        return null
      }

      // Design TODO:  should this be the full transaction group or just the consensus group?
      let votingGroup: Shardus.NodeWithRank[] | P2PTypes.NodeListTypes.Node[]

      if (this.stateManager.transactionQueue.usePOQo === true) {
        votingGroup = queueEntry.executionGroup
      } else if (
        this.stateManager.transactionQueue.executeInOneShard &&
        this.stateManager.transactionQueue.useNewPOQ === false
      ) {
        //use execuiton group instead of full transaciton group, since only the execution group will run the transaction
        votingGroup = queueEntry.executionGroup
      } else {
        votingGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
      }

      if (this.stateManager.transactionQueue.usePOQo === true) {
        if (Math.random() < this.debugFailPOQo) {
          nestedCountersInstance.countEvent('poqo', 'debug fail no receipt produced')
          return null
        }
        if (queueEntry.ourVote === undefined) {
          // Cannot produce receipt just yet. Wait further.
          // In V2 of POQo, we may not have to check this.
          // further versions could ask other nodes for proposal blob
          return null
        }

        const majorityCount = Math.ceil(votingGroup.length * this.config.p2p.requiredVotesPercentage)

        const numVotes = queueEntry.collectedVoteHashes.length

        if (numVotes < majorityCount) {
          // we need more votes
          return null
        }
        // be smart an only recalculate votes when we see a new vote show up.
        if (queueEntry.newVotes === false) {
          return null
        }
        queueEntry.newVotes = false
        let winningVoteHash: string
        const hashCounts: Map<string, number> = new Map()

        for (let i = 0; i < numVotes; i++) {
          // eslint-disable-next-line security/detect-object-injection
          const currentVote = queueEntry.collectedVoteHashes[i]
          const voteCount = hashCounts.get(currentVote.voteHash) || 0
          hashCounts.set(currentVote.voteHash, voteCount + 1)
          if (voteCount + 1 > majorityCount) {
            winningVoteHash = currentVote.voteHash
            break
          }
        }

        if (winningVoteHash != undefined) {
          // For V1 of POQo check if our voteHash matches the winning hash
          // If not, do not generate a receipt and log it
          // In later versions of POQo, we should get the proposal blob from a winning node
          if (queueEntry.ourVoteHash !== winningVoteHash) {
            nestedCountersInstance.countEvent('poqo', 'My votehash did not match consensed vote hash. Not producing receipt.')
            return
          }

          //make the new receipt.
          const signedReceipt: SignedReceipt = {
            proposal: queueEntry.ourProposal,
            proposalHash: queueEntry.ourVoteHash,
            signaturePack: []
          }
          for (let i = 0; i < numVotes; i++) {
            // eslint-disable-next-line security/detect-object-injection
            const currentVote = queueEntry.collectedVoteHashes[i]
            if (currentVote.voteHash === winningVoteHash) {
              signedReceipt.signaturePack.push(currentVote.sign)
            }
          }
          // now send it !!!

          // for (let i = 0; i < queueEntry.ourVote.account_id.length; i++) {
          //   /* eslint-disable security/detect-object-injection */
          //   if (queueEntry.ourVote.account_id[i] === 'app_data_hash') {
          //     appliedReceipt2.app_data_hash = queueEntry.ourVote.account_state_hash_after[i]
          //     break
          //   }
          //   /* eslint-enable security/detect-object-injection */
          // }

          queueEntry.signedReceipt = signedReceipt
          

          //this is a temporary hack to reduce the ammount of refactor needed.
          // const appliedReceipt: AppliedReceipt = {
          //   txid: queueEntry.acceptedTx.txId,
          //   result: queueEntry.ourVote.transaction_result,
          //   appliedVotes: [queueEntry.ourVote],
          //   confirmOrChallenge: [], // TODO: Do we remove this for POQo??
          //   app_data_hash: appliedReceipt2.app_data_hash,
          // }
          // queueEntry.appliedReceipt = appliedReceipt

          const payload = { ...signedReceipt, txGroupCycle: queueEntry.txGroupCycle }
          // tellx128 the receipt to the entire execution group
          // if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.poqoSendReceiptBinary) {
           
            Comms.tellBinary<PoqoSendReceiptReq>(
              votingGroup,
              InternalRouteEnum.binary_poqo_send_receipt,
              payload,
              serializePoqoSendReceiptReq,
              {}
            )
          // } else {
          //   Comms.tell(votingGroup, 'poqo-send-receipt', payload)
          // }

          // we are checking this here, because factTellCorrespondingNodesFinalData will throw and eror if we have no
          // preApplyTXResult.   The issue is that we may have a TX that has consensed on the idea that we should not apply a change
          // it is still important to gossip this receipt so and move forward so we can remove it from the queue.
          // This means we dont want to panic on a missing preApplyTXResult
          if (queueEntry.preApplyTXResult != null && queueEntry.preApplyTXResult.applyResponse != null) {
            // Corresponding tell of receipt+data to entire transaction group
            this.stateManager.transactionQueue.factTellCorrespondingNodesFinalData(queueEntry)
          } else {
            // however if we have a missing preApplyTXResult but the result is false we should log a count 
            // as this may be an error condition to look out for
            // note: appliedReceipt2.result comes from queueEntry.ourVote.transaction_result which comes from PreApplyAcceptedTransactionResult.passed
            // it will be false if the apply funciton throws an error to signal that it was not possible apply

            if(signedReceipt.proposal.applied === true){
              // if we have a receipt with a positive result we should not have a null preApplyTXResult
              /* prettier-ignore */ nestedCountersInstance.countEvent('poqo', `error: unexpected preApplyTXResult == null while result === true.  preApplyTXResult:${queueEntry.preApplyTXResult != null} applyResponse:${queueEntry.preApplyTXResult?.applyResponse != null}`)
              /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`error: unexpected preApplyTXResult == null while result === true ${queueEntry.logID}   preApplyTXResult:${queueEntry.preApplyTXResult != null}  applyResponse:${queueEntry.preApplyTXResult?.applyResponse != null}`)
            } else {
              /* prettier-ignore */ nestedCountersInstance.countEvent('poqo', `expected skip fact tell preApplyTXResult == null while result === false.  preApplyTXResult:${queueEntry.preApplyTXResult != null}  applyResponse:${queueEntry.preApplyTXResult?.applyResponse != null}`)
            }
          }
          // Kick off receipt-gossip
          queueEntry.hasSentFinalReceipt = true
          Comms.sendGossip(
            'poqo-receipt-gossip',
            payload,
            null,
            null,
            queueEntry.transactionGroup,
            false,
            4,
            queueEntry.acceptedTx.txId,
            '',
            true
          )
          return signedReceipt
        }
      } else if (this.stateManager.transactionQueue.useNewPOQ === false) {
        const requiredVotes = Math.round(votingGroup.length * this.config.p2p.requiredVotesPercentage) //hacky for now.  debug code:

        if (queueEntry.debug.loggedStats1 == null) {
          queueEntry.debug.loggedStats1 = true
          nestedCountersInstance.countEvent('transactionStats', ` votingGroup:${votingGroup.length}`)
        }

        const numVotes = queueEntry.collectedVoteHashes.length

        if (numVotes < requiredVotes) {
          // we need more votes
          return null
        }

        // be smart an only recalculate votes when we see a new vote show up.
        if (queueEntry.newVotes === false) {
          return null
        }
        queueEntry.newVotes = false
        let mostVotes = 0
        let winningVoteHash: string
        const hashCounts: Map<string, number> = new Map()

        for (let i = 0; i < numVotes; i++) {
          // eslint-disable-next-line security/detect-object-injection
          const currentVote = queueEntry.collectedVoteHashes[i]
          const voteCount = hashCounts.get(currentVote.voteHash)
          let updatedVoteCount: number
          if (voteCount === undefined) {
            updatedVoteCount = 1
          } else {
            updatedVoteCount = voteCount + 1
          }
          hashCounts.set(currentVote.voteHash, updatedVoteCount)
          if (updatedVoteCount > mostVotes) {
            mostVotes = updatedVoteCount
            winningVoteHash = currentVote.voteHash
          }
        }

        if (mostVotes < requiredVotes) {
          return null
        }

        if (winningVoteHash != undefined) {
          //make the new receipt.
          const appliedReceipt2: AppliedReceipt2 = {
            txid: queueEntry.acceptedTx.txId,
            result: undefined,
            appliedVote: undefined,
            confirmOrChallenge: null,
            signatures: [],
            app_data_hash: '',
            // transaction_result: false //this was missing before..
          }
          for (let i = 0; i < numVotes; i++) {
            // eslint-disable-next-line security/detect-object-injection
            const currentVote = queueEntry.collectedVoteHashes[i]
            if (currentVote.voteHash === winningVoteHash) {
              appliedReceipt2.signatures.push(currentVote.sign)
            }
          }
          //result and appliedVote must be set using a winning vote..
          //we may not have this yet

          if (queueEntry.ourVote != null && queueEntry.ourVoteHash === winningVoteHash) {
            appliedReceipt2.result = queueEntry.ourVote.transaction_result
            appliedReceipt2.appliedVote = queueEntry.ourVote
            // now send it !!!

            queueEntry.appliedReceipt2 = appliedReceipt2

            for (let i = 0; i < queueEntry.ourVote.account_id.length; i++) {
              /* eslint-disable security/detect-object-injection */
              if (queueEntry.ourVote.account_id[i] === 'app_data_hash') {
                appliedReceipt2.app_data_hash = queueEntry.ourVote.account_state_hash_after[i]
                break
              }
              /* eslint-enable security/detect-object-injection */
            }

            //this is a temporary hack to reduce the ammount of refactor needed.
            const appliedReceipt: AppliedReceipt = {
              txid: queueEntry.acceptedTx.txId,
              result: queueEntry.ourVote.transaction_result,
              appliedVotes: [queueEntry.ourVote],
              confirmOrChallenge: [],
              app_data_hash: appliedReceipt2.app_data_hash,
            }
            queueEntry.appliedReceipt = appliedReceipt

            return appliedReceipt
          }
        }
      } else {
        if (queueEntry.completedConfirmedOrChallenge === false && queueEntry.isInExecutionHome) {
          if (this.stateManager.consensusLog || logFlags.debug)
            this.mainLogger.info(
              `tryProduceReceipt ${queueEntry.logID} completedConfirmedOrChallenge === false and isInExecutionHome`
            )
          nestedCountersInstance.countEvent('consensus', 'tryProduceReceipt still in confirm/challenge stage')
          return
        }
        const now = shardusGetTime()
        const timeSinceLastConfirmOrChallenge =
          queueEntry.lastConfirmOrChallengeTimestamp > 0
            ? now - queueEntry.lastConfirmOrChallengeTimestamp
            : 0
        const timeSinceFirstMessage =
          queueEntry.firstConfirmOrChallengeTimestamp > 0
            ? now - queueEntry.firstConfirmOrChallengeTimestamp
            : 0
        const hasWaitedLongEnough =
          timeSinceLastConfirmOrChallenge >= this.config.stateManager.waitTimeBeforeReceipt
        const hasWaitLimitReached =
          timeSinceFirstMessage >= this.config.stateManager.waitLimitAfterFirstMessage
        if (logFlags.debug)
          this.mainLogger.debug(
            `tryProduceReceipt: ${queueEntry.logID} hasWaitedLongEnough: ${hasWaitedLongEnough}, hasWaitLimitReached: ${hasWaitLimitReached}, timeSinceLastConfirmOrChallenge: ${timeSinceLastConfirmOrChallenge} ms, timeSinceFirstMessage: ${timeSinceFirstMessage} ms`
          )
        // check if last vote confirm/challenge received is waitTimeBeforeReceipt ago
        if (timeSinceLastConfirmOrChallenge >= this.config.stateManager.waitTimeBeforeReceipt) {
          // stop accepting the vote messages, confirm or challenge for this tx
          queueEntry.acceptConfirmOrChallenge = false
          nestedCountersInstance.countEvent('consensus', 'tryProduceReceipt hasWaitedLongEnough: true')
          if (logFlags.debug)
            this.mainLogger.debug(
              `tryProduceReceipt: ${queueEntry.logID} stopped accepting confirm/challenge messages`
            )

          if (logFlags.debug) this.mainLogger.debug(`tryProduceReceipt: ${queueEntry.logID} ready to decide final receipt. bestReceivedChallenge: ${utils.stringifyReduce(queueEntry.receivedBestChallenge)}, bestReceivedConfirmation: ${utils.stringifyReduce(queueEntry.receivedBestConfirmation)}, receivedBestConfirmedNode: ${utils.stringifyReduce(queueEntry.receivedBestConfirmedNode)}`) // prettier-ignore
          if (this.stateManager.consensusLog) {
            this.mainLogger.debug(`tryProduceReceipt: ${queueEntry.logID} ready to decide final receipt.`)
            this.mainLogger.debug(
              `tryProduceReceipt: ${queueEntry.logID} uniqueChallengesCount: ${queueEntry.uniqueChallengesCount}`
            )
          }

          // we have received challenge message, produce failed receipt
          if (
            queueEntry.receivedBestChallenge &&
            queueEntry.receivedBestChallenger &&
            queueEntry.uniqueChallengesCount >= this.config.stateManager.minRequiredChallenges
          ) {
            nestedCountersInstance.countEvent('consensus', 'tryProduceReceipt producing fail receipt from unique challenges')
            const appliedReceipt: AppliedReceipt = {
              txid: queueEntry.receivedBestChallenge.appliedVote.txid,
              result: false,
              appliedVotes: [queueEntry.receivedBestChallenge.appliedVote],
              confirmOrChallenge: [queueEntry.receivedBestChallenge],
              app_data_hash: queueEntry.receivedBestChallenge.appliedVote.app_data_hash,
            }
            const appliedReceipt2: AppliedReceipt2 = {
              txid: queueEntry.receivedBestChallenge.appliedVote.txid,
              result: false,
              appliedVote: queueEntry.receivedBestChallenge.appliedVote,
              confirmOrChallenge: queueEntry.receivedBestChallenge,
              app_data_hash: queueEntry.receivedBestChallenge.appliedVote.app_data_hash,
              signatures: [queueEntry.receivedBestChallenge.appliedVote.sign],
            }
            if (logFlags.debug)
              this.mainLogger.debug(
                `tryProduceReceipt: ${
                  queueEntry.logID
                } producing a fail receipt based on received challenge message. appliedReceipt: ${utils.stringifyReduce(
                  appliedReceipt2
                )}`
              )

            // todo: we still need to check if we have a better challenge receipt from robust query ??
            const robustQueryResult = await this.robustQueryConfirmOrChallenge(queueEntry)
            const robustConfirmOrChallenge = robustQueryResult?.result
            const robustUniqueCount = robustQueryResult?.uniqueCount
            if (this.stateManager.consensusLog) {
              this.mainLogger.debug(
                `tryProduceReceipt: ${queueEntry.logID} robustChallenge: ${utils.stringifyReduce(
                  robustConfirmOrChallenge
                )}, robustUniqueCount: ${robustUniqueCount}`
              )
            }
            if (robustConfirmOrChallenge == null) {
              nestedCountersInstance.countEvent(
                'consensus',
                'tryProduceReceipt robust query for challenge failed'
              )
              if (logFlags.debug)
                this.mainLogger.debug(
                  `tryProduceReceipt: ${queueEntry.logID} failed to query robust challenge`
                )
              return
            }
            queueEntry.robustQueryConfirmOrChallengeCompleted = true

            // Received a confrim receipt. We have a challenge receipt which is better.
            if (robustConfirmOrChallenge && robustConfirmOrChallenge.message === 'confirm') {
              if (logFlags.debug)
                this.mainLogger.debug(
                  `tryProduceReceipt: ${queueEntry.logID} received a confirm message. We have enough challenge messages which is better`
                )
              // just use our challenge receipt and return
              queueEntry.appliedReceipt = appliedReceipt
              queueEntry.appliedReceipt2 = appliedReceipt2
              return appliedReceipt
            }

            // Received another challenge receipt. Compare ranks. Lower is better
            let bestNodeFromRobustQuery: Shardus.NodeWithRank
            if (queueEntry.executionGroupMap.has(robustConfirmOrChallenge.nodeId)) {
              bestNodeFromRobustQuery = queueEntry.executionGroupMap.get(
                robustConfirmOrChallenge.nodeId
              ) as Shardus.NodeWithRank
            }
            const isRobustQueryNodeBetter = bestNodeFromRobustQuery.rank < queueEntry.receivedBestChallenger.rank
            if (
              isRobustQueryNodeBetter &&
              robustUniqueCount >= this.config.stateManager.minRequiredChallenges
            ) {
              nestedCountersInstance.countEvent(
                'consensus',
                'tryProduceReceipt challenge from network is better than our challenge'
              )
              if (logFlags.debug)
                this.mainLogger.debug(
                  `tryProduceReceipt: ${
                    queueEntry.logID
                  } challenge from robust query is better than our challenge. robustQueryConfirmOrChallenge: ${Utils.safeStringify(
                    robustConfirmOrChallenge
                  )}`
                )
              const robustReceipt: AppliedReceipt = {
                txid: robustConfirmOrChallenge.appliedVote.txid,
                result: false,
                appliedVotes: [robustConfirmOrChallenge.appliedVote],
                confirmOrChallenge: [robustConfirmOrChallenge],
                app_data_hash: robustConfirmOrChallenge.appliedVote.app_data_hash,
              }
              const robustReceipt2: AppliedReceipt2 = {
                txid: robustConfirmOrChallenge.appliedVote.txid,
                result: false,
                appliedVote: robustConfirmOrChallenge.appliedVote,
                confirmOrChallenge: robustConfirmOrChallenge,
                app_data_hash: robustConfirmOrChallenge.appliedVote.app_data_hash,
                signatures: [robustConfirmOrChallenge.appliedVote.sign],
              }
              queueEntry.appliedReceipt = robustReceipt
              queueEntry.appliedReceipt2 = robustReceipt2
              return robustReceipt
            } else {
              nestedCountersInstance.countEvent(
                'consensus',
                'tryProduceReceipt robustQueryConfirmOrChallenge is NOT better'
              )
              /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`tryProduceReceipt: ${queueEntry.logID} challenge from robust query is not better than our challenge. use our challenge: ${utils.stringifyReduce(appliedReceipt2)}`)
              queueEntry.appliedReceipt = appliedReceipt
              queueEntry.appliedReceipt2 = appliedReceipt2
              return appliedReceipt
            }
          }

          // create receipt
          // The receipt for the transactions is the lowest ranked challenge message or if there is no challenge the lowest ranked confirm message
          // loop through "confirm" messages and "challenge" messages to decide the final receipt
          if (queueEntry.receivedBestConfirmation && queueEntry.receivedBestConfirmedNode) {
            const winningVote = queueEntry.receivedBestConfirmation.appliedVote
            const appliedReceipt: AppliedReceipt = {
              txid: winningVote.txid,
              result: winningVote.transaction_result,
              appliedVotes: [winningVote],
              confirmOrChallenge: [queueEntry.receivedBestConfirmation],
              app_data_hash: winningVote.app_data_hash,
            }
            const appliedReceipt2: AppliedReceipt2 = {
              txid: winningVote.txid,
              result: winningVote.transaction_result,
              appliedVote: winningVote,
              confirmOrChallenge: queueEntry.receivedBestConfirmation,
              app_data_hash: winningVote.app_data_hash,
              signatures: [winningVote.sign],
            }
            if (logFlags.debug || this.stateManager.consensusLog)
              this.mainLogger.debug(
                `tryProduceReceipt: ${queueEntry.logID} producing a confirm receipt based on received confirmation message.`
              )
            for (let i = 0; i < winningVote.account_id.length; i++) {
              /* eslint-disable security/detect-object-injection */
              if (winningVote.account_id[i] === 'app_data_hash') {
                appliedReceipt.app_data_hash = winningVote.account_state_hash_after[i]
                appliedReceipt2.app_data_hash = winningVote.account_state_hash_after[i]
                break
              }
              /* eslint-enable security/detect-object-injection */
            }
            // do a robust query to confirm that we have the best receipt
            // (lower the rank of confirm message, the better the receipt is)
            const robustQueryResult = await this.robustQueryConfirmOrChallenge(queueEntry)
            const robustConfirmOrChallenge = robustQueryResult?.result

            if (this.stateManager.consensusLog) {
              this.mainLogger.debug(
                `tryProduceReceipt: ${
                  queueEntry.logID
                } got result robustConfirmOrChallenge: ${utils.stringifyReduce(robustConfirmOrChallenge)}`
              )
            }

            if (robustConfirmOrChallenge == null || robustConfirmOrChallenge.message == null) {
              nestedCountersInstance.countEvent(
                'consensus',
                'tryProduceReceipt robustQueryConfirmOrChallenge confirm failed'
              )
              if (logFlags.debug || this.stateManager.consensusLog)
                this.mainLogger.debug(
                  `tryProduceReceipt: ${queueEntry.logID} failed to query best challenge/message from robust query`
                )
              return // this will prevent OOS
            }
            queueEntry.robustQueryConfirmOrChallengeCompleted = true

            // Received challenge receipt, we have confirm receipt which is not as strong as challenge receipt
            if (robustConfirmOrChallenge.message === 'challenge') {
              nestedCountersInstance.countEvent(
                'consensus',
                'tryProduceReceipt robustQueryConfirmOrChallenge is challenge, we have confirmation'
              )
              const robustReceipt: AppliedReceipt = {
                txid: robustConfirmOrChallenge.appliedVote.txid,
                result: false,
                appliedVotes: [robustConfirmOrChallenge.appliedVote],
                confirmOrChallenge: [robustConfirmOrChallenge],
                app_data_hash: robustConfirmOrChallenge.appliedVote.app_data_hash,
              }
              const robustReceipt2: AppliedReceipt2 = {
                txid: robustConfirmOrChallenge.appliedVote.txid,
                result: false,
                appliedVote: robustConfirmOrChallenge.appliedVote,
                confirmOrChallenge: robustConfirmOrChallenge,
                app_data_hash: robustConfirmOrChallenge.appliedVote.app_data_hash,
                signatures: [robustConfirmOrChallenge.appliedVote.sign],
              }
              queueEntry.appliedReceipt = robustReceipt
              queueEntry.appliedReceipt2 = robustReceipt2
              return robustReceipt
            }
            // mark that we have a robust confirmation, should not expire the tx
            queueEntry.hasRobustConfirmation = true

            // Received another confirm receipt. Compare ranks
            let bestNodeFromRobustQuery: Shardus.NodeWithRank
            if (queueEntry.executionGroupMap.has(robustConfirmOrChallenge.nodeId)) {
              bestNodeFromRobustQuery = queueEntry.executionGroupMap.get(
                robustConfirmOrChallenge.nodeId
              ) as Shardus.NodeWithRank
            }

            const isRobustQueryNodeBetter =
              bestNodeFromRobustQuery.rank < queueEntry.receivedBestConfirmedNode.rank
            if (isRobustQueryNodeBetter) {
              nestedCountersInstance.countEvent(
                'consensus',
                'tryProduceReceipt robustQueryConfirmOrChallenge is better'
              )
              if (this.stateManager.consensusLog) {
                this.mainLogger.debug(
                  `tryProducedReceipt: ${
                    queueEntry.logID
                  } robust confirmation result is better. ${utils.stringifyReduce(robustConfirmOrChallenge)}`
                )
              }
              if (logFlags.debug)
                this.mainLogger.debug(
                  `tryProduceReceipt: ${
                    queueEntry.logID
                  } confirmation from robust query is better than our confirm. bestNodeFromRobust?Query: ${Utils.safeStringify(
                    bestNodeFromRobustQuery
                  )}, queueEntry.receivedBestVoter: ${Utils.safeStringify(
                    queueEntry.receivedBestVoter
                  )}, robustQueryConfirmOrChallenge: ${Utils.safeStringify(robustConfirmOrChallenge)}`
                )
              const robustReceipt: AppliedReceipt = {
                txid: robustConfirmOrChallenge.appliedVote.txid,
                result: robustConfirmOrChallenge.appliedVote.transaction_result,
                appliedVotes: [robustConfirmOrChallenge.appliedVote],
                confirmOrChallenge: [robustConfirmOrChallenge],
                app_data_hash: robustConfirmOrChallenge.appliedVote.app_data_hash,
              }
              const robustReceipt2: AppliedReceipt2 = {
                txid: robustConfirmOrChallenge.appliedVote.txid,
                result: robustConfirmOrChallenge.appliedVote.transaction_result,
                appliedVote: robustConfirmOrChallenge.appliedVote,
                confirmOrChallenge: robustConfirmOrChallenge,
                app_data_hash: robustConfirmOrChallenge.appliedVote.app_data_hash,
                signatures: [robustConfirmOrChallenge.appliedVote.sign],
              }
              queueEntry.appliedReceipt = robustReceipt
              queueEntry.appliedReceipt2 = robustReceipt2
              return robustReceipt
            } else {
              if (this.stateManager.consensusLog) {
                this.mainLogger.debug(
                  `tryProducedReceipt: ${queueEntry.logID} robust confirmation result is NOT better. Using our best received confirmation`
                )
              }
              queueEntry.appliedReceipt = appliedReceipt
              queueEntry.appliedReceipt2 = appliedReceipt2
              return queueEntry.appliedReceipt
            }
          } else {
            nestedCountersInstance.countEvent(
              'consensus',
              'tryProduceReceipt waitedEnough: true. no confirm or challenge received'
            )
            return null
          }
        } else {
          if (logFlags.debug)
            this.mainLogger.debug(
              `tryProduceReceipt: ${queueEntry.logID} not producing receipt yet because timeSinceLastConfirmOrChallenge is ${timeSinceLastConfirmOrChallenge} ms`
            )
        }
      }
      return null
    } catch (e) {
      //if (logFlags.error) this.mainLogger.error(`tryProduceReceipt: error ${queueEntry.logID} error: ${e.message}`)
      /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`tryProduceReceipt: error ${queueEntry.logID} error: ${utils.formatErrorMessage(e)}`)  
    } finally {
      if (logFlags.profiling_verbose) this.profiler.scopedProfileSectionEnd('tryProduceReceipt')
      this.profiler.profileSectionEnd('tryProduceReceipt')
    }
  }

  async robustQueryBestReceipt(queueEntry: QueueEntry): Promise<AppliedReceipt2> {
    this.profiler.profileSectionStart('robustQueryBestReceipt', true)
    this.profiler.scopedProfileSectionStart('robustQueryBestReceipt')
    try {
      const queryFn = async (node: Shardus.Node): Promise<RequestReceiptForTxResp> => {
        const ip = node.externalIp
        const port = node.externalPort
        // the queryFunction must return null if the given node is our own
        if (ip === Self.ip && port === Self.port) return null
        const message: RequestReceiptForTxReq = {
          txid: queueEntry.acceptedTx.txId,
          timestamp: queueEntry.acceptedTx.timestamp,
        }
        return await this.p2p.askBinary<RequestReceiptForTxReqSerialized, RequestReceiptForTxRespSerialized>(
          node,
          InternalRouteEnum.binary_request_receipt_for_tx,
          message,
          serializeRequestReceiptForTxReq,
          deserializeRequestReceiptForTxResp,
          {}
        )
        // return await Comms.ask(node, 'request_receipt_for_tx', message)
      }
      const eqFn = (item1: RequestReceiptForTxResp, item2: RequestReceiptForTxResp): boolean => {
        const deepCompare = (obj1: any, obj2: any): boolean => {
          // If both are null or undefined or exactly the same value
          if (obj1 === obj2) {
            return true
          }

          // If only one is null or undefined
          if (obj1 === null || obj2 === null || typeof obj1 !== 'object' || typeof obj2 !== 'object') {
            return false
          }

          // Compare arrays
          if (Array.isArray(obj1) && Array.isArray(obj2)) {
            if (obj1.length !== obj2.length) {
              return false
            }
            for (let i = 0; i < obj1.length; i++) {
              if (!deepCompare(obj1[i], obj2[i])) {
                return false
              }
            }
            return true
          }

          // Compare objects
          const keys1 = Object.keys(obj1)
          const keys2 = Object.keys(obj2)

          if (keys1.length !== keys2.length) {
            return false
          }

          for (const key of keys1) {
            if (!keys2.includes(key)) {
              return false
            }
            if (!deepCompare(obj1[key], obj2[key])) {
              return false
            }
          }

          return true
        }
        try {
          // Deep compare item.receipt
          return deepCompare(item1.receipt, item2.receipt)
        } catch (err) {
          return false
        }
      }
      const redundancy = 3
      const { topResult: response } = await robustQuery(
        this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry),
        queryFn,
        eqFn,
        redundancy,
        true
      )
      if (response && response.receipt) {
        return response.receipt
      }
    } catch (e) {
      this.mainLogger.error(`robustQueryBestReceipt: ${queueEntry.logID} error: ${e.message}`)
    } finally {
      this.profiler.scopedProfileSectionEnd('robustQueryBestReceipt')
      this.profiler.profileSectionEnd('robustQueryBestReceipt', true)
    }
  }

  async robustQueryBestVote(queueEntry: QueueEntry): Promise<AppliedVote> {
    profilerInstance.profileSectionStart('robustQueryBestVote', true)
    profilerInstance.scopedProfileSectionStart('robustQueryBestVote')
    const txId = queueEntry.acceptedTx.txId
    try {
      queueEntry.queryingRobustVote = true
      if (this.stateManager.consensusLog) this.mainLogger.debug(`robustQueryBestVote: ${queueEntry.logID}`)
      const queryFn = async (node: Shardus.Node): Promise<AppliedVoteQueryResponse> => {
        try {
          const ip = node.externalIp
          const port = node.externalPort
          // the queryFunction must return null if the given node is our own
          if (ip === Self.ip && port === Self.port) return null
          const queryData: AppliedVoteQuery = { txId: queueEntry.acceptedTx.txId }
          // if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.getAppliedVoteBinary) {
            const req = queryData as GetAppliedVoteReq
            /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455101 ${shardusGetTime()} tx:${txId} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'get_applied_vote'}`)
            const rBin = await Comms.askBinary<GetAppliedVoteReq, GetAppliedVoteResp>(
              node,
              InternalRouteEnum.binary_get_applied_vote,
              req,
              serializeGetAppliedVoteReq,
              deserializeGetAppliedVoteResp,
              {
                verification_data: `${queryData.txId}`,
              }
            )
            return rBin
          // }
          // return await Comms.ask(node, 'get_applied_vote', queryData)          
        } catch (e) {
          this.mainLogger.error(`robustQueryBestVote: Failed query to node ${node.id} error: ${e.message}`)
          return {
            txId: `invalid-${randomUUID()}`,
            appliedVote: null,
            appliedVoteHash: null,
          }
        }
      }
      const eqFn = (item1: AppliedVoteQueryResponse, item2: AppliedVoteQueryResponse): boolean => {
        try {
          if (item1.appliedVoteHash === item2.appliedVoteHash) return true
          return false
        } catch (err) {
          return false
        }
      }
      const redundancy = 3
      const { topResult: response } = await robustQuery(
        this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry),
        queryFn,
        eqFn,
        redundancy,
        true,
        true,
        false,
        'robustQueryBestVote'
      )
      if (response && response.appliedVote) {
        return response.appliedVote
      } else {
        this.mainLogger.error(`robustQueryBestVote: ${txId} no response from robustQuery`)
      }
    } catch (e) {
      this.mainLogger.error(`robustQueryBestVote: ${queueEntry.logID} error: ${e.message}`)
    } finally {
      queueEntry.queryingRobustVote = false
      profilerInstance.scopedProfileSectionEnd('robustQueryBestVote')
      profilerInstance.profileSectionEnd('robustQueryBestVote', true)
    }
  }

  async robustQueryConfirmOrChallenge(queueEntry: QueueEntry): Promise<ConfirmOrChallengeQueryResponse> {
    profilerInstance.profileSectionStart('robustQueryConfirmOrChallenge', true)
    profilerInstance.scopedProfileSectionStart('robustQueryConfirmOrChallenge')
    try {
      if (this.stateManager.consensusLog) {
        this.mainLogger.debug(`robustQueryConfirmOrChallenge: ${queueEntry.logID}`)
      }
      queueEntry.queryingRobustConfirmOrChallenge = true
      const queryFn = async (node: Shardus.Node): Promise<ConfirmOrChallengeQueryResponse> => {
        if (node.externalIp === Self.ip && node.externalPort === Self.port) return null
        const queryData = { txId: queueEntry.acceptedTx.txId }
        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455101 ${shardusGetTime()} tx:${queryData.txId} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'get_confirm_or_challenge'}`)
        // return this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.getConfirmOrChallengeBinary
        //   ? 
          const response = await Comms.askBinary<GetConfirmOrChallengeReq, GetConfirmOrChallengeResp>(
              node,
              InternalRouteEnum.binary_get_confirm_or_challenge,
              queryData,
              serializeGetConfirmOrChallengeReq,
              deserializeGetConfirmOrChallengeResp,
              {}
            )
          return {
            txId: response.txId,
            appliedVoteHash: response.appliedVoteHash,
            result: response.result ?? null,
            uniqueCount: response.uniqueCount
          } as ConfirmOrChallengeQueryResponse
          // : await Comms.ask(node, 'get_confirm_or_challenge', queryData)
      }
      const eqFn = (
        item1: ConfirmOrChallengeQueryResponse,
        item2: ConfirmOrChallengeQueryResponse
      ): boolean => {
        try {
          if (item1 == null || item2 == null) return false
          if (item1.appliedVoteHash == null || item2.appliedVoteHash == null) return false
          if (item1.result == null || item2.result == null) return false

          const message1 =
            item1.appliedVoteHash + item1.result.message + item1.result.nodeId + item1.uniqueCount
          const message2 =
            item2.appliedVoteHash + item2.result.message + item2.result.nodeId + item2.uniqueCount
          if (message1 === message2) return true
          return false
        } catch (err) {
          return false
        } finally {
        }
      }
      // const nodesToAsk = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
      let nodesToAsk = []

      // for (const key of Object.keys(queueEntry.localKeys)) {
      //   if (queueEntry.localKeys[key] === true) {
      //     const nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData =
      //       this.stateManager.currentCycleShardData.nodeShardData
      //
      //     const homeNode = ShardFunctions.findHomeNode(
      //       Context.stateManager.currentCycleShardData.shardGlobals,
      //       key,
      //       Context.stateManager.currentCycleShardData.parititionShardDataMap
      //     )
      //     const storageNodes = homeNode.nodeThatStoreOurParitionFull
      //     const storageNodesIdSet = new Set(storageNodes.map(node => node.id))
      //     for (const node of queueEntry.transactionGroup) {
      //       if (storageNodesIdSet.has(node.id)) {
      //         nodesToAsk.push(node)
      //       }
      //     }
      //   }
      // }

      nestedCountersInstance.countEvent('robustQueryConfirmOrChallenge', `nodesToAsk:${nodesToAsk.length}`)

      if (nodesToAsk.length === 0) {
        nestedCountersInstance.countEvent('robustQueryConfirmOrChallenge', `nodesToAsk is 0`)
        nodesToAsk = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
      }

      const redundancy = 3
      const maxRetry = 10
      const {
        topResult: response,
        isRobustResult,
        winningNodes,
      } = await robustQuery(
        nodesToAsk,
        queryFn,
        eqFn,
        redundancy,
        true,
        true,
        false,
        'robustQueryConfirmOrChallenge',
        maxRetry
      )
      nestedCountersInstance.countEvent('robustQueryConfirmOrChallenge', `isRobustResult:${isRobustResult}`)
      if (!isRobustResult) {
        return null
      }

      if (response && response.result) {
        nestedCountersInstance.countEvent('robustQueryConfirmOrChallenge', `result is NOT null`)
        return response
      } else {
        nestedCountersInstance.countEvent('robustQueryConfirmOrChallenge', `result is null`)
      }
    } catch (e) {
      this.mainLogger.error(`robustQueryConfirmOrChallenge: ${queueEntry.logID} error: ${e.message}`)
    } finally {
      queueEntry.queryingRobustConfirmOrChallenge = false
      profilerInstance.scopedProfileSectionEnd('robustQueryConfirmOrChallenge')
      profilerInstance.profileSectionEnd('robustQueryConfirmOrChallenge', true)
    }
  }

  async robustQueryAccountData(
    consensNodes: Shardus.Node[],
    accountId: string,
    txId: string
  ): Promise<Shardus.WrappedData> {
    const queryFn = async (node: Shardus.Node): Promise<GetAccountData3Resp> => {
      const ip = node.externalIp
      const port = node.externalPort
      // the queryFunction must return null if the given node is our own
      if (ip === Self.ip && port === Self.port) return null

      const message: GetAccountData3Req = {
        accountStart: accountId,
        accountEnd: accountId,
        tsStart: 0,
        maxRecords: this.config.stateManager.accountBucketSize,
        offset: 0,
        accountOffset: '',
      }
      let result
      try {
        // if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.getAccountDataBinary) {
          const req = message as GetAccountDataReqSerializable
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455101 ${shardusGetTime()} tx:${txId} ${NodeList.activeIdToPartition.get(Self.id)}-->>${NodeList.activeIdToPartition.get(node.id)}: ${'get_account_data3'}`)
          const rBin = await Comms.askBinary<GetAccountDataReqSerializable, GetAccountDataRespSerializable>(
            node,
            InternalRouteEnum.binary_get_account_data,
            req,
            serializeGetAccountDataReq,
            deserializeGetAccountDataResp,
            {}
          )
          if (((rBin.errors && rBin.errors.length === 0) || !rBin.errors) && rBin.data) {
            result = rBin as GetAccountData3Resp
          }
        // } else {
        //   result = await Comms.ask(node, 'get_account_data3', message)
        // }
      } catch (error) {
        this.mainLogger.error(
          `robustQueryAccountData: Failed query to node ${node.id}. askBinary ex: ${error.message}`
        )
        return {
          data: null,
          errors: [`robustQueryAccountData: Failed query to node ${node.id}. askBinary ex: ${error.message}`],
        }
      }
      return result
    }
    const eqFn = (item1: GetAccountData3Resp, item2: GetAccountData3Resp): boolean => {
      try {
        const account1 = item1.data.wrappedAccounts[0]
        const account2 = item1.data.wrappedAccounts[0]
        if (account1.stateId === account2.stateId) return true
        return false
      } catch (err) {
        return false
      }
    }
    const redundancy = 3
    const maxRetry = 5
    const { topResult: response } = await robustQuery(
      consensNodes,
      queryFn,
      eqFn,
      redundancy,
      true,
      true,
      false,
      'robustQueryAccountData',
      maxRetry
    )
    if (response && response.data) {
      const accountData = response.data.wrappedAccounts[0]
      return accountData
    }
  }

  async confirmOrChallenge(queueEntry: QueueEntry): Promise<void> {
    try {
      if (queueEntry.ourVote == null && queueEntry.isInExecutionHome) {
        nestedCountersInstance.countEvent('confirmOrChallenge', 'ourVote == null and isInExecutionHome')
        return
      }
      if (queueEntry.completedConfirmedOrChallenge) {
        nestedCountersInstance.countEvent('confirmOrChallenge', 'already completedConfirmedOrChallenge')
        return
      }
      if (queueEntry.queryingRobustVote) {
        nestedCountersInstance.countEvent('confirmOrChallenge', 'in the middle of querying robust vote')
        return
      }
      if (queueEntry.queryingRobustAccountData) {
        nestedCountersInstance.countEvent(
          'confirmOrChallenge',
          'in the middle of querying robust account data'
        )
        return
      }
      if (logFlags.debug)
        this.mainLogger.debug(
          `confirmOrChallenge: ${queueEntry.logID}  receivedBestVote: ${Utils.safeStringify(
            queueEntry.receivedBestVote
          )}} `
        )

      this.profiler.profileSectionStart('confirmOrChallenge')
      if (logFlags.profiling_verbose) this.profiler.scopedProfileSectionStart('confirmOrChallenge')

      const now = shardusGetTime()
      //  if we are in lowest 10% of execution group and agrees with the highest ranked vote, send out a confirm msg
      const timeSinceLastVoteMessage =
        queueEntry.lastVoteReceivedTimestamp > 0 ? now - queueEntry.lastVoteReceivedTimestamp : 0
      const timeSinceFirstVote =
        queueEntry.firstVoteReceivedTimestamp > 0 ? now - queueEntry.firstVoteReceivedTimestamp : 0
      // check if last confirm/challenge received is 1s ago
      const hasWaitedLongEnough = timeSinceLastVoteMessage >= this.config.stateManager.waitTimeBeforeConfirm
      const hasWaitLimitReached = timeSinceFirstVote >= this.config.stateManager.waitLimitAfterFirstVote
      if (logFlags.verbose && this.stateManager.consensusLog)
        this.mainLogger.debug(
          `confirmOrChallenge: ${queueEntry.logID} hasWaitedLongEnough: ${hasWaitedLongEnough}, hasWaitLimitReached: ${hasWaitLimitReached}, timeSinceLastVoteMessage: ${timeSinceLastVoteMessage} ms, timeSinceFirstVote: ${timeSinceFirstVote} ms`
        )
      if (hasWaitedLongEnough || hasWaitLimitReached) {
        nestedCountersInstance.countEvent('confirmOrChallenge', 'hasWaitedLongEnough or hasWaitLimitReached')
        // stop accepting the vote messages for this tx
        queueEntry.acceptVoteMessage = false
        const eligibleToConfirm = queueEntry.eligibleNodeIdsToConfirm.has(Self.id)
        const eligibleToChallenge = true
        if (this.stateManager.consensusLog || logFlags.debug) {
          this.mainLogger.info(
            `confirmOrChallenge: ${queueEntry.logID} hasWaitedLongEnough: true. Now we will try to confirm or challenge. eligibleToConfirm: ${eligibleToConfirm}, eligibleToChallenge: ${eligibleToChallenge}`
          )
        }

        // confirm that current vote is the winning highest ranked vote using robustQuery
        const voteFromRobustQuery = await this.robustQueryBestVote(queueEntry)
        if (voteFromRobustQuery == null) {
          // we cannot confirm the best vote from network
          this.mainLogger.error(`confirmOrChallenge: ${queueEntry.logID} We cannot get voteFromRobustQuery`)
          nestedCountersInstance.countEvent('confirmOrChallenge', 'cannot get robust vote from network')
          return
        }
        /* prettier ignore */if (this.mainLogger.debug || this.stateManager.consensusLog) this.mainLogger.debug(`confirmOrChallenge: ${queueEntry.logID} voteFromRobustQuery: ${utils.stringifyReduce(voteFromRobustQuery)}`)
        let bestVoterFromRobustQuery: Shardus.NodeWithRank
        for (let i = 0; i < queueEntry.executionGroup.length; i++) {
          const node = queueEntry.executionGroup[i]
          if (node.id === voteFromRobustQuery.node_id) {
            bestVoterFromRobustQuery = node as Shardus.NodeWithRank
            break
          }
        }
        if (bestVoterFromRobustQuery == null) {
          // we cannot confirm the best voter from network
          this.mainLogger.error(
            `confirmOrChallenge: ${queueEntry.logID} We cannot get bestVoter from robustQuery for tx ${queueEntry.logID}`
          )
          nestedCountersInstance.countEvent('confirmOrChallenge', 'cannot get robust voter from network')
          return
        }
        queueEntry.robustQueryVoteCompleted = true

        // if vote from robust is better than our received vote, use it as final vote
        const isRobustQueryVoteBetter = bestVoterFromRobustQuery.rank > queueEntry.receivedBestVoter.rank
        let finalVote = queueEntry.receivedBestVote
        let finalVoteHash = queueEntry.receivedBestVoteHash
        if (isRobustQueryVoteBetter) {
          nestedCountersInstance.countEvent('confirmOrChallenge', 'robust query vote is better')
          finalVote = voteFromRobustQuery
          finalVoteHash = this.calculateVoteHash(voteFromRobustQuery)
          queueEntry.receivedBestVote = voteFromRobustQuery
          queueEntry.receivedBestVoter = bestVoterFromRobustQuery
          queueEntry.receivedBestVoteHash = finalVoteHash
          if (this.stateManager.consensusLog) {
            this.mainLogger.info(`confirmOrChallenge: ${queueEntry.logID} robust query vote is better`)
          }
        } else {
          if (this.stateManager.consensusLog) {
            this.mainLogger.info(
              `confirmOrChallenge: ${
                queueEntry.logID
              } robust query vote is NOT better. ${utils.stringifyReduce(queueEntry.receivedBestVote)}`
            )
          }
        }
        const shouldChallenge = queueEntry.ourVoteHash != null && queueEntry.ourVoteHash !== finalVoteHash

        if (this.stateManager.consensusLog)
          this.mainLogger.debug(
            `confirmOrChallenge: ${queueEntry.logID} isInExecutionSet: ${queueEntry.isInExecutionHome}, eligibleToConfirm: ${eligibleToConfirm}, shouldChallenge: ${shouldChallenge}`
          )
        if (this.produceBadChallenge || shouldChallenge) {
          if (!shouldChallenge && logFlags.debug) {
            this.mainLogger.debug(
              `confirmOrChallenge: ${queueEntry.logID} I'm a bad node producing a bad challenge`
            )
          }
          this.challengeVoteAndShare(queueEntry)
          return
        }

        if (eligibleToConfirm && queueEntry.ourVoteHash === finalVoteHash) {
          // queueEntry.eligibleNodesToConfirm is sorted highest to lowest rank
          const confirmNodeIds = Array.from(queueEntry.eligibleNodeIdsToConfirm).reverse()
          const ourRankIndex = confirmNodeIds.indexOf(Self.id)
          // let delayBeforeConfirm = ourRankIndex * 50 // 50ms
          //
          // if (delayBeforeConfirm > 500) delayBeforeConfirm = 500 // we don't want to wait too long
          //
          // if (delayBeforeConfirm > 0) {
          //   await utils.sleep(delayBeforeConfirm)
          //
          //   // Compare our rank with received rank before sharing our confirmation
          //   if (
          //     queueEntry.receivedBestConfirmedNode &&
          //     queueEntry.receivedBestConfirmedNode.rank < queueEntry.ourNodeRank
          //   ) {
          //     nestedCountersInstance.countEvent(
          //       'confirmOrChallenge',
          //       `isReceivedBetterConfirmation after ${delayBeforeConfirm}ms delay: true`
          //     )
          //     if (logFlags.debug)
          //       this.mainLogger.debug(
          //         `confirmOrChallenge: ${
          //           queueEntry.logID
          //         } received better confirmation before we share ours, receivedBestConfirmation: ${utils.stringifyReduce(
          //           queueEntry.receivedBestConfirmation
          //         )}`
          //       )
          //     queueEntry.completedConfirmedOrChallenge = true
          //     return
          //   }
          //   nestedCountersInstance.countEvent(
          //     'confirmOrChallenge',
          //     `isReceivedBetterConfirmation after ${delayBeforeConfirm}ms delay: false`
          //   )
          // }
          this.confirmVoteAndShare(queueEntry)
        } else if (eligibleToConfirm === false) {
          // we are not eligible to confirm
          if (this.stateManager.consensusLog)
            this.mainLogger.debug(
              `confirmOrChallenge: ${queueEntry.logID} not eligible to confirm. set completedConfirmedOrChallenge to true`
            )
          queueEntry.completedConfirmedOrChallenge = true
        }
      } else {
        nestedCountersInstance.countEvent('confirmOrChallenge', 'still early for confirm or challenge')
        if (logFlags.debug)
          this.mainLogger.debug(
            `confirmOrChallenge: ${queueEntry.logID} not sending confirm or challenge yet because timeSinceLastVoteMessage is ${timeSinceLastVoteMessage} ms`
          )
      }
    } catch (e) {
      this.mainLogger.error(`confirmOrChallenge: ${queueEntry.logID} error: ${e.message}, ${e.stack}`)
    } finally {
      if (logFlags.profiling_verbose) this.profiler.scopedProfileSectionEnd('confirmOrChallenge')
      this.profiler.profileSectionEnd('confirmOrChallenge')
    }
  }

  sortByAccountId(first: Shardus.WrappedResponse, second: Shardus.WrappedResponse): Ordering {
    return utils.sortAscProp(first, second, 'accountId')
  }

  async confirmVoteAndShare(queueEntry: QueueEntry): Promise<void> {
    this.profiler.profileSectionStart('confirmVoteAndShare')
    try {
      /* prettier-ignore */
      if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote("shrd_confirmOrChallengeVote", `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `);

      // podA: POQ3 create confirm message and share to tx group
      const confirmMessage: ConfirmOrChallengeMessage = {
        message: 'confirm',
        nodeId: Self.id,
        appliedVote: queueEntry.receivedBestVote,
      }
      const signedConfirmMessage = this.crypto.sign(confirmMessage)
      if (this.stateManager.consensusLog) this.mainLogger.debug(`confirmVoteAndShare: ${queueEntry.logID}`)

      //Share message to tx group
      const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
      Comms.sendGossip('spread_confirmOrChallenge', signedConfirmMessage, '', Self.id, gossipGroup, true, 10, queueEntry.acceptedTx.txId, `confirmVote_${NodeList.activeIdToPartition.get(signedConfirmMessage.appliedVote?.node_id)}`)
      this.tryAppendMessage(queueEntry, signedConfirmMessage)
      queueEntry.gossipedConfirmOrChallenge = true
      queueEntry.completedConfirmedOrChallenge = true
      if (this.stateManager.consensusLog)
        this.mainLogger.debug(`completedConfirmOrChallenge: ${queueEntry.logID}`)
    } catch (e) {
      this.mainLogger.error(`confirmVoteAndShare: ${queueEntry.logID} error: ${e.message}`)
    } finally {
      this.profiler.profileSectionEnd('confirmVoteAndShare')
    }
  }

  async challengeVoteAndShare(queueEntry: QueueEntry): Promise<void> {
    this.profiler.profileSectionStart('challengeVoteAndShare')
    try {
      /* prettier-ignore */
      if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote("shrd_confirmOrChallengeVote", `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `);

      // Should check account integrity only when before states are different from best vote
      let doStatesMatch = true
      const voteBeforeStates = queueEntry.receivedBestVote.account_state_hash_before
      const ourCollectedData = Object.values(queueEntry.collectedData)
      if (voteBeforeStates.length !== ourCollectedData.length) {
        doStatesMatch = false
      }
      for (let i = 0; i < voteBeforeStates.length; i++) {
        if (ourCollectedData[i] == null) {
          doStatesMatch = false
          nestedCountersInstance.countEvent(
            'confirmOrChallenge',
            'tryChallengeVoteAndShare canceled because ourCollectedData is null'
          )
          break
        }
        if (voteBeforeStates[i] !== ourCollectedData[i].stateId) {
          doStatesMatch = false
          nestedCountersInstance.countEvent(
            'confirmOrChallenge',
            'tryChallengeVoteAndShare states do not match'
          )
          break
        }
      }
      if (this.produceBadChallenge) doStatesMatch = false
      let isAccountIntegrityOk = false

      if (doStatesMatch) {
        isAccountIntegrityOk = true
      } else if (doStatesMatch === false && this.config.stateManager.integrityCheckBeforeChallenge === true) {
        isAccountIntegrityOk = await this.checkAccountIntegrity(queueEntry)
      } else {
        isAccountIntegrityOk = true
      }

      if (!isAccountIntegrityOk) {
        nestedCountersInstance.countEvent(
          'confirmOrChallenge',
          'tryChallengeVoteAndShare account integrity not ok.'
        )
        if (logFlags.verbose)
          this.mainLogger.debug(`challengeVoteAndShare: ${queueEntry.logID} account integrity is not ok`)
        // we should not challenge or confirm if account integrity is not ok
        queueEntry.completedConfirmedOrChallenge = true
        return
      }

      //podA: POQ4 create challenge message and share to tx group
      const challengeMessage: ConfirmOrChallengeMessage = {
        message: 'challenge',
        nodeId: queueEntry.ourVote.node_id,
        appliedVote: queueEntry.receivedBestVote,
      }
      const signedChallengeMessage = this.crypto.sign(challengeMessage)
      if (logFlags.debug)
        this.mainLogger.debug(
          `challengeVoteAndShare: ${queueEntry.logID}  ${Utils.safeStringify(signedChallengeMessage)}}`
        )

      //Share message to tx group
      const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
      Comms.sendGossip('spread_confirmOrChallenge', signedChallengeMessage, '', null, gossipGroup, true, 10, queueEntry.acceptedTx.txId, `challengeVote_${NodeList.activeIdToPartition.get(signedChallengeMessage.appliedVote?.node_id)}`)
      this.tryAppendMessage(queueEntry, signedChallengeMessage)
      queueEntry.gossipedConfirmOrChallenge = true
      queueEntry.completedConfirmedOrChallenge = true
    } catch (e) {
      this.mainLogger.error(`challengeVoteAndShare: ${queueEntry.logID} error: ${e.message}`)
    } finally {
      this.profiler.profileSectionEnd('challengeVoteAndShare')
    }
  }

  async checkAccountIntegrity(queueEntry: QueueEntry): Promise<boolean> {
    this.profiler.scopedProfileSectionStart('checkAccountIntegrity')
    queueEntry.queryingRobustAccountData = true
    let success = true

    for (const key of queueEntry.uniqueKeys) {
      const collectedAccountData = queueEntry.collectedData[key]
      if (collectedAccountData.accountCreated) {
        // we do not need to check this newly created account
        // todo: still possible that node has lost data for this account
        continue
      }
      const consensuGroupForAccount =
        this.stateManager.transactionQueue.queueEntryGetConsensusGroupForAccount(queueEntry, key)
      const promise = this.stateManager.transactionConsensus.robustQueryAccountData(
        consensuGroupForAccount,
        key,
        queueEntry.acceptedTx.txId
      )
      queueEntry.robustAccountDataPromises[key] = promise
    }

    if (
      queueEntry.robustAccountDataPromises &&
      Object.keys(queueEntry.robustAccountDataPromises).length > 0
    ) {
      const keys = Object.keys(queueEntry.robustAccountDataPromises)
      const promises = Object.values(queueEntry.robustAccountDataPromises)
      const results: Shardus.WrappedData[] = await Promise.all(promises)
      for (let i = 0; i < results.length; i++) {
        const key = keys[i]
        const collectedAccountData = queueEntry.collectedData[key]
        const robustQueryAccountData = results[i]
        if (
          robustQueryAccountData.stateId === collectedAccountData.stateId &&
          robustQueryAccountData.timestamp === collectedAccountData.timestamp
        ) {
          nestedCountersInstance.countEvent('checkAccountIntegrity', 'collected data and robust data match')
          if (logFlags.debug)
            this.mainLogger.debug(`checkAccountIntegrity: ${queueEntry.logID} key: ${key} ok`)
        } else {
          success = false
          nestedCountersInstance.countEvent(
            'checkAccountIntegrity',
            'collected data and robust data do not match'
          )
          if (logFlags.debug) {
            this.mainLogger.debug(
              `checkAccountIntegrity: ${
                queueEntry.logID
              } key: ${key} failed. collectedAccountData: ${Utils.safeStringify(
                collectedAccountData
              )} robustAccountData: ${Utils.safeStringify(robustQueryAccountData)}`
            )
          }
        }
      }
    } else {
      nestedCountersInstance.countEvent('checkAccountIntegrity', 'robustAccountDataPromises empty')
    }
    this.profiler.scopedProfileSectionEnd('checkAccountIntegrity')
    queueEntry.queryingRobustAccountData = false
    return success
  }
  /**
   * createAndShareVote
   * create an AppliedVote
   * gossip the AppliedVote
   * @param queueEntry
   */
  async createAndShareVote(queueEntry: QueueEntry): Promise<unknown> {
    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_createAndShareVote', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `)

    // TODO STATESHARDING4 CHECK VOTES PER CONSENSUS GROUP

    if (queueEntry.isInExecutionHome === false) {
      //we are not in the execution home, so we can't create or share a vote
      if (logFlags.debug) this.mainLogger.debug(`createAndShareVote: ${queueEntry.logID} not in execution home`)
      return
    }
    if (Context.config.debug.forcedExpiration) {
      // only expired 70% of the execution group
      if (Math.random() < 0.7) {
        // we are in forced expiration mode, so we can't create or share a vote
        nestedCountersInstance.countEvent('transactionConsensus', 'forcedExpiration')
        return
      }
      console.log(`allowing vote creation for ${queueEntry.acceptedTx.txId} in forcedExpiration mode`)
    }
    if (queueEntry.almostExpired) {
      if (logFlags.debug) this.mainLogger.debug(`createAndShareVote: ${queueEntry.logID} almostExpired`)
      nestedCountersInstance.countEvent('transactionConsensus', 'almostExpired')
      return
    }
    this.profiler.profileSectionStart('createAndShareVote', true)

    try {
      const ourNodeId = Self.id
      const isEligibleToShareVote = queueEntry.eligibleNodeIdsToVote.has(ourNodeId)
      let isReceivedBetterVote = false

      // create our vote (for later use) even if we have received a better vote
      const proposal: Proposal = {
        txid: queueEntry.acceptedTx.txId,
        applied: queueEntry.preApplyTXResult.passed,
        accountIDs: [],
        afterStateHashes: [],
        beforeStateHashes: [],
        cant_preApply: queueEntry.preApplyTXResult.applied === false,
        appReceiptDataHash: '',
      }

      proposal.appReceiptDataHash = queueEntry?.preApplyTXResult?.applyResponse?.appReceiptDataHash || ''

      if (queueEntry.debugFail_voteFlip === true) {
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_createAndShareVote_voteFlip', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `)

          proposal.applied = !proposal.applied
      }

      let wrappedStates = this.stateManager.useAccountWritesOnly ? {} : queueEntry.collectedData

      const applyResponse = queueEntry?.preApplyTXResult?.applyResponse

      const stats = {
        usedApplyResponse: false,
        wrappedStateSet: 0,
        optimized: false,
      }
      //if we have values for accountWrites, then build a list wrappedStates from it and use this list instead
      //of the collected data list
      if (applyResponse != null) {
        const writtenAccountsMap: WrappedResponses = {}
        if (applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
          for (const writtenAccount of applyResponse.accountWrites) {
            writtenAccountsMap[writtenAccount.accountId] = writtenAccount.data
          }
          //override wrapped states with writtenAccountsMap which should be more complete if it included
          wrappedStates = writtenAccountsMap
        }

        stats.usedApplyResponse = true
        stats.wrappedStateSet = Object.keys(wrappedStates).length
        //Issue that could happen with sharded network:
        //Need to figure out where to put the logic that knows which nodes need final data forwarded to them
        //A receipt aline may not be enough, remote shards will need an updated copy of the data.
      }

      if (wrappedStates != null) {
        //we need to sort this list and doing it in place seems ok
        //applyResponse.stateTableResults.sort(this.sortByAccountId )

        stats.optimized = true
        //need to sort our parallel lists so that they are deterministic!!
        const wrappedStatesList = [...Object.values(wrappedStates)]

        //this sort is critical to a deterministic vote structure.. we need this if taking a hash
        wrappedStatesList.sort(this.sortByAccountId)

        for (const wrappedState of wrappedStatesList) {
          // note this is going to stomp the hash value for the account
          // this used to happen in dapp.updateAccountFull  we now have to save off prevStateId on the wrappedResponse
          //We have to update the hash now! Not sure if this is the greatest place but it needs to be done
          const updatedHash = this.app.calculateAccountHash(wrappedState.data)
          wrappedState.stateId = updatedHash

          // populate accountIds
          proposal.accountIDs.push(wrappedState.accountId)
          // popoulate after state hashes
          proposal.afterStateHashes.push(wrappedState.stateId) // account hash for nonce 100
          const wrappedResponse = queueEntry.collectedData[wrappedState.accountId]
          // populate before state hashes
          if (wrappedResponse != null) proposal.beforeStateHashes.push(wrappedResponse.stateId)
        }
      }

      let appliedVoteHash: AppliedVoteHash
      //let temp = ourVote.node_id
      // ourVote.node_id = '' //exclue this from hash
      // proposal = this.crypto.sign(proposal)
      const voteHash = this.calculateVoteHash(proposal)
      //ourVote.node_id = temp
      appliedVoteHash = {
        txid: proposal.txid,
        voteHash,
      }
      queueEntry.ourVoteHash = voteHash

      const ourVote: Vote = {
        proposalHash: voteHash,
      }

      if (logFlags.debug || this.stateManager.consensusLog)
        this.mainLogger.debug(
          `createAndShareVote ${queueEntry.logID} created ourVote: ${utils.stringifyReduce(
            ourVote
          )},ourVoteHash: ${voteHash}, isEligibleToShareVote: ${isEligibleToShareVote}, isReceivedBetterVote: ${isReceivedBetterVote}`
        )

      //append our vote
      appliedVoteHash = this.crypto.sign(appliedVoteHash)
      if (this.stateManager.transactionQueue.useNewPOQ === false)
        this.tryAppendVoteHash(queueEntry, appliedVoteHash)

      // save our vote to our queueEntry
      this.crypto.sign(ourVote)
      this.crypto.sign(proposal)
      queueEntry.ourVote = ourVote
      queueEntry.ourProposal = proposal
      if (queueEntry.firstVoteReceivedTimestamp === 0) {
        queueEntry.firstVoteReceivedTimestamp = shardusGetTime()
      }

      if (this.stateManager.transactionQueue.usePOQo) {
        // Kick off POQo vote sending loop asynchronously in the background and return
        // Can skip over the remaining part of the function because this loop will
        // handle sending the vote to the intended receivers
        if (logFlags.verbose) this.mainLogger.debug(`POQO: Sending vote for ${queueEntry.logID}`)
        if (Math.random() < this.debugFailPOQo) {
          nestedCountersInstance.countEvent('poqo', 'debug fail no vote')
          return
        }
        this.poqoVoteSendLoop(queueEntry, appliedVoteHash)
        return
      }

      if (this.stateManager.transactionQueue.useNewPOQ) {
        if (isEligibleToShareVote === false) {
          nestedCountersInstance.countEvent(
            'transactionConsensus',
            'createAndShareVote isEligibleToShareVote:' + ' false'
          )
          return
        }
        const ourRankIndex = Array.from(queueEntry.eligibleNodeIdsToVote).indexOf(ourNodeId)
        let delayBeforeVote = ourRankIndex * 10 // 10ms x rank index

        if (delayBeforeVote > 500) {
          delayBeforeVote = 500
        }

        nestedCountersInstance.countEvent(
          'transactionConsensus',
          `createAndShareVote delayBeforeSharingVote: ${delayBeforeVote} ms`
        )

        if (delayBeforeVote > 0) {
          await utils.sleep(delayBeforeVote)

          // Compare our rank with received rank
          if (queueEntry.receivedBestVoter && queueEntry.receivedBestVoter.rank > queueEntry.ourNodeRank) {
            isReceivedBetterVote = true
          }

          if (isReceivedBetterVote) {
            if (this.stateManager.consensusLog)
              this.mainLogger.debug(`createAndShareVote received better vote`)
            nestedCountersInstance.countEvent(
              'transactionConsensus',
              'createAndShareVote isReceivedBetterVote: true'
            )
            return
          }
        }

        // tryAppend before sharing
        const appendWorked = this.tryAppendVote(queueEntry, ourVote)
        if (appendWorked === false) {
          nestedCountersInstance.countEvent('transactionConsensus', 'createAndShareVote appendFailed')
        }
      }

      let gossipGroup = []
      if (
        this.stateManager.transactionQueue.executeInOneShard === true &&
        this.stateManager.transactionQueue.useNewPOQ === false
      ) {
        //only share with the exection group
        gossipGroup = queueEntry.executionGroup
      } else {
        //sharing with the entire transaction group actually..
        gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
      }

      if (gossipGroup.length >= 1) {
        this.stateManager.debugNodeGroup(
          queueEntry.acceptedTx.txId,
          queueEntry.acceptedTx.timestamp,
          `share tx vote to neighbors`,
          gossipGroup
        )

        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`createAndShareVote numNodes: ${gossipGroup.length} stats:${utils.stringifyReduce(stats)} ourVote: ${utils.stringifyReduce(ourVote)}`)
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('createAndShareVote', `${queueEntry.acceptedTx.txId}`, `numNodes: ${gossipGroup.length} stats:${utils.stringifyReduce(stats)} ourVote: ${utils.stringifyReduce(ourVote)} `)

        // Filter nodes before we send tell()
        const filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
          gossipGroup,
          'createAndShareVote',
          true,
          true
        )
        if (filteredNodes.length === 0) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error('createAndShareVote: filterValidNodesForInternalMessage no valid nodes left to try')
          return null
        }
        const filteredConsensusGroup = filteredNodes

        if (this.stateManager.transactionQueue.useNewPOQ) {
          // Gossip the vote to the entire consensus group
          Comms.sendGossip('gossip-applied-vote', ourVote, '', null, filteredConsensusGroup, true, 4, queueEntry.acceptedTx.txId, `${NodeList.activeIdToPartition.get(ourVote.node_id)}`)
        } else {
          this.profiler.profileSectionStart('createAndShareVote-tell')
          // if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.spreadAppliedVoteHashBinary) {
            const request = appliedVoteHash as AppliedVoteHash
            this.p2p.tellBinary<SpreadAppliedVoteHashReq>(
              filteredConsensusGroup,
              InternalRouteEnum.binary_spread_appliedVoteHash,
              request,
              serializeSpreadAppliedVoteHashReq,
              {}
            )
          // } else {
            // this.p2p.tell(filteredConsensusGroup, 'spread_appliedVoteHash', appliedVoteHash)
          // }

          this.profiler.profileSectionEnd('createAndShareVote-tell')
        }
      } else {
        nestedCountersInstance.countEvent('transactionQueue', 'createAndShareVote fail, no consensus group')
      }
    } catch (e) {
      this.mainLogger.error(`createAndShareVote: error ${e.message}`)
    } finally {
      this.profiler.profileSectionEnd('createAndShareVote', true)
    }
  }

  calculateVoteHash(vote: AppliedVote | Proposal, removeSign = true): string {
    if (this.stateManager.transactionQueue.usePOQo && (vote as Proposal).applied !== undefined) {
      const proposal = vote as Proposal
      const applyStatus = {
        applied: proposal.applied,
        cantApply: proposal.cant_preApply,
      }
      const accountsHash = this.crypto.hash(
        this.crypto.hash(proposal.accountIDs) +
        this.crypto.hash(proposal.beforeStateHashes) + 
        this.crypto.hash(proposal.afterStateHashes)
      )
      const proposalHash = this.crypto.hash(
        this.crypto.hash(applyStatus) + accountsHash + proposal.appReceiptDataHash
      )
      return proposalHash
    } else if (this.stateManager.transactionQueue.usePOQo) {
      const appliedVote = vote as AppliedVote
      const appliedHash = {
        applied: appliedVote.transaction_result,
        cantApply: appliedVote.cant_apply
      }
      const stateHash = {
        account_id: appliedVote.account_id,
        account_state_hash_after: appliedVote.account_state_hash_after,
        account_state_hash_before: appliedVote.account_state_hash_before,
      }
      const appDataHash = {
        app_data_hash: appliedVote.app_data_hash,
      }
      const voteToHash = {
        appliedHash: this.crypto.hash(appliedHash),
        stateHash: this.crypto.hash(stateHash),
        appDataHash: this.crypto.hash(appDataHash),
      }
      return this.crypto.hash(voteToHash)
    } else if (this.stateManager.transactionQueue.useNewPOQ) {
      const appliedVote = vote as AppliedVote
      const voteToHash = {
        txId: appliedVote.txid,
        transaction_result: appliedVote.transaction_result,
        account_id: appliedVote.account_id,
        account_state_hash_after: appliedVote.account_state_hash_after,
        account_state_hash_before: appliedVote.account_state_hash_before,
        cant_apply: appliedVote.cant_apply,
      }
      return this.crypto.hash(voteToHash)
    } else {
      const appliedVote = vote as AppliedVote
      const voteToHash = Object.assign({}, appliedVote)
      if (voteToHash.node_id != null) voteToHash.node_id = ''
      if (voteToHash.sign != null) delete voteToHash.sign
      return this.crypto.hash(voteToHash)
    }
  }
  addPendingConfirmOrChallenge(queueEntry: QueueEntry, confirmOrChallenge: ConfirmOrChallengeMessage): void {
    if (queueEntry.pendingConfirmOrChallenge.has(confirmOrChallenge.nodeId) === false) {
      queueEntry.pendingConfirmOrChallenge.set(confirmOrChallenge.nodeId, confirmOrChallenge)
    }
  }

  /**
   * tryAppendMessage
   * if we have not seen this message yet search our list of votes and append it in
   * the correct spot sorted by signer's id
   * @param queueEntry
   * @param confirmOrChallenge
   */
  tryAppendMessage(queueEntry: QueueEntry, confirmOrChallenge: ConfirmOrChallengeMessage): boolean {
    if (queueEntry.acceptVoteMessage === true) { /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryAppendMessage: ${queueEntry.logID} we are still accepting vote messages. Not ready`)
      this.addPendingConfirmOrChallenge(queueEntry, confirmOrChallenge)
      return false
    }
    if (queueEntry.robustQueryVoteCompleted === false) {
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug(`tryAppendMessage: ${queueEntry.logID} robustQueryVoteCompleted: ${queueEntry.robustQueryVoteCompleted}. Not ready`)
      this.addPendingConfirmOrChallenge(queueEntry, confirmOrChallenge)
      return false
    }
    if (queueEntry.acceptConfirmOrChallenge === false || queueEntry.appliedReceipt2 != null) {
      this.mainLogger.debug(
        `tryAppendMessage: ${
          queueEntry.logID
        } not accepting confirm or challenge. acceptConfirmOrChallenge: ${
          queueEntry.acceptConfirmOrChallenge
        }, appliedReceipt2: ${queueEntry.appliedReceipt2 == null}`
      )
      return false
    }

    /* prettier-ignore */
    if (logFlags.playback) this.logger.playbackLogNote("tryAppendMessage", `${queueEntry.logID}`, `collectedVotes: ${queueEntry.collectedVotes.length}`);
    /* prettier-ignore */
    if (logFlags.debug) this.mainLogger.debug(`tryAppendMessage: ${queueEntry.logID}   ${Utils.safeStringify(confirmOrChallenge)} `);
    // check if the node is in the execution group
    const isMessageFromExecutionNode = queueEntry.executionGroupMap.has(confirmOrChallenge.nodeId)

    if (!isMessageFromExecutionNode) {
      this.mainLogger.error(`tryAppendMessage: ${queueEntry.logID} Message is not from an execution node.`)
      return false
    }

    if (confirmOrChallenge.message === 'confirm') {
      const foundNode =
        queueEntry.eligibleNodeIdsToConfirm.has(confirmOrChallenge.nodeId) &&
        this.crypto.verify(
          confirmOrChallenge as SignedObject,
          queueEntry.executionGroupMap.get(confirmOrChallenge.nodeId).publicKey
        )

      if (!foundNode) {
        this.mainLogger.error(
          `tryAppendMessage: ${queueEntry.logID} Message signature does not match with any eligible nodes that can confirm.`
        )
        return false
      }
    }

    // todo: podA check if the message is valid
    const isMessageValid = true
    if (!isMessageValid) return false

    // Check if the previous phase is finalized and we have received best vote
    if (queueEntry.receivedBestVote == null) {
      this.mainLogger.error(
        `tryAppendMessage: ${queueEntry.logID} confirm/challenge is too early. Not finalized best vote yet`
      )
      this.addPendingConfirmOrChallenge(queueEntry, confirmOrChallenge)
      return false
    }

    // verify that the vote part of the message is for the same vote that was finalized in the previous phase
    if (this.calculateVoteHash(confirmOrChallenge.appliedVote) !== queueEntry.receivedBestVoteHash) {
      this.mainLogger.error(
        `tryAppendMessage: ${
          queueEntry.logID
        } confirmOrChallenge is not for the same vote that was finalized in the previous phase, queueEntry.receivedBestVote: ${Utils.safeStringify(
          queueEntry.receivedBestVote
        )}`
      )
      nestedCountersInstance.countEvent('confirmOrChallenge', 'not same vote as finalized vote')
      return false
    }

    // record the timestamps
    const now = shardusGetTime()
    queueEntry.lastConfirmOrChallengeTimestamp = now
    if (queueEntry.firstConfirmOrChallengeTimestamp === 0) {
      queueEntry.firstConfirmOrChallengeTimestamp = now

      if (this.stateManager.consensusLog) {
        this.mainLogger.info(`tryAppendMessage: ${queueEntry.logID} first confirm or challenge`)
      }
    }

    if (confirmOrChallenge.message === 'confirm') {
      let isBetterThanCurrentConfirmation
      let receivedConfirmedNode: Shardus.NodeWithRank

      queueEntry.topConfirmations.add(confirmOrChallenge.nodeId)
      if (this.stateManager.consensusLog) this.mainLogger.info(
          `tryAppendMessage: ${queueEntry.logID} current topConfirmations: ${queueEntry.topConfirmations.size}`
        )

      if (!queueEntry.receivedBestConfirmation) isBetterThanCurrentConfirmation = true
      else if (queueEntry.receivedBestConfirmation.nodeId === confirmOrChallenge.nodeId)
        isBetterThanCurrentConfirmation = false
      else {
        // Compare ranks
        if (queueEntry.executionGroupMap.has(confirmOrChallenge.nodeId)) {
          receivedConfirmedNode = queueEntry.executionGroupMap.get(
            confirmOrChallenge.nodeId
          ) as Shardus.NodeWithRank
        }

        isBetterThanCurrentConfirmation =
          receivedConfirmedNode.rank < queueEntry.receivedBestConfirmedNode.rank
      }

      if (!isBetterThanCurrentConfirmation) {
        if (logFlags.debug)
          this.mainLogger.debug(
            `tryAppendMessage: ${queueEntry.logID} confirmation is not better than current confirmation`
          )
        return false
      }

      if (this.stateManager.consensusLog)
        this.mainLogger.debug(
          `tryAppendMessage: ${queueEntry.logID} better confirmation received and switching to it`
        )

      queueEntry.receivedBestConfirmation = confirmOrChallenge

      if (receivedConfirmedNode) {
        queueEntry.receivedBestConfirmedNode = receivedConfirmedNode
      } else {
        if (queueEntry.executionGroupMap.has(confirmOrChallenge.nodeId)) {
          queueEntry.receivedBestConfirmedNode = queueEntry.executionGroupMap.get(
            confirmOrChallenge.nodeId
          ) as Shardus.NodeWithRank
        }
      }

      if (logFlags.debug)
        this.mainLogger.debug(
          `tryAppendMessage: ${
            queueEntry.logID
          } confirmation received and processed. queueEntry.receivedBestConfirmation: ${Utils.safeStringify(
            queueEntry.receivedBestConfirmation
          )}, receivedBestConfirmedNode: ${queueEntry.receivedBestConfirmedNode}`
        )
      return true
    } else if (confirmOrChallenge.message === 'challenge') {
      let isBetterThanCurrentChallenge = false
      let receivedChallenger: Shardus.NodeWithRank

      // add the challenge to the queueEntry if it is from a unique node
      if (queueEntry.uniqueChallenges[confirmOrChallenge.sign.owner] == null) {
        queueEntry.uniqueChallenges[confirmOrChallenge.sign.owner] = confirmOrChallenge
        queueEntry.uniqueChallengesCount++
        if (this.stateManager.consensusLog)
          this.mainLogger.debug(
            `tryAppendMessage: ${queueEntry.logID} unique challenge added. ${Utils.safeStringify(
              queueEntry.uniqueChallenges
            )}`
          )
      }

      this.mainLogger.debug(
        `tryAppendMessage: ${
          queueEntry.logID
        } challenge received and processing. queueEntry.receivedBestChallenge: ${Utils.safeStringify(
          queueEntry.receivedBestChallenge
        )}`
      )
      if (!queueEntry.receivedBestChallenge) isBetterThanCurrentChallenge = true
      else if (queueEntry.receivedBestChallenge.nodeId === confirmOrChallenge.nodeId)
        isBetterThanCurrentChallenge = false
      else {
        // Compare ranks
        if (queueEntry.executionGroupMap.has(confirmOrChallenge.nodeId)) {
          receivedChallenger = queueEntry.executionGroupMap.get(
            confirmOrChallenge.nodeId
          ) as Shardus.NodeWithRank
        }
        isBetterThanCurrentChallenge = receivedChallenger.rank < queueEntry.receivedBestChallenger.rank
      }

      if (!isBetterThanCurrentChallenge) {
        if (logFlags.debug)
          this.mainLogger.debug(
            `tryAppendMessage: ${queueEntry.logID} challenge is not better than current challenge`
          )
        return false
      }

      queueEntry.receivedBestChallenge = confirmOrChallenge

      if (receivedChallenger) {
        queueEntry.receivedBestChallenger = receivedChallenger
      } else {
        if (queueEntry.executionGroupMap.has(confirmOrChallenge.nodeId)) {
          queueEntry.receivedBestChallenger = queueEntry.executionGroupMap.get(
            confirmOrChallenge.nodeId
          ) as Shardus.NodeWithRank
        }
      }
      if (logFlags.debug)
        this.mainLogger.debug(
          `tryAppendMessage: ${
            queueEntry.logID
          } challenge received and processed. queueEntry.receivedBestChallenge: ${Utils.safeStringify(
            queueEntry.receivedBestChallenge
          )}, receivedBestChallenger: ${queueEntry.receivedBestChallenger}`
        )
      return true
    }
  }

  /**
   * tryAppendVote
   * if we have not seen this vote yet search our list of votes and append it in
   * the correct spot sorted by signer's id
   * @param queueEntry
   * @param vote
   */
  tryAppendVote(queueEntry: QueueEntry, vote: AppliedVote): boolean {
    if (this.stateManager.transactionQueue.useNewPOQ === false) {
      const numVotes = queueEntry.collectedVotes.length

      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tryAppendVote', `${queueEntry.logID}`, `vote: ${utils.stringifyReduce(vote)}`)
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`tryAppendVote collectedVotes: ${queueEntry.logID}   vote: ${utils.stringifyReduce(vote)}`)

      // just add the vote if we dont have any yet
      if (numVotes === 0) {
        queueEntry.collectedVotes.push(vote)
        queueEntry.newVotes = true
        if (queueEntry.firstVoteReceivedTimestamp === 0) queueEntry.firstVoteReceivedTimestamp = shardusGetTime()
        if (this.stateManager.consensusLog)
          this.mainLogger.debug(`First vote appended for tx ${queueEntry.logID}}`)
        return true
      }

      //compare to existing votes.  keep going until we find that this vote is already in the list or our id is at the right spot to insert sorted
      for (let i = 0; i < numVotes; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const currentVote = queueEntry.collectedVotes[i]

        if (currentVote.sign.owner === vote.sign.owner) {
          // already in our list so do nothing and return
          return false
        }
      }
      queueEntry.lastVoteReceivedTimestamp = shardusGetTime()
      queueEntry.collectedVotes.push(vote)
      queueEntry.newVotes = true

      return true
    } else {
      if (queueEntry.acceptVoteMessage === false || queueEntry.appliedReceipt2 != null) {
        if (queueEntry.acceptVoteMessage === false)
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:f no_accept`)
        if (queueEntry.appliedReceipt2 != null)
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:f applied2_not_null`)
        return false
      }
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tryAppendVote', `${queueEntry.logID}`, `vote: ${utils.stringifyReduce(vote)}`)
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`tryAppendVote collectedVotes: ${queueEntry.logID}   vote: ${utils.stringifyReduce(vote)}`)

      const isEligibleToVote =
        queueEntry.eligibleNodeIdsToVote.has(vote.node_id) &&
        this.crypto.verify(vote as SignedObject, queueEntry.executionGroupMap.get(vote.node_id).publicKey)

      if (!isEligibleToVote) {
        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:f not_eligible`)
        if (logFlags.debug) {
          this.mainLogger.debug(
            `tryAppendVote: logId:${
              queueEntry.logID
            } received node is not part of eligible nodes to vote, vote: ${Utils.safeStringify(
              vote
            )}, eligibleNodesToVote: ${Utils.safeStringify(queueEntry.eligibleNodeIdsToVote)}`
          )
        }
        return
      }

      // todo: podA check if the vote is valid
      const isVoteValid = true
      if (!isVoteValid) return

      queueEntry.topVoters.add(vote.node_id)
      // we will mark the last received vote timestamp
      const now = shardusGetTime()
      queueEntry.lastVoteReceivedTimestamp = now
      if (queueEntry.firstVoteReceivedTimestamp === 0) queueEntry.firstVoteReceivedTimestamp = now

      // Compare with existing vote. Skip we already have it or node rank is lower than ours
      let isBetterThanCurrentVote
      let receivedVoter: Shardus.NodeWithRank
      if (!queueEntry.receivedBestVote){
        isBetterThanCurrentVote = true
        //do not compare the hash we still need to allow gossip to flow if the hash is the
        //same but the vote is better.
        //else if (queueEntry.receivedBestVoteHash === this.calculateVoteHash(vote)){
      } else {
        // Compare ranks
        if (queueEntry.executionGroupMap.has(vote.node_id)) {
          receivedVoter = queueEntry.executionGroupMap.get(vote.node_id) as Shardus.NodeWithRank
        }
        isBetterThanCurrentVote = receivedVoter.rank > queueEntry.receivedBestVoter.rank
        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV ${receivedVoter.rank} > ${queueEntry.receivedBestVoter.rank}`)
        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV ${NodeList.activeIdToPartition.get(receivedVoter.id)} : ${NodeList.activeIdToPartition.get(queueEntry.receivedBestVoter.id)}`)
      }

      if (!isBetterThanCurrentVote) {
        if (logFlags.debug || this.stateManager.consensusLog) {
          this.mainLogger.debug(
            `tryAppendVote: ${queueEntry.logID} received vote is NOT better than current vote. lastReceivedVoteTimestamp: ${queueEntry.lastVoteReceivedTimestamp}`
          )
        }
        if (receivedVoter) {
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:f worser_voter ${NodeList.activeIdToPartition.get(receivedVoter.id)}`)
        } else {
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:f worser_voter`)
        }
        return false
      }

      queueEntry.receivedBestVote = vote
      queueEntry.receivedBestVoteHash = this.calculateVoteHash(vote)
      queueEntry.newVotes = true
      if (logFlags.debug || this.stateManager.consensusLog) {
        this.mainLogger.debug(
          `tryAppendVote: ${queueEntry.logID} received vote is better than current vote. lastReceivedVoteTimestamp: ${queueEntry.lastVoteReceivedTimestamp}`
        )
      }
      if (receivedVoter) {
        queueEntry.receivedBestVoter = receivedVoter
        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:t receivedVoter ${NodeList.activeIdToPartition.get(receivedVoter.id)}`)
        return true
      } else {
        if (queueEntry.executionGroupMap.has(vote.node_id)) {
          queueEntry.receivedBestVoter = queueEntry.executionGroupMap.get(
            vote.node_id
          ) as Shardus.NodeWithRank
          /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:t receivedVoter2 ${NodeList.activeIdToPartition.get(queueEntry.receivedBestVoter.id)}`)
          return true
        }
        /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(`0x53455103 ${shardusGetTime()} tx:${queueEntry.acceptedTx.txId} Note over ${NodeList.activeIdToPartition.get(Self.id)}: gossipHandlerAV:f no_receivedVoter`)
        return false
      }
      // No need to forward the gossip here as it's being done in the gossip handler
    }
  }

  tryAppendVoteHash(queueEntry: QueueEntry, voteHash: AppliedVoteHash): boolean {
    // Check if sender is in execution group
    if (!queueEntry.executionGroup.some((node) => node.publicKey === voteHash.sign.owner)) {
      nestedCountersInstance.countEvent('poqo', 'Vote sender not in execution group')
      return false
    }

    const numVotes = queueEntry.collectedVoteHashes.length

    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tryAppendVoteHash', `${queueEntry.logID}`, `collectedVotes: ${queueEntry.collectedVoteHashes.length}`)
    /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`tryAppendVoteHash collectedVotes: ${queueEntry.logID}   ${queueEntry.collectedVoteHashes.length} `)

    // just add the vote if we dont have any yet
    if (numVotes === 0) {
      queueEntry.collectedVoteHashes.push(voteHash)
      queueEntry.newVotes = true
      queueEntry.lastVoteReceivedTimestamp = shardusGetTime()
      return true
    }

    //compare to existing votes.  keep going until we find that this vote is already in the list or our id is at the right spot to insert sorted
    for (let i = 0; i < numVotes; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const currentVote = queueEntry.collectedVoteHashes[i]

      if (currentVote.sign.owner === voteHash.sign.owner) {
        // already in our list so do nothing and return
        return false
      }
    }

    queueEntry.collectedVoteHashes.push(voteHash)
    queueEntry.newVotes = true
    queueEntry.lastVoteReceivedTimestamp = shardusGetTime()
    return true
  }
  
}

export default TransactionConsenus
