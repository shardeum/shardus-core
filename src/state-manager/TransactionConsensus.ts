import { CycleRecord } from '@shardus/types/build/src/p2p/CycleCreatorTypes'
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
import {
  AppliedReceipt,
  AppliedReceipt2,
  AppliedVote,
  AppliedVoteHash,
  AppliedVoteQuery,
  AppliedVoteQueryResponse,
  ConfirmOrChallengeMessage,
  QueueEntry,
  RequestReceiptForTxReq,
  RequestReceiptForTxResp,
  WrappedResponses,
} from './state-manager-types'
import { shardusGetTime } from '../network'
import { robustQuery } from '../p2p/Utils'
import { SignedObject } from '@shardus/crypto-utils'
import { isDebugModeMiddleware } from '../network/debugMiddleware'

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
  fatalLogger: log4jLogger
  shardLogger: log4jLogger
  statsLogger: log4jLogger
  statemanager_fatal: (key: string, log: string) => void

  txTimestampCache: { [key: string | number]: { [key: string]: TimestampReceipt } }

  waitTimeBeforeConfirm: number
  waitTimeBeforeReceipt: number

  produceBadVote: boolean
  produceBadChallenge: boolean

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
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal
    this.txTimestampCache = {}

    // todo: put these values in server config
    this.waitTimeBeforeConfirm = 1000
    this.waitTimeBeforeReceipt = 1000

    this.produceBadVote = this.config.debug.produceBadVote
    this.produceBadChallenge = this.config.debug.produceBadChallenge
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
    Context.network.registerExternalGet('debug-produceBadVote', isDebugModeMiddleware, (req, res) => {
      this.produceBadVote = !this.produceBadVote
      res.json({ status: 'ok' })
    })

    Context.network.registerExternalGet('debug-produceBadChallenge', isDebugModeMiddleware, (req, res) => {
      this.produceBadChallenge = !this.produceBadChallenge
      res.json({ status: 'ok' })
    })

    this.p2p.registerInternal(
      'get_tx_timestamp',
      async (
        payload: { txId: string; cycleCounter: number; cycleMarker: string },
        respond: (arg0: Shardus.TimestampReceipt) => unknown
      ) => {
        const { txId, cycleCounter, cycleMarker } = payload
        /* eslint-disable security/detect-object-injection */
        if (this.txTimestampCache[cycleCounter] && this.txTimestampCache[cycleCounter][txId]) {
          await respond(this.txTimestampCache[cycleCounter][txId])
        } else {
          const tsReceipt: Shardus.TimestampReceipt = this.generateTimestampReceipt(
            txId,
            cycleMarker,
            cycleCounter
          )
          await respond(tsReceipt)
        }
        /* eslint-enable security/detect-object-injection */
      }
    )

    this.p2p.registerInternal(
      'get_applied_vote',
      async (payload: AppliedVoteQuery, respond: (arg0: AppliedVoteQueryResponse) => unknown) => {
        nestedCountersInstance.countEvent('consensus', 'get_applied_vote')
        const { txId } = payload
        let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(txId)
        if (queueEntry == null) {
          // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
          queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(txId, 'get_applied_vote')
        }

        if (queueEntry == null) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`get_applied_vote no queue entry for ${payload.txId} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txId)]}`)
          return
        }
        if (queueEntry.receivedBestVote == null) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`get_applied_vote no receivedBestVote for ${payload.txId} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txId)]}`)
          return
        }
        const appliedVote: AppliedVoteQueryResponse = {
          txId,
          appliedVote: queueEntry.receivedBestVote,
          appliedVoteHash: queueEntry.receivedBestVoteHash
            ? queueEntry.receivedBestVoteHash
            : this.calculateVoteHash(queueEntry.receivedBestVote),
        }
        await respond(appliedVote)
      }
    )

    Comms.registerGossipHandler(
      'gossip-applied-vote',
      async (payload: AppliedVote, sender: string, tracker: string) => {
        nestedCountersInstance.countEvent('consensus', 'gossip-applied-vote')
        profilerInstance.scopedProfileSectionStart('gossip-applied-vote', true)
        try {
          const queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(payload.txid) // , payload.timestamp)
          if (queueEntry == null) {
            return
          }
          const newVote = payload as AppliedVote
          const appendSuccessful = this.stateManager.transactionConsensus.tryAppendVote(queueEntry, newVote)

          if (appendSuccessful) {
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
                false
              )
            }
          }
        } finally {
          profilerInstance.scopedProfileSectionEnd('gossip-applied-vote')
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
                false
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
        payload: {
          txid: string
          result?: boolean
          appliedVote?: AppliedVote
          signatures?: Shardus.Sign[]
          app_data_hash?: string
        },
        tracker: string,
        msgSize: number
      ) => {
        nestedCountersInstance.countEvent('consensus', 'spread_appliedReceipt2')
        profilerInstance.scopedProfileSectionStart('spread_appliedReceipt2', false, msgSize)
        let respondSize = cUninitializedSize
        try {
          const appliedReceipt = payload as AppliedReceipt2
          let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(appliedReceipt.txid) // , payload.timestamp)
          if (queueEntry == null) {
            if (queueEntry == null) {
              // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
              queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(
                payload.txid as string,
                'spread_appliedReceipt2'
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
              'spread_appliedReceipt2',
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

          if (queueEntry.state === 'expired') {
            //have we tried to repair this yet?
            const startRepair = queueEntry.repairStarted === false
            /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`spread_appliedReceipt2. tx expired. start repair:${startRepair}. update ${queueEntry.logID} receiptNotNull:${receiptNotNull}`)
            if (queueEntry.repairStarted === false) {
              nestedCountersInstance.countEvent('repair1', 'got receipt for expiredTX start repair')
              queueEntry.appliedReceiptForRepair2 = appliedReceipt
              //todo any limits to how many repairs at once to allow?
              this.stateManager.getTxRepair().repairToMatchReceipt(queueEntry)
            }
            //x - dont forward gossip, it is probably too late?
            //do forward gossip so we dont miss on sharing a receipt!
            //return
          }

          if (queueEntry.gossipedReceipt === false) {
            queueEntry.gossipedReceipt = true
            /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`spread_appliedReceipt2 update ${queueEntry.logID} receiptNotNull:${receiptNotNull}`)

            if (queueEntry.archived === false) {
              queueEntry.recievedAppliedReceipt2 = appliedReceipt
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
                'spread_appliedReceipt2',
                appliedReceipt,
                tracker,
                sender,
                gossipGroup,
                false
              )
            }
          } else {
            // we get here if the receipt has already been shared
            /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`spread_appliedReceipt2 skipped ${queueEntry.logID} receiptNotNull:${receiptNotNull} Already Shared`)
          }
        } catch (ex) {
          this.statemanager_fatal(
            `spread_appliedReceipt2_ex`,
            'spread_appliedReceipt2 endpoint failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack
          )
        } finally {
          profilerInstance.scopedProfileSectionEnd('spread_appliedReceipt2', respondSize)
        }
      }
    )

    Comms.registerGossipHandler(
      'spread_confirmOrChallenge',
      (payload: ConfirmOrChallengeMessage, msgSize: number) => {
        nestedCountersInstance.countEvent('consensus', 'spread_confirmOrChallenge')
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
            return
          }

          const appendSuccessful = this.tryAppendMessage(queueEntry, payload)

          if (appendSuccessful) {
            // Gossip further
            const sender = null
            const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
            Comms.sendGossip('spread_confirmOrChallenge', payload, '', sender, gossipGroup, false, 10)
          }
        } catch (e) {
          this.mainLogger.error(`Error in spread_confirmOrChallenge handler: ${e.message}`)
        } finally {
          profilerInstance.scopedProfileSectionEnd('spread_confirmOrChallenge', msgSize)
        }
      }
    )
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
      // Date.now() was replaced with shardusGetTime() so we can have a more reliable timestamp consensus
      timestamp: shardusGetTime(),
    }
    const signedTsReceipt = this.crypto.sign(tsReceipt)
    /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`Timestamp receipt generated for txId ${txId}: ${utils.stringifyReduce(signedTsReceipt)}`)

    // caching ts receipt for later nodes
    if (!this.txTimestampCache[signedTsReceipt.cycleCounter]) {
      this.txTimestampCache[signedTsReceipt.cycleCounter] = {}
    }
    // eslint-disable-next-line security/detect-object-injection
    this.txTimestampCache[signedTsReceipt.cycleCounter][txId] = signedTsReceipt
    return signedTsReceipt
  }

  pruneTxTimestampCache(): void {
    for (const key in this.txTimestampCache) {
      if (parseInt(key) + 1 < CycleChain.newest.counter) {
        // eslint-disable-next-line security/detect-object-injection
        delete this.txTimestampCache[key]
      }
    }
    if (logFlags.debug) this.mainLogger.debug(`Pruned tx timestamp cache.`)
  }

  async askTxnTimestampFromNode(
    tx: Shardus.OpaqueTransaction,
    txId: string
  ): Promise<Shardus.TimestampReceipt | null> {
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
      const timestampReceipt = await Comms.ask(homeNode.node, 'get_tx_timestamp', {
        cycleMarker,
        cycleCounter,
        txId,
        tx,
      })
      delete timestampReceipt.isResponse
      const isValid = this.crypto.verify(timestampReceipt, homeNode.node.publicKey)
      if (isValid) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`Timestamp receipt received from home node. TxId: ${txId} isValid: ${isValid}, timestampReceipt: ${JSON.stringify(timestampReceipt)}`)
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
  async shareAppliedReceipt(queueEntry: QueueEntry): Promise<void> {
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

      const payload = queueEntry.appliedReceipt2
      //let payload = queueEntry.recievedAppliedReceipt2 ?? queueEntry.appliedReceipt2
      this.p2p.sendGossipIn('spread_appliedReceipt2', payload, '', sender, gossipGroup, true)
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
  hasAppliedReceiptMatchingPreApply(queueEntry: QueueEntry, appliedReceipt: AppliedReceipt): boolean {
    // This is much easier than the old way
    if (queueEntry.ourVote) {
      const reciept = queueEntry.appliedReceipt2 ?? queueEntry.recievedAppliedReceipt2
      if (reciept != null && queueEntry.ourVoteHash != null) {
        if (this.calculateVoteHash(reciept.appliedVote) === queueEntry.ourVoteHash) {
          return true
        } else {
          /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} state does not match missing id:${utils.stringifyReduce(reciept.txid)} `)
          return false
        }
      }
      return false
    }

    if (appliedReceipt == null) {
      return false
    }

    if (queueEntry.ourVote == null) {
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} ourVote == null`)
      return false
    }

    if (appliedReceipt != null) {
      if (appliedReceipt.result !== queueEntry.ourVote.transaction_result) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} ${appliedReceipt.result}, ${queueEntry.ourVote.transaction_result} appliedReceipt.result !== queueEntry.ourVote.transaction_result`)
        return false
      }
      if (appliedReceipt.txid !== queueEntry.ourVote.txid) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} appliedReceipt.txid !== queueEntry.ourVote.txid`)
        return false
      }
      if (appliedReceipt.appliedVotes.length === 0) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} appliedReceipt.appliedVotes.length == 0`)
        return false
      }

      if (appliedReceipt.appliedVotes[0].cant_apply === true) {
        // TODO STATESHARDING4 NEGATIVECASE    need to figure out what to do here
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} appliedReceipt.appliedVotes[0].cant_apply === true`)
        //If the network votes for cant_apply then we wouldn't need to patch.  We return true here
        //but outside logic will have to know to check cant_apply flag and make sure to not commit data
        return true
      }

      //we return true for a false receipt because there is no need to repair our data to match the receipt
      //it is already checked above if we matched the result
      if (appliedReceipt.result === false) {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} result===false Good Match`)
        return true
      }

      //test our data against a winning vote in the receipt
      let wrappedStates = this.stateManager.useAccountWritesOnly ? {} : queueEntry.collectedData

      let wrappedStateKeys = Object.keys(queueEntry.collectedData)
      const vote = appliedReceipt.appliedVotes[0] //all votes are equivalent, so grab the first

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

      for (let j = 0; j < vote.account_id.length; j++) {
        /* eslint-disable security/detect-object-injection */
        const id = vote.account_id[j]
        const hash = vote.account_state_hash_after[j]
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
  async tryProduceReceipt(queueEntry: QueueEntry): Promise<AppliedReceipt> {
    const receipt2 = queueEntry.recievedAppliedReceipt2 ?? queueEntry.appliedReceipt2
    if (receipt2 != null) {
      //we have a receipt2, so we can make a receipt
      return {
        result: receipt2.result,
        appliedVotes: [receipt2.appliedVote], // everything is the same but the applied vote is an array
        txid: receipt2.txid,
        app_data_hash: receipt2.app_data_hash,
      }
    }

    if (queueEntry.waitForReceiptOnly === true) {
      return null
    }

    // TEMP hack.. allow any node to try and make a receipt
    // if (this.stateManager.transactionQueue.executeInOneShard && queueEntry.isInExecutionHome === false) {
    //   return null
    // }

    if (queueEntry.appliedReceipt != null) {
      return queueEntry.appliedReceipt
    }

    // Design TODO:  should this be the full transaction group or just the consensus group?
    let votingGroup

    if (
      this.stateManager.transactionQueue.executeInOneShard &&
      this.stateManager.transactionQueue.useNewPOQ === false
    ) {
      //use execuiton group instead of full transaciton group, since only the execution group will run the transaction
      votingGroup = queueEntry.executionGroup
    } else {
      votingGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
    }

    if (this.stateManager.transactionQueue.useNewPOQ === false) {
      const requiredVotes = Math.round(votingGroup.length * (2 / 3.0)) //hacky for now.  debug code:

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
            app_data_hash: appliedReceipt2.app_data_hash,
          }
          queueEntry.appliedReceipt = appliedReceipt

          return appliedReceipt
        }
      }
    } else {
      const now = Date.now()
      const timeSinceLastConfirmOrChallenge =
        queueEntry.lastConfirmOrChallengeTimestamp > 0 ? now - queueEntry.lastConfirmOrChallengeTimestamp : 0
      // check if last vote confirm/challenge received is 1s ago
      if (timeSinceLastConfirmOrChallenge >= this.waitTimeBeforeReceipt) {
        // stop accepting the vote messages, confirm or challenge for this tx
        queueEntry.acceptVoteMessage = false
        queueEntry.acceptConfirmOrChallenge = false

        // we have received challenge message, produce failed receipt
        if (queueEntry.receivedBestChallenge && queueEntry.receivedBestChallenger) {
          const appliedReceipt: AppliedReceipt = {
            txid: queueEntry.receivedBestChallenge.appliedVote.txid,
            result: false,
            appliedVotes: [],
            app_data_hash: '',
          }
          queueEntry.appliedReceipt = appliedReceipt
          if (logFlags.debug)
            this.mainLogger.debug(
              `tryProduceReceipt: producing a fail receipt based on received challenge message. appliedReceipt: ${utils.stringifyReduce(
                appliedReceipt
              )}`
            )
          const receiptFromRobustQuery = await this.robustQueryBestReceipt(queueEntry)

          // Received a confrim receipt. We have a challenge receipt which is better.
          if (receiptFromRobustQuery.result !== false) return appliedReceipt

          // Received another challenge receipt. Compare ranks
          let bestNodeFromRobustQuery: Shardus.NodeWithRank
          for (const node of queueEntry.executionGroup) {
            if (node.id === receiptFromRobustQuery.appliedVote.node_id) {
              bestNodeFromRobustQuery = node
            }
          }
          const isRobustQueryNodeBetter =
            bestNodeFromRobustQuery.rank < queueEntry.receivedBestChallenger.rank
          if (isRobustQueryNodeBetter) {
            if (logFlags.debug)
              this.mainLogger.debug(
                `tryProduceReceipt: ${
                  queueEntry.logID
                } receipt from robust query is better than our receipt. receiptFromRobustQuery: ${utils.stringify(
                  receiptFromRobustQuery
                )}`
              )
            return {
              txid: receiptFromRobustQuery.txid,
              result: receiptFromRobustQuery.result,
              appliedVotes: [receiptFromRobustQuery.appliedVote],
              app_data_hash: receiptFromRobustQuery.app_data_hash,
            }
          } else {
            return appliedReceipt
          }
        }

        // create receipt
        // The receipt for the transactions is the lowest ranked challenge message or if there is no challenge the lowest ranked confirm message
        // loop through "confirm" messages and "challenge" messages to decide the final receipt
        if (queueEntry.receivedBestConfirmation && queueEntry.receivedBestConfirmedNode) {
          const winningVote = queueEntry.receivedBestConfirmation.appliedVote
          if (winningVote !== null) {
            const appliedReceipt: AppliedReceipt = {
              txid: winningVote.txid,
              result: winningVote.transaction_result,
              appliedVotes: [winningVote],
              app_data_hash: '',
            }
            const appliedReceipt2: AppliedReceipt2 = {
              txid: winningVote.txid,
              result: winningVote.transaction_result,
              appliedVote: winningVote,
              app_data_hash: '',
              signatures: [winningVote.sign],
            }
            console.log(
              `LPOQ: producing a confirm receipt based on received confirmation message`,
              queueEntry.logID,
              appliedReceipt,
              appliedReceipt2
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
            queueEntry.appliedReceipt = appliedReceipt
            queueEntry.appliedReceipt2 = appliedReceipt2
          }
          // do a robust query to confirm that we have the best receipt
          // (lower the rank of confirm message, the better the receipt is)
          const receiptFromRobustQuery = await this.robustQueryBestReceipt(queueEntry)

          if (receiptFromRobustQuery == null) {
            return
          }

          // Received challenge receipt, we have confirm receipt which is not better
          if (receiptFromRobustQuery.result === false) {
            return {
              txid: receiptFromRobustQuery.txid,
              result: receiptFromRobustQuery.result,
              appliedVotes: [receiptFromRobustQuery.appliedVote],
              app_data_hash: receiptFromRobustQuery.app_data_hash,
            }
          }

          // Received another confirm receipt. Compare ranks
          let bestNodeFromRobustQuery: Shardus.NodeWithRank
          for (const node of queueEntry.executionGroup) {
            if (node.id === receiptFromRobustQuery.appliedVote.node_id) {
              bestNodeFromRobustQuery = node
            }
          }

          const isRobustQueryNodeBetter = bestNodeFromRobustQuery.rank < queueEntry.receivedBestVoter.rank
          if (isRobustQueryNodeBetter) {
            console.log(
              'LPOQ: producing a confirm receipt based on robust query',
              queueEntry.logID,
              receiptFromRobustQuery
            )
            const appliedReceipt: AppliedReceipt = {
              txid: receiptFromRobustQuery.txid,
              result: receiptFromRobustQuery.result,
              appliedVotes: [receiptFromRobustQuery.appliedVote],
              app_data_hash: receiptFromRobustQuery.app_data_hash,
            }
            const appliedReceipt2: AppliedReceipt2 = {
              txid: receiptFromRobustQuery.txid,
              result: receiptFromRobustQuery.result,
              appliedVote: receiptFromRobustQuery.appliedVote,
              app_data_hash: receiptFromRobustQuery.app_data_hash,
              signatures: [receiptFromRobustQuery.appliedVote.sign],
            }
            queueEntry.appliedReceipt = appliedReceipt
            queueEntry.appliedReceipt2 = appliedReceipt2
            return appliedReceipt
          } else {
            return queueEntry.appliedReceipt
          }
        }
      } else {
        if (logFlags.debug)
          this.mainLogger.debug(
            `tryProduceReceipt: ${queueEntry.logID} not producing receipt yet because timeSinceLastConfirmOrChallenge is ${timeSinceLastConfirmOrChallenge} ms`
          )
      }
    }
    return null
  }

  async robustQueryBestReceipt(queueEntry: QueueEntry): Promise<AppliedReceipt2> {
    const queryFn = async (node: Shardus.Node): Promise<RequestReceiptForTxResp> => {
      const ip = node.externalIp
      const port = node.externalPort
      // the queryFunction must return null if the given node is our own
      if (ip === Self.ip && port === Self.port) return null
      const message: RequestReceiptForTxReq = {
        txid: queueEntry.acceptedTx.txId,
        timestamp: queueEntry.acceptedTx.timestamp,
      }
      return await Comms.ask(node, 'request_receipt_for_tx', message)
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
    console.log(`robustQueryBestReceipt top response is: ${JSON.stringify(response)}`)
    if (response && response.receipt) {
      return response.receipt
    }
  }

  async robustQueryBestVote(queueEntry: QueueEntry): Promise<AppliedVote> {
    const queryFn = async (node: Shardus.Node): Promise<AppliedVoteQueryResponse> => {
      const ip = node.externalIp
      const port = node.externalPort
      // the queryFunction must return null if the given node is our own
      if (ip === Self.ip && port === Self.port) return null
      const queryData: AppliedVoteQuery = { txId: queueEntry.acceptedTx.txId }
      return await Comms.ask(node, 'get_applied_vote', queryData)
    }
    const eqFn = (item1: AppliedVoteQueryResponse, item2: AppliedVoteQueryResponse): boolean => {
      console.log(`robustQueryBestVote eqFn item is: ${JSON.stringify(item1)}`)
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
      true
    )
    console.log(`robustQueryBestVote top response is: ${JSON.stringify(response)}`)
    if (response && response.appliedVote) {
      return response.appliedVote
    }
  }

  async tryConfirmOrChallenge(queueEntry: QueueEntry): Promise<void> {
    if (queueEntry.gossipedConfirmOrChallenge === true) {
      return
    }
    if (queueEntry.isInExecutionHome === false) {
      return
    }
    if (queueEntry.ourVote == null) {
      return
    }
    this.profiler.profileSectionStart('tryConfirmOrChallenge')
    try {
      if (logFlags.debug)
        this.mainLogger.debug(
          `tryConfirmOrChallenge: ${queueEntry.logID}  receivedBestVote: ${JSON.stringify(
            queueEntry.receivedBestVote
          )}} `
        )

      const now = Date.now()
      //  if we are in lowest 10% of execution group and agrees with the highest ranked vote, send out a confirm msg
      const eligibleToConfirm = queueEntry.eligibleNodesToConfirm.map((node) => node.id).includes(Self.id)
      const timeSinceLastVoteMessage =
        queueEntry.lastVoteReceivedTimestamp > 0 ? now - queueEntry.lastVoteReceivedTimestamp : 0
      // check if last confirm/challenge received is 1s ago
      if (timeSinceLastVoteMessage >= this.waitTimeBeforeConfirm) {
        // stop accepting the vote messages for this tx
        queueEntry.acceptVoteMessage = false

        // confirm that current vote is the winning highest ranked vote using robustQuery
        const voteFromRobustQuery = await this.robustQueryBestVote(queueEntry)
        if (voteFromRobustQuery == null) {
          // we cannot confirm the best vote from network
          this.mainLogger.error(`We cannot get voteFromRobustQuery for tx ${queueEntry.acceptedTx.txId}`)
          return
        }
        let bestVoterFromRobustQuery: Shardus.NodeWithRank
        for (const node of queueEntry.executionGroup) {
          if (node.id === voteFromRobustQuery.node_id) {
            bestVoterFromRobustQuery = node
          }
        }
        if (bestVoterFromRobustQuery == null) {
          // we cannot confirm the best voter from network
          this.mainLogger.error(
            `We cannot get bestVoter from robustQuery for tx ${queueEntry.acceptedTx.txId}`
          )
          return
        }

      // if vote from robust is better than our received vote, use it as final vote
      const isRobustQueryVoteBetter = bestVoterFromRobustQuery.rank > queueEntry.receivedBestVoter.rank
      let finalVote = queueEntry.receivedBestVote
      if (isRobustQueryVoteBetter) {
        finalVote = voteFromRobustQuery
      }
      const finalVoteHash = this.calculateVoteHash(finalVote)
      const shouldChallenge = queueEntry.ourVoteHash !== finalVoteHash
        // todo: podA: POQ2 handle if we can't figure out the best voter from robust query result (low priority)

      // if we are in execution group and disagree with the highest ranked vote, send out a "challenge" message
      const isInExecutionSet = queueEntry.executionIdSet.has(Self.id)
      if (isInExecutionSet && queueEntry.ourVoteHash !== finalVoteHash) {
        this.challengeVoteAndShare(queueEntry)
      }
        // if vote from robust is better than our received vote, use it as final vote
        const isRobustQueryVoteBetter = bestVoterFromRobustQuery.rank > queueEntry.receivedBestVoter.rank
        let finalVote = queueEntry.receivedBestVote
        if (isRobustQueryVoteBetter) {
          finalVote = voteFromRobustQuery
        }
        const finalVoteHash = this.calculateVoteHash(finalVote)
        const shouldChallenge = queueEntry.ourVoteHash !== finalVoteHash

        // if we are in execution group and disagree with the highest ranked vote, send out a "challenge" message
        const isInExecutionSet = queueEntry.executionIdSet.has(Self.id)
        if (logFlags.debug)
          this.mainLogger.debug(
            `tryConfirmOrChallenge: ${queueEntry.logID} isInExecutionSet: ${isInExecutionSet}, eligibleToConfirm: ${eligibleToConfirm}, shouldChallenge: ${shouldChallenge}`
          )
        if (isInExecutionSet && shouldChallenge) {
          this.challengeVoteAndShare(queueEntry)
        }

      if (eligibleToConfirm && queueEntry.ourVoteHash === finalVoteHash) {
        // queueEntry.eligibleNodesToConfirm is sorted highest to lowest rank
        const eligibleNodeIds = queueEntry.eligibleNodesToConfirm.map((node) => node.id).reverse()
        const ourRankIndex = eligibleNodeIds.indexOf(Self.id)
        const delayBeforeConfirm = ourRankIndex * 100 // 100ms
        let isReceivedBetterConfirmation = false
        if (eligibleToConfirm && queueEntry.ourVoteHash === finalVoteHash) {
          // queueEntry.eligibleNodesToConfirm is sorted highest to lowest rank
          const eligibleNodeIds = queueEntry.eligibleNodesToConfirm.map((node) => node.id).reverse()
          const ourRankIndex = eligibleNodeIds.indexOf(Self.id)
          const delayBeforeConfirm = ourRankIndex * 100 // 100ms
          let isReceivedBetterConfirmation = false

        await utils.sleep(delayBeforeConfirm)
          await utils.sleep(delayBeforeConfirm)

        // Compare our rank with received rank
        if (
          queueEntry.receivedBestConfirmedNode &&
          queueEntry.receivedBestConfirmedNode.rank < queueEntry.ourNodeRank
        ) {
          isReceivedBetterConfirmation = true
        }
        if (isReceivedBetterConfirmation) {
          nestedCountersInstance.countEvent(
            'transactionConsensus',
            'tryConfirmOrChallenge isReceivedBetterConfirmation: true'
          )
          return
          // Compare our rank with received rank
          if (
            queueEntry.receivedBestConfirmedNode &&
            queueEntry.receivedBestConfirmedNode.rank < queueEntry.ourNodeRank
          ) {
            isReceivedBetterConfirmation = true
          }
          if (isReceivedBetterConfirmation) {
            if (logFlags.debug)
              this.mainLogger.debug(
                `tryConfirmOrChallenge: ${
                  queueEntry.logID
                } received better confirmation before we share ours, receivedBestConfirmation: ${utils.stringifyReduce(
                  queueEntry.receivedBestConfirmation
                )}`
              )
            nestedCountersInstance.countEvent(
              'transactionConsensus',
              'tryConfirmOrChallenge isReceivedBetterConfirmation: true'
            )
            return
          }
          // BAD NODE SIMULATION
          if (this.config.debug.produceBadChallenge) {
            this.challengeVoteAndShare(queueEntry)
          } else {
            this.confirmVoteAndShare(queueEntry)
          }
        }
        queueEntry.gossipedConfirmOrChallenge = true
      }
    } catch (e) {
      this.mainLogger.error(`tryConfirmOrChallenge: ${queueEntry.logID} ${e.message} ${e.stack}`)
    } finally {
      this.profiler.profileSectionEnd('tryConfirmOrChallenge')
    }
  }

  sortByAccountId(first: Shardus.WrappedResponse, second: Shardus.WrappedResponse): Ordering {
    return utils.sortAscProp(first, second, 'accountId')
  }

  confirmVoteAndShare(queueEntry: QueueEntry): void {
    this.profiler.profileSectionStart('confirmOrChallengeVote')
    /* prettier-ignore */
    if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote("shrd_confirmOrChallengeVote", `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `);

    // podA: POQ3 create confirm message and share to tx group
    const confirmMessage: ConfirmOrChallengeMessage = {
      message: 'confirm',
      nodeId: queueEntry.ourVote.node_id,
      appliedVote: queueEntry.ourVote,
    }
    const signedConfirmMessage = this.crypto.sign(confirmMessage)
    this.mainLogger.debug(`confirmVoteAndShare: ${queueEntry.logID}  ${JSON.stringify(confirmMessage)}}`)

    //Share message to tx group
    const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
    Comms.sendGossip('spread_confirmOrChallenge', signedConfirmMessage, '', null, gossipGroup, true, 10)
    queueEntry.gossipedConfirmOrChallenge = true

    this.profiler.profileSectionEnd('confirmOrChallengeVote')
  }

  challengeVoteAndShare(queueEntry: QueueEntry): void {
    this.profiler.profileSectionStart('confirmOrChallengeVote')
    /* prettier-ignore */
    if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote("shrd_confirmOrChallengeVote", `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `);

    //podA: POQ4 create challenge message and share to tx group
    const challengeMessage: ConfirmOrChallengeMessage = {
      message: 'challenge',
      nodeId: queueEntry.ourVote.node_id,
      appliedVote: queueEntry.ourVote,
    }
    const signedConfirmMessage = this.crypto.sign(challengeMessage)

    //Share message to tx group
    const gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
    Comms.sendGossip('spread_confirmOrChallenge', signedConfirmMessage, '', null, gossipGroup, true, 10)
    queueEntry.gossipedConfirmOrChallenge = true

    this.profiler.profileSectionEnd('confirmOrChallengeVote')
    return null
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
      return
    }
    this.profiler.profileSectionStart('createAndShareVote')

    try {
      const ourNodeId = Self.id
      const eligibleNodeIds = queueEntry.eligibleNodesToVote.map((node) => node.id)
      const isEligibleToShareVote = eligibleNodeIds.includes(ourNodeId)
      let isReceivedBetterVote = false

      // create our vote (for later use) even if we have received a better vote
      let ourVote: AppliedVote = {
        txid: queueEntry.acceptedTx.txId,
        transaction_result: queueEntry.preApplyTXResult.passed,
        account_id: [],
        account_state_hash_after: [],
        node_id: ourNodeId,
        cant_apply: queueEntry.preApplyTXResult.applied === false,
        app_data_hash: '',
      }

      // BAD NODE SIMULATION
      if (this.config.debug.produceBadVote) {
        ourVote.transaction_result = !ourVote.transaction_result
      }

    // BAD NODE SIMULATION
    if (this.produceBadVote) {
      ourVote.transaction_result = !ourVote.transaction_result
    }

    ourVote.app_data_hash = queueEntry?.preApplyTXResult?.applyResponse.appReceiptDataHash

      if (queueEntry.debugFail_voteFlip === true) {
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_createAndShareVote_voteFlip', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `)

        ourVote.transaction_result = !ourVote.transaction_result
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

          ourVote.account_id.push(wrappedState.accountId)
          ourVote.account_state_hash_after.push(wrappedState.stateId)
        }
      }

      let appliedVoteHash: AppliedVoteHash
      //let temp = ourVote.node_id
      // ourVote.node_id = '' //exclue this from hash
      ourVote = this.crypto.sign(ourVote)
      const voteHash = this.calculateVoteHash(ourVote)
      //ourVote.node_id = temp
      appliedVoteHash = {
        txid: ourVote.txid,
        voteHash,
      }
      queueEntry.ourVoteHash = voteHash

      if (logFlags.verbose)
        this.mainLogger.debug(
          `createAndShareVote ourVote: ${utils.stringifyReduce(
            ourVote
          )}, isEligibleToShareVote: ${isEligibleToShareVote}, isReceivedBetterVote: ${isReceivedBetterVote}`
        )

      //append our vote
      appliedVoteHash = this.crypto.sign(appliedVoteHash)
      if (this.stateManager.transactionQueue.useNewPOQ === false)
        this.tryAppendVoteHash(queueEntry, appliedVoteHash)

      // save our vote to our queueEntry
      queueEntry.ourVote = ourVote

      if (this.stateManager.transactionQueue.useNewPOQ) {
        if (isEligibleToShareVote === false) {
          nestedCountersInstance.countEvent(
            'transactionConsensus',
            'createAndShareVote isEligibleToShareVote:' + ' false'
          )
          return
        }
        const ourRankIndex = eligibleNodeIds.indexOf(ourNodeId)
        let delayBeforeVote = ourRankIndex * 100 // 100ms

        if (delayBeforeVote > 1000) {
          delayBeforeVote = 1000
        }

        nestedCountersInstance.countEvent(
          'transactionConsensus',
          `createAndShareVote delayBeforeSharingVote: ${delayBeforeVote} ms`
        )
        await utils.sleep(delayBeforeVote)

        // Compare our rank with received rank
        if (queueEntry.receivedBestVoter && queueEntry.receivedBestVoter.rank > queueEntry.ourNodeRank) {
          isReceivedBetterVote = true
        }

        if (isReceivedBetterVote) {
          nestedCountersInstance.countEvent(
            'transactionConsensus',
            'createAndShareVote isReceivedBetterVote: true'
          )
          return
        }
        // tryAppend before sharing
        const appendWorked = this.tryAppendVote(queueEntry, ourVote)
        if (appendWorked === false) {
          nestedCountersInstance.countEvent('transactionConsensus', 'createAndShareVote appendFailed')
        }
      }

      let consensusGroup = []
      if (
        this.stateManager.transactionQueue.executeInOneShard === true &&
        this.stateManager.transactionQueue.useNewPOQ === false
      ) {
        //only share with the exection group
        consensusGroup = queueEntry.executionGroup
      } else {
        //sharing with the entire transaction group actually..
        consensusGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
      }

      if (consensusGroup.length >= 1) {
        this.stateManager.debugNodeGroup(
          queueEntry.acceptedTx.txId,
          queueEntry.acceptedTx.timestamp,
          `share tx vote to neighbors`,
          consensusGroup
        )

        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`createAndShareVote numNodes: ${consensusGroup.length} stats:${utils.stringifyReduce(stats)} ourVote: ${utils.stringifyReduce(ourVote)}`)
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('createAndShareVote', `${queueEntry.acceptedTx.txId}`, `numNodes: ${consensusGroup.length} stats:${utils.stringifyReduce(stats)} ourVote: ${utils.stringifyReduce(ourVote)} `)

        // Filter nodes before we send tell()
        const filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
          consensusGroup,
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
          Comms.sendGossip('gossip-applied-vote', ourVote, '', null, filteredConsensusGroup, true, 4)
        } else {
          this.profiler.profileSectionStart('createAndShareVote-tell')
          this.p2p.tell(filteredConsensusGroup, 'spread_appliedVoteHash', appliedVoteHash)
          this.profiler.profileSectionEnd('createAndShareVote-tell')
        }
      } else {
        nestedCountersInstance.countEvent('transactionQueue', 'createAndShareVote fail, no consensus group')
      }
    } catch (e) {
      this.mainLogger.error(`createAndShareVote: error ${e.message}`)
    } finally {
      this.profiler.profileSectionEnd('createAndShareVote')
    }
  }

  calculateVoteHash(vote: AppliedVote, removeSign = true): string {
    const voteToHash = Object.assign({}, vote)
    if (this.stateManager.transactionQueue.useNewPOQ) {
      if (voteToHash.node_id && voteToHash.node_id.length > 0) voteToHash.node_id = ''
      if (removeSign && voteToHash.sign != null) delete voteToHash.sign
      return this.crypto.hash(voteToHash)
    } else {
      voteToHash.node_id = ''
      if (voteToHash.sign != null) delete voteToHash.sign
      return this.crypto.hash(voteToHash)
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
    /* prettier-ignore */
    if (logFlags.playback) this.logger.playbackLogNote("tryAppendMessage", `${queueEntry.logID}`, `collectedVotes: ${queueEntry.collectedVotes.length}`);
    /* prettier-ignore */
    if (logFlags.debug) this.mainLogger.debug(`tryAppendMessage confirmOrChallenge: ${queueEntry.logID}   ${JSON.stringify(confirmOrChallenge)} `);

    console.log(
      `tryAppendMessage confirmOrChallenge: ${queueEntry.logID}   ${JSON.stringify(confirmOrChallenge)} `
    )

    const foundNode = queueEntry.eligibleNodesToConfirm.find(
      (node) =>
        confirmOrChallenge.nodeId === node.id &&
        this.crypto.verify(confirmOrChallenge as SignedObject, node.publicKey)
    )

    if (!foundNode) {
      console.log('tryAppendMessage: Message signature does not match with any eligible nodes.')
      return
    }

    const isVoteValid = true
    if (!isVoteValid) return false

    // Check if the previous phase is finalized and we have received best vote
    if (queueEntry.acceptVoteMessage === true || !queueEntry.receivedBestVote) {
      console.log('tryAppendMessage: best vote is not received as previous phase is not finalized')
      return
    }

    // verify that the vote part of the message is for the same vote that was finalized in the previous phase
    if (
      this.calculateVoteHash(confirmOrChallenge.appliedVote) !==
      this.calculateVoteHash(queueEntry.receivedBestVote)
    ) {
      console.log(
        'tryAppendMessage: confirmOrChallenge is not for the same vote that was finalized in the previous phase'
      )
      return false
    }

    if (confirmOrChallenge.message === 'confirm') {
      let isBetterThanCurrentConfirmation
      let receivedConfirmedNode: Shardus.NodeWithRank

      if (!queueEntry.receivedBestConfirmation) isBetterThanCurrentConfirmation = true
      else if (queueEntry.receivedBestConfirmation.nodeId === confirmOrChallenge.nodeId)
        isBetterThanCurrentConfirmation = false
      else {
        // Compare ranks
        receivedConfirmedNode = queueEntry.executionGroup.find(
          (node) => node.id === confirmOrChallenge.nodeId
        )

        if (receivedConfirmedNode.rank === queueEntry.receivedBestConfirmedNode.rank) {
          // Compare ids if ranks are equal (rare edge case)
          isBetterThanCurrentConfirmation = receivedConfirmedNode.id > queueEntry.receivedBestConfirmedNode.id
        } else {
          isBetterThanCurrentConfirmation =
            receivedConfirmedNode.rank > queueEntry.receivedBestConfirmedNode.rank
        }
      }

      if (!isBetterThanCurrentConfirmation) {
        console.log(
          'tryAppendMessage: confirmation is not better than current confirmation',
          confirmOrChallenge,
          queueEntry.receivedBestConfirmation
        )
        return false
      }

      queueEntry.receivedBestConfirmation = confirmOrChallenge
      queueEntry.lastConfirmOrChallengeTimestamp = Date.now()
      if (receivedConfirmedNode) {
        queueEntry.receivedBestConfirmedNode = receivedConfirmedNode
        return true
      } else {
        for (const node of queueEntry.executionGroup) {
          if (node.id === confirmOrChallenge.nodeId) {
            queueEntry.receivedBestConfirmedNode = node
            return true
          }
        }
      }
    } else if (confirmOrChallenge.message === 'challenge') {
      let isBetterThanCurrentChallenge
      let receivedChallenger: Shardus.NodeWithRank

      if (!queueEntry.receivedBestChallenge) isBetterThanCurrentChallenge = true
      else if (queueEntry.receivedBestChallenge.nodeId === confirmOrChallenge.nodeId)
        isBetterThanCurrentChallenge = false
      else {
        // Compare ranks
        for (const node of queueEntry.executionGroup) {
          if (node.id === confirmOrChallenge.nodeId) {
            receivedChallenger = node
            break
          }
        }
        isBetterThanCurrentChallenge = receivedChallenger.rank < queueEntry.receivedBestChallenger.rank
      }

      if (!isBetterThanCurrentChallenge) {
        console.log(
          'tryAppendMessage: challenge is not better than current challenge',
          confirmOrChallenge,
          queueEntry.receivedBestChallenge
        )
        return false
      }

      queueEntry.receivedBestChallenge = confirmOrChallenge
      queueEntry.lastConfirmOrChallengeTimestamp = Date.now()
      if (receivedChallenger) {
        queueEntry.receivedBestChallenger = receivedChallenger
        return true
      } else {
        for (const node of queueEntry.executionGroup) {
          if (node.id === confirmOrChallenge.nodeId) {
            queueEntry.receivedBestChallenger = node
            return true
          }
        }
      }
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

      queueEntry.collectedVotes.push(vote)
      queueEntry.newVotes = true

      return true
    } else {
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tryAppendVote', `${queueEntry.logID}`, `vote: ${utils.stringifyReduce(vote)}`)
      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`tryAppendVote collectedVotes: ${queueEntry.logID}   vote: ${utils.stringifyReduce(vote)}`)

      const foundNode = queueEntry.eligibleNodesToVote.find(
        (node) => vote.node_id === node.id && this.crypto.verify(vote as SignedObject, node.publicKey)
      )

      if (!foundNode) {
        if (logFlags.debug) {
          this.mainLogger.debug(
            `tryAppendVote: logId:${
              queueEntry.logID
            } received node is not part of eligible nodes to vote, vote: ${utils.stringify(
              vote
            )}, eligibleNodesToVote: ${utils.stringify(queueEntry.eligibleNodesToVote)}`
          )
        }
        return
      }

      const isVoteValid = true
      if (!isVoteValid) return

      // we will mark the last received vote timestamp
      queueEntry.lastVoteReceivedTimestamp = Date.now()

      // Compare with existing vote. Skip we already have it or node rank is lower than ours
      let isBetterThanCurrentVote
      let recievedVoter: Shardus.NodeWithRank
      if (!queueEntry.receivedBestVote) isBetterThanCurrentVote = true
      else if (queueEntry.receivedBestVoteHash === this.calculateVoteHash(vote))
        isBetterThanCurrentVote = false
      else {
        // Compare ranks
        for (const node of queueEntry.executionGroup) {
          if (node.id === vote.node_id) {
            recievedVoter = node
            break
          }
        }
        isBetterThanCurrentVote = recievedVoter.rank > queueEntry.receivedBestVoter.rank
      }

      if (!isBetterThanCurrentVote) {
        if (logFlags.debug) {
          this.mainLogger.debug(
            `tryAppendVote: logId:${queueEntry.logID} received vote is not better than current vote`
          )
        }
        return false
      }

      queueEntry.receivedBestVote = vote
      queueEntry.receivedBestVoteHash = this.calculateVoteHash(vote)
      queueEntry.newVotes = true
      if (logFlags.debug) {
        this.mainLogger.debug(
          `tryAppendVote: logId:${queueEntry.logID} received vote is better than current vote`
        )
      }
      if (recievedVoter) {
        queueEntry.receivedBestVoter = recievedVoter
        return true
      } else {
        for (const node of queueEntry.executionGroup) {
          if (node.id === vote.node_id) {
            queueEntry.receivedBestVoter = node
            return true
          }
        }
      }
      // No need to forward the gossip here as it's being done in the gossip handler
    }
  }

  tryAppendVoteHash(queueEntry: QueueEntry, voteHash: AppliedVoteHash): boolean {
    const numVotes = queueEntry.collectedVotes.length

    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tryAppendVoteHash', `${queueEntry.logID}`, `collectedVotes: ${queueEntry.collectedVoteHashes.length}`)
    /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`tryAppendVoteHash collectedVotes: ${queueEntry.logID}   ${queueEntry.collectedVoteHashes.length} `)

    // just add the vote if we dont have any yet
    if (numVotes === 0) {
      queueEntry.collectedVoteHashes.push(voteHash)
      queueEntry.newVotes = true
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

    return true
  }
}

export default TransactionConsenus
