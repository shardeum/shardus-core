import { Logger } from 'log4js'
import * as Snapshot from '../snapshot'
import * as Comms from './Comms'
import * as Context from './Context'
import * as CycleCreator from './CycleCreator'
import * as CycleParser from './CycleParser'
import * as Self from './Self'
import * as Types from './Types'

/** TYPES */

// No TXs for this module
export interface Txs {
  safetyMode: []
  safetyNum: []
  networkStateHash: []
}

export interface Record {
  safetyMode: boolean
  safetyNum: number
  networkStateHash: string
}

/** STATE */

let p2pLogger: Logger

/** ROUTES */

const gossipRoute: Types.GossipHandler = (payload) => {}

const routes = {
  internal: {},
  gossip: {
    gossip: gossipRoute,
  },
}

let cycleNumberForNetworkDataHash: number
let cycleNumberForNetworkReceiptHash: number
let cycleNumberForNetworkSummaryHash: number

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

export function getTxs(): Txs {
  return
}

export function dropInvalidTxs(txs: Txs): Txs {
  return
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: Txs,
  record: CycleCreator.CycleRecord,
  prev: CycleCreator.CycleRecord
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

  const stateHashes = Snapshot.getStateHashes(cycleNumberForNetworkDataHash ? cycleNumberForNetworkDataHash + 1 : record.counter - 1)
  if (stateHashes && stateHashes.length > 0) {
    record.networkDataHash = stateHashes.map(stateHash => {
      return {
        cycle: stateHash.counter,
        hash: stateHash.networkHash
      }
    })
    cycleNumberForNetworkDataHash += 1
  } else {
    record.networkDataHash = []
  }

  const receiptHashes = Snapshot.getReceiptHashes(cycleNumberForNetworkReceiptHash ? cycleNumberForNetworkReceiptHash + 1 : record.counter - 1)
  if (receiptHashes && receiptHashes.length > 0) {
    record.networkReceiptHash = receiptHashes.map(receiptHash => {
      return {
        cycle: receiptHash.counter,
        hash: receiptHash.networkReceiptHash
      }
    })
    cycleNumberForNetworkReceiptHash += 1
  } else {
    record.networkReceiptHash = []
  }

  const summaryHashes = Snapshot.getSummaryHashes(cycleNumberForNetworkSummaryHash ? cycleNumberForNetworkSummaryHash + 1 : record.counter - 1)
  if (summaryHashes && summaryHashes.length > 0) {
    record.networkSummaryHash = summaryHashes.map(stateHash => {
      return {
        cycle: stateHash.counter,
        hash: stateHash.networkSummaryHash
      }
    })
    cycleNumberForNetworkSummaryHash += 1
  } else {
    record.networkSummaryHash = []
  }
}

export function validateRecordTypes(rec: Record): string {
  // [TODO] Implement actual validation
  return ''
}

export function parseRecord(
  record: CycleCreator.CycleRecord
): CycleParser.Change {
  return {
    added: [],
    removed: [],
    updated: [],
  }
}

export function queueRequest(request) {}

export function sendRequests() {}

/** Module Functions */

function info(...msg) {
  const entry = `[CHANGE ME]: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `[CHANGE ME]: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `[CHANGE ME]: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
