
import * as NodeList from './NodeList'
import * as Self from './Self'
import { enterRecovery, enterSafety, enterProcessing } from './Modes'
import { config } from './Context'
import { targetCount } from './CycleAutoScale'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { P2P } from '@shardus/types'
import { insertSorted, lerp } from '../utils'
import * as CycleCreator from './CycleCreator'
import * as CycleChain from './CycleChain'

export function calculateToAcceptV2(prevRecord: P2P.CycleCreatorTypes.CycleRecord) {
  const active = NodeList.activeByIdOrder.length
  const syncing = NodeList.byJoinOrder.length - NodeList.activeByIdOrder.length
  // For now, we are using the desired value from the previous cycle. In the future, we should look at using the next desired value
  const desired = prevRecord.desired
  const target = targetCount

  nestedCountersInstance.countEvent('p2p', `desired: ${desired}, target: ${target}, active: ${active}, syncing: ${syncing}`)
  console.log(`prevCounter: ${prevRecord.counter}, desired: ${desired}, target: ${target}, active: ${active}, syncing: ${syncing}`)

  let add = 0
  let remove = 0
  console.log("ModeSystemFuncs: before prevRecord check")
  if (prevRecord) {
    console.log("ModeSystemFuncs: passed prevRecord check")
    if (prevRecord.mode === 'forming') {
      if (Self.isFirst) {
        console.log("ModeSystemFuncs: seed node reaches here")
        add = target
        remove = 0
        return { add, remove }
      } else if (active != desired) {
        let addRem = target - (active + syncing)
        console.log(`under forming active != desired; addRem: ${addRem}`)
        if (addRem > 0) {
          add = Math.ceil(addRem)
          remove = 0
          console.log("ModeSystemFuncs: 1 return")
          return { add, remove }
        }
        if (addRem < 0) {
          addRem = active - target
          if (addRem > 0) {
            if (addRem > 0.1 * active) {
              addRem = 0.1 * active
            }
            if (addRem < 1) {
              addRem = 1
            }

            add = 0
            remove = Math.ceil(addRem)
            console.log("ModeSystemFuncs: 2 return")
            return { add, remove }
          } else {
            console.log("ModeSystemFuncs: 3 return")
            return { add, remove }
          }
        } else {
          console.log("ModeSystemFuncs: 4 return")
          return { add, remove }
        }
      }
    } else if (prevRecord.mode === 'processing') {
      if (enterSafety(active, prevRecord) === false && enterRecovery(active) === false) {
        if (active !== ~~target) {
          // calculate nodes to add or remove
          let addRem = target - (active + syncing)
          if (addRem > 0) {
            if (addRem > active * 0.1) { // limit nodes added to 10% of active; we are here because many were lost
              addRem = ~~(active * 0.1)
              if (addRem === 0) {
                addRem = 1
              }
            }

            add = Math.ceil(addRem)
            remove = 0
            console.log("ModeSystemFuncs: 5 return")
            return { add, remove }
          }
          if (addRem < 0) {
            addRem = active - target   // only remove the active nodes more than target
            console.log(`addRem in processing: ${addRem}`)
            if (addRem > active * 0.05) { // limit nodes removed to 5% of active; this should not happen
              console.log("unexpected addRem > 5% of active", addRem, active, target, desired)
              addRem = ~~(active * 0.05)
              if (addRem === 0) {
                addRem = 1
              }
            }
            if (addRem > 0) {
              if (addRem > active * 0.05) { // don't ever remove more than 10% of active per cycle
                addRem = active * 0.05
              }
              if (addRem < 1) {
                addRem = 1
              }
              add = 0
              remove = Math.ceil(addRem)
              console.log("ModeSystemFuncs: 6 return")
              return { add, remove }
            } else {
              console.log("ModeSystemFuncs: 7 return")
              return { add, remove }
            }
          } else {
            console.log("ModeSystemFuncs: 8 return")
            return { add, remove }
          }
        }
      }
    } else if (prevRecord.mode === 'safety') {
      if (enterProcessing(active) === false && enterRecovery(active) === false) {
        let addRem = 1.02 * config.p2p.minNodes - (active + syncing) // we try to overshoot min value by 2%; for slow syncing nodes
        if (addRem > active * 0.05) {
          addRem = ~~(active * 0.05)
          if (addRem === 0) {
            addRem = 1
          }
        }
        addRem += prevRecord.lost.length  // compensate for nodes that were lost; though this could add more burden on existing nodes
        if (addRem > 0) {
          add = Math.ceil(addRem)
          remove = 0
          console.log("ModeSystemFuncs: 9 return")
          return { add, remove }
        }
      }
    } else if (prevRecord.mode === 'recovery') {
      if (enterSafety(active, prevRecord) === false) {
        let addRem = 0.62 * config.p2p.minNodes - (active + syncing) // we try to overshoot min value by 2%; for slow syncing nodes
        if (addRem > active * 0.1) { // we really should be looking at how many archivers are available to sync from
          addRem = ~~(active * 0.1)
          if (addRem === 0) {
            addRem = 1
          }
        }
        if (addRem > 0) {
          add = Math.ceil(addRem)
          remove = 0
          console.log("ModeSystemFuncs: 10 return")
          return { add, remove }
        }
      }
    }
  }
  return { add, remove }
}


// need to think about and maybe ask Omar about using prev record for determining mode, could use next record


/** Returns the number of expired nodes and the list of removed nodes using calculateToAcceptV2 */
export function getExpiredRemovedV2(
  prevRecord: P2P.CycleCreatorTypes.CycleRecord,
  lastLoggedCycle: number,
  txs: P2P.RotationTypes.Txs & P2P.ApoptosisTypes.Txs,
  info: (...msg: string[]) => void
): { expired: number; removed: string[] } {
  const start = prevRecord.start
  let expired = 0
  const removed = []
  NodeList.potentiallyRemoved.clear()

  // Don't expire/remove any if nodeExpiryAge is negative
  if (config.p2p.nodeExpiryAge < 0) return { expired, removed }

  const active = NodeList.activeByIdOrder.length

  let expireTimestamp = (start - config.p2p.nodeExpiryAge) * 1000
  if (expireTimestamp < 0) expireTimestamp = 0

  // initialize the max amount to remove to our config value
  // let maxRemove = config.p2p.maxRotatedPerCycle //TODO check if this is needed

  // calculate the target number of nodes
  const { add, remove } = calculateToAcceptV2(prevRecord)
  nestedCountersInstance.countEvent('p2p', `results of getExpiredRemovedV2.calculateToAcceptV2: add: ${add}, remove: ${remove}`)
  // initialize `scaleDownRemove` to at most any "excess" nodes more than
  // desired. it can't be less than zero.
  let maxRemove = remove

  //only let the scale factor impart a partial influence based on scaleInfluenceForShrink
  // const scaledAmountToShrink = getScaledAmountToShrink() //TODO check if this is needed

  //limit the scale down by scaledAmountToShrink
  // if (scaleDownRemove > scaledAmountToShrink) {
  //   scaleDownRemove = scaledAmountToShrink
  // }

  //maxActiveNodesToRemove is a percent of the active nodes that is set as a 0-1 value in maxShrinkMultiplier
  //this is to prevent the network from shrinking too fast
  //make sure the value is at least 1
  // const maxActiveNodesToRemove = Math.max(Math.floor(config.p2p.maxShrinkMultiplier * active), 1)

  const cycle = CycleChain.newest.counter
  if (cycle > lastLoggedCycle && maxRemove > 0) {
    lastLoggedCycle = cycle
    info(
      'scale down dump:' +
        JSON.stringify({
          cycle,
          scaleFactor: CycleCreator.scaleFactor,
          // scaleDownRemove,
          // maxActiveNodesToRemove,
          desired: prevRecord.desired,
          active,
          // scaledAmountToShrink,
          maxRemove,
          expired,
        })
    )
  }

  //TODO not sure we still need the following block anymore

  // Allows the network to scale down even if node rotation is turned off
  // if (maxRemove < 1) {
  //   maxRemove = scaleDownRemove
  // } else {
  //   //else pick the higher of the two
  //   maxRemove = Math.max(maxRemove, scaleDownRemove)
  // }

  // never remove more nodes than the difference between active and desired
  // if (maxRemove > active - desired) maxRemove = active - desired // [TODO] - this is handled inside calculateToAcceptV2

  // final clamp of max remove, but only if it is more than amountToShrink
  // to avoid messing up the calculation above this next part can only make maxRemove smaller.
  // maxActiveNodesToRemove is a percent of the active nodes that is set as a 0-1 value in maxShrinkMultiplier
  // if (maxRemove > config.p2p.amountToShrink && maxRemove > maxActiveNodesToRemove) {
    // yes, this max could be baked in earlier, but I like it here for clarity
    // maxRemove = Math.max(config.p2p.amountToShrink, maxActiveNodesToRemove)
  // }

  //TODO end of block

  nestedCountersInstance.countEvent('p2p', `results of getExpiredRemovedV2: scaleDownRemove: maxRemove: ${maxRemove}`)
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


/** Returns a linearly interpolated value between `amountToShrink` and the same
* multiplied by a `scaleFactor`. The result depends on the
* `scaleInfluenceForShrink` */
function getScaledAmountToShrink(): number {
  const nonScaledAmount = config.p2p.amountToShrink
  const scaledAmount = config.p2p.amountToShrink * CycleCreator.scaleFactor
  const scaleInfluence = config.p2p.scaleInfluenceForShrink
  return Math.floor(lerp(nonScaledAmount, scaledAmount, scaleInfluence))
}