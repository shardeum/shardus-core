import { Logger } from 'log4js'
import { insertSorted } from '../utils'
import * as Comms from './Comms'
import { config, logger } from './Context'
import { CycleRecord } from './CycleCreator'
import { Change } from './CycleParser'
import { byJoinOrder, activeByIdOrder } from './NodeList'
import * as Self from './Self'
import * as Types from './Types'

/** TYPES */

export interface Txs {}

export interface Record {
  desired: number
  expired: number
  removed: string[]
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
  return {}
}

export function dropInvalidTxs(txs: Txs): Txs {
  return txs
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(txs: Txs, record: CycleRecord, prev: CycleRecord) {
  record.desired = getDesired(prev.active)
  record.expired = getExpiredCount(prev.start)
  record.removed = getRemoved(prev.active, record.desired, record.expired) // already sorted
}

export function parseRecord(record: CycleRecord): Change {
  // Look at the removed id's and make Self emit 'removed' if your own id is there
  if (record.removed.includes(Self.id)) {
    Self.emitter.emit('removed', Self.id)
  }

  return {
    added: [],
    removed: record.removed,
    updated: [],
  }
}

export function queueRequest(request) {}

export function sendRequests() {}

/** Module Functions */

function getDesired(active: number) {
  // config.p2p.maxNodes isn't used until we have autoscaling
  return config.p2p.minNodes
}

function getExpiredCount(start: CycleRecord['start']) {
  // This line allows for a configuration in which nodes never expire
  if (config.p2p.nodeExpiryAge === 0) return 0

  const expiredTime = start - config.p2p.nodeExpiryAge

  let expired = 0
  for (const node of byJoinOrder) {
    if (node.joinRequestTimestamp > expiredTime) expired++
  }

  return expired
}

function getRemoved(active: number, desired: number, expired: number) {
  // Don't remove any if we have less than desired active nodes
  if (active <= desired) return []

  // Get expired IDs
  const expiredIds = byJoinOrder.slice(0, expired).map(node => node.id)

  // Get beyond desired extra node IDs
  const extra = active - desired - expired
  if (extra < 0) return []

  return removed
}

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
