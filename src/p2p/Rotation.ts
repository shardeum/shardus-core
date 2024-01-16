import { Logger } from 'log4js'
import { P2P } from '@shardus/types'
import { insertSorted, lerp, validateTypes } from '../utils'
import * as Comms from './Comms'
import { config, logger } from './Context'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as CycleCreator from './CycleCreator'
import * as CycleChain from './CycleChain'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { currentCycle } from './CycleCreator'
import { getExpiredRemovedV2 } from './ModeSystemFuncs'
import { logFlags } from '../logger'

/** STATE */

let p2pLogger: Logger

let lastLoggedCycle: number

/** ROUTES */

// const routes = {
//   internal: {},
// }

/** FUNCTIONS */

/** CycleCreator Functions */

export function init(): void {
  // Init logger
  p2pLogger = logger.getLogger('p2p')

  // Init state
  reset()
  lastLoggedCycle = 0

  // Register routes
  // for (const [name, handler] of Object.entries(routes.internal)) {
  //   Comms.registerInternal(name, handler)
  // }
}

export function reset(): void {
  return
}

export function getTxs(): P2P.RotationTypes.Txs {
  return {}
}

export function validateRecordTypes(rec: P2P.RotationTypes.Record): string {
  const err = validateTypes(rec, { expired: 'n', removed: 'a' })
  if (err) return err
  for (const item of rec.removed) {
    if (typeof item !== 'string') return 'items of removed array must be strings'
  }
  return ''
}

export function dropInvalidTxs(txs: P2P.RotationTypes.Txs): P2P.RotationTypes.Txs {
  return txs
}

/** Given the `txs` and `prev` cycle record, mutate the referenced `record` */
export function updateRecord(
  txs: P2P.RotationTypes.Txs & P2P.ApoptosisTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  if (!prev) {
    record.expired = 0
    record.removed = []
    return
  }

  {
    const { expired, removed } = getExpiredRemoved(prev.start, prev.desired, txs)
    nestedCountersInstance.countEvent('p2p', `results of getExpiredRemoved: expired: ${expired} removed: ${removed.length}`, 1)
    if (logFlags && logFlags.verbose) console.log(`results of getExpiredRemoved: expired: ${expired} removed: ${removed.length} array: ${removed}`)
  }

  // Allow the autoscale module to set this value
  const { expired, removed } = getExpiredRemovedV2(prev, lastLoggedCycle, txs, info)
  nestedCountersInstance.countEvent('p2p', `results of getExpiredRemovedV2: expired: ${expired} removed: ${removed.length}`, 1)
  if (logFlags && logFlags.verbose) console.log(`results of getExpiredRemovedV2: expired: ${expired} removed: ${removed.length} array: ${removed}`)

  record.expired = expired
  record.removed = removed // already sorted
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  // Look at the removed id's and make Self emit 'removed' if your own id is there
  if (record.removed.includes(Self.id)) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `self-removed c:${currentCycle}`, 1)
    Self.emitter.emit('removed', Self.id)
  }

  return {
    added: [],
    removed: record.removed,
    updated: [],
  }
}

export function queueRequest(): void {
  return
}

export function sendRequests(): void {
  return
}

/** Module Functions */

/** Returns the number of expired nodes and the list of removed nodes */
export function getExpiredRemoved(
  start: P2P.CycleCreatorTypes.CycleRecord['start'],
  desired: P2P.CycleCreatorTypes.CycleRecord['desired'],
  txs: P2P.RotationTypes.Txs & P2P.ApoptosisTypes.Txs
): { expired: number; removed: string[] } {
  let expired = 0
  const removed = []
  NodeList.potentiallyRemoved.clear()

  // Don't expire/remove any if nodeExpiryAge is negative
  if (config.p2p.nodeExpiryAge < 0) return { expired, removed }

  const active = NodeList.activeByIdOrder.length

  let expireTimestamp = (start - config.p2p.nodeExpiryAge) * 1000
  if (expireTimestamp < 0) expireTimestamp = 0

  // initialize the max amount to remove to our config value
  let maxRemove = config.p2p.maxRotatedPerCycle

  // initialize `scaleDownRemove` to at most any "excess" nodes more than
  // desired. it can't be less than zero.
  let scaleDownRemove = Math.max(active - desired, 0)

  //only let the scale factor impart a partial influence based on scaleInfluenceForShrink
  const scaledAmountToShrink = getScaledAmountToShrink()

  //limit the scale down by scaledAmountToShrink
  if (scaleDownRemove > scaledAmountToShrink) {
    scaleDownRemove = scaledAmountToShrink
  }

  //maxActiveNodesToRemove is a percent of the active nodes that is set as a 0-1 value in maxShrinkMultiplier
  //this is to prevent the network from shrinking too fast
  //make sure the value is at least 1
  const maxActiveNodesToRemove = Math.max(Math.floor(config.p2p.maxShrinkMultiplier * active), 1)

  const cycle = CycleChain.newest.counter
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
  // to avoid messing up the calculation above this next part can only make maxRemove smaller.
  // maxActiveNodesToRemove is a percent of the active nodes that is set as a 0-1 value in maxShrinkMultiplier
  if (maxRemove > config.p2p.amountToShrink && maxRemove > maxActiveNodesToRemove) {
    // yes, this max could be baked in earlier, but I like it here for clarity
    maxRemove = Math.max(config.p2p.amountToShrink, maxActiveNodesToRemove)
  }

  // get list of nodes that have been requested to be removed
  const apoptosizedNodesList = []
  for (const request of txs.apoptosis) {
    const node = NodeList.nodes.get(request.id)
    if (node) {
      apoptosizedNodesList.push(node.id)
    }
  }

  // Oldest node has index 0
  for (const node of NodeList.byJoinOrder) {
    // don't count syncing nodes in our expired count
    if (node.status === 'syncing') continue

    // once we've hit the first node that's not expired, stop counting
    if (node.joinRequestTimestamp > expireTimestamp) break

    // otherwise, count this node as expired
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

function info(...msg: string[]): void {
  const entry = `Rotation: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg: string[]): void {
  const entry = `Rotation: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg: string[]): void {
  const entry = `Rotation: ${msg.join(' ')}`
  p2pLogger.error(entry)
}

/** Returns a linearly interpolated value between `amountToShrink` and the same
* multiplied by a `scaleFactor`. The result depends on the
* `scaleInfluenceForShrink` */
function getScaledAmountToShrink(): number {
  const nonScaledAmount = config.p2p.amountToShrink
  const scaledAmount = config.p2p.amountToShrink * CycleCreator.scaleFactor
  const scaleInfluence = config.p2p.scaleInfluenceForShrink
  return Math.floor(lerp(nonScaledAmount, scaledAmount, scaleInfluence))
}
