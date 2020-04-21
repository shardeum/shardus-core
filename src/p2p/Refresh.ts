import { Logger } from 'log4js'
import * as Archivers from './Archivers'
import * as Comms from './Comms'
import { logger } from './Context'
import { CycleRecord } from './CycleCreator'
import { Change } from './CycleParser'
import { JoinedConsensor } from './Join'
import * as Types from './Types'

/**
 * This module is reponsible for refreshing cycle chain entries for consensors
 * and archivers that are not rotating and would be "forgotten" by the network.
 * In a network that has low amount of rotation or no rotation, a syncing node
 * would have to read the cycle chain all the way back to where the oldest node
 * in the network joined. If there is no rotation, this would mean reading back
 * to the begining of the cycle chain. To avoid this we refresh the join info
 * for the consensor or archiver. Thus the syncing node has to read back much
 * less to sync the cycle chain.
 */

/** TYPES */

export interface Txs {}

export interface Record {
  refreshedArchivers: Archivers.JoinedArchiver[]
  refreshedConsensors: JoinedConsensor[]
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

let p2pLogger: Logger

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
  // [TODO] Come up with a better policy for this
  let refreshedArchivers = []

  if (prev) {
    refreshedArchivers = prev.refreshedArchivers
    if (refreshedArchivers.length < 1) refreshedArchivers = prev.joinedArchivers
  }

  record.refreshedArchivers = refreshedArchivers
  record.refreshedConsensors = []
}

export function parseRecord(record: CycleRecord): Change {
  // If Archivers.archivers doesn't have a refreshedArchiver, put it in
  for (const refreshed of record.refreshedArchivers) {
    if (Archivers.archivers.has(refreshed.publicKey) === false) {
      Archivers.archivers.set(refreshed.publicKey, refreshed)
    }
  }
  // Omar added the following
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
  const entry = `Active: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Active: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Active: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
