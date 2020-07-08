import { Logger } from 'log4js'
import { initSafetyModeVals } from '../snapshot'
import * as Comms from './Comms'
import { logger } from './Context'
import { CycleRecord } from './CycleCreator'
import { Change } from './CycleParser'
import { isFirst } from './Self'
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

/** FUNCTIONS */

/** CycleCreator Functions */

/* These functions must be defined by all modules that implement a
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
*/

export function init() {
  // Init logger
  p2pLogger = logger.getLogger('p2p')

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
export function updateRecord(txs: Txs, record: CycleRecord, prev: CycleRecord) {
  // If you're the first node
  if (isFirst) {
    // Ask snapshot for saftey mode field values
    initSafetyModeVals().then(safetyModeVals => {
      Object.assign(record, safetyModeVals)
    })
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
  if (record.safetyMode === true) {
    if (prev.active >= prev.safetyNum) {
      record.safetyMode = false
    }
  }
}

export function validateRecordTypes(rec: Record): string {
  // [TODO] Implement actual validation
  return ''
}

export function parseRecord(record: CycleRecord): Change {
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
