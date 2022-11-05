import { Logger } from 'log4js'
import { P2P } from '@shardus/types'
import * as Snapshot from '../snapshot'
import * as Comms from './Comms'
import * as Context from './Context'
import * as Self from './Self'

/** STATE */

let p2pLogger: Logger

/** ROUTES */

const gossipRoute: P2P.P2PTypes.GossipHandler = (payload) => {}

const routes = {
  internal: {},
  gossip: {
    gossip: gossipRoute,
  },
}

let cycleNumberForNetworkDataHash: number = 0
let cycleNumberForNetworkReceiptHash: number = 0
let cycleNumberForNetworkSummaryHash: number = 0

/** FUNCTIONS */

/** CycleCreator Functions */

/* These functions must be defined by all modules that implement a
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
*/

export function init() {
  // Init logger
  p2pLogger = Context.logger.getLogger('p2p')

  // Init state
  reset()

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    Comms.registerInternal(name, handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset() {}

export function getTxs(): P2P.SafetyModeTypes.Txs {
  return
}

export function dropInvalidTxs(txs: P2P.SafetyModeTypes.Txs): P2P.SafetyModeTypes.Txs {
  return
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: P2P.SafetyModeTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
) {
  // If you're the first node
  if (Self.isFirst) {
    // Get saftey mode field values from snapshot
    Object.assign(record, Snapshot.safetyModeVals)
  }
  // If you're not the first node
  else {
    // Just copy the safety mode, safteyNum, and networkStateHash vals for now
    if (prev) {
      record.safetyMode = prev.safetyMode
      record.safetyNum = prev.safetyNum
      record.networkStateHash = prev.networkStateHash
    }
  }

  /**
   * [NOTE] The check for turning off safety mode once safefy number of nodes
   * have become active should probably go here.
   */
  if (record.safetyMode === true && prev) {
    if (prev.active >= prev.safetyNum) {
      record.safetyMode = false
    }
  }

  const stateHashes = Snapshot.getStateHashes(cycleNumberForNetworkDataHash)
  if (stateHashes && stateHashes.length > 0) {
    record.networkDataHash = stateHashes.map((stateHash) => {
      return {
        cycle: stateHash.counter,
        hash: stateHash.networkHash,
      }
    })
    if (record.networkDataHash.length > 0) {
      cycleNumberForNetworkDataHash = record.networkDataHash[record.networkDataHash.length - 1].cycle + 1
    }
  } else {
    record.networkDataHash = []
  }

  const receiptHashes = Snapshot.getReceiptHashes(cycleNumberForNetworkReceiptHash)
  if (receiptHashes && receiptHashes.length > 0) {
    record.networkReceiptHash = receiptHashes.map((receiptHash) => {
      return {
        cycle: receiptHash.counter,
        hash: receiptHash.networkReceiptHash,
      }
    })
    if (record.networkReceiptHash.length > 0) {
      cycleNumberForNetworkReceiptHash =
        record.networkReceiptHash[record.networkReceiptHash.length - 1].cycle + 1
    }
  } else {
    record.networkReceiptHash = []
  }

  const summaryHashes = Snapshot.getSummaryHashes(cycleNumberForNetworkSummaryHash)
  if (summaryHashes && summaryHashes.length > 0) {
    record.networkSummaryHash = summaryHashes.map((stateHash) => {
      return {
        cycle: stateHash.counter,
        hash: stateHash.networkSummaryHash,
      }
    })
    if (record.networkSummaryHash.length > 0) {
      cycleNumberForNetworkSummaryHash =
        record.networkSummaryHash[record.networkSummaryHash.length - 1].cycle + 1
    }
  } else {
    record.networkSummaryHash = []
  }
}

export function validateRecordTypes(rec: P2P.SafetyModeTypes.Record): string {
  // [TODO] Implement actual validation
  return ''
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  return {
    added: [],
    removed: [],
    updated: [],
  }
}

export function queueRequest(request) {}

export function sendRequests() {}
