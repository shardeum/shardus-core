import { Logger } from 'log4js'
import { P2P } from '../types'
import * as Comms from './Comms'
import { logger } from './Context'

/** STATE */

let p2pLogger: Logger

/** ROUTES */

const gossipRoute: P2P.P2PTypes.GossipHandler = payload => {}

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

export function getTxs(): P2P.TemplateTypes.Txs {
  return
}

export function dropInvalidTxs(txs: P2P.TemplateTypes.Txs): P2P.TemplateTypes.Txs {
  return
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: P2P.TemplateTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
) {}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
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
