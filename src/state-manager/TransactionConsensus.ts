import * as Shardus from '../shardus/shardus-types'
import { TimestampReceipt } from '../shardus/shardus-types'
import * as utils from '../utils'
import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'
import * as Context from '../p2p/Context'
import { config, P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import ShardFunctions from './shardFunctions'
import StateManager from '.'
import {
  AppliedReceipt,
  AppliedReceipt2,
  AppliedVote,
  AppliedVoteHash,
  QueueEntry,
  WrappedResponses,
} from './state-manager-types'
import { nestedCountersInstance } from '../utils/nestedCounters'
import * as Self from '../p2p/Self'
import * as CycleChain from '../p2p/CycleChain'
import * as Comms from '../p2p/Comms'
import { CycleRecord } from '@shardus/types/build/src/p2p/CycleCreatorTypes'

class TransactionConsenus {
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

  txTimestampCache: any

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
    this.p2p.registerInternal('get_tx_timestamp', async (payload, respond) => {
      const { txId, cycleCounter, cycleMarker } = payload
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
    })

    this.p2p.registerGossipHandler(
      'spread_appliedReceipt',
      async (payload, sender, tracker, msgSize: number) => {
        profilerInstance.scopedProfileSectionStart('spread_appliedReceipt', false, msgSize)
        let respondSize = cUninitializedSize
        try {
          let appliedReceipt = payload as AppliedReceipt
          let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(appliedReceipt.txid) // , payload.timestamp)
          if (queueEntry == null) {
            if (queueEntry == null) {
              // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
              queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(
                payload.txid,
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

          let receiptNotNull = appliedReceipt != null

          if (queueEntry.gossipedReceipt === false) {
            queueEntry.gossipedReceipt = true
            /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`spread_appliedReceipt update ${queueEntry.logID} receiptNotNull:${receiptNotNull}`)

            if (queueEntry.archived === false) {
              queueEntry.recievedAppliedReceipt = appliedReceipt
            }

            // I think we handle the negative cases later by checking queueEntry.recievedAppliedReceipt vs queueEntry.appliedReceipt

            // share the appliedReceipt.
            let sender = null
            let gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
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
      async (payload, sender, tracker, msgSize: number) => {
        profilerInstance.scopedProfileSectionStart('spread_appliedReceipt2', false, msgSize)
        let respondSize = cUninitializedSize
        try {
          let appliedReceipt = payload as AppliedReceipt2
          let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(appliedReceipt.txid) // , payload.timestamp)
          if (queueEntry == null) {
            if (queueEntry == null) {
              // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
              queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(
                payload.txid,
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

          let receiptNotNull = appliedReceipt != null

          if (queueEntry.state === 'expired') {
            //have we tried to repair this yet?
            let startRepair = queueEntry.repairStarted === false
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
            let sender = null
            let gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
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
  }

  generateTimestampReceipt(
    txId,
    cycleMarker: string,
    cycleCounter: CycleRecord['counter']
  ): TimestampReceipt {
    const tsReceipt: TimestampReceipt = {
      txId,
      cycleMarker,
      cycleCounter,
      timestamp: Date.now(),
    }
    const signedTsReceipt = this.crypto.sign(tsReceipt)
    /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`Timestamp receipt generated for txId ${txId}: ${utils.stringifyReduce(signedTsReceipt)}`)

    // caching ts receipt for later nodes
    if (!this.txTimestampCache[signedTsReceipt.cycleCounter]) {
      this.txTimestampCache[signedTsReceipt.cycleCounter] = {}
    }
    this.txTimestampCache[signedTsReceipt.cycleCounter][txId] = signedTsReceipt
    return signedTsReceipt
  }

  pruneTxTimestampCache(): void {
    for (const key in this.txTimestampCache) {
      if (parseInt(key) + 1 < CycleChain.newest.counter) {
        delete this.txTimestampCache[key]
      }
    }
    if (logFlags.debug) this.mainLogger.debug(`Pruned tx timestamp cache.`)
  }

  async askTxnTimestampFromNode(tx, txId): Promise<Shardus.TimestampReceipt | null> {
    const homeNode = ShardFunctions.findHomeNode(
      Context.stateManager.currentCycleShardData.shardGlobals,
      txId,
      Context.stateManager.currentCycleShardData.parititionShardDataMap
    )
    const cycleMarker = CycleChain.computeCycleMarker(CycleChain.newest)
    const cycleCounter = CycleChain.newest.counter
    this.mainLogger.debug('Asking timestamp from node', homeNode.node)
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
  async shareAppliedReceipt(queueEntry: QueueEntry) {
    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_shareAppliedReceipt', `${queueEntry.logID}`, `qId: ${queueEntry.entryID} `)

    let appliedReceipt = queueEntry.appliedReceipt

    if (queueEntry.appliedReceipt2 == null) {
      //take no action
      /* prettier-ignore */ nestedCountersInstance.countEvent('transactionQueue', 'shareAppliedReceipt-skipped appliedReceipt2 == null')
      return
    }

    // share the appliedReceipt.
    let sender = null
    let gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)

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

      let payload = queueEntry.appliedReceipt2
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
      let reciept = queueEntry.appliedReceipt2 ?? queueEntry.recievedAppliedReceipt2
      if (reciept != null && queueEntry.ourVoteHash != null) {
        if (this.crypto.hash(reciept.appliedVote) === queueEntry.ourVoteHash) {
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
      let vote = appliedReceipt.appliedVotes[0] //all votes are equivalent, so grab the first

      // Iff we have accountWrites, then overwrite the keys and wrapped data
      let appOrderedKeys = []
      let writtenAccountsMap: WrappedResponses = {}
      let applyResponse = queueEntry?.preApplyTXResult?.applyResponse
      if (applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
        for (let wrappedAccount of applyResponse.accountWrites) {
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
        let id = vote.account_id[j]
        let hash = vote.account_state_hash_after[j]
        let found = false
        for (let key of wrappedStateKeys) {
          let wrappedState = wrappedStates[key]
          if (wrappedState.accountId === id) {
            found = true
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
  tryProduceReceipt(queueEntry: QueueEntry): AppliedReceipt | null {
    let receipt2 = queueEntry.recievedAppliedReceipt2 ?? queueEntry.appliedReceipt2
    if (receipt2 != null) {
      //
      //@ts-ignore
      return receipt2
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

    let passed = false
    let canProduceReceipt = false

    // Design TODO:  should this be the full transaction group or just the consensus group?
    let votingGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)

    if (this.stateManager.transactionQueue.executeInOneShard) {
      //use execuiton group instead of full transaciton group, since only the execution group will run the transaction
      votingGroup = queueEntry.executionGroup
    }

    let requiredVotes = Math.round(votingGroup.length * (2 / 3.0))

    //hacky for now.  debug code:
    //@ts-ignore
    if (queueEntry.loggedStats1 == null) {
      //@ts-ignore
      queueEntry.loggedStats1 = true
      nestedCountersInstance.countEvent('transactionStats', ` votingGroup:${votingGroup.length}`)
    }

    let numVotes = queueEntry.collectedVoteHashes.length

    if (numVotes < requiredVotes) {
      // we need more votes
      return null
    }

    // be smart an only recalculate votes when we see a new vote show up.
    if (queueEntry.newVotes === false) {
      return null
    }
    queueEntry.newVotes = false

    let passCount = 0
    let failCount = 0

    let mostVotes = 0
    let winningVoteHash
    let hashCounts: Map<string, number> = new Map()

    for (let i = 0; i < numVotes; i++) {
      let currentVote = queueEntry.collectedVoteHashes[i]
      let voteCount = hashCounts.get(currentVote.voteHash)
      let updatedVoteCount
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
      let appliedReceipt2: AppliedReceipt2 = {
        txid: queueEntry.acceptedTx.txId,
        result: undefined,
        appliedVote: undefined,
        signatures: [],
        app_data_hash: '',
        //transaction_result: false //this was missing before..
      }

      for (let i = 0; i < numVotes; i++) {
        let currentVote = queueEntry.collectedVoteHashes[i]
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
          if (queueEntry.ourVote.account_id[i] === 'app_data_hash') {
            appliedReceipt2.app_data_hash = queueEntry.ourVote.account_state_hash_after[i]
            break
          }
        }

        //this is a temporary hack to reduce the ammount of refactor needed.
        let appliedReceipt: AppliedReceipt = {
          txid: queueEntry.acceptedTx.txId,
          result: queueEntry.ourVote.transaction_result,
          appliedVotes: [queueEntry.ourVote],
          app_data_hash: appliedReceipt2.app_data_hash,
        }
        queueEntry.appliedReceipt = appliedReceipt

        return appliedReceipt
      }
    }
    return null
  }

  sortByAccountId(first, second) {
    return utils.sortAscProp(first, second, 'accountId')
  }

  /**
   * createAndShareVote
   * create an AppliedVote
   * gossip the AppliedVote
   * @param queueEntry
   */
  async createAndShareVote(queueEntry: QueueEntry) {
    /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_createAndShareVote', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `)

    // TODO STATESHARDING4 CHECK VOTES PER CONSENSUS GROUP

    // create our applied vote
    let ourVote: AppliedVote = {
      txid: queueEntry.acceptedTx.txId,
      transaction_result: queueEntry.preApplyTXResult.passed,
      account_id: [],
      account_state_hash_after: [],
      node_id: this.stateManager.currentCycleShardData.ourNode.id,
      cant_apply: queueEntry.preApplyTXResult.applied === false,
      app_data_hash: '',
    }

    ourVote.app_data_hash = queueEntry?.preApplyTXResult?.applyResponse.appReceiptDataHash

    if (queueEntry.debugFail_voteFlip === true) {
      /* prettier-ignore */ if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_createAndShareVote_voteFlip', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `)

      ourVote.transaction_result = !ourVote.transaction_result
    }

    // fill out the lists of account ids and after states
    // let applyResponse = queueEntry.preApplyTXResult.applyResponse //as ApplyResponse
    // if(applyResponse != null){
    //   //we need to sort this list and doing it in place seems ok
    //   applyResponse.stateTableResults.sort(this.sortByAccountId )
    //   for(let stateTableObject of applyResponse.stateTableResults ){

    //     ourVote.account_id.push(stateTableObject.accountId)
    //     ourVote.account_state_hash_after.push(stateTableObject.stateAfter)
    //   }
    // }

    let wrappedStates = this.stateManager.useAccountWritesOnly ? {} : queueEntry.collectedData

    let applyResponse = queueEntry?.preApplyTXResult?.applyResponse

    let stats = {
      usedApplyResponse: false,
      wrappedStateSet: 0,
      optimized: false,
    }
    //if we have values for accountWrites, then build a list wrappedStates from it and use this list instead
    //of the collected data list
    if (applyResponse != null) {
      let writtenAccountsMap: WrappedResponses = {}
      if (applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
        for (let writtenAccount of applyResponse.accountWrites) {
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
      let wrappedStatesList = [...Object.values(wrappedStates)]

      //this sort is critical to a deterministic vote structure.. we need this if taking a hash
      wrappedStatesList.sort(this.sortByAccountId)

      for (let wrappedState of wrappedStatesList) {
        // note this is going to stomp the hash value for the account
        // this used to happen in dapp.updateAccountFull  we now have to save off prevStateId on the wrappedResponse
        //We have to update the hash now! Not sure if this is the greatest place but it needs to be done
        let updatedHash = this.app.calculateAccountHash(wrappedState.data)
        wrappedState.stateId = updatedHash

        ourVote.account_id.push(wrappedState.accountId)
        ourVote.account_state_hash_after.push(wrappedState.stateId)
      }
    }

    let appliedVoteHash: AppliedVoteHash
    //let temp = ourVote.node_id
    ourVote.node_id = '' //exclue this from hash
    let voteHash = this.crypto.hash(ourVote)
    //ourVote.node_id = temp
    appliedVoteHash = {
      txid: ourVote.txid,
      voteHash,
    }
    appliedVoteHash = this.crypto.sign(appliedVoteHash)
    queueEntry.ourVoteHash = voteHash

    //append our vote
    this.tryAppendVoteHash(queueEntry, appliedVoteHash)

    // save our vote to our queueEntry
    queueEntry.ourVote = ourVote
    // also append it to the total list of votes
    let appendWorked = this.tryAppendVote(queueEntry, ourVote)
    if (appendWorked === false) {
      nestedCountersInstance.countEvent('transactionQueue', 'createAndShareVote appendFailed')
    }
    // share the vote via gossip?
    let sender = null

    let consensusGroup = []
    if (this.stateManager.transactionQueue.executeInOneShard === true) {
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
      let filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
        consensusGroup,
        'createAndShareVote',
        true,
        true
      )
      if (filteredNodes.length === 0) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error('createAndShareVote: filterValidNodesForInternalMessage no valid nodes left to try')
        return null
      }
      let filteredConsensusGroup = filteredNodes

      this.p2p.tell(filteredConsensusGroup, 'spread_appliedVoteHash', appliedVoteHash)
    } else {
      nestedCountersInstance.countEvent('transactionQueue', 'createAndShareVote fail, no consensus group')
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
    let numVotes = queueEntry.collectedVotes.length

    /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('tryAppendVote', `${queueEntry.logID}`, `collectedVotes: ${queueEntry.collectedVotes.length}`)
    /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`tryAppendVote collectedVotes: ${queueEntry.logID}   ${queueEntry.collectedVotes.length} `)

    // just add the vote if we dont have any yet
    if (numVotes === 0) {
      queueEntry.collectedVotes.push(vote)
      queueEntry.newVotes = true
      return true
    }

    //compare to existing votes.  keep going until we find that this vote is already in the list or our id is at the right spot to insert sorted
    for (let i = 0; i < numVotes; i++) {
      let currentVote = queueEntry.collectedVotes[i]

      if (currentVote.sign.owner === vote.sign.owner) {
        // already in our list so do nothing and return
        return false
      }
    }

    queueEntry.collectedVotes.push(vote)
    queueEntry.newVotes = true

    return true
  }

  tryAppendVoteHash(queueEntry: QueueEntry, voteHash: AppliedVoteHash): boolean {
    let numVotes = queueEntry.collectedVotes.length

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
      let currentVote = queueEntry.collectedVoteHashes[i]

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
