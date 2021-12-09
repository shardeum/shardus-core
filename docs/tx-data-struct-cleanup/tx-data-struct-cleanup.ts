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

  /** OUTPUT: AcceptedTx */

    /** this.p2p.sendGossipIn('spread_tx_to_group', acceptedTx, '', sender, transactionGroup, true) */

    /** this.p2p.tell(this.stateManager.currentCycleShardData.syncingNeighborsTxGroup, 'spread_tx_to_group_syncing', acceptedTx) */

/** 5. 'spread_tx_to_group' gossipIn handler */

  /** INPUT: AcceptedTx */

  /** OUTPUT: AcceptedTx */

/** 6. 'spread_tx_to_group_syncing' tell handler */

  /** INPUT: AcceptedTx */

  /** OUTPUT: AcceptedTx */
