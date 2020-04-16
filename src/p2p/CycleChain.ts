import { p2p, network, crypto, logger } from './Context'
import { LooseObject, P2PNode } from './Types'
import { CycleRecord } from './CycleCreator'
import { Logger } from 'log4js'

/** TYPES */

export interface UnfinshedCycle {
  metadata: LooseObject
  updates: LooseObject
  data: CycleRecord
}

/** STATE */

let mainLogger: Logger

export let cycles: CycleRecord[] // [OLD, ..., NEW]
export let cyclesByMarker: { [marker: string]: CycleRecord }

export let oldest: CycleRecord
export let newest: CycleRecord

/** FUNCTIONS */

export function init() {
  mainLogger = logger.getLogger('main')
  reset()
}

export function reset() {
  cycles = []
  cyclesByMarker = {}
  oldest = null
  newest = null
}

export function append(cycle: CycleRecord) {
  const marker = computeCycleMarker(cycle)
  if (!cyclesByMarker[marker]) {
    cycles.push(cycle)
    cyclesByMarker[marker] = cycle
    newest = cycle
    if (!oldest) oldest = cycle

    // Add cycle to old p2p-state cyclechain
    // Remove this once everything is using new CycleChain.ts
    // p2p.state.addCycles([cycle])
  }
}
export function prepend(cycle: CycleRecord) {
  const marker = computeCycleMarker(cycle)
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

export function getCycleChain(start, end = Infinity) {
  // Ensure start/end are positive and start <= end
  if (start < 0) start = 0
  if (end < 0) end = 0
  if (start > end) start = end

  // Convert start/end into idxs relative to our cycles array
  const offset = oldest ? oldest.counter : 0
  const relStart = start - offset < 0 ? 0 : start - offset
  const relEnd = end - offset < 0 ? 0 : end - offset

  return cycles.slice(relStart, relEnd + 1)
}

/** HELPER FUNCTIONS */

function computeCycleMarker (fields) {
  mainLogger.debug(`Computing cycle marker... Cycle marker fields: ${JSON.stringify(fields)}`)
  const cycleMarker = crypto.hash(fields)
  mainLogger.debug(`Created cycle marker: ${cycleMarker}`)
  return cycleMarker
}
