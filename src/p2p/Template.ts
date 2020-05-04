import { Logger } from 'log4js'
import * as Comms from './Comms'
import { logger } from './Context'
import { CycleRecord } from './CycleCreator'
import { Change } from './CycleParser'
import * as Types from './Types'

/** TYPES */

export interface Txs {
  field: []
}

export interface Record {
  field: string
}

/** STATE */

let p2pLogger: Logger

/** ROUTES */

const gossipRoute: Types.GossipHandler = payload => {}

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
export function updateRecord(
  txs: Txs,
  record: CycleRecord,
  prev: CycleRecord
) {}

export function parseRecord(record: CycleRecord): Change {
  return
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
