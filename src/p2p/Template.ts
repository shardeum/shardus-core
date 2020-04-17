import { Logger } from 'log4js'
import * as Comms from './Comms'
import { logger } from './Context'
import { CycleRecord } from './CycleCreator'
import * as Types from './Types'

/** TYPES */

export interface Txs extends SignedObject {
  timestamp: number
}

export interface Record {
  field: string
}

/** ROUTES */

const gossipRoute: Types.GossipHandler = payload => {}

const routes = {
  internal: {},
  gossip: {
    gossip: gossipRoute,
  },
}

/** STATE */

let mainLogger: Logger

/** FUNCTIONS */

/** EXPORTED FUNCTIONS */
/* These functions must be defined by all modules that implement a 
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
*/
export function init() {
  // Init logger
  mainLogger = logger.getLogger('main')

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

export function parseRecord(record: CycleRecord) {}

export function queueRequest(request) {}

export function sendRequests() {}
