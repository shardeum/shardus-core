import { Logger } from 'log4js'
import { P2P } from '@shardus/types'
import { insertSorted, lerp, validateTypes } from '../utils'
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
    if (typeof item !== 'string') return 'items of removed array must be strings'
  }
  return ''
}

export function dropInvalidTxs(txs: P2P.RotationTypes.Txs): P2P.RotationTypes.Txs {
  return txs
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: P2P.RotationTypes.Txs & P2P.ApoptosisTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
) {
  if (!prev) {
    record.expired = 0
    record.removed = []
    return
  }

  // Allow the autoscale module to set this value
  const { expired, removed } = getExpiredRemoved(prev.start, prev.desired, txs)

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
  desired: P2P.CycleCreatorTypes.CycleRecord['desired'],
  txs: P2P.RotationTypes.Txs & P2P.ApoptosisTypes.Txs
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

  let scaleDownRemove = 0
  if (active - desired > 0) scaleDownRemove = active - desired

  //only let the scale factor impart a partial influence based on scaleInfluenceForShrink
  let scaledAmountToShrink: number
  {
    const scaleInfluence = config.p2p.scaleInfluenceForShrink
    const nonScaledAmount = config.p2p.amountToShrink
    const scaledAmount = config.p2p.amountToShrink * CycleCreator.scaleFactor
    scaledAmountToShrink = Math.floor(lerp(nonScaledAmount, scaledAmount, scaleInfluence))
  }

  //limit the scale down by scaledAmountToShrink
  if (scaleDownRemove > scaledAmountToShrink) {
    scaleDownRemove = scaledAmountToShrink
  }

  //maxActiveNodesToRemove is a percent of the active nodes that is set as a 0-1 value in maxShrinkMultiplier
  //this is to prevent the network from shrinking too fast
  //make sure the value is at least 1
  const maxActiveNodesToRemove = Math.max(Math.floor(config.p2p.maxShrinkMultiplier * active), 1)

  let cycle = CycleChain.newest.counter
  if (cycle > lastLoggedCycle && scaleDownRemove > 0) {
    lastLoggedCycle = cycle
    info(
      'scale down dump:' +
        JSON.stringify({
          cycle,
          scaleFactor: CycleCreator.scaleFactor,
          scaleDownRemove,
          maxActiveNodesToRemove,
          desired,
          active,
          scaledAmountToShrink,
          maxRemove,
          expired,
        })
    )
  }

  // Allows the network to scale down even if node rotation is turned off
  if (maxRemove < 1) {
    maxRemove = scaleDownRemove
  } else {
    //else pick the higher of the two
    maxRemove = Math.max(maxRemove, scaleDownRemove)
  }

  // never remove more nodes than the difference between active and desired
  if (maxRemove > active - desired) maxRemove = active - desired

  // final clamp of max remove, but only if it is more than amountToShrink
  // to avoid messing up the calculation above this next part can only make maxRemove smaller
  if (maxRemove > config.p2p.amountToShrink) {
    //maxActiveNodesToRemove is a percent of the active nodes that is set as a 0-1 value in maxShrinkMultiplier
    if (maxRemove > maxActiveNodesToRemove) {
      //yes, this max could be baked in earlier, but I like it here for clarity
      maxRemove = Math.max(config.p2p.amountToShrink, maxActiveNodesToRemove)
    }
  }

  const apoptosizedNodesList = []
  for (const request of txs.apoptosis) {
    const node = NodeList.nodes.get(request.id)
    if (node) {
      apoptosizedNodesList.push(node.id)
    }
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
    if (config.p2p.uniqueRemovedIds) {
      // Limit the number of nodes that can be removed by removed + apoptosized
      if (removed.length + apoptosizedNodesList.length < maxRemove) {
        NodeList.potentiallyRemoved.add(node.id)
        if (!apoptosizedNodesList.includes(node.id)) {
          insertSorted(removed, node.id)
        }
      } else break
    } else {
      if (removed.length < maxRemove) {
        NodeList.potentiallyRemoved.add(node.id)
        insertSorted(removed, node.id)
      }
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
