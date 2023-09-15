import * as CycleChain from './CycleChain'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { enterRecovery, enterSafety, enterProcessing } from './Modes' 
import { config } from './Context'
import { targetCount } from './CycleAutoScale'
import { nestedCountersInstance } from '../utils/nestedCounters'

export function calculateToAcceptV2() {
  const prevRecord = CycleChain.newest
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
            console.log(`next addRem in processing: ${addRem}`)
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