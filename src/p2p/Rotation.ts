import { Logger } from 'log4js'
import { insertSorted } from '../utils'
import * as Comms from './Comms'
import { config, logger } from './Context'
import * as CycleChain from './CycleChain'
import { CycleRecord } from './CycleCreator'
import { Change } from './CycleParser'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as Types from './Types'

/** TYPES */

export interface Txs {}

export interface Record {
  desired: number
  expired: number
  removed: string[]
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
  if (!prev) {
    record.desired = config.p2p.minNodes
    record.expired = 0
    record.removed = []
    return
  }

  // Allow the autoscale module to set this value
  const { expired, removed } = getExpiredRemoved(prev.start)

  record.desired = getDesiredCount() // Need to get this from autoscale module
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

export function getDesiredCount() {
  // config.p2p.maxNodes isn't used until we have autoscaling
  return config.p2p.minNodes
}

function getExpiredRemoved(start: CycleRecord['start']) {
  let expired = 0
  const removed = []

  // Don't expire/remove any if nodeExpiryAge is negative
  if (config.p2p.nodeExpiryAge < 0) return { expired, removed }

  const active = NodeList.activeByIdOrder.length
  const desired = getDesiredCount()

  let expireTimestamp = (start - config.p2p.nodeExpiryAge) * 1000
  if (expireTimestamp < 0) expireTimestamp = 0

  let maxRemove = config.p2p.maxNodesPerCycle
  if (maxRemove > active - desired) maxRemove = active - desired

  // Oldest node has index 0
  for (const node of NodeList.byJoinOrder) {
    // Don't count syncing nodes in your expired count
    if (node.status === 'syncing') continue
    // Once you hit the first node that's not expired, stop
    if (node.joinRequestTimestamp > expireTimestamp) break
    // Count the expired node
    expired++
    // Add it to removed if it isn't full
    if (removed.length < maxRemove) insertSorted(removed, node.id)
  }

  return { expired, removed }
}

function getExpiredCount(start: CycleRecord['start']) {
  // Don't expire any if nodeExpiryAge is negative
  if (config.p2p.nodeExpiryAge < 0) return 0

  let expireTimestamp = (start - config.p2p.nodeExpiryAge) * 1000
  if (expireTimestamp < 0) expireTimestamp = 0
  let expiredCount = 0

  // Oldest node has index 0
  for (const node of NodeList.byJoinOrder) {
    if (node.status === 'syncing') {
      continue
    }
    if (node.joinRequestTimestamp > expireTimestamp) break
    expiredCount++
  }

  return expiredCount
}

function getRemoved(active: number, desired: number) {
  // Don't remove any if nodeExpiryAge is negative
  if (config.p2p.nodeExpiryAge < 0) return []

  // Don't remove any if we have less than desired active nodes
  if (active <= desired) return []

  const start = CycleChain.newest.start
  const expireTimestamp = (start - config.p2p.nodeExpiryAge) * 1000
  const removed = []
  let maxRemove = config.p2p.maxNodesPerCycle
  if (maxRemove > active - desired) maxRemove = active - desired

  // Oldest node has index 0
  for (const node of NodeList.byJoinOrder) {
    if (node.status === 'syncing') continue
    if (node.joinRequestTimestamp > expireTimestamp) break
    removed.push(node.id)
    if (removed.length >= maxRemove) break
  }

  removed.sort()
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
