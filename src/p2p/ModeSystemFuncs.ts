import * as NodeList from './NodeList'
import * as Self from './Self'
import { enterRecovery, enterSafety, enterProcessing, enterShutdown } from './Modes'
import { config } from './Context'
import { targetCount } from './CycleAutoScale'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { P2P } from '@shardus/types'
import { insertSorted, lerp } from '../utils'
import * as CycleCreator from './CycleCreator'
import * as CycleChain from './CycleChain'
import { logFlags } from '../logger'

interface ToAcceptResult {
  add: number
  remove: number
}

export function calculateToAcceptV2(prevRecord: P2P.CycleCreatorTypes.CycleRecord): ToAcceptResult {
  const active = NodeList.activeByIdOrder.length
  const syncing = NodeList.byJoinOrder.length - NodeList.activeByIdOrder.length
  // For now, we are using the desired value from the previous cycle. In the future, we should look at using the next desired value
  const desired = prevRecord.desired
  const target = targetCount

  nestedCountersInstance.countEvent(
    'p2p',
    `desired: ${desired}, target: ${target}, active: ${active}, syncing: ${syncing}`
  )
  /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log(`prevCounter: ${prevRecord.counter}, desired: ${desired}, target: ${target}, active: ${active}, syncing: ${syncing}`)

  let add = 0
  let remove = 0
  if (prevRecord) {
    if (prevRecord.mode === 'forming') {
      if (Self.isFirst && active < 1) {
        add = target
        remove = 0
        return { add, remove }
      } else if (active != desired) {
        let addRem = target - (active + syncing)
        /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log(`under forming active != desired; addRem: ${addRem}`)
        if (addRem > 0) {
          add = Math.ceil(addRem)
          remove = 0
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
            return { add, remove }
          }
        }
      }
    } else if (prevRecord.mode === 'restart') {
      if (syncing < desired + config.p2p.extraNodesToAddInRestart) {
        const addRem = target - syncing
        /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log(`under restart active != desired; addRem: ${addRem}`)
        if (addRem > 0) {
          add = Math.ceil(addRem)
          remove = 0
          return { add, remove }
        }
      }
    } else if (prevRecord.mode === 'processing') {
      if (enterSafety(active) === false && enterRecovery(active) === false) {
        /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("max rotated per cycle: ", config.p2p.maxRotatedPerCycle)
        if (active !== ~~target) {
          // calculate nodes to add or remove
          /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("active not equal target")
          let addRem = target - (active + syncing)
          /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("addRem ", addRem)
          if (addRem > 0) {
            if (addRem > active * config.p2p.rotationMaxAddPercent) {
              // limit nodes added to 10% of active; we are here because many were lost
              addRem = ~~(active * config.p2p.rotationMaxAddPercent)
              if (addRem === 0) {
                addRem = 1
              }
            }

            add = Math.ceil(addRem)
            remove = 0

            /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `calculateToAcceptV2 c:${prevRecord.counter} active !== ~~target, addRem > 0 add: ${add}, remove: ${remove}`)
            return { add, remove }
          }
          if (addRem < 0) {
            //Note that we got here earlier because syncing nodes were "counting against us"
            //now we will look at addRem where syncing nodes are not considered
            let toRemove = active - target // only remove the active nodes more than target
            /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log(`addRem in processing: ${toRemove}`)
            if (toRemove > active * config.p2p.rotationMaxRemovePercent) {
              // limit nodes removed to 5% of active; this should not happen
              console.log('unexpected addRem > 5% of active', toRemove, active, target, desired)
              //~~ truncate the value of rnum i.e. fast Math.floor()
              toRemove = ~~(active * config.p2p.rotationMaxRemovePercent)
              if (toRemove === 0) {
                toRemove = 1
              }
            }
            //keep in mind that we use (active - target), so this value means we have too many nodes more than target
            if (toRemove > 0) {
              if (toRemove > active * config.p2p.rotationMaxRemovePercent) {
                // don't ever remove more than 5% of active per cycle
                toRemove = active * config.p2p.rotationMaxRemovePercent
              }
              if (toRemove < 1) {
                toRemove = 1
              }
              add = 0
              remove = Math.ceil(toRemove)
              /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `calculateToAcceptV2 c:${prevRecord.counter} active !== ~~target, addRem < 0 (remove) add: ${add}, remove: ${remove}`)
              return { add, remove }
            } else {
              //this is a case where syncing nodes are counting against us and we need to take a careful look to allow
              //some nodes to sync and go active  (can look at median time )

              // for now we will use an approximation that we want to rotate one per cycle
              // consier this a stand in for the 0.1% of active, but rounded up... i.e   1 for 1-1999 node networks
              const desiredRotationPerCycle = 1
              //const estimatedCyclesToSyncAndGoActive = 5

              //we can make a max syncing number that is based on our rotation rate desires and average syncing times
              //const maxSyncing = estimatedCyclesToSyncAndGoActive * desiredRotationPerCycle

              //for now max syncing can be based on our fudge factors
              const maxSyncing =
                desiredRotationPerCycle * config.p2p.rotationCountMultiply + config.p2p.rotationCountAdd + 1
              //note added +1 at the end so we can always buffere at least one syncing node if we hit this case

              if (syncing < maxSyncing) {
                //test code to see if we can manipulate a network to rotate at a better rate.
                // addRem = config.p2p.rotationCountMultiply * addRem
                // addRem = config.p2p.rotationCountAdd + addRem

                add = maxSyncing - syncing

                /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `calculateToAcceptV2 c:${prevRecord.counter} active !== ~~target, addRem < 0 (not-remove) add: ${add}, remove: ${remove}`)
                return { add, remove }
              }
            }
          }
        } else if (config.p2p.maxRotatedPerCycle !== 0) {
          //This essentially active === target and we have a non zero maxRotatedPerCycle
          /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("entered rotation")
          let rnum = config.p2p.maxRotatedPerCycle // num to rotate per cycle; can be less than 1; like 0.5 for every other cycle; -1 for auto
          if (rnum < 0) {
            // rotate all nodes in 1000 cycles
            rnum = active * config.p2p.rotationPercentActive
          }
          if (rnum < 1) {
            //This is supposed to be true rnum % of the time, that does not work
            //the math is wrong.  fortunately we can avoid this if maxRotatedPerCycle >= 1
            if (prevRecord.counter % (1 / rnum) === 0) {
              // rotate every few cycles if less than 1000 nodes
              rnum = 1
            } else {
              rnum = 0
            }
          }
          if (rnum > 0) {
            if (rnum > active * config.p2p.rotationPercentActive) {
              //~~ truncate the value of rnum i.e. fast Math.floor()
              rnum = ~~(active * config.p2p.rotationPercentActive)
              if (rnum < 1) {
                rnum = 1
              }
            }

            //test code to see if we can manipulate a network to rotate at a better rate.
            rnum = config.p2p.rotationCountMultiply * rnum
            rnum = config.p2p.rotationCountAdd + rnum

            /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("rnum: ", rnum)
            /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("setting add to rnum")
            add = Math.ceil(rnum)
            remove = 0
          }

          /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `calculateToAcceptV2 c:${prevRecord.counter} config.p2p.maxRotatedPerCycle !== 0 add: ${add}, remove: ${remove}`)
          /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log(`add: ${add}, remove: ${remove}`)
          return { add, remove }
        }
      }
    } else if (prevRecord.mode === 'safety') {
      if (enterProcessing(active) === false && enterRecovery(active) === false) {
        // since in safety mode, will use minNodes as the threshold to enter back into processing mode
        let addRem = 1.02 * config.p2p.minNodes - (active + syncing) // we try to overshoot min value by 2%; for slow syncing nodes
        if (addRem > active * 0.05) {
          addRem = ~~(active * 0.05)
          if (addRem === 0) {
            addRem = 1
          }
        }
        // Is this needed for lost nodes? lost nodes didn't get removed in next cycle if they refuted
        // Or is the intention to use the removed nodes in the previous cycle? If so, we can also consider apoptosized nodes as well.
        addRem += prevRecord.lost.length // compensate for nodes that were lost; though this could add more burden on existing nodes
        if (addRem > 0) {
          add = Math.ceil(addRem)
          remove = 0
          return { add, remove }
        }
      }
    } else if (prevRecord.mode === 'recovery') {
      if (enterShutdown(active) === false) {
        const totalNodeCount = active + syncing
        let addRem = target - totalNodeCount
        if (addRem > totalNodeCount * 0.2) {
          addRem = ~~(totalNodeCount * 0.2) // Add 20% more nodes on each cycle
          if (addRem === 0) {
            addRem = 1
          }
        }
        if (addRem > 0) {
          add = Math.ceil(addRem)
          remove = 0
          return { add, remove }
        }
      }
    } else if (prevRecord.mode === 'restore') {
      const addRem = target - (active + syncing)
      if (addRem > 0) {
        add = Math.ceil(addRem)
        return { add, remove }
      }
    }
  }
  /* prettier-ignore */ if (logFlags.verbose) console.log('add remove returned from default')
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

  let expireTimestamp = start - config.p2p.nodeExpiryAge
  if (expireTimestamp < 0) expireTimestamp = 0

  // initialize the max amount to remove to our config value
  // let maxRemove = config.p2p.maxRotatedPerCycle //TODO check if this is needed

  // calculate the target number of nodes
  const { add, remove } = calculateToAcceptV2(prevRecord)
  nestedCountersInstance.countEvent(
    'p2p',
    `results of getExpiredRemovedV2.calculateToAcceptV2: add: ${add}, remove: ${remove}`
  )
  // initialize `scaleDownRemove` to at most any "excess" nodes more than
  // desired. it can't be less than zero.
  const maxRemove = remove

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

  nestedCountersInstance.countEvent(
    'p2p',
    `results of getExpiredRemovedV2: scaleDownRemove: maxRemove: ${maxRemove}`
  )
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
    // updated to use activeTimestamp as this is when the node has gone active for us
    if (node.activeTimestamp > expireTimestamp) break

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
