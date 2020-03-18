import { p2p } from './Context'
import { LooseObject, P2PNode } from './Types'

/** TYPES */

export interface SignedMarker {
  id: string
  marker: string
  sign: {
    owner: string
    sig: string
  }
}

export type Certificate = SignedMarker[]

export interface JoinedArchiver {
  curvePk: string
  ip: string
  port: number
  publicKey: string
}

// Should eventually become Node type from NodeList
export interface JoinedConsensor extends P2PNode {
  id: string
  cycleJoined: string
}

export interface Cycle {
  counter: number
  previous: string
  start: number
  duration: number
  active: number
  desired: number
  expired: number
  joined: string[]
  joinedArchivers: JoinedArchiver[]
  joinedConsensors: JoinedConsensor[]
  activated: string[]
  activatedPublicKeys: string[]
  removed: string[]
  returned: string[]
  lost: string[]
  refuted: string[]
  apoptosized: string[]
}

export interface UnfinshedCycle {
  metadata: LooseObject
  updates: LooseObject
  data: Cycle
}

/** STATE */

export let cycles: Cycle[] // [OLD, ..., NEW]
let cyclesByMarker: { [marker: string]: Cycle }

export let oldest: Cycle
export let newest: Cycle

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

export function append(cycle: Cycle) {
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
export function prepend(cycle: Cycle) {
  const marker = p2p.state._computeCycleMarker(cycle)
  if (!cyclesByMarker[marker]) {
    cycles.unshift(cycle)
    cyclesByMarker[marker] = cycle
    oldest = cycle
    if (!newest) newest = cycle
  }
}
export function validate(prev: Cycle, next: Cycle): boolean {
  // [TODO] actually validate
  return true
}
