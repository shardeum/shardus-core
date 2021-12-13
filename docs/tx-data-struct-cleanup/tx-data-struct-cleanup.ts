/** Link to the document describing the steps taken by Shardus to process txs
 * 
 *  https://docs.google.com/document/d/1hx7ALdJXbT5W2xnefMFhJA0mbloNrxVwGE1R-JNJf_U/edit#bookmark=id.95rrplpl4wwr
 * 
 *  [TODO] For each of the steps before the tx gets to state-manager, come up with
 *  what its data structure should look like.
 * 
 *  [TODO] Change the current code to be in sync with the data structures we come up with
 * 
 *  [TODO] Add the ability for the network to timestamp tx's
 */

/** TYPES */

type Timestamp = number

type HexString = string

interface Signature {
  owner: HexString,
  sig: HexString
}

/** 1. Liberdus /inject */

  /** INPUT */
  interface InjectedTx {
    type: string,
    from: HexString,
    to: HexString,
    amount: number,
    timestamp: Timestamp
    sign: Signature,
  }

  /** OUTPUT: InjectedTx */

/** 2. Shardus.put */

  /** INPUT: InjectedTx */

  /** OUTPUT */
  interface SignedShardusTx {
    receivedTimestamp: Timestamp,
    inTransaction: InjectedTx,
    sign: Signature
  }

/** 3. this.consensus.inject */

  /** TYPES */
  interface TransactionReceipt {
    stateId: null,
    targetStateId: null,
    txHash: HexString,
    time: Timestamp
  }

  /** INPUT: SignedShardusTx */

  /** OUTPUT */
  interface AcceptedTX {
    id: HexString,
    timestamp: Timestamp,
    data: InjectedTx,
    status: number,
    receipt: TransactionReceipt,
  }

/** 4. this.consensus.on('accepted', (...) => { stateManager.transactionQueue.routeAndQueueAcceptedTransaction(...) }) */

  /** INPUT: AcceptedTx */

  /** OUTPUT: QueueEntry */

    /** this.p2p.sendGossipIn('spread_tx_to_group', acceptedTx, '', sender, transactionGroup, true) */

    /** this.p2p.tell(this.stateManager.currentCycleShardData.syncingNeighborsTxGroup, 'spread_tx_to_group_syncing', acceptedTx) */

    /** this.transactionQueue.processAcceptedTxQueue() */

/** 5. 'spread_tx_to_group' gossipIn handler */

  /** INPUT: AcceptedTx */

  /** OUTPUT: AcceptedTx */

/** 6. 'spread_tx_to_group_syncing' tell handler */

  /** INPUT: AcceptedTx */

  /** OUTPUT: AcceptedTx */

/** 7. this.transactionQueue.processAcceptedTxQueue() */

  /** INPUT: QueueEntry[] */
  
  /** OUTPUT: */

    /** 
     * const txResult = this.preApplyTransaction();
     * queueEntry.preApplyTXResult = txResult
    */

    /** this.stateManager.transactionConsensus.createAndShareVote(queueEntry) */

    /** this.stateManager.transactionConsensus.tryProduceReceipt(queueEntry) */

    /** this.commitConsensedTransaction(queueEntry) */

type PreApplyAcceptedTransactionResult = {
  applied: boolean
  passed: boolean
  applyResult: string
  reason: string
  applyResponse?: ApplyResponse
}

interface ApplyResponse {
  stateTableResults: StateTableObject[]
  txId: string
  txTimestamp: number
  accountData: WrappedResponse[]
  appDefinedData: any
}

interface StateTableObject {
  accountId: string
  txId: string
  txTimestamp: string
  stateBefore: string
  stateAfter: string
}

interface WrappedResponse {
  /** */
}

/** 8. this.preApplyTransaction() */

  /** INPUT: QueueEntry */

  /** OUTPUT: PreApplyAcceptedTransactionResult */

export type AppliedVote = {
  txid: string
  transaction_result: boolean
  account_id: string[]
  account_state_hash_after: string[]
  cant_apply: boolean
  node_id: string
  sign?: Signature
}

/** 9. this.stateManager.transactionConsensus.createAndShareVote(queueEntry) */

  /** INPUT: QueueEntry */

  /** OUTPUT: AppliedVote */
  
    /**
     * const ourVote : AppliedVote 
     * this.tryAppendVote(queueEntry, ourVote)
     * this.p2p.tell(filteredConsensusGroup, 'spread_appliedVote', ourVote)
     */

/** 10. 'spread_appliedVote' tell handler */

  /** INPUT: AppliedVote */

  /** this.transactionConsensus.tryAppendVote(queueEntry, newVote) */

export type AppliedReceipt = {
  txid: string
  result: boolean
  appliedVotes: AppliedVote[]
}

/** 11. this.stateManager.transactionConsensus.tryProduceReceipt(queueEntry) */

  /** INPUT: QueueEntry */

  /** OUTPUT: AppliedReceipt */

type CommitConsensedTransactionResult = { success: boolean }

/** 12. this.commitConsensedTransaction(queueEntry) */

  /** INPUT: QueueEntry */

  /** OUTPUT: CommitConsensedTransactionResult */

