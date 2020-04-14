import { Logger } from 'log4js'
import { logger } from './Context'
import * as Comms from './Comms'
import * as Types from './Types'

/** TYPES */

export interface Txs {
  txField: string
}

export interface Record {
  field: string
}

/** ROUTES */

const gossipRoute: Types.GossipHandler = payload => {}

const routes = {
  internal: {},
  gossip: {
    'gossip': gossipRoute
  },
}

/** STATE */

let mainLogger: Logger

/** FUNCTIONS */

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

export function getCycleTxs(): Txs {
  return
}

export function getCycleRecord(txs: Txs): Record {
  return
}