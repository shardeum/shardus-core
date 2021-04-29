import { Logger } from 'log4js'
import { insertSorted, validateTypes } from '../utils'
import * as Comms from './Comms'
import { config, logger } from './Context'
import { CycleRecord } from './CycleCreator'
import { Change } from './CycleParser'
import { getDesiredCount } from './CycleAutoScale'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as Types from './Types'

/** TYPES */

export interface Txs {}

export interface Record {
  expired: number
  removed: string[]
}

/** STATE */

let p2pLogger: Logger

/** ROUTES */

// [TODO] - since we don't have any routes, no need to create and register this emply function
const gossipRoute: Types.GossipHandler = (payload) => {}

const routes = {
  internal: {},
  gossip: {
    gossip: gossipRoute,
  },
}

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

export function validateRecordTypes(rec: Record): string {
  let err = validateTypes(rec, { expired: 'n', removed: 'a' })
  if (err) return err
  for (const item of rec.removed) {
    if (typeof item !== 'string')
      return 'items of removed array must be strings'
  }
  return ''
}

export function dropInvalidTxs(txs: Txs): Txs {
  return txs
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(txs: Txs, record: CycleRecord, prev: CycleRecord) {
  if (!prev) {
    record.expired = 0
    record.removed = []
    return
  }

  // Allow the autoscale module to set this value
  const { expired, removed } = getExpiredRemoved(prev.start)

  record.expired = expired
  record.removed = removed // already sorted
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

function getExpiredRemoved(start: CycleRecord['start']) {
  let expired = 0
  const removed = []

  // Don't expire/remove any if nodeExpiryAge is negative
  if (config.p2p.nodeExpiryAge < 0) return { expired, removed }

  const active = NodeList.activeByIdOrder.length
  const desired = getDesiredCount()

  let expireTimestamp = (start - config.p2p.nodeExpiryAge) * 1000
  if (expireTimestamp < 0) expireTimestamp = 0

  let maxRemove = config.p2p.maxRotatedPerCycle
  if (maxRemove < 1) {
    if (active - desired > 0) maxRemove = active - desired
    if (maxRemove > config.p2p.amountToScale)
      maxRemove = config.p2p.amountToScale
  } else {
    if (maxRemove > active - desired) maxRemove = active - desired
  }

  // Oldest node has index 0
  for (const node of NodeList.byJoinOrder) {
    // Don't count syncing nodes in your expired count
    if (node.status === 'syncing') continue
    // Once you hit the first node that's not expired, stop
    if (node.joinRequestTimestamp > expireTimestamp) break
    // Count the expired node
    expired++
    // Add it to removed if it isn't full
    if (removed.length < maxRemove) {
      insertSorted(removed, node.id)
      node.status = Types.NodeStatus.REMOVED
    }
  }

  return { expired, removed }
}

function info(...msg) {
  const entry = `Rotation: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Rotation: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Rotation: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
