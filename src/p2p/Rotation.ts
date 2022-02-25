import { Logger } from 'log4js'
import { P2P } from '@shardus/types'
import { insertSorted, validateTypes } from '../utils'
import * as Comms from './Comms'
import { config, logger } from './Context'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as CycleCreator from './CycleCreator'
import * as CycleChain from './CycleChain'

/** STATE */

let p2pLogger: Logger

let lastLoggedCycle: number

/** ROUTES */

// [TODO] - since we don't have any routes, no need to create and register this emply function
const gossipRoute: P2P.P2PTypes.GossipHandler = (payload) => {}

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
  lastLoggedCycle = 0

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    Comms.registerInternal(name, handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset() {}

export function getTxs(): P2P.RotationTypes.Txs {
  return {}
}

export function validateRecordTypes(rec: P2P.RotationTypes.Record): string {
  let err = validateTypes(rec, { expired: 'n', removed: 'a' })
  if (err) return err
  for (const item of rec.removed) {
    if (typeof item !== 'string')
      return 'items of removed array must be strings'
  }
  return ''
}

export function dropInvalidTxs(txs: P2P.RotationTypes.Txs): P2P.RotationTypes.Txs {
  return txs
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(txs: P2P.RotationTypes.Txs, record: P2P.CycleCreatorTypes.CycleRecord, prev: P2P.CycleCreatorTypes.CycleRecord) {
  if (!prev) {
    record.expired = 0
    record.removed = []
    return
  }

  // Allow the autoscale module to set this value
  const { expired, removed } = getExpiredRemoved(prev.start, prev.desired)

  record.expired = expired
  record.removed = removed // already sorted
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
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

export function getExpiredRemoved(
  start: P2P.CycleCreatorTypes.CycleRecord['start'],
  desired: P2P.CycleCreatorTypes.CycleRecord['desired']
) {
  let expired = 0
  const removed = []
  NodeList.potentiallyRemoved.clear()

  // Don't expire/remove any if nodeExpiryAge is negative
  if (config.p2p.nodeExpiryAge < 0) return { expired, removed }

  const active = NodeList.activeByIdOrder.length
  // const desired = getDesiredCount()

  let expireTimestamp = (start - config.p2p.nodeExpiryAge) * 1000
  if (expireTimestamp < 0) expireTimestamp = 0

  let maxRemove = config.p2p.maxRotatedPerCycle

  // Allows the network to scale down even if node rotation is turned off
  if (maxRemove < 1) {
    if (active - desired > 0) maxRemove = active - desired

    let scaledAmountToShrink = Math.floor(config.p2p.amountToShrink * CycleCreator.scaleFactor)
    if (maxRemove > scaledAmountToShrink)
      maxRemove = scaledAmountToShrink

    let cycle = CycleChain.newest.counter
    if(cycle > lastLoggedCycle){
      lastLoggedCycle = cycle
      info('scale down dump:' + JSON.stringify({cycle, scaleFactor:CycleCreator.scaleFactor, desired, active, scaledAmountToShrink, maxRemove, expired  })  )
    }
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
      NodeList.potentiallyRemoved.add(node.id)
      insertSorted(removed, node.id)
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
