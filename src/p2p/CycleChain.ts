import { p2p } from './Context'
import { LooseObject, P2PNode } from './Types'
import { CycleRecord } from './CycleCreator'

/** TYPES */

export interface UnfinshedCycle {
  metadata: LooseObject
  updates: LooseObject
  data: CycleRecord
}

/** STATE */

export let cycles: CycleRecord[] // [OLD, ..., NEW]
let cyclesByMarker: { [marker: string]: CycleRecord }

export let oldest: CycleRecord
export let newest: CycleRecord

function initialize() {
  cycles = []
  cyclesByMarker = {}
  oldest = null
  newest = null
}
initialize()

/** FUNCTIONS */

export function reset() {
  initialize()
}

export function append(cycle: CycleRecord) {
  const marker = p2p.state._computeCycleMarker(cycle)
  if (!cyclesByMarker[marker]) {
    cycles.push(cycle)
    cyclesByMarker[marker] = cycle
    newest = cycle
    if (!oldest) oldest = cycle

    // Add cycle to old p2p-state cyclechain
    // [TODO] Remove this once everything is using new CycleChain.ts
    p2p.state.addCycles([cycle])
  }
}
export function prepend(cycle: CycleRecord) {
  const marker = p2p.state._computeCycleMarker(cycle)
  if (!cyclesByMarker[marker]) {
    cycles.unshift(cycle)
    cyclesByMarker[marker] = cycle
    oldest = cycle
    if (!newest) newest = cycle
  }
}
export function validate(prev: CycleRecord, next: CycleRecord): boolean {
  // [TODO] actually validate
  return true
}
