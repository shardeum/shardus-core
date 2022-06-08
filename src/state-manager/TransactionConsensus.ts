import * as Shardus from '../shardus/shardus-types'
import { TimestampReceipt } from '../shardus/shardus-types'
import * as utils from '../utils'
import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'
import * as Context from '../p2p/Context'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import ShardFunctions from './shardFunctions.js'
import StateManager from '.'
import { AppliedReceipt, AppliedVote, QueueEntry, WrappedResponses } from './state-manager-types'
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

  constructor(stateManager: StateManager,  profiler: Profiler, app: Shardus.App, logger: Logger, storage: Storage, p2p: P2P, crypto: Crypto, config: Shardus.StrictServerConfiguration) {

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
        const tsReceipt: Shardus.TimestampReceipt = this.generateTimestampReceipt(txId, cycleMarker, cycleCounter)
        await respond(tsReceipt)
      }
    })

    this.p2p.registerGossipHandler('spread_appliedReceipt', async (payload, sender, tracker, msgSize: number) => {
      profilerInstance.scopedProfileSectionStart('spread_appliedReceipt', false, msgSize)
      let respondSize = cUninitializedSize
      try {
        let appliedReceipt = payload as AppliedReceipt
        let queueEntry = this.stateManager.transactionQueue.getQueueEntrySafe(appliedReceipt.txid) // , payload.timestamp)
        if (queueEntry == null) {
          if (queueEntry == null) {
            // It is ok to search the archive for this.  Not checking this was possibly breaking the gossip chain before
            queueEntry = this.stateManager.transactionQueue.getQueueEntryArchived(payload.txid, 'spread_appliedReceipt') // , payload.timestamp)
            if (queueEntry != null) {
              // TODO : PERF on a faster version we may just bail if this lives in the arcive list.
              // would need to make sure we send gossip though.
            }
          }
          if (queueEntry == null) {
            if (logFlags.error) this.mainLogger.error(`spread_appliedReceipt no queue entry for ${appliedReceipt.txid} dbg:${this.stateManager.debugTXHistory[utils.stringifyReduce(payload.txid)]}`)
            // NEW start repair process that will find the TX then apply repairs
            // this.stateManager.transactionRepair.repairToMatchReceiptWithoutQueueEntry(appliedReceipt)
            return
          }
        }

        if (this.stateManager.testFailChance(this.stateManager.ignoreRecieptChance, 'spread_appliedReceipt', utils.stringifyReduce(appliedReceipt.txid), '', logFlags.verbose) === true) {
          return
        }

        // TODO STATESHARDING4 ENDPOINTS check payload format
        // TODO STATESHARDING4 ENDPOINTS that this message is from a valid sender (may need to check docs)

        let receiptNotNull = appliedReceipt != null

        if (queueEntry.gossipedReceipt === false){
          queueEntry.gossipedReceipt = true
          if (logFlags.debug) this.mainLogger.debug(`spread_appliedReceipt update ${queueEntry.logID} receiptNotNull:${receiptNotNull}`)


          if(queueEntry.archived === false){
            queueEntry.recievedAppliedReceipt = appliedReceipt
          }

          // I think we handle the negative cases later by checking queueEntry.recievedAppliedReceipt vs queueEntry.appliedReceipt

          // share the appliedReceipt.
          let sender = null
          let gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
          if (gossipGroup.length > 1) {
            // should consider only forwarding in some cases?
            this.stateManager.debugNodeGroup(queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp, `share appliedReceipt to neighbors`, gossipGroup)
            //no await so we cant get the message out size in a reasonable way
            this.p2p.sendGossipIn('spread_appliedReceipt', appliedReceipt, tracker, sender, gossipGroup, false)
          }
        } else {
          // we get here if the receipt has already been shared
          if (logFlags.debug) this.mainLogger.debug(`spread_appliedReceipt skipped ${queueEntry.logID} receiptNotNull:${receiptNotNull} Already Shared`)
        }

      } finally {
        profilerInstance.scopedProfileSectionEnd('spread_appliedReceipt', respondSize)
      }
    })
  }

  generateTimestampReceipt(txId, cycleMarker: string, cycleCounter: CycleRecord['counter']): TimestampReceipt {
    const tsReceipt: TimestampReceipt = {
      txId,
      cycleMarker,
      cycleCounter,
      timestamp: Date.now(),
    }
    const signedTsReceipt = this.crypto.sign(tsReceipt)

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
  }

  async askTxnTimestampFromNode(tx, txId): Promise<Shardus.TimestampReceipt> {
    const homeNode = ShardFunctions.findHomeNode(Context.stateManager.currentCycleShardData.shardGlobals, txId, Context.stateManager.currentCycleShardData.parititionShardDataMap)
    const cycleMarker = CycleChain.computeCycleMarker(CycleChain.newest)
    const cycleCounter = CycleChain.newest.counter
    this.mainLogger.debug('Asking timestamp from node', homeNode.node)
    if (homeNode.node.id === Self.id) {
      // we generate the tx timestamp by ourselves
      return this.generateTimestampReceipt(txId, cycleMarker, cycleCounter)
    } else {
      return await Comms.ask(homeNode.node, 'get_tx_timestamp', { cycleMarker, cycleCounter, txId, tx })
    }
  }

  /**
   * shareAppliedReceipt
   * gossip the appliedReceipt to the transaction group
   * @param queueEntry
   */
  async shareAppliedReceipt(queueEntry: QueueEntry) {
    if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_shareAppliedReceipt', `${queueEntry.logID}`, `qId: ${queueEntry.entryID} `)

    let appliedReceipt = queueEntry.appliedReceipt

    // share the appliedReceipt.
    let sender = null
    let gossipGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)

    // todo only recalc if cycle boundry?
    // let updatedGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry, true)

    if (gossipGroup.length > 1) {

      if (queueEntry.ourNodeInTransactionGroup === false) {
        return
      }

      if(queueEntry.ourTXGroupIndex > 0){
        let everyN = Math.max(1,Math.floor(gossipGroup.length * 0.4))
        let nonce = parseInt('0x' + queueEntry.acceptedTx.txId.substr(0,2))
        let idxPlusNonce = queueEntry.ourTXGroupIndex + nonce
        let idxModEveryN = idxPlusNonce % everyN
        if(idxModEveryN > 0){
          nestedCountersInstance.countEvent('transactionQueue', 'shareAppliedReceipt-skipped')
          return
        }
      }
      nestedCountersInstance.countEvent('transactionQueue', 'shareAppliedReceipt-notSkipped')
      // should consider only forwarding in some cases?
      this.stateManager.debugNodeGroup(queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp, `share appliedReceipt to neighbors`, gossipGroup)
      this.p2p.sendGossipIn('spread_appliedReceipt', appliedReceipt, '', sender, gossipGroup, true)
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
    if (appliedReceipt == null) {
      return false
    }

    if (queueEntry.ourVote == null) {
      if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} ourVote == null`)
      return false
    }

    if (appliedReceipt != null) {
      if (appliedReceipt.result !== queueEntry.ourVote.transaction_result) {
        if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} ${appliedReceipt.result}, ${queueEntry.ourVote.transaction_result} appliedReceipt.result !== queueEntry.ourVote.transaction_result`)
        return false
      }
      if (appliedReceipt.txid !== queueEntry.ourVote.txid) {
        if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} appliedReceipt.txid !== queueEntry.ourVote.txid`)
        return false
      }
      if (appliedReceipt.appliedVotes.length === 0) {
        if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} appliedReceipt.appliedVotes.length == 0`)
        return false
      }

      if (appliedReceipt.appliedVotes[0].cant_apply === true) {
        // TODO STATESHARDING4 NEGATIVECASE    need to figure out what to do here
        if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} appliedReceipt.appliedVotes[0].cant_apply === true`)
        //If the network votes for cant_apply then we wouldn't need to patch.  We return true here
        //but outside logic will have to know to check cant_apply flag and make sure to not commit data
        return true
      }

      //we return true for a false receipt because there is no need to repair our data to match the receipt
      //it is already checked above if we matched the result
      if(appliedReceipt.result === false){
        if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} result===false Good Match`)
        return true
      }



      //test our data against a winning vote in the receipt
      let wrappedStates = queueEntry.collectedData
      let wrappedStateKeys = Object.keys(queueEntry.collectedData)
      let vote = appliedReceipt.appliedVotes[0] //all votes are equivalent, so grab the first


      // Iff we have accountWrites, then overwrite the keys and wrapped data
      let appOrderedKeys = []
      let writtenAccountsMap:WrappedResponses = {}
      let applyResponse = queueEntry?.preApplyTXResult?.applyResponse
      if(applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0){
        for(let wrappedAccount of applyResponse.accountWrites){
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
      //     if (logFlags.verbose) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply collectedFinalData tx:${queueEntry.logID} ts:${timestamp} ${utils.makeShortHash(finalAccount)} preveStateID: ${finalAccount.prevStateId } vs expected: ${prevStateCalc}`)

      //     wrappedStates[key] = finalAccount
      //   }
      //   if (logFlags.verbose) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply collectedFinalData tx:${queueEntry.logID} ts:${timestamp} accounts: ${utils.stringifyReduce(Object.keys(wrappedStates))}  `)
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
              if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} state does not match id:${utils.stringifyReduce(id)} hash:${utils.stringifyReduce(wrappedState.stateId)} votehash:${utils.stringifyReduce(hash)}`)
              return false
            }
          }
        }
        if (found === false) {
          if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} state does not match missing id:${utils.stringifyReduce(id)} `)
          return false
        }
      }

      if (logFlags.debug) this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} Good Match`)
      if (logFlags.playback) this.logger.playbackLogNote('hasAppliedReceiptMatchingPreApply', `${queueEntry.logID}`, `  Good Match`)
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
    if (queueEntry.waitForReceiptOnly === true) {
      return null
    }

    // TEMP hack.. allow any node to try and make a receipt
    // if (this.stateManager.transactionQueue.executeInOneShard && queueEntry.isInExecutionHome === false) {
    //   return null
    // }

    if(queueEntry.appliedReceipt != null){
      return queueEntry.appliedReceipt
    }

    let passed = false
    let canProduceReceipt = false

    // Design TODO:  should this be the full transaction group or just the consensus group?
    let votingGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)

    if(this.stateManager.transactionQueue.executeInOneShard){
      //use execuiton group instead of full transaciton group, since only the execution group will run the transaction
      votingGroup = queueEntry.executionGroup
    }

    let requiredVotes = Math.round(votingGroup.length * (2 / 3.0))

    //hacky for now.  debug code:
    //@ts-ignore
    if(queueEntry.loggedStats1 == null){
      //@ts-ignore
      queueEntry.loggedStats1 = true
      nestedCountersInstance.countEvent('transactionStats', ` votingGroup:${votingGroup.length}`)      
    }


    let numVotes = queueEntry.collectedVotes.length

    if (numVotes < requiredVotes) {
      // we need more votes
      return null
    }

    // be smart an only recalculate votes when we see a new vote show up.
    if(queueEntry.newVotes === false){
      return null
    }
    queueEntry.newVotes = false

    let passCount = 0
    let failCount = 0

    // First Pass: Check if there are enough pass or fail votes to attempt a receipt.
    for (let i = 0; i < numVotes; i++) {
      let currentVote = queueEntry.collectedVotes[i]

      if (currentVote.transaction_result === true) {
        passCount++
      } else {
        failCount++
      }

      if (passCount >= requiredVotes) {
        canProduceReceipt = true
        passed = true
      }
      if (failCount >= requiredVotes) {
        canProduceReceipt = true
        passed = false
      }
    }

    // TODO STATESHARDING4 There isn't really an analysis of account_state_hash_after.  seems like we should make sure the hashes match up
    //   type AppliedVote = {
    //     txid: string;
    //     transaction_result: boolean;
    //     account_id: string[];
    //     account_state_hash_after: string[];
    //     cant_apply: boolean;  // indicates that the preapply could not give a pass or fail
    //     node_id: string; // record the node that is making this vote.. todo could look this up from the sig later
    //     sign?: Shardus.Sign
    // };


    // Second Pass: look at the account hashes and find the most common hash per account
    //let uniqueKeys: {[id: string]: boolean} = {}
    //let topAppDataByHash: {[id: string]: number}
    let topHashByID: { [id: string]: { hash: string; count: number } } = {}
    let topValuesByIDByHash: { [id: string]: { [id: string]: { count: number } } } = {}
    if (passed && canProduceReceipt) {
      if (canProduceReceipt === true) {
        for (let i = 0; i < numVotes; i++) {
          let currentVote = queueEntry.collectedVotes[i]
          if (passed === currentVote.transaction_result) {
            let vote = currentVote

            //use top values for app_data_hash. this should just work
            if(currentVote.app_data_hash != null && currentVote.app_data_hash != ''){
              let id = 'app_data_hash'
              let hash = currentVote.app_data_hash
              if (topValuesByIDByHash[id] == null) {
                topValuesByIDByHash[id] = {}
              }
              if (topValuesByIDByHash[id][hash] == null) {
                topValuesByIDByHash[id][hash] = { count: 0 }
              }
              let count = topValuesByIDByHash[id][hash].count + 1
              topValuesByIDByHash[id][hash].count = count

              if (topHashByID[id] == null) {
                topHashByID[id] = { hash: '', count: 0 }
              }
              if (count > topHashByID[id].count) {
                topHashByID[id].count = count
                topHashByID[id].hash = hash
              }
            }

            for (let j = 0; j < vote.account_id.length; j++) {
              let id = vote.account_id[j]
              let hash = vote.account_state_hash_after[j]

              //uniqueKeys[id] = true

              if (topValuesByIDByHash[id] == null) {
                topValuesByIDByHash[id] = {}
              }
              if (topValuesByIDByHash[id][hash] == null) {
                topValuesByIDByHash[id][hash] = { count: 0 }
              }
              let count = topValuesByIDByHash[id][hash].count + 1
              topValuesByIDByHash[id][hash].count = count

              if (topHashByID[id] == null) {
                topHashByID[id] = { hash: '', count: 0 }
              }
              if (count > topHashByID[id].count) {
                topHashByID[id].count = count
                topHashByID[id].hash = hash
              }
            }
          }
        }
      }
    }

    // test to make sure each account has enough votes for the most popular hash
    if (passed === true) {
      let tooFewVotes = false
      let uniqueAccounts = Object.keys(topHashByID)
      for(let accountID of uniqueAccounts){
        if (topHashByID[accountID].count < requiredVotes ) {
          tooFewVotes = true
          if (logFlags.playback) this.logger.playbackLogNote('tryProduceReceipt', `${queueEntry.logID}`, `canProduceReceipt: failed. requiredVotes${requiredVotes}  ${utils.stringifyReduce(topHashByID[accountID])}`)
          if (logFlags.info) this.mainLogger.info(`tryProduceReceipt canProduceReceipt: failed. requiredVotes:${requiredVotes}  ${utils.stringifyReduce(topHashByID[accountID])}`)
        }
      }
      if(tooFewVotes){
        return null
      }
    }

    if (logFlags.playback) this.logger.playbackLogNote('tryProduceReceipt', `${queueEntry.logID}`, `canProduceReceipt: ${canProduceReceipt} passed: ${passed} passCount: ${passCount} failCount: ${failCount} requiredVotes${requiredVotes}`)
    if (logFlags.debug) this.mainLogger.debug(`tryProduceReceipt canProduceReceipt: ${canProduceReceipt} passed: ${passed} passCount: ${passCount} failCount: ${failCount} `)

    let passingAccountVotesTotal = 0
    // Assemble the receipt from votes that are passing
    if (canProduceReceipt === true) {
      let appliedReceipt: AppliedReceipt = {
        txid: queueEntry.acceptedTx.txId,
        result: passed,
        appliedVotes: [],
        app_data_hash:''
      }

      // grab just the votes that match the winning pass or fail status
      for (let i = 0; i < numVotes; i++) {
        let currentVote = queueEntry.collectedVotes[i]
        // build a list of applied votes
        if (passed === true) {
          if (currentVote.transaction_result === true) {
            let badVoteMatch = false
            //Test that state after hash values match with the winning vote hashes
            for (let j = 0; j < currentVote.account_id.length; j++) {
              let id = currentVote.account_id[j]
              let hash = currentVote.account_state_hash_after[j]
              if (topHashByID[id].hash === hash) {
                passingAccountVotesTotal++
              } else {
                badVoteMatch = true
                break
              }
            }
            if (badVoteMatch) {
              continue
            }
            appliedReceipt.appliedVotes.push(currentVote)
          }
        } else if (passed === false) {
          if (currentVote.transaction_result === false) {
            //not checking state after hashes since a failed TX can not change account state
            appliedReceipt.appliedVotes.push(currentVote)
          }
        }

        let topAppDataHashEntry = topHashByID['app_data_hash']
        if(topAppDataHashEntry != null && topAppDataHashEntry.hash != null){
          appliedReceipt.app_data_hash = topAppDataHashEntry.hash
          //should we append the full app data?
        }
        
      }

      // if a passing vote won then check all the hashes.
      // if (passed) {
      //   if (passingAccountVotesTotal < requiredVotes) {
      //     if (logFlags.playback) this.logger.playbackLogNote('tryProduceReceipt', `${queueEntry.acceptedTx.id}`, `canProduceReceipt: failed second tally. passed: ${passed} passCount: ${passCount} failCount: ${failCount} passingAccountVotesTotal:${passingAccountVotesTotal}`)
      //     if (logFlags.error) this.mainLogger.error(`tryProduceReceipt canProduceReceipt: failed second tally. passed: ${passed} passCount: ${passCount} failCount: ${failCount} passingAccountVotesTotal:${passingAccountVotesTotal} `)
      //     return null
      //   }
      // }

      // one last check to make sure we assembled enough votes.
      // this is needed because our hash counts could have added up but if a vote could still get discarded if any one of its account hashes are wrong
      if(passed && appliedReceipt.appliedVotes.length < requiredVotes) {
        if (logFlags.playback) this.logger.playbackLogNote('tryProduceReceipt', `${queueEntry.logID}`, `canProduceReceipt:  failed to produce enough votes. passed: ${passed} passCount: ${passCount} failCount: ${failCount} passingAccountVotesTotal:${passingAccountVotesTotal}`)
        if (logFlags.error) this.mainLogger.error(`tryProduceReceipt canProduceReceipt: failed to produce enough votes: ${passed} passCount: ${passCount} failCount: ${failCount} passingAccountVotesTotal:${passingAccountVotesTotal} `)
        return null
      }

      if (logFlags.playback) this.logger.playbackLogNote('tryProduceReceipt', `${queueEntry.logID}`, `canProduceReceipt: Success. passed: ${passed} passCount: ${passCount} failCount: ${failCount} passingAccountVotesTotal:${passingAccountVotesTotal} rc:${utils.stringifyReduce(appliedReceipt)}`)

      // recored our generated receipt to the queue entry
      queueEntry.appliedReceipt = appliedReceipt
      return appliedReceipt
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
    if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_createAndShareVote', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `)

    // TODO STATESHARDING4 CHECK VOTES PER CONSENSUS GROUP

    // create our applied vote
    let ourVote: AppliedVote = {
      txid: queueEntry.acceptedTx.txId,
      transaction_result: queueEntry.preApplyTXResult.passed,
      account_id: [],
      account_state_hash_after: [],
      node_id: this.stateManager.currentCycleShardData.ourNode.id,
      cant_apply: queueEntry.preApplyTXResult.applied === false,
      app_data_hash:''
    }

    ourVote.app_data_hash = queueEntry?.preApplyTXResult?.applyResponse.appReceiptDataHash

    if (queueEntry.debugFail_voteFlip === true) {
      if (logFlags.verbose) if (logFlags.playback) this.logger.playbackLogNote('shrd_createAndShareVote_voteFlip', `${queueEntry.acceptedTx.txId}`, `qId: ${queueEntry.entryID} `)

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

    let wrappedStates = queueEntry.collectedData

    let applyResponse = queueEntry?.preApplyTXResult?.applyResponse
    //if we have values for accountWrites, then build a list wrappedStates from it and use this list instead
    //of the collected data list
    if(applyResponse != null){
      let writtenAccountsMap:WrappedResponses = {}
      if(applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0){
        for(let writtenAccount of applyResponse.accountWrites){
          writtenAccountsMap[writtenAccount.accountId] = writtenAccount.data
        }
        //override wrapped states with writtenAccountsMap which should be more complete if it included
        wrappedStates = writtenAccountsMap
      }
      //Issue that could happen with sharded network:
      //Need to figure out where to put the logic that knows which nodes need final data forwarded to them
      //A receipt aline may not be enough, remote shards will need an updated copy of the data.
    }

    if (wrappedStates != null) {
      //we need to sort this list and doing it in place seems ok
      //applyResponse.stateTableResults.sort(this.sortByAccountId )
      for (let key of Object.keys(wrappedStates)) {
        let wrappedState = wrappedStates[key]

        // note this is going to stomp the hash value for the account
        // this used to happen in dapp.updateAccountFull  we now have to save off prevStateId on the wrappedResponse
        //We have to update the hash now! Not sure if this is the greatest place but it needs to be done
        let updatedHash = this.app.calculateAccountHash(wrappedState.data)
        wrappedState.stateId = updatedHash

        ourVote.account_id.push(wrappedState.accountId)
        ourVote.account_state_hash_after.push(wrappedState.stateId)
      }
    }

    ourVote = this.crypto.sign(ourVote)

    // save our vote to our queueEntry
    queueEntry.ourVote = ourVote
    // also append it to the total list of votes
    let appendWorked = this.tryAppendVote(queueEntry, ourVote)
    if(appendWorked === false){
      nestedCountersInstance.countEvent('transactionQueue', 'createAndShareVote appendFailed')
    }
    // share the vote via gossip
    let sender = null
    // TODO need to migrate to execution group and then corresponding node tell the receipt at the end
    let consensusGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)   //.queueEntryGetConsensusGroup(queueEntry)
    if (consensusGroup.length >= 1) {
      // should consider only forwarding in some cases?
      this.stateManager.debugNodeGroup(queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp, `share tx vote to neighbors`, consensusGroup)
      // TODO STATESHARDING4 ENDPOINTS this needs to change from gossip to a tell
      //this.p2p.sendGossipIn('spread_appliedVote', ourVote, '', sender, consensusGroup)

      if (logFlags.debug) this.mainLogger.debug(`createAndShareVote numNodes: ${consensusGroup.length} ourVote: ${utils.stringifyReduce(ourVote)} `)
      if (logFlags.playback) this.logger.playbackLogNote('createAndShareVote', `${queueEntry.acceptedTx.txId}`, `numNodes: ${consensusGroup.length} ourVote: ${utils.stringifyReduce(ourVote)} `)

      // Filter nodes before we send tell()
      let filteredNodes = this.stateManager.filterValidNodesForInternalMessage(consensusGroup, 'createAndShareVote', true, true)
      if (filteredNodes.length === 0) {
        if (logFlags.error) this.mainLogger.error('createAndShareVote: filterValidNodesForInternalMessage no valid nodes left to try')
        return null
      }
      let filteredConsensusGroup = filteredNodes

      this.p2p.tell(filteredConsensusGroup, 'spread_appliedVote', ourVote)
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

    if (logFlags.playback) this.logger.playbackLogNote('tryAppendVote', `${queueEntry.logID}`, `collectedVotes: ${queueEntry.collectedVotes.length}`)
    if (logFlags.debug) this.mainLogger.debug(`tryAppendVote collectedVotes: ${queueEntry.logID}   ${queueEntry.collectedVotes.length} `)

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
}

export default TransactionConsenus
