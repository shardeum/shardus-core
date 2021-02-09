import { ShardusConfiguration } from '../shardus/shardus-types'
import Shardus = require('../shardus/shardus-types')
import { ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, HomeNodeSummary, ParititionShardDataMap, NodeShardDataMap, MergeResults, BasicAddressRange } from './shardFunctionTypes'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger from '../logger'
import ShardFunctions from './shardFunctions.js'
import { time } from 'console'
import StateManager from '.'

class TransactionConsenus {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler
  verboseLogs: boolean
  logger: Logger
  p2p: P2P
  storage: Storage
  stateManager: StateManager

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any
  statemanager_fatal: (key: string, log: string) => void

  constructor(stateManager: StateManager, verboseLogs: boolean, profiler: Profiler, app: Shardus.App, logger: Logger, storage: Storage, p2p: P2P, crypto: Crypto, config: Shardus.ShardusConfiguration) {
    this.verboseLogs = verboseLogs
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
  }

  /**
   * shareAppliedReceipt
   * gossip the appliedReceipt to the transaction group
   * @param queueEntry
   */
  async shareAppliedReceipt(queueEntry: QueueEntry) {
    if (this.verboseLogs) if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_shareAppliedReceipt', `${queueEntry.logID}`, `qId: ${queueEntry.entryID} `)

    let appliedReceipt = queueEntry.appliedReceipt

    // share the appliedReceipt.
    let sender = null
    let consensusGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
    if (consensusGroup.length > 1) {
      // should consider only forwarding in some cases?
      this.stateManager.debugNodeGroup(queueEntry.acceptedTx.id, queueEntry.acceptedTx.timestamp, `share appliedReceipt to neighbors`, consensusGroup)
      this.p2p.sendGossipIn('spread_appliedReceipt', appliedReceipt, '', sender, consensusGroup)
    }
  }

  /**
   * hasAppliedReceiptMatchingPreApply
   * check if recievedAppliedReceipt matches what we voted for.
   * this implies that our pre apply had the same result.
   *
   * @param queueEntry
   */
  hasAppliedReceiptMatchingPreApply(queueEntry: QueueEntry, appliedReceipt: AppliedReceipt): boolean {
    if (appliedReceipt == null) {
      return false
    }

    if (queueEntry.ourVote == null) {
      this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} ourVote == null`)
      return false
    }

    if (appliedReceipt != null) {
      if (appliedReceipt.result !== queueEntry.ourVote.transaction_result) {
        this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} ${appliedReceipt.result}, ${queueEntry.ourVote.transaction_result} appliedReceipt.result !== queueEntry.ourVote.transaction_result`)
        return false
      }
      if (appliedReceipt.txid !== queueEntry.ourVote.txid) {
        this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} appliedReceipt.txid !== queueEntry.ourVote.txid`)
        return false
      }
      if (appliedReceipt.appliedVotes.length === 0) {
        this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} appliedReceipt.appliedVotes.length == 0`)
        return false
      }

      if (appliedReceipt.appliedVotes[0].cant_apply === true) {
        // TODO STATESHARDING4 NEGATIVECASE    need to figure out what to do here
        this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} appliedReceipt.appliedVotes[0].cant_apply === true`)
        return false
      }

      //test our vote against data hashes.
      let wrappedStates = queueEntry.collectedData
      let wrappedStateKeys = Object.keys(queueEntry.collectedData)
      let vote = appliedReceipt.appliedVotes[0] //queueEntry.ourVote
      for (let j = 0; j < vote.account_id.length; j++) {
        let id = vote.account_id[j]
        let hash = vote.account_state_hash_after[j]
        let found = false
        for (let key of wrappedStateKeys) {
          let wrappedState = wrappedStates[key]
          if (wrappedState.accountId === id) {
            found = true
            if (wrappedState.stateId !== hash) {
              this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} state does not match id:${utils.stringifyReduce(id)} hash:${utils.stringifyReduce(wrappedState.stateId)} votehash:${utils.stringifyReduce(hash)}`)
              return false
            }
          }
        }
        if (found === false) {
          this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} state does not match missing id:${utils.stringifyReduce(id)} `)
          return false
        }
      }

      this.mainLogger.debug(`hasAppliedReceiptMatchingPreApply  ${queueEntry.logID} Good Match`)
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('hasAppliedReceiptMatchingPreApply', `${queueEntry.logID}`, `  Good Match`)
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

    let passed = false
    let canProduceReceipt = false

    let consensusGroup = this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry) // todo use real consensus group!!!
    let requiredVotes = Math.round(consensusGroup.length * (2 / 3.0))

    let numVotes = queueEntry.collectedVotes.length

    if (numVotes < requiredVotes) {
      // we need more votes
      return null
    }

    let passCount = 0
    let failCount = 0
    // tally our votes

    // TODO STATESHARDING4 CHECK VOTES PER CONSENSUS GROUP
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
    //     sign?: import("../shardus/shardus-types").Sign
    // };

    //big ol fun vote tally

    //idk if we should check passed or not
    let topHashByID: { [id: string]: { hash: string; count: number } } = {}
    let topValuesByIDByHash: { [id: string]: { [id: string]: { count: number } } } = {}
    if (passed && canProduceReceipt) {
      if (canProduceReceipt === true) {
        for (let i = 0; i < numVotes; i++) {
          let currentVote = queueEntry.collectedVotes[i]
          if (passed === currentVote.transaction_result) {
            let vote = currentVote
            for (let j = 0; j < vote.account_id.length; j++) {
              let id = vote.account_id[j]
              let hash = vote.account_state_hash_after[j]

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

    // TODO: possibly need an extra check to make sure all the top hash by ID values match to a single vote (and are not spread between multiple votes)

    if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('tryProduceReceipt', `${queueEntry.acceptedTx.id}`, `canProduceReceipt: ${canProduceReceipt} passed: ${passed} passCount: ${passCount} failCount: ${failCount} `)
    this.mainLogger.debug(`tryProduceReceipt canProduceReceipt: ${canProduceReceipt} passed: ${passed} passCount: ${passCount} failCount: ${failCount} `)

    let secondTally = 0
    // if we can create a receipt do that now
    if (canProduceReceipt === true) {
      let appliedReceipt: AppliedReceipt = {
        txid: queueEntry.acceptedTx.id,
        result: passed,
        appliedVotes: [],
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
                secondTally++
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
      }

      // if a passing vote won then check all the hashes.
      if (passed) {
        if (secondTally < requiredVotes) {
          if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('tryProduceReceipt', `${queueEntry.acceptedTx.id}`, `canProduceReceipt: failed second tally. passed: ${passed} passCount: ${passCount} failCount: ${failCount} secondTally:${secondTally}`)
          this.mainLogger.error(`tryProduceReceipt canProduceReceipt: failed second tally. passed: ${passed} passCount: ${passCount} failCount: ${failCount} secondTally:${secondTally} `)
          return null
        }
      }

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
    if (this.verboseLogs) if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_createAndShareVote', `${queueEntry.acceptedTx.id}`, `qId: ${queueEntry.entryID} `)

    // TODO STATESHARDING4 CHECK VOTES PER CONSENSUS GROUP

    // create our applied vote
    let ourVote: AppliedVote = {
      txid: queueEntry.acceptedTx.id,
      transaction_result: queueEntry.preApplyTXResult.passed,
      account_id: [],
      account_state_hash_after: [],
      node_id: this.stateManager.currentCycleShardData.ourNode.id,
      cant_apply: queueEntry.preApplyTXResult.applied === false,
    }

    if (queueEntry.debugFail_voteFlip === true) {
      if (this.verboseLogs) if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_createAndShareVote_voteFlip', `${queueEntry.acceptedTx.id}`, `qId: ${queueEntry.entryID} `)

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
    this.tryAppendVote(queueEntry, ourVote)
    // share the vote via gossip
    let sender = null
    let consensusGroup = this.stateManager.transactionQueue.queueEntryGetConsensusGroup(queueEntry)
    if (consensusGroup.length >= 1) {
      // should consider only forwarding in some cases?
      this.stateManager.debugNodeGroup(queueEntry.acceptedTx.id, queueEntry.acceptedTx.timestamp, `share tx vote to neighbors`, consensusGroup)
      // TODO STATESHARDING4 ENDPOINTS this needs to change from gossip to a tell
      //this.p2p.sendGossipIn('spread_appliedVote', ourVote, '', sender, consensusGroup)

      this.mainLogger.debug(`createAndShareVote numNodes: ${consensusGroup.length} ourVote: ${utils.stringifyReduce(ourVote)} `)
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('createAndShareVote', `${queueEntry.acceptedTx.id}`, `numNodes: ${consensusGroup.length} ourVote: ${utils.stringifyReduce(ourVote)} `)

      // Filter nodes before we send tell()
      let filteredNodes = this.stateManager.filterValidNodesForInternalMessage(consensusGroup, 'createAndShareVote', true, true)
      if (filteredNodes.length === 0) {
        this.mainLogger.error('createAndShareVote: filterValidNodesForInternalMessage no valid nodes left to try')
        return null
      }
      let filteredConsensusGroup = filteredNodes

      this.p2p.tell(filteredConsensusGroup, 'spread_appliedVote', ourVote)
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

    if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('tryAppendVote', `${queueEntry.logID}`, `collectedVotes: ${queueEntry.collectedVotes.length}`)
    this.mainLogger.debug(`tryAppendVote collectedVotes: ${queueEntry.logID}   ${queueEntry.collectedVotes.length} `)

    // just add the vote if we dont have any yet
    if (numVotes === 0) {
      queueEntry.collectedVotes.push(vote)
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

    return true
  }
}

export default TransactionConsenus
